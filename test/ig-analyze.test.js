'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { computeFeatures, computeFeaturesWithStats, runCorrelations, topBottomCompare } = require('../lib/ig-analyze');

// media行 + insights行のフィクスチャ（最小）
const media = [
  { media_id: 'a', carousel_count: 5, comments_count: 4, like_count: 20, weekday: 'Mon', hour: 12, permalink: 'https://insta/a' },
  { media_id: 'b', carousel_count: 2, comments_count: 1, like_count: 5, weekday: 'Tue', hour: 9, permalink: 'https://insta/b' },
  { media_id: 'c', carousel_count: 8, comments_count: 9, like_count: 40, weekday: 'Wed', hour: 20, permalink: 'https://insta/c' },
  { media_id: 'd', carousel_count: 1, comments_count: 0, like_count: 2, weekday: 'Thu', hour: 7, permalink: 'https://insta/d' },
];
const insights = [
  { media_id: 'a', reach: 1000, saved: 50, shares: 10, total_interactions: 84 },
  { media_id: 'b', reach: 400, saved: 8, shares: 2, total_interactions: 16 },
  { media_id: 'c', reach: 3000, saved: 300, shares: 60, total_interactions: 409 },
  { media_id: 'd', reach: 200, saved: 2, shares: 0, total_interactions: 4 },
];

test('computeFeatures: reach欠損は除外し、率を算出', () => {
  const withMissing = insights.concat([{ media_id: 'e', reach: null }]);
  const mediaPlus = media.concat([{ media_id: 'e', carousel_count: 3 }]);
  const f = computeFeatures(mediaPlus, withMissing);
  assert.strictEqual(f.length, 4); // eは除外
  const a = f.find((r) => r.media_id === 'a');
  assert.ok(Math.abs(a.engagement_rate - 0.084) < 1e-9);
  assert.ok(Math.abs(a.save_rate - 0.05) < 1e-9);
  assert.ok(Math.abs(a.share_rate - 0.01) < 1e-9);
});

test('computeFeatures: minReachでフィルタ', () => {
  const f = computeFeatures(media, insights, { minReach: 300 });
  assert.deepStrictEqual(f.map((r) => r.media_id).sort(), ['a', 'b', 'c']); // d(reach200)除外
});

test('runCorrelations: 主要4ペアを返す（pearson/spearman/n）', () => {
  const f = computeFeatures(media, insights);
  const cors = runCorrelations(f);
  const keys = cors.map((c) => `${c.x}~${c.y}`);
  assert.ok(keys.includes('carousel_count~engagement_rate'));
  assert.ok(keys.includes('carousel_count~reach'));
  assert.ok(keys.includes('save_rate~reach'));
  assert.ok(keys.includes('share_rate~reach'));
  const sr = cors.find((c) => c.x === 'save_rate' && c.y === 'reach');
  assert.strictEqual(sr.n, 4);
  assert.ok(typeof sr.pearson === 'number' && typeof sr.spearman === 'number');
});

test('topBottomCompare: 上位/下位群の中央値とURLを返す', () => {
  const f = computeFeatures(media, insights);
  const cmp = topBottomCompare(f, 0.25);
  assert.ok(cmp.top.n >= 1 && cmp.bottom.n >= 1);
  assert.ok('carousel_count' in cmp.top.medians);
  assert.ok('engagement_rate' in cmp.top.medians);
  assert.ok(Array.isArray(cmp.top.permalinks));
});

// ---- 分析フィルタ（48時間未満 / 広告 / キャンペーン）----

const NOW = Date.parse('2026-06-30T12:00:00Z');
const baseMedia = (over) => Object.assign(
  { media_id: 'x', carousel_count: 3, comments_count: 1, like_count: 5, permalink: 'https://insta/x' },
  over,
);
const baseInsight = (over) => Object.assign({ media_id: 'x', reach: 500, saved: 10, shares: 2, total_interactions: 30 }, over);

test('48時間未満の投稿は除外（timestampあり）', () => {
  const m = [
    baseMedia({ media_id: 'fresh', timestamp: '2026-06-30T00:00:00Z' }), // 12時間前 → 除外
    baseMedia({ media_id: 'old', timestamp: '2026-06-25T00:00:00Z' }),   // 5日前 → 残す
  ];
  const i = [baseInsight({ media_id: 'fresh' }), baseInsight({ media_id: 'old' })];
  const { features, excluded } = computeFeaturesWithStats(m, i, { now: NOW });
  assert.deepStrictEqual(features.map((f) => f.media_id), ['old']);
  assert.strictEqual(excluded.tooFresh, 1);
});

test('--keep-fresh相当: minAgeHours=0なら48時間未満も残す', () => {
  const m = [baseMedia({ media_id: 'fresh', timestamp: '2026-06-30T00:00:00Z' })];
  const i = [baseInsight({ media_id: 'fresh' })];
  const { features } = computeFeaturesWithStats(m, i, { now: NOW, minAgeHours: 0 });
  assert.strictEqual(features.length, 1);
});

test('timestampが無い投稿は48時間判定では除外しない', () => {
  const m = [baseMedia({ media_id: 'x' })]; // timestampなし
  const i = [baseInsight({})];
  const { features, excluded } = computeFeaturesWithStats(m, i, { now: NOW });
  assert.strictEqual(features.length, 1);
  assert.strictEqual(excluded.tooFresh, 0);
});

test('is_boosted=true（広告）は除外', () => {
  const m = [baseMedia({ media_id: 'ad', is_boosted: true }), baseMedia({ media_id: 'norm', is_boosted: false })];
  const i = [baseInsight({ media_id: 'ad' }), baseInsight({ media_id: 'norm' })];
  const { features, excluded } = computeFeaturesWithStats(m, i, { now: NOW });
  assert.deepStrictEqual(features.map((f) => f.media_id), ['norm']);
  assert.strictEqual(excluded.boosted, 1);
});

test('キャンペーン/プレゼント投稿はcaptionで除外', () => {
  const m = [
    baseMedia({ media_id: 'camp', caption: '【プレゼントキャンペーン】フォローで応募！' }),
    baseMedia({ media_id: 'plain', caption: '新作コスメの成分解説です #スキンケア' }),
  ];
  const i = [baseInsight({ media_id: 'camp' }), baseInsight({ media_id: 'plain' })];
  const { features, excluded } = computeFeaturesWithStats(m, i, { now: NOW });
  assert.deepStrictEqual(features.map((f) => f.media_id), ['plain']);
  assert.strictEqual(excluded.campaign, 1);
});

test('--keep-ads相当: 除外オフなら広告・キャンペーンも残す', () => {
  const m = [
    baseMedia({ media_id: 'ad', is_boosted: true }),
    baseMedia({ media_id: 'camp', caption: 'プレゼント企画' }),
  ];
  const i = [baseInsight({ media_id: 'ad' }), baseInsight({ media_id: 'camp' })];
  const { features } = computeFeaturesWithStats(m, i, { now: NOW, excludeBoosted: false, excludeCampaign: false });
  assert.strictEqual(features.length, 2);
});

test('computeFeatures は computeFeaturesWithStats の features と一致', () => {
  const m = [baseMedia({ media_id: 'x', timestamp: '2026-06-25T00:00:00Z' })];
  const i = [baseInsight({})];
  const a = computeFeatures(m, i, { now: NOW });
  const b = computeFeaturesWithStats(m, i, { now: NOW }).features;
  assert.deepStrictEqual(a, b);
});
