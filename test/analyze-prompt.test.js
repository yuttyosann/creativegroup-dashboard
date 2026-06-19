'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { buildAnalyzePrompt } = require('../lib/analyze-prompt');

test('product: 商品名と提供情報が user プロンプトに差し込まれる', () => {
  const { system, user } = buildAnalyzePrompt('product', {
    productName: 'ABCトーンアップ美容液',
    info: '公式説明とECレビュー抜粋',
  });
  assert.ok(system.length > 0, 'systemが空でない');
  assert.match(user, /ABCトーンアップ美容液/);
  assert.match(user, /公式説明とECレビュー抜粋/);
  assert.match(user, /需要タイプ/);
});

test('diagnose: 商品/インフル/条件が差し込まれ、条件未指定は既定文言', () => {
  const { user } = buildAnalyzePrompt('diagnose', {
    productSummary: 'カバー需要型・毛穴',
    influencerSummary: '購買意向コメント率高',
  });
  assert.match(user, /カバー需要型・毛穴/);
  assert.match(user, /購買意向コメント率高/);
  assert.match(user, /（記載なし）/);
  assert.match(user, /M02/);
});

test('unknown kind はエラー', () => {
  assert.throws(() => buildAnalyzePrompt('xxx', {}), /unknown kind/);
});

test('必須項目欠落は項目名つきでエラー', () => {
  assert.throws(() => buildAnalyzePrompt('product', { productName: 'x' }), /info/);
  assert.throws(() => buildAnalyzePrompt('diagnose', { productSummary: 'x' }), /influencerSummary/);
});

test('diagnose: 施策条件を指定するとプロンプトに反映される', () => {
  const { user } = buildAnalyzePrompt('diagnose', {
    productSummary: 'A',
    influencerSummary: 'B',
    conditions: 'タイアップ費30万・成果報酬10%',
  });
  assert.match(user, /タイアップ費30万・成果報酬10%/);
});
