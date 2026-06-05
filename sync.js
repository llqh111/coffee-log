/* 同步客户端：管理同步码，封装 pull / push / 全量同步，并通过回调汇报状态。
   依赖：全局 SyncMerge（merge.js）。本地数据的读写由调用方（app.js）通过传入的钩子完成。 */
(function () {
  const CODE_KEY = "coffee-sync-code";
  // 同源部署时 API 与网页同域，用相对路径即可
  const API = "/api/data";

  let onStatus = function () {};        // 状态回调：传入 {type, text}
  let getLocal = function () { return null; };      // 返回当前本地 state（含 tombstones）
  let setLocal = function () {};        // 用合并结果覆盖本地并重渲染+存盘

  // 去抖：pushOnly 500ms 内只推一次，避免连点保存/删除时刷屏
  let pushTimer = null;
  let pendingPush = null;

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
    var res = await fetch(API, { headers: { "X-Sync-Code": getCode() } });
    if (res.status === 401) throw Object.assign(new Error("同步码错误"), { code: 401 });
    if (!res.ok) throw new Error("拉取失败 " + res.status);
    return res.json();
  }

  async function push(data) {
    var res = await fetch(API, {
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
      onStatus({ type: "offline", text: "📴 离线，联网后自动同步" });
      return;
    }
    try {
      onStatus({ type: "syncing", text: "🔄 同步中…" });
      var remote = await pull();
      var merged = SyncMerge.mergeState(getLocal(), remote);
      setLocal(merged);
      var finalData = await push(merged);
      setLocal(SyncMerge.mergeState(merged, finalData));
      onStatus({ type: "ok", text: "✅ 已同步" });
    } catch (e) {
      if (e.code === 401) onStatus({ type: "auth", text: "⚠️ 同步码错误，点我重设" });
      else onStatus({ type: "offline", text: "📴 同步失败，联网后重试" });
      console.warn("同步失败（本地数据安全）", e);
    }
  }

  // 去抖推送（存档后用）：500ms 内多次调用只推最后一次
  async function pushOnly() {
    if (!enabled() || !navigator.onLine) return;
    pendingPush = getLocal();
    if (pushTimer) return; // 已有定时器在等，只更新 pending 数据
    pushTimer = setTimeout(async function () {
      pushTimer = null;
      var data = pendingPush;
      pendingPush = null;
      try {
        onStatus({ type: "syncing", text: "🔄 同步中…" });
        var finalData = await push(data);
        setLocal(SyncMerge.mergeState(data, finalData));
        onStatus({ type: "ok", text: "✅ 已同步" });
      } catch (e) {
        onStatus({ type: "offline", text: "📴 推送暂缓，联网后自动同步" });
        console.warn("推送失败（本地数据安全）", e);
      }
    }, 500);
  }

  function init(hooks) {
    onStatus = hooks.onStatus || onStatus;
    getLocal = hooks.getLocal || getLocal;
    setLocal = hooks.setLocal || setLocal;
  }

  globalThis.SyncClient = { init: init, getCode: getCode, setCode: setCode, enabled: enabled, syncNow: syncNow, pushOnly: pushOnly };
})();
