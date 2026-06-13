/* ========== wheel.js — 咖啡风味轮 SVG 圆盘 ========== */

// --- 纯函数 ---

/**
 * 构建单个扇形的 SVG path d 属性字符串。
 * 坐标系：cx=cy=0，0 弧度指向 12 点钟方向（-y 轴），顺时针增大。
 *
 * 路径结构：M(外弧起点) A(外弧到终点) L(内弧终点) A(内弧回起点, sweep=0) Z
 *
 * @param {number} startAngle - 起始角度（弧度）
 * @param {number} endAngle   - 终止角度（弧度）
 * @param {number} innerR     - 内圆半径
 * @param {number} outerR     - 外圆半径
 * @returns {string} SVG path d 字符串
 */
function buildSectorPath(startAngle, endAngle, innerR, outerR) {
  // x = cx + r*sin(a)，y = cy - r*cos(a)，cx=cy=0
  var sinStart = Math.sin(startAngle);
  var cosStart = Math.cos(startAngle);
  var sinEnd   = Math.sin(endAngle);
  var cosEnd   = Math.cos(endAngle);

  // 外弧起点和终点
  var ox1 = (outerR * sinStart).toFixed(4);
  var oy1 = (-outerR * cosStart).toFixed(4);
  var ox2 = (outerR * sinEnd).toFixed(4);
  var oy2 = (-outerR * cosEnd).toFixed(4);

  // 内弧起点和终点（对应外弧的终点和起点）
  var ix1 = (innerR * sinEnd).toFixed(4);
  var iy1 = (-innerR * cosEnd).toFixed(4);
  var ix2 = (innerR * sinStart).toFixed(4);
  var iy2 = (-innerR * cosStart).toFixed(4);

  // large-arc-flag：弧度差严格大于 π 时为 1
  var largeArc = (endAngle - startAngle) > Math.PI ? 1 : 0;

  var outerRStr = outerR.toFixed(4);
  var innerRStr = innerR.toFixed(4);
  var outerArc = "A " + outerRStr + " " + outerRStr + " 0 " + largeArc + " 1\n" + ox2 + " " + oy2;
  var innerArc = "A " + innerRStr + " " + innerRStr + " 0 " + largeArc + " 0\n" + ix2 + " " + iy2;
  return "M " + ox1 + " " + oy1 + " " + outerArc + " L " + ix1 + " " + iy1 + " " + innerArc + " Z";
}

/**
 * 在 flavorWheel 所有大类的 children 里查找 key，返回对应 label。
 * 找不到返回 null。
 *
 * @param {string} key
 * @param {Array}  flavorWheel
 * @returns {string|null}
 */
function flavorKeyToLabel(key, flavorWheel) {
  for (var i = 0; i < flavorWheel.length; i++) {
    var cat = flavorWheel[i];
    var children = cat.children || [];
    for (var j = 0; j < children.length; j++) {
      if (children[j].key === key) return children[j].label;
    }
  }
  return null;
}

/**
 * 不可变地切换 selected 数组中的 key：存在则移除，不存在则追加。
 * 总是返回新数组，不修改原数组。
 *
 * @param {string[]} selected - 当前选中的 key 列表
 * @param {string}   key
 * @returns {string[]} 新数组
 */
function toggleFlavor(selected, key) {
  if (selected.indexOf(key) !== -1) {
    return selected.filter(function (k) { return k !== key; });
  } else {
    return selected.concat([key]);
  }
}

// --- 径向文字旋转角度（防止下半圆文字倒置）---
function radialDeg(midAngle) {
  var d = midAngle * 180 / Math.PI - 90;
  if (d > 90)  d -= 180;
  if (d < -90) d += 180;
  return d.toFixed(1);
}

// --- 圆盘状态 ---
var wheelSelectedKeys   = [];
var wheelActiveCategory = null;
var wheelOnDone         = null;

// --- 渲染 ---

/**
 * 在 container 元素内用 innerHTML 渲染双环 SVG 风味轮。
 *
 * 内环：全部大类，始终可见。
 * 外环：点击某个大类后，该大类的子风味在外环展开；再次点击同一大类或点中心圆则收起。
 *
 * @param {Element}  container   - #wheel-svg-container
 * @param {string[]} selectedKeys - 当前已选子风味 key 列表
 */
function renderWheel(container, selectedKeys) {
  var size = Math.min(
    container.clientWidth  || 320,
    container.clientHeight || 320,
    440
  );
  var cx = size / 2;
  var cy = size / 2;

  // 内环：大类
  var innerR1 = size * 0.14;   // 内环内径（= 中心圆半径）
  var innerR2 = size * 0.29;   // 内环外径

  // 外环：子风味（点击大类后展开）
  var outerR1 = size * 0.315;  // 外环内径（留 ~2.5% 间隙）
  var outerR2 = size * 0.47;   // 外环外径

  var centerR    = innerR1;
  var fontSzIn   = (size * 0.034).toFixed(1);  // 内环标签
  var fontSzOut  = (size * 0.031).toFixed(1);  // 外环标签
  var fontSzCtr  = (size * 0.028).toFixed(1);  // 中心文字

  var fw = (typeof FLAVOR_WHEEL !== "undefined") ? FLAVOR_WHEEL : [];
  var n  = fw.length;
  var step = (2 * Math.PI) / (n || 1);

  var svgParts = [
    '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '" xmlns="http://www.w3.org/2000/svg">',
    '<g transform="translate(' + cx + ',' + cy + ')">'
  ];

  // 预建选中 key 的快查集合
  var selectedSet = {};
  for (var si = 0; si < selectedKeys.length; si++) selectedSet[selectedKeys[si]] = true;

  // ===== 内环：大类 =====
  for (var i = 0; i < n; i++) {
    var cat    = fw[i];
    var startA = i * step;
    var endA   = (i + 1) * step;
    var isActive = (wheelActiveCategory === cat.key);

    // 判断该大类是否有已选的子风味（用于显示指示点）
    var hasSelected = false;
    var ch0 = cat.children || [];
    for (var ci0 = 0; ci0 < ch0.length; ci0++) {
      if (selectedSet[ch0[ci0].key]) { hasSelected = true; break; }
    }

    var d = buildSectorPath(startA, endA, innerR1, innerR2);
    var opacity  = (wheelActiveCategory === null || isActive) ? "1" : "0.55";
    var strokeCl = isActive ? "#333" : "var(--paper)";
    var strokeWt = isActive ? "2" : "1.5";

    svgParts.push(
      '<path d="' + d + '" fill="' + cat.color + '" opacity="' + opacity + '"' +
      ' stroke="' + strokeCl + '" stroke-width="' + strokeWt + '"' +
      ' style="cursor:pointer" data-cat="' + cat.key + '"/>'
    );

    // 大类标签（沿半径方向排列，防止重叠）
    var midA  = (startA + endA) / 2;
    var textR = (innerR1 + innerR2) / 2;
    var tx = (textR * Math.sin(midA)).toFixed(2);
    var ty = (-textR * Math.cos(midA)).toFixed(2);

    svgParts.push(
      '<text transform="translate(' + tx + ',' + ty + ') rotate(' + radialDeg(midA) + ')"' +
      ' text-anchor="middle" dominant-baseline="middle"' +
      ' font-size="' + fontSzIn + '" fill="#1a1a1a" pointer-events="none"' +
      ' style="user-select:none;font-weight:' + (isActive ? "700" : "600") + ';">' +
      cat.label + '</text>'
    );

    // 已选子风味指示点（内环外缘）
    if (hasSelected) {
      var dotR = innerR2 * 0.90;
      var dotX = (dotR * Math.sin(midA)).toFixed(2);
      var dotY = (-dotR * Math.cos(midA)).toFixed(2);
      svgParts.push(
        '<circle cx="' + dotX + '" cy="' + dotY + '" r="' + (size * 0.011).toFixed(1) + '"' +
        ' fill="#1a1a1a" opacity="0.65" pointer-events="none"/>'
      );
    }
  }

  // ===== 外环：选中大类的子风味 =====
  var activeCatObj = null;
  for (var ac = 0; ac < n; ac++) {
    if (fw[ac].key === wheelActiveCategory) { activeCatObj = fw[ac]; break; }
  }

  if (activeCatObj) {
    var children = activeCatObj.children || [];
    var nc       = children.length;

    // 找到激活大类在内环中的起止角度，外环只在该扇形范围内展开
    var activeCatIdx = 0;
    for (var ai = 0; ai < n; ai++) {
      if (fw[ai].key === wheelActiveCategory) { activeCatIdx = ai; break; }
    }
    var catStartA = activeCatIdx * step;
    var stepC     = step / (nc || 1);   // step = 大类扇角 = 2π/n

    for (var j = 0; j < nc; j++) {
      var child   = children[j];
      var startAC = catStartA + j * stepC;
      var endAC   = catStartA + (j + 1) * stepC;
      var dc      = buildSectorPath(startAC, endAC, outerR1, outerR2);
      var isSelected = selectedKeys.indexOf(child.key) !== -1;

      svgParts.push(
        '<path d="' + dc + '" fill="' + activeCatObj.color + '"' +
        (isSelected
          ? ' stroke="#333" stroke-width="2.5"'
          : ' stroke="var(--paper)" stroke-width="1.5"') +
        ' opacity="' + (isSelected ? "1" : "0.78") + '"' +
        ' style="cursor:pointer" data-flavor="' + child.key + '"/>'
      );

      // 子风味标签（沿半径方向排列；勾选符直接拼入标签）
      var midAC  = (startAC + endAC) / 2;
      var textRC = (outerR1 + outerR2) / 2;
      var txc = (textRC * Math.sin(midAC)).toFixed(2);
      var tyc = (-textRC * Math.cos(midAC)).toFixed(2);
      var displayLabel = (isSelected ? "✓ " : "") + child.label;

      svgParts.push(
        '<text transform="translate(' + txc + ',' + tyc + ') rotate(' + radialDeg(midAC) + ')"' +
        ' text-anchor="middle" dominant-baseline="middle"' +
        ' font-size="' + fontSzOut + '" fill="#1a1a1a" pointer-events="none"' +
        ' style="user-select:none;font-weight:' + (isSelected ? "700" : "400") + ';">' +
        displayLabel + '</text>'
      );
    }
  }

  // ===== 中心圆 =====
  var centerFill   = activeCatObj ? activeCatObj.color : "var(--paper)";
  var centerOpacity = activeCatObj ? "0.3" : "1";
  var centerStroke = activeCatObj ? activeCatObj.color : "var(--border)";
  var centerClickAttr = activeCatObj ? ' style="cursor:pointer" data-center-back="1"' : '';

  svgParts.push(
    '<circle r="' + centerR + '" fill="' + centerFill + '" opacity="' + centerOpacity + '"' +
    ' stroke="' + centerStroke + '" stroke-width="1"' + centerClickAttr + '/>'
  );
  svgParts.push(
    '<text x="0" y="0" text-anchor="middle" dominant-baseline="middle"' +
    ' font-size="' + fontSzCtr + '" fill="' + (activeCatObj ? "var(--fg)" : "var(--fg-muted)") + '"' +
    ' pointer-events="none"' +
    ' style="user-select:none;font-weight:' + (activeCatObj ? "600" : "400") + ';">' +
    (activeCatObj ? activeCatObj.label : "点击选择") + '</text>'
  );

  svgParts.push("</g></svg>");
  container.innerHTML = svgParts.join("\n");

  // ===== 事件绑定 =====
  var svg = container.querySelector("svg");
  if (!svg) return;

  svg.addEventListener("click", function (e) {
    var target = e.target;

    // 中心圆 → 收起外环
    if (target.dataset && target.dataset.centerBack) {
      wheelActiveCategory = null;
      var backBtn = document.querySelector("#wheel-back-btn");
      if (backBtn) backBtn.style.display = "none";
      renderWheel(container, wheelSelectedKeys);
      return;
    }

    // 内环大类点击：同一大类再次点击 → 收起；不同大类 → 展开新外环
    if (target.dataset && target.dataset.cat) {
      var newCat = target.dataset.cat;
      if (wheelActiveCategory === newCat) {
        wheelActiveCategory = null;
        var bb = document.querySelector("#wheel-back-btn");
        if (bb) bb.style.display = "none";
      } else {
        wheelActiveCategory = newCat;
        var bb2 = document.querySelector("#wheel-back-btn");
        if (bb2) bb2.style.display = "";
      }
      renderWheel(container, wheelSelectedKeys);
      return;
    }

    // 外环子风味点击 → 切换选中
    if (target.dataset && target.dataset.flavor) {
      wheelSelectedKeys = toggleFlavor(wheelSelectedKeys, target.dataset.flavor);
      var hint = document.querySelector("#wheel-hint");
      if (hint) {
        hint.textContent = wheelSelectedKeys.length > 6
          ? "杯测一般记 3~5 个主风味就够，太多反而抓不住重点"
          : "";
      }
      renderWheel(container, wheelSelectedKeys);
      return;
    }
  });
}

// --- 事件绑定（只在 DOM 加载后执行一次，Node 环境跳过） ---
if (typeof document !== "undefined") document.addEventListener("DOMContentLoaded", function () {
  var backBtn   = document.querySelector("#wheel-back-btn");
  var doneBtn   = document.querySelector("#wheel-done-btn");
  var closeBtn  = document.querySelector("#wheel-close-btn");
  var container = document.querySelector("#wheel-svg-container");

  if (backBtn) {
    backBtn.addEventListener("click", function () {
      wheelActiveCategory = null;
      backBtn.style.display = "none";
      if (container) renderWheel(container, wheelSelectedKeys);
    });
  }

  if (doneBtn) {
    doneBtn.addEventListener("click", function () {
      var dialog = document.querySelector("#wheel-dialog");
      if (dialog) dialog.close();
      if (wheelOnDone) wheelOnDone([].concat(wheelSelectedKeys));
    });
  }

  if (closeBtn) {
    closeBtn.addEventListener("click", function () {
      var dialog = document.querySelector("#wheel-dialog");
      if (dialog) dialog.close();
    });
  }
});

// --- 公开入口 ---

/**
 * 打开风味轮弹窗。
 *
 * @param {string[]} currentSelected - 当前已选 key 列表（会被复制，不影响原数组）
 * @param {Function} onDone          - 完成回调，参数为最终选中的 key 列表
 */
function openWheelDialog(currentSelected, onDone) {
  wheelSelectedKeys   = [].concat(currentSelected || []);
  wheelActiveCategory = null;
  wheelOnDone         = onDone || null;

  var dialog    = document.querySelector("#wheel-dialog");
  var container = document.querySelector("#wheel-svg-container");
  var backBtn   = document.querySelector("#wheel-back-btn");
  var hint      = document.querySelector("#wheel-hint");

  if (backBtn) backBtn.style.display = "none";
  if (hint)    hint.textContent = "";

  if (container) renderWheel(container, wheelSelectedKeys);
  if (dialog)    dialog.showModal();
}

// --- CommonJS 导出（供 node --test 使用） ---
if (typeof module !== "undefined") {
  module.exports = { buildSectorPath, flavorKeyToLabel, toggleFlavor };
}
