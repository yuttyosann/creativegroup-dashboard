# 気づきワードサイクル Phase 3 スライス1 — 広告シグナル自動取込＋スコア自動再計算 設計仕様書

作成日: 2026-07-10
ステータス: 設計確定（実装計画はこの後 writing-plans で作成）
位置づけ: Phase 3 の最初のスライス。訴求スコアで最重視の「広告シグナル（40点）」を自動化する。

## 背景・狙い

Phase 1（[score.js](../../../lib/kizuki/score.js)）／Phase 2（[ledger-store.js](../../../lib/kizuki/ledger-store.js)・コックピット連携）を土台に、これまで手入力だった「広告シグナル」を **Google Ads から自動取込 → BigQuery → スコア自動再計算** で自動化する。勝ち訴求・勝ちデモグラが自動で確定し、Phase 2 の診断連携が本領を発揮する。

## 確定した設計方針

- **最初の媒体＝Google Ads**（他媒体は後続。まず1コネクタで確実に立ち上げる）
- **紐付け＝マッピング表**：`creative_id ↔ word_id` の対応表を Sheet で人が管理（命名規約より堅い。Phase 2 の広告シグナルに creative_id 列が既にある）
- **compute engine＝Node バッチジョブで `score.js` を再利用**（BQ側SQL再実装はしない＝単一の正を維持）
- **役割分担：BQ＝広告生データの置き場／スコアの正＝Node＋score.js**。台帳は Phase 1/2 のまま Sheets（BQ昇格は後続スライス3）
- **デモグラはベストエフォート**（Google Ads は creative 粒度のデモグラを直接は返さない）

## アーキテクチャ／データフロー

```
Google Ads API
   │ ① 日次fetch（creative粒度: imp/clicks/CV/cost/revenue/デモグラ）
   ▼
BigQuery  cg_analytics.ad_creative_daily   ← 生KPIの置き場（source of truth）
   │ ② JOIN  広告マッピング（creative_id ↔ word_id, Sheet・人が管理）
   ▼
ad-ingest：word_id対応づけ→広告シグナル行を生成（CTR%/CVR%整形・勝ちデモグラ・配信額）
   │ ③ 「広告シグナル」タブ（Sheet）を洗い替え（冪等）
   ▼
recalc：ledger-store で全シグナル集約→computeAppealScore→台帳の訴求スコア/判定/確度を書戻し
   ▼
気づきワード台帳（Sheets）→ コックピット表示（Phase 2）
   ▲
   └ Cloud Scheduler が ①〜③ を日次トリガー（Cloud Run Job）
```

## コンポーネント（ファイル構成）

| 追加/変更 | 役割 | テスト |
|---|---|---|
| `bigquery/ad_creative_daily.sql`（新規） | BQテーブルDDL（creative日次KPIの置き場。日付パーティション） | — |
| `scripts/google-ads/fetch_creatives.js`（新規） | Google Ads API から creative 日次KPIを取得→BQへ書込。認証は `.env`（developer token / OAuth refresh token / login-customer-id / customer-id） | 起動スモーク／`--dry-run`（外部API） |
| **`lib/kizuki/ad-ingest.js`（新規・純粋・要テスト）** | BQ行＋マッピング行 → 広告シグナル行（word_id対応・CTR/CVR%整形・ROAS・勝ちデモグラ・配信額）を生成 | `node:test` |
| `scripts/kizuki/recalc_job.js`（新規） | バッチ本体：BQ+マッピング読取 → `ad-ingest` で広告シグナルタブ洗い替え → `ledger-store` でスコア再計算し台帳へ書戻し | 起動スモーク（内部は単体テストで担保） |
| Cloud Scheduler 設定（`docs` に gcloud 手順） | ①〜③ を日次（例 AM4）トリガー | — |
| `.env.example` 追記 | Google Ads 認証・BQ project/dataset・SHEET_ID | — |

**再利用**：スコア集約・書き戻しは Phase 2 の `lib/kizuki/ledger-store.js`（`buildWordRows`／`buildLedgerScoreUpdate`）を不改変で使う。`score.js` も不改変。新規ロジックの核は `ad-ingest.js` のみ。

## データモデル

### BQ: `cg_analytics.ad_creative_daily`
列（想定）：`date`（DATE・パーティション）／`creative_id`（STRING）／`campaign`（STRING）／`impressions`（INT）／`clicks`（INT）／`conversions`（FLOAT）／`cost`（FLOAT）／`revenue`（FLOAT）／`demographics`（STRING・ベストエフォート・空可）

### Sheet: 「広告マッピング」タブ（コックピットの SHEET_ID）
列：`creative_id`（0）／`word_id`（1）／`campaign`（2・任意）／`メモ`（3・任意）。1行目ヘッダー。

### Sheet: 「広告シグナル」タブ（Phase 2 と同一 schema・自動洗い替え対象）
`[word_id, creative_id, CTR%, CVR%, ROAS, 勝ちデモグラ, デモグラ明確度, 配信額]`

## 変換ロジック（`ad-ingest.js`）

`buildAdSignalRows(bqRows, mappingRows)` → 広告シグナル行（配列）の配列。
- `bqRows`：`{creative_id, impressions, clicks, conversions, cost, revenue, demographics}` の配列（BQ集計結果。creativeごとに1件＝期間合算 or 直近ウィンドウ）
- `mappingRows`：`{creative_id, word_id}` の配列（Sheet「広告マッピング」由来）
- 各 bqRow を creative_id でマッピングに引く。**未マッピングはスキップ**（＝台帳に紐づかない広告は対象外）。
- CTR = `clicks/impressions*100` を `"2.1%"` 形式に整形（Phase 2 の広告シグナル `parsePercent` が `"2.1%"→2.1` で読める形）。imp=0 は空。
- CVR = `conversions/clicks*100` を同様に `"%"` 整形。clicks=0 は空。
- ROAS = `revenue/cost`（数値文字列）。cost=0 は空。
- 勝ちデモグラ = `demographics`（ベストエフォート・空可）。
- デモグラ明確度 = ベストエフォート（明確な上位層があれば0..1、無ければ空）。スライス1では空を許容（`score.js` は欠損→デモグラ0点で安全）。
- 配信額 = `cost`（数値）。
- 出力：マッピングできた creative ごとに1行。

**単位整合**：`ad-ingest` は Phase 2 の広告シグナル schema（"2.1%" 等の文字列）に合わせて出力するため、既存 `ledger-store.parseAdRow` がそのまま `2.1` に戻して `score.js` に渡す（Phase 2 の単位変換ルールをそのまま踏襲）。

## 再計算ジョブ（`recalc_job.js`）フロー

1. BQ `ad_creative_daily` を creative 粒度で集計取得（直近ウィンドウ or 累計）。
2. Sheet「広告マッピング」を `readRows` で取得。
3. `ad-ingest.buildAdSignalRows(bqRows, mappingRows)` → 広告シグナル行。
4. Sheet「広告シグナル」の**自動生成データ行を洗い替え**（ヘッダー保持・データ行を全置換）。→ Google Ads 分の手入力は不要に。
5. `ledger-store.buildWordRows` ＋ `buildLedgerScoreUpdate` で台帳の訴求スコア/判定/確度を再計算し `updateRowById` で書戻し（Phase 2 `/recalc` と同一ロジック）。
6. 冪等：毎回現データから再生成。1ワードの失敗が他を止めない（try/継続）。

## スケジューリング／実行基盤

- Cloud Run Job として `recalc_job.js` をデプロイ、Cloud Scheduler で日次（例 AM4 JST）トリガー。
- 認証：サービスアカウント（BQ書込／Sheets書込）。Google Ads はOAuth refresh token。
- gcloud 手順は `docs` に記載（デプロイ・スケジューラ登録）。

## テスト方針

- `lib/kizuki/ad-ingest.js`：`node:test` で純粋関数を検証（マッピングJOIN・未マッピングskip・CTR/CVR%整形・imp0/clicks0/cost0の空処理・ROAS・デモグラ空・配信額）。
- `scripts/google-ads/fetch_creatives.js`：`node --check`＋`--dry-run`スモーク（外部API・単体テスト対象外）。
- `scripts/kizuki/recalc_job.js`：`node --check`＋起動スモーク（内部ロジックは ad-ingest / ledger-store の単体テストで担保）。
- 既存テスト（95）は不変で緑を維持。

## スコープ外（後続スライス／別spec）

- スライス2：Pamunデータ取込（購買意向共感率の自動化）
- スライス3：台帳そのもののBigQuery昇格＋Looker等の可視化
- Meta/TikTok等の他媒体コネクタ
- デモグラの creative 粒度精緻化（ad group デモグラの厳密割当）

## オープン論点（実装時に確定）

- BQ集計ウィンドウ（累計 vs 直近N日）＝訴求の「勝ち」をどの期間で見るか。初期は累計で開始し要調整。
- 「広告シグナル」洗い替えが手入力行も消す点の運用周知（Google Ads 対象ワードは手入力しない）。
- Google Ads のデモグラ取得方法（別ビュー）と creative への割当ルール。
- GCP プロジェクトID・データセット名・サービスアカウント権限の確定。

## 関連

- `docs/superpowers/specs/2026-06-30-kizuki-word-cycle-design.md`（全体設計）
- `docs/superpowers/specs/2026-07-06-kizuki-word-cycle-phase2-design.md`（Phase 2）
- `ARCHITECTURE.md`（BigQuery中心・Cloud Run Jobs / Cloud Scheduler 志向）
- `lib/kizuki/score.js` / `lib/kizuki/ledger-store.js`（不改変で再利用）
