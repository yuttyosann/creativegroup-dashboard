'use strict';
/**
 * routes/auth.js
 * MFクラウド OAuth 2.0 認証ルート
 *
 * - GET /auth/login   → MFクラウド認可ページへリダイレクト
 * - GET /callback     → 認可コードをアクセストークンに交換
 * - GET /auth/logout  → トークンをクリアしてルートへリダイレクト
 */

const express = require('express');
const axios   = require('axios');
const router  = express.Router();

// MFクラウド認証エンドポイント（app-portal登録アプリ用）
const MF_AUTH_URL   = 'https://api.biz.moneyforward.com/authorize';
const MF_TOKEN_URL  = 'https://api.biz.moneyforward.com/token';

// 要求スコープ — MFクラウド請求書APIの読み取り権限
const SCOPES = 'mfc/invoice/data.read';

/**
 * buildAuthUrl — OAuth 2.0 Authorization Code フロー用のリダイレクトURLを生成する
 *
 * @returns {string} 認可エンドポイントURL（クエリ付き）
 */
function buildAuthUrl() {
  const params = new URLSearchParams({
    client_id:     process.env.MF_CLIENT_ID,
    redirect_uri:  process.env.MF_REDIRECT_URI,
    response_type: 'code',
    scope:         SCOPES,
  });
  return `${MF_AUTH_URL}?${params}`;
}

/**
 * exchangeCodeForToken — 認可コードをアクセストークンに交換する
 *
 * @param {string} code - MFクラウドから返された認可コード
 * @returns {Promise<{accessToken, refreshToken, expiresIn}>}
 */
async function exchangeCodeForToken(code) {
  const response = await axios.post(
    MF_TOKEN_URL,
    new URLSearchParams({
      redirect_uri:  process.env.MF_REDIRECT_URI,
      grant_type:    'authorization_code',
      code,
      client_id:     process.env.MF_CLIENT_ID,
      client_secret: process.env.MF_CLIENT_SECRET,
    }),
    {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    }
  );

  return {
    accessToken:  response.data.access_token,
    refreshToken: response.data.refresh_token,
    expiresIn:    response.data.expires_in,  // seconds
  };
}

/**
 * refreshAccessToken — リフレッシュトークンで新しいアクセストークンを取得する
 *
 * @param {string} refreshToken - 現在のリフレッシュトークン
 * @returns {Promise<{accessToken, refreshToken, expiresIn}>}
 */
async function refreshAccessToken(refreshToken) {
  const response = await axios.post(
    MF_TOKEN_URL,
    new URLSearchParams({
      grant_type:    'refresh_token',
      refresh_token: refreshToken,
      client_id:     process.env.MF_CLIENT_ID,
      client_secret: process.env.MF_CLIENT_SECRET,
    }),
    {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    }
  );

  return {
    accessToken:  response.data.access_token,
    refreshToken: response.data.refresh_token,
    expiresIn:    response.data.expires_in,
  };
}

// ── ルート定義 ─────────────────────────────────────────────

/**
 * GET /auth/login
 * MFクラウドの認可ページへリダイレクトする。
 * 管理者が一度だけ実行し、取得したトークンはサーバーレベルで全ユーザーと共有する。
 */
router.get('/login', (req, res) => {
  const url = buildAuthUrl();
  console.log('\n=== 認可URL ===');
  console.log(url);
  console.log('===============\n');
  res.redirect(url);
});

/**
 * callbackHandler
 * GET /callback  (MF_REDIRECT_URI=http://localhost:3000/callback に対応)
 *
 * MFクラウドから認可コードを受け取り、アクセストークンに交換する。
 * このハンドラは server.js でルートレベルに直接マウントする。
 * （/auth/callback ではなく /callback のため router には登録しない）
 */
async function callbackHandler(req, res) {
  const { code, error, error_description } = req.query;

  if (error) {
    console.error('Authorization error:', error, error_description);
    return res.status(400).send(`
      <h2>認可エラー</h2>
      <p>${error}: ${error_description || ''}</p>
      <a href="/auth/login">再試行する</a>
    `);
  }

  if (!code) {
    return res.status(400).send('認可コードが取得できませんでした。');
  }

  try {
    const { accessToken, refreshToken, expiresIn } = await exchangeCodeForToken(code);

    // サーバーレベルの共有トークンを更新（全閲覧者で共有）
    const shared = req.app.locals.sharedToken;
    shared.accessToken  = accessToken;
    shared.refreshToken = refreshToken;
    shared.tokenExpiry  = Date.now() + expiresIn * 1000;

    console.log('MFクラウド認証成功 — トークンを共有ストレージに保存しました');
    res.redirect('/dashboard.html');
  } catch (err) {
    const errData   = err.response && err.response.data;
    const errStatus = err.response && err.response.status;
    console.error('Token exchange error:', errStatus, JSON.stringify(errData) || err.message);
    res.status(500).send(`
      <h2>トークン交換エラー</h2>
      <p>ステータス: ${errStatus}</p>
      <pre>${JSON.stringify(errData, null, 2) || err.message}</pre>
      <p>リダイレクトURI: <code>${process.env.MF_REDIRECT_URI}</code></p>
      <a href="/auth/login">再試行する</a>
    `);
  }
}

/**
 * GET /auth/logout
 * MFクラウドのアクセストークンをサーバーからクリアする。
 */
router.get('/logout', (req, res) => {
  const shared = req.app.locals.sharedToken;
  shared.accessToken  = null;
  shared.refreshToken = null;
  shared.tokenExpiry  = null;
  console.log('MFクラウドトークンをクリアしました');
  res.redirect('/');
});

module.exports = { router, callbackHandler, refreshAccessToken };
