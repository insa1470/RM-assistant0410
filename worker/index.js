/**
 * RM 隨行助手 — Cloudflare Worker API v3
 *
 * 路由：
 *   POST /api/record    — 上傳紀錄（含 tmpl 結構化欄位 + company_graph 寫入）
 *   GET  /api/stats     — 統計資料（管理者）
 *   GET  /api/records   — 明細列表（管理者）
 *   GET  /api/targets   — 取得月度目標設定
 *   POST /api/targets   — 儲存月度目標設定
 *   GET  /api/export    — 匯出 CSV
 *   GET  /api/hint      — AI 助手：供應鏈關聯提示（含 Claude 洞察）
 *   POST /api/setup     — 初始化資料表
 *   POST /api/migrate   — 資料庫升級
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
      if (path === '/api/hint'    && request.method === 'GET')  return await handleHint(request, env);
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
    purpose, city, branch, is8PlusE,
    tmpl, followUp, hqLeader
  } = b;

  if (!userName || !type) return jsonRes({ error: '缺少必填欄位' }, 400);

  const recordId = id || crypto.randomUUID();
  const tmplJson = tmpl ? JSON.stringify(tmpl) : null;

  await env.DB.prepare(`
    INSERT OR REPLACE INTO records
      (id, user_name, type, client_name, meeting_name, rm_group, owner,
       visit_date, visit_hour, visit_end_hour, purpose, city, branch,
       is_8_plus_e, tmpl_json, follow_up, hq_leader, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
  `).bind(
    recordId,
    userName.trim(), type,
    clientName || null, meetingName || null,
    rmGroup || null, owner || null,
    visitDate || null,
    visitHour  != null ? parseInt(visitHour)    : null,
    visitEndHour != null ? parseInt(visitEndHour) : null,
    purpose || null, city || null, branch || null,
    is8PlusE ? 1 : 0,
    tmplJson,
    followUp || null,
    hqLeader ? 1 : 0
  ).run();

  // ── 寫入 company_graph（供 AI 供應鏈分析用）
  if (clientName && tmpl) {
    // 先清除同一 record_id 的舊圖譜（避免重複上傳產生重複邊）
    await env.DB.prepare(`DELETE FROM company_graph WHERE record_id = ?`).bind(recordId).run();

    const edges = [];
    if (tmpl.buyer)    edges.push(['buyer',    tmpl.buyer,    tmpl.buyerTerms    || null]);
    if (tmpl.supplier) edges.push(['supplier', tmpl.supplier, tmpl.supplierTerms || null]);
    if (tmpl.group)    edges.push(['group',    tmpl.group,    null]);

    for (const [relType, relName, terms] of edges) {
      await env.DB.prepare(`
        INSERT INTO company_graph (record_id, focal_co, rel_type, rel_name, terms, customer_need, visit_date)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(recordId, clientName, relType, relName, terms,
              tmpl.customerNeed || null, visitDate || null).run();
    }
  }

  return jsonRes({ success: true });
}

/* ──────────────────────────────────────────
   GET /api/hint?name=台積電
   → 搜尋供應鏈關聯 + 呼叫 Claude 生成洞察
────────────────────────────────────────── */
async function handleHint(request, env) {
  const url  = new URL(request.url);
  const name = (url.searchParams.get('name') || '').trim();
  if (name.length < 2) return jsonRes({ hints: [], insight: null });

  const pat = `%${name}%`;

  // 搜尋 company_graph
  const graphRes = await env.DB.prepare(`
    SELECT focal_co, rel_type, rel_name, terms, customer_need, visit_date
    FROM company_graph
    WHERE rel_name LIKE ? OR focal_co LIKE ?
    ORDER BY visit_date DESC
    LIMIT 20
  `).bind(pat, pat).all();

  const raw = graphRes.results || [];
  if (!raw.length) return jsonRes({ hints: [], insight: null });

  // 去重（同一組關係只留最新一筆）
  const seen = new Set();
  const hints = raw.filter(h => {
    const key = `${h.rel_type}|${h.focal_co}|${h.rel_name}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  }).slice(0, 8);

  // ── 組成 Claude prompt
  const lines = hints.map(h => {
    if (h.rel_type === 'buyer')
      return `・「${h.focal_co}」的主要買方為「${h.rel_name}」，收款條件：${h.terms || '未記錄'}${h.customer_need ? `，顧客需求：${h.customer_need}` : ''}`;
    if (h.rel_type === 'supplier')
      return `・「${h.focal_co}」的主要供應商為「${h.rel_name}」，付款條件：${h.terms || '未記錄'}`;
    if (h.rel_type === 'group')
      return `・「${h.focal_co}」屬於「${h.rel_name}」集團`;
    return '';
  }).filter(Boolean).join('\n');

  const prompt = `你是玉山銀行企業金融部的RM業務助手。\n以下是行內資料庫中與「${name}」相關的供應鏈紀錄：\n\n${lines}\n\n請用繁體中文，在150字以內提供業務洞察，聚焦於：\n1. 此公司在供應鏈中的角色與位置\n2. 潛在的跨客戶金融商機（如金流串聯、貿融、TMU、跨境轉介）\n3. 建議的業務切入角度\n\n請直接輸出洞察內容，不需標題或編號。`;

  let insight = null;
  if (env.CLAUDE_API_KEY) {
    try {
      const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': env.CLAUDE_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5',
          max_tokens: 250,
          messages: [{ role: 'user', content: prompt }]
        })
      });
      const aiData = await aiRes.json();
      insight = aiData.content?.[0]?.text || null;
    } catch (e) {
      insight = null; // 靜默失敗，仍回傳關聯資料
    }
  }

  return jsonRes({ hints, insight });
}

/* ──────────────────────────────────────────
   GET /api/stats
────────────────────────────────────────── */
async function handleStats(request, env) {
  if (!checkAdmin(request, env)) return jsonRes({ error: '密碼錯誤' }, 401);

  const url   = new URL(request.url);
  const days  = parseInt(url.searchParams.get('range') || '30');
  const sleep = parseInt(url.searchParams.get('sleep') || '30');
  const since = daysAgo(days);
  const prev  = daysAgo(days * 2);

  const totals = await env.DB.prepare(`
    SELECT COUNT(*) as total,
           COUNT(DISTINCT user_name) as users,
           COUNT(DISTINCT client_name) as clients,
           SUM(is_8_plus_e) as total_8e
    FROM records WHERE visit_date >= ?
  `).bind(since).first();

  const perUser = await env.DB.prepare(`
    SELECT user_name, COUNT(*) as count,
           SUM(is_8_plus_e) as e8_count,
           COUNT(DISTINCT client_name) as unique_clients
    FROM records WHERE visit_date >= ?
    GROUP BY user_name ORDER BY count DESC
  `).bind(since).all();

  const prevPeriod = await env.DB.prepare(`
    SELECT user_name, COUNT(*) as count
    FROM records WHERE visit_date >= ? AND visit_date < ?
    GROUP BY user_name
  `).bind(prev, since).all();
  const prevMap = Object.fromEntries((prevPeriod.results || []).map(r => [r.user_name, r.count]));

  const dailyTrend = await env.DB.prepare(`
    SELECT visit_date, COUNT(*) as count
    FROM records WHERE visit_date >= ?
    GROUP BY visit_date ORDER BY visit_date ASC
  `).bind(since).all();

  const typeBreakdown = await env.DB.prepare(`
    SELECT type, COUNT(*) as count
    FROM records WHERE visit_date >= ? GROUP BY type
  `).bind(since).all();

  const purposeBreakdown = await env.DB.prepare(`
    SELECT purpose, COUNT(*) as count
    FROM records WHERE visit_date >= ? AND purpose IS NOT NULL GROUP BY purpose
  `).bind(since).all();

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

  const lastVisit = await env.DB.prepare(`
    SELECT user_name, MAX(visit_date) as last_date, COUNT(*) as total_all
    FROM records GROUP BY user_name ORDER BY last_date DESC
  `).all();

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
    totals, radar,
    avg_visits: Math.round(avg * 10) / 10,
    dailyTrend:       dailyTrend.results,
    typeBreakdown:    typeBreakdown.results,
    purposeBreakdown: purposeBreakdown.results,
    sleepingClients:  sleepingClients.results,
    lastVisit:        lastVisit.results,
  });
}

/* ──────────────────────────────────────────
   GET /api/records
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
   POST /api/targets
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
   GET /api/export → CSV
────────────────────────────────────────── */
async function handleExport(request, env) {
  if (!checkAdmin(request, env)) return jsonRes({ error: '密碼錯誤' }, 401);
  const url   = new URL(request.url);
  const days  = parseInt(url.searchParams.get('range') || '30');
  const since = daysAgo(days);

  const result = await env.DB.prepare(`
    SELECT user_name, type, client_name, meeting_name, rm_group,
           visit_date, purpose, city, is_8_plus_e, follow_up, hq_leader, created_at
    FROM records WHERE visit_date >= ?
    ORDER BY visit_date DESC
  `).bind(since).all();

  const rows   = result.results || [];
  const TYPE   = { report:'訪談報告', meeting:'會議記錄', site:'現場記錄' };
  const header = '姓名,類型,客戶/會議,RM組別,拜訪日期,目的,地點,8+E,下次跟進,總行領導,建立時間';
  const lines  = rows.map(r => [
    r.user_name,
    TYPE[r.type] || r.type,
    r.client_name || r.meeting_name || '',
    r.rm_group || '',
    r.visit_date || '',
    r.purpose || '',
    r.city || '',
    r.is_8_plus_e ? '是' : '否',
    r.follow_up || '',
    r.hq_leader ? '是' : '否',
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
   POST /api/setup — 初始化（第一次部署）
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
      tmpl_json      TEXT,
      follow_up      TEXT,
      hq_leader      INTEGER DEFAULT 0,
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
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS company_graph (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      record_id     TEXT NOT NULL,
      focal_co      TEXT NOT NULL,
      rel_type      TEXT NOT NULL,
      rel_name      TEXT NOT NULL,
      terms         TEXT,
      customer_need TEXT,
      visit_date    TEXT,
      created_at    TEXT DEFAULT (datetime('now'))
    )
  `).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_graph_rel  ON company_graph(rel_name)`).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_graph_focal ON company_graph(focal_co)`).run();
  return jsonRes({ success: true, message: '資料表建立完成（含 company_graph）' });
}

/* ──────────────────────────────────────────
   POST /api/migrate — 升級舊資料庫
────────────────────────────────────────── */
async function handleMigrate(request, env) {
  if (!checkAdmin(request, env)) return jsonRes({ error: '密碼錯誤' }, 401);
  const results = [];
  const ops = [
    // v1 → v2
    `ALTER TABLE records ADD COLUMN is_8_plus_e INTEGER DEFAULT 0`,
    `CREATE TABLE IF NOT EXISTS targets (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       monthly_visits INTEGER DEFAULT 20,
       sleep_days INTEGER DEFAULT 30,
       updated_at TEXT DEFAULT (datetime('now'))
     )`,
    // v2 → v3（tmpl + followUp + hqLeader + company_graph）
    `ALTER TABLE records ADD COLUMN tmpl_json TEXT`,
    `ALTER TABLE records ADD COLUMN follow_up TEXT`,
    `ALTER TABLE records ADD COLUMN hq_leader INTEGER DEFAULT 0`,
    `CREATE TABLE IF NOT EXISTS company_graph (
       id            INTEGER PRIMARY KEY AUTOINCREMENT,
       record_id     TEXT NOT NULL,
       focal_co      TEXT NOT NULL,
       rel_type      TEXT NOT NULL,
       rel_name      TEXT NOT NULL,
       terms         TEXT,
       customer_need TEXT,
       visit_date    TEXT,
       created_at    TEXT DEFAULT (datetime('now'))
     )`,
    `CREATE INDEX IF NOT EXISTS idx_graph_rel   ON company_graph(rel_name)`,
    `CREATE INDEX IF NOT EXISTS idx_graph_focal ON company_graph(focal_co)`,
  ];
  for (const sql of ops) {
    try {
      await env.DB.prepare(sql).run();
      results.push({ sql: sql.slice(0, 50), ok: true });
    } catch(e) {
      results.push({ sql: sql.slice(0, 50), ok: false, msg: e.message });
    }
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
