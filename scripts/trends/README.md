# Google Trends 取得手順（Trepoトレンド大賞2026 「検索の伸び」用）

ジャンル横断のトレンド候補生成（discover）と、候補名ごとの「検索の伸び」採点（score）を行う。
Google Trendsは**ジャンルを問わずキーワード単位**で取れるため、コスメ以外のジャンル
（食品・ファッション・おでかけ・エンタメ等）でも同じ仕組みで使える＝**横断バックボーン**。

仕様出典: `docs/superpowers/specs/trepo-award-jisseki-research-runbook.md`

## 1. セットアップ

```bash
python3 -m pip install -r scripts/requirements.txt
```

> ⚠️ **urllib3 は v1系が必須**（`urllib3<2`）。v2だと pytrends が `method_whitelist` エラーで落ちる。
> requirements.txt で固定済み。

> pytrendsはGoogle Trendsの**非公式API**。**429（レート制限）**で落ちることが多い前提で使う
> （短時間に叩きすぎない・失敗したら時間をおく・連続実行を避ける）。安定運用が必要なら
> 時間を空けた再試行やプロキシ併用を検討する。

## 2. 使い方

### discover（候補生成・ジャンル横断）
日本の急上昇検索を取得し、候補のシードにする。

```bash
python3 scripts/trends/google_trends.py discover
```
- 出力: `分析レポート/trends_data/<日付>_discover.csv`
- → 人手でカテゴリを付与し、候補プールDBに `流入経路=編集部リサーチ` で投入。

### score（実績スコア「検索の伸び」採点）
候補名を入れて、検索の伸びを1〜5の素材として算出する。

```bash
# カンマ区切り
python3 scripts/trends/google_trends.py score "〇〇リップ,△△グミ,□□カフェ"

# 候補プールDBから書き出したCSVで一括（対象名の列を指定）
python3 scripts/trends/google_trends.py score --csv candidates.csv --col 対象名

# 429が出やすい時は待機を長めに
python3 scripts/trends/google_trends.py score --csv candidates.csv --col 対象名 --sleep 15
```
- **1キーワードずつ**軽いリクエストで取得し、`--sleep`秒の間隔を空けて429（レート制限）を回避する。
  「検索の伸び」は `rising_ratio`（伸び率）で測れるため、複数比較やanchorは不要。
- 出力: `分析レポート/trends_data/<日付>_score.csv`
  - `rising_ratio` … 直近 ÷ 前半（>1で伸びている）＝採点の主指標
  - `mean_interest` … 平均関心度（参考。キーワード単体の0-100相対値）
  - `suggested_point` … `rising_ratio`のプール内5分位での1〜5目安（**v0.1。最終点は編集判断で上書き可**）
- → `suggested_point` を候補プールDBの `検索の伸び_点`、`rising_ratio`等を `検索_根拠` に転記。

## 3. オプション

| オプション | 既定 | 説明 |
|---|---|---|
| `--geo` | JP | 地域 |
| `--timeframe` | 今年1/1〜実行日 | 期間（例: `"2026-01-01 2026-06-17"`） |
| `--sleep` | 8 | キーワード間の待機秒（429が多い時は15〜30に上げる） |
| `--breakout` | オフ | 関連クエリでbreakout判定（リクエスト増・429リスク上昇） |
| `--out` | 自動 | 出力CSVパス |

## 4. 429（レート制限）対策

Google Trendsは自動アクセスを強くレート制限する。本スクリプトは次で回避している:
- **実ブラウザ風のUser-Agent**を付与（デフォルトUAは即ブロックされる＝最大の要因）
- **1キーワード=1リクエスト**に限定（重い複数比較リクエストを避ける）
- **キーワード間に`--sleep`秒の待機**＋429時はクールダウン後に1回再試行
- それでも出る場合は `--sleep` を上げる／時間を空ける／連続実行を避ける。安定運用が必須なら
  プロキシ併用や有料のTrends API（SerpApi等）も選択肢。

## 5. 制約（正直な注意）

| 項目 | 制約 |
|---|---|
| pytrends | 非公式。429が出ることがある（上記対策で大幅軽減） |
| 関心度 | 相対値のみ。絶対的な検索ボリュームは出ない |
| discover | 日次/リアルタイムの一般トレンド。商品トレンド以外のノイズも混ざる→人手で取捨 |
| suggested_point | v0.1のヒューリスティック。次サイクルで実績較正 |

## 6. Phase 2（将来）

このCSV出力を BigQuery（`cg_external` / `cg_analytics.trend_award_signals`）に集約し、
SQLビューで実績スコアを自動算出。Cloud Schedulerで日次バッチ化（ARCHITECTURE.md準拠）。
