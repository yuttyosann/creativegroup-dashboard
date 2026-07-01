# 気づきワードサイクル Phase 1（土台）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 気づきワードの訴求スコア計算エンジン（Nodeでテスト済み）と、データ連携の背骨となる「気づきワード台帳」スプレッドシート生成器（GAS）を作る。

**Architecture:** スコアの単一の正（source of truth）は純粋関数 `lib/kizuki/score.js`。各モジュールのシグナルを集約したオブジェクトを受け取り、訴求スコア・判定・確度ステージを返す。GAS生成器 `CG_気づきワード台帳.gs` は台帳＋4シグナルシート＋記入ガイドを作る「データ構造レイヤ」。Phase 1ではスコアは手入力/サンプル値で運用し、エンジンとシートの自動連携（コックピット）は Phase 2 に回す。

**Tech Stack:** Node.js 標準テストランナー（`node --test`, `node:assert`）／Google Apps Script（SpreadsheetApp）。新規依存なし。

**Scope:** これは Phase 1 のみ。Phase 2（コックピット気づきワードタブ＋診断ツール接続）と Phase 3（広告/Pamun自動取込＋BigQuery昇格）は別計画。仕様書: `docs/superpowers/specs/2026-06-30-kizuki-word-cycle-design.md`。

---

## File Structure

- **Create:** `lib/kizuki/score.js` — 訴求スコア計算（純粋関数群）。配点・正規化基準・虚栄控除・確度ステージ・判定。
- **Create:** `test/kizuki/score.test.js` — `node:test` による単体テスト。仕様書セクション2の計算例（「パケ可愛い」「乾燥でゆらいだ」）を含む。
- **Create:** `CG_気づきワード台帳.gs` — 台帳＋4シグナルシート＋記入ガイドを生成するGAS。既存 `CG_提案ログDB.gs` / `CG_案件データベース.gs` と同じ `build/add/_build` 作法。

`lib/kizuki/` と `test/kizuki/` を新設するのは、診断ツール本体と気づきワードのコードを分離して各ファイルの責務を1つに保つため。`lib/` 直下は既存モジュールが多いので、新機能はサブディレクトリにまとめる。

---

## Task 1: スコアエンジンの骨格と配点定数

**Files:**
- Create: `lib/kizuki/score.js`
- Test: `test/kizuki/score.test.js`

- [ ] **Step 1: 失敗するテストを書く**

`test/kizuki/score.test.js`:
```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { computeAppealScore, WEIGHTS } = require('../../lib/kizuki/score');

test('WEIGHTS: 配点合計は100（虚栄控除を除く）', () => {
  const sum = WEIGHTS.workshop + WEIGHTS.review + WEIGHTS.ad + WEIGHTS.demo + WEIGHTS.collab;
  assert.strictEqual(sum, 100);
});

test('computeAppealScore: 空シグナルは score 0・暫定・×', () => {
  const r = computeAppealScore({});
  assert.strictEqual(r.score, 0);
  assert.strictEqual(r.stage, '暫定');
  assert.strictEqual(r.grade, '×');
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npm test -- test/kizuki/score.test.js`
Expected: FAIL（`Cannot find module '../../lib/kizuki/score'`）

- [ ] **Step 3: 最小実装**

`lib/kizuki/score.js`:
```js
'use strict';

/**
 * 気づきワード 訴求スコア計算。
 * 仕様: docs/superpowers/specs/2026-06-30-kizuki-word-cycle-design.md セクション2。
 * 実データ（広告CTR/CVR）を最重視し、言及の多さ（虚栄）だけでは上がらない。
 * これがスコアの単一の正。GAS台帳/コックピット/BQはこの定義に従う。
 */

// 配点（合計100。虚栄控除は別途 -20..0）
const WEIGHTS = {
  workshop: 15, // ①勉強会：言及の質＋ブランド未認知
  review: 25,   // ②Pamun：購買意向共感率
  ad: 40,       // ③広告：CTR/CVR/ROAS（最重視）
  demo: 10,     // ③広告：デモグラ明確度
  collab: 10,   // ④インフル：適合・実売
};

function computeAppealScore(signals = {}) {
  return { score: 0, grade: '×', stage: '暫定', breakdown: {} };
}

module.exports = { computeAppealScore, WEIGHTS };
```

- [ ] **Step 4: テストを実行して成功を確認**

Run: `npm test -- test/kizuki/score.test.js`
Expected: PASS（2 tests）

- [ ] **Step 5: コミット**

```bash
git add lib/kizuki/score.js test/kizuki/score.test.js
git commit -m "feat(kizuki): スコアエンジンの骨格と配点定数を追加"
```

---

## Task 2: 正規化ヘルパーと各軸サブスコア

**Files:**
- Modify: `lib/kizuki/score.js`
- Test: `test/kizuki/score.test.js`

- [ ] **Step 1: 失敗するテストを追記**

`test/kizuki/score.test.js` に追記:
```js
const { workshopScore, reviewScore, adScore, demoScore, collabScore } = require('../../lib/kizuki/score');

test('workshopScore: 言及8＋ブランド未認知で満点15', () => {
  assert.strictEqual(workshopScore({ mentions: 8, brandUnaware: true }), 15);
});

test('reviewScore: 購買意向共感率60%で満点25', () => {
  assert.strictEqual(reviewScore({ intentRate: 0.6 }), 25);
});

test('reviewScore: 未測定(null)は0', () => {
  assert.strictEqual(reviewScore({ intentRate: null }), 0);
});

test('adScore: CTR2.0%で満点40（測定済みのみ平均）', () => {
  assert.strictEqual(adScore({ ctr: 2.0 }), 40);
});

test('adScore: 未測定は0（50%で底上げしない＝虚栄を防ぐ）', () => {
  assert.strictEqual(adScore({}), 0);
});

test('demoScore: デモグラ明確度1.0で満点10', () => {
  assert.strictEqual(demoScore({ demoClarity: 1.0 }), 10);
});

test('collabScore: 適合100かつ実売ありで満点10', () => {
  assert.strictEqual(collabScore({ fitScore: 100, sales: 50 }), 10);
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npm test -- test/kizuki/score.test.js`
Expected: FAIL（`workshopScore is not a function` など）

- [ ] **Step 3: 実装**

`lib/kizuki/score.js` の `WEIGHTS` 定義の直後に追記し、`module.exports` を更新:
```js
// 正規化の基準値（この値で満点）
const CTR_GOOD = 2.0;    // %
const CVR_GOOD = 3.0;    // %
const ROAS_GOOD = 2.0;   // 倍（=200%）
const INTENT_GOOD = 0.6; // 購買意向共感率 60%
const MENTION_GOOD = 8;  // 言及数

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** 平均（null/NaN除外）。全て無効なら null。 */
function avgDefined(xs) {
  const a = xs.filter((v) => num(v) !== null);
  if (a.length === 0) return null;
  return a.reduce((s, v) => s + v, 0) / a.length;
}

/** ①勉強会 0..15。言及数(MENTION_GOODで頭打ち)×0.5 ＋ ブランド未認知×0.5。 */
function workshopScore(w) {
  if (!w) return 0;
  const mentionNorm = clamp01((num(w.mentions) ?? 0) / MENTION_GOOD);
  const unaware = w.brandUnaware ? 1 : 0;
  return (mentionNorm * 0.5 + unaware * 0.5) * WEIGHTS.workshop;
}

/** ②Pamun 0..25。購買意向共感率(0..1)をINTENT_GOODで満点に。未測定は0。 */
function reviewScore(r) {
  if (!r) return 0;
  const intent = num(r.intentRate);
  if (intent === null) return 0;
  return clamp01(intent / INTENT_GOOD) * WEIGHTS.review;
}

/** ③広告 0..40。CTR/CVR/ROASの正規化平均（測定済みのみ）。未測定は0。 */
function adScore(a) {
  if (!a) return 0;
  const parts = [];
  if (num(a.ctr) !== null) parts.push(clamp01(a.ctr / CTR_GOOD));
  if (num(a.cvr) !== null) parts.push(clamp01(a.cvr / CVR_GOOD));
  if (num(a.roas) !== null) parts.push(clamp01(a.roas / ROAS_GOOD));
  const m = avgDefined(parts);
  return m === null ? 0 : m * WEIGHTS.ad;
}

/** ③デモグラ明確度 0..10。0..1。未測定は0。 */
function demoScore(a) {
  if (!a) return 0;
  const d = num(a.demoClarity);
  return d === null ? 0 : clamp01(d) * WEIGHTS.demo;
}

/** ④インフル 0..10。適合(0..100)正規化＋実売ありで+0.2底上げ。未測定は0。 */
function collabScore(c) {
  if (!c) return 0;
  const fit = num(c.fitScore);
  const sales = num(c.sales);
  if (fit === null && sales === null) return 0;
  const fitNorm = fit === null ? 0 : clamp01(fit / 100);
  const soldBonus = sales !== null && sales > 0 ? 0.2 : 0;
  return clamp01(fitNorm + soldBonus) * WEIGHTS.collab;
}
```

`module.exports` を更新:
```js
module.exports = {
  computeAppealScore, WEIGHTS,
  workshopScore, reviewScore, adScore, demoScore, collabScore,
};
```

- [ ] **Step 4: テストを実行して成功を確認**

Run: `npm test -- test/kizuki/score.test.js`
Expected: PASS（全テスト）

- [ ] **Step 5: コミット**

```bash
git add lib/kizuki/score.js test/kizuki/score.test.js
git commit -m "feat(kizuki): 各軸サブスコアと正規化ヘルパーを実装"
```

---

## Task 3: 虚栄控除

**Files:**
- Modify: `lib/kizuki/score.js`
- Test: `test/kizuki/score.test.js`

- [ ] **Step 1: 失敗するテストを追記**

```js
const { vanityPenalty } = require('../../lib/kizuki/score');

test('vanityPenalty: 言及多い(11)がCTR低い(0.6%)で減点される', () => {
  const p = vanityPenalty({ workshop: { mentions: 11 }, ad: { ctr: 0.6 } });
  assert.ok(p < 0, '減点されるべき');
  assert.strictEqual(p, -5); // (0.4-0.3)/0.4*20 = 5
});

test('vanityPenalty: 広告未測定なら控除しない（まだ判定不能）', () => {
  assert.strictEqual(vanityPenalty({ workshop: { mentions: 11 } }), 0);
});

test('vanityPenalty: 言及が少なければ控除しない', () => {
  assert.strictEqual(vanityPenalty({ workshop: { mentions: 3 }, ad: { ctr: 0.2 } }), 0);
});

test('vanityPenalty: CTRが十分高ければ控除しない', () => {
  assert.strictEqual(vanityPenalty({ workshop: { mentions: 11 }, ad: { ctr: 2.1 } }), 0);
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npm test -- test/kizuki/score.test.js`
Expected: FAIL（`vanityPenalty is not a function`）

- [ ] **Step 3: 実装**

`collabScore` の直後に追記:
```js
const MAX_VANITY_PENALTY = 20;

/**
 * 虚栄控除 -20..0。言及は多い(>=MENTION_GOOD)のに広告で転換が確認できない場合に減点。
 * 「パケ可愛い」型（注目は集めるが売れない）を弾く。広告未測定なら控除しない。
 */
function vanityPenalty(signals) {
  const w = signals.workshop;
  const a = signals.ad;
  if (!w || !a) return 0;
  const mentions = num(w.mentions) ?? 0;
  const ctr = num(a.ctr);
  if (mentions <= MENTION_GOOD || ctr === null) return 0; // 満点上限(8)ちょうどは控除しない＝境界
  const ctrNorm = clamp01(ctr / CTR_GOOD);
  if (ctrNorm >= 0.4) return 0;
  return -Math.round(((0.4 - ctrNorm) / 0.4) * MAX_VANITY_PENALTY);
}
```

`module.exports` に `vanityPenalty` を追加。

- [ ] **Step 4: テストを実行して成功を確認**

Run: `npm test -- test/kizuki/score.test.js`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add lib/kizuki/score.js test/kizuki/score.test.js
git commit -m "feat(kizuki): 虚栄控除（パケ可愛い型を弾く）を実装"
```

---

## Task 4: 確度ステージ・判定・統合関数

**Files:**
- Modify: `lib/kizuki/score.js`
- Test: `test/kizuki/score.test.js`

- [ ] **Step 1: 失敗するテストを追記**

```js
const { confidenceStage, grade } = require('../../lib/kizuki/score');

test('confidenceStage: 広告データありで広告確定', () => {
  assert.strictEqual(confidenceStage({ ad: { ctr: 1.0 } }), '広告確定');
});

test('confidenceStage: レビューのみでレビュー反映', () => {
  assert.strictEqual(confidenceStage({ review: { intentRate: 0.5 } }), 'レビュー反映');
});

test('confidenceStage: 勉強会のみで暫定', () => {
  assert.strictEqual(confidenceStage({ workshop: { mentions: 5 } }), '暫定');
});

test('grade: 閾値（80◎/60○/40△/それ未満×）', () => {
  assert.strictEqual(grade(80), '◎');
  assert.strictEqual(grade(60), '○');
  assert.strictEqual(grade(40), '△');
  assert.strictEqual(grade(39), '×');
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npm test -- test/kizuki/score.test.js`
Expected: FAIL（`confidenceStage is not a function`）

- [ ] **Step 3: 実装**

`vanityPenalty` の直後に追記し、骨格の `computeAppealScore` を本実装に置き換える:
```js
/** 確度ステージ。広告データありで確定、レビューありで反映、それ以外は暫定。 */
function confidenceStage(signals = {}) {
  const a = signals.ad;
  if (a && (num(a.ctr) !== null || num(a.cvr) !== null || num(a.roas) !== null)) return '広告確定';
  if (signals.review && num(signals.review.intentRate) !== null) return 'レビュー反映';
  return '暫定';
}

/** スコア→判定。 */
function grade(score) {
  if (score >= 80) return '◎';
  if (score >= 60) return '○';
  if (score >= 40) return '△';
  return '×';
}
```

骨格の `computeAppealScore`（Task 1の暫定版）を次に置き換え:
```js
/**
 * 気づきワードの訴求スコアを算出。
 * @param {object} signals { workshop, review, ad, collab }
 * @returns {{score:number, grade:string, stage:string, breakdown:object}}
 */
function computeAppealScore(signals = {}) {
  const breakdown = {
    workshop: workshopScore(signals.workshop),
    review: reviewScore(signals.review),
    ad: adScore(signals.ad),
    demo: demoScore(signals.ad),
    collab: collabScore(signals.collab),
    vanity: vanityPenalty(signals),
  };
  const raw = breakdown.workshop + breakdown.review + breakdown.ad
    + breakdown.demo + breakdown.collab + breakdown.vanity;
  const score = Math.max(0, Math.min(100, Math.round(raw)));
  return { score, grade: grade(score), stage: confidenceStage(signals), breakdown };
}
```

`module.exports` に `confidenceStage, grade` を追加。

- [ ] **Step 4: テストを実行して成功を確認**

Run: `npm test -- test/kizuki/score.test.js`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add lib/kizuki/score.js test/kizuki/score.test.js
git commit -m "feat(kizuki): 確度ステージ・判定・統合関数computeAppealScoreを実装"
```

---

## Task 5: 仕様書の計算例で受け入れテスト

**Files:**
- Test: `test/kizuki/score.test.js`

これらは仕様書セクション2の代表例。マジックナンバーで固定せず「強い訴求は◎(>=80)」「虚栄型は×(<40)」という振る舞いを検証する（例の点数は説明用で、配点調整時に壊れにくくする）。

- [ ] **Step 1: 受け入れテストを追記**

```js
test('受け入れ例「乾燥でゆらいだ日の駆け込み」: 広告確定・◎・80以上', () => {
  const r = computeAppealScore({
    workshop: { mentions: 8, brandUnaware: true },
    review: { intentRate: 0.62 },
    ad: { ctr: 2.1, demoClarity: 0.9 },
  });
  assert.strictEqual(r.stage, '広告確定');
  assert.ok(r.score >= 80, `期待:>=80 実際:${r.score}`);
  assert.strictEqual(r.grade, '◎');
});

test('受け入れ例「パケが可愛い」: 言及最多でも虚栄控除で×・40未満', () => {
  const r = computeAppealScore({
    workshop: { mentions: 11, brandUnaware: false },
    review: { intentRate: 0.12 },
    ad: { ctr: 0.6 },
  });
  assert.ok(r.breakdown.vanity < 0, '虚栄控除が発動するべき');
  assert.ok(r.score < 40, `期待:<40 実際:${r.score}`);
  assert.strictEqual(r.grade, '×');
});

test('未確定の訴求（勉強会のみ）は暫定で低スコアに留まる（虚栄を防ぐ）', () => {
  const r = computeAppealScore({ workshop: { mentions: 8, brandUnaware: true } });
  assert.strictEqual(r.stage, '暫定');
  assert.ok(r.score < 40, `未確定なので低いはず 実際:${r.score}`);
});
```

- [ ] **Step 2: テストを実行**

Run: `npm test -- test/kizuki/score.test.js`
Expected: PASS（既存実装で通るはず。落ちたら配点・正規化基準を見直す）

- [ ] **Step 3: 全テストが緑であることを確認**

Run: `npm test`
Expected: 既存テスト含め全て PASS

- [ ] **Step 4: コミット**

```bash
git add test/kizuki/score.test.js
git commit -m "test(kizuki): 仕様書の計算例（乾燥/パケ可愛い）で受け入れ検証"
```

---

## Task 6: 気づきワード台帳 GAS 生成器（台帳＋4シグナル＋ガイド）

**Files:**
- Create: `CG_気づきワード台帳.gs`

GASはこのリポジトリでは Apps Script エディタに貼り付けて実行する運用（既存 `CG_提案ログDB.gs` 等と同じ）。ローカルの自動テストは無いため、検証は Step 4 のエディタ実行＋目視。スコアは Phase 1 では手入力/サンプル値（自動連携は Phase 2 のコックピットで `lib/kizuki/score.js` を呼ぶ）。

- [ ] **Step 1: 生成器を作成**

`CG_気づきワード台帳.gs`:
```js
/**
 * Creative Group — 気づきワード台帳 自動生成
 *
 * 「気づきワードサイクル」のデータ連携の背骨。word_id で全モジュールを串刺しする。
 * 中心＝気づきワード台帳。各モジュールはシグナルシートに word_id 単位で追記。
 * 訴求スコアの計算ロジックは lib/kizuki/score.js が単一の正（Phase2でコックピットが自動反映）。
 * 仕様: docs/superpowers/specs/2026-06-30-kizuki-word-cycle-design.md
 *
 * 【使い方】
 * 1. スプレッドシート →「拡張機能」→「Apps Script」にこのコードを貼付
 * 2. buildKizukiLedger を実行（新規・サンプル入り）／ addKizukiLedger（不足シートのみ追加）
 */

const KZ_SHEETS = ['気づきワード台帳', '勉強会シグナル', 'モニターシグナル', '広告シグナル', 'コラボ実績', '記入ガイド'];

function buildKizukiLedger() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const tmp = ss.insertSheet('__tmp__');
  KZ_SHEETS.forEach((n) => { const s = ss.getSheetByName(n); if (s) ss.deleteSheet(s); });
  _kzLedger(ss);
  _kzWorkshop(ss);
  _kzReview(ss);
  _kzAd(ss);
  _kzCollab(ss);
  _kzGuide(ss);
  ss.deleteSheet(tmp);
  ss.setActiveSheet(ss.getSheetByName('気づきワード台帳'));
  SpreadsheetApp.getUi().alert('✅ 気づきワード台帳を作成しました。サンプル（87点◎/64点○/28点×相当）入りです。');
}

function addKizukiLedger() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const added = [];
  const map = { '気づきワード台帳': _kzLedger, '勉強会シグナル': _kzWorkshop, 'モニターシグナル': _kzReview, '広告シグナル': _kzAd, 'コラボ実績': _kzCollab, '記入ガイド': _kzGuide };
  Object.keys(map).forEach((n) => { if (!ss.getSheetByName(n)) { map[n](ss); added.push(n); } });
  SpreadsheetApp.getUi().alert(added.length ? `✅ 追加: ${added.join('、')}` : 'すでに存在します。');
}

// 共通：シート骨格を作る（タイトル帯＋ヘッダー＋データ＋ゼブラ＋固定）
function _kzSheet(ss, idx, name, headerColor, cols, rows) {
  const C = { dark: '#1E2D40', white: '#FFFFFF', zebra: '#F4F6F7' };
  const sh = ss.insertSheet(name, idx);
  const need = cols.length;
  if (sh.getMaxColumns() < need) sh.insertColumnsAfter(sh.getMaxColumns(), need - sh.getMaxColumns());
  cols.forEach((c, i) => sh.setColumnWidth(i + 1, c[1]));
  sh.setRowHeight(2, 34); sh.setRowHeight(3, 38);
  sh.getRange(2, 1, 1, need).merge().setValue('Creative Group — ' + name)
    .setBackground(C.dark).setFontColor(C.white).setFontSize(13).setFontWeight('bold')
    .setHorizontalAlignment('center').setVerticalAlignment('middle');
  sh.getRange(3, 1, 1, need).setValues([cols.map((c) => c[0])])
    .setBackground(headerColor).setFontColor(C.white).setFontSize(8).setFontWeight('bold')
    .setHorizontalAlignment('center').setVerticalAlignment('middle').setWrap(true);
  const DR = 4;
  if (rows && rows.length) {
    sh.getRange(DR, 1, rows.length, need).setValues(rows).setFontSize(9).setVerticalAlignment('middle').setWrap(true);
    for (let r = DR; r < DR + rows.length; r += 2) sh.getRange(r, 1, 1, need).setBackground(C.zebra);
  }
  for (let r = (rows ? DR + rows.length : DR); r < (rows ? DR + rows.length : DR) + 20; r++) {
    if (r % 2 === 0) sh.getRange(r, 1, 1, need).setBackground(C.zebra);
  }
  sh.setFrozenRows(3);
  sh.setFrozenColumns(1);
  return sh;
}

const KZ_DV = (list) => SpreadsheetApp.newDataValidation().requireValueInList(list, true).setAllowInvalid(true).build();

// 中心テーブル：気づきワード台帳
function _kzLedger(ss) {
  const cols = [
    ['案件ID', 140], ['商品ID', 90], ['word_id', 120], ['ワード本文', 240], ['訴求軸タグ', 110],
    ['起点', 90], ['status', 110], ['確度ステージ', 100], ['訴求スコア', 90], ['判定', 60], ['メモ', 220], ['最終更新', 90],
  ];
  const rows = [
    ['2026-06-AVENE', 'AV01', 'w001', '乾燥でゆらいだ日の駆け込み', '使用シーン', '勉強会', '勝ち', '広告確定', 87, '◎', '広告CTR2.1%・30代敏感肌が明確', '2026/06/30'],
    ['2026-06-AVENE', 'AV01', 'w002', '無香料だから夜も気にならない', '情緒', 'レビュー', '広告検証', 'レビュー反映', 64, '○', '候補抽出中', '2026/06/30'],
    ['2026-06-AVENE', 'AV01', 'w003', 'パケが可愛い', '情緒', '勉強会', '見送り', '広告確定', 28, '×', '言及最多だがCVR低・虚栄控除', '2026/06/30'],
  ];
  const sh = _kzSheet(ss, 0, '気づきワード台帳', '#4F46E5', cols, rows);
  sh.getRange(4, 5, 60, 1).setDataValidation(KZ_DV(['効能', '情緒', '使用シーン', '成分', '価格']));
  sh.getRange(4, 6, 60, 1).setDataValidation(KZ_DV(['勉強会', 'レビュー', 'コメント']));
  sh.getRange(4, 7, 60, 1).setDataValidation(KZ_DV(['候補', 'モニター', '広告検証', '勝ち', '見送り']));
  sh.getRange(4, 8, 60, 1).setDataValidation(KZ_DV(['暫定', 'レビュー反映', '広告確定']));
  sh.getRange(4, 10, 60, 1).setDataValidation(KZ_DV(['◎', '○', '△', '×']));
  sh.getRange(3, 9).setNote('lib/kizuki/score.js の computeAppealScore で算出（100点満点＋虚栄控除）。Phase1は手入力/サンプル。Phase2でコックピットが自動反映。');
  sh.getRange(3, 3).setNote('word_id が全シグナルシートを串刺しする連携キー。');
}

// ①勉強会シグナル
function _kzWorkshop(ss) {
  const cols = [['word_id', 120], ['参加者ID(匿名)', 110], ['発言抜粋', 300], ['言及数', 70], ['アンケ評価', 90], ['ブランド未認知', 100]];
  const rows = [
    ['w001', 'U-03', '化粧水なのに、肌が荒れた時に一番に手が伸びる', 8, 4.6, 'TRUE'],
    ['w003', 'U-07', 'まずパッケージが可愛くてテンション上がる', 11, 4.1, 'FALSE'],
  ];
  const sh = _kzSheet(ss, 1, '勉強会シグナル', '#0369A1', cols, rows);
  sh.getRange(4, 6, 60, 1).setDataValidation(KZ_DV(['TRUE', 'FALSE']));
}

// ②モニターシグナル（Pamun）
function _kzReview(ss) {
  const cols = [['word_id', 120], ['レビュー件数', 90], ['購買意向共感率', 110], ['代表クリエイティブURL', 220], ['2次利用可否', 90]];
  const rows = [
    ['w001', 24, '62%', 'https://pamun.example/r/001', 'TRUE'],
    ['w003', 30, '12%', 'https://pamun.example/r/003', 'TRUE'],
  ];
  const sh = _kzSheet(ss, 2, 'モニターシグナル', '#0D9488', cols, rows);
  sh.getRange(4, 3, 60, 1).setNumberFormat('0%');
  sh.getRange(4, 5, 60, 1).setDataValidation(KZ_DV(['TRUE', 'FALSE']));
  sh.getRange(3, 3).setNote('「買いたい/使ってみたい」系の反応 ÷ 総反応。可愛い等の虚栄反応は除外。');
}

// ③広告シグナル
function _kzAd(ss) {
  const cols = [['word_id', 120], ['creative_id', 110], ['CTR%', 70], ['CVR%', 70], ['ROAS', 70], ['勝ちデモグラ', 160], ['デモグラ明確度', 100], ['配信額', 100]];
  const rows = [
    ['w001', 'cr-001a', '2.1%', '1.8%', '2.3', '30代/女性/敏感肌', '0.9', 200000],
    ['w003', 'cr-003a', '0.6%', '0.3%', '0.5', '—', '0.2', 120000],
  ];
  const sh = _kzSheet(ss, 3, '広告シグナル', '#EA580C', cols, rows);
  ['C', 'D'].forEach((_, i) => sh.getRange(4, 3 + i, 60, 1).setNumberFormat('0.0%'));
  sh.getRange(4, 8, 60, 1).setNumberFormat('#,##0');
  sh.getRange(3, 7).setNote('刺さる層が立っているか 0..1。後工程のインフル選定精度に直結。');
}

// ④コラボ実績
function _kzCollab(ss) {
  const cols = [['word_id', 120], ['influencer_id', 130], ['適合スコア', 90], ['実売数', 80], ['ROAS', 70]];
  const rows = [['w001', 'inf-SACHI', 87, 320, '2.3']];
  const sh = _kzSheet(ss, 4, 'コラボ実績', '#7C3AED', cols, rows);
  sh.getRange(4, 4, 60, 1).setNumberFormat('#,##0');
  sh.getRange(3, 2).setNote('提案ログDB／実績タブの influencer_id と一致させる。');
}

// 記入ガイド
function _kzGuide(ss) {
  const C = { dark: '#1E2D40', blue: '#2E6DA4', white: '#FFFFFF' };
  const sh = ss.insertSheet('記入ガイド', 5);
  sh.setColumnWidth(1, 20); sh.setColumnWidth(2, 720);
  sh.setRowHeight(2, 40);
  sh.getRange(2, 2).setValue('📋 気づきワード台帳 記入ガイド').setBackground(C.dark).setFontColor(C.white)
    .setFontSize(13).setFontWeight('bold').setVerticalAlignment('middle');
  const secs = [
    ['【このシートの目的】',
      '勉強会・Pamun・広告・インフルの4モジュールを word_id で串刺しし、訴求ワードを実データでスコア化する連携の背骨。\n' +
      'モジュール単体販売でも各シグナルは独立して追記できる。通すほど同じワードに証拠が積み増しされる。'],
    ['【記入のタイミング】',
      '① 勉強会後：気づきワード台帳に word_id を発番し、勉強会シグナルへ言及を記入（確度=暫定）\n' +
      '② Pamunモニター後：モニターシグナルに購買意向共感率を記入（確度=レビュー反映）\n' +
      '③ 広告運用後：広告シグナルにCTR/CVR/ROAS・勝ちデモグラを記入（確度=広告確定）\n' +
      '④ コラボ後：コラボ実績に適合・実売・ROASを記入'],
    ['【訴求スコアの考え方】',
      '実データ（広告CTR/CVR）を最重視。言及が多くても購買につながらなければ低い（虚栄控除）。\n' +
      '配点：勉強会15／Pamun25／広告40／デモグラ明確度10／インフル10／虚栄控除-20〜0。\n' +
      '計算は lib/kizuki/score.js が単一の正。Phase1は手入力、Phase2でコックピットが自動反映。'],
    ['【既存DBとの接続】',
      '案件ID で案件DB、word_id×influencer_id で提案ログDB／実績タブに接続。\n' +
      '勝ち訴求・勝ちデモグラはモジュールCで診断ツールの M01／M02／M04 の入力に流す。'],
  ];
  let r = 4;
  secs.forEach(([t, b]) => {
    sh.setRowHeight(r, 26);
    sh.getRange(r, 2).setValue(t).setBackground(C.blue).setFontColor(C.white).setFontSize(10).setFontWeight('bold').setVerticalAlignment('middle');
    r++;
    sh.setRowHeight(r, b.split('\n').length * 19 + 12);
    sh.getRange(r, 2).setValue(b).setFontSize(9).setWrap(true).setVerticalAlignment('top').setBackground('#F8F9FA');
    r += 2;
  });
}
```

- [ ] **Step 2: 構文チェック（ローカル）**

Run: `node --check CG_気づきワード台帳.gs`
Expected: エラー無し（SpreadsheetApp 等は実行しないので構文のみ検証される）

- [ ] **Step 3: コミット**

```bash
git add CG_気づきワード台帳.gs
git commit -m "feat(kizuki): 気づきワード台帳GAS生成器（台帳＋4シグナル＋ガイド）を追加"
```

- [ ] **Step 4: Apps Script エディタで実行検証（手動）**

1. 新規スプレッドシート →「拡張機能」→「Apps Script」に `CG_気づきワード台帳.gs` を貼付
2. `buildKizukiLedger` を実行
3. 確認：6シート（気づきワード台帳／勉強会・モニター・広告シグナル／コラボ実績／記入ガイド）が生成され、台帳にサンプル3行（87◎/64○/28×）、各シグナルに word_id 紐付きサンプルが入っていること。ドロップダウン・注記が効いていること
4. `addKizukiLedger` を実行 → 「すでに存在します。」が出ること（既存を壊さない）

Expected: 上記すべて確認できる。崩れがあれば該当 `_kz*` 関数を修正して再コミット。

---

## Self-Review（この計画の点検結果）

- **Spec coverage:** データモデル（5テーブル）→ Task 6（台帳＋4シグナル）✓／訴求スコア計算ロジック → Task 1-5（lib/kizuki/score.js）✓／確度ステージ・虚栄控除・過学習防止の「未確定は credited しない」方針 → Task 3-5 ✓／既存資産への接続（案件ID・influencer_id）→ Task 6 の注記とガイド ✓／パッケージ構成・KPI・Phase2/3 → 本計画スコープ外（仕様書に記載、別計画）。
- **Placeholder scan:** TODO/TBD なし。全コードステップに実コードあり。
- **Type consistency:** `computeAppealScore` の戻り値 `{score, grade, stage, breakdown}` は Task 4 で定義し Task 5 で同名参照。サブスコア関数名（workshopScore/reviewScore/adScore/demoScore/collabScore/vanityPenalty）は定義と参照が一致。GAS は `_kzSheet` ヘルパー＋各 `_kz*` で命名一貫。
- **注意点:** Task 5 の受け入れテストは閾値（>=80 / <40）で検証し、例の点数（87/28）には固定しない。配点調整時に過剰に壊れないため。GAS のサンプル点数（87/64/28）は表示用の静的値で、エンジンの出力とは独立（Phase2 で自動反映に置換）。
