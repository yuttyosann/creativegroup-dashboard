# CGコックピット デプロイ手順（CG側作業）

## 1. Google Cloud 準備
1. プロジェクトを用意する
   - **既存の cg-project を使ってOK（推奨）**。BigQuery構想と同じプロジェクトに収まり、Phase 4（Sheets→BigQuery集計）が楽になる。
   - 既存を使う場合はプロジェクト新規作成は不要。新規に分離したい場合のみ https://console.cloud.google.com で作成。
2. 「YouTube Data API v3」を有効化（プロジェクト単位・他に影響なし）
3. 「Google Sheets API」を有効化（Sheets読み書き用）
4. APIキー発行（YouTube用）

## 2. OAuthクライアント（ログイン用）
1. APIとサービス → OAuth同意画面（外部）を設定
2. 認証情報 → OAuthクライアントID（ウェブアプリ）を作成
3. 承認済みJavaScript生成元に Xserverの本番URL（例 https://cg-app.jp）を追加
4. 発行されたクライアントIDを控える

## 3. スプレッドシート準備
1. スプレッドシートを新規作成し、タブ「許可リスト」「診断ログ」「インフルエンサーマスタ」「案件DB」を用意
2. 許可リストの1行目: 氏名 / Gmail / 権限。2行目以降にメンバーを記入
3. スプレッドシートIDを控える（URLの /d/〜/ の部分）
4. Cloud Runのサービスアカウントのメール（→ 3-2の手順で確認）に、このシートを「編集者」で共有

### 3-1. 「権限」列について（補足）
- 値は `admin` / `member`（デフォルト member）。
- ⚠️ **現状のMVPでは権限による機能差は無い**。Gmailがリストに載っていれば全員ログイン＆診断できる。`admin` は将来フェーズ（管理機能）用の準備で、今は記入するだけでOK。
- 「リスト自体を勝手に編集されたくない」場合は、アプリではなく**スプレッドシートの共有設定**で制御する（管理者だけ「編集者」、他は「閲覧者」）。

### 3-2. Cloud Run のサービスアカウントのメールを確認する
デフォルトでは Compute Engine デフォルトサービスアカウント `＜プロジェクト番号＞-compute@developer.gserviceaccount.com` が使われる。確認方法（いずれか）：
- **Cloud Console**：Cloud Run → サービス cg-cockpit → 「リビジョン」または「セキュリティ」タブにサービスアカウントが表示される
- **IAM**：IAMと管理 → サービスアカウント →「Default compute service account」のメール
- **gcloud**：
  ```
  gcloud run services describe cg-cockpit --region asia-northeast1 \
    --format='value(spec.template.spec.serviceAccountName)'
  ```
  （プロジェクト番号はCloud Consoleダッシュボードの「プロジェクト情報」で確認可）

※このメールを手順4でシートの「編集者」に追加する。本番でセキュリティを高めたい場合は専用サービスアカウントを作成して最小権限を与える（MVPはデフォルトでOK）。
※Cloud Runデプロイ（手順4）より前にこのSAは存在しないため、**手順4でデプロイ→SA確認→シート共有**の順でも良い。

## 4. Cloud Run デプロイ
1. gcloud CLI でログイン: `gcloud auth login`
2. デプロイ:
   ```
   gcloud run deploy cg-cockpit --source . --region asia-northeast1 \
     --allow-unauthenticated \
     --set-env-vars YOUTUBE_API_KEY=＜キー＞,GOOGLE_OAUTH_CLIENT_ID=＜クライアントID＞,SHEET_ID=＜シートID＞,ALLOWED_ORIGIN=https://cg-app.jp,APIFY_TOKEN=＜任意＞
   ```
3. 払い出されたURL（https://cg-cockpit-xxxx.a.run.app）を控える

## 5. Xserver にフロント配置
1. public/cg-cockpit.html と public/config.js をXserverにアップロード
2. config.js を編集:
   - API_BASE: Cloud RunのURL
   - GOOGLE_CLIENT_ID: OAuthクライアントID
3. 独自ドメインで cg-cockpit.html にアクセスし、Googleログイン→診断を確認

## トラブルシュート
- 403「許可リストにありません」: 許可リストSheetにそのGmailを追加
- CORSエラー: ALLOWED_ORIGIN がXserverのURLと一致しているか確認
- 401: ブラウザで再ログイン
