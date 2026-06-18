const { test } = require('node:test');
const assert = require('node:assert');
const { toDiagnosisRow } = require('../lib/diagnosis-store');

test('YouTube診断結果を診断ログ行に整形する', () => {
  const result = {
    title: 'SACHI沙智ちゃんねる', subscribers: 193000,
    avgER: 1.67, purchaseIntentRate: 17.9, commentsAnalyzed: 145, prOnly: false,
  };
  const row = toDiagnosisRow(result, { email: 'a@example.com' }, new Date('2026-06-18T00:00:00Z'));
  assert.deepStrictEqual(row, [
    '2026-06-18', 'a@example.com', 'YouTube', 'SACHI沙智ちゃんねる',
    193000, 1.67, 17.9, 145, '人気投稿',
  ]);
});

test('PR投稿モードは投稿種別がPR投稿になる', () => {
  const row = toDiagnosisRow(
    { title: 'X', subscribers: 1, avgER: 0, purchaseIntentRate: 0, commentsAnalyzed: 0, prOnly: true },
    { email: 'u@x.com' }, new Date('2026-06-18T00:00:00Z'));
  assert.strictEqual(row[8], 'PR投稿');
});
