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
