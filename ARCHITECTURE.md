# CreativeGroup データプラットフォーム — 全体アーキテクチャ設計書

> ⚠️ この設計書はすべてのプロジェクト・開発作業の**根幹思想**です。
> Claude Codeは必ずこの方針に沿って実装・提案を行うこと。

---

## 🎯 ビジョン

**CreativeGroupの全社データを一元管理し、グロースハックに必要な意思決定を
リアルタイムで行える「データドリブン経営基盤」を構築する。**

- すべてのデータは **BigQuery（Google Cloud）** に集約する
- 広告・アンケート・売上・メール・外部システムを横断して分析できる
- 予算アロケーション、ボトルネック発見、チャネル別ROAS比較を1つの画面で行う

---

## 🏗️ 全体アーキテクチャ

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【データソース層】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  広告媒体                業務データ              外部システム
  ──────                 ──────                 ──────────
  Google Ads              Pamunアンケート          cg-app.jp（Pamun本体）
  Meta Ads（FB/IG）       Gmail/メール履歴          ※ Next.js + React + TS
  TikTok Ads              MFクラウド（請求/売上）   その他外部連携アプリ
  Yahoo! 広告             CGダッシュボード操作ログ
  ※今後追加可能           GA4（Web流入データ）

          ↓ API / GAS / Webhook / SDK
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【収集・ETL層】（Googleエコシステムで統一）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  GAS（Google Apps Script）     → 既存資産活用・無料・簡易ETL
  Cloud Functions               → イベント駆動・API連携・スケーラブル
  Cloud Scheduler               → 日次バッチ自動実行（毎日AM3時など）
  Cloud Storage                 → 生データ一時保存（Data Lake）

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【データウェアハウス層】★ 中核
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  BigQuery（Google Cloud）
  ├── データセット: cg_analytics
  │   ├── ad_daily_metrics        広告媒体別日次KPI
  │   ├── ad_campaigns            キャンペーンマスタ
  │   ├── channel_summary         チャネル横断サマリー
  │   ├── budget_allocation       予算配分テーブル
  │   ├── survey_responses        Pamunアンケート回答
  │   ├── email_threads           Gmail/メール履歴
  │   ├── billing_invoices        MFクラウド請求データ
  │   └── ga4_sessions            GA4流入データ
  └── データセット: cg_external   ※外部システムデータ用

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【外部システム稼働基盤】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Cloud Run                      コンテナ実行・サーバーレス・自動スケール
  Firebase Hosting               Webアプリ公開（cg-app.jp等）
  Cloud Run Jobs                 バッチ処理用

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【活用・可視化層】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  CGダッシュボード（既存）       Node.js + Vanilla JS + Chart.js
  ├── 売上・請求タブ（既存）
  ├── Pamunアンケートタブ（既存）
  ├── 広告パフォーマンスタブ     ← 追加予定
  ├── グロースハックタブ         ← 追加予定（ICEスコアリング）
  └── チャネル横断ROASタブ       ← 追加予定

  Looker Studio（将来）          BigQuery直結・経営BI
  Claude AI分析（既存）          インサイト自動生成
```

---

## 📊 取得・管理するKPI（広告）

| 指標 | 説明 |
|------|------|
| インプレッション | 広告表示回数 |
| クリック数 | 広告クリック数 |
| CTR | クリック率 = クリック/imp |
| CPC | クリック単価 |
| コンバージョン | CV数 |
| CVR | コンバージョン率 |
| フリークエンシー | 1人あたりの広告接触回数 |
| 広告費 | 総消化額 |
| ROAS | 広告費用対効果 = 売上/広告費 |

> ※ 指標は将来的にフレキシブルに追加・変更可能な設計とする

---

## 🗺️ 実装ロードマップ

### Phase B — 既存データのBigQuery統合（最優先）
- [ ] GCPプロジェクト・BigQueryデータセット作成
- [ ] Pamunアンケート → BigQuery日次同期（GAS）
- [ ] MFクラウド請求データ → BigQuery同期
- [ ] Gmail → BigQuery連携（Gmail API）
- [ ] GA4 → BigQuery連携（ネイティブ設定）

### Phase C — 外部システム稼働基盤（第2優先）
- [ ] Cloud Runセットアップ
- [ ] cg-app.js（Pamun本体）のCloud Run移行検討
- [ ] 外部システムからBigQueryへのデータ書き込みAPI設計
- [ ] Cloud Schedulerで日次バッチ設定

### Phase A — 広告媒体API連携（第3優先）
- [ ] Google Ads → BigQuery（ネイティブコネクタ）
- [ ] Meta Marketing API → BigQuery
- [ ] TikTok Ads API → BigQuery
- [ ] Yahoo! 広告API → BigQuery
- [ ] チャネル横断ROASダッシュボードタブ追加

---

## 🔧 技術スタック（Googleエコシステム統一）

| 用途 | ツール |
|------|--------|
| データウェアハウス | BigQuery |
| ETL（軽量） | Google Apps Script |
| ETL（重量・イベント駆動） | Cloud Functions |
| バッチスケジューリング | Cloud Scheduler |
| 生データ保存 | Cloud Storage |
| アプリ実行基盤 | Cloud Run |
| Webホスティング | Firebase Hosting |
| BIツール（将来） | Looker Studio |
| AI分析 | Claude API（Anthropic） |
| 既存ダッシュボード | Node.js + Express + Chart.js |

---

## 🏢 外部システム情報

### cg-app.jp（Pamun本体）
- URL: https://cg-app.jp/
- 技術スタック: Next.js + React + TypeScript + Material-UI
- ルーティング: App Router採用
- 認証: AuthProvider（独自実装）
- 移行先候補: Firebase Hosting / Cloud Run

---

## 📌 設計原則

1. **Google One Stack** — GCP・Googleツールで統一し、連携コストを最小化
2. **BigQuery First** — すべてのデータは最終的にBigQueryに集約
3. **既存資産活用** — GASは引き続き活用、段階的にCloud Functionsへ移行
4. **フレキシブル設計** — KPI・テーブル構造は追加・変更しやすい設計
5. **段階的構築** — Phase B → C → A の順で確実に積み上げる

---

*最終更新: 2026-03-25*
*担当: Claude Code + CreativeGroup*
