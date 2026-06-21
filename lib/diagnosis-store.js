'use strict';

/** 診断結果を「診断ログ」シートの1行（配列）に整形する。先頭は案件ID（未指定なら空）。 */
function toDiagnosisRow(result, user, now = new Date(), caseId = '') {
  const date = now.toISOString().slice(0, 10);
  return [
    caseId || '',
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
