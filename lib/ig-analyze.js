'use strict';

const { median, percentile, pearson, spearman } = require('./ig-stats');

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const div = (a, b) => (num(a) != null && num(b) != null && b !== 0 ? a / b : null);

/**
 * media行 + insights行を media_id で結合し特徴量を算出。
 * reach欠損は除外。opts.minReach 未満も除外。
 */
function computeFeatures(mediaRows, insightRows, opts = {}) {
  const minReach = opts.minReach != null ? opts.minReach : 0;
  const byId = new Map();
  for (const i of insightRows) byId.set(i.media_id, i);
  const out = [];
  for (const m of mediaRows) {
    const i = byId.get(m.media_id);
    if (!i) continue;
    const reach = num(i.reach);
    if (reach == null || reach < minReach) continue;
    out.push({
      media_id: m.media_id,
      permalink: m.permalink || null,
      weekday: m.weekday || null,
      hour: m.hour != null ? m.hour : null,
      carousel_count: num(m.carousel_count),
      reach,
      saved: num(i.saved),
      shares: num(i.shares),
      total_interactions: num(i.total_interactions),
      engagement_rate: div(i.total_interactions, reach),
      save_rate: div(i.saved, reach),
      share_rate: div(i.shares, reach),
      basic_engagement_rate: div((num(m.like_count) || 0) + (num(m.comments_count) || 0), reach),
    });
  }
  return out;
}

const CORR_PAIRS = [
  ['carousel_count', 'engagement_rate'],
  ['carousel_count', 'reach'],
  ['save_rate', 'reach'],
  ['share_rate', 'reach'],
];

/** 主要ペアの Pearson/Spearman/n を算出。 */
function runCorrelations(features) {
  return CORR_PAIRS.map(([x, y]) => {
    const xs = features.map((f) => f[x]);
    const ys = features.map((f) => f[y]);
    const paired = features.filter((f) => num(f[x]) != null && num(f[y]) != null);
    return { x, y, n: paired.length, pearson: pearson(xs, ys), spearman: spearman(xs, ys) };
  });
}

const COMPARE_METRICS = ['carousel_count', 'engagement_rate', 'save_rate', 'share_rate', 'hour'];

function mediansOf(rows) {
  const medians = {};
  for (const k of COMPARE_METRICS) medians[k] = median(rows.map((r) => r[k]).filter((v) => num(v) != null));
  return medians;
}

/** リーチ上位/下位 q（既定0.25）を比較。 */
function topBottomCompare(features, q = 0.25) {
  const valid = features.filter((f) => num(f.reach) != null);
  const reaches = valid.map((f) => f.reach);
  const hi = percentile(reaches, (1 - q) * 100);
  const lo = percentile(reaches, q * 100);
  const top = valid.filter((f) => f.reach >= hi);
  const bottom = valid.filter((f) => f.reach <= lo);
  return {
    top: { n: top.length, medians: mediansOf(top), permalinks: top.map((f) => f.permalink).filter(Boolean) },
    bottom: { n: bottom.length, medians: mediansOf(bottom), permalinks: bottom.map((f) => f.permalink).filter(Boolean) },
  };
}

/** カルーセル枚数別の指標中央値（散布図用）。 */
function carouselBreakdown(features) {
  const groups = new Map();
  for (const f of features) {
    const c = num(f.carousel_count);
    if (c == null) continue;
    if (!groups.has(c)) groups.set(c, []);
    groups.get(c).push(f);
  }
  return [...groups.keys()].sort((a, b) => a - b).map((c) => {
    const rows = groups.get(c);
    return {
      carousel_count: c,
      n: rows.length,
      median_engagement_rate: median(rows.map((r) => r.engagement_rate).filter((v) => num(v) != null)),
      median_save_rate: median(rows.map((r) => r.save_rate).filter((v) => num(v) != null)),
      median_reach: median(rows.map((r) => r.reach).filter((v) => num(v) != null)),
    };
  });
}

module.exports = { computeFeatures, runCorrelations, topBottomCompare, carouselBreakdown };
