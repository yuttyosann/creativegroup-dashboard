# ②a Pamun LP 計測基盤 — 設計書

*作成日: 2026-07-12 / 担当: Claude Code + CreativeGroup*
*親ドキュメント: [Pamun LP × 広告グロースハック基盤 全体像](2026-07-09-pamun-lp-growth-platform-overview.md) のサブプロジェクト②a*
*前提: ①制作・配信基盤 完了（本番 pamun.jp/monitor/ 稼働中）*

---

## 1. 目的

新LP（`pamun.jp/monitor/` ja・`/monitor/ko/` ko）に計測を載せ、
「LP流入 → CTA → フォーム送信CV」を GA4 と BigQuery で可視化する。
③Claude駆動改善ループを回すための *LP自体の数値（流入・CVR）* を取れる状態にすることがゴール。

②a はLP計測に限定し、広告媒体→BigQuery・チャネル別ROAS分析は ②b（別サブプロジェクト）で扱う。

## 2. 現状（調査で判明・2026-07-12）

| 要素 | 状態 |
|------|------|
| GTM | `GTM-5KWRC39` が pamun.jp（WordPress）に設置済み |
| GA4 | `G-HR6XF36RCZ`（GTM経由）稼働中。GA4プロパティ = `273371278` |
| GA4 → BigQuery | ✅ `cg-project-491303.analytics_273371278` に日次export稼働中 |
| Meta Pixel / Google Ads | `fbq` / `AW-799179729` 設置済み（GTM同梱） |
| 資料請求フォーム | `https://pamun.jp/document-inquiry/`（Contact Form 7・AJAX送信・「ありがとう」インライン表示） |
| お問い合わせ | `https://pamun.jp/inquiry/` |
| 新LP `/monitor/` | 計測タグ未設置（`PUBLIC_GTM_ID` 未設定）。BaseLayoutにGTM挿入口は実装済み |

## 3. 基本方針：既存GA4資産に相乗り

新LPを独立させず、**既存の `GTM-5KWRC39` / GA4 `G-HR6XF36RCZ` に載せる**。
LP・フォームとも同じ pamun.jp・同じGA4プロパティなので、
「LP流入 → CTAクリック → フォーム送信CV」が **1セッションのファネル** として繋がり、
既に BigQuery(`analytics_273371278`) へ流れている日次exportにそのまま乗る。

> 却下案: LP専用のGA4プロパティ/コンテナを新設 → 同一ドメイン内でセッション/CVが分断し、
> 既存Meta/Ads資産も二重管理になるため不採用。LPは landing_page=`/monitor/*` で分離すれば十分。

## 4. データフロー

```
/monitor/(ja) ─┐                          ┌→ GA4 (G-HR6XF36RCZ / 273371278)
/monitor/ko/  ─┤ GTM-5KWRC39（LPに搭載）  ┤   ├ page_view / lp_cta_click / scroll
               │                          │   └ (Meta Pixel / Google Ads も相乗り)
   CTAクリック  ▼                          └→ BigQuery analytics_273371278（既存export）
 ja → pamun.jp/document-inquiry/ (既存CF7)   ──┐
 ko → pamun.jp/document-inquiry-ko/ (新設CF7) ├→ フォーム送信 = CV（wpcf7mailsent）
                                              └→ landing_page=/monitor/* で LP別CVR算出
```

## 5. コンポーネント

### 5.1 LPにGTM搭載
- ビルド環境変数 `PUBLIC_GTM_ID=GTM-5KWRC39` を GitHub Actions のビルドに渡す（BaseLayout挿入口は実装済み）
- ja/ko 両ページに適用される（共通レイアウト）
- → GA4/Meta/Ads を一括継承

### 5.2 CTA導線を実フォームへ
- ja: LPのCTA『資料をダウンロード/資料請求』→ `https://pamun.jp/document-inquiry/`
- ko: LPのCTA → `https://pamun.jp/document-inquiry-ko/`（韓国語CF7・5.5で新設）
- CTAのhref・ラベルは i18n 辞書（`ja.json`/`ko.json`）で管理

### 5.3 LP側イベント設計（dataLayer → GTM → GA4）
| イベント | 発火 | 用途 |
|---------|------|------|
| `page_view` | GA4自動 | 流入・landing_page |
| `lp_cta_click` | CTAボタンクリック時に `dataLayer.push` | intent・アトリビューションの起点 |
| `scroll`（90%到達） | GA4拡張計測 or 手動 | エンゲージメント（任意） |
- LP（Astro）側で CTA に dataLayer push を仕込む（`window.dataLayer.push({event:'lp_cta_click', locale, cta_id})`）
- GTM-5KWRC39 側で `lp_cta_click` を GA4イベントとして転送するトリガー/タグを追加

### 5.4 CV（フォーム送信）計測
- CF7 は AJAX送信のため pageview が発生しない。`wpcf7mailsent` DOMイベントを dataLayer に push → GTMでGA4コンバージョン `generate_lead` として送信
- 既にGTM-5KWRC39に設定済みかを **まず検証**。無ければ設定を追加（GTMコンテナ作業）
- ja/ko 両フォームで発火すること、`form_id` 等でja/ko判別できることを確認

### 5.5 韓国語問い合わせページ新設（採用案A）
- WordPressに韓国語の資料請求ページを新設（例 `pamun.jp/document-inquiry-ko/`）、Contact Form 7 を韓国語ラベルで作成
- GTM-5KWRC39 を継承（テーマ共通のため自動）
- 通知先メール・自動返信を設定（韓国語問い合わせの受信対応担当を決める）
- 日本語 `document-inquiry` と同一の計測・CV機構になる（採用理由）

### 5.6 UTM規約
- 広告流入分類のため `utm_source` / `utm_medium` / `utm_campaign` の命名規則を定義
  - 例: `utm_source=google|meta|tiktok`、`utm_medium=cpc|paid_social`、`utm_campaign=<商戦_媒体_案>`
- ②bのチャネル別ROAS分析の前提になるため②aで規約だけ先に決める（実際の付与は広告入稿時）

## 6. 検証（Definition of Done）

1. LP(ja/ko)に `GTM-5KWRC39` が搭載され、GA4 DebugView/リアルタイムで `/monitor/` の `page_view`・`lp_cta_click` が発火する
2. BigQuery `analytics_273371278` に `/monitor/` イベントが着弾する（翌日以降のevents_テーブル）
3. `document-inquiry` / `document-inquiry-ko` のフォーム送信が GA4コンバージョン `generate_lead` として計上される
4. ファネル「landing_page=/monitor/* → CTA → フォーム送信CV」が GA4/BQ で追え、**LP別CVR**が算出できる
5. ja/ko 両方でCV導線が機能（koは韓国語問い合わせへ送客）

## 7. スコープ外（②b以降）

- Google/Meta/TikTok 広告 → BigQuery 連携（②b）
- チャネル別ROAS・広告費対効果の可視化（②b）
- LP別CVRダッシュボード/Looker Studioの本格構築（②b or ③）
- Claude駆動のLP改善運用ルール（③）

## 8. 依存・未決事項

- **GTM-5KWRC39コンテナの編集権限**（`lp_cta_click`転送・CF7 CV設定の確認/追加に必要）
- 韓国語問い合わせの**受信対応担当**（誰が韓国語で返信するか）
- `document-inquiry-ko` の正式スラッグ/デザイン（WP側でTCDテーマに合わせる）
- 既存GTMで `generate_lead` CVが設定済みか（検証で判明させる）

## 9. リスクと対策

| リスク | 対策 |
|--------|------|
| 既存GTM/GA4への変更が本番計測を壊す | GTMの「プレビュー/バージョン公開」で検証してから公開。変更は追加中心（既存タグは触らない） |
| LP計測が本番pamun.jp全体の数値に混ざる | landing_page=`/monitor/*` で常に分離。既存レポートは影響なし |
| CF7 CVがko/jaで区別できない | `form_id` またはURLで判別、GA4イベントパラメータに `lang` を付与 |
