# 気づきワードサイクル Phase 2 — 設計仕様書（コックピット連携）

作成日: 2026-07-06
ステータス: 設計確定・実装は保留（park）。勉強会スキーム整備を優先するため、実装計画は後日。

## 背景

Phase 1 で訴求スコアエンジン（`lib/kizuki/score.js`）と気づきワード台帳GAS（`CG_気づきワード台帳.gs`）を実装済み（PR #4）。Phase 2 は、既存の施策進行コックピット（`cockpit-server.js` / `public/cg-cockpit.html`）に台帳を統合し、スコアを自動反映し、勝ちデータを診断ツールへ自動連携する。

## 前提

- 台帳＋4シグナルタブは**コックピットの `SHEET_ID` に置く**（サーバーが読み書きするため）。Phase 1 のGAS生成器をそのシートで実行してタブを用意する。
- `score.js` は Phase 1 で確定した「スコアの単一の正」。**Phase 2 では一切改変せず利用**する。
- 既存パターン（`lib/*-store.js` ＋ GET/POST エンドポイント、Google IDトークン＋許可リスト認証、`updateRowById`）を踏襲。

## 確定した設計方針

- 診断ツール接続＝**診断入力を自動生成**（勝ち訴求・勝ちデモグラ → 需要タイプ/M02基準/M04客層 → 既存 `/api/cockpit/analyze` へ）。
- スコア再計算＝**ボタン式（明示実行）**。既存の「ライブ実行」型に合わせる。
- 再計算時、台帳の**手入力値は上書き**する。

## コンポーネント

| 追加/変更 | 役割 |
|---|---|
| `lib/kizuki/ledger-store.js`（新規） | 台帳・4シグナルタブの行⇄オブジェクト変換。`word_id` で集約し score.js に渡す `signals` を組み立てる。CTR%等の文字列は parse（Phase 1 注記どおり） |
| `lib/kizuki/diagnosis-input.js`（新規・純関数） | 勝ち訴求・勝ちデモグラ → 診断プロンプト入力（需要タイプ/M02肌悩み基準/M04客層）へ変換 |
| `cockpit-server.js`（追記） | `/api/cockpit/kizuki/*` エンドポイント群 |
| `public/cg-cockpit.html`（追記） | 「気づきワード」タブ |

## エンドポイント

- `GET /api/cockpit/kizuki/words?caseId=` — 台帳＋各シグナルを結合し、word_idごとに `{word, signals, score}` を返す（score は台帳の保存値、または再計算プレビュー）
- `POST /api/cockpit/kizuki/recalc` — 全ワードの signals を読み、`computeAppealScore` で算出→台帳の訴求スコア/判定/確度ステージ列を `updateRowById` で書き戻し（手入力上書き）
- `POST /api/cockpit/kizuki/to-diagnosis` — 指定 word_id の勝ちデータから `diagnosis-input.js` で診断入力を生成し、既存 `/api/cockpit/analyze` に渡して診断スコア付き起用候補を返す

## データフロー

### スコア再計算
再計算ボタン → サーバーが4シグナルタブを `readRows` → `ledger-store` が word_id で集約（CTR%等 parse）→ `computeAppealScore` → 台帳へ `updateRowById` で書き戻し。

### 診断への自動入力
勝ちワード選択 → `diagnosis-input.js` が需要タイプ・M02基準・M04客層の入力文を生成 → `/api/cockpit/analyze` → 診断スコア付き起用候補。`project-influencer-matching` の診断ツールと接続。

## UI「気づきワード」タブ

案件選択 → ワード一覧（訴求スコア順・確度ステージバッジ・虚栄控除表示）→「スコア再計算」ボタン →「勝ちワードで診断」ボタン。既存タブのHTML/JS作法に合わせる。

## テスト方針

- `lib/kizuki/ledger-store.js` の行⇄オブジェクト変換・word_id集約・CTR%パースを `node:test` で単体テスト（既存 store テストの流儀）。
- `lib/kizuki/diagnosis-input.js` は純関数として入出力を単体テスト。
- エンドポイントは既存パターン同様、store層のテストで主要ロジックを担保。

## スコープ外（別フェーズ）

- Phase 3：広告/Pamun自動取込 → BigQuery昇格 → スコア自動更新。
- 勉強会スキーム（Module A 入口の運用設計）＝別トラックで先に整備（アヴェンヌで型作り）。

## 関連

- `docs/superpowers/specs/2026-06-30-kizuki-word-cycle-design.md`（全体設計）
- `docs/superpowers/plans/2026-06-30-kizuki-word-cycle-phase1.md`（Phase 1 計画）
- `project-influencer-matching` / `project-growth-hack-architecture`
