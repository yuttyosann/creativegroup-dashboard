# 気づきワードサイクル Phase 2（コックピット連携）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 施策進行コックピットに「気づきワード」タブを追加し、`lib/kizuki/score.js` を使って台帳の訴求スコアを自動再計算・書き戻し、勝ちデータから診断入力を自動生成する。

**Architecture:** データ整形とスコア集約は純粋関数 `lib/kizuki/ledger-store.js`（既存 `lib/*-store.js` と同じ流儀・`node:test`）に閉じ込める。スコア計算は Phase 1 で確定した `lib/kizuki/score.js` を**一切改変せず**利用。`cockpit-server.js` に `/api/cockpit/kizuki/*` エンドポイントを追加し、`public/cg-cockpit.html` にタブを足す。台帳＋4シグナルは既存コックピットの Google Sheet（`SHEET_ID`）上のタブ（Phase 1 の `CG_気づきワード台帳.gs` で生成）。

**Tech Stack:** Node.js（Express）／`node --test`／Google Sheets API（既存 `lib/sheets.js`：`readRows`/`updateRowById`）／Vanilla JS フロント。新規依存なし。

**Scope:** Phase 2 のみ。Phase 3（広告/Pamun自動取込→BigQuery昇格）は別計画。仕様書: `docs/superpowers/specs/2026-07-06-kizuki-word-cycle-phase2-design.md`。

---

## 重要な前提：シートの値と score.js の単位

`readRows` は Sheets API の FORMATTED_VALUE を返すため、%セルは文字列（例 `"2.1%"`, `"62%"`）で来る。`score.js` の入力単位は軸ごとに異なるので、ledger-store で正しく変換する：

| シート列 | セルの見え方 | score.js が期待する値 | 変換 |
|---|---|---|---|
| モニター 購買意向共感率 | `"62%"` | `review.intentRate` = 0..1（0.62） | %を外して **/100** |
| 広告 CTR% / CVR% | `"2.1%"` / `"0.3%"` | `ad.ctr` / `ad.cvr` = 百分率の数値（2.1 / 0.3） | %を外すだけ（**/100しない**） |
| 広告 ROAS | `"2.3"` | `ad.roas` = 倍率（2.3） | 数値化 |
| 広告 デモグラ明確度 | `"0.9"` | `ad.demoClarity` = 0..1（0.9） | 数値化 |

この違いはテストで固定する（Task 1）。

## File Structure

- **Create** `lib/kizuki/ledger-store.js` — 台帳＋4シグナルの行整形・word_id集約（`score.js` 入力の組み立て）・スコア書き戻し行の生成。タブ名/列インデックス定数も持つ。
- **Create** `test/kizuki/ledger-store.test.js`
- **Create** `lib/kizuki/diagnosis-input.js` — 勝ち訴求＋勝ちデモグラ → 診断プロンプト入力（productSummary / conditions）へ変換する純粋関数。
- **Create** `test/kizuki/diagnosis-input.test.js`
- **Modify** `cockpit-server.js` — `/api/cockpit/kizuki/words`（GET）・`/recalc`（POST）・`/to-diagnosis`（POST）を追加。
- **Modify** `public/cg-cockpit.html` — `STEPS` に「気づきワード」を追加し、パネルと描画JSを足す。

`lib/kizuki/` サブディレクトリに閉じるのは、診断ツール本体と分離し各ファイルの責務を1つに保つため。

---

## Task 1: ledger-store — 値パーサと行パーサ

**Files:**
- Create: `lib/kizuki/ledger-store.js`
- Test: `test/kizuki/ledger-store.test.js`

- [ ] **Step 1: 失敗するテストを書く**

`test/kizuki/ledger-store.test.js`:
```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const {
  parsePercent, toNum, parseWorkshopRow, parseReviewRow, parseAdRow, parseCollabRow,
} = require('../../lib/kizuki/ledger-store');

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

test('parseWorkshopRow: 言及数と未認知(TRUE)', () => {
  assert.deepStrictEqual(
    parseWorkshopRow(['w001', 'U-03', '発言', 8, 4.6, 'TRUE']),
    { wordId: 'w001', mentions: 8, brandUnaware: true });
});

test('parseReviewRow: 購買意向共感率"62%"は0.62（/100して0..1に）', () => {
  assert.deepStrictEqual(
    parseReviewRow(['w001', 24, '62%', 'https://x', 'TRUE']),
    { wordId: 'w001', intentRate: 0.62 });
});

test('parseAdRow: CTR/CVRは%を外すだけ・ROAS/明確度は数値', () => {
  assert.deepStrictEqual(
    parseAdRow(['w001', 'cr-1', '2.1%', '0.3%', '2.3', '30代/女性', '0.9', 200000]),
    { wordId: 'w001', ctr: 2.1, cvr: 0.3, roas: 2.3, demoClarity: 0.9, demographics: '30代/女性' });
});

test('parseCollabRow: 適合と実売', () => {
  assert.deepStrictEqual(
    parseCollabRow(['w001', 'inf-A', 87, 320, '2.3']),
    { wordId: 'w001', fitScore: 87, sales: 320 });
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npm test -- test/kizuki/ledger-store.test.js`
Expected: FAIL（`Cannot find module '../../lib/kizuki/ledger-store'`）

- [ ] **Step 3: 実装**

`lib/kizuki/ledger-store.js`:
```js
'use strict';

/**
 * 気づきワード台帳＋4シグナルの行整形・集約。
 * スコア計算は lib/kizuki/score.js（単一の正）を利用し、ここでは触らない。
 * 仕様: docs/superpowers/specs/2026-07-06-kizuki-word-cycle-phase2-design.md
 */

// タブ名（CG_気づきワード台帳.gs が生成する名称と一致させる）
const TABS = {
  LEDGER: '気づきワード台帳',
  WORKSHOP: '勉強会シグナル',
  REVIEW: 'モニターシグナル',
  AD: '広告シグナル',
  COLLAB: 'コラボ実績',
};

// 台帳の列インデックス（0始まり）
const L = { case: 0, product: 1, wordId: 2, word: 3, axis: 4, origin: 5, status: 6, stage: 7, score: 8, grade: 9, note: 10, updated: 11 };

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

function parseWorkshopRow(r) {
  return { wordId: r[0], mentions: toNum(r[3]) || 0, brandUnaware: String(r[5]).toUpperCase() === 'TRUE' };
}

/** 購買意向共感率は "62%"→0.62（score.js は 0..1 を期待）。 */
function parseReviewRow(r) {
  const pct = parsePercent(r[2]);
  return { wordId: r[0], intentRate: pct === null ? null : pct / 100 };
}

/** CTR/CVR は "2.1%"→2.1（%を外すだけ。/100しない）。 */
function parseAdRow(r) {
  return { wordId: r[0], ctr: parsePercent(r[2]), cvr: parsePercent(r[3]), roas: toNum(r[4]), demographics: r[5] || '', demoClarity: toNum(r[6]) };
}

function parseCollabRow(r) {
  return { wordId: r[0], fitScore: toNum(r[2]), sales: toNum(r[3]) };
}

module.exports = { TABS, L, parsePercent, toNum, parseWorkshopRow, parseReviewRow, parseAdRow, parseCollabRow };
```

- [ ] **Step 4: テストを実行して成功を確認**

Run: `npm test -- test/kizuki/ledger-store.test.js`
Expected: PASS（6 tests）

- [ ] **Step 5: コミット**

```bash
git add lib/kizuki/ledger-store.js test/kizuki/ledger-store.test.js
git commit -m "feat(kizuki): ledger-store の値パーサ・行パーサ（単位変換込み）"
```

---

## Task 2: ledger-store — word_id 集約と buildWordRows

**Files:**
- Modify: `lib/kizuki/ledger-store.js`
- Test: `test/kizuki/ledger-store.test.js`

- [ ] **Step 1: 失敗するテストを追記**

```js
const { aggregateSignals, buildWordRows } = require('../../lib/kizuki/ledger-store');

test('aggregateSignals: 言及は合算・広告は平均・明確度は最大・未認知はor', () => {
  const parsed = {
    workshop: [{ wordId: 'w1', mentions: 8, brandUnaware: true }, { wordId: 'w1', mentions: 3, brandUnaware: false }],
    review: [{ wordId: 'w1', intentRate: 0.62 }],
    ad: [{ wordId: 'w1', ctr: 2.0, cvr: null, roas: 2.0, demoClarity: 0.9, demographics: '30代' },
         { wordId: 'w1', ctr: 2.2, cvr: 1.0, roas: null, demoClarity: 0.5, demographics: '30代' }],
    collab: [{ wordId: 'w1', fitScore: 80, sales: 100 }],
  };
  const s = aggregateSignals('w1', parsed);
  assert.strictEqual(s.workshop.mentions, 11);
  assert.strictEqual(s.workshop.brandUnaware, true);
  assert.strictEqual(s.review.intentRate, 0.62);
  assert.ok(Math.abs(s.ad.ctr - 2.1) < 1e-9); // (2.0+2.2)/2
  assert.strictEqual(s.ad.cvr, 1.0);           // 平均は非null(1.0)のみ
  assert.strictEqual(s.ad.roas, 2.0);
  assert.strictEqual(s.ad.demoClarity, 0.9);   // 最大
  assert.strictEqual(s.collab.fitScore, 80);
  assert.strictEqual(s.collab.sales, 100);
});

test('aggregateSignals: 該当シグナルが無い軸は undefined', () => {
  const s = aggregateSignals('w9', { workshop: [], review: [], ad: [], collab: [] });
  assert.strictEqual(s.workshop, undefined);
  assert.strictEqual(s.ad, undefined);
});

test('buildWordRows: 台帳行に computed スコアを付けて返す（乾燥＝◎）', () => {
  const tabs = {
    ledgerRows: [
      ['案件ID','商品ID','word_id','ワード本文','訴求軸タグ','起点','status','確度ステージ','訴求スコア','判定','メモ','最終更新'],
      ['C-AVENE','AV01','w1','乾燥でゆらいだ日の駆け込み','使用シーン','勉強会','勝ち','広告確定',87,'◎','','2026/06/30'],
    ],
    workshopRows: [['word_id','',''],['w1','U-03','発言',8,4.6,'TRUE']],
    reviewRows: [['word_id'],['w1',24,'62%','https://x','TRUE']],
    adRows: [['word_id'],['w1','cr-1','2.1%','1.8%','2.3','30代/女性/敏感肌','0.9',200000]],
    collabRows: [['word_id']],
  };
  const rows = buildWordRows(tabs, 'C-AVENE');
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].wordId, 'w1');
  assert.strictEqual(rows[0].computed.grade, '◎');
  assert.ok(rows[0].computed.score >= 80);
  assert.strictEqual(rows[0].computed.stage, '広告確定');
  assert.strictEqual(rows[0].demographics, '30代/女性/敏感肌');
});

test('buildWordRows: caseId でフィルタ（不一致は除外）', () => {
  const tabs = {
    ledgerRows: [['案件ID'],['C-OTHER','AV01','w1','x','情緒','勉強会','候補','暫定','','','','']],
    workshopRows: [['h']], reviewRows: [['h']], adRows: [['h']], collabRows: [['h']],
  };
  assert.strictEqual(buildWordRows(tabs, 'C-AVENE').length, 0);
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npm test -- test/kizuki/ledger-store.test.js`
Expected: FAIL（`aggregateSignals is not a function`）

- [ ] **Step 3: 実装**

`lib/kizuki/ledger-store.js` の `require` 追加（先頭 `'use strict';` の直後）:
```js
const { computeAppealScore } = require('./score');
```

パーサ群の後、`module.exports` の前に追記:
```js
/** null除外平均。全てnullなら null。 */
function avg(xs) {
  const a = xs.filter((v) => v !== null && v !== undefined && Number.isFinite(v));
  return a.length ? a.reduce((s, v) => s + v, 0) / a.length : null;
}
/** null除外最大。全てnullなら null。 */
function maxOr(xs) {
  const a = xs.filter((v) => v !== null && v !== undefined && Number.isFinite(v));
  return a.length ? Math.max(...a) : null;
}

/**
 * parsed = { workshop:[], review:[], ad:[], collab:[] }（parse済み・全word_id混在）から
 * 指定 wordId の score.js 入力 signals を組み立てる。該当が無い軸は undefined。
 */
function aggregateSignals(wordId, parsed) {
  const ws = parsed.workshop.filter((x) => x.wordId === wordId);
  const rv = parsed.review.filter((x) => x.wordId === wordId);
  const ad = parsed.ad.filter((x) => x.wordId === wordId);
  const cb = parsed.collab.filter((x) => x.wordId === wordId);
  const signals = {};
  if (ws.length) signals.workshop = {
    mentions: ws.reduce((s, x) => s + (x.mentions || 0), 0),
    brandUnaware: ws.some((x) => x.brandUnaware),
  };
  if (rv.length) signals.review = { intentRate: avg(rv.map((x) => x.intentRate)) };
  if (ad.length) signals.ad = {
    ctr: avg(ad.map((x) => x.ctr)), cvr: avg(ad.map((x) => x.cvr)),
    roas: avg(ad.map((x) => x.roas)), demoClarity: maxOr(ad.map((x) => x.demoClarity)),
  };
  if (cb.length) signals.collab = { fitScore: maxOr(cb.map((x) => x.fitScore)), sales: cb.reduce((s, x) => s + (x.sales || 0), 0) };
  return signals;
}

/** ad行から wordId の「勝ちデモグラ」（CTR最大の行のデモグラ文字列）を返す。無ければ ''。 */
function winningDemographics(wordId, adParsed) {
  const rows = adParsed.filter((x) => x.wordId === wordId && x.demographics);
  if (!rows.length) return '';
  rows.sort((a, b) => (b.ctr || 0) - (a.ctr || 0));
  return rows[0].demographics;
}

/**
 * 生行（ヘッダー込み）を受け取り、台帳の各ワードに computed スコアを付けた配列を返す。
 * tabs = { ledgerRows, workshopRows, reviewRows, adRows, collabRows }
 */
function buildWordRows(tabs, caseId) {
  const parsed = {
    workshop: (tabs.workshopRows || []).slice(1).map(parseWorkshopRow),
    review: (tabs.reviewRows || []).slice(1).map(parseReviewRow),
    ad: (tabs.adRows || []).slice(1).map(parseAdRow),
    collab: (tabs.collabRows || []).slice(1).map(parseCollabRow),
  };
  return (tabs.ledgerRows || []).slice(1)
    .filter((r) => r[L.wordId] && (!caseId || r[L.case] === caseId))
    .map((r) => {
      const wordId = r[L.wordId];
      const computed = computeAppealScore(aggregateSignals(wordId, parsed));
      return {
        wordId, caseId: r[L.case], productId: r[L.product], word: r[L.word], axis: r[L.axis],
        status: r[L.status], demographics: winningDemographics(wordId, parsed.ad),
        saved: { score: toNum(r[L.score]), grade: r[L.grade] || '', stage: r[L.stage] || '' },
        computed,
      };
    });
}
```

`module.exports` を更新:
```js
module.exports = {
  TABS, L, parsePercent, toNum,
  parseWorkshopRow, parseReviewRow, parseAdRow, parseCollabRow,
  aggregateSignals, winningDemographics, buildWordRows,
};
```

- [ ] **Step 4: テストを実行して成功を確認**

Run: `npm test -- test/kizuki/ledger-store.test.js`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add lib/kizuki/ledger-store.js test/kizuki/ledger-store.test.js
git commit -m "feat(kizuki): word_id集約とbuildWordRows（score.js連携）"
```

---

## Task 3: ledger-store — スコア書き戻し行の生成

**Files:**
- Modify: `lib/kizuki/ledger-store.js`
- Test: `test/kizuki/ledger-store.test.js`

- [ ] **Step 1: 失敗するテストを追記**

```js
const { buildLedgerScoreUpdate } = require('../../lib/kizuki/ledger-store');

test('buildLedgerScoreUpdate: 確度/スコア/判定/最終更新のみ更新し他列は保持', () => {
  const row = ['C-AVENE','AV01','w1','乾燥…','使用シーン','勉強会','勝ち','暫定',10,'×','メモ','2026/06/30'];
  const out = buildLedgerScoreUpdate(row, { score: 89, grade: '◎', stage: '広告確定' }, new Date('2026-07-09T00:00:00Z'));
  assert.strictEqual(out[7], '広告確定'); // stage
  assert.strictEqual(out[8], 89);        // score
  assert.strictEqual(out[9], '◎');        // grade
  assert.strictEqual(out[11], '2026-07-09'); // updated
  assert.strictEqual(out[3], '乾燥…');    // 保持
  assert.strictEqual(out[10], 'メモ');     // 保持
  assert.notStrictEqual(out, row);        // 非破壊（新配列）
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npm test -- test/kizuki/ledger-store.test.js`
Expected: FAIL（`buildLedgerScoreUpdate is not a function`）

- [ ] **Step 3: 実装**

`buildWordRows` の後に追記し、`module.exports` に `buildLedgerScoreUpdate` を追加:
```js
/** 台帳行のコピーに、確度ステージ・訴求スコア・判定・最終更新を書き込んだ新配列を返す（非破壊）。 */
function buildLedgerScoreUpdate(ledgerRow, computed, now = new Date()) {
  const out = ledgerRow.slice();
  out[L.stage] = computed.stage;
  out[L.score] = computed.score;
  out[L.grade] = computed.grade;
  out[L.updated] = now.toISOString().slice(0, 10);
  return out;
}
```

- [ ] **Step 4: テストを実行して成功を確認**

Run: `npm test -- test/kizuki/ledger-store.test.js`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add lib/kizuki/ledger-store.js test/kizuki/ledger-store.test.js
git commit -m "feat(kizuki): スコア書き戻し行 buildLedgerScoreUpdate"
```

---

## Task 4: diagnosis-input — 勝ちデータ→診断入力

**Files:**
- Create: `lib/kizuki/diagnosis-input.js`
- Test: `test/kizuki/diagnosis-input.test.js`

- [ ] **Step 1: 失敗するテストを書く**

`test/kizuki/diagnosis-input.test.js`:
```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { buildDiagnosisInput } = require('../../lib/kizuki/diagnosis-input');

test('buildDiagnosisInput: 勝ち訴求・訴求軸・デモグラを productSummary/conditions に反映', () => {
  const out = buildDiagnosisInput({ word: '乾燥でゆらいだ日の駆け込み', axis: '使用シーン', demographics: '30代/女性/敏感肌' });
  assert.match(out.productSummary, /乾燥でゆらいだ日の駆け込み/);
  assert.match(out.productSummary, /使用シーン/);
  assert.match(out.conditions, /30代\/女性\/敏感肌/);
});

test('buildDiagnosisInput: デモグラ未確定でも文字列を返す（空でも壊れない）', () => {
  const out = buildDiagnosisInput({ word: 'x', axis: '効能', demographics: '' });
  assert.strictEqual(typeof out.productSummary, 'string');
  assert.strictEqual(typeof out.conditions, 'string');
  assert.match(out.conditions, /未確定|未取得/);
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npm test -- test/kizuki/diagnosis-input.test.js`
Expected: FAIL（module not found）

- [ ] **Step 3: 実装**

`lib/kizuki/diagnosis-input.js`:
```js
'use strict';

/**
 * 勝ち訴求（気づきワード）＋勝ちデモグラから、診断ツールの入力（M01/M02/M04の根拠）を生成する。
 * 生成した productSummary / conditions は、コックピットの診断フロー（/api/cockpit/analyze の diagnose）に流す。
 * 仕様: docs/superpowers/specs/2026-07-06-kizuki-word-cycle-phase2-design.md
 */
function buildDiagnosisInput({ word = '', axis = '', demographics = '' } = {}) {
  const demo = String(demographics).trim();
  const productSummary =
    `【広告で勝った訴求】「${word}」（訴求軸：${axis}）\n`
    + `この訴求が広告で最も反応が高かった。M01(カテゴリ)・M02(需要・肌悩み適合)の判定はこの勝ち訴求を軸に行う。`;
  const conditions =
    `【狙う客層＝広告で反応が高かったデモグラ（M04フォロワー層適合の基準）】`
    + (demo ? `${demo}` : `未確定（広告デモグラ未取得。取得後に上書き）`);
  return { productSummary, conditions };
}

module.exports = { buildDiagnosisInput };
```

- [ ] **Step 4: テストを実行して成功を確認**

Run: `npm test -- test/kizuki/diagnosis-input.test.js`
Expected: PASS

- [ ] **Step 5: 全テストが緑か確認 → コミット**

Run: `npm test`
Expected: 既存＋新規すべて PASS（"trust settings of system certificate" 行はノイズ・無視）
```bash
git add lib/kizuki/diagnosis-input.js test/kizuki/diagnosis-input.test.js
git commit -m "feat(kizuki): 勝ちデータから診断入力を生成 diagnosis-input"
```

---

## Task 5: cockpit-server — 気づきワードAPI

**Files:**
- Modify: `cockpit-server.js`（require追加は先頭のrequire群、エンドポイントは `app.get('/', ...)` の直前）

APIはSheets依存で単体テストしないが、`node --check` と起動スモークで壊れていないことを担保する（既存 store のテストで主要ロジックは担保済み）。

- [ ] **Step 1: require を追加**

`cockpit-server.js` の既存 require 群（`const { buildAnalyzePrompt } = require('./lib/analyze-prompt');` の直後）に追記:
```js
const kzLedger = require('./lib/kizuki/ledger-store');
const kzDx = require('./lib/kizuki/diagnosis-input');
```

- [ ] **Step 2: エンドポイントを追加**

`app.get('/', (req, res) => res.redirect('/cg-cockpit.html'));` の**直前**に挿入:
```js
// --- 気づきワード（Phase 2） ---
// 5タブをまとめて読む
async function kzReadTabs() {
  const [ledgerRows, workshopRows, reviewRows, adRows, collabRows] = await Promise.all([
    readRows(SHEET_ID, kzLedger.TABS.LEDGER),
    readRows(SHEET_ID, kzLedger.TABS.WORKSHOP),
    readRows(SHEET_ID, kzLedger.TABS.REVIEW),
    readRows(SHEET_ID, kzLedger.TABS.AD),
    readRows(SHEET_ID, kzLedger.TABS.COLLAB),
  ]);
  return { ledgerRows, workshopRows, reviewRows, adRows, collabRows };
}

// 台帳＋シグナルを結合し、word_idごとに保存値と再計算プレビューを返す
app.get('/api/cockpit/kizuki/words', requireAuth, async (req, res) => {
  try {
    const caseId = String(req.query.case_id || req.query.caseId || '');
    const tabs = await kzReadTabs();
    const words = kzLedger.buildWordRows(tabs, caseId);
    res.json({ ok: true, words });
  } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e).slice(0, 300) }); }
});

// 全ワードのスコアを再計算し、台帳の確度/スコア/判定/最終更新を上書き
app.post('/api/cockpit/kizuki/recalc', requireAuth, async (req, res) => {
  try {
    const caseId = String((req.body || {}).case_id || (req.body || {}).caseId || '');
    const tabs = await kzReadTabs();
    const words = kzLedger.buildWordRows(tabs, caseId);
    const dataRows = tabs.ledgerRows.slice(1);
    let updated = 0;
    for (const w of words) {
      const row = dataRows.find((r) => r[kzLedger.L.wordId] === w.wordId);
      if (!row) continue;
      const newRow = kzLedger.buildLedgerScoreUpdate(row, w.computed);
      await updateRowById(SHEET_ID, kzLedger.TABS.LEDGER, kzLedger.L.wordId, w.wordId, newRow);
      updated += 1;
    }
    res.json({ ok: true, updated });
  } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e).slice(0, 300) }); }
});

// 指定word_idの勝ちデータから診断入力（productSummary/conditions）を生成して返す
app.post('/api/cockpit/kizuki/to-diagnosis', requireAuth, async (req, res) => {
  try {
    const wordId = String((req.body || {}).word_id || '');
    if (!wordId) return res.status(400).json({ ok: false, error: '必須項目が不足しています: word_id' });
    const tabs = await kzReadTabs();
    const w = kzLedger.buildWordRows(tabs, '').find((x) => x.wordId === wordId);
    if (!w) return res.status(404).json({ ok: false, error: 'word_idが見つかりません: ' + wordId });
    const input = kzDx.buildDiagnosisInput({ word: w.word, axis: w.axis, demographics: w.demographics });
    res.json({ ok: true, word_id: wordId, ...input });
  } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e).slice(0, 300) }); }
});
```

- [ ] **Step 3: 構文チェックと起動スモーク**

Run: `node --check cockpit-server.js`
Expected: エラー無し

Run: `PORT=8091 SHEET_ID=dummy node -e "require('./cockpit-server.js'); setTimeout(()=>{console.log('boot-ok');process.exit(0)},800);"`
Expected: `boot-ok`（サーバーが例外なく起動する。Sheets呼び出しは行わないのでdummyで良い）

- [ ] **Step 4: コミット**

```bash
git add cockpit-server.js
git commit -m "feat(kizuki): 気づきワードAPI（words/recalc/to-diagnosis）を追加"
```

---

## Task 6: cg-cockpit.html — 気づきワードタブ

**Files:**
- Modify: `public/cg-cockpit.html`

既存の実装構造：ナビは `STEPS` 配列、パネル本体は `const RENDER = { flow(){...}, hearing(){...}, ..., result(){...} }` というオブジェクトのメソッドで、`render()` が `RENDER[s.id]()` を呼んで描画する（`public/cg-cockpit.html:179` の `RENDER`、`:915` の呼び出し）。API は `api(path,body)`（POST）/`apiGet(path)`、現在の案件は `caseId()`（既存関数、例: `:543`）。CSS は `.card` / `.btn`、淡色は `style="color:var(--muted)"`。

- [ ] **Step 1: STEPS に項目を追加**

`public/cg-cockpit.html` の `STEPS` 配列（`{id:"result", ...}` の直後）に1行追加:
```js
  {id:"kizuki", t:"気づきワード", sub:"勉強会→広告の訴求を台帳でスコア化し、勝ち訴求を診断へ渡す"},
```

- [ ] **Step 2: RENDER にパネルメソッドを追加**

`RENDER` オブジェクトの `result(){ ... }` メソッドの**直後**に、`kizuki` メソッドを追加する（既存メソッドと同じ文字列テンプレート方式）:
```js
  kizuki(){
    return `<div class="card"><h3>🧩 気づきワード台帳</h3>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <button class="btn" onclick="kzLoad()">読み込み</button>
        <button class="btn" onclick="kzRecalc()">スコア再計算（台帳へ書き戻し）</button>
        <span style="color:var(--muted)">現在の案件：<b id="kzCase">-</b></span>
      </div>
      <div id="kzList" style="margin-top:10px;color:var(--muted)">「読み込み」を押してください。</div>
    </div>`;
  },
```

- [ ] **Step 3: 描画・API呼び出しのJSを追加**

`public/cg-cockpit.html` の `<script>` 末尾付近（`window.` に関数を生やしている領域）に追記:
```js
function kzGrade(g){ return {'◎':'#16a34a','○':'#ca8a04','△':'#b45309','×':'#dc2626'}[g] || '#64748b'; }

window.kzLoad = async ()=>{
  const cid = (typeof caseId==="function") ? caseId() : "";
  document.getElementById("kzCase").textContent = cid || "（未設定＝全件）";
  const box = document.getElementById("kzList"); box.textContent = "読み込み中…";
  const r = await apiGet("/api/cockpit/kizuki/words" + (cid?("?case_id="+encodeURIComponent(cid)):""));
  if(!r || !r.ok){ box.textContent = "取得に失敗しました。"; return; }
  if(!r.words.length){ box.textContent = "気づきワードがありません。"; return; }
  box.innerHTML = r.words.map(w=>{
    const c = w.computed || {};
    return `<div class="card">
      <div><b>${w.word||w.wordId}</b> <span class="muted">[${w.axis||""}]</span></div>
      <div>再計算：<b style="color:${kzGrade(c.grade)}">${c.score} ${c.grade}</b>
        <span class="muted">/ ${c.stage||""}（保存値：${(w.saved&&w.saved.score)||"-"} ${(w.saved&&w.saved.grade)||""}）</span></div>
      <div class="muted">勝ちデモグラ：${w.demographics||"—"}</div>
      <button class="btn" onclick="kzToDiagnosis('${w.wordId}')">この訴求で診断入力を作る</button>
      <pre class="kzOut" id="kzOut-${w.wordId}" style="display:none"></pre>
    </div>`;
  }).join("");
};

window.kzRecalc = async ()=>{
  const cid = (typeof caseId==="function") ? caseId() : "";
  if(!confirm("台帳の訴求スコア/判定/確度ステージを再計算して上書きします。よろしいですか？")) return;
  const r = await api("/api/cockpit/kizuki/recalc", cid?{case_id:cid}:{});
  alert(r && r.ok ? (r.updated+"件のワードを更新しました。") : "再計算に失敗しました。");
  if(r && r.ok) window.kzLoad();
};

window.kzToDiagnosis = async (wordId)=>{
  const r = await api("/api/cockpit/kizuki/to-diagnosis", {word_id:wordId});
  const pre = document.getElementById("kzOut-"+wordId);
  if(!r || !r.ok){ pre.style.display="block"; pre.textContent="生成に失敗しました。"; return; }
  pre.style.display="block";
  pre.textContent = "▼ 商品サマリー（M01/M02の根拠）\n" + r.productSummary + "\n\n▼ 条件（M04客層）\n" + r.conditions
    + "\n\n※「5. 診断プロンプト」タブの入力に貼り付けて使ってください。";
};
```

- [ ] **Step 4: プレビューで表示確認（サーバーが必要なら起動）**

`.claude/launch.json` の "Cockpit Live"（`node cockpit-server.js` / port 8090）を使う。preview_start → cg-cockpit を開き、ナビに「気づきワード」タブが出て、パネル（読み込み/再計算ボタン）が表示されることを確認する。ログイン・実データが無くてもタブとパネルの描画自体は確認できる（データ取得はエラーメッセージ表示で可）。

Run（プレビュー確認後）:
```bash
node --check cockpit-server.js
```
Expected: エラー無し

- [ ] **Step 5: コミット**

```bash
git add public/cg-cockpit.html
git commit -m "feat(kizuki): コックピットに気づきワードタブを追加"
```

---

## Self-Review（この計画の点検結果）

- **Spec coverage:** ledger-store（背骨の読み書き・単位変換）→ Task 1-3 ✓／diagnosis-input（勝ちデータ→診断入力）→ Task 4 ✓／エンドポイント words/recalc/to-diagnosis → Task 5 ✓／気づきワードタブ → Task 6 ✓／score.js 不改変で利用 → Task 2 で require のみ ✓／CTR%等の単位変換の罠 → Task 1 のテストで固定 ✓。
- **Placeholder scan:** TODO/TBD なし。全コードステップに実コードあり。API はSheets依存のため単体テスト不可を明記し、`node --check`＋起動スモーク＋プレビューで担保。
- **Type consistency:** `buildWordRows` の戻り値 `{wordId, word, axis, demographics, saved, computed}` は Task 2 で定義し Task 5/6 で同名参照。`computeAppealScore` の戻り `{score,grade,stage,breakdown}` は score.js（Phase1）準拠。`L`（列インデックス）と `TABS`（タブ名）は Task 1 で定義し Task 2/3/5 で共有。`buildLedgerScoreUpdate(row, computed, now)` の引数順は Task 3 定義と Task 5 呼び出しで一致。
- **注意（Phase 2→実運用）:** cg-cockpit.html のパネル生成は既存構造（`step.id` 分岐）に合流させる想定。実ファイルの分岐が `switch` の場合は `case "kizuki":` として同じ文字列を返す。CSSクラス（card/btn/muted/pad/row/mt/sm）は既存の流用。無い場合は最寄りの既存クラスに合わせる。
