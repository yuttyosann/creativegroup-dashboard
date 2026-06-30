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
