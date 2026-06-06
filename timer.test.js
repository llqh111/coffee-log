/* 计时器核心纯函数测试：buildResult(timestamps)
   输入：按时间顺序排列的 [{label, sec}]，sec 是累计秒。
        正常情况下最后一项是停止，但输入也可能缺失停止项。
   输出：{ totalSec, bloomSec, stages }
         bloomSec = 第一段 label 含 "闷蒸" 时的 sec，否则 null
         stages = 原样返回（去掉了停止那一项） */

const { test } = require("node:test");
const assert = require("node:assert");

// 直接引入源码的纯函数，避免内联副本和实现漂移
const { buildResult, elapsedMsFrom } = require("./timer.js");

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

// ========== elapsedMsFrom：暂停算账（纯函数） ==========
// 参数：(now, startTime, pausedMs, pauseStartedAt)
// 真实流逝 = now − startTime − 已结算暂停 − 当前正在进行的暂停

test("从没暂停过 → 就是 now−startTime", () => {
  // 开始于 1000，现在 6000，没暂停 → 5000ms
  assert.strictEqual(elapsedMsFrom(6000, 1000, 0, 0), 5000);
});

test("有过一次已结束的暂停 → 扣掉累计暂停", () => {
  // 流逝 10s，其中暂停过 3s → 7000ms
  assert.strictEqual(elapsedMsFrom(11000, 1000, 3000, 0), 7000);
});

test("正在暂停中 → 数字冻住（连当前这段也扣）", () => {
  // 开始 1000，现在 9000（墙上过了 8s），本次暂停从 6000 开始
  // 暂停前已走 5s，暂停中不应增长 → 仍是 5000ms
  assert.strictEqual(elapsedMsFrom(9000, 1000, 0, 6000), 5000);
  // 再过 2 秒（now=11000）仍冻在 5000
  assert.strictEqual(elapsedMsFrom(11000, 1000, 0, 6000), 5000);
});

test("先结算一次暂停、又正在暂停中 → 两段都扣", () => {
  // 墙上 12s，已结算暂停 2s，当前暂停从 9000 起（此刻 now=13000，距开始 1000 过了 12s）
  // = 12000 − 2000 − (13000−9000)=4000 → 6000ms
  assert.strictEqual(elapsedMsFrom(13000, 1000, 2000, 9000), 6000);
});

test("异常输入不为负 → 兜底 0", () => {
  assert.strictEqual(elapsedMsFrom(1000, 5000, 0, 0), 0, "now 早于 startTime 也不应为负");
  assert.strictEqual(elapsedMsFrom(5000, 1000, 99999, 0), 0, "暂停超过总时长也兜底 0");
});
