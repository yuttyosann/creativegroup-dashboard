'use strict';
/**
 * server.js — CreativeGroup 経営ダッシュボード
 *
 * 構成:
 *   - Express + express-session
 *   - Google OAuth 2.0（passport.js）— ポータル認証
 *   - MFクラウド OAuth 2.0（routes/auth.js）— 請求書APIトークン取得
 *   - ロールベースアクセス制御（middleware/auth.js + data/roles.json）
 *   - MFクラウド APIプロキシ（routes/api.js）
 */

require('dotenv').config({ override: true });

const express  = require('express');
const session  = require('express-session');
const passport = require('passport');
const path     = require('path');

const { router: authRouter, callbackHandler } = require('./routes/auth');
const apiRouter                               = require('./routes/api');
const { requireAuth, requireRole }            = require('./middleware/auth');
// TODO Task 7: growthRouter を追加する
// const growthRouter = require('./routes/growth');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── サーバーレベルの共有トークン（MFクラウド用）──────────
app.locals.sharedToken = {
  accessToken:  null,
  refreshToken: null,
  tokenExpiry:  null,
};

// ── ミドルウェア ──────────────────────────────────────────
app.use(express.json({ limit: '5mb' }));

// セッション
app.use(session({
  secret:            process.env.SESSION_SECRET || 'cg_secret',
  resave:            false,
  saveUninitialized: false,
  cookie: {
    maxAge:   24 * 60 * 60 * 1000, // 24時間
    httpOnly: true,
    sameSite: 'lax',
    // secure: true を本番環境（HTTPS）では有効化すること
  },
}));

// passport（Google OAuth）
app.use(passport.initialize());
app.use(passport.session());

// 静的ファイル（認証不要: CSS/JS/画像など）
app.use(express.static(path.join(__dirname, 'public')));

// ── ルーティング ──────────────────────────────────────────

// 認証フロー（Google OAuth + MFクラウドOAuth）
app.use('/auth', authRouter);
app.get('/callback', callbackHandler); // MFクラウドOAuthコールバック

// ポータル（要ログイン）
app.get('/portal', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'portal.html'));
});

// グロースハック（要ログイン・社員以上）
app.get('/growth', requireAuth, requireRole(['owner', 'manager', 'employee']), (req, res) => {
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
app.get('/classify', requireAuth, requireRole(['owner', 'manager']), (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'classify.html'));
});

// APIプロキシ（MFクラウド）
app.use('/api', requireAuth, apiRouter);
// TODO Task 7: 施策CRUD / KPI API を有効化する
// app.use('/api/growth', requireAuth, growthRouter);

// ルート → ログイン済みならポータルへ、未ログインならGoogleログインへ
app.get('/', (req, res) => {
  if (req.session?.googleUser) {
    res.redirect('/portal');
  } else {
    res.redirect('/auth/google');
  }
});

// ── サーバー起動 ──────────────────────────────────────────
app.listen(PORT, () => {
  const googleStatus = process.env.GOOGLE_CLIENT_ID ? '設定済み' : '未設定 ← .envを確認';
  const mfStatus     = process.env.MF_CLIENT_ID     ? '設定済み' : '未設定';

  console.log(`
  ┌─────────────────────────────────────────────┐
  │  CreativeGroup データプラットフォーム         │
  │  http://localhost:${PORT}                       │
  │                                             │
  │  Google OAuth : ${googleStatus.padEnd(20)} │
  │  MF_CLIENT_ID : ${mfStatus.padEnd(20)} │
  │                                             │
  │  アクセス: http://localhost:${PORT}             │
  │  → Googleログイン画面にリダイレクト          │
  └─────────────────────────────────────────────┘
  `);
});
