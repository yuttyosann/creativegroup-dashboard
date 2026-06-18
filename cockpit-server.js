'use strict';
/**
 * cockpit-server.js — 施策進行コックピット 専用サーバー（ライブ実行）
 *
 * public/cg-cockpit.html を配信し、診断スクリプトをブラウザから実行できる
 * エンドポイントを提供する。MFダッシュボード（server.js）とは独立。
 *
 * 起動: node cockpit-server.js   （ポート 8090）
 *
 * エンドポイント:
 *   POST /api/cockpit/youtube     { input, prOnly }  → fetch_channel.js
 *   POST /api/cockpit/yt-search   { keyword, max }   → search_channels.js
 */
require('dotenv').config({ override: true });
const express = require('express');
const path = require('path');
const { execFile } = require('child_process');

const app = express();
const PORT = process.env.COCKPIT_PORT || 8090;

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

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// スクリプトを実行し @@JSON@@ マーカー行を抽出して返す
function runScript(scriptRel, scriptArgs, res) {
  const script = path.join(__dirname, scriptRel);
  execFile('node', [script, ...scriptArgs], { cwd: __dirname, timeout: 180000, maxBuffer: 10 * 1024 * 1024 },
    (err, stdout, stderr) => {
      const marker = (stdout || '').split('\n').find(l => l.startsWith('@@JSON@@'));
      if (marker) {
        try { return res.json(JSON.parse(marker.slice(8))); } catch (e) {}
      }
      if (err) {
        return res.status(500).json({ ok: false, error: (stderr || err.message || '').slice(0, 500) });
      }
      res.status(500).json({ ok: false, error: 'JSON出力が見つかりませんでした', raw: (stdout || '').slice(-500) });
    });
}

// 成功時にコールバック（Sheets保存等）を実行してからJSONを返す版
function runScriptThen(scriptRel, scriptArgs, res, after) {
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

// YouTube チャンネル診断
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

// YouTube キーワード検索
app.post('/api/cockpit/yt-search', requireAuth, (req, res) => {
  const { keyword, max } = req.body || {};
  if (!keyword) return res.status(400).json({ ok: false, error: 'キーワードを入力してください' });
  runScript('scripts/youtube/search_channels.js', [keyword, '--json', '--max', String(max || 8)], res);
});

app.get('/', (req, res) => res.redirect('/cg-cockpit.html'));

app.listen(PORT, () => {
  const key = process.env.YOUTUBE_API_KEY ? '設定済み' : '未設定 ← .env確認';
  console.log(`\n  🚀 施策進行コックピット（ライブ実行）`);
  console.log(`  http://localhost:${PORT}/cg-cockpit.html`);
  console.log(`  YOUTUBE_API_KEY: ${key}\n`);
});
