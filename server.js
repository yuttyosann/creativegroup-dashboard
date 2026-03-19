require('dotenv').config();
const express = require('express');
const session = require('express-session');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const basicAuth = require('express-basic-auth');

// ── チーム定義 ────────────────────────────────────────
const TEAMS = ['Marketing', 'PR', 'Advertisement', 'Casting', 'Media'];

// ── 分類データ読み書き ────────────────────────────────
const DATA_DIR = path.join(__dirname, 'data');
const CLASSIFICATIONS_FILE = path.join(DATA_DIR, 'classifications.json');

function loadClassifications() {
  try {
    if (fs.existsSync(CLASSIFICATIONS_FILE)) {
      return JSON.parse(fs.readFileSync(CLASSIFICATIONS_FILE, 'utf8'));
    }
  } catch (e) { console.error('classifications load error:', e.message); }
  return { mappings: {} };
}

function saveClassifications(data) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(CLASSIFICATIONS_FILE, JSON.stringify(data, null, 2));
}

const app = express();
const PORT = process.env.PORT || 3000;

// ── サーバーレベルのトークン（全ユーザーで共有） ────────
// 管理者が一度MFクラウドで認証すれば、全閲覧者で共有される
let sharedToken = {
  accessToken: null,
  refreshToken: null,
  tokenExpiry: null
};

// ── Middleware ──────────────────────────────────────
app.use(express.json());

// ── Basic認証（ダッシュボード閲覧用パスワード保護） ──
const dashUser = process.env.DASHBOARD_USER || 'admin';
const dashPass = process.env.DASHBOARD_PASS || 'password';
app.use(basicAuth({
  users: { [dashUser]: dashPass },
  challenge: true,
  realm: 'CreativeGroup Dashboard'
}));

app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET || 'cg_secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 } // 24時間
}));

// MFクラウド API設定
const MF_BASE = 'https://invoice.moneyforward.com';
const MF_AUTH_BASE = 'https://api.biz.moneyforward.com';
const MF_AUTH_URL = `${MF_AUTH_BASE}/authorize`;
const MF_TOKEN_URL = `${MF_AUTH_BASE}/token`;
const MF_API_BASE = `${MF_BASE}/api/v3`;

// ── OAuth認証フロー ──────────────────────────────────

// Step1: MFクラウド認可ページへリダイレクト
app.get('/auth/login', (req, res) => {
  const params = new URLSearchParams({
    client_id: process.env.MF_CLIENT_ID,
    redirect_uri: process.env.MF_REDIRECT_URI,
    response_type: 'code',
    scope: 'mfc/office/data.read mfc/invoice/data.read',
  });
  const authUrl = `${MF_AUTH_URL}?${params}`;
  console.log('\n=== 認可URL ===');
  console.log(authUrl);
  console.log('===============\n');
  res.redirect(authUrl);
});

// Step2: コールバック — コードをトークンに交換
app.get('/callback', async (req, res) => {
  const { code, error, error_description } = req.query;

  if (error) {
    console.error('Authorization error:', error, error_description);
    return res.status(400).send(`認可エラー: ${error} — ${error_description}`);
  }

  if (!code) return res.status(400).send('認可コードが取得できませんでした');

  try {
    const response = await axios.post(MF_TOKEN_URL, new URLSearchParams({
      redirect_uri: process.env.MF_REDIRECT_URI,
      grant_type: 'authorization_code',
      code,
    }), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      auth: {
        username: process.env.MF_CLIENT_ID,
        password: process.env.MF_CLIENT_SECRET,
      },
    });

    // サーバーレベルのsharedTokenに保存（全ユーザーで共有）
    sharedToken.accessToken = response.data.access_token;
    sharedToken.refreshToken = response.data.refresh_token;
    sharedToken.tokenExpiry = Date.now() + (response.data.expires_in * 1000);

    console.log('✅ MFクラウド認証成功 — トークンを共有ストレージに保存しました');
    res.redirect('/dashboard.html');
  } catch (err) {
    const errData = err.response && err.response.data;
    const errStatus = err.response && err.response.status;
    console.error('Token exchange error:', errStatus, JSON.stringify(errData) || err.message);
    res.status(500).send(`
      <h2>トークン交換エラー</h2>
      <p>ステータス: ${errStatus}</p>
      <pre>${JSON.stringify(errData, null, 2) || err.message}</pre>
      <p>認可URL: <code>${process.env.MF_REDIRECT_URI}</code></p>
    `);
  }
});

// ── トークン自動更新ミドルウェア ─────────────────────
async function refreshIfNeeded(req, res, next) {
  if (!sharedToken.accessToken) {
    return res.status(401).json({ error: 'not_authenticated', redirect: '/auth/login' });
  }

  // 期限5分前に自動更新
  if (Date.now() > sharedToken.tokenExpiry - 5 * 60 * 1000) {
    try {
      const response = await axios.post(MF_TOKEN_URL, new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: sharedToken.refreshToken,
      }), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        auth: {
          username: process.env.MF_CLIENT_ID,
          password: process.env.MF_CLIENT_SECRET,
        },
      });
      sharedToken.accessToken = response.data.access_token;
      sharedToken.refreshToken = response.data.refresh_token;
      sharedToken.tokenExpiry = Date.now() + (response.data.expires_in * 1000);
      console.log('🔄 トークンを自動更新しました');
    } catch (err) {
      sharedToken = { accessToken: null, refreshToken: null, tokenExpiry: null };
      return res.status(401).json({ error: 'token_refresh_failed', redirect: '/auth/login' });
    }
  }
  next();
}

// ── APIプロキシ ──────────────────────────────────────
function mfRequest() {
  return axios.create({
    baseURL: MF_API_BASE,
    headers: { Authorization: `Bearer ${sharedToken.accessToken}` }
  });
}

// 月次売上サマリー
app.get('/api/summary', refreshIfNeeded, async (req, res) => {
  try {
    const api = mfRequest();
    const now = new Date();
    const results = [];

    // 直近12ヶ月分を取得
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const from = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`;
      const to = new Date(d.getFullYear(), d.getMonth()+1, 0);
      const toStr = `${to.getFullYear()}-${String(to.getMonth()+1).padStart(2,'0')}-${String(to.getDate()).padStart(2,'0')}`;

      const r = await api.get('/billings', { params: {
        from: from,
        to: toStr,
        range_key: 'billing_date',
        per_page: 100,
      }});

      const billings = r.data.data || [];
      const total = billings.reduce((sum, b) => sum + (parseFloat(b.total_price) || 0), 0);
      const unpaid = billings
        .filter(b => b.payment_status === '未入金')
        .reduce((sum, b) => sum + (parseFloat(b.total_price) || 0), 0);

      results.push({
        month: `${d.getMonth()+1}月`,
        year: d.getFullYear(),
        revenue: total,
        unpaid,
        count: billings.length,
      });
    }

    res.json({ months: results });
  } catch (err) {
    console.error('Summary error:', (err.response && err.response.data) || err.message);
    res.status(500).json({ error: err.message });
  }
});

// 請求書一覧（未入金フィルタ対応）
app.get('/api/billings', refreshIfNeeded, async (req, res) => {
  try {
    const api = mfRequest();
    const { status } = req.query;

    const params = { per_page: 100 };

    const r = await api.get('/billings', { params });
    let billings = r.data.data || [];

    if (status === 'unpaid') {
      billings = billings.filter(b => b.payment_status === '未入金');
    }

    const mapped = billings.map(b => ({
      id: b.id,
      client: b.partner_name || '不明',
      amount: parseFloat(b.total_price) || 0,
      dueDate: b.due_date,
      billingDate: b.billing_date,
      status: b.payment_status,
      title: b.title,
    }));

    res.json({ billings: mapped, total: mapped.reduce((s, b) => s + b.amount, 0) });
  } catch (err) {
    console.error('Billings error:', (err.response && err.response.data) || err.message);
    res.status(500).json({ error: err.message });
  }
});

// クライアント別収益
app.get('/api/partners', refreshIfNeeded, async (req, res) => {
  try {
    const api = mfRequest();

    const partnersRes = await api.get('/partners', { params: { per_page: 100 } });
    const partners = partnersRes.data.data || [];

    const now = new Date();
    const from = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;
    const billingsRes = await api.get('/billings', { params: {
      from: from,
      range_key: 'billing_date',
      per_page: 100,
    }});
    const billings = billingsRes.data.data || [];

    const partnerMap = {};
    billings.forEach(b => {
      const name = b.partner_name || '不明';
      if (!partnerMap[name]) partnerMap[name] = { name, revenue: 0, count: 0 };
      partnerMap[name].revenue += parseFloat(b.total_price) || 0;
      partnerMap[name].count++;
    });

    const sorted = Object.values(partnerMap).sort((a, b) => b.revenue - a.revenue);
    res.json({ partners: sorted });
  } catch (err) {
    console.error('Partners error:', (err.response && err.response.data) || err.message);
    res.status(500).json({ error: err.message });
  }
});

// 認証状態確認
app.get('/api/auth-status', (req, res) => {
  res.json({ authenticated: !!sharedToken.accessToken });
});

// ── 分類管理API ──────────────────────────────────────

// 分類データ取得
app.get('/api/classifications', (req, res) => {
  const data = loadClassifications();
  res.json({ mappings: data.mappings || {}, teams: TEAMS });
});

// 分類データ保存
app.post('/api/classifications', (req, res) => {
  const { mappings } = req.body;
  if (!mappings || typeof mappings !== 'object') {
    return res.status(400).json({ error: 'invalid mappings' });
  }
  saveClassifications({ mappings });
  res.json({ ok: true });
});

// チーム別売上サマリー
app.get('/api/team-summary', refreshIfNeeded, async (req, res) => {
  try {
    const api = mfRequest();
    const { months = 1 } = req.query;
    const data = loadClassifications();
    const mappings = data.mappings || {};

    const now = new Date();
    const startDate = new Date(now.getFullYear(), now.getMonth() - (parseInt(months) - 1), 1);
    const from = `${startDate.getFullYear()}-${String(startDate.getMonth()+1).padStart(2,'0')}-01`;

    const r = await api.get('/billings', { params: {
      from,
      range_key: 'billing_date',
      per_page: 100,
    }});
    const billings = r.data.data || [];

    // チームごとに集計
    const teamStats = {};
    TEAMS.forEach(t => { teamStats[t] = { name: t, revenue: 0, unpaid: 0, count: 0 }; });
    teamStats['未分類'] = { name: '未分類', revenue: 0, unpaid: 0, count: 0 };

    billings.forEach(b => {
      const partner = b.partner_name || '不明';
      const team = mappings[partner] || '未分類';
      const amount = parseFloat(b.total_price) || 0;
      if (!teamStats[team]) teamStats[team] = { name: team, revenue: 0, unpaid: 0, count: 0 };
      teamStats[team].revenue += amount;
      teamStats[team].count++;
      if (b.payment_status === '未入金') teamStats[team].unpaid += amount;
    });

    const result = TEAMS.map(t => teamStats[t]);
    if (teamStats['未分類'].count > 0) result.push(teamStats['未分類']);

    res.json({ teams: result, period: { from, months: parseInt(months) } });
  } catch (err) {
    console.error('Team summary error:', (err.response && err.response.data) || err.message);
    res.status(500).json({ error: err.message });
  }
});

// ログアウト（MFクラウドトークンをリセット）
app.get('/auth/logout', (req, res) => {
  sharedToken = { accessToken: null, refreshToken: null, tokenExpiry: null };
  res.redirect('/');
});

// トップページ → 未認証なら認証へ
app.get('/', (req, res) => {
  if (sharedToken.accessToken) {
    res.redirect('/dashboard.html');
  } else {
    res.redirect('/auth/login');
  }
});

// ── 起動 ────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`
  ┌─────────────────────────────────────────┐
  │  CreativeGroup Dashboard                │
  │  http://localhost:${PORT}                   │
  │                                         │
  │  MF_CLIENT_ID: ${process.env.MF_CLIENT_ID ? '設定済み ✅' : '未設定 ❌'}             │
  │  Basic Auth:   ${process.env.DASHBOARD_USER ? '設定済み ✅' : 'デフォルト(admin) ⚠️'}        │
  └─────────────────────────────────────────┘
  `);
});
