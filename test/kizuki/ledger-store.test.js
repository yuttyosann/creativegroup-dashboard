'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const {
  parsePercent, toNum, parseWorkshopRow, parseReviewRow, parseAdRow, parseCollabRow,
} = require('../../lib/kizuki/ledger-store');

test('parsePercent: "2.1%"→2.1 / "62%"→62 / 数値そのまま / 空・—はnull', () => {
  assert.strictEqual(parsePercent('2.1%'), 2.1);
  assert.strictEqual(parsePercent('62%'), 62);
  assert.strictEqual(parsePercent(2.1), 2.1);
  assert.strictEqual(parsePercent(''), null);
  assert.strictEqual(parsePercent('—'), null);
});

test('toNum: 数値化・空/—/NaNはnull', () => {
  assert.strictEqual(toNum('2.3'), 2.3);
  assert.strictEqual(toNum(0.9), 0.9);
  assert.strictEqual(toNum(''), null);
  assert.strictEqual(toNum('—'), null);
});

test('parseWorkshopRow: 言及数と未認知(TRUE)', () => {
  assert.deepStrictEqual(
    parseWorkshopRow(['w001', 'U-03', '発言', 8, 4.6, 'TRUE']),
    { wordId: 'w001', mentions: 8, brandUnaware: true });
});

test('parseReviewRow: 購買意向共感率"62%"は0.62（/100して0..1に）', () => {
  assert.deepStrictEqual(
    parseReviewRow(['w001', 24, '62%', 'https://x', 'TRUE']),
    { wordId: 'w001', intentRate: 0.62 });
});

test('parseAdRow: CTR/CVRは%を外すだけ・ROAS/明確度は数値', () => {
  assert.deepStrictEqual(
    parseAdRow(['w001', 'cr-1', '2.1%', '0.3%', '2.3', '30代/女性', '0.9', 200000]),
    { wordId: 'w001', ctr: 2.1, cvr: 0.3, roas: 2.3, demoClarity: 0.9, demographics: '30代/女性' });
});

test('parseCollabRow: 適合と実売', () => {
  assert.deepStrictEqual(
    parseCollabRow(['w001', 'inf-A', 87, 320, '2.3']),
    { wordId: 'w001', fitScore: 87, sales: 320 });
});

const { aggregateSignals, buildWordRows, winningDemographics } = require('../../lib/kizuki/ledger-store');

test('winningDemographics: CTR最大の行のデモグラを返す（M04客層の決定）', () => {
  const ad = [
    { wordId: 'w1', ctr: 1.0, demographics: '20代' },
    { wordId: 'w1', ctr: 2.5, demographics: '30代/敏感肌' },
    { wordId: 'w2', ctr: 9.0, demographics: '別ワード' },
  ];
  assert.strictEqual(winningDemographics('w1', ad), '30代/敏感肌');
});

test('winningDemographics: デモグラ空の行は除外', () => {
  const ad = [
    { wordId: 'w1', ctr: 5.0, demographics: '' },
    { wordId: 'w1', ctr: 1.0, demographics: '40代' },
  ];
  assert.strictEqual(winningDemographics('w1', ad), '40代');
});

test('winningDemographics: 該当ad行が無ければ空文字', () => {
  assert.strictEqual(winningDemographics('w9', [{ wordId: 'w1', ctr: 3.0, demographics: '30代' }]), '');
});

test('aggregateSignals: 言及は合算・広告は平均・明確度は最大・未認知はor', () => {
  const parsed = {
    workshop: [{ wordId: 'w1', mentions: 8, brandUnaware: true }, { wordId: 'w1', mentions: 3, brandUnaware: false }],
    review: [{ wordId: 'w1', intentRate: 0.62 }],
    ad: [{ wordId: 'w1', ctr: 2.0, cvr: null, roas: 2.0, demoClarity: 0.9, demographics: '30代' },
         { wordId: 'w1', ctr: 2.2, cvr: 1.0, roas: null, demoClarity: 0.5, demographics: '30代' }],
    collab: [{ wordId: 'w1', fitScore: 80, sales: 100 }],
  };
  const s = aggregateSignals('w1', parsed);
  assert.strictEqual(s.workshop.mentions, 11);
  assert.strictEqual(s.workshop.brandUnaware, true);
  assert.strictEqual(s.review.intentRate, 0.62);
  assert.ok(Math.abs(s.ad.ctr - 2.1) < 1e-9); // (2.0+2.2)/2
  assert.strictEqual(s.ad.cvr, 1.0);           // 平均は非null(1.0)のみ
  assert.strictEqual(s.ad.roas, 2.0);
  assert.strictEqual(s.ad.demoClarity, 0.9);   // 最大
  assert.strictEqual(s.collab.fitScore, 80);
  assert.strictEqual(s.collab.sales, 100);
});

test('aggregateSignals: 該当シグナルが無い軸は undefined', () => {
  const s = aggregateSignals('w9', { workshop: [], review: [], ad: [], collab: [] });
  assert.strictEqual(s.workshop, undefined);
  assert.strictEqual(s.ad, undefined);
});

test('buildWordRows: 台帳行に computed スコアを付けて返す（乾燥＝◎）', () => {
  const tabs = {
    ledgerRows: [
      ['案件ID','商品ID','word_id','ワード本文','訴求軸タグ','起点','status','確度ステージ','訴求スコア','判定','メモ','最終更新'],
      ['C-AVENE','AV01','w1','乾燥でゆらいだ日の駆け込み','使用シーン','勉強会','勝ち','広告確定',87,'◎','','2026/06/30'],
    ],
    workshopRows: [['word_id','',''],['w1','U-03','発言',8,4.6,'TRUE']],
    reviewRows: [['word_id'],['w1',24,'62%','https://x','TRUE']],
    adRows: [['word_id'],['w1','cr-1','2.1%','1.8%','2.3','30代/女性/敏感肌','0.9',200000]],
    collabRows: [['word_id']],
  };
  const rows = buildWordRows(tabs, 'C-AVENE');
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].wordId, 'w1');
  assert.strictEqual(rows[0].computed.grade, '◎');
  assert.ok(rows[0].computed.score >= 80);
  assert.strictEqual(rows[0].computed.stage, '広告確定');
  assert.strictEqual(rows[0].demographics, '30代/女性/敏感肌');
});

test('buildWordRows: caseId でフィルタ（不一致は除外）', () => {
  const tabs = {
    ledgerRows: [['案件ID'],['C-OTHER','AV01','w1','x','情緒','勉強会','候補','暫定','','','','']],
    workshopRows: [['h']], reviewRows: [['h']], adRows: [['h']], collabRows: [['h']],
  };
  assert.strictEqual(buildWordRows(tabs, 'C-AVENE').length, 0);
});

const { buildLedgerScoreUpdate } = require('../../lib/kizuki/ledger-store');

test('buildLedgerScoreUpdate: 確度/スコア/判定/最終更新のみ更新し他列は保持', () => {
  const row = ['C-AVENE','AV01','w1','乾燥…','使用シーン','勉強会','勝ち','暫定',10,'×','メモ','2026/06/30'];
  const out = buildLedgerScoreUpdate(row, { score: 89, grade: '◎', stage: '広告確定' }, new Date('2026-07-09T00:00:00Z'));
  assert.strictEqual(out[7], '広告確定'); // stage
  assert.strictEqual(out[8], 89);        // score
  assert.strictEqual(out[9], '◎');        // grade
  assert.strictEqual(out[11], '2026-07-09'); // updated
  assert.strictEqual(out[3], '乾燥…');    // 保持
  assert.strictEqual(out[10], 'メモ');     // 保持
  assert.notStrictEqual(out, row);        // 非破壊（新配列）
});
