/* wheel.js 纯函数契约测试
   运行：node --test wheel.test.js */

const { test } = require("node:test");
const assert = require("node:assert");

const { buildSectorPath, flavorKeyToLabel, toggleFlavor } = require("./wheel.js");

// 测试用小型 flavorWheel 数据
const MINI_WHEEL = [
  { key: "fruity", label: "果香", color: "#F87171", children: [
    { key: "berry",  label: "莓果" },
    { key: "citrus", label: "柑橘" },
  ]},
  { key: "sweet", label: "甜", color: "#F59E0B", children: [
    { key: "caramel", label: "焦糖" },
  ]},
];

// ===== buildSectorPath =====

test("buildSectorPath：返回字符串，以 M 开头、以 Z 结尾", () => {
  var d = buildSectorPath(0, Math.PI / 2, 40, 80);
  assert.strictEqual(typeof d, "string", "返回值应为字符串");
  assert.ok(d.startsWith("M"), "路径应以 M 开头，实际：" + d.slice(0, 4));
  assert.ok(d.endsWith("Z"), "路径应以 Z 结尾，实际：" + d.slice(-4));
});

test("buildSectorPath：小扇区（90° = π/2）large-arc-flag 为 0", () => {
  var d = buildSectorPath(0, Math.PI / 2, 40, 80);
  // SVG arc 格式：A rx ry x-rotation large-arc-flag sweep-flag x y
  // 用正则捕获第一个 A 命令里的 large-arc-flag（第 4 个数字参数）
  var match = d.match(/A[\d. ]+ (0|1) (0|1)/);
  assert.ok(match, "路径中应含 A 弧线命令");
  assert.strictEqual(match[1], "0", "小扇区 large-arc-flag 应为 0，实际：" + match[1]);
});

test("buildSectorPath：大扇区（270° = 3π/2）large-arc-flag 为 1", () => {
  var d = buildSectorPath(0, 3 * Math.PI / 2, 40, 80);
  var match = d.match(/A[\d. ]+ (0|1) (0|1)/);
  assert.ok(match, "路径中应含 A 弧线命令");
  assert.strictEqual(match[1], "1", "大扇区 large-arc-flag 应为 1，实际：" + match[1]);
});

test("buildSectorPath：恰好 π（180°）时 large-arc-flag 为 0（边界不含等号）", () => {
  // endAngle - startAngle === Math.PI，规则是严格 > π 才为 1，等于 π 应为 0
  var d = buildSectorPath(0, Math.PI, 40, 80);
  var match = d.match(/A[\d. ]+ (0|1) (0|1)/);
  assert.ok(match, "路径中应含 A 弧线命令");
  assert.strictEqual(match[1], "0", "恰好 π 时 large-arc-flag 应为 0，实际：" + match[1]);
});

test("buildSectorPath：内外半径均为 0 时不崩溃，返回字符串", () => {
  var d;
  assert.doesNotThrow(() => { d = buildSectorPath(0, Math.PI / 4, 0, 0); });
  assert.strictEqual(typeof d, "string", "r=0 时也应返回字符串");
});

test("buildSectorPath：不同 startAngle 偏移后路径字符串不同", () => {
  var d1 = buildSectorPath(0,           Math.PI / 2, 40, 80);
  var d2 = buildSectorPath(Math.PI / 2, Math.PI,     40, 80);
  assert.notStrictEqual(d1, d2, "不同 startAngle 应产生不同路径");
});

// ===== flavorKeyToLabel =====

test("flavorKeyToLabel：已知 key 'berry' → 返回 '莓果'", () => {
  assert.strictEqual(flavorKeyToLabel("berry", MINI_WHEEL), "莓果");
});

test("flavorKeyToLabel：已知 key 'citrus' → 返回 '柑橘'", () => {
  assert.strictEqual(flavorKeyToLabel("citrus", MINI_WHEEL), "柑橘");
});

test("flavorKeyToLabel：已知 key 'caramel'（跨分类）→ 返回 '焦糖'", () => {
  assert.strictEqual(flavorKeyToLabel("caramel", MINI_WHEEL), "焦糖");
});

test("flavorKeyToLabel：未知 key → 返回 null，不抛错", () => {
  var result;
  assert.doesNotThrow(() => { result = flavorKeyToLabel("unknown_xyz", MINI_WHEEL); });
  assert.strictEqual(result, null, "未知 key 应返回 null，实际：" + result);
});

test("flavorKeyToLabel：空字符串 key → 返回 null", () => {
  var result = flavorKeyToLabel("", MINI_WHEEL);
  assert.strictEqual(result, null, "空字符串 key 应返回 null，实际：" + result);
});

test("flavorKeyToLabel：传入空 wheel 数组 → 返回 null", () => {
  var result = flavorKeyToLabel("berry", []);
  assert.strictEqual(result, null, "空 wheel 时应返回 null，实际：" + result);
});

// ===== toggleFlavor =====

test("toggleFlavor：空数组选中 'berry' → ['berry']", () => {
  var result = toggleFlavor([], "berry");
  assert.deepStrictEqual(result, ["berry"], "实际：" + JSON.stringify(result));
});

test("toggleFlavor：['berry'] 再选 'citrus' → ['berry', 'citrus']（顺序保持）", () => {
  var result = toggleFlavor(["berry"], "citrus");
  assert.deepStrictEqual(result, ["berry", "citrus"], "实际：" + JSON.stringify(result));
});

test("toggleFlavor：['berry', 'citrus'] 取消 'berry' → ['citrus']", () => {
  var result = toggleFlavor(["berry", "citrus"], "berry");
  assert.deepStrictEqual(result, ["citrus"], "实际：" + JSON.stringify(result));
});

test("toggleFlavor：['berry', 'citrus'] 取消 'citrus'（末尾）→ ['berry']", () => {
  var result = toggleFlavor(["berry", "citrus"], "citrus");
  assert.deepStrictEqual(result, ["berry"], "实际：" + JSON.stringify(result));
});

test("toggleFlavor：不可变验证——原数组长度不变", () => {
  var original = ["berry", "citrus"];
  var lenBefore = original.length;
  toggleFlavor(original, "berry");    // 取消 berry
  toggleFlavor(original, "caramel"); // 新增 caramel
  assert.strictEqual(original.length, lenBefore, "原数组不应被修改，长度应仍为 " + lenBefore);
});

test("toggleFlavor：不可变验证——返回新数组引用", () => {
  var original = ["berry"];
  var result = toggleFlavor(original, "citrus");
  assert.notStrictEqual(result, original, "返回值应是新数组，不是原数组的同一引用");
});

test("toggleFlavor：不在 selected 里的 key → 加入后返回新数组（非同一引用）", () => {
  var original = ["berry", "citrus"];
  var result = toggleFlavor(original, "nonexistent_key");
  assert.deepStrictEqual(result, ["berry", "citrus", "nonexistent_key"], "toggle 不在 selected 里的 key 应追加，实际：" + JSON.stringify(result));
  assert.notStrictEqual(result, original, "返回值应是新数组，不是原数组的同一引用");
});

test("toggleFlavor：多次 toggle 同一 key 结果对称（选→消→选）", () => {
  var s0 = [];
  var s1 = toggleFlavor(s0, "berry");  // ["berry"]
  var s2 = toggleFlavor(s1, "berry");  // []
  var s3 = toggleFlavor(s2, "berry");  // ["berry"]
  assert.deepStrictEqual(s1, ["berry"], "第一次添加");
  assert.deepStrictEqual(s2, [],        "第二次移除");
  assert.deepStrictEqual(s3, ["berry"], "第三次再添加");
});
