-- ============================================================
-- CreativeGroup BigQuery セットアップSQL
-- プロジェクトID: cg-project-491303
-- 実行場所: BigQueryコンソール > SQLクエリ
-- ============================================================

-- ※ BigQueryではCREATE SCHEMAでデータセットを作成します
-- ※ 1ステートメントずつ実行してください

-- ① データセット作成（東京リージョン）
CREATE SCHEMA IF NOT EXISTS `cg-project-491303.cg_analytics`
OPTIONS (
  location = 'asia-northeast1',
  description = 'CreativeGroup 全社データプラットフォーム'
);

-- ============================================================
-- テーブル①: Pamunアンケート回答
-- ============================================================
CREATE TABLE IF NOT EXISTS `cg-project-491303.cg_analytics.survey_responses` (
  id              STRING    NOT NULL,   -- アンケート回答ID
  response_date   DATE,                 -- 回答日
  company         STRING,               -- クライアント名
  genre           STRING,               -- 商品ジャンル
  product         STRING,               -- 商品名
  nps             FLOAT64,              -- NPS（0〜10）
  satisfaction    FLOAT64,              -- 満足度
  reason          STRING,               -- 購入・使用理由（自由記述）
  improvement     STRING,               -- 改善点（自由記述）
  age             STRING,               -- 年代
  gender          STRING,               -- 性別
  channel         STRING,               -- 流入チャネル
  raw_json        JSON,                 -- 元データ全量（フレキシブル拡張用）
  loaded_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP()  -- BigQuery書込日時
)
PARTITION BY response_date
OPTIONS (description = 'Pamunアンケート回答データ（日次同期）');

-- ============================================================
-- テーブル②: 広告媒体 日次KPI
-- ============================================================
CREATE TABLE IF NOT EXISTS `cg-project-491303.cg_analytics.ad_daily_metrics` (
  date            DATE      NOT NULL,   -- 集計日
  platform        STRING    NOT NULL,   -- 媒体（google/meta/tiktok/yahoo）
  campaign_id     STRING,               -- キャンペーンID
  campaign_name   STRING,               -- キャンペーン名
  client          STRING,               -- クライアント名
  impressions     INT64,                -- インプレッション
  clicks          INT64,                -- クリック数
  ctr             FLOAT64,              -- CTR（%）
  cpc             FLOAT64,              -- CPC（円）
  conversions     INT64,                -- コンバージョン数
  cvr             FLOAT64,              -- CVR（%）
  frequency       FLOAT64,              -- フリークエンシー
  spend           FLOAT64,              -- 広告費（円）
  revenue         FLOAT64,              -- 売上（円）※連携できる場合
  roas            FLOAT64,              -- ROAS（%）
  loaded_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
)
PARTITION BY date
CLUSTER BY platform, client
OPTIONS (description = '広告媒体別日次KPI（Google/Meta/TikTok/Yahoo）');

-- ============================================================
-- テーブル③: キャンペーンマスタ
-- ============================================================
CREATE TABLE IF NOT EXISTS `cg-project-491303.cg_analytics.ad_campaigns` (
  campaign_id     STRING    NOT NULL,
  platform        STRING    NOT NULL,
  campaign_name   STRING,
  client          STRING,
  genre           STRING,
  start_date      DATE,
  end_date        DATE,
  budget          FLOAT64,              -- 月次予算（円）
  goal            STRING,               -- キャンペーン目標
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
)
OPTIONS (description = 'キャンペーンマスタ（媒体横断）');

-- ============================================================
-- テーブル④: MFクラウド 請求・売上データ
-- ============================================================
CREATE TABLE IF NOT EXISTS `cg-project-491303.cg_analytics.billing_invoices` (
  invoice_id      STRING    NOT NULL,   -- 請求書ID
  invoice_date    DATE,                 -- 請求日
  client          STRING,               -- 取引先名
  title           STRING,               -- 件名
  amount          FLOAT64,              -- 金額（税抜）
  tax             FLOAT64,              -- 消費税
  total_amount    FLOAT64,              -- 合計金額（税込）
  status          STRING,               -- ステータス（未入金/入金済/etc）
  paid_date       DATE,                 -- 入金日
  team            STRING,               -- 担当チーム
  loaded_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
)
PARTITION BY invoice_date
OPTIONS (description = 'MFクラウド請求・売上データ（日次同期）');

-- ============================================================
-- テーブル⑤: Gmail メール履歴
-- ============================================================
CREATE TABLE IF NOT EXISTS `cg-project-491303.cg_analytics.email_threads` (
  message_id      STRING    NOT NULL,   -- メールID
  thread_id       STRING,               -- スレッドID
  sent_at         TIMESTAMP,            -- 送受信日時
  direction       STRING,               -- sent / received
  from_address    STRING,               -- 送信者
  to_address      STRING,               -- 宛先
  subject         STRING,               -- 件名
  snippet         STRING,               -- 本文抜粋（先頭200字）
  client          STRING,               -- 関連クライアント（推定）
  label           STRING,               -- Gmailラベル
  loaded_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
)
PARTITION BY DATE(sent_at)
OPTIONS (description = 'Gmailメール履歴（日次同期）');

-- ============================================================
-- テーブル⑥: チャネル横断サマリー（集計用ビュー）
-- ============================================================
CREATE OR REPLACE VIEW `cg-project-491303.cg_analytics.channel_summary` AS
SELECT
  date,
  platform                          AS channel,
  client,
  SUM(impressions)                  AS total_impressions,
  SUM(clicks)                       AS total_clicks,
  SAFE_DIVIDE(SUM(clicks), SUM(impressions)) * 100  AS avg_ctr,
  SAFE_DIVIDE(SUM(spend), SUM(clicks))              AS avg_cpc,
  SUM(conversions)                  AS total_conversions,
  SAFE_DIVIDE(SUM(conversions), SUM(clicks)) * 100  AS avg_cvr,
  SUM(spend)                        AS total_spend,
  SUM(revenue)                      AS total_revenue,
  SAFE_DIVIDE(SUM(revenue), SUM(spend)) * 100       AS roas
FROM `cg-project-491303.cg_analytics.ad_daily_metrics`
GROUP BY date, platform, client;

-- ============================================================
-- 完了メッセージ確認用クエリ
-- ============================================================
SELECT
  table_name,
  table_type,
  creation_time
FROM `cg-project-491303.cg_analytics.INFORMATION_SCHEMA.TABLES`
ORDER BY creation_time;
