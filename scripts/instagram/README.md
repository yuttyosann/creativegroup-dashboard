# Instagram 投稿分析（自社アカウント・公式Graph API）

自社IGプロアカウントの投稿＋Insightsを公式Graph APIで取得し、
カルーセル枚数・エンゲージメント率・リーチの相関と上位/下位比較をレポート化する。

## 1. 認証情報の取得手順

> ⚠️ API version・指標名は変わるため、実装時は Meta for Developers 公式ドキュメントの最新版を確認すること。

### 前提
- 対象IGアカウントが **Business / Creator（プロアカウント）** であること。
- そのIGアカウントが **Facebookページ** に連携されていること。

### 手順
1. **Meta for Developers** （https://developers.facebook.com/）でアプリ作成（タイプ: Business）。
2. アプリに **Instagram Graph API** 製品を追加。
3. **Graph API Explorer** で対象ユーザーのトークンを発行し、権限を付与:
   - `instagram_basic`
   - `instagram_manage_insights`
   - `pages_read_engagement`
   - `pages_show_list`
4. **IG User ID を取得**:
   `GET /me/accounts` → 対象ページの `id` を取得 →
   `GET /{page-id}?fields=instagram_business_account` の `instagram_business_account.id` が **IG_USER_ID**。
5. **長期トークン（約60日）へ交換**:
   ```
   GET https://graph.facebook.com/v21.0/oauth/access_token
     ?grant_type=fb_exchange_token
     &client_id={app-id}
     &client_secret={app-secret}
     &fb_exchange_token={短期トークン}
   ```
   返却された `access_token` が **IG_ACCESS_TOKEN**。
6. プロジェクトルートの `.env` に追記:
   ```
   IG_USER_ID=取得したIG User ID
   IG_ACCESS_TOKEN=取得した長期トークン
   IG_API_VERSION=v21.0
   ```

> 長期トークンは約60日で失効する。失効したら手順5を再実行して `.env` を更新する。

## 2. BigQuery セットアップ（初回のみ）

`bigquery/instagram_setup.sql` を BigQuery コンソールで1ステートメントずつ実行し、
`ig_media_raw` / `ig_insights_raw` / `ig_media_features`（ビュー）を作成する。

> BigQuery を使わず CSV だけで回す場合は不要。取得時に `--csv-only` を付ける。

## 3. 使い方

```bash
# 取得（BigQuery + CSV）
npm run ig:fetch
# 取得（CSVのみ・BQ未設定時）
node scripts/instagram/fetch_insights.js --csv-only
# 件数上限
node scripts/instagram/fetch_insights.js --limit 300

# 分析（当日のCSVを自動検出 → Markdown/CSVレポート）
npm run ig:analyze
# 低リーチ投稿を除外
node scripts/instagram/analyze.js --min-reach 100
```

出力先: `分析レポート/instagram_data/`
- `<日付>_media_raw.csv` / `<日付>_insights_raw.csv` … 取得生データ
- `<日付>_分析レポート.md` … 相関・上位下位比較・カルーセル別
- `<日付>_scatter.csv` … カルーセル枚数別の散布図用データ

## 4. MVPの範囲と次フェーズ

- **MVP（本実装）**: 取得 → 相関 → リーチ上位/下位比較 → カルーセル枚数別まで。
- **次フェーズ**: 全投稿の自動タグ付け（theme_tag/hook_type）、回帰分析、winning_patterns自動生成、ダッシュボードタブ化。
- レポートの「次アクション」に従い、上位投稿を手動タグ付け → 引き渡し資料11章のプロンプトでClaudeに勝ちパターンを仮抽出させる。

## 5. 構成

| ファイル | 役割 |
|---|---|
| `scripts/instagram/fetch_insights.js` | Graph API取得 → BigQuery + CSV |
| `scripts/instagram/analyze.js` | CSV/BQ読込 → 相関・比較 → レポート |
| `lib/ig-transform.js` | 取得データの変換（純粋ロジック） |
| `lib/ig-stats.js` | 統計（median/percentile/pearson/spearman） |
| `lib/ig-analyze.js` | 特徴量・相関・上位下位比較（純粋ロジック） |
| `bigquery/instagram_setup.sql` | BQスキーマ（raw 2テーブル＋特徴量ビュー） |
