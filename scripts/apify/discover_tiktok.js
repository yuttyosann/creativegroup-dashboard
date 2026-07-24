/**
 * Apify 外部API — TikTok 共起ハッシュタグから「候補」を発掘する
 *
 * Trepoトレンド大賞2026の候補生成（Layer 1）用。
 * シードのハッシュタグでTikTok動画を取得し、一緒に付けられている
 * ハッシュタグ（共起タグ）を集計して、関連トレンド＝候補を発掘する。
 *
 * ※Google Trendsは候補発見に使えないため（discover=404 / related=429）、
 *   自動の候補生成はTikTok（Z世代の本丸・Apifyで安定取得）を主軸とする。
 *
 * 【使い方】
 *   node scripts/apify/discover_tiktok.js 新作コスメ コンビニスイーツ
 *   node scripts/apify/discover_tiktok.js --csv seeds.csv --col ハッシュタグ --out out.csv
 *
 * 【出力】 CSV: seed,candidate,count,views
 *   candidate … 共起ハッシュタグ（＝候補の種）。count=共起回数、views=合計再生数
 */

require("dotenv").config();
const axios = require("axios");
const fs = require("fs");
const path = require("path");

const TOKEN = process.env.APIFY_TOKEN;
if (!TOKEN) {
  console.error("❌ .env に APIFY_TOKEN がありません。");
  process.exit(1);
}

const TIKTOK_ACTOR = "clockworks~tiktok-scraper";

// ---- 引数 ----
const args = process.argv.slice(2);
const num = (flag, def) => { const i = args.indexOf(flag); return i >= 0 && args[i+1] ? parseInt(args[i+1],10) : def; };
const str = (flag, def) => { const i = args.indexOf(flag); return i >= 0 && args[i+1] ? args[i+1] : def; };
const perSeed   = num("--per", 40);    // 1シードあたり取得する動画数
const topPerSeed= num("--top", 8);     // 1シードあたり出力する候補数
const maxSeeds  = num("--max-seeds", 12); // コスト上限（超過分はスキップし明示ログ）
const outArg    = str("--out", null);
const csvArg    = str("--csv", null);
const colArg    = str("--col", null);

// 汎用タグ（候補にならない）を完全一致で除外。
// ※完全一致なので「地雷リップ」「限定スイーツ」等の具体的トレンドは残る。
const STOP = new Set([
  // TikTok定型
  "fyp","fypシ","fypage","foryou","foryoupage","おすすめ","おすすめにのりたい","おすすめのせて",
  "tiktok","viral","trending","capcut","日本","japan","バズれ","拡散希望","tiktokデビュー",
  "pr","ad","提供","購入品","紹介","レビュー","検証","おすすめ商品","好きなものリスト","毎日投稿",
  // カテゴリ総称（候補ではない）
  "コスメ","メイク","リップ","スキンケア","ヘアケア","ボディケア","香水","フレグランス",
  "スイーツ","グルメ","カフェ","food","asmr","モッパン","飯テロ","お菓子","コンビニ",
  "ファッション","コーデ","服","おでかけ","旅行","観光","エンタメ","アニメ","音楽",
  "雑貨","便利グッズ","推し活",
  // persona・行動タグ
  "コスメオタク","美容垢","コスメ好きさんと繋がりたい","女子高生","jk","大学生","主婦",
  "購入品紹介","開封","使ってみた","比較",
]);
const normalize = (s) => String(s || "").replace(/^#/, "").trim();

let seeds = [];
if (csvArg) {
  const text = fs.readFileSync(csvArg, "utf-8").replace(/^﻿/, "");
  const lines = text.split(/\r?\n/).filter(Boolean);
  const header = lines[0].split(",");
  const col = colArg ? header.findIndex(h => h.trim() === colArg) : 0;
  for (const line of lines.slice(1)) {
    const cell = (line.split(",")[col] || "").trim();
    // "#a #b #c" 形式を分解
    for (const t of cell.split(/[\s、,]+/)) {
      const v = normalize(t);
      if (v && v !== "—" && !seeds.includes(v)) seeds.push(v);
    }
  }
} else {
  seeds = args.filter(a => !a.startsWith("--")).filter((t) => {
    const prev = args[args.indexOf(t) - 1];
    return !["--per","--top","--max-seeds","--out","--csv","--col"].includes(prev);
  }).map(normalize).filter(Boolean);
}

if (!seeds.length) { console.error("シードのハッシュタグ or --csv を指定してください"); process.exit(1); }
if (seeds.length > maxSeeds) {
  console.log(`⚠ シード${seeds.length}件のうち先頭${maxSeeds}件のみ処理します（コスト上限 --max-seeds）。スキップ: ${seeds.slice(maxSeeds).join(", ")}`);
  seeds = seeds.slice(0, maxSeeds);
}

async function runActor(input) {
  const url = `https://api.apify.com/v2/acts/${TIKTOK_ACTOR}/run-sync-get-dataset-items?token=${TOKEN}`;
  const res = await axios.post(url, input, { timeout: 240000, headers: { "Content-Type": "application/json" } });
  return res.data || [];
}

/** 1シードの共起ハッシュタグを集計 */
async function discoverFromSeed(seed, seedSet) {
  const items = await runActor({ hashtags: [seed], resultsPerPage: perSeed, shouldDownloadVideos: false });
  const agg = new Map(); // tag -> {count, views}
  for (const v of items) {
    const views = typeof v.playCount === "number" ? v.playCount : 0;
    for (const h of (v.hashtags || [])) {
      // hashtagsは {name} オブジェクト or 文字列。それ以外は無視（[object Object]化を防ぐ）
      const raw = typeof h === "string" ? h : (h && typeof h.name === "string" ? h.name : "");
      const name = normalize(raw);
      if (!name) continue;
      const low = name.toLowerCase();
      if (seedSet.has(name) || STOP.has(low) || STOP.has(name)) continue;
      if (name.length < 2 || /^\d+$/.test(name)) continue;
      const cur = agg.get(name) || { count: 0, views: 0 };
      cur.count++; cur.views += views;
      agg.set(name, cur);
    }
  }
  return [...agg.entries()]
    .map(([candidate, s]) => ({ seed, candidate, count: s.count, views: s.views }))
    .sort((a, b) => b.count - a.count || b.views - a.views)
    .slice(0, topPerSeed);
}

(async () => {
  console.log(`\n🔎 TikTokの共起ハッシュタグから候補を発掘中…（シード${seeds.length}件 × 動画${perSeed}本）\n`);
  const seedSet = new Set(seeds);
  const rows = [];
  for (const seed of seeds) {
    try {
      const found = await discoverFromSeed(seed, seedSet);
      rows.push(...found);
      console.log(`  #${seed} → ${found.length}件: ${found.map(f => f.candidate).join(", ")}`);
    } catch (e) {
      console.log(`  #${seed} 取得失敗: ${e.response?.status || e.message}`);
    }
  }

  let csvPath;
  if (outArg) { csvPath = outArg; fs.mkdirSync(path.dirname(csvPath), { recursive: true }); }
  else {
    const dir = path.join(__dirname, "../../分析レポート/tiktok_data");
    fs.mkdirSync(dir, { recursive: true });
    csvPath = path.join(dir, `${new Date().toISOString().slice(0,10)}_候補発掘.csv`);
  }
  const head = "seed,candidate,count,views";
  const lines = rows.map(r => `${r.seed},${r.candidate},${r.count},${r.views}`);
  fs.writeFileSync(csvPath, "﻿" + [head, ...lines].join("\n"), "utf-8");
  console.log(`\n✅ 候補 ${rows.length}件 → ${csvPath}`);
})();
