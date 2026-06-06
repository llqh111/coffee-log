# 分享卡片「保存/分享」按钮健壮性优化

日期：2026-06-06
范围：`share.js`（`showShareDialog` 的保存逻辑）+ `style.css`（预览图样式）

## 背景与问题

分享卡片本身（Canvas 绘图）能正常生成，但「保存 / 分享」按钮在手机端（主战场：微信 / 小红书）经常「点了没反应」。根因有三：

1. **微信内置浏览器里 `navigator.share` 通常为 undefined** → 掉进 `a.download` 下载分支 → 但手机端 `a.download` 对 blob 图片基本无效（点击无反应或仅打开新标签）。
2. `.catch(function(){})` **吞掉了所有错误**，真失败时用户看不到任何反馈。
3. 手机端最可靠的存图方式是**长按图片 → 保存到相册**，但当前只有一行不显眼的小字提示，没有主动引导。

目标分享场景：手机社交（微信 / 小红书），竖图为主。

## 方案：三层优雅降级（graceful degradation）

每条路径都有可见反馈（复用现成的 `showToast(message, type)`，见 `app.js:89`）：

| 层级 | 触发条件 | 行为 |
|---|---|---|
| ① 首选 | `navigator.canShare({ files })` 为真 | 调系统分享面板（微信/小红书可直接选） |
| ② 次选 | 不支持分享 + 桌面端 | 真·下载 PNG（桌面 `a.download` 有效），toast 提示已保存 |
| ③ 保底 | 手机但分享不可用（如微信内置浏览器） | toast 引导「长按上方图片保存到相册」，预览图脉冲高亮 |

### 行为细则

- **用户主动取消分享**（`AbortError` / `NotAllowedError`）→ 静默忽略，不算失败、不降级。
- **分享真失败**（其它异常）→ 降级到 ②/③ 并提示。
- 平台判断：用一个简单的 `isMobile()`（基于 `navigator.userAgent` 粗判 Android/iPhone/iPad/微信）决定走 ② 还是 ③，以及按钮文案。
- 预览 `<img>` 必须可长按保存：CSS 不能设 `-webkit-touch-callout: none`；显式允许 `-webkit-touch-callout: default` 并加圆角脉冲反馈类。

### 受影响代码单元

- `showShareDialog` 内的「保存/分享按钮」点击回调：拆成清晰的 `handleSaveOrShare(blob, isMobileDevice)` 决策函数，分支明确、可单独读懂。
- 新增小工具 `isMobile()`、`triggerDownload(blob, filename)`。
- `style.css` 的 `.share-preview` 增加可长按 + `.pulse-hint` 反馈。

## 不做（YAGNI）

- 不改卡片本身的排版/配色（用户未反馈此痛点）。
- 不引入第三方库（保持零依赖）。
- 不做卡片高度自适应（本次聚焦按钮可用性；排版问题留待后续）。

## 验证

- 本地：Chrome 移动模拟跑通弹窗渲染 + 三个分支不报错 + 长按提示出现。
- 真机：交付一份自查清单，用户部署后用手机开 GitHub Pages 链接对照确认微信/小红书实际行为。
