/* Cloudflare Pages Function：/api/track 极简隐私统计。
   只记录「事件计数」——不收集 IP、不写 Cookie、不存任何能定位到人的信息。
   POST {event}  → 对应计数 +1（event 必须在白名单内，防止乱写脏数据）
   GET           → 返回当前所有计数（纯聚合数字，给作者自己看漏斗）

   存储：复用云同步那块 KV（SYNC_KV），固定键 stats_v1，值是一个计数对象。
   写入量很低：客户端对每个里程碑每浏览器只上报一次，所以远在免费额度内。
   注意：KV 是「读-改-写」，并发高时可能少算几次 → 数字是「约数」，看趋势足够。 */

// 只认这几个事件名，对应推广计划的漏斗。新增事件先加到这里。
const ALLOWED = ["visit", "first_record", "aha_5cups", "share_card", "sync_on"];
const STATS_KEY = "stats_v1";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      // 允许从自己的网页跨源调用（同源其实也行，这里宽松些不出错）
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

function emptyStats() {
  const zero = {};
  for (const k of ALLOWED) zero[k] = 0;
  zero.since = new Date().toISOString().slice(0, 10); // 起始日期，方便算"这是多少天里的数据"
  return zero;
}

// 浏览器预检请求
export async function onRequestOptions() {
  return json({ ok: true });
}

// 作者看板：直接在浏览器打开 /api/track 就能看到所有计数
export async function onRequestGet({ env }) {
  if (!env.SYNC_KV) return json({ error: "KV 未绑定" }, 500);
  const raw = await env.SYNC_KV.get(STATS_KEY);
  return json(raw ? JSON.parse(raw) : emptyStats());
}

// 客户端打点：某个里程碑计数 +1
export async function onRequestPost({ request, env }) {
  if (!env.SYNC_KV) return json({ error: "KV 未绑定" }, 500);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "请求体不是合法 JSON" }, 400);
  }

  const event = body && body.event;
  if (!ALLOWED.includes(event)) {
    return json({ error: "未知事件" }, 400); // 白名单兜底，拒绝乱写
  }

  const raw = await env.SYNC_KV.get(STATS_KEY);
  const stats = raw ? JSON.parse(raw) : emptyStats();
  stats[event] = (stats[event] || 0) + 1;
  await env.SYNC_KV.put(STATS_KEY, JSON.stringify(stats));

  return json({ ok: true });
}
