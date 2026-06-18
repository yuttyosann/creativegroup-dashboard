'use strict';

/** 診断結果を「診断ログ」シートの1行（配列）に整形する */
function toDiagnosisRow(result, user, now = new Date()) {
  const date = now.toISOString().slice(0, 10);
  return [
    date,
    user.email || '',
    'YouTube',
    result.title || '',
    result.subscribers || 0,
    result.avgER || 0,
    result.purchaseIntentRate || 0,
    result.commentsAnalyzed || 0,
    result.prOnly ? 'PR投稿' : '人気投稿',
  ];
}

module.exports = { toDiagnosisRow };
