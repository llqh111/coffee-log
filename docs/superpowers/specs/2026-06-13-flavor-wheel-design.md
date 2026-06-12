# 风味轮（咖啡风味轮）功能 · 设计文档

- 日期：2026-06-13
- 状态：已确认，待写实现计划
- 范围：**只做风味轮记录**。"从手冲扩展到所有咖啡"另起一轮，不在本设计内。

---

## 1. 背景与定位

现在"记录一杯"里描述味道的字段有两个：

- ✍️ **风味笔记**（自由文字）：能写细腻描述，但没法统计。
- ⚠️ **这杯哪里不对**（`tasteIssues`，负向诊断）：勾"发酸/发苦…"，给"下次怎么调"的方向。

缺一块**正向、结构化**的记录——"这杯好喝在哪"。本功能补上这块：照 **SCA（美国精品咖啡协会）官方咖啡风味轮**，让用户可选地给每杯打上风味标签。

三者分工，互补不替代：

| 字段 | 性质 | 作用 |
|---|---|---|
| 🎡 风味轮（本次新增，`flavors`） | 正向 · 结构化 | "好喝在哪"，可统计 |
| ✍️ 风味笔记（保留，`notes`） | 正向 · 自由文字 | 圆盘表达不了的细腻描述 |
| ⚠️ 哪里不对（保留，`tasteIssues`） | 负向 · 结构化 | "下次怎么调" |

---

## 2. 风味词库

- 依据 **SCA 官方风味轮**，做 **2 层**：内圈 9 大类 → 每类 5~8 个子风味，合计约 50~60 词。
- **中英对照**，沿用 SCA 标志配色。
- 写成代码里的 `FLAVOR_WHEEL` 常量（参照现有 `TASTE_ISSUES` 的写法），加减词、改配色、将来加第 3 层都只改这一处。
- **存 key 不存中文**：每条记录存子风味的英文 key 数组（如 `["berry","citrus"]`），显示时再查标签。改中文叫法/配色时，所有老记录自动跟着变，无需迁移数据（和现在 `tasteIssues` 存 `"sour"` 同理）。

### 2.1 词库初稿（实现时以此为准，可在代码里继续调整）

> 颜色为 SCA 风味轮各大类的代表色，最终取值在实现时由 frontend-design 微调以保证对比度与美观。

| 大类 key | 大类（中/英） | 代表色 | 子风味 key — 中/英 |
|---|---|---|---|
| `floral` | 花香 / Floral | 紫粉 | `black_tea` 红茶 / Black Tea，`chamomile` 洋甘菊 / Chamomile，`rose` 玫瑰 / Rose，`jasmine` 茉莉 / Jasmine，`osmanthus` 桂花 / Osmanthus |
| `fruity` | 果香 / Fruity | 红 | `berry` 莓果 / Berry，`dried_fruit` 干果 / Dried Fruit，`citrus` 柑橘 / Citrus，`stone_fruit` 核果 / Stone Fruit（桃李），`tropical` 热带水果 / Tropical，`apple_pear` 苹果梨 / Apple·Pear，`grape` 葡萄 / Grape |
| `sour_ferment` | 酸 / 发酵 — Sour / Fermented | 黄 | `sour` 酸香 / Sour，`winey` 酒香 / Winey，`fermented` 发酵 / Fermented，`overripe` 熟透 / Overripe |
| `green_veg` | 绿色 / 植物 — Green / Vegetative | 绿 | `vegetative` 植物 / Vegetative，`grassy` 青草 / Grassy，`herb` 草本 / Herb-like，`beany` 豆子 / Beany |
| `other` | 其他 / Other | 青蓝 | `papery` 纸质·陈旧 / Papery-Musty，`chemical` 化学 / Chemical，`pungent` 刺激 / Pungent，`rubber` 橡胶 / Rubber |
| `roasted` | 烘焙 / Roasted | 橙棕 | `cereal` 谷物 / Cereal，`burnt` 焦香 / Burnt，`tobacco` 烟草 / Tobacco，`smoky` 烟熏 / Smoky |
| `spices` | 香料 / Spices | 红棕 | `pungent_spice` 辛辣 / Pungent，`pepper` 胡椒 / Pepper，`brown_spice` 棕色香料 / Brown Spice（肉桂·丁香），`anise` 茴香 / Anise |
| `nutty_cocoa` | 坚果 / 可可 — Nutty / Cocoa | 棕 | `nutty` 坚果 / Nutty，`hazelnut` 榛子 / Hazelnut，`almond` 杏仁 / Almond，`cocoa` 可可 / Cocoa，`dark_chocolate` 黑巧克力 / Dark Chocolate |
| `sweet` | 甜 / Sweet | 橙金 | `caramel` 焦糖 / Caramel，`honey` 蜂蜜 / Honey，`brown_sugar` 红糖 / Brown Sugar，`vanilla` 香草 / Vanilla，`maple` 枫糖 / Maple Syrup，`overall_sweet` 整体甜感 / Overall Sweet |

约 51 个子风味，落在目标 50~60 区间。

---

## 3. 交互：钻取式 SVG 圆盘

### 3.1 入口
- "记录一杯"表单里，在「风味笔记」旁加一行 **「🎡 选风味」按钮**。
- 已选风味在表单内显示成一排 **SCA 配色小标签**（点标签上的 ✕ 可直接删，无需重开圆盘）。

### 3.2 圆盘弹出
- 点「🎡 选风味」→ **全屏 overlay 弹出**圆盘，复用现有计时器全屏 overlay 的体感（`role="dialog"` `aria-modal`）。
- 圆盘用 **SVG** 画成圆环扇形（donut sector）。

### 3.3 钻取流程
1. **初始**：显示内圈 **9 大类**，每瓣是一段圆环扇形，填 SCA 配色，瓣上写中文大类名。
2. **点一类** → 圆盘**聚焦/展开**该大类，露出它下面的子风味（每个子风味一个可点扇区，颜色为大类色的深浅变体）。
3. **点子风味** → 选中/取消（多选，选中态加描边或勾标记）。
4. **返回**：圆盘中心一个「← 返回大类」可层层退回。
5. **完成**：底部「完成」按钮回到表单，已选风味写入表单标签区。

### 3.4 多选与提示
- 不设硬上限。选到约 **6 个**时给一句温和提示（"杯测一般记 3~5 个主风味就够，太多反而抓不住重点"），不阻止继续选。

---

## 4. 显示

- **冲煮卡片**：已选风味显示为**带颜色圆点的小标签**，与"哪里不对"的灰色标签视觉区分，让人一眼分清"好喝在哪 vs 哪里不对"。
- **本轮不接入「找规律」分析**——留到下一轮，等记录积累后做"我喜欢的味道长这样"才不空洞。

---

## 5. 数据模型

每条 brew 记录新增一个字段：

```js
// brew 记录
{
  id, beanId, brewDate, doseGrams, waterGrams, /* …现有字段… */
  notes,            // 保留
  tasteIssues: [],  // 保留
  flavors: ["berry", "citrus", "caramel"],  // 新增：子风味 key 数组
  // …
}
```

- 老记录无 `flavors` → 读取时一律兜底 `[]`（和 `tasteIssues` 同样处理）。
- **同步 / 导出导入 / 墓碑：无需改动**。`merge.js` 按整条记录 id + `updatedAt` 取较新者（见 `merge.js:6-13`），新字段随记录自动同步。

---

## 6. 涉及文件

| 文件 | 改动 | 说明 |
|---|---|---|
| **`wheel.js`（新增）** | 圆盘几何计算 + 渲染 + 选择交互 | app.js 已 1584 行，按项目"多个小文件"习惯单独拆，和 `timer.js`/`share.js` 并列 |
| **`wheel.test.js`（新增）** | 测纯函数：扇区弧线 `path` 计算、key→标签解析、选/取消逻辑 | 沿用 `timer.test.js` 的 TDD 习惯 |
| `index.html`（改） | 表单加「🎡 选风味」按钮 + 已选标签容器；加全屏圆盘 overlay 骨架 | |
| `app.js`（改） | 定义 `FLAVOR_WHEEL`；保存/编辑时读写 `flavors`；卡片渲染风味标签 | |
| `style.css`（改） | 圆盘 + 风味标签样式 | |

- **UI 实现统一用 frontend-design 技能**，保证圆盘与标签有 SCA 风味轮的质感、不是默认 AI 味样式。

---

## 7. 测试要点

- **纯函数（单元测试，wheel.test.js）**
  - 圆环扇区路径：给定起止角度、内外半径 → 正确的 SVG `path d`（含跨 180° 的 large-arc 标志）。
  - key→标签解析：给一组 `flavors` key → 正确的中文标签与配色；含未知 key 时安全跳过。
  - 选择逻辑：选/取消的纯函数返回新数组，不可变（不改原数组）。
- **集成/手动**
  - 新记录选风味→保存→卡片显示正确标签。
  - 编辑旧记录（无 `flavors`）不报错，可补选。
  - 多设备同步后 `flavors` 不丢。
  - 圆盘在手机窄屏可点、可返回、可完成。

---

## 8. 本轮明确不做（YAGNI）

- 不接入「找规律」分析。
- 不做第 3 层细分风味。
- 不改分享图。
- 不碰"扩展到所有咖啡类型"。
