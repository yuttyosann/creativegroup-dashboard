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
