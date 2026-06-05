/* Cloudflare Pages Function：/api/data 同步接口。
   GET  返回该同步码对应的数据；POST 把上传数据与 KV 现有数据再合并一次后写回。
   合并规则与前端 merge.js 保持一致（此处内联一份，改动时两处都要改）。 */

// —— 与 merge.js 同步的最小合并实现 ——
function mergeRecords(listA, listB) {
  const map = new Map();
  for (const r of [...(listA || []), ...(listB || [])]) {
    const prev = map.get(r.id);
    if (!prev || (r.updatedAt || 0) >= (prev.updatedAt || 0)) map.set(r.id, r);
  }
  return map;
}
function mergeTombMap(tA, tB) {
  const out = { ...(tA || {}) };
  for (const [id, t] of Object.entries(tB || {})) out[id] = Math.max(out[id] || 0, t);
  return out;
}
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
  return { records: applyTombstones(mergeRecords(listA, listB), tomb), tomb };
}
function mergeState(a, b) {
  a = a || {}; b = b || {};
  const ta = a.tombstones || { beans: {}, brews: {} };
  const tb = b.tombstones || { beans: {}, brews: {} };
  const beans = mergeCollection(a.beans, b.beans, ta.beans, tb.beans);
  const brews = mergeCollection(a.brews, b.brews, ta.brews, tb.brews);
  return { version: 1, beans: beans.records, brews: brews.records,
    tombstones: { beans: beans.tomb, brews: brews.tomb } };
}

// —— 工具 ——
const EMPTY = { version: 1, beans: [], brews: [], tombstones: { beans: {}, brews: {} } };

function codeFrom(request) {
  return (request.headers.get("X-Sync-Code") || "").trim();
}
// 用同步码派生 KV 键，避免把明文直接当键
async function keyFor(code) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code));
  const hex = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return "u_" + hex;
}
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { "Content-Type": "application/json" },
  });
}

export async function onRequestGet({ request, env }) {
  if (!env.SYNC_KV) return json({ error: "KV 未绑定，请检查 wrangler.toml 的 SYNC_KV 配置" }, 500);
  const code = codeFrom(request);
  if (!code) return json({ error: "缺少同步码" }, 401);
  const raw = await env.SYNC_KV.get(await keyFor(code));
  return json(raw ? JSON.parse(raw) : EMPTY);
}

export async function onRequestPost({ request, env }) {
  if (!env.SYNC_KV) return json({ error: "KV 未绑定，请检查 wrangler.toml 的 SYNC_KV 配置" }, 500);
  const code = codeFrom(request);
  if (!code) return json({ error: "缺少同步码" }, 401);
  let incoming;
  try {
    incoming = await request.json();
  } catch {
    return json({ error: "请求体不是合法 JSON" }, 400);
  }
  // 结构校验：beans / brews 必须是数组，否则拒绝，防止畸形数据污染云端存储
  if (!incoming || typeof incoming !== "object" ||
      !Array.isArray(incoming.beans) || !Array.isArray(incoming.brews)) {
    return json({ error: "数据格式不对：beans / brews 必须是数组" }, 400);
  }
  const key = await keyFor(code);
  const existingRaw = await env.SYNC_KV.get(key);
  const existing = existingRaw ? JSON.parse(existingRaw) : EMPTY;
  const merged = mergeState(existing, incoming); // 服务端二次合并兜底
  await env.SYNC_KV.put(key, JSON.stringify(merged));
  return json(merged);
}
