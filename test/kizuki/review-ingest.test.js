'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { parseSurveyRows, tallyTrackA } = require('../../lib/kizuki/review-ingest');

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

test('parseSurveyRows: 空白だけの行はスキップ（分母nを水増しさせない）', () => {
  const rows = [
    ['ご年齢', '①', '②', '③', '④', '⑤'],
    ['  ', '', '', '', '', ''],
    ['\t', null, '', '', '', ''],
    [22, '満足', 'キラキラ感が可愛かったところです。', '', '', 'JUPITER'],
  ];
  const out = parseSurveyRows(rows);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].index, 0);
  assert.strictEqual(out[0].age, 22);
});

test('parseSurveyRows: 0は有意な値なのでスキップしない', () => {
  const rows = [['ご年齢', '①', '②', '③', '④', '⑤'], [0, '', '', '', '', '']];
  assert.strictEqual(parseSurveyRows(rows).length, 1);
});

test('parseSurveyRows: ヘッダーのみ・空・undefined は空配列（06レポート＝未回答の回帰）', () => {
  assert.deepStrictEqual(parseSurveyRows([['ご年齢', '①', '②', '③', '④', '⑤']]), []);
  assert.deepStrictEqual(parseSurveyRows([]), []);
  assert.deepStrictEqual(parseSurveyRows(undefined), []);
});

test('tallyTrackA: 件数は②③・意向は③のみ（①は分母のみで両方に数えない）', () => {
  const respondents = [
    [{ wordId: 'w1', choice: 3 }, { wordId: 'w2', choice: 1 }],
    [{ wordId: 'w1', choice: 2 }, { wordId: 'w2', choice: 3 }],
    [{ wordId: 'w1', choice: 1 }, { wordId: 'w2', choice: 3 }],
  ];
  assert.deepStrictEqual(tallyTrackA(respondents), {
    w1: { count: 2, intentCount: 1, confidences: [] }, // ③1 + ②1 = 件数2 / 意向1
    w2: { count: 2, intentCount: 2, confidences: [] }, // ③2 = 件数2 / 意向2（①1は分母のみ）
  });
});

test('tallyTrackA: 同一回答者が同じwordIdを重複回答しても1回として数える', () => {
  const respondents = [[{ wordId: 'w1', choice: 3 }, { wordId: 'w1', choice: 3 }]];
  assert.deepStrictEqual(tallyTrackA(respondents), {
    w1: { count: 1, intentCount: 1, confidences: [] },
  });
});

test('tallyTrackA: 同一回答者の重複回答は最初の回答が勝つ（①が先なら③は無視）', () => {
  assert.deepStrictEqual(tallyTrackA([[{ wordId: 'w1', choice: 1 }, { wordId: 'w1', choice: 3 }]]), {});
  assert.deepStrictEqual(tallyTrackA([[{ wordId: 'w1', choice: 3 }, { wordId: 'w1', choice: 1 }]]), {
    w1: { count: 1, intentCount: 1, confidences: [] },
  });
});

test('tallyTrackA: 空・不正な回答は無視', () => {
  assert.deepStrictEqual(tallyTrackA([]), {});
  assert.deepStrictEqual(tallyTrackA(undefined), {});
  assert.deepStrictEqual(tallyTrackA([[null, { choice: 3 }, { wordId: '', choice: 3 }]]), {});
});
