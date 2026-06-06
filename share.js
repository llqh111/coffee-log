/* =========================================================
   手冲手记 · 分享卡片生成（Canvas 画图 → 下载 / 分享）
   零依赖，纯浏览器 API
   ========================================================= */

// ---- 改水印文案改这里 ----
var SHARE_BRAND = '手冲手记 · 咖啡冲煮记录本';
var SHARE_URL   = 'https://llqh111.github.io/coffee-log/';

// 卡片尺寸（2x 高清输出，手机上看也清晰）
var CW = 750;
var CH = 1100;

// 配色（跟 style.css :root 一致）
var C = {
  paper:   '#efe6d6',
  ink:     '#2a1c12',
  soft:    '#6f5a48',
  line:    '#d8c8b0',
  accent:  '#b85c38',
  gold:    '#c08a3e',
};

// ---- Canvas 小工具 ----
function _wrapText(ctx, text, maxW) {
  var lines = [];
  var cur = '';
  for (var i = 0; i < text.length; i++) {
    var test = cur + text[i];
    if (ctx.measureText(test).width > maxW && cur.length > 0) {
      lines.push(cur);
      cur = text[i];
    } else { cur = test; }
  }
  if (cur) lines.push(cur);
  return lines;
}

function _roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

// ---- 主函数：在 Canvas 上画分享卡片 ----
function generateShareImage(bean, brew) {
  var scale = 2;
  var canvas = document.createElement('canvas');
  canvas.width  = CW * scale;
  canvas.height = CH * scale;
  var ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);

  /* ── 背景 ── */
  ctx.fillStyle = C.paper;
  ctx.fillRect(0, 0, CW, CH);

  // 纸张纹理
  ctx.fillStyle = 'rgba(42,28,18,0.025)';
  for (var i = 0; i < 300; i++) {
    ctx.fillRect(Math.random() * CW, Math.random() * CH, 1.8, 1.8);
  }

  /* ── 顶部深色区域 ── */
  var topH = 250;
  ctx.fillStyle = C.ink;
  ctx.fillRect(0, 0, CW, topH);

  // 小标签
  ctx.fillStyle = C.accent;
  ctx.font = 'bold 20px "PingFang SC","Noto Sans SC","Microsoft YaHei",sans-serif';
  ctx.fillText('☕ 最佳配方', 56, 54);

  // 豆名（长名字自动换行）
  ctx.fillStyle = C.paper;
  ctx.font = 'bold 46px "PingFang SC","Noto Sans SC","Microsoft YaHei",sans-serif';
  var nameLines = _wrapText(ctx, bean.name, CW - 200);
  nameLines.forEach(function (line, i) {
    ctx.fillText(line, 56, 110 + i * 52);
  });
  var nameBottom = 110 + (nameLines.length - 1) * 52;

  // 烘焙商
  ctx.fillStyle = C.line;
  ctx.font = '22px "PingFang SC","Noto Sans SC","Microsoft YaHei",sans-serif';
  ctx.fillText(bean.roaster || '', 56, nameBottom + 38);

  // 评分（右上角大字）
  var rating = brew.rating || '?';
  var rText = String(rating);
  ctx.fillStyle = C.gold;
  ctx.font = 'bold 80px "PingFang SC","Noto Sans SC","Microsoft YaHei",sans-serif';
  var rW = ctx.measureText(rText).width;
  ctx.fillText(rText, CW - 56 - rW - 58, 110);
  ctx.fillStyle = C.paper;
  ctx.font = '26px "PingFang SC","Noto Sans SC","Microsoft YaHei",sans-serif';
  ctx.fillText('/10', CW - 56 - 58 + rW + 10, 110);

  // 冲煮日期
  ctx.fillStyle = C.soft;
  ctx.font = '20px "PingFang SC","Noto Sans SC","Microsoft YaHei",sans-serif';
  ctx.fillText(brew.brewDate || '', CW - 56 - rW - 58, 170);

  // 标签 chips
  var chips = [bean.process, bean.origin, bean.roastLevel].filter(Boolean);
  var chipX = 56;
  var chipY = nameBottom + 78;
  chips.forEach(function (t) {
    var tw = ctx.measureText(t).width + 28;
    ctx.fillStyle = 'rgba(239,230,214,0.16)';
    _roundRect(ctx, chipX, chipY - 18, tw, 32, 16);
    ctx.fill();
    ctx.fillStyle = C.paper;
    ctx.font = '18px "PingFang SC","Noto Sans SC","Microsoft YaHei",sans-serif';
    ctx.fillText(t, chipX + 14, chipY + 4);
    chipX += tw + 12;
  });

  /* ── 参数网格（两列）── */
  var gridY = topH + 42;
  var col1X = 56;
  var col2X = CW / 2 + 20;
  var rowH = 76;

  var params = [
    { k: '粉量',   v: brew.doseGrams            ? brew.doseGrams + 'g'                         : '—' },
    { k: '水量',   v: brew.waterGrams            ? brew.waterGrams + 'g'                        : '—' },
    { k: '粉水比', v: ratioText(brew.doseGrams, brew.waterGrams) },
    { k: '水温',   v: brew.waterTemp             ? brew.waterTemp + '°C'                        : '—' },
    { k: '研磨度', v: brew.grind                 || '—' },
    { k: '器具',   v: brew.gear                  || '—' },
  ];

  var bloomStr = '—';
  if (brew.bloomWater || brew.bloomTime) {
    bloomStr = (brew.bloomWater || '?') + 'g / ' + (brew.bloomTime || '?') + 's';
  }
  params.push({ k: '闷蒸', v: bloomStr });
  params.push({ k: '总时间', v: brew.totalTime || '—' });

  params.forEach(function (p, i) {
    var col = i % 2;
    var row = Math.floor(i / 2);
    var px = col === 0 ? col1X : col2X;
    var py = gridY + row * rowH;

    ctx.fillStyle = C.soft;
    ctx.font = '19px "PingFang SC","Noto Sans SC","Microsoft YaHei",sans-serif';
    ctx.fillText(p.k, px, py + 20);
    ctx.fillStyle = C.ink;
    ctx.font = 'bold 28px "PingFang SC","Noto Sans SC","Microsoft YaHei",sans-serif';
    ctx.fillText(p.v, px, py + 54);
  });

  /* ── 分隔线 ── */
  var sepY = gridY + Math.ceil(params.length / 2) * rowH + 32;
  ctx.strokeStyle = C.line;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(56, sepY);
  ctx.lineTo(CW - 56, sepY);
  ctx.stroke();

  /* ── 养豆天数 + 累计冲煮 ── */
  var rest = restDays(bean.roastDate, brew.brewDate);
  var totalBrews = brewsOfBean(bean.id).length;
  var statsY = sepY + 48;

  ctx.fillStyle = C.soft;
  ctx.font = '19px "PingFang SC","Noto Sans SC","Microsoft YaHei",sans-serif';
  ctx.fillText('养豆天数', col1X, statsY);
  ctx.fillStyle = C.ink;
  ctx.font = 'bold 32px "PingFang SC","Noto Sans SC","Microsoft YaHei",sans-serif';
  ctx.fillText(rest != null ? String(rest) + ' 天' : '—', col1X, statsY + 38);

  ctx.fillStyle = C.soft;
  ctx.font = '19px "PingFang SC","Noto Sans SC","Microsoft YaHei",sans-serif';
  ctx.fillText('累计冲煮', col2X, statsY);
  ctx.fillStyle = C.ink;
  ctx.font = 'bold 32px "PingFang SC","Noto Sans SC","Microsoft YaHei",sans-serif';
  ctx.fillText(String(totalBrews) + ' 杯', col2X, statsY + 38);

  /* ── 风味笔记 ── */
  var noteY = statsY + 80;
  if (brew.notes) {
    ctx.fillStyle = C.soft;
    ctx.font = '19px "PingFang SC","Noto Sans SC","Microsoft YaHei",sans-serif';
    ctx.fillText('风味笔记', 56, noteY);

    ctx.fillStyle = C.ink;
    ctx.font = 'italic 24px "PingFang SC","Noto Sans SC","Microsoft YaHei",sans-serif';
    var noteLines = _wrapText(ctx, '"' + brew.notes + '"', CW - 112);
    noteLines.forEach(function (line, i) {
      ctx.fillText(line, 56, noteY + 38 + i * 34);
    });
    noteY += noteLines.length * 34 + 16;
  }

  /* ── 底部水印（核心：别人转发出图 = 帮你宣传）── */
  var wmY = CH - 60;
  ctx.strokeStyle = C.line;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(56, wmY - 36);
  ctx.lineTo(CW - 56, wmY - 36);
  ctx.stroke();

  ctx.fillStyle = C.soft;
  ctx.textAlign = 'center';
  ctx.font = '21px "PingFang SC","Noto Sans SC","Microsoft YaHei",sans-serif';
  ctx.fillText(SHARE_BRAND, CW / 2, wmY);
  ctx.font = '17px "PingFang SC","Noto Sans SC","Microsoft YaHei",sans-serif';
  ctx.fillText(SHARE_URL, CW / 2, wmY + 28);
  ctx.textAlign = 'left';

  return canvas;
}

/* =========================================================
   保存 / 分享 —— 底层工具（已写好，可直接用）
   ========================================================= */

// 粗略识别移动端（含微信内置浏览器 MicroMessenger）
function isMobile() {
  var ua = navigator.userAgent || '';
  return /Android|iPhone|iPad|iPod|HarmonyOS|MicroMessenger/i.test(ua);
}

// 触发桌面下载（手机上 a.download 多半无效，仅桌面/兜底用）
function triggerDownload(blob, filename) {
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
}

// 调系统分享面板：返回 Promise
//   成功 resolve；不支持或用户取消会 reject（取消时 err.name === 'AbortError'）
function shareImageFile(blob) {
  if (!navigator.canShare) return Promise.reject(new Error('unsupported'));
  var file = new File([blob], 'coffee-best-recipe.png', { type: 'image/png' });
  if (!navigator.canShare({ files: [file] })) return Promise.reject(new Error('unsupported'));
  return navigator.share({ files: [file], title: '☕ 我的最佳配方' });
}

// 让预览框脉冲高亮一下，配合「长按保存」的引导
function pulsePreview(img) {
  if (!img) return;
  var target = img.closest('.share-preview-wrap') || img;
  target.classList.remove('pulse-hint');
  void target.offsetWidth; // 强制回流，重启动画
  target.classList.add('pulse-hint');
}

/* ── 点「保存 / 分享」时怎么走（三层降级）── 整个功能的灵魂 ──
   可用的工具：
     isMobile()                         -> true=手机, false=桌面
     shareImageFile(blob)               -> Promise；成功=分享成功，reject=不支持/取消
     triggerDownload(blob, '名字.png')    -> 桌面下载（别拿它当手机主路径）
     showToast('文字', 'success')        -> 右上角提示（第二参传 'success' 是绿色成功样式）
     pulsePreview(previewImg)            -> 预览图脉冲高亮
   reject 出来的 err：err && err.name === 'AbortError' 表示用户自己点了取消，不算失败、别再降级。

   推荐策略（你也可以按自己的想法调）：
     ① 先 shareImageFile(blob) —— .then 成功就结束
     ② .catch 里：先判断是不是用户取消(AbortError) -> 是就直接 return，什么都不做
     ③ 不是取消（说明不支持/失败）：桌面 -> triggerDownload + showToast('已保存到下载文件夹','success')
     ④                              手机 -> showToast('长按上方图片即可保存到相册') + pulsePreview(previewImg)
*/
function handleSaveOrShare(blob, previewImg) {
  // ① 首选：系统分享面板（微信/小红书可直接选）
  shareImageFile(blob).catch(function (err) {
    // ② 用户主动取消 → 静默结束，不算失败、不降级
    if (err && err.name === 'AbortError') return;
    // ③ 不支持 / 真失败 → 按平台降级
    if (isMobile()) {
      // 手机：a.download 多半无效，引导长按存图（最可靠）
      showToast('长按上方图片即可保存到相册');
      pulsePreview(previewImg);
    } else {
      // 桌面：直接下载 PNG
      triggerDownload(blob, 'coffee-best-recipe.png');
      showToast('已保存到下载文件夹', 'success');
    }
  });
}

/* ── 弹出分享对话框 ── */
function showShareDialog(bean, brew) {
  // 移除已有弹窗
  var old = document.getElementById('share-dialog');
  if (old) old.remove();

  var canvas = generateShareImage(bean, brew);

  var dialog = document.createElement('dialog');
  dialog.id = 'share-dialog';
  dialog.className = 'dialog share-dialog';
  dialog.innerHTML =
    '<div class="share-inner">' +
      '<h3 class="dialog-title">📷 分享最佳配方</h3>' +
      '<p class="share-hint">' + (isMobile()
        ? '长按图片即可保存到相册，或点下方按钮分享'
        : '点下方按钮下载图片，或右键图片另存为') + '</p>' +
      '<div class="share-preview-wrap">' +
        '<img class="share-preview" id="share-preview-img" src="' + canvas.toDataURL('image/png') + '" alt="最佳配方卡片" />' +
      '</div>' +
      '<div class="share-actions">' +
        '<button class="btn btn-solid" id="btn-share-dl">' + (isMobile() ? '📤 分享 / 保存' : '💾 下载图片') + '</button>' +
        '<button class="btn btn-ghost" data-close-share>关闭</button>' +
      '</div>' +
    '</div>';

  document.body.appendChild(dialog);

  // 关闭
  function closeShare() { animateDialogClose(dialog, function () { dialog.remove(); }); }
  dialog.querySelector('[data-close-share]').addEventListener('click', closeShare);
  dialog.addEventListener('click', function (e) { if (e.target === dialog) closeShare(); });

  // 保存 / 分享按钮 → 交给三层降级决策（见 handleSaveOrShare）
  var previewImg = dialog.querySelector('#share-preview-img');
  dialog.querySelector('#btn-share-dl').addEventListener('click', function () {
    canvas.toBlob(function (blob) {
      if (!blob) { showToast('图片生成失败，请重试'); return; }
      handleSaveOrShare(blob, previewImg);
    }, 'image/png');
  });

  animateDialogOpen(dialog);
}
