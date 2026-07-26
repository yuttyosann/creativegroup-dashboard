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
