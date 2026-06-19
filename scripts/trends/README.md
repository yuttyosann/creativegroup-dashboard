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

# バッチ間の比較精度を上げる基準語を指定（任意・推奨）
python3 scripts/trends/google_trends.py score "a,b,c,d,e,f" --anchor "iPhone"
```
- 出力: `分析レポート/trends_data/<日付>_score.csv`
  - `mean_interest` … 平均関心度（anchor指定時はスケール正規化）
  - `rising_ratio` … 直近 ÷ 前半（>1で伸びている）
  - `is_breakout` … 関連クエリでBreakout判定
  - `suggested_point` … プール内5分位での1〜5目安（**v0.1の目安。最終点は編集判断で上書き可**）
- → `suggested_point` を候補プールDBの `検索の伸び_点`、`rising_ratio`等を `検索_根拠` に転記。

## 3. オプション

| オプション | 既定 | 説明 |
|---|---|---|
| `--geo` | JP | 地域 |
| `--timeframe` | 今年1/1〜実行日 | 期間（例: `"2026-01-01 2026-06-17"`） |
| `--anchor` | なし | バッチ間比較の基準語（scoreの精度向上） |
| `--out` | 自動 | 出力CSVパス |

## 4. なぜ anchor が要るか

Google Trendsの関心度は**1リクエスト内での相対値（0-100）**。pytrendsは1回最大5語まで。
候補が6語以上だとバッチに分かれ、バッチ間で数値が比較できない。
そこで**全バッチに共通の基準語（anchor）を入れ、その値でスケール**して比較可能にする。
基準語は「年間を通して検索量が安定し、候補と無関係な一般語」（例: `iPhone`）が良い。

## 5. 制約（正直な注意）

| 項目 | 制約 |
|---|---|
| pytrends | 非公式・不安定。落ちたら時間をおいて再試行 |
| 関心度 | 相対値のみ。絶対的な検索ボリュームは出ない |
| discover | 日次/リアルタイムの一般トレンド。商品トレンド以外のノイズも混ざる→人手で取捨 |
| suggested_point | v0.1のヒューリスティック。次サイクルで実績較正 |

## 6. Phase 2（将来）

このCSV出力を BigQuery（`cg_external` / `cg_analytics.trend_award_signals`）に集約し、
SQLビューで実績スコアを自動算出。Cloud Schedulerで日次バッチ化（ARCHITECTURE.md準拠）。
