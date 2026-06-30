# Instagram 投稿分析 MVP — 設計書

**作成日:** 2026-06-30
**テーマ:** カルーセル枚数・エンゲージメント率・リーチ伸長要因の分析
**スコープ:** MVP（引き渡し資料13章）
**プラットフォーム:** Node.js → BigQuery（ARCHITECTURE.md 準拠）

---

## 1. 目的

自社Instagramアカウントの投稿単位データを公式Graph APIで取得し、以下を分析できる状態にする（MVP）。

1. カルーセル枚数とエンゲージメント率／リーチの相関を確認する。
2. リーチ上位25%と下位25%の投稿を比較し、共通点・違いを抽出する。
3. 「リーチが伸びる型」「エンゲージメント率が高い型」を仮抽出するための数値根拠を出す。

MVPでは自動タグ付け・回帰・勝ちパターン自動生成は行わず、**傾向が見える最小構成**に絞る。
有効性が見えたら次フェーズ（タグ付け自動化・winning_patterns・ダッシュボード化）へ拡張する。

---

## 2. 前提・制約

- 対象は自社IGプロアカウント（Business/Creator）。
- 認証情報（Meta App / IG User ID / 長期アクセストークン）は**未取得**のため、取得手順を README で提供する。
- Insights指標はメディア種別で取得可否が変わるため、フォールバック処理を必須とする。
- Insights系は広告由来の扱い・反映遅延・保持期間の制約があるため、分析レポートに注記を付ける。
- 既存の `scripts/apify/fetch_instagram.js` は「他者アカウントをApifyでスクレイピングし提案採点する」別物。本件は自社アカウントの公式API分析であり、新規実装とする。

---

## 3. 全体構成

```
scripts/instagram/
  README.md           ← 認証情報の取得手順 ＋ 使い方
  fetch_insights.js   ← Graph API取得 → BigQuery + ローカルCSV
  analyze.js          ← MVP分析（相関・上位下位比較） → レポート出力
bigquery/
  instagram_setup.sql ← ig_media_raw / ig_insights_raw / ig_media_features(ビュー)
分析レポート/instagram_data/   ← CSV・分析レポートの出力先
```

**データフロー:**
```
Graph API ──fetch_insights.js──> BigQuery raw 2テーブル（主シンク）
                              └─> 分析レポート/instagram_data/<日付>_*.csv（バックアップ／オフライン）
BigQuery(or CSV) ──analyze.js──> 分析レポート/instagram_data/<日付>_分析レポート.md ＋ 数値CSV
```

設計原則：**生データの蓄積は BigQuery（アーキ準拠）、相関・中央値の計算は Node 側で自前実装**（依存追加なし、CSV でも BQ でも動き、BQ 未設定でも MVP が回る）。

---

## 4. 認証ガイド（scripts/instagram/README.md）

トークン未準備のため、以下を手順化する。

1. Meta for Developers でアプリ作成（タイプ: Business）。
2. Instagram Graph API（または Instagram API with Instagram Login）を連携。
3. 対象IGアカウントに紐づく **IG User ID** を取得する手順。
4. **長期アクセストークン（約60日）** の発行手順（短期→長期の交換、`fb_exchange_token`）。
5. 必要権限: `instagram_basic`, `instagram_manage_insights`, `pages_read_engagement`。
6. `.env` への追記（既存の `APIFY_TOKEN` 等と同じ流儀）:
   ```
   IG_USER_ID=...
   IG_ACCESS_TOKEN=...
   IG_API_VERSION=v21.0   # 任意。未指定時のデフォルトをコードに持つ
   ```
7. トークン期限切れ時の再発行メモ（60日でリフレッシュが必要なこと）。

> API version・指標名は Meta Developers 公式ドキュメントを最新版で確認する旨を明記する。

---

## 5. fetch_insights.js

### 5.1 投稿一覧取得
- `GET /{ig-user-id}/media?fields=id,caption,media_type,media_product_type,timestamp,permalink,like_count,comments_count,children{id,media_type}&limit=100`
- `paging.next` が存在する限り全件取得（ページネーション）。
- `children` 件数から `carousel_count` を算出（CAROUSEL_ALBUM以外は1）。
- `timestamp` から `date` / `weekday` / `hour` を導出。

### 5.2 投稿Insights取得（フォールバック必須）
投稿ごとに `/insights` を取得。1回でエラー時は指標セットを分けて再試行する：
1. `reach,saved`
2. `shares,total_interactions`
3. `profile_visits,follows`
4. `views`

取得できなかった指標は欠損（null）とし、エラー内容を `insight_error` に記録する。

### 5.3 出力
- **BigQuery（主シンク）**: `ig_media_raw` / `ig_insights_raw` に `media_id` で MERGE（重複更新）。
- **ローカルCSV（バックアップ）**: `分析レポート/instagram_data/<日付>_media_raw.csv` / `<日付>_insights_raw.csv`。
- **fetch_log**: 実行日時・取得件数・エラー件数をコンソール出力＋CSV末尾ログ（MVPではBQ fetch_logテーブルは任意）。

### 5.4 引数・実行
```
node scripts/instagram/fetch_insights.js              # 全件取得（BQ + CSV）
node scripts/instagram/fetch_insights.js --limit 300  # 件数上限
node scripts/instagram/fetch_insights.js --csv-only   # BQに書かずCSVのみ（BQ未設定時）
```
- `.env` に `IG_USER_ID` / `IG_ACCESS_TOKEN` が無ければ明確なエラーで停止（既存スクリプトの流儀）。

---

## 6. bigquery/instagram_setup.sql

プロジェクト/データセットは既存SQLと統一（`cg-project-491303.cg_analytics`、`asia-northeast1`）。

### 6.1 ig_media_raw
`media_id`(PK), `timestamp`, `date`(PARTITION), `weekday`, `hour`, `permalink`, `caption`,
`media_type`, `media_product_type`, `like_count`, `comments_count`,
`children_count`, `carousel_count`, `is_carousel`, `children_media_types`, `loaded_at`

### 6.2 ig_insights_raw
`media_id`(PK), `fetched_at`, `reach`, `saved`, `shares`, `total_interactions`,
`profile_visits`, `follows`, `views`, `insight_error`, `loaded_at`

### 6.3 ig_media_features（ビュー）
raw 2テーブルを `media_id` で結合し、`SAFE_DIVIDE` で算出：
- `engagement_rate = total_interactions / reach`
- `basic_engagement_rate = (like_count + comments_count) / reach`
- `save_rate = saved / reach`, `share_rate = shares / reach`, `comment_rate = comments_count / reach`
- `profile_visit_rate`, `follow_rate`
- `reach_log = LN(reach + 1)`
- `caption_length`, `hashtag_count`, `mention_count`, `carousel_count`

---

## 7. analyze.js（MVP分析）

BigQuery（接続不可なら同日CSV）から `ig_media_features` 相当を読み、以下を出力する。

### 7.1 相関（Pearson＋Spearman 併記）
| x | y |
|---|---|
| carousel_count | engagement_rate |
| carousel_count | reach |
| save_rate | reach |
| share_rate | reach |

- Pearson・Spearman を自前実装（外れ値・非線形に備えSpearmanも重視）。
- サンプル数 n を併記。

### 7.2 リーチ上位25% × 下位25%比較
- 比較項目（**中央値**）: carousel_count / engagement_rate / save_rate / share_rate / 投稿曜日・時間帯。
- 各群の代表投稿URL（permalink）一覧。
- 平均ではなく中央値を主軸（バズ1件に引っ張られない）。

### 7.3 カルーセル枚数別データ
- `carousel_count` ごとの engagement_rate / save_rate / reach 中央値（散布図用CSV）。

### 7.4 出力
- `分析レポート/instagram_data/<日付>_分析レポート.md`（見出し: 全体サマリー / 相関 / 上位下位比較 / カルーセル枚数別 / 注意点）。
- `<日付>_scatter.csv`（カルーセル枚数 × 各指標）。
- 注記: 相関は因果ではない・サンプル少の型は仮説扱い・広告/キャンペーン投稿は別解釈、を必ず明記。

### 7.5 分析対象フィルタ
既定で以下を除外する（`computeFeaturesWithStats` が件数も返し、レポートに内訳を明示）。
- API取得エラーで `reach` 欠損／Insights取得不可の投稿。
- リーチ下限 `--min-reach` 未満（既定0）。
- **投稿48時間未満**（`timestamp` から判定。`--keep-fresh` で無効化、`--min-age-hours` で時間変更）。
- **広告投稿**（`is_boosted=true`。media_rawの手動マーク前提。`--keep-ads` で無効化）。
- **キャンペーン/プレゼント投稿**（caption キーワードのヒューリスティック検出。`--keep-ads` で無効化）。

注意: `is_boosted` はGraph APIの基本フィールドで確実に取れないため手動マーク（既定false）。
キャンペーン判定はヒューリスティックのため取りこぼし・誤除外がありうる旨をレポートに注記する。

---

## 8. MVP外（次フェーズ）

- 全投稿の自動タグ付け（content_tags: theme_tag / hook_type / creative_type 等）。
- 回帰分析（log(reach+1) 目的変数）。
- winning_patterns 自動生成・型カテゴリ分類。
- ダッシュボードタブ化（Chart.js / Looker Studio）。

→ MVPレポート末尾に「リーチ上位投稿を手動でtheme_tag/hook_tag付け → Claudeで勝ちパターン仮抽出」の手順だけ残す。

---

## 9. 実装単位（独立性）

| 単位 | 役割 | 依存 |
|---|---|---|
| README.md | 認証情報取得・運用手順 | なし（ドキュメント） |
| instagram_setup.sql | BQスキーマ定義 | BigQuery |
| fetch_insights.js | API取得→BQ/CSV書込 | Graph API, @google-cloud/bigquery, .env |
| analyze.js | 特徴量読込→相関/比較→レポート | BQ or CSV |

各単位は独立して動作・テスト可能。`fetch` と `analyze` は CSV を介して疎結合（BQ未設定でも分析が回る）。

---

## 10. 注意点

- Graph API のバージョン・指標名は実装時に Meta Developers 公式で最新確認する。
- Insights指標はメディア種別で取得可否が変わる前提でフォールバックを必ず入れる。
- 長期トークンは約60日で失効するため、運用上のリフレッシュをREADMEに明記。
- 分析結果は相関＝因果でない旨・サンプル数の注記を必須とする。
