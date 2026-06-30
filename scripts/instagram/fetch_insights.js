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
  return limit === Infinity ? all : all.slice(0, limit);
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
