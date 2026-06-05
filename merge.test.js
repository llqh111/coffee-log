const { test } = require("node:test");
const assert = require("node:assert");
const { mergeState } = require("./merge.js");

const S = (beans = [], brews = [], tombstones = { beans: {}, brews: {} }) => ({
  version: 1, beans, brews, tombstones,
});

test("只有一边有的记录会被保留", () => {
  const a = S([{ id: "x", updatedAt: 1 }]);
  const b = S([{ id: "y", updatedAt: 1 }]);
  const out = mergeState(a, b);
  assert.deepStrictEqual(out.beans.map((r) => r.id).sort(), ["x", "y"]);
});

test("同 id 取 updatedAt 较新的那条", () => {
  const a = S([{ id: "x", updatedAt: 1, note: "旧" }]);
  const b = S([{ id: "x", updatedAt: 2, note: "新" }]);
  const out = mergeState(a, b);
  assert.strictEqual(out.beans.length, 1);
  assert.strictEqual(out.beans[0].note, "新");
});

test("墓碑删除时间晚于记录修改时间 → 记录被删掉", () => {
  const a = S([{ id: "x", updatedAt: 5 }]);
  const b = S([], [], { beans: { x: 9 }, brews: {} });
  const out = mergeState(a, b);
  assert.strictEqual(out.beans.length, 0);
});

test("删除后又编辑（updatedAt 晚于删除时间）→ 记录复活保留", () => {
  const a = S([{ id: "x", updatedAt: 12 }]);
  const b = S([], [], { beans: { x: 9 }, brews: {} });
  const out = mergeState(a, b);
  assert.strictEqual(out.beans.length, 1);
});

test("墓碑合并取较晚的删除时间", () => {
  const a = S([], [], { beans: { x: 3 }, brews: {} });
  const b = S([], [], { beans: { x: 8 }, brews: {} });
  const out = mergeState(a, b);
  assert.strictEqual(out.tombstones.beans.x, 8);
});

test("空数据 / 缺 tombstones 字段不报错", () => {
  const out = mergeState({ beans: [], brews: [] }, { beans: [], brews: [] });
  assert.deepStrictEqual(out.beans, []);
  assert.deepStrictEqual(out.tombstones, { beans: {}, brews: {} });
});

test("brews 同样按规则合并", () => {
  const a = S([], [{ id: "b1", updatedAt: 1 }]);
  const b = S([], [{ id: "b1", updatedAt: 4, score: 9 }]);
  const out = mergeState(a, b);
  assert.strictEqual(out.brews[0].score, 9);
});

test("删除时间正好等于记录修改时间 → 记录被删掉（删除胜出）", () => {
  const a = S([{ id: "x", updatedAt: 9 }]);
  const b = S([], [], { beans: { x: 9 }, brews: {} });
  const out = mergeState(a, b);
  assert.strictEqual(out.beans.length, 0);
});
