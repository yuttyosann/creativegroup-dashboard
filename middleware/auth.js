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
    const user = req.session?.googleUser;
    if (!user) {
      // 未認証 → ログインにリダイレクト
      return res.redirect('/auth/google');
    }
    if (allowedRoles.includes(user.role)) {
      return next();
    }
    res.status(403).json({ error: 'forbidden', message: 'アクセス権限がありません' });
  };
}

module.exports = { requireAuth, requireRole, getRoleFromEmail };
