# CreativeGroup Portal & Growth Hack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Google OAuthで認証するポータルハブ・グロースハックダッシュボード（KPIファネル + ICEスコアリング）・ポータル全体のリファレンスガイドを構築する。

**Architecture:** 既存のNode.js/Expressサーバーにpassport.jsを追加してGoogle OAuthを実装。既存のBasic Authを削除し、ロールベースのアクセス制御（`data/roles.json`）に置き換える。MFクラウドOAuthは別系統で維持。新規ページ・APIは既存機能を壊さず段階的に追加する。

**Tech Stack:** Node.js, Express, passport.js, passport-google-oauth20, express-session, Jest, Supertest, Vanilla JS, Chart.js

---

## ファイル構成

```
新規作成:
  data/roles.json              メール→ロール対応表
  data/portal-cards.json       ポータルカード設定
  data/initiatives.json        施策データ永続化（空配列で初期化）
  middleware/auth.js           requireAuth / requireRole ミドルウェア
  routes/growth.js             施策CRUD + KPI API
  public/portal.html           ハブポータルページ
  public/portal.js             ポータルのフロントエンドJS
  public/growth.html           グロースハックダッシュボード
  public/growth.js             グロースハックのフロントエンドJS
  public/guide.html            ポータル全体リファレンスガイド
  tests/middleware.test.js     認証ミドルウェアのテスト
  tests/growth.test.js         施策CRUDのテスト

変更:
  package.json                 依存関係追加（passport系・jest・supertest）
  server.js                    Basic Auth削除・passport追加・新ルート追加
  routes/auth.js               Google OAuthルート追加（MFクラウド部分は維持）
  public/dashboard.js          Basic Auth fetch override を削除
  .env.example                 Google OAuth環境変数を追記
```

---

## Task 1: 依存パッケージの追加とテスト環境の構築

**Files:**
- Modify: `package.json`
- Create: `tests/middleware.test.js`（空ファイル）

- [ ] **Step 1: 依存パッケージをインストールする**

```bash
cd /Users/yuttyo/claude/creativegroup-dashboard
npm install passport passport-google-oauth20
npm install --save-dev jest supertest
```

- [ ] **Step 2: package.json に jest 設定を追加する**

`"scripts"` セクションに `"test"` を追加：

```json
{
  "name": "creativegroup-dashboard",
  "version": "1.0.0",
  "description": "CreativeGroup 経営ダッシュボード — MFクラウドAPI連携",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js",
    "test": "jest --testEnvironment node"
  },
  "jest": {
    "testMatch": ["**/tests/**/*.test.js"]
  },
  "dependencies": {
    "@google-cloud/bigquery": "^8.1.1",
    "@google-cloud/bigquery-data-transfer": "^5.1.2",
    "axios": "^1.6.0",
    "dotenv": "^16.3.1",
    "express": "^4.18.2",
    "express-basic-auth": "^1.2.1",
    "express-session": "^1.17.3",
    "passport": "^0.7.0",
    "passport-google-oauth20": "^2.0.0"
  },
  "devDependencies": {
    "jest": "^29.7.0",
    "nodemon": "^3.0.2",
    "supertest": "^7.0.0"
  }
}
```

- [ ] **Step 3: tests/ ディレクトリを作成する**

```bash
mkdir -p tests
touch tests/middleware.test.js tests/growth.test.js
```

- [ ] **Step 4: テストが実行できることを確認する**

```bash
npm test
```

Expected: `No tests found` または `Test Suites: 0 passed` — エラーなく終了すること。

- [ ] **Step 5: コミットする**

```bash
git add package.json package-lock.json tests/
git commit -m "chore: add passport, jest, supertest dependencies"
```

---

## Task 2: ロール管理データと認証ミドルウェアの実装

**Files:**
- Create: `data/roles.json`
- Create: `middleware/auth.js`
- Modify: `tests/middleware.test.js`

- [ ] **Step 1: テストを書く**

`tests/middleware.test.js` を以下の内容で作成する：

```js
'use strict';

const { requireAuth, requireRole, getRoleFromEmail } = require('../middleware/auth');

// ── getRoleFromEmail のテスト ──────────────────────────────
describe('getRoleFromEmail', () => {
  test('登録済みメールのロールを返す', () => {
    expect(getRoleFromEmail('owner@example.com')).toBe('owner');
  });

  test('未登録メールは null を返す', () => {
    expect(getRoleFromEmail('unknown@example.com')).toBeNull();
  });
});

// ── requireAuth のテスト ───────────────────────────────────
describe('requireAuth', () => {
  const mockNext = jest.fn();

  beforeEach(() => mockNext.mockClear());

  test('googleUser がセッションにあれば next() を呼ぶ', () => {
    const req = { session: { googleUser: { email: 'owner@example.com', role: 'owner' } } };
    const res = { redirect: jest.fn() };
    requireAuth(req, res, mockNext);
    expect(mockNext).toHaveBeenCalled();
    expect(res.redirect).not.toHaveBeenCalled();
  });

  test('googleUser がなければ /auth/google にリダイレクト', () => {
    const req = { session: {} };
    const res = { redirect: jest.fn() };
    requireAuth(req, res, mockNext);
    expect(res.redirect).toHaveBeenCalledWith('/auth/google');
    expect(mockNext).not.toHaveBeenCalled();
  });
});

// ── requireRole のテスト ──────────────────────────────────
describe('requireRole', () => {
  const mockNext = jest.fn();

  beforeEach(() => mockNext.mockClear());

  test('許可ロールなら next() を呼ぶ', () => {
    const req = { session: { googleUser: { role: 'owner' } } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    requireRole(['owner', 'manager'])(req, res, mockNext);
    expect(mockNext).toHaveBeenCalled();
  });

  test('許可外ロールなら 403 を返す', () => {
    const req = { session: { googleUser: { role: 'staff' } } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    requireRole(['owner', 'manager'])(req, res, mockNext);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockNext).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: テストが失敗することを確認する**

```bash
npm test -- tests/middleware.test.js
```

Expected: `Cannot find module '../middleware/auth'` — モジュール未作成のため失敗する。

- [ ] **Step 3: `data/roles.json` を作成する**

```json
{
  "owner@example.com": "owner",
  "_comment": "メールアドレス: ロール名 の形式で追加。ロール: owner / manager / employee / staff"
}
```

> ⚠️ 実際のメールアドレスに書き換えること。`_comment` キーは無視される。

- [ ] **Step 4: `middleware/auth.js` を作成する**

```js
'use strict';
/**
 * middleware/auth.js
 * Google OAuth セッションベースの認証・認可ミドルウェア
 */

const path  = require('path');
const fs    = require('fs');

const ROLES_FILE = path.join(__dirname, '..', 'data', 'roles.json');

/**
 * getRoleFromEmail — メールアドレスからロールを取得する
 * roles.json を都度読み込むことで、再起動なしに反映できる
 * @param {string} email
 * @returns {string|null} ロール名 or null
 */
function getRoleFromEmail(email) {
  try {
    const roles = JSON.parse(fs.readFileSync(ROLES_FILE, 'utf8'));
    return roles[email] || null;
  } catch {
    return null;
  }
}

/**
 * requireAuth — Googleログイン済みかチェックする
 * 未ログインなら /auth/google にリダイレクト
 */
function requireAuth(req, res, next) {
  if (req.session && req.session.googleUser) {
    return next();
  }
  res.redirect('/auth/google');
}

/**
 * requireRole — 許可ロールのリストに対してアクセス制御する
 * @param {string[]} allowedRoles - 許可するロール名の配列
 */
function requireRole(allowedRoles) {
  return (req, res, next) => {
    const role = req.session?.googleUser?.role;
    if (allowedRoles.includes(role)) {
      return next();
    }
    res.status(403).json({ error: 'forbidden', message: 'アクセス権限がありません' });
  };
}

module.exports = { requireAuth, requireRole, getRoleFromEmail };
```

- [ ] **Step 5: テストが通ることを確認する**

```bash
npm test -- tests/middleware.test.js
```

Expected: `Tests: 5 passed`

- [ ] **Step 6: コミットする**

```bash
git add data/roles.json middleware/auth.js tests/middleware.test.js
git commit -m "feat: add role-based auth middleware with tests"
```

---

## Task 3: Google OAuth の実装（server.js + routes/auth.js）

**Files:**
- Modify: `routes/auth.js`（Google OAuthルートを追加）
- Modify: `server.js`（Basic Auth削除・passport追加）
- Modify: `.env.example`

- [ ] **Step 1: `.env.example` に Google OAuth の設定項目を追記する**

```bash
cat >> /Users/yuttyo/claude/creativegroup-dashboard/.env.example << 'EOF'

# Google OAuth 2.0（GCP console で取得）
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_CALLBACK_URL=http://localhost:3000/auth/google/callback
EOF
```

- [ ] **Step 2: `.env` に Google OAuth の設定を追加する**

`.env` ファイルを開き、以下を追記する（実際の値を使うこと）：

```
GOOGLE_CLIENT_ID=取得したClient IDをここに貼る
GOOGLE_CLIENT_SECRET=取得したClient Secretをここに貼る
GOOGLE_CALLBACK_URL=http://localhost:3000/auth/google/callback
```

> GCPコンソール → API とサービス → 認証情報 → OAuth 2.0 クライアントID で取得。
> 承認済みのリダイレクトURIに `http://localhost:3000/auth/google/callback` を追加すること。

- [ ] **Step 3: `routes/auth.js` に Google OAuth ルートを追加する**

ファイル末尾の `module.exports` の前に以下を追加する：

```js
// ── Google OAuth 2.0 ─────────────────────────────────────
const passport            = require('passport');
const GoogleStrategy      = require('passport-google-oauth20').Strategy;
const { getRoleFromEmail } = require('../middleware/auth');

passport.use(new GoogleStrategy(
  {
    clientID:     process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL:  process.env.GOOGLE_CALLBACK_URL,
  },
  (_accessToken, _refreshToken, profile, done) => {
    const email = profile.emails?.[0]?.value;
    const role  = getRoleFromEmail(email);
    if (!role) {
      return done(null, false, { message: `${email} はアクセス権限がありません` });
    }
    return done(null, {
      email,
      name:    profile.displayName,
      picture: profile.photos?.[0]?.value,
      role,
    });
  }
));

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

// GET /auth/google — Googleログイン開始
router.get('/google',
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

// GET /auth/google/callback — Googleからのコールバック
router.get('/google/callback',
  passport.authenticate('google', { failureRedirect: '/auth/error' }),
  (req, res) => {
    req.session.googleUser = req.user;
    res.redirect('/portal');
  }
);

// GET /auth/error — 権限なしエラーページ
router.get('/error', (req, res) => {
  res.status(403).send(`
    <html><body style="font-family:sans-serif;padding:40px;text-align:center">
      <h2>アクセスが拒否されました</h2>
      <p>このダッシュボードへのアクセス権限がありません。</p>
      <p>管理者にメールアドレスの登録を依頼してください。</p>
      <a href="/auth/google">別のアカウントでログイン</a>
    </body></html>
  `);
});

// GET /auth/google/logout — Googleログアウト
router.get('/google/logout', (req, res) => {
  req.session.googleUser = null;
  req.session.save(() => res.redirect('/auth/google'));
});
```

- [ ] **Step 4: `server.js` を更新する（Basic Auth削除・passport追加）**

`server.js` の先頭部分を以下に置き換える（`require` 部分）：

```js
'use strict';
require('dotenv').config({ override: true });

const express   = require('express');
const session   = require('express-session');
const passport  = require('passport');
const path      = require('path');

const { router: authRouter, callbackHandler } = require('./routes/auth');
const apiRouter                               = require('./routes/api');
const growthRouter                            = require('./routes/growth');
const { requireAuth, requireRole }            = require('./middleware/auth');

const app  = express();
const PORT = process.env.PORT || 3000;
```

`app.locals` の下のミドルウェア設定部分（Basic Auth から session まで）を以下に置き換える：

```js
// ── ミドルウェア ──────────────────────────────────────────
app.use(express.json({ limit: '5mb' }));

// セッション
app.use(session({
  secret:            process.env.SESSION_SECRET || 'cg_secret',
  resave:            false,
  saveUninitialized: false,
  cookie:            { maxAge: 24 * 60 * 60 * 1000 }, // 24時間
}));

// passport（Google OAuth）
app.use(passport.initialize());
app.use(passport.session());

// 静的ファイル（認証不要: CSS/JS/画像など）
app.use(express.static(path.join(__dirname, 'public')));
```

ルーティング部分を以下に置き換える：

```js
// ── ルーティング ──────────────────────────────────────────

// 認証フロー（Google OAuth + MFクラウドOAuth）
app.use('/auth', authRouter);
app.get('/callback', callbackHandler); // MFクラウドOAuthコールバック

// ポータル（要ログイン）
app.get('/portal', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'portal.html'));
});

// グロースハック（要ログイン・社員以上）
app.get('/growth', requireAuth, requireRole(['owner','manager','employee']), (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'growth.html'));
});

// ガイド（要ログイン・全ロール）
app.get('/guide', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'guide.html'));
});

// 既存ダッシュボード（要ログイン）
app.get('/dashboard', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// 分類ツール（要ログイン・オーナー・マネージャーのみ）
app.get('/classify', requireAuth, requireRole(['owner','manager']), (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'classify.html'));
});

// APIプロキシ（MFクラウド）
app.use('/api', requireAuth, apiRouter);

// 施策CRUD / KPI API
app.use('/api/growth', requireAuth, growthRouter);

// ルート → Google未ログインならauth、ログイン済みならポータルへ
app.get('/', (req, res) => {
  if (req.session?.googleUser) {
    res.redirect('/portal');
  } else {
    res.redirect('/auth/google');
  }
});
```

- [ ] **Step 5: サーバーを起動して Google OAuth フローを確認する**

```bash
npm start
```

ブラウザで `http://localhost:3000` を開く。
Expected: Googleログイン画面にリダイレクトされる。

ログイン後:
- `roles.json` に登録済みメール → `/portal` にリダイレクトされる（404で良い、portal.htmlはまだ未作成）
- 未登録メール → `/auth/error` でエラーページが表示される

- [ ] **Step 6: コミットする**

```bash
git add routes/auth.js server.js .env.example
git commit -m "feat: add Google OAuth with role-based access control"
```

---

## Task 4: ポータルカード設定 + ログインユーザー情報API

**Files:**
- Create: `data/portal-cards.json`
- Modify: `routes/api.js`（ポータル用APIを追加）

- [ ] **Step 1: `data/portal-cards.json` を作成する**

```json
[
  {
    "id": "dashboard",
    "icon": "📊",
    "title": "売上ダッシュボード",
    "description": "月次売上・未入金・チーム別・クライアント別",
    "href": "/dashboard",
    "status": "active",
    "roles": ["owner", "manager", "employee", "staff"],
    "badgeKey": null
  },
  {
    "id": "growth",
    "icon": "🚀",
    "title": "グロースハック",
    "description": "KPIファネル・ICEスコア・施策管理",
    "href": "/growth",
    "status": "phase1",
    "roles": ["owner", "manager", "employee"],
    "badgeKey": null
  },
  {
    "id": "ads",
    "icon": "📱",
    "title": "広告ROAS",
    "description": "Google/Meta/TikTok チャネル横断分析",
    "href": "/ads",
    "status": "coming",
    "roles": ["owner", "manager", "employee"],
    "badgeKey": null
  },
  {
    "id": "pamun",
    "icon": "📝",
    "title": "Pamunアンケート",
    "description": "回答データ分析・満足度トレンド",
    "href": "/dashboard#tab-pamun",
    "status": "active",
    "roles": ["owner", "manager", "employee"],
    "badgeKey": null
  },
  {
    "id": "trepo",
    "icon": "📰",
    "title": "Trepo分析",
    "description": "記事・GA4・ランク管理",
    "href": "/trepo",
    "status": "active",
    "roles": ["owner", "manager", "employee", "staff"],
    "badgeKey": null
  },
  {
    "id": "guide",
    "icon": "📖",
    "title": "ポータルガイド",
    "description": "各機能の使い方・グロースハック入門",
    "href": "/guide",
    "status": "active",
    "roles": ["owner", "manager", "employee", "staff"],
    "badgeKey": null
  },
  {
    "id": "classify",
    "icon": "🎯",
    "title": "分類ツール",
    "description": "請求分類の設定・管理",
    "href": "/classify",
    "status": "active",
    "roles": ["owner", "manager"],
    "badgeKey": null,
    "isAdmin": true
  }
]
```

- [ ] **Step 2: `routes/api.js` にポータル用APIエンドポイントを追加する**

`routes/api.js` の末尾（`module.exports` の前）に追加する：

```js
// ── ポータル用API ─────────────────────────────────────────

/**
 * GET /api/portal/me — ログイン中のユーザー情報とロールを返す
 */
router.get('/portal/me', (req, res) => {
  const user = req.session?.googleUser;
  if (!user) return res.status(401).json({ error: 'not_authenticated' });
  res.json({ email: user.email, name: user.name, picture: user.picture, role: user.role });
});

/**
 * GET /api/portal/cards — ログインユーザーのロールに応じたカード一覧を返す
 */
router.get('/portal/cards', (req, res) => {
  const role = req.session?.googleUser?.role;
  if (!role) return res.status(401).json({ error: 'not_authenticated' });
  const allCards = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'data', 'portal-cards.json'), 'utf8')
  );
  const filtered = allCards.filter(c => c.roles.includes(role));
  res.json(filtered);
});
```

`routes/api.js` の先頭の require に `path` と `fs` が含まれているか確認し、なければ追加する：

```js
const path = require('path');
const fs   = require('fs');
```

- [ ] **Step 3: ブラウザで API を確認する**

ログイン後に `http://localhost:3000/api/portal/me` を開く。
Expected:
```json
{"email":"あなたのメール","name":"山口さん","role":"owner"}
```

- [ ] **Step 4: コミットする**

```bash
git add data/portal-cards.json routes/api.js
git commit -m "feat: add portal cards config and /api/portal/* endpoints"
```

---

## Task 5: ポータルページ HTML の作成

**Files:**
- Create: `public/portal.html`
- Create: `public/portal.js`

- [ ] **Step 1: `public/portal.html` を作成する**

```html
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CreativeGroup ポータル</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@300;400;500;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/style.css">
  <style>
    .portal-header { background:#2c2c2c; color:#fff; padding:14px 24px; display:flex; justify-content:space-between; align-items:center; }
    .portal-logo { display:flex; align-items:center; gap:12px; }
    .portal-logo-mark { font-weight:700; font-size:18px; }
    .portal-logo-sub { font-size:11px; color:#aaa; }
    .user-badge { display:flex; align-items:center; gap:10px; font-size:13px; }
    .user-avatar { width:28px; height:28px; border-radius:50%; background:#4285f4; display:flex; align-items:center; justify-content:center; font-size:12px; color:#fff; overflow:hidden; }
    .user-avatar img { width:100%; height:100%; object-fit:cover; }
    .role-tag { background:#444; border-radius:4px; padding:2px 8px; font-size:11px; }
    .logout-link { color:#aaa; text-decoration:none; font-size:12px; }
    .logout-link:hover { color:#fff; }
    .portal-main { padding:28px 32px; background:#f8f7f4; min-height:calc(100vh - 56px); }
    .greeting { margin-bottom:24px; }
    .greeting h1 { font-size:22px; font-weight:700; color:#2c2c2c; margin:0 0 6px; }
    .greeting .sub { font-size:13px; color:#888; }
    .section-label { font-size:11px; font-weight:700; color:#888; letter-spacing:.08em; text-transform:uppercase; margin-bottom:12px; }
    .cards-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(220px, 1fr)); gap:14px; margin-bottom:28px; }
    .portal-card { background:#fff; border-radius:12px; padding:18px; border:1px solid #e5e2db; cursor:pointer; text-decoration:none; color:inherit; display:block; transition:box-shadow .15s, border-color .15s; }
    .portal-card:hover { box-shadow:0 4px 12px rgba(0,0,0,.08); border-color:#bbb; }
    .portal-card.coming { opacity:.55; cursor:default; pointer-events:none; }
    .card-top { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:12px; }
    .card-icon { font-size:26px; }
    .card-badge { font-size:10px; font-weight:700; border-radius:4px; padding:2px 8px; }
    .badge-active { background:#e8f5e9; color:#2e7d32; }
    .badge-phase1 { background:#e3f2fd; color:#1565c0; }
    .badge-coming { background:#f5f5f5; color:#888; }
    .badge-guide { background:#f8f7f4; color:#555; }
    .card-title { font-weight:700; font-size:14px; margin-bottom:5px; }
    .card-desc { font-size:12px; color:#888; line-height:1.6; }
    .admin-section { border-top:1px solid #e5e2db; padding-top:18px; }
    .admin-tools { display:flex; gap:10px; flex-wrap:wrap; }
    .admin-tool-link { background:#fff; border:1px solid #e5e2db; border-radius:8px; padding:9px 16px; font-size:13px; text-decoration:none; color:#2c2c2c; display:flex; align-items:center; gap:8px; }
    .admin-tool-link:hover { background:#f5f2ed; }
  </style>
</head>
<body>
  <header class="portal-header">
    <div class="portal-logo">
      <span class="portal-logo-mark">CG</span>
      <div>
        <div style="font-size:13px;font-weight:600">CreativeGroup</div>
        <div class="portal-logo-sub">データプラットフォーム</div>
      </div>
    </div>
    <div class="user-badge">
      <div class="user-avatar" id="user-avatar"><span id="user-initial">?</span></div>
      <span id="user-name">読み込み中...</span>
      <span class="role-tag" id="user-role-tag"></span>
      <a href="/auth/google/logout" class="logout-link">ログアウト</a>
    </div>
  </header>

  <main class="portal-main">
    <div class="greeting">
      <h1 id="greeting-text">こんにちは 👋</h1>
      <div class="sub" id="greeting-sub"></div>
    </div>

    <div class="section-label">ダッシュボード & ツール</div>
    <div class="cards-grid" id="cards-grid">
      <div style="color:#aaa;font-size:13px">読み込み中...</div>
    </div>

    <div class="admin-section" id="admin-section" style="display:none">
      <div class="section-label">管理ツール</div>
      <div class="admin-tools" id="admin-tools"></div>
    </div>
  </main>

  <script src="/portal.js"></script>
</body>
</html>
```

- [ ] **Step 2: `public/portal.js` を作成する**

```js
'use strict';

const ROLE_LABELS = {
  owner:    'オーナー',
  manager:  'マネージャー',
  employee: '社員',
  staff:    'スタッフ',
};

const STATUS_BADGE = {
  active:  { cls: 'badge-active',  text: '稼働中' },
  phase1:  { cls: 'badge-phase1',  text: 'Phase 1' },
  coming:  { cls: 'badge-coming',  text: '準備中' },
  guide:   { cls: 'badge-guide',   text: 'ガイド' },
};

async function init() {
  // ユーザー情報取得
  const me = await fetch('/api/portal/me').then(r => r.json());

  // ヘッダー更新
  document.getElementById('user-name').textContent = me.name || me.email;
  document.getElementById('user-role-tag').textContent = ROLE_LABELS[me.role] || me.role;
  const avatarEl = document.getElementById('user-avatar');
  if (me.picture) {
    avatarEl.innerHTML = `<img src="${me.picture}" alt="${me.name}">`;
  } else {
    document.getElementById('user-initial').textContent = (me.name || me.email)[0].toUpperCase();
  }

  // 挨拶
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'おはようございます' : hour < 18 ? 'こんにちは' : 'お疲れ様です';
  document.getElementById('greeting-text').textContent = `${greet}、${me.name?.split(' ')[0] || ''}さん 👋`;
  document.getElementById('greeting-sub').textContent =
    new Date().toLocaleDateString('ja-JP', { year:'numeric', month:'long', day:'numeric', weekday:'long' });

  // カード取得・描画
  const cards = await fetch('/api/portal/cards').then(r => r.json());
  const normalCards = cards.filter(c => !c.isAdmin);
  const adminCards  = cards.filter(c => c.isAdmin);

  const grid = document.getElementById('cards-grid');
  grid.innerHTML = normalCards.map(card => {
    const badge = STATUS_BADGE[card.status] || STATUS_BADGE.active;
    return `
      <a href="${card.href}" class="portal-card ${card.status === 'coming' ? 'coming' : ''}">
        <div class="card-top">
          <span class="card-icon">${card.icon}</span>
          <span class="card-badge ${badge.cls}">${badge.text}</span>
        </div>
        <div class="card-title">${card.title}</div>
        <div class="card-desc">${card.description}</div>
      </a>
    `;
  }).join('');

  if (adminCards.length > 0) {
    document.getElementById('admin-section').style.display = 'block';
    document.getElementById('admin-tools').innerHTML = adminCards.map(card => `
      <a href="${card.href}" class="admin-tool-link">${card.icon} ${card.title}</a>
    `).join('');
  }
}

init().catch(console.error);
```

- [ ] **Step 3: ポータルページを確認する**

```bash
npm start
```

`http://localhost:3000` → Google ログイン → `/portal`
Expected: カードグリッドが表示され、ロールに応じたカードが並ぶ。

- [ ] **Step 4: コミットする**

```bash
git add public/portal.html public/portal.js
git commit -m "feat: add portal hub page with role-based card grid"
```

---

## Task 6: dashboard.js の Basic Auth オーバーライドを削除する

**Files:**
- Modify: `public/dashboard.js`

- [ ] **Step 1: dashboard.js の Basic Auth fetch オーバーライドブロックを削除する**

`public/dashboard.js` の先頭にある以下のブロック（約18行）を完全に削除する：

```js
// 削除するブロック:
(function() {
  const _fetch = window.fetch.bind(window);
  window.fetch = function(input, init) {
    let url = typeof input === 'string' ? input : (input && input.url) || '';
    if (url.startsWith('/')) {
      url = location.protocol + '//' + location.hostname + (location.port ? ':' + location.port : '') + url;
    }
    init = Object.assign({}, init || {});
    init.headers = Object.assign(
      { 'Authorization': 'Basic ' + btoa('admin:creativegroup2025') },
      init.headers || {}
    );
    return _fetch(url, init);
  };
})();
```

- [ ] **Step 2: サーバーを再起動して売上ダッシュボードが動作することを確認する**

```bash
npm start
```

`http://localhost:3000/dashboard` にアクセスし、売上データが正常に表示されることを確認する。

- [ ] **Step 3: コミットする**

```bash
git add public/dashboard.js
git commit -m "fix: remove Basic Auth fetch override from dashboard.js"
```

---

## Task 7: 施策CRUD API の実装（routes/growth.js）

**Files:**
- Create: `data/initiatives.json`
- Create: `routes/growth.js`
- Modify: `tests/growth.test.js`

- [ ] **Step 1: テストを書く**

`tests/growth.test.js` に以下を記述する：

```js
'use strict';

const request  = require('supertest');
const express  = require('express');
const session  = require('express-session');
const fs       = require('fs');
const path     = require('path');

// テスト用の一時ファイルを使う
const TMP_FILE = path.join(__dirname, 'tmp-initiatives.json');
process.env.INITIATIVES_FILE = TMP_FILE;

const growthRouter = require('../routes/growth');

function buildApp(role = 'owner') {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: 'test', resave: false, saveUninitialized: false }));
  app.use((req, _res, next) => {
    req.session.googleUser = { email: 'test@test.com', role };
    next();
  });
  app.use('/', growthRouter);
  return app;
}

beforeEach(() => {
  fs.writeFileSync(TMP_FILE, JSON.stringify([]));
});

afterAll(() => {
  if (fs.existsSync(TMP_FILE)) fs.unlinkSync(TMP_FILE);
});

describe('GET /initiatives', () => {
  test('空のリストを返す', async () => {
    const res = await request(buildApp()).get('/initiatives');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe('POST /initiatives', () => {
  test('施策を追加してIDを返す', async () => {
    const payload = { title: 'テスト施策', impact: 8, confidence: 7, ease: 6, status: 'idea' };
    const res = await request(buildApp()).post('/initiatives').send(payload);
    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.iceScore).toBeCloseTo(7.0);
  });

  test('必須フィールド欠落で 400 を返す', async () => {
    const res = await request(buildApp()).post('/initiatives').send({ title: '不完全' });
    expect(res.status).toBe(400);
  });
});

describe('PUT /initiatives/:id', () => {
  test('ステータスを更新できる', async () => {
    const create = await request(buildApp()).post('/initiatives')
      .send({ title: '更新テスト', impact: 5, confidence: 5, ease: 5, status: 'idea' });
    const id = create.body.id;
    const update = await request(buildApp()).put(`/initiatives/${id}`).send({ status: 'in_progress' });
    expect(update.status).toBe(200);
    expect(update.body.status).toBe('in_progress');
  });
});

describe('DELETE /initiatives/:id', () => {
  test('施策を削除できる', async () => {
    const create = await request(buildApp()).post('/initiatives')
      .send({ title: '削除テスト', impact: 5, confidence: 5, ease: 5, status: 'idea' });
    const id = create.body.id;
    const del = await request(buildApp()).delete(`/initiatives/${id}`);
    expect(del.status).toBe(200);
    const list = await request(buildApp()).get('/initiatives');
    expect(list.body).toHaveLength(0);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認する**

```bash
npm test -- tests/growth.test.js
```

Expected: `Cannot find module '../routes/growth'` で失敗。

- [ ] **Step 3: `data/initiatives.json` を作成する**

```json
[]
```

- [ ] **Step 4: `routes/growth.js` を作成する**

```js
'use strict';
/**
 * routes/growth.js
 * グロースハック施策CRUD API
 *
 *   GET    /api/growth/initiatives        施策一覧（ICEスコア降順）
 *   POST   /api/growth/initiatives        施策を追加
 *   PUT    /api/growth/initiatives/:id    施策を更新
 *   DELETE /api/growth/initiatives/:id    施策を削除
 *   GET    /api/growth/kpi               KPIサマリー（BigQueryまたはモック）
 */

const express = require('express');
const path    = require('path');
const fs      = require('fs');
const crypto  = require('crypto');

const router = express.Router();

const INITIATIVES_FILE = process.env.INITIATIVES_FILE
  || path.join(__dirname, '..', 'data', 'initiatives.json');

// crypto.randomUUID は Node.js 14.17+ で利用可能
function newId() {
  return crypto.randomUUID();
}

function loadInitiatives() {
  try {
    return JSON.parse(fs.readFileSync(INITIATIVES_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveInitiatives(data) {
  fs.writeFileSync(INITIATIVES_FILE, JSON.stringify(data, null, 2));
}

function calcIce(impact, confidence, ease) {
  return Math.round(((impact + confidence + ease) / 3) * 10) / 10;
}

// GET /initiatives
router.get('/initiatives', (req, res) => {
  const list = loadInitiatives().sort((a, b) => b.iceScore - a.iceScore);
  res.json(list);
});

// POST /initiatives
router.post('/initiatives', (req, res) => {
  const { title, impact, confidence, ease, status, description } = req.body;
  if (!title || impact == null || confidence == null || ease == null) {
    return res.status(400).json({ error: 'title, impact, confidence, ease は必須です' });
  }
  const initiative = {
    id:          newId(),
    title,
    description: description || '',
    impact:      Number(impact),
    confidence:  Number(confidence),
    ease:        Number(ease),
    iceScore:    calcIce(Number(impact), Number(confidence), Number(ease)),
    status:      status || 'idea',
    createdAt:   new Date().toISOString(),
    updatedAt:   new Date().toISOString(),
    createdBy:   req.session?.googleUser?.email || 'unknown',
  };
  const list = loadInitiatives();
  list.push(initiative);
  saveInitiatives(list);
  res.status(201).json(initiative);
});

// PUT /initiatives/:id
router.put('/initiatives/:id', (req, res) => {
  const list = loadInitiatives();
  const idx  = list.findIndex(i => i.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: '施策が見つかりません' });

  const updated = { ...list[idx], ...req.body, updatedAt: new Date().toISOString() };
  if (req.body.impact || req.body.confidence || req.body.ease) {
    updated.iceScore = calcIce(updated.impact, updated.confidence, updated.ease);
  }
  list[idx] = updated;
  saveInitiatives(list);
  res.json(updated);
});

// DELETE /initiatives/:id
router.delete('/initiatives/:id', (req, res) => {
  const list    = loadInitiatives();
  const newList = list.filter(i => i.id !== req.params.id);
  if (newList.length === list.length) {
    return res.status(404).json({ error: '施策が見つかりません' });
  }
  saveInitiatives(newList);
  res.json({ ok: true });
});

// GET /kpi — モックデータを返す（BigQuery連携はPhase 1後半で実装）
router.get('/kpi', (req, res) => {
  const initiatives = loadInitiatives();
  res.json({
    monthlySales:     null,  // BigQuery連携後に実装
    newDeals:         null,
    retentionRate:    null,
    roas:             null,
    activeInitiatives: initiatives.filter(i => i.status === 'in_progress').length,
    funnel: {
      acquisition: null,
      interest:    null,
      conversion:  null,
      retention:   null,
      revenue:     null,
    },
    _mock: true,
    _message: 'BigQuery連携前のモックデータです',
  });
});

module.exports = router;
```

- [ ] **Step 5: テストが通ることを確認する**

```bash
npm test -- tests/growth.test.js
```

Expected: `Tests: 6 passed`

- [ ] **Step 6: コミットする**

```bash
git add data/initiatives.json routes/growth.js tests/growth.test.js
git commit -m "feat: add growth hack initiatives CRUD API with tests"
```

---

## Task 8: グロースハックダッシュボード HTML の作成

**Files:**
- Create: `public/growth.html`
- Create: `public/growth.js`

- [ ] **Step 1: `public/growth.html` を作成する**

```html
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>グロースハック — CreativeGroup</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@300;400;500;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/style.css">
  <style>
    body { background:#f8f7f4; }
    .gh-header { background:#2c2c2c; color:#fff; padding:12px 24px; display:flex; justify-content:space-between; align-items:center; }
    .gh-header a { color:#aaa; text-decoration:none; font-size:12px; }
    .gh-header a:hover { color:#fff; }
    .kpi-bar { display:grid; grid-template-columns:repeat(5,1fr); gap:10px; padding:16px 24px; background:#fff; border-bottom:1px solid #e5e2db; }
    .kpi-card { text-align:center; }
    .kpi-label { font-size:11px; color:#888; margin-bottom:4px; }
    .kpi-value { font-size:20px; font-weight:700; color:#2c2c2c; }
    .kpi-change { font-size:11px; margin-top:2px; }
    .kpi-change.up { color:#2e7d32; }
    .kpi-change.down { color:#c62828; }
    .gh-body { display:grid; grid-template-columns:260px 1fr; gap:0; min-height:calc(100vh - 130px); }
    .funnel-panel { padding:16px 20px; border-right:1px solid #e5e2db; background:#fff; }
    .panel-title { font-size:11px; font-weight:700; color:#888; letter-spacing:.08em; margin-bottom:12px; }
    .funnel-step { display:flex; justify-content:space-between; align-items:center; border-radius:6px; padding:8px 12px; margin-bottom:5px; font-size:12px; color:#fff; }
    .funnel-bottleneck { background:#fff8e1; border-radius:6px; padding:8px 10px; font-size:11px; color:#f57f17; margin-top:10px; }
    .initiatives-panel { padding:16px 24px; }
    .initiatives-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; }
    .btn-add { background:#2c2c2c; color:#fff; border:none; border-radius:6px; padding:7px 14px; font-size:12px; cursor:pointer; font-family:inherit; }
    .btn-add:hover { background:#444; }
    .ice-table { width:100%; border-collapse:collapse; font-size:13px; }
    .ice-table th { text-align:left; padding:6px 10px; font-size:11px; font-weight:700; color:#888; border-bottom:2px solid #e5e2db; }
    .ice-table th.center { text-align:center; }
    .ice-table td { padding:10px; border-bottom:1px solid #f0ede8; }
    .ice-table td.center { text-align:center; }
    .ice-score { font-weight:700; }
    .score-high { color:#2e7d32; }
    .score-mid  { color:#1565c0; }
    .score-low  { color:#f57f17; }
    .status-badge { display:inline-block; border-radius:4px; padding:2px 8px; font-size:10px; font-weight:700; }
    .status-idea        { background:#f5f5f5; color:#555; }
    .status-planned     { background:#e3f2fd; color:#1565c0; }
    .status-in_progress { background:#e8f5e9; color:#2e7d32; }
    .status-done        { background:#f3e5f5; color:#6a1b9a; }
    /* ツールチップ */
    .tip { position:relative; display:inline-flex; align-items:center; justify-content:center; width:15px; height:15px; background:#e5e2db; border-radius:50%; font-size:9px; cursor:pointer; color:#555; margin-left:4px; vertical-align:middle; }
    .tip-body { display:none; position:absolute; bottom:120%; left:50%; transform:translateX(-50%); background:#2c2c2c; color:#fff; border-radius:6px; padding:6px 10px; font-size:11px; white-space:nowrap; z-index:100; font-weight:400; }
    .tip:hover .tip-body { display:block; }
    /* モーダル */
    .modal-overlay { display:none; position:fixed; inset:0; background:rgba(0,0,0,.4); z-index:200; align-items:center; justify-content:center; }
    .modal-overlay.open { display:flex; }
    .modal { background:#fff; border-radius:12px; padding:24px; width:480px; max-width:90vw; }
    .modal h3 { margin:0 0 16px; font-size:16px; }
    .form-group { margin-bottom:14px; }
    .form-label { display:block; font-size:12px; font-weight:700; color:#555; margin-bottom:5px; }
    .form-input { width:100%; box-sizing:border-box; padding:8px 10px; border:1px solid #ddd; border-radius:6px; font-size:13px; font-family:inherit; }
    .form-input:focus { outline:none; border-color:#2c2c2c; }
    .score-inputs { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; }
    .modal-footer { display:flex; justify-content:flex-end; gap:10px; margin-top:16px; }
    .btn-cancel { background:#f5f5f5; border:none; border-radius:6px; padding:8px 16px; cursor:pointer; font-family:inherit; }
    .btn-save { background:#2c2c2c; color:#fff; border:none; border-radius:6px; padding:8px 16px; cursor:pointer; font-family:inherit; }
  </style>
</head>
<body>
  <header class="gh-header">
    <div style="display:flex;align-items:center;gap:12px">
      <a href="/portal">← ポータルへ</a>
      <span style="color:#555">|</span>
      <span style="font-weight:700">🚀 グロースハック</span>
    </div>
    <a href="/guide#growth">使い方ガイド 📖</a>
  </header>

  <!-- KPIサマリー -->
  <div class="kpi-bar">
    <div class="kpi-card">
      <div class="kpi-label">月次売上</div>
      <div class="kpi-value" id="kpi-sales">—</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">新規案件</div>
      <div class="kpi-value" id="kpi-deals">—</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">継続率</div>
      <div class="kpi-value" id="kpi-retention">—</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">広告ROAS</div>
      <div class="kpi-value" id="kpi-roas">—</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">施策実行中</div>
      <div class="kpi-value" id="kpi-active" style="color:#1565c0">0</div>
    </div>
  </div>

  <div class="gh-body">
    <!-- ファネル -->
    <div class="funnel-panel">
      <div class="panel-title">グロースファネル</div>
      <div id="funnel-steps"></div>
      <div class="funnel-bottleneck" id="funnel-note" style="display:none"></div>
    </div>

    <!-- 施策管理 -->
    <div class="initiatives-panel">
      <div class="initiatives-header">
        <div class="panel-title" style="margin:0">
          施策管理 × ICEスコア
          <span class="tip">?<span class="tip-body">ICE = Impact・Confidence・Ease の平均。高いほど優先度が高い。</span></span>
        </div>
        <button class="btn-add" onclick="openModal()">＋ 施策を追加</button>
      </div>
      <table class="ice-table">
        <thead>
          <tr>
            <th>施策名</th>
            <th class="center">
              Impact<span class="tip">?<span class="tip-body">この施策が成功した場合のビジネスへの影響度（1〜10）</span></span>
            </th>
            <th class="center">
              Confidence<span class="tip">?<span class="tip-body">この施策が効果を出せるという自信の度合い（1〜10）</span></span>
            </th>
            <th class="center">
              Ease<span class="tip">?<span class="tip-body">実装・実行のしやすさ（1〜10）</span></span>
            </th>
            <th class="center">ICE</th>
            <th class="center">ステータス</th>
          </tr>
        </thead>
        <tbody id="initiatives-tbody">
          <tr><td colspan="6" style="text-align:center;color:#aaa;padding:20px">施策がまだありません。追加してください。</td></tr>
        </tbody>
      </table>
    </div>
  </div>

  <!-- 施策追加モーダル -->
  <div class="modal-overlay" id="modal">
    <div class="modal">
      <h3>施策を追加</h3>
      <div class="form-group">
        <label class="form-label">施策名 <span style="color:#c62828">*</span></label>
        <input class="form-input" id="f-title" placeholder="例: Metaリターゲティング広告の最適化">
      </div>
      <div class="form-group">
        <label class="form-label">内容・仮説</label>
        <input class="form-input" id="f-desc" placeholder="例: CVRが低いページの訪問者に再アプローチ">
      </div>
      <div class="form-group">
        <label class="form-label">ICEスコア（各 1〜10）</label>
        <div class="score-inputs">
          <div>
            <div style="font-size:11px;color:#888;margin-bottom:4px">Impact</div>
            <input class="form-input" id="f-impact" type="number" min="1" max="10" value="5">
          </div>
          <div>
            <div style="font-size:11px;color:#888;margin-bottom:4px">Confidence</div>
            <input class="form-input" id="f-confidence" type="number" min="1" max="10" value="5">
          </div>
          <div>
            <div style="font-size:11px;color:#888;margin-bottom:4px">Ease</div>
            <input class="form-input" id="f-ease" type="number" min="1" max="10" value="5">
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn-cancel" onclick="closeModal()">キャンセル</button>
        <button class="btn-save" onclick="saveInitiative()">追加する</button>
      </div>
    </div>
  </div>

  <script src="/growth.js"></script>
</body>
</html>
```

- [ ] **Step 2: `public/growth.js` を作成する**

```js
'use strict';

const STATUS_LABELS = {
  idea:        { text: 'アイデア',  cls: 'status-idea' },
  planned:     { text: '計画中',    cls: 'status-planned' },
  in_progress: { text: '実行中',    cls: 'status-in_progress' },
  done:        { text: '完了',      cls: 'status-done' },
};

const FUNNEL_STEPS = [
  { key: 'acquisition', label: 'Acquisition（認知）', color: '#1565c0' },
  { key: 'interest',    label: 'Interest（興味）',    color: '#1976d2' },
  { key: 'conversion',  label: 'Conversion（成約）',  color: '#42a5f5' },
  { key: 'retention',   label: 'Retention（継続）',   color: '#90caf9' },
  { key: 'revenue',     label: 'Revenue（売上）',     color: '#bbdefb' },
];

async function loadKpi() {
  const kpi = await fetch('/api/growth/kpi').then(r => r.json());
  document.getElementById('kpi-sales').textContent     = kpi.monthlySales ? `¥${(kpi.monthlySales/1000000).toFixed(1)}M` : '—';
  document.getElementById('kpi-deals').textContent     = kpi.newDeals     ?? '—';
  document.getElementById('kpi-retention').textContent = kpi.retentionRate ? `${kpi.retentionRate}%` : '—';
  document.getElementById('kpi-roas').textContent      = kpi.roas         ? `${kpi.roas}x` : '—';
  document.getElementById('kpi-active').textContent    = kpi.activeInitiatives ?? 0;

  // ファネル描画
  const stepsEl = document.getElementById('funnel-steps');
  const margin = [0, 12, 24, 36, 48];
  stepsEl.innerHTML = FUNNEL_STEPS.map((step, i) => {
    const val = kpi.funnel?.[step.key];
    const textColor = i >= 3 ? '#2c2c2c' : '#fff';
    return `<div class="funnel-step" style="background:${step.color};margin:0 ${margin[i]}px 5px;color:${textColor}">
      <span>${step.label}</span>
      <strong>${val ?? '—'}</strong>
    </div>`;
  }).join('');
}

async function loadInitiatives() {
  const list = await fetch('/api/growth/initiatives').then(r => r.json());
  const tbody = document.getElementById('initiatives-tbody');
  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#aaa;padding:20px">施策がまだありません。追加してください。</td></tr>';
    return;
  }
  tbody.innerHTML = list.map(item => {
    const s = STATUS_LABELS[item.status] || STATUS_LABELS.idea;
    const scoreClass = item.iceScore >= 7 ? 'score-high' : item.iceScore >= 5 ? 'score-mid' : 'score-low';
    return `<tr>
      <td>
        <div style="font-weight:600">${escHtml(item.title)}</div>
        ${item.description ? `<div style="font-size:11px;color:#888;margin-top:2px">${escHtml(item.description)}</div>` : ''}
      </td>
      <td class="center">${item.impact}</td>
      <td class="center">${item.confidence}</td>
      <td class="center">${item.ease}</td>
      <td class="center ice-score ${scoreClass}">${item.iceScore}</td>
      <td class="center">
        <select class="form-input" style="font-size:11px;padding:3px 6px;width:auto" onchange="updateStatus('${item.id}', this.value)">
          ${Object.entries(STATUS_LABELS).map(([v, l]) =>
            `<option value="${v}" ${item.status === v ? 'selected' : ''}>${l.text}</option>`
          ).join('')}
        </select>
      </td>
    </tr>`;
  }).join('');
}

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function openModal() {
  document.getElementById('modal').classList.add('open');
  document.getElementById('f-title').focus();
}

function closeModal() {
  document.getElementById('modal').classList.remove('open');
}

async function saveInitiative() {
  const title      = document.getElementById('f-title').value.trim();
  const impact     = Number(document.getElementById('f-impact').value);
  const confidence = Number(document.getElementById('f-confidence').value);
  const ease       = Number(document.getElementById('f-ease').value);
  const description = document.getElementById('f-desc').value.trim();

  if (!title) { alert('施策名を入力してください'); return; }

  await fetch('/api/growth/initiatives', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ title, impact, confidence, ease, description, status: 'idea' }),
  });

  closeModal();
  document.getElementById('f-title').value = '';
  document.getElementById('f-desc').value  = '';
  loadInitiatives();
}

async function updateStatus(id, status) {
  await fetch(`/api/growth/initiatives/${id}`, {
    method:  'PUT',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ status }),
  });
  loadKpi(); // KPIの「実行中」カウントを更新
}

// モーダル外クリックで閉じる
document.getElementById('modal').addEventListener('click', e => {
  if (e.target === e.currentTarget) closeModal();
});

loadKpi();
loadInitiatives();
```

- [ ] **Step 3: グロースハックページを確認する**

`http://localhost:3000/growth` にアクセス。
Expected:
- KPIサマリーが「—」で表示（BigQuery未連携のため）
- ファネルが「—」で表示
- 施策テーブルが空で表示
- 「＋ 施策を追加」ボタンをクリック → モーダルが開く
- 施策を追加 → テーブルに表示されICEスコアが計算される

- [ ] **Step 4: コミットする**

```bash
git add public/growth.html public/growth.js
git commit -m "feat: add growth hack dashboard with ICE scoring and funnel"
```

---

## Task 9: ポータル全体リファレンスガイドの作成

**Files:**
- Create: `public/guide.html`

- [ ] **Step 1: `public/guide.html` を作成する**

```html
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ポータルガイド — CreativeGroup</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@300;400;500;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/style.css">
  <style>
    body { background:#f8f7f4; }
    .guide-header { background:#2c2c2c; color:#fff; padding:12px 24px; display:flex; justify-content:space-between; align-items:center; }
    .guide-header a { color:#aaa; text-decoration:none; font-size:12px; }
    .guide-layout { display:grid; grid-template-columns:220px 1fr; min-height:calc(100vh - 48px); }
    .guide-nav { background:#fff; border-right:1px solid #e5e2db; padding:20px 16px; position:sticky; top:0; height:100vh; overflow-y:auto; }
    .nav-section { margin-bottom:20px; }
    .nav-label { font-size:10px; font-weight:700; color:#aaa; letter-spacing:.1em; text-transform:uppercase; margin-bottom:8px; }
    .nav-link { display:block; padding:6px 8px; border-radius:6px; font-size:13px; color:#555; text-decoration:none; margin-bottom:2px; }
    .nav-link:hover { background:#f5f2ed; color:#2c2c2c; }
    .guide-content { padding:32px 48px; max-width:780px; }
    .guide-content h2 { font-size:20px; font-weight:700; margin:36px 0 12px; padding-top:20px; border-top:1px solid #e5e2db; color:#2c2c2c; }
    .guide-content h2:first-child { border-top:none; margin-top:0; }
    .guide-content h3 { font-size:15px; font-weight:700; margin:20px 0 8px; color:#2c2c2c; }
    .guide-content p { font-size:14px; line-height:1.8; color:#444; margin:0 0 12px; }
    .guide-content ul { font-size:14px; line-height:1.8; color:#444; margin:0 0 12px; padding-left:20px; }
    .callout { background:#e3f2fd; border-left:4px solid #1565c0; border-radius:0 8px 8px 0; padding:12px 16px; margin:12px 0; font-size:13px; color:#1a237e; }
    .callout.tip { background:#e8f5e9; border-color:#2e7d32; color:#1b5e20; }
    .callout.warn { background:#fff8e1; border-color:#f57f17; color:#e65100; }
    .ice-demo { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; margin:12px 0; }
    .ice-box { background:#fff; border:1px solid #e5e2db; border-radius:8px; padding:12px; text-align:center; }
    .ice-box .label { font-size:11px; color:#888; margin-bottom:4px; }
    .ice-box .val { font-size:24px; font-weight:700; }
    .ice-box .desc { font-size:11px; color:#555; margin-top:4px; line-height:1.5; }
    .dashboard-cards { display:grid; grid-template-columns:repeat(2,1fr); gap:10px; margin:12px 0; }
    .dashboard-card { background:#fff; border:1px solid #e5e2db; border-radius:8px; padding:12px; }
    .dashboard-card .icon { font-size:20px; margin-bottom:6px; }
    .dashboard-card .title { font-weight:700; font-size:13px; margin-bottom:4px; }
    .dashboard-card .desc { font-size:12px; color:#888; line-height:1.6; }
  </style>
</head>
<body>
  <header class="guide-header">
    <div style="display:flex;align-items:center;gap:12px">
      <a href="/portal">← ポータルへ</a>
      <span style="color:#555">|</span>
      <span style="font-weight:700">📖 ポータルガイド</span>
    </div>
  </header>

  <div class="guide-layout">
    <!-- サイドナビ -->
    <nav class="guide-nav">
      <div class="nav-section">
        <div class="nav-label">はじめに</div>
        <a class="nav-link" href="#portal">ポータルの使い方</a>
        <a class="nav-link" href="#roles">ロールについて</a>
      </div>
      <div class="nav-section">
        <div class="nav-label">グロースハック</div>
        <a class="nav-link" href="#growth">グロースハックとは</a>
        <a class="nav-link" href="#funnel">ファネルの読み方</a>
        <a class="nav-link" href="#ice">ICEスコアの使い方</a>
        <a class="nav-link" href="#initiative">良い施策の書き方</a>
      </div>
      <div class="nav-section">
        <div class="nav-label">各ダッシュボード</div>
        <a class="nav-link" href="#dash-sales">売上ダッシュボード</a>
        <a class="nav-link" href="#dash-ads">広告ROAS</a>
        <a class="nav-link" href="#dash-pamun">Pamunアンケート</a>
        <a class="nav-link" href="#dash-trepo">Trepo分析</a>
      </div>
    </nav>

    <!-- コンテンツ -->
    <main class="guide-content">
      <h2 id="portal">ポータルの使い方</h2>
      <p>このポータルは CreativeGroup の全データを一箇所で管理するためのハブです。ログイン後に表示されるカード一覧から、各ダッシュボードやツールにアクセスできます。</p>
      <div class="dashboard-cards">
        <div class="dashboard-card"><div class="icon">📊</div><div class="title">売上ダッシュボード</div><div class="desc">MFクラウドの請求データを可視化。月次売上・未入金・チーム別・クライアント別に確認できます。</div></div>
        <div class="dashboard-card"><div class="icon">🚀</div><div class="title">グロースハック</div><div class="desc">会社の成長施策を管理。KPIのボトルネック発見とICEスコアによる施策の優先順位付けができます。</div></div>
        <div class="dashboard-card"><div class="icon">📱</div><div class="title">広告ROAS（準備中）</div><div class="desc">Google/Meta/TikTok広告のROASをチャネル横断で比較。予算の最適配分に活用します。</div></div>
        <div class="dashboard-card"><div class="icon">📝</div><div class="title">Pamunアンケート</div><div class="desc">Pamunのアンケート回答データを分析。満足度トレンドやフィードバックの傾向を把握できます。</div></div>
      </div>

      <h2 id="roles">ロールについて</h2>
      <p>このポータルでは5種類のロールに応じてアクセスできる機能が異なります。</p>
      <ul>
        <li><strong>オーナー / マネージャー</strong> — 全機能にアクセス・編集可能</li>
        <li><strong>社員</strong> — 売上閲覧・グロースハック編集・広告/Pamun/Trepo閲覧</li>
        <li><strong>スタッフ</strong> — 自分に関係する売上・グロースハック閲覧・自分のTrepoデータ</li>
        <li><strong>外部</strong> — 管理者が発行した個別URLのみアクセス可能</li>
      </ul>
      <div class="callout">ロールの変更は管理者にお問い合わせください。Googleアカウントのメールアドレスで管理されています。</div>

      <h2 id="growth">グロースハックとは</h2>
      <p>グロースハック（Growth Hacking）とは、データに基づいて仮説を立て、素早く実験し、効果のある施策を見つけて拡大していくアプローチです。</p>
      <p>伝統的なマーケティングが「予算を使って認知を広げる」のに対し、グロースハックは「少ないコストで最大の成長を生む」ことを目指します。</p>
      <div class="callout tip">💡 グロースハックの核心は「試す→測る→学ぶ」の繰り返しです。完璧な施策より、多くの実験が重要です。</div>

      <h2 id="funnel">ファネルの読み方</h2>
      <p>グロースファネルは「認知 → 興味 → 成約 → 継続 → 売上」の流れを可視化したものです。各ステップで顧客がどれだけ次に進んでいるかを見ます。</p>
      <ul>
        <li><strong>Acquisition（認知）</strong> — 広告・SNS・紹介などで知ってもらった人数</li>
        <li><strong>Interest（興味）</strong> — 問い合わせ・資料請求など興味を示した数</li>
        <li><strong>Conversion（成約）</strong> — 実際に契約・購入した数</li>
        <li><strong>Retention（継続）</strong> — 継続して利用している顧客数</li>
        <li><strong>Revenue（売上）</strong> — 顧客から得た売上金額</li>
      </ul>
      <div class="callout warn">⚠️ 最も転換率が低いステップが「ボトルネック」です。そこを改善する施策が最も効果的です。</div>

      <h2 id="ice">ICEスコアの使い方</h2>
      <p>ICEスコアは施策の優先順位を決めるためのフレームワークです。3つの指標を1〜10で採点し、その平均を出します。</p>
      <div class="ice-demo">
        <div class="ice-box">
          <div class="label">Impact（影響度）</div>
          <div class="val" style="color:#2e7d32">8</div>
          <div class="desc">成功した場合にビジネスにどれだけ影響を与えるか</div>
        </div>
        <div class="ice-box">
          <div class="label">Confidence（自信度）</div>
          <div class="val" style="color:#1565c0">7</div>
          <div class="desc">この施策が実際に効果を出せると思う確信の度合い</div>
        </div>
        <div class="ice-box">
          <div class="label">Ease（実行容易度）</div>
          <div class="val" style="color:#f57f17">6</div>
          <div class="desc">施策を実装・実行するのがどれだけ簡単か</div>
        </div>
      </div>
      <p>上記の例では ICEスコア = (8 + 7 + 6) ÷ 3 = <strong>7.0</strong> となります。スコアが高い施策から優先的に実行します。</p>
      <div class="callout">採点は直感で構いません。チーム内で議論しながら付けることで、優先順位の認識をそろえることが目的です。</div>

      <h2 id="initiative">良い施策の書き方</h2>
      <h3>テンプレート</h3>
      <p>「<strong>（対象）</strong> に対して <strong>（施策）</strong> を行うことで、<strong>（指標）</strong> が改善できると仮説する」</p>
      <h3>具体例</h3>
      <ul>
        <li>「商談後フォローしていないリードに対してメール自動送信を行うことで、Conversion率が改善できると仮説する」</li>
        <li>「既存クライアントに対して月次レポートを自動送付することで、Retention率が改善できると仮説する」</li>
      </ul>
      <div class="callout tip">💡 施策は小さく始めましょう。2週間以内に結果が出るものが理想です。大きな施策は小さく分割してください。</div>

      <h2 id="dash-sales">売上ダッシュボードの読み方</h2>
      <p>MFクラウドの請求データをリアルタイムで取得・集計しています。月次・チーム別・クライアント別の売上を確認できます。未入金の請求書も一覧で確認でき、フォローアップに使えます。</p>

      <h2 id="dash-ads">広告ROASの読み方</h2>
      <p>ROAS（Return On Advertising Spend）= 売上 ÷ 広告費。3.0以上が一般的な目安です。チャネルごとのROASを比較することで、予算を最も効果的な媒体に集中させることができます。（Phase 2で実装予定）</p>

      <h2 id="dash-pamun">Pamunアンケートの見方</h2>
      <p>PamunユーザーのアンケートデータがBigQueryに日次同期されています。満足度の推移・フリーコメントのトレンドを把握し、サービス改善の優先順位付けに活用してください。</p>

      <h2 id="dash-trepo">Trepo分析の見方</h2>
      <p>Trepoの記事データ（360件）とGA4の流入データを連携。記事ごとのPV・ランクシステムのKPI・インターン生の活動データを確認できます。スタッフは自分のデータのみ閲覧できます。</p>
    </main>
  </div>
</body>
</html>
```

- [ ] **Step 2: ガイドページを確認する**

`http://localhost:3000/guide` にアクセス。
Expected:
- 左サイドナビが表示される
- 各セクションに正しくスクロールできる
- サイドナビの各リンクが対応セクションに飛ぶ

- [ ] **Step 3: コミットする**

```bash
git add public/guide.html
git commit -m "feat: add portal-wide reference guide with growth hacking tutorial"
```

---

## Task 10: 全体動作確認 & ドキュメント更新

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: 全テストを実行する**

```bash
npm test
```

Expected: `Test Suites: 2 passed, Tests: 11 passed`

- [ ] **Step 2: エンドツーエンドで動作確認する**

以下の順序で確認する：

```
1. http://localhost:3000
   → /auth/google にリダイレクト

2. roles.json に登録済みのGoogleアカウントでログイン
   → /portal にリダイレクト

3. ポータルで各カードをクリック
   → 各ダッシュボード・ガイドにアクセスできる

4. /growth にアクセス
   → 施策追加ボタンで施策を追加できる
   → ICEスコアが自動計算される
   → ステータスを変更できる

5. /guide にアクセス
   → 全セクションが読める
   → サイドナビが機能する

6. /auth/google/logout
   → /auth/google にリダイレクト（ログアウト確認）

7. スタッフロールのアカウントで /classify にアクセス
   → 403エラーが返ることを確認
```

- [ ] **Step 3: `CLAUDE.md` にPhase 0 / Phase 1 の完了を記録する**

`CLAUDE.md` の「Claude Codeへの追加タスク」セクションに以下を追記する：

```markdown
### 完了済み（2026-05-20）

#### Phase 0 — Google OAuth + ポータル
- ✅ Google OAuth 2.0（passport.js）実装
- ✅ 5ロール権限管理（data/roles.json）
- ✅ ポータルハブページ（/portal）
- ✅ ポータル全体リファレンスガイド（/guide）
- ✅ 既存ダッシュボードの認証ミドルウェア適用

#### Phase 1 — グロースハックダッシュボード
- ✅ 施策CRUD API（routes/growth.js）
- ✅ ICEスコア自動計算
- ✅ グロースハックダッシュボード（/growth）
- ✅ インラインヘルプ（ツールチップ）

#### 次のフェーズ（Phase 2）
- 広告媒体API連携（Google Ads / Meta / TikTok）
- チャネル横断ROASダッシュボード
→ 別スペック・別プランで実施
```

- [ ] **Step 4: 最終コミットをする**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md with Phase 0/1 completion status"
```

---

## セットアップチェックリスト（初回）

Google OAuth を使うために必要な事前設定：

1. [GCP Console](https://console.cloud.google.com/) → `cg-project-491303` を選択
2. **APIとサービス → 認証情報 → OAuth 2.0 クライアントID** を作成
   - アプリケーションの種類: **ウェブアプリケーション**
   - 承認済みのリダイレクトURI: `http://localhost:3000/auth/google/callback`
3. `Client ID` と `Client Secret` を `.env` に設定
4. `data/roles.json` に自分のGoogleアカウントのメールアドレスを `"owner"` で登録
5. `npm start` → `http://localhost:3000` でログインできることを確認
