/**
 * Apify 外部API — TikTok ハッシュタグ/キーワードの話題量取得
 *
 * Trepoトレンド大賞2026の実績スコア「SNS話題量」用。
 * 候補のハッシュタグ or キーワードでTikTok動画を取得し、
 * 動画数・総再生数・エンゲージを集計して話題量の素材を出す。
 * （発見＝Creative Center手動スイープ、定量化＝本スクリプト、の役割分担）
 *
 * 【事前準備】
 *   1. https://apify.com にサインアップ（無料枠：毎月$5クレジット）
 *   2. Settings → Integrations → API token をコピー
 *   3. .env に APIFY_TOKEN=取得したトークン を追記
 *
 * 【使い方】
 *   // ハッシュタグ（# は付けても付けなくてもOK）
 *   node scripts/apify/fetch_tiktok.js 地雷リップ 量産型コーデ
 *   // キーワード検索として扱う
 *   node scripts/apify/fetch_tiktok.js --search "〇〇カフェ" "△△グミ"
 *   // 候補プールDBから書き出したCSVで一括（対象名の列を指定）
 *   node scripts/apify/fetch_tiktok.js --csv candidates.csv --col 対象名 --limit 30
 *
 * 【出力】
 *   分析レポート/tiktok_data/<日付>_話題量.csv
 *   コンソールに話題量ランキング
 *
 * 【コスト目安】1ハッシュタグ ≒ $0.02〜0.05（取得動画数による）
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

// Apifyアクター（Storeで変わったら差し替え）。clockworks/tiktok-scraper を使用。
const TIKTOK_ACTOR = "clockworks~tiktok-scraper";

// ---- 引数 ----
const args = process.argv.slice(2);
const SEARCH_MODE = args.includes("--search"); // キーワード検索（既定はハッシュタグ）
const perTerm = (() => { const i = args.indexOf("--per"); return i>=0 && args[i+1] ? parseInt(args[i+1],10) : 50; })();
const limit = (() => { const i = args.indexOf("--limit"); return i>=0 && args[i+1] ? parseInt(args[i+1],10) : 30; })();
const outArg = (() => { const i = args.indexOf("--out"); return i>=0 && args[i+1] ? args[i+1] : null; })();

let terms = [];
const csvIdx = args.indexOf("--csv");
if (csvIdx >= 0 && args[csvIdx+1]) {
  const colName = (() => { const i = args.indexOf("--col"); return i>=0 && args[i+1] ? args[i+1] : null; })();
  const text = fs.readFileSync(args[csvIdx+1], "utf-8").replace(/^﻿/, "");
  const lines = text.split(/\r?\n/).filter(Boolean);
  const header = lines[0].split(",");
  const col = colName ? header.findIndex(h => h.trim() === colName) : 0;
  for (const line of lines.slice(1)) {
    const v = (line.split(",")[col] || "").trim();
    if (v && !terms.includes(v)) terms.push(v);
  }
  terms = terms.slice(0, limit);
} else {
  terms = args.filter(a => !a.startsWith("--"));
  // --per / --col の値が混ざらないよう、直前がオプションのものは除外
  terms = terms.filter((t, i) => {
    const prev = args[args.indexOf(t) - 1];
    return prev !== "--per" && prev !== "--col" && prev !== "--limit" && prev !== "--out";
  });
}
terms = terms.map(t => t.replace(/^#/, "").trim()).filter(Boolean);

if (!terms.length) { console.error("ハッシュタグ/キーワード or --csv を指定してください"); process.exit(1); }

// 数値フィールドを複数候補から拾う（アクターの出力差異に強くする）
const num = (...vals) => { for (const v of vals) if (typeof v === "number") return v; return 0; };
function videoStats(v) {
  const s = v.stats || v.statistics || {};
  return {
    views: num(v.playCount, v.viewCount, s.playCount, s.viewCount),
    likes: num(v.diggCount, v.likeCount, s.diggCount, s.likeCount),
    comments: num(v.commentCount, s.commentCount),
    shares: num(v.shareCount, s.shareCount),
    saves: num(v.collectCount, s.collectCount),
  };
}

async function runActor(input) {
  const url = `https://api.apify.com/v2/acts/${TIKTOK_ACTOR}/run-sync-get-dataset-items?token=${TOKEN}`;
  const res = await axios.post(url, input, { timeout: 240000, headers: { "Content-Type": "application/json" } });
  return res.data; // dataset items 配列
}

async function fetchTerm(term) {
  const input = SEARCH_MODE
    ? { searchQueries: [term], resultsPerPage: perTerm, shouldDownloadVideos: false }
    : { hashtags: [term], resultsPerPage: perTerm, shouldDownloadVideos: false };
  const items = (await runActor(input)) || [];
  if (!items.length) return { term, videos: 0, totalViews: 0, avgViews: 0, totalEng: 0, engRate: null, buzz: 0, note: "取得0件" };

  let totalViews = 0, totalEng = 0;
  for (const v of items) {
    const st = videoStats(v);
    totalViews += st.views;
    totalEng += st.likes + st.comments + st.shares + st.saves;
  }
  const videos = items.length;
  const avgViews = Math.round(totalViews / videos);
  const engRate = totalViews > 0 ? totalEng / totalViews : null;
  // 話題量(buzz) = 総再生数（主指標）。エンゲージは根拠として併記。
  return { term, videos, totalViews, avgViews, totalEng, engRate, buzz: totalViews };
}

// プール内パーセンタイルで1〜5（ランブックのデータアンカー正規化）
function quintilePoint(value, sortedVals) {
  if (!sortedVals.length) return "";
  let lo = 0; while (lo < sortedVals.length && sortedVals[lo] < value) lo++;
  const rank = lo / Math.max(1, sortedVals.length - 1);
  return Math.min(5, Math.max(1, Math.floor(rank * 5) + 1));
}

(async () => {
  console.log(`\n🔍 Apifyで ${terms.length}件のTikTok ${SEARCH_MODE?"キーワード":"ハッシュタグ"}話題量を取得中...（時間がかかります）\n`);
  const results = [];
  for (const t of terms) {
    try {
      const r = await fetchTerm(t);
      results.push(r);
      console.log(`  ${SEARCH_MODE?"":"#"}${t}  再生${r.totalViews.toLocaleString()} / 動画${r.videos} / ENG率${r.engRate==null?"—":(r.engRate*100).toFixed(1)+"%"}`);
    } catch (e) {
      results.push({ term: t, buzz: 0, note: e.response?.status || e.message });
      console.log(`  ${SEARCH_MODE?"":"#"}${t}  取得失敗: ${e.response?.status || e.message}`);
    }
  }

  // buzz のプール内5分位で suggested_point を付与
  const sortedBuzz = results.map(r => r.buzz || 0).sort((a,b)=>a-b);
  results.forEach(r => { r.point = quintilePoint(r.buzz || 0, sortedBuzz); });
  results.sort((a,b) => (b.buzz||0) - (a.buzz||0));

  console.log(`\n${"=".repeat(64)}`);
  console.log("📊 SNS話題量ランキング（TikTok総再生数）");
  console.log(`${"=".repeat(64)}`);
  results.forEach((r,i)=> console.log(`${i+1}. ${SEARCH_MODE?"":"#"}${r.term}  話題量${r.point||"—"}点  (再生${(r.totalViews||0).toLocaleString()})`));

  let csvPath;
  if (outArg) {
    csvPath = outArg;
    fs.mkdirSync(path.dirname(csvPath), { recursive: true });
  } else {
    const outDir = path.join(__dirname, "../../分析レポート/tiktok_data");
    fs.mkdirSync(outDir, { recursive: true });
    const date = new Date().toISOString().slice(0,10);
    csvPath = path.join(outDir, `${date}_話題量.csv`);
  }
  const head = "対象,種別,サンプル動画数,総再生数,平均再生数,総エンゲージ,エンゲージ率%,話題量_点(1-5)";
  const lines = results.map(r =>
    `${r.term},${SEARCH_MODE?"keyword":"hashtag"},${r.videos||0},${r.totalViews||0},${r.avgViews||0},${r.totalEng||0},${r.engRate==null?"":(r.engRate*100).toFixed(1)},${r.point||""}`);
  fs.writeFileSync(csvPath, "﻿"+[head,...lines].join("\n"), "utf-8");
  console.log(`\n✅ 結果CSV: ${csvPath}`);
  console.log("   次：話題量_点 を候補プールDBの『SNS話題量_点』、総再生数等を『SNS_根拠』に転記。");
  console.log("   ※ 話題量_点はv0.1の目安。最終点は編集判断で上書き可。");
})();
