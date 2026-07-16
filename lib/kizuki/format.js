'use strict';

/**
 * 気づきワード台帳まわりの数値整形・解釈の唯一の置き場。
 * ad-ingest（広告）と review-ingest（Pamun）が共有する。
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

module.exports = { pctStr, ratioStr, parsePercent, toNum };
