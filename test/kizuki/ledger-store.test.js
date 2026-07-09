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
