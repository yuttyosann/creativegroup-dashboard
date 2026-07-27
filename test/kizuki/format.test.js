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
