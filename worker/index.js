/**
 * RM 隨行助手 — Cloudflare Worker API
 *
 * 路由：
 *   POST /api/record          — 上傳一筆紀錄（前端呼叫）
 *   GET  /api/stats           — 取得統計資料（管理者）
 *   GET  /api/records         — 取得所有紀錄列表（管理者）
 *   POST /api/setup           — 初始化資料表（第一次部署時用）
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request, env) {
    // 處理 CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (path === '/api/record' && request.method === 'POST') {
        return await handleUploadRecord(request, env);
      }
      if (path === '/api/stats' && request.method === 'GET') {
        return await handleGetStats(request, env);
      }
      if (path === '/api/records' && request.method === 'GET') {
        return await handleGetRecords(request, env);
      }
      if (path === '/api/setup' && request.method === 'POST') {
        return await handleSetup(request, env);
      }

      return jsonResponse({ error: '找不到路由' }, 404);
    } catch (e) {
      return jsonResponse({ error: e.message }, 500);
    }
  }
};

/* ────────────────────────────────────────────
   POST /api/record
   Body: { userName, type, clientName, meetingName,
           rmGroup, owner, visitDate, visitHour,
           visitEndHour, purpose, city, branch, id }
──────────────────────────────────────────── */
async function handleUploadRecord(request, env) {
  const body = await request.json();

  const {
    id, userName, type, clientName, meetingName,
    rmGroup, owner, visitDate, visitHour, visitEndHour,
    purpose, city, branch
  } = body;

  if (!userName || !type) {
    return jsonResponse({ error: '缺少必填欄位' }, 400);
  }

  await env.DB.prepare(`
    INSERT OR REPLACE INTO records
      (id, user_name, type, client_name, meeting_name,
       rm_group, owner, visit_date, visit_hour, visit_end_hour,
       purpose, city, branch, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).bind(
    id || crypto.randomUUID(),
    userName.trim(),
    type,
    clientName || null,
    meetingName || null,
    rmGroup || null,
    owner || null,
    visitDate || null,
    visitHour !== undefined ? parseInt(visitHour) : null,
    visitEndHour !== undefined ? parseInt(visitEndHour) : null,
    purpose || null,
    city || null,
    branch || null
  ).run();

  return jsonResponse({ success: true });
}

/* ────────────────────────────────────────────
   GET /api/stats?password=xxx&range=30
   回傳：每人統計、類型分佈、每日趨勢、拜訪目的
──────────────────────────────────────────── */
async function handleGetStats(request, env) {
  if (!checkAdmin(request, env)) {
    return jsonResponse({ error: '密碼錯誤' }, 401);
  }

  const url = new URL(request.url);
  const days = parseInt(url.searchParams.get('range') || '30');
  const since = new Date(Date.now() - days * 86400000).toISOString().split('T')[0];

  // 每人拜訪次數
  const perUser = await env.DB.prepare(`
    SELECT user_name, COUNT(*) as count
    FROM records
    WHERE visit_date >= ?
    GROUP BY user_name
    ORDER BY count DESC
  `).bind(since).all();

  // 類型分佈
  const typeBreakdown = await env.DB.prepare(`
    SELECT type, COUNT(*) as count
    FROM records
    WHERE visit_date >= ?
    GROUP BY type
  `).bind(since).all();

  // 每日趨勢（近 N 天）
  const dailyTrend = await env.DB.prepare(`
    SELECT visit_date, COUNT(*) as count
    FROM records
    WHERE visit_date >= ?
    GROUP BY visit_date
    ORDER BY visit_date ASC
  `).bind(since).all();

  // 拜訪目的分析
  const purposeBreakdown = await env.DB.prepare(`
    SELECT purpose, COUNT(*) as count
    FROM records
    WHERE visit_date >= ? AND purpose IS NOT NULL
    GROUP BY purpose
  `).bind(since).all();

  // 總覽數字
  const totals = await env.DB.prepare(`
    SELECT
      COUNT(*) as total,
      COUNT(DISTINCT user_name) as users,
      COUNT(DISTINCT client_name) as clients
    FROM records
    WHERE visit_date >= ?
  `).bind(since).first();

  // 最近拜訪時間（各用戶）
  const lastVisit = await env.DB.prepare(`
    SELECT user_name, MAX(visit_date) as last_date, COUNT(*) as total_all
    FROM records
    GROUP BY user_name
    ORDER BY last_date DESC
  `).all();

  return jsonResponse({
    range: days,
    since,
    totals,
    perUser: perUser.results,
    typeBreakdown: typeBreakdown.results,
    dailyTrend: dailyTrend.results,
    purposeBreakdown: purposeBreakdown.results,
    lastVisit: lastVisit.results,
  });
}

/* ────────────────────────────────────────────
   GET /api/records?password=xxx&user=xxx&limit=50&offset=0
──────────────────────────────────────────── */
async function handleGetRecords(request, env) {
  if (!checkAdmin(request, env)) {
    return jsonResponse({ error: '密碼錯誤' }, 401);
  }

  const url = new URL(request.url);
  const user   = url.searchParams.get('user') || null;
  const limit  = parseInt(url.searchParams.get('limit')  || '50');
  const offset = parseInt(url.searchParams.get('offset') || '0');

  let query = `SELECT * FROM records`;
  const params = [];

  if (user) {
    query += ` WHERE user_name = ?`;
    params.push(user);
  }
  query += ` ORDER BY visit_date DESC, created_at DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const result = await env.DB.prepare(query).bind(...params).all();
  return jsonResponse({ records: result.results, total: result.results.length });
}

/* ────────────────────────────────────────────
   POST /api/setup — 建立資料表（只需執行一次）
──────────────────────────────────────────── */
async function handleSetup(request, env) {
  if (!checkAdmin(request, env)) {
    return jsonResponse({ error: '密碼錯誤' }, 401);
  }

  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS records (
      id            TEXT PRIMARY KEY,
      user_name     TEXT NOT NULL,
      type          TEXT NOT NULL,
      client_name   TEXT,
      meeting_name  TEXT,
      rm_group      TEXT,
      owner         TEXT,
      visit_date    TEXT,
      visit_hour    INTEGER,
      visit_end_hour INTEGER,
      purpose       TEXT,
      city          TEXT,
      branch        TEXT,
      created_at    TEXT DEFAULT (datetime('now'))
    )
  `).run();

  return jsonResponse({ success: true, message: '資料表建立完成' });
}

/* ── 工具函數 ── */
function checkAdmin(request, env) {
  const url = new URL(request.url);
  const pwd = url.searchParams.get('password');
  return pwd === env.ADMIN_PASSWORD;
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}
