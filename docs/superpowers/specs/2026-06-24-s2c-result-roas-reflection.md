# S2c: 実績（ROAS）入力→候補DB反映 設計書

- 日付: 2026-06-24
- ステータス: 設計確定（実装前）
- 親プロジェクト: CG インフルエンサープラットフォーム再構成（S1/S2a/S2b完了／本書=S2c／S2d・S3未着手）

## 背景

S2bで候補DB（インフルエンサーDB）に「実績サマリー」列を用意したが手動メモのみだった。
本書（S2c）は **案件完了後の実績（実売/ROAS）を入力し、候補DBの実績サマリーへ自動反映**する。
これにより「過去にROAS黒字を出した実績者」を候補検索時に把握できる。

既存の `診断ログ` には `案件ID / 媒体 / アカウント名（チャンネル名）/ 転換質%` が入るため、
案件で診断したインフルを自動列挙して実績入力フォームをプリフィルできる。

ROAS計算は既存の案件DB（GAS）の慣習に合わせる。非対象：診断スコア vs 実ROASのキャリブレーション分析（既存GASのまま）、X自動診断（S2d）、クライアントポータル（S3）。

## ゴール / 非ゴール

**ゴール**
1. コックピットが読み書きする「実績」タブ（`result_id`自動採番・案件ID＋アカウント名でupsert）
2. 「実績」タブUI：案件を選ぶ→診断ログから対象インフルを自動列挙＋手動追加→実績入力→ROAS自動計算→保存
3. 保存時に候補DB（インフルエンサーDB）の「実績サマリー」へ反映（案件ごとに追記・案件IDで重複排除）

**非ゴール**
- 診断スコア vs 実ROAS のキャリブレーション統計（既存GAS案件DB/診断キャリブレーションのまま）
- 実績の月次集計・レポート（将来）
- 案件ステータスの自動遷移（実績保存で「成果回収・完了」へ自動更新はしない。手動運用）

## アーキテクチャ

S2a/S2bと同じ Node/Sheets 構成。ROAS計算とサマリー生成は純粋関数に切り出してTDD。

```
ブラウザ public/cg-cockpit.html
  └─ 実績タブ（新規）：案件選択 → 対象インフル自動列挙(診断ログ)＋手動追加 → 実績入力 → ROASプレビュー → 保存
        │
        ▼
cockpit-server.js（全て requireAuth）
  GET  /api/cockpit/case-influencers?case_id=   診断ログからその案件の(媒体,アカウント)を列挙
  GET  /api/cockpit/results?case_id=            実績一覧
  POST /api/cockpit/results                     upsert（案件ID＋アカウント名）→ROAS計算→候補DB反映
        │
        ▼
Google Sheets：実績（新規タブ）／インフルエンサーDB（実績サマリー更新）
```

## データモデル（Sheets）

新規タブ **実績**。1行目ヘッダー。`result_id`はアプリ採番（`R-0001`）。**upsertキー：案件ID＋アカウント名**。

| 列 | 説明 |
|----|------|
| result_id | 主キー。`R-0001` |
| 案件ID | 必須 |
| アカウント名 | 必須 |
| 媒体 | YouTube/Instagram/TikTok/X |
| 実施日 | |
| 実売数 | 任意（数値） |
| 売上 | 入力（数値） |
| タイアップ費 | 入力（数値） |
| 成果報酬率% | 入力（数値・例 20） |
| 総コスト | 自動＝タイアップ費＋売上×(成果報酬率/100) |
| ROAS% | 自動＝売上÷総コスト×100（総コスト0なら0） |
| 損益 | 自動＝売上−総コスト |
| メモ | 任意 |
| 記録者 | 実行者email |
| 最終更新 | ISO日付 |

## コンポーネント / ファイル

- **`lib/result-store.js`（新規・TDD）**
  - `computeResult({ sales, fee, rewardRate })` → `{ totalCost, roas, profit }`（純粋関数）
    - `totalCost = fee + sales * (rewardRate/100)`、`roas = totalCost>0 ? round(sales/totalCost*100) : 0`、`profit = sales - totalCost`
    - 数値化は内部で行う（空・非数値・カンマは0/除去扱い）
  - `RESULT_HEADERS`／`toResultRow(obj, id, now)`／`parseResult(row)`
  - `validateResult(obj)`：`case_id`・`account` 必須（欠落で項目名つきthrow）
  - `buildSummaryLine(caseLabel, roas, profit)` → `"<caseLabel> ROAS<roas>% <黒字|赤字>"`（profit≥0で黒字）
  - `mergeSummaryLine(existingSummary, caseId, line)` → 既存サマリー（改行区切り）から **行頭が同じ案件ID** の行を除いて、新しい `line`（先頭に `caseId ` を付与）を追記。案件IDで重複排除。純粋関数
- **`cockpit-server.js`（既存・修正）**
  - `GET /api/cockpit/case-influencers?case_id=`：`診断ログ` を読み、案件ID一致行から `{account: チャンネル名, media: 媒体}` を重複排除して返す
  - `GET /api/cockpit/results?case_id=`：`実績` を読み、案件ID一致を返す
  - `POST /api/cockpit/results`：
    1. `validateResult` → 失敗400
    2. `computeResult` でROAS等算出、案件ID＋アカウント名で `実績` をupsert（既存はupdateRowById、無ければnextId('R')＋append）
    3. **候補DB反映**：`インフルエンサーDB` を読み、媒体＋アカウント名で照合。`buildSummaryLine(caseLabel, roas, profit)`＋`mergeSummaryLine(existing.result, case_id, line)` を計算し、influencer を upsert（`{account, media, result: 反映後サマリー}`）。DBに無ければ新規作成。`caseLabel` はリクエストで受け取る（案件名。未指定なら case_id）
- **`public/cg-cockpit.html`（既存・修正）**：新「実績」タブ（`STEPS`／`RENDER.result()`）
  - 案件セレクタ（`apiGet('/api/cockpit/cases')`）→ 選択で `case-influencers` と `results` を取得しフォーム生成
  - 各インフル行：`実施日 / 実売数 / 売上 / タイアップ費 / 成果報酬率` 入力＋ROASプレビュー＋「保存」
  - 手動でインフル行を追加（account＋media）
- **`scripts/setup/build_result_db.gs`（新規）**：実績タブ作成GAS（冪等）

## サーバーエンドポイント仕様

すべて `requireAuth`。レスポンス `{ ok, ... }`。

- `GET /api/cockpit/case-influencers?case_id=` → `{ ok, influencers:[{account, media}] }`（診断ログ由来・重複排除）
- `GET /api/cockpit/results?case_id=` → `{ ok, results:[parseResult] }`
- `POST /api/cockpit/results` `{ case_id, account, media, caseLabel?, date?, units?, sales?, fee?, rewardRate?, note? }`
  → `{ ok, result_id, roas, updated, reflected }`（reflected=候補DB反映の有無）

## データフロー

1. 実績タブで案件を選択
2. `case-influencers` でその案件の診断インフルを自動列挙（＋手動追加）
3. 各人の実績を入力 → フロントが概算ROASプレビュー（保存時はサーバが再計算＝正）
4. 「保存」→ `POST /results` → `実績` にupsert → 候補DBの当該インフルの「実績サマリー」へ
   `<案件名> ROAS<x>% <黒字/赤字>` を案件IDで重複排除して追記

## エラーハンドリング

- `case_id`／`account` 欠落 → 400（項目名つき）
- 総コスト0（売上もタイアップ費も0）→ ROAS 0 で安全に保存（エラーにしない）
- 候補DB反映先が見つからない → 新規作成（account/media/result）。反映で例外が出ても実績保存自体は成功扱い（reflected:false で返す）
- 認証 → requireAuth（401/403）／Sheets障害 → 500（先頭300字）

## テスト方針

- `test/result-store.test.js`
  - `computeResult`：既存式（タイアップ費200万・売上858万・報酬20% → 総コスト=タイアップ費＋売上×0.2、ROAS=売上/総コスト×100、損益）／売上0で総コスト>0／総コスト0でROAS0
  - `buildSummaryLine`：profit≥0で黒字・<0で赤字・文字列フォーマット
  - `mergeSummaryLine`：新規追記／同一案件IDの行を置換／他案件の行は保持
  - `validateResult`：case_id/account 必須
  - `toResultRow`↔`parseResult` 往復
- エンドポイント結合（Sheets実書き込み・反映）はデプロイ後に手動確認

## デプロイ / 設定手順（ユーザー作業）

1. `scripts/setup/build_result_db.gs` をGASに貼って `buildResultDb` を実行（実績タブ作成）
2. コックピット再デプロイ
3. 最新 `public/cg-cockpit.html` を Xserver に再アップロード

## 未確定事項（実装時に確定）

- 数値入力のカンマ/単位 → フロントは数値inputで素の数値、サーバ `computeResult` も数値化（カンマ除去）して計算
- `caseLabel` は案件名（無ければ商戦時期、無ければ case_id）。フロントが案件セレクタの表示名から渡す
