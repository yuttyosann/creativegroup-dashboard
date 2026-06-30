'use strict';

const { median, percentile, pearson, spearman } = require('./ig-stats');

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const div = (a, b) => (num(a) != null && num(b) != null && b !== 0 ? a / b : null);

// キャンペーン/プレゼント企画の検出キーワード（caption部分一致・大文字小文字無視）
const DEFAULT_CAMPAIGN_KEYWORDS = [
  'プレゼント', 'キャンペーン', '応募', '抽選', '当た', '当選', 'クーポン',
  'プレ企画', 'フォロー&', 'フォロー＆', 'リポスト', '配布', 'ギフト', 'giveaway',
];

const isTrue = (v) => v === true || v === 'true' || v === 'TRUE' || v === 1;

/** captionがキャンペーン/プレゼント投稿らしいか。 */
function isCampaignCaption(caption, keywords) {
  if (!caption) return false;
  const text = String(caption).toLowerCase();
  return keywords.some((k) => text.includes(String(k).toLowerCase()));
}

/**
 * media行 + insights行を media_id で結合し特徴量を算出し、除外件数も返す。
 * 除外: Insights無し / reach欠損 / 48時間未満(minAgeHours) / 広告(is_boosted) /
 *       キャンペーン(captionヒューリスティック) / minReach未満。
 *
 * opts:
 *   minReach        … リーチ下限（既定0）
 *   minAgeHours     … 投稿からの最小経過時間（既定48）。0で48時間フィルタ無効。
 *   now             … 現在時刻ms（既定 Date.now()）。テスト用に注入可。
 *   excludeBoosted  … is_boosted=true を除外（既定true）
 *   excludeCampaign … キャンペーン投稿を除外（既定true）
 *   campaignKeywords… 検出キーワード上書き（既定 DEFAULT_CAMPAIGN_KEYWORDS）
 */
function computeFeaturesWithStats(mediaRows, insightRows, opts = {}) {
  const minReach = opts.minReach != null ? opts.minReach : 0;
  const minAgeHours = opts.minAgeHours != null ? opts.minAgeHours : 48;
  const now = opts.now != null ? opts.now : Date.now();
  const excludeBoosted = opts.excludeBoosted !== false;
  const excludeCampaign = opts.excludeCampaign !== false;
  const keywords = opts.campaignKeywords || DEFAULT_CAMPAIGN_KEYWORDS;

  const byId = new Map();
  for (const i of insightRows) byId.set(i.media_id, i);
  const excluded = { noInsights: 0, missingReach: 0, tooFresh: 0, boosted: 0, campaign: 0, lowReach: 0 };
  const out = [];

  for (const m of mediaRows) {
    const i = byId.get(m.media_id);
    if (!i) { excluded.noInsights++; continue; }
    const reach = num(i.reach);
    if (reach == null) { excluded.missingReach++; continue; }

    // 48時間未満（timestampが解釈できる場合のみ判定）
    if (minAgeHours > 0 && m.timestamp) {
      const ts = Date.parse(m.timestamp);
      if (!Number.isNaN(ts) && (now - ts) / 3600000 < minAgeHours) { excluded.tooFresh++; continue; }
    }
    // 広告（手動マークのis_boosted）
    if (excludeBoosted && isTrue(m.is_boosted)) { excluded.boosted++; continue; }
    // キャンペーン/プレゼント投稿
    if (excludeCampaign && isCampaignCaption(m.caption, keywords)) { excluded.campaign++; continue; }
    // 低リーチ
    if (reach < minReach) { excluded.lowReach++; continue; }

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
  return { features: out, excluded };
}

/** computeFeaturesWithStats の features のみを返す薄いラッパ。 */
function computeFeatures(mediaRows, insightRows, opts = {}) {
  return computeFeaturesWithStats(mediaRows, insightRows, opts).features;
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

module.exports = { computeFeatures, computeFeaturesWithStats, runCorrelations, topBottomCompare, carouselBreakdown, isCampaignCaption, DEFAULT_CAMPAIGN_KEYWORDS };
