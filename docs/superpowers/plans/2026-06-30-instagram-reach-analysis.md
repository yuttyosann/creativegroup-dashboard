# Instagram 投稿分析 MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 自社Instagramアカウントの投稿データを公式Graph APIで取得しBigQuery/CSVに蓄積、カルーセル枚数・エンゲージメント率・リーチの相関と上位/下位比較をレポート出力するMVPを構築する。

**Architecture:** 純粋ロジック（統計・変換・分析）を `lib/ig-*.js` に切り出し `node:test` でTDD。`scripts/instagram/` は薄いI/Oオーケストレーション（Graph API取得→BigQuery+CSV、CSV/BQ読込→相関・比較→Markdown/CSVレポート）。生データはBigQuery（アーキ準拠）、計算はNode自前（依存追加なし・BQ未設定でもCSVで動く）。

**Tech Stack:** Node.js (CommonJS), `node:test`, `axios`（既存依存）, `@google-cloud/bigquery`（既存依存）, Graph API v21.0。

---

## File Structure

| ファイル | 責務 |
|---|---|
| `bigquery/instagram_setup.sql` | BQスキーマ（ig_media_raw / ig_insights_raw / ig_media_features ビュー） |
| `lib/ig-stats.js` | 純粋統計: median, percentile, pearson, spearman |
| `lib/ig-transform.js` | 純粋変換: carouselCount, deriveTimeFields, hashtagCount, mentionCount, buildMediaRow, parseInsights |
| `lib/ig-analyze.js` | 純粋分析: computeFeatures, runCorrelations, topBottomCompare, carouselBreakdown |
| `scripts/instagram/fetch_insights.js` | Graph API取得→BigQuery+CSV（薄いI/O） |
| `scripts/instagram/analyze.js` | CSV/BQ読込→分析→Markdown/CSV出力（薄いI/O） |
| `scripts/instagram/README.md` | 認証情報の取得手順＋使い方 |
| `test/ig-stats.test.js` | ig-stats のテスト |
| `test/ig-transform.test.js` | ig-transform のテスト |
| `test/ig-analyze.test.js` | ig-analyze のテスト（フィクスチャ） |

実行: `npm test`（= `node --test`）。

---

### Task 1: BigQuery スキーマSQL

**Files:**
- Create: `bigquery/instagram_setup.sql`

- [ ] **Step 1: SQLファイルを作成**

`bigquery/setup_dataset.sql` と同じプロジェクト/データセット/リージョン規約に従う。

```sql
-- ============================================================
-- CreativeGroup BigQuery — Instagram 投稿分析セットアップSQL
-- プロジェクトID: cg-project-491303 / データセット: cg_analytics
-- 実行場所: BigQueryコンソール > SQLクエリ（1ステートメントずつ実行）
-- ============================================================

-- ① 投稿基本情報（raw）
CREATE TABLE IF NOT EXISTS `cg-project-491303.cg_analytics.ig_media_raw` (
  media_id             STRING NOT NULL,  -- 投稿ID
  timestamp            TIMESTAMP,        -- 投稿日時
  date                 DATE,             -- 投稿日
  weekday              STRING,           -- 曜日（Mon..Sun）
  hour                 INT64,            -- 投稿時間（0-23, JST）
  permalink            STRING,           -- 投稿URL
  caption              STRING,           -- キャプション全文
  media_type           STRING,           -- IMAGE / VIDEO / CAROUSEL_ALBUM
  media_product_type   STRING,           -- FEED / REELS など
  like_count           INT64,
  comments_count       INT64,
  children_count       INT64,            -- children件数
  carousel_count       INT64,            -- カルーセル枚数（非カルーセルは1）
  is_carousel          BOOL,
  children_media_types STRING,           -- 子メディア種別のカンマ連結
  loaded_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
)
PARTITION BY date
OPTIONS (description = 'Instagram 投稿基本情報（公式Graph API）');

-- ② 投稿Insights（raw）
CREATE TABLE IF NOT EXISTS `cg-project-491303.cg_analytics.ig_insights_raw` (
  media_id           STRING NOT NULL,
  fetched_at         TIMESTAMP,
  reach              INT64,
  saved              INT64,
  shares             INT64,
  total_interactions INT64,
  profile_visits     INT64,
  follows            INT64,
  views              INT64,
  insight_error      STRING,             -- 取得失敗時のエラー
  loaded_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
)
OPTIONS (description = 'Instagram 投稿Insights（メディア種別でフォールバック取得）');

-- ③ 特徴量ビュー
CREATE OR REPLACE VIEW `cg-project-491303.cg_analytics.ig_media_features` AS
SELECT
  m.media_id,
  m.date, m.weekday, m.hour, m.permalink, m.media_type, m.media_product_type,
  m.carousel_count, m.is_carousel,
  m.like_count, m.comments_count,
  i.reach, i.saved, i.shares, i.total_interactions, i.profile_visits, i.follows, i.views,
  LN(IFNULL(i.reach, 0) + 1)                                            AS reach_log,
  SAFE_DIVIDE(i.total_interactions, i.reach)                           AS engagement_rate,
  SAFE_DIVIDE(m.like_count + m.comments_count, i.reach)                AS basic_engagement_rate,
  SAFE_DIVIDE(i.saved, i.reach)                                        AS save_rate,
  SAFE_DIVIDE(i.shares, i.reach)                                       AS share_rate,
  SAFE_DIVIDE(m.comments_count, i.reach)                               AS comment_rate,
  SAFE_DIVIDE(i.profile_visits, i.reach)                              AS profile_visit_rate,
  SAFE_DIVIDE(i.follows, i.reach)                                      AS follow_rate,
  CHAR_LENGTH(IFNULL(m.caption, ''))                                   AS caption_length,
  ARRAY_LENGTH(REGEXP_EXTRACT_ALL(IFNULL(m.caption, ''), r'#[^\s#]+')) AS hashtag_count,
  ARRAY_LENGTH(REGEXP_EXTRACT_ALL(IFNULL(m.caption, ''), r'@[^\s@]+')) AS mention_count
FROM `cg-project-491303.cg_analytics.ig_media_raw` m
LEFT JOIN `cg-project-491303.cg_analytics.ig_insights_raw` i USING (media_id);
```

- [ ] **Step 2: コミット**

```bash
git add bigquery/instagram_setup.sql
git commit -m "feat: Instagram分析用BigQueryスキーマSQLを追加"
```

---

### Task 2: 統計ユーティリティ `lib/ig-stats.js`

**Files:**
- Create: `lib/ig-stats.js`
- Test: `test/ig-stats.test.js`

- [ ] **Step 1: 失敗するテストを書く**

`test/ig-stats.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { median, percentile, pearson, spearman } = require('../lib/ig-stats');

test('median: 奇数個は中央値、偶数個は平均', () => {
  assert.strictEqual(median([3, 1, 2]), 2);
  assert.strictEqual(median([1, 2, 3, 4]), 2.5);
});

test('median: 空配列は null', () => {
  assert.strictEqual(median([]), null);
});

test('percentile: 25/75パーセンタイル（線形補間）', () => {
  // [1..5] の p25=2, p75=4（線形補間）
  assert.strictEqual(percentile([1, 2, 3, 4, 5], 25), 2);
  assert.strictEqual(percentile([1, 2, 3, 4, 5], 75), 4);
});

test('pearson: 完全な正の相関は1', () => {
  const r = pearson([1, 2, 3, 4], [2, 4, 6, 8]);
  assert.ok(Math.abs(r - 1) < 1e-9);
});

test('pearson: 完全な負の相関は-1', () => {
  const r = pearson([1, 2, 3, 4], [8, 6, 4, 2]);
  assert.ok(Math.abs(r + 1) < 1e-9);
});

test('spearman: 単調増加なら1（非線形でも）', () => {
  const r = spearman([1, 2, 3, 4], [1, 4, 9, 16]);
  assert.ok(Math.abs(r - 1) < 1e-9);
});

test('相関: n<2 や分散0は null', () => {
  assert.strictEqual(pearson([1], [1]), null);
  assert.strictEqual(pearson([1, 1, 1], [2, 3, 4]), null);
});
```

- [ ] **Step 2: テスト失敗を確認**

Run: `node --test test/ig-stats.test.js`
Expected: FAIL（`Cannot find module '../lib/ig-stats'`）

- [ ] **Step 3: 最小実装を書く**

`lib/ig-stats.js`:

```js
'use strict';

/** 中央値。空配列は null。 */
function median(xs) {
  const a = xs.filter((v) => typeof v === 'number' && !Number.isNaN(v)).sort((x, y) => x - y);
  if (a.length === 0) return null;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

/** パーセンタイル（線形補間, p=0..100）。空配列は null。 */
function percentile(xs, p) {
  const a = xs.filter((v) => typeof v === 'number' && !Number.isNaN(v)).sort((x, y) => x - y);
  if (a.length === 0) return null;
  if (a.length === 1) return a[0];
  const idx = (p / 100) * (a.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return a[lo];
  return a[lo] + (a[hi] - a[lo]) * (idx - lo);
}

/** ペアリングして両方が有限数の組だけ残す。 */
function pairFinite(xs, ys) {
  const px = [];
  const py = [];
  for (let i = 0; i < Math.min(xs.length, ys.length); i++) {
    const x = xs[i];
    const y = ys[i];
    if (typeof x === 'number' && typeof y === 'number' && Number.isFinite(x) && Number.isFinite(y)) {
      px.push(x);
      py.push(y);
    }
  }
  return [px, py];
}

/** ピアソン相関。n<2 または分散0は null。 */
function pearson(xsRaw, ysRaw) {
  const [xs, ys] = pairFinite(xsRaw, ysRaw);
  const n = xs.length;
  if (n < 2) return null;
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let cov = 0;
  let vx = 0;
  let vy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    cov += dx * dy;
    vx += dx * dx;
    vy += dy * dy;
  }
  if (vx === 0 || vy === 0) return null;
  return cov / Math.sqrt(vx * vy);
}

/** 順位（同値は平均順位）。 */
function ranks(a) {
  const idx = a.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]);
  const r = new Array(a.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avgRank = (i + j) / 2 + 1; // 1始まり
    for (let k = i; k <= j; k++) r[idx[k][1]] = avgRank;
    i = j + 1;
  }
  return r;
}

/** スピアマン相関。順位に変換してピアソン。 */
function spearman(xsRaw, ysRaw) {
  const [xs, ys] = pairFinite(xsRaw, ysRaw);
  if (xs.length < 2) return null;
  return pearson(ranks(xs), ranks(ys));
}

module.exports = { median, percentile, pearson, spearman };
```

- [ ] **Step 4: テスト成功を確認**

Run: `node --test test/ig-stats.test.js`
Expected: PASS（全テスト）

- [ ] **Step 5: コミット**

```bash
git add lib/ig-stats.js test/ig-stats.test.js
git commit -m "feat: Instagram分析の統計ユーティリティ(median/percentile/pearson/spearman)を追加"
```

---

### Task 3: 変換ユーティリティ `lib/ig-transform.js`

**Files:**
- Create: `lib/ig-transform.js`
- Test: `test/ig-transform.test.js`

- [ ] **Step 1: 失敗するテストを書く**

`test/ig-transform.test.js`:

```js
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
```

- [ ] **Step 2: テスト失敗を確認**

Run: `node --test test/ig-transform.test.js`
Expected: FAIL（`Cannot find module '../lib/ig-transform'`）

- [ ] **Step 3: 最小実装を書く**

`lib/ig-transform.js`:

```js
'use strict';

const INSIGHT_KEYS = ['reach', 'saved', 'shares', 'total_interactions', 'profile_visits', 'follows', 'views'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** カルーセル枚数。CAROUSEL_ALBUM以外は1。 */
function carouselCount(media) {
  if (media && media.media_type === 'CAROUSEL_ALBUM' && media.children && Array.isArray(media.children.data)) {
    return media.children.data.length || 1;
  }
  return 1;
}

/** ISO8601(+0900等) から JST の date/weekday/hour を導出。 */
function deriveTimeFields(timestamp) {
  if (!timestamp) return { date: null, weekday: null, hour: null };
  const d = new Date(timestamp);
  if (Number.isNaN(d.getTime())) return { date: null, weekday: null, hour: null };
  // JST(+9)に変換
  const jst = new Date(d.getTime() + 9 * 3600 * 1000);
  const yyyy = jst.getUTCFullYear();
  const mm = String(jst.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(jst.getUTCDate()).padStart(2, '0');
  return { date: `${yyyy}-${mm}-${dd}`, weekday: WEEKDAYS[jst.getUTCDay()], hour: jst.getUTCHours() };
}

/** ハッシュタグ数。 */
function hashtagCount(caption) {
  if (!caption) return 0;
  const m = String(caption).match(/#[^\s#]+/g);
  return m ? m.length : 0;
}

/** メンション数。 */
function mentionCount(caption) {
  if (!caption) return 0;
  const m = String(caption).match(/@[^\s@]+/g);
  return m ? m.length : 0;
}

/** APIメディアオブジェクト → ig_media_raw 行。 */
function buildMediaRow(media) {
  const t = deriveTimeFields(media.timestamp);
  const childrenData = media.children && Array.isArray(media.children.data) ? media.children.data : [];
  const cc = carouselCount(media);
  return {
    media_id: media.id,
    timestamp: media.timestamp || null,
    date: t.date,
    weekday: t.weekday,
    hour: t.hour,
    permalink: media.permalink || null,
    caption: media.caption || null,
    media_type: media.media_type || null,
    media_product_type: media.media_product_type || null,
    like_count: media.like_count != null ? media.like_count : null,
    comments_count: media.comments_count != null ? media.comments_count : null,
    children_count: childrenData.length,
    carousel_count: cc,
    is_carousel: media.media_type === 'CAROUSEL_ALBUM',
    children_media_types: childrenData.map((c) => c.media_type).filter(Boolean).join(','),
  };
}

/** Insights API の data 配列 → 指標オブジェクト（未取得キーは null）。 */
function parseInsights(apiData) {
  const out = {};
  for (const k of INSIGHT_KEYS) out[k] = null;
  if (!Array.isArray(apiData)) return out;
  for (const item of apiData) {
    if (item && INSIGHT_KEYS.includes(item.name) && Array.isArray(item.values) && item.values.length) {
      const v = item.values[0].value;
      out[item.name] = typeof v === 'number' ? v : null;
    }
  }
  return out;
}

module.exports = { carouselCount, deriveTimeFields, hashtagCount, mentionCount, buildMediaRow, parseInsights, INSIGHT_KEYS };
```

- [ ] **Step 4: テスト成功を確認**

Run: `node --test test/ig-transform.test.js`
Expected: PASS（全テスト）

- [ ] **Step 5: コミット**

```bash
git add lib/ig-transform.js test/ig-transform.test.js
git commit -m "feat: Instagram取得データの変換ユーティリティを追加"
```

---

### Task 4: 分析ロジック `lib/ig-analyze.js`

**Files:**
- Create: `lib/ig-analyze.js`
- Test: `test/ig-analyze.test.js`

- [ ] **Step 1: 失敗するテストを書く**

`test/ig-analyze.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { computeFeatures, runCorrelations, topBottomCompare } = require('../lib/ig-analyze');

// media行 + insights行のフィクスチャ（最小）
const media = [
  { media_id: 'a', carousel_count: 5, comments_count: 4, like_count: 20, weekday: 'Mon', hour: 12 },
  { media_id: 'b', carousel_count: 2, comments_count: 1, like_count: 5, weekday: 'Tue', hour: 9 },
  { media_id: 'c', carousel_count: 8, comments_count: 9, like_count: 40, weekday: 'Wed', hour: 20 },
  { media_id: 'd', carousel_count: 1, comments_count: 0, like_count: 2, weekday: 'Thu', hour: 7 },
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
```

- [ ] **Step 2: テスト失敗を確認**

Run: `node --test test/ig-analyze.test.js`
Expected: FAIL（`Cannot find module '../lib/ig-analyze'`）

- [ ] **Step 3: 最小実装を書く**

`lib/ig-analyze.js`:

```js
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
    top: { n: top.n || top.length, medians: mediansOf(top), permalinks: top.map((f) => f.permalink).filter(Boolean) },
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
```

- [ ] **Step 4: テスト成功を確認**

Run: `node --test test/ig-analyze.test.js`
Expected: PASS（全テスト）

- [ ] **Step 5: コミット**

```bash
git add lib/ig-analyze.js test/ig-analyze.test.js
git commit -m "feat: Instagram分析ロジック(特徴量・相関・上位下位比較)を追加"
```

---

### Task 5: 取得スクリプト `scripts/instagram/fetch_insights.js`

**Files:**
- Create: `scripts/instagram/fetch_insights.js`

このタスクは外部I/O（Graph API / BigQuery）の薄いオーケストレーション。純粋ロジックはTask 2-4で検証済み。認証情報が未取得のため実データ実行は手順提示まで。構文・起動エラーのみ検証する。

- [ ] **Step 1: スクリプトを作成**

`scripts/instagram/fetch_insights.js`:

```js
/**
 * Instagram 投稿分析 — 公式Graph APIから投稿＋Insightsを取得し
 * BigQuery（cg_analytics.ig_*_raw）とローカルCSVへ蓄積する。
 *
 * 【事前準備】scripts/instagram/README.md を参照し .env に追記:
 *   IG_USER_ID=...
 *   IG_ACCESS_TOKEN=...
 *   IG_API_VERSION=v21.0   # 任意
 *
 * 【使い方】
 *   node scripts/instagram/fetch_insights.js               # 全件 → BQ + CSV
 *   node scripts/instagram/fetch_insights.js --limit 300   # 件数上限
 *   node scripts/instagram/fetch_insights.js --csv-only    # CSVのみ（BQ未設定時）
 *
 * 【出力】
 *   分析レポート/instagram_data/<日付>_media_raw.csv
 *   分析レポート/instagram_data/<日付>_insights_raw.csv
 */
'use strict';

require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { buildMediaRow, parseInsights } = require('../../lib/ig-transform');

const USER_ID = process.env.IG_USER_ID;
const TOKEN = process.env.IG_ACCESS_TOKEN;
const VERSION = process.env.IG_API_VERSION || 'v21.0';
const BASE = `https://graph.facebook.com/${VERSION}`;

const args = process.argv.slice(2);
const csvOnly = args.includes('--csv-only');
const limit = (() => { const i = args.indexOf('--limit'); return i >= 0 && args[i + 1] ? parseInt(args[i + 1], 10) : Infinity; })();

if (!USER_ID || !TOKEN) {
  console.error('❌ .env に IG_USER_ID / IG_ACCESS_TOKEN がありません。');
  console.error('   取得手順は scripts/instagram/README.md を参照してください。');
  process.exit(1);
}

// メディア種別でフォールバックする指標セット
const METRIC_SETS = [
  ['reach', 'saved'],
  ['shares', 'total_interactions'],
  ['profile_visits', 'follows'],
  ['views'],
];

/** 投稿一覧をページネーション全件取得。 */
async function fetchAllMedia() {
  const fields = 'id,caption,media_type,media_product_type,timestamp,permalink,like_count,comments_count,children{id,media_type}';
  let url = `${BASE}/${USER_ID}/media?fields=${encodeURIComponent(fields)}&limit=100&access_token=${TOKEN}`;
  const all = [];
  while (url && all.length < limit) {
    const res = await axios.get(url);
    all.push(...(res.data.data || []));
    url = res.data.paging && res.data.paging.next ? res.data.paging.next : null;
  }
  return all.slice(0, limit === Infinity ? undefined : limit);
}

/** 1投稿のInsightsをフォールバックしながら取得。 */
async function fetchInsights(mediaId) {
  const merged = {};
  const errors = [];
  for (const set of METRIC_SETS) {
    try {
      const url = `${BASE}/${mediaId}/insights?metric=${set.join(',')}&access_token=${TOKEN}`;
      const res = await axios.get(url);
      Object.assign(merged, parseInsights(res.data.data));
    } catch (e) {
      const msg = e.response && e.response.data && e.response.data.error ? e.response.data.error.message : e.message;
      errors.push(`${set.join(',')}: ${msg}`);
    }
  }
  const parsed = parseInsights([]); // 全キーnull初期化
  Object.assign(parsed, merged);
  parsed.media_id = mediaId;
  parsed.fetched_at = new Date().toISOString();
  parsed.insight_error = errors.length ? errors.join(' | ') : null;
  return parsed;
}

/** 配列→CSV文字列（簡易エスケープ）。 */
function toCsv(rows, columns) {
  const esc = (v) => {
    if (v == null) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.join(','), ...rows.map((r) => columns.map((c) => esc(r[c])).join(','))].join('\n');
}

async function writeBigQuery(mediaRows, insightRows) {
  const { BigQuery } = require('@google-cloud/bigquery');
  const bq = new BigQuery({ projectId: 'cg-project-491303' });
  const ds = bq.dataset('cg_analytics');
  await ds.table('ig_media_raw').insert(mediaRows, { ignoreUnknownValues: true });
  await ds.table('ig_insights_raw').insert(insightRows, { ignoreUnknownValues: true });
  console.log('✅ BigQuery へ書込: media %d / insights %d', mediaRows.length, insightRows.length);
}

async function main() {
  console.log('▶ 投稿一覧を取得中...');
  const media = await fetchAllMedia();
  console.log('  取得投稿数: %d', media.length);

  const mediaRows = media.map(buildMediaRow);
  const insightRows = [];
  let errCount = 0;
  for (const m of media) {
    const ins = await fetchInsights(m.id);
    if (ins.insight_error) errCount++;
    insightRows.push(ins);
  }
  console.log('  Insights取得完了（エラー %d 件）', errCount);

  // CSV出力
  const outDir = path.join(__dirname, '../../分析レポート/instagram_data');
  fs.mkdirSync(outDir, { recursive: true });
  const day = new Date().toISOString().slice(0, 10);
  const mediaCols = ['media_id', 'timestamp', 'date', 'weekday', 'hour', 'permalink', 'caption', 'media_type', 'media_product_type', 'like_count', 'comments_count', 'children_count', 'carousel_count', 'is_carousel', 'children_media_types'];
  const insightCols = ['media_id', 'fetched_at', 'reach', 'saved', 'shares', 'total_interactions', 'profile_visits', 'follows', 'views', 'insight_error'];
  fs.writeFileSync(path.join(outDir, `${day}_media_raw.csv`), toCsv(mediaRows, mediaCols));
  fs.writeFileSync(path.join(outDir, `${day}_insights_raw.csv`), toCsv(insightRows, insightCols));
  console.log('✅ CSV出力: %s', outDir);

  if (!csvOnly) {
    try {
      await writeBigQuery(mediaRows, insightRows);
    } catch (e) {
      console.error('⚠ BigQuery書込に失敗（CSVは出力済み）: %s', e.message);
      console.error('  BQ未設定なら --csv-only で実行してください。');
    }
  }
}

main().catch((e) => { console.error('❌ 失敗:', e.message); process.exit(1); });
```

- [ ] **Step 2: 起動エラー（認証情報チェック）を確認**

Run: `node scripts/instagram/fetch_insights.js --csv-only`
Expected: `.env` に IG_USER_ID/IG_ACCESS_TOKEN が無ければ「❌ .env に IG_USER_ID / IG_ACCESS_TOKEN がありません。」を表示し exit 1。構文エラーが出ないこと。

> 注: 実データ取得は認証情報取得後（Task 7のREADME手順）に行う。本ステップは構文・引数処理・認証ガードの検証のみ。

- [ ] **Step 3: コミット**

```bash
git add scripts/instagram/fetch_insights.js
git commit -m "feat: Instagram投稿+Insights取得スクリプトを追加"
```

---

### Task 6: 分析スクリプト `scripts/instagram/analyze.js`

**Files:**
- Create: `scripts/instagram/analyze.js`

CSV（既定）またはBigQueryから特徴量を読み、相関・上位下位比較・カルーセル別をMarkdown/CSVへ出力する薄いI/O。純粋ロジックはTask 4で検証済み。

- [ ] **Step 1: スクリプトを作成**

`scripts/instagram/analyze.js`:

```js
/**
 * Instagram 投稿分析 — 取得済みデータ（CSV or BigQuery）から
 * 相関・リーチ上位/下位比較・カルーセル枚数別を算出しレポート出力する。
 *
 * 【使い方】
 *   node scripts/instagram/analyze.js                       # 当日のCSVを自動検出
 *   node scripts/instagram/analyze.js --date 2026-06-30     # 日付指定CSV
 *   node scripts/instagram/analyze.js --min-reach 100       # 低リーチ除外しきい値
 *
 * 【出力】分析レポート/instagram_data/<日付>_分析レポート.md ＋ <日付>_scatter.csv
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { computeFeatures, runCorrelations, topBottomCompare, carouselBreakdown } = require('../../lib/ig-analyze');

const args = process.argv.slice(2);
const dateArg = (() => { const i = args.indexOf('--date'); return i >= 0 ? args[i + 1] : new Date().toISOString().slice(0, 10); })();
const minReach = (() => { const i = args.indexOf('--min-reach'); return i >= 0 && args[i + 1] ? parseInt(args[i + 1], 10) : 0; })();

const dataDir = path.join(__dirname, '../../分析レポート/instagram_data');

/** 簡易CSVパーサ（ヘッダ付き・ダブルクオート対応）。数値は自動変換。 */
function parseCsv(text) {
  const rows = [];
  const lines = text.split(/\r?\n/).filter((l) => l.length);
  if (!lines.length) return rows;
  const split = (line) => {
    const out = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') q = false;
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',') { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out;
  };
  const headers = split(lines[0]);
  for (let r = 1; r < lines.length; r++) {
    const cells = split(lines[r]);
    const obj = {};
    headers.forEach((h, i) => {
      const v = cells[i];
      if (v === '' || v == null) obj[h] = null;
      else if (/^-?\d+(\.\d+)?$/.test(v)) obj[h] = Number(v);
      else if (v === 'true' || v === 'false') obj[h] = v === 'true';
      else obj[h] = v;
    });
    rows.push(obj);
  }
  return rows;
}

function loadCsv(name) {
  const p = path.join(dataDir, name);
  if (!fs.existsSync(p)) {
    console.error('❌ CSVが見つかりません: %s', p);
    console.error('   先に node scripts/instagram/fetch_insights.js を実行してください。');
    process.exit(1);
  }
  return parseCsv(fs.readFileSync(p, 'utf8'));
}

const fmt = (v) => (v == null ? 'N/A' : (typeof v === 'number' ? (Math.abs(v) < 1 ? v.toFixed(3) : v.toFixed(2)) : v));

function main() {
  const media = loadCsv(`${dateArg}_media_raw.csv`);
  const insights = loadCsv(`${dateArg}_insights_raw.csv`);
  const features = computeFeatures(media, insights, { minReach });
  if (!features.length) {
    console.error('❌ 有効な特徴量が0件です（reach欠損やminReach除外を確認）。');
    process.exit(1);
  }

  const cors = runCorrelations(features);
  const cmp = topBottomCompare(features, 0.25);
  const breakdown = carouselBreakdown(features);

  // Markdownレポート
  const L = [];
  L.push(`# Instagram 投稿分析レポート（${dateArg}）`);
  L.push('');
  L.push('## 1. 全体サマリー');
  L.push(`- 分析対象投稿: ${features.length}件（reach欠損・minReach<${minReach}を除外）`);
  L.push('');
  L.push('## 2. 相関（Pearson / Spearman）');
  L.push('| x | y | n | Pearson | Spearman |');
  L.push('|---|---|---|---|---|');
  for (const c of cors) L.push(`| ${c.x} | ${c.y} | ${c.n} | ${fmt(c.pearson)} | ${fmt(c.spearman)} |`);
  L.push('');
  L.push('## 3. リーチ上位25% × 下位25%（中央値）');
  L.push('| 指標 | 上位25% | 下位25% |');
  L.push('|---|---|---|');
  for (const k of ['carousel_count', 'engagement_rate', 'save_rate', 'share_rate', 'hour']) {
    L.push(`| ${k} | ${fmt(cmp.top.medians[k])} | ${fmt(cmp.bottom.medians[k])} |`);
  }
  L.push('');
  L.push(`**上位25%代表投稿（n=${cmp.top.n}）:**`);
  cmp.top.permalinks.slice(0, 10).forEach((u) => L.push(`- ${u}`));
  L.push('');
  L.push(`**下位25%代表投稿（n=${cmp.bottom.n}）:**`);
  cmp.bottom.permalinks.slice(0, 10).forEach((u) => L.push(`- ${u}`));
  L.push('');
  L.push('## 4. カルーセル枚数別（中央値）');
  L.push('| 枚数 | n | engagement_rate | save_rate | reach |');
  L.push('|---|---|---|---|---|');
  for (const b of breakdown) L.push(`| ${b.carousel_count} | ${b.n} | ${fmt(b.median_engagement_rate)} | ${fmt(b.median_save_rate)} | ${fmt(b.median_reach)} |`);
  L.push('');
  L.push('## 5. 注意点');
  L.push('- 相関は因果ではない。傾向把握として読むこと。');
  L.push('- サンプル数が少ない枚数・群は結論を強く言い切らず仮説として扱う。');
  L.push('- 広告配信・キャンペーン投稿は通常投稿と性質が異なるため、別解釈が必要（MVPでは未分離）。');
  L.push('- Insights指標は反映遅延・保持期間・広告由来の扱いに制約がある。');
  L.push('');
  L.push('## 6. 次アクション（手動 → Claude）');
  L.push('- 上位25%投稿に theme_tag / hook_type を手動付与する。');
  L.push('- 引き渡し資料11章の分析プロンプトでClaudeに勝ちパターンを仮抽出させる。');

  const mdPath = path.join(dataDir, `${dateArg}_分析レポート.md`);
  fs.writeFileSync(mdPath, L.join('\n'));

  // scatter CSV
  const scatterCols = ['carousel_count', 'n', 'median_engagement_rate', 'median_save_rate', 'median_reach'];
  const scatterCsv = [scatterCols.join(','), ...breakdown.map((b) => scatterCols.map((c) => (b[c] == null ? '' : b[c])).join(','))].join('\n');
  fs.writeFileSync(path.join(dataDir, `${dateArg}_scatter.csv`), scatterCsv);

  console.log('✅ レポート出力: %s', mdPath);
  console.log(L.slice(0, 18).join('\n'));
}

main();
```

- [ ] **Step 2: フィクスチャCSVで動作確認**

一時フィクスチャを作って実行し、レポートが生成されることを確認する。

```bash
mkdir -p 分析レポート/instagram_data
cat > 分析レポート/instagram_data/2099-01-01_media_raw.csv <<'EOF'
media_id,permalink,weekday,hour,carousel_count,like_count,comments_count
a,https://insta/a,Mon,12,5,20,4
b,https://insta/b,Tue,9,2,5,1
c,https://insta/c,Wed,20,8,40,9
d,https://insta/d,Thu,7,1,2,0
EOF
cat > 分析レポート/instagram_data/2099-01-01_insights_raw.csv <<'EOF'
media_id,reach,saved,shares,total_interactions
a,1000,50,10,84
b,400,8,2,16
c,3000,300,60,409
d,200,2,0,4
EOF
node scripts/instagram/analyze.js --date 2099-01-01
```

Expected: `✅ レポート出力:` と相関表が表示され、`2099-01-01_分析レポート.md` と `2099-01-01_scatter.csv` が生成される。

- [ ] **Step 3: フィクスチャを削除**

```bash
rm 分析レポート/instagram_data/2099-01-01_*
```

- [ ] **Step 4: コミット**

```bash
git add scripts/instagram/analyze.js
git commit -m "feat: Instagram分析レポート出力スクリプトを追加"
```

---

### Task 7: 認証ガイド README ＋ npm スクリプト ＋ 全体検証

**Files:**
- Create: `scripts/instagram/README.md`
- Modify: `package.json`（scripts に ig 取得/分析を追加）

- [ ] **Step 1: README を作成**

`scripts/instagram/README.md`:

````markdown
# Instagram 投稿分析（自社アカウント・公式Graph API）

自社IGプロアカウントの投稿＋Insightsを公式Graph APIで取得し、
カルーセル枚数・エンゲージメント率・リーチの相関と上位/下位比較をレポート化する。

## 1. 認証情報の取得手順

> ⚠️ API version・指標名は変わるため、実装時は Meta for Developers 公式ドキュメントの最新版を確認すること。

### 前提
- 対象IGアカウントが **Business / Creator（プロアカウント）** であること。
- そのIGアカウントが **Facebookページ** に連携されていること。

### 手順
1. **Meta for Developers** （https://developers.facebook.com/）でアプリ作成（タイプ: Business）。
2. アプリに **Instagram Graph API** 製品を追加。
3. **Graph API Explorer** で対象ユーザーのトークンを発行し、権限を付与:
   - `instagram_basic`
   - `instagram_manage_insights`
   - `pages_read_engagement`
   - `pages_show_list`
4. **IG User ID を取得**:
   `GET /me/accounts` → 対象ページの `id` を取得 →
   `GET /{page-id}?fields=instagram_business_account` の `instagram_business_account.id` が **IG_USER_ID**。
5. **長期トークン（約60日）へ交換**:
   ```
   GET https://graph.facebook.com/v21.0/oauth/access_token
     ?grant_type=fb_exchange_token
     &client_id={app-id}
     &client_secret={app-secret}
     &fb_exchange_token={短期トークン}
   ```
   返却された `access_token` が **IG_ACCESS_TOKEN**。
6. プロジェクトルートの `.env` に追記:
   ```
   IG_USER_ID=取得したIG User ID
   IG_ACCESS_TOKEN=取得した長期トークン
   IG_API_VERSION=v21.0
   ```

> 長期トークンは約60日で失効する。失効したら手順5を再実行して `.env` を更新する。

## 2. BigQuery セットアップ（初回のみ）

`bigquery/instagram_setup.sql` を BigQuery コンソールで1ステートメントずつ実行し、
`ig_media_raw` / `ig_insights_raw` / `ig_media_features`（ビュー）を作成する。

> BigQuery を使わず CSV だけで回す場合は不要。取得時に `--csv-only` を付ける。

## 3. 使い方

```bash
# 取得（BigQuery + CSV）
npm run ig:fetch
# 取得（CSVのみ・BQ未設定時）
node scripts/instagram/fetch_insights.js --csv-only
# 件数上限
node scripts/instagram/fetch_insights.js --limit 300

# 分析（当日のCSVを自動検出 → Markdown/CSVレポート）
npm run ig:analyze
# 低リーチ投稿を除外
node scripts/instagram/analyze.js --min-reach 100
```

出力先: `分析レポート/instagram_data/`
- `<日付>_media_raw.csv` / `<日付>_insights_raw.csv` … 取得生データ
- `<日付>_分析レポート.md` … 相関・上位下位比較・カルーセル別
- `<日付>_scatter.csv` … カルーセル枚数別の散布図用データ

## 4. MVPの範囲と次フェーズ

- **MVP（本実装）**: 取得 → 相関 → リーチ上位/下位比較 → カルーセル枚数別まで。
- **次フェーズ**: 全投稿の自動タグ付け（theme_tag/hook_type）、回帰分析、winning_patterns自動生成、ダッシュボードタブ化。
- レポートの「次アクション」に従い、上位投稿を手動タグ付け → 引き渡し資料11章のプロンプトでClaudeに勝ちパターンを仮抽出させる。
````

- [ ] **Step 2: package.json に npm スクリプトを追加**

`package.json` の `scripts` に2行追加する（既存の `cockpit` 行の後など）:

```json
    "ig:fetch": "node scripts/instagram/fetch_insights.js",
    "ig:analyze": "node scripts/instagram/analyze.js",
```

- [ ] **Step 3: 全テスト実行**

Run: `npm test`
Expected: ig-stats / ig-transform / ig-analyze を含む全テストが PASS（既存テストも壊さない）。

- [ ] **Step 4: コミット**

```bash
git add scripts/instagram/README.md package.json
git commit -m "docs: Instagram分析の認証ガイドREADMEとnpmスクリプトを追加"
```

---

## 完了条件

- [ ] `npm test` が全PASS（ig-stats / ig-transform / ig-analyze）。
- [ ] `node scripts/instagram/fetch_insights.js --csv-only` が認証情報未設定時に明確なエラーで停止。
- [ ] フィクスチャCSVで `analyze.js` がMarkdown/CSVレポートを生成。
- [ ] `bigquery/instagram_setup.sql` が既存SQL規約に沿う。
- [ ] README に認証情報取得〜使い方が記載され、トークン未取得の山口さんが自走できる。

## 動作確認（認証情報取得後）

1. README手順で `.env` に `IG_USER_ID` / `IG_ACCESS_TOKEN` を設定。
2. （任意）`bigquery/instagram_setup.sql` を実行。
3. `npm run ig:fetch`（BQ未設定なら `--csv-only`）→ CSV生成を確認。
4. `npm run ig:analyze` → 分析レポート生成を確認。
