# 内置冲煮计时器 · 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在「记录一杯」流程中加入全屏分段计时器，冲完自动把总时间/闷蒸时间/分段轨迹填回表单。

**Architecture:** 新增独立 `timer.js` 模块——纯函数 `buildResult()` 负责「打点→分段」计算（可单测），`BrewTimer` 对象负责全屏 UI 状态机 + 墙上时钟计时 + Wake Lock。通过 `onFinish` 回调与 `app.js` 解耦。复用现有 `totalTime`/`bloomTime` 字段，新增 `stages` 数组字段。

**Tech Stack:** 原生 JS（与项目一致），Wake Lock API，无外部依赖。

---

## 文件结构

| 文件 | 操作 | 职责 |
|------|------|------|
| `timer.test.js` | 🆕 创建 | `buildResult()` 的单元测试 |
| `timer.js` | 🆕 创建 | 纯函数 `buildResult()` + `BrewTimer` UI 状态机 |
| `index.html` | 修改 | 全屏计时器骨架 + 「开始冲煮计时」按钮 |
| `style.css` | 修改 | 全屏计时器样式 |
| `app.js` | 修改 | 胶水代码：启动计时器、接收回调填表单、渲染 stages |

---

### Task 1: TDD 驱动 write `timer.test.js` —— 先写失败的测试

**Files:**
- Create: `timer.test.js`

- [ ] **Step 1: 写 `buildResult()` 的完整测试**

```js
/* 计时器核心纯函数测试：buildResult(timestamps)
   输入：按时间顺序排列的 [{label, sec}]，sec 是累计秒。
        最后一项一定是「停止」。
   输出：{ totalSec, bloomSec, stages }
         bloomSec = 第一段 label 含 "闷蒸" 时的 sec，否则 null
         stages = 原样返回（去掉了停止那一项） */

// ========== 用 Node 跑：直接内联 buildResult ==========
// （测试文件先自己包含一份 buildResult，等 timer.js 写好后改从模块引）

function buildResult(timestamps) {
  // 占位：TDD 第一步，先写测试再实现
  throw new Error("not implemented");
}

// --- 测试用例 ---
let passed = 0, failed = 0;

function test(name, fn) {
  try { fn(); passed++; console.log("✔ " + name); }
  catch (e) { failed++; console.error("✘ " + name + "\n  " + e.message); }
}

// 正常流程：闷蒸 0:32 结束，总 2:30 停止
test("闷蒸 + 一段注水 → 两段", () => {
  const r = buildResult([
    { label: "闷蒸", sec: 32 },
    { label: "停止", sec: 150 },
  ]);
  if (r.totalSec !== 150) throw new Error("totalSec 应为 150，实际 " + r.totalSec);
  if (r.bloomSec !== 32) throw new Error("bloomSec 应为 32，实际 " + r.bloomSec);
  if (r.stages.length !== 1) throw new Error("stages 应有 1 段（去掉停止），实际 " + r.stages.length);
  if (r.stages[0].label !== "闷蒸") throw new Error("第一段 label 应为闷蒸");
});

// 多段
test("闷蒸 + 三段注水 → 四段（停止不计入）", () => {
  const r = buildResult([
    { label: "闷蒸", sec: 30 },
    { label: "段2",  sec: 75 },
    { label: "段3",  sec: 130 },
    { label: "段4",  sec: 175 },
    { label: "停止", sec: 210 },
  ]);
  if (r.totalSec !== 210) throw new Error("totalSec 不对");
  if (r.bloomSec !== 30) throw new Error("bloomSec 不对");
  if (r.stages.length !== 4) throw new Error("stages 应有 4 段，实际 " + r.stages.length);
  if (r.stages[3].sec !== 175) throw new Error("最后一段 sec 不对");
});

// 没点闷蒸就停
test("没点闷蒸 → bloomSec 为 null", () => {
  const r = buildResult([
    { label: "停止", sec: 45 },
  ]);
  if (r.totalSec !== 45) throw new Error("totalSec 应为 45");
  if (r.bloomSec !== null) throw new Error("没闷蒸时 bloomSec 应为 null");
  if (r.stages.length !== 0) throw new Error("stages 应为空数组");
});

// 空数组
test("空数组 → 全 0 / null", () => {
  const r = buildResult([]);
  if (r.totalSec !== 0) throw new Error("空数组 totalSec 应为 0");
  if (r.bloomSec !== null) throw new Error("空数组 bloomSec 应为 null");
  if (r.stages.length !== 0) throw new Error("空数组 stages 应为空");
});

// 只有一项且是闷蒸（异常：忘了停止但有闷蒸）
test("只有闷蒸，没有停止 → 闷蒸即总时间", () => {
  const r = buildResult([
    { label: "闷蒸", sec: 30 },
  ]);
  if (r.totalSec !== 30) throw new Error("totalSec 应为最后一项的 sec");
  if (r.bloomSec !== 30) throw new Error("bloomSec 应为 30");
  if (r.stages.length !== 1) throw new Error("stages 应有 1 段");
});

console.log("\n" + (passed + failed) + " tests: " + passed + " pass, " + failed + " fail");
if (failed > 0) process.exit(1);
```

- [ ] **Step 2: 运行测试，确认全部失败**

```bash
node timer.test.js
```
Expected: 全部 FAIL（因为 `buildResult` 直接 throw）

- [ ] **Step 3: 实现 `buildResult()` 使测试通过**

在 `timer.test.js` 中把 `buildResult` 替换为真实实现：

```js
function buildResult(timestamps) {
  const arr = timestamps || [];
  if (arr.length === 0) {
    return { totalSec: 0, bloomSec: null, stages: [] };
  }
  const last = arr[arr.length - 1];
  const totalSec = last.sec;
  // 闷蒸 = 第一条 label 含"闷蒸"的记录
  const bloom = arr.find(function (s) { return s.label.indexOf("闷蒸") !== -1; });
  const bloomSec = bloom ? bloom.sec : null;
  // stages = 去掉最后一项（停止），全部保留
  const stages = arr.slice(0, -1);
  return { totalSec: totalSec, bloomSec: bloomSec, stages: stages };
}
```

- [ ] **Step 4: 运行测试，确认全部通过**

```bash
node timer.test.js
```
Expected: 全部 PASS

- [ ] **Step 5: 提交**

```bash
git add timer.test.js
git commit -m "test: buildResult() 纯函数单元测试"

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
```

---

### Task 2: 创建 `timer.js` —— 纯函数 + BrewTimer 状态机

**Files:**
- Create: `timer.js`
- Modify: `timer.test.js`（改从 timer.js 引 buildResult）

- [ ] **Step 1: 写 `timer.js` 骨架**

```js
/* 冲煮计时器：全屏分段计时 + 墙上时钟计时。
   不碰数据存储，只测时间、报节点。
   用法：
     BrewTimer.start({ beanName: "耶加雪菲", onFinish: fn })
     → fn({ totalSec, bloomSec, stages, aborted }) */

/* ====== 纯函数：打点 → 分段结果（可单测） ====== */
function buildResult(timestamps) {
  var arr = timestamps || [];
  if (arr.length === 0) {
    return { totalSec: 0, bloomSec: null, stages: [] };
  }
  var last = arr[arr.length - 1];
  var totalSec = last.sec;
  // 闷蒸 = 第一条 label 含"闷蒸"的记录
  var bloom = null;
  for (var i = 0; i < arr.length; i++) {
    if (arr[i].label.indexOf("闷蒸") !== -1) { bloom = arr[i]; break; }
  }
  var bloomSec = bloom ? bloom.sec : null;
  // stages = 去掉最后一项（停止），全部保留
  var stages = arr.slice(0, -1);
  return { totalSec: totalSec, bloomSec: bloomSec, stages: stages };
}

/* ====== BrewTimer：UI 状态机 ====== */
var BrewTimer = (function () {
  var startTime = 0;         // 开始时刻（Date.now()）
  var timestamps = [];       // [{label, sec}] 打点记录
  var displayTimer = null;   // 刷新界面数字的 interval id
  var wakeLock = null;       // Wake Lock 对象
  var onFinish = null;       // 完成回调
  var beanName = "";
  var hasStarted = false;    // 是否已经开始过计时
  var lastStageSec = 0;      // 上次打点时的累计秒，用于防抖（1s 内忽略）

  // 防抖最小间隔（秒）
  var DEBOUNCE_SEC = 1;

  // --- DOM 引用（延迟取，start 时才拿） ---
  var overlay, timeDisplay, stageLabel, stageList, mainBtn, stopBtn, beanLabel, exitBtn;
  function cacheDom() {
    overlay = document.getElementById("brew-timer-overlay");
    timeDisplay = document.getElementById("timer-display");
    stageLabel = document.getElementById("timer-stage-label");
    stageList = document.getElementById("timer-stage-list");
    mainBtn = document.getElementById("timer-main-btn");
    stopBtn = document.getElementById("timer-stop-btn");
    beanLabel = document.getElementById("timer-bean-label");
    exitBtn = document.getElementById("timer-exit");
  }

  // --- 墙上时钟：当前已过秒数 ---
  function elapsedSec() {
    return Math.round((Date.now() - startTime) / 1000);
  }

  // --- 格式化 mm:ss ---
  function fmt(sec) {
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return m + ":" + (s < 10 ? "0" : "") + s;
  }

  // --- 刷新界面数字 ---
  function updateDisplay() {
    if (!timeDisplay) return;
    var sec = elapsedSec();
    timeDisplay.textContent = fmt(sec);
  }

  // --- 添加一条打点 ---
  function addStage(label) {
    var sec = elapsedSec();
    // 防抖：1 秒内同标签忽略
    if (sec - lastStageSec < DEBOUNCE_SEC) return;
    lastStageSec = sec;
    timestamps.push({ label: label, sec: sec });
    renderStageList();
  }

  // --- 渲染分段列表 ---
  function renderStageList() {
    if (!stageList) return;
    var html = "";
    for (var i = 0; i < timestamps.length; i++) {
      var s = timestamps[i];
      var isLast = (i === timestamps.length - 1);
      var cls = isLast ? "timer-stage current" : "timer-stage done";
      html += '<div class="' + cls + '">' +
        '<span class="ts-num">' + (i + 1) + '</span>' +
        '<span class="ts-label">' + escHTML(s.label) + '</span>' +
        '<span class="ts-time">' + fmt(s.sec) + (isLast ? "" : " ✓") + '</span>' +
        '</div>';
    }
    stageList.innerHTML = html;
    // 滚动到最新段
    stageList.scrollTop = stageList.scrollHeight;
  }

  function escHTML(str) {
    return String(str).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  }

  // --- Wake Lock ---
  async function requestWakeLock() {
    try {
      if ("wakeLock" in navigator) {
        wakeLock = await navigator.wakeLock.request("screen");
        wakeLock.addEventListener("release", function () { wakeLock = null; });
      }
    } catch (e) { /* 不支持就跳过 */ }
  }
  async function releaseWakeLock() {
    if (wakeLock) {
      try { await wakeLock.release(); } catch (e) {}
      wakeLock = null;
    }
  }

  // --- beforeunload 拦截 ---
  function onBeforeUnload(e) {
    if (hasStarted) {
      e.preventDefault();
      e.returnValue = "";
    }
  }

  // --- 退出确认 ---
  function confirmExit() {
    if (!hasStarted) { teardown(true); return; }
    if (confirm("放弃这次计时？已记的时间会丢。")) {
      teardown(true);
    }
  }

  // --- 状态切换 ---
  function setMainButton(label, action) {
    if (!mainBtn) return;
    mainBtn.textContent = label;
    mainBtn.style.display = label ? "" : "none";
    // 移除旧监听器：克隆节点替换
    var clone = mainBtn.cloneNode(true);
    mainBtn.parentNode.replaceChild(clone, mainBtn);
    mainBtn = clone;
    if (label && action) {
      mainBtn.addEventListener("click", action);
    }
  }

  function enterBlooming() {
    // 状态变为「闷蒸中」
    addStage("闷蒸");
    if (stageLabel) stageLabel.textContent = "闷蒸中…";
    setMainButton("闷蒸结束", function () {
      enterPouring();
    });
  }

  function enterPouring() {
    // 标记当前段结束，开始新段
    var count = timestamps.length + 1;
    addStage("段" + count);
    if (stageLabel) stageLabel.textContent = "注水中…";
    setMainButton("下一段", function () {
      enterPouring(); // 继续分段
    });
  }

  // --- 启动 ---
  function start(opts) {
    opts = opts || {};
    beanName = opts.beanName || "";
    onFinish = opts.onFinish || function () {};

    cacheDom();
    if (!overlay) return;

    // 重置状态
    startTime = Date.now();
    timestamps = [];
    hasStarted = false;
    lastStageSec = 0;

    // 设置界面
    if (beanLabel) beanLabel.textContent = beanName;
    if (timeDisplay) timeDisplay.textContent = "0:00";
    if (stageLabel) stageLabel.textContent = "准备好就点开始";
    if (stageList) stageList.innerHTML = "";
    setMainButton("▶ 开始", function () {
      hasStarted = true;
      enterBlooming();
    });
    if (stopBtn) {
      stopBtn.textContent = "停止";
      stopBtn.style.display = "";
      var sc = stopBtn.cloneNode(true);
      stopBtn.parentNode.replaceChild(sc, stopBtn);
      stopBtn = sc;
      stopBtn.addEventListener("click", function () { teardown(false); });
    }

    // 显示界面
    overlay.classList.add("is-active");

    // 申请 Wake Lock
    requestWakeLock();

    // 启动显示刷新（每 250ms）
    displayTimer = setInterval(updateDisplay, 250);
    updateDisplay();

    // 拦截误关闭
    window.addEventListener("beforeunload", onBeforeUnload);
    if (exitBtn) {
      var ec = exitBtn.cloneNode(true);
      exitBtn.parentNode.replaceChild(ec, exitBtn);
      exitBtn = ec;
      exitBtn.addEventListener("click", confirmExit);
    }
  }

  // --- 停止 / 退出 ---
  function teardown(aborted) {
    // 停止计时
    if (displayTimer) { clearInterval(displayTimer); displayTimer = null; }
    releaseWakeLock();
    window.removeEventListener("beforeunload", onBeforeUnload);

    // 隐藏界面
    if (overlay) overlay.classList.remove("is-active");

    var result = null;
    if (!aborted) {
      // 最后一击：记录停止时刻
      var sec = elapsedSec();
      timestamps.push({ label: "停止", sec: sec });
      result = buildResult(timestamps);
    }

    // 回调
    if (onFinish) {
      onFinish(aborted ? { aborted: true } : result);
      onFinish = null;
    }
  }

  // --- 公开接口 ---
  return { start: start };
})();
```

- [ ] **Step 2: 更新 `timer.test.js`，改从 `timer.js` 引用 `buildResult`**

把 `timer.test.js` 顶部的 `function buildResult(...){ throw... }` 占位换成：

```js
// 在浏览器里 timer.js 把 buildResult 挂在全局
// Node 测试用：模拟 globalThis 注入
globalThis.buildResult = require("./timer.js").buildResult || globalThis.buildResult;
```

但 `timer.js` 是浏览器脚本，用 IIFE 写的，没法直接 `require`。最简单的做法：**在 `timer.test.js` 里保留一份 buildResult 的独立副本**（它本身就是纯函数，60行，拷贝测试没毛病——跟 `merge.js` 被 `data.js` 内联一样的套路）。

把 `timer.test.js` 里的 `throw new Error("not implemented")` 替换为真实实现（与 `timer.js` 中的 `buildResult` 完全相同）：

```js
function buildResult(timestamps) {
  var arr = timestamps || [];
  if (arr.length === 0) {
    return { totalSec: 0, bloomSec: null, stages: [] };
  }
  var last = arr[arr.length - 1];
  var totalSec = last.sec;
  var bloom = null;
  for (var i = 0; i < arr.length; i++) {
    if (arr[i].label.indexOf("闷蒸") !== -1) { bloom = arr[i]; break; }
  }
  var bloomSec = bloom ? bloom.sec : null;
  var stages = arr.slice(0, -1);
  return { totalSec: totalSec, bloomSec: bloomSec, stages: stages };
}
```

- [ ] **Step 3: 运行测试确认通过**

```bash
node timer.test.js
```
Expected: 全部 PASS

- [ ] **Step 4: 语法检查 `timer.js`**

```bash
node --check timer.js
```
Expected: 无输出（通过）

- [ ] **Step 5: 提交**

```bash
git add timer.js timer.test.js
git commit -m "feat: 计时器核心模块 timer.js（纯函数 + BrewTimer 状态机）

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
```

---

### Task 3: 添加全屏计时器 HTML 骨架 + 「开始计时」按钮

**Files:**
- Modify: `index.html`

- [ ] **Step 1: 在 `</body>` 前添加计时器覆盖层**

在 `index.html` 的 `</body>` 上方（`<script>` 标签之前）插入：

```html
  <!-- ============ 全屏冲煮计时器 ============ -->
  <div class="brew-timer-overlay" id="brew-timer-overlay" aria-hidden="true">
    <div class="timer-top">
      <button id="timer-exit" class="timer-exit" type="button">← 退出</button>
      <span id="timer-bean-label" class="timer-bean-name"></span>
      <span class="timer-spacer"></span>
    </div>
    <div class="timer-center">
      <div class="timer-big-num" id="timer-display">0:00</div>
      <div class="timer-stage-hint" id="timer-stage-label">准备好就点开始</div>
    </div>
    <div class="timer-stage-list" id="timer-stage-list"></div>
    <div class="timer-actions">
      <button id="timer-main-btn" class="timer-main-btn">▶ 开始</button>
      <button id="timer-stop-btn" class="timer-stop-btn">停止</button>
    </div>
  </div>
```

- [ ] **Step 2: 在「记录一杯」弹窗的 dialog-actions 上方添加「开始冲煮计时」按钮**

找到 `index.html` 中 `id="brew-dialog"` 的 `<dialog>`，在 `<div class="dialog-actions">` 之前插入：

```html
      <div class="brew-timer-launch" id="brew-timer-launch" style="display:none">
        <button id="btn-start-timer" class="btn btn-timer" type="button">▶ 开始冲煮计时</button>
        <p class="timer-hint">先填好粉量、水量、研磨、水温，再点这里进全屏计时</p>
      </div>
```

- [ ] **Step 3: 引入 `timer.js`**

在 `index.html` 底部，`<script src="app.js?v=5"></script>` 之前插入：

```html
  <script src="timer.js?v=5"></script>
```

注意顺序：`merge.js` → `sync.js` → `timer.js` → `app.js`（因为 `app.js` 的胶水代码要调 `BrewTimer`）。

- [ ] **Step 4: 提交**

```bash
git add index.html
git commit -m "feat: 全屏计时器 HTML 骨架 + 开始计时按钮

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
```

---

### Task 4: 计时器样式

**Files:**
- Modify: `style.css`

- [ ] **Step 1: 在 `style.css` 末尾添加计时器样式**

```css
/* ====== 全屏冲煮计时器 ====== */
.brew-timer-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: var(--surface);
  display: none;
  flex-direction: column;
  align-items: center;
  padding: env(safe-area-inset-top) 24px env(safe-area-inset-bottom);
  font-family: var(--font-ui);
  color: var(--ink);
}

.brew-timer-overlay.is-active {
  display: flex;
}

/* 顶部栏 */
.timer-top {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 0;
  gap: 12px;
}
.timer-exit {
  background: none;
  border: none;
  font-size: 15px;
  color: var(--ink-soft);
  cursor: pointer;
  padding: 8px 0;
  flex-shrink: 0;
}
.timer-exit:active { opacity: 0.6; }
.timer-bean-name {
  font-size: 15px;
  font-weight: 600;
  color: var(--ink);
  text-align: center;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.timer-spacer { width: 50px; flex-shrink: 0; }  /* 与退出按钮对称 */

/* 中部：超大数字 */
.timer-center {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
}
.timer-big-num {
  font-size: clamp(64px, 15vw, 96px);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  letter-spacing: -1px;
  line-height: 1;
  font-family: 'Spline Sans Mono', 'Courier New', monospace;
}
.timer-stage-hint {
  font-size: 16px;
  color: var(--ink-soft);
  transition: color 0.2s;
}

/* 分段列表 */
.timer-stage-list {
  width: 100%;
  max-width: 360px;
  max-height: 180px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 20px;
  padding: 0 4px;
}
.timer-stage {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-radius: 10px;
  background: var(--surface-raised);
  transition: background 0.3s, opacity 0.3s;
}
.timer-stage.done {
  opacity: 0.6;
}
.timer-stage.current {
  background: var(--accent-light, #f0e6d3);
  opacity: 1;
}
.ts-num {
  width: 24px; height: 24px;
  border-radius: 50%;
  background: var(--accent);
  color: #fff;
  font-size: 12px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.timer-stage.done .ts-num { background: var(--ink-soft); }
.ts-label {
  flex: 1;
  font-size: 14px;
  font-weight: 500;
}
.ts-time {
  font-size: 14px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  font-family: 'Spline Sans Mono', 'Courier New', monospace;
}

/* 底部按钮 */
.timer-actions {
  width: 100%;
  max-width: 420px;
  display: flex;
  gap: 12px;
  padding-bottom: 16px;
}
.timer-main-btn,
.timer-stop-btn {
  flex: 1;
  padding: 18px 0;
  border-radius: 14px;
  font-size: 18px;
  font-weight: 700;
  border: none;
  cursor: pointer;
  transition: transform 0.1s, opacity 0.15s;
}
.timer-main-btn {
  flex: 2;
  background: var(--accent);
  color: #fff;
}
.timer-stop-btn {
  background: var(--surface-raised);
  color: var(--ink-soft);
  border: 1.5px solid var(--border);
}
.timer-main-btn:active,
.timer-stop-btn:active {
  transform: scale(0.97);
}

/* 「记录一杯」弹窗里的启动按钮 */
.brew-timer-launch {
  margin: 8px 0 16px;
  text-align: center;
}
.btn-timer {
  width: 100%;
  padding: 14px 0;
  font-size: 17px;
  font-weight: 600;
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: 12px;
  cursor: pointer;
  transition: transform 0.1s;
}
.btn-timer:active { transform: scale(0.98); }
.timer-hint {
  margin: 8px 0 0;
  font-size: 12px;
  color: var(--ink-soft);
}

/* 表单格子闪烁（计时器回填时） */
.field input.timer-filled {
  animation: timer-flash 0.6s ease;
}
@keyframes timer-flash {
  0%, 100% { background: transparent; }
  50% { background: var(--accent-light, #f0e6d3); }
}
```

- [ ] **Step 2: 语法检查 CSS**

快速检查：没有明显的拼写错误，CSS 变量均已在原有 `style.css` 中定义。

- [ ] **Step 3: 提交**

```bash
git add style.css
git commit -m "style: 全屏计时器 + 启动按钮样式

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
```

---

### Task 5: `app.js` 胶水代码 —— 启动计时器 + 回填表单 + 保存 stages

**Files:**
- Modify: `app.js`

- [ ] **Step 1: 在 `initEvents()` 底部添加「开始冲煮计时」按钮接线**

找到 `initEvents()` 函数的末尾，在一个合适的 `});` 之前添加：

```js
  // 「开始冲煮计时」按钮（仅新增冲煮时显示）
  el("#btn-start-timer").addEventListener("click", function () {
    // 先临时保存表单中已填的部分数据（豆子/粉水/研磨/水温），存到内存变量
    var prefill = {
      beanId: el("#brew-bean-select").value,
      brewDate: el("#brew-date").value,
      doseGrams: el("#dose-input").value,
      waterGrams: el("#water-input").value,
      waterTemp: el("input[name='waterTemp']").value,
      grind: el("input[name='grind']").value,
      bloomWater: el("input[name='bloomWater']").value,
      gear: el("input[name='gear']").value,
    };
    // 隐藏弹窗
    var dlg = el("#brew-dialog");
    dlg.close();
    // 启动全屏计时器
    var bean = findBean(prefill.beanId);
    BrewTimer.start({
      beanName: bean ? bean.name : "未选豆子",
      onFinish: function (result) {
        onTimerFinish(result, prefill);
      }
    });
  });
```

- [ ] **Step 2: 添加 `onTimerFinish()` 函数**

在 `app.js` 中找个合适位置（放在 `reproduceBrew` 附近）：

```js
// 计时结束后的暂存（保存前临时持有 stages + 总时间/闷蒸时间）
var timerResultData = null;

function onTimerFinish(result, prefill) {
  // 重新打开弹窗
  var dlg = el("#brew-dialog");
  var form = el("#brew-form");

  if (result.aborted) {
    // 用户放弃了计时，恢复弹窗
    animateDialogOpen(dlg);
    timerResultData = null;
    return;
  }

  // 恢复之前填的表单数据
  if (prefill) {
    for (var key in prefill) {
      if (form.elements[key]) form.elements[key].value = prefill[key] || "";
    }
  }

  // 填回计时结果
  // 总时间：秒 → "分:秒" 字符串，填进 totalTime 字段
  var totalTimeField = form.elements["totalTime"];
  if (totalTimeField && result.totalSec > 0) {
    totalTimeField.value = formatTime(result.totalSec);
    totalTimeField.classList.add("timer-filled");
    setTimeout(function () { totalTimeField.classList.remove("timer-filled"); }, 800);
  }

  // 闷蒸时间：秒数，填进 bloomTime 字段
  var bloomField = form.elements["bloomTime"];
  if (bloomField && result.bloomSec != null) {
    bloomField.value = result.bloomSec;
    bloomField.classList.add("timer-filled");
    setTimeout(function () { bloomField.classList.remove("timer-filled"); }, 800);
  }

  // 暂存 stages（等保存时写入）
  timerResultData = result.stages || [];

  // 更新实时预览
  updateBrewPreview();
  updateTastePreview();

  // 重新打开弹窗
  animateDialogOpen(dlg);
  showToast("时间已自动填入 ✨", "success");
}
```

- [ ] **Step 3: 修改 `openBrewDialog()` —— 区分新增/编辑，控制计时器按钮显隐**

找到 `openBrewDialog()` 函数，在末尾（`animateDialogOpen` 之前）添加：

```js
  // 只有「新增」时才显示「开始冲煮计时」按钮；编辑时不显示
  var launch = el("#brew-timer-launch");
  if (launch) launch.style.display = id ? "none" : "";
```

- [ ] **Step 4: 修改 `onSaveBrew()` —— 把 stages 写进记录**

在 `onSaveBrew()` 中，`data` 对象定义里，`tasteIssues` 之后添加：

```js
    stages: timerResultData || [],
```

在 `animateDialogClose` 之前添加清理：

```js
  timerResultData = null;
```

- [ ] **Step 5: 提交**

```bash
git add app.js
git commit -m "feat: app.js 胶水代码——启动计时器、回填表单、保存 stages

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
```

---

### Task 6: 冲煮卡片 + 详情页展示 stages 分段节奏

**Files:**
- Modify: `app.js`

- [ ] **Step 1: 在 `brewCardHTML()` 的 metadata 行中追加 stages 节奏展示**

在 `brewCardHTML()` 函数中，找到 `var meta = [...]` 的定义块末尾（`].filter(Boolean).join("");` 之前），添加：

```js
    (brew.stages && brew.stages.length > 0) ? '<span class="brew-rhythm">节奏 <b>' +
      brew.stages.map(function (s, i) {
        var prev = i === 0 ? 0 : brew.stages[i - 1].sec;
        return s.label + " " + formatTime(s.sec - prev);
      }).join(" · ") + '</b></span>' : "",
```

注意：`formatTime` 已经在 `app.js` 第 233 行定义，可以直接用。

- [ ] **Step 2: 同步更新「记录一杯」弹窗注释**

确保 `timerResultData` 在 `openBrewDialog(null)` 时被清空——在 `openBrewDialog()` 中 `clearDirty("brew")` 之后添加：

```js
  if (!id) timerResultData = null;
```

- [ ] **Step 3: 处理老记录没有 stages 的兜底**

`store.load()` 已经处理了 `beans`/`brews` 的老字段兜底。在 `load()` 中 `brews` 循环之后添加一行 stages 兜底：

```js
      for (const r of state.brews) if (!r.stages) r.stages = [];
```

放在 `app.js` 中第 34-35 行附近（已有的 updatedAt 兜底循环后面）。

- [ ] **Step 4: 提交**

```bash
git add app.js
git commit -m "feat: 冲煮卡片展示分段节奏 + 老数据 stages 兜底

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
```

---

### Task 7: 浏览器实测验证

- [ ] **Step 1: 语法检查所有文件**

```bash
node --check timer.js && echo "timer.js OK"
node --check app.js && echo "app.js OK"
node --check sync.js && echo "sync.js OK"
node timer.test.js
```
Expected: 全部 PASS

- [ ] **Step 2: 启动本地服务器 + 浏览器实测**

```bash
python -m http.server 8765 &
```

用 Chrome 打开 `http://localhost:8765/index.html`，执行以下检查：

1. 切到「冲煮记录」→ 点「+ 记录一杯」→ 弹窗应出现「▶ 开始冲煮计时」按钮
2. 选一颗豆，填粉量/水量 → 点「开始冲煮计时」→ 弹窗关闭、全屏计时界面出现
3. 点「开始」→ 闷蒸中 → 点「闷蒸结束」→ 注水中 → 点「下一段」 → 再点「停止」
4. 回到弹窗 → 总时间/闷蒸时间应已填入、格子有闪烁 → 补评分 → 保存
5. 冲煮记录卡片应出现「节奏」行
6. 控制台应无错误（F12 → Console）
7. 点「← 退出」→ 应弹出确认框
8. 不填任何参数直接点「停止」→ 总时间应正常填入

- [ ] **Step 3: 关闭服务器**

```bash
pkill -f "http.server 8765"
```

---

### Task 8: 最终提交

- [ ] **Step 1: 确认所有改动都在，工作目录干净**

```bash
git status
git log --oneline -5
```

- [ ] **Step 2: 不再额外提交（Task 1–6 已经是分步提交），标记完成**

---

## 自检清单

| 检查项 | 状态 |
|--------|------|
| Spec 覆盖：6 节需求都有对应 Task | ✓ |
| 占位符/TODO/模糊描述 | 无 |
| 类型一致：`buildResult` 输入输出在 test / timer.js / app.js 中一致 | ✓ |
| 类型一致：`BrewTimer.start({ beanName, onFinish })` 接口不变 | ✓ |
| 类型一致：`onFinish({ totalSec, bloomSec, stages, aborted })` 回传形状不变 | ✓ |
| 老数据兼容：stages 兜底空数组 | ✓ |
| 纯函数可单测 | ✓ |
