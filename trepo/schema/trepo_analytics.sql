-- ============================================================
-- Trepo Analytics — BigQuery データセット定義
-- データセット: trepo_analytics
-- ============================================================

-- ============================================================
-- 1. ランク定義テーブル
-- ============================================================
CREATE TABLE IF NOT EXISTS `trepo_analytics.trepo_rank_definitions` (
  rank_id          INT64   NOT NULL,  -- 1(研修生) 〜 7(プロフェッショナル)
  rank_name        STRING  NOT NULL,  -- 研修生 / ジュニアII / ...
  rank_label       STRING,            -- リーダー / 副編集長 / 編集長
  hourly_rate      INT64   NOT NULL,  -- 時給（円）
  incentive_rate   FLOAT64 NOT NULL,  -- インセンティブ率（0.01 = 1%）
  ig_summary_bonus INT64   NOT NULL,  -- IGまとめ投稿ボーナス（円）
  short_video_bonus INT64  NOT NULL,  -- ショート動画ボーナス（円）
  salary_cap       INT64,             -- 給与上限（円）NULL=上限なし
  perk_description STRING,            -- 昇格特典の説明
  updated_at       TIMESTAMP
);

-- ============================================================
-- 2. ランク昇格条件テーブル（定量）
-- ============================================================
CREATE TABLE IF NOT EXISTS `trepo_analytics.trepo_rank_quant_conditions` (
  condition_id      INT64   NOT NULL,
  rank_id           INT64   NOT NULL,  -- 対象ランク（このランクに昇格するための条件）
  condition_key     STRING  NOT NULL,  --例: cumulative_pv / monthly_articles / ig_likes_1000_posts
  condition_label   STRING  NOT NULL,  -- 表示用ラベル
  threshold_value   FLOAT64,           -- 閾値（数値）
  threshold_unit    STRING,            -- 単位: 本 / PV / 回 など
  logic_group       STRING,            -- ANDグループ内のOR条件をグループ化 例: 'pv_or_ig'
  logic_type        STRING,            -- 'AND' or 'OR'（同一logic_group内）
  is_flag           BOOL    NOT NULL,  -- TRUE=社員がフラグで管理する条件
  flag_description  STRING,            -- フラグ管理条件の説明
  notes             STRING             -- 備考（未設定項目など）
);

-- ============================================================
-- 3. ランク昇格条件テーブル（定性）
-- ============================================================
CREATE TABLE IF NOT EXISTS `trepo_analytics.trepo_rank_qual_conditions` (
  condition_id    INT64  NOT NULL,
  rank_id         INT64  NOT NULL,
  condition_label STRING NOT NULL,  -- 条件の説明文
  category        STRING,           -- attitude / teamwork / management / communication / skill
  is_common       BOOL   NOT NULL   -- TRUE=全ランク共通条件
);

-- ============================================================
-- 4. メンバー情報テーブル
-- ============================================================
CREATE TABLE IF NOT EXISTS `trepo_analytics.trepo_members` (
  member_id       STRING  NOT NULL,  -- Googleアカウントのuid or 独自ID
  display_name    STRING  NOT NULL,
  email           STRING  NOT NULL,
  role            STRING  NOT NULL,  -- 'intern' or 'staff'
  current_rank_id INT64,             -- 現在のランクID
  joined_date     DATE,
  is_active       BOOL    NOT NULL,
  updated_at      TIMESTAMP
);

-- ============================================================
-- 5. ランク評価レコード（社員が定性評価を入力）
-- ============================================================
CREATE TABLE IF NOT EXISTS `trepo_analytics.trepo_rank_evaluations` (
  evaluation_id    STRING    NOT NULL,  -- UUID
  member_id        STRING    NOT NULL,
  evaluated_by     STRING    NOT NULL,  -- 評価者のmember_id
  evaluation_date  DATE      NOT NULL,
  target_rank_id   INT64     NOT NULL,  -- 評価対象ランク
  -- 定量フラグ（社員確認が必要なもの）
  flag_retouch_trained     BOOL,  -- レタッチ研修受講済み
  flag_steel_trained       BOOL,  -- スチール研修受講済み
  flag_dslr_ok             BOOL,  -- 一眼レフOK
  flag_solo_interview_ok   BOOL,  -- 1人取材OK
  flag_no_content_check    BOOL,  -- コンテンツシートチェック不要
  -- 定性スコア（1〜5）
  score_attitude           INT64, -- 姿勢・成長意欲
  score_teamwork           INT64, -- 協調性・チームワーク
  score_communication      INT64, -- コミュニケーション
  score_management         INT64, -- マネジメント・育成
  score_flexibility        INT64, -- 柔軟性・対応力
  score_responsibility     INT64, -- 責任感・社会人基礎
  overall_comment          STRING,
  is_promotion_approved    BOOL,  -- 昇格承認
  has_violation            BOOL   DEFAULT FALSE,  -- ルール違反フラグ
  created_at               TIMESTAMP
);

-- ============================================================
-- 6. 記事テーブル
-- ============================================================
CREATE TABLE IF NOT EXISTS `trepo_analytics.trepo_articles` (
  article_id      STRING    NOT NULL,
  title           STRING    NOT NULL,
  author_id       STRING    NOT NULL,  -- member_id
  category        STRING,              -- オリジナル / 芸能 / レビュー / タイアップ
  published_date  DATE,
  url             STRING,
  is_pickup       BOOL      DEFAULT FALSE,
  is_tieup        BOOL      DEFAULT FALSE,
  status          STRING,              -- 執筆中 / 編集中 / 公開済み
  created_at      TIMESTAMP,
  updated_at      TIMESTAMP
);

-- ============================================================
-- 7. 記事PVテーブル（GA4から同期）
-- ============================================================
CREATE TABLE IF NOT EXISTS `trepo_analytics.trepo_article_pv` (
  date            DATE      NOT NULL,
  article_id      STRING    NOT NULL,  -- trepo_articles との結合キー
  page_path       STRING    NOT NULL,
  sessions        INT64,
  page_views      INT64,
  unique_users    INT64
)
PARTITION BY date;

-- ============================================================
-- 8. IGネタ会議スケジュールテーブル
-- ============================================================
CREATE TABLE IF NOT EXISTS `trepo_analytics.trepo_ig_schedule` (
  schedule_id     STRING    NOT NULL,
  post_date       DATE      NOT NULL,
  member_id       STRING    NOT NULL,
  content_title   STRING,
  content_type    STRING,              -- フィード / リール / ストーリー
  status          STRING,              -- 予定 / 制作中 / 投稿済み / キャンセル
  notes           STRING,
  created_at      TIMESTAMP,
  updated_at      TIMESTAMP
);

-- ============================================================
-- 9. Instagram投稿テーブル（IG APIから同期）
-- ============================================================
CREATE TABLE IF NOT EXISTS `trepo_analytics.trepo_ig_posts` (
  post_id         STRING    NOT NULL,  -- Instagram media ID
  member_id       STRING,              -- 担当者（スケジュールと結合）
  posted_at       TIMESTAMP,
  media_type      STRING,              -- IMAGE / VIDEO / CAROUSEL_ALBUM
  caption         STRING,
  permalink       STRING,
  like_count      INT64,
  comments_count  INT64,
  reach           INT64,
  impressions     INT64,
  saved           INT64,
  plays           INT64,               -- リール再生数
  synced_at       TIMESTAMP
)
PARTITION BY DATE(posted_at);

-- ============================================================
-- 10. 経費申請テーブル
-- ============================================================
CREATE TABLE IF NOT EXISTS `trepo_analytics.trepo_expenses` (
  expense_id      STRING    NOT NULL,
  member_id       STRING    NOT NULL,
  applied_date    DATE      NOT NULL,
  amount          INT64     NOT NULL,
  category        STRING,              -- 交通費 / 備品 / 飲食 / その他
  description     STRING,
  receipt_url     STRING,
  status          STRING    DEFAULT 'pending',  -- pending / approved / rejected
  reviewed_by     STRING,
  reviewed_at     TIMESTAMP,
  created_at      TIMESTAMP
);

-- ============================================================
-- 11. 備品申請テーブル
-- ============================================================
CREATE TABLE IF NOT EXISTS `trepo_analytics.trepo_equipment_requests` (
  request_id      STRING    NOT NULL,
  member_id       STRING    NOT NULL,
  applied_date    DATE      NOT NULL,
  item_name       STRING    NOT NULL,
  quantity        INT64     DEFAULT 1,
  purpose         STRING,
  status          STRING    DEFAULT 'pending',
  reviewed_by     STRING,
  reviewed_at     TIMESTAMP,
  created_at      TIMESTAMP
);

-- ============================================================
-- 12. 日報テーブル
-- ============================================================
CREATE TABLE IF NOT EXISTS `trepo_analytics.trepo_daily_reports` (
  report_id       STRING    NOT NULL,
  member_id       STRING    NOT NULL,
  report_date     DATE      NOT NULL,
  work_hours      FLOAT64,
  tasks_done      STRING,   -- 実施タスク（テキスト）
  articles_worked ARRAY<STRING>,  -- 作業した記事ID
  ig_posts_worked ARRAY<STRING>,  -- 作業したIG投稿ID
  issues          STRING,   -- 課題・困りごと
  next_actions    STRING,   -- 翌日の予定
  created_at      TIMESTAMP
);

-- ============================================================
-- 13. シフトテーブル
-- ============================================================
CREATE TABLE IF NOT EXISTS `trepo_analytics.trepo_shifts` (
  shift_id        STRING    NOT NULL,
  member_id       STRING    NOT NULL,
  shift_date      DATE      NOT NULL,
  start_time      TIME,
  end_time        TIME,
  location        STRING,              -- オフィス / リモート
  status          STRING    DEFAULT 'scheduled',  -- scheduled / attended / absent / late
  notes           STRING,
  created_at      TIMESTAMP
);

-- ============================================================
-- 14. 記事報告テーブル
-- ============================================================
CREATE TABLE IF NOT EXISTS `trepo_analytics.trepo_article_reports` (
  report_id         STRING    NOT NULL,
  member_id         STRING    NOT NULL,
  article_id        STRING,
  reported_date     DATE      NOT NULL,
  article_title     STRING,
  category          STRING,
  word_count        INT64,
  interview_done    BOOL      DEFAULT FALSE,
  photo_taken       BOOL      DEFAULT FALSE,
  memo              STRING,
  status            STRING    DEFAULT 'submitted',  -- submitted / reviewed / published
  created_at        TIMESTAMP
);

-- ============================================================
-- ビュー: メンバーのランク進捗サマリー
-- PVはすべて月間（当月）で集計
-- いいね閾値: ジュニアI〜ミドルI=500以上、シニア以上=1,000以上
-- ============================================================
CREATE OR REPLACE VIEW `trepo_analytics.v_member_rank_progress` AS
WITH article_stats AS (
  SELECT
    a.author_id AS member_id,
    COUNT(*) AS total_articles,
    COUNTIF(a.is_pickup) AS pickup_count,
    COUNT(CASE WHEN DATE_TRUNC(a.published_date, MONTH) = DATE_TRUNC(CURRENT_DATE(), MONTH) THEN 1 END) AS monthly_articles
  FROM `trepo_analytics.trepo_articles` a
  WHERE a.status = '公開済み'
  GROUP BY a.author_id
),
pv_stats AS (
  SELECT
    a.author_id AS member_id,
    -- 全ランク共通: 月間PV（当月）
    SUM(CASE WHEN p.date >= DATE_TRUNC(CURRENT_DATE(), MONTH) THEN p.page_views ELSE 0 END) AS monthly_pv
  FROM `trepo_analytics.trepo_articles` a
  JOIN `trepo_analytics.trepo_article_pv` p USING (article_id)
  GROUP BY a.author_id
),
ig_stats AS (
  SELECT
    member_id,
    COUNT(*) AS total_ig_posts,
    -- 当月の投稿のみ集計
    COUNTIF(like_count >= 500  AND DATE(posted_at) >= DATE_TRUNC(CURRENT_DATE(), MONTH)) AS monthly_ig_500like_posts,
    COUNTIF(like_count >= 1000 AND DATE(posted_at) >= DATE_TRUNC(CURRENT_DATE(), MONTH)) AS monthly_ig_1000like_posts
  FROM `trepo_analytics.trepo_ig_posts`
  GROUP BY member_id
)
SELECT
  m.member_id,
  m.display_name,
  m.current_rank_id,
  rd.rank_name AS current_rank_name,
  COALESCE(ar.total_articles, 0)            AS total_articles,
  COALESCE(ar.pickup_count, 0)              AS pickup_count,
  COALESCE(ar.monthly_articles, 0)          AS monthly_articles,
  COALESCE(pv.monthly_pv, 0)               AS monthly_pv,
  COALESCE(ig.total_ig_posts, 0)            AS total_ig_posts,
  COALESCE(ig.monthly_ig_500like_posts, 0)  AS monthly_ig_500like_posts,
  COALESCE(ig.monthly_ig_1000like_posts, 0) AS monthly_ig_1000like_posts
FROM `trepo_analytics.trepo_members` m
LEFT JOIN `trepo_analytics.trepo_rank_definitions` rd ON m.current_rank_id = rd.rank_id
LEFT JOIN article_stats ar ON m.member_id = ar.member_id
LEFT JOIN pv_stats pv ON m.member_id = pv.member_id
LEFT JOIN ig_stats ig ON m.member_id = ig.member_id
WHERE m.is_active = TRUE AND m.role = 'intern';
