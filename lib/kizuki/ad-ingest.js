'use strict';

const { pctStr, ratioStr } = require('./format');

/**
 * 広告生KPI（BigQuery）＋マッピングから「広告シグナル」行を生成する。
 * 出力は Phase 2 の広告シグナル schema に一致（CTR/CVRは "2.1%" 形式）。
 * 仕様: docs/superpowers/specs/2026-07-10-kizuki-word-cycle-phase3-slice1-ad-ingest.md
 * 広告シグナル列順: [word_id, creative_id, CTR%, CVR%, ROAS, 勝ちデモグラ, デモグラ明確度, 配信額]
 */

/** BQの1行（集計済み creative）と word_id から広告シグナル行（配列）を生成。 */
function buildAdSignalRow(bqRow, wordId) {
  const ctr = pctStr(bqRow.clicks, bqRow.impressions);
  const cvr = pctStr(bqRow.conversions, bqRow.clicks);
  const roas = ratioStr(bqRow.revenue, bqRow.cost);
  const cost = Number.isFinite(Number(bqRow.cost)) ? Number(bqRow.cost) : '';
  return [
    wordId,
    bqRow.creative_id,
    ctr === null ? '' : ctr,
    cvr === null ? '' : cvr,
    roas === null ? '' : roas,
    bqRow.demographics || '',
    '', // デモグラ明確度: スライス1はベストエフォートで空（score.jsは欠損→デモグラ0点で安全）
    cost,
  ];
}

/**
 * BQ行の配列＋マッピング行の配列から広告シグナル行の配列を生成。
 * mappingRows: [{ creative_id, word_id }]。creative_id が未マッピングの BQ行はスキップ。
 */
function buildAdSignalRows(bqRows, mappingRows) {
  const map = new Map();
  for (const m of mappingRows || []) {
    if (m && m.creative_id) map.set(String(m.creative_id), m.word_id);
  }
  const out = [];
  for (const r of bqRows || []) {
    const wordId = map.get(String(r.creative_id));
    if (!wordId) continue;
    out.push(buildAdSignalRow(r, wordId));
  }
  return out;
}

module.exports = { pctStr, ratioStr, buildAdSignalRow, buildAdSignalRows };
