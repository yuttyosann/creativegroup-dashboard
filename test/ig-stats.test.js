'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { median, percentile, pearson, spearman } = require('../lib/ig-stats');

test('median: 奇数個は中央値、偶数個は平均', () => {
  assert.strictEqual(median([3, 1, 2]), 2);
  assert.strictEqual(median([1, 2, 3, 4]), 2.5);
});

test('median: 空配列は null', () => {
  assert.strictEqual(median([]), null);
});

test('percentile: 25/75パーセンタイル（線形補間）', () => {
  // [1..5] の p25=2, p75=4（線形補間）
  assert.strictEqual(percentile([1, 2, 3, 4, 5], 25), 2);
  assert.strictEqual(percentile([1, 2, 3, 4, 5], 75), 4);
});

test('pearson: 完全な正の相関は1', () => {
  const r = pearson([1, 2, 3, 4], [2, 4, 6, 8]);
  assert.ok(Math.abs(r - 1) < 1e-9);
});

test('pearson: 完全な負の相関は-1', () => {
  const r = pearson([1, 2, 3, 4], [8, 6, 4, 2]);
  assert.ok(Math.abs(r + 1) < 1e-9);
});

test('spearman: 単調増加なら1（非線形でも）', () => {
  const r = spearman([1, 2, 3, 4], [1, 4, 9, 16]);
  assert.ok(Math.abs(r - 1) < 1e-9);
});

test('相関: n<2 や分散0は null', () => {
  assert.strictEqual(pearson([1], [1]), null);
  assert.strictEqual(pearson([1, 1, 1], [2, 3, 4]), null);
});
