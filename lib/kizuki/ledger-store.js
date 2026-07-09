'use strict';

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
  return { wordId: r[0], mentions: toNum(r[3]) || 0, brandUnaware: String(r[5]).toUpperCase() === 'TRUE' };
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

module.exports = { TABS, L, parsePercent, toNum, parseWorkshopRow, parseReviewRow, parseAdRow, parseCollabRow };
