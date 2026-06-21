'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { findRowNumber } = require('../lib/sheets');

const ROWS = [
  ['case_id', 'brand_id'],     // header (row 1)
  ['C-0001', 'B-0001'],        // row 2
  ['C-0002', 'B-0002'],        // row 3
];

test('IDから1始まりの行番号を返す（ヘッダーはスキップ）', () => {
  assert.strictEqual(findRowNumber(ROWS, 0, 'C-0002'), 3);
  assert.strictEqual(findRowNumber(ROWS, 0, 'C-0001'), 2);
});

test('見つからなければ-1', () => {
  assert.strictEqual(findRowNumber(ROWS, 0, 'C-9999'), -1);
});
