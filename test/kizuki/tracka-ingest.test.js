'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { detectWordColumns, parseChoice, parseTrackAResponses } = require('../../lib/kizuki/tracka-ingest');
const { tallyTrackA } = require('../../lib/kizuki/review-ingest');

const HEADER = [
  'タイムスタンプ', 'メールアドレス', 'ご年齢',
  '「伸びが良くてスッと塗りやすい」について、あなたに一番近いものは？ [w001]',
  '「白浮きしないから顔にも使える」について、あなたに一番近いものは？ [w002]',
  '商品の感想を教えてください',
];

test('detectWordColumns: 見出し末尾の [wNNN] から列と word_id を取る', () => {
  assert.deepStrictEqual(detectWordColumns(HEADER), [
    { index: 3, wordId: 'w001' },
    { index: 4, wordId: 'w002' },
  ]);
});

test('detectWordColumns: word_id を持たない列は無視する（自由記述やタイムスタンプ）', () => {
  assert.deepStrictEqual(detectWordColumns(['タイムスタンプ', '商品の感想を教えてください']), []);
  assert.deepStrictEqual(detectWordColumns([]), []);
  assert.deepStrictEqual(detectWordColumns(undefined), []);
});

test('detectWordColumns: 同じ word_id が複数列にあれば先の列だけ採る', () => {
  assert.deepStrictEqual(detectWordColumns(['Q [w001]', 'Q再掲 [w001]']), [{ index: 0, wordId: 'w001' }]);
});

test('parseChoice: Googleフォームが返す選択肢の文言（全角丸数字）から数値を取る', () => {
  assert.strictEqual(parseChoice('① ピンとこない／当てはまらない'), 1);
  assert.strictEqual(parseChoice('② 共感する（でも購入の決め手ではない）'), 2);
  assert.strictEqual(parseChoice('③ 共感するし、これがあるから買いたい／使い続けたい'), 3);
});

test('parseChoice: 先頭が半角数字の表記も受ける', () => {
  assert.strictEqual(parseChoice('1. ピンとこない'), 1);
  assert.strictEqual(parseChoice('3'), 3);
  assert.strictEqual(parseChoice(3), 3);
});

test('parseChoice: 必ず number を返す（文字列のままだと tallyTrackA が全件0に潰れる）', () => {
  // tallyTrackA は a.choice !== 2 && a.choice !== 3 の厳密比較。'3' を渡すと例外なく0件になる。
  assert.strictEqual(typeof parseChoice('③ 共感するし、これがあるから買いたい'), 'number');
  assert.strictEqual(typeof parseChoice('3'), 'number');
});

test('parseChoice: 空・未回答・想定外の値は null', () => {
  assert.strictEqual(parseChoice(''), null);
  assert.strictEqual(parseChoice('   '), null);
  assert.strictEqual(parseChoice(null), null);
  assert.strictEqual(parseChoice(undefined), null);
  assert.strictEqual(parseChoice('④ その他'), null);
  assert.strictEqual(parseChoice('わからない'), null);
});

test('parseTrackAResponses: 1行=1回答者で [{wordId, choice}] を組み立てる', () => {
  const rows = [
    HEADER,
    ['2026/06/20 10:00', 'a@example.com', 30, '③ 共感するし、これがあるから買いたい', '① ピンとこない', '感想テキスト'],
    ['2026/06/20 10:05', 'b@example.com', 41, '② 共感する', '② 共感する', '感想テキスト'],
  ];
  assert.deepStrictEqual(parseTrackAResponses(rows), [
    [{ wordId: 'w001', choice: 3 }, { wordId: 'w002', choice: 1 }],
    [{ wordId: 'w001', choice: 2 }, { wordId: 'w002', choice: 2 }],
  ]);
});

test('parseTrackAResponses: 設問に1つも答えていない行は回答者に数えない（分母nの水増し防止）', () => {
  const rows = [
    HEADER,
    ['2026/06/20 10:00', 'a@example.com', 30, '③ 共感するし', '② 共感する', '感想'],
    ['', '', '', '', '', ''],            // 完全な空行
    ['', '', '', '', '', '自由記述だけ'],  // 自由記述はあるが3択は未回答
    ['', '', '名簿だけの人'],              // 名簿行
  ];
  assert.strictEqual(parseTrackAResponses(rows).length, 1);
});

test('parseTrackAResponses: 未回答の設問はその回答者の配列に載せない（分母には残る）', () => {
  const rows = [HEADER, ['2026/06/20 10:00', 'a@example.com', 30, '② 共感する', '', '感想']];
  assert.deepStrictEqual(parseTrackAResponses(rows), [[{ wordId: 'w001', choice: 2 }]]);
});

test('parseTrackAResponses: 設問列が無ければ空配列（Track A 未実施のアンケート）', () => {
  assert.deepStrictEqual(parseTrackAResponses([['タイムスタンプ', '商品の感想'], ['2026/06/20', 'よかった']]), []);
  assert.deepStrictEqual(parseTrackAResponses([]), []);
  assert.deepStrictEqual(parseTrackAResponses(undefined), []);
});

test('結合: parseTrackAResponses の出力が tallyTrackA でそのまま集計できる', () => {
  const rows = [
    HEADER,
    ['t', 'a@x', 30, '③ 買いたい', '① ピンとこない', ''],
    ['t', 'b@x', 41, '③ 買いたい', '② 共感する', ''],
    ['t', 'c@x', 25, '② 共感する', '② 共感する', ''],
  ];
  // w001: ②③が3人 → 件数3・意向2 ／ w002: ①は分母のみなので件数2・意向0
  assert.deepStrictEqual(tallyTrackA(parseTrackAResponses(rows)), {
    w001: { count: 3, intentCount: 2, confidences: [] },
    w002: { count: 2, intentCount: 0, confidences: [] },
  });
});
