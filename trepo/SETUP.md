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

> 翌日から `trepo_analytics.events_YYYYMMDD` テーブルが自動生成される。
> セッション・ページビューはBigQueryで集計クエリを作成して `trepo_article_pv` ビューに変換する。

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
