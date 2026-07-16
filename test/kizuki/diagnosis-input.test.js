'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { buildDiagnosisInput } = require('../../lib/kizuki/diagnosis-input');

test('buildDiagnosisInput: 勝ち訴求・訴求軸・デモグラを productSummary/conditions に反映', () => {
  const out = buildDiagnosisInput({ word: '乾燥でゆらいだ日の駆け込み', axis: '使用シーン', demographics: '30代/女性/敏感肌' });
  assert.match(out.productSummary, /乾燥でゆらいだ日の駆け込み/);
  assert.match(out.productSummary, /使用シーン/);
  assert.match(out.conditions, /30代\/女性\/敏感肌/);
});

test('buildDiagnosisInput: デモグラ未確定でも文字列を返す（空でも壊れない）', () => {
  const out = buildDiagnosisInput({ word: 'x', axis: '効能', demographics: '' });
  assert.strictEqual(typeof out.productSummary, 'string');
  assert.strictEqual(typeof out.conditions, 'string');
  assert.match(out.conditions, /未確定|未取得/);
});
