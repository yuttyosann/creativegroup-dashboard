-- ============================================================
-- Trepo Analytics — BigQuery 完全セットアップSQL
-- 実行方法: BigQueryコンソール(console.cloud.google.com/bigquery)で
--           このファイルの内容を「クエリを編集」に貼り付けて実行
-- プロジェクトID: cg-project-491303
-- ============================================================

-- ※ BigQueryはセミコロン区切りで複数ステートメントを実行できます
-- ※ 「実行」ボタンを押すだけでOKです

-- ============================================================
-- STEP 1: テーブル作成
-- ============================================================

CREATE TABLE IF NOT EXISTS `cg-project-491303.trepo_analytics.trepo_rank_definitions` (
  rank_id           INT64    NOT NULL,
  rank_name         STRING   NOT NULL,
  rank_label        STRING,
  hourly_rate       INT64    NOT NULL,
  incentive_rate    FLOAT64  NOT NULL,
  ig_summary_bonus  INT64    NOT NULL,
  short_video_bonus INT64    NOT NULL,
  salary_cap        INT64,
  perk_description  STRING,
  updated_at        TIMESTAMP
);

CREATE TABLE IF NOT EXISTS `cg-project-491303.trepo_analytics.trepo_rank_quant_conditions` (
  condition_id      INT64    NOT NULL,
  rank_id           INT64    NOT NULL,
  condition_key     STRING   NOT NULL,
  condition_label   STRING   NOT NULL,
  threshold_value   FLOAT64,
  threshold_unit    STRING,
  logic_group       STRING,
  logic_type        STRING,
  is_flag           BOOL     NOT NULL,
  flag_description  STRING,
  notes             STRING
);

CREATE TABLE IF NOT EXISTS `cg-project-491303.trepo_analytics.trepo_rank_qual_conditions` (
  condition_id    INT64  NOT NULL,
  rank_id         INT64  NOT NULL,
  condition_label STRING NOT NULL,
  category        STRING,
  is_common       BOOL   NOT NULL
);

CREATE TABLE IF NOT EXISTS `cg-project-491303.trepo_analytics.trepo_members` (
  member_id       STRING    NOT NULL,
  display_name    STRING    NOT NULL,
  email           STRING    NOT NULL,
  role            STRING    NOT NULL,
  current_rank_id INT64,
  joined_date     DATE,
  is_active       BOOL      NOT NULL,
  updated_at      TIMESTAMP
);

CREATE TABLE IF NOT EXISTS `cg-project-491303.trepo_analytics.trepo_rank_evaluations` (
  evaluation_id            STRING    NOT NULL,
  member_id                STRING    NOT NULL,
  evaluated_by             STRING    NOT NULL,
  evaluation_date          DATE      NOT NULL,
  target_rank_id           INT64     NOT NULL,
  flag_retouch_trained     BOOL,
  flag_steel_trained       BOOL,
  flag_dslr_ok             BOOL,
  flag_solo_interview_ok   BOOL,
  flag_no_content_check    BOOL,
  score_attitude           INT64,
  score_teamwork           INT64,
  score_communication      INT64,
  score_management         INT64,
  score_flexibility        INT64,
  score_responsibility     INT64,
  overall_comment          STRING,
  is_promotion_approved    BOOL,
  has_violation            BOOL,
  created_at               TIMESTAMP
);

CREATE TABLE IF NOT EXISTS `cg-project-491303.trepo_analytics.trepo_articles` (
  article_id      STRING    NOT NULL,
  title           STRING    NOT NULL,
  author_id       STRING    NOT NULL,
  category        STRING,
  published_date  DATE,
  url             STRING,
  is_pickup       BOOL,
  is_tieup        BOOL,
  status          STRING,
  created_at      TIMESTAMP,
  updated_at      TIMESTAMP
);

CREATE TABLE IF NOT EXISTS `cg-project-491303.trepo_analytics.trepo_article_pv`
PARTITION BY date
AS SELECT
  CAST(NULL AS DATE)    AS date,
  CAST(NULL AS STRING)  AS article_id,
  CAST(NULL AS STRING)  AS page_path,
  CAST(NULL AS INT64)   AS sessions,
  CAST(NULL AS INT64)   AS page_views,
  CAST(NULL AS INT64)   AS unique_users
WHERE FALSE;

CREATE TABLE IF NOT EXISTS `cg-project-491303.trepo_analytics.trepo_ig_schedule` (
  schedule_id   STRING    NOT NULL,
  post_date     DATE      NOT NULL,
  member_id     STRING    NOT NULL,
  content_title STRING,
  content_type  STRING,
  status        STRING,
  notes         STRING,
  created_at    TIMESTAMP,
  updated_at    TIMESTAMP
);

CREATE TABLE IF NOT EXISTS `cg-project-491303.trepo_analytics.trepo_ig_posts`
PARTITION BY DATE(posted_at)
AS SELECT
  CAST(NULL AS STRING)    AS post_id,
  CAST(NULL AS STRING)    AS member_id,
  CAST(NULL AS TIMESTAMP) AS posted_at,
  CAST(NULL AS STRING)    AS media_type,
  CAST(NULL AS STRING)    AS caption,
  CAST(NULL AS STRING)    AS permalink,
  CAST(NULL AS INT64)     AS like_count,
  CAST(NULL AS INT64)     AS comments_count,
  CAST(NULL AS INT64)     AS reach,
  CAST(NULL AS INT64)     AS impressions,
  CAST(NULL AS INT64)     AS saved,
  CAST(NULL AS INT64)     AS plays,
  CAST(NULL AS TIMESTAMP) AS synced_at
WHERE FALSE;

CREATE TABLE IF NOT EXISTS `cg-project-491303.trepo_analytics.trepo_expenses` (
  expense_id   STRING    NOT NULL,
  member_id    STRING    NOT NULL,
  applied_date DATE      NOT NULL,
  amount       INT64     NOT NULL,
  category     STRING,
  description  STRING,
  receipt_url  STRING,
  status       STRING,
  reviewed_by  STRING,
  reviewed_at  TIMESTAMP,
  created_at   TIMESTAMP
);

CREATE TABLE IF NOT EXISTS `cg-project-491303.trepo_analytics.trepo_equipment_requests` (
  request_id   STRING    NOT NULL,
  member_id    STRING    NOT NULL,
  applied_date DATE      NOT NULL,
  item_name    STRING    NOT NULL,
  quantity     INT64,
  purpose      STRING,
  status       STRING,
  reviewed_by  STRING,
  reviewed_at  TIMESTAMP,
  created_at   TIMESTAMP
);

CREATE TABLE IF NOT EXISTS `cg-project-491303.trepo_analytics.trepo_daily_reports` (
  report_id    STRING    NOT NULL,
  member_id    STRING    NOT NULL,
  report_date  DATE      NOT NULL,
  work_hours   FLOAT64,
  tasks_done   STRING,
  issues       STRING,
  next_actions STRING,
  created_at   TIMESTAMP
);

CREATE TABLE IF NOT EXISTS `cg-project-491303.trepo_analytics.trepo_shifts` (
  shift_id    STRING    NOT NULL,
  member_id   STRING    NOT NULL,
  shift_date  DATE      NOT NULL,
  start_time  STRING,
  end_time    STRING,
  location    STRING,
  status      STRING,
  notes       STRING,
  created_at  TIMESTAMP
);

CREATE TABLE IF NOT EXISTS `cg-project-491303.trepo_analytics.trepo_article_reports` (
  report_id      STRING    NOT NULL,
  member_id      STRING    NOT NULL,
  article_id     STRING,
  reported_date  DATE      NOT NULL,
  article_title  STRING,
  category       STRING,
  word_count     INT64,
  interview_done BOOL,
  photo_taken    BOOL,
  memo           STRING,
  status         STRING,
  created_at     TIMESTAMP
);

-- ============================================================
-- STEP 2: ランク定義データ投入
-- ============================================================

INSERT INTO `cg-project-491303.trepo_analytics.trepo_rank_definitions`
  (rank_id, rank_name, rank_label, hourly_rate, incentive_rate, ig_summary_bonus, short_video_bonus, salary_cap, perk_description)
VALUES
  (1, '研修生',           NULL,       1260, 0.00, 2000, 3000, 50000, NULL),
  (2, 'ジュニアII',       NULL,       1260, 0.01, 2000, 3000, 50000, 'インセンティブが発生するようになる'),
  (3, 'ジュニアI',        NULL,       1300, 0.01, 2000, 3000, NULL,  '時給での給料の上限がなくなる'),
  (4, 'ミドルII',         NULL,       1350, 0.03, 2500, 3500, NULL,  '自宅出勤が可能（シフト20時間/月は維持）'),
  (5, 'ミドルI',          'リーダー', 1400, 0.03, 2500, 3500, NULL,  'タイアップ案件など優先的に案内'),
  (6, 'シニア',           '副編集長', 1500, 0.05, 3000, 4000, NULL,  NULL),
  (7, 'プロフェッショナル','編集長',   1700, 0.07, 3000, 4000, NULL,  NULL);

-- ============================================================
-- STEP 3: ランク定量条件データ投入
-- ============================================================

INSERT INTO `cg-project-491303.trepo_analytics.trepo_rank_quant_conditions`
  (condition_id, rank_id, condition_key, condition_label, threshold_value, threshold_unit, logic_group, logic_type, is_flag, flag_description, notes)
VALUES
  -- 研修生
  (101, 1, 'basic_tasks_done',      'Trepoの一通りの業務をこなしている（オリジナル記事・芸能記事・レビュー記事・取材同行・リール制作・フィード投稿・メール）', NULL,  NULL,      'basic',    'AND', TRUE,  '社員が確認・承認',                 NULL),
  -- ジュニアII
  (201, 2, 'basic_writing_ok',      'Trepoの基本ルールを理解し、指示がなくても一定レベルの記事が書ける',   NULL,  NULL,      'basic',    'AND', TRUE,  '社員が確認・承認',                 NULL),
  (202, 2, 'steel_training_done',   'スチール研修受講済み',                                                NULL,  NULL,      'basic',    'AND', TRUE,  'スチール研修受講フラグ',           NULL),
  -- ジュニアI
  (301, 3, 'monthly_articles',      '月間記事本数 8本以上',                                               8,     '本/月',   'articles', 'AND', FALSE, NULL,                              'trepo_articlesから自動集計'),
  (302, 3, 'monthly_pv',            '月間PV数 2,500以上',                                                 2500,  'PV/月',   'pv_or_ig', 'OR',  FALSE, NULL,                              '月間PV（当月）'),
  (303, 3, 'ig_posts_over_500likes','Instagramいいね500以上の投稿 1本以上（当月）',                       1,     '本',      'pv_or_ig', 'OR',  FALSE, NULL,                              'いいね閾値: 500・当月投稿分'),
  (304, 3, 'retouch_training_done', 'レタッチ研修受講済み',                                               NULL,  NULL,      'skill',    'AND', TRUE,  'レタッチ研修受講フラグ',           NULL),
  (305, 3, 'dslr_basic_ok',         '一眼レフの基本的な撮影ができる',                                     NULL,  NULL,      'skill',    'AND', TRUE,  '社員による撮影スキル確認',         NULL),
  -- ミドルII
  (401, 4, 'monthly_pv',            '月間PV数 10,000以上',                                                10000, 'PV/月',   'pv_or_ig', 'OR',  FALSE, NULL,                              '月間PV（当月）'),
  (402, 4, 'ig_posts_over_500likes','Instagramいいね500以上の投稿 2本以上（当月）',                       2,     '本',      'pv_or_ig', 'OR',  FALSE, NULL,                              'いいね閾値: 500・当月投稿分'),
  (403, 4, 'no_content_check_needed','コンテンツシートのチェックが不要になった',                          NULL,  NULL,      'skill',    'AND', TRUE,  '社員がコンテンツチェック不要認定', NULL),
  (404, 4, 'dslr_stable_ok',        '一眼レフの写真が安定してOK',                                        NULL,  NULL,      'skill',    'AND', TRUE,  '社員による写真スキル安定確認',     NULL),
  (405, 4, 'solo_interview_ok',     '1人で芸能取材が可能（ペン＆スチール＆レタッチ担当）',               NULL,  NULL,      'skill',    'AND', TRUE,  '社員による1人取材スキル確認',      NULL),
  -- ミドルI
  (501, 5, 'monthly_pv',            '月間PV数 20,000以上',                                                20000, 'PV/月',   'pv_or_ig', 'OR',  FALSE, NULL,                              '月間PV（当月）'),
  (502, 5, 'ig_posts_over_500likes','Instagramいいね500以上の投稿 2本以上（当月）',                       2,     '本',      'pv_or_ig', 'OR',  FALSE, NULL,                              'いいね閾値: 500・当月投稿分'),
  (503, 5, 'pickup_top',            '多くの記事がピックアップに選ばれている',                             NULL,  '本',      'top',      'AND', FALSE, NULL,                              'ピックアップ数の閾値は未設定'),
  -- シニア
  (601, 6, 'monthly_pv',             '月間PV数 30,000以上',                                               30000, 'PV/月',   'pv_or_ig', 'OR',  FALSE, NULL,                              '月間PV（当月）'),
  (602, 6, 'ig_posts_over_1000likes','Instagramいいね1,000以上の投稿 1本以上（当月）',                    1,     '本',      'pv_or_ig', 'OR',  FALSE, NULL,                              'いいね閾値: 1,000・当月投稿分'),
  -- プロフェッショナル
  (701, 7, 'monthly_pv',             '月間PV数 50,000以上',                                               50000, 'PV/月',   'pv_or_ig', 'OR',  FALSE, NULL,                              '月間PV（当月）'),
  (702, 7, 'ig_posts_over_1000likes','Instagramいいね1,000以上の投稿 1本以上（当月）',                    1,     '本',      'pv_or_ig', 'OR',  FALSE, NULL,                              'いいね閾値: 1,000・当月投稿分');

-- ============================================================
-- STEP 4: ランク進捗ビュー作成
-- ============================================================

CREATE OR REPLACE VIEW `cg-project-491303.trepo_analytics.v_member_rank_progress` AS
WITH article_stats AS (
  SELECT
    a.author_id AS member_id,
    COUNT(*) AS total_articles,
    COUNTIF(a.is_pickup) AS pickup_count,
    COUNT(CASE WHEN DATE_TRUNC(a.published_date, MONTH) = DATE_TRUNC(CURRENT_DATE(), MONTH) THEN 1 END) AS monthly_articles
  FROM `cg-project-491303.trepo_analytics.trepo_articles` a
  WHERE a.status = '公開済み'
  GROUP BY a.author_id
),
pv_stats AS (
  SELECT
    a.author_id AS member_id,
    SUM(CASE WHEN p.date >= DATE_TRUNC(CURRENT_DATE(), MONTH) THEN p.page_views ELSE 0 END) AS monthly_pv
  FROM `cg-project-491303.trepo_analytics.trepo_articles` a
  JOIN `cg-project-491303.trepo_analytics.trepo_article_pv` p USING (article_id)
  GROUP BY a.author_id
),
ig_stats AS (
  SELECT
    member_id,
    COUNT(*) AS total_ig_posts,
    COUNTIF(like_count >= 500  AND DATE(posted_at) >= DATE_TRUNC(CURRENT_DATE(), MONTH)) AS monthly_ig_500like_posts,
    COUNTIF(like_count >= 1000 AND DATE(posted_at) >= DATE_TRUNC(CURRENT_DATE(), MONTH)) AS monthly_ig_1000like_posts
  FROM `cg-project-491303.trepo_analytics.trepo_ig_posts`
  GROUP BY member_id
)
SELECT
  m.member_id,
  m.display_name,
  m.current_rank_id,
  rd.rank_name                                    AS current_rank_name,
  rd.hourly_rate,
  rd.incentive_rate,
  COALESCE(ar.total_articles, 0)                  AS total_articles,
  COALESCE(ar.pickup_count, 0)                    AS pickup_count,
  COALESCE(ar.monthly_articles, 0)                AS monthly_articles,
  COALESCE(pv.monthly_pv, 0)                      AS monthly_pv,
  COALESCE(ig.total_ig_posts, 0)                  AS total_ig_posts,
  COALESCE(ig.monthly_ig_500like_posts, 0)        AS monthly_ig_500like_posts,
  COALESCE(ig.monthly_ig_1000like_posts, 0)       AS monthly_ig_1000like_posts
FROM `cg-project-491303.trepo_analytics.trepo_members` m
LEFT JOIN `cg-project-491303.trepo_analytics.trepo_rank_definitions` rd ON m.current_rank_id = rd.rank_id
LEFT JOIN article_stats ar ON m.member_id = ar.member_id
LEFT JOIN pv_stats pv      ON m.member_id = pv.member_id
LEFT JOIN ig_stats ig      ON m.member_id = ig.member_id
WHERE m.is_active = TRUE AND m.role = 'intern';
