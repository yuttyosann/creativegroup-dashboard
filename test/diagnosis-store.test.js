const { test } = require('node:test');
const assert = require('node:assert');
const { toDiagnosisRow } = require('../lib/diagnosis-store');

test('YouTube診断結果を診断ログ行に整形する（案件ID先頭・未指定は空）', () => {
  const result = {
    title: 'SACHI沙智ちゃんねる', subscribers: 193000,
    avgER: 1.67, purchaseIntentRate: 17.9, commentsAnalyzed: 145, prOnly: false,
  };
  const row = toDiagnosisRow(result, { email: 'a@example.com' }, new Date('2026-06-18T00:00:00Z'));
  assert.deepStrictEqual(row, [
    '', '2026-06-18', 'a@example.com', 'YouTube', 'SACHI沙智ちゃんねる',
    193000, 1.67, 17.9, 145, '人気投稿',
  ]);
});

test('案件IDを指定すると先頭列に入る', () => {
  const row = toDiagnosisRow(
    { title: 'X', subscribers: 1, avgER: 0, purchaseIntentRate: 0, commentsAnalyzed: 0, prOnly: true },
    { email: 'u@x.com' }, new Date('2026-06-18T00:00:00Z'), 'C-0007');
  assert.strictEqual(row[0], 'C-0007');
  assert.strictEqual(row[9], 'PR投稿');
});
