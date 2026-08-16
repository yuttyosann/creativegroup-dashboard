'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const {
  detectFreeTextColumns, detectAwarenessColumn, isBrandUnaware,
  buildUnawareSet, majorityUnaware, buildWorkshopSignalRows,
} = require('../../lib/kizuki/workshop-ingest');

const POST_HEADER = [
  'タイムスタンプ', 'メールアドレス', '氏名（漢字表記）', 'ご年齢',
  '【最も印象が変わった点】  今回の勉強会を通じて…',
  '【説明後に初めて理解できたこと】  今回の勉強会を通じて…',
  '【印象に残った言葉】  説明やスライド、ブランド担当者からの言葉…',
  '【使いたい部位・場面】  先行体験された「シカリップ」…',
  '【レスキュー vs お守り】  アベンヌが提案する…',
  '【購入意向】  今後ご自身で（自費で）購入して使い続けたいと思いますか？',
  '【推奨意向】  ご家族やご友人におすすめしたいと思いますか？',
];

const PRE_HEADER = [
  'タイムスタンプ', 'メールアドレス', '氏名（漢字表記）', 'ご年齢',
  'アベンヌブランドおよびシカ商品の認知について  応募前からどの程度ご存知だったか教えてください。',
  'アベンヌの「シカクリーム」に対するこれまでのイメージを教えてください。',
];

test('detectFreeTextColumns: 気づきワードの源泉になる自由記述4問だけを拾う', () => {
  assert.deepStrictEqual(detectFreeTextColumns(POST_HEADER), [
    { index: 4, label: '最も印象が変わった点' },
    { index: 5, label: '説明後に初めて理解できたこと' },
    { index: 6, label: '印象に残った言葉' },
    { index: 7, label: '使いたい部位・場面' },
  ]);
});

test('detectFreeTextColumns: 意向・選択式の設問は源泉に含めない', () => {
  const labels = detectFreeTextColumns(POST_HEADER).map((c) => c.label);
  assert.ok(!labels.some((l) => l.includes('購入意向')));
  assert.ok(!labels.some((l) => l.includes('推奨意向')));
  assert.ok(!labels.some((l) => l.includes('レスキュー')));
});

test('detectFreeTextColumns: 該当が無ければ空配列', () => {
  assert.deepStrictEqual(detectFreeTextColumns(['タイムスタンプ', 'メールアドレス']), []);
  assert.deepStrictEqual(detectFreeTextColumns(undefined), []);
});

test('detectAwarenessColumn: 事前アンケートの認知度列を見つける', () => {
  assert.strictEqual(detectAwarenessColumn(PRE_HEADER), 4);
});

test('detectAwarenessColumn: 見つからなければ null', () => {
  assert.strictEqual(detectAwarenessColumn(['タイムスタンプ', 'メールアドレス']), null);
  assert.strictEqual(detectAwarenessColumn(undefined), null);
});

test('isBrandUnaware: 「知らなかった」「初めて」系は未認知', () => {
  assert.strictEqual(isBrandUnaware('まったく知らなかった'), true);
  assert.strictEqual(isBrandUnaware('今回初めて知った'), true);
  assert.strictEqual(isBrandUnaware('名前も聞いたことがない'), true);
});

test('isBrandUnaware: 認知している回答は false', () => {
  assert.strictEqual(isBrandUnaware('よく知っていた'), false);
  assert.strictEqual(isBrandUnaware('使ったことがある'), false);
  assert.strictEqual(isBrandUnaware(''), false);
  assert.strictEqual(isBrandUnaware(null), false);
});

test('buildUnawareSet: メールアドレスをキーに未認知の参加者を集める', () => {
  const rows = [
    PRE_HEADER,
    ['t', 'A@Example.com ', '山田', 30, 'まったく知らなかった', ''],
    ['t', 'b@example.com', '佐藤', 41, 'よく知っていた', ''],
  ];
  const set = buildUnawareSet(rows);
  assert.ok(set.has('a@example.com'), 'メールは小文字・trim して突合する');
  assert.ok(!set.has('b@example.com'));
});

test('buildUnawareSet: 認知度列が無ければ空集合（事前アンケート未実施）', () => {
  assert.strictEqual(buildUnawareSet([['タイムスタンプ', 'メールアドレス'], ['t', 'a@x']]).size, 0);
  assert.strictEqual(buildUnawareSet([]).size, 0);
  assert.strictEqual(buildUnawareSet(undefined).size, 0);
});

test('majorityUnaware: 過半が未認知なら true。ちょうど半分は false', () => {
  const unaware = new Set(['a@x', 'b@x']);
  assert.strictEqual(majorityUnaware(['a@x', 'b@x', 'c@x'], unaware), true);  // 3人中2人
  assert.strictEqual(majorityUnaware(['a@x', 'c@x'], unaware), false);        // 2人中1人＝同数
  assert.strictEqual(majorityUnaware(['a@x'], unaware), true);                // 1人中1人
  assert.strictEqual(majorityUnaware(['c@x', 'd@x'], unaware), false);
});

test('majorityUnaware: 言及者0人・集合が空なら false', () => {
  assert.strictEqual(majorityUnaware([], new Set(['a@x'])), false);
  assert.strictEqual(majorityUnaware(['a@x'], new Set()), false);
});

test('buildWorkshopSignalRows: ワード単位1行。言及数は言及者数', () => {
  const words = [
    { wordId: 'w001', quote: '肌が生き返る感じ', mentionedBy: ['a@x', 'b@x', 'c@x'] },
    { wordId: 'w002', quote: 'お守りとして持ち歩ける', mentionedBy: ['c@x'] },
  ];
  const rows = buildWorkshopSignalRows(words, new Set(['a@x', 'b@x']));
  // [word_id, 参加者ID(匿名), 発言抜粋, 言及数, アンケ評価, ブランド未認知]
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0][0], 'w001');
  assert.strictEqual(rows[0][3], 3);
  assert.strictEqual(rows[0][5], 'TRUE');   // 3人中2人が未認知
  assert.strictEqual(rows[1][3], 1);
  assert.strictEqual(rows[1][5], 'FALSE');  // c@x は認知済み
});

test('buildWorkshopSignalRows: 参加者IDは匿名化する（メールをそのまま書かない）', () => {
  const rows = buildWorkshopSignalRows(
    [{ wordId: 'w001', quote: 'q', mentionedBy: ['taro@example.com'] }], new Set());
  assert.ok(!rows[0][1].includes('@'), 'メールアドレスが漏れている');
  assert.ok(rows[0][1].length > 0, '参加者IDが空');
});

test('buildWorkshopSignalRows: アンケ評価は空（採点に使われず意味が定まっていない）', () => {
  const rows = buildWorkshopSignalRows(
    [{ wordId: 'w001', quote: 'q', mentionedBy: ['a@x'] }], new Set());
  assert.strictEqual(rows[0][4], '');
});
