-- 気づきワードサイクル Phase3 スライス1: Google Ads creative 日次KPI 置き場
-- 仕様: docs/superpowers/specs/2026-07-10-kizuki-word-cycle-phase3-slice1-ad-ingest.md
-- 実行: bq query --use_legacy_sql=false < bigquery/ad_creative_daily.sql
CREATE TABLE IF NOT EXISTS `cg-project-491303.cg_analytics.ad_creative_daily` (
  date          DATE      NOT NULL,   -- 集計日
  creative_id   STRING    NOT NULL,   -- Google Ads の ad(creative) ID。マッピング表の突合キー
  campaign      STRING,               -- キャンペーン名（参考）
  impressions   INT64,
  clicks        INT64,
  conversions   FLOAT64,
  cost          FLOAT64,              -- 消化額（円）
  revenue       FLOAT64,              -- 売上（ROAS算出用）
  demographics  STRING                -- 勝ちデモグラ（ベストエフォート・空可）
)
PARTITION BY date;
