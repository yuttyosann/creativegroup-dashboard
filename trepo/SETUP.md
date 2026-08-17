# Trepo データプラットフォーム — セットアップ手順

## 全体の作業ステップ

```
Step 1. GCPプロジェクト確認・BigQueryデータセット作成  ← あなたが実施
Step 2. GA4 → BigQuery エクスポート有効化              ← あなたが実施
Step 3. GASスクリプトをスプレッドシートに設置           ← あなたが実施
Step 4. ランク定義データをBigQueryにインポート          ← Claude Code で実施
Step 5. Instagram API 設定                             ← あなたが実施（Facebookページ連携）
```

---

## Step 1. GCPプロジェクト確認・BigQueryデータセット作成

### 1-1. GCPプロジェクトの確認
1. https://console.cloud.google.com/ にアクセス
2. 上部のプロジェクト選択で「CreativeGroup用プロジェクト」を選択
3. プロジェクトIDをメモしておく（例: `creativegroup-analytics`）

### 1-2. BigQuery データセットの作成
1. GCPコンソール左メニュー > **BigQuery**
2. 左ペインのプロジェクト名を右クリック > **「データセットを作成」**
3. 以下の設定で作成:
   - データセットID: `trepo_analytics`
   - ロケーション: `asia-northeast1`（東京）
   - テーブルの有効期限: なし

### 1-3. テーブルの作成
BigQuery コンソールの「クエリを編集」で以下を実行:

```
trepo/schema/trepo_analytics.sql の内容をコピペして実行
```

---

## Step 2. GA4 → BigQuery エクスポート有効化

> **無料・設定だけで完了・自動的に毎日同期される**

1. Google Analytics 管理画面にアクセス
2. 左下「管理（歯車アイコン）」> **「BigQueryのリンク設定」**
3. 「リンク」をクリック
4. BigQueryプロジェクトを選択（Step 1で確認したプロジェクト）
5. データストリームを選択（trepo.jp のストリーム）
6. エクスポート形式: 「毎日」にチェック
7. 「送信」をクリック

> 翌日から `analytics_263435110.events_YYYYMMDD` テーブルが自動生成される。
> セッション・ページビューはスケジュールクエリで `trepo_article_pv` テーブルに変換する。

### 2-1. PV集計スケジュールクエリ

| 項目 | 値 |
|---|---|
| 表示名 | `trepo_article_pv_daily_sync` |
| 転送設定ID | `projects/620587423995/locations/asia-northeast1/transferConfigs/69d5ec36-0000-29f0-8524-94eb2c1b1188` |
| SQL | [`schema/ga4_to_article_pv.sql`](schema/ga4_to_article_pv.sql) |
| スケジュール | 毎日 04:00 UTC（13:00 JST） |
| 実行サービスアカウント | `trepo-bq-scheduler@cg-project-491303.iam.gserviceaccount.com` |

必要な権限（**これが欠けていて2026-03〜08の約145日間サイレントに失敗していた**）:

- プロジェクト: `roles/bigquery.jobUser`（ジョブ起動）
- `trepo_analytics` データセット: `WRITER`（DELETE+INSERT）
- **`analytics_263435110` データセット: `READER`（GA4読み取り）**

```bash
# GA4データセットの読み取り権限を付与する（データセット単位のACLなのでIAMバインディングではない）
bq show --format=prettyjson cg-project-491303:analytics_263435110 > ds.json
# ds.json の access 配列に
#   {"role": "READER", "userByEmail": "trepo-bq-scheduler@cg-project-491303.iam.gserviceaccount.com"}
# を追記してから
bq update --source ds.json cg-project-491303:analytics_263435110
```

過去分を埋め直す場合は [`schema/ga4_to_article_pv_backfill.sql`](schema/ga4_to_article_pv_backfill.sql) の
`start_date` / `end_date` を書き換えて実行する（対象期間をDELETEしてから入れ直すので何度でも安全）。

```bash
bq query --use_legacy_sql=false --project_id=cg-project-491303 < trepo/schema/ga4_to_article_pv_backfill.sql
```

> 日次クエリは前日〜3日前の3日分を毎回作り直す。GA4のエクスポートは実測で最大約25時間遅れる日があり、
> 前日1日分だけを対象にすると遅延した日が永久に欠損するため。

**既知の制約:** `trepo_articles` のURLが実サイトの `/{カテゴリ}/{記事ID}/` 形式になっている記事だけが
集計対象になる（2026-08-17時点で477件中74件）。スラッグ形式のURLは実在せずGA4のログにも出現しないため
マッチしない。カバレッジ改善は別タスクで対応。

---

## Step 3. GASスクリプトの設置

### 3-1. スクリプトを設置
1. Trepo管理シートを開く
2. メニュー: **「拡張機能」 > 「Apps Script」**
3. `trepo/gas/sync_to_bigquery.gs` の内容を全コピーして貼り付け
4. `CONFIG` セクションの以下を修正:
   ```javascript
   GCP_PROJECT_ID: 'YOUR_GCP_PROJECT_ID',  // Step 1でメモしたプロジェクトID
   SHEET_TABLE_MAP: {
     '記事管理': 'trepo_articles',          // 実際のシート名に変更
     'IGスケジュール': 'trepo_ig_schedule',  // 実際のシート名に変更
   }
   ```

### 3-2. GCP認証スコープの設定
Apps Script エディタ > 「プロジェクトの設定」 > `appsscript.json を表示` にチェック

`appsscript.json` に以下を追加:
```json
{
  "oauthScopes": [
    "https://www.googleapis.com/auth/bigquery",
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/script.external_request"
  ]
}
```

### 3-3. 初回セットアップ
1. 関数の選択ボックスで `setup` を選択
2. 「実行」ボタンをクリック
3. Google認証を許可
4. `manualSync` を選択して「実行」→ 初回同期テスト

---

## Step 4. ランク定義データのインポート

Step 1〜3完了後、Claude Code に「ランク定義データをBigQueryにインポートして」と依頼。
`trepo/data/rank_definitions.json` と `trepo/data/rank_quant_conditions.json` を使って自動インポートします。

---

## Step 5. Instagram API 設定

### 前提: Facebookページとの連携
InstagramクリエイターアカウントはFacebookページと連携することでGraph APIが使用可能になります。

1. **Facebookページの準備**
   - trepo.jp 用のFacebookページを作成（または既存ページを使用）
   - Instagramクリエイターアカウントをそのページに接続:
     Instagram設定 > 「クリエイターアカウント」 > 「Facebookページをリンク」

2. **Meta Developerアプリの作成**
   - https://developers.facebook.com/ にアクセス
   - 「マイアプリ」 > 「アプリを作成」
   - タイプ: 「ビジネス」を選択
   - 「Instagram Graph API」を追加

3. **必要な権限**
   - `instagram_basic`
   - `instagram_manage_insights`
   - `pages_read_engagement`

4. 設定完了後、Claude Code に「Instagram APIのBigQuery同期スクリプトを作成して」と依頼。

---

## ファイル構成

```
trepo/
├── SETUP.md                    ← この手順書
├── schema/
│   └── trepo_analytics.sql     ← BQテーブル定義（CREATE TABLE）
├── data/
│   ├── rank_definitions.json   ← ランク定義初期データ
│   └── rank_quant_conditions.json  ← ランク昇格条件（定量）初期データ
└── gas/
    └── sync_to_bigquery.gs     ← スプレッドシート→BQ同期スクリプト
```
