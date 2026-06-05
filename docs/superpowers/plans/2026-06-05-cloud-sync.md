# 手冲手记 · 云同步 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让手机和电脑通过一个免费 Cloudflare 服务自动同步咖啡数据，一条不丢、无需手动导出导入。

**Architecture:** 本地 localStorage 仍是主存（离线照常用）；新增一个纯函数 `merge.js` 负责「逐条合并/末次修改胜出」；`sync.js` 在打开/存档/联网时自动 pull→merge→push；Cloudflare Pages 托管网页、Pages Function 提供 `/api/data` 同步接口、KV 按「同步码」分格存数据，服务端 push 时再合并一次兜底。

**Tech Stack:** 原生 JavaScript（无框架）、Node 22 自带的 `node --test`、Cloudflare Pages + Functions + KV、`npx wrangler` 部署。

> 实现说明：设计文档第 3 节的「软删除」原计划在每条记录上加 `deleted` 字段并在渲染处过滤。本计划改用等价但更安全的做法——删除时仍从数组移除（现有渲染/分析代码无需改动），另用 `state.tombstones`（被删 id → 删除时间）单独记录墓碑，仅在合并时使用。用户可见行为完全一致：删除能跨设备传播、不会死灰复活、不丢数据。

---

## 文件结构

| 文件 | 状态 | 职责 |
|---|---|---|
| `merge.js` | 新建 | 纯函数：合并两份数据（记录按 `updatedAt` 取新、墓碑压制已删记录）。浏览器挂全局 `SyncMerge`，Node 用 `module.exports`。 |
| `merge.test.js` | 新建 | `node --test` 单测，覆盖合并各场景。 |
| `sync.js` | 新建 | 同步客户端：读写同步码、`pull`/`push`、状态回调。浏览器挂全局 `SyncClient`。 |
| `functions/api/data.js` | 新建 | Cloudflare Pages Function：`GET`/`POST /api/data`，校验同步码、读写 KV、服务端二次合并。 |
| `wrangler.toml` | 新建 | Pages 项目配置 + KV 绑定。 |
| `app.js` | 修改 | 数据模型加 `updatedAt`+`tombstones`、软删除、加载时补字段、存档后触发同步、导出/导入带墓碑。 |
| `index.html` | 修改 | 引入 `merge.js`/`sync.js`、新增「云同步」面板。 |
| `sw.js` | 修改 | 缓存清单加入 `merge.js`/`sync.js`，版本号 +1。 |
| `部署云同步.md` | 新建 | 给用户的逐步部署说明。 |

---

## Task 1: 数据模型——加 updatedAt、墓碑、软删除

**Files:**
- Modify: `D:/Documents/coffee-log/app.js`（store.load / 新增豆 / 编辑豆 / 删除豆 / 新增冲煮 / 编辑冲煮 / 删除冲煮）

- [ ] **Step 1: 在 `state` 初始结构里加 `tombstones`**

找到 store 层的初始 state（约 `let state = { version: 1, beans: [], brews: [] };`），改为：

```javascript
let state = { version: 1, beans: [], brews: [], tombstones: { beans: {}, brews: {} } };
```

- [ ] **Step 2: `store.load()` 里向后兼容补字段**

在 `store.load()` 解析出数据后、赋值给 `state` 之前，确保旧数据补齐新字段。把 load 中读到的对象规整为：

```javascript
load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    state = {
      version: 1,
      beans: Array.isArray(data.beans) ? data.beans : [],
      brews: Array.isArray(data.brews) ? data.brews : [],
      tombstones: {
        beans: (data.tombstones && data.tombstones.beans) || {},
        brews: (data.tombstones && data.tombstones.brews) || {},
      },
    };
    // 旧记录没有 updatedAt：用 createdAt 兜底，保证合并时有可比时间
    for (const b of state.beans) if (b.updatedAt == null) b.updatedAt = b.createdAt || 0;
    for (const r of state.brews) if (r.updatedAt == null) r.updatedAt = r.createdAt || 0;
  } catch (e) {
    console.warn("读取本地数据失败，按空数据处理", e);
  }
}
```

> 注意：以实际 `store.load()` 现有写法为准，保留其原有的 try/catch 与键名 `STORAGE_KEY`，只把「补字段 + tombstones」这部分合并进去。

- [ ] **Step 3: 新增豆子时写 `updatedAt`**

在 `onSaveBean` 的「创建」分支（`state.beans.push({ id: uid(), createdAt: Date.now(), ...data })`）里加上 `updatedAt`：

```javascript
const now = Date.now();
state.beans.push({ id: uid(), createdAt: now, updatedAt: now, ...data });
```

- [ ] **Step 4: 编辑豆子时刷新 `updatedAt`**

在 `onSaveBean` 的「编辑」分支（`Object.assign(bean, data)`）后补一行：

```javascript
Object.assign(bean, data);
bean.updatedAt = Date.now();
```

- [ ] **Step 5: 删除豆子改为「移除 + 打墓碑」（连带其冲煮）**

把 `deleteBean` 里的硬删除：

```javascript
state.beans = state.beans.filter((b) => b.id !== id);
state.brews = state.brews.filter((b) => b.beanId !== id);
```

改为：

```javascript
const now = Date.now();
state.tombstones.beans[id] = now;
state.beans = state.beans.filter((b) => b.id !== id);
for (const r of state.brews) {
  if (r.beanId === id) state.tombstones.brews[r.id] = now;
}
state.brews = state.brews.filter((b) => b.beanId !== id);
```

- [ ] **Step 6: 新增冲煮时写 `updatedAt`**

在 `onSaveBrew` 的「创建」分支（`state.brews.push({ id: uid(), createdAt: Date.now(), ...data })`）里：

```javascript
const now = Date.now();
state.brews.push({ id: uid(), createdAt: now, updatedAt: now, ...data });
```

- [ ] **Step 7: 编辑冲煮时刷新 `updatedAt`**

在 `onSaveBrew` 的「编辑」分支（`Object.assign(brew, data)`）后补一行：

```javascript
Object.assign(brew, data);
brew.updatedAt = Date.now();
```

- [ ] **Step 8: 删除冲煮改为「移除 + 打墓碑」**

把 `deleteBrew` 里的：

```javascript
state.brews = state.brews.filter((b) => b.id !== id);
```

改为：

```javascript
state.tombstones.brews[id] = Date.now();
state.brews = state.brews.filter((b) => b.id !== id);
```

- [ ] **Step 9: 手动验证**

用浏览器打开 `index.html`，新增一包豆+一杯，删除其中一杯。打开开发者工具 Console 执行 `JSON.parse(localStorage["coffee-log-v1"])`，确认：
- 现存记录都有 `updatedAt`；
- 被删冲煮的 id 出现在 `tombstones.brews` 里；
- 页面上看不到被删记录（渲染行为不变）。

- [ ] **Step 10: Commit**

```bash
git add app.js
git commit -m "feat(sync): 数据模型加 updatedAt 与墓碑，删除改软删除"
```

---

## Task 2: 纯合并函数 `merge.js` + 单测（TDD）

**Files:**
- Create: `D:/Documents/coffee-log/merge.js`
- Test: `D:/Documents/coffee-log/merge.test.js`

> 这是整个同步的核心业务规则。合并的「谁胜出、墓碑何时压制记录」是有真实取舍的判断点（见 Step 3 注释），适合在执行阶段请用户亲手写这 ~8 行。计划里给出完整参考实现以保证可执行、无歧义。

- [ ] **Step 1: 写失败的测试**

创建 `merge.test.js`：

```javascript
const { test } = require("node:test");
const assert = require("node:assert");
const { mergeState } = require("./merge.js");

// 工具：造一份 state
const S = (beans = [], brews = [], tombstones = { beans: {}, brews: {} }) => ({
  version: 1, beans, brews, tombstones,
});

test("只有一边有的记录会被保留", () => {
  const a = S([{ id: "x", updatedAt: 1 }]);
  const b = S([{ id: "y", updatedAt: 1 }]);
  const out = mergeState(a, b);
  assert.deepStrictEqual(out.beans.map((r) => r.id).sort(), ["x", "y"]);
});

test("同 id 取 updatedAt 较新的那条", () => {
  const a = S([{ id: "x", updatedAt: 1, note: "旧" }]);
  const b = S([{ id: "x", updatedAt: 2, note: "新" }]);
  const out = mergeState(a, b);
  assert.strictEqual(out.beans.length, 1);
  assert.strictEqual(out.beans[0].note, "新");
});

test("墓碑删除时间晚于记录修改时间 → 记录被删掉", () => {
  const a = S([{ id: "x", updatedAt: 5 }]);
  const b = S([], [], { beans: { x: 9 }, brews: {} });
  const out = mergeState(a, b);
  assert.strictEqual(out.beans.length, 0);
});

test("删除后又编辑（updatedAt 晚于删除时间）→ 记录复活保留", () => {
  const a = S([{ id: "x", updatedAt: 12 }]);
  const b = S([], [], { beans: { x: 9 }, brews: {} });
  const out = mergeState(a, b);
  assert.strictEqual(out.beans.length, 1);
});

test("墓碑合并取较晚的删除时间", () => {
  const a = S([], [], { beans: { x: 3 }, brews: {} });
  const b = S([], [], { beans: { x: 8 }, brews: {} });
  const out = mergeState(a, b);
  assert.strictEqual(out.tombstones.beans.x, 8);
});

test("空数据 / 缺 tombstones 字段不报错", () => {
  const out = mergeState({ beans: [], brews: [] }, { beans: [], brews: [] });
  assert.deepStrictEqual(out.beans, []);
  assert.deepStrictEqual(out.tombstones, { beans: {}, brews: {} });
});

test("brews 同样按规则合并", () => {
  const a = S([], [{ id: "b1", updatedAt: 1 }]);
  const b = S([], [{ id: "b1", updatedAt: 4, score: 9 }]);
  const out = mergeState(a, b);
  assert.strictEqual(out.brews[0].score, 9);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test merge.test.js`
Expected: FAIL，报错类似 `Cannot find module './merge.js'`。

- [ ] **Step 3: 实现 `merge.js`**

创建 `merge.js`：

```javascript
/* 纯函数合并模块：浏览器和 Node 都能用。不依赖任何外部状态。
   规则（方案 B）：记录按 id 配对取 updatedAt 较新者；墓碑取较晚删除时间；
   若某 id 的删除时间 >= 该记录的 updatedAt，则该记录视为已删除，丢弃。 */
(function () {
  // 合并两份记录数组：同 id 取 updatedAt 较大者
  function mergeRecords(listA, listB) {
    const map = new Map();
    for (const r of [...(listA || []), ...(listB || [])]) {
      const prev = map.get(r.id);
      if (!prev || (r.updatedAt || 0) >= (prev.updatedAt || 0)) map.set(r.id, r);
    }
    return map; // id -> record
  }

  // 合并两份墓碑表：同 id 取较晚的删除时间
  function mergeTombMap(tA, tB) {
    const out = { ...(tA || {}) };
    for (const [id, t] of Object.entries(tB || {})) {
      out[id] = Math.max(out[id] || 0, t);
    }
    return out;
  }

  // 应用墓碑：删除时间 >= 记录修改时间 → 丢弃；否则（删后又编辑）保留
  function applyTombstones(recordMap, tomb) {
    const result = [];
    for (const record of recordMap.values()) {
      const delAt = tomb[record.id] || 0;
      if (delAt >= (record.updatedAt || 0)) continue;
      result.push(record);
    }
    return result;
  }

  function mergeCollection(listA, listB, tombA, tombB) {
    const tomb = mergeTombMap(tombA, tombB);
    const records = applyTombstones(mergeRecords(listA, listB), tomb);
    return { records, tomb };
  }

  function mergeState(a, b) {
    a = a || {}; b = b || {};
    const ta = a.tombstones || { beans: {}, brews: {} };
    const tb = b.tombstones || { beans: {}, brews: {} };
    const beans = mergeCollection(a.beans, b.beans, ta.beans, tb.beans);
    const brews = mergeCollection(a.brews, b.brews, ta.brews, tb.brews);
    return {
      version: 1,
      beans: beans.records,
      brews: brews.records,
      tombstones: { beans: beans.tomb, brews: brews.tomb },
    };
  }

  const api = { mergeState, mergeRecords, mergeTombMap, applyTombstones };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof globalThis !== "undefined") globalThis.SyncMerge = api;
})();
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test merge.test.js`
Expected: PASS，7 个测试全绿。

- [ ] **Step 5: index.html 在 app.js 之前引入 merge.js**

在 `index.html` 里 `<script src="app.js"></script>` 这一行**之前**加：

```html
<script src="merge.js"></script>
```

（顺序重要：经典脚本按出现顺序执行，merge.js 必须先于 app.js 把 `SyncMerge` 挂到全局。）

- [ ] **Step 6: Commit**

```bash
git add merge.js merge.test.js index.html
git commit -m "feat(sync): 纯合并函数 merge.js 及单测"
```

---

## Task 3: 导出/导入带上墓碑

**Files:**
- Modify: `D:/Documents/coffee-log/app.js`（`store.exportJSON` / `store.importJSON`）

- [ ] **Step 1: 导出包含 tombstones**

把 `exportJSON()` 返回的对象加上 `tombstones`（保持原有 beans/brews/version 字段）：

```javascript
exportJSON() {
  return JSON.stringify(
    { version: 1, beans: state.beans, brews: state.brews, tombstones: state.tombstones },
    null, 2
  );
}
```

- [ ] **Step 2: 导入兼容旧备份（无墓碑）并补字段**

把 `importJSON(text)` 校验通过后的赋值改为：

```javascript
state = {
  version: 1,
  beans: data.beans,
  brews: data.brews,
  tombstones: {
    beans: (data.tombstones && data.tombstones.beans) || {},
    brews: (data.tombstones && data.tombstones.brews) || {},
  },
};
for (const b of state.beans) if (b.updatedAt == null) b.updatedAt = b.createdAt || 0;
for (const r of state.brews) if (r.updatedAt == null) r.updatedAt = r.createdAt || 0;
```

> 保留 importJSON 原有的 beans/brews 是否为数组的校验逻辑，只替换最终赋值部分。

- [ ] **Step 3: 手动验证**

导出一份备份，确认 JSON 里有 `tombstones`。再导入一份**旧版**（没有 tombstones 的）备份，确认不报错、页面正常。

- [ ] **Step 4: Commit**

```bash
git add app.js
git commit -m "feat(sync): 导出/导入携带墓碑并兼容旧备份"
```

---

## Task 4: 同步客户端 `sync.js`

**Files:**
- Create: `D:/Documents/coffee-log/sync.js`
- Modify: `D:/Documents/coffee-log/index.html`（引入 sync.js）

- [ ] **Step 1: 创建 `sync.js`**

```javascript
/* 同步客户端：管理同步码，封装 pull / push / 全量同步，并通过回调汇报状态。
   依赖：全局 SyncMerge（merge.js）。本地数据的读写由调用方（app.js）通过传入的钩子完成。 */
(function () {
  const CODE_KEY = "coffee-sync-code";
  // 同源部署时 API 与网页同域，用相对路径即可
  const API = "/api/data";

  let onStatus = () => {};        // 状态回调：传入 {type, text}
  let getLocal = () => null;      // 返回当前本地 state（含 tombstones）
  let setLocal = () => {};        // 用合并结果覆盖本地并重渲染+存盘

  function getCode() {
    return (localStorage.getItem(CODE_KEY) || "").trim();
  }
  function setCode(code) {
    localStorage.setItem(CODE_KEY, (code || "").trim());
  }
  function enabled() {
    return getCode().length > 0;
  }

  async function pull() {
    const res = await fetch(API, { headers: { "X-Sync-Code": getCode() } });
    if (res.status === 401) throw Object.assign(new Error("同步码错误"), { code: 401 });
    if (!res.ok) throw new Error("拉取失败 " + res.status);
    return res.json();
  }

  async function push(data) {
    const res = await fetch(API, {
      method: "POST",
      headers: { "X-Sync-Code": getCode(), "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (res.status === 401) throw Object.assign(new Error("同步码错误"), { code: 401 });
    if (!res.ok) throw new Error("推送失败 " + res.status);
    return res.json();
  }

  // 完整一轮：拉云端 → 与本地合并 → 写回本地 → 推送（服务端再合并）→ 用最终结果写回本地
  async function syncNow() {
    if (!enabled()) return;
    if (!navigator.onLine) {
      onStatus({ type: "offline", text: "📴 离线，待同步" });
      return;
    }
    try {
      onStatus({ type: "syncing", text: "🔄 同步中…" });
      const remote = await pull();
      const merged = SyncMerge.mergeState(getLocal(), remote);
      setLocal(merged);
      const finalData = await push(merged);
      setLocal(SyncMerge.mergeState(merged, finalData));
      onStatus({ type: "ok", text: "✅ 已同步（刚刚）" });
    } catch (e) {
      if (e.code === 401) onStatus({ type: "auth", text: "⚠️ 同步码错误" });
      else onStatus({ type: "offline", text: "📴 离线，待同步" });
      console.warn("同步失败（本地数据安全）", e);
    }
  }

  // 仅推送（存档后用）：失败不影响本地
  async function pushOnly() {
    if (!enabled() || !navigator.onLine) return;
    try {
      onStatus({ type: "syncing", text: "🔄 同步中…" });
      const finalData = await push(getLocal());
      setLocal(SyncMerge.mergeState(getLocal(), finalData));
      onStatus({ type: "ok", text: "✅ 已同步（刚刚）" });
    } catch (e) {
      onStatus({ type: "offline", text: "📴 离线，待同步" });
      console.warn("推送失败（本地数据安全）", e);
    }
  }

  function init(hooks) {
    onStatus = hooks.onStatus || onStatus;
    getLocal = hooks.getLocal || getLocal;
    setLocal = hooks.setLocal || setLocal;
    window.addEventListener("online", syncNow);
  }

  globalThis.SyncClient = { init, getCode, setCode, enabled, syncNow, pushOnly };
})();
```

- [ ] **Step 2: index.html 引入 sync.js（在 app.js 之前）**

在 `<script src="app.js"></script>` 之前、`merge.js` 之后加：

```html
<script src="sync.js"></script>
```

- [ ] **Step 3: 手动冒烟（无后端也不报错）**

打开页面，Console 执行 `SyncClient.enabled()` 应返回 `false`（还没填同步码）。确认页面其它功能正常。

- [ ] **Step 4: Commit**

```bash
git add sync.js index.html
git commit -m "feat(sync): 同步客户端 sync.js（pull/push/状态）"
```

---

## Task 5: 接线——云同步面板 + 自动同步时机

**Files:**
- Modify: `D:/Documents/coffee-log/index.html`（工具栏附近加面板，约 36-40 行）
- Modify: `D:/Documents/coffee-log/app.js`（暴露 state 钩子、存档后触发、启动时初始化与首轮同步）

- [ ] **Step 1: index.html 加「云同步」面板**

在工具栏（含 `#btn-export`/`#btn-import` 的区域，约 36-40 行）后面加：

```html
<div id="sync-panel" class="sync-panel">
  <label>云同步码
    <input id="sync-code" type="text" placeholder="自设一串不易猜的码" autocomplete="off" />
  </label>
  <button id="btn-sync-save" type="button">保存并同步</button>
  <span id="sync-status" class="sync-status">未启用</span>
</div>
```

- [ ] **Step 2: app.js 暴露读写本地 state 的钩子**

在 store 层附近（`renderAll` 已定义之后的作用域）新增两个辅助，供 sync 使用：

```javascript
// 给同步用：拿到当前完整 state（含 tombstones）
function getStateForSync() {
  return { version: 1, beans: state.beans, brews: state.brews, tombstones: state.tombstones };
}

// 给同步用：用合并结果覆盖本地，存盘并重渲染
function applyMergedState(merged) {
  state = {
    version: 1,
    beans: merged.beans || [],
    brews: merged.brews || [],
    tombstones: merged.tombstones || { beans: {}, brews: {} },
  };
  store.save();
  renderAll();
}
```

- [ ] **Step 3: app.js 在启动序列里初始化同步并跑首轮**

把启动序列（`store.load(); initEvents(); renderAll();`）扩展为：

```javascript
store.load();
initEvents();
renderAll();
initSync();
```

并新增 `initSync`：

```javascript
function initSync() {
  const codeInput = document.getElementById("sync-code");
  const statusEl = document.getElementById("sync-status");
  const setStatus = (s) => { if (statusEl) statusEl.textContent = s.text; };

  SyncClient.init({
    onStatus: setStatus,
    getLocal: getStateForSync,
    setLocal: applyMergedState,
  });

  if (codeInput) codeInput.value = SyncClient.getCode();
  setStatus(SyncClient.enabled() ? { text: "✅ 已启用" } : { text: "未启用" });

  const saveBtn = document.getElementById("btn-sync-save");
  if (saveBtn) {
    saveBtn.addEventListener("click", () => {
      SyncClient.setCode(codeInput.value);
      if (SyncClient.enabled()) SyncClient.syncNow();
      else setStatus({ text: "未启用" });
    });
  }

  // 打开即跑一轮（拉取→合并→推送）
  if (SyncClient.enabled()) {
    window.addEventListener("load", () => SyncClient.syncNow());
  }
}
```

- [ ] **Step 4: app.js 在每次存档后推送**

`onSaveBean`、`onSaveBrew`、`deleteBean`、`deleteBrew` 这四处在 `store.save()` 之后、各自原有逻辑末尾，加一行：

```javascript
if (window.SyncClient && SyncClient.enabled()) SyncClient.pushOnly();
```

> 若这些函数共用了一个集中的「保存并重渲染」收尾（例如都调用某个 `persist()`/`store.save()` 后再 `renderAll()`），优先把这一行加到那个公共收尾处，避免重复。以实际代码为准。

- [ ] **Step 5: index.html / style.css 给面板补一点样式（可选但推荐）**

在 `style.css` 末尾加：

```css
.sync-panel { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin: 8px 0; }
.sync-panel input { padding: 4px 6px; }
.sync-status { color: #888; font-size: 0.9em; }
```

- [ ] **Step 6: 手动验证（先不连后端）**

打开页面，云同步面板可见，填入一个码点「保存并同步」，状态会变成「📴 离线，待同步」或「🔄 同步中…」后转「待同步」（因为后端还没部署）——这是预期的，本地数据不受影响。

- [ ] **Step 7: Commit**

```bash
git add index.html app.js style.css
git commit -m "feat(sync): 云同步面板与自动同步时机接线"
```

---

## Task 6: Cloudflare 后端——Pages Function + KV 绑定

**Files:**
- Create: `D:/Documents/coffee-log/functions/api/data.js`
- Create: `D:/Documents/coffee-log/wrangler.toml`

- [ ] **Step 1: 创建 `functions/api/data.js`**

```javascript
/* Cloudflare Pages Function：/api/data 同步接口。
   GET  返回该同步码对应的数据；POST 把上传数据与 KV 现有数据再合并一次后写回。
   合并规则与前端 merge.js 保持一致（此处内联一份，改动时两处都要改）。 */

// —— 与 merge.js 同步的最小合并实现 ——
function mergeRecords(listA, listB) {
  const map = new Map();
  for (const r of [...(listA || []), ...(listB || [])]) {
    const prev = map.get(r.id);
    if (!prev || (r.updatedAt || 0) >= (prev.updatedAt || 0)) map.set(r.id, r);
  }
  return map;
}
function mergeTombMap(tA, tB) {
  const out = { ...(tA || {}) };
  for (const [id, t] of Object.entries(tB || {})) out[id] = Math.max(out[id] || 0, t);
  return out;
}
function applyTombstones(recordMap, tomb) {
  const result = [];
  for (const record of recordMap.values()) {
    const delAt = tomb[record.id] || 0;
    if (delAt >= (record.updatedAt || 0)) continue;
    result.push(record);
  }
  return result;
}
function mergeCollection(listA, listB, tombA, tombB) {
  const tomb = mergeTombMap(tombA, tombB);
  return { records: applyTombstones(mergeRecords(listA, listB), tomb), tomb };
}
function mergeState(a, b) {
  a = a || {}; b = b || {};
  const ta = a.tombstones || { beans: {}, brews: {} };
  const tb = b.tombstones || { beans: {}, brews: {} };
  const beans = mergeCollection(a.beans, b.beans, ta.beans, tb.beans);
  const brews = mergeCollection(a.brews, b.brews, ta.brews, tb.brews);
  return { version: 1, beans: beans.records, brews: brews.records,
    tombstones: { beans: beans.tomb, brews: brews.tomb } };
}

// —— 工具 ——
const EMPTY = { version: 1, beans: [], brews: [], tombstones: { beans: {}, brews: {} } };

function codeFrom(request) {
  return (request.headers.get("X-Sync-Code") || "").trim();
}
// 用同步码派生 KV 键，避免把明文直接当键
async function keyFor(code) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code));
  const hex = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return "u_" + hex;
}
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { "Content-Type": "application/json" },
  });
}

export async function onRequestGet({ request, env }) {
  const code = codeFrom(request);
  if (!code) return json({ error: "缺少同步码" }, 401);
  const raw = await env.SYNC_KV.get(await keyFor(code));
  return json(raw ? JSON.parse(raw) : EMPTY);
}

export async function onRequestPost({ request, env }) {
  const code = codeFrom(request);
  if (!code) return json({ error: "缺少同步码" }, 401);
  let incoming;
  try {
    incoming = await request.json();
  } catch {
    return json({ error: "请求体不是合法 JSON" }, 400);
  }
  const key = await keyFor(code);
  const existingRaw = await env.SYNC_KV.get(key);
  const existing = existingRaw ? JSON.parse(existingRaw) : EMPTY;
  const merged = mergeState(existing, incoming); // 服务端二次合并兜底
  await env.SYNC_KV.put(key, JSON.stringify(merged));
  return json(merged);
}
```

- [ ] **Step 2: 创建 `wrangler.toml`**

```toml
name = "coffee-log"
pages_build_output_dir = "."
compatibility_date = "2026-06-05"

# 部署前把 id 换成你创建的 KV 命名空间 id（见部署文档 Task 7）
[[kv_namespaces]]
binding = "SYNC_KV"
id = "在这里填你的_KV_id"
```

- [ ] **Step 3: 本地起后端联调**

Run: `npx wrangler pages dev .`
打开它给出的本地地址（如 `http://localhost:8788`），在云同步面板填一个码点「保存并同步」，状态应变「✅ 已同步（刚刚）」。

> 本地 `pages dev` 会用本地模拟 KV，无需先在云端建 KV 即可联调接口逻辑。

- [ ] **Step 4: 端到端验证（两个浏览器模拟两台设备）**

用普通窗口和无痕窗口各打开本地地址、填**相同**同步码：
- 窗口 A 记 2 杯 → 窗口 B 刷新后应看到这 2 杯；
- 窗口 B 删 1 杯 → 窗口 A 刷新后该杯消失且不复活。

- [ ] **Step 5: Commit**

```bash
git add functions/api/data.js wrangler.toml
git commit -m "feat(sync): Pages Function 同步接口与 KV 绑定"
```

---

## Task 7: 更新 PWA 缓存 + 部署文档

**Files:**
- Modify: `D:/Documents/coffee-log/sw.js`
- Create: `D:/Documents/coffee-log/部署云同步.md`

- [ ] **Step 1: sw.js 缓存清单加新文件并升版本**

把 `sw.js` 顶部改为：

```javascript
const CACHE = "shouchong-v2";
const ASSETS = [
  "./",
  "index.html",
  "style.css",
  "merge.js",
  "sync.js",
  "app.js",
  "manifest.webmanifest",
  "icon.svg",
];
```

> `/api/data` 是动态接口，**不要**加进缓存。现有 fetch 处理器只缓存 GET 且失败回退首页；POST 本就跳过，无需改动。

- [ ] **Step 2: 写部署文档 `部署云同步.md`**

```markdown
# 把手冲手记部署到 Cloudflare（一次配好，手机电脑自动同步）

> 全程免费、不用信用卡、不用 GitHub。需要 Node（你已装 Node 22）。

## 1. 注册并登录
1. 浏览器打开 https://dash.cloudflare.com 注册一个免费账号。
2. 在 `coffee-log` 文件夹打开 PowerShell，运行：
   ```
   npx wrangler login
   ```
   浏览器弹出授权页，点同意。

## 2. 创建 KV（存数据的格子）
运行：
```
npx wrangler kv namespace create SYNC_KV
```
命令会输出一段 `id = "xxxxxxxx"`。把这个 id 复制到 `wrangler.toml` 里
`[[kv_namespaces]]` 的 `id = "在这里填你的_KV_id"` 处替换掉。

## 3. 部署
运行：
```
npx wrangler pages deploy .
```
完成后会给你一个网址，形如 `https://coffee-log.pages.dev`。

## 4. 两台设备各填一次同步码
1. 手机和电脑都用浏览器打开上面的网址。
2. 在「云同步」面板填**同一串**同步码（自己定，越不容易被猜到越好），点「保存并同步」。
3. 看到「✅ 已同步（刚刚）」就成了。以后两边记录都会自动合到一起。

> 想装到手机桌面：用手机浏览器打开网址 → 菜单「添加到主屏幕」。
> 换了码或清了缓存：重填原来的同步码即可找回云端数据。
```

- [ ] **Step 3: Commit**

```bash
git add sw.js 部署云同步.md
git commit -m "feat(sync): 更新 PWA 缓存清单并新增部署文档"
```

---

## 自检（写完计划后回看）

- **spec 覆盖**：背景(Task 1)、架构(Task 6)、数据模型变更(Task 1)、合并规则(Task 2)、同步流程客户端(Task 4-5)/服务端(Task 6)、鉴权同步码(Task 4 setCode + Task 6 keyFor/401)、界面(Task 5)、错误处理(Task 4 catch + Task 6 400/401)、部署(Task 7)、YAGNI(未做多用户/CRDT/墓碑清理/加密)、测试要点(Task 2 单测 + 各 Task 手动验收) —— 均有对应任务。
- **占位符**：除 `wrangler.toml` 中需用户填的真实 KV id（部署文档已说明如何获取）外，无 TODO/TBD。
- **类型一致**：`mergeState(a,b)` 签名、`state.tombstones.{beans,brews}`、`X-Sync-Code` 头、`SyncMerge`/`SyncClient` 全局名、`getStateForSync`/`applyMergedState` 在前后 Task 中一致。
