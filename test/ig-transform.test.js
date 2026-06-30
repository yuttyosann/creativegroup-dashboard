'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { carouselCount, deriveTimeFields, hashtagCount, mentionCount, buildMediaRow, parseInsights } = require('../lib/ig-transform');

test('carouselCount: カルーセルは子要素数', () => {
  const media = { media_type: 'CAROUSEL_ALBUM', children: { data: [{ id: '1' }, { id: '2' }, { id: '3' }] } };
  assert.strictEqual(carouselCount(media), 3);
});

test('carouselCount: 非カルーセルは1', () => {
  assert.strictEqual(carouselCount({ media_type: 'IMAGE' }), 1);
  assert.strictEqual(carouselCount({ media_type: 'VIDEO' }), 1);
});

test('deriveTimeFields: JSTの日付・曜日・時刻を返す', () => {
  // 2026-06-30T00:30:00+0900 → date 2026-06-30, weekday Tue, hour 0
  const t = deriveTimeFields('2026-06-30T00:30:00+0900');
  assert.strictEqual(t.date, '2026-06-30');
  assert.strictEqual(t.weekday, 'Tue');
  assert.strictEqual(t.hour, 0);
});

test('hashtagCount / mentionCount', () => {
  const cap = 'メガ割きた！ #コスメ #スキンケア @brand_official みてね';
  assert.strictEqual(hashtagCount(cap), 2);
  assert.strictEqual(mentionCount(cap), 1);
  assert.strictEqual(hashtagCount(''), 0);
  assert.strictEqual(hashtagCount(null), 0);
});

test('buildMediaRow: APIメディアを行オブジェクトへ整形', () => {
  const media = {
    id: 'm1',
    caption: '#a #b',
    media_type: 'CAROUSEL_ALBUM',
    media_product_type: 'FEED',
    timestamp: '2026-06-30T12:00:00+0900',
    permalink: 'https://insta/m1',
    like_count: 10,
    comments_count: 2,
    children: { data: [{ id: 'c1', media_type: 'IMAGE' }, { id: 'c2', media_type: 'IMAGE' }] },
  };
  const row = buildMediaRow(media);
  assert.strictEqual(row.media_id, 'm1');
  assert.strictEqual(row.carousel_count, 2);
  assert.strictEqual(row.is_carousel, true);
  assert.strictEqual(row.children_count, 2);
  assert.strictEqual(row.children_media_types, 'IMAGE,IMAGE');
  assert.strictEqual(row.date, '2026-06-30');
  assert.strictEqual(row.hour, 12);
  assert.strictEqual(row.is_boosted, false); // 広告フラグは既定false（手動マーク用）
});

test('parseInsights: name/values 配列を指標オブジェクトへ', () => {
  const apiData = [
    { name: 'reach', values: [{ value: 1000 }] },
    { name: 'saved', values: [{ value: 50 }] },
    { name: 'total_interactions', values: [{ value: 120 }] },
  ];
  const got = parseInsights(apiData);
  assert.strictEqual(got.reach, 1000);
  assert.strictEqual(got.saved, 50);
  assert.strictEqual(got.total_interactions, 120);
  assert.strictEqual(got.shares, null); // 未取得はnull
});
