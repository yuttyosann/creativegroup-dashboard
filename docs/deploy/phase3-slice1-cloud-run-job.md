# Phase3 スライス1 デプロイ手順（Cloud Run Job ＋ Cloud Scheduler）

前提: GCPプロジェクト `cg-project-491303` / BigQuery `cg_analytics` / サービスアカウントに BigQuery・Sheets 権限。

## 1. BQテーブル作成
    bq query --use_legacy_sql=false < bigquery/ad_creative_daily.sql

## 2. 広告マッピングタブ用意
コックピットの Google Sheet に「広告マッピング」タブを作成。1行目ヘッダー: `creative_id, word_id, campaign, メモ`。
Google Ads 対象 creative の creative_id と word_id を登録（＝自動管理の許可リスト）。

## 3. 日次バッチ（2ジョブ）
- 取得: `node scripts/google-ads/fetch_creatives.js --date <前日>` → BQへ
- 再計算: `node scripts/kizuki/recalc_job.js` → 広告シグナル upsert ＋ 台帳スコア更新

## 4. Cloud Run Job 化 ＋ Scheduler（例）
    gcloud run jobs create kizuki-recalc --source . --command node --args scripts/kizuki/recalc_job.js --region asia-northeast1
    gcloud scheduler jobs create http kizuki-recalc-daily \
      --schedule "0 4 * * *" --time-zone "Asia/Tokyo" \
      --uri "<Cloud Run Job 実行 URI>" --http-method POST

## 注意
- 広告シグナルの更新は creative_id upsert（マッピング済みのみ）。手入力行は不可侵。
- BQ集計は現状「累計」。期間を変えたい場合は recalc_job.js の SQL（GROUP BY）を調整。
