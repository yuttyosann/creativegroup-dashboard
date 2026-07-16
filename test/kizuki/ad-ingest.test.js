'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { pctStr, ratioStr, buildAdSignalRow, buildAdSignalRows } = require('../../lib/kizuki/ad-ingest');
const { parseAdRow } = require('../../lib/kizuki/ledger-store');

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

test('buildAdSignalRow: Phase2広告シグナル列順で行を生成（デモグラ明確度は空）', () => {
  const row = buildAdSignalRow(
    { creative_id: 'cr-1', impressions: 1000, clicks: 21, conversions: 18, cost: 200000, revenue: 460000, demographics: '30代/女性' },
    'w1');
  assert.deepStrictEqual(row, ['w1', 'cr-1', '2.1%', '85.7%', '2.3', '30代/女性', '', 200000]);
});

test('buildAdSignalRow: imp0/clicks0でCTR/CVR/ROASは空・配信額(cost)0は0のまま保持', () => {
  const row = buildAdSignalRow(
    { creative_id: 'cr-2', impressions: 0, clicks: 0, conversions: 0, cost: 0, revenue: 0, demographics: '' },
    'w2');
  assert.deepStrictEqual(row, ['w2', 'cr-2', '', '', '', '', '', 0]);
});

test('buildAdSignalRows: マッピングでword_idを付与・未マッピングはskip', () => {
  const bqRows = [
    { creative_id: 'cr-1', impressions: 1000, clicks: 21, conversions: 18, cost: 200000, revenue: 460000, demographics: '30代/女性' },
    { creative_id: 'cr-x', impressions: 500, clicks: 3, conversions: 0, cost: 10000, revenue: 0, demographics: '' }, // 未マッピング
  ];
  const mapping = [{ creative_id: 'cr-1', word_id: 'w1' }];
  const rows = buildAdSignalRows(bqRows, mapping);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0][0], 'w1');
  assert.strictEqual(rows[0][1], 'cr-1');
});

test('buildAdSignalRows: 出力行は ledger-store.parseAdRow で正しい単位に戻る（結合検証）', () => {
  const rows = buildAdSignalRows(
    [{ creative_id: 'cr-1', impressions: 1000, clicks: 21, conversions: 18, cost: 200000, revenue: 460000, demographics: '30代/女性' }],
    [{ creative_id: 'cr-1', word_id: 'w1' }]);
  const parsed = parseAdRow(rows[0]);
  assert.strictEqual(parsed.wordId, 'w1');
  assert.ok(Math.abs(parsed.ctr - 2.1) < 1e-9);   // "2.1%"→2.1
  assert.ok(Math.abs(parsed.roas - 2.3) < 1e-9);
  assert.strictEqual(parsed.demographics, '30代/女性');
});

test('buildAdSignalRows: 空入力は空配列', () => {
  assert.deepStrictEqual(buildAdSignalRows([], []), []);
  assert.deepStrictEqual(buildAdSignalRows(undefined, undefined), []);
});
