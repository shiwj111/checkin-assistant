
      
/**
 * Cloudflare Workers - 打卡助手后端
 * 
 * 功能：
 * 1. 接收 PWA 发来的打卡记录，存入 KV
 * 2. 定时 Cron 触发检测，根据打卡状态发飞书通知
 * 
 * 部署：wrangler deploy
 */

// ==================== 配置 ====================
const CONFIG = {
  // 公司位置（深圳前海嘉里中心T8栋）
  officeLat: 22.5093,
  officeLng: 113.9018,
  radiusMeters: 50,

  // 早卡窗口
  morningStart: { h: 9, m: 30 },
  morningEnd:   { h: 10, m: 0 },

  // 晚卡窗口
  eveningStart: { h: 19, m: 0 },
  eveningEnd:   { h: 21, m: 0 },

  // 晚卡超时阈值（小时）
  workHourThreshold: 9.5,

  // 飞书 Webhook（替换为你的机器人 Webhook）
  feishuWebhookUrl: 'https://open.feishu.cn/open-apis/bot/v2/hook/YOUR_WEBHOOK_ID',

  // 飞书用户 Open ID（接收通知的人）
  feishuUserOpenId: 'ou_95ee53259573dfcd85be8f576623a2c1',

  // 记录 KV namespace 名称
  KV_NAME: 'checkin_records',
};

// ==================== CORS 头 ====================
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function corsResponse(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders,
    },
  });
}

// ==================== 距离计算 ====================
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

// ==================== 时间窗口 ====================
function isInMorningWindow() {
  const now = new Date();
  const curMin = now.getHours() * 60 + now.getMinutes();
  const startMin = CONFIG.morningStart.h * 60 + CONFIG.morningStart.m;
  const endMin   = CONFIG.morningEnd.h * 60 + CONFIG.morningEnd.m;
  return curMin >= startMin && curMin < endMin;
}

function isInEveningWindow() {
  const now = new Date();
  const curMin = now.getHours() * 60 + now.getMinutes();
  const startMin = CONFIG.eveningStart.h * 60 + CONFIG.eveningStart.m;
  const endMin   = CONFIG.eveningEnd.h * 60 + CONFIG.eveningEnd.m;
  return curMin >= startMin && curMin < endMin;
}

function todayKey() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

// ==================== KV 存储 ====================
async function getKVRecord(userId, type) {
  const key = `record:${userId}:${type}:${todayKey()}`;
  return await CHECKIN_KV.get(key, 'json');
}

async function setKVRecord(userId, type, data) {
  const key = `record:${userId}:${type}:${todayKey()}`;
  await CHECKIN_KV.put(key, JSON.stringify(data), { expirationTtl: 86400 * 2 });
}

async function getLastRemindTime(userId, type) {
  const key = `remind:${userId}:${type}:${todayKey()}`;
  return await CHECKIN_KV.get(key);
}

async function setLastRemindTime(userId, type) {
  const key = `remind:${userId}:${type}:${todayKey()}`;
  await CHECKIN_KV.put(key, new Date().toISOString(), { expirationTtl: 86400 });
}

async function getLocation(userId) {
  const key = `location:${userId}:${todayKey()}`;
  return await CHECKIN_KV.get(key, 'json');
}

async function setLocation(userId, lat, lng) {
  const key = `location:${userId}:${todayKey()}`;
  await CHECKIN_KV.put(key, JSON.stringify({ lat, lng, updatedAt: new Date().toISOString() }), { expirationTtl: 86400 });
}

// ==================== 飞书通知 ====================
async function sendFeishuCard(title, content) {
  if (CONFIG.feishuWebhookUrl === 'https://open.feishu.cn/open-apis/bot/v2/hook/YOUR_WEBHOOK_ID') {
    console.log('[Feishu] ⚠️ Webhook 未配置，本应发送:', title, content);
    return;
  }

  const payload = {
    msg_type: 'interactive',
    card: {
      header: {
        title: { tag: 'plain_text', content: title },
        template: 'red',
      },
      elements: [
        { tag: 'div', text: { tag: 'lark_md', content } },
        { tag: 'hr' },
        {
          tag: 'note',
          elements: [
            { tag: 'plain_text', content: `🕐 ${new Date().toLocaleString('zh-CN')} | 打卡助手` }
          ]
        }
      ],
    },
  };

  try {
    const resp = await fetch(CONFIG.feishuWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (resp.ok) {
      console.log('[Feishu] ✅ 发送成功:', title);
    } else {
      console.error('[Feishu] ❌ 发送失败:', resp.status);
    }
    return resp.ok;
  } catch(e) {
    console.error('[Feishu] ❌ 异常:', e.message);
    return false;
  }
}

// ==================== 核心检测逻辑 ====================
async function runScheduledCheck(userId) {
  const now = new Date();
  const userKey = userId || CONFIG.feishuUserOpenId;
  const actions = [];

  // 早卡检测
  if (isInMorningWindow()) {
    const morning = await getKVRecord(userKey, 'morning');
    if (!morning) {
      // 检查位置（在公司范围内才会提醒）
      const loc = await getLocation(userKey);
      if (loc && isWithinRadius(loc.lat, loc.lng)) {
        const lastRemind = await getLastRemindTime(userKey, 'morning');
        const canRemind = !lastRemind || (now - new Date(lastRemind)) > 25 * 60 * 1000;
        if (canRemind) {
          const sent = await sendFeishuCard(
            '☀️ 早安打卡提醒',
            `📍 你已进入公司围栏\n⏰ ${now.toLocaleString('zh-CN')}\n\n还没打早卡，记得打卡哦！`
          );
          if (sent !== false) {
            await setLastRemindTime(userKey, 'morning');
            actions.push('☀️ 已发送早卡提醒');
          }
        }
      }
    }
  }

  // 晚卡检测
  if (isInEveningWindow()) {
    const evening = await getKVRecord(userKey, 'evening');
    const morning = await getKVRecord(userKey, 'morning');
    
    if (!evening && morning) {
      const workHours = (now - new Date(morning.time)) / 1000 / 60 / 60;
      if (workHours >= CONFIG.workHourThreshold) {
        const loc = await getLocation(userKey);
        if (loc && !isWithinRadius(loc.lat, loc.lng)) {
          const lastRemind = await getLastRemindTime(userKey, 'evening');
          const canRemind = !lastRemind || (now - new Date(lastRemind)) > 25 * 60 * 1000;
          if (canRemind) {
            const sent = await sendFeishuCard(
              '🌙 晚卡打卡提醒',
              `✅ 你已工作 **${workHours.toFixed(1)} 小时**\n📍 你已离开公司\n⏰ ${now.toLocaleString('zh-CN')}\n\n记得打完卡再下班！`
            );
            if (sent !== false) {
              await setLastRemindTime(userKey, 'evening');
              actions.push(`🌙 已发送晚卡提醒 (已工作${workHours.toFixed(1)}小时)`);
            }
          }
        }
      }
    }
  }

  return actions;
}

// ==================== 路由处理 ====================
async function handleRequest(request) {
  const url = new URL(request.url);
  const path = url.pathname;

  // OPTIONS 预检
  if (request.method === 'OPTIONS') {
    return new Response('', { headers: corsHeaders });
  }

  // ---- 接收位置更新（每30秒 PWA 调用）----
  if (path === '/api/location' && request.method === 'POST') {
    try {
      const body = await request.json();
      const userId = body.userId || CONFIG.feishuUserOpenId;
      const { lat, lng } = body;

      await setLocation(userId, lat, lng);

      // 顺便检测是否该提醒
      const actions = await runScheduledCheck(userId);

      return corsResponse(JSON.stringify({
        success: true,
        location: { lat, lng },
        distance: distanceFromOffice(lat, lng),
        inOffice: isWithinRadius(lat, lng),
        actions,
      }));
    } catch(e) {
      return corsResponse(JSON.stringify({ error: e.message }), 500);
    }
  }

  // ---- 手动打卡 ----
  if (path === '/api/record' && request.method === 'POST') {
    try {
      const body = await request.json();
      const userId = body.userId || CONFIG.feishuUserOpenId;
      const { type, time, lat, lng } = body;

      const record = {
        time: time || new Date().toISOString(),
        lat,
        lng,
        isInOffice: lat && lng ? isWithinRadius(lat, lng) : null,
        savedAt: new Date().toISOString(),
      };

      await setKVRecord(userId, type, record);

      return corsResponse(JSON.stringify({
        success: true,
        record,
        distance: lat && lng ? distanceFromOffice(lat, lng) : null,
      }));
    } catch(e) {
      return corsResponse(JSON.stringify({ error: e.message }), 500);
    }
  }

  // ---- 获取今日状态 ----
  if (path === '/api/status' && request.method === 'GET') {
    const userId = url.searchParams.get('userId') || CONFIG.feishuUserOpenId;
    const morning = await getKVRecord(userId, 'morning');
    const evening = await getKVRecord(userId, 'evening');
    const loc = await getLocation(userId);

    return corsResponse(JSON.stringify({
      morning,
      evening,
      location: loc,
      inOffice: loc ? isWithinRadius(loc.lat, loc.lng) : null,
      distance: loc ? distanceFromOffice(loc.lat, loc.lng) : null,
    }));
  }

  // ---- 测试通知 ----
  if (path === '/api/test' && request.method === 'POST') {
    const sent = await sendFeishuCard(
      '🧪 测试通知',
      `这是来自打卡助手的测试消息\n如果你收到了，说明飞书机器人配置正常！\n\n⏰ ${new Date().toLocaleString('zh-CN')}`
    );
    return corsResponse(JSON.stringify({
      success: true,
      sent: sent !== false,
      message: '已发送测试通知',
    }));
  }

  // ---- 健康检查 ----
  if (path === '/health') {
    return new Response('OK', { headers: { 'Content-Type': 'text/plain' } });
  }

  // 默认
  return corsResponse(JSON.stringify({ error: 'Not found' }), 404);
}

// ==================== 定时任务（Cron 触发）====================
// 定时任务在 wrangler.toml 中配置：
// cron = ["0 9 * * *", "30 9 * * *", "0 19 * * *", "30 19 * * *", "0 20 * * *"]
async function handleScheduled(controller, env) {
  // 从 env 初始化 KV（Workers 中通过 env 访问 bindings）
  const userId = env.USER_ID || CONFIG.feishuUserOpenId;
  console.log('[Cron] 定时检测触发', new Date().toISOString());
  const actions = await runScheduledCheck(userId);
  console.log('[Cron] 检测结果:', actions.length > 0 ? actions : '无提醒');
  return actions;
}

// ==================== 入口 ====================
export default {
  async fetch(request, env, ctx) {
    // Workers 环境下用 env 初始化 KV
    if (env.CHECKIN_RECORDS) {
      globalThis.CHECKIN_KV = env.CHECKIN_RECORDS;
    }
    return handleRequest(request);
  },

  // Cron 触发器入口
  async scheduled(controller, env, ctx) {
    if (env.CHECKIN_RECORDS) {
      globalThis.CHECKIN_KV = env.CHECKIN_RECORDS;
    }
    await handleScheduled(controller, env);
  },
};

    
