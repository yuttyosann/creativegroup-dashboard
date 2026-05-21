/**
 * GCP OAuth2認証ヘルパー
 * ローカルサーバーでコールバックをキャプチャして認証を完了する
 *
 * 実行方法: node trepo/auth_gcp.js
 */

const http = require('http');
const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = 9876;
const GCLOUD = '/Users/yuttyo/google-cloud-sdk/bin/gcloud';
const PYTHON = '/usr/bin/python3';

// OAuth2 client credentials (gcloud default)
const CLIENT_ID = '764086051850-6qr4p6gpi6hn506pt8ejuq83di341hur.apps.googleusercontent.com';
const CLIENT_SECRET = 'd-FL95Q19q7MQmFpd7hHD0Ty';
const REDIRECT_URI = `http://localhost:${PORT}/callback`;
const SCOPES = [
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/cloud-platform',
].join(' ');

const CRED_PATH = path.join(os.homedir(), '.config', 'gcloud', 'application_default_credentials.json');

async function main() {
  // PKCE用のcode verifier/challengeを生成
  const crypto = require('crypto');
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
  const state = crypto.randomBytes(16).toString('hex');

  const authUrl = new URL('https://accounts.google.com/o/oauth2/auth');
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
  authUrl.searchParams.set('scope', SCOPES);
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('prompt', 'consent');
  authUrl.searchParams.set('code_challenge', codeChallenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');

  console.log('\n🔐 GCP認証を開始します\n');
  console.log('以下のURLをブラウザで開いてGoogleアカウントにログインしてください:\n');
  console.log(authUrl.toString());
  console.log('\n（自動でブラウザを開きます...）');

  // macOSでブラウザを開く
  try {
    execSync(`open "${authUrl.toString()}"`);
  } catch (e) {
    console.log('ブラウザを手動で開いてください');
  }

  // ローカルサーバーでコールバックを待つ
  const code = await waitForCode(PORT, state);
  console.log('\n✅ 認証コードを受信しました。トークンを取得中...');

  // アクセストークンを取得
  const tokens = await exchangeCode(code, codeVerifier);

  // 認証情報を保存
  fs.mkdirSync(path.dirname(CRED_PATH), { recursive: true });
  const credData = {
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    quota_project_id: 'cg-project-491303',
    refresh_token: tokens.refresh_token,
    type: 'authorized_user',
    universe_domain: 'googleapis.com',
  };
  fs.writeFileSync(CRED_PATH, JSON.stringify(credData, null, 2));
  console.log(`✅ 認証情報を保存しました: ${CRED_PATH}`);
  console.log('\n🚀 BigQueryセットアップを開始します...');

  // セットアップスクリプトを実行
  const { execSync: run } = require('child_process');
  run('node trepo/setup_bigquery.js --project=cg-project-491303', {
    stdio: 'inherit',
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, GOOGLE_APPLICATION_CREDENTIALS: CRED_PATH },
  });
}

function waitForCode(port, expectedState) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://localhost:${port}`);
      if (url.pathname !== '/callback') return;

      const code  = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const error = url.searchParams.get('error');

      if (error) {
        res.writeHead(400);
        res.end(`<h2>認証エラー: ${error}</h2>`);
        server.close();
        reject(new Error(error));
        return;
      }

      if (state !== expectedState) {
        res.writeHead(400);
        res.end('<h2>stateが一致しません</h2>');
        server.close();
        reject(new Error('state mismatch'));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<h2>✅ 認証完了！このタブは閉じてください。</h2>');
      server.close();
      resolve(code);
    });

    server.listen(port, () => {
      console.log(`\n⏳ ブラウザでのログイン完了を待機中...`);
    });

    server.on('error', reject);
  });
}

async function exchangeCode(code, codeVerifier) {
  const params = new URLSearchParams({
    code,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    redirect_uri: REDIRECT_URI,
    grant_type: 'authorization_code',
    code_verifier: codeVerifier,
  });

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  const data = await res.json();
  if (data.error) throw new Error(`Token exchange failed: ${data.error_description || data.error}`);
  return data;
}

main().catch(err => {
  console.error('\n❌ エラー:', err.message);
  process.exit(1);
});
