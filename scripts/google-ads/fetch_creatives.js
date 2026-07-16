'use strict';
/**
 * Google Ads の ad(creative) 日次KPIを取得し BigQuery(cg_analytics.ad_creative_daily) へ書き込む。
 * 仕様: docs/superpowers/specs/2026-07-10-kizuki-word-cycle-phase3-slice1-ad-ingest.md
 * 認証(.env): GOOGLE_ADS_DEVELOPER_TOKEN / GOOGLE_ADS_CLIENT_ID / GOOGLE_ADS_CLIENT_SECRET /
 *            GOOGLE_ADS_REFRESH_TOKEN / GOOGLE_ADS_CUSTOMER_ID / GOOGLE_ADS_LOGIN_CUSTOMER_ID
 * 使い方: node scripts/google-ads/fetch_creatives.js [--date YYYY-MM-DD] [--dry-run]
 */
require('dotenv').config({ override: true });

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const dateIdx = args.indexOf('--date');
const DATE = dateIdx >= 0 ? args[dateIdx + 1] : null; // 未指定は運用側で前日を渡す

const BQ_PROJECT = process.env.BQ_PROJECT || 'cg-project-491303';
const BQ_DATASET = process.env.BQ_DATASET || 'cg_analytics';

/** Google Ads から creative 日次行を取得。GAQL: ad_group_ad の指標を date 指定で。 */
async function fetchFromGoogleAds(date) {
  const { GoogleAdsApi } = require('google-ads-api');
  const client = new GoogleAdsApi({
    client_id: process.env.GOOGLE_ADS_CLIENT_ID,
    client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET,
    developer_token: process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
  });
  const customer = client.Customer({
    customer_id: process.env.GOOGLE_ADS_CUSTOMER_ID,
    login_customer_id: process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID,
    refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN,
  });
  const rows = await customer.query(`
    SELECT ad_group_ad.ad.id, campaign.name,
           metrics.impressions, metrics.clicks, metrics.conversions,
           metrics.cost_micros, metrics.conversions_value
    FROM ad_group_ad
    WHERE segments.date = '${date}'`);
  return rows.map((r) => ({
    date,
    creative_id: String(r.ad_group_ad.ad.id),
    campaign: r.campaign.name || '',
    impressions: Number(r.metrics.impressions || 0),
    clicks: Number(r.metrics.clicks || 0),
    conversions: Number(r.metrics.conversions || 0),
    cost: Number(r.metrics.cost_micros || 0) / 1e6, // micros→円
    revenue: Number(r.metrics.conversions_value || 0),
    demographics: '', // creative粒度デモグラは別ビュー。スライス1はベストエフォートで空
  }));
}

async function writeBigQuery(rows) {
  const { BigQuery } = require('@google-cloud/bigquery');
  const bq = new BigQuery({ projectId: BQ_PROJECT });
  await bq.dataset(BQ_DATASET).table('ad_creative_daily').insert(rows, { ignoreUnknownValues: true });
  console.log('✅ BigQuery へ書込: %d行', rows.length);
}

async function main() {
  if (DRY_RUN) {
    console.log('DRY-RUN: date=%s / project=%s.%s（Google Ads呼び出し・BQ書込はしない）', DATE || '(未指定)', BQ_PROJECT, BQ_DATASET);
    return;
  }
  if (!DATE) throw new Error('--date YYYY-MM-DD を指定してください（運用側で前日を渡す）');
  const rows = await fetchFromGoogleAds(DATE);
  if (!rows.length) { console.log('取得0行'); return; }
  await writeBigQuery(rows);
}

main().catch((e) => { console.error('❌ fetch_creatives 失敗:', e.message); process.exit(1); });
