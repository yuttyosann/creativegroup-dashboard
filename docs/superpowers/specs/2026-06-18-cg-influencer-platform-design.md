# CG インフルエンサー施策プラットフォーム 設計書

作成日：2026-06-18
対象：Phase 1（MVP）= 診断をWebで実行
ステータス：設計承認待ち

---

## 1. 目的・背景

インフルエンサー施策の全工程（ヒアリング→診断→提案→施策→成果）を、自社ドメイン上のWEBプラットフォームで一元管理する。最終的にはCG管理側（ステータス管理・結果集計）とクライアント側（ポータル）の両方を持つ。

このプラットフォームは大規模なため4フェーズに分解し、**Phase 1（MVP）= 診断をWebで実行**から構築する。本設計書はPhase 1を対象とし、全体像はフェーズ計画として記す。

既存資産：Node製の診断スクリプト群（`scripts/youtube/*`, `scripts/apify/*`, `scripts/astream/*`）、`cockpit-server.js`（Express）、`public/cg-cockpit.html`（静的コックピット）。これらをMVPで活用する。

---

## 2. 全体像とフェーズ計画

| Phase | 内容 | 本書の対象 |
|-------|------|-----------|
| **Phase 1（MVP）** | 診断をWebで実行（CG社員向け） | ◎ 対象 |
| Phase 2 | ヒアリング（Googleフォーム→Sheets）＋CG管理画面（ステータス・集計） | 後 |
| Phase 3 | クライアントポータル（進行・結果の閲覧） | 後 |
| Phase 4 | BigQuery分析ダッシュボード | 後 |

各フェーズは独立した spec → plan → 実装サイクルで進める。

---

## 3. アーキテクチャ（確定）

```
[ブラウザ]
   │
[Xserver] ── 静的フロント（cg-cockpit.html・ログインゲート）
   │  fetch (HTTPS, CORS許可)
[Google Cloud Run] ── Node API（cockpit-server.js を拡張）
   │      ├─ YouTube Data API / Apify（診断実行）
   │      └─ Google Sheets API 読み書き（操作データ）
   │
[BigQuery] ←── Sheetsから同期（結果集計・分析）※Phase 4
```

- **フロント＝Xserver（静的）／実行＝Cloud Run（Node）／操作データ＝Google Sheets／分析＝BigQuery**
- 全てGoogleエコシステム。既存Node資産をそのまま活用。
- 選定理由：Xserverはレンタルサーバー（Node常駐不可）のため、フロントは静的配置し、診断実行はscale-to-zeroのCloud Runに置く。BigQuery（ARCHITECTURE.md構想）と同じGoogle Cloud内に収まる。

---

## 4. Phase 1 MVP スコープ

### 含む
- Xserverにコックピット画面を静的配置（既存 `public/cg-cockpit.html` をベース）
- Cloud Runに診断APIをデプロイ（既存 `cockpit-server.js` を拡張）
  - `POST /api/cockpit/youtube`（YouTubeチャンネル診断・転換質）
  - `POST /api/cockpit/yt-search`（キーワードで候補検索）
- ブラウザから診断を実行し結果を表示（既存ライブパネルを本番化）
- 診断結果を Google Sheets に保存（マスタDB／案件DB相当のタブ）
- CG社員向けログイン（Googleサインイン＋メール許可リスト）

### 含まない（後フェーズ）
- クライアントポータル（Phase 3）
- ヒアリングのGoogleフォーム連携（Phase 2）
- CG管理画面のステータス・集計UI（Phase 2）
- BigQuery集計ダッシュボード（Phase 4）
- Instagram/Apifyのブラウザ実行（コスト管理が必要なため段階導入。MVPはYouTubeのみ）

---

## 5. コンポーネントと責務

| コンポーネント | 置き場所 | 責務 | 依存 |
|--------------|---------|------|------|
| フロント（cockpit） | Xserver（静的） | UI・入力・結果表示・ログインゲート | 診断API・認証 |
| 認証ゲート | フロント＋API | Googleサインイン、許可リスト照合、セッション | Google OAuth、許可リストSheet |
| 診断API | Cloud Run（Node） | YouTube/Apify診断の実行、Sheets書き込み | YouTube API、Apify、Sheets API |
| 操作データ | Google Sheets | 診断結果・マスタ・案件・許可リスト | — |

各ユニットはHTTPの明確なインターフェースで通信し、独立して差し替え可能。

---

## 6. データフロー（MVP：診断実行）

```
1. CG社員がフロントでGoogleサインイン
2. フロントが認証トークンを得て、許可リスト照合（API側で検証）
3. チャンネルID/キーワードを入力し「診断」
4. フロント → 診断API（Cloud Run）にPOST
5. APIがYouTube API/Apifyを呼び、転換質等を算出
6. APIが結果をSheetsに追記（マスタDB/案件DB）し、JSONをフロントに返す
7. フロントが結果を表示
```

---

## 7. 認証設計（MVP）

- 方式：**Googleサインイン（OAuth 2.0）＋メール許可リスト**
- 無料の個人Gmailで利用可能（Workspace不要）。OAuthクライアントは無料のGoogle Cloudプロジェクトで発行。
- フロー：Googleサインインで本人確認 → APIが許可リストSheet（氏名・Gmail・権限）と照合 → 一致すれば許可。
- メンバー追加/削除は許可リストSheetの編集のみ。
- セッション：IDトークン（JWT）をAPIが検証。短期セッションをフロントで保持。
- 「誰が操作したか」をログに残せる（提案ログDBに有効）。

---

## 8. データモデル（Google Sheets・MVP範囲）

スプレッドシート1冊に以下のタブ（既存GAS資産を踏襲）：
- `許可リスト`：氏名 / Gmail / 権限（admin/member）
- `インフルエンサーマスタ`：既存設計の名簿（媒体・ジャンル・コンテンツ型・スコア・転換質・実績）
- `案件DB`：診断→結果の記録（既存設計）
- `診断ログ`：MVPの診断実行ログ（実行者・日時・対象・スコア・転換質）

Phase 2以降で `提案ログ`・`ヒアリング`・`ステータス` タブを追加。

---

## 9. デプロイ・運用の責任分担

コードと手順書はClaudeが用意。以下の設定・デプロイはCG側で実施（Claudeは認証情報を扱えないため）：
- Google Cloud プロジェクト作成、Cloud Run デプロイ
- Google OAuth クライアント発行（ログイン用）、APIキー（YouTube）の設定
- Xserver へ静的ファイルをアップロード、独自ドメイン割当
- 許可リストSheet・各DB Sheetの作成と共有設定

---

## 10. 成功基準（MVP）

- CG社員が自社ドメインのURLにアクセスし、Googleサインイン（許可リスト内）でログインできる
- ブラウザでYouTubeチャンネルIDを入力 → 転換質を含む診断結果が表示される
- キーワード検索で候補リストが表示される
- 診断結果がSheetsに自動保存される
- 非許可ユーザーはログインできない

---

## 11. リスク・留意点

- Cloud Run・OAuth・Xserverの初期設定はCG側の作業負荷がある（手順書で軽減）。
- YouTube APIクォータ（1日10,000ユニット）・Apifyコストの管理が必要。MVPはYouTube中心。
- IGの転換質はノイズが大きいため、MVPでは扱わず Phase 2以降で「Astream PRエンゲージ・プロキシ＋人間の目」で設計済みの方式を組み込む。
- 静的フロント→Cloud RunのCORS設定が必要。
- 認証トークンの検証をAPI側で必ず行う（フロントだけの判定にしない）。

---

## 12. 次フェーズの予告（参考）

- Phase 2：Googleフォーム（ヒアリング）→ Sheets連携、CG管理画面（案件ステータス・結果集計）
- Phase 3：クライアントポータル（per-clientログイン、進行・結果の閲覧）
- Phase 4：Sheets → BigQuery 同期、分析ダッシュボード（ROAS・診断精度の集計）
