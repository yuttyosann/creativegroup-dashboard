# S2a: データモデル＋案件管理（Mode A）設計書

- 日付: 2026-06-21
- ステータス: 設計確定（実装前）
- 親プロジェクト: CG インフルエンサープラットフォーム再構成（S1完了／本書=S2a／S2b・S3は別途）

## 背景

S1で施策進行コックピット（`public/cg-cockpit.html` ＋ `cockpit-server.js`、Cloud Run）に
商品分析・診断のWeb完結を実装した。次の本流は **Mode A（案件進行）**：
ブランドから依頼が来たら「ブランド登録→商品登録→案件作成」を行い、その案件に紐づけて
診断・提案を進める。本書（S2a）はそのデータモデルと案件管理UI、診断との自動紐付けまでを対象とする。

非対象：S2b（インフルエンサーDBのフィルター検索）、S3（クライアントポータル）。

## ゴール / 非ゴール

**ゴール**
1. ブランド→商品→案件の正規化データモデルをSheetsに持つ（IDはアプリが自動採番）
2. コックピットに「案件」タブを追加し、ブランド/商品/案件の登録・一覧・編集ができる
3. ヘッダーに「現在の案件」セレクタを置き、選択中は商品分析・診断・候補の実行が
   その案件IDに自動で紐づく（診断ログに案件IDが入る）

**非ゴール**
- インフルエンサーDBのフィルター検索（→S2b）
- クライアント向け画面・案件専用リンク（→S3）
- BigQuery連携（運用=Sheets。分析=BigQueryは後フェーズ）
- 案件の削除UI（当面は編集とステータス「見送り/中止」で代替。YAGNI）

## アーキテクチャ

S1と同じ Node/Sheets 構成。新インフラなし。書き込みは全てNode（cockpit-server.js）に一本化する。

```
ブラウザ public/cg-cockpit.html
  ├─ ヘッダー：現在の案件セレクタ（localStorage保持。選択中の case_id を全実行に付与）
  ├─ 案件タブ（新規）
  │    ① ブランド選択/新規 → ② 商品選択/追加 → ③ 案件作成（case_id発行）
  │    ④ 案件一覧（ステータス/ブランド/商品でフィルタ・編集）
  └─ 商品分析/候補/診断タブ：実行時に caseId を同送
        │
        ▼
cockpit-server.js（全て requireAuth）
  GET  /api/cockpit/brands|products|cases     一覧取得
  POST /api/cockpit/brands|products|cases     新規作成（ID自動採番）
  PATCH /api/cockpit/cases                     案件の更新（ステータス等）
  既存の診断系（youtube 等）：body に caseId を受け取り診断ログ行へ刻む
        │
        ▼
Google Sheets（既存スプレッドシート SHEET_ID）
  ブランド / 商品 / 案件（新規タブ）＋ 診断ログ（案件ID列を追加）
```

## データモデル（Sheets）

新規3タブ。1行目ヘッダー、2行目以降データ。IDはアプリが採番（`<prefix>-<4桁ゼロ詰め>`、既存max+1）。

### ブランド
| 列 | 説明 |
|----|------|
| brand_id | 主キー。`B-0001` |
| ブランド名 | 必須 |
| 業種・カテゴリ | 任意 |
| 担当・連絡先 | 任意（社内メモ用途。個人情報は最小限） |
| メモ | 任意 |
| 作成日 / 最終更新 | ISO日付 |

### 商品
| 列 | 説明 |
|----|------|
| product_id | 主キー。`P-0001` |
| brand_id | 親ブランド参照。必須 |
| 商品名 | 必須 |
| カテゴリ | 任意 |
| 価格帯 | 任意 |
| URL | 任意（Qoo10/公式） |
| 需要タイプ | 任意（商品分析の出力を控える欄） |
| メモ / 作成日 / 最終更新 | |

### 案件
| 列 | 説明 |
|----|------|
| case_id | 主キー。`C-0001` |
| brand_id | 必須 |
| product_id | 必須 |
| 案件名 | 必須（例「〇〇コスメ 6月メガ割」） |
| ステータス | 下記8段階＋終了状態 |
| 商戦時期 | 任意（例 2026-06 メガ割） |
| 予算 | 任意 |
| 目標 | 任意 |
| メモ / 作成日 / 最終更新 | |

**ステータス（全体フロー13ステップを8段階に集約）:**
`受注 / ヒアリング / 候補リスト作成 / クライアント選定待ち / 起用交渉 / 制作進行 / 投稿済み / 成果回収・完了`
＋ 終了状態 `見送り・中止`。
（マッピング：受注=発注／候補リスト作成=リスト作成・診断／起用交渉=アプローチ〜実施者確定／
制作進行=オリエン〜商品体験〜下書き〜添削〜修正／成果回収・完了=インサイト回収）

### 診断ログ（既存タブの拡張）
先頭に `案件ID` 列を1つ追加（既存の `日付/実行者/媒体/...` の前）。
現在の案件が未選択のときは空欄。S1の `toDiagnosisRow` を拡張して先頭に case_id を入れる。

## コンポーネント / ファイル

責務を小さく分け、純粋ロジックはテスト可能に切り出す。

- **`lib/id-gen.js`（新規・TDD）**：`nextId(prefix, ids)` — 既存ID配列から次IDを生成。
  `nextId('B', ['B-0001','B-0003']) -> 'B-0004'`（max+1・4桁ゼロ詰め）。空配列なら `-0001`。
  数値部が壊れた値は無視。
- **`lib/crm-store.js`（新規・TDD）**：ブランド/商品/案件の行マッパーとバリデーション。
  - `BRAND_HEADERS / PRODUCT_HEADERS / CASE_HEADERS`（列順の単一定義）
  - `toBrandRow(obj, now)` / `parseBrand(row)`（往復）、product/case も同様
  - `CASE_STATUSES` 定数（8段階＋見送り・中止）
  - `validateBrand/Product/Case(obj)` — 必須項目欠落時に項目名つきでthrow
- **`lib/diagnosis-store.js`（既存・修正）**：`toDiagnosisRow(result, user, now, caseId)` に
  `caseId`（既定 `''`）を追加し、行の先頭に入れる。既存テストを更新＋case_id付きテスト追加。
- **`lib/sheets.js`（既存・利用）**：`appendRow / readRows` を使う。
  行更新のため `updateRowById(spreadsheetId, tabName, idColIndex, id, rowArray)` を追加（TDDは
  難しいので薄く保ち、結合は手動確認）。
- **`cockpit-server.js`（既存・修正）**：CRUDエンドポイント追加＋診断系に caseId 連携。
- **`public/cg-cockpit.html`（既存・修正）**：案件タブ＋現在の案件セレクタ＋診断呼び出しに caseId 付与。
- **`scripts/setup/build_crm_sheets.gs`（新規）**：ブランド/商品/案件タブと診断ログの案件ID列を
  作るGASスニペット（運用者が一度実行）。コックピットは既存スプレッドシートに読み書き。

## サーバーエンドポイント仕様

すべて `requireAuth`。リクエスト/レスポンスは `{ ok, ... }` 形（S1と統一）。

- `GET /api/cockpit/brands` → `{ ok, brands:[{brand_id, name, ...}] }`
- `POST /api/cockpit/brands` `{ name, industry?, contact?, note? }` → 採番して append → `{ ok, brand_id }`
- `GET /api/cockpit/products?brand_id=` → 指定ブランドの商品（未指定なら全件）
- `POST /api/cockpit/products` `{ brand_id, name, category?, price?, url?, demandType?, note? }`
- `GET /api/cockpit/cases?status=&brand_id=` → フィルタ付き一覧
- `POST /api/cockpit/cases` `{ brand_id, product_id, name, status?, season?, budget?, goal?, note? }`
  （status未指定なら `受注`）
- `PATCH /api/cockpit/cases` `{ case_id, ...更新フィールド }` → `updateRowById` で更新
- 既存診断系（`/api/cockpit/youtube` 等）：body に任意の `caseId` を受け、診断ログ保存時に刻む

採番の同時実行衝突は小規模運用では実害が低い。`nextId` は append直前に最新行を読み直して算出する。

## データフロー（Mode A本流）

1. 案件タブでブランドを選択（無ければ新規作成 → brand_id）
2. そのブランドの商品を選択（無ければ追加 → product_id）
3. 案件を作成（案件名・商戦時期・予算・目標）→ case_id 発行、ステータス`受注`
4. ヘッダーの「現在の案件」にこの case_id をセット（localStorage保持）
5. 商品分析・候補・診断タブを実行 → 各リクエストに caseId 同送 → 診断ログに案件IDが入る
6. 案件一覧でステータスを更新（受注→ヒアリング→…→成果回収・完了）

## エラーハンドリング

- 必須項目欠落（ブランド名/商品名/案件名）→ 400（項目名を含むメッセージ）
- 不正ステータス値 → 400（許可値一覧を返す）
- 親不在（存在しない brand_id/product_id を参照）→ 400
- 認証 → 既存 requireAuth（401/403）
- Sheets障害 → 500（先頭500字）
- 「現在の案件」未選択での診断 → 許可（案件ID空欄で保存。エラーにしない）

## テスト方針

- `test/id-gen.test.js`：空・連番・歯抜け・壊れた値の無視・ゼロ詰め
- `test/crm-store.test.js`：brand/product/case の toRow↔parse 往復、必須バリデーション、CASE_STATUSES包含
- `test/diagnosis-store.test.js`（更新）：caseId が先頭に入る／未指定時は空
- エンドポイント結合（Sheets実書き込み・更新）はデプロイ後に手動確認

## デプロイ / 設定手順（ユーザー作業）

1. `scripts/setup/build_crm_sheets.gs` をスプレッドシートのGASに貼って一度実行
   → ブランド/商品/案件タブ作成＋診断ログ先頭に案件ID列を挿入
2. コックピットを再デプロイ（`gcloud run deploy ...`）
3. 最新 `public/cg-cockpit.html` を Xserver に再アップロード

## 未確定事項（実装時に確定）

- 診断ログ既存データへの案件ID列挿入時、既存行は空欄で良いか（→空欄で確定。過去分は紐付け不要）
- 案件一覧の表示件数上限（→当面 `A:Z` 全件読み。件数が増えたらページングを別途）
