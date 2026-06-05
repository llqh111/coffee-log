/* 纯函数合并模块：浏览器和 Node 都能用。不依赖任何外部状态。
   规则（方案 B）：记录按 id 配对取 updatedAt 较新者；墓碑取较晚删除时间；
   若某 id 的删除时间 >= 该记录的 updatedAt，则该记录视为已删除，丢弃。 */
(function () {
  // 合并两份记录数组：同 id 取 updatedAt 较大者
  function mergeRecords(listA, listB) {
    const map = new Map();
    for (const r of [...(listA || []), ...(listB || [])]) {
      const prev = map.get(r.id);
      if (!prev || (r.updatedAt || 0) >= (prev.updatedAt || 0)) map.set(r.id, r);
    }
    return map; // id -> record
  }

  // 合并两份墓碑表：同 id 取较晚的删除时间
  function mergeTombMap(tA, tB) {
    const out = { ...(tA || {}) };
    for (const [id, t] of Object.entries(tB || {})) {
      out[id] = Math.max(out[id] || 0, t);
    }
    return out;
  }

  // 应用墓碑：删除时间 >= 记录修改时间 → 丢弃；否则（删后又编辑）保留
  function applyTombstones(recordMap, tomb) {
    const result = [];
    for (const record of recordMap.values()) {
      const delAt = tomb[record.id] || 0;
      if (delAt >= (record.updatedAt || 0)) continue;
      result.push(record);
    }
    return result;
  }

  function mergeCollection(listA, listB, tombA, tombB) {
    const tomb = mergeTombMap(tombA, tombB);
    const records = applyTombstones(mergeRecords(listA, listB), tomb);
    return { records, tomb };
  }

  function mergeState(a, b) {
    a = a || {}; b = b || {};
    const ta = a.tombstones || { beans: {}, brews: {} };
    const tb = b.tombstones || { beans: {}, brews: {} };
    const beans = mergeCollection(a.beans, b.beans, ta.beans, tb.beans);
    const brews = mergeCollection(a.brews, b.brews, ta.brews, tb.brews);
    return {
      version: 1,
      beans: beans.records,
      brews: brews.records,
      tombstones: { beans: beans.tomb, brews: brews.tomb },
    };
  }

  const api = { mergeState, mergeRecords, mergeTombMap, applyTombstones };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof globalThis !== "undefined") globalThis.SyncMerge = api;
})();
