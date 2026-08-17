# ブランド→商品の解決 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 編集部が採用したブランドについて、TikTok再検索＋Claude精選で「2026年に話題になった具体的な商品」を提案し、選ばれた商品を候補プールDBに登録できるようにする（対象名＝商品名／企業名＝ブランド名）。

**Architecture:** 新規 `award-signal-tool/lib/products.js` に商品解決を分離（`discover.js` は発掘の責務のみ・200行超のため）。既存 `scripts/apify/discover_tiktok.js` を無変更で再利用し、Claude精選だけ新規 `scripts/ai/filter_products.js` を作る。商品解決も**提案のみでNotionには書かない**（登録は承認後の `adoptCandidates` に一本化）。

**Tech Stack:** Node.js（`award-signal-tool` は ESM `type: module`／`scripts/` は CommonJS）、node:test（テストは既存慣習に合わせ CommonJS `test/*.test.js` から動的importでESMを読む）、Apify、Anthropic SDK、Cloud Run。

**設計書:** [2026-07-28-trepo-award-product-resolution-design.md](../specs/2026-07-28-trepo-award-product-resolution-design.md)

---

## 事前準備

- [ ] **作業ブランチを作成**（mainへ直接コミットしない）

```bash
cd /Users/yuttyo/claude/creativegroup-dashboard
git checkout main && git pull
git checkout -b feat/award-product-resolution
```

---

## ファイル構成

| ファイル | 変更 | 責務 |
|---|---|---|
| `award-signal-tool/lib/products.js` | **新規** | `needsProductResolution()`・`planResolution()`（純粋関数）／`resolveProducts()`（TikTok再検索→Claude精選→商品候補を返す。Notionには書かない） |
| `scripts/ai/filter_products.js` | **新規** | 「このブランドの具体的商品はどれか」をClaudeで判定するCLI |
| `test/product-resolution.test.js` | **新規** | `needsProductResolution()`・`planResolution()` の単体テスト（計10ケース） |
| `award-signal-tool/lib/notion.js` | 修正 | `createCandidate` が `企業名`(brand) を受け取れるようにする |
| `award-signal-tool/lib/discover.js` | 修正 | `adoptCandidates` が `brand` を `createCandidate` に渡す |
| `award-signal-tool/server.js` | 修正 | `POST /api/products/resolve` を追加 |
| `award-signal-tool/public/index.html` | 修正 | 採用フローを2段階に（商品選択カード追加） |
| `docs/superpowers/specs/trepo-trend-award-2026-INDEX.md` | 修正 | §5-2に商品解決を反映 |

---

## Task 1: `needsProductResolution()` 純粋関数

**Files:**
- Create: `award-signal-tool/lib/products.js`
- Test: `test/product-resolution.test.js`（新規）

- [ ] **Step 1: 失敗するテストを書く**

`test/product-resolution.test.js` を新規作成:

```js
'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert');

let needsProductResolution;
before(async () => {
  ({ needsProductResolution } = await import('../award-signal-tool/lib/products.js'));
});

test('商品系カテゴリは true（商品まで解決する）', () => {
  for (const c of ['コスメ', 'スキンケア', 'ヘアケア', 'ボディケア', 'フレグランス',
                   '食品・飲料', 'ライフスタイル雑貨', 'ファッション']) {
    assert.equal(needsProductResolution(c), true, `${c} は true のはず`);
  }
});

test('非商品系カテゴリは false（それ自体が受賞対象）', () => {
  for (const c of ['おでかけ・スポット', 'エンタメ・コンテンツ', 'その他']) {
    assert.equal(needsProductResolution(c), false, `${c} は false のはず`);
  }
});

test('未知カテゴリ・空・undefined は false（安全側に倒す）', () => {
  assert.equal(needsProductResolution('謎カテゴリ'), false);
  assert.equal(needsProductResolution(''), false);
  assert.equal(needsProductResolution(undefined), false);
  assert.equal(needsProductResolution(null), false);
});

test('前後の空白は無視する', () => {
  assert.equal(needsProductResolution('  コスメ  '), true);
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npm test 2>&1 | grep -B2 -A6 "product-resolution"`
Expected: FAIL（`Cannot find module '../award-signal-tool/lib/products.js'`）

- [ ] **Step 3: `products.js` を作成し `needsProductResolution` を実装**

`award-signal-tool/lib/products.js` を新規作成:

```js
// ブランド→商品の解決: 採用されたブランドから「具体的な商品」を発掘して提案する。
// ※受賞対象は商品/サービス単位（お試し会・商品サンプル取寄せ・重複排除ルールが商品前提）。
// ※ここでもNotionには一切書き込まない。登録は承認後の adoptCandidates() のみ。
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");

// 商品まで落とすカテゴリ（受賞対象が「商品」であるもの）。
// おでかけ・スポット / エンタメ・コンテンツ は対象そのものが受賞対象なので解決しない。
const PRODUCT_CATEGORIES = new Set([
  "コスメ", "スキンケア", "ヘアケア", "ボディケア", "フレグランス",
  "食品・飲料", "ライフスタイル雑貨", "ファッション",
]);

/**
 * このカテゴリは「ブランド→商品」の解決が必要か（純粋関数）。
 * 未知・空のカテゴリは false（安全側: 無駄な検索を走らせない）。
 * @param {string} category
 * @returns {boolean}
 */
export function needsProductResolution(category) {
  return PRODUCT_CATEGORIES.has(String(category || "").trim());
}
```

- [ ] **Step 4: テストを実行して成功を確認**

Run: `npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"`
Expected: `fail 0`（既存テスト＋新規4ケースが pass）

- [ ] **Step 5: コミット**

```bash
git add award-signal-tool/lib/products.js test/product-resolution.test.js
git commit -m "feat(award): needsProductResolution でカテゴリ別の商品解決要否を判定"
```
（コミットメッセージ末尾に空行を挟んで `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` を追加すること。以降のタスクも同様）

---

## Task 2: Claude精選スクリプト `filter_products.js`

**Files:**
- Create: `scripts/ai/filter_products.js`

既存 `scripts/ai/filter_candidates.js` と同じ構造（CommonJS・`require("dotenv").config()`・構造化出力）。
CLI単体で動くので、実キーで直接検証する。

- [ ] **Step 1: `scripts/ai/filter_products.js` を作成**

```js
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
    const key = `${p.brand} ${String(p.name).trim()}`;
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
```

- [ ] **Step 2: 実データで動作確認（実キー・ネットワークあり）**

> ⚠️ サンドボックスでは Apify / Anthropic に繋がらないため `dangerouslyDisableSandbox: true` で実行すること。

既に検証済みの共起データを使う。無ければ先に発掘する:

```bash
cd /Users/yuttyo/claude/creativegroup-dashboard
export APIFY_TOKEN=$(grep "^APIFY_TOKEN=" .env | cut -d= -f2-)
node scripts/apify/discover_tiktok.js キャンメイク ケラスターゼ --per 30 --top 12 --max-seeds 2 --out /tmp/b2p.csv
node scripts/ai/filter_products.js --csv /tmp/b2p.csv --out /tmp/b2p_products.csv
```

Expected: キャンメイクから「クリーミータッチライナー」「クリームチーク」等、
ケラスターゼから「グロスアブソリュ」等が採用され、
総称語（ヘアオイル・トリートメント・シャンプー）・人物（ウォニョン）・
季節（クリスマスプレゼント）が除外されていること。

- [ ] **Step 3: コミット**

```bash
git add scripts/ai/filter_products.js
git commit -m "feat(award): ブランドの共起タグから商品を精選する filter_products.js を追加"
```

---

## Task 3: `planResolution()` 純粋関数（対象の振り分けと上限）

「どのブランドを解決し／除外し／次回に回すか」を、ネットワーク非依存の純粋関数として切り出す。
上限や除外がサイレントに効いてしまう事故を防ぐため、ここは必ずテストで固定する。

**Files:**
- Modify: `award-signal-tool/lib/products.js`
- Test: `test/product-resolution.test.js`（Task 1で作成済みのファイルに追記）

- [ ] **Step 1: 失敗するテストを追記**

`test/product-resolution.test.js` の末尾に追記し、冒頭の `before` も `planResolution` と `BRAND_CAP` を読むよう変更する。

冒頭の `before(...)` を次に置き換える:
```js
let needsProductResolution, planResolution, BRAND_CAP;
before(async () => {
  ({ needsProductResolution, planResolution, BRAND_CAP } =
    await import('../award-signal-tool/lib/products.js'));
});
```

ファイル末尾に追記:
```js
const BRANDS = [
  { name: 'キャンメイク', category: 'コスメ' },
  { name: '江ノ島', category: 'おでかけ・スポット' },
  { name: 'ケラスターゼ', category: 'ヘアケア' },
  { name: '鬼滅の刃', category: 'エンタメ・コンテンツ' },
];

test('非商品系カテゴリは skipped に入り、run には入らない', () => {
  const { run, skipped } = planResolution(BRANDS, 10);
  assert.deepEqual(run.map(r => r.name), ['キャンメイク', 'ケラスターゼ']);
  assert.deepEqual(skipped.map(s => s.brand).sort(), ['江ノ島', '鬼滅の刃'].sort());
  assert.ok(skipped.every(s => s.why));
});

test('cap を超えた分は deferred に入り、消えない', () => {
  const many = Array.from({ length: 13 }, (_, i) => ({ name: `ブランド${i + 1}`, category: 'コスメ' }));
  const { run, deferred } = planResolution(many, 10);
  assert.equal(run.length, 10);
  assert.equal(deferred.length, 3);
  // run と deferred を合わせると入力を漏れなく網羅する
  assert.deepEqual([...run, ...deferred].map(x => x.name), many.map(x => x.name));
});

test('# と前後空白を正規化し、空名は捨てる', () => {
  const { run } = planResolution(
    [{ name: '#fwee', category: 'コスメ' }, { name: '  ', category: 'コスメ' }, { name: ' ロムアンド ', category: 'コスメ' }],
    10);
  assert.deepEqual(run.map(r => r.name), ['fwee', 'ロムアンド']);
});

test('同じブランドが重複しても1回だけ', () => {
  const { run } = planResolution(
    [{ name: 'fwee', category: 'コスメ' }, { name: '#fwee', category: 'コスメ' }], 10);
  assert.equal(run.length, 1);
});

test('空入力でも落ちない', () => {
  assert.deepEqual(planResolution([], 10), { run: [], skipped: [], deferred: [] });
  assert.deepEqual(planResolution(undefined, 10), { run: [], skipped: [], deferred: [] });
});

test('BRAND_CAP は 10（1ブランド約35秒 ≒ 6分の想定）', () => {
  assert.equal(BRAND_CAP, 10);
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npm test 2>&1 | grep -A3 "planResolution\|product-resolution" | head -20`
Expected: FAIL（`planResolution is not a function`）

- [ ] **Step 3: `planResolution` と `BRAND_CAP` を実装**

`award-signal-tool/lib/products.js` の `needsProductResolution` の直後に追記:

```js
// 1ブランド約35秒。1回の解決はここまで（≒6分）。超過分は次回に回す。
export const BRAND_CAP = 10;

/**
 * 採用ブランドを「今回解決する / 対象外 / 次回に回す」に振り分ける（純粋関数・ネットワーク不要）。
 * ・非商品系カテゴリ（スポット・エンタメ等）は skipped（対象自体が受賞対象のため）
 * ・# と前後空白を正規化し、空名と重複は捨てる
 * ・cap を超えた分は deferred（サイレントに切り捨てない）
 * @param {Array<{name:string, category:string}>} brands
 * @param {number} cap
 * @returns {{run:{name:string,category:string}[], skipped:{brand:string,category:string,why:string}[], deferred:{name:string,category:string}[]}}
 */
export function planResolution(brands, cap = BRAND_CAP) {
  const limit = Math.max(0, Math.trunc(cap) || 0);
  const targets = [], skipped = [], seen = new Set();
  for (const b of brands || []) {
    const name = String(b?.name || "").replace(/^#/, "").trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const category = b?.category || "";
    if (!needsProductResolution(category)) {
      skipped.push({ brand: name, category, why: "このカテゴリは対象自体が受賞対象のため商品解決しません" });
      continue;
    }
    targets.push({ name, category });
  }
  return { run: targets.slice(0, limit), skipped, deferred: targets.slice(limit) };
}
```

- [ ] **Step 4: テストを実行して成功を確認**

Run: `npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"`
Expected: `fail 0`（Task 1の4ケース＋今回の6ケースを含む）

- [ ] **Step 5: コミット**

```bash
git add award-signal-tool/lib/products.js test/product-resolution.test.js
git commit -m "feat(award): planResolution で解決対象の振り分けと上限を純粋関数化"
```

---

## Task 4: `resolveProducts()` — 商品解決の本体

**Files:**
- Modify: `award-signal-tool/lib/products.js`

- [ ] **Step 1: `resolveProducts` を `products.js` に追記**

`planResolution` の下に、以下をそのまま追記する（`parseCSV` は `discover.js` から再利用する）:

```js
function spawnP(cmd, args, onLog) {
  return new Promise((resolve, reject) => {
    const ps = spawn(cmd, args, { cwd: REPO_ROOT, env: process.env });
    let stderr = "";
    ps.stdout.on("data", d => onLog && onLog(d.toString()));
    ps.stderr.on("data", d => { stderr += d.toString(); onLog && onLog(d.toString()); });
    ps.on("error", reject);
    ps.on("close", code => code === 0 ? resolve() : reject(new Error(`exit ${code}: ${stderr.slice(-300)}`)));
  });
}

/**
 * 採用されたブランドから具体的な商品を発掘して「提案」を返す。Notionには一切書き込まない。
 * 振り分けは planResolution（純粋関数・テスト済み）に委ねる。
 * @param {Array<{name:string, category:string}>} brands
 * @returns {Promise<{resolved:Array<{brand:string,category:string,products:Array<{name:string,reason:string}>}>,
 *                    skipped:Array<{brand:string,category:string,why:string}>,
 *                    deferred:Array<{name:string,category:string}>}>}
 */
export async function resolveProducts(brands, onLog) {
  const log = (s) => onLog && onLog(s);
  const { run, skipped, deferred } = planResolution(brands, BRAND_CAP);

  if (skipped.length) {
    log(`商品解決の対象外 ${skipped.length}件（スポット/エンタメ等はそのまま登録できます）: ${skipped.map(s => s.brand).join(", ")}`);
  }
  if (!run.length) { log("商品解決が必要なブランドはありません"); return { resolved: [], skipped, deferred }; }
  if (deferred.length) {
    log(`⚠ 今回は ${run.length}件を解決します（上限${BRAND_CAP}）。見送り（次回実行してください）: ${deferred.map(d => d.name).join(", ")}`);
  }
  log(`商品を解決中… ${run.length}ブランド（1件あたり約35秒）: ${run.map(r => r.name).join(", ")}`);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "products-"));
  const rawCsv = path.join(tmp, "raw.csv");
  const pickedCsv = path.join(tmp, "picked.csv");

  // 1) ブランド名でTikTok再検索（既存スクリプトを無変更で再利用）
  await spawnP("node", [
    "scripts/apify/discover_tiktok.js", ...run.map(r => r.name),
    "--per", "30", "--top", "12", "--max-seeds", String(run.length), "--out", rawCsv,
  ], log);
  if (!fs.existsSync(rawCsv)) throw new Error("共起タグCSVが生成されませんでした");
  if (!parseCSV(fs.readFileSync(rawCsv, "utf-8")).length) {
    log("⚠ 共起タグが1件も取れませんでした（Apifyのクレジット残高を確認してください）");
    return { resolved: run.map(r => ({ brand: r.name, category: r.category, products: [] })), skipped, deferred };
  }

  // 2) Claude精選（このブランドの具体的商品はどれか）
  await spawnP("node", [
    "scripts/ai/filter_products.js", "--csv", rawCsv, "--out", pickedCsv,
  ], log);
  if (!fs.existsSync(pickedCsv)) throw new Error("商品精選CSVが生成されませんでした");
  const picked = parseCSV(fs.readFileSync(pickedCsv, "utf-8"));

  // 3) ブランドごとにまとめる。商品0件のブランドも必ず結果に残す（候補を失わないため）
  const byBrand = new Map(run.map(r => [r.name, { brand: r.name, category: r.category, products: [] }]));
  for (const p of picked) {
    const brand = String(p.brand || "").trim();
    const name = String(p.name || "").trim();
    if (!brand || !name) continue;
    const entry = byBrand.get(brand);
    if (!entry) continue;
    if (entry.products.some(x => x.name === name)) continue;
    entry.products.push({ name, reason: p.reason || "" });
  }
  const resolved = [...byBrand.values()];
  for (const r of resolved) {
    log(r.products.length
      ? `  ${r.brand}: ${r.products.map(p => p.name).join(" / ")}`
      : `  ${r.brand}: 商品を特定できませんでした（ブランドのまま登録できます）`);
  }
  return { resolved, skipped, deferred };
}
```

- [ ] **Step 2: `parseCSV` の import を冒頭に追加**

Step 1のコードは `parseCSV` を使うが、まだ import していない。
`award-signal-tool/lib/products.js` 冒頭の import 群の最後（`import path from "node:path";` の直後）に追加する:

```js
import { parseCSV } from "./discover.js";
```

- [ ] **Step 3: 構文チェックとテスト**

Run: `node --check award-signal-tool/lib/products.js && npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"`
Expected: 構文OK、`fail 0`

- [ ] **Step 4: 実データで結合確認（実キー・ネットワークあり）**

> `dangerouslyDisableSandbox: true` で実行すること。

```bash
cd /Users/yuttyo/claude/creativegroup-dashboard
export APIFY_TOKEN=$(grep "^APIFY_TOKEN=" .env | cut -d= -f2-)
export ANTHROPIC_API_KEY=$(grep "^ANTHROPIC_API_KEY=" .env | cut -d= -f2-)
node --input-type=module -e '
import { resolveProducts } from "./award-signal-tool/lib/products.js";
const r = await resolveProducts([
  { name: "キャンメイク", category: "コスメ" },
  { name: "江ノ島", category: "おでかけ・スポット" },
], (s) => process.stdout.write(s.endsWith("\n") ? s : s + "\n"));
console.log("\n=== 結果 ===");
console.log("resolved:", JSON.stringify(r.resolved, null, 1));
console.log("skipped:", JSON.stringify(r.skipped));
'
```

Expected:
- 「江ノ島」は `skipped` に入り、TikTok検索が走らない（＝対象外カテゴリの除外が効いている）
- 「キャンメイク」の `products` に クリーミータッチライナー等の商品名が入る

- [ ] **Step 5: コミット**

```bash
git add award-signal-tool/lib/products.js
git commit -m "feat(award): resolveProducts でブランドから商品候補を解決（提案のみ・DB非書込）"
```

---

## Task 5: Notion登録で `企業名` を保存できるようにする

**Files:**
- Modify: `award-signal-tool/lib/notion.js`（`createCandidate`）
- Modify: `award-signal-tool/lib/discover.js`（`adoptCandidates`）

- [ ] **Step 1: `createCandidate` を `brand` 対応にする**

`award-signal-tool/lib/notion.js` の `createCandidate` 関数全体を次で置き換える:

```js
/** 候補プールDBに新しい候補を作成（自動生成された候補用）。brand は企業名（ブランド）に入る */
export async function createCandidate({ name, category, note, brand }) {
  const props = {
    "対象名": { title: [{ text: { content: String(name).slice(0, 190) } }] },
    "流入経路": { select: { name: "編集部リサーチ" } },
    "段階": { select: { name: "0次" } },
  };
  if (category) props["カテゴリ"] = { select: { name: category } };
  if (note) props["トレンドポイント"] = { rich_text: [{ text: { content: String(note).slice(0, 1990) } }] };
  if (brand) props["企業名"] = { rich_text: [{ text: { content: String(brand).slice(0, 1990) } }] };
  await notion("/pages", { method: "POST", body: { parent: { database_id: CAND_DB() }, properties: props } });
}
```

- [ ] **Step 2: `adoptCandidates` が `brand` を渡すようにする**

`award-signal-tool/lib/discover.js` の `adoptCandidates` 内の以下2行を変更する。

変更前:
```js
    const note = ["🔎自動生成(TikTok共起タグ→Claude精選)", it.reason].filter(Boolean).join(" ");
    try {
      await createCandidate({ name, category, note });
      existing.add(name);
      created.push({ name, category });
      log(`  ＋ ${name}（${category}）`);
```

変更後:
```js
    const brand = it.brand ? String(it.brand).trim() : "";
    const note = ["🔎自動生成(TikTok共起タグ→Claude精選)", brand ? `ブランド: ${brand}` : "", it.reason].filter(Boolean).join(" ");
    try {
      await createCandidate({ name, category, note, brand });
      existing.add(name);
      created.push({ name, category, brand });
      log(`  ＋ ${name}${brand ? `（${brand} / ${category}）` : `（${category}）`}`);
```

- [ ] **Step 3: 構文チェックとテスト**

Run: `node --check award-signal-tool/lib/notion.js && node --check award-signal-tool/lib/discover.js && npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"`
Expected: 構文OK、`fail 0`

- [ ] **Step 4: 実際にNotionへ書けるか確認（実データ・ネットワークあり）**

> `dangerouslyDisableSandbox: true` で実行すること。gcloud は `export PATH="$HOME/google-cloud-sdk/bin:$PATH"` が必要。
> **テスト用の候補を1件作り、確認後に必ずアーカイブする**（DBを汚さない）。

```bash
export PATH="$HOME/google-cloud-sdk/bin:$PATH"
cd /Users/yuttyo/claude/creativegroup-dashboard
NT=$(gcloud secrets versions access latest --secret=notion-token --project=cg-project-491303)
NOTION_TOKEN="$NT" CANDIDATE_DB_ID=3832a9c9-20f7-81ad-a21e-fee38dfd4b8c node --input-type=module -e '
import { createCandidate, listCandidates } from "./award-signal-tool/lib/notion.js";
const testName = "__テスト商品_削除してOK__";
await createCandidate({ name: testName, category: "コスメ", note: "動作確認用", brand: "テストブランド" });
const all = await listCandidates();
const hit = all.find(c => c.name === testName);
console.log(hit ? "✅ 登録できた: " + hit.name : "❌ 登録が見つからない");
// 後始末: アーカイブ
const r = await fetch(`https://api.notion.com/v1/pages/${hit.id}`, {
  method: "PATCH",
  headers: { Authorization: "Bearer " + process.env.NOTION_TOKEN, "Notion-Version": "2022-06-28", "Content-Type": "application/json" },
  body: JSON.stringify({ archived: true }),
});
console.log(r.ok ? "✅ テスト候補をアーカイブしました" : "⚠ アーカイブ失敗。手動で削除してください: " + hit.id);
'
```

Expected: `✅ 登録できた` と `✅ テスト候補をアーカイブしました` の両方。
NotionのUIで「企業名」列に「テストブランド」が入っていたことも確認できるとなお良い。

- [ ] **Step 5: コミット**

```bash
git add award-signal-tool/lib/notion.js award-signal-tool/lib/discover.js
git commit -m "feat(award): 候補登録で企業名(ブランド)を保存できるようにする"
```

---

## Task 6: API エンドポイント `POST /api/products/resolve`

**Files:**
- Modify: `award-signal-tool/server.js`

- [ ] **Step 1: import に `resolveProducts` を追加**

`award-signal-tool/server.js` の以下の行:
```js
import { proposeCandidates, adoptCandidates } from "./lib/discover.js";
```
の直後に追加:
```js
import { resolveProducts } from "./lib/products.js";
```

- [ ] **Step 2: エンドポイントと実行関数を追加**

`app.post("/api/candidates/bulk", ...)` のブロック全体の**直後**に、以下を追加する:

```js
// 採用したブランドから具体的な商品を解決する（提案のみ。Notionには書かない）
app.post("/api/products/resolve", requireAuth, (req, res) => {
  const { brands = [] } = req.body || {};
  if (!Array.isArray(brands) || !brands.length) {
    return res.status(400).json({ error: "brands を1件以上指定してください" });
  }
  const id = randomUUID();
  const job = { id, status: "running", createdAt: Date.now(), type: "products", log: [], resolved: [], skipped: [], deferred: [], error: null };
  jobs.set(id, job);
  res.json({ jobId: id });
  runResolve(job, brands).catch((e) => { job.status = "error"; job.error = String(e.message); });
});

async function runResolve(job, brands) {
  const log = (s) => { job.log.push(String(s).replace(/\n+$/, "")); };
  log("=== 採用したブランドの具体的な商品を探しています ===");
  const { resolved, skipped, deferred } = await resolveProducts(brands, log);
  job.resolved = resolved;
  job.skipped = skipped;
  job.deferred = deferred;
  const total = resolved.reduce((n, r) => n + r.products.length, 0);
  log(`=== 完了: ${total}件の商品候補が見つかりました ===`);
  job.status = "done";
}
```

- [ ] **Step 3: 構文チェックとサーバー起動確認**

```bash
cd /Users/yuttyo/claude/creativegroup-dashboard/award-signal-tool
node --check server.js && echo "構文OK"
node --input-type=module -e 'await import("./server.js")' &
sleep 2
curl -s -o /dev/null -w "認証なしPOST → %{http_code}\n" -X POST http://localhost:4000/api/products/resolve \
  -H "Content-Type: application/json" -d '{"brands":[{"name":"x","category":"コスメ"}]}'
curl -s -o /dev/null -w "空bodyでPOST → %{http_code}\n" -X POST http://localhost:4000/api/products/resolve \
  -H "Content-Type: application/json" -d '{}'
kill %1
```

Expected: 構文OK。ローカルは `.env` に `GOOGLE_OAUTH_CLIENT_ID` が無ければ認証不要なので、
1つ目は `200`（ジョブ起動）、2つ目は `400`（brands未指定）。
`.env` にクライアントIDがある場合は両方 `401` になる（それも正常）。

- [ ] **Step 4: コミット**

```bash
git add award-signal-tool/server.js
git commit -m "feat(award): POST /api/products/resolve を追加（商品解決ジョブ）"
```

---

## Task 7: フロントの採用フローを2段階にする

**Files:**
- Modify: `award-signal-tool/public/index.html`

現状の「チェックした候補を登録」は即DB登録する。これを
「商品系は商品解決 → 商品を選んで登録／非商品系はそのまま登録」に変える。

- [ ] **Step 1: 商品選択カードのHTMLを追加**

`award-signal-tool/public/index.html` の、提案カード `</section>` の直後
（`  <section class="card">` で始まる「取得するシグナル」カードの直前）に以下を挿入:

```html
  <section class="card hidden" id="prodCard">
    <h2 class="prop">商品を選ぶ
      <button id="prodAllBtn" class="mini" type="button">全部チェック</button>
    </h2>
    <div class="muted" style="margin:-6px 0 12px;">
      受賞は<b>商品単位</b>です。採用したブランドの具体的な商品を選んでね🎁<br>
      商品が見つからなかったブランドは「ブランドのまま登録」もできます。
    </div>
    <div id="prodList"></div>
    <div class="tools">
      <button id="prodAdoptBtn" disabled>チェックした商品を登録</button>
      <span id="prodCount">0件選択</span>
    </div>
  </section>
```

- [ ] **Step 2: 採用ボタンの処理を差し替える**

`$("#adoptBtn").onclick = async () => { ... };` のブロック全体を、以下で置き換える:

```js
// 商品まで落とすカテゴリ（サーバーの needsProductResolution と揃えること）
const PRODUCT_CATEGORIES = new Set([
  "コスメ", "スキンケア", "ヘアケア", "ボディケア", "フレグランス",
  "食品・飲料", "ライフスタイル雑貨", "ファッション",
]);
let resolvedBrands = [];   // 商品解決の結果
let pendingDirect = [];    // 商品解決不要でそのまま登録するもの

$("#adoptBtn").onclick = async () => {
  const picked = [...document.querySelectorAll(".propchk:checked")].map(cb => proposals[Number(cb.value)]);
  if (!picked.length) return;
  const needProduct = picked.filter(p => PRODUCT_CATEGORIES.has((p.category || "").trim()));
  const direct = picked.filter(p => !PRODUCT_CATEGORIES.has((p.category || "").trim()));

  if (!needProduct.length) {
    if (!confirm(`${direct.length}件を候補プールDBに登録します。よろしいですか？`)) return;
    await registerCandidates(direct);
    return;
  }
  if (!confirm(`${needProduct.length}件は具体的な商品を探します（1件あたり約35秒）。\n${direct.length}件はそのまま登録します。\n続けますか？`)) return;

  pendingDirect = direct;
  $("#adoptBtn").disabled = true;
  setStatus("running", "商品を探しています…");
  const r = await apiFetch("/api/products/resolve", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ brands: needProduct }),
  });
  const { jobId, error } = await r.json();
  if (error) { setStatus("error", error); $("#adoptBtn").disabled = false; return; }
  poll(jobId, (job) => {
    $("#adoptBtn").disabled = false;
    if (job.status === "done") renderProducts(job.resolved || []);
  }, "商品を探しています…（TikTok再検索→Claude精選）");
};

function renderProducts(list) {
  resolvedBrands = list;
  if (!resolvedBrands.length) { $("#prodCard").classList.add("hidden"); return; }
  const rows = [];
  resolvedBrands.forEach((b, bi) => {
    if (b.products.length) {
      b.products.forEach((p, pi) => {
        rows.push(`<label class="prop-item">
          <input type="checkbox" class="prodchk" value="${bi}:${pi}">
          <span><b>${esc(p.name)}</b><span class="pill">${esc(b.brand)}</span>
          <div class="reason">${esc(p.reason || "")}</div></span></label>`);
      });
    } else {
      rows.push(`<label class="prop-item">
        <input type="checkbox" class="prodchk" value="${bi}:brand">
        <span><b>${esc(b.brand)}</b><span class="pill">ブランドのまま</span>
        <div class="reason">商品を特定できませんでした。ブランドとして登録し、後で商品名を手で入れられます。</div></span></label>`);
    }
  });
  $("#prodList").innerHTML = rows.join("");
  document.querySelectorAll(".prodchk").forEach(cb => cb.onchange = updateProd);
  $("#prodAllBtn").textContent = "全部チェック";
  $("#prodCard").classList.remove("hidden");
  updateProd();
  const n = resolvedBrands.reduce((a, b) => a + b.products.length, 0);
  setStatus("done", `${n}件の商品候補が見つかりました 🎁 登録するものを選んでね`);
}

function updateProd() {
  const n = document.querySelectorAll(".prodchk:checked").length;
  $("#prodCount").textContent = `${n}件選択`;
  $("#prodAdoptBtn").disabled = n === 0;
}

$("#prodAllBtn").onclick = () => {
  const boxes = [...document.querySelectorAll(".prodchk")];
  const turnOn = boxes.some(cb => !cb.checked);
  boxes.forEach(cb => cb.checked = turnOn);
  $("#prodAllBtn").textContent = turnOn ? "全部はずす" : "全部チェック";
  updateProd();
};

$("#prodAdoptBtn").onclick = async () => {
  const picked = [...document.querySelectorAll(".prodchk:checked")].map(cb => {
    const [bi, pi] = cb.value.split(":");
    const b = resolvedBrands[Number(bi)];
    return pi === "brand"
      ? { name: b.brand, category: b.category, reason: "商品を特定できずブランドとして登録" }
      : { name: b.products[Number(pi)].name, category: b.category, brand: b.brand, reason: b.products[Number(pi)].reason };
  });
  const all = [...picked, ...pendingDirect];
  if (!all.length) return;
  if (!confirm(`${all.length}件を候補プールDBに登録します。よろしいですか？`)) return;
  $("#prodAdoptBtn").disabled = true;
  await registerCandidates(all);
  pendingDirect = [];
};

async function registerCandidates(list) {
  setStatus("running", "候補プールDBに登録中…");
  const r = await apiFetch("/api/candidates/bulk", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ candidates: list }),
  });
  const res = await r.json();
  if (!r.ok) { setStatus("error", res.error || "登録に失敗しました"); $("#adoptBtn").disabled = false; $("#prodAdoptBtn").disabled = false; return; }
  const parts = [`${res.created.length}件を登録しました 🎉`];
  if (res.skipped.length) parts.push(`${res.skipped.length}件は既存のためスキップ`);
  if (res.failed.length) parts.push(`${res.failed.length}件は失敗`);
  setStatus("done", parts.join(" / "));
  $("#propCard").classList.add("hidden");
  $("#prodCard").classList.add("hidden");
  await loadCandidates();
  updateSel();
}
```

- [ ] **Step 3: `poll` がジョブ本体をコールバックに渡すようにする**

現在の `poll(jobId, onEnd)` は `onEnd()` に引数を渡していない。Step 2 の `poll(jobId, (job) => ...)` が
動くよう、`poll` 関数内の `if (onEnd) onEnd();` を次に変更する:

```js
      if (onEnd) onEnd(job);
```

（既存の `poll(jobId, () => { ... })` 呼び出しは引数を無視するだけなので影響しない）

- [ ] **Step 4: ローカルで画面を動かして確認**

```bash
cd /Users/yuttyo/claude/creativegroup-dashboard/award-signal-tool && npm start
```
ブラウザで http://localhost:4000 を開き、**ネットワークをスタブして**以下を確認する
（実際のApify呼び出しをせずUIだけ検証するため、DevToolsコンソールで）:

```js
// 提案とジョブ応答を差し替えて、商品選択カードの表示・選択・送信を確認する
window.__origFetch = window.fetch;
window.fetch = async (url, opts) => {
  if (String(url).includes("/api/products/resolve")) return new Response(JSON.stringify({ jobId: "j1" }), { status: 200 });
  if (String(url).includes("/api/jobs/j1")) return new Response(JSON.stringify({
    status: "done", log: ["テスト"], resolved: [
      { brand: "キャンメイク", category: "コスメ", products: [{ name: "クリーミータッチライナー", reason: "具体的な商品" }] },
      { brand: "ミニュム", category: "コスメ", products: [] },
    ]}), { status: 200 });
  if (String(url).includes("/api/candidates/bulk")) { console.log("送信された候補:", JSON.parse(opts.body)); return new Response(JSON.stringify({ created: [], skipped: [], failed: [] }), { status: 200 }); }
  return window.__origFetch(url, opts);
};
```

Expected:
- 「商品を選ぶ」カードが表示される
- キャンメイクは商品名、ミニュムは「ブランドのまま」として出る
- チェックして登録すると、コンソールの「送信された候補」に
  `{name:"クリーミータッチライナー", category:"コスメ", brand:"キャンメイク", ...}` が含まれる

- [ ] **Step 5: コミット**

```bash
git add award-signal-tool/public/index.html
git commit -m "feat(award): 採用フローを2段階にし商品を選んで登録できるようにする"
```

---

## Task 8: ドキュメント更新

**Files:**
- Modify: `docs/superpowers/specs/trepo-trend-award-2026-INDEX.md`

- [ ] **Step 1: INDEX §5-2 に商品解決を追記**

`trepo-trend-award-2026-INDEX.md` の §5-2 内、`**次にやること（P2候補）**:` で始まる行の**直前**に、以下を挿入:

```markdown
**商品解決（2026-07-28）**: 受賞は**商品単位**（お試し会・商品サンプル取寄せ・重複排除ルールが商品前提）
なのに自動発掘がブランド止まりだった問題を解消。採用したブランドだけTikTok再検索＋Claude精選で
具体的な商品を提案し、選ばれた商品を登録する（`対象名`＝商品名 / `企業名`＝ブランド名）。
スポット・エンタメは対象自体が受賞対象なので商品解決しない
（[設計書](2026-07-28-trepo-award-product-resolution-design.md)）。

```

- [ ] **Step 2: コミット**

```bash
git add docs/superpowers/specs/trepo-trend-award-2026-INDEX.md
git commit -m "docs: ブランド→商品の解決をINDEXに反映"
```

---

## Task 9: ビルド＆デプロイ＆本番検証

**Files:** なし（Cloud Run 運用）。gcloud はサンドボックス外のため `export PATH="$HOME/google-cloud-sdk/bin:$PATH"` ＋ `dangerouslyDisableSandbox: true`。

- [ ] **Step 1: mainへマージ**

```bash
cd /Users/yuttyo/claude/creativegroup-dashboard
git checkout main && git pull origin main
git merge --no-ff feat/award-product-resolution -m "Merge: ブランド→商品の解決（受賞対象を商品単位に）"
git push origin main
```

- [ ] **Step 2: イメージをビルド＆push**

```bash
export PATH="$HOME/google-cloud-sdk/bin:$PATH"
cd /Users/yuttyo/claude/creativegroup-dashboard
gcloud builds submit --config award-signal-tool/cloudbuild.yaml \
  --substitutions _IMAGE=asia-northeast1-docker.pkg.dev/cg-project-491303/cg/trepo-award-tool . \
  --project=cg-project-491303
```
Expected: `STATUS: SUCCESS`

- [ ] **Step 3: デプロイ（env/secretsは既存を保持）**

```bash
gcloud run deploy trepo-award-tool \
  --image asia-northeast1-docker.pkg.dev/cg-project-491303/cg/trepo-award-tool \
  --region asia-northeast1 --project=cg-project-491303
```
Expected: `revision [trepo-award-tool-000NN-xxx] ... serving 100 percent of traffic`
（`--set-env-vars`/`--set-secrets` を付けないので既存の環境変数・シークレットは維持される）

- [ ] **Step 4: デプロイ後の疎通確認**

```bash
curl -s -o /dev/null -w "candidates → %{http_code}\n" https://award.trepo.jp/api/candidates
curl -s -o /dev/null -w "top → %{http_code}\n" https://award.trepo.jp/
export PATH="$HOME/google-cloud-sdk/bin:$PATH"
gcloud run services describe trepo-award-tool --region=asia-northeast1 --project=cg-project-491303 \
  --format='value(spec.template.spec.containers[0].env)' | tr ';' '\n' | grep -c "name" 
```
Expected: candidates → `401`、top → `200`、env の数が `7`（CANDIDATE_DB_ID / SEED_DB_ID / GOOGLE_OAUTH_CLIENT_ID / ALLOWED_EMAILS / notion-token / apify-token / anthropic-api-key）

- [ ] **Step 5: 本番でエンドツーエンド確認（山口さんの操作＋ログ監視）**

山口さんに https://award.trepo.jp で「候補を提案してもらう」→ **コスメ系のブランドをチェックして「登録」** を実行してもらう。
実行者側でログを監視:

```bash
export PATH="$HOME/google-cloud-sdk/bin:$PATH"
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="trepo-award-tool" AND httpRequest.requestUrl:("/api/products/resolve" OR "/api/candidates/bulk")' \
  --project=cg-project-491303 --limit=10 --freshness=30m \
  --format='value(timestamp, httpRequest.requestMethod, httpRequest.status, httpRequest.requestUrl)'
```

Expected:
- `POST /api/products/resolve` が 200
- 画面に「商品を選ぶ」カードが出て、具体的な商品名（クリーミータッチライナー等）が並ぶ
- 商品をチェックして登録すると `POST /api/candidates/bulk` が 200
- Notionの候補プールDBに **対象名＝商品名 / 企業名＝ブランド名** で入っている

---

## 完了条件

- [ ] `npm test` が `fail 0`（needsProductResolution 4ケース＋planResolution 6ケースを含む）
- [ ] `filter_products.js` が実データで商品を抽出できる（Task 2 Step 2）
- [ ] `planResolution` が非商品系を除外し、上限超過を deferred に残す（Task 3・テストで担保）
- [ ] `resolveProducts` が実データで動く（Task 4 Step 4：江ノ島はskipped・キャンメイクは商品が返る）
- [ ] Notionに `企業名` 付きで登録できる（Task 5 Step 4・テスト候補はアーカイブ済み）
- [ ] 本番デプロイ済み・`/api/candidates` が 401・env 7件
- [ ] 本番で商品まで落として登録できる（Task 9 Step 5）
- [ ] INDEX が更新済み
