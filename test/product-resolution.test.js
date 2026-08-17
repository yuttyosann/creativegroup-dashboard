'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert');

let needsProductResolution;
before(async () => {
  ({ needsProductResolution } = await import('../award-signal-tool/lib/products.js'));
});

test('商品系カテゴリは true（商品まで解決する）', () => {
  for (const c of ['コスメ', 'スキンケア', 'ヘアケア', 'ボディケア', 'フレグランス',
                   '食品・飲料', 'ライフスタイル雑貨', 'ファッション']) {
    assert.equal(needsProductResolution(c), true, `${c} は true のはず`);
  }
});

test('非商品系カテゴリは false（それ自体が受賞対象）', () => {
  for (const c of ['おでかけ・スポット', 'エンタメ・コンテンツ', 'その他']) {
    assert.equal(needsProductResolution(c), false, `${c} は false のはず`);
  }
});

test('未知カテゴリ・空・undefined は false（安全側に倒す）', () => {
  assert.equal(needsProductResolution('謎カテゴリ'), false);
  assert.equal(needsProductResolution(''), false);
  assert.equal(needsProductResolution(undefined), false);
  assert.equal(needsProductResolution(null), false);
});

test('前後の空白は無視する', () => {
  assert.equal(needsProductResolution('  コスメ  '), true);
});
