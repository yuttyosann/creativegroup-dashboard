-- ============================================================
-- GA4 → trepo_article_pv 日次変換クエリ
--
-- 使い方:
--   BigQueryコンソール → 「スケジュールされたクエリ」→ 新規作成
--   スケジュール: 毎日 AM4:00（UTC）
--   書き込み先データセット: cg-project-491303.trepo_analytics
--   書き込み方式: クエリ内のMERGEで完結するため、宛先テーブルの指定は不要
--
-- 対象は @run_date（スケジュールクエリが自動で渡す実行日）の前日から3日前までの3日間。
-- 前日1日分だけにしないのは、GA4のエクスポートが遅延することがあるため
-- （実測で最大約25時間遅れた日があり、その日は04:00 UTC時点でテーブルが存在しない）。
-- 3日分を毎回作り直すことで、遅れて到着した日も自動的に埋まる。
--
-- MERGE（DELETE+INSERTの2文ではなく単文）にしている理由:
--   1. スケジュールクエリは宛先データセットが設定されているとマルチステートメントの
--      スクリプトを受け付けない（Dataset specified in the query ('') is not
--      consistent with Destination dataset エラーになる）
--   2. 単文なので原子的に反映され、集計途中にテーブルが欠損する瞬間がない
--   3. 何度実行しても同じ結果になる（バックフィルの再実行も安全）
--
-- ※ GA4データセット名（analytics_XXXXXXXXX）は実際のものに変更すること
-- ============================================================

MERGE `cg-project-491303.trepo_analytics.trepo_article_pv` T
USING (
  WITH ga4_events AS (
    SELECT
      PARSE_DATE('%Y%m%d', event_date) AS date,
      -- GA4が持つのは page_location（完全URL）。page_path というパラメータは存在しない。
      -- クエリ文字列とフラグメントを除いたパス部分だけを取り出す。
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
      _TABLE_SUFFIX BETWEEN FORMAT_DATE('%Y%m%d', DATE_SUB(@run_date, INTERVAL 3 DAY))
                        AND FORMAT_DATE('%Y%m%d', DATE_SUB(@run_date, INTERVAL 1 DAY))
      AND event_name IN ('page_view', 'session_start')
  ),

  -- trepo.jpの記事URLは /{カテゴリ}/{WordPress記事ID}/ 形式。
  -- ページ送り（/{カテゴリ}/{記事ID}/2/）も同じ記事IDに寄せる。
  page_events AS (
    SELECT
      date,
      SAFE_CAST(REGEXP_EXTRACT(raw_path, r'^/[^/]+/([0-9]+)(?:/|$)') AS INT64) AS post_id,
      user_pseudo_id,
      event_name
    FROM ga4_events
    WHERE raw_path IS NOT NULL
  ),

  -- 記事IDごとに集計（ページ送り分は合算される）
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

  -- 記事マスタ側もURL末尾の記事IDをキーにする。
  -- プレビューURL（?p=...&preview=1）や未公開でURL未設定のものは除外。
  articles AS (
    SELECT
      post_id,
      ANY_VALUE(article_id) AS article_id,
      ANY_VALUE(page_path)  AS page_path
    FROM (
      SELECT
        SAFE_CAST(REGEXP_EXTRACT(url, r'/([0-9]+)/?$') AS INT64)  AS post_id,
        article_id,
        REGEXP_EXTRACT(url, r'https?://[^/]+(/[^?#]*)')           AS page_path
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
  JOIN articles a USING (post_id)
) S
ON  T.date = S.date
AND T.article_id = S.article_id

WHEN MATCHED THEN UPDATE SET
  page_path    = S.page_path,
  sessions     = S.sessions,
  page_views   = S.page_views,
  unique_users = S.unique_users

WHEN NOT MATCHED BY TARGET THEN INSERT
  (date, article_id, page_path, sessions, page_views, unique_users)
  VALUES (S.date, S.article_id, S.page_path, S.sessions, S.page_views, S.unique_users)

-- 対象期間内で、集計結果に出てこなくなった行は削除する
-- （記事マスタのURL修正などで紐付きが変わった場合に古い行を残さない）
WHEN NOT MATCHED BY SOURCE
     AND T.date BETWEEN DATE_SUB(@run_date, INTERVAL 3 DAY)
                    AND DATE_SUB(@run_date, INTERVAL 1 DAY)
     THEN DELETE;

-- ============================================================
-- GA4データセット名の確認クエリ（設定時に一度だけ実行）
-- ============================================================
-- SELECT schema_name
-- FROM `cg-project-491303`.INFORMATION_SCHEMA.SCHEMATA
-- WHERE schema_name LIKE 'analytics_%';
-- → analytics_263435110 が表示されれば正しく連携されています
