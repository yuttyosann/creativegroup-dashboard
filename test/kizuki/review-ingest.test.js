'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const {
  parseSurveyRows, tallyTrackA, tallyTrackB, buildReviewSignalRows, signalKey, SOURCES,
  realignByIndex,
} = require('../../lib/kizuki/review-ingest');

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

test('tallyTrackB: 件数は言及者数・意向はintent かつ vanityでない ものだけ', () => {
  const respondents = [
    [{ wordId: 'w1', intent: true, vanity: false, confidence: 0.9 }],
    [{ wordId: 'w1', intent: false, vanity: false, confidence: 0.8 }],
    [{ wordId: 'w1', intent: true, vanity: true, confidence: 0.7 }], // 虚栄反応→意向に数えない
  ];
  assert.deepStrictEqual(tallyTrackB(respondents), {
    w1: { count: 3, intentCount: 1, confidences: [0.9, 0.8, 0.7] },
  });
});

test('tallyTrackB: 該当なし（空配列）の回答者は分母には残るがtallyには載らない', () => {
  const respondents = [
    [{ wordId: 'w1', intent: true, vanity: false, confidence: 0.9 }],
    [], // 候補ワードに該当なし
  ];
  assert.deepStrictEqual(tallyTrackB(respondents), {
    w1: { count: 1, intentCount: 1, confidences: [0.9] },
  });
});

test('tallyTrackB: 同一回答者の同一wordId重複は1件・confidenceは有限値のみ収集', () => {
  const respondents = [[
    { wordId: 'w1', intent: true, vanity: false, confidence: 0.9 },
    { wordId: 'w1', intent: false, vanity: false, confidence: 0.1 },
    { wordId: 'w2', intent: true, vanity: false, confidence: null },
  ]];
  assert.deepStrictEqual(tallyTrackB(respondents), {
    w1: { count: 1, intentCount: 1, confidences: [0.9] },
    w2: { count: 1, intentCount: 1, confidences: [] },
  });
});

test('tallyTrackB: confidence=0 は残す（要レビューの最強シグナル）・null/undefined/NaNだけ落とす', () => {
  const respondents = [[
    { wordId: 'w1', intent: true, vanity: false, confidence: 0 },
    { wordId: 'w2', intent: true, vanity: false, confidence: undefined },
    { wordId: 'w3', intent: true, vanity: false, confidence: NaN },
  ]];
  assert.deepStrictEqual(tallyTrackB(respondents), {
    w1: { count: 1, intentCount: 1, confidences: [0] }, // 0は有意な最低スコアなので平均に効かせる
    w2: { count: 1, intentCount: 1, confidences: [] },
    w3: { count: 1, intentCount: 1, confidences: [] },
  });
});

test('buildReviewSignalRows: 共感率は意向÷n（言及なしも分母に残る＝普及率）', () => {
  // 回答者n=50、w1に共感したのは20人だが「買いたい」は17人 → 17/50 = 34%
  const tally = { w1: { count: 20, intentCount: 17, confidences: [] } };
  const rows = buildReviewSignalRows(tally, { n: 50, campaignId: '2026_04_stardust', source: SOURCES.TRACK_A });
  assert.deepStrictEqual(rows, [
    ['w1', 20, '34%', '', '', 'trackA', '2026_04_stardust', ''],
  ]);
});

test('buildReviewSignalRows: レビュー件数は共感/言及者数であって意向数ではない', () => {
  const tally = { w1: { count: 20, intentCount: 17, confidences: [] } };
  const [row] = buildReviewSignalRows(tally, { n: 50, campaignId: 'c1', source: SOURCES.TRACK_A });
  assert.strictEqual(row[1], 20);   // 件数=共感者
  assert.strictEqual(row[2], '34%'); // 率=意向÷n
});

test('buildReviewSignalRows: 虚栄ワード（件数は多いが意向は低い）は件数高・共感率低で出る', () => {
  // 「パケが可愛い」型: 40人が共感したが買いたいは2人 → 2/50 = 4%
  const tally = { vanity1: { count: 40, intentCount: 2, confidences: [] } };
  const [row] = buildReviewSignalRows(tally, { n: 50, campaignId: 'c1', source: SOURCES.TRACK_A });
  assert.strictEqual(row[1], 40);
  assert.strictEqual(row[2], '4%');
});

test('buildReviewSignalRows: n=0 は率を空にする（0除算防止・ad-ingestのpctStrと同じ扱い）', () => {
  const tally = { w1: { count: 0, intentCount: 0, confidences: [] } };
  const rows = buildReviewSignalRows(tally, { n: 0, campaignId: 'c1', source: SOURCES.TRACK_B });
  assert.strictEqual(rows[0][2], '');
});

test('buildReviewSignalRows: trackBはconfidence平均(2桁)・trackA/manualは空', () => {
  const tally = { w1: { count: 2, intentCount: 1, confidences: [0.9, 0.8] } };
  const [b] = buildReviewSignalRows(tally, { n: 10, campaignId: 'c1', source: SOURCES.TRACK_B });
  assert.strictEqual(b[5], 'trackB');
  assert.strictEqual(b[7], 0.85);

  const [a] = buildReviewSignalRows(tally, { n: 10, campaignId: 'c1', source: SOURCES.TRACK_A });
  assert.strictEqual(a[7], '');
});

test('buildReviewSignalRows: confidence=0は平均に効く（空扱いにしない）', () => {
  const tally = { w1: { count: 2, intentCount: 1, confidences: [0, 0.5] } };
  const [b] = buildReviewSignalRows(tally, { n: 10, campaignId: 'c1', source: SOURCES.TRACK_B });
  assert.strictEqual(b[7], 0.25); // (0+0.5)/2、0を欠損扱いして0.5にはしない
});

test('buildReviewSignalRows: 候補ワード外はスキップ（閉じた集合への写像を強制）', () => {
  const tally = {
    w1: { count: 1, intentCount: 1, confidences: [] },
    unknown: { count: 5, intentCount: 5, confidences: [] },
  };
  const rows = buildReviewSignalRows(tally, {
    n: 10, campaignId: 'c1', source: SOURCES.TRACK_B, candidateWordIds: ['w1', 'w2'],
  });
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0][0], 'w1');
});

test('buildReviewSignalRows: 代表URL・2次利用可否は空（当面は手入力/任意）', () => {
  const tally = { w1: { count: 1, intentCount: 1, confidences: [] } };
  const [row] = buildReviewSignalRows(tally, { n: 10, campaignId: 'c1', source: SOURCES.TRACK_A });
  assert.strictEqual(row[3], '');
  assert.strictEqual(row[4], '');
});

test('signalKey: upsertキーは (word_id, campaign_id, source)', () => {
  assert.strictEqual(
    signalKey(['w1', 20, '34%', '', '', 'trackA', '2026_04_stardust', '']),
    'w1|2026_04_stardust|trackA');
});

test('realignByIndex: 回答者順に items を並べ、LLMが順序を入れ替えても index で対応づける', () => {
  const respondents = [{ index: 0 }, { index: 1 }, { index: 2 }];
  const classified = [
    { index: 2, items: [{ wordId: 'c' }] },
    { index: 0, items: [{ wordId: 'a' }] },
    { index: 1, items: [{ wordId: 'b' }] },
  ];
  assert.deepStrictEqual(realignByIndex(respondents, classified), [
    [{ wordId: 'a' }], [{ wordId: 'b' }], [{ wordId: 'c' }],
  ]);
});

test('realignByIndex: LLMが欠落させた回答者は空配列に縮退する', () => {
  const respondents = [{ index: 0 }, { index: 1 }, { index: 2 }];
  const classified = [{ index: 0, items: [{ wordId: 'a' }] }]; // 1,2 が欠落
  assert.deepStrictEqual(realignByIndex(respondents, classified), [
    [{ wordId: 'a' }], [], [],
  ]);
});

test('realignByIndex: items欠落・未知index・空入力に耐える', () => {
  const respondents = [{ index: 0 }, { index: 1 }];
  const classified = [
    { index: 0 },                          // items 欠落 → []
    { index: 9, items: [{ wordId: 'x' }] }, // 未知index → 無視
  ];
  assert.deepStrictEqual(realignByIndex(respondents, classified), [[], []]);
  assert.deepStrictEqual(realignByIndex([], []), []);
  assert.deepStrictEqual(realignByIndex(undefined, undefined), []);
});
