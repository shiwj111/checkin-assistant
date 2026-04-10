      
/**
 * Cloudflare Workers - 打卡助手后端
 * 功能：1.接收PWA打卡记录存KV 2.定时Cron检测并发飞书通知
 */

// ==================== 配置 ====================
const CONFIG = {
  officeLat: 22.5093,
  officeLng: 113.9018,
  radiusMeters: 50,
  morningStart: { h: 9, m: 30 },
  morningEnd:   { h: 10, m: 0 },
  eveningStart: { h: 19, m: 0 },
  eveningEnd:   { h: 21, m: 0 },
  workHourThreshold: 9.5,
  feishuWebhookUrl: 'https://open.feishu.cn/open-apis/bot/v2/hook/YOUR_WEBHOOK_ID',
  feishuUserOpenId: 'ou_95ee53259573dfcd85be8f576623a2c1',
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function corsResponse(body, status) {
  return new Response(body, {
    status: status || 200,
    headers: Object.assign({ 'Content-Type': 'application/json' }, corsHeaders),
  });
}

// ==================== 工具函数 ====================
function isWithinRadius(lat, lng) {
  const R = 6371000;
  const dLat = (lat - CONFIG.officeLat) * Math.PI / 180;
  const dLng = (lng - CONFIG.officeLng) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 +
    Math.cos(CONFIG.officeLat * Math.PI/180) * Math.cos(lat * Math.PI/180) *
    Math.sin(dLng/2)**2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)) <= CONFIG.radiusMeters;
}

function distanceFromOffice(lat, lng) {
  const R = 6371000;
  const dLat = (lat - CONFIG.officeLat) * Math.PI / 180;
  const dLng = (lng - CONFIG.officeLng) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 +
    Math.cos(CONFIG.officeLat * Math.PI/180) * Math.cos(lat * Math.PI/180) *
    Math.sin(dLng/2)**2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function getCurrentMinutes() {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

function isInMorningWindow() {
  const cur = getCurrentMinutes();
  const s = CONFIG.morningStart.h * 60 + CONFIG.morningStart.m;
  const e = CONFIG.morningEnd.h * 60 + CONFIG.morningEnd.m;
  return cur >= s && cur < e;
}

function isInEveningWindow() {
  const cur = getCurrentMinutes();
  const s = CONFIG.eveningStart.h * 60 + CONFIG.eveningStart.m;
  const e = CONFIG.eveningEnd.h * 60 + CONFIG.eveningEnd.m;
  return cur >= s && cur < e;
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

// ==================== KV 操作 ====================
async function kvGet(env, key) {
  return await env.CHECKIN_RECORDS.get(key, 'json');
}

async function kvPut(env, key, data, ttl) {
  await env.CHECKIN_RECORDS.put(key, JSON.stringify(data), { expirationTtl: ttl || 172800 });
}

async function getKVRecord(env, userId, type) {
  return await kvGet(env, 'record:' + userId + ':' + type + ':' + todayKey());
}

async function setKVRecord(env, userId, type, data) {
  await kvPut(env, 'record:' + userId + ':' + type + ':' + todayKey(), data, 172800);
}

async function getLastRemind(env, userId, type) {
  return await kvGet(env, 'remind:' + userId + ':' + type + ':' + todayKey());
}

async function setLastRemind(env, userId, type) {
  await kvPut(env, 'remind:' + userId + ':' + type + ':' + todayKey(), new Date().toISOString(), 86400);
}

async function getLocation(env, userId) {
  return await kvGet(env, 'location:' + userId + ':' + todayKey());
}

async function setLocation(env, userId, lat, lng) {
  await kvPut(env, 'location:' + userId + ':' + todayKey(), { lat: lat, lng: lng, updatedAt: new Date().toISOString() }, 86400);
}

// ==================== 飞书通知 ====================
async function sendFeishuCard(title, content) {
  if (CONFIG.feishuWebhookUrl.indexOf('YOUR_WEBHOOK_ID') !== -1) {
    console.log('[Feishu] Webhook未配置，跳过:', title);
    return true;
  }
  const payload = {
    msg_type: 'interactive',
    card: {
      header: { title: { tag: 'plain_text', content: title }, template: 'red' },
      elements: [
        { tag: 'div', text: { tag: 'lark_md', content: content } },
        { tag: 'hr' },
        { tag: 'note', elements: [{ tag: 'plain_text', content: '🕐 ' + new Date().toLocaleString('zh-CN') + ' | 打卡助手' }] }
      ],
    },
  };
  try {
    const resp = await fetch(CONFIG.feishuWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (resp.ok) console.log('[Feishu] 发送成功:', title);
    return resp.ok;
  } catch(e) {
    console.error('[Feishu] 异常:', e.message);
    return false;
  }
}

// ==================== 核心检测逻辑 ====================
async function runCheck(env, userId) {
  const now = new Date();
  const key = userId || CONFIG.feishuUserOpenId;
  const actions = [];

  if (isInMorningWindow()) {
    const morning = await getKVRecord(env, key, 'morning');
    if (!morning) {
      const loc = await getLocation(env, key);
      if (loc && isWithinRadius(loc.lat, loc.lng)) {
        const last = await getLastRemind(env, key, 'morning');
        const gap = last ? now - new Date(last) : 0;
        if (!last || gap > 25 * 60 * 1000) {
          const ok = await sendFeishuCard('☀️ 早安打卡提醒', '📍 你已进入公司围栏\n⏰ ' + now.toLocaleString('zh-CN') + '\n\n还没打早卡，记得打卡哦！');
          if (ok) { await setLastRemind(env, key, 'morning'); actions.push('☀️ 已发送早卡提醒'); }
        }
      }
    }
  }

  if (isInEveningWindow()) {
    const evening = await getKVRecord(env, key, 'evening');
    const morning = await getKVRecord(env, key, 'morning');
    if (!evening && morning) {
      const workHours = (now - new Date(morning.time)) / 1000 / 60 / 60;
      if (workHours >= CONFIG.workHourThreshold) {
        const loc = await getLocation(env, key);
        if (loc && !isWithinRadius(loc.lat, loc.lng)) {
          const last = await getLastRemind(env, key, 'evening');
          const gap = last ? now - new Date(last) : 0;
          if (!last || gap > 25 * 60 * 1000) {
            const ok = await sendFeishuCard('🌙 晚卡打卡提醒', '✅ 你已工作 ' + workHours.toFixed(1) + ' 小时\n📍 你已离开公司\n⏰ ' + now.toLocaleString('zh-CN') + '\n\n记得打完卡再下班！');
            if (ok) { await setLastRemind(env, key, 'evening'); actions.push('🌙 已发送晚卡提醒'); }
          }
        }
      }
    }
  }

  return actions;
}

// ==================== HTTP 入口 ====================
async function handleRequest(request, env) {
  const path = new URL(request.url).pathname;
  const userId = CONFIG.feishuUserOpenId;

  if (request.method === 'OPTIONS') {
    return new Response('', { headers: corsHeaders });
  }

  if (path === '/api/location' && request.method === 'POST') {
    try {
      const body = await request.json();
      await setLocation(env, userId, body.lat, body.lng);
      const actions = await runCheck(env, userId);
      return corsResponse(JSON.stringify({
        success: true,
        inOffice: isWithinRadius(body.lat, body.lng),
        distance: distanceFromOffice(body.lat, body.lng),
        actions: actions,
      }));
    } catch(e) {
      return corsResponse(JSON.stringify({ error: e.message }), 500);
    }
  }

  if (path === '/api/record' && request.method === 'POST') {
    try {
      const body = await request.json();
      const record = {
        time: body.time || new Date().toISOString(),
        lat: body.lat,
        lng: body.lng,
        isInOffice: body.lat && body.lng ? isWithinRadius(body.lat, body.lng) : null,
        savedAt: new Date().toISOString(),
      };
      await setKVRecord(env, userId, body.type, record);
      return corsResponse(JSON.stringify({ success: true, record: record }));
    } catch(e) {
      return corsResponse(JSON.stringify({ error: e.message }), 500);
    }
  }

  if (path === '/api/status' && request.method === 'GET') {
    const morning = await getKVRecord(env, userId, 'morning');
    const evening = await getKVRecord(env, userId, 'evening');
    const loc = await getLocation(env, userId);
    return corsResponse(JSON.stringify({
      morning: morning,
      evening: evening,
      location: loc,
      inOffice: loc ? isWithinRadius(loc.lat, loc.lng) : null,
      distance: loc ? distanceFromOffice(loc.lat, loc.lng) : null,
    }));
  }

  if (path === '/api/test' && request.method === 'POST') {
    await sendFeishuCard('🧪 测试通知', '这是来自打卡助手的测试消息\n如果你收到了，说明飞书机器人配置正常！\n\n⏰ ' + new Date().toLocaleString('zh-CN'));
    return corsResponse(JSON.stringify({ success: true }));
  }

  if (path === '/health') {
    return new Response('OK');
  }

  return corsResponse(JSON.stringify({ error: 'Not found' }), 404);
}

// ==================== 导出 ====================
export default {
  async fetch(request, env, ctx) {
    return handleRequest(request, env);
  },

  async scheduled(controller, env, ctx) {
    console.log('[Cron] 定时触发', new Date().toISOString());
    const actions = await runCheck(env, CONFIG.feishuUserOpenId);
    console.log('[Cron] 结果:', actions.length > 0 ? actions : '无提醒');
  },
};

    
