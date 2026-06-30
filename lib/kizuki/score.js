'use strict';

/**
 * 気づきワード 訴求スコア計算。
 * 仕様: docs/superpowers/specs/2026-06-30-kizuki-word-cycle-design.md セクション2。
 * 実データ（広告CTR/CVR）を最重視し、言及の多さ（虚栄）だけでは上がらない。
 * これがスコアの単一の正。GAS台帳/コックピット/BQはこの定義に従う。
 */

// 配点（合計100。虚栄控除は別途 -20..0）
const WEIGHTS = {
  workshop: 15, // ①勉強会：言及の質＋ブランド未認知
  review: 25,   // ②Pamun：購買意向共感率
  ad: 40,       // ③広告：CTR/CVR/ROAS（最重視）
  demo: 10,     // ③広告：デモグラ明確度
  collab: 10,   // ④インフル：適合・実売
};

// 正規化の基準値（この値で満点）
const CTR_GOOD = 2.0;    // %
const CVR_GOOD = 3.0;    // %
const ROAS_GOOD = 2.0;   // 倍（=200%）
const INTENT_GOOD = 0.6; // 購買意向共感率 60%
const MENTION_GOOD = 8;  // 言及数

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** 平均（null/NaN除外）。全て無効なら null。 */
function avgDefined(xs) {
  const a = xs.filter((v) => num(v) !== null);
  if (a.length === 0) return null;
  return a.reduce((s, v) => s + v, 0) / a.length;
}

/** ①勉強会 0..15。言及数(MENTION_GOODで頭打ち)×0.5 ＋ ブランド未認知×0.5。 */
function workshopScore(w) {
  if (!w) return 0;
  const mentionNorm = clamp01((num(w.mentions) ?? 0) / MENTION_GOOD);
  const unaware = w.brandUnaware ? 1 : 0;
  return (mentionNorm * 0.5 + unaware * 0.5) * WEIGHTS.workshop;
}

/** ②Pamun 0..25。購買意向共感率(0..1)をINTENT_GOODで満点に。未測定は0。 */
function reviewScore(r) {
  if (!r) return 0;
  const intent = num(r.intentRate);
  if (intent === null) return 0;
  return clamp01(intent / INTENT_GOOD) * WEIGHTS.review;
}

/** ③広告 0..40。CTR/CVR/ROASの正規化平均（測定済みのみ）。未測定は0。 */
function adScore(a) {
  if (!a) return 0;
  const parts = [];
  if (num(a.ctr) !== null) parts.push(clamp01(a.ctr / CTR_GOOD));
  if (num(a.cvr) !== null) parts.push(clamp01(a.cvr / CVR_GOOD));
  if (num(a.roas) !== null) parts.push(clamp01(a.roas / ROAS_GOOD));
  const m = avgDefined(parts);
  return m === null ? 0 : m * WEIGHTS.ad;
}

/** ③デモグラ明確度 0..10。0..1。未測定は0。 */
function demoScore(a) {
  if (!a) return 0;
  const d = num(a.demoClarity);
  return d === null ? 0 : clamp01(d) * WEIGHTS.demo;
}

/** ④インフル 0..10。適合(0..100)正規化＋実売ありで+0.2底上げ。未測定は0。 */
function collabScore(c) {
  if (!c) return 0;
  const fit = num(c.fitScore);
  const sales = num(c.sales);
  if (fit === null && sales === null) return 0;
  const fitNorm = fit === null ? 0 : clamp01(fit / 100);
  const soldBonus = sales !== null && sales > 0 ? 0.2 : 0;
  return clamp01(fitNorm + soldBonus) * WEIGHTS.collab;
}

function computeAppealScore(signals = {}) {
  return { score: 0, grade: '×', stage: '暫定', breakdown: {} };
}

module.exports = {
  computeAppealScore, WEIGHTS,
  workshopScore, reviewScore, adScore, demoScore, collabScore,
};
