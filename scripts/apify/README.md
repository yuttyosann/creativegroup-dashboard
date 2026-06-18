# Apify 外部API セットアップ手順（Instagram/TikTok 転換質スキャン）

Instagramは公式APIで他人のコメントを取得できないため、Apifyの
Instagramスクレイパーを使って投稿＋コメントを取得し、当社の転換質を採点する。

## 1. Apifyアカウント作成（無料枠あり）

1. https://apify.com にサインアップ
2. **無料枠：毎月 $5 クレジット**（≒ アカウント100名分弱）
3. Settings → Integrations → **Personal API token** をコピー

## 2. .env に追記

```
APIFY_TOKEN=取得したトークンを貼る
```
（YOUTUBE_API_KEY と同様、値は共有せずご自身で追記してください）

## 3. 実行

```bash
# ユーザー名を直接指定
node scripts/apify/fetch_instagram.js piii_xx_01 karin__life m.mai_ozaki

# 提案CSVから一括（アカウント名 or URL列を自動抽出）
node scripts/apify/fetch_instagram.js --csv "/path/to/提案リスト.csv" --limit 20
```

## 4. 出力

- `分析レポート/instagram_data/<日付>_転換質.csv`
- コンソールに転換質ランキング（購買意向コメント率）

→ 提案ログDBの「転換質%」列に転記し、人間の「要望クリア/推薦理由」と照合する。

## コスト目安

| 規模 | 概算コスト |
|------|-----------|
| 1アカウント | 約 $0.05（投稿$0.50/1k・コメント$0.30/1k） |
| 20アカウント | 約 $1（無料枠内） |
| 68アカウント | 約 $3〜4 |

## 使用アクター（変更可）

スクリプト内の定数で指定。Apify Storeのアクターが変わった場合は差し替える。
- 投稿：`apify~instagram-scraper`
- コメント：`apify~instagram-comment-scraper`

## トラブルシュート

| 症状 | 対処 |
|------|------|
| 401 | トークンが無効。再コピー |
| 課金上限 | 無料枠超過。Apifyダッシュボードで確認 |
| コメント0件 | 非公開/コメント無効アカウント。投稿のみ採点 |
| アクターが見つからない | Apify Storeでアクター名を確認し定数を差し替え |

## TikTok 話題量取得（fetch_tiktok.js）

Trepoトレンド大賞2026の実績スコア「SNS話題量」用。
候補のハッシュタグ/キーワードでTikTok動画を取得し、動画数・総再生数・エンゲージを集計する。
（**発見**はCreative Center手動スイープ、**定量化**は本スクリプト、という役割分担）

```bash
# ハッシュタグ（# は任意）
node scripts/apify/fetch_tiktok.js 地雷リップ 量産型コーデ

# キーワード検索として扱う
node scripts/apify/fetch_tiktok.js --search "〇〇カフェ" "△△グミ"

# 候補プールDBから書き出したCSVで一括（対象名の列を指定）
node scripts/apify/fetch_tiktok.js --csv candidates.csv --col 対象名 --limit 30
```

- 使用アクター: `clockworks~tiktok-scraper`（Storeで変わったらスクリプト内定数を差し替え）
- 出力: `分析レポート/tiktok_data/<日付>_話題量.csv`
  - 列: 対象 / 種別 / サンプル動画数 / 総再生数 / 平均再生数 / 総エンゲージ / エンゲージ率% / 話題量_点(1-5)
  - `話題量_点` … 総再生数のプール内5分位（v0.1の目安。最終点は編集判断で上書き可）
- → `話題量_点` を候補プールDBの `SNS話題量_点`、総再生数等を `SNS_根拠` に転記。

### オプション

| オプション | 既定 | 説明 |
|---|---|---|
| `--search` | （無し=ハッシュタグ） | キーワード検索として取得 |
| `--per N` | 50 | 1対象あたりの取得動画数 |
| `--csv PATH --col 列名` | — | CSV一括。列名未指定なら先頭列 |
| `--limit N` | 30 | CSV時の最大対象数 |

### コスト目安

| 規模 | 概算 |
|------|------|
| 1ハッシュタグ | 約 $0.02〜0.05（取得動画数による） |
| 30対象 | 約 $1前後（無料枠内） |
