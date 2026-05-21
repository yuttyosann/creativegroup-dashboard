-- ============================================================
-- GA4 → trepo_article_pv 日次変換クエリ
--
-- 使い方:
--   BigQueryコンソール → 「スケジュールされたクエリ」→ 新規作成
--   スケジュール: 毎日 AM4:00
--   書き込み先: cg-project-491303.trepo_analytics.trepo_article_pv
--   書き込み方式: WRITE_APPEND（追記）
--
-- ※ GA4データセット名（analytics_XXXXXXXXX）は実際のものに変更すること
--    BigQueryコンソールの左ペインで確認できます
-- ============================================================

-- 前日分のGA4データをtrepo_article_pvに変換して挿入
INSERT INTO `cg-project-491303.trepo_analytics.trepo_article_pv`
  (date, article_id, page_path, sessions, page_views, unique_users)

WITH ga4_pages AS (
  SELECT
    PARSE_DATE('%Y%m%d', event_date)                        AS date,
    (SELECT value.string_value
     FROM UNNEST(event_params)
     WHERE key = 'page_location')                           AS page_url,
    (SELECT value.string_value
     FROM UNNEST(event_params)
     WHERE key = 'page_path')                               AS page_path,
    user_pseudo_id,
    event_name
  FROM
    `cg-project-491303.analytics_263435110.events_*`
  WHERE
    _TABLE_SUFFIX = FORMAT_DATE('%Y%m%d', DATE_SUB(CURRENT_DATE('Asia/Tokyo'), INTERVAL 1 DAY))
    AND event_name IN ('page_view', 'session_start')
),

-- ページパスごとに集計
page_stats AS (
  SELECT
    date,
    page_path,
    COUNTIF(event_name = 'page_view')    AS page_views,
    COUNTIF(event_name = 'session_start') AS sessions,
    COUNT(DISTINCT user_pseudo_id)        AS unique_users
  FROM ga4_pages
  WHERE page_path IS NOT NULL
  GROUP BY date, page_path
),

-- trepo_articlesのURLとページパスを結合
article_match AS (
  SELECT
    ps.date,
    a.article_id,
    ps.page_path,
    ps.sessions,
    ps.page_views,
    ps.unique_users
  FROM page_stats ps
  JOIN `cg-project-491303.trepo_analytics.trepo_articles` a
    ON ps.page_path = REGEXP_EXTRACT(a.url, r'https?://[^/]+(/.+)')
    OR ps.page_path LIKE CONCAT('%', SPLIT(a.url, '/')[SAFE_OFFSET(3)], '%')
  WHERE a.url IS NOT NULL
)

SELECT * FROM article_match;

-- ============================================================
-- GA4データセット名の確認クエリ（設定時に一度だけ実行）
-- ============================================================
-- SELECT schema_name
-- FROM `cg-project-491303`.INFORMATION_SCHEMA.SCHEMATA
-- WHERE schema_name LIKE 'analytics_%';
-- → analytics_263435110 が表示されれば正しく連携されています
