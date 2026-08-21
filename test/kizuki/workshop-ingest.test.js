'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const {
  detectFreeTextColumns, detectAwarenessColumn, isFormResponse,
  parseAwarenessRows, buildUnawareSets, majorityUnaware, buildWorkshopSignalRows,
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

test('isFormResponse: 実際のフォーム回答はA列にタイムスタンプを持つ', () => {
  assert.strictEqual(isFormResponse(['2026/08/22 10:03:11', 'a@x', '山田']), true);
  assert.strictEqual(isFormResponse(['2026-08-22 10:03', 'a@x']), true);
});

test('isFormResponse: 人が下に作った集計行はタイムスタンプが無いので除外する', () => {
  // 実データ: 回答シートの52行目以降に「アンケート未回答」等の管理メモが並んでいた
  assert.strictEqual(isFormResponse(['', 'a@example.com', '村田', 'アンケート未回答']), false);
  assert.strictEqual(isFormResponse(['合計', '35']), false);
  assert.strictEqual(isFormResponse([]), false);
  assert.strictEqual(isFormResponse(null), false);
});

test('parseAwarenessRows: 回答行だけを取り、集計行は落とす', () => {
  const rows = [
    PRE_HEADER,
    ['2026/08/10 9:00', 'a@Example.com ', '山田', 30, 'アベンヌは知っていたがシカは知らなかった', ''],
    ['2026/08/10 9:05', 'b@example.com', '佐藤', 41, '昔から愛用しています', ''],
    ['', 'c@example.com', '集計メモ', '', 'アンケート未回答', ''],
  ];
  assert.deepStrictEqual(parseAwarenessRows(rows), [
    { email: 'a@example.com', text: 'アベンヌは知っていたがシカは知らなかった' },
    { email: 'b@example.com', text: '昔から愛用しています' },
  ]);
});

test('parseAwarenessRows: 認知度列が無ければ空配列', () => {
  assert.deepStrictEqual(parseAwarenessRows([['タイムスタンプ', 'メールアドレス'], ['2026/08/10', 'a@x']]), []);
  assert.deepStrictEqual(parseAwarenessRows([]), []);
  assert.deepStrictEqual(parseAwarenessRows(undefined), []);
});

test('buildUnawareSets: ブランド未認知と商品未認知を別々の集合にする', () => {
  const sets = buildUnawareSets([
    { email: 'a@x', brandUnaware: true, productUnaware: true },
    { email: 'B@X ', brandUnaware: false, productUnaware: true },
    { email: 'c@x', brandUnaware: false, productUnaware: false },
  ]);
  assert.deepStrictEqual([...sets.brand], ['a@x']);
  assert.deepStrictEqual([...sets.product].sort(), ['a@x', 'b@x']);
});

test('buildUnawareSets: either はブランド・商品どちらかが未認知なら含む（シグナルで使う集合）', () => {
  // アベンヌ自体は有名なのでブランド未認知はごく少数。CICAラインを知らない層も
  // 新規獲得の対象とみなすため、どちらか一方でも未認知なら未認知として扱う。
  const sets = buildUnawareSets([
    { email: 'a@x', brandUnaware: true, productUnaware: false },
    { email: 'b@x', brandUnaware: false, productUnaware: true },
    { email: 'c@x', brandUnaware: false, productUnaware: false },
  ]);
  assert.deepStrictEqual([...sets.either].sort(), ['a@x', 'b@x']);
});

test('buildUnawareSets: 空・不正な入力でも落ちない', () => {
  const sets = buildUnawareSets(undefined);
  assert.strictEqual(sets.brand.size, 0);
  assert.strictEqual(sets.product.size, 0);
  assert.strictEqual(sets.either.size, 0);
  assert.strictEqual(buildUnawareSets([{ brandUnaware: true }]).brand.size, 0); // メール無しは無視
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
