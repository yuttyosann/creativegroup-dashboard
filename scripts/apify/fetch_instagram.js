/**
 * Apify 外部API — Instagram 投稿＋コメント取得＆転換質スキャン
 *
 * Instagramは公式APIで他人のコメントを取れないため、Apifyの
 * Instagram Scraper / Comment Scraper を呼び出して取得し、
 * 当社の転換質（購買意向コメント率）を採点する。
 *
 * 【事前準備】
 *   1. https://apify.com にサインアップ（無料枠：毎月$5クレジット）
 *   2. Settings → Integrations → API token をコピー
 *   3. .env に APIFY_TOKEN=取得したトークン を追記
 *
 * 【使い方】
 *   // ユーザー名を直接指定
 *   node scripts/apify/fetch_instagram.js piii_xx_01 karin__life m.mai_ozaki
 *   // 提案CSVから一括（アカウント名列を自動抽出）
 *   node scripts/apify/fetch_instagram.js --csv "/path/to/提案リスト.csv" --limit 20
 *
 * 【出力】
 *   分析レポート/instagram_data/<日付>_転換質.csv
 *   コンソールに転換質ランキング
 *
 * 【コスト目安】1アカウント ≒ $0.05前後（投稿$0.50/1k・コメント$0.30/1k）
 */

require("dotenv").config();
const axios = require("axios");
const fs = require("fs");
const path = require("path");

const TOKEN = process.env.APIFY_TOKEN;
if (!TOKEN) {
  console.error("❌ .env に APIFY_TOKEN がありません。");
  console.error("   https://apify.com → Settings → Integrations → API token を取得し追記してください。");
  process.exit(1);
}

// Apifyアクター（必要なら変更可）
const POST_ACTOR = "apify~instagram-scraper";          // 投稿取得
const COMMENT_ACTOR = "apify~instagram-comment-scraper"; // コメント取得

// ---- 引数 ----
const args = process.argv.slice(2);
const csvIdx = args.indexOf("--csv");
const limit = (() => { const i = args.indexOf("--limit"); return i>=0 && args[i+1] ? parseInt(args[i+1],10) : 30; })();
const PR_ONLY = args.includes("--pr-only");   // PR投稿のみで転換質を測る
const prPosts = (() => { const i = args.indexOf("--pr-posts"); return i>=0 && args[i+1] ? parseInt(args[i+1],10) : 8; })();
const postsPerAcc = PR_ONLY ? 30 : 8, commentsPerPost = 50;  // PR抽出のため広めに取得

// PR表記の精密マッチ（bare "pr" は誤検出するため使わない。ハッシュタグ/明示表記で判定）
const PR_MARKERS = ["#pr", "#ad", "#提供", "#タイアップ", "提供:", "提供：", "タイアップ", "案件", "sponsored", "paid partnership", "アンバサダー"];
function isPRpost(p) {
  if (p.isSponsored || p.isPaidPartnership) return true;
  const t = (p.caption || "").toLowerCase();
  return PR_MARKERS.some(m => t.includes(m));
}

let usernames = [];
if (csvIdx >= 0 && args[csvIdx+1]) {
  // CSVから「アカウント名」列 or URLからユーザー名抽出
  const text = fs.readFileSync(args[csvIdx+1], "utf-8");
  const lines = text.split(/\r?\n/);
  const header = lines[0].split(",");
  const accCol = header.findIndex(h => h.includes("アカウント名"));
  const urlCol = header.findIndex(h => h.includes("URL"));
  for (const line of lines.slice(1)) {
    const cols = line.split(",");
    let u = accCol>=0 ? (cols[accCol]||"").trim() : "";
    if (!u && urlCol>=0) { const m = (cols[urlCol]||"").match(/instagram\.com\/([^\/\?]+)/); if (m) u = m[1]; }
    u = u.replace(/^@/, "").trim();
    // 有効なIGハンドル（英数字・_・.）のみ。ヘッダー語（媒体/投稿日等）を除外
    if (u && /^[a-zA-Z0-9._]+$/.test(u) && !usernames.includes(u)) usernames.push(u);
  }
  usernames = usernames.slice(0, limit);
} else {
  usernames = args.filter(a => !a.startsWith("--")).map(u => u.replace(/^@/, ""));
}

if (!usernames.length) { console.error("ユーザー名 or --csv を指定してください"); process.exit(1); }

const PURCHASE_SIGNALS = ["買った","買いました","購入","ポチ","注文","届いた","リピ","欲しい","気になる","どこで","愛用","使ってる","真似","参考"];
function intentRate(comments) {
  if (!comments.length) return 0;
  let hits = 0;
  comments.forEach(c => { if (PURCHASE_SIGNALS.some(k => (c||"").includes(k))) hits++; });
  return hits / comments.length;
}

// Apifyアクターを同期実行して結果を取得
async function runActor(actor, input) {
  const url = `https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?token=${TOKEN}`;
  const res = await axios.post(url, input, { timeout: 180000, headers: { "Content-Type": "application/json" } });
  return res.data; // dataset items 配列
}

async function fetchAccount(username) {
  // 1) 投稿取得
  const posts = await runActor(POST_ACTOR, {
    directUrls: [`https://www.instagram.com/${username}/`],
    resultsType: "posts",
    resultsLimit: postsPerAcc,
    addParentData: false,
  });
  let postList = (posts || []).filter(p => p.url || p.shortCode).map(p => ({
    url: p.url || `https://www.instagram.com/p/${p.shortCode}/`,
    likes: p.likesCount || 0,
    comments: p.commentsCount || 0,
    caption: p.caption || "",
    isSponsored: p.isSponsored, isPaidPartnership: p.isPaidPartnership,
  }));
  if (!postList.length) return { username, followers: posts?.[0]?.ownerFollowersCount||null, intent: null, posts: 0, note: "投稿取得不可" };

  // 2) 分析対象：PR投稿のみ or いいね上位3
  let top;
  if (PR_ONLY) {
    const prList = postList.filter(isPRpost);
    top = prList.slice(0, prPosts);
    if (!top.length) return { username, followers: posts?.[0]?.ownerFollowersCount||null, intent: null, posts: postList.length, prPosts: 0, note: "PR投稿なし" };
  } else {
    top = [...postList].sort((a,b)=>b.likes-a.likes).slice(0,3);
  }
  let allComments = [];
  try {
    const cs = await runActor(COMMENT_ACTOR, { directUrls: top.map(p=>p.url), resultsLimit: commentsPerPost });
    allComments = (cs || []).map(c => c.text || c.comment || "");
  } catch (e) { /* コメント不可時は投稿のみ */ }

  return {
    username,
    followers: posts?.[0]?.ownerFollowersCount || null,
    posts: postList.length,
    prPostsAnalyzed: PR_ONLY ? top.length : null,
    commentsAnalyzed: allComments.length,
    intent: allComments.length ? intentRate(allComments) : null,
    sampleComments: allComments.slice(0,5),
  };
}

(async () => {
  console.log(`\n🔍 Apifyで ${usernames.length}アカウントの投稿＋コメントを取得中...（時間がかかります）\n`);
  const results = [];
  for (const u of usernames) {
    try {
      const r = await fetchAccount(u);
      results.push(r);
      const it = r.intent==null ? "—" : `${(r.intent*100).toFixed(1)}%`;
      console.log(`  @${u}  転換質${it} (コメント${r.commentsAnalyzed||0}件)`);
    } catch (e) {
      results.push({ username:u, intent:null, note: e.response?.status||e.message });
      console.log(`  @${u}  取得失敗: ${e.response?.status||e.message}`);
    }
  }

  results.sort((a,b)=> (b.intent??-1) - (a.intent??-1));

  console.log(`\n${"=".repeat(64)}`);
  console.log("📊 転換質ランキング（購買意向コメント率）");
  console.log(`${"=".repeat(64)}`);
  results.forEach((r,i)=>{
    const it = r.intent==null ? "—（取得不可）" : `${(r.intent*100).toFixed(1)}%`;
    console.log(`${i+1}. @${r.username}  転換質 ${it}`);
  });

  const outDir = path.join(__dirname, "../../分析レポート/instagram_data");
  fs.mkdirSync(outDir, { recursive: true });
  const date = new Date().toISOString().slice(0,10);
  const csvPath = path.join(outDir, `${date}_転換質.csv`);
  const head = "アカウント名,フォロワー,分析コメント数,転換質%";
  const lines = results.map(r=>`${r.username},${r.followers||""},${r.commentsAnalyzed||0},${r.intent==null?"":(r.intent*100).toFixed(1)}`);
  fs.writeFileSync(csvPath, "﻿"+[head,...lines].join("\n"), "utf-8");
  console.log(`\n✅ 結果CSV: ${csvPath}`);
  console.log("   次：提案ログDBの『転換質%』列に転記し、人間の『要望クリア/推薦理由』と照合してください。");

  if (args.includes("--json")) {
    console.log("@@JSON@@" + JSON.stringify({
      ok: true,
      results: results.map(r => ({
        username: r.username, followers: r.followers || null,
        commentsAnalyzed: r.commentsAnalyzed || 0,
        intent: r.intent == null ? null : +(r.intent * 100).toFixed(1),
        prPostsAnalyzed: r.prPostsAnalyzed ?? null,
      })),
    }));
  }
})();
