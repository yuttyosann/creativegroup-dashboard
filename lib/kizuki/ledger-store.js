'use strict';

const { computeAppealScore } = require('./score');

/**
 * 気づきワード台帳＋4シグナルの行整形・集約。
 * スコア計算は lib/kizuki/score.js（単一の正）を利用し、ここでは触らない。
 * 仕様: docs/superpowers/specs/2026-07-06-kizuki-word-cycle-phase2-design.md
 */

// タブ名（CG_気づきワード台帳.gs が生成する名称と一致させる）
const TABS = {
  LEDGER: '気づきワード台帳',
  WORKSHOP: '勉強会シグナル',
  REVIEW: 'モニターシグナル',
  AD: '広告シグナル',
  COLLAB: 'コラボ実績',
};

// 台帳の列インデックス（0始まり）
const L = { case: 0, product: 1, wordId: 2, word: 3, axis: 4, origin: 5, status: 6, stage: 7, score: 8, grade: 9, note: 10, updated: 11 };

/** "2.1%"→2.1 / "62%"→62 / 数値そのまま / 空・"—"・非数値は null。（%は外すだけ） */
function parsePercent(v) {
  if (v === null || v === undefined || v === '' || v === '—') return null;
  const n = parseFloat(String(v).replace('%', '').trim());
  return Number.isFinite(n) ? n : null;
}

/** 数値化。空・"—"・非数値は null。 */
function toNum(v) {
  if (v === null || v === undefined || v === '' || v === '—') return null;
  const n = parseFloat(String(v).trim());
  return Number.isFinite(n) ? n : null;
}

function parseWorkshopRow(r) {
  return { wordId: r[0], mentions: toNum(r[3]) ?? 0, brandUnaware: String(r[5]).toUpperCase() === 'TRUE' };
}

/** 購買意向共感率は "62%"→0.62（score.js は 0..1 を期待）。 */
function parseReviewRow(r) {
  const pct = parsePercent(r[2]);
  return { wordId: r[0], intentRate: pct === null ? null : pct / 100 };
}

/** CTR/CVR は "2.1%"→2.1（%を外すだけ。/100しない）。 */
function parseAdRow(r) {
  return { wordId: r[0], ctr: parsePercent(r[2]), cvr: parsePercent(r[3]), roas: toNum(r[4]), demographics: r[5] || '', demoClarity: toNum(r[6]) };
}

function parseCollabRow(r) {
  return { wordId: r[0], fitScore: toNum(r[2]), sales: toNum(r[3]) };
}

/** null除外平均。全てnullなら null。 */
function avg(xs) {
  const a = xs.filter((v) => v !== null && v !== undefined && Number.isFinite(v));
  return a.length ? a.reduce((s, v) => s + v, 0) / a.length : null;
}
/** null除外最大。全てnullなら null。 */
function maxOr(xs) {
  const a = xs.filter((v) => v !== null && v !== undefined && Number.isFinite(v));
  return a.length ? Math.max(...a) : null;
}

/**
 * parsed = { workshop:[], review:[], ad:[], collab:[] }（parse済み・全word_id混在）から
 * 指定 wordId の score.js 入力 signals を組み立てる。該当が無い軸は undefined。
 */
function aggregateSignals(wordId, parsed) {
  const ws = parsed.workshop.filter((x) => x.wordId === wordId);
  const rv = parsed.review.filter((x) => x.wordId === wordId);
  const ad = parsed.ad.filter((x) => x.wordId === wordId);
  const cb = parsed.collab.filter((x) => x.wordId === wordId);
  const signals = {};
  if (ws.length) signals.workshop = {
    mentions: ws.reduce((s, x) => s + (x.mentions || 0), 0),
    brandUnaware: ws.some((x) => x.brandUnaware),
  };
  if (rv.length) signals.review = { intentRate: avg(rv.map((x) => x.intentRate)) };
  if (ad.length) signals.ad = {
    ctr: avg(ad.map((x) => x.ctr)), cvr: avg(ad.map((x) => x.cvr)),
    roas: avg(ad.map((x) => x.roas)), demoClarity: maxOr(ad.map((x) => x.demoClarity)),
  };
  if (cb.length) signals.collab = { fitScore: maxOr(cb.map((x) => x.fitScore)), sales: cb.reduce((s, x) => s + (x.sales || 0), 0) };
  return signals;
}

/** ad行から wordId の「勝ちデモグラ」（CTR最大の行のデモグラ文字列）を返す。無ければ ''。 */
function winningDemographics(wordId, adParsed) {
  const rows = adParsed.filter((x) => x.wordId === wordId && x.demographics);
  if (!rows.length) return '';
  rows.sort((a, b) => (b.ctr || 0) - (a.ctr || 0));
  return rows[0].demographics;
}

/**
 * 生行（ヘッダー込み）を受け取り、台帳の各ワードに computed スコアを付けた配列を返す。
 * tabs = { ledgerRows, workshopRows, reviewRows, adRows, collabRows }
 */
function buildWordRows(tabs, caseId) {
  const parsed = {
    workshop: (tabs.workshopRows || []).slice(1).map(parseWorkshopRow),
    review: (tabs.reviewRows || []).slice(1).map(parseReviewRow),
    ad: (tabs.adRows || []).slice(1).map(parseAdRow),
    collab: (tabs.collabRows || []).slice(1).map(parseCollabRow),
  };
  return (tabs.ledgerRows || []).slice(1)
    .filter((r) => r[L.wordId] && (!caseId || r[L.case] === caseId))
    .map((r) => {
      const wordId = r[L.wordId];
      const computed = computeAppealScore(aggregateSignals(wordId, parsed));
      return {
        wordId, caseId: r[L.case], productId: r[L.product], word: r[L.word], axis: r[L.axis],
        status: r[L.status], demographics: winningDemographics(wordId, parsed.ad),
        saved: { score: toNum(r[L.score]), grade: r[L.grade] || '', stage: r[L.stage] || '' },
        computed,
      };
    });
}

/** 台帳行のコピーに、確度ステージ・訴求スコア・判定・最終更新を書き込んだ新配列を返す（非破壊）。 */
function buildLedgerScoreUpdate(ledgerRow, computed, now = new Date()) {
  const out = ledgerRow.slice();
  out[L.stage] = computed.stage;
  out[L.score] = computed.score;
  out[L.grade] = computed.grade;
  out[L.updated] = now.toISOString().slice(0, 10);
  return out;
}

module.exports = {
  TABS, L, parsePercent, toNum,
  parseWorkshopRow, parseReviewRow, parseAdRow, parseCollabRow,
  aggregateSignals, winningDemographics, buildWordRows, buildLedgerScoreUpdate,
};
