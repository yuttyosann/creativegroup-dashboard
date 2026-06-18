# CGプラットフォーム Phase 1 MVP（診断をWebで実行）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** CG社員がブラウザからGoogleサインインでログインし、YouTubeチャンネル診断・キーワード検索を実行して結果をGoogle Sheetsに保存できるWebアプリ（Xserver静的フロント＋Cloud Run Node API）を構築する。

**Architecture:** 静的フロント（Xserver）が、Cloud Run上のNode API（既存`cockpit-server.js`を拡張）をHTTPSで呼ぶ。APIはGoogle IDトークンを検証し、許可リストSheetで認可、YouTube/Apifyで診断を実行し、結果をGoogle Sheetsに追記する。

**Tech Stack:** Node.js (Express), googleapis (Sheets), google-auth-library (IDトークン検証), 既存診断スクリプト, Google Sign-In (GIS), Docker/Cloud Run, node:test（組込テスト）。

---

## ファイル構成

| ファイル | 区分 | 責務 |
|---------|------|------|
| `package.json` | 変更 | 依存追加（googleapis, google-auth-library）、testスクリプト |
| `lib/diagnosis-store.js` | 新規 | 診断結果→Sheet行への整形（純ロジック・テスト対象） |
| `lib/authz.js` | 新規 | 許可リスト照合（純ロジック・テスト対象） |
| `lib/google-auth.js` | 新規 | Google IDトークン検証（google-auth-library） |
| `lib/sheets.js` | 新規 | Google Sheetsへの追記・読み取り |
| `cockpit-server.js` | 変更 | CORS・認証ミドルウェア・診断結果のSheets保存を追加 |
| `public/cg-cockpit.html` | 変更 | ログインゲート（Google Sign-In）・APIベースURL・トークン送信 |
| `public/config.js` | 新規 | フロントの設定（APIベースURL・OAuthクライアントID） |
| `Dockerfile` | 新規 | Cloud Run用コンテナ |
| `.dockerignore` | 新規 | コンテナ除外 |
| `test/diagnosis-store.test.js` | 新規 | 整形ロジックのテスト |
| `test/authz.test.js` | 新規 | 許可リストのテスト |
| `docs/superpowers/setup/cloud-run-deploy.md` | 新規 | CG側のデプロイ・認証設定手順書 |

---

## Task 1: 依存追加とテストランナー設定

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 依存とtestスクリプトを追加**

`package.json` の `dependencies` に2つ追加し、`scripts` に test を追加する。

```json
{
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js",
    "cockpit": "node cockpit-server.js",
    "test": "node --test"
  },
  "dependencies": {
    "@google-cloud/bigquery": "^8.1.1",
    "@google-cloud/bigquery-data-transfer": "^5.1.2",
    "axios": "^1.6.0",
    "dotenv": "^16.3.1",
    "express": "^4.18.2",
    "express-basic-auth": "^1.2.1",
    "express-session": "^1.17.3",
    "googleapis": "^144.0.0",
    "google-auth-library": "^9.14.0"
  }
}
```

- [ ] **Step 2: インストール**

Run: `npm install`
Expected: `added N packages` でエラーなく完了。

- [ ] **Step 3: コミット**

```bash
git add package.json package-lock.json
git commit -m "chore: Sheets/認証用の依存とtestスクリプトを追加"
```

---

## Task 2: 診断結果→Sheet行 整形ロジック（TDD）

**Files:**
- Create: `lib/diagnosis-store.js`
- Test: `test/diagnosis-store.test.js`

- [ ] **Step 1: 失敗するテストを書く**

```javascript
// test/diagnosis-store.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { toDiagnosisRow } = require('../lib/diagnosis-store');

test('YouTube診断結果を診断ログ行に整形する', () => {
  const result = {
    title: 'SACHI沙智ちゃんねる', subscribers: 193000,
    avgER: 1.67, purchaseIntentRate: 17.9, commentsAnalyzed: 145, prOnly: false,
  };
  const row = toDiagnosisRow(result, { email: 'a@example.com' }, new Date('2026-06-18T00:00:00Z'));
  assert.deepStrictEqual(row, [
    '2026-06-18', 'a@example.com', 'YouTube', 'SACHI沙智ちゃんねる',
    193000, 1.67, 17.9, 145, '人気投稿',
  ]);
});

test('PR投稿モードは投稿種別がPR投稿になる', () => {
  const row = toDiagnosisRow(
    { title: 'X', subscribers: 1, avgER: 0, purchaseIntentRate: 0, commentsAnalyzed: 0, prOnly: true },
    { email: 'u@x.com' }, new Date('2026-06-18T00:00:00Z'));
  assert.strictEqual(row[8], 'PR投稿');
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `node --test test/diagnosis-store.test.js`
Expected: FAIL（`Cannot find module '../lib/diagnosis-store'`）

- [ ] **Step 3: 最小実装を書く**

```javascript
// lib/diagnosis-store.js
'use strict';

/** 診断結果を「診断ログ」シートの1行（配列）に整形する */
function toDiagnosisRow(result, user, now = new Date()) {
  const date = now.toISOString().slice(0, 10);
  return [
    date,
    user.email || '',
    'YouTube',
    result.title || '',
    result.subscribers || 0,
    result.avgER || 0,
    result.purchaseIntentRate || 0,
    result.commentsAnalyzed || 0,
    result.prOnly ? 'PR投稿' : '人気投稿',
  ];
}

module.exports = { toDiagnosisRow };
```

- [ ] **Step 4: テストを実行して成功を確認**

Run: `node --test test/diagnosis-store.test.js`
Expected: PASS（2 tests）

- [ ] **Step 5: コミット**

```bash
git add lib/diagnosis-store.js test/diagnosis-store.test.js
git commit -m "feat: 診断結果をSheet行に整形するロジック（TDD）"
```

---

## Task 3: 許可リスト照合ロジック（TDD）

**Files:**
- Create: `lib/authz.js`
- Test: `test/authz.test.js`

- [ ] **Step 1: 失敗するテストを書く**

```javascript
// test/authz.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { isAllowed, normalizeEmail } = require('../lib/authz');

const list = [
  { email: 'Alice@Example.com', role: 'admin' },
  { email: 'bob@example.com', role: 'member' },
];

test('許可リストにあるメール（大文字小文字無視）は許可', () => {
  assert.strictEqual(isAllowed('alice@example.com', list), true);
  assert.strictEqual(isAllowed('BOB@EXAMPLE.COM', list), true);
});

test('許可リストにないメールは拒否', () => {
  assert.strictEqual(isAllowed('eve@example.com', list), false);
});

test('空・未定義は拒否', () => {
  assert.strictEqual(isAllowed('', list), false);
  assert.strictEqual(isAllowed(undefined, list), false);
});

test('normalizeEmailは小文字化とトリムを行う', () => {
  assert.strictEqual(normalizeEmail('  Foo@Bar.com '), 'foo@bar.com');
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `node --test test/authz.test.js`
Expected: FAIL（`Cannot find module '../lib/authz'`）

- [ ] **Step 3: 最小実装を書く**

```javascript
// lib/authz.js
'use strict';

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

/** allowlist: [{email, role}] に対し、emailが含まれるか */
function isAllowed(email, allowlist) {
  const e = normalizeEmail(email);
  if (!e) return false;
  return allowlist.some((u) => normalizeEmail(u.email) === e);
}

module.exports = { isAllowed, normalizeEmail };
```

- [ ] **Step 4: テストを実行して成功を確認**

Run: `node --test test/authz.test.js`
Expected: PASS（4 tests）

- [ ] **Step 5: コミット**

```bash
git add lib/authz.js test/authz.test.js
git commit -m "feat: 許可リスト照合ロジック（TDD）"
```

---

## Task 4: Google Sheets 読み書きモジュール

**Files:**
- Create: `lib/sheets.js`

実認証が必要なため自動テストは行わず、コードと手動確認手順で進める。サービスアカウントの認証情報は環境変数 `GOOGLE_APPLICATION_CREDENTIALS`（鍵JSONパス）で渡す前提。

- [ ] **Step 1: 実装を書く**

```javascript
// lib/sheets.js
'use strict';
const { google } = require('googleapis');

// 認証（Cloud Runのサービスアカウント or GOOGLE_APPLICATION_CREDENTIALS）
async function getClient() {
  const auth = new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth: await auth.getClient() });
}

/** 指定タブに1行追記 */
async function appendRow(spreadsheetId, tabName, rowArray) {
  const sheets = await getClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${tabName}!A:Z`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [rowArray] },
  });
}

/** 指定タブの全行を取得（ヘッダー含む） */
async function readRows(spreadsheetId, tabName) {
  const sheets = await getClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId, range: `${tabName}!A:Z`,
  });
  return res.data.values || [];
}

/** 許可リストタブを [{email, role}] として読む（1行目ヘッダー: 氏名,Gmail,権限） */
async function readAllowlist(spreadsheetId) {
  const rows = await readRows(spreadsheetId, '許可リスト');
  return rows.slice(1)
    .filter((r) => r[1])
    .map((r) => ({ name: r[0] || '', email: r[1], role: r[2] || 'member' }));
}

module.exports = { appendRow, readRows, readAllowlist };
```

- [ ] **Step 2: 構文チェック**

Run: `node --check lib/sheets.js`
Expected: エラーなし

- [ ] **Step 3: コミット**

```bash
git add lib/sheets.js
git commit -m "feat: Google Sheets 読み書きモジュール"
```

---

## Task 5: Google IDトークン検証モジュール

**Files:**
- Create: `lib/google-auth.js`

- [ ] **Step 1: 実装を書く**

```javascript
// lib/google-auth.js
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
```

- [ ] **Step 2: 構文チェック**

Run: `node --check lib/google-auth.js`
Expected: エラーなし

- [ ] **Step 3: コミット**

```bash
git add lib/google-auth.js
git commit -m "feat: Google IDトークン検証モジュール"
```

---

## Task 6: cockpit-server.js に CORS・認証・Sheets保存を統合

**Files:**
- Modify: `cockpit-server.js`

- [ ] **Step 1: 先頭の require とミドルウェアを追加**

`cockpit-server.js` の冒頭（`const app = express();` の直後）に追加する。

```javascript
const cors = (req, res, next) => {
  const origin = process.env.ALLOWED_ORIGIN || '*';
  res.header('Access-Control-Allow-Origin', origin);
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
};
app.use(cors);

const { verifyIdToken } = require('./lib/google-auth');
const { isAllowed } = require('./lib/authz');
const { appendRow, readAllowlist } = require('./lib/sheets');
const { toDiagnosisRow } = require('./lib/diagnosis-store');
const SHEET_ID = process.env.SHEET_ID;

// 認証ミドルウェア：Authorization: Bearer <idToken> を検証＋許可リスト照合
async function requireAuth(req, res, next) {
  try {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!token) return res.status(401).json({ ok: false, error: '未ログイン' });
    const user = await verifyIdToken(token);
    const allowlist = await readAllowlist(SHEET_ID);
    if (!isAllowed(user.email, allowlist)) {
      return res.status(403).json({ ok: false, error: '許可リストにありません' });
    }
    req.user = user;
    next();
  } catch (e) {
    res.status(401).json({ ok: false, error: '認証失敗' });
  }
}
```

- [ ] **Step 2: 既存の診断エンドポイントに認証と保存を付与**

既存の `app.post('/api/cockpit/youtube', ...)` を以下に置き換える（`requireAuth` を挟み、結果をSheetsに保存）。

```javascript
app.post('/api/cockpit/youtube', requireAuth, (req, res) => {
  const { input, prOnly } = req.body || {};
  if (!input) return res.status(400).json({ ok: false, error: 'チャンネルID/ハンドルを入力してください' });
  const a = [input, '--json', '--videos', '20', '--comments', '50'];
  if (prOnly) a.push('--pr-only', '--pr-posts', '10');
  runScriptThen('scripts/youtube/fetch_channel.js', a, res, async (data) => {
    if (SHEET_ID && data.ok) {
      try { await appendRow(SHEET_ID, '診断ログ', toDiagnosisRow(data, req.user)); } catch (e) {}
    }
  });
});
```

- [ ] **Step 3: yt-search にも認証を付与**

既存の `app.post('/api/cockpit/yt-search', ...)` の第2引数に `requireAuth` を挿入する。

```javascript
app.post('/api/cockpit/yt-search', requireAuth, (req, res) => {
  const { keyword, max } = req.body || {};
  if (!keyword) return res.status(400).json({ ok: false, error: 'キーワードを入力してください' });
  runScript('scripts/youtube/search_channels.js', [keyword, '--json', '--max', String(max || 8)], res);
});
```

- [ ] **Step 4: runScript に「成功後コールバック」版を追加**

既存の `runScript` 関数の直後に追加する。

```javascript
// 成功時にコールバック（Sheets保存等）を実行してからJSONを返す版
function runScriptThen(scriptRel, scriptArgs, res, after) {
  const { execFile } = require('child_process');
  const path = require('path');
  const script = path.join(__dirname, scriptRel);
  execFile('node', [script, ...scriptArgs], { cwd: __dirname, timeout: 180000, maxBuffer: 10 * 1024 * 1024 },
    async (err, stdout) => {
      const marker = (stdout || '').split('\n').find((l) => l.startsWith('@@JSON@@'));
      if (marker) {
        try {
          const data = JSON.parse(marker.slice(8));
          if (after) await after(data);
          return res.json(data);
        } catch (e) {}
      }
      res.status(500).json({ ok: false, error: '実行に失敗しました' });
    });
}
```

- [ ] **Step 5: 構文チェックと起動確認**

Run: `node --check cockpit-server.js`
Expected: エラーなし

Run: `SHEET_ID= node cockpit-server.js`（数秒後 Ctrl+C）
Expected: 「施策進行コックピット（ライブ実行）」の起動ログが出る

- [ ] **Step 6: 認証ガードの手動確認（トークン無し）**

サーバー起動中に別ターミナルで:
Run: `curl -s -X POST localhost:8090/api/cockpit/youtube -H "Content-Type: application/json" -d '{"input":"UCxxxx"}'`
Expected: `{"ok":false,"error":"未ログイン"}`（401）

- [ ] **Step 7: コミット**

```bash
git add cockpit-server.js
git commit -m "feat: コックピットAPIにCORS・Google認証・診断結果のSheets保存を追加"
```

---

## Task 7: フロントにログインゲートとAPI連携を追加

**Files:**
- Create: `public/config.js`
- Modify: `public/cg-cockpit.html`

- [ ] **Step 1: フロント設定ファイルを作成**

```javascript
// public/config.js
// デプロイ時にCG側が値を設定する
window.CG_CONFIG = {
  API_BASE: "",              // 例: https://cockpit-xxxx.a.run.app
  GOOGLE_CLIENT_ID: "",      // OAuthクライアントID（…apps.googleusercontent.com）
};
```

- [ ] **Step 2: HTMLヘッダにGoogle Sign-Inとconfigを読み込む**

`cg-cockpit.html` の `<head>` 内、`<title>` の直後に追加する。

```html
<script src="https://accounts.google.com/gsi/client" async defer></script>
<script src="config.js"></script>
```

- [ ] **Step 3: ログインゲートのHTMLとCSSを追加**

`<body>` の直後（`<header>` の前）に追加する。

```html
<div id="login" style="display:none;position:fixed;inset:0;background:#1E2D40;color:#fff;z-index:100;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px">
  <div style="font-size:20px;font-weight:600">🚀 CG 施策進行コックピット</div>
  <div style="font-size:13px;color:#A9BBD0">許可されたメンバーのGoogleアカウントでログイン</div>
  <div id="gbtn"></div>
  <div id="loginerr" style="color:#F09595;font-size:13px"></div>
</div>
```

- [ ] **Step 4: 認証JSを追加**

`<script>` ブロックの先頭（`const STEPS = [` の前）に追加する。

```javascript
let ID_TOKEN = sessionStorage.getItem("cg_idtoken") || "";
const API_BASE = (window.CG_CONFIG && window.CG_CONFIG.API_BASE) || "";

function showLogin(msg){
  document.getElementById("login").style.display="flex";
  if(msg) document.getElementById("loginerr").textContent=msg;
}
function hideLogin(){ document.getElementById("login").style.display="none"; }

window.onGoogleCredential=(resp)=>{
  ID_TOKEN=resp.credential;
  sessionStorage.setItem("cg_idtoken",ID_TOKEN);
  hideLogin();
};

function initAuth(){
  const cid = window.CG_CONFIG && window.CG_CONFIG.GOOGLE_CLIENT_ID;
  if(!cid){ hideLogin(); return; } // 未設定なら開発用に素通り
  if(ID_TOKEN){ hideLogin(); return; }
  showLogin();
  if(window.google && google.accounts){
    google.accounts.id.initialize({ client_id: cid, callback: window.onGoogleCredential });
    google.accounts.id.renderButton(document.getElementById("gbtn"), { theme:"filled_blue", size:"large" });
  }
}
```

- [ ] **Step 5: API呼び出しに認証トークンとAPI_BASEを付与**

既存の `async function api(path,body){...}` を以下に置き換える。

```javascript
async function api(path,body){
  const r=await fetch(API_BASE+path,{
    method:"POST",
    headers:{"Content-Type":"application/json","Authorization":"Bearer "+ID_TOKEN},
    body:JSON.stringify(body)
  });
  if(r.status===401){ showLogin("再ログインしてください"); }
  if(r.status===403){ showLogin("このアカウントは許可リストにありません"); }
  return r.json();
}
```

- [ ] **Step 6: 起動時に認証を初期化**

既存の末尾 `render();` の直前に `initAuth();` を追加する。

```javascript
initAuth();
render();
```

- [ ] **Step 7: 静的サーバーで表示確認（未設定なら素通り）**

Run: `node cockpit-server.js`（別ターミナル）
ブラウザで `http://localhost:8090/cg-cockpit.html` を開く
Expected: GOOGLE_CLIENT_ID未設定のためログインゲートは出ず、画面が通常表示される（開発時の挙動）

- [ ] **Step 8: コミット**

```bash
git add public/config.js public/cg-cockpit.html
git commit -m "feat: フロントにGoogleログインゲートとAPI認証連携を追加"
```

---

## Task 8: Cloud Run 用 Dockerfile

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`

- [ ] **Step 1: Dockerfile を作成**

```dockerfile
FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
ENV COCKPIT_PORT=8080
EXPOSE 8080
CMD ["node", "cockpit-server.js"]
```

- [ ] **Step 2: .dockerignore を作成**

```
node_modules
.env
.git
分析レポート
docs
*.md
```

- [ ] **Step 3: cockpit-server.js のポートをCloud Run対応に確認**

`cockpit-server.js` のポート定義が `process.env.COCKPIT_PORT || 8090` であることを確認する（Cloud Runは8080をENVで渡す。Dockerfileで COCKPIT_PORT=8080 を設定済み）。異なる場合は次に修正：

```javascript
const PORT = process.env.PORT || process.env.COCKPIT_PORT || 8090;
```

- [ ] **Step 4: ローカルでDockerビルド（任意・Docker導入時のみ）**

Run: `docker build -t cg-cockpit . && echo OK`
Expected: ビルド成功（Docker未導入ならスキップしデプロイ手順書で実施）

- [ ] **Step 5: コミット**

```bash
git add Dockerfile .dockerignore cockpit-server.js
git commit -m "feat: Cloud Run用Dockerfileを追加"
```

---

## Task 9: デプロイ・認証設定の手順書（CG側作業）

**Files:**
- Create: `docs/superpowers/setup/cloud-run-deploy.md`

- [ ] **Step 1: 手順書を作成**

```markdown
# CGコックピット デプロイ手順（CG側作業）

## 1. Google Cloud 準備
1. https://console.cloud.google.com でプロジェクト作成（無料）
2. 「YouTube Data API v3」を有効化
3. APIキー発行（YouTube用）

## 2. OAuthクライアント（ログイン用）
1. APIとサービス → OAuth同意画面（外部）を設定
2. 認証情報 → OAuthクライアントID（ウェブアプリ）を作成
3. 承認済みJavaScript生成元に Xserverの本番URL（例 https://cg-app.jp）を追加
4. 発行されたクライアントIDを控える

## 3. スプレッドシート準備
1. スプレッドシートを新規作成し、タブ「許可リスト」「診断ログ」「インフルエンサーマスタ」「案件DB」を用意
2. 許可リストの1行目: 氏名 / Gmail / 権限。2行目以降にメンバーを記入
3. スプレッドシートIDを控える（URLの /d/〜/ の部分）
4. Cloud Runのサービスアカウントのメールに、このシートを「編集者」で共有

## 4. Cloud Run デプロイ
1. gcloud CLI でログイン: `gcloud auth login`
2. デプロイ:
   gcloud run deploy cg-cockpit --source . --region asia-northeast1 \
     --allow-unauthenticated \
     --set-env-vars YOUTUBE_API_KEY=＜キー＞,GOOGLE_OAUTH_CLIENT_ID=＜クライアントID＞,SHEET_ID=＜シートID＞,ALLOWED_ORIGIN=https://cg-app.jp,APIFY_TOKEN=＜任意＞
3. 払い出されたURL（https://cg-cockpit-xxxx.a.run.app）を控える

## 5. Xserver にフロント配置
1. public/cg-cockpit.html と public/config.js をXserverにアップロード
2. config.js を編集:
   - API_BASE: Cloud RunのURL
   - GOOGLE_CLIENT_ID: OAuthクライアントID
3. 独自ドメインで cg-cockpit.html にアクセスし、Googleログイン→診断を確認

## トラブルシュート
- 403「許可リストにありません」: 許可リストSheetにそのGmailを追加
- CORSエラー: ALLOWED_ORIGIN がXserverのURLと一致しているか確認
- 401: ブラウザで再ログイン
```

- [ ] **Step 2: コミット**

```bash
git add docs/superpowers/setup/cloud-run-deploy.md
git commit -m "docs: Cloud Run/Xserverデプロイ手順書を追加"
```

---

## 完了条件（MVP）

- `npm test` が全てPASS（diagnosis-store, authz）
- ローカルで `node cockpit-server.js` 起動し、トークン無しの診断呼び出しが401になる
- Dockerfileでビルドできる
- デプロイ手順書に沿ってCG側がデプロイすれば、Googleログイン→診断→Sheets保存が動作する

## 補足（YAGNI）

- IG/Apifyのブラウザ実行・クライアントポータル・ヒアリング連携・BigQuery集計はPhase 2以降。本MVPには含めない。
- セッションは sessionStorage のIDトークンで簡易に保持。リフレッシュは都度サインインで対応（MVP範囲）。
