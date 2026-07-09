# ① Pamun LP 制作・配信基盤 — 設計書

*作成日: 2026-07-09 / 担当: Claude Code + CreativeGroup*
*親ドキュメント: [Pamun LP × 広告グロースハック基盤 全体像](2026-07-09-pamun-lp-growth-platform-overview.md) のサブプロジェクト①*

---

## 1. 目的

広告の受け皿となる「キャンペーンLP」を、Claudeに指示して高速に作成・改善できる**制作・配信の土台**を作る。
このサブプロジェクトのゴールは「Claudeで作った日本語＋韓国語のLPを、staging確認を経て本番公開できるパイプラインが回る」状態にすること。

## 2. 確定した前提・決定事項（経緯つき）

| 項目 | 決定 | 経緯・理由 |
|------|------|-----------|
| リポジトリ | **新規専用リポジトリ `pamun-lp`** | ダッシュボードrepoとは関心を分離。LP専用にCI/デプロイを組む |
| スタック | **Astro + i18n** | コンポーネント再利用でLP量産しやすい・完全静的で高速 |
| 多言語 | 日本語(デフォルト, ルート) / 韓国語(`/ko/`)、将来他言語も | 翻訳ベース＋韓国向けセクション差し替え可の柔軟設計 |
| URL構造 | **本体ドメイン配下 `pamun.jp/<slug>/`** | サブドメイン `lp.` は「売り込み感」が強く、信頼ベースの口コミサービスに逆行。本体ドメイン配下がSEO/信頼で有利 |
| 本番配信 | **Xserver に静的ファイルを直接配置**（A2） | Xserver共有プランは外部への `mod_proxy`（リバースプロキシ, A1）が使えないため。Astroは完全静的なのでファイル配置で完結 |
| WP共存 | WordPressは `public_html/` ルートのまま、AstroはサブディレクトリでApacheが直接配信 | WPの`.htaccess`は実在するファイル/ディレクトリを書き換えない（`RewriteCond !-f !-d`）ため衝突しない |
| staging | **`stg.pamun.jp`（Xserverサブドメイン）**、Firebaseは廃止 | 本番がXserver静的配置＋WP .htaccess共存という特殊環境。stagingも同一環境にする方が本番挙動を保証でき、1ホストで完結し構成がシンプル |
| CI/CD | **GitHub Actions → SSH鍵で rsync/SFTP** | PR/開発ブランチ→stg、mainマージ→本番を自動化 |
| GCP/Firebase | ①では**不要** | ②計測基盤でBigQueryを使う段で再登場 |

### 却下した選択肢（後戻り防止の記録）
- **A1 リバースプロキシ**（WPサーバーが `/xxx/` をFirebaseへプロキシ）: Xserver共有プランで外部逆プロキシが使えず不可
- **Firebase Hosting 本番配信**: URL構造Aを選んだ結果、本番がXserverになり本番用途が消滅。stagingもXserverに寄せて廃止
- **サブドメイン `lp.pamun.jp`**: 売り込み感・信頼低下のため却下

## 3. アーキテクチャ

```
GitHub: pamun-lp（新規専用リポジトリ）
  Astro + i18n（ja=default, ko=/ko/）
  再利用コンポーネント（Hero / 訴求 / MonitorStats / FAQ / CTA …）
        │
        ▼  GitHub Actions（SSH鍵で rsync/SFTP）
   ┌────────────────────┬───────────────────────┐
   │ PR/開発ブランチ      │ main マージ            │
   ▼                    ▼
 stg.pamun.jp          pamun.jp/<slug>/
 (Xserver staging)     (Xserver 本番・WPと同居)
                       ※ WPの.htaccessは実在dirを
                          そのままApacheが配信＝衝突なし
```

## 4. コンポーネント設計（各ユニットは独立して理解・変更可能に）

### 4.1 Astroプロジェクト構成
```
pamun-lp/
├── astro.config.mjs        # i18n設定・base path（環境変数で切替）
├── src/
│   ├── pages/
│   │   ├── index.astro          # ja（ルート）
│   │   └── ko/index.astro       # 韓国語
│   ├── components/              # 再利用LP部品
│   │   ├── Hero.astro
│   │   ├── ProblemSection.astro
│   │   ├── Solutions.astro
│   │   ├── MonitorStats.astro
│   │   ├── Faq.astro
│   │   └── CtaButton.astro
│   ├── layouts/
│   │   └── BaseLayout.astro     # hreflang・言語切替UI・GTM挿入口
│   ├── i18n/
│   │   ├── ja.json              # 日本語辞書
│   │   ├── ko.json              # 韓国語辞書
│   │   └── ui.ts                # 翻訳ヘルパ・ロケール別セクション差し替え
│   └── styles/
│       └── tokens.css           # ブランドトークン（配色・フォント／韓国語Webフォント）
├── .github/workflows/
│   └── deploy.yml               # PR→stg / main→本番
└── README.md                    # セットアップ・運用手順
```

### 4.2 i18n方針（柔軟設計）
- 基本：1つのページ構造 × 言語別辞書（`ja.json`/`ko.json`）で翻訳
- 例外：韓国向けだけ差し替えたいセクションは、ロケール別コンテンツ定義で上書き可能にする（翻訳と差し替えの両立）
- `hreflang` タグで ja/ko の相互リンクを出力（SEO）

### 4.3 base path 切替
- 本番: `base: '/<slug>/'`（例 `/lp-monitor/`）→ アセットは `pamun.jp/<slug>/_astro/...`
- staging: `stg.pamun.jp` ルート配信（`base: '/'`）
- ビルド時の環境変数（例 `DEPLOY_TARGET=prod|stg`）で `astro.config.mjs` が base を切替

### 4.4 CI/CD（GitHub Actions）
- **PR / 開発ブランチ push**: `DEPLOY_TARGET=stg` でビルド → `stg.pamun.jp` のドキュメントルートへ rsync
- **main マージ**: `DEPLOY_TARGET=prod` でビルド → `public_html/<slug>/` へ rsync
- SSH秘密鍵・接続先ホスト/ユーザー/パスは GitHub Secrets に格納
- rsync は `--delete` で対象ディレクトリのみ同期（WPルートには絶対に触れない安全策）

## 5. Xserver 側の準備（手順としてドキュメント化する）
1. Xserverパネルで SSH を有効化し、公開鍵を登録（GitHub Actions用）
2. サブドメイン `stg.pamun.jp` を作成（独立ドキュメントルート）
3. `pamun.jp` DNS はそのまま（本番は既存ドメイン配下の物理ディレクトリなのでDNS変更不要）／`stg` サブドメイン用レコードのみ追加
4. `public_html/<slug>/` は GitHub Actions が作成・同期（手動作成は不要）

## 6. ①の完了条件（Definition of Done）
1. `pamun-lp` リポジトリ雛形（Astro + i18n + 再利用コンポーネント群）が存在する
2. **1枚の実LP**を日本語＋韓国語で作り、`stg.pamun.jp` → `pamun.jp/<slug>/` までパイプラインを通して公開できる
3. GitHub Actions で PR→stg / main→本番 が自動で動作する
4. Xserver の SSH／サブドメイン／デプロイ手順が README にドキュメント化されている
5. WordPress（`pamun.jp` トップ）に一切影響が出ていないことを確認

## 7. スコープ外（別サブプロジェクトで扱う）
- LPの中身・slug名・キャンペーンテーマの具体化（②③）
- 韓国語翻訳の供給元の確定（人手 or Claude翻訳＋監修）
- GA4/GTM・広告媒体との計測連携（②）
- Claude駆動の改善運用ルール（③）
- バナー量産（④）

## 8. リスクと対策
| リスク | 対策 |
|--------|------|
| rsync 誤爆でWPルートを破壊 | デプロイ先を `public_html/<slug>/` に限定、`--delete` は対象ディレクトリ内のみ。WPルートはパスに含めない |
| WPの.htaccessがサブディレクトリを飲み込む | 実在ディレクトリは書き換えられない仕様を利用。デプロイ後に本番URLで実配信を確認 |
| base path 設定漏れでアセット404 | stg/prodで base を環境変数切替し、両環境で表示確認をDoDに含める |
| 韓国語フォントの表示崩れ | Webフォント（例 Noto Sans KR）をtokensで明示、ko表示をstgで確認 |
