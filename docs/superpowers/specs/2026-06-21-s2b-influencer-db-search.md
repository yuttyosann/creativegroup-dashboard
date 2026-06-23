# S2b: インフルエンサーDB＋フィルター検索（Mode B）設計書

- 日付: 2026-06-21
- ステータス: 設計確定（実装前）
- 親プロジェクト: CG インフルエンサープラットフォーム再構成（S1完了／S2a完了／本書=S2b／S3未着手）

## 背景

S1で診断のWeb完結、S2aでブランド→商品→案件のデータモデルと案件管理（Mode A）を実装した。
本書（S2b）は **Mode B（候補拡充）**：案件が無くても、採点済みインフルエンサー候補を
DBに貯め、フィルター検索で必要時にすぐ引ける状態をつくる。

既存の「インフルエンサーマスタ」（GAS生成）はタイトル行＋3行目ヘッダーの装飾フォーマットで
`readRows`（1行目＝ヘッダー前提）では読めないため、コックピットが読み書きできる
**新タブ「インフルエンサーDB」**（1行目ヘッダー）を新設する。既存マスタはそのまま残す。

非対象：実績（実売/ROAS）の自動連携。S2bでは「実績サマリー」自由記述列で手動記録のみとし、
案件完了→実績入力→DB自動反映の本格連携は将来 **S2c** で設計する。クライアントポータルは S3。

## ゴール / 非ゴール

**ゴール**
1. コックピットが読み書きする「インフルエンサーDB」タブ（1行目ヘッダー・`inf_id`自動採番）
2. YouTube一括診断・Astream取込の結果から「DBに登録」ボタンで候補をupsert（媒体＋アカウント名キー）
3. 候補DBタブ：フィルター検索（媒体/ジャンル/フォロワー範囲/転換質/スクリーニング/女性%/フリーワード）＋手動追加フォーム

**非ゴール**
- 実績（実売/ROAS）の案件完了→自動反映（→S2c）。S2bは「実績サマリー」手動メモのみ
- 既存インフルエンサーマスタ（GAS）の移行・統合（当面そのまま並存）
- 検索結果から案件への直接アサイン（将来拡張）

## アーキテクチャ

S1/S2aと同じ Node/Sheets 構成。フィルタはクライアント側JS（全件取得して絞り込み）でシンプルに。

```
ブラウザ public/cg-cockpit.html
  ├─ 候補DBタブ（新規）：フィルタUI → 全件取得 → クライアント側で絞込 → 結果テーブル／手動追加フォーム
  ├─ 診断タブ（既存）：YouTube一括結果の各行に「DBに登録」ボタン
  └─ 候補タブ（既存）：Astream取込結果の各行に「DBに登録」ボタン
        │
        ▼
cockpit-server.js（全て requireAuth）
  GET  /api/cockpit/influencers          全件取得
  POST /api/cockpit/influencers          upsert（媒体＋アカウント名で検索→更新 or 追記）
        │
        ▼
Google Sheets（既存スプレッドシート SHEET_ID）
  インフルエンサーDB（新規タブ）
```

## データモデル（Sheets）

新規タブ **インフルエンサーDB**。1行目ヘッダー、2行目以降データ。`inf_id`はアプリ採番（`I-0001`）。

| 列 | 説明 |
|----|------|
| inf_id | 主キー（更新用）。`I-0001` |
| アカウント名 | 表示名／検索キー。必須 |
| 媒体 | `YouTube` / `Instagram` / `TikTok` / `X`。必須 |
| ジャンル | 美容/ライフスタイル 等 |
| コンテンツ型 | レビュー型/アンバサダー型/要確認 |
| フォロワー | 数値 |
| 女性% | 客層（Astream由来） |
| 中核年齢25-44% | 客層（Astream由来） |
| スクリーニング | Tier1点 |
| 転換質% | 購買意向 |
| 実在率% | Astream由来 |
| PRエンゲージ% | Astream由来 |
| 適性メモ・向く商品 | 自由記述 |
| 実績サマリー | 自由記述（例「6月メガ割 ROAS189%黒字」）。S2cで自動反映の受け皿 |
| URL | チャンネル/プロフィールURL |
| 登録者 | 実行者email |
| 最終更新 | ISO日付 |

**upsertキー：媒体＋アカウント名**（アカウント名は大文字小文字無視で比較）。
- 既存行があれば**空でない入力値だけ上書きマージ**（既存の値は消さない）し、最終更新を更新
- 無ければ `nextId('I', 既存inf_id)` で採番して追記
- YouTube由来の登録ではアカウント名＝チャンネル名（診断結果の `title`）

## コンポーネント / ファイル

- **`lib/influencer-store.js`（新規・TDD）**
  - `INFLUENCER_HEADERS`（列順の単一の正）
  - `MEDIA_OPTIONS = ['YouTube','Instagram','TikTok','X']`
  - `toInfluencerRow(obj, id, now, created)` / `parseInfluencer(row)`（往復）
  - `validateInfluencer(obj)`：`account`・`media` 必須、`media` は MEDIA_OPTIONS のいずれか
  - `mergeInfluencer(existing, incoming)`：incoming の**空でない値だけ** existing に上書きした新objを返す（純粋関数）
- **`cockpit-server.js`（既存・修正）**
  - `GET /api/cockpit/influencers` → `{ ok, influencers:[...] }`（全件）
  - `POST /api/cockpit/influencers`（upsert）：DB読み込み→媒体＋アカウント名（小文字比較）で一致行を探す→
    あれば `mergeInfluencer` 後 `updateRowById('インフルエンサーDB', 0, inf_id, row)`、無ければ採番して `appendRow`
- **`public/cg-cockpit.html`（既存・修正）**
  - 新タブ「候補DB」（`STEPS`／`RENDER.idb()`）：フィルタUI＋結果テーブル＋手動追加フォーム
  - YouTube一括結果（`runYTBatch`）の各行に「DBに登録」ボタン → upsert
  - Astream取込結果（`runAstreamIngest`）の各行に「DBに登録」ボタン → upsert
  - 取得は `apiGet`、登録は `api`（POST）
- **`scripts/setup/build_influencer_db.gs`（新規）**
  - インフルエンサーDBタブ（上記ヘッダー）を作成するGASスニペット（運用者が一度実行）。冪等

## サーバーエンドポイント仕様

すべて `requireAuth`。レスポンスは `{ ok, ... }`。

- `GET /api/cockpit/influencers` → `{ ok:true, influencers: parseInfluencer[] }`
- `POST /api/cockpit/influencers` `{ account, media, genre?, contentType?, followers?, female?, coreAge?, screening?, conversion?, realRate?, prEngage?, note?, result?, url? }`
  - `validateInfluencer` → 失敗 400（項目名つき）
  - 既存（媒体＋アカウント名一致）あり：`mergeInfluencer(existing, incoming)` → `updateRowById` → `{ ok:true, inf_id, updated:true }`
  - 無し：`nextId('I', ids)` → `appendRow` → `{ ok:true, inf_id, updated:false }`
  - `登録者` は `req.user.email`、`最終更新` は当日

## データフロー

**登録（YouTube例）**：YouTube一括診断→結果行の「DBに登録」→ `POST {account:title, media:'YouTube', followers, conversion}` →
サーバが媒体＋アカウント名で照合→新規採番 or マージ更新。

**検索**：候補DBタブを開く→ `GET /api/cockpit/influencers` で全件取得→クライアント側でフィルタ
（媒体一致／ジャンル含む／フォロワー下限・上限／転換質下限／スクリーニング下限／女性%下限／フリーワード）→
転換質%降順で表示。

## エラーハンドリング

- `account`／`media` 欠落、`media` が選択肢外 → 400（項目名・不正値を含む）
- 認証 → requireAuth（401/403）
- Sheets障害（タブ未作成含む）→ 500（先頭300字）。候補DBタブのフィルタ取得失敗はメッセージ表示し画面は壊さない

## テスト方針

- `test/influencer-store.test.js`
  - `toInfluencerRow`↔`parseInfluencer` 往復
  - `validateInfluencer`：account/media 必須、media が選択肢外でthrow、X を許可
  - `mergeInfluencer`：incoming の空値は既存を保持／非空値は上書き
- エンドポイント結合（Sheets実書き込み・upsert）はデプロイ後に手動確認

## デプロイ / 設定手順（ユーザー作業）

1. `scripts/setup/build_influencer_db.gs` をスプレッドシートのGASに貼って一度実行（インフルエンサーDBタブ作成）
2. コックピット再デプロイ
3. 最新 `public/cg-cockpit.html` を Xserver に再アップロード

## 未確定事項（実装時に確定）

- アカウント名の表記ゆれ（@有無等）→ 登録時に先頭`@`を除去して比較・保存（実装時に統一）
- 全件取得の件数増加時のページング → 当面 `A:Z` 全件。多くなったら別途（YAGNI）
