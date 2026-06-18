'use strict';
const { OAuth2Client } = require('google-auth-library');

const client = new OAuth2Client();

/**
 * フロントから受け取ったGoogle IDトークンを検証し、payload（email等）を返す。
 * audience（OAuthクライアントID）は環境変数 GOOGLE_OAUTH_CLIENT_ID。
 * 失敗時は例外。
 */
async function verifyIdToken(idToken) {
  const ticket = await client.verifyIdToken({
    idToken,
    audience: process.env.GOOGLE_OAUTH_CLIENT_ID,
  });
  const payload = ticket.getPayload();
  if (!payload || !payload.email || !payload.email_verified) {
    throw new Error('メール未確認のトークン');
  }
  return { email: payload.email, name: payload.name || '' };
}

module.exports = { verifyIdToken };
