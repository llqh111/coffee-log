/* 冲煮计时器：全屏分段计时 + 墙上时钟计时 + 暂停/继续。
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
  // stages = 去掉最后一项（如果是停止），其余全部保留
  var lastIsStop = last.label === "停止";
  var stages = lastIsStop ? arr.slice(0, -1) : arr.slice();
  return { totalSec: totalSec, bloomSec: bloomSec, stages: stages };
}

/* ====== 纯函数：已过毫秒（含暂停扣减，可单测） ======
   now           当前时刻 Date.now()
   startTime     开始时刻
   pausedMs      此前累计已暂停的毫秒
   pauseStartedAt 本次暂停开始时刻；0 表示当前没在暂停
   返回：真实流逝毫秒（扣掉所有暂停时间，永不为负） */
function elapsedMsFrom(now, startTime, pausedMs, pauseStartedAt) {
  var ms = now - startTime - (pausedMs || 0);
  if (pauseStartedAt) ms -= (now - pauseStartedAt); // 正在暂停，连这一段也扣掉 → 数字冻住
  return ms < 0 ? 0 : ms;
}

/* ====== BrewTimer：UI 状态机 ====== */
var BrewTimer = (function () {
  var startTime = 0;         // 开始时刻（Date.now()）
  var pausedMs = 0;          // 累计已暂停毫秒
  var pauseStartedAt = 0;    // 本次暂停开始时刻；0 = 没在暂停
  var timestamps = [];       // [{label, sec}] 打点记录
  var displayTimer = null;   // 刷新界面数字的 interval id
  var wakeLock = null;       // Wake Lock 对象
  var onFinish = null;       // 完成回调
  var beanName = "";
  var hasStarted = false;    // 是否已经开始过计时
  var finished = false;      // 是否已结束（防 teardown 重入）

  // 按钮防抖：同一动作 350ms 内只认一次（防手抖双击丢段/重段）
  var ACTION_LOCK_MS = 350;
  var lastActionAt = 0;

  // --- DOM 引用（延迟取，start 时才拿） ---
  var overlay, timeDisplay, stageLabel, stageList, mainBtn, stopBtn, pauseBtn, beanLabel, exitBtn;
  function cacheDom() {
    overlay = document.getElementById("brew-timer-overlay");
    timeDisplay = document.getElementById("timer-display");
    stageLabel = document.getElementById("timer-stage-label");
    stageList = document.getElementById("timer-stage-list");
    mainBtn = document.getElementById("timer-main-btn");
    stopBtn = document.getElementById("timer-stop-btn");
    pauseBtn = document.getElementById("timer-pause-btn");
    beanLabel = document.getElementById("timer-bean-label");
    exitBtn = document.getElementById("timer-exit");
  }

  // --- 墙上时钟：当前已过秒数（用 Date.now() 算，防后台节流漂移，含暂停扣减） ---
  function elapsedSec() {
    return Math.round(elapsedMsFrom(Date.now(), startTime, pausedMs, pauseStartedAt) / 1000);
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
    timeDisplay.textContent = fmt(elapsedSec());
  }

  // --- 添加一条打点（按钮级锁已保证不会误触，这里总是如实记录） ---
  function addStage(label) {
    timestamps.push({ label: label, sec: elapsedSec() });
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

  // --- 按钮级防抖：同一动作 350ms 内只认一次；暂停中不接受换段 ---
  function guard(fn) {
    return function () {
      if (pauseStartedAt) return;                   // 暂停时屏蔽换段
      var now = Date.now();
      if (now - lastActionAt < ACTION_LOCK_MS) return;
      lastActionAt = now;
      fn();
    };
  }

  // --- Wake Lock（屏幕常亮，冲的时候不让手机息屏） ---
  async function requestWakeLock() {
    try {
      if ("wakeLock" in navigator && document.visibilityState === "visible") {
        wakeLock = await navigator.wakeLock.request("screen");
        wakeLock.addEventListener("release", function () { wakeLock = null; });
      }
    } catch (e) { /* 不支持或权限不足就跳过 */ }
  }
  async function releaseWakeLock() {
    if (wakeLock) {
      try { await wakeLock.release(); } catch (e) {}
      wakeLock = null;
    }
  }

  // --- 切回前台时重新申请 Wake Lock（浏览器切后台会自动释放） ---
  function onVisibility() {
    if (document.visibilityState === "visible" && hasStarted && !finished && !pauseStartedAt) {
      requestWakeLock();
    }
  }

  // --- beforeunload 拦截（防误刷新） ---
  function onBeforeUnload(e) {
    if (hasStarted && !finished) {
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

  // --- 暂停 / 继续 ---
  function togglePause() {
    if (!hasStarted || finished) return;
    if (pauseStartedAt) {
      // 继续：把这次暂停时长累加进 pausedMs，时钟接着走
      pausedMs += Date.now() - pauseStartedAt;
      pauseStartedAt = 0;
      if (overlay) overlay.classList.remove("is-paused");
      if (pauseBtn) pauseBtn.textContent = "⏸ 暂停";
      requestWakeLock();
      if (!displayTimer) displayTimer = setInterval(updateDisplay, 250);
      updateDisplay();
    } else {
      // 暂停：记下此刻，停掉刷新，数字冻住，松开屏幕常亮
      pauseStartedAt = Date.now();
      if (overlay) overlay.classList.add("is-paused");
      if (pauseBtn) pauseBtn.textContent = "▶ 继续";
      if (displayTimer) { clearInterval(displayTimer); displayTimer = null; }
      updateDisplay();
      releaseWakeLock();
    }
  }

  // --- 主按钮文字切换（克隆节点以解绑旧监听器；action 自动套防抖锁） ---
  function setMainButton(label, action) {
    if (!mainBtn) return;
    mainBtn.textContent = label;
    mainBtn.style.display = label ? "" : "none";
    var clone = mainBtn.cloneNode(true);
    mainBtn.parentNode.replaceChild(clone, mainBtn);
    mainBtn = clone;
    if (label && action) {
      mainBtn.addEventListener("click", guard(action));
    }
  }

  function enterBlooming() {
    addStage("闷蒸");
    if (stageLabel) stageLabel.textContent = "闷蒸中…";
    setMainButton("闷蒸结束", function () {
      enterPouring();
    });
  }

  function enterPouring() {
    var segNum = timestamps.length + 1;
    addStage("段" + segNum);
    if (stageLabel) stageLabel.textContent = "注水中…";
    setMainButton("下一段", function () {
      enterPouring();
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
    pausedMs = 0;
    pauseStartedAt = 0;
    timestamps = [];
    hasStarted = false;
    finished = false;
    lastActionAt = 0;

    // 设置界面
    overlay.classList.remove("is-paused");
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
    if (pauseBtn) {
      pauseBtn.textContent = "⏸ 暂停";
      var pc = pauseBtn.cloneNode(true);
      pauseBtn.parentNode.replaceChild(pc, pauseBtn);
      pauseBtn = pc;
      pauseBtn.addEventListener("click", togglePause);
    }

    // 显示界面（同时切换无障碍可见性）
    overlay.classList.add("is-active");
    overlay.setAttribute("aria-hidden", "false");

    // 申请 Wake Lock
    requestWakeLock();

    // 启动显示刷新（每 250ms，用墙上时钟保证精度）
    displayTimer = setInterval(updateDisplay, 250);
    updateDisplay();

    // 拦截误关闭 + 切回前台重申屏幕常亮
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("visibilitychange", onVisibility);
    if (exitBtn) {
      var ec = exitBtn.cloneNode(true);
      exitBtn.parentNode.replaceChild(ec, exitBtn);
      exitBtn = ec;
      exitBtn.addEventListener("click", confirmExit);
    }
  }

  // --- 停止 / 退出 ---
  function teardown(aborted) {
    if (finished) return;   // 防双击「停止」重入
    finished = true;

    if (displayTimer) { clearInterval(displayTimer); displayTimer = null; }
    releaseWakeLock();
    window.removeEventListener("beforeunload", onBeforeUnload);
    document.removeEventListener("visibilitychange", onVisibility);

    if (overlay) {
      overlay.classList.remove("is-active");
      overlay.classList.remove("is-paused");
      overlay.setAttribute("aria-hidden", "true");
    }

    var result = null;
    if (!aborted) {
      // 若停在暂停态，先结算暂停时长，保证总时间准确
      if (pauseStartedAt) { pausedMs += Date.now() - pauseStartedAt; pauseStartedAt = 0; }
      timestamps.push({ label: "停止", sec: elapsedSec() });
      result = buildResult(timestamps);
    }

    if (onFinish) {
      onFinish(aborted ? { aborted: true } : result);
      onFinish = null;
    }
  }

  return { start: start };
})();

/* 给 Node 测试用（浏览器里 module 不存在，会跳过） */
if (typeof module !== "undefined" && module.exports) {
  module.exports = { buildResult: buildResult, elapsedMsFrom: elapsedMsFrom };
}
