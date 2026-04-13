/**
 * RM 隨行助手 — Cloudflare Worker API v2
 *
 * 路由：
 *   POST /api/record          — 上傳紀錄
 *   GET  /api/stats           — 統計資料（管理者）
 *   GET  /api/records         — 明細列表（管理者）
 *   GET  /api/targets         — 取得月度目標設定
 *   POST /api/targets         — 儲存月度目標設定
 *   GET  /api/export          — 匯出 CSV
 *   POST /api/setup           — 初始化資料表
 *   POST /api/migrate         — 資料庫升級（加入新欄位）
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    const url  = new URL(request.url);
    const path = url.pathname;

    try {
      if (path === '/api/record'  && request.method === 'POST') return await handleUpload(request, env);
      if (path === '/api/stats'   && request.method === 'GET')  return await handleStats(request, env);
      if (path === '/api/records' && request.method === 'GET')  return await handleRecords(request, env);
      if (path === '/api/targets' && request.method === 'GET')  return await handleGetTargets(request, env);
      if (path === '/api/targets' && request.method === 'POST') return await handleSetTargets(request, env);
      if (path === '/api/export'  && request.method === 'GET')  return await handleExport(request, env);
      if (path === '/api/setup'   && request.method === 'POST') return await handleSetup(request, env);
      if (path === '/api/migrate' && request.method === 'POST') return await handleMigrate(request, env);
      return jsonRes({ error: '找不到路由' }, 404);
    } catch (e) {
      return jsonRes({ error: e.message }, 500);
    }
  }
};

/* ──────────────────────────────────────────
   POST /api/record
────────────────────────────────────────── */
async function handleUpload(request, env) {
  const b = await request.json();
  const {
    id, userName, type, clientName, meetingName,
    rmGroup, owner, visitDate, visitHour, visitEndHour,
    purpose, city, branch, is8PlusE
  } = b;

  if (!userName || !type) return jsonRes({ error: '缺少必填欄位' }, 400);

  await env.DB.prepare(`
    INSERT OR REPLACE INTO records
      (id, user_name, type, client_name, meeting_name, rm_group, owner,
       visit_date, visit_hour, visit_end_hour, purpose, city, branch,
       is_8_plus_e, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
  `).bind(
    id || crypto.randomUUID(),
    userName.trim(), type,
    clientName || null, meetingName || null,
    rmGroup || null, owner || null,
    visitDate || null,
    visitHour  != null ? parseInt(visitHour)    : null,
    visitEndHour != null ? parseInt(visitEndHour) : null,
    purpose || null, city || null, branch || null,
    is8PlusE ? 1 : 0
  ).run();

  return jsonRes({ success: true });
}

/* ──────────────────────────────────────────
   GET /api/stats?password=&range=30&sleep=30
────────────────────────────────────────── */
async function handleStats(request, env) {
  if (!checkAdmin(request, env)) return jsonRes({ error: '密碼錯誤' }, 401);

  const url   = new URL(request.url);
  const days  = parseInt(url.searchParams.get('range') || '30');
  const sleep = parseInt(url.searchParams.get('sleep') || '30');
  const since = daysAgo(days);
  const prev  = daysAgo(days * 2);

  // ── 總覽
  const totals = await env.DB.prepare(`
    SELECT COUNT(*) as total,
           COUNT(DISTINCT user_name) as users,
           COUNT(DISTINCT client_name) as clients,
           SUM(is_8_plus_e) as total_8e
    FROM records WHERE visit_date >= ?
  `).bind(since).first();

  // ── 每人本期拜訪數
  const perUser = await env.DB.prepare(`
    SELECT user_name, COUNT(*) as count,
           SUM(is_8_plus_e) as e8_count,
           COUNT(DISTINCT client_name) as unique_clients
    FROM records WHERE visit_date >= ?
    GROUP BY user_name ORDER BY count DESC
  `).bind(since).all();

  // ── 每人上期拜訪數（用於計算動能）
  const prevPeriod = await env.DB.prepare(`
    SELECT user_name, COUNT(*) as count
    FROM records WHERE visit_date >= ? AND visit_date < ?
    GROUP BY user_name
  `).bind(prev, since).all();
  const prevMap = Object.fromEntries((prevPeriod.results || []).map(r => [r.user_name, r.count]));

  // ── 每日趨勢
  const dailyTrend = await env.DB.prepare(`
    SELECT visit_date, COUNT(*) as count
    FROM records WHERE visit_date >= ?
    GROUP BY visit_date ORDER BY visit_date ASC
  `).bind(since).all();

  // ── 類型分佈
  const typeBreakdown = await env.DB.prepare(`
    SELECT type, COUNT(*) as count
    FROM records WHERE visit_date >= ? GROUP BY type
  `).bind(since).all();

  // ── 拜訪目的
  const purposeBreakdown = await env.DB.prepare(`
    SELECT purpose, COUNT(*) as count
    FROM records WHERE visit_date >= ? AND purpose IS NOT NULL GROUP BY purpose
  `).bind(since).all();

  // ── 沉睡客戶（超過 N 天沒被拜訪的客戶）
  const sleepingClients = await env.DB.prepare(`
    SELECT client_name,
           MAX(visit_date) as last_visit,
           COUNT(*) as total_visits,
           CAST(julianday('now') - julianday(MAX(visit_date)) AS INTEGER) as days_since
    FROM records
    WHERE client_name IS NOT NULL AND type IN ('report','site')
    GROUP BY client_name
    HAVING days_since > ?
    ORDER BY days_since DESC
    LIMIT 20
  `).bind(sleep).all();

  // ── 最後拜訪時間（各人）
  const lastVisit = await env.DB.prepare(`
    SELECT user_name, MAX(visit_date) as last_date, COUNT(*) as total_all
    FROM records GROUP BY user_name ORDER BY last_date DESC
  `).all();

  // ── 計算管理雷達（加入動能、8+E比率、平均值）
  const users = perUser.results || [];
  const avg   = users.length > 0 ? users.reduce((s, u) => s + u.count, 0) / users.length : 0;
  const radar = users.map(u => ({
    user_name:      u.user_name,
    count:          u.count,
    prev_count:     prevMap[u.user_name] || 0,
    momentum:       u.count - (prevMap[u.user_name] || 0),
    unique_clients: u.unique_clients || 0,
    e8_count:       u.e8_count || 0,
    e8_ratio:       u.count > 0 ? Math.round((u.e8_count || 0) * 100 / u.count) : 0,
    vs_avg:         avg > 0 ? Math.round((u.count - avg) / avg * 100) : 0,
    above_avg:      u.count >= avg,
  }));

  return jsonRes({
    range: days, since, sleep,
    totals,
    radar,
    avg_visits: Math.round(avg * 10) / 10,
    dailyTrend:       dailyTrend.results,
    typeBreakdown:    typeBreakdown.results,
    purposeBreakdown: purposeBreakdown.results,
    sleepingClients:  sleepingClients.results,
    lastVisit:        lastVisit.results,
  });
}

/* ──────────────────────────────────────────
   GET /api/records?password=&user=&limit=50&offset=0
────────────────────────────────────────── */
async function handleRecords(request, env) {
  if (!checkAdmin(request, env)) return jsonRes({ error: '密碼錯誤' }, 401);
  const url    = new URL(request.url);
  const user   = url.searchParams.get('user') || null;
  const limit  = parseInt(url.searchParams.get('limit')  || '50');
  const offset = parseInt(url.searchParams.get('offset') || '0');

  let q = 'SELECT * FROM records';
  const p = [];
  if (user) { q += ' WHERE user_name = ?'; p.push(user); }
  q += ' ORDER BY visit_date DESC, created_at DESC LIMIT ? OFFSET ?';
  p.push(limit, offset);

  const result = await env.DB.prepare(q).bind(...p).all();
  return jsonRes({ records: result.results });
}

/* ──────────────────────────────────────────
   GET /api/targets
────────────────────────────────────────── */
async function handleGetTargets(request, env) {
  if (!checkAdmin(request, env)) return jsonRes({ error: '密碼錯誤' }, 401);
  const row = await env.DB.prepare(
    'SELECT * FROM targets ORDER BY id DESC LIMIT 1'
  ).first();
  return jsonRes(row || { monthly_visits: 20, sleep_days: 30 });
}

/* ──────────────────────────────────────────
   POST /api/targets  body: { monthly_visits, sleep_days }
────────────────────────────────────────── */
async function handleSetTargets(request, env) {
  if (!checkAdmin(request, env)) return jsonRes({ error: '密碼錯誤' }, 401);
  const { monthly_visits = 20, sleep_days = 30 } = await request.json();
  await env.DB.prepare(
    `INSERT INTO targets (monthly_visits, sleep_days, updated_at)
     VALUES (?, ?, datetime('now'))`
  ).bind(parseInt(monthly_visits), parseInt(sleep_days)).run();
  return jsonRes({ success: true });
}

/* ──────────────────────────────────────────
   GET /api/export?password=&range=30  → CSV
────────────────────────────────────────── */
async function handleExport(request, env) {
  if (!checkAdmin(request, env)) return jsonRes({ error: '密碼錯誤' }, 401);
  const url   = new URL(request.url);
  const days  = parseInt(url.searchParams.get('range') || '30');
  const since = daysAgo(days);

  const result = await env.DB.prepare(`
    SELECT user_name, type, client_name, meeting_name, rm_group,
           visit_date, purpose, city, is_8_plus_e, created_at
    FROM records WHERE visit_date >= ?
    ORDER BY visit_date DESC
  `).bind(since).all();

  const rows  = result.results || [];
  const TYPE  = { report:'訪談報告', meeting:'會議記錄', site:'現場記錄' };
  const header = '姓名,類型,客戶/會議,RM組別,拜訪日期,目的,地點,8+E,建立時間';
  const lines  = rows.map(r => [
    r.user_name,
    TYPE[r.type] || r.type,
    r.client_name || r.meeting_name || '',
    r.rm_group || '',
    r.visit_date || '',
    r.purpose || '',
    r.city || '',
    r.is_8_plus_e ? '是' : '否',
    (r.created_at || '').slice(0, 16),
  ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));

  const csv = '\uFEFF' + [header, ...lines].join('\r\n');
  return new Response(csv, {
    headers: {
      ...CORS,
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="rm-report-${since}.csv"`,
    }
  });
}

/* ──────────────────────────────────────────
   POST /api/setup  — 初始化（第一次部署）
────────────────────────────────────────── */
async function handleSetup(request, env) {
  if (!checkAdmin(request, env)) return jsonRes({ error: '密碼錯誤' }, 401);
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS records (
      id             TEXT PRIMARY KEY,
      user_name      TEXT NOT NULL,
      type           TEXT NOT NULL,
      client_name    TEXT,
      meeting_name   TEXT,
      rm_group       TEXT,
      owner          TEXT,
      visit_date     TEXT,
      visit_hour     INTEGER,
      visit_end_hour INTEGER,
      purpose        TEXT,
      city           TEXT,
      branch         TEXT,
      is_8_plus_e    INTEGER DEFAULT 0,
      created_at     TEXT DEFAULT (datetime('now'))
    )
  `).run();
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS targets (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      monthly_visits INTEGER DEFAULT 20,
      sleep_days     INTEGER DEFAULT 30,
      updated_at     TEXT DEFAULT (datetime('now'))
    )
  `).run();
  return jsonRes({ success: true, message: '資料表建立完成' });
}

/* ──────────────────────────────────────────
   POST /api/migrate — 升級舊資料庫
────────────────────────────────────────── */
async function handleMigrate(request, env) {
  if (!checkAdmin(request, env)) return jsonRes({ error: '密碼錯誤' }, 401);
  const results = [];
  const ops = [
    `ALTER TABLE records ADD COLUMN is_8_plus_e INTEGER DEFAULT 0`,
    `CREATE TABLE IF NOT EXISTS targets (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       monthly_visits INTEGER DEFAULT 20,
       sleep_days INTEGER DEFAULT 30,
       updated_at TEXT DEFAULT (datetime('now'))
     )`,
  ];
  for (const sql of ops) {
    try { await env.DB.prepare(sql).run(); results.push({ sql: sql.slice(0,40), ok: true }); }
    catch(e) { results.push({ sql: sql.slice(0,40), ok: false, msg: e.message }); }
  }
  return jsonRes({ success: true, results });
}

/* ── 工具 ── */
function checkAdmin(request, env) {
  return new URL(request.url).searchParams.get('password') === env.ADMIN_PASSWORD;
}
function jsonRes(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { ...CORS, 'Content-Type': 'application/json' }
  });
}
function daysAgo(n) {
  return new Date(Date.now() - n * 86400000).toISOString().split('T')[0];
}
