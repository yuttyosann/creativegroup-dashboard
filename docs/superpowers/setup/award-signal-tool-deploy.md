# 実績シグナル収集ツール デプロイ手順（Cloud Run・別ドメイン）

`award-signal-tool/` を Cloud Run にデプロイし、Googleログインで社内限定にする手順。
既存コックピットとは**別サービス・別ドメイン**で運用する。

## ✅ 本番稼働情報（2026-06 デプロイ済み）

| 項目 | 値 |
|---|---|
| 公開URL | **https://award.trepo.jp** |
| Cloud Run URL | https://trepo-award-tool-620587423995.asia-northeast1.run.app |
| GCPプロジェクト | cg-project-491303 |
| サービス名 / リージョン | trepo-award-tool / asia-northeast1 |
| イメージ | asia-northeast1-docker.pkg.dev/cg-project-491303/cg/trepo-award-tool |
| シークレット | NOTION_TOKEN=notion-token、APIFY_TOKEN=apify-token（Secret Manager） |
| 認証 | GOOGLE_OAUTH_CLIENT_ID＋ALLOWED_EMAILS（個別Gmail許可） |
| ドメイン | award.trepo.jp（Cloud Run domain mapping・CNAME→ghs.googlehosted.com） |

**再デプロイ（コード更新時）**: ビルド（手順2）→ `gcloud run deploy trepo-award-tool --image <上記> --region asia-northeast1 --project cg-project-491303`（env/シークレットは維持される）。
**メンバー追加/削除**: `gcloud run services update trepo-award-tool --region asia-northeast1 --update-env-vars "^|^ALLOWED_EMAILS=a@x,b@y,..."`

---

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
**機密（NOTION_TOKEN / APIFY_TOKEN / ANTHROPIC_API_KEY）は Secret Manager を推奨**:
```
echo -n "＜Notionトークン＞"   | gcloud secrets create notion-token      --data-file=-
echo -n "＜Apifyトークン＞"    | gcloud secrets create apify-token       --data-file=-
echo -n "＜Anthropic APIキー＞" | gcloud secrets create anthropic-api-key --data-file=-

# Cloud Run の実行サービスアカウントに読み取り権限を付与（新規シークレットごとに必要）
SA=$(gcloud run services describe trepo-award-tool --region asia-northeast1 \
       --format='value(spec.template.spec.serviceAccountName)')
[ -z "$SA" ] && SA="$(gcloud projects describe PROJECT --format='value(projectNumber)')-compute@developer.gserviceaccount.com"
gcloud secrets add-iam-policy-binding anthropic-api-key \
  --member="serviceAccount:$SA" --role=roles/secretmanager.secretAccessor

gcloud run services update trepo-award-tool --region asia-northeast1 \
  --set-secrets NOTION_TOKEN=notion-token:latest,APIFY_TOKEN=apify-token:latest,ANTHROPIC_API_KEY=anthropic-api-key:latest
```
> ⚠️ `--set-secrets` は**指定しなかったシークレットを外す**ので、必ず3つまとめて指定すること。
> ANTHROPIC_API_KEY は候補提案のClaude精選（`scripts/ai/filter_candidates.js`）で使う。
> ローカルはリポジトリ直下の `.env` から読むが、コンテナに `.env` は入らない（.dockerignore）ため必須。
（簡易にやるなら `--set-env-vars` に直接 NOTION_TOKEN/APIFY_TOKEN を足してもよいが非推奨）

> 🩹 **必ずやる: プレースホルダ混入チェック**（2026-07-27 に `apify-token` がこの罠にハマった）。
> 上の `echo -n "＜Apifyトークン＞"` はサンプルの飾り。**実値に置き換え忘れると全角 `＜＞` がそのまま
> シークレットに入り、Apify/Claude/Notion 認証が毎回即失敗する**（症状: 「候補を提案してもらう」が提案0件、
> discover は 200 だがポーリングが十数秒で停止）。作成後に3本とも検証すること:
> ```
> for s in notion-token apify-token anthropic-api-key; do
>   v=$(gcloud secrets versions access latest --secret=$s --project=PROJECT)
>   printf '%s' "$v" | grep -q '＜' && echo "❌ $s: プレースホルダ混入" || echo "✅ $s: len=${#v}"
> done
> ```
> 期待値の目安: notion `ntn_`〜50字 / apify `apify_`〜46字 / anthropic `sk-ant-`〜108字。
> 既存シークレットを直すには `printf '%s' "<実トークン>" | gcloud secrets versions add <name> --data-file=-` の後、
> `gcloud run services update ... --update-secrets <ENV>=<name>:latest` で**新リビジョンを出して再読込**させる
> （稼働中インスタンスは起動時にシークレットを固定するので、バージョン追加だけでは反映されない）。

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
| APIFY_TOKEN | SNS話題量(TikTok)取得・候補の発掘 | ○ |
| ANTHROPIC_API_KEY | 候補提案のClaude精選 | ○（「候補を提案してもらう」を使うなら） |
| YOUTUBE_API_KEY | （将来）インフル反響 | 任意 |

## トラブルシュート
- ログイン画面でボタンが出ない → OAuthクライアントの「JavaScript生成元」にアクセス中のURLが入っているか
- 403「許可されていないアカウント」→ `ALLOWED_HD`/`ALLOWED_EMAILS` を確認
- 候補が「読み込み失敗」→ NOTION_TOKEN・DB ID、Notionインテグレーションの接続を確認
- SNS話題量が 402 → Apifyのクレジット残高
- 「候補を提案してもらう」が精選で失敗 → ANTHROPIC_API_KEY がサービスに付いているか
  （`gcloud run services describe trepo-award-tool --region asia-northeast1 --format='yaml(spec.template.spec.containers[0].env)'`）
- 検索の伸びが 429 → 一時的なレート制限。時間を空ける／`--sleep`を上げる（ツール側は既定で対策済み）
