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
