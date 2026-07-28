'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert');

let selectSeeds;
before(async () => { ({ selectSeeds } = await import('../award-signal-tool/lib/discover.js')); });

// テスト用の入力（カテゴリ→タグ）
const CATS = [
  { category: 'コスメ', tags: ['新作コスメ', 'プチプラコスメ', '韓国コスメ'] },
  { category: 'スキンケア', tags: ['スキンケア', '毛穴ケア'] },
  { category: 'エンタメ', tags: ['推し活'] },
  { category: 'その他', tags: [] }, // タグ空
];

test('cap>=カテゴリ数のとき、タグを持つ全カテゴリが必ず1つ以上選ばれる', () => {
  const { selected } = selectSeeds(CATS, 14, 0);
  const cats = new Set(selected.map(s => s.category));
  assert.ok(cats.has('コスメ'));
  assert.ok(cats.has('スキンケア'));
  assert.ok(cats.has('エンタメ'));
  assert.equal(cats.has('その他'), false); // タグ空は除外
});

test('cap を超えない', () => {
  const { selected } = selectSeeds(CATS, 3, 0);
  assert.equal(selected.length, 3);
});

test('selected と deferred で全ユニークタグを漏れなく網羅する', () => {
  const { selected, deferred } = selectSeeds(CATS, 3, 0);
  const all = [...selected, ...deferred].map(x => x.tag).sort();
  assert.deepEqual(all, ['スキンケア', '推し活', '新作コスメ', '毛穴ケア', '韓国コスメ', 'プチプラコスメ'].sort());
});

test('カテゴリ内の重複タグと # は正規化・除去される', () => {
  const cats = [{ category: 'A', tags: ['#x', 'x', ' x ', 'y'] }];
  const { selected, deferred } = selectSeeds(cats, 10, 0);
  const tags = [...selected, ...deferred].map(x => x.tag);
  assert.deepEqual(tags.sort(), ['x', 'y']);
});

test('カテゴリ間で重複するタグは初出の1回だけ', () => {
  const cats = [
    { category: 'A', tags: ['shein'] },
    { category: 'B', tags: ['shein', 'temu'] },
  ];
  const { selected, deferred } = selectSeeds(cats, 10, 0);
  const all = [...selected, ...deferred].map(x => x.tag);
  assert.equal(all.filter(t => t === 'shein').length, 1);
});

test('rotation を変えると各カテゴリの先頭タグがずれる', () => {
  const r0 = selectSeeds(CATS, 3, 0).selected.find(s => s.category === 'コスメ').tag;
  const r1 = selectSeeds(CATS, 3, 1).selected.find(s => s.category === 'コスメ').tag;
  assert.notEqual(r0, r1); // 3タグあるので回転で先頭が変わる
});

test('同じ rotation なら結果は決定的', () => {
  const a = selectSeeds(CATS, 3, 5);
  const b = selectSeeds(CATS, 3, 5);
  assert.deepEqual(a, b);
});

test('空入力・cap 0 でも落ちない', () => {
  assert.deepEqual(selectSeeds([], 14, 0), { selected: [], deferred: [] });
  assert.deepEqual(selectSeeds(CATS, 0, 0).selected, []);
});

test('rotation が NaN/undefined でも全ユニークタグを網羅する（消失しない）', () => {
  for (const rot of [NaN, undefined]) {
    const { selected, deferred } = selectSeeds(CATS, 3, rot);
    const all = [...selected, ...deferred].map(x => x.tag).sort();
    assert.deepEqual(all, ['スキンケア', '推し活', '新作コスメ', '毛穴ケア', '韓国コスメ', 'プチプラコスメ'].sort());
  }
});

test('rotation が負値でも正しく正規化される（-1 ≡ 2 mod 3。+n 補正パスを踏む）', () => {
  // 注: CATS はカテゴリごとにタグ数が異なる（3/2/1）ため、-1 と 2 の等価性は
  // タグ数3のカテゴリでしか成り立たない。よってタグ数を揃えた単一カテゴリで検証する。
  // -1 % 3 は JS では -1（負の剰余）になるため、((rot % n) + n) % n の +n 補正が
  // 実際に効く非退化ケースになっている（-3 だと -0 になり補正の有無を検証できない）。
  const cats = [{ category: 'コスメ', tags: ['a', 'b', 'c'] }];
  const neg = selectSeeds(cats, 3, -1);
  const pos = selectSeeds(cats, 3, 2);
  assert.deepEqual(neg, pos);
});
