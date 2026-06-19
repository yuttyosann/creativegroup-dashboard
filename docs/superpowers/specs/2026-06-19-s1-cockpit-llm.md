# S1: コックピット改善＋LLM連携 設計書

- 日付: 2026-06-19
- ステータス: 設計確定（実装前）
- 親プロジェクト: CG インフルエンサープラットフォーム再構成（S1〜S3 のうち S1）

## 背景

施策進行コックピット（`public/cg-cockpit.html` ＋ `cockpit-server.js`、Cloud Run稼働）は、
診断スクリプトのWeb実行・Sheets保存まで動いている。残る課題は次の通り。

- **商品分析（step2）／診断（step5）がコピペ運用**：プロンプト文面を手でコピーし、
  別途Claudeチャットに貼って結果を得ている。Web画面内で完結したい。
- **候補を探す（step3）**：YouTube自動検索が画面に出ておらず、Astream CSV取込はあるが
  Astreamログインへの導線がない。
- **全体フロー（step0）**：13ステップの順序は出るが各工程の説明がない。

本設計（S1）は、既存の単一ページ構成のまま、これらを解消する。
データモデル拡張（ブランド→商品→案件）や2モード画面、クライアントポータルは
後続の S2 / S3 で別途設計する（本設計の対象外）。

## ゴール / 非ゴール

**ゴール**
1. 商品分析・診断をWeb画面のボタン操作で完結（Claude API連携）
2. 候補タブにYouTubeキーワード検索の実行UIを表示
3. Astream CSV欄の近くにAstreamログインリンクを設置
4. 全体フローの各ステップに1行説明を追加
5. 詳細マニュアルページ（タブ）を別途追加：各工程の目的・操作手順・注意点を詳しく掲載

**非ゴール（S1では作らない）**
- ブランド/商品/案件のデータモデル、インフルエンサーDB、フィルター検索（→S2）
- クライアントポータル・案件専用リンク（→S3）
- モデルのOpus切替UI（S1はSonnet固定。将来S2以降で検討）

## アーキテクチャ

新インフラは増やさない。既存サーバにエンドポイントを1本追加する。

```
ブラウザ public/cg-cockpit.html
  ├─ 商品分析タブ : 商品情報を入力 →[分析]→ POST /api/cockpit/analyze {kind:"product"} → 結果表示
  ├─ 診断タブ     : 診断データを入力 →[診断]→ POST /api/cockpit/analyze {kind:"diagnose"} → 結果表示
  ├─ 候補タブ     : キーワード→[検索] (既存 /api/cockpit/yt-search) ／ Astream CSV(既存) ＋ ログインリンク
  └─ 全体フロー   : 各ステップに説明文（静的）
            │
            ▼
cockpit-server.js
  POST /api/cockpit/analyze (requireAuth)
    → buildAnalyzePrompt(kind, payload)  ※lib/analyze-prompt.js（テスト対象）
    → Anthropic Messages API (claude-sonnet-4-6)
    → 返答テキストを { ok, text } で返す
            │
            ▼
  Anthropic API  ← ANTHROPIC_API_KEY（Cloud Run 環境変数。ブラウザには出さない）
```

## コンポーネント設計

### 1. `lib/analyze-prompt.js`（新規・テスト対象）
プロンプト組み立てを純粋関数に切り出し、サーバ本体から分離する。

```
buildAnalyzePrompt(kind, payload) -> { system, user }
```

- `kind === "product"`：商品分析プロンプト（既存コピペ文面を内蔵）に payload を差し込む。
  payload 例：`{ productName, brand, category, price, features, target }`
- `kind === "diagnose"`：診断プロンプト（v0.6 のカテゴリ非依存版・既存コピペ文面）に
  payload を差し込む。payload 例：`{ productContext, influencerData }`
- 未知の `kind`：`throw new Error("unknown kind")`
- payload の必須項目が欠ける場合：欠落項目名を含むエラーを投げる

文面は `CG_インフルエンサー診断_v0.1.md` の確定プロンプトを正とし、ここに転記する。

### 2. `POST /api/cockpit/analyze`（cockpit-server.js に追加）
- `requireAuth` を適用（既存のBearer＋許可リスト照合）
- body: `{ kind, payload }`
- `ANTHROPIC_API_KEY` 未設定なら 400「ANTHROPIC_API_KEY未設定」
- `buildAnalyzePrompt` でプロンプト生成 → Anthropic Messages API を呼ぶ
  - model: `claude-sonnet-4-6`
  - max_tokens: 4096（診断レポートが長文になり得るため）
- 成功：`{ ok:true, text }` を返す。失敗：`{ ok:false, error }`（500/400）
- 呼び出しは `@anthropic-ai/sdk` を使用（package.json に追加）

### 3. フロント `public/cg-cockpit.html`
- **商品分析タブ**：コピペ用テキストエリアを、入力フォーム（商品名/ブランド/カテゴリ/価格/特徴/ターゲット）
  ＋[分析する]ボタンに置換。結果は下部に表示（処理30〜60秒のため「実行中・リロードしないで」表示を流用）。
- **診断タブ**：診断対象の入力（商品文脈＋インフルエンサーデータ）＋[診断する]ボタン。結果を表示。
- **候補タブ**：キーワード入力＋[検索]ボタン（既存 `/api/cockpit/yt-search` を呼びテーブル表示）。
  Astream CSV欄の近くに「Astreamにログイン →」リンクボタンを追加。
- 既存の `api(path, body)` ヘルパ（Bearer付与・エラー文言）をそのまま使う。

### 4. 全体フロー説明（静的）
13ステップそれぞれに1行説明を `cg-cockpit.html` の flow タブに直書き。
（内容は既存の業務マニュアル `CG_インフルエンサー提案_業務マニュアル.md` の各工程定義に整合させる。）

### 5. マニュアルタブ（静的・新規）
flow タブの1行説明とは別に、独立した「マニュアル」タブを追加し、各工程を詳しく掲載する。
- 元ネタ：`CG_インフルエンサー提案_業務マニュアル.md`（既存）。Sheets/コード変更は不要。
- 各工程ごとに「目的」「操作手順」「注意点・判断基準」を見出し付きで記載。
- 長文になるため、タブ内に工程アンカー（目次リンク）を置いて飛べるようにする。
- フロントの静的HTMLとして実装（API呼び出しなし）。flowタブが「順序の俯瞰」、
  マニュアルタブが「各工程の詳細手順」という役割分担。

## データフロー（商品分析の例）
1. ユーザーが商品情報を入力し[分析する]を押す
2. フロントが `POST /api/cockpit/analyze {kind:"product", payload:{...}}`（Bearer付与）
3. `requireAuth` がトークン検証＋許可リスト照合
4. `buildAnalyzePrompt("product", payload)` で system/user プロンプト生成
5. Anthropic API (Sonnet 4.6) に送信、返答テキスト取得
6. `{ok:true, text}` を返却 → フロントが結果欄に表示

## エラーハンドリング
- 未ログイン/許可リスト外：既存 requireAuth が 401/403（フロントは既存の文言表示）
- `ANTHROPIC_API_KEY` 未設定：400「ANTHROPIC_API_KEY未設定（Cloud Runの環境変数に追加してください）」
- Anthropic API エラー（レート/タイムアウト）：500 ＋ エラー要約（先頭500字）
- payload 欠落：buildAnalyzePrompt が投げる → 400 で欠落項目名を返す
- 長時間処理中のリロードによるfetch中断：既存の「実行中・リロードしないで」警告で予防

## テスト方針
- `test/analyze-prompt.test.js`（node:test）
  - product/diagnose それぞれで payload が文面に差し込まれること
  - 未知 kind でエラー
  - 必須項目欠落でエラー（項目名を含む）
- Anthropic API 実呼び出しはキー必須のため手動結合確認（デプロイ後に1件ずつ）

## デプロイ / 設定手順（ユーザー作業）
1. Anthropic コンソール（console.anthropic.com）でAPIキーを発行（**ユーザーが実施**）
2. Cloud Run に環境変数を設定：
   `gcloud run services update cg-cockpit --region asia-northeast1 --update-env-vars ANTHROPIC_API_KEY=＜キー＞`
3. 再デプロイ（`gcloud run deploy ...`）
4. 最新 `cg-cockpit.html` を Xserver に再アップロード

※APIキーはサーバ側環境変数のみ。`public/config.js` 等のフロントには絶対に置かない。

## 未確定事項（実装時に確定）
- Astreamの正規ログインURL（リンク先）→ 実装時にユーザーへ確認
- 商品分析／診断プロンプトの最終文面 → `CG_インフルエンサー診断_v0.1.md` から転記し確定
