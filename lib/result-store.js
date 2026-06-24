'use strict';
/**
 * result-store.js — 実績の列定義・ROAS計算・行マッパー・サマリー生成（純粋関数）
 * ROAS式は既存案件DB(GAS)の慣習に合わせる：総コスト=タイアップ費+売上×成果報酬率、ROAS=売上/総コスト。
 */

const RESULT_HEADERS = [
  'result_id', '案件ID', 'アカウント名', '媒体', '実施日', '実売数', '売上', 'タイアップ費',
  '成果報酬率%', '総コスト', 'ROAS%', '損益', 'メモ', '記録者', '最終更新',
];

function isoDate(now) { return now.toISOString().slice(0, 10); }
function num(v) { const n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, '')); return isNaN(n) ? 0 : n; }

function computeResult({ sales, fee, rewardRate } = {}) {
  const s = num(sales), f = num(fee), r = num(rewardRate);
  const totalCost = f + s * (r / 100);
  const roas = totalCost > 0 ? Math.round(s / totalCost * 100) : 0;
  const profit = s - totalCost;
  return { totalCost, roas, profit };
}

function validateResult(o) {
  if (!o || !String(o.case_id || '').trim()) throw new Error('必須項目が不足しています: 案件ID');
  if (!String(o.account || '').trim()) throw new Error('必須項目が不足しています: アカウント名');
}

function toResultRow(o, id, now = new Date()) {
  const c = computeResult({ sales: o.sales, fee: o.fee, rewardRate: o.rewardRate });
  return [
    id, o.case_id || '', o.account || '', o.media || '', o.date || '', o.units || '',
    o.sales || '', o.fee || '', o.rewardRate || '', c.totalCost, c.roas, c.profit,
    o.note || '', o.registrant || '', isoDate(now),
  ];
}

function parseResult(r) {
  return {
    result_id: r[0] || '', case_id: r[1] || '', account: r[2] || '', media: r[3] || '', date: r[4] || '',
    units: r[5] || '', sales: r[6] || '', fee: r[7] || '', rewardRate: r[8] || '', totalCost: r[9] || '',
    roas: r[10] || '', profit: r[11] || '', note: r[12] || '', registrant: r[13] || '', updated: r[14] || '',
  };
}

function buildSummaryLine(caseLabel, roas, profit) {
  const head = caseLabel ? caseLabel + ' ' : '';
  return `${head}ROAS${roas}% ${num(profit) >= 0 ? '黒字' : '赤字'}`;
}

function mergeSummaryLine(existingSummary, caseId, line) {
  const lines = String(existingSummary || '').split('\n').map((s) => s.trim()).filter(Boolean)
    .filter((l) => !l.startsWith(caseId + ' '));
  lines.push(caseId + ' ' + line);
  return lines.join('\n');
}

module.exports = { RESULT_HEADERS, computeResult, validateResult, toResultRow, parseResult, buildSummaryLine, mergeSummaryLine };
