'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { nextId } = require('../lib/id-gen');

test('空配列なら -0001', () => {
  assert.strictEqual(nextId('B', []), 'B-0001');
});

test('既存の最大値+1（4桁ゼロ詰め）', () => {
  assert.strictEqual(nextId('B', ['B-0001', 'B-0003']), 'B-0004');
  assert.strictEqual(nextId('C', ['C-0009']), 'C-0010');
});

test('別prefixや壊れた値は無視する', () => {
  assert.strictEqual(nextId('B', ['C-0009', 'B-xx', '', null, 'B-0002']), 'B-0003');
});
