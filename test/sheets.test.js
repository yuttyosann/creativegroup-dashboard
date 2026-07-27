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
