/**
 * Trepo BigQuery 初期セットアップスクリプト
 *
 * 実行方法:
 *   node trepo/setup_bigquery.js --project=YOUR_PROJECT_ID
 *
 * 事前に必要な認証:
 *   gcloud auth application-default login
 */

const { BigQuery } = require('@google-cloud/bigquery');
const fs = require('fs');
const path = require('path');

// コマンドライン引数からプロジェクトIDを取得
const args = process.argv.slice(2);
const projectArg = args.find(a => a.startsWith('--project='));
const PROJECT_ID = projectArg ? projectArg.split('=')[1] : process.env.GCLOUD_PROJECT;

if (!PROJECT_ID) {
  console.error('❌ プロジェクトIDを指定してください: node trepo/setup_bigquery.js --project=YOUR_PROJECT_ID');
  process.exit(1);
}

const DATASET_ID = 'trepo_analytics';
const LOCATION   = 'asia-northeast1';
const DATA_DIR   = path.join(__dirname, 'data');

const bq = new BigQuery({ projectId: PROJECT_ID });

// ============================================================
// メイン処理
// ============================================================
async function main() {
  console.log(`\n🚀 Trepo BigQuery セットアップ開始`);
  console.log(`   プロジェクト: ${PROJECT_ID}`);
  console.log(`   データセット: ${DATASET_ID}`);
  console.log(`   ロケーション: ${LOCATION}\n`);

  await createDataset();
  await createTables();
  await importRankDefinitions();
  await importRankQuantConditions();

  console.log('\n✅ セットアップ完了！');
  console.log(`   BigQuery Console: https://console.cloud.google.com/bigquery?project=${PROJECT_ID}`);
}

// ============================================================
// データセット作成
// ============================================================
async function createDataset() {
  process.stdout.write('📦 データセット作成中... ');
  const dataset = bq.dataset(DATASET_ID);
  const [exists] = await dataset.exists();

  if (exists) {
    console.log('既存のデータセットを使用します（スキップ）');
    return;
  }

  await bq.createDataset(DATASET_ID, { location: LOCATION });
  console.log('✅ 作成完了');
}

// ============================================================
// テーブル作成
// ============================================================
async function createTables() {
  console.log('\n📋 テーブル作成中...');

  const tables = [
    { id: 'trepo_rank_definitions',      schema: RANK_DEF_SCHEMA },
    { id: 'trepo_rank_quant_conditions', schema: RANK_QUANT_SCHEMA },
    { id: 'trepo_rank_qual_conditions',  schema: RANK_QUAL_SCHEMA },
    { id: 'trepo_members',               schema: MEMBERS_SCHEMA },
    { id: 'trepo_rank_evaluations',      schema: RANK_EVAL_SCHEMA },
    { id: 'trepo_articles',              schema: ARTICLES_SCHEMA },
    { id: 'trepo_article_pv',            schema: ARTICLE_PV_SCHEMA,   timePartitioning: { type: 'DAY', field: 'date' } },
    { id: 'trepo_ig_schedule',           schema: IG_SCHEDULE_SCHEMA },
    { id: 'trepo_ig_posts',              schema: IG_POSTS_SCHEMA,     timePartitioning: { type: 'DAY', field: 'posted_at' } },
    { id: 'trepo_expenses',              schema: EXPENSES_SCHEMA },
    { id: 'trepo_equipment_requests',    schema: EQUIPMENT_SCHEMA },
    { id: 'trepo_daily_reports',         schema: DAILY_REPORTS_SCHEMA },
    { id: 'trepo_shifts',                schema: SHIFTS_SCHEMA },
    { id: 'trepo_article_reports',       schema: ARTICLE_REPORTS_SCHEMA },
  ];

  const dataset = bq.dataset(DATASET_ID);

  for (const { id, schema, timePartitioning } of tables) {
    process.stdout.write(`   ${id}... `);
    const table = dataset.table(id);
    const [exists] = await table.exists();

    if (exists) {
      console.log('スキップ（既存）');
      continue;
    }

    const options = { schema };
    if (timePartitioning) options.timePartitioning = timePartitioning;

    await dataset.createTable(id, options);
    console.log('✅ 作成');
  }
}

// ============================================================
// ランク定義データのインポート
// ============================================================
async function importRankDefinitions() {
  process.stdout.write('\n📥 ランク定義データをインポート中... ');
  const data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'rank_definitions.json'), 'utf8'));
  const table = bq.dataset(DATASET_ID).table('trepo_rank_definitions');
  await table.insert(data);
  console.log(`✅ ${data.length}件 インポート完了`);
}

async function importRankQuantConditions() {
  process.stdout.write('📥 ランク定量条件をインポート中... ');
  const data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'rank_quant_conditions.json'), 'utf8'));
  const table = bq.dataset(DATASET_ID).table('trepo_rank_quant_conditions');
  await table.insert(data);
  console.log(`✅ ${data.length}件 インポート完了`);
}

// ============================================================
// スキーマ定義
// ============================================================
const RANK_DEF_SCHEMA = [
  { name: 'rank_id',           type: 'INTEGER', mode: 'REQUIRED' },
  { name: 'rank_name',         type: 'STRING',  mode: 'REQUIRED' },
  { name: 'rank_label',        type: 'STRING',  mode: 'NULLABLE' },
  { name: 'hourly_rate',       type: 'INTEGER', mode: 'REQUIRED' },
  { name: 'incentive_rate',    type: 'FLOAT',   mode: 'REQUIRED' },
  { name: 'ig_summary_bonus',  type: 'INTEGER', mode: 'REQUIRED' },
  { name: 'short_video_bonus', type: 'INTEGER', mode: 'REQUIRED' },
  { name: 'salary_cap',        type: 'INTEGER', mode: 'NULLABLE' },
  { name: 'perk_description',  type: 'STRING',  mode: 'NULLABLE' },
  { name: 'updated_at',        type: 'TIMESTAMP', mode: 'NULLABLE' },
];

const RANK_QUANT_SCHEMA = [
  { name: 'condition_id',     type: 'INTEGER', mode: 'REQUIRED' },
  { name: 'rank_id',          type: 'INTEGER', mode: 'REQUIRED' },
  { name: 'condition_key',    type: 'STRING',  mode: 'REQUIRED' },
  { name: 'condition_label',  type: 'STRING',  mode: 'REQUIRED' },
  { name: 'threshold_value',  type: 'FLOAT',   mode: 'NULLABLE' },
  { name: 'threshold_unit',   type: 'STRING',  mode: 'NULLABLE' },
  { name: 'logic_group',      type: 'STRING',  mode: 'NULLABLE' },
  { name: 'logic_type',       type: 'STRING',  mode: 'NULLABLE' },
  { name: 'is_flag',          type: 'BOOLEAN', mode: 'REQUIRED' },
  { name: 'flag_description', type: 'STRING',  mode: 'NULLABLE' },
  { name: 'notes',            type: 'STRING',  mode: 'NULLABLE' },
];

const RANK_QUAL_SCHEMA = [
  { name: 'condition_id',    type: 'INTEGER', mode: 'REQUIRED' },
  { name: 'rank_id',         type: 'INTEGER', mode: 'REQUIRED' },
  { name: 'condition_label', type: 'STRING',  mode: 'REQUIRED' },
  { name: 'category',        type: 'STRING',  mode: 'NULLABLE' },
  { name: 'is_common',       type: 'BOOLEAN', mode: 'REQUIRED' },
];

const MEMBERS_SCHEMA = [
  { name: 'member_id',       type: 'STRING',    mode: 'REQUIRED' },
  { name: 'display_name',    type: 'STRING',    mode: 'REQUIRED' },
  { name: 'email',           type: 'STRING',    mode: 'REQUIRED' },
  { name: 'role',            type: 'STRING',    mode: 'REQUIRED' },
  { name: 'current_rank_id', type: 'INTEGER',   mode: 'NULLABLE' },
  { name: 'joined_date',     type: 'DATE',      mode: 'NULLABLE' },
  { name: 'is_active',       type: 'BOOLEAN',   mode: 'REQUIRED' },
  { name: 'updated_at',      type: 'TIMESTAMP', mode: 'NULLABLE' },
];

const RANK_EVAL_SCHEMA = [
  { name: 'evaluation_id',            type: 'STRING',    mode: 'REQUIRED' },
  { name: 'member_id',                type: 'STRING',    mode: 'REQUIRED' },
  { name: 'evaluated_by',             type: 'STRING',    mode: 'REQUIRED' },
  { name: 'evaluation_date',          type: 'DATE',      mode: 'REQUIRED' },
  { name: 'target_rank_id',           type: 'INTEGER',   mode: 'REQUIRED' },
  { name: 'flag_retouch_trained',     type: 'BOOLEAN',   mode: 'NULLABLE' },
  { name: 'flag_steel_trained',       type: 'BOOLEAN',   mode: 'NULLABLE' },
  { name: 'flag_dslr_ok',             type: 'BOOLEAN',   mode: 'NULLABLE' },
  { name: 'flag_solo_interview_ok',   type: 'BOOLEAN',   mode: 'NULLABLE' },
  { name: 'flag_no_content_check',    type: 'BOOLEAN',   mode: 'NULLABLE' },
  { name: 'score_attitude',           type: 'INTEGER',   mode: 'NULLABLE' },
  { name: 'score_teamwork',           type: 'INTEGER',   mode: 'NULLABLE' },
  { name: 'score_communication',      type: 'INTEGER',   mode: 'NULLABLE' },
  { name: 'score_management',         type: 'INTEGER',   mode: 'NULLABLE' },
  { name: 'score_flexibility',        type: 'INTEGER',   mode: 'NULLABLE' },
  { name: 'score_responsibility',     type: 'INTEGER',   mode: 'NULLABLE' },
  { name: 'overall_comment',          type: 'STRING',    mode: 'NULLABLE' },
  { name: 'is_promotion_approved',    type: 'BOOLEAN',   mode: 'NULLABLE' },
  { name: 'has_violation',            type: 'BOOLEAN',   mode: 'NULLABLE' },
  { name: 'created_at',               type: 'TIMESTAMP', mode: 'NULLABLE' },
];

const ARTICLES_SCHEMA = [
  { name: 'article_id',     type: 'STRING',    mode: 'REQUIRED' },
  { name: 'title',          type: 'STRING',    mode: 'REQUIRED' },
  { name: 'author_id',      type: 'STRING',    mode: 'REQUIRED' },
  { name: 'category',       type: 'STRING',    mode: 'NULLABLE' },
  { name: 'published_date', type: 'DATE',      mode: 'NULLABLE' },
  { name: 'url',            type: 'STRING',    mode: 'NULLABLE' },
  { name: 'is_pickup',      type: 'BOOLEAN',   mode: 'NULLABLE' },
  { name: 'is_tieup',       type: 'BOOLEAN',   mode: 'NULLABLE' },
  { name: 'status',         type: 'STRING',    mode: 'NULLABLE' },
  { name: 'created_at',     type: 'TIMESTAMP', mode: 'NULLABLE' },
  { name: 'updated_at',     type: 'TIMESTAMP', mode: 'NULLABLE' },
];

const ARTICLE_PV_SCHEMA = [
  { name: 'date',         type: 'DATE',    mode: 'REQUIRED' },
  { name: 'article_id',   type: 'STRING',  mode: 'REQUIRED' },
  { name: 'page_path',    type: 'STRING',  mode: 'REQUIRED' },
  { name: 'sessions',     type: 'INTEGER', mode: 'NULLABLE' },
  { name: 'page_views',   type: 'INTEGER', mode: 'NULLABLE' },
  { name: 'unique_users', type: 'INTEGER', mode: 'NULLABLE' },
];

const IG_SCHEDULE_SCHEMA = [
  { name: 'schedule_id',   type: 'STRING',    mode: 'REQUIRED' },
  { name: 'post_date',     type: 'DATE',      mode: 'REQUIRED' },
  { name: 'member_id',     type: 'STRING',    mode: 'REQUIRED' },
  { name: 'content_title', type: 'STRING',    mode: 'NULLABLE' },
  { name: 'content_type',  type: 'STRING',    mode: 'NULLABLE' },
  { name: 'status',        type: 'STRING',    mode: 'NULLABLE' },
  { name: 'notes',         type: 'STRING',    mode: 'NULLABLE' },
  { name: 'created_at',    type: 'TIMESTAMP', mode: 'NULLABLE' },
  { name: 'updated_at',    type: 'TIMESTAMP', mode: 'NULLABLE' },
];

const IG_POSTS_SCHEMA = [
  { name: 'post_id',      type: 'STRING',    mode: 'REQUIRED' },
  { name: 'member_id',    type: 'STRING',    mode: 'NULLABLE' },
  { name: 'posted_at',    type: 'TIMESTAMP', mode: 'NULLABLE' },
  { name: 'media_type',   type: 'STRING',    mode: 'NULLABLE' },
  { name: 'caption',      type: 'STRING',    mode: 'NULLABLE' },
  { name: 'permalink',    type: 'STRING',    mode: 'NULLABLE' },
  { name: 'like_count',   type: 'INTEGER',   mode: 'NULLABLE' },
  { name: 'comments_count', type: 'INTEGER', mode: 'NULLABLE' },
  { name: 'reach',        type: 'INTEGER',   mode: 'NULLABLE' },
  { name: 'impressions',  type: 'INTEGER',   mode: 'NULLABLE' },
  { name: 'saved',        type: 'INTEGER',   mode: 'NULLABLE' },
  { name: 'plays',        type: 'INTEGER',   mode: 'NULLABLE' },
  { name: 'synced_at',    type: 'TIMESTAMP', mode: 'NULLABLE' },
];

const EXPENSES_SCHEMA = [
  { name: 'expense_id',    type: 'STRING',    mode: 'REQUIRED' },
  { name: 'member_id',     type: 'STRING',    mode: 'REQUIRED' },
  { name: 'applied_date',  type: 'DATE',      mode: 'REQUIRED' },
  { name: 'amount',        type: 'INTEGER',   mode: 'REQUIRED' },
  { name: 'category',      type: 'STRING',    mode: 'NULLABLE' },
  { name: 'description',   type: 'STRING',    mode: 'NULLABLE' },
  { name: 'receipt_url',   type: 'STRING',    mode: 'NULLABLE' },
  { name: 'status',        type: 'STRING',    mode: 'NULLABLE' },
  { name: 'reviewed_by',   type: 'STRING',    mode: 'NULLABLE' },
  { name: 'reviewed_at',   type: 'TIMESTAMP', mode: 'NULLABLE' },
  { name: 'created_at',    type: 'TIMESTAMP', mode: 'NULLABLE' },
];

const EQUIPMENT_SCHEMA = [
  { name: 'request_id',   type: 'STRING',    mode: 'REQUIRED' },
  { name: 'member_id',    type: 'STRING',    mode: 'REQUIRED' },
  { name: 'applied_date', type: 'DATE',      mode: 'REQUIRED' },
  { name: 'item_name',    type: 'STRING',    mode: 'REQUIRED' },
  { name: 'quantity',     type: 'INTEGER',   mode: 'NULLABLE' },
  { name: 'purpose',      type: 'STRING',    mode: 'NULLABLE' },
  { name: 'status',       type: 'STRING',    mode: 'NULLABLE' },
  { name: 'reviewed_by',  type: 'STRING',    mode: 'NULLABLE' },
  { name: 'reviewed_at',  type: 'TIMESTAMP', mode: 'NULLABLE' },
  { name: 'created_at',   type: 'TIMESTAMP', mode: 'NULLABLE' },
];

const DAILY_REPORTS_SCHEMA = [
  { name: 'report_id',       type: 'STRING',    mode: 'REQUIRED' },
  { name: 'member_id',       type: 'STRING',    mode: 'REQUIRED' },
  { name: 'report_date',     type: 'DATE',      mode: 'REQUIRED' },
  { name: 'work_hours',      type: 'FLOAT',     mode: 'NULLABLE' },
  { name: 'tasks_done',      type: 'STRING',    mode: 'NULLABLE' },
  { name: 'issues',          type: 'STRING',    mode: 'NULLABLE' },
  { name: 'next_actions',    type: 'STRING',    mode: 'NULLABLE' },
  { name: 'created_at',      type: 'TIMESTAMP', mode: 'NULLABLE' },
];

const SHIFTS_SCHEMA = [
  { name: 'shift_id',    type: 'STRING',    mode: 'REQUIRED' },
  { name: 'member_id',   type: 'STRING',    mode: 'REQUIRED' },
  { name: 'shift_date',  type: 'DATE',      mode: 'REQUIRED' },
  { name: 'start_time',  type: 'STRING',    mode: 'NULLABLE' },
  { name: 'end_time',    type: 'STRING',    mode: 'NULLABLE' },
  { name: 'location',    type: 'STRING',    mode: 'NULLABLE' },
  { name: 'status',      type: 'STRING',    mode: 'NULLABLE' },
  { name: 'notes',       type: 'STRING',    mode: 'NULLABLE' },
  { name: 'created_at',  type: 'TIMESTAMP', mode: 'NULLABLE' },
];

const ARTICLE_REPORTS_SCHEMA = [
  { name: 'report_id',      type: 'STRING',    mode: 'REQUIRED' },
  { name: 'member_id',      type: 'STRING',    mode: 'REQUIRED' },
  { name: 'article_id',     type: 'STRING',    mode: 'NULLABLE' },
  { name: 'reported_date',  type: 'DATE',      mode: 'REQUIRED' },
  { name: 'article_title',  type: 'STRING',    mode: 'NULLABLE' },
  { name: 'category',       type: 'STRING',    mode: 'NULLABLE' },
  { name: 'word_count',     type: 'INTEGER',   mode: 'NULLABLE' },
  { name: 'interview_done', type: 'BOOLEAN',   mode: 'NULLABLE' },
  { name: 'photo_taken',    type: 'BOOLEAN',   mode: 'NULLABLE' },
  { name: 'memo',           type: 'STRING',    mode: 'NULLABLE' },
  { name: 'status',         type: 'STRING',    mode: 'NULLABLE' },
  { name: 'created_at',     type: 'TIMESTAMP', mode: 'NULLABLE' },
];

main().catch(err => {
  console.error('\n❌ エラーが発生しました:', err.message);
  if (err.errors) {
    err.errors.forEach(e => console.error('  -', e.message || JSON.stringify(e)));
  }
  process.exit(1);
});
