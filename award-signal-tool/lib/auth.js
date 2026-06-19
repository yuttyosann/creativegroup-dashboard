// Googleログイン（IDトークン検証＋許可リスト）。既存コックピットと同じ方式。
import { OAuth2Client } from "google-auth-library";

const client = new OAuth2Client();

/** 認証が有効か（GOOGLE_OAUTH_CLIENT_ID 未設定なら無効＝ローカル開発用） */
export function authEnabled() {
  return !!process.env.GOOGLE_OAUTH_CLIENT_ID;
}

/** 許可判定: ALLOWED_EMAILS(カンマ区切り) または ALLOWED_HD(Workspaceドメイン) */
function isAllowed(email) {
  const e = String(email).toLowerCase();
  const list = (process.env.ALLOWED_EMAILS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const hd = (process.env.ALLOWED_HD || "").trim().toLowerCase();
  if (list.length && list.includes(e)) return true;
  if (hd && e.endsWith("@" + hd)) return true;
  // どちらも未設定なら全許可（運用では必ずどちらかを設定すること。手順書で警告）
  if (!list.length && !hd) return true;
  return false;
}

/** Express ミドルウェア: Authorization: Bearer <idToken> を検証＋許可リスト照合 */
export async function requireAuth(req, res, next) {
  if (!authEnabled()) return next(); // ローカル開発: 認証スキップ
  try {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!token) return res.status(401).json({ error: "未ログイン" });
    const ticket = await client.verifyIdToken({ idToken: token, audience: process.env.GOOGLE_OAUTH_CLIENT_ID });
    const p = ticket.getPayload();
    if (!p || !p.email || !p.email_verified) return res.status(401).json({ error: "メール未確認" });
    if (!isAllowed(p.email)) return res.status(403).json({ error: "許可されていないアカウントです" });
    req.user = { email: p.email, name: p.name || "" };
    next();
  } catch (e) {
    res.status(401).json({ error: "認証失敗" });
  }
}
