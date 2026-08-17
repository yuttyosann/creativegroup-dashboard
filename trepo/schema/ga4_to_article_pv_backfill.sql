-- ============================================================
-- GA4 → trepo_article_pv バックフィル（過去分一括再生成）
--
-- 用途:
--   スケジュールクエリが停止していた期間をまとめて埋め直す。
--   日次版（ga4_to_article_pv.sql）と同じロジックを日付範囲に広げただけで、
--   対象期間をDELETEしてから入れ直すため何度実行しても重複しない。
--
-- 実行方法:
--   bq query --use_legacy_sql=false --project_id=cg-project-491303 \
--     < trepo/schema/ga4_to_article_pv_backfill.sql
--
-- 注意:
--   GA4エクスポートは events_20260324 が最古のため、
--   それ以前の日付は復元できない（BigQuery側に元データが存在しない）。
-- ============================================================

DECLARE start_date DATE DEFAULT '2026-03-25';
DECLARE end_date   DATE DEFAULT '2026-08-16';

DELETE FROM `cg-project-491303.trepo_analytics.trepo_article_pv`
WHERE date BETWEEN start_date AND end_date;

INSERT INTO `cg-project-491303.trepo_analytics.trepo_article_pv`
  (date, article_id, page_path, sessions, page_views, unique_users)

WITH ga4_events AS (
  SELECT
    PARSE_DATE('%Y%m%d', event_date) AS date,
    REGEXP_EXTRACT(
      (SELECT value.string_value
       FROM UNNEST(event_params)
       WHERE key = 'page_location'),
      r'https?://[^/?#]+([^?#]*)'
    ) AS raw_path,
    user_pseudo_id,
    event_name
  FROM
    `cg-project-491303.analytics_263435110.events_*`
  WHERE
    _TABLE_SUFFIX BETWEEN FORMAT_DATE('%Y%m%d', start_date)
                      AND FORMAT_DATE('%Y%m%d', end_date)
    AND event_name IN ('page_view', 'session_start')
),

page_events AS (
  SELECT
    date,
    SAFE_CAST(REGEXP_EXTRACT(raw_path, r'^/[^/]+/([0-9]+)(?:/|$)') AS INT64) AS post_id,
    user_pseudo_id,
    event_name
  FROM ga4_events
  WHERE raw_path IS NOT NULL
),

article_stats AS (
  SELECT
    date,
    post_id,
    COUNTIF(event_name = 'page_view')                                  AS page_views,
    COUNTIF(event_name = 'session_start')                              AS sessions,
    COUNT(DISTINCT IF(event_name = 'page_view', user_pseudo_id, NULL)) AS unique_users
  FROM page_events
  WHERE post_id IS NOT NULL
  GROUP BY date, post_id
),

articles AS (
  SELECT
    post_id,
    ANY_VALUE(article_id) AS article_id,
    ANY_VALUE(page_path)  AS page_path
  FROM (
    SELECT
      SAFE_CAST(REGEXP_EXTRACT(url, r'/([0-9]+)/?$') AS INT64) AS post_id,
      article_id,
      REGEXP_EXTRACT(url, r'https?://[^/]+(/[^?#]*)')          AS page_path
    FROM `cg-project-491303.trepo_analytics.trepo_articles`
    WHERE url IS NOT NULL
      AND url NOT LIKE '%?%'
  )
  WHERE post_id IS NOT NULL
  GROUP BY post_id
)

SELECT
  s.date,
  a.article_id,
  a.page_path,
  s.sessions,
  s.page_views,
  s.unique_users
FROM article_stats s
JOIN articles a USING (post_id);
