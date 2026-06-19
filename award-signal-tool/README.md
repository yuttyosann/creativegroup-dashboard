# Trepoトレンド大賞 実績シグナル収集ツール

候補をボタンで選んで「取得」を押すと、裏で **検索の伸び（Google Trends）／メディア掲載（Google News＋PR TIMES）／SNS話題量（Apify TikTok）** を自動取得し、`suggested_point(1〜5)` を **Notion候補プールDBに書き戻す** 別アプリ。既存コックピットとは別ドメインで運用する。

> 設計の位置づけ: [docs/superpowers/specs/trepo-trend-award-2026-INDEX.md](../docs/superpowers/specs/trepo-trend-award-2026-INDEX.md) ／ [実績スコア調査ランブック](../docs/superpowers/specs/trepo-award-jisseki-research-runbook.md)

## アーキテクチャ

```
フロント(public/index.html) ── ボタン押下 ──▶ Express(server.js)
                                              ├ GET  /api/candidates  Notion候補プールDB読込
                                              ├ GET  /api/seeds        Notionシード設定DB読込
                                              ├ POST /api/jobs         非同期ジョブ起動
                                              └ GET  /api/jobs/:id      進捗ポーリング
                                                      ↓ 子プロセス実行
            lib/engines.js ──▶ scripts/trends/google_trends.py
                               scripts/media/fetch_media.py
                               scripts/apify/fetch_tiktok.js
                                                      ↓ suggested_point
            lib/notion.js ──▶ Notion候補プールDBに書戻し（_点は空欄時のみ）
```

- **非同期＋画面表示通知**: ボタン→ジョブID→裏で実行→フロントが1.5秒ごとにポーリング→完了表示
- **編集の手入力を壊さない**: `_点` は空欄のときだけ自動入力。`_根拠` は常に更新
- **自動=3シグナル**。インフル反響・売上・TikTok Creative Centerの急上昇チェックは手動（マニュアル参照）

## セットアップ（ローカル）

```bash
cd award-signal-tool
npm install
cp .env.example .env   # NOTION_TOKEN等を記入（APIFY_TOKEN/YOUTUBE_API_KEYは取得実行時に必要）
npm start              # http://localhost:4000
```

`.env` に必要な値:
| 変数 | 用途 |
|---|---|
| `NOTION_TOKEN` | Notion APIトークン |
| `CANDIDATE_DB_ID` | 候補プールDB（`3832a9c9-20f7-81ad-a21e-fee38dfd4b8c`） |
| `SEED_DB_ID` | 検索シード設定DB（`3832a9c9-20f7-811b-b44f-d11874a495c7`） |
| `APIFY_TOKEN` | SNS話題量(TikTok)取得時 |
| `YOUTUBE_API_KEY` | （将来）インフル反響取得時 |

## 検証済み（MVP）

- 候補プールDB読込 → 取得ジョブ → Notion書き戻し → 画面反映 まで実機確認済み
- メディア掲載: Google News＋PR TIMESで `suggested_point` を算出し書き戻し（例: サンリオ=5 / ロゼット=1）
- SNS話題量(Apify)・検索の伸び(Trends)は `APIFY_TOKEN` とネットワークがある環境で実行可

## 今後（デプロイ）

- Cloud Run へデプロイ（別ドメイン）。`.env` は Secret Manager / 環境変数で注入
- Googleログインで社内限定（既存のGoogle認証モジュールを流用）
- ジョブの永続化（現状はメモリ。再起動で消える）
