require('dotenv').config();
const express = require('express');
const session = require('express-session');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ──────────────────────────────────────
app.use(express.json());
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

  // MFクラウドが認可ステップでエラーを返した場合
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

    req.session.accessToken = response.data.access_token;
    req.session.refreshToken = response.data.refresh_token;
    req.session.tokenExpiry = Date.now() + (response.data.expires_in * 1000);

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
  if (!req.session.accessToken) {
    return res.status(401).json({ error: 'not_authenticated', redirect: '/auth/login' });
  }

  // 期限5分前に自動更新
  if (Date.now() > req.session.tokenExpiry - 5 * 60 * 1000) {
    try {
      const response = await axios.post(MF_TOKEN_URL, new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: req.session.refreshToken,
      }), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        auth: {
          username: process.env.MF_CLIENT_ID,
          password: process.env.MF_CLIENT_SECRET,
        },
      });
      req.session.accessToken = response.data.access_token;
      req.session.refreshToken = response.data.refresh_token;
      req.session.tokenExpiry = Date.now() + (response.data.expires_in * 1000);
    } catch (err) {
      req.session.destroy();
      return res.status(401).json({ error: 'token_refresh_failed', redirect: '/auth/login' });
    }
  }
  next();
}

// ── APIプロキシ ──────────────────────────────────────
function mfRequest(token) {
  return axios.create({
    baseURL: MF_API_BASE,
    headers: { Authorization: `Bearer ${token}` }
  });
}

// 月次売上サマリー
app.get('/api/summary', refreshIfNeeded, async (req, res) => {
  try {
    const api = mfRequest(req.session.accessToken);
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
    const api = mfRequest(req.session.accessToken);
    const { status } = req.query; // 'unpaid' | 'paid' | all

    const params = { per_page: 100 };

    const r = await api.get('/billings', { params });
    let billings = r.data.data || [];

    // payment_statusはクライアント側でフィルタ（API仕様: 未入金/入金済み/未払い/振込済み/未設定）
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
    const api = mfRequest(req.session.accessToken);

    // 取引先一覧取得
    const partnersRes = await api.get('/partners', { params: { per_page: 100 } });
    const partners = partnersRes.data.data || [];

    // 各取引先の今月請求額を集計
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
  res.json({ authenticated: !!req.session.accessToken });
});

// ログアウト
app.get('/auth/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

// トップページ → 未認証なら認証へ
app.get('/', (req, res) => {
  if (req.session.accessToken) {
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
  └─────────────────────────────────────────┘
  `);
});
