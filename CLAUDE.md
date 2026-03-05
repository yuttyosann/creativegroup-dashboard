# CreativeGroup 経営ダッシュボード — Claude Code 指示書

## プロジェクト概要
MFクラウド（MoneyForward）APIと連携し、売上・請求書・入金データを
リアルタイムでダッシュボードに表示するWebアプリ。

## 技術スタック
- Node.js (Express) — APIサーバー・OAuthフロー処理
- Vanilla JS + Chart.js — フロントエンドダッシュボード
- MFクラウド請求書API v3 / 会計API

---

## セットアップ手順

### 1. 依存パッケージのインストール
```bash
cd creativegroup-dashboard
npm install
```

### 2. 環境変数の設定
`.env` ファイルに以下を記入：
```
MF_CLIENT_ID=取得したClient IDをここに貼る
MF_CLIENT_SECRET=取得したClient Secretをここに貼る
MF_REDIRECT_URI=http://localhost:3000/callback
SESSION_SECRET=任意のランダム文字列（例: cg_dashboard_2025）
PORT=3000
```

### 3. サーバー起動
```bash
npm start
```

### 4. ブラウザでアクセス
http://localhost:3000 を開くと、MFクラウドのOAuth認証画面に飛ぶ。
ログイン・承認するとダッシュボードが表示される。

---

## API連携の仕様

### 認証フロー（OAuth 2.0 Authorization Code）
1. `/` アクセス → MFクラウド認可ページへリダイレクト
2. ユーザーが承認 → `/callback` にコードが返る
3. コードをアクセストークンに交換して保存
4. 以降のAPIリクエストにトークンを付与

### 使用するMFクラウドAPIエンドポイント
| データ | エンドポイント |
|--------|---------------|
| 請求書一覧 | GET /api/v3/billings |
| 取引先一覧 | GET /api/v3/partners |
| 品目一覧 | GET /api/v3/items |

### ダッシュボード表示データ
- 月次売上合計（請求書の金額集計）
- 未入金リスト（ステータス: 未入金）
- チーム別売上（品目タグで分類）
- クライアント別収益（取引先ごとの集計）

---

## ファイル構成
```
creativegroup-dashboard/
├── .env                  ← 環境変数（Gitに入れない）
├── .gitignore
├── package.json
├── server.js             ← Expressサーバー・OAuthフロー
├── routes/
│   ├── auth.js           ← OAuth認証ルート
│   └── api.js            ← MFクラウドAPIプロキシルート
├── public/
│   ├── index.html        ← ダッシュボードUI
│   ├── dashboard.js      ← データ取得・グラフ描画
│   └── style.css
└── CLAUDE.md             ← この指示書
```

---

## Claude Codeへの追加タスク

### タスク1: MFクラウドAPI連携の実装
`server.js` と `routes/auth.js` を実装する。
OAuthフローを完成させ、アクセストークンをセッションに保存する。

### タスク2: データ取得・集計ロジック
`routes/api.js` に以下のエンドポイントを実装：
- `GET /api/summary` — 月次売上・粗利サマリー
- `GET /api/billings` — 請求書一覧（未入金フィルタ付き）
- `GET /api/partners` — クライアント別収益

### タスク3: トークン自動更新
アクセストークンの有効期限切れ時にリフレッシュトークンで自動更新する
ミドルウェアを実装する。

### タスク4: ダッシュボードUIとの接続
`public/dashboard.js` で `/api/*` を呼び出し、
Chart.jsのグラフをリアルタイムデータで更新する。
