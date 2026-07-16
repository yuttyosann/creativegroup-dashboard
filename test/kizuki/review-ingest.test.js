'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { parseSurveyRows } = require('../../lib/kizuki/review-ingest');

test('parseSurveyRows: ヘッダーを飛ばし1行=1回答者にする（indexは0始まり）', () => {
  const rows = [
    ['ご年齢', '①商品の満足度を教えて下さい', '②商品の良かった点を教えてください',
     '③商品の改善点を教えてください', '④容器であったら嬉しい商品', '⑤一番気に入ったもの'],
    [39, '良い', 'MARSとVENUSは使い勝手が良くてよかったです！', 'JUPITERは出番が少ない', '日焼け止め', 'VENUS'],
    [22, '満足', 'キラキラ感が可愛かったところです。', '最初に少し蓋が開けにくかったです。', '日焼け止め', 'JUPITER'],
  ];
  assert.deepStrictEqual(parseSurveyRows(rows), [
    { index: 0, age: 39, satisfaction: '良い',
      goodPoints: 'MARSとVENUSは使い勝手が良くてよかったです！',
      improvements: 'JUPITERは出番が少ない', favorite: 'VENUS' },
    { index: 1, age: 22, satisfaction: '満足',
      goodPoints: 'キラキラ感が可愛かったところです。',
      improvements: '最初に少し蓋が開けにくかったです。', favorite: 'JUPITER' },
  ]);
});

test('parseSurveyRows: 空行はスキップ・欠損セルは空文字/null', () => {
  const rows = [
    ['ご年齢', '①', '②', '③', '④', '⑤'],
    ['', '', '', '', '', ''],
    [null, null, null, null, null, null],
    [35, '大変満足', 'しっとり感と煌めきが好みでした。'],
  ];
  assert.deepStrictEqual(parseSurveyRows(rows), [
    { index: 0, age: 35, satisfaction: '大変満足',
      goodPoints: 'しっとり感と煌めきが好みでした。', improvements: '', favorite: '' },
  ]);
});

test('parseSurveyRows: ヘッダーのみ・空・undefined は空配列（06レポート＝未回答の回帰）', () => {
  assert.deepStrictEqual(parseSurveyRows([['ご年齢', '①', '②', '③', '④', '⑤']]), []);
  assert.deepStrictEqual(parseSurveyRows([]), []);
  assert.deepStrictEqual(parseSurveyRows(undefined), []);
});
