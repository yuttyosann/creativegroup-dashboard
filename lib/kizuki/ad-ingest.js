'use strict';

/**
 * 広告生KPI（BigQuery）＋マッピングから「広告シグナル」行を生成する。
 * 出力は Phase 2 の広告シグナル schema に一致（CTR/CVRは "2.1%" 形式）。
 * 仕様: docs/superpowers/specs/2026-07-10-kizuki-word-cycle-phase3-slice1-ad-ingest.md
 * 広告シグナル列順: [word_id, creative_id, CTR%, CVR%, ROAS, 勝ちデモグラ, デモグラ明確度, 配信額]
 */

/** 百分率を "2.1%" 形式（小数1桁）に。分母0・無効は null。 */
function pctStr(numerator, denominator) {
  const n = Number(numerator), d = Number(denominator);
  if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return null;
  return (Math.round((n / d) * 1000) / 10) + '%';
}

/** 比率（ROAS）を数値文字列（小数2桁）に。分母0・無効は null。 */
function ratioStr(numerator, denominator) {
  const n = Number(numerator), d = Number(denominator);
  if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return null;
  return String(Math.round((n / d) * 100) / 100);
}

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

module.exports = { pctStr, ratioStr, buildAdSignalRow };
