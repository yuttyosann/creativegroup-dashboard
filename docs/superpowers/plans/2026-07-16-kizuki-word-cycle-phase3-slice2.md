# 気づきワードサイクル Phase 3 スライス2（Pamunモニターシグナル取込）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pamunモニターの回答から「レビュー件数」と「購買意向共感率」を word_id 単位で算出し、モニターシグナルへ upsert して台帳の訴求スコア（25点）を自動更新する。

**Architecture:** 2トラック（Track A=標準化3択アンケート・決定的／Track B=既存レポート自由記述のLLM写像）が同一のモニターシグナル行に合流し、スライス1と同じ「純粋関数で行生成 → キーで upsert（手入力不可侵）→ ledger-store で再計算」の経路を通る。共感率の分母は全回答者 n に統一（普及率）。`score.js` は不改変。

**Tech Stack:** Node.js (CommonJS) / `node --test` / googleapis (Sheets) / @anthropic-ai/sdk（Track B分類・`claude-opus-4-8`・structured outputs）

**Spec:** [docs/superpowers/specs/2026-07-16-kizuki-word-cycle-phase3-slice2-pamun-ingest.md](../specs/2026-07-16-kizuki-word-cycle-phase3-slice2-pamun-ingest.md)

**Baseline:** 実装開始前に `npm test` が **102 tests / 102 pass** であること。

---

## ファイル構成

| 追加/変更 | ファイル | 責務 |
|---|---|---|
| 新規 | `lib/kizuki/format.js` | 数値・百分率の整形/解釈の唯一の置き場（`pctStr` `ratioStr` `parsePercent` `toNum`）。ad-ingest と review-ingest の共有を DRY にするための抽出 |
| 変更 | `lib/kizuki/ad-ingest.js` | `format.js` を require して再エクスポート（挙動不変・既存テスト不変） |
| 変更 | `lib/kizuki/ledger-store.js` | `format.js` を require して再エクスポート／モニターシグナルの列定数 `R`／`parseReviewRow` 拡張／review集約を source優先ピックに |
| 新規 | **`lib/kizuki/review-ingest.js`** | **唯一のロジック核（純粋関数）**。事後アンケート行のパース・Track A/B 集計・モニターシグナル行生成・upsertキー |
| 新規 | `test/kizuki/review-ingest.test.js` | 上記のユニットテスト |
| 変更 | `test/kizuki/ledger-store.test.js` | `parseReviewRow` の期待値更新＋source優先ピックのテスト追加 |
| 新規 | `test/kizuki/fixtures/pamun-reports.js` | 実レポート2本（04=50人相当・06=空）から起こした生行fixture |
| 新規 | `test/kizuki/pamun-report.test.js` | 実レポート形状での結合検証（06の n=0 回帰含む） |
| 変更 | `lib/sheets.js` | 複合キー upsert のための `findRowNumberByKey` / `updateRowAt` を追加 |
| 新規 | `scripts/kizuki/pamun_ingest.js` | 副作用側。レポート読取→Track B分類→review-ingest→モニターシグナル upsert。`--dry-run` 有 |
| 変更 | `CG_気づきワード台帳.gs` | モニターシグナルに `source` `campaign_id` `confidence` の3列を追加・記入ガイド更新 |

`lib/kizuki/score.js` は **不改変**。

### モニターシグナル 列順（Phase2 schema を末尾3列拡張・後方互換）

```
[word_id, レビュー件数, 購買意向共感率, 代表URL, 2次利用可否, source, campaign_id, confidence]
 r[0]     r[1]          r[2]("62%")      r[3]     r[4]          r[5]    r[6]         r[7]
```
upsertキー = `(word_id, campaign_id, source)`／source ∈ `manual` | `trackA` | `trackB`

---

## Task 1: `format.js` 抽出（共有整形ユーティリティ）

`pctStr` を ad-ingest と review-ingest の両方が使うため、汎用整形を独立モジュールへ移す。ad-ingest / ledger-store は再エクスポートするので **既存テストは1行も変えずに緑のまま**。

**Files:**
- Create: `lib/kizuki/format.js`
- Modify: `lib/kizuki/ad-ingest.js:10-22`（`pctStr`/`ratioStr` 定義を削除し require に）
- Modify: `lib/kizuki/ledger-store.js:23-35`（`parsePercent`/`toNum` 定義を削除し require に）

- [ ] **Step 1: `format.js` を作成（既存の実装をそのまま移設・挙動不変）**

```javascript
'use strict';

/**
 * 気づきワード台帳まわりの数値整形・解釈の唯一の置き場。
 * ad-ingest（広告）と review-ingest（Pamun）が共有する。
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

/** "2.1%"→2.1 / "62%"→62 / 数値そのまま / 空・"—"・非数値は null。（%は外すだけ） */
function parsePercent(v) {
  if (v === null || v === undefined || v === '' || v === '—') return null;
  const n = parseFloat(String(v).replace('%', '').trim());
  return Number.isFinite(n) ? n : null;
}

/** 数値化。空・"—"・非数値は null。 */
function toNum(v) {
  if (v === null || v === undefined || v === '' || v === '—') return null;
  const n = parseFloat(String(v).trim());
  return Number.isFinite(n) ? n : null;
}

module.exports = { pctStr, ratioStr, parsePercent, toNum };
```

- [ ] **Step 2: `ad-ingest.js` を require＋再エクスポートに変更**

`lib/kizuki/ad-ingest.js` の先頭 `'use strict';` の直後に require を足し、`pctStr`/`ratioStr` の**関数定義2つ（現 10〜22行目）を削除**する。ファイル末尾の `module.exports` はそのまま（再エクスポートになる）。

変更後の冒頭はこうなる：

```javascript
'use strict';

const { pctStr, ratioStr } = require('./format');

/**
 * 広告生KPI（BigQuery）＋マッピングから「広告シグナル」行を生成する。
 * 出力は Phase 2 の広告シグナル schema に一致（CTR/CVRは "2.1%" 形式）。
 * 仕様: docs/superpowers/specs/2026-07-10-kizuki-word-cycle-phase3-slice1-ad-ingest.md
 * 広告シグナル列順: [word_id, creative_id, CTR%, CVR%, ROAS, 勝ちデモグラ, デモグラ明確度, 配信額]
 */

/** BQの1行（集計済み creative）と word_id から広告シグナル行（配列）を生成。 */
function buildAdSignalRow(bqRow, wordId) {
```

末尾の `module.exports = { pctStr, ratioStr, buildAdSignalRow, buildAdSignalRows };` は **変更しない**（require したものをそのまま再エクスポートする）。

- [ ] **Step 3: `ledger-store.js` を require＋再エクスポートに変更**

`lib/kizuki/ledger-store.js` の `const { computeAppealScore } = require('./score');` の直後に require を足し、`parsePercent`/`toNum` の**関数定義2つ（現 23〜35行目、JSDocコメント含む）を削除**する。

変更後の冒頭はこうなる：

```javascript
'use strict';

const { computeAppealScore } = require('./score');
const { parsePercent, toNum } = require('./format');
```

末尾の `module.exports` に含まれる `parsePercent, toNum` は **そのまま残す**（再エクスポート）。

- [ ] **Step 4: 既存テストが全て緑のままであることを確認（挙動不変の証明）**

Run: `npm test`
Expected: `tests 102` / `pass 102` / `fail 0`（Task 1 はリファクタなので件数は増えない）

- [ ] **Step 5: Commit**

```bash
git add lib/kizuki/format.js lib/kizuki/ad-ingest.js lib/kizuki/ledger-store.js
git commit -m "refactor(kizuki): 数値整形をformat.jsへ抽出（ad-ingestとreview-ingestで共有するため）

挙動不変。ad-ingest/ledger-storeはrequire＋再エクスポートで既存exportsを維持。
テスト102/102維持。

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: `review-ingest.js` — 事後アンケート行のパース

現行レポート《事後アンケート》詳細シートの生行を、扱いやすい回答者オブジェクトに変換する純粋関数。

**Files:**
- Create: `lib/kizuki/review-ingest.js`
- Create: `test/kizuki/review-ingest.test.js`

- [ ] **Step 1: 失敗するテストを書く**

`test/kizuki/review-ingest.test.js` を新規作成：

```javascript
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { parseSurveyRows } = require('../../lib/kizuki/review-ingest');

test('parseSurveyRows: ヘッダーを飛ばし1行=1回答者にする（indexは0始まり）', () => {
  const rows = [
    ['ご年齢', '①商品の満足度を教えて下さい', '②商品の良かった点を教えてください',
     '③商品の改善点を教えてください', '④容器であったら嬉しい商品', '⑤一番気に入ったもの'],
    [39, '良い', 'MARSとVENUSは使い勝手が良くてよかったです！', 'JUPITERは出番が少ない', '日焼け止め', 'VENUS'],
    [22, '満足', 'キラキラ感が可愛かったところです。', '最初に少し蓋が開けにくかったです。', '日焼け止め', 'JUPITER'],
  ];
  assert.deepStrictEqual(parseSurveyRows(rows), [
    { index: 0, age: 39, satisfaction: '良い',
      goodPoints: 'MARSとVENUSは使い勝手が良くてよかったです！',
      improvements: 'JUPITERは出番が少ない', favorite: 'VENUS' },
    { index: 1, age: 22, satisfaction: '満足',
      goodPoints: 'キラキラ感が可愛かったところです。',
      improvements: '最初に少し蓋が開けにくかったです。', favorite: 'JUPITER' },
  ]);
});

test('parseSurveyRows: 空行はスキップ・欠損セルは空文字/null', () => {
  const rows = [
    ['ご年齢', '①', '②', '③', '④', '⑤'],
    ['', '', '', '', '', ''],
    [null, null, null, null, null, null],
    [35, '大変満足', 'しっとり感と煌めきが好みでした。'],
  ];
  assert.deepStrictEqual(parseSurveyRows(rows), [
    { index: 0, age: 35, satisfaction: '大変満足',
      goodPoints: 'しっとり感と煌めきが好みでした。', improvements: '', favorite: '' },
  ]);
});

test('parseSurveyRows: ヘッダーのみ・空・undefined は空配列（06レポート＝未回答の回帰）', () => {
  assert.deepStrictEqual(parseSurveyRows([['ご年齢', '①', '②', '③', '④', '⑤']]), []);
  assert.deepStrictEqual(parseSurveyRows([]), []);
  assert.deepStrictEqual(parseSurveyRows(undefined), []);
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npm test -- test/kizuki/review-ingest.test.js`
Expected: FAIL — `Cannot find module '../../lib/kizuki/review-ingest'`

- [ ] **Step 3: 最小実装を書く**

`lib/kizuki/review-ingest.js` を新規作成：

```javascript
'use strict';

const { pctStr, toNum } = require('./format');

/**
 * Pamunモニターの回答から「モニターシグナル」行を生成する（唯一のロジック核・純粋関数）。
 * LLM呼び出し等の副作用は scripts/kizuki/pamun_ingest.js 側に置き、ここは決定的変換のみ。
 * 仕様: docs/superpowers/specs/2026-07-16-kizuki-word-cycle-phase3-slice2-pamun-ingest.md
 *
 * 購買意向共感率 = 意向あり人数 ÷ 全回答者n（＝普及率。言及なしも分母に残る）
 * レビュー件数   = そのワードに共感/言及した人数（意向数ではない）
 * モニターシグナル列順: [word_id, レビュー件数, 購買意向共感率, 代表URL, 2次利用可否, source, campaign_id, confidence]
 */

// source（upsertの優先順位は ledger-store 側の REVIEW_SOURCE_PRIORITY が正）
const SOURCES = { MANUAL: 'manual', TRACK_A: 'trackA', TRACK_B: 'trackB' };

// 現行レポート《事後アンケート》詳細シートの列インデックス（0始まり）
const S = { age: 0, satisfaction: 1, goodPoints: 2, improvements: 3, containerWish: 4, favorite: 5 };

const str = (v) => (v === null || v === undefined ? '' : String(v));

/** 生行（ヘッダー込み）→ [{index, age, satisfaction, goodPoints, improvements, favorite}]。空行はスキップ。 */
function parseSurveyRows(rows) {
  const out = [];
  for (const r of (rows || []).slice(1)) {
    if (!r || !r.some((c) => c !== '' && c !== null && c !== undefined)) continue;
    out.push({
      index: out.length,
      age: toNum(r[S.age]),
      satisfaction: str(r[S.satisfaction]),
      goodPoints: str(r[S.goodPoints]),
      improvements: str(r[S.improvements]),
      favorite: str(r[S.favorite]),
    });
  }
  return out;
}

module.exports = { SOURCES, S, parseSurveyRows };
```

- [ ] **Step 4: テストを実行して成功を確認**

Run: `npm test -- test/kizuki/review-ingest.test.js`
Expected: PASS（3 tests）

- [ ] **Step 5: Commit**

```bash
git add lib/kizuki/review-ingest.js test/kizuki/review-ingest.test.js
git commit -m "feat(kizuki): review-ingestに事後アンケート行のパースを追加

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: `review-ingest.js` — Track A 集計（3択マトリクス・決定的）

各ワードを1問3択で聞いた回答を集計する。①ピンとこない＝分母のみ／②共感するが決め手ではない＝件数+1（虚栄の受け皿）／③共感するし買いたい＝件数+1・意向+1。

**Files:**
- Modify: `lib/kizuki/review-ingest.js`
- Modify: `test/kizuki/review-ingest.test.js`

- [ ] **Step 1: 失敗するテストを書く**

`test/kizuki/review-ingest.test.js` の先頭 require を差し替え、末尾にテストを追記：

```javascript
const { parseSurveyRows, tallyTrackA } = require('../../lib/kizuki/review-ingest');
```

```javascript
test('tallyTrackA: 件数は②③・意向は③のみ（①は分母のみで両方に数えない）', () => {
  const respondents = [
    [{ wordId: 'w1', choice: 3 }, { wordId: 'w2', choice: 1 }],
    [{ wordId: 'w1', choice: 2 }, { wordId: 'w2', choice: 3 }],
    [{ wordId: 'w1', choice: 1 }, { wordId: 'w2', choice: 3 }],
  ];
  assert.deepStrictEqual(tallyTrackA(respondents), {
    w1: { count: 2, intentCount: 1, confidences: [] }, // ③1 + ②1 = 件数2 / 意向1
    w2: { count: 2, intentCount: 2, confidences: [] }, // ③2 = 件数2 / 意向2（①1は分母のみ）
  });
});

test('tallyTrackA: 同一回答者が同じwordIdを重複回答しても1回として数える', () => {
  const respondents = [[{ wordId: 'w1', choice: 3 }, { wordId: 'w1', choice: 3 }]];
  assert.deepStrictEqual(tallyTrackA(respondents), {
    w1: { count: 1, intentCount: 1, confidences: [] },
  });
});

test('tallyTrackA: 空・不正な回答は無視', () => {
  assert.deepStrictEqual(tallyTrackA([]), {});
  assert.deepStrictEqual(tallyTrackA(undefined), {});
  assert.deepStrictEqual(tallyTrackA([[null, { choice: 3 }, { wordId: '', choice: 3 }]]), {});
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npm test -- test/kizuki/review-ingest.test.js`
Expected: FAIL — `TypeError: tallyTrackA is not a function`

- [ ] **Step 3: 最小実装を書く**

`lib/kizuki/review-ingest.js` の `parseSurveyRows` の下に追加：

```javascript
/** tally のエントリを取得（無ければ作る）。 */
function bucket(tally, wordId) {
  if (!tally[wordId]) tally[wordId] = { count: 0, intentCount: 0, confidences: [] };
  return tally[wordId];
}

/**
 * Track A（標準化3択アンケート）の集計。
 * respondents = [[{wordId, choice: 1|2|3}], ...]（1要素=1回答者）
 * → { wordId: {count, intentCount, confidences} }
 */
function tallyTrackA(respondents) {
  const tally = {};
  for (const answers of respondents || []) {
    const seen = new Set();
    for (const a of answers || []) {
      if (!a || !a.wordId || seen.has(a.wordId)) continue;
      seen.add(a.wordId);
      if (a.choice !== 2 && a.choice !== 3) continue; // ①は分母のみ（tallyに載せない）
      const e = bucket(tally, a.wordId);
      e.count += 1;
      if (a.choice === 3) e.intentCount += 1;
    }
  }
  return tally;
}
```

`module.exports` を更新：

```javascript
module.exports = { SOURCES, S, parseSurveyRows, tallyTrackA };
```

- [ ] **Step 4: テストを実行して成功を確認**

Run: `npm test -- test/kizuki/review-ingest.test.js`
Expected: PASS（6 tests）

- [ ] **Step 5: Commit**

```bash
git add lib/kizuki/review-ingest.js test/kizuki/review-ingest.test.js
git commit -m "feat(kizuki): Track A（3択マトリクス）の集計を追加

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: `review-ingest.js` — Track B 集計（LLM分類結果・虚栄除外）

LLMが自由記述を候補ワードに写像した結果を集計する。`vanity=true`（見た目・パッケージ等の反応のみ）は **件数には数えるが意向には数えない**。

**Files:**
- Modify: `lib/kizuki/review-ingest.js`
- Modify: `test/kizuki/review-ingest.test.js`

- [ ] **Step 1: 失敗するテストを書く**

require を差し替え、テストを追記：

```javascript
const { parseSurveyRows, tallyTrackA, tallyTrackB } = require('../../lib/kizuki/review-ingest');
```

```javascript
test('tallyTrackB: 件数は言及者数・意向はintent かつ vanityでない ものだけ', () => {
  const respondents = [
    [{ wordId: 'w1', intent: true, vanity: false, confidence: 0.9 }],
    [{ wordId: 'w1', intent: false, vanity: false, confidence: 0.8 }],
    [{ wordId: 'w1', intent: true, vanity: true, confidence: 0.7 }], // 虚栄反応→意向に数えない
  ];
  assert.deepStrictEqual(tallyTrackB(respondents), {
    w1: { count: 3, intentCount: 1, confidences: [0.9, 0.8, 0.7] },
  });
});

test('tallyTrackB: 該当なし（空配列）の回答者は分母には残るがtallyには載らない', () => {
  const respondents = [
    [{ wordId: 'w1', intent: true, vanity: false, confidence: 0.9 }],
    [], // 候補ワードに該当なし
  ];
  assert.deepStrictEqual(tallyTrackB(respondents), {
    w1: { count: 1, intentCount: 1, confidences: [0.9] },
  });
});

test('tallyTrackB: 同一回答者の同一wordId重複は1件・confidenceは有限値のみ収集', () => {
  const respondents = [[
    { wordId: 'w1', intent: true, vanity: false, confidence: 0.9 },
    { wordId: 'w1', intent: false, vanity: false, confidence: 0.1 },
    { wordId: 'w2', intent: true, vanity: false, confidence: null },
  ]];
  assert.deepStrictEqual(tallyTrackB(respondents), {
    w1: { count: 1, intentCount: 1, confidences: [0.9] },
    w2: { count: 1, intentCount: 1, confidences: [] },
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npm test -- test/kizuki/review-ingest.test.js`
Expected: FAIL — `TypeError: tallyTrackB is not a function`

- [ ] **Step 3: 最小実装を書く**

`tallyTrackA` の下に追加：

```javascript
/**
 * Track B（既存レポートのLLM分類結果）の集計。
 * respondents = [[{wordId, intent, vanity, confidence}], ...]（1要素=1回答者・該当なしは空配列）
 * → { wordId: {count, intentCount, confidences} }
 * vanity=true（見た目等の反応のみ）は件数には数えるが意向には数えない。
 */
function tallyTrackB(respondents) {
  const tally = {};
  for (const items of respondents || []) {
    const seen = new Set();
    for (const it of items || []) {
      if (!it || !it.wordId || seen.has(it.wordId)) continue;
      seen.add(it.wordId);
      const e = bucket(tally, it.wordId);
      e.count += 1;
      if (it.intent && !it.vanity) e.intentCount += 1;
      if (Number.isFinite(it.confidence)) e.confidences.push(it.confidence);
    }
  }
  return tally;
}
```

`module.exports` を更新：

```javascript
module.exports = { SOURCES, S, parseSurveyRows, tallyTrackA, tallyTrackB };
```

- [ ] **Step 4: テストを実行して成功を確認**

Run: `npm test -- test/kizuki/review-ingest.test.js`
Expected: PASS（9 tests）

- [ ] **Step 5: Commit**

```bash
git add lib/kizuki/review-ingest.js test/kizuki/review-ingest.test.js
git commit -m "feat(kizuki): Track B（LLM分類結果）の集計を追加。虚栄反応は意向に数えない

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: `review-ingest.js` — モニターシグナル行の生成＋upsertキー

tally と n からモニターシグナル行を作る。**ここが「分母＝全回答者n（普及率）」を固定する場所**。

**Files:**
- Modify: `lib/kizuki/review-ingest.js`
- Modify: `test/kizuki/review-ingest.test.js`

- [ ] **Step 1: 失敗するテストを書く**

require を差し替え、テストを追記：

```javascript
const {
  parseSurveyRows, tallyTrackA, tallyTrackB, buildReviewSignalRows, signalKey, SOURCES,
} = require('../../lib/kizuki/review-ingest');
```

```javascript
test('buildReviewSignalRows: 共感率は意向÷n（言及なしも分母に残る＝普及率）', () => {
  // 回答者n=50、w1に共感したのは20人だが「買いたい」は17人 → 17/50 = 34%
  const tally = { w1: { count: 20, intentCount: 17, confidences: [] } };
  const rows = buildReviewSignalRows(tally, { n: 50, campaignId: '2026_04_stardust', source: SOURCES.TRACK_A });
  assert.deepStrictEqual(rows, [
    ['w1', 20, '34%', '', '', 'trackA', '2026_04_stardust', ''],
  ]);
});

test('buildReviewSignalRows: レビュー件数は共感/言及者数であって意向数ではない', () => {
  const tally = { w1: { count: 20, intentCount: 17, confidences: [] } };
  const [row] = buildReviewSignalRows(tally, { n: 50, campaignId: 'c1', source: SOURCES.TRACK_A });
  assert.strictEqual(row[1], 20);   // 件数=共感者
  assert.strictEqual(row[2], '34%'); // 率=意向÷n
});

test('buildReviewSignalRows: 虚栄ワード（件数は多いが意向は低い）は件数高・共感率低で出る', () => {
  // 「パケが可愛い」型: 40人が共感したが買いたいは2人 → 2/50 = 4%
  const tally = { vanity1: { count: 40, intentCount: 2, confidences: [] } };
  const [row] = buildReviewSignalRows(tally, { n: 50, campaignId: 'c1', source: SOURCES.TRACK_A });
  assert.strictEqual(row[1], 40);
  assert.strictEqual(row[2], '4%');
});

test('buildReviewSignalRows: n=0 は率を空にする（0除算防止・ad-ingestのpctStrと同じ扱い）', () => {
  const tally = { w1: { count: 0, intentCount: 0, confidences: [] } };
  const rows = buildReviewSignalRows(tally, { n: 0, campaignId: 'c1', source: SOURCES.TRACK_B });
  assert.strictEqual(rows[0][2], '');
});

test('buildReviewSignalRows: trackBはconfidence平均(2桁)・trackA/manualは空', () => {
  const tally = { w1: { count: 2, intentCount: 1, confidences: [0.9, 0.8] } };
  const [b] = buildReviewSignalRows(tally, { n: 10, campaignId: 'c1', source: SOURCES.TRACK_B });
  assert.strictEqual(b[5], 'trackB');
  assert.strictEqual(b[7], 0.85);

  const [a] = buildReviewSignalRows(tally, { n: 10, campaignId: 'c1', source: SOURCES.TRACK_A });
  assert.strictEqual(a[7], '');
});

test('buildReviewSignalRows: 候補ワード外はスキップ（閉じた集合への写像を強制）', () => {
  const tally = {
    w1: { count: 1, intentCount: 1, confidences: [] },
    unknown: { count: 5, intentCount: 5, confidences: [] },
  };
  const rows = buildReviewSignalRows(tally, {
    n: 10, campaignId: 'c1', source: SOURCES.TRACK_B, candidateWordIds: ['w1', 'w2'],
  });
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0][0], 'w1');
});

test('buildReviewSignalRows: 代表URL・2次利用可否は空（当面は手入力/任意）', () => {
  const tally = { w1: { count: 1, intentCount: 1, confidences: [] } };
  const [row] = buildReviewSignalRows(tally, { n: 10, campaignId: 'c1', source: SOURCES.TRACK_A });
  assert.strictEqual(row[3], '');
  assert.strictEqual(row[4], '');
});

test('signalKey: upsertキーは (word_id, campaign_id, source)', () => {
  assert.strictEqual(
    signalKey(['w1', 20, '34%', '', '', 'trackA', '2026_04_stardust', '']),
    'w1|2026_04_stardust|trackA');
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npm test -- test/kizuki/review-ingest.test.js`
Expected: FAIL — `TypeError: buildReviewSignalRows is not a function`

- [ ] **Step 3: 最小実装を書く**

`tallyTrackB` の下に追加：

```javascript
/** confidence の平均（小数2桁）。無ければ ''。 */
function avgConfidence(confidences) {
  const a = (confidences || []).filter((v) => Number.isFinite(v));
  if (!a.length) return '';
  return Math.round((a.reduce((s, v) => s + v, 0) / a.length) * 100) / 100;
}

/**
 * tally + メタ からモニターシグナル行の配列を生成。
 * opts = { n, campaignId, source, candidateWordIds? }
 * n = その施策の全回答者数（共感率の分母＝普及率）。candidateWordIds を渡すと候補外をスキップ。
 */
function buildReviewSignalRows(tally, opts) {
  const { n, campaignId, source } = opts || {};
  const allow = opts && opts.candidateWordIds ? new Set(opts.candidateWordIds) : null;
  const rows = [];
  for (const wordId of Object.keys(tally || {})) {
    if (allow && !allow.has(wordId)) continue;
    const e = tally[wordId];
    const rate = pctStr(e.intentCount, n);
    rows.push([
      wordId,
      e.count,
      rate === null ? '' : rate,
      '', // 代表URL: 当面は手入力/任意
      '', // 2次利用可否: 当面は手入力/任意
      source,
      campaignId,
      source === SOURCES.TRACK_B ? avgConfidence(e.confidences) : '',
    ]);
  }
  return rows;
}

/** モニターシグナル行の upsertキー (word_id, campaign_id, source)。 */
function signalKey(row) {
  return [row[0], row[6], row[5]].join('|');
}
```

`module.exports` を更新：

```javascript
module.exports = {
  SOURCES, S,
  parseSurveyRows, tallyTrackA, tallyTrackB,
  avgConfidence, buildReviewSignalRows, signalKey,
};
```

- [ ] **Step 4: テストを実行して成功を確認**

Run: `npm test -- test/kizuki/review-ingest.test.js`
Expected: PASS（17 tests）

- [ ] **Step 5: Commit**

```bash
git add lib/kizuki/review-ingest.js test/kizuki/review-ingest.test.js
git commit -m "feat(kizuki): モニターシグナル行の生成とupsertキーを追加

共感率の分母は全回答者n（普及率）に固定。n=0は率null（0除算防止）。

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: `ledger-store.js` — モニターシグナルの追加列パース

`parseReviewRow` に `count` / `source` / `campaignId` / `confidence` を足す。**既存の手入力行（5列）は `source` 欠損→`'manual'` 扱い**で後方互換。

**Files:**
- Modify: `lib/kizuki/ledger-store.js`（`parseReviewRow`）
- Modify: `test/kizuki/ledger-store.test.js:29-33`（期待値の更新）

- [ ] **Step 1: 失敗するテストを書く**

`test/kizuki/ledger-store.test.js` の 29〜33行目のテストを**次の内容に置き換える**：

```javascript
test('parseReviewRow: 購買意向共感率"62%"は0.62（/100して0..1に）', () => {
  assert.deepStrictEqual(
    parseReviewRow(['w001', 24, '62%', 'https://x', 'TRUE', 'trackB', '2026_04_stardust', 0.82]),
    { wordId: 'w001', intentRate: 0.62, count: 24, source: 'trackB',
      campaignId: '2026_04_stardust', confidence: 0.82 });
});

test('parseReviewRow: 追加3列が無い既存の手入力行は source=manual として読む（後方互換）', () => {
  assert.deepStrictEqual(
    parseReviewRow(['w001', 24, '62%', 'https://x', 'TRUE']),
    { wordId: 'w001', intentRate: 0.62, count: 24, source: 'manual',
      campaignId: '', confidence: null });
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npm test -- test/kizuki/ledger-store.test.js`
Expected: FAIL — `AssertionError` （実際の値に `count`/`source`/`campaignId`/`confidence` が無い）

- [ ] **Step 3: 最小実装を書く**

`lib/kizuki/ledger-store.js` の台帳列定数 `L` の下に、モニターシグナルの列定数を追加：

```javascript
// モニターシグナルの列インデックス（0始まり）。source以降はスライス2で追加（末尾追加＝既存行と後方互換）
const R = { wordId: 0, count: 1, intentRate: 2, url: 3, reuse: 4, source: 5, campaignId: 6, confidence: 7 };
```

`parseReviewRow` を差し替え：

```javascript
/** 購買意向共感率は "62%"→0.62（score.js は 0..1 を期待）。source未設定の既存行は manual 扱い。 */
function parseReviewRow(r) {
  const pct = parsePercent(r[R.intentRate]);
  return {
    wordId: r[R.wordId],
    intentRate: pct === null ? null : pct / 100,
    count: toNum(r[R.count]),
    source: r[R.source] || 'manual',
    campaignId: r[R.campaignId] || '',
    confidence: toNum(r[R.confidence]),
  };
}
```

`module.exports` に `R` を追加：

```javascript
module.exports = {
  TABS, L, R, parsePercent, toNum,
  parseWorkshopRow, parseReviewRow, parseAdRow, parseCollabRow,
  aggregateSignals, winningDemographics, buildWordRows, buildLedgerScoreUpdate,
};
```

- [ ] **Step 4: テストを実行して成功を確認**

Run: `npm test`
Expected: `tests 120` / `pass 120` / `fail 0`（内訳: 既存102 ＋ review-ingest 17 ＋ parseReviewRow の後方互換テスト1）

- [ ] **Step 5: Commit**

```bash
git add lib/kizuki/ledger-store.js test/kizuki/ledger-store.test.js
git commit -m "feat(kizuki): モニターシグナルにsource/campaign_id/confidenceを追加

末尾3列追加のため既存の手入力行はsource=manualとして後方互換。

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: `ledger-store.js` — review集約を source優先ピックに

現状の `aggregateSignals` は review の `intentRate` を**単純平均**している（`ledger-store.js:81`）。クリーンな trackA と機械生成の trackB を平均するのは不正なので、`trackA > manual > trackB` の**優先ピック（ブレンドしない）**に変える。`score.js` は不改変。

**Files:**
- Modify: `lib/kizuki/ledger-store.js`（`aggregateSignals` の review 部分）
- Modify: `test/kizuki/ledger-store.test.js`（テスト追記）

- [ ] **Step 1: 失敗するテストを書く**

`test/kizuki/ledger-store.test.js` の末尾に追記：

```javascript
test('aggregateSignals: reviewはsource優先ピック（trackAがあればtrackBは無視・平均しない）', () => {
  const parsed = {
    workshop: [], ad: [], collab: [],
    review: [
      { wordId: 'w1', intentRate: 0.60, source: 'trackA', campaignId: 'c1' },
      { wordId: 'w1', intentRate: 0.20, source: 'trackB', campaignId: 'c2' },
    ],
  };
  // 平均(0.40)ではなく trackA の 0.60
  assert.strictEqual(aggregateSignals('w1', parsed).review.intentRate, 0.60);
});

test('aggregateSignals: reviewの優先順位は trackA > manual > trackB', () => {
  const base = { workshop: [], ad: [], collab: [] };
  const manualAndB = Object.assign({}, base, { review: [
    { wordId: 'w1', intentRate: 0.50, source: 'manual', campaignId: '' },
    { wordId: 'w1', intentRate: 0.20, source: 'trackB', campaignId: 'c2' },
  ]});
  assert.strictEqual(aggregateSignals('w1', manualAndB).review.intentRate, 0.50);

  const onlyB = Object.assign({}, base, { review: [
    { wordId: 'w1', intentRate: 0.20, source: 'trackB', campaignId: 'c2' },
  ]});
  assert.strictEqual(aggregateSignals('w1', onlyB).review.intentRate, 0.20);
});

test('aggregateSignals: 同一source内に複数campaignがあれば従来どおり平均', () => {
  const parsed = {
    workshop: [], ad: [], collab: [],
    review: [
      { wordId: 'w1', intentRate: 0.60, source: 'trackA', campaignId: 'c1' },
      { wordId: 'w1', intentRate: 0.40, source: 'trackA', campaignId: 'c2' },
    ],
  };
  assert.strictEqual(aggregateSignals('w1', parsed).review.intentRate, 0.50);
});

test('aggregateSignals: review行はあるが率が全てnullなら intentRate=null（score.jsで0点・stageは暫定）', () => {
  const parsed = {
    workshop: [], ad: [], collab: [],
    review: [{ wordId: 'w1', intentRate: null, source: 'trackB', campaignId: 'c1' }],
  };
  assert.strictEqual(aggregateSignals('w1', parsed).review.intentRate, null);
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npm test -- test/kizuki/ledger-store.test.js`
Expected: FAIL — 1つ目で `0.4 !== 0.6`（現在は単純平均のため）

- [ ] **Step 3: 最小実装を書く**

`lib/kizuki/ledger-store.js` の `maxOr` の下（`aggregateSignals` の直前）に追加：

```javascript
// reviewシグナルの採用優先順位。クリーンなtrackAと機械生成のtrackBを平均しないためのピック。
const REVIEW_SOURCE_PRIORITY = ['trackA', 'manual', 'trackB'];

/**
 * review行から最優先sourceの行だけを返す（ブレンドしない）。
 * 率がnullの行は採用対象にしない（未測定のsourceで上位を占有させない）。
 */
function pickReviewRows(rows) {
  for (const s of REVIEW_SOURCE_PRIORITY) {
    const hit = rows.filter((x) => (x.source || 'manual') === s && x.intentRate !== null);
    if (hit.length) return hit;
  }
  return [];
}
```

`aggregateSignals` の review の行（現 81行目）を差し替え：

```javascript
  if (rv.length) signals.review = { intentRate: avg(pickReviewRows(rv).map((x) => x.intentRate)) };
```

`module.exports` に `REVIEW_SOURCE_PRIORITY, pickReviewRows` を追加：

```javascript
module.exports = {
  TABS, L, R, parsePercent, toNum,
  parseWorkshopRow, parseReviewRow, parseAdRow, parseCollabRow,
  REVIEW_SOURCE_PRIORITY, pickReviewRows,
  aggregateSignals, winningDemographics, buildWordRows, buildLedgerScoreUpdate,
};
```

- [ ] **Step 4: テストを実行して成功を確認**

Run: `npm test`
Expected: `tests 124` / `pass 124` / `fail 0`（既存の `aggregateSignals: 言及は合算…` テストの `review: [{ wordId: 'w1', intentRate: 0.62 }]` は source欠損→`'manual'` で採用され、0.62 のまま緑）

- [ ] **Step 5: Commit**

```bash
git add lib/kizuki/ledger-store.js test/kizuki/ledger-store.test.js
git commit -m "feat(kizuki): review集約をsource優先ピックに変更（trackA > manual > trackB）

クリーンなtrackAと機械生成のtrackBの単純平均は不正なため、最優先sourceのみ採用。
score.jsは不改変。

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: 実レポート2本での結合検証（06の n=0 回帰含む）

実際に受領した2本のレポートの形状で、パース→集計→行生成が通ることを固定する。**06レポートは事後アンケートが空（n=0）** なので「空データで落ちない」回帰テストとして価値が高い。

**Files:**
- Create: `test/kizuki/fixtures/pamun-reports.js`
- Create: `test/kizuki/pamun-report.test.js`

- [ ] **Step 1: fixture を作る（実レポートから起こした生行）**

`test/kizuki/fixtures/pamun-reports.js` を新規作成：

```javascript
'use strict';

/**
 * 実際に受領した施策レポート2本（2026-07-16 調査）から起こした《事後アンケート》詳細シートの生行。
 * - 04（スターダストグロウエッセンス）: 回答あり（実データは50人。ここは代表5人に縮約）
 * - 06（ブラッシュオンUVパウダー）  : 事後アンケート未回答（ヘッダーのみ・n=0）
 * 列: [ご年齢, ①満足度, ②良かった点, ③改善点, ④容器であったら嬉しい商品, ⑤一番気に入ったもの]
 */

const SURVEY_HEADER = [
  'ご年齢',
  '①商品の満足度を教えて下さい',
  '②商品の良かった点を教えてください',
  '③商品の改善点を教えてください',
  '④今回の卵型の容器を使ってあったら嬉しい商品があれば教えてください',
  '⑤お渡しした3つの中で一番気に入ったものを教えてください',
];

// 04レポート《事後アンケート》詳細（代表5行）
const REPORT_2026_04_ROWS = [
  SURVEY_HEADER,
  [39, '良い',
    'MARSとVENUSは使い勝手が良くてよかったです！\nメイク落として綺麗にラメが落ちたのがよかったです！',
    'JUPITERは私には出番があまりないように感じました。',
    '日焼け止め！\n見た目が可愛くて気に入りました！', 'VENUS'],
  [35, '大変満足',
    'キラキラも選べるし、好きな香りも選べる。\n服にもそんなにつかないし、美容液。このお値段でなら文句はないと思います。',
    'キャップが少し固くて開けづらかったです', '除菌できる香り付きとかもいいな', 'JUPITER'],
  [22, '満足', 'キラキラ感が可愛かったところです。', '最初に少し蓋が開けにくかったです。', '日焼け止め', 'JUPITER'],
  [37, '大変満足', 'スキンケアしながら肌をきれいにみせることができるのがよかった',
    'さかさまにしたりすると勝手に美容液がでてくるところ', '日焼け止め', 'JUPITER'],
  [32, '良い', 'うるおい感のあるハイライトで体に使いやすかった', 'ギラギラ感があるので若い子向け', 'クリームチーク', 'JUPITER'],
];

// 06レポート《事後アンケート》詳細（未回答＝ヘッダーのみ）
const REPORT_2026_06_ROWS = [SURVEY_HEADER];

// 04施策の気づきワード台帳 候補ワード（Track Bのマッピング先＝閉じた集合）
const CANDIDATE_WORD_IDS_2026_04 = ['w-skincare-glow', 'w-scent-choice', 'w-kirakira-cute', 'w-easy-cleanse'];

module.exports = {
  SURVEY_HEADER,
  REPORT_2026_04_ROWS,
  REPORT_2026_06_ROWS,
  CANDIDATE_WORD_IDS_2026_04,
};
```

- [ ] **Step 2: 失敗するテストを書く**

`test/kizuki/pamun-report.test.js` を新規作成：

```javascript
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const {
  parseSurveyRows, tallyTrackB, buildReviewSignalRows, SOURCES,
} = require('../../lib/kizuki/review-ingest');
const { parseReviewRow, aggregateSignals } = require('../../lib/kizuki/ledger-store');
const {
  REPORT_2026_04_ROWS, REPORT_2026_06_ROWS, CANDIDATE_WORD_IDS_2026_04,
} = require('./fixtures/pamun-reports');

test('04レポート: 実形状をパースして回答者を取り出せる', () => {
  const respondents = parseSurveyRows(REPORT_2026_04_ROWS);
  assert.strictEqual(respondents.length, 5);
  assert.strictEqual(respondents[0].age, 39);
  assert.strictEqual(respondents[0].favorite, 'VENUS');
  assert.ok(respondents[3].goodPoints.includes('スキンケアしながら'));
});

test('04レポート: 分類結果→行生成まで通る（分母は全回答者n・言及なしも分母に残る）', () => {
  const respondents = parseSurveyRows(REPORT_2026_04_ROWS);
  const n = respondents.length; // 5

  // LLM分類の結果を模した固定値（回答者ごと。該当なしは空配列）
  const classified = [
    [{ wordId: 'w-easy-cleanse', intent: true, vanity: false, confidence: 0.8 }],
    [{ wordId: 'w-scent-choice', intent: true, vanity: false, confidence: 0.9 }],
    [{ wordId: 'w-kirakira-cute', intent: false, vanity: true, confidence: 0.7 }], // 虚栄反応のみ
    [{ wordId: 'w-skincare-glow', intent: true, vanity: false, confidence: 0.9 }],
    [], // 候補ワードに該当なし
  ];

  const rows = buildReviewSignalRows(tallyTrackB(classified), {
    n, campaignId: '2026_04_stardust', source: SOURCES.TRACK_B,
    candidateWordIds: CANDIDATE_WORD_IDS_2026_04,
  });
  const byWord = Object.fromEntries(rows.map((r) => [r[0], r]));

  // 1/5 = 20%
  assert.strictEqual(byWord['w-skincare-glow'][2], '20%');
  // 虚栄反応のみ → 件数1だが意向0 → 0%
  assert.strictEqual(byWord['w-kirakira-cute'][1], 1);
  assert.strictEqual(byWord['w-kirakira-cute'][2], '0%');
  // source/campaign_id/confidence が入る
  assert.strictEqual(byWord['w-skincare-glow'][5], 'trackB');
  assert.strictEqual(byWord['w-skincare-glow'][6], '2026_04_stardust');
  assert.strictEqual(byWord['w-skincare-glow'][7], 0.9);
});

test('04レポート: 生成行はledger-storeが読み戻せてscore.js入力になる（往復）', () => {
  const rows = buildReviewSignalRows(
    { 'w-skincare-glow': { count: 1, intentCount: 1, confidences: [0.9] } },
    { n: 5, campaignId: '2026_04_stardust', source: SOURCES.TRACK_B });

  const parsed = rows.map(parseReviewRow);
  assert.strictEqual(parsed[0].intentRate, 0.2); // "20%" → 0.2
  assert.strictEqual(parsed[0].source, 'trackB');

  const s = aggregateSignals('w-skincare-glow', { workshop: [], ad: [], collab: [], review: parsed });
  assert.strictEqual(s.review.intentRate, 0.2);
});

test('06レポート: 事後アンケート未回答（n=0）でも落ちず、行も出ない', () => {
  const respondents = parseSurveyRows(REPORT_2026_06_ROWS);
  assert.deepStrictEqual(respondents, []);

  const tally = tallyTrackB([]);
  assert.deepStrictEqual(tally, {});

  const rows = buildReviewSignalRows(tally, {
    n: respondents.length, campaignId: '2026_06_uvpowder', source: SOURCES.TRACK_B,
  });
  assert.deepStrictEqual(rows, []);
});

test('06レポート: n=0で分類結果が万一あっても率は空（0除算防止）', () => {
  const rows = buildReviewSignalRows(
    { w1: { count: 1, intentCount: 1, confidences: [] } },
    { n: 0, campaignId: '2026_06_uvpowder', source: SOURCES.TRACK_B });
  assert.strictEqual(rows[0][2], '');
  assert.strictEqual(parseReviewRow(rows[0]).intentRate, null);
});
```

- [ ] **Step 3: テストを実行して成功を確認**

Task 2〜7 の実装で全て賄えるはずなので、このテストは**書いた時点で通る**（新規プロダクションコードは不要）。

Run: `npm test -- test/kizuki/pamun-report.test.js`
Expected: PASS（5 tests）

もし FAIL する場合は Task 2〜7 のどこかに実装漏れがある。fixture ではなく実装を直すこと。

- [ ] **Step 4: 全テストが緑であることを確認**

Run: `npm test`
Expected: `tests 129` / `pass 129` / `fail 0`

- [ ] **Step 5: Commit**

```bash
git add test/kizuki/fixtures/pamun-reports.js test/kizuki/pamun-report.test.js
git commit -m "test(kizuki): 実レポート2本の形状で結合検証（06のn=0回帰含む）

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 9: `lib/sheets.js` — 複合キー upsert のための補助

スライス1の `updateRowById` は単一列キーしか扱えない。モニターシグナルのキーは `(word_id, campaign_id, source)` の複合なので、行番号を求める純粋関数と、行番号指定で書く関数を足す。

**Files:**
- Modify: `lib/sheets.js`
- Create: `test/sheets.test.js`

- [ ] **Step 1: 失敗するテストを書く**

`test/sheets.test.js` を新規作成（`findRowNumberByKey` は純粋関数なので Sheets API に触れずテストできる）：

```javascript
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { findRowNumberByKey } = require('../lib/sheets');

const keyOf = (r) => [r[0], r[6], r[5]].join('|');

test('findRowNumberByKey: 一致行の1始まり行番号を返す（ヘッダーは1行目）', () => {
  const rows = [
    ['word_id', 'レビュー件数', '購買意向共感率', '代表URL', '2次利用可否', 'source', 'campaign_id', 'confidence'],
    ['w1', 20, '34%', '', '', 'manual', '', ''],
    ['w1', 18, '20%', '', '', 'trackB', 'c2', 0.8],
  ];
  assert.strictEqual(findRowNumberByKey(rows, keyOf, 'w1||manual'), 2);
  assert.strictEqual(findRowNumberByKey(rows, keyOf, 'w1|c2|trackB'), 3);
});

test('findRowNumberByKey: 無ければ -1', () => {
  const rows = [['word_id'], ['w1', 20, '34%', '', '', 'manual', '', '']];
  assert.strictEqual(findRowNumberByKey(rows, keyOf, 'w9|c9|trackA'), -1);
});

test('findRowNumberByKey: 空・ヘッダーのみでも落ちない', () => {
  assert.strictEqual(findRowNumberByKey([], keyOf, 'w1||manual'), -1);
  assert.strictEqual(findRowNumberByKey([['word_id']], keyOf, 'w1||manual'), -1);
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npm test -- test/sheets.test.js`
Expected: FAIL — `TypeError: findRowNumberByKey is not a function`

- [ ] **Step 3: 最小実装を書く**

`lib/sheets.js` の `findRowNumber` の下に追加：

```javascript
/** rows（ヘッダー込み）から keyFn(row)===key の行の1始まり行番号を返す。無ければ-1。複合キー用。 */
function findRowNumberByKey(rows, keyFn, key) {
  for (let i = 1; i < (rows || []).length; i++) {
    if (keyFn(rows[i] || []) === key) return i + 1;
  }
  return -1;
}

/** 行番号（1始まり）を指定して rowArray で上書きする。 */
async function updateRowAt(spreadsheetId, tabName, rowNumber, rowArray) {
  const sheets = await getClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${tabName}!A${rowNumber}:Z${rowNumber}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [rowArray] },
  });
}
```

`module.exports` を更新：

```javascript
module.exports = { appendRow, readRows, readAllowlist, findRowNumber, findRowNumberByKey, updateRowById, updateRowAt };
```

- [ ] **Step 4: テストを実行して成功を確認**

Run: `npm test`
Expected: `tests 132` / `pass 132` / `fail 0`

- [ ] **Step 5: Commit**

```bash
git add lib/sheets.js test/sheets.test.js
git commit -m "feat(sheets): 複合キーupsert用のfindRowNumberByKey/updateRowAtを追加

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 10: `scripts/kizuki/pamun_ingest.js` — Track B 取込バッチ（副作用側）

レポート（Google Sheets化済み）を読み、候補ワードを台帳から引き、LLMで分類し、`review-ingest` で行を作って **(word_id, campaign_id, source) で upsert**（手入力/trackA行は不可侵）。

**実装上の決定（spec のオープン論点に対する回答）:**
- **入力経路 = Google Sheets**（xlsx直読みではなく、レポートをスプレッドシート化して読む）。新規依存ゼロ・`lib/sheets` を再利用でき、ARCHITECTURE.md の「Googleエコシステムで統一」に沿う。
- **LLM呼び出し単位 = 施策ごとに1回のバッチ**（回答者は数十人規模）。回答者 `index` をスキーマで往復させ、対応ズレを検証する。
- **モデル = `claude-opus-4-8`**（自由記述の意向/虚栄判定は25点配点に効くニュアンス判断のため）。structured outputs で JSON を強制。

**Files:**
- Create: `scripts/kizuki/pamun_ingest.js`

- [ ] **Step 1: スクリプトを書く**

`scripts/kizuki/pamun_ingest.js` を新規作成：

```javascript
'use strict';
/**
 * 気づきワードサイクル Phase3 スライス2 バッチ本体（Track B＝既存の従来Pamun進行）。
 * Sheet(Pamun取込マッピング) → レポートの《事後アンケート》詳細 → LLMで候補ワードへ写像
 * → review-ingest でモニターシグナル行を生成 → (word_id, campaign_id, source) で upsert。
 * 仕様: docs/superpowers/specs/2026-07-16-kizuki-word-cycle-phase3-slice2-pamun-ingest.md
 *
 * 使い方: node scripts/kizuki/pamun_ingest.js [--campaign <campaign_id>] [--dry-run]
 * 台帳スコアの再計算は recalc_job.js が行う（即時反映したい場合は続けて実行する）。
 */
require('dotenv').config({ override: true });
const Anthropic = require('@anthropic-ai/sdk');
const { readRows, appendRow, updateRowAt, findRowNumberByKey } = require('../../lib/sheets');
const { toNum } = require('../../lib/kizuki/format');
const ledger = require('../../lib/kizuki/ledger-store');
const reviewIngest = require('../../lib/kizuki/review-ingest');

const SHEET_ID = process.env.SHEET_ID;
const MAPPING_TAB = 'Pamun取込マッピング';
const SURVEY_TAB = '《事後アンケート》詳細';
const MODEL = 'claude-opus-4-8';
const DRY_RUN = process.argv.includes('--dry-run');
const CAMPAIGN_ARG = (() => {
  const i = process.argv.indexOf('--campaign');
  return i >= 0 ? process.argv[i + 1] : null;
})();

/** Pamun取込マッピングタブ（ヘッダー: campaign_id, report_name, case_id, n）を読む。 */
async function readMapping() {
  const rows = await readRows(SHEET_ID, MAPPING_TAB);
  return rows.slice(1)
    .filter((r) => r[0] && r[1] && r[2])
    .map((r) => ({ campaignId: r[0], reportName: r[1], caseId: r[2], n: toNum(r[3]) }));
}

/** 台帳から case の候補ワードを引く（word_id と表記のペア）。 */
async function readCandidates(caseId) {
  const rows = await readRows(SHEET_ID, ledger.TABS.LEDGER);
  return rows.slice(1)
    .filter((r) => r[ledger.L.wordId] && r[ledger.L.case] === caseId)
    .map((r) => ({ wordId: r[ledger.L.wordId], word: r[ledger.L.word] }));
}

const CLASSIFY_SCHEMA = {
  type: 'object',
  properties: {
    respondents: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          index: { type: 'integer' },
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                wordId: { type: 'string' },
                intent: { type: 'boolean' },
                vanity: { type: 'boolean' },
                confidence: { type: 'number' },
              },
              required: ['wordId', 'intent', 'vanity', 'confidence'],
              additionalProperties: false,
            },
          },
        },
        required: ['index', 'items'],
        additionalProperties: false,
      },
    },
  },
  required: ['respondents'],
  additionalProperties: false,
};

const SYSTEM_PROMPT = [
  'あなたはPamunモニターの事後アンケート回答を、与えられた「気づきワード候補」に写像する分類器です。',
  '',
  '厳守事項:',
  '- wordId は与えられた候補一覧のいずれかのみ。新しいワードを作らないこと。該当しなければ items を空配列にする。',
  '- intent は「買いたい／使い続けたい」に相当する記述がある場合のみ true。満足の表明だけでは false。',
  '- vanity は見た目・パッケージ・可愛さ等の反応のみで、機能や体験の価値に触れていない場合に true。',
  '- vanity な反応は購買意向として扱わない（呼び出し側で意向から除外される）。',
  '- confidence は0〜1でその分類の確からしさ。',
  '- 主な判断材料は goodPoints（良かった点）。satisfaction / favorite / improvements は文脈として使う。',
  '- 入力の index を必ずそのまま返すこと。',
].join('\n');

/** 回答者配列 → [[{wordId,intent,vanity,confidence}], ...]（indexで整列）。 */
async function classify(respondents, candidates) {
  if (!respondents.length) return [];
  const client = new Anthropic();
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: CLASSIFY_SCHEMA } },
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: JSON.stringify({
        candidates,
        respondents: respondents.map((r) => ({
          index: r.index, satisfaction: r.satisfaction, goodPoints: r.goodPoints,
          improvements: r.improvements, favorite: r.favorite,
        })),
      }),
    }],
  });
  if (msg.stop_reason === 'refusal') throw new Error('分類がrefusalで停止しました');
  const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  const parsed = JSON.parse(text);

  // index で整列し直す（対応ズレ検知。欠落は「該当なし」として空配列）
  const byIndex = new Map(parsed.respondents.map((r) => [r.index, r.items || []]));
  return respondents.map((r) => byIndex.get(r.index) || []);
}

/** モニターシグナルを (word_id, campaign_id, source) で upsert。手入力/trackA行は触らない。 */
async function upsertReviewSignals(signalRows) {
  let inserted = 0, updated = 0;
  for (const row of signalRows) {
    const existing = await readRows(SHEET_ID, ledger.TABS.REVIEW);
    const rowNumber = findRowNumberByKey(existing, reviewIngest.signalKey, reviewIngest.signalKey(row));
    if (rowNumber === -1) {
      await appendRow(SHEET_ID, ledger.TABS.REVIEW, row);
      inserted += 1;
    } else {
      await updateRowAt(SHEET_ID, ledger.TABS.REVIEW, rowNumber, row);
      updated += 1;
    }
  }
  return { inserted, updated };
}

async function ingestCampaign(m) {
  const surveyRows = await readRows(SHEET_ID, `${m.reportName}${SURVEY_TAB}`);
  const respondents = reviewIngest.parseSurveyRows(surveyRows);
  const n = m.n !== null ? m.n : respondents.length;
  const candidates = await readCandidates(m.caseId);
  if (!candidates.length) {
    console.error('⚠ 候補ワードが台帳にありません case=%s（skip）', m.caseId);
    return { campaignId: m.campaignId, rows: [] };
  }
  if (!respondents.length) {
    console.log('· %s: 事後アンケート回答0件（n=%d）→ 生成なし', m.campaignId, n);
    return { campaignId: m.campaignId, rows: [] };
  }
  const classified = DRY_RUN ? respondents.map(() => []) : await classify(respondents, candidates);
  const rows = reviewIngest.buildReviewSignalRows(reviewIngest.tallyTrackB(classified), {
    n,
    campaignId: m.campaignId,
    source: reviewIngest.SOURCES.TRACK_B,
    candidateWordIds: candidates.map((c) => c.wordId),
  });
  return { campaignId: m.campaignId, rows, n, respondents: respondents.length };
}

async function main() {
  if (!SHEET_ID) throw new Error('SHEET_ID が未設定です');
  const mapping = await readMapping();
  const targets = CAMPAIGN_ARG ? mapping.filter((m) => m.campaignId === CAMPAIGN_ARG) : mapping;
  if (!targets.length) throw new Error('対象施策がマッピングにありません（許可リストに追加してください）');

  let totalRows = 0;
  for (const m of targets) {
    const { rows, n, respondents } = await ingestCampaign(m);
    totalRows += rows.length;
    if (DRY_RUN) {
      console.log('DRY-RUN: %s 回答%s人 / n=%s / モニターシグナル生成 %d行（LLM分類・書込なし）',
        m.campaignId, respondents ?? 0, n ?? 0, rows.length);
      continue;
    }
    if (!rows.length) continue;
    const { inserted, updated } = await upsertReviewSignals(rows);
    console.log('✅ %s: モニターシグナル 追加%d行 / 更新%d行（n=%d）', m.campaignId, inserted, updated, n);
  }
  if (!DRY_RUN) {
    console.log('計 %d行。台帳スコアの再計算は次回の recalc_job.js で反映されます', totalRows);
    console.log('（即時反映する場合: node scripts/kizuki/recalc_job.js）');
  }
}

main().catch((e) => { console.error('❌ pamun_ingest 失敗:', e.message); process.exit(1); });
```

- [ ] **Step 2: 構文とモジュール解決を確認（API呼び出しはしない）**

Run: `node --check scripts/kizuki/pamun_ingest.js`
Expected: 出力なし（構文OK）

- [ ] **Step 3: 全テストが緑のままであることを確認**

Run: `npm test`
Expected: `tests 132` / `pass 132` / `fail 0`（このスクリプトは副作用側でテスト対象外・件数は増えない。ロジック核は Task 2〜5 で検証済み）

- [ ] **Step 4: Commit**

```bash
git add scripts/kizuki/pamun_ingest.js
git commit -m "feat(kizuki): Pamun取込バッチ（Track B）を追加

Sheets読取→LLM(claude-opus-4-8/structured outputs)で候補ワードへ写像
→review-ingestで行生成→(word_id,campaign_id,source)でupsert。--dry-run有。
ロジック核はreview-ingest.js（テスト済み）で、ここは副作用のみ。

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 11: `CG_気づきワード台帳.gs` — モニターシグナルの3列追加

台帳GASが生成するモニターシグナルのヘッダーに `source` `campaign_id` `confidence` を足し、記入ガイドを更新する。

**Files:**
- Modify: `CG_気づきワード台帳.gs`（モニターシグナルのヘッダー定義・記入ガイド）

- [ ] **Step 1: モニターシグナルのヘッダー定義を特定する**

Run: `grep -n "モニターシグナル\|購買意向共感率\|2次利用可否" CG_気づきワード台帳.gs`
Expected: モニターシグナルタブのヘッダー配列と記入ガイドの該当行が出る

- [ ] **Step 2: ヘッダー配列に3列を追加する**

モニターシグナルのヘッダー配列（`['word_id', 'レビュー件数', '購買意向共感率', '代表クリエイティブURL', '2次利用可否']` 相当）の**末尾**に3要素を足す：

```javascript
['word_id', 'レビュー件数', '購買意向共感率', '代表クリエイティブURL', '2次利用可否', 'source', 'campaign_id', 'confidence']
```

**末尾追加であること**が後方互換の条件（既存行は `source` 欠損→`manual` として読まれる）。既存列の順序は変えないこと。

- [ ] **Step 3: 記入ガイドに定義を追記する**

モニターシグナルの記入ガイド文言に以下を追記する（既存のガイド記述のスタイルに合わせる）：

```
・レビュー件数 … そのワードに共感/言及した人数（意向の数ではない）
・購買意向共感率 … 「買いたい/使い続けたい」人数 ÷ その施策の全回答者n（%で記入。例: 34%）
・source … manual（手入力）/ trackA（標準化アンケート）/ trackB（既存レポートのLLM写像）
・campaign_id … 施策の一意キー（例: 2026_04_stardust）。手入力行は空でよい
・confidence … trackBのみ。0〜1の機械分類の確からしさ（要レビューの目安）
※同じword_idに複数sourceがある場合、台帳は trackA > manual > trackB の優先で1つだけ採用する（平均しない）
※自動取込は (word_id, campaign_id, source) をキーに upsert する。source=manual の行は自動取込では上書きされない
```

- [ ] **Step 4: 全テストが緑のままであることを確認**

Run: `npm test`
Expected: `tests 132` / `pass 132` / `fail 0`（GASはNode側テスト対象外・件数は増えない。列順が `ledger-store.js` の `R` と一致しているかを目視で確認すること）

- [ ] **Step 5: Commit**

```bash
git add CG_気づきワード台帳.gs
git commit -m "feat(kizuki): 台帳のモニターシグナルにsource/campaign_id/confidenceを追加

末尾3列追加＝既存行と後方互換。記入ガイドに分母n・source優先順位を明記。

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 12: `format.js` の再エクスポート撤去（Task 1 の後始末）

Task 1 では「既存テストを1行も変えない」ことを安全網にするため、`ad-ingest` と `ledger-store` に再エクスポートを残した。その足場が恒久化しないうちに剥がす。

**なぜ今か:** 調査の結果、再エクスポート（`ad-ingest.pctStr` / `ad-ingest.ratioStr` / `ledger-store.parsePercent` / `ledger-store.toNum`）は **テストからしか使われておらず、本番コードの利用はゼロ**。この状態を放置すると、`ad-ingest` が「自分が所有していない汎用フォーマッタ」を公開APIとして広告し続けることになり、Task 1 が解消したはずのモジュール境界の問題がぶり返す。`format.js` の冒頭コメント「数値整形・解釈の唯一の置き場」も、再エクスポートがある限り事実に反する。

**前提:** Task 10 の `pamun_ingest.js` は `toNum` を `lib/kizuki/format` から直接 require している（`ledger.toNum` ではない）。この前提が崩れていたら先に直すこと。

**Files:**
- Create: `test/kizuki/format.test.js`
- Modify: `test/kizuki/ad-ingest.test.js:4-16`（`pctStr`/`ratioStr` のテストと import を削除）
- Modify: `test/kizuki/ledger-store.test.js:5-20`（`parsePercent`/`toNum` のテストと import を削除）
- Modify: `lib/kizuki/ad-ingest.js`（`module.exports` から `pctStr, ratioStr` を削除）
- Modify: `lib/kizuki/ledger-store.js`（`module.exports` から `parsePercent, toNum` を削除）
- Modify: `lib/kizuki/format.js`（JSDocの精度修正）

- [ ] **Step 1: 本番コードに再エクスポート経由の利用が無いことを再確認する（撤去の前提）**

Run:
```bash
grep -rnE "\.(pctStr|ratioStr|parsePercent|toNum)\b" --include=*.js . \
  | grep -v node_modules | grep -v "^./test/" | grep -v "^./lib/kizuki/format.js"
```
Expected: **1件もヒットしないこと**。ヒットしたら、その呼び出し元を `require('./format')`（または `require('../../lib/kizuki/format')`）に付け替えてから先に進む。

- [ ] **Step 2: `test/kizuki/format.test.js` を作成し、4関数のテストを移設する**

移設元のテストを**内容を変えずに**移す（`format.js` は Task 1 でバイト同一に移設済みなので、期待値は現状のまま通る）：

```javascript
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { pctStr, ratioStr, parsePercent, toNum } = require('../../lib/kizuki/format');

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

test('parsePercent: "2.1%"→2.1 / "62%"→62 / 数値そのまま / 空・—はnull', () => {
  assert.strictEqual(parsePercent('2.1%'), 2.1);
  assert.strictEqual(parsePercent('62%'), 62);
  assert.strictEqual(parsePercent(2.1), 2.1);
  assert.strictEqual(parsePercent(''), null);
  assert.strictEqual(parsePercent('—'), null);
});

test('toNum: 数値化・空/—/NaNはnull', () => {
  assert.strictEqual(toNum('2.3'), 2.3);
  assert.strictEqual(toNum(0.9), 0.9);
  assert.strictEqual(toNum(''), null);
  assert.strictEqual(toNum('—'), null);
});

test('小数は「最大N桁」であって固定桁ではない（JSDocの意味を固定する）', () => {
  assert.strictEqual(pctStr(10, 1000), '1%');   // "1.0%" ではない
  assert.strictEqual(ratioStr(200, 100), '2');  // "2.00" ではない
});
```

- [ ] **Step 3: 移設元から重複テストとimportを削除する**

`test/kizuki/ad-ingest.test.js`:
- 4行目の import を `const { buildAdSignalRow, buildAdSignalRows } = require('../../lib/kizuki/ad-ingest');` に変更
- `test('pctStr: ...')` と `test('ratioStr: ...')` の2ブロック（7〜17行目相当）を削除

`test/kizuki/ledger-store.test.js`:
- 5行目の import から `parsePercent, toNum,` を削除
- `test('parsePercent: ...')` と `test('toNum: ...')` の2ブロック（8〜21行目相当）を削除

- [ ] **Step 4: 再エクスポートを剥がす**

`lib/kizuki/ad-ingest.js` の末尾を：
```javascript
module.exports = { buildAdSignalRow, buildAdSignalRows };
```

`lib/kizuki/ledger-store.js` の `module.exports` から `parsePercent, toNum` を削除：
```javascript
module.exports = {
  TABS, L, R,
  parseWorkshopRow, parseReviewRow, parseAdRow, parseCollabRow,
  REVIEW_SOURCE_PRIORITY, pickReviewRows,
  aggregateSignals, winningDemographics, buildWordRows, buildLedgerScoreUpdate,
};
```

両ファイルとも `require('./format')` の行は**残す**（中で使っているため）。

- [ ] **Step 5: JSDocの精度を直す（`format.js` が唯一の契約になったので）**

`lib/kizuki/format.js` の2つのJSDocを差し替える。固定桁ではなく最大桁であること、および汎用モジュールから広告ドメインの語（ROAS）を外すこと：

```javascript
/** 百分率を "2.1%" 形式（最大小数1桁。"1%" のように0埋めはしない）に。分母0・無効は null。 */
function pctStr(numerator, denominator) {
```

```javascript
/** 比率を数値文字列（最大小数2桁。"2" のように0埋めはしない）に。分母0・無効は null。 */
function ratioStr(numerator, denominator) {
```

- [ ] **Step 6: テストを実行して成功を確認**

Run: `npm test`
Expected: `tests 133` / `pass 133` / `fail 0`
（132 から、テストは移設なので増減せず、Step 2 で「最大N桁」テストを1件足したぶん +1）

- [ ] **Step 7: Commit**

```bash
git add lib/kizuki/format.js lib/kizuki/ad-ingest.js lib/kizuki/ledger-store.js \
        test/kizuki/format.test.js test/kizuki/ad-ingest.test.js test/kizuki/ledger-store.test.js
git commit -m "refactor(kizuki): format.jsの再エクスポートを撤去しテストを移設

Task1の再エクスポートは「既存テストを変えない」ための足場で、本番利用はゼロだった。
ad-ingestが所有しない汎用フォーマッタを公開し続ける状態を解消し、format.jsを
実際に唯一の置き場にする。JSDocの「小数N桁」は実挙動どおり「最大N桁」に修正。

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## 完了条件

- [ ] `npm test` が **fail 0**（既存102テストを含め全て緑）
- [ ] `pctStr` / `ratioStr` / `parsePercent` / `toNum` が `lib/kizuki/format.js` からのみ import されている（Task 12 Step 1 の grep が0件）
- [ ] `lib/kizuki/score.js` が **1行も変更されていない**（`git diff main -- lib/kizuki/score.js` が空）
- [ ] `node --check scripts/kizuki/pamun_ingest.js` が通る
- [ ] 台帳GASのモニターシグナル列順が `ledger-store.js` の `R` と一致している

## 運用整備（実装後に必要・コード外）

これらはコードでは完結しないので、実装完了時に申し送ること：

- `.env` の `ANTHROPIC_API_KEY`（Track B分類用）と `SHEET_ID` の設定
- コックピットのSHEET_IDに **`Pamun取込マッピング`タブ**を作成（`campaign_id, report_name, case_id, n`）
- 既存モニターシグナルタブへの3列追加（Task 11のGAS再実行、または既存シートに手で列追加）
- 施策レポート（xlsx）をGoogleスプレッドシート化し、`report_name` をタブ名の接頭辞として合わせる
- Track A（標準化アンケート）の設問生成・回答収集の導線は**本スライスのスコープ外**（`review-ingest.tallyTrackA` は用意済みなので、回答が取れ次第つなぐだけ）
