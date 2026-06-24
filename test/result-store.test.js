'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const rst = require('../lib/result-store');

const NOW = new Date('2026-06-24T00:00:00Z');

test('computeResult: 既存式（総コスト=費+売上×報酬率, ROAS=売上/総コスト×100, 損益=売上-総コスト）', () => {
  const c = rst.computeResult({ sales: 8586717, fee: 2000000, rewardRate: 20 });
  const totalCost = 2000000 + 8586717 * 0.2;
  assert.strictEqual(c.totalCost, totalCost);
  assert.strictEqual(c.roas, Math.round(8586717 / totalCost * 100));
  assert.strictEqual(c.profit, 8586717 - totalCost);
});

test('computeResult: 総コスト0ならROAS0（ゼロ除算回避）', () => {
  const c = rst.computeResult({ sales: 0, fee: 0, rewardRate: 0 });
  assert.strictEqual(c.totalCost, 0);
  assert.strictEqual(c.roas, 0);
  assert.strictEqual(c.profit, 0);
});

test('computeResult: カンマ/空文字は数値化', () => {
  const c = rst.computeResult({ sales: '1,000', fee: '500', rewardRate: '' });
  assert.strictEqual(c.totalCost, 500);
  assert.strictEqual(c.roas, 200);
  assert.strictEqual(c.profit, 500);
});

test('buildSummaryLine: profit≥0で黒字・<0で赤字', () => {
  assert.strictEqual(rst.buildSummaryLine('6月メガ割', 231, 100), '6月メガ割 ROAS231% 黒字');
  assert.strictEqual(rst.buildSummaryLine('6月メガ割', 80, -50), '6月メガ割 ROAS80% 赤字');
  assert.strictEqual(rst.buildSummaryLine('', 120, 10), 'ROAS120% 黒字');
});

test('mergeSummaryLine: 新規追記・同一案件IDは置換・他案件は保持', () => {
  assert.strictEqual(rst.mergeSummaryLine('', 'C-0001', 'ROAS231% 黒字'), 'C-0001 ROAS231% 黒字');
  const merged = rst.mergeSummaryLine('C-0001 古い\nC-0002 維持', 'C-0001', '6月メガ割 ROAS50% 赤字');
  assert.strictEqual(merged, 'C-0002 維持\nC-0001 6月メガ割 ROAS50% 赤字');
});

test('validateResult: case_id/account 必須', () => {
  assert.throws(() => rst.validateResult({ account: 'a' }), /案件ID/);
  assert.throws(() => rst.validateResult({ case_id: 'C-0001' }), /アカウント名/);
  assert.doesNotThrow(() => rst.validateResult({ case_id: 'C-0001', account: 'a' }));
});

test('toResultRow↔parseResult 往復（計算列含む）', () => {
  const row = rst.toResultRow({ case_id: 'C-0001', account: 'sachi', media: 'YouTube', sales: 1000, fee: 500, rewardRate: 0 }, 'R-0001', NOW);
  const o = rst.parseResult(row);
  assert.strictEqual(o.result_id, 'R-0001');
  assert.strictEqual(o.case_id, 'C-0001');
  assert.strictEqual(o.account, 'sachi');
  assert.strictEqual(String(o.roas), '200');
  assert.strictEqual(o.updated, '2026-06-24');
});
