'use strict';
/**
 * cockpit-server.js — 施策進行コックピット 専用サーバー（ライブ実行）
 *
 * public/cg-cockpit.html を配信し、診断スクリプトをブラウザから実行できる
 * エンドポイントを提供する。MFダッシュボード（server.js）とは独立。
 *
 * 起動: node cockpit-server.js   （ポート 8090）
 *
 * エンドポイント:
 *   POST /api/cockpit/youtube     { input, prOnly }  → fetch_channel.js
 *   POST /api/cockpit/yt-search   { keyword, max }   → search_channels.js
 */
require('dotenv').config({ override: true });
const express = require('express');
const path = require('path');
const { execFile } = require('child_process');

const app = express();
const PORT = process.env.PORT || process.env.COCKPIT_PORT || 8090;

const cors = (req, res, next) => {
  const origin = process.env.ALLOWED_ORIGIN || '*';
  res.header('Access-Control-Allow-Origin', origin);
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
};
app.use(cors);

const { verifyIdToken } = require('./lib/google-auth');
const { isAllowed } = require('./lib/authz');
const { appendRow, readAllowlist, readRows, updateRowById } = require('./lib/sheets');
const { toDiagnosisRow } = require('./lib/diagnosis-store');
const crm = require('./lib/crm-store');
const { nextId } = require('./lib/id-gen');
const inf = require('./lib/influencer-store');
const rst = require('./lib/result-store');
const { buildAnalyzePrompt } = require('./lib/analyze-prompt');
const { buildXIntentPrompt } = require('./lib/x-intent-prompt');
const Anthropic = require('@anthropic-ai/sdk');
const SHEET_ID = process.env.SHEET_ID;

// 指定タブの既存ID（A列）一覧を返す（採番用）
async function existingIds(tabName) {
  const rows = await readRows(SHEET_ID, tabName);
  return rows.slice(1).map((r) => (r[0] || '')).filter(Boolean);
}

// 認証ミドルウェア：Authorization: Bearer <idToken> を検証＋許可リスト照合
async function requireAuth(req, res, next) {
  try {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!token) return res.status(401).json({ ok: false, error: '未ログイン' });
    const user = await verifyIdToken(token);
    const allowlist = await readAllowlist(SHEET_ID);
    if (!isAllowed(user.email, allowlist)) {
      return res.status(403).json({ ok: false, error: '許可リストにありません' });
    }
    req.user = user;
    next();
  } catch (e) {
    res.status(401).json({ ok: false, error: '認証失敗' });
  }
}

app.use(express.json({ limit: '12mb' }));  // CSVアップロード対応
app.use(express.static(path.join(__dirname, 'public')));

// スクリプトを実行し @@JSON@@ マーカー行を抽出して返す
function runScript(scriptRel, scriptArgs, res) {
  const script = path.join(__dirname, scriptRel);
  execFile('node', [script, ...scriptArgs], { cwd: __dirname, timeout: 180000, maxBuffer: 10 * 1024 * 1024 },
    (err, stdout, stderr) => {
      const marker = (stdout || '').split('\n').find(l => l.startsWith('@@JSON@@'));
      if (marker) {
        try { return res.json(JSON.parse(marker.slice(8))); } catch (e) {}
      }
      if (err) {
        return res.status(500).json({ ok: false, error: (stderr || err.message || '').slice(0, 500) });
      }
      res.status(500).json({ ok: false, error: 'JSON出力が見つかりませんでした', raw: (stdout || '').slice(-500) });
    });
}

// 成功時にコールバック（Sheets保存等）を実行してからJSONを返す版
function runScriptThen(scriptRel, scriptArgs, res, after) {
  const script = path.join(__dirname, scriptRel);
  execFile('node', [script, ...scriptArgs], { cwd: __dirname, timeout: 180000, maxBuffer: 10 * 1024 * 1024 },
    async (err, stdout) => {
      const marker = (stdout || '').split('\n').find((l) => l.startsWith('@@JSON@@'));
      if (marker) {
        try {
          const data = JSON.parse(marker.slice(8));
          if (after) await after(data);
          return res.json(data);
        } catch (e) {}
      }
      res.status(500).json({ ok: false, error: '実行に失敗しました' });
    });
}

// スクリプトを実行して @@JSON@@ をPromiseで返す版。
// runScriptThen は after() の例外を握り潰して「実行に失敗しました」に丸めるため、
// 取得段と判定段のエラーを区別したい呼び出し元はこちらを使う。
function runScriptJson(scriptRel, scriptArgs) {
  const script = path.join(__dirname, scriptRel);
  return new Promise((resolve, reject) => {
    execFile('node', [script, ...scriptArgs], { cwd: __dirname, timeout: 180000, maxBuffer: 10 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const marker = (stdout || '').split('\n').find((l) => l.startsWith('@@JSON@@'));
        if (marker) {
          try { return resolve(JSON.parse(marker.slice(8))); } catch (e) { /* 下のrejectへ */ }
        }
        reject(new Error(String(stderr || (err && err.message) || 'JSON出力が見つかりませんでした').slice(0, 400)));
      });
  });
}

// YouTube チャンネル診断
app.post('/api/cockpit/youtube', requireAuth, (req, res) => {
  const { input, prOnly } = req.body || {};
  if (!input) return res.status(400).json({ ok: false, error: 'チャンネルID/ハンドルを入力してください' });
  const a = [input, '--json', '--videos', '20', '--comments', '50'];
  if (prOnly) a.push('--pr-only', '--pr-posts', '10');
  const caseId = String((req.body || {}).caseId || '');
  runScriptThen('scripts/youtube/fetch_channel.js', a, res, async (data) => {
    if (SHEET_ID && data.ok) {
      try { await appendRow(SHEET_ID, '診断ログ', toDiagnosisRow(data, req.user, new Date(), caseId)); } catch (e) {}
    }
  });
});

// YouTube キーワード検索
app.post('/api/cockpit/yt-search', requireAuth, (req, res) => {
  const { keyword, max } = req.body || {};
  if (!keyword) return res.status(400).json({ ok: false, error: 'キーワードを入力してください' });
  runScript('scripts/youtube/search_channels.js', [keyword, '--json', '--max', String(max || 8)], res);
});

// Instagram 診断（Apify）— 1ユーザーずつ（フロントで複数ループ）
app.post('/api/cockpit/instagram', requireAuth, (req, res) => {
  const u = String((req.body || {}).input || '').trim().replace(/^@/, '');
  const prOnly = (req.body || {}).prOnly;
  if (!u) return res.status(400).json({ ok: false, error: 'ユーザー名を入力してください' });
  if (!process.env.APIFY_TOKEN) return res.status(400).json({ ok: false, error: 'APIFY_TOKEN未設定（Cloud Runの環境変数に追加してください）' });
  const a = [u, '--json'];
  if (prOnly) a.push('--pr-only', '--pr-posts', '10');
  runScript('scripts/apify/fetch_instagram.js', a, res);
});

// CSVテキストを一時ファイルに書いてPythonスクリプトを実行し @@JSON@@ を返す
function runPythonCsv(scriptRel, csvText, res) {
  const fs = require('fs');
  const os = require('os');
  const tmp = path.join(os.tmpdir(), `cg_${Date.now()}_${Math.random().toString(36).slice(2)}.csv`);
  try { fs.writeFileSync(tmp, csvText, 'utf-8'); }
  catch (e) { return res.status(500).json({ ok: false, error: '一時ファイル作成に失敗' }); }
  const script = path.join(__dirname, scriptRel);
  execFile('python3', [script, tmp, '--json'], { cwd: __dirname, timeout: 120000, maxBuffer: 20 * 1024 * 1024 },
    (err, stdout, stderr) => {
      try { fs.unlinkSync(tmp); } catch (e) {}
      const marker = (stdout || '').split('\n').find((l) => l.startsWith('@@JSON@@'));
      if (marker) { try { return res.json(JSON.parse(marker.slice(8))); } catch (e) {} }
      res.status(500).json({ ok: false, error: (stderr || (err && err.message) || '実行に失敗しました').slice(0, 400) });
    });
}

// Astream CSV → IG転換質プロキシ
app.post('/api/cockpit/ig-proxy', requireAuth, (req, res) => {
  const csv = (req.body || {}).csv;
  if (!csv) return res.status(400).json({ ok: false, error: 'CSVをアップロードしてください' });
  runPythonCsv('scripts/astream/ig_conversion_proxy.py', csv, res);
});

// Astream CSV → マスタDB取込用に整形
app.post('/api/cockpit/astream-ingest', requireAuth, (req, res) => {
  const csv = (req.body || {}).csv;
  if (!csv) return res.status(400).json({ ok: false, error: 'CSVをアップロードしてください' });
  runPythonCsv('scripts/astream/ingest_csv.py', csv, res);
});

// Astream X(旧Twitter) CSV → 候補DBに登録できる正規化行を返す
app.post('/api/cockpit/astream-x-ingest', requireAuth, (req, res) => {
  const csv = (req.body || {}).csv;
  if (!csv) return res.status(400).json({ ok: false, error: 'CSVをアップロードしてください' });
  runPythonCsv('scripts/astream/ingest_x_csv.py', csv, res);
});

// 商品分析 / マッチング診断（Claude Sonnet 4.6 でWeb完結）
app.post('/api/cockpit/analyze', requireAuth, async (req, res) => {
  const { kind, payload } = req.body || {};
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(400).json({ ok: false, error: 'ANTHROPIC_API_KEY未設定（Cloud Runの環境変数に追加してください）' });
  }
  let prompt;
  try {
    prompt = buildAnalyzePrompt(kind, payload);
  } catch (e) {
    return res.status(400).json({ ok: false, error: e.message });
  }
  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 120000 });
    const msg = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,  // 診断レポートは長文（10軸表＋ROAS＋強み/懸念）のため余裕を持たせる
      system: prompt.system,
      messages: [{ role: 'user', content: prompt.user }],
    });
    const text = (msg.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    res.json({ ok: true, text });
  } catch (e) {
    res.status(500).json({ ok: false, error: String((e && e.message) || e).slice(0, 500) });
  }
});

// X リプライ転換質診断（Apify取得＋Claude判定）— 1アカウントずつ（フロントで複数ループ）
// Cloud Runのリクエストタイムアウトが300秒のため、バッチ処理にはしない（既存のIG診断と同型）
app.post('/api/cockpit/x-intent', requireAuth, async (req, res) => {
  const account = String((req.body || {}).account || '').trim().replace(/^@/, '');
  if (!account) return res.status(400).json({ ok: false, error: 'アカウント名を入力してください' });
  if (!process.env.APIFY_TOKEN) return res.status(400).json({ ok: false, error: 'APIFY_TOKEN未設定（Cloud Runの環境変数に追加してください）' });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(400).json({ ok: false, error: 'ANTHROPIC_API_KEY未設定（Cloud Runの環境変数に追加してください）' });

  // 1) Apify取得＋懸賞投稿の除外
  let data;
  try {
    data = await runScriptJson('scripts/apify/fetch_x_replies.js', [account, '--json']);
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'リプライ取得に失敗しました: ' + String(e.message || e).slice(0, 400) });
  }
  // 「対象投稿なし」は 0% と意味が違う（0%＝反応はあるが買う気ゼロ）ので conversion を null で返す
  if (!data.posts) {
    return res.json({ ok: true, account, conversion: null, reason: data.note || '対象投稿なし（懸賞のみ）', posts: 0, giveawayExcluded: data.giveawayExcluded || 0 });
  }
  if (!data.replies || !data.replies.length) {
    return res.json({ ok: true, account, conversion: null, reason: data.note || '判定対象のリプライがありません', posts: data.posts, giveawayExcluded: data.giveawayExcluded || 0 });
  }

  // 2) Claude判定
  let prompt;
  try { prompt = buildXIntentPrompt({ account, replies: data.replies }); }
  catch (e) { return res.status(400).json({ ok: false, error: e.message }); }

  let judged;
  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 120000 });
    const msg = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: prompt.system,
      messages: [{ role: 'user', content: prompt.user }],
    });
    const text = (msg.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('JSONが見つかりません');
    judged = JSON.parse(m[0]);
  } catch (e) {
    return res.status(500).json({ ok: false, error: '判定結果の解析に失敗しました: ' + String(e.message || e).slice(0, 300) });
  }

  // 3) 転換質% = (購入済＋購入予定＋欲しい) ÷ 判定数。重み付けはしない（未検証の任意定数を入れないため）
  const c = judged.counts || {};
  const total = Number(judged.total) || data.replies.length;
  const hit = (Number(c.purchased) || 0) + (Number(c.willBuy) || 0) + (Number(c.want) || 0);
  const conversion = total > 0 ? +((hit / total) * 100).toFixed(1) : null;

  res.json({
    ok: true, account, conversion, total,
    counts: c,
    evidence: judged.evidence || {},
    note: judged.note || '',
    posts: data.posts,
    giveawayExcluded: data.giveawayExcluded || 0,
    hasPRPost: !!data.hasPRPost,
    lowSample: total < 20,
  });
});

// X候補検索（S2d-3）— キーワードでXアカウントを発掘。
// 検索は300件でも数十秒で終わるため、転換質診断と違い1リクエストで完結する。
app.post('/api/cockpit/x-discover', requireAuth, async (req, res) => {
  const raw = (req.body || {}).keywords;
  const keywords = (Array.isArray(raw) ? raw : String(raw || '').split(/[\n,、，]/))
    .map((s) => String(s).trim())
    .filter(Boolean);
  if (!keywords.length) return res.status(400).json({ ok: false, error: 'キーワードを入力してください' });
  if (keywords.length > 3) return res.status(400).json({ ok: false, error: 'キーワードは3つまでです' });
  if (!process.env.APIFY_TOKEN) return res.status(400).json({ ok: false, error: 'APIFY_TOKEN未設定（Cloud Runの環境変数に追加してください）' });

  try {
    const data = await runScriptJson('scripts/apify/discover_x.js', [...keywords, '--json']);
    return res.json(data);
  } catch (e) {
    return res.status(502).json({ ok: false, error: 'X検索に失敗しました: ' + String(e.message || e).slice(0, 400) });
  }
});

// --- ブランド ---
app.get('/api/cockpit/brands', requireAuth, async (req, res) => {
  try {
    const rows = await readRows(SHEET_ID, 'ブランド');
    res.json({ ok: true, brands: rows.slice(1).map(crm.parseBrand) });
  } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e).slice(0, 300) }); }
});
app.post('/api/cockpit/brands', requireAuth, async (req, res) => {
  try {
    crm.validateBrand(req.body || {});
    const id = nextId('B', await existingIds('ブランド'));
    await appendRow(SHEET_ID, 'ブランド', crm.toBrandRow(req.body, id));
    res.json({ ok: true, brand_id: id });
  } catch (e) {
    const bad = /必須項目/.test(e.message);
    res.status(bad ? 400 : 500).json({ ok: false, error: String(e.message || e).slice(0, 300) });
  }
});

// --- 商品 ---
app.get('/api/cockpit/products', requireAuth, async (req, res) => {
  try {
    const rows = await readRows(SHEET_ID, '商品');
    let products = rows.slice(1).map(crm.parseProduct);
    if (req.query.brand_id) products = products.filter((p) => p.brand_id === req.query.brand_id);
    res.json({ ok: true, products });
  } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e).slice(0, 300) }); }
});
app.post('/api/cockpit/products', requireAuth, async (req, res) => {
  try {
    crm.validateProduct(req.body || {});
    const id = nextId('P', await existingIds('商品'));
    await appendRow(SHEET_ID, '商品', crm.toProductRow(req.body, id));
    res.json({ ok: true, product_id: id });
  } catch (e) {
    const bad = /必須項目/.test(e.message);
    res.status(bad ? 400 : 500).json({ ok: false, error: String(e.message || e).slice(0, 300) });
  }
});

// --- 案件 ---
app.get('/api/cockpit/cases', requireAuth, async (req, res) => {
  try {
    const rows = await readRows(SHEET_ID, '案件');
    let cases = rows.slice(1).map(crm.parseCase);
    if (req.query.brand_id) cases = cases.filter((c) => c.brand_id === req.query.brand_id);
    if (req.query.status) cases = cases.filter((c) => c.status === req.query.status);
    res.json({ ok: true, cases });
  } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e).slice(0, 300) }); }
});
app.post('/api/cockpit/cases', requireAuth, async (req, res) => {
  try {
    crm.validateCase(req.body || {});
    const id = nextId('C', await existingIds('案件'));
    await appendRow(SHEET_ID, '案件', crm.toCaseRow(req.body, id));
    res.json({ ok: true, case_id: id });
  } catch (e) {
    const bad = /必須項目|不正なステータス/.test(e.message);
    res.status(bad ? 400 : 500).json({ ok: false, error: String(e.message || e).slice(0, 300) });
  }
});
app.patch('/api/cockpit/cases', requireAuth, async (req, res) => {
  try {
    const { case_id } = req.body || {};
    if (!case_id) return res.status(400).json({ ok: false, error: '必須項目が不足しています: case_id' });
    const rows = await readRows(SHEET_ID, '案件');
    const existing = rows.slice(1).map(crm.parseCase).find((c) => c.case_id === case_id);
    if (!existing) return res.status(404).json({ ok: false, error: '案件が見つかりません: ' + case_id });
    const PATCHABLE = ['brand_id', 'product_id', 'name', 'status', 'season', 'budget', 'goal', 'note'];
    const patch = Object.fromEntries(Object.entries(req.body).filter(([k]) => PATCHABLE.includes(k)));
    const merged = { ...existing, ...patch };
    crm.validateCase(merged);
    const row = crm.toCaseRow(merged, case_id, new Date(), existing.created);
    await updateRowById(SHEET_ID, '案件', 0, case_id, row);
    res.json({ ok: true, case_id });
  } catch (e) {
    const bad = /必須項目|不正なステータス/.test(e.message);
    res.status(bad ? 400 : 500).json({ ok: false, error: String(e.message || e).slice(0, 300) });
  }
});

// --- インフルエンサーDB ---
app.get('/api/cockpit/influencers', requireAuth, async (req, res) => {
  try {
    const rows = await readRows(SHEET_ID, 'インフルエンサーDB');
    res.json({ ok: true, influencers: rows.slice(1).map(inf.parseInfluencer) });
  } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e).slice(0, 300) }); }
});
app.post('/api/cockpit/influencers', requireAuth, async (req, res) => {
  try {
    const body = req.body || {};
    inf.validateInfluencer(body);
    const account = String(body.account || '').trim().replace(/^@/, '');
    const media = String(body.media || '').trim();
    const rows = await readRows(SHEET_ID, 'インフルエンサーDB');
    const parsed = rows.slice(1).map(inf.parseInfluencer);
    const incoming = { ...body, account, media, registrant: req.user.email };
    const existing = parsed.find((x) => x.media === media && (x.account || '').toLowerCase() === account.toLowerCase());
    if (existing) {
      const merged = inf.mergeInfluencer(existing, incoming);
      await updateRowById(SHEET_ID, 'インフルエンサーDB', 0, existing.inf_id, inf.toInfluencerRow(merged, existing.inf_id));
      return res.json({ ok: true, inf_id: existing.inf_id, updated: true });
    }
    const id = nextId('I', parsed.map((x) => x.inf_id).filter(Boolean));
    await appendRow(SHEET_ID, 'インフルエンサーDB', inf.toInfluencerRow(incoming, id));
    res.json({ ok: true, inf_id: id, updated: false });
  } catch (e) {
    const bad = /必須項目|媒体/.test(e.message);
    res.status(bad ? 400 : 500).json({ ok: false, error: String(e.message || e).slice(0, 300) });
  }
});

// --- 実績 ---
// 案件で診断したインフルを診断ログから列挙（診断ログ列: [案件ID,日付,実行者,媒体,チャンネル名,...]）
app.get('/api/cockpit/case-influencers', requireAuth, async (req, res) => {
  try {
    const caseId = String(req.query.case_id || '');
    if (!caseId) return res.json({ ok: true, influencers: [] });
    const rows = await readRows(SHEET_ID, '診断ログ');
    const seen = new Set(); const out = [];
    rows.slice(1).forEach((r) => {
      if ((r[0] || '') !== caseId) return;
      const account = (r[4] || '').trim(); const media = (r[3] || '').trim();
      const key = media + '|' + account.toLowerCase();
      if (account && !seen.has(key)) { seen.add(key); out.push({ account, media }); }
    });
    res.json({ ok: true, influencers: out });
  } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e).slice(0, 300) }); }
});
app.get('/api/cockpit/results', requireAuth, async (req, res) => {
  try {
    const caseId = String(req.query.case_id || '');
    const rows = await readRows(SHEET_ID, '実績');
    let results = rows.slice(1).map(rst.parseResult);
    if (caseId) results = results.filter((x) => x.case_id === caseId);
    res.json({ ok: true, results });
  } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e).slice(0, 300) }); }
});
app.post('/api/cockpit/results', requireAuth, async (req, res) => {
  try {
    const body = req.body || {};
    rst.validateResult(body);
    const caseId = String(body.case_id || '').trim();
    const account = String(body.account || '').trim().replace(/^@/, '');
    const media = String(body.media || '').trim();
    const incoming = { ...body, case_id: caseId, account, media, registrant: req.user.email };
    const rows = await readRows(SHEET_ID, '実績');
    const parsed = rows.slice(1).map(rst.parseResult);
    const existing = parsed.find((x) => x.case_id === caseId && (x.account || '').toLowerCase() === account.toLowerCase());
    let resultId;
    if (existing) {
      resultId = existing.result_id;
      await updateRowById(SHEET_ID, '実績', 0, resultId, rst.toResultRow(incoming, resultId));
    } else {
      resultId = nextId('R', parsed.map((x) => x.result_id).filter(Boolean));
      await appendRow(SHEET_ID, '実績', rst.toResultRow(incoming, resultId));
    }
    const comp = rst.computeResult({ sales: body.sales, fee: body.fee, rewardRate: body.rewardRate });
    let reflected = false;
    try {
      const caseLabel = String(body.caseLabel || '').trim();
      const line = rst.buildSummaryLine(caseLabel, comp.roas, comp.profit);
      const irows = await readRows(SHEET_ID, 'インフルエンサーDB');
      const iparsed = irows.slice(1).map(inf.parseInfluencer);
      const iex = iparsed.find((x) => x.media === media && (x.account || '').toLowerCase() === account.toLowerCase());
      const mergedSummary = rst.mergeSummaryLine(iex ? iex.result : '', caseId, line);
      if (iex) {
        const m = inf.mergeInfluencer(iex, { account, media, result: mergedSummary });
        await updateRowById(SHEET_ID, 'インフルエンサーDB', 0, iex.inf_id, inf.toInfluencerRow(m, iex.inf_id));
      } else {
        const iid = nextId('I', iparsed.map((x) => x.inf_id).filter(Boolean));
        await appendRow(SHEET_ID, 'インフルエンサーDB', inf.toInfluencerRow({ account, media, result: mergedSummary, registrant: req.user.email }, iid));
      }
      reflected = true;
    } catch (e) { reflected = false; }
    res.json({ ok: true, result_id: resultId, roas: comp.roas, updated: !!existing, reflected });
  } catch (e) {
    const bad = /必須項目/.test(e.message);
    res.status(bad ? 400 : 500).json({ ok: false, error: String(e.message || e).slice(0, 300) });
  }
});

app.get('/', (req, res) => res.redirect('/cg-cockpit.html'));

app.listen(PORT, () => {
  const key = process.env.YOUTUBE_API_KEY ? '設定済み' : '未設定 ← .env確認';
  console.log(`\n  🚀 施策進行コックピット（ライブ実行）`);
  console.log(`  http://localhost:${PORT}/cg-cockpit.html`);
  console.log(`  YOUTUBE_API_KEY: ${key}\n`);
});
