/**
 * Claude で「ブランドの具体的な商品」だけを精選する（Trepoトレンド大賞2026 商品解決）
 *
 * discover_tiktok.js にブランド名を渡すと、その共起ハッシュタグには
 * 商品名（クリーミータッチライナー / グロスアブソリュ）に混じって、
 * 総称語（韓国コスメ・ヘアオイル）・職業/人物（美容師・ウォニョン）・
 * 季節イベント（クリスマスプレゼント）が大量に混ざる。
 * Claudeに「このブランドが実際に販売している具体的な商品か？」を判定させる。
 *
 * 【使い方】
 *   node scripts/ai/filter_products.js --csv <discover出力.csv> --out <商品.csv>
 * 【入力CSV】 seed,candidate,count,views   ※seed がブランド名
 * 【出力CSV】 brand,name,reason
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const Anthropic = require("@anthropic-ai/sdk");

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("❌ ANTHROPIC_API_KEY がありません（.env に設定してください）");
  process.exit(1);
}

const arg = (flag, def) => { const i = process.argv.indexOf(flag); return i >= 0 && process.argv[i+1] ? process.argv[i+1] : def; };
const csvIn = arg("--csv", null);
const outPath = arg("--out", null);
if (!csvIn) { console.error("--csv を指定してください"); process.exit(1); }

function parseCSV(text) {
  text = text.replace(/^﻿/, "");
  const lines = text.split(/\r?\n/).filter(Boolean);
  const header = lines[0].split(",");
  return lines.slice(1).map((line) => {
    const cols = line.split(",");
    const o = {};
    header.forEach((h, i) => (o[h.trim()] = (cols[i] || "").trim()));
    return o;
  });
}
const rows = parseCSV(fs.readFileSync(csvIn, "utf-8"));
if (!rows.length) { console.error("入力が空です"); process.exit(1); }

// ブランド（seed）ごとに共起タグをまとめる
const byBrand = new Map();
for (const r of rows) {
  const brand = (r.seed || "").trim();
  const cand = (r.candidate || "").trim();
  if (!brand || !cand) continue;
  const cur = byBrand.get(brand) || [];
  cur.push({ name: cand, count: Number(r.count || 0), views: Number(r.views || 0) });
  byBrand.set(brand, cur);
}

const SCHEMA = {
  type: "object",
  properties: {
    products: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "integer", description: "入力リストの番号。必ず入力と1対1で対応させる" },
          brand: { type: "string", description: "対象ブランド名" },
          name: { type: "string", description: "商品の正式表記（日本語優先。英字表記は日本語に直す）" },
          keep: { type: "boolean", description: "そのブランドが販売する具体的な商品ならtrue" },
          reason: { type: "string", description: "判断理由を日本語で簡潔に" },
        },
        required: ["id", "brand", "name", "keep", "reason"],
        additionalProperties: false,
      },
    },
  },
  required: ["products"],
  additionalProperties: false,
};

const SYSTEM = `あなたはZ世代女性向けトレンドメディア「Trepo」の編集アシスタントです。
「Trepoトレンド大賞2026」は**具体的な商品・サービス単位**で表彰します。
ブランド名だけでは受賞対象になりません（お試し会で実際に試す必要があるため）。

与えられるのは「あるブランドのTikTok投稿に一緒に付いていたハッシュタグ」です。
この中から、**そのブランドが実際に販売している具体的な商品**だけを選んでください。

keep=true にすべきもの（具体的な商品）:
- 商品名・ライン名（例: クリーミータッチライナー、グロスアブソリュ、ジューシーラスティングティント）
- そのブランドの特定シリーズ（例: クリームチーク、プランぷくコーデアイズ）

keep=false にすべきもの:
- カテゴリ総称・商品ジャンル（コスメ、リップ、ヘアオイル、トリートメント、シャンプー、チーク）
- ブランド名そのもの・その言語違い（romand、canmake、kerastase、롬앤）
- 国・産地・属性（韓国コスメ、デパコス、プチプラ、ドラコス）
- 人物・職業・タレント（ウォニョン、美容師、モデル名）
- 行動・投稿形式（購入品、開封動画、コスメレポ、パケ買い、使ってみた）
- 季節・イベント・販促（クリスマスプレゼント、メガ割、母の日）
- 効果・悩みワード（毛穴、垢抜け、髪質改善、ツヤ髪、乾燥ケア）

その他のルール:
- 表記ゆれ・多言語表記は日本語の正式表記に統一する
  （juicyflashlipoil→ジューシーフラッシュリップオイル、틴트→ティント）
- **確信が持てないものは keep=false にする**（後で人が確認するので、取りこぼしより誤検出を避ける）
- **入力の各項目には番号(id)が振ってある。出力の id は必ずその番号と一致させ、入力の全項目について過不足なく1件ずつ返すこと。**`;

(async () => {
  const client = new Anthropic();
  const all = [];
  let idx = 0;
  const indexed = [];
  for (const [brand, items] of byBrand) {
    for (const it of items) { idx++; indexed.push({ id: idx, brand, ...it }); }
  }
  const list = indexed.map((x) =>
    `id=${x.id}: ブランド「${x.brand}」の共起タグ: ${x.name}（共起${x.count}回 / 再生${x.views.toLocaleString()}）`
  ).join("\n");

  console.log(`🤖 Claudeで ${indexed.length}件（${byBrand.size}ブランド）から商品を精選中…`);
  const res = await client.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 16000,
    system: SYSTEM,
    thinking: { type: "adaptive" },
    output_config: {
      effort: "high",
      format: { type: "json_schema", schema: SCHEMA },
    },
    messages: [{
      role: "user",
      content: `各ブランドの共起ハッシュタグです。そのブランドが販売する具体的な商品だけを keep=true にしてください。idは入力の番号と必ず一致させてください。\n\n${list}`,
    }],
  });

  const text = res.content.find((b) => b.type === "text")?.text || "{}";
  const parsed = JSON.parse(text);
  const out = parsed.products || [];

  const missing = indexed.map((x) => x.id).filter((n) => !out.some((p) => p.id === n));
  if (missing.length) console.log(`  ⚠ 判定が返らなかった項目: ${missing.length}件`);
  const kept = out.filter((p) => p.keep && p.id >= 1 && p.id <= indexed.length);

  // ブランド＋商品名で重複統合
  const seen = new Set();
  const final = [];
  for (const p of kept) {
    const key = `${p.brand} ${String(p.name).trim()}`;
    if (!p.name || seen.has(key)) continue;
    seen.add(key);
    final.push(p);
  }

  console.log(`  → ${out.length}件中 ${final.length}件を商品として採用`);
  for (const p of final) console.log(`   ✓ [${p.brand}] ${p.name} — ${p.reason}`);

  const dest = outPath || path.join("分析レポート", "tiktok_data", `${new Date().toISOString().slice(0,10)}_商品候補.csv`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const esc = (s) => `"${String(s).replace(/"/g, '""')}"`;
  const lines = ["brand,name,reason", ...final.map((p) => [p.brand, p.name, p.reason].map(esc).join(","))];
  fs.writeFileSync(dest, "﻿" + lines.join("\n"), "utf-8");
  console.log(`\n✅ 商品候補 ${final.length}件 → ${dest}`);
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
