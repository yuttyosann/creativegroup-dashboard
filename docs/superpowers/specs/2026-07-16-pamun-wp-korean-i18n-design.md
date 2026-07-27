# Pamun WordPress本体 韓国語対応 設計書

*作成日: 2026-07-16 / 担当: Claude Code + CreativeGroup*

> 親: [Pamun LP × 広告グロースハック基盤 — 全体像](./2026-07-09-pamun-lp-growth-platform-overview.md)
> 関連: [① 制作・配信基盤 設計書](./2026-07-09-pamun-lp-delivery-infra-design.md)（Astro側 `/monitor/` のja/ko）

---

## 1. 背景・目的

①で広告用キャンペーンLP（`pamun.jp/monitor/`）はAstro i18nによりja/ko両対応で本番稼働している。
一方、**コーポレートサイト本体（`pamun.jp/` ルート = WordPress + TCD087）は日本語のみ**である。

本サブシステムは、このWordPress本体を韓国語に切り替えられるようにする。

**目的は韓国語SEOでの集客**（2026-07-16 確定）。広告流入の読解補助にとどまらず、
韓国語ページを検索エンジンにインデックスさせオーガニック流入を狙う。
→ URLスラッグ・metaタイトル/descriptionの翻訳とhreflangが**必須要件**となる。

## 2. 対象環境の実測値（2026-07-16 SSH確認済）

| 項目 | 値 |
|------|-----|
| WordPress | 7.0.1 |
| テーマ | `drop_tcd087`（TCD「DROP」）v2.12.5 |
| docroot | `/home/buzzreach/pamun.jp/public_html/`（WPはルート稼働） |
| DB | `buzzreach_wp6` / 58MB / テーブルプレフィックス `wp_` |
| wp-content | 2.3GB（うち `uploads` 2.1GB） |
| WP-CLI | `/usr/bin/wp`（利用可） |
| PHP | 8.0.30 |
| コンテンツ | 固定ページ20件・投稿0件・独自投稿タイプ `news` / `faq` / `interview` |
| SEO | **Rank Math**（`seo-by-rank-math`）稼働中 |
| 他の主要プラグイン | contact-form-7（+multi-step, +redirect）/ mw-wp-form / liquid-connect / liquid-blocks / super-progressive-web-apps / really-simple-ssl / code-snippets |
| SSH | user=`buzzreach` / host=`sv5149.xserver.jp` / port=`10022` / 鍵=`~/.ssh/pamun_lp_ci` |

## 3. 確定した決定事項

| 項目 | 決定 | 理由 |
|------|------|------|
| プラグイン | **TranslatePress** | 後述（§4） |
| ライセンス | **Personal €99/年** | SEO Packが含まれ、1サイト・ja→koの要件を満たす最小構成 |
| URL構造 | `pamun.jp/ko/`（サブディレクトリ方式） | Astro側 `/monitor/ko/` と表記が揃う。サブドメイン不要 |
| SEOプラグイン | **Rank Mathは存置** | TranslatePressと公式に相互対応。多言語サイトマップが自動生成される |
| 検証環境 | **`wpstg.pamun.jp` + 新規DB** | 本番リスクゼロ。`stg.pamun.jp` はAstro版LPが使用中で転用不可 |
| uploads | 検証環境は**本番へのシンボリックリンク**で共有（読み取り専用運用） | 2.1GBの重複コピーとディスク・転送時間を回避 |
| 自動翻訳 | Google翻訳API（自前キー）＋**人手校正必須** | DeepLはBusinessプラン限定。校正前提なら精度差は許容範囲 |

### 3.1 却下した選択肢（後戻り防止のため記録）

- **Polylang / Bogo（投稿複製型）** → 却下。§4参照。
- **WPML** → 却下。有料かつ公式ディレクトリ外。TranslatePressで要件を満たせるため採用理由がない。
- **Weglot（SaaS）** → 却下。従量課金でページ数増に伴いコストが伸びる。翻訳データが外部保持になる。
- **Business €199/年** → 現時点では却下。DeepLと自動言語検出のためだけに倍額を払う必要がない。将来3言語目や自動言語検出が必要になった時点で再検討（Personalからの差額アップグレード可）。

## 4. TranslatePressを選ぶ理由（最重要）

WordPressコアに多言語機能は無く、プラグインで実現する。方式は2系統ある。

- **投稿複製型**（Polylang / Bogo / WPML）: 固定ページ・投稿を言語ごとに複製して紐付ける
- **画面出力翻訳型**（TranslatePress）: フロントに出力されたHTMLのテキストを丸ごと翻訳対象にする

**TCD087は前者と相性が悪い。** TCD系テーマは、トップのキャッチコピー・スライダー見出し・
CTAボタン文言などの多くを「投稿」ではなく**テーマオプション（管理画面の設定値、`wp_options`に保存）**
に格納している。投稿複製型は投稿・固定ページ・カスタム投稿を翻訳対象とする仕組みのため、
テーマオプション由来の文言が日本語のまま韓国語ページに残る。

TranslatePressは出力後のHTMLを対象にするためこの制約を受けない。
TCD公式ブログ自身がTranslatePressを紹介しており、テーマ側との相性の裏付けもある。

> ⚠️ ただし「テーマオプション文言も訳せるはず」は**理論上の期待値**である。
> 実際にどこまで拾えるかは Task 5 のカバレッジ実測で確定させる。ここが本プランの検証の核。

### 4.1 カバレッジ実測結果（2026-07-16 wpstg.pamun.jpで実証・GO判定）

**結論: 仮説は実証された。TCD087のテーマオプション文言はTranslatePressで翻訳できる。**

- **決定的証拠**: トップのヒーローキャッチコピー「発売前から、売れる理由をつくる。」
  （TCD DROPテーマのテーマオプション由来）に韓国語訳を注入したところ、
  `/ko/` では韓国語に置換され、`/`（日本語）では原文のまま表示された。
  投稿複製型（Polylang等）では訳せない文言が、TranslatePressでは訳せることをブラウザで確認。
- **翻訳可能文字列量**（主要9ページ巡回時点）: 通常文字列（本文＋テーマオプション）約391件、
  gettext（テーマ/プラグインの`__()`文言）103件。全ページ訳しても
  Personalプランの自動翻訳枠（AI 50,000語）に十分収まる小規模。
- **R3（フォーム）**: `/ko/` の問い合わせ・資料請求・応募フォームは全て描画される（各27要素）。
  ⚠️ 送信→確認画面→サンクスの多段遷移はTask 8でブラウザ実機確認する（curlでは未検証）。
- **R2（PWA）**: SuperPWAは稼働中だが、`/` と `/ko/` はURLが異なるため
  ServiceWorkerのキャッシュエントリも別。言語混線は起きない（低リスク）。

### 4.2 実装で判明したgotcha（本番展開・再構築時に必須）

- **G1: 検証環境のDB_HOSTは `127.0.0.1` 必須**。XserverのWeb版PHP-FPMは
  `localhost`（UNIXソケット）を解決できず「Error establishing a database connection」で500になる。
  CLIの`wp`は`localhost`で通るため気づきにくい。TCP接続の`127.0.0.1`で解決。
  （本番は`mysql5015.xserver.jp`で稼働中のため本番側は影響なし）
- **G2: WP-CLIの`wp option update trp_settings`で言語を足すと、TPの辞書・gettextテーブルが自動生成されない**。
  結果、韓国語ページで`Table 'wp_trp_gettext_ko_kr' doesn't exist`のDBエラーが多発する。
  → **本番では管理画面のTranslatePress設定画面から言語を追加・保存する**こと（保存時に
  `check_table()` / `check_gettext_table()` が正規フローで走りテーブルを生成する）。
  CLIで設定する場合は同関数を明示的に呼ぶ必要がある（検証環境では手動実行して解決済み）。

## 5. 既知のリスク・要検証事項

| # | リスク | 対応 |
|---|--------|------|
| R1 | TCD087のテーマオプション文言が実際には拾えない箇所がある | ✅**解消**（§4.1）。ヒーロー文言で翻訳を実証。テーマオプション文言は翻訳可能 |
| R2 | `super-progressive-web-apps`（PWA）のキャッシュが言語違いのページを混線配信する可能性 | ✅**低リスク**（§4.1）。`/`と`/ko/`はURLが別＝SWキャッシュも別エントリ。混線しない |
| R3 | CF7多段フォーム／MW WP Formの確認画面・リダイレクト先が韓国語で破綻する可能性 | ⏳一部確認（§4.1）。`/ko/`でフォーム描画OK。送信→確認→サンクスの多段遷移はTask 8で実機確認 |
| R4 | `/ko/` がAstro側 `/monitor/` と衝突 | **衝突しない**。`/monitor/` は実在ディレクトリでApacheが直接配信しWPに到達しない。`/ko/` は実在しないためWPが処理する（①で実証済の共存原理と同じ） |
| R5 | Rank Mathのサイトマップに `/ko/` が載らない | SEO Pack導入後にサイトマップを実確認 |
| R6 | 検証環境が検索インデックスされ重複コンテンツ扱いになる | Basic認証＋`noindex`＋`robots.txt`で二重に遮断（Task 1） |
| R7 | 検証環境のuploadsシンボリックリンク経由で本番メディアを破壊 | 検証環境では**メディアの追加・削除を行わない**運用ルールとする。翻訳検証にメディア編集は不要 |
| R8 | 本番へのプラグイン導入で既存プラグインと競合しサイトが停止 | 本番反映前にDB・ファイルのバックアップを取得（Task 6 Step 1）。ロールバック手順を明記 |

## 6. 言語切替導線の整合（Astro側との関係）

WordPress本体（TranslatePress）とAstro製LP（`/monitor/`）は**言語切替の仕組みが別系統**になる。

- WP本体: `pamun.jp/` ⇄ `pamun.jp/ko/`（TranslatePressの言語スイッチャー）
- Astro LP: `pamun.jp/monitor/` ⇄ `pamun.jp/monitor/ko/`（Astro i18n）

両者は独立して動作するため技術的な衝突はない（R4）。ただしユーザー体験上、
**韓国語のWPページから韓国語のLPへ遷移すべき**である。
→ Task 5 で、韓国語版WPページ内のLPリンクを `/monitor/` から `/monitor/ko/` に差し替える。
TranslatePressはリンクURLも翻訳対象にできるため、この差し替えは翻訳エディタ上で完結する。

## 7. スコープ外（YAGNI）

- 英語・中国語など3言語目以降（必要になった時点でMultiple Languagesアドオンで追加。Personalに同梱済）
- 韓国語向けのコンテンツ差し替え（訴求・オファーの出し分け）。まずは翻訳のみ
- Astro側 `/monitor/` の変更（①で完結済み）
- 韓国語ページのGA4計測分離（②計測基盤のスコープ）
