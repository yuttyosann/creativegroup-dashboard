# メディア掲載 取得手順（Trepoトレンド大賞2026 「メディア掲載」用）

候補名で **Google News（実際の報道）** と **PR TIMES（企業のPR活動）** の掲載件数を取得し、
実績スコア「メディア掲載」の素材（1〜5）を出す。**標準ライブラリのみ・pip不要**。

仕様出典: `docs/superpowers/specs/trepo-award-jisseki-research-runbook.md`

## 使い方

```bash
# スペース or カンマ区切り
python3 scripts/media/fetch_media.py "〇〇リップ" "△△グミ"

# 候補プールDBから書き出したCSVで一括（対象名の列を指定）
python3 scripts/media/fetch_media.py --csv candidates.csv --col 対象名 --limit 30

# PR TIMESだけ / Google Newsだけ
python3 scripts/media/fetch_media.py --no-news "〇〇リップ"
python3 scripts/media/fetch_media.py --no-prtimes "〇〇リップ"
```

- 出力: `分析レポート/media_data/<日付>_メディア掲載.csv`
  - 列: keyword / news_count / prtimes_count(1ページ実数) / prtimes_total(総件数) / suggested_point(1-5) / news_titles
  - `suggested_point` … **ニュースとPR TIMESをそれぞれプール内5分位 → 該当ソースの平均**で1〜5化
- → `suggested_point` を候補プールDBの `メディア掲載_点`、news_count/titles等を `メディア_根拠` に転記。

## オプション

| オプション | 既定 | 説明 |
|---|---|---|
| `--after YYYY-MM-DD` | 今年1/1 | この日以降の報道に限定（賞は2026実績が対象） |
| `--no-news` | — | Google Newsをスキップ |
| `--no-prtimes` | — | PR TIMESをスキップ |
| `--csv PATH --col 列名` | — | CSV一括。列名未指定なら先頭列 |
| `--limit N` | 30 | CSV時の最大対象数 |
| `--out PATH` | 自動 | 出力CSVパス |

## 信号の性質（正直な注意）

| ソース | 性質 | 注意 |
|---|---|---|
| **Google News** | 実際の報道件数（メディア掲載の本命） | news.google.com に接続＝**社内ネットワークで実行**。RSS最大100件程度 |
| **PR TIMES `prtimes_total`** | 企業のPR活動量（総リリース件数） | 商品名ごとに段階差が出る主指標。ただし**部分一致で緩め**なので具体的な商品名で使う |
| **PR TIMES `prtimes_count`** | 1ページ実リリース数 | 最大40で頭打ち。差がつかないので参考のみ |

- `suggested_point` はv0.1のヒューリスティック。最終点は編集判断で上書き可。
- 低頻度・節度を持って実行（検索を連打しない。スクリプトは1.5秒間隔を入れている）。

## 検証状況

- PR TIMES経路: サンドボックスで実機検証済み（サンリオ=5 / ちいかわ=4 / ロゼット=2 と段階化を確認）。
- Google News経路: news.google.com がサンドボックス外のため未検証。社内ネットワークで実行して確認のこと。

## Phase 2（将来）

CSV出力を BigQuery に集約し、SQLビューで実績スコアに統合（ARCHITECTURE.md準拠）。
