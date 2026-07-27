# Trepoトレンド大賞 候補発掘 カバレッジ改修 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 候補発掘が全カテゴリ（コスメ等の中核含む）を必ず検索するようにし、1回の実行時間を実証済み範囲（約7〜8分）に抑える。

**Architecture:** `award-signal-tool/lib/discover.js` に純粋関数 `selectSeeds()`（カテゴリ均等＋日次ローテーション＋上限）を追加し、`proposeCandidates()` がフラット化をやめてこれ経由でシードを選ぶ。`discover_tiktok.js` には `--max-seeds` を明示的に渡し件数制御をlib側に一本化。DB登録は承認後のみ（P1の非破壊原則は不変）。

**Tech Stack:** Node.js (ESM, award-signal-tool は `type: module`) / node:test（テストは既存慣習に合わせCommonJS `test/*.test.js` から動的importでESMを読む）/ Apify / Anthropic / Cloud Run。

**設計書:** [2026-07-27-trepo-award-seed-coverage-design.md](../specs/2026-07-27-trepo-award-seed-coverage-design.md)

---

## 事前準備

- [ ] **作業ブランチを作成**（mainへ直接コミットしない）

```bash
cd /Users/yuttyo/claude/creativegroup-dashboard
git checkout main && git pull
git checkout -b feat/award-seed-coverage
```

---

## ファイル構成

| ファイル | 変更 | 責務 |
|---|---|---|
| `award-signal-tool/lib/discover.js` | 修正 | `selectSeeds()` 追加（純粋関数）／ `proposeCandidates()` をカテゴリ均等＋ローテーションに改修 |
| `test/seed-selection.test.js` | 新規 | `selectSeeds()` の単体テスト（CommonJS＋動的import） |
| `docs/superpowers/specs/trepo-award-jisseki-research-runbook.md` | 修正 | シード運用SOP（各カテゴリ2〜4個・フィードバックは手動）を追記 |
| `docs/superpowers/specs/trepo-trend-award-2026-INDEX.md` | 修正 | カバレッジ改修済みを§5-2に反映 |

---

## Task 1: `selectSeeds()` 純粋関数（カテゴリ均等＋ローテーション）

**Files:**
- Modify: `award-signal-tool/lib/discover.js`（`normalize` 定義の直後、`proposeCandidates` の前に追加）
- Test: `test/seed-selection.test.js`（新規）

- [ ] **Step 1: 失敗するテストを書く**

`test/seed-selection.test.js` を新規作成:

```js
'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert');

let selectSeeds;
before(async () => { ({ selectSeeds } = await import('../award-signal-tool/lib/discover.js')); });

// テスト用の入力（カテゴリ→タグ）
const CATS = [
  { category: 'コスメ', tags: ['新作コスメ', 'プチプラコスメ', '韓国コスメ'] },
  { category: 'スキンケア', tags: ['スキンケア', '毛穴ケア'] },
  { category: 'エンタメ', tags: ['推し活'] },
  { category: 'その他', tags: [] }, // タグ空
];

test('cap>=カテゴリ数のとき、タグを持つ全カテゴリが必ず1つ以上選ばれる', () => {
  const { selected } = selectSeeds(CATS, 14, 0);
  const cats = new Set(selected.map(s => s.category));
  assert.ok(cats.has('コスメ'));
  assert.ok(cats.has('スキンケア'));
  assert.ok(cats.has('エンタメ'));
  assert.equal(cats.has('その他'), false); // タグ空は除外
});

test('cap を超えない', () => {
  const { selected } = selectSeeds(CATS, 3, 0);
  assert.equal(selected.length, 3);
});

test('selected と deferred で全ユニークタグを漏れなく網羅する', () => {
  const { selected, deferred } = selectSeeds(CATS, 3, 0);
  const all = [...selected, ...deferred].map(x => x.tag).sort();
  assert.deepEqual(all, ['スキンケア', '推し活', '新作コスメ', '毛穴ケア', '韓国コスメ', 'プチプラコスメ'].sort());
});

test('カテゴリ内の重複タグと # は正規化・除去される', () => {
  const cats = [{ category: 'A', tags: ['#x', 'x', ' x ', 'y'] }];
  const { selected, deferred } = selectSeeds(cats, 10, 0);
  const tags = [...selected, ...deferred].map(x => x.tag);
  assert.deepEqual(tags.sort(), ['x', 'y']);
});

test('カテゴリ間で重複するタグは初出の1回だけ', () => {
  const cats = [
    { category: 'A', tags: ['shein'] },
    { category: 'B', tags: ['shein', 'temu'] },
  ];
  const { selected, deferred } = selectSeeds(cats, 10, 0);
  const all = [...selected, ...deferred].map(x => x.tag);
  assert.equal(all.filter(t => t === 'shein').length, 1);
});

test('rotation を変えると各カテゴリの先頭タグがずれる', () => {
  const r0 = selectSeeds(CATS, 3, 0).selected.find(s => s.category === 'コスメ').tag;
  const r1 = selectSeeds(CATS, 3, 1).selected.find(s => s.category === 'コスメ').tag;
  assert.notEqual(r0, r1); // 3タグあるので回転で先頭が変わる
});

test('同じ rotation なら結果は決定的', () => {
  const a = selectSeeds(CATS, 3, 5);
  const b = selectSeeds(CATS, 3, 5);
  assert.deepEqual(a, b);
});

test('空入力・cap 0 でも落ちない', () => {
  assert.deepEqual(selectSeeds([], 14, 0), { selected: [], deferred: [] });
  assert.deepEqual(selectSeeds(CATS, 0, 0).selected, []);
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npm test 2>&1 | grep -A3 seed-selection`
Expected: FAIL（`selectSeeds is not a function` 等。`selectSeeds` 未実装のため）

- [ ] **Step 3: `selectSeeds()` を実装**

`award-signal-tool/lib/discover.js` の `const normalize = ...` 行の直後に追加:

```js
/**
 * カテゴリ均等＋ローテーションでシードを選ぶ（純粋関数・ネットワーク不要）。
 * ・タグ空カテゴリを除外。カテゴリ内/カテゴリ間の重複タグを除去（初出のみ）。
 * ・各カテゴリを rotation で回転させ、ラウンドロビンで cap 件まで選ぶ
 *   （＝タグを持つ全カテゴリが必ず1つ以上代表される。cap≥カテゴリ数のとき）。
 * @param {Array<{category:string, tags:string[]}>} categories
 * @param {number} cap 1回で選ぶ最大シード数
 * @param {number} rotation 日次ローテーション用の整数（同じ値なら決定的）
 * @returns {{selected:{tag:string,category:string}[], deferred:{tag:string,category:string}[]}}
 */
export function selectSeeds(categories, cap, rotation = 0) {
  const limit = Math.max(0, Math.trunc(cap) || 0);
  // 1) タグ空カテゴリを除外し、カテゴリ内の重複タグを除去（順序維持）
  const cats = [];
  for (const c of categories || []) {
    const seen = new Set();
    const tags = [];
    for (const t of c?.tags || []) {
      const v = normalize(t);
      if (v && !seen.has(v)) { seen.add(v); tags.push(v); }
    }
    if (tags.length) cats.push({ category: c.category, tags });
  }
  // 2) 各カテゴリを rotation で回転
  const rotated = cats.map((c) => {
    const n = c.tags.length;
    const off = ((Math.trunc(rotation) % n) + n) % n;
    return { category: c.category, tags: c.tags.map((_, i) => c.tags[(off + i) % n]) };
  });
  // 3) ラウンドロビンで選ぶ（グローバル重複タグは初出のみ）
  const used = new Set();
  const selected = [];
  const maxLen = rotated.length ? Math.max(...rotated.map((c) => c.tags.length)) : 0;
  for (let r = 0; r < maxLen && selected.length < limit; r++) {
    for (const c of rotated) {
      if (selected.length >= limit) break;
      const tag = c.tags[r];
      if (tag === undefined || used.has(tag)) continue;
      used.add(tag);
      selected.push({ tag, category: c.category });
    }
  }
  // 4) 残り = deferred（選ばれなかったもの。グローバル重複も初出のみ）
  const deferred = [];
  for (const c of rotated) {
    for (const tag of c.tags) {
      if (used.has(tag)) continue;
      used.add(tag);
      deferred.push({ tag, category: c.category });
    }
  }
  return { selected, deferred };
}
```

- [ ] **Step 4: テストを実行して成功を確認**

Run: `npm test 2>&1 | tail -6`
Expected: `fail 0`。新規の seed-selection 8ケースを含む全テストが pass（既存テスト件数 + 8 に増える）

- [ ] **Step 5: コミット**

```bash
git add award-signal-tool/lib/discover.js test/seed-selection.test.js
git commit -m "feat(award): selectSeeds でカテゴリ均等＋ローテーション選定を追加"
```

---

## Task 2: `proposeCandidates()` をカテゴリ均等＋ローテーションに改修

**Files:**
- Modify: `award-signal-tool/lib/discover.js`（`proposeCandidates` 関数の本体を差し替え）

TDDではなく統合改修。純粋ロジックはTask 1でテスト済み。ここは配線と手動確認。

- [ ] **Step 1: `proposeCandidates` を差し替える**

現在の `proposeCandidates`（`export async function proposeCandidates(onLog) { ... }` の関数全体）を次で置き換える:

```js
export async function proposeCandidates(onLog) {
  const log = (s) => onLog && onLog(s);

  // 1) シード設定DBの「自動検索ON」を カテゴリ→タグ で集める（フラット化しない）
  const seeds = await listSeeds();
  const categories = [];
  const allSeedTags = new Set(); // 候補から除外する用（シード自身は候補にしない）
  for (const s of seeds) {
    if (!s.autoOn || !s.hashtags || s.hashtags === "—") continue;
    const tags = [];
    for (const t of s.hashtags.split(/[\s、,]+/)) {
      const v = normalize(t);
      if (v) { tags.push(v); allSeedTags.add(v); }
    }
    if (tags.length) categories.push({ category: s.category, tags });
  }
  if (!allSeedTags.size) { log("⚠ シード設定DBに有効なハッシュタグがありません"); return []; }

  // 2) カテゴリ均等＋日次ローテーションで今回のシードを選ぶ（上限14≒実証済み7〜8分）
  const CAP = 14;
  const rotation = Math.floor(Date.now() / 86400000); // 経過日数（ステートレス）
  const { selected, deferred } = selectSeeds(categories, CAP, rotation);
  const tags = selected.map((s) => s.tag);
  log(`対象カテゴリ ${categories.length}件 / 今回のシード ${tags.length}件（上限${CAP}）`);
  const byCat = {};
  for (const s of selected) (byCat[s.category] ??= []).push(s.tag);
  for (const [c, ts] of Object.entries(byCat)) log(`  ${c}: ${ts.join(", ")}`);
  if (deferred.length) log(`  今回見送り（次回ローテーション）: ${deferred.map((d) => d.tag).join(", ")}`);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "discover-"));
  const rawCsv = path.join(tmp, "raw.csv");
  const pickedCsv = path.join(tmp, "picked.csv");

  // 3) TikTok共起タグ発掘（件数はlib側で --max-seeds に明示指定して制御）
  await spawnP("node", [
    "scripts/apify/discover_tiktok.js", ...tags,
    "--per", "30", "--top", "8", "--max-seeds", String(tags.length), "--out", rawCsv,
  ], log);
  if (!fs.existsSync(rawCsv)) throw new Error("発掘結果CSVが生成されませんでした");
  if (!parseCSV(fs.readFileSync(rawCsv, "utf-8")).length) {
    log("⚠ 共起タグが1件も取れませんでした（Apifyのクレジット残高やシードを確認してください）");
    return [];
  }

  // 4) Claude精選（総称語・persona語・表記ゆれを落とし、カテゴリを補正）
  await spawnP("node", [
    "scripts/ai/filter_candidates.js", "--csv", rawCsv, "--out", pickedCsv,
  ], log);
  if (!fs.existsSync(pickedCsv)) throw new Error("精選結果CSVが生成されませんでした");
  const picked = parseCSV(fs.readFileSync(pickedCsv, "utf-8"));

  // 5) 既存候補・シード自体・重複を除外して提案リストにする（登録はしない）
  const existing = new Set((await listCandidates()).map((c) => c.name.trim()));
  const seen = new Set();
  const proposals = [];
  for (const r of picked) {
    const name = normalize(r.name);
    if (!name || seen.has(name) || existing.has(name) || allSeedTags.has(name)) continue;
    seen.add(name);
    proposals.push({ name, category: r.category || "その他", reason: r.reason || "" });
  }
  log(`提案 ${proposals.length}件（既存・シード重複を除外）`);
  return proposals;
}
```

- [ ] **Step 2: 構文チェック**

Run: `node --check award-signal-tool/lib/discover.js && echo OK`
Expected: `OK`

- [ ] **Step 3: 既存テストが壊れていないか確認**

Run: `npm test 2>&1 | tail -4`
Expected: fail 0（selectSeeds テストは引き続き pass）

- [ ] **Step 4: 選定ロジックの手動確認（本番シード相当・ネットワークあり）**

> サンドボックスでは Notion/Apify に繋がらないため `dangerouslyDisableSandbox` 相当で実行すること。
> `.env` に NOTION_TOKEN が無ければ Secret Manager から取得（[gotcha参照](../setup/award-signal-tool-deploy.md)）。

`selectSeeds` が本番シードで「全カテゴリを代表し14件に収まる」ことをNotion実データで確認する使い捨てスクリプト:

```bash
export PATH="$HOME/google-cloud-sdk/bin:$PATH"
cd /Users/yuttyo/claude/creativegroup-dashboard
NT=$(gcloud secrets versions access latest --secret=notion-token --project=cg-project-491303)
NOTION_TOKEN="$NT" SEED_DB_ID=3832a9c9-20f7-811b-b44f-d11874a495c7 node --input-type=module -e '
import { listSeeds } from "./award-signal-tool/lib/notion.js";
import { selectSeeds } from "./award-signal-tool/lib/discover.js";
const seeds = await listSeeds();
const cats = [];
for (const s of seeds) { if (!s.autoOn || !s.hashtags || s.hashtags==="—") continue;
  const tags = s.hashtags.split(/[\s、,]+/).map(t=>t.replace(/^#/,"").trim()).filter(Boolean);
  if (tags.length) cats.push({category:s.category, tags}); }
const { selected, deferred } = selectSeeds(cats, 14, 0);
console.log("カテゴリ数:", cats.length, "/ 選定:", selected.length, "/ 見送り:", deferred.length);
const byCat = {}; for (const s of selected) (byCat[s.category] ??= []).push(s.tag);
for (const [c,ts] of Object.entries(byCat)) console.log("  ", c, ":", ts.join(", "));
const missing = cats.map(c=>c.category).filter(c=>!byCat[c]);
console.log(missing.length ? "❌ 代表なしカテゴリ: "+missing.join(",") : "✅ 全カテゴリが代表されている");
'
```

Expected: `✅ 全カテゴリが代表されている` かつ 選定 ≤ 14。**特にコスメ・スキンケア・ヘアケア・ボディケア・フレグランスが出力に含まれること。**

- [ ] **Step 5: コミット**

```bash
git add award-signal-tool/lib/discover.js
git commit -m "feat(award): proposeCandidates を全カテゴリ均等発掘に改修（--max-seedsをlib制御）"
```

---

## Task 3: ドキュメント更新（SOP＋INDEX）

**Files:**
- Modify: `docs/superpowers/specs/trepo-award-jisseki-research-runbook.md`
- Modify: `docs/superpowers/specs/trepo-trend-award-2026-INDEX.md`

- [ ] **Step 1: ランブックにシード運用SOPを追記**

`trepo-award-jisseki-research-runbook.md` の「### 自動の候補生成パイプライン（TikTok × Claude）」節の
末尾（`- **自動登録はしない**: ...` の行の直後）に次を追記:

```markdown

#### シード運用SOP（カバレッジ改修後・2026-07）

- 発掘は **カテゴリ均等＋日次ローテーション＋1回上限14シード** で走る（約7〜8分）。
  全カテゴリが毎回必ず1つ以上検索され、超過分は翌日以降のローテーションで拾われる。
- 各カテゴリは **具体寄りのシードを2〜4個** 持たせる（総称語でも共起経由で具体候補は出るが、
  痩せているカテゴリには追加する）。実測で全カテゴリが機能することは確認済み。
- **フィードバック（手動）**: 採用したブランド/IP（例: fwee）を、該当カテゴリのシードに手で追記する。
  細かすぎる商品名は共起が出にくいのでシードにしない。※半自動化は次フェーズ（設計書§9）。
- カテゴリ別の産出数はツールのログに出る。産出ゼロが続くシードは間引く判断材料にする。
```

- [ ] **Step 2: INDEX §5-2 にカバレッジ改修を反映**

`trepo-trend-award-2026-INDEX.md` の §5-2 内、`**次にやること（P2候補）**:` の行を次に置き換える:

```markdown
**カバレッジ改修済み（2026-07-27）**: `--max-seeds=12` で中核カテゴリ（コスメ等）が
毎回スキップされていた問題を解消。`selectSeeds()` によるカテゴリ均等＋日次ローテーション＋
1回上限14シードで、全カテゴリが必ず提案に出るようにした（[設計書](2026-07-27-trepo-award-seed-coverage-design.md)）。

**次にやること（P2候補）**: フィードバックループの半自動化（設計書§9・方式A）／
インフル反響(YouTube)の自動化／Phase 2 のBigQuery集約。
```

- [ ] **Step 3: コミット**

```bash
git add docs/superpowers/specs/trepo-award-jisseki-research-runbook.md docs/superpowers/specs/trepo-trend-award-2026-INDEX.md
git commit -m "docs: シード運用SOPとカバレッジ改修をランブック/INDEXに反映"
```

---

## Task 4: ビルド＆デプロイ＆本番検証

**Files:** なし（Cloud Run 運用）。gcloud はサンドボックス外のため `$HOME/google-cloud-sdk/bin` をPATHに通し `dangerouslyDisableSandbox` 相当で実行。

- [ ] **Step 1: マージ（作業ブランチ → main）**

```bash
cd /Users/yuttyo/claude/creativegroup-dashboard
git checkout main && git merge --no-ff feat/award-seed-coverage -m "Merge: 候補発掘カバレッジ改修" && git push origin main
```

- [ ] **Step 2: イメージをビルド＆push**

```bash
export PATH="$HOME/google-cloud-sdk/bin:$PATH"
gcloud builds submit --config award-signal-tool/cloudbuild.yaml \
  --substitutions _IMAGE=asia-northeast1-docker.pkg.dev/cg-project-491303/cg/trepo-award-tool . \
  --project=cg-project-491303
```
Expected: ビルド成功・push完了（`DONE`）

- [ ] **Step 3: 新リビジョンをデプロイ（env/secretsは既存を保持）**

```bash
gcloud run deploy trepo-award-tool \
  --image asia-northeast1-docker.pkg.dev/cg-project-491303/cg/trepo-award-tool \
  --region asia-northeast1 --project=cg-project-491303
```
Expected: `revision [trepo-award-tool-000NN-xxx] ... serving 100 percent of traffic`
（`--set-env-vars`/`--set-secrets` を付けないので既存の環境変数・シークレットは維持される）

- [ ] **Step 4: デプロイ後の疎通確認（認証必須エンドポイントが生きているか）**

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://award.trepo.jp/api/candidates
```
Expected: `401`（未認証で弾かれる＝サーバー稼働・認証有効）

- [ ] **Step 5: 本番でエンドツーエンド確認（山口さんの操作＋ログ監視）**

山口さんに https://award.trepo.jp で「候補を提案してもらう」を実行してもらい、実行者側でCloud Runログを監視:

```bash
export PATH="$HOME/google-cloud-sdk/bin:$PATH"
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="trepo-award-tool" AND httpRequest.requestUrl:"/api/discover"' \
  --project=cg-project-491303 --limit=3 --freshness=30m \
  --format='value(timestamp, httpRequest.status)'
```
Expected: discover POST が 200。提案リストに **コスメ・スキンケア等の中核カテゴリの候補が含まれる**
（例: ロムアンド／キャンメイク／fwee／ケラスターゼ 等）。エラーなし。

---

## 完了条件

- [ ] `npm test` が `fail 0`（selectSeeds 8ケース含む）
- [ ] 本番シードで `selectSeeds` が全カテゴリ代表・14件以内（Task 2 Step 4）
- [ ] 本番デプロイ済み・`/api/candidates` が 401
- [ ] 本番の提案に中核カテゴリ（コスメ等）が含まれる（Task 4 Step 5）
- [ ] ランブック/INDEX が更新済み
