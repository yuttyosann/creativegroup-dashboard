# 実績シグナル収集ツール デプロイ手順（Cloud Run・別ドメイン）

`award-signal-tool/` を Cloud Run にデプロイし、Googleログインで社内限定にする手順。
既存コックピットとは**別サービス・別ドメイン**で運用する。

> アプリ概要: [award-signal-tool/README.md](../../../award-signal-tool/README.md)
> ⚠️ `gcloud` 実行・OAuth設定・ドメイン割当は **CG側（GCPオーナー）の作業**。

## 0. 前提
- GCPプロジェクト（**既存 cg-project でOK**）
- Artifact Registry リポジトリ（例 `cg`／asia-northeast1）。無ければ作成:
  ```
  gcloud artifacts repositories create cg --repository-format=docker --location=asia-northeast1
  ```
- Notionインテグレーションが「Trepo編集部」ページに接続済み（候補プールDB作成時点で接続済み）

## 1. OAuthクライアント（ログイン用）
1. APIとサービス → OAuth同意画面（内部 or 外部）を設定
2. 認証情報 → OAuthクライアントID（**ウェブアプリ**）を作成
3. 「承認済みのJavaScript生成元」に**このツールのURL**を追加:
   - Cloud Runの払い出しURL（後述、例 `https://trepo-award-tool-xxxx.a.run.app`）
   - 独自ドメイン（例 `https://award.cg-xxx.jp`）
4. 発行された**クライアントID**を控える（`GOOGLE_OAUTH_CLIENT_ID`）

## 2. ビルド＆push（リポジトリルートで実行）
```
gcloud builds submit --config award-signal-tool/cloudbuild.yaml \
  --substitutions _IMAGE=asia-northeast1-docker.pkg.dev/PROJECT/cg/trepo-award-tool .
```
（`PROJECT` は実プロジェクトIDに置換）

## 3. Cloud Run デプロイ
```
gcloud run deploy trepo-award-tool \
  --image asia-northeast1-docker.pkg.dev/PROJECT/cg/trepo-award-tool \
  --region asia-northeast1 --allow-unauthenticated \
  --set-env-vars \
CANDIDATE_DB_ID=3832a9c9-20f7-81ad-a21e-fee38dfd4b8c,\
SEED_DB_ID=3832a9c9-20f7-811b-b44f-d11874a495c7,\
GOOGLE_OAUTH_CLIENT_ID=＜クライアントID＞,\
ALLOWED_HD=＜社内Workspaceドメイン 例 creativegroup.co.jp＞
```
**機密（NOTION_TOKEN / APIFY_TOKEN）は Secret Manager を推奨**:
```
echo -n "＜Notionトークン＞" | gcloud secrets create notion-token --data-file=-
echo -n "＜Apifyトークン＞"  | gcloud secrets create apify-token  --data-file=-
gcloud run services update trepo-award-tool --region asia-northeast1 \
  --set-secrets NOTION_TOKEN=notion-token:latest,APIFY_TOKEN=apify-token:latest
```
（簡易にやるなら `--set-env-vars` に直接 NOTION_TOKEN/APIFY_TOKEN を足してもよいが非推奨）

→ 払い出されたURL（`https://trepo-award-tool-xxxx.a.run.app`）を OAuthクライアントのJS生成元（手順1-3）に追加し忘れないこと。

## 4. アクセス制限（許可リスト）
- `ALLOWED_HD` … 社内Google Workspaceドメイン。`@そのドメイン` のアカウントのみ許可（推奨）
- `ALLOWED_EMAILS` … 個別Gmailをカンマ区切りで許可（Workspace外メンバー用）
- どちらか必ず設定すること。**両方未設定だと全Googleアカウントが通る**ので注意。

## 5. 独自ドメイン割当（別ドメイン）
```
gcloud beta run domain-mappings create --service trepo-award-tool \
  --domain award.＜任意ドメイン＞ --region asia-northeast1
```
表示されるDNSレコード（CNAME/A）をドメイン側に登録。割当後、その独自URLも手順1-3のJS生成元に追加。

## 6. 必要なAPIキー
| 変数 | 用途 | 必須 |
|---|---|---|
| NOTION_TOKEN | 候補プールDB読み書き | ✅ |
| CANDIDATE_DB_ID / SEED_DB_ID | 対象DB | ✅ |
| GOOGLE_OAUTH_CLIENT_ID | ログイン | ✅（社内限定にするなら） |
| ALLOWED_HD / ALLOWED_EMAILS | 許可リスト | ✅ |
| APIFY_TOKEN | SNS話題量(TikTok)取得 | ○ |
| YOUTUBE_API_KEY | （将来）インフル反響 | 任意 |

## トラブルシュート
- ログイン画面でボタンが出ない → OAuthクライアントの「JavaScript生成元」にアクセス中のURLが入っているか
- 403「許可されていないアカウント」→ `ALLOWED_HD`/`ALLOWED_EMAILS` を確認
- 候補が「読み込み失敗」→ NOTION_TOKEN・DB ID、Notionインテグレーションの接続を確認
- SNS話題量が 402 → Apifyのクレジット残高
- 検索の伸びが 429 → 一時的なレート制限。時間を空ける／`--sleep`を上げる（ツール側は既定で対策済み）
