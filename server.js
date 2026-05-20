'use strict';
/**
 * server.js — CreativeGroup 経営ダッシュボード
 *
 * 構成:
 *   - Express + express-session
 *   - Basic認証（ダッシュボード閲覧をパスワード保護）
 *   - MFクラウド OAuth 2.0 フロー（routes/auth.js）
 *   - MFクラウド APIプロキシ（routes/api.js）
 *
 * トークン管理:
 *   管理者が一度だけ /auth/login から認証すれば、取得したアクセストークンを
 *   app.locals.sharedToken にサーバーレベルで保持する。
 *   全閲覧者（Basic認証を通過した社内メンバー）がトークンを共有する。
 */

require('dotenv').config({ override: true });

const express      = require('express');
const session      = require('express-session');
const path         = require('path');
const basicAuth    = require('express-basic-auth');

const { router: authRouter, callbackHandler } = require('./routes/auth');
const apiRouter                               = require('./routes/api');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── サーバーレベルの共有トークン ──────────────────────────
// 管理者が一度 MFクラウドで認証したあと、全閲覧者で共有する。
// app.locals に置くことで routes/auth.js・routes/api.js から
// req.app.locals.sharedToken として参照できる。
app.locals.sharedToken = {
  accessToken:  null,
  refreshToken: null,
  tokenExpiry:  null,
};

// ── ミドルウェア ──────────────────────────────────────────
app.use(express.json({ limit: '5mb' }));

// Basic認証 — ダッシュボード全体をパスワード保護
// DASHBOARD_USER / DASHBOARD_PASS を .env に設定していない場合はデフォルト値を使用
const dashUser = process.env.DASHBOARD_USER || 'admin';
const dashPass = process.env.DASHBOARD_PASS || 'password';
app.use(basicAuth({
  users:     { [dashUser]: dashPass },
  challenge: true,
  realm:     'CreativeGroup Dashboard',
}));

// 静的ファイル（public/）
app.use(express.static(path.join(__dirname, 'public')));

// セッション（将来的な拡張のために保持）
app.use(session({
  secret:            process.env.SESSION_SECRET || 'cg_secret',
  resave:            false,
  saveUninitialized: false,
  cookie:            { maxAge: 24 * 60 * 60 * 1000 }, // 24時間
}));

// ── ルーティング ──────────────────────────────────────────

// OAuth フロー: /auth/login, /auth/logout
app.use('/auth', authRouter);

// OAuth コールバック: GET /callback
// MF_REDIRECT_URI=http://localhost:3000/callback に合わせてルートレベルに配置
app.get('/callback', callbackHandler);

// APIプロキシ: /api/*
app.use('/api', apiRouter);

// トップページ — 認証状態に応じてリダイレクト
app.get('/', (req, res) => {
  if (req.app.locals.sharedToken.accessToken) {
    res.redirect('/dashboard.html');
  } else {
    // index.html が JS で /api/auth-status を叩いて状態表示する
    res.redirect('/index.html');
  }
});

// ── サーバー起動 ──────────────────────────────────────────
app.listen(PORT, () => {
  const clientIdStatus = process.env.MF_CLIENT_ID     ? '設定済み' : '未設定 ← .envを確認';
  const basicStatus    = process.env.DASHBOARD_USER   ? '設定済み' : `デフォルト(${dashUser})`;

  console.log(`
  ┌─────────────────────────────────────────────┐
  │  CreativeGroup 経営ダッシュボード             │
  │  http://localhost:${PORT}                       │
  │                                             │
  │  MF_CLIENT_ID : ${clientIdStatus.padEnd(20)} │
  │  Basic Auth   : ${basicStatus.padEnd(20)} │
  │                                             │
  │  初回セットアップ:                           │
  │    1. http://localhost:${PORT}/auth/login       │
  │    2. MFクラウドで承認                       │
  │    3. ダッシュボードが表示される             │
  └─────────────────────────────────────────────┘
  `);
});
