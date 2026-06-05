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
  // stages = 去掉最后一项（如果是停止），其余全部保留
  var lastIsStop = last.label === "停止";
  var stages = lastIsStop ? arr.slice(0, -1) : arr.slice();
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
  var lastStageSec = 0;      // 上次打点时的累计秒，用于防抖

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

  // --- 墙上时钟：当前已过秒数（用 Date.now() 算，防后台节流漂移） ---
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
    // 防抖：1 秒内忽略重复点击
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

  // --- Wake Lock（屏幕常亮，冲的时候不让手机息屏） ---
  async function requestWakeLock() {
    try {
      if ("wakeLock" in navigator) {
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

  // --- beforeunload 拦截（防误刷新） ---
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

  // --- 主按钮文字切换（克隆节点以解绑旧监听器） ---
  function setMainButton(label, action) {
    if (!mainBtn) return;
    mainBtn.textContent = label;
    mainBtn.style.display = label ? "" : "none";
    var clone = mainBtn.cloneNode(true);
    mainBtn.parentNode.replaceChild(clone, mainBtn);
    mainBtn = clone;
    if (label && action) {
      mainBtn.addEventListener("click", action);
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

    // 启动显示刷新（每 250ms，用墙上时钟保证精度）
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
    if (displayTimer) { clearInterval(displayTimer); displayTimer = null; }
    releaseWakeLock();
    window.removeEventListener("beforeunload", onBeforeUnload);

    if (overlay) overlay.classList.remove("is-active");

    var result = null;
    if (!aborted) {
      var sec = elapsedSec();
      timestamps.push({ label: "停止", sec: sec });
      result = buildResult(timestamps);
    }

    if (onFinish) {
      onFinish(aborted ? { aborted: true } : result);
      onFinish = null;
    }
  }

  return { start: start };
})();
