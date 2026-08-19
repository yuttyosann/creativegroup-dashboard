'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert');

let needsProductResolution, planResolution, BRAND_CAP;
before(async () => {
  ({ needsProductResolution, planResolution, BRAND_CAP } =
    await import('../award-signal-tool/lib/products.js'));
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

const BRANDS = [
  { name: 'キャンメイク', category: 'コスメ' },
  { name: '江ノ島', category: 'おでかけ・スポット' },
  { name: 'ケラスターゼ', category: 'ヘアケア' },
  { name: '鬼滅の刃', category: 'エンタメ・コンテンツ' },
];

test('非商品系カテゴリは skipped に入り、run には入らない', () => {
  const { run, skipped } = planResolution(BRANDS, 10);
  assert.deepEqual(run.map(r => r.name), ['キャンメイク', 'ケラスターゼ']);
  assert.deepEqual(skipped.map(s => s.brand).sort(), ['江ノ島', '鬼滅の刃'].sort());
  assert.ok(skipped.every(s => s.why));
});

test('cap を超えた分は deferred に入り、消えない', () => {
  const many = Array.from({ length: 13 }, (_, i) => ({ name: `ブランド${i + 1}`, category: 'コスメ' }));
  const { run, deferred } = planResolution(many, 10);
  assert.equal(run.length, 10);
  assert.equal(deferred.length, 3);
  // run と deferred を合わせると入力を漏れなく網羅する
  assert.deepEqual([...run, ...deferred].map(x => x.name), many.map(x => x.name));
});

test('# と前後空白を正規化し、空名は捨てる', () => {
  const { run } = planResolution(
    [{ name: '#fwee', category: 'コスメ' }, { name: '  ', category: 'コスメ' }, { name: ' ロムアンド ', category: 'コスメ' }],
    10);
  assert.deepEqual(run.map(r => r.name), ['fwee', 'ロムアンド']);
});

test('同じブランドが重複しても1回だけ', () => {
  const { run } = planResolution(
    [{ name: 'fwee', category: 'コスメ' }, { name: '#fwee', category: 'コスメ' }], 10);
  assert.equal(run.length, 1);
});

test('空入力でも落ちない', () => {
  assert.deepEqual(planResolution([], 10), { run: [], skipped: [], deferred: [] });
  assert.deepEqual(planResolution(undefined, 10), { run: [], skipped: [], deferred: [] });
});

test('BRAND_CAP は 10（1ブランド約30秒 ≒ 5分の想定）', () => {
  assert.equal(BRAND_CAP, 10);
});
