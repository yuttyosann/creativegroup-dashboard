/**
 * Claude で「候補になりうるもの」だけを精選する（Trepoトレンド大賞2026 候補生成）
 *
 * discover_tiktok.js が出した共起ハッシュタグには、総称語（コスメ/スイーツ）・
 * persona語（オタク/女子高生）・プラットフォーム定型（fyp/vlog）・表記ゆれ
 * （リゼロ/rezero）が大量に混ざる。Claudeに判定させて、
 *   ・具体的な商品/ブランド/スポット/作品/コラボ か？
 *   ・正しいカテゴリは？（シード由来のカテゴリ継承は誤りやすいので補正）
 *   ・表記ゆれは日本語の正式表記に統一
 * を行い、候補として妥当なものだけを残す。
 *
 * 【使い方】
 *   node scripts/ai/filter_candidates.js --csv <discover出力.csv> --out <精選.csv>
 * 【入力CSV】 seed,candidate,count,views
 * 【出力CSV】 name,category,reason
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const Anthropic = require("@anthropic-ai/sdk");

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("❌ ANTHROPIC_API_KEY がありません（.env に設定してください）");
  process.exit(1);
}

const CATEGORIES = [
  "コスメ", "スキンケア", "ヘアケア", "ボディケア", "フレグランス",
  "食品・飲料", "ライフスタイル雑貨", "ファッション",
  "おでかけ・スポット", "エンタメ・コンテンツ", "その他",
];

const arg = (flag, def) => { const i = process.argv.indexOf(flag); return i >= 0 && process.argv[i+1] ? process.argv[i+1] : def; };
const csvIn = arg("--csv", null);
const outPath = arg("--out", null);
if (!csvIn) { console.error("--csv を指定してください"); process.exit(1); }

// ---- 入力CSV読み込み ----
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

// 重複タグはまとめる（同じcandidateが複数seedから出る）
const byName = new Map();
for (const r of rows) {
  const name = (r.candidate || "").trim();
  if (!name) continue;
  const cur = byName.get(name) || { name, seeds: new Set(), count: 0, views: 0 };
  cur.seeds.add(r.seed);
  cur.count += Number(r.count || 0);
  cur.views += Number(r.views || 0);
  byName.set(name, cur);
}
const items = [...byName.values()].map((x) => ({
  name: x.name, seeds: [...x.seeds].join(" / "), count: x.count, views: x.views,
}));

const SCHEMA = {
  type: "object",
  properties: {
    candidates: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "integer", description: "入力リストの番号。必ず入力と1対1で対応させる" },
          name: { type: "string", description: "候補の正式表記（日本語優先。表記ゆれは統一する）" },
          category: { type: "string", enum: CATEGORIES },
          keep: { type: "boolean", description: "賞の候補として妥当ならtrue" },
          reason: { type: "string", description: "判断理由を日本語で簡潔に" },
        },
        required: ["id", "name", "category", "keep", "reason"],
        additionalProperties: false,
      },
    },
  },
  required: ["candidates"],
  additionalProperties: false,
};

const SYSTEM = `あなたはZ世代女性向けトレンドメディア「Trepo」の編集アシスタントです。
「Trepoトレンド大賞2026」の候補になりうるものを選別します。

賞の対象は「2026年に話題になった具体的な商品・サービス・スポット・コンテンツ・コラボ」です。

keep=true にすべきもの（具体的で、賞として表彰できる対象）:
- 商品名・ブランド名（例: キャンメイク、リップフォンデュ、fwee）
- 店舗・チェーン・スポット（例: セブンイレブン、ホテルニューオータニ、竹下通り）
- 作品・IP・コンテンツ（例: ちいかわ、青ブタ、サンリオ）
- 具体的なサービスやEC（例: SHEIN、Temu）

keep=false にすべきもの（候補にならない）:
- カテゴリ総称（コスメ、スイーツ、リップ、コーデ、カフェ）
- persona・行動・属性タグ（オタク、女子高生、購入品、開封動画、使ってみた）
- プラットフォーム定型・ミーム（fyp、おすすめ、vlog、ASMR、モッパン）
- 地名や国名だけの広すぎるもの（東京、韓国、日本）
- トレンドの型・スタイル語で商品でないもの（量産型、地雷系、映え）

その他のルール:
- 表記ゆれ・多言語表記は日本語の正式表記に統一する（rezero→リゼロ、트와이스→TWICE、冰之城牆→氷の城壁）
- category は必ず対象の実態に合わせる。シード由来のカテゴリは誤っていることがあるので、名前から正しく判断する
  - 例: 「サンリオ」「にじさんじ」「アニメ作品」→ エンタメ・コンテンツ
  - 例: 「ホテル◯◯」「新大久保」「◯◯カフェ」など場所 → おでかけ・スポット
  - 例: 「SHEIN」「Temu」など通販・雑貨 → ライフスタイル雑貨（服中心ならファッション）
  - 例: 「セブンイレブン」「ローソン」→ 食品・飲料
  - どうしても当てはまらない場合のみ その他
- **入力の各項目には番号(id)が振ってある。出力の id は必ずその番号と一致させ、入力の全項目について過不足なく1件ずつ返すこと。**`;

(async () => {
  const client = new Anthropic();
  const list = items.map((x, i) =>
    `id=${i + 1}: ${x.name}（seed: ${x.seeds} / 共起${x.count}回 / 再生${x.views.toLocaleString()}）`
  ).join("\n");

  console.log(`🤖 Claudeで ${items.length}件を精選中…`);
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
      content: `TikTokの共起ハッシュタグから発掘した候補リストです。各項目について id / keep / category / name（正式表記）/ reason を判定してください。idは入力の番号と必ず一致させてください。\n\n${list}`,
    }],
  });

  const text = res.content.find((b) => b.type === "text")?.text || "{}";
  const parsed = JSON.parse(text);
  const all = parsed.candidates || [];

  // idで入力と突合（ズレ検出）。idが元の項目と対応しないものは捨てる。
  const missing = items.map((_, i) => i + 1).filter((n) => !all.some((c) => c.id === n));
  if (missing.length) console.log(`  ⚠ 判定が返らなかった項目: ${missing.map((n) => items[n-1].name).join(", ")}`);
  const kept = all.filter((c) => c.keep && c.id >= 1 && c.id <= items.length);

  // 正式表記で重複統合
  const seen = new Set();
  const final = [];
  for (const c of kept) {
    const n = String(c.name).trim();
    if (!n || seen.has(n)) continue;
    seen.add(n);
    final.push(c);
  }

  console.log(`  → ${all.length}件中 ${final.length}件を採用（${all.length - final.length}件を除外）`);
  for (const c of final) console.log(`   ✓ ${c.name}（${c.category}）— ${c.reason}`);

  const out = outPath || path.join("分析レポート", "tiktok_data", `${new Date().toISOString().slice(0,10)}_精選候補.csv`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const esc = (s) => `"${String(s).replace(/"/g, '""')}"`;
  const lines = ["name,category,reason", ...final.map((c) => [c.name, c.category, c.reason].map(esc).join(","))];
  fs.writeFileSync(out, "﻿" + lines.join("\n"), "utf-8");
  console.log(`\n✅ 精選候補 ${final.length}件 → ${out}`);
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
