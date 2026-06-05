/* 计时器核心纯函数测试：buildResult(timestamps)
   输入：按时间顺序排列的 [{label, sec}]，sec 是累计秒。
        正常情况下最后一项是停止，但输入也可能缺失停止项。
   输出：{ totalSec, bloomSec, stages }
         bloomSec = 第一段 label 含 "闷蒸" 时的 sec，否则 null
         stages = 原样返回（去掉了停止那一项） */

const { test } = require("node:test");
const assert = require("node:assert");

// ========== 被测试的函数（内联实现） ==========

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

// ========== 正常流程 ==========

test("闷蒸 + 一段注水 → 两段", () => {
  var r = buildResult([
    { label: "闷蒸", sec: 32 },
    { label: "停止", sec: 150 },
  ]);
  assert.strictEqual(r.totalSec, 150, "totalSec 应为 150，实际 " + r.totalSec);
  assert.strictEqual(r.bloomSec, 32, "bloomSec 应为 32，实际 " + r.bloomSec);
  assert.strictEqual(r.stages.length, 1, "stages 应有 1 段（去掉停止），实际 " + r.stages.length);
  assert.strictEqual(r.stages[0].label, "闷蒸", "第一段 label 应为闷蒸");
});

// 多段
test("闷蒸 + 三段注水 → 四段（停止不计入）", () => {
  var r = buildResult([
    { label: "闷蒸", sec: 30 },
    { label: "段2",  sec: 75 },
    { label: "段3",  sec: 130 },
    { label: "段4",  sec: 175 },
    { label: "停止", sec: 210 },
  ]);
  assert.strictEqual(r.totalSec, 210, "totalSec 应为 210，实际 " + r.totalSec);
  assert.strictEqual(r.bloomSec, 30, "bloomSec 应为 30，实际 " + r.bloomSec);
  assert.strictEqual(r.stages.length, 4, "stages 应有 4 段，实际 " + r.stages.length);
  assert.strictEqual(r.stages[3].sec, 175, "最后一段 sec 应为 175，实际 " + r.stages[3].sec);
});

// ========== 边界情况 ==========

test("没点闷蒸就停 → bloomSec 为 null", () => {
  var r = buildResult([
    { label: "停止", sec: 45 },
  ]);
  assert.strictEqual(r.totalSec, 45, "totalSec 应为 45，实际 " + r.totalSec);
  assert.strictEqual(r.bloomSec, null, "没闷蒸时 bloomSec 应为 null，实际 " + r.bloomSec);
  assert.strictEqual(r.stages.length, 0, "stages 应为空数组，实际长度 " + r.stages.length);
});

test("空数组 → 全 0 / null", () => {
  var r = buildResult([]);
  assert.strictEqual(r.totalSec, 0, "空数组 totalSec 应为 0，实际 " + r.totalSec);
  assert.strictEqual(r.bloomSec, null, "空数组 bloomSec 应为 null，实际 " + r.bloomSec);
  assert.strictEqual(r.stages.length, 0, "空数组 stages 应为空，实际长度 " + r.stages.length);
});

test("只有闷蒸，没有停止 → 闷蒸即总时间", () => {
  var r = buildResult([
    { label: "闷蒸", sec: 30 },
  ]);
  assert.strictEqual(r.totalSec, 30, "totalSec 应为最后一项的 sec 30，实际 " + r.totalSec);
  assert.strictEqual(r.bloomSec, 30, "bloomSec 应为 30，实际 " + r.bloomSec);
  assert.strictEqual(r.stages.length, 1, "stages 应有 1 段，实际 " + r.stages.length);
});

// null / undefined → 返回默认值
test("buildResult(null) → 返回默认值", () => {
  var r = buildResult(null);
  assert.strictEqual(r.totalSec, 0, "null 时 totalSec 应为 0，实际 " + r.totalSec);
  assert.strictEqual(r.bloomSec, null, "null 时 bloomSec 应为 null，实际 " + r.bloomSec);
  assert.strictEqual(r.stages.length, 0, "null 时 stages 应为空数组，实际长度 " + r.stages.length);
});

test("buildResult(undefined) → 返回默认值", () => {
  var r = buildResult(undefined);
  assert.strictEqual(r.totalSec, 0, "undefined 时 totalSec 应为 0，实际 " + r.totalSec);
  assert.strictEqual(r.bloomSec, null, "undefined 时 bloomSec 应为 null，实际 " + r.bloomSec);
  assert.strictEqual(r.stages.length, 0, "undefined 时 stages 应为空数组，实际长度 " + r.stages.length);
});
