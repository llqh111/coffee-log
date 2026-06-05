/* =========================================================
   手冲手记 · 逻辑（原生 JavaScript，无框架）
   代码分四块：
     1) store   —— 唯一碰 localStorage 的地方（读写 / 导出 / 导入）
     2) helpers —— 计算工具（粉水比、养豆天数、时间格式…）
     3) render  —— 把数据画到页面上
     4) wire    —— 把按钮、表单、点击事件接起来
   ========================================================= */

/* ========== 1) store：数据层 ========== */
const STORAGE_KEY = "coffee-log-v1";

// 内存里的当前数据。结构：{ version, beans:[], brews:[] }
let state = { version: 1, beans: [], brews: [], tombstones: { beans: {}, brews: {} } };

const store = {
  // 从浏览器读出数据；读不到或坏了就用空数据兜底
  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      state = {
        version: 1,
        beans: Array.isArray(data.beans) ? data.beans : [],
        brews: Array.isArray(data.brews) ? data.brews : [],
        // 墓碑：记录被删除项的 id -> 删除时间，给以后云同步用，永远保证存在
        tombstones: {
          beans: (data.tombstones && data.tombstones.beans) || {},
          brews: (data.tombstones && data.tombstones.brews) || {},
        },
      };
      // 老数据没有 updatedAt，用 createdAt 兜底（再不行用 0）
      for (const b of state.beans) if (b.updatedAt == null) b.updatedAt = b.createdAt || 0;
      for (const r of state.brews) if (r.updatedAt == null) r.updatedAt = r.createdAt || 0;
    } catch (e) {
      console.warn("读取本地数据失败，已使用空数据：", e);
    }
  },
  // 把当前数据写回浏览器
  save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  },
  // 导出成一个 .json 文件下载下来（备份用）
  exportJSON() {
    const text = JSON.stringify(
      { version: 1, beans: state.beans, brews: state.brews, tombstones: state.tombstones },
      null,
      2
    );
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const d = new Date();
    const stamp = `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;
    a.href = url;
    a.download = `coffee-log-${stamp}.json`;
    a.click();
    URL.revokeObjectURL(url);
  },
  // 从文件内容字符串导入（覆盖当前数据）
  importJSON(text) {
    const data = JSON.parse(text); // 解析失败会抛错，由调用方捕获
    if (!data || !Array.isArray(data.beans) || !Array.isArray(data.brews)) {
      throw new Error("文件格式不对：缺少 beans 或 brews 列表");
    }
    state = {
      version: 1,
      beans: data.beans,
      brews: data.brews,
      // 墓碑：旧备份可能没有，缺省给空对象，保证后续删除不会因 undefined 报错
      tombstones: {
        beans: (data.tombstones && data.tombstones.beans) || {},
        brews: (data.tombstones && data.tombstones.brews) || {},
      },
    };
    // 老备份没有 updatedAt，用 createdAt 兜底（再不行用 0），与 load 保持一致
    for (const b of state.beans) if (b.updatedAt == null) b.updatedAt = b.createdAt || 0;
    for (const r of state.brews) if (r.updatedAt == null) r.updatedAt = r.createdAt || 0;
    store.save();
  },
};

/* ========== 1.3) ui：交互工具（toast / 确认 / 动画） ========== */

// Toast 通知：从右上角滑入，3s 后自动消失
function showToast(message, type) {
  type = type || "";
  var container = document.getElementById("toast-container");
  if (!container) return; // 安全兜底
  var toast = document.createElement("div");
  toast.className = "toast " + type;
  toast.textContent = message;
  container.appendChild(toast);
  // 点击提前关闭
  toast.addEventListener("click", function () { removeToast(toast); });
  var timer = setTimeout(function () { removeToast(toast); }, 3200);
  toast._timer = timer;
}
function removeToast(toast) {
  if (toast._removed) return;
  toast._removed = true;
  clearTimeout(toast._timer);
  toast.classList.add("out");
  setTimeout(function () { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 320);
}

// 内联确认条：在 target 元素后面插入确认栏，替换原生 confirm()
// onYes 回调里做实际删除；target 通常是被点的那行卡片
function confirmInline(target, message, onYes) {
  // 移除已有的确认条
  var existing = document.querySelector(".confirm-bar");
  if (existing) existing.remove();

  var bar = document.createElement("div");
  bar.className = "confirm-bar";
  bar.innerHTML =
    '<span class="confirm-text">' + esc(message) + '</span>' +
    '<button class="confirm-yes">确定删除</button>' +
    '<button class="confirm-no">取消</button>';

  // 找到合适的插入位置
  var card = target.closest(".brew-card") || target.closest(".bean-card") || target.closest(".detail-head");
  if (card) {
    card.after(bar);
    bar.scrollIntoView({ behavior: "smooth", block: "nearest" });
  } else {
    target.parentNode.insertBefore(bar, target.nextSibling);
  }

  bar.querySelector(".confirm-no").addEventListener("click", function () { bar.remove(); });
  bar.querySelector(".confirm-yes").addEventListener("click", function () {
    bar.remove();
    if (card) { card.classList.add("card-removing"); }
    // 等退出动画播完再执行删除
    setTimeout(function () { if (onYes) onYes(); }, 260);
  });
}

// 交错入场动画：给容器里的卡片加 stagger-in 类
function staggerCards(container, selector) {
  var cards = container.querySelectorAll(selector);
  cards.forEach(function (c, i) {
    c.classList.add("stagger-in");
    c.style.animationDelay = Math.min(i * 50, 300) + "ms";
  });
}

// 弹窗动画：打开前重置 transform
function animateDialogOpen(dialog) {
  dialog.classList.remove("closing");
  dialog.showModal();
}
// 弹窗关闭动画：先加 closing 类，动画播完再 close
function animateDialogClose(dialog, callback) {
  dialog.classList.add("closing");
  setTimeout(function () {
    dialog.close();
    dialog.classList.remove("closing");
    if (callback) callback();
  }, 180);
}

// 元素脉冲动画
function pulseElement(el) {
  el.classList.remove("pulse");
  void el.offsetWidth; // 强制回流，让浏览器重启动画
  el.classList.add("pulse");
  setTimeout(function () { el.classList.remove("pulse"); }, 400);
}

// 保存按钮闪烁
function flashButton(btn) {
  btn.classList.add("btn-saved");
  setTimeout(function () { btn.classList.remove("btn-saved"); }, 1300);
}

// 更新标签页滑动下划线位置
function updateTabIndicator(tab) {
  var tabsBar = document.getElementById("tabs");
  if (!tabsBar) return;
  var left = tab.offsetLeft;
  var width = tab.offsetWidth;
  tabsBar.style.setProperty("--indicator-left", left + "px");
  tabsBar.style.setProperty("--indicator-width", width + "px");
  // 用 JS 直接设伪元素没法做到，改用 style 动态注入
  // 伪元素用不了 JS 直接改，用 CSS 自定义属性
  tabsBar.style.setProperty("--il", left + "px");
  tabsBar.style.setProperty("--iw", width + "px");
}

/* ========== 2) helpers：计算工具 ========== */

// 生成唯一 id（时间戳 + 随机，足够个人使用）
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// 个位数补零：3 -> "03"
function pad2(n) { return String(n).padStart(2, "0"); }

// 今天的日期，格式 YYYY-MM-DD（给 <input type=date> 用）
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

// 粉水比：水量 / 粉量 -> "1:15.0"；算不了返回 "—"
function ratioText(dose, water) {
  const d = parseFloat(dose), w = parseFloat(water);
  if (!d || !w || d <= 0) return "—";
  return "1:" + (w / d).toFixed(1);
}

// 养豆天数：冲煮日期 - 烘焙日期（天）。缺数据返回 null
function restDays(roastDate, brewDate) {
  if (!roastDate || !brewDate) return null;
  const r = new Date(roastDate), b = new Date(brewDate);
  if (isNaN(r) || isNaN(b)) return null;
  const ms = b - r;
  return Math.round(ms / 86400000); // 一天的毫秒数
}

// "2:30" -> 150 秒；空或不合法返回 null
function parseTime(str) {
  if (!str) return null;
  const m = String(str).match(/^(\d{1,2}):([0-5]\d)$/);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

// 150 -> "2:30"；null 返回 ""
function formatTime(sec) {
  if (sec == null || sec === "") return "";
  const n = parseInt(sec, 10);
  if (isNaN(n)) return "";
  return Math.floor(n / 60) + ":" + pad2(n % 60);
}

// 转义文本，防止笔记里的特殊字符破坏页面（安全小习惯）
function esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// 取某包豆下的所有冲煮
function brewsOfBean(beanId) {
  return state.brews.filter((b) => b.beanId === beanId);
}
// 按 id 找豆子
function findBean(id) {
  return state.beans.find((b) => b.id === id) || null;
}

/* ========== 1.5) 味道问题 → 下次怎么调（功能1的「灵魂」） ==========
   每个味道问题给一句"给方向"的调整建议（不给具体刻度数字）。
   key 会被存进每条冲煮的 tasteIssues 数组里（如 ["sour","astringent"]）。
   核心原理：萃取不足 → 发酸；萃取过度 → 发苦/发涩。
   调整旋钮就是研磨、水温、时间、粉水比这几个。
   以后冲多了，按你自己的口味经验随时改这里的措辞即可。 */
const TASTE_ISSUES = [
  { key: "sour",       label: "发酸 / 尖锐", advice: "研磨调细一点 / 水温 +2~3°C / 适当延长冲煮时间" },
  { key: "bitter",     label: "发苦 / 焦",   advice: "研磨调粗一点 / 水温 −2~3°C / 适当缩短冲煮时间" },
  { key: "weak",       label: "寡淡 / 像水", advice: "粉水比调浓（如 1:15 → 1:14），或粉量加一点" },
  { key: "strong",     label: "太浓 / 压舌", advice: "粉水比调淡（如 1:15 → 1:16），或水量加一点" },
  { key: "astringent", label: "涩 / 收敛",   advice: "研磨调粗一点 / 水温略降 / 注水轻柔一点（少搅拌）" },
];

// 一条冲煮勾选的味道 → 标签列表（用于显示小标签 chips）
function tasteLabels(brew) {
  const issues = brew.tasteIssues || []; // 老记录没这字段，兜底空数组
  return TASTE_ISSUES.filter((t) => issues.includes(t.key)).map((t) => t.label);
}
// 一条冲煮勾选的味道 → 有建议的那些 [{label, advice}]
function adviceForBrew(brew) {
  const issues = brew.tasteIssues || [];
  return TASTE_ISSUES
    .filter((t) => issues.includes(t.key) && t.advice)
    .map((t) => ({ label: t.label, advice: t.advice }));
}

/* ========== 3) render：渲染到页面 ========== */

const el = (sel) => document.querySelector(sel);

// 刷新整个界面（数据变了就调用它）
function renderAll() {
  el("#count-beans").textContent = state.beans.length;
  el("#count-brews").textContent = state.brews.length;
  renderBeans();
  renderBrews();
  refreshBeanSelects();
}

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

// --- 豆子列表 ---
function renderBeans() {
  const grid = el("#beans-grid");
  if (state.beans.length === 0) {
    grid.innerHTML = emptyState("🫘", "豆柜还是空的", "点右上角「新增豆子」，记下你的第一包豆");
    return;
  }
  // 新加的排前面
  const beans = [...state.beans].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  grid.innerHTML = beans.map(beanCardHTML).join("");
  // 交错入场
  staggerCards(grid, ".bean-card");
}

function beanCardHTML(bean) {
  const rest = restDays(bean.roastDate, todayISO());
  const count = brewsOfBean(bean.id).length;
  const chips = [bean.roastLevel, bean.process, bean.origin]
    .filter(Boolean)
    .map((t) => `<span class="chip">${esc(t)}</span>`)
    .join("");

  // 用量进度：有购买克数时，按总用粉量估算
  let usageHTML = "";
  const totalGrams = parseFloat(bean.weightGrams);
  if (totalGrams > 0) {
    const usedGrams = brewsOfBean(bean.id).reduce(function (s, b) { return s + (parseFloat(b.doseGrams) || 0); }, 0);
    const pct = Math.min(100, Math.round((usedGrams / totalGrams) * 100));
    const leftGrams = Math.max(0, totalGrams - usedGrams);
    usageHTML =
      '<div class="bean-usage">' +
      '<div class="usage-bar"><div class="usage-fill" style="width:' + pct + '%"></div></div>' +
      '<div class="usage-text">已用 ' + pct + '% · 剩约 ' + leftGrams + 'g</div>' +
      '</div>';
  }

  return `
    <article class="bean-card" data-bean="${bean.id}">
      <h3 class="bean-name">${esc(bean.name)}</h3>
      <div class="bean-roaster">${esc(bean.roaster || "未填烘焙商")}</div>
      <div class="chips">${chips || '<span class="chip">未填产地信息</span>'}</div>
      ${usageHTML}
      <div class="bean-stats">
        <div class="stat">
          <div class="stat-num accent">${rest == null ? "—" : rest}</div>
          <div class="stat-label">养豆天数</div>
        </div>
        <div class="stat">
          <div class="stat-num">${count}</div>
          <div class="stat-label">冲煮次数</div>
        </div>
      </div>
      <div class="row-actions">
        <button class="btn-mini" data-edit-bean="${bean.id}">编辑</button>
        <button class="btn-mini danger" data-del-bean="${bean.id}">删除</button>
      </div>
    </article>`;
}

// --- 冲煮列表 ---
function renderBrews() {
  const list = el("#brews-list");
  let brews = [...state.brews];

  // 筛选：按豆子
  const filterBean = el("#filter-bean").value;
  if (filterBean) brews = brews.filter((b) => b.beanId === filterBean);

  // 排序
  const sort = el("#sort-brews").value;
  brews.sort((a, b) => {
    if (sort === "date-asc") return (a.brewDate || "").localeCompare(b.brewDate || "");
    if (sort === "rating-desc") return (b.rating || 0) - (a.rating || 0);
    if (sort === "rating-asc") return (a.rating || 0) - (b.rating || 0);
    return (b.brewDate || "").localeCompare(a.brewDate || ""); // date-desc 默认
  });

  if (brews.length === 0) {
    list.innerHTML = emptyState("☕", "还没有冲煮记录", "点右上角「记录一杯」，记下今天这杯");
    return;
  }
  list.innerHTML = brews.map((b) => brewCardHTML(b, true)).join("");
  // 交错入场
  staggerCards(list, ".brew-card");
}

// showBean=true 时显示属于哪包豆（单豆详情里就不用重复显示了）
function brewCardHTML(brew, showBean) {
  const bean = findBean(brew.beanId);
  const rest = restDays(bean?.roastDate, brew.brewDate);
  const meta = [
    brew.grind ? `<span>研磨 <b>${esc(brew.grind)}</b></span>` : "",
    brew.waterTemp ? `<span>水温 <b>${esc(brew.waterTemp)}°C</b></span>` : "",
    brew.doseGrams && brew.waterGrams ? `<span>粉/水 <b>${esc(brew.doseGrams)}g · ${esc(brew.waterGrams)}g</b></span>` : "",
    (brew.bloomWater || brew.bloomTime) ? `<span>闷蒸 <b>${esc(brew.bloomWater || "?")}g / ${esc(brew.bloomTime || "?")}s</b></span>` : "",
    brew.totalTime ? `<span>总时间 <b>${esc(brew.totalTime)}</b></span>` : "",
    rest != null ? `<span>养豆 <b>${rest}天</b></span>` : "",
    brew.gear ? `<span>器具 <b>${esc(brew.gear)}</b></span>` : "",
  ].filter(Boolean).join("");

  return `
    <article class="brew-card" data-brew="${brew.id}">
      <div class="brew-ratio">
        <div class="ratio-num">${ratioText(brew.doseGrams, brew.waterGrams)}</div>
        <div class="ratio-label">粉水比</div>
      </div>
      <div class="brew-main">
        ${showBean ? `<div class="brew-bean">${esc(bean ? bean.name : "（豆子已删除）")}</div>` : ""}
        <div class="brew-meta">${meta || '<span class="brew-date">（未填更多参数）</span>'}</div>
        ${brew.notes ? `<div class="brew-notes">“${esc(brew.notes)}”</div>` : ""}
        ${tasteChipsHTML(brew)}
        ${adviceBlockHTML(brew)}
      </div>
      <div class="brew-side">
        ${ratingBadge(brew.rating)}
        <div class="brew-date">${esc(brew.brewDate || "")}</div>
        <div class="row-actions">
          <button class="btn-mini" data-edit-brew="${brew.id}">编辑</button>
          <button class="btn-mini danger" data-del-brew="${brew.id}">删除</button>
        </div>
      </div>
    </article>`;
}

function ratingBadge(rating) {
  const r = parseFloat(rating);
  if (!r) return `<span class="rating-badge none"><span class="r-num">—</span></span>`;
  const cls = r >= 8 ? "high" : "";
  return `<span class="rating-badge ${cls}"><span class="r-num">${r}</span><span class="r-max">/10</span></span>`;
}

function emptyState(emoji, title, sub) {
  return `<div class="empty"><div class="empty-emoji">${emoji}</div><p>${title}</p><small>${sub}</small></div>`;
}

// 勾选的味道问题，显示成一排小标签
function tasteChipsHTML(brew) {
  const labels = tasteLabels(brew);
  if (!labels.length) return "";
  return `<div class="taste-chips">${
    labels.map((l) => `<span class="taste-chip">${esc(l)}</span>`).join("")
  }</div>`;
}

// 「💡 下次试试」建议块（每个有建议的味道一行）
function adviceBlockHTML(brew) {
  const list = adviceForBrew(brew);
  if (!list.length) return "";
  return `<div class="brew-advice">
    <div class="ba-title">💡 下次试试</div>
    ${list.map((a) => `<div class="ba-line"><b>${esc(a.label)}</b> → ${esc(a.advice)}</div>`).join("")}
  </div>`;
}

// --- 功能2：最佳配方 + 调试轨迹 ---

// 这包豆评分最高的一杯；同分取最近的（先比日期，再比创建时间）。没打过分返回 null
function bestBrewOfBean(beanId) {
  const rated = brewsOfBean(beanId).filter((b) => num(b.rating));
  if (!rated.length) return null;
  return [...rated].sort((a, b) =>
    (b.rating - a.rating) ||
    (b.brewDate || "").localeCompare(a.brewDate || "") ||
    ((b.createdAt || 0) - (a.createdAt || 0))
  )[0];
}

// 「🎯 最佳配方」卡片
function bestRecipeHTML(brew) {
  const bloom = (brew.bloomWater || brew.bloomTime)
    ? `${esc(brew.bloomWater || "?")}g / ${esc(brew.bloomTime || "?")}s` : "—";
  const rows = [
    ["粉水比", ratioText(brew.doseGrams, brew.waterGrams)],
    ["水温", brew.waterTemp ? esc(brew.waterTemp) + "°C" : "—"],
    ["研磨", brew.grind ? esc(brew.grind) : "—"],
    ["闷蒸", bloom],
    ["总时间", brew.totalTime ? esc(brew.totalTime) : "—"],
    ["器具", brew.gear ? esc(brew.gear) : "—"],
  ].map(([k, v]) => `<div class="br-item"><div class="br-k">${k}</div><div class="br-v">${v}</div></div>`).join("");

  return `<div class="best-recipe">
    <div class="best-head"><h3>🎯 最佳配方</h3><span class="best-rating">${esc(brew.rating)}<small>/10</small></span></div>
    <p class="best-sub">这包豆你打分最高的一杯，照着复现它 ↓</p>
    <div class="br-grid">${rows}</div>
    <button class="btn btn-solid" data-repro="${brew.id}">照这个再冲一杯</button>
  </div>`;
}

// 「🧪 调试轨迹」：按时间正序，每个点显示 评分 + 器具 + 研磨度 + 水温
function dialInTrajectoryHTML(beanId) {
  const brews = brewsOfBean(beanId).sort((a, b) =>
    (a.brewDate || "").localeCompare(b.brewDate || "") || ((a.createdAt || 0) - (b.createdAt || 0))
  );
  if (brews.length < 2) return ""; // 只有 0–1 杯没必要画轨迹

  const points = brews.map((b, i) => {
    const meta = [
      b.gear ? esc(b.gear) : "",
      b.grind ? "研磨 " + esc(b.grind) : "",
      b.waterTemp ? esc(b.waterTemp) + "°C" : "",
    ].filter(Boolean).join(" · ");
    return `<div class="traj-point">
      <div class="traj-dot">${i + 1}</div>
      <div class="traj-body">
        <div class="traj-top"><span class="traj-date">${esc(b.brewDate || "")}</span>${ratingBadge(b.rating)}</div>
        <div class="traj-meta">${meta || "（未填器具 / 研磨 / 水温）"}</div>
      </div>
    </div>`;
  }).join("");

  return `<h3 class="detail-section-title">🧪 调试轨迹（按时间）</h3>
    <div class="trajectory">${points}</div>`;
}

// --- 单豆详情 ---
function renderBeanDetail(beanId) {
  const bean = findBean(beanId);
  if (!bean) { showView("beans"); return; }
  const brews = brewsOfBean(beanId).sort((a, b) => (b.rating || 0) - (a.rating || 0));
  const rest = restDays(bean.roastDate, todayISO());
  const ratings = brews.map((b) => parseFloat(b.rating)).filter((n) => n > 0);
  const avg = ratings.length ? (ratings.reduce((s, n) => s + n, 0) / ratings.length).toFixed(1) : "—";
  const best = ratings.length ? Math.max(...ratings) : "—";

  const chips = [bean.roastLevel, bean.process, bean.origin, bean.roaster]
    .filter(Boolean).map((t) => `<span class="chip">${esc(t)}</span>`).join("");

  el("#bean-detail-content").innerHTML = `
    <div class="detail-head">
      <h2>${esc(bean.name)}</h2>
      <div class="detail-roaster">${esc(bean.roaster || "")}</div>
      <div class="chips">${chips}</div>
      <div class="detail-grid">
        <div class="stat"><div class="stat-num accent">${rest == null ? "—" : rest}</div><div class="stat-label">养豆天数</div></div>
        <div class="stat"><div class="stat-num">${brews.length}</div><div class="stat-label">冲煮次数</div></div>
        <div class="stat"><div class="stat-num">${avg}</div><div class="stat-label">平均评分</div></div>
        <div class="stat"><div class="stat-num">${best}</div><div class="stat-label">最高评分</div></div>
        ${bean.roastDate ? `<div class="stat"><div class="stat-num" style="font-size:18px">${esc(bean.roastDate)}</div><div class="stat-label">烘焙日期</div></div>` : ""}
        ${bean.price ? `<div class="stat"><div class="stat-num">¥${esc(bean.price)}</div><div class="stat-label">价格${bean.weightGrams ? " / " + esc(bean.weightGrams) + "g" : ""}</div></div>` : ""}
      </div>
      <div class="row-actions" style="margin-top:18px">
        <button class="btn-mini" data-edit-bean="${bean.id}">编辑豆子</button>
        <button class="btn-mini danger" data-del-bean="${bean.id}">删除豆子</button>
      </div>
    </div>
    ${(() => { const best = bestBrewOfBean(beanId); return best ? bestRecipeHTML(best) : ""; })()}
    ${dialInTrajectoryHTML(beanId)}
    <h3 class="detail-section-title">这包豆的冲煮（按评分高→低）</h3>
    <div class="brews-list">
      ${brews.length ? brews.map((b) => brewCardHTML(b, false)).join("")
        : emptyState("☕", "这包豆还没冲过", "去「冲煮记录」记一杯，选这包豆")}
    </div>`;
  showView("bean-detail");
}

/* ========== 视图切换 ========== */
function showView(name) {
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("is-active"));
  el(`#view-${name}`).classList.add("is-active");
  // 顶部标签高亮（详情页 name=bean-detail 时三个标签都不亮，符合预期）
  document.querySelectorAll(".tab").forEach((t) => {
    t.classList.toggle("is-active", t.dataset.view === name);
    if (t.dataset.view === name && t.dataset.view !== "bean-detail") {
      updateTabIndicator(t);
    }
  });
  if (name === "analysis") renderAnalysis(); // 进分析页时现算
  window.scrollTo({ top: 0, behavior: "smooth" });
  // 切换后给当前视图的卡片加交错动画
  var activeView = el("#view-" + name);
  if (activeView) {
    staggerCards(activeView, ".bean-card, .brew-card");
  }
}

// 把豆子填进下拉框（筛选框 + 新增冲煮的选豆框）
function refreshBeanSelects() {
  const options = state.beans
    .map((b) => `<option value="${b.id}">${esc(b.name)}</option>`)
    .join("");

  const filter = el("#filter-bean");
  const keepFilter = filter.value;
  filter.innerHTML = `<option value="">全部</option>` + options;
  filter.value = keepFilter; // 尽量保留用户当前选择

  el("#brew-bean-select").innerHTML =
    options || `<option value="">（请先去「咖啡豆」添加一包豆）</option>`;

  // 分析页的范围下拉（全部 + 各包豆）
  const analysis = el("#analysis-bean");
  const keepAnalysis = analysis.value;
  analysis.innerHTML = `<option value="">全部豆子</option>` + options;
  analysis.value = keepAnalysis;
}

/* ========== 3.5) analyze：评分关联分析 ==========
   思路：不做花哨统计，只做"描述性分析"——
   把你打分最高的几杯挑出来看共性，并按器具/处理法分组比平均分。
   数据少时如实提示"仅供参考"。 */

// 把空、0、非数字都当作"没填"返回 null，避免污染统计
function num(v) {
  const n = parseFloat(v);
  return isNaN(n) || n <= 0 ? null : n;
}

// 数值型指标：标签 + 取值函数 + 显示格式
const NUMERIC_METRICS = [
  { label: "粉水比", get: (b) => (num(b.doseGrams) && num(b.waterGrams)) ? b.waterGrams / b.doseGrams : null, fmt: (v) => "1:" + v.toFixed(1) },
  { label: "水温",   get: (b) => num(b.waterTemp), fmt: (v) => Math.round(v) + "°C" },
  { label: "养豆天数", get: (b) => restDays(findBean(b.beanId)?.roastDate, b.brewDate), fmt: (v) => Math.round(v) + " 天" },
  { label: "闷蒸时间", get: (b) => num(b.bloomTime), fmt: (v) => Math.round(v) + " 秒" },
  { label: "总时间",  get: (b) => parseTime(b.totalTime), fmt: (v) => formatTime(Math.round(v)) },
];

// 文字型指标（出现最多的那个）
const CATEGORY_METRICS = [
  { label: "研磨度", get: (b) => b.grind },
  { label: "器具",   get: (b) => b.gear },
];

// 取当前分析范围内、打过分的冲煮
function ratedBrews(scopeBeanId) {
  let list = state.brews.filter((b) => num(b.rating));
  if (scopeBeanId) list = list.filter((b) => b.beanId === scopeBeanId);
  return list;
}

// 评分最高的一批：取前 1/3（至少 1 杯）——数据少不至于只看 1 杯，数据多也不掺中庸杯
function topBrews(list) {
  const sorted = [...list].sort((a, b) => b.rating - a.rating);
  const n = Math.max(1, Math.ceil(sorted.length / 3));
  return sorted.slice(0, n);
}

// 一组数字 -> 最小/最大/中位数（中位数当"典型值"）
function summarizeNumbers(vals) {
  if (!vals.length) return null;
  const s = [...vals].sort((a, b) => a - b);
  return { min: s[0], max: s[s.length - 1], median: s[Math.floor(s.length / 2)], count: s.length };
}

// 一组文字 -> 出现最多的那个 + 次数
function topCategory(vals) {
  const clean = vals.filter(Boolean);
  if (!clean.length) return null;
  const map = {};
  clean.forEach((v) => (map[v] = (map[v] || 0) + 1));
  let best = null, bestCount = 0;
  for (const k in map) if (map[k] > bestCount) { best = k; bestCount = map[k]; }
  return { value: best, count: bestCount, total: clean.length };
}

// 按某个键分组，算每组平均分 + 杯数，按平均分降序
function groupByAvgRating(list, keyFn) {
  const map = {};
  list.forEach((b) => {
    const k = keyFn(b);
    if (!k) return;
    (map[k] = map[k] || []).push(b.rating);
  });
  return Object.entries(map)
    .map(([key, arr]) => ({ key, avg: arr.reduce((s, x) => s + x, 0) / arr.length, count: arr.length }))
    .sort((a, b) => b.avg - a.avg);
}

// --- 渲染分析页 ---
function renderAnalysis() {
  const scope = el("#analysis-bean").value;
  const list = ratedBrews(scope);
  const box = el("#analysis-content");

  // 一杯都没打分
  if (list.length === 0) {
    const totalBrews = state.brews.length;
    if (totalBrews === 0) {
      // 还没有任何冲煮记录
      box.innerHTML = emptyState("📊", "还没有可分析的数据",
        "先去「冲煮记录」标签，点「+ 记录一杯」，冲完给这杯打个分（1–10），这里就会帮你找规律 ✨");
    } else {
      // 有冲煮记录但都没打分
      box.innerHTML = emptyState("📊", "这 " + totalBrews + " 杯还没打分",
        "去「冲煮记录」标签，点每条记录的「编辑」，拖动评分滑块打个分（1–10），再回来就能分析了 ✨");
    }
    return;
  }

  let html = "";

  // 数据太少：如实提示，但仍展示能算的
  if (list.length < 3) {
    html += `<div class="notice warn">⚠️ 目前只有 ${list.length} 杯打了分，规律仅供参考。多记几杯、多打分，结论会更靠谱。</div>`;
  }

  const tops = topBrews(list);

  // —— 块①：高分配方共性 ——
  const recipeItems = [];
  for (const m of NUMERIC_METRICS) {
    const vals = tops.map(m.get).filter((v) => v != null);
    const sum = summarizeNumbers(vals);
    if (!sum) continue;
    const rangeText = sum.min === sum.max ? "" : `<div class="ri-range">范围 ${m.fmt(sum.min)} – ${m.fmt(sum.max)}</div>`;
    recipeItems.push(
      `<div class="recipe-item"><div class="ri-label">${m.label}</div><div class="ri-value">${m.fmt(sum.median)}</div>${rangeText}</div>`
    );
  }
  for (const m of CATEGORY_METRICS) {
    const top = topCategory(tops.map(m.get));
    if (!top) continue;
    recipeItems.push(
      `<div class="recipe-item"><div class="ri-label">${m.label}</div><div class="ri-value" style="font-size:15px">${esc(top.value)}</div><div class="ri-range">${top.count}/${top.total} 杯都用它</div></div>`
    );
  }
  html += `<div class="analysis-block">
    <h3>🏆 你的高分配方</h3>
    <p class="block-sub">取你评分最高的 ${tops.length} 杯，看它们的参数集中在哪</p>
    ${recipeItems.length ? `<div class="recipe-grid">${recipeItems.join("")}</div>`
      : `<p class="block-sub">这些高分杯还没填够参数，先把水温、粉水比等记上吧。</p>`}
  </div>`;

  // —— 块②：下次试试建议 ——
  const suggestParts = [];
  for (const m of NUMERIC_METRICS) {
    const sum = summarizeNumbers(tops.map(m.get).filter((v) => v != null));
    if (sum) suggestParts.push(`${m.label} <b>${m.fmt(sum.median)}</b>`);
  }
  const grindTop = topCategory(tops.map((b) => b.grind));
  if (grindTop) suggestParts.push(`研磨 <b>${esc(grindTop.value)}</b>`);
  if (suggestParts.length) {
    html += `<div class="suggest-card">
      <h3>💡 下次试试</h3>
      <div class="suggest-line">照着你打分最高那几杯的样子：${suggestParts.join("、")}。</div>
    </div>`;
  }

  // —— 块③：器具 / 处理法 分类对比 ——
  const byGear = groupByAvgRating(list, (b) => b.gear);
  const byProcess = groupByAvgRating(list, (b) => findBean(b.beanId)?.process);
  const compareGroups = [];
  if (byGear.length >= 2) compareGroups.push(compareGroupHTML("按器具", byGear));
  if (!scope && byProcess.length >= 2) compareGroups.push(compareGroupHTML("按处理法", byProcess));
  if (compareGroups.length) {
    html += `<div class="analysis-block">
      <h3>⚖️ 分类对比</h3>
      <p class="block-sub">不同选择的平均评分，看哪类你打分更高（条越长越高分）</p>
      ${compareGroups.join("")}
    </div>`;
  }

  box.innerHTML = html;
}

// 一组"分类 -> 平均分"的条形图
function compareGroupHTML(title, rows) {
  const bars = rows.map((r) => {
    const pct = (r.avg / 10) * 100; // 满分 10，按比例画条
    return `<div class="compare-row">
      <div class="cr-name" title="${esc(r.key)}">${esc(r.key)}</div>
      <div class="cr-bar-wrap"><div class="cr-bar" style="width:${pct}%"></div></div>
      <div class="cr-val">${r.avg.toFixed(1)} <span class="cr-count">(${r.count}杯)</span></div>
    </div>`;
  }).join("");
  return `<div class="compare-group"><h4>${title}</h4>${bars}</div>`;
}

/* ========== 4) wire：事件接线 ========== */

// 当前正在编辑的记录 id（null = 新增）
let editingBeanId = null;
let editingBrewId = null;

// 表单脏标记：有未保存修改时设为 true，防止误关丢失数据
let beanFormDirty = false;
let brewFormDirty = false;

function markDirty(formId) {
  if (formId === "bean") beanFormDirty = true;
  if (formId === "brew") brewFormDirty = true;
}
function clearDirty(formId) {
  if (formId === "bean") beanFormDirty = false;
  if (formId === "brew") brewFormDirty = false;
}

function initEvents() {
  // 顶部标签切换
  el("#tabs").addEventListener("click", (e) => {
    const tab = e.target.closest(".tab");
    if (tab) showView(tab.dataset.view);
  });

  // 返回豆柜
  el("#btn-back").addEventListener("click", () => showView("beans"));

  // 豆子卡片：按钮（编辑/删除）优先，然后才是点卡片进详情
  el("#beans-grid").addEventListener("click", (e) => {
    const editBtn = e.target.closest("[data-edit-bean]");
    const delBtn = e.target.closest("[data-del-bean]");
    if (editBtn) { e.stopPropagation(); openBeanDialog(editBtn.dataset.editBean); return; }
    if (delBtn) { e.stopPropagation(); deleteBean(delBtn.dataset.delBean); return; }
    const card = e.target.closest(".bean-card");
    if (card) renderBeanDetail(card.dataset.bean);
  });

  // 冲煮列表里的编辑/删除（事件委托）
  el("#brews-list").addEventListener("click", onBrewListClick);
  // 详情页里的按钮（编辑/删除豆子、编辑/删除冲煮）也委托到 content
  el("#bean-detail-content").addEventListener("click", onDetailClick);

  // 筛选/排序变化 -> 重画冲煮列表
  el("#filter-bean").addEventListener("change", renderBrews);
  el("#sort-brews").addEventListener("change", renderBrews);

  // 分析范围切换 -> 重算分析
  el("#analysis-bean").addEventListener("change", renderAnalysis);

  // 新增按钮
  el("#btn-add-bean").addEventListener("click", () => openBeanDialog(null));
  el("#btn-add-brew").addEventListener("click", () => openBrewDialog(null));

  // 弹窗里的「取消」——有未保存修改时先提示，不直接关
  document.querySelectorAll("[data-close]").forEach((btn) =>
    btn.addEventListener("click", function (e) {
      var dlg = e.target.closest("dialog");
      if (!dlg) return;
      if (dlg.id === "bean-dialog" && beanFormDirty) {
        showToast("有未保存的修改，请先保存或点「取消」再次确认关闭", "warn");
        beanFormDirty = false; // 再点一次就关
        return;
      }
      if (dlg.id === "brew-dialog" && brewFormDirty) {
        showToast("有未保存的修改，请先保存或点「取消」再次确认关闭", "warn");
        brewFormDirty = false; // 再点一次就关
        return;
      }
      animateDialogClose(dlg);
    })
  );

  // 按 Esc 关闭弹窗时也要检查未保存内容
  document.querySelectorAll("dialog").forEach((dlg) => {
    dlg.addEventListener("cancel", function (e) {
      if (dlg.id === "bean-dialog" && beanFormDirty) {
        e.preventDefault();
        showToast("有未保存的修改，请先保存或再按一次 Esc 强制关闭", "warn");
        beanFormDirty = false;
        return;
      }
      if (dlg.id === "brew-dialog" && brewFormDirty) {
        e.preventDefault();
        showToast("有未保存的修改，请先保存或再按一次 Esc 强制关闭", "warn");
        brewFormDirty = false;
        return;
      }
    });
  });

  // 表单提交
  el("#bean-form").addEventListener("submit", onSaveBean);
  el("#brew-form").addEventListener("submit", onSaveBrew);

  // 表单输入变化 → 标记脏（用于关闭前警告）
  el("#bean-form").addEventListener("input", function () { markDirty("bean"); });
  el("#bean-form").addEventListener("change", function () { markDirty("bean"); });
  el("#brew-form").addEventListener("input", function () { markDirty("brew"); });
  el("#brew-form").addEventListener("change", function () { markDirty("brew"); });

  // 冲煮表单：实时算粉水比 + 养豆天数 + 评分文字
  el("#dose-input").addEventListener("input", updateBrewPreview);
  el("#water-input").addEventListener("input", updateBrewPreview);
  el("#brew-date").addEventListener("input", updateBrewPreview);
  el("#brew-bean-select").addEventListener("change", updateBrewPreview);
  el("#rating-input").addEventListener("input", updateRatingOutput);

  // 味道复选框：先渲染出来，再监听勾选 -> 实时更新建议
  renderTasteOptions();
  el("#taste-options").addEventListener("change", updateTastePreview);

  // 导出 / 导入
  el("#btn-export").addEventListener("click", function () {
    store.exportJSON();
    showToast("备份已保存 ☕", "success");
  });
  el("#btn-import").addEventListener("click", () => el("#file-import").click());
  el("#file-import").addEventListener("change", onImportFile);
}

// ----- 冲煮列表点击 -----
function onBrewListClick(e) {
  const editId = e.target.closest("[data-edit-brew]")?.dataset.editBrew;
  const delId = e.target.closest("[data-del-brew]")?.dataset.delBrew;
  if (editId) openBrewDialog(editId);
  if (delId) deleteBrew(delId);
}

// ----- 详情页点击 -----
function onDetailClick(e) {
  const editBean = e.target.closest("[data-edit-bean]")?.dataset.editBean;
  const delBean = e.target.closest("[data-del-bean]")?.dataset.delBean;
  const editBrew = e.target.closest("[data-edit-brew]")?.dataset.editBrew;
  const delBrew = e.target.closest("[data-del-brew]")?.dataset.delBrew;
  const repro = e.target.closest("[data-repro]")?.dataset.repro;
  if (editBean) openBeanDialog(editBean);
  if (delBean) deleteBean(delBean);
  if (editBrew) openBrewDialog(editBrew);
  if (repro) reproduceBrew(repro);
  if (delBrew) {
    const beanId = findBrewBeanId(delBrew);
    deleteBrew(delBrew, function () { if (beanId) renderBeanDetail(beanId); });
  }
}
function findBrewBeanId(brewId) {
  const b = state.brews.find((x) => x.id === brewId);
  return b ? b.beanId : null;
}

/* ----- 豆子：打开弹窗 / 保存 / 删除 ----- */
function openBeanDialog(id) {
  editingBeanId = id;
  clearDirty("bean");
  const form = el("#bean-form");
  form.reset();
  el("#bean-dialog-title").textContent = id ? "编辑豆子" : "新增豆子";
  if (id) {
    const bean = findBean(id);
    if (bean) {
      for (const key of ["name", "roaster", "roastDate", "roastLevel", "origin", "process", "weightGrams", "price"]) {
        if (form.elements[key]) form.elements[key].value = bean[key] ?? "";
      }
    }
  }
  animateDialogOpen(el("#bean-dialog"));
}

function onSaveBean(e) {
  e.preventDefault();
  const f = e.target.elements;
  const data = {
    name: f.name.value.trim(),
    roaster: f.roaster.value.trim(),
    roastDate: f.roastDate.value,
    roastLevel: f.roastLevel.value,
    origin: f.origin.value.trim(),
    process: f.process.value.trim(),
    weightGrams: f.weightGrams.value,
    price: f.price.value,
  };
  if (!data.name) return; // required 已经拦住，这里再保险一次

  if (editingBeanId) {
    const bean = findBean(editingBeanId);
    Object.assign(bean, data);
    bean.updatedAt = Date.now();
  } else {
    const now = Date.now();
    state.beans.push({ id: uid(), createdAt: now, updatedAt: now, ...data });
  }
  store.save();
  if (window.SyncClient && SyncClient.enabled()) SyncClient.pushOnly();
  renderAll();
  clearDirty("bean");
  flashButton(el("#bean-form").querySelector('button[type="submit"]'));
  showToast("豆子已保存 ☕", "success");
  animateDialogClose(el("#bean-dialog"));
}

function deleteBean(id) {
  const bean = findBean(id);
  const count = brewsOfBean(id).length;
  const msg = count > 0
    ? '确定删除「' + (bean ? bean.name : '') + '」？它名下的 ' + count + ' 条冲煮也会一起删除。'
    : '确定删除「' + (bean ? bean.name : '') + '」？此操作无法恢复。';

  // 找到合适的确认条锚点：优先当前页面的卡片或详情头
  var anchor = document.querySelector('.bean-card[data-bean="' + id + '"]');
  if (!anchor) anchor = document.querySelector("#bean-detail-content .detail-head");
  if (!anchor) anchor = document.querySelector("#beans-grid");
  confirmInline(anchor, msg, function () {
    const now = Date.now();
    state.tombstones.beans[id] = now;
    state.beans = state.beans.filter((b) => b.id !== id);
    for (var i = 0; i < state.brews.length; i++) {
      if (state.brews[i].beanId === id) state.tombstones.brews[state.brews[i].id] = now;
    }
    state.brews = state.brews.filter((b) => b.beanId !== id);
    store.save();
    if (window.SyncClient && SyncClient.enabled()) SyncClient.pushOnly();
    renderAll();
    showView("beans");
    var delMsg = "豆子已删除";
    if (count > 0) delMsg += "（含其名下 " + count + " 条冲煮记录）";
    showToast(delMsg, "warn");
  });
}

/* ----- 冲煮：打开弹窗 / 保存 / 删除 ----- */
function openBrewDialog(id) {
  if (state.beans.length === 0) {
    alert("请先到「咖啡豆」标签添加至少一包豆，再来记录冲煮 🙂");
    showView("beans");
    return;
  }
  editingBrewId = id;
  clearDirty("brew");
  const form = el("#brew-form");
  form.reset();
  el("#brew-dialog-title").textContent = id ? "编辑冲煮" : "记录一杯";

  if (id) {
    const brew = state.brews.find((b) => b.id === id);
    if (brew) {
      for (const key of ["beanId", "brewDate", "doseGrams", "waterGrams", "waterTemp",
        "grind", "bloomWater", "bloomTime", "totalTime", "gear", "rating", "notes"]) {
        if (form.elements[key]) form.elements[key].value = brew[key] ?? "";
      }
      // 回显勾选的味道问题
      const issues = brew.tasteIssues || [];
      form.querySelectorAll('input[name="taste"]').forEach((cb) => (cb.checked = issues.includes(cb.value)));
    }
  } else {
    el("#brew-date").value = todayISO(); // 新增时默认今天
  }
  updateRatingOutput();
  updateBrewPreview();
  updateTastePreview();
  animateDialogOpen(el("#brew-dialog"));
}

function onSaveBrew(e) {
  e.preventDefault();
  const f = e.target.elements;
  const totalTime = f.totalTime.value.trim();
  if (totalTime && parseTime(totalTime) == null) {
    alert("总冲煮时间格式应为 分:秒，例如 2:30");
    return;
  }
  const data = {
    beanId: f.beanId.value,
    brewDate: f.brewDate.value || todayISO(),
    doseGrams: f.doseGrams.value,
    waterGrams: f.waterGrams.value,
    waterTemp: f.waterTemp.value,
    grind: f.grind.value.trim(),
    bloomWater: f.bloomWater.value,
    bloomTime: f.bloomTime.value,
    totalTime: totalTime,
    gear: f.gear.value.trim(),
    rating: parseFloat(f.rating.value) || 0,
    notes: f.notes.value.trim(),
    tasteIssues: checkedTasteKeys(),
  };
  if (!data.beanId) { alert("请选择这杯用的豆子"); return; }

  // 拒绝负数：粉量、水量、闷蒸、水温等不应为负
  const numFields = [
    { key: "doseGrams", label: "粉量" },
    { key: "waterGrams", label: "总水量" },
    { key: "waterTemp", label: "水温" },
    { key: "bloomWater", label: "闷蒸水量" },
    { key: "bloomTime", label: "闷蒸时间" },
  ];
  for (const { key, label } of numFields) {
    const v = parseFloat(data[key]);
    if (!isNaN(v) && v < 0) { alert(label + "不能是负数，请修改后再保存"); return; }
  }

  if (editingBrewId) {
    const brew = state.brews.find((b) => b.id === editingBrewId);
    Object.assign(brew, data);
    brew.updatedAt = Date.now();
  } else {
    const now = Date.now();
    state.brews.push({ id: uid(), createdAt: now, updatedAt: now, ...data });
  }
  store.save();
  if (window.SyncClient && SyncClient.enabled()) SyncClient.pushOnly();
  renderAll();
  clearDirty("brew");
  flashButton(el("#brew-form").querySelector('button[type="submit"]'));
  showToast("冲煮记录已保存 ☕", "success");
  animateDialogClose(el("#brew-dialog"));

  // 如果当前正在看某包豆的详情，刷新它
  if (el("#view-bean-detail").classList.contains("is-active")) {
    renderBeanDetail(data.beanId);
  }
}

function deleteBrew(id, onDeleted) {
  var card = document.querySelector('.brew-card[data-brew="' + id + '"]');
  confirmInline(card || el("#brews-list"), "确定删除这条冲煮记录？此操作无法恢复。", function () {
    state.tombstones.brews[id] = Date.now();
    state.brews = state.brews.filter(function (b) { return b.id !== id; });
    store.save();
    if (window.SyncClient && SyncClient.enabled()) SyncClient.pushOnly();
    renderAll();
    showToast("冲煮记录已删除", "warn");
    if (onDeleted) onDeleted();
  });
}

/* ----- 冲煮弹窗的实时反馈 ----- */
function updateBrewPreview() {
  const dose = el("#dose-input").value;
  const water = el("#water-input").value;
  el("#ratio-preview").textContent = ratioText(dose, water);
  pulseElement(el("#ratio-preview"));

  const beanId = el("#brew-bean-select").value;
  const bean = findBean(beanId);
  const rest = restDays(bean?.roastDate, el("#brew-date").value || todayISO());
  el("#rest-preview").textContent = rest == null ? "—" : rest + " 天";
  pulseElement(el("#rest-preview"));
}

function updateRatingOutput() {
  const v = parseFloat(el("#rating-input").value);
  el("#rating-output").textContent = v ? `${v} / 10` : "未评分";
  if (v) pulseElement(el("#rating-output"));
}

/* ----- 味道复选框：渲染 / 实时建议 ----- */

// 把 TASTE_ISSUES 渲染成一排复选框（只需在启动时调一次）
function renderTasteOptions() {
  el("#taste-options").innerHTML = TASTE_ISSUES.map((t) => `
    <label class="taste-check">
      <input type="checkbox" name="taste" value="${t.key}" />
      <span>${esc(t.label)}</span>
    </label>`).join("");
}

// 当前勾了哪些味道（读复选框）
function checkedTasteKeys() {
  return [...el("#brew-form").querySelectorAll('input[name="taste"]:checked')].map((cb) => cb.value);
}

// 按当前勾选，实时刷新弹窗里的「下次试试」
function updateTastePreview() {
  const keys = checkedTasteKeys();
  const box = el("#taste-advice-preview");
  if (!keys.length) { box.innerHTML = ""; return; }

  const withAdvice = TASTE_ISSUES.filter((t) => keys.includes(t.key) && t.advice);
  const missing = TASTE_ISSUES.filter((t) => keys.includes(t.key) && !t.advice);

  let html = `<div class="ba-title">💡 下次试试</div>`;
  html += withAdvice.map((t) => `<div class="ba-line"><b>${esc(t.label)}</b> → ${esc(t.advice)}</div>`).join("");
  if (missing.length) {
    html += `<div class="ba-line ba-empty">（${missing.map((t) => esc(t.label)).join("、")} 还没填建议——去 app.js 的 TASTE_ISSUES 补上 advice）</div>`;
  }
  box.innerHTML = html;
}

// 按一条已有冲煮的参数，开一个"新"记录（复现配方）
function reproduceBrew(brewId) {
  const src = state.brews.find((b) => b.id === brewId);
  if (!src) return;
  editingBrewId = null; // 是"新增"，不是编辑那条
  const form = el("#brew-form");
  form.reset();
  el("#brew-dialog-title").textContent = "照配方再冲一杯";

  // 带入配方参数，但不带评分 / 笔记 / 味道（那是这次要重新填的）
  for (const key of ["beanId", "doseGrams", "waterGrams", "waterTemp", "grind", "bloomWater", "bloomTime", "totalTime", "gear"]) {
    if (form.elements[key]) form.elements[key].value = src[key] ?? "";
  }
  el("#brew-date").value = todayISO();
  form.querySelectorAll('input[name="taste"]').forEach((cb) => (cb.checked = false));

  updateRatingOutput();
  updateBrewPreview();
  updateTastePreview();
  animateDialogOpen(el("#brew-dialog"));
}

/* ----- 导入文件 ----- */
function onImportFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  // 立即重置 input，保证无论确认还是取消都能重选同一文件
  e.target.value = "";
  confirmInline(el("#btn-import"), "导入会用文件数据【覆盖】当前所有记录，确定继续？（建议先导出备份）", function () {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        store.importJSON(reader.result);
        renderAll();
        showView("beans");
        showToast("导入成功 ✅", "success");
        // 导入后触发云同步，确保多设备能收到导入的数据
        if (window.SyncClient && SyncClient.enabled()) SyncClient.pushOnly();
      } catch (err) {
        showToast("导入失败：" + err.message, "error");
      }
    };
    reader.readAsText(file);
  });
}

/* ----- 云同步：独立弹窗设置，稳定可靠 ----- */
function initSync() {
  // 如果 sync.js 没加载成功（极少发生，但做兜底），静默跳过
  if (!window.SyncClient) return;

  var indicator = document.getElementById("sync-indicator");
  var label = document.getElementById("sync-label");
  var dialog = document.getElementById("sync-dialog");
  var codeInput = document.getElementById("sync-code-input");
  var form = document.getElementById("sync-form");

  function updateUI(s) {
    if (!s) return;
    if (label) label.textContent = s.text || "未启用";
    if (indicator) {
      indicator.classList.remove("enabled", "syncing", "error");
      if (s.type === "ok") indicator.classList.add("enabled");
      else if (s.type === "syncing") indicator.classList.add("syncing");
      else if (s.type === "error" || s.type === "auth" || s.type === "offline") indicator.classList.add("error");
    }
    // 同步更新页脚文案
    var footer = document.getElementById("footer-text");
    if (footer) {
      if (SyncClient.enabled()) {
        footer.textContent = "☁️ 云同步已启用 · 多设备数据自动合并 · 建议偶尔「导出备份」";
      } else {
        footer.textContent = "数据存于本地浏览器，可设同步码多设备共享 · 建议偶尔「导出备份」";
      }
    }
  }

  SyncClient.init({
    onStatus: function (s) { updateUI(s); },
    getLocal: getStateForSync,
    setLocal: applyMergedState,
  });

  // 初始状态
  if (codeInput) codeInput.value = SyncClient.getCode();
  updateUI(SyncClient.enabled() ? { type: "ok", text: "已启用" } : { type: "", text: "未启用" });

  // 点击指示器 → 打开同步设置弹窗
  if (indicator && dialog) {
    indicator.addEventListener("click", function () {
      // 打开前回显当前同步码
      if (codeInput) codeInput.value = SyncClient.getCode();
      animateDialogOpen(dialog);
    });
  }

  // 弹窗里的取消按钮
  if (dialog) {
    dialog.querySelectorAll("[data-close]").forEach(function (btn) {
      btn.addEventListener("click", function () { animateDialogClose(dialog); });
    });
  }

  // 表单提交 = 保存并同步
  if (form) {
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var code = codeInput ? codeInput.value.trim() : "";
      SyncClient.setCode(code);

      if (SyncClient.enabled()) {
        SyncClient.syncNow();
        updateUI({ type: "ok", text: "已启用" });
        showToast("同步码已保存，正在同步…", "success");
      } else {
        // 清空同步码 = 断开
        updateUI({ type: "", text: "未启用" });
        showToast("已断开云同步", "warn");
      }

      animateDialogClose(dialog);
    });
  }

  // 启动时自动同步一轮
  if (SyncClient.enabled()) {
    window.addEventListener("load", function () { SyncClient.syncNow(); });
  }

  // 切回页面时自动同步（比如切到微信看了个消息再回来）
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible" && SyncClient.enabled()) {
      SyncClient.syncNow();
    }
  });

  // 网络恢复时自动同步
  window.addEventListener("online", function () {
    if (SyncClient.enabled()) SyncClient.syncNow();
  });
}

/* ========== 启动 ========== */
store.load();
initEvents();
renderAll();
initSync();
// 初始标签指示器位置
(function () {
  var activeTab = document.querySelector(".tab.is-active");
  if (activeTab) updateTabIndicator(activeTab);
})();
