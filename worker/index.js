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
      if (path === '/api/migrate') return await handleMigrate(request, env);
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
    clientName ? normalize(clientName) : null,
    meetingName ? normalize(meetingName) : null,
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
      `).bind(recordId, normalize(clientName), relType, normalize(relName), terms,
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

  const pat = `%${normalize(name)}%`;

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
  const deduped = raw.filter(h => {
    const key = `${h.rel_type}|${h.focal_co}|${h.rel_name}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  }).slice(0, 8);

  // 統一以「被搜尋公司」為視角：
  // 若搜尋詞命中 rel_name 而非 focal_co，翻轉關係方向
  // 例如：DB 存「深圳信隆 → supplier → 鑫福铝业」
  //       搜尋「鑫福铝業」時，應改為「鑫福铝業 → buyer → 深圳信隆」
  const searchNorm = normalize(name);
  const hints = deduped.map(h => {
    const focalMatch = normalize(h.focal_co || '').includes(searchNorm);
    const relMatch   = normalize(h.rel_name || '').includes(searchNorm);
    if (relMatch && !focalMatch && h.rel_type !== 'group') {
      const flippedType = h.rel_type === 'supplier' ? 'buyer' : 'supplier';
      return { ...h, focal_co: h.rel_name, rel_type: flippedType, rel_name: h.focal_co };
    }
    return h;
  });

  // ── 組成 prompt（嚴格限制只根據資料庫內容）
  const lines = hints.map(h => {
    if (h.rel_type === 'buyer')
      return `・「${h.focal_co}」買方：${h.rel_name}${h.terms ? `（收款 ${h.terms}）` : ''}`;
    if (h.rel_type === 'supplier')
      return `・「${h.focal_co}」供應商：${h.rel_name}${h.terms ? `（付款 ${h.terms}）` : ''}`;
    if (h.rel_type === 'group')
      return `・「${h.focal_co}」所屬集團：${h.rel_name}`;
    return '';
  }).filter(Boolean).join('\n');

  const prompt = `你是玉山銀行RM業務助手。以下是行內資料庫關於「${name}」的全部供應鏈紀錄，這是全部資料，不得推測或補充任何資料庫以外的信息：\n\n${lines}\n\n請用繁體中文在60字以內，只根據以上紀錄提供最關鍵的業務切入建議一句話，不可添加資料庫沒有的內容。`;

  let insight = null;
  if (env.DEEPSEEK_API_KEY) {
    try {
      const aiRes = await fetch(
        'https://api.deepseek.com/chat/completions',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${env.DEEPSEEK_API_KEY}`,
          },
          body: JSON.stringify({
            model: 'deepseek-chat',
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 120,
            temperature: 0.2,
          })
        }
      );
      const aiData = await aiRes.json();
      insight = aiData.choices?.[0]?.message?.content || null;
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

/* ── 繁→簡 正規化（供公司名稱匹配用） ── */
const T2S = {"來":"来","業":"业","電":"电","國":"国","際":"际","銀":"银","貿":"贸","資":"资","產":"产","術":"术","發":"发","華":"华","經":"经","營":"营","廠":"厂","億":"亿","東":"东","設":"设","備":"备","開":"开","關":"关","學":"学","實":"实","現":"现","進":"进","銷":"销","購":"购","價":"价","種":"种","類":"类","點":"点","線":"线","時":"时","機":"机","號":"号","議":"议","計":"计","訂":"订","記":"记","話":"话","請":"请","調":"调","讓":"让","認":"认","識":"识","說":"说","費":"费","貨":"货","輸":"输","運":"运","輕":"轻","轉":"转","車":"车","連":"连","達":"达","過":"过","還":"还","邊":"边","遠":"远","這":"这","選":"选","辦":"办","農":"农","醫":"医","藥":"药","稅":"税","稱":"称","積":"积","務":"务","頭":"头","題":"题","風":"风","飛":"飞","飲":"饮","馬":"马","體":"体","長":"长","層":"层","幣":"币","帶":"带","師":"师","廣":"广","應":"应","數":"数","據":"据","維":"维","統":"统","網":"网","絡":"络","組":"组","終":"终","總":"总","紙":"纸","綠":"绿","繼":"继","紀":"纪","結":"结","給":"给","級":"级","紅":"红","綜":"综","經":"经","勞":"劳","動":"动","協":"协","貸":"贷","財":"财","觀":"观","親":"亲","論":"论","訓":"训","語":"语","誠":"诚","試":"试","課":"课","負":"负","賣":"卖","買":"买","賬":"账","質":"质","趨":"趋","遷":"迁","錢":"钱","鋼":"钢","銅":"铜","鐵":"铁","鋁":"铝","鋒":"锋","錄":"录","鎖":"锁","門":"门","間":"间","隊":"队","陽":"阳","陰":"阴","險":"险","難":"难","領":"领","頻":"频","養":"养","齊":"齐","龍":"龙","廈":"厦","寶":"宝","豐":"丰","興":"兴","廬":"庐","盧":"卢","豬":"猪","傳":"传","億":"亿","儲":"储","優":"优","價":"价","儀":"仪","億":"亿","傑":"杰","偉":"伟","們":"们","側":"侧","係":"系","倉":"仓","倫":"伦","債":"债","值":"值","備":"备","勢":"势","勵":"励","勸":"劝","勻":"匀","勵":"励","匯":"汇","區":"区","協":"协","卻":"却","厭":"厌","參":"参","發":"发","變":"变","奪":"夺","媽":"妈","嫵":"妩","孫":"孙","寬":"宽","導":"导","對":"对","屬":"属","幫":"帮","廢":"废","強":"强","彈":"弹","彿":"佛","徵":"征","惡":"恶","態":"态","懂":"懂","懷":"怀","戰":"战","擁":"拥","擔":"担","攜":"携","攤":"摊","撥":"拨","數":"数","樓":"楼","標":"标","樣":"样","樞":"枢","橋":"桥","歷":"历","殘":"残","氣":"气","濟":"济","燈":"灯","獲":"获","環":"环","當":"当","盡":"尽","監":"监","礙":"碍","節":"节","範":"范","篩":"筛","糧":"粮","綁":"绑","網":"网","緊":"紧","縮":"缩","繁":"繁","職":"职","聯":"联","聲":"声","聽":"听","肅":"肃","臉":"脸","與":"与","興":"兴","舊":"旧","藏":"藏","藝":"艺","處":"处","蘇":"苏","蘭":"兰","衛":"卫","補":"补","複":"复","覺":"觉","覽":"览","親":"亲","觸":"触","訊":"讯","訴":"诉","詢":"询","該":"该","詳":"详","詞":"词","誰":"谁","講":"讲","謝":"谢","讀":"读","負":"负","財":"财","費":"费","賦":"赋","賽":"赛","贈":"赠","贊":"赞","赴":"赴","跡":"迹","躍":"跃","輛":"辆","輩":"辈","辦":"办","辭":"辞","遞":"递","適":"适","鄉":"乡","鄰":"邻","配":"配","酬":"酬","針":"针","釋":"释","鏈":"链","關":"关","陸":"陆","陽":"阳","隱":"隐","雙":"双","雲":"云","電":"电","需":"需","頂":"顶","預":"预","領":"领","館":"馆","養":"养","騰":"腾","驗":"验"};
function normalize(str) {
  if (!str) return str;
  return str.split('').map(c => T2S[c] || c).join('');
}
