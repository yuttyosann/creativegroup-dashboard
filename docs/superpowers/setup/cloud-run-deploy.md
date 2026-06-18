# CGコックピット デプロイ手順（CG側作業）

## 1. Google Cloud 準備
1. https://console.cloud.google.com でプロジェクト作成（無料）
2. 「YouTube Data API v3」を有効化
3. APIキー発行（YouTube用）

## 2. OAuthクライアント（ログイン用）
1. APIとサービス → OAuth同意画面（外部）を設定
2. 認証情報 → OAuthクライアントID（ウェブアプリ）を作成
3. 承認済みJavaScript生成元に Xserverの本番URL（例 https://cg-app.jp）を追加
4. 発行されたクライアントIDを控える

## 3. スプレッドシート準備
1. スプレッドシートを新規作成し、タブ「許可リスト」「診断ログ」「インフルエンサーマスタ」「案件DB」を用意
2. 許可リストの1行目: 氏名 / Gmail / 権限。2行目以降にメンバーを記入
3. スプレッドシートIDを控える（URLの /d/〜/ の部分）
4. Cloud Runのサービスアカウントのメールに、このシートを「編集者」で共有

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
