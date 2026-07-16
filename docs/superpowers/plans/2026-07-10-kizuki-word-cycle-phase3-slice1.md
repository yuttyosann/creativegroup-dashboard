# 気づきワードサイクル Phase 3 スライス1（広告シグナル自動取込＋スコア自動再計算）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Google Ads の creative 日次KPIを BigQuery 経由で取り込み、マッピング表で word_id に紐付けて「広告シグナル」タブを creative_id upsert で自動更新し、`score.js`（不改変）で台帳スコアを日次再計算する。

**Architecture:** 新規ロジックの核は純粋関数 `lib/kizuki/ad-ingest.js`（BQ行＋マッピング → 広告シグナル行）のみで、これを TDD する。スコア集約・台帳書き戻しは Phase 2 の `lib/kizuki/ledger-store.js`／`lib/kizuki/score.js` を不改変で再利用。BQ読取・Google Ads取得・Sheets upsert は外部依存の統合コード（`node --check`＋スモークで担保）。役割分担：BQ＝広告生データ置き場／スコアの正＝Node＋score.js。

**Tech Stack:** Node.js／`node --test`／`@google-cloud/bigquery`（既存依存）／`google-ads-api`（新規）／既存 `lib/sheets.js`（`readRows`/`updateRowById`/`appendRow`）／Cloud Run Job＋Cloud Scheduler。

**Scope:** Phase 3 スライス1のみ。Pamun取込（スライス2）・台帳BQ昇格（スライス3）・他媒体は別spec。仕様書: `docs/superpowers/specs/2026-07-10-kizuki-word-cycle-phase3-slice1-ad-ingest.md`。

**Environment note:** Google Ads API・本番BQ・GCPデプロイは本環境に無い。**完全にテスト可能なのは `ad-ingest.js`（純粋）**。`recalc_job.js`／`fetch_creatives.js` は `node --check`＋dry-run/起動スモークで検証し、実データ実行は認証情報・GCP整備後（運用側）に行う。

---

## 既知の前提（既存コードから確認済み）

- BQ利用（`scripts/instagram/fetch_insights.js:95-101`）：`const { BigQuery } = require('@google-cloud/bigquery'); const bq = new BigQuery({ projectId: 'cg-project-491303' }); const ds = bq.dataset('cg_analytics'); await ds.table('..').insert(rows); ` 読取は `const [rows] = await bq.query(sql);`。
- Sheets（`lib/sheets.js`）：`readRows(SHEET_ID, tab)`／`updateRowById(SHEET_ID, tab, idColIndex, id, rowArray)`（該当が無いと throw）／`appendRow(SHEET_ID, tab, rowArray)`。
- 広告シグナル列順（Phase 2 `CG_気づきワード台帳.gs` / `ledger-store.parseAdRow`）：`[word_id, creative_id, CTR%, CVR%, ROAS, 勝ちデモグラ, デモグラ明確度, 配信額]`。`parseAdRow` は `"2.1%"→2.1`（%外すだけ）。
- creative_id は creative 単位で一意 → **upsert の突合キーは creative_id（列index 1）**。`updateRowById(SHEET_ID, '広告シグナル', 1, creative_id, row)` で更新、無ければ `appendRow`。

## File Structure

- **Create** `lib/kizuki/ad-ingest.js` — BQ行＋マッピング → 広告シグナル行（純粋・唯一のロジック核）。
- **Create** `test/kizuki/ad-ingest.test.js`
- **Create** `bigquery/ad_creative_daily.sql` — BQテーブルDDL。
- **Create** `scripts/kizuki/recalc_job.js` — バッチ本体（BQ読取＋マッピング＋ad-ingest＋upsert＋ledger-store再計算）。
- **Create** `scripts/google-ads/fetch_creatives.js` — Google Ads→BQ（skeleton＋`--dry-run`）。
- **Modify** `.env.example` — Google Ads認証・BQ・SHEET_ID を追記。
- **Create** `docs/deploy/phase3-slice1-cloud-run-job.md` — Cloud Run Job＋Scheduler デプロイ手順。

---

## Task 1: ad-ingest — 整形ヘルパーと単一行変換

**Files:**
- Create: `lib/kizuki/ad-ingest.js`
- Test: `test/kizuki/ad-ingest.test.js`

- [ ] **Step 1: 失敗するテストを書く**

`test/kizuki/ad-ingest.test.js`:
```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { pctStr, ratioStr, buildAdSignalRow } = require('../../lib/kizuki/ad-ingest');

test('pctStr: 分子/分母を"2.1%"形式（1桁）に。分母0/無効はnull', () => {
  assert.strictEqual(pctStr(21, 1000), '2.1%');
  assert.strictEqual(pctStr(3, 1000), '0.3%');
  assert.strictEqual(pctStr(5, 0), null);
  assert.strictEqual(pctStr(5, ''), null);
});

test('ratioStr: 比率を数値文字列（2桁）に。分母0/無効はnull', () => {
  assert.strictEqual(ratioStr(230, 100), '2.3');
  assert.strictEqual(ratioStr(1, 0), null);
});

test('buildAdSignalRow: Phase2広告シグナル列順で行を生成（デモグラ明確度は空）', () => {
  const row = buildAdSignalRow(
    { creative_id: 'cr-1', impressions: 1000, clicks: 21, conversions: 18, cost: 200000, revenue: 460000, demographics: '30代/女性' },
    'w1');
  assert.deepStrictEqual(row, ['w1', 'cr-1', '2.1%', '85.7%', '2.3', '30代/女性', '', 200000]);
});

test('buildAdSignalRow: imp0/clicks0/cost0 は該当セルを空に', () => {
  const row = buildAdSignalRow(
    { creative_id: 'cr-2', impressions: 0, clicks: 0, conversions: 0, cost: 0, revenue: 0, demographics: '' },
    'w2');
  assert.deepStrictEqual(row, ['w2', 'cr-2', '', '', '', '', '', 0]);
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npm test -- test/kizuki/ad-ingest.test.js`
Expected: FAIL（module not found）

- [ ] **Step 3: 実装**

`lib/kizuki/ad-ingest.js`:
```js
'use strict';

/**
 * 広告生KPI（BigQuery）＋マッピングから「広告シグナル」行を生成する。
 * 出力は Phase 2 の広告シグナル schema に一致（CTR/CVRは "2.1%" 形式）。
 * 仕様: docs/superpowers/specs/2026-07-10-kizuki-word-cycle-phase3-slice1-ad-ingest.md
 * 広告シグナル列順: [word_id, creative_id, CTR%, CVR%, ROAS, 勝ちデモグラ, デモグラ明確度, 配信額]
 */

/** 百分率を "2.1%" 形式（小数1桁）に。分母0・無効は null。 */
function pctStr(numerator, denominator) {
  const n = Number(numerator), d = Number(denominator);
  if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return null;
  return (Math.round((n / d) * 1000) / 10) + '%';
}

/** 比率（ROAS）を数値文字列（小数2桁）に。分母0・無効は null。 */
function ratioStr(numerator, denominator) {
  const n = Number(numerator), d = Number(denominator);
  if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return null;
  return String(Math.round((n / d) * 100) / 100);
}

/** BQの1行（集計済み creative）と word_id から広告シグナル行（配列）を生成。 */
function buildAdSignalRow(bqRow, wordId) {
  const ctr = pctStr(bqRow.clicks, bqRow.impressions);
  const cvr = pctStr(bqRow.conversions, bqRow.clicks);
  const roas = ratioStr(bqRow.revenue, bqRow.cost);
  const cost = Number.isFinite(Number(bqRow.cost)) ? Number(bqRow.cost) : '';
  return [
    wordId,
    bqRow.creative_id,
    ctr === null ? '' : ctr,
    cvr === null ? '' : cvr,
    roas === null ? '' : roas,
    bqRow.demographics || '',
    '', // デモグラ明確度: スライス1はベストエフォートで空（score.jsは欠損→デモグラ0点で安全）
    cost,
  ];
}

module.exports = { pctStr, ratioStr, buildAdSignalRow };
```

- [ ] **Step 4: テストを実行して成功を確認**

Run: `npm test -- test/kizuki/ad-ingest.test.js`
Expected: PASS（4 tests）

- [ ] **Step 5: コミット**

```bash
git add lib/kizuki/ad-ingest.js test/kizuki/ad-ingest.test.js
git commit -m "feat(kizuki): ad-ingest の整形ヘルパーと単一行変換"
```

---

## Task 2: ad-ingest — buildAdSignalRows（マッピングJOIN・未マッピングskip）

**Files:**
- Modify: `lib/kizuki/ad-ingest.js`
- Test: `test/kizuki/ad-ingest.test.js`

- [ ] **Step 1: 失敗するテストを追記**

```js
const { buildAdSignalRows } = require('../../lib/kizuki/ad-ingest');
const { parseAdRow } = require('../../lib/kizuki/ledger-store');

test('buildAdSignalRows: マッピングでword_idを付与・未マッピングはskip', () => {
  const bqRows = [
    { creative_id: 'cr-1', impressions: 1000, clicks: 21, conversions: 18, cost: 200000, revenue: 460000, demographics: '30代/女性' },
    { creative_id: 'cr-x', impressions: 500, clicks: 3, conversions: 0, cost: 10000, revenue: 0, demographics: '' }, // 未マッピング
  ];
  const mapping = [{ creative_id: 'cr-1', word_id: 'w1' }];
  const rows = buildAdSignalRows(bqRows, mapping);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0][0], 'w1');
  assert.strictEqual(rows[0][1], 'cr-1');
});

test('buildAdSignalRows: 出力行は ledger-store.parseAdRow で正しい単位に戻る（結合検証）', () => {
  const rows = buildAdSignalRows(
    [{ creative_id: 'cr-1', impressions: 1000, clicks: 21, conversions: 18, cost: 200000, revenue: 460000, demographics: '30代/女性' }],
    [{ creative_id: 'cr-1', word_id: 'w1' }]);
  const parsed = parseAdRow(rows[0]);
  assert.strictEqual(parsed.wordId, 'w1');
  assert.ok(Math.abs(parsed.ctr - 2.1) < 1e-9);   // "2.1%"→2.1
  assert.ok(Math.abs(parsed.roas - 2.3) < 1e-9);
  assert.strictEqual(parsed.demographics, '30代/女性');
});

test('buildAdSignalRows: 空入力は空配列', () => {
  assert.deepStrictEqual(buildAdSignalRows([], []), []);
  assert.deepStrictEqual(buildAdSignalRows(undefined, undefined), []);
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npm test -- test/kizuki/ad-ingest.test.js`
Expected: FAIL（`buildAdSignalRows is not a function`）

- [ ] **Step 3: 実装**

`buildAdSignalRow` の後に追記し、`module.exports` を更新:
```js
/**
 * BQ行の配列＋マッピング行の配列から広告シグナル行の配列を生成。
 * mappingRows: [{ creative_id, word_id }]。creative_id が未マッピングの BQ行はスキップ。
 */
function buildAdSignalRows(bqRows, mappingRows) {
  const map = new Map();
  for (const m of mappingRows || []) {
    if (m && m.creative_id) map.set(String(m.creative_id), m.word_id);
  }
  const out = [];
  for (const r of bqRows || []) {
    const wordId = map.get(String(r.creative_id));
    if (!wordId) continue;
    out.push(buildAdSignalRow(r, wordId));
  }
  return out;
}
```
```js
module.exports = { pctStr, ratioStr, buildAdSignalRow, buildAdSignalRows };
```

- [ ] **Step 4: テストを実行して成功を確認**

Run: `npm test -- test/kizuki/ad-ingest.test.js`
Then: `npm test`
Expected: 個別 PASS ＋ 全体 PASS（既存95＋新規7＝102。"trust settings of system certificate" はノイズ・無視）

- [ ] **Step 5: コミット**

```bash
git add lib/kizuki/ad-ingest.js test/kizuki/ad-ingest.test.js
git commit -m "feat(kizuki): ad-ingest の buildAdSignalRows（マッピングJOIN・未マッピングskip）"
```

---

## Task 3: BigQuery テーブル DDL

**Files:**
- Create: `bigquery/ad_creative_daily.sql`

- [ ] **Step 1: DDLを作成**

`bigquery/ad_creative_daily.sql`:
```sql
-- 気づきワードサイクル Phase3 スライス1: Google Ads creative 日次KPI 置き場
-- 仕様: docs/superpowers/specs/2026-07-10-kizuki-word-cycle-phase3-slice1-ad-ingest.md
-- 実行: bq query --use_legacy_sql=false < bigquery/ad_creative_daily.sql
CREATE TABLE IF NOT EXISTS `cg-project-491303.cg_analytics.ad_creative_daily` (
  date          DATE      NOT NULL,   -- 集計日
  creative_id   STRING    NOT NULL,   -- Google Ads の ad(creative) ID。マッピング表の突合キー
  campaign      STRING,               -- キャンペーン名（参考）
  impressions   INT64,
  clicks        INT64,
  conversions   FLOAT64,
  cost          FLOAT64,              -- 消化額（円）
  revenue       FLOAT64,              -- 売上（ROAS算出用）
  demographics  STRING                -- 勝ちデモグラ（ベストエフォート・空可）
)
PARTITION BY date;
```

- [ ] **Step 2: 構文の目視確認**

このファイルは本番BQで実行する（本環境では実行しない）。SQLの列名・型が仕様書のデータモデルと一致することを目視確認する（date/creative_id/campaign/impressions/clicks/conversions/cost/revenue/demographics）。

- [ ] **Step 3: コミット**

```bash
git add bigquery/ad_creative_daily.sql
git commit -m "feat(kizuki): ad_creative_daily の BQ テーブルDDL"
```

---

## Task 4: recalc_job — バッチ本体（BQ読取＋upsert＋再計算）

**Files:**
- Create: `scripts/kizuki/recalc_job.js`

外部依存（BQ・Sheets）のため単体テストはしない。内部ロジックは Task 1-2（ad-ingest）＋ Phase 2（ledger-store）の単体テストで担保。ここでは `node --check`＋`--dry-run` スモークで検証する。

- [ ] **Step 1: 実装**

`scripts/kizuki/recalc_job.js`:
```js
'use strict';
/**
 * 気づきワードサイクル Phase3 スライス1 バッチ本体。
 * BQ(ad_creative_daily)＋Sheet(広告マッピング) → ad-ingest → 広告シグナルを creative_id upsert
 * → ledger-store でスコア再計算し台帳へ書戻し。Cloud Run Job として Cloud Scheduler が日次実行。
 * 仕様: docs/superpowers/specs/2026-07-10-kizuki-word-cycle-phase3-slice1-ad-ingest.md
 *
 * 使い方: node scripts/kizuki/recalc_job.js [--dry-run]
 */
require('dotenv').config({ override: true });
const { readRows, updateRowById, appendRow } = require('../../lib/sheets');
const adIngest = require('../../lib/kizuki/ad-ingest');
const ledger = require('../../lib/kizuki/ledger-store');

const SHEET_ID = process.env.SHEET_ID;
const BQ_PROJECT = process.env.BQ_PROJECT || 'cg-project-491303';
const BQ_DATASET = process.env.BQ_DATASET || 'cg_analytics';
const AD_MAPPING_TAB = '広告マッピング';
const DRY_RUN = process.argv.includes('--dry-run');

/** BQ の ad_creative_daily を creative 粒度で集計取得（累計）。--dry-run では空配列。 */
async function fetchAdRowsFromBQ() {
  if (DRY_RUN) return [];
  const { BigQuery } = require('@google-cloud/bigquery');
  const bq = new BigQuery({ projectId: BQ_PROJECT });
  const sql = `
    SELECT creative_id,
           SUM(impressions) AS impressions,
           SUM(clicks) AS clicks,
           SUM(conversions) AS conversions,
           SUM(cost) AS cost,
           SUM(revenue) AS revenue,
           ANY_VALUE(demographics) AS demographics
    FROM \`${BQ_PROJECT}.${BQ_DATASET}.ad_creative_daily\`
    GROUP BY creative_id`;
  const [rows] = await bq.query({ query: sql });
  return rows;
}

/** 広告マッピングタブを [{creative_id, word_id}] で読む（ヘッダー: creative_id,word_id,...）。 */
async function readMapping() {
  const rows = await readRows(SHEET_ID, AD_MAPPING_TAB);
  return rows.slice(1)
    .filter((r) => r[0] && r[1])
    .map((r) => ({ creative_id: r[0], word_id: r[1] }));
}

/** 広告シグナルを creative_id(列index1) で upsert。マッピング外の手入力行は触らない。 */
async function upsertAdSignals(signalRows) {
  const existing = await readRows(SHEET_ID, ledger.TABS.AD);
  const existingIds = new Set(existing.slice(1).map((r) => r[1]).filter(Boolean));
  for (const row of signalRows) {
    const creativeId = row[1];
    if (existingIds.has(creativeId)) {
      await updateRowById(SHEET_ID, ledger.TABS.AD, 1, creativeId, row);
    } else {
      await appendRow(SHEET_ID, ledger.TABS.AD, row);
      existingIds.add(creativeId);
    }
  }
}

/** 台帳の全ワードを score.js で再計算し書戻し（Phase2 /recalc と同一ロジック）。1件失敗しても継続。 */
async function recalcLedger() {
  const [ledgerRows, workshopRows, reviewRows, adRows, collabRows] = await Promise.all([
    readRows(SHEET_ID, ledger.TABS.LEDGER),
    readRows(SHEET_ID, ledger.TABS.WORKSHOP),
    readRows(SHEET_ID, ledger.TABS.REVIEW),
    readRows(SHEET_ID, ledger.TABS.AD),
    readRows(SHEET_ID, ledger.TABS.COLLAB),
  ]);
  const words = ledger.buildWordRows({ ledgerRows, workshopRows, reviewRows, adRows, collabRows }, '');
  const dataRows = ledgerRows.slice(1);
  let updated = 0;
  for (const w of words) {
    try {
      const row = dataRows.find((r) => r[ledger.L.wordId] === w.wordId);
      if (!row) continue;
      await updateRowById(SHEET_ID, ledger.TABS.LEDGER, ledger.L.wordId, w.wordId, ledger.buildLedgerScoreUpdate(row, w.computed));
      updated += 1;
    } catch (e) {
      console.error('⚠ 再計算失敗 word=%s: %s', w.wordId, e.message);
    }
  }
  return updated;
}

async function main() {
  const bqRows = await fetchAdRowsFromBQ();
  const mapping = DRY_RUN ? [] : await readMapping();
  const signalRows = adIngest.buildAdSignalRows(bqRows, mapping);
  if (DRY_RUN) {
    console.log('DRY-RUN: BQ %d行 / マッピング %d件 / 広告シグナル生成 %d行（書込なし）',
      bqRows.length, mapping.length, signalRows.length);
    return;
  }
  await upsertAdSignals(signalRows);
  const updated = await recalcLedger();
  console.log('✅ 広告シグナル upsert %d行 / 台帳スコア再計算 %d件', signalRows.length, updated);
}

main().catch((e) => { console.error('❌ recalc_job 失敗:', e.message); process.exit(1); });
```

- [ ] **Step 2: 構文チェックと dry-run スモーク**

Run: `node --check scripts/kizuki/recalc_job.js`
Expected: エラー無し

Run: `SHEET_ID=dummy node scripts/kizuki/recalc_job.js --dry-run`
Expected: `DRY-RUN: BQ 0行 / マッピング 0件 / 広告シグナル生成 0行（書込なし）`（外部呼び出しをせず完走）

- [ ] **Step 3: 全テストが緑か確認 → コミット**

Run: `npm test`
Expected: 102 pass / 0 fail（HTML/スクリプト追加はテストに影響なし）
```bash
git add scripts/kizuki/recalc_job.js
git commit -m "feat(kizuki): recalc_job（BQ→広告シグナルupsert→スコア再計算）"
```

---

## Task 5: fetch_creatives — Google Ads → BigQuery（skeleton＋dry-run）

**Files:**
- Create: `scripts/google-ads/fetch_creatives.js`
- Modify: `package.json`（`google-ads-api` を dependencies に追加）

Google Ads API は認証情報（developer token/OAuth refresh/customer id）が本環境に無いため、実データ取得は運用側。ここでは取得→整形→BQ書込の骨格と `--dry-run` を実装し、`node --check`＋dry-run で検証する。

- [ ] **Step 1: 依存を追加**

Run: `npm install google-ads-api`
Expected: `package.json` の dependencies に `google-ads-api` が入る（`npm test` が引き続き緑）

- [ ] **Step 2: 実装**

`scripts/google-ads/fetch_creatives.js`:
```js
'use strict';
/**
 * Google Ads の ad(creative) 日次KPIを取得し BigQuery(cg_analytics.ad_creative_daily) へ書き込む。
 * 仕様: docs/superpowers/specs/2026-07-10-kizuki-word-cycle-phase3-slice1-ad-ingest.md
 * 認証(.env): GOOGLE_ADS_DEVELOPER_TOKEN / GOOGLE_ADS_CLIENT_ID / GOOGLE_ADS_CLIENT_SECRET /
 *            GOOGLE_ADS_REFRESH_TOKEN / GOOGLE_ADS_CUSTOMER_ID / GOOGLE_ADS_LOGIN_CUSTOMER_ID
 * 使い方: node scripts/google-ads/fetch_creatives.js [--date YYYY-MM-DD] [--dry-run]
 */
require('dotenv').config({ override: true });

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const dateIdx = args.indexOf('--date');
const DATE = dateIdx >= 0 ? args[dateIdx + 1] : null; // 未指定は運用側で前日を渡す

const BQ_PROJECT = process.env.BQ_PROJECT || 'cg-project-491303';
const BQ_DATASET = process.env.BQ_DATASET || 'cg_analytics';

/** Google Ads から creative 日次行を取得。GAQL: ad_group_ad の指標を date 指定で。 */
async function fetchFromGoogleAds(date) {
  const { GoogleAdsApi } = require('google-ads-api');
  const client = new GoogleAdsApi({
    client_id: process.env.GOOGLE_ADS_CLIENT_ID,
    client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET,
    developer_token: process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
  });
  const customer = client.Customer({
    customer_id: process.env.GOOGLE_ADS_CUSTOMER_ID,
    login_customer_id: process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID,
    refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN,
  });
  const rows = await customer.query(`
    SELECT ad_group_ad.ad.id, campaign.name,
           metrics.impressions, metrics.clicks, metrics.conversions,
           metrics.cost_micros, metrics.conversions_value
    FROM ad_group_ad
    WHERE segments.date = '${date}'`);
  return rows.map((r) => ({
    date,
    creative_id: String(r.ad_group_ad.ad.id),
    campaign: r.campaign.name || '',
    impressions: Number(r.metrics.impressions || 0),
    clicks: Number(r.metrics.clicks || 0),
    conversions: Number(r.metrics.conversions || 0),
    cost: Number(r.metrics.cost_micros || 0) / 1e6, // micros→円
    revenue: Number(r.metrics.conversions_value || 0),
    demographics: '', // creative粒度デモグラは別ビュー。スライス1はベストエフォートで空
  }));
}

async function writeBigQuery(rows) {
  const { BigQuery } = require('@google-cloud/bigquery');
  const bq = new BigQuery({ projectId: BQ_PROJECT });
  await bq.dataset(BQ_DATASET).table('ad_creative_daily').insert(rows, { ignoreUnknownValues: true });
  console.log('✅ BigQuery へ書込: %d行', rows.length);
}

async function main() {
  if (DRY_RUN) {
    console.log('DRY-RUN: date=%s / project=%s.%s（Google Ads呼び出し・BQ書込はしない）', DATE || '(未指定)', BQ_PROJECT, BQ_DATASET);
    return;
  }
  if (!DATE) throw new Error('--date YYYY-MM-DD を指定してください（運用側で前日を渡す）');
  const rows = await fetchFromGoogleAds(DATE);
  if (!rows.length) { console.log('取得0行'); return; }
  await writeBigQuery(rows);
}

main().catch((e) => { console.error('❌ fetch_creatives 失敗:', e.message); process.exit(1); });
```

- [ ] **Step 3: 構文チェックと dry-run スモーク**

Run: `node --check scripts/google-ads/fetch_creatives.js`
Expected: エラー無し

Run: `node scripts/google-ads/fetch_creatives.js --dry-run`
Expected: `DRY-RUN: date=(未指定) / project=cg-project-491303.cg_analytics（Google Ads呼び出し・BQ書込はしない）`

- [ ] **Step 4: コミット**

```bash
git add scripts/google-ads/fetch_creatives.js package.json package-lock.json
git commit -m "feat(kizuki): fetch_creatives（Google Ads→BQ・skeleton＋dry-run）"
```

---

## Task 6: .env.example ＋ デプロイ手順

**Files:**
- Modify: `.env.example`
- Create: `docs/deploy/phase3-slice1-cloud-run-job.md`

- [ ] **Step 1: .env.example に追記**

`.env.example` の末尾に追記:
```
# --- 気づきワードサイクル Phase3 スライス1 ---
SHEET_ID=コックピットのGoogle Sheet ID
BQ_PROJECT=cg-project-491303
BQ_DATASET=cg_analytics
GOOGLE_ADS_DEVELOPER_TOKEN=
GOOGLE_ADS_CLIENT_ID=
GOOGLE_ADS_CLIENT_SECRET=
GOOGLE_ADS_REFRESH_TOKEN=
GOOGLE_ADS_CUSTOMER_ID=
GOOGLE_ADS_LOGIN_CUSTOMER_ID=
```

- [ ] **Step 2: デプロイ手順を作成**

`docs/deploy/phase3-slice1-cloud-run-job.md`:
```markdown
# Phase3 スライス1 デプロイ手順（Cloud Run Job ＋ Cloud Scheduler）

前提: GCPプロジェクト `cg-project-491303` / BigQuery `cg_analytics` / サービスアカウントに BigQuery・Sheets 権限。

## 1. BQテーブル作成
    bq query --use_legacy_sql=false < bigquery/ad_creative_daily.sql

## 2. 広告マッピングタブ用意
コックピットの Google Sheet に「広告マッピング」タブを作成。1行目ヘッダー: `creative_id, word_id, campaign, メモ`。
Google Ads 対象 creative の creative_id と word_id を登録（＝自動管理の許可リスト）。

## 3. 日次バッチ（2ジョブ）
- 取得: `node scripts/google-ads/fetch_creatives.js --date <前日>` → BQへ
- 再計算: `node scripts/kizuki/recalc_job.js` → 広告シグナル upsert ＋ 台帳スコア更新

## 4. Cloud Run Job 化 ＋ Scheduler（例）
    gcloud run jobs create kizuki-recalc --source . --command node --args scripts/kizuki/recalc_job.js --region asia-northeast1
    gcloud scheduler jobs create http kizuki-recalc-daily \
      --schedule "0 4 * * *" --time-zone "Asia/Tokyo" \
      --uri "<Cloud Run Job 実行 URI>" --http-method POST

## 注意
- 広告シグナルの更新は creative_id upsert（マッピング済みのみ）。手入力行は不可侵。
- BQ集計は現状「累計」。期間を変えたい場合は recalc_job.js の SQL（GROUP BY）を調整。
```

- [ ] **Step 3: 確認 → コミット**

Run: `npm test`
Expected: 102 pass / 0 fail（ドキュメント/envのみ）
```bash
git add .env.example docs/deploy/phase3-slice1-cloud-run-job.md
git commit -m "docs(kizuki): Phase3スライス1のenv雛形とCloud Run Jobデプロイ手順"
```

---

## Self-Review（この計画の点検結果）

- **Spec coverage:** ad-ingest（BQ行＋マッピング→広告シグナル）→ Task 1-2 ✓／BQ DDL → Task 3 ✓／recalc_job（upsert＋再計算・score.js/ledger-store再利用）→ Task 4 ✓／fetch_creatives（Google Ads→BQ）→ Task 5 ✓／Cloud Scheduler・env → Task 6 ✓／creative_id upsert・手入力不可侵 → Task 4 の `upsertAdSignals`（idColIndex=1・既存外はappend）✓／デモグラ ベストエフォート空 → Task 1 の buildAdSignalRow ✓。
- **Placeholder scan:** TODO/TBD なし。外部依存（BQ/Google Ads/GCP）は本環境で実行不可を明記し、`node --check`＋dry-run＋既存単体テスト再利用で担保。
- **Type consistency:** `buildAdSignalRows(bqRows, mappingRows)` の戻り（広告シグナル行配列）は Task 4 の `upsertAdSignals`/`buildWordRows` が消費。列順は Phase 2 `ledger-store.parseAdRow`（`L`/`TABS`）と一致（Task 2 の結合テストで固定）。`ledger.TABS.AD`・`ledger.L.wordId`・`updateRowById(idColIndex)` は Phase 2 定義に準拠。upsert キー＝creative_id（列index 1）で一貫。
- **注意:** `score.js`・`ledger-store.js` は本計画で不改変。ad-ingest 出力が既存 `parseAdRow` で正しく解釈されることを Task 2 の結合テストで担保している（単位: "2.1%"→2.1）。
