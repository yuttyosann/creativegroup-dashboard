# S2d-1: Astream X CSV取込→候補DB 設計書

- 日付: 2026-06-24
- ステータス: 設計確定（実装前）
- 親プロジェクト: CG インフルエンサープラットフォーム再構成（S1/S2a/S2b/S2c完了／本書=S2d-1／S2d-2・S3未着手）

## 背景

S2bで候補DB（インフルエンサーDB）を作り、媒体にX（旧Twitter）を加えた。本書（S2d-1）は
**Astreamが出力するX CSV**を取り込み、X候補を候補DBに貯められるようにする。
Xはスクレイピング上、客層（女性%/年齢/実在率）やコメントベースの転換質が取れない構造的限界があるため、
Astream X CSVで取れる**フォロワー・エンゲージメント率・平均反応・プロフィール**を候補DBに登録する。

実装は既存のAstream IG取込（`scripts/astream/ingest_csv.py` ＋ `runPythonCsv` ＋ 「DBに登録」ボタン）と
同型にする。Apifyによるリプライ転換質診断は別ピース（S2d-2）で、本書の対象外。

## ゴール / 非ゴール

**ゴール**
1. Astream X CSVを解析して正規化行を返す `scripts/astream/ingest_x_csv.py`
2. `POST /api/cockpit/astream-x-ingest`（既存 `runPythonCsv` を再利用）
3. コックピットに「Astream X CSV取込」カード：アップロード→行表示→各行「DBに登録」で候補DBにX候補をupsert

**非ゴール**
- Apify によるX リプライ転換質診断（→S2d-2）
- Xの客層・実在率の取得（構造的に不可）
- 新Sheetsタブ（既存インフルエンサーDBにupsert登録するのみ）

## Astream X CSV 形式（入力）

ヘッダー（1行目）:
`アカウント名,名前,位置,フォト,URL,フォロワー数,フォロワー中,平均いいね,平均コメント,平均リポスト,平均インプレッション,エンゲージメント,プロフィール`

- `アカウント名` は `@xqueen___a` のように先頭 `@` 付き
- `エンゲージメント` は `56.33(0.04)` のように `平均エンゲージ数(エンゲージ率%)`。**括弧内がエンゲージ率%**
- `プロフィール` は最終列（カンマを含み得るため csv モジュールで安全に解析）

## フィールドマッピング（X CSV → 候補DB）

| X CSV列 | 候補DB（インフルエンサーDB） |
|---------|------------------------------|
| アカウント名（先頭`@`除去） | アカウント名 |
| （固定） | 媒体 = `X` |
| フォロワー数 | フォロワー |
| エンゲージメント の括弧内（エンゲージ率%） | PRエンゲージ% |
| 平均いいね/コメント/リポスト/インプレッション ＋ プロフィール | 適性メモ・向く商品（テキスト集約） |
| URL | URL |
| （なし） | 女性%/中核年齢/実在率%/転換質%/スクリーニング → 空 |

適性メモの集約フォーマット：`ENG率<率>% ♡<平均いいね> 💬<平均コメント> RT<平均リポスト> Imp<平均インプレッション> / <プロフィール>`

## コンポーネント / ファイル

- **`scripts/astream/ingest_x_csv.py`（新規）**
  - 標準ライブラリ（csv）のみ。`python3 scripts/astream/ingest_x_csv.py <csv> --json` で `@@JSON@@` 出力
  - 各行を `{ account, followers, engageRate, avgLikes, avgComments, avgReposts, avgImpressions, url, profile, note }` に正規化
  - `account` は先頭 `@` 除去。`engageRate` は `エンゲージメント` 列の括弧内（`(...)`）を数値抽出（無ければ空）。`note` は上記集約フォーマット
  - 出力: `@@JSON@@{"ok":true,"count":N,"rows":[...上位50件]}`（既存 ingest_csv.py と同じ `--json` 規約）
- **`cockpit-server.js`（既存・修正）**
  - `POST /api/cockpit/astream-x-ingest`（requireAuth）：`runPythonCsv('scripts/astream/ingest_x_csv.py', csv, res)`（既存ヘルパ再利用）
- **`public/cg-cockpit.html`（既存・修正）**
  - 既存の「📑 Astream CSV → IG転換質プロキシ / マスタ取込」カードの近く（diagnose タブ）に「📑 Astream X CSV取込」カードを追加
  - ファイル入力（`#asxcsv`）＋ボタン → `runXIngest()` が `astream-x-ingest` を呼ぶ
  - 結果各行に「DBに登録」ボタン → `registerCand({ account, media:'X', followers, prEngage: engageRate, url, note }, btn)`（S2bの `registerCand` を再利用）
  - 行データは `window.__xCand` に退避してインデックス参照（S2bのAstream取込と同じ方式）

## データフロー

Astream X CSVをアップロード → `astream-x-ingest` がPythonで解析（csv） → 正規化行を返す →
画面に「@アカウント / フォロワー / ENG率% / プロフィール」を表示し各行に「DBに登録」 →
押すと候補DBにX候補としてupsert（媒体＝X・PRエンゲージ%にエンゲージ率）

## エラーハンドリング

- CSV未選択 → 既存の `readCsvFile()` がreject（メッセージ表示）
- CSV形式不正/空 → `runPythonCsv` が500＋エラー先頭400字
- 認証 → requireAuth（401/403）
- `エンゲージメント` 列が `数値(率)` 形式でない → engageRate は空（エラーにしない）
- アカウント名が空の行はスキップ（出力に含めない）

## テスト方針

- `scripts/astream/ingest_x_csv.py` は既存のAstreamスクリプト（`ingest_csv.py`/`ig_conversion_proxy.py`）同様、
  リポジトリのnode:testでは扱わず**手動検証**（標準ライブラリのみ・ロジックは正規表現での括弧内抽出と文字列集約のみ）
  - 検証：共有済みのX CSV（株式会社CreativeGroup_日本ドクターヘルスケア.csv）で `--json` 出力を目視確認
- フロントは既存 `registerCand` を再利用（新規ロジックは行退避とマッピングのみ）

## デプロイ / 設定手順（ユーザー作業）

1. コックピット再デプロイ（GAS不要・新タブなし）
2. 最新 `public/cg-cockpit.html` を Xserver に再アップロード

## 未確定事項（実装時に確定）

- `エンゲージメント` 括弧内の単位（率%）→ 値をそのまま `PRエンゲージ%` に格納（サンプルで率と確認済み）
- BOM付きCSV（utf-8-sig）→ 既存 ingest_csv.py 同様 `encoding="utf-8-sig"` で読む
