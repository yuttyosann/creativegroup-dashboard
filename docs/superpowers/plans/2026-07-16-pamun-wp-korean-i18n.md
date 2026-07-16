# Pamun WordPress本体 韓国語対応 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `pamun.jp` のWordPress本体（TCD087テーマ）に TranslatePress を導入し、韓国語ページ `pamun.jp/ko/` を検索インデックス可能な状態で公開する。

**Architecture:** 本番と分離した検証環境 `wpstg.pamun.jp`（新規DB・uploadsは本番へsymlink共有）を構築し、そこで TranslatePress 無料版の翻訳カバレッジを実測する。TCD087のテーマオプション文言がどこまで拾えるかを確定させてから Personal ライセンスを購入し、SEO Pack で hreflang・スラッグ・meta を整備、最後に本番へ同じ手順を適用する。

**Tech Stack:** WordPress 7.0.1 / TranslatePress（`translatepress-multilingual`）/ Rank Math / WP-CLI / Xserver（SSH, PHP 8.0）

**親仕様書:** [Pamun WordPress本体 韓国語対応 設計書](../specs/2026-07-16-pamun-wp-korean-i18n-design.md)

---

## 前提と規約

- **これはコードリポジトリの変更ではない。** 対象は Xserver 上の本番/検証WordPress。このリポジトリにはドキュメントのみコミットする。
- **SSH接続**（以下 `$SSH` と表記）:
  ```bash
  ssh -i ~/.ssh/pamun_lp_ci -p 10022 buzzreach@sv5149.xserver.jp
  ```
  ⚠️ ローカルのサンドボックスはこのホストを解決できない。Bash実行時は `dangerouslyDisableSandbox: true` が必要。
- **パス定義**:
  | 変数 | 値 |
  |------|-----|
  | 本番docroot | `/home/buzzreach/pamun.jp/public_html` |
  | 検証docroot | `/home/buzzreach/pamun.jp/public_html/wpstg.pamun.jp` |
  | 本番DB | `buzzreach_wp6`（プレフィックス `wp_`） |
  | 検証DB | `buzzreach_wpstg`（Task 0で作成） |
- **破壊的操作の禁止**: 本番DBへの書き込みは Task 8 まで一切行わない。Task 1〜7 の `wp` コマンドは必ず検証docrootで `cd` してから実行する。
- **検証環境ではメディアを追加・削除しない**（uploadsが本番へのsymlinkのため。設計書 R7）。

---

## 👤 Task 0: 人間側の事前準備（山口さん作業・コード不要）

Xserverサーバーパネルでの作業。完了後にチェックを入れる。以降の全タスクの前提。

- [ ] **Step 1: 検証用サブドメインを作成**
  - Xserverサーバーパネル →「サブドメイン設定」→ ドメイン `pamun.jp` を選択 → `wpstg` を追加
  - ⚠️ Xserverはサブドメインのフォルダを**フルのサブドメイン名**で作る。ドキュメントルートは
    `/home/buzzreach/pamun.jp/public_html/wpstg.pamun.jp/` になる（`wpstg/` ではない）。①の `stg.pamun.jp` と同じ挙動。

- [ ] **Step 2: SSLを有効化**
  - サーバーパネル →「SSL設定」→ `pamun.jp` → 「独自SSL設定追加」→ `wpstg.pamun.jp` を追加（無料Let's Encrypt）
  - 反映に最大1時間かかる場合がある

- [ ] **Step 3: 検証用MySQLデータベースを作成**
  - サーバーパネル →「MySQL設定」→「MySQL追加」→ DB名 `wpstg`（実際の名前は `buzzreach_wpstg` になる）
  - 文字コードは **UTF-8（utf8mb4）** を選択

- [ ] **Step 4: 検証用MySQLユーザーを作成し権限を付与**
  - 「MySQLユーザ追加」→ ユーザーID `wpstg`（実際は `buzzreach_wpstg`）＋パスワードを設定
  - 「MySQL一覧」→ `buzzreach_wpstg` DBに、いま作ったユーザーへのアクセス権を追加

- [ ] **Step 5: 接続情報をClaudeに共有**
  - DB名 / DBユーザー名 / DBパスワード / MySQLホスト名（サーバーパネルのMySQL設定に表示される。例 `mysqlXXXX.xserver.jp`）
  - ⚠️ パスワードはチャットに貼らず、可能なら別経路で共有するか、Step 6の方法を使う

- [ ] **Step 6:（推奨）パスワードを直接サーバーに置く**
  - チャットにパスワードを出したくない場合、山口さん自身がSSHで以下を実行しておく:
    ```bash
    echo 'DB_PASS_HERE' > ~/.wpstg_dbpass && chmod 600 ~/.wpstg_dbpass
    ```
  - 以降のタスクはこのファイルからパスワードを読む

- [ ] **Step 7: 完了確認**
  - ブラウザで `https://wpstg.pamun.jp/` を開き、Xserverの初期ページまたは403/404が返る（＝vhostが生きている）ことを確認

---

## Task 1: 検証環境のファイル複製

**対象:**
- Create: `/home/buzzreach/pamun.jp/public_html/wpstg.pamun.jp/`（WPファイル一式）
- Symlink: `wpstg.pamun.jp/wp-content/uploads` → 本番uploads

- [ ] **Step 1: 複製先が空であることを確認**

```bash
ssh -i ~/.ssh/pamun_lp_ci -p 10022 buzzreach@sv5149.xserver.jp \
  'ls -A ~/pamun.jp/public_html/wpstg.pamun.jp/ | head'
```

期待: 何も出ないか、Xserverが置いた `default_page.png` / `index.html` 程度。
WPファイルが既にある場合は中断して原因を確認すること。

- [ ] **Step 2: WPファイルを複製（uploadsと他サイトのディレクトリは除外）**

```bash
ssh -i ~/.ssh/pamun_lp_ci -p 10022 buzzreach@sv5149.xserver.jp '
cd ~/pamun.jp/public_html
rsync -a \
  --exclude "/monitor/" \
  --exclude "/stg.pamun.jp/" \
  --exclude "/wpstg.pamun.jp/" \
  --exclude "/wp-content/uploads/" \
  --exclude "/wp-content/cache/" \
  ./ ./wpstg.pamun.jp/
echo "--- copied ---"
ls -1 ./wpstg.pamun.jp/ | head -20
'
```

期待: `wp-admin` `wp-content` `wp-includes` `wp-config.php` 等が複製されている。
⚠️ 除外指定の先頭 `/` は「rsyncのソースルート直下のみ」を意味する。これが無いと
`wp-content/uploads` 配下の同名ディレクトリまで誤って除外されうる。

- [ ] **Step 3: uploadsを本番へsymlinkして共有**

```bash
ssh -i ~/.ssh/pamun_lp_ci -p 10022 buzzreach@sv5149.xserver.jp '
cd ~/pamun.jp/public_html/wpstg.pamun.jp/wp-content
rm -rf uploads
ln -s /home/buzzreach/pamun.jp/public_html/wp-content/uploads uploads
ls -ld uploads
'
```

期待: `uploads -> /home/buzzreach/pamun.jp/public_html/wp-content/uploads` と表示される。

- [ ] **Step 4: 複製サイズを確認**

```bash
ssh -i ~/.ssh/pamun_lp_ci -p 10022 buzzreach@sv5149.xserver.jp \
  'du -sh --exclude=wp-content/uploads ~/pamun.jp/public_html/wpstg.pamun.jp/'
```

期待: 数百MB程度（2.1GBのuploadsを含まない）。

---

## Task 2: 検証環境のDB複製とURL書き換え

**対象:**
- Modify: `wpstg.pamun.jp/wp-config.php`（DB接続先・デバッグ設定）

- [ ] **Step 1: 本番DBをダンプ（読み取りのみ・本番は変更しない）**

```bash
ssh -i ~/.ssh/pamun_lp_ci -p 10022 buzzreach@sv5149.xserver.jp '
cd ~/pamun.jp/public_html
wp db export ~/pamun_prod_dump.sql --add-drop-table
ls -lh ~/pamun_prod_dump.sql
'
```

期待: 50MB前後の `.sql` が出力される。

- [ ] **Step 2: 検証DBへインポート**

```bash
ssh -i ~/.ssh/pamun_lp_ci -p 10022 buzzreach@sv5149.xserver.jp '
DBPASS=$(cat ~/.wpstg_dbpass)
mysql -h mysqlXXXX.xserver.jp -u buzzreach_wpstg -p"$DBPASS" buzzreach_wpstg < ~/pamun_prod_dump.sql
echo "exit=$?"
'
```

⚠️ `mysqlXXXX.xserver.jp` は Task 0 Step 5 で共有された実際のMySQLホスト名に置換すること。
期待: `exit=0`。

- [ ] **Step 3: 検証環境のwp-configをDB接続先ごと書き換える**

```bash
ssh -i ~/.ssh/pamun_lp_ci -p 10022 buzzreach@sv5149.xserver.jp '
cd ~/pamun.jp/public_html/wpstg.pamun.jp
DBPASS=$(cat ~/.wpstg_dbpass)
wp config set DB_NAME buzzreach_wpstg
wp config set DB_USER buzzreach_wpstg
wp config set DB_PASSWORD "$DBPASS"
wp config set DB_HOST mysqlXXXX.xserver.jp
wp config set WP_DEBUG true --raw
echo "--- verify ---"
wp config get DB_NAME
wp config get DB_HOST
'
```

期待: `buzzreach_wpstg` / `mysqlXXXX.xserver.jp` が表示される。

- [ ] **Step 4: 接続先が本番でないことを確認（最重要の安全確認）**

```bash
ssh -i ~/.ssh/pamun_lp_ci -p 10022 buzzreach@sv5149.xserver.jp '
cd ~/pamun.jp/public_html/wpstg.pamun.jp
echo "staging DB_NAME: $(wp config get DB_NAME)"
wp db query "SELECT DATABASE();"
'
```

期待: いずれも `buzzreach_wpstg`。**`buzzreach_wp6` と表示された場合は即中断**し、以降のコマンドを一切実行しないこと。

- [ ] **Step 5: URLを検証環境に書き換え**

```bash
ssh -i ~/.ssh/pamun_lp_ci -p 10022 buzzreach@sv5149.xserver.jp '
cd ~/pamun.jp/public_html/wpstg.pamun.jp
wp search-replace "https://pamun.jp" "https://wpstg.pamun.jp" \
  --all-tables-with-prefix --precise --report-changed-only
echo "--- verify ---"
wp option get siteurl
wp option get home
'
```

期待: `https://wpstg.pamun.jp` が2行表示される。

⚠️ `--all-tables-with-prefix` は `wp_` プレフィックスのテーブルのみ対象。
検証DBには検証環境のテーブルしか無いため本番には影響しない（Step 4で確認済）。

- [ ] **Step 6: ダンプを削除**

```bash
ssh -i ~/.ssh/pamun_lp_ci -p 10022 buzzreach@sv5149.xserver.jp 'rm -f ~/pamun_prod_dump.sql'
```

---

## Task 3: 検証環境の遮断と外部連携の停止

本番の解析データ・通知・スプレッドシートを汚染しないための隔離。設計書 R6 / R2 対応。

- [ ] **Step 1: 外部にデータを送るプラグインを停止**

```bash
ssh -i ~/.ssh/pamun_lp_ci -p 10022 buzzreach@sv5149.xserver.jp '
cd ~/pamun.jp/public_html/wpstg.pamun.jp
wp plugin deactivate \
  cf7-google-sheets-connector \
  mw-wp-form-line-notify \
  facebook-conversion-pixel \
  official-facebook-pixel \
  onesignal-free-web-push-notifications \
  insert-headers-and-footers
echo "--- active plugins ---"
wp plugin list --status=active --field=name
'
```

期待: 上記6つが `active` 一覧から消えている。
⚠️ `super-progressive-web-apps`（PWA）は**あえて有効のまま残す**。設計書R2のキャッシュ混線を検証するため。

- [ ] **Step 2: 検索エンジンからの遮断（WP設定）**

```bash
ssh -i ~/.ssh/pamun_lp_ci -p 10022 buzzreach@sv5149.xserver.jp '
cd ~/pamun.jp/public_html/wpstg.pamun.jp
wp option update blog_public 0
wp option get blog_public
'
```

期待: `0`（＝「検索エンジンがサイトをインデックスしないようにする」ON）。

- [ ] **Step 3: Basic認証をかける**

```bash
ssh -i ~/.ssh/pamun_lp_ci -p 10022 buzzreach@sv5149.xserver.jp '
cd ~/pamun.jp/public_html/wpstg.pamun.jp
htpasswd -bc ~/.htpasswd_wpstg pamun $(openssl rand -base64 12 | tr -d "/+=" | head -c 16)
cat > .htaccess.basicauth <<EOF
AuthType Basic
AuthName "staging"
AuthUserFile /home/buzzreach/.htpasswd_wpstg
Require valid-user
EOF
cat .htaccess.basicauth
'
```

⚠️ `htpasswd` が無い場合は Xserverサーバーパネルの「アクセス制限」機能で `wpstg.pamun.jp` にBasic認証を設定する（こちらの方が確実。パネル作業なので山口さんに依頼）。
生成したパスワードは控えて山口さんに共有すること。

- [ ] **Step 4: 検証環境が表示されることを確認**

```bash
curl -su pamun:PASSWORD https://wpstg.pamun.jp/ -o /dev/null -w "%{http_code}\n"
curl -s https://wpstg.pamun.jp/ -o /dev/null -w "no-auth: %{http_code}\n"
```

期待: 認証あり `200` / 認証なし `401`。

- [ ] **Step 5: トップページが本番と同じ見た目で表示されることを目視確認**

ブラウザで `https://wpstg.pamun.jp/` を開く。
期待: 本番 `https://pamun.jp/` と同じレイアウト・画像（uploads symlink経由）で表示される。
崩れている場合はここで原因を潰す。TranslatePress導入前の基準点なので、この時点で本番と一致していることが重要。

---

## Task 4: TranslatePress（無料版）導入と韓国語追加

- [ ] **Step 1: プラグインを導入・有効化**

```bash
ssh -i ~/.ssh/pamun_lp_ci -p 10022 buzzreach@sv5149.xserver.jp '
cd ~/pamun.jp/public_html/wpstg.pamun.jp
wp plugin install translatepress-multilingual --activate
wp plugin list --status=active --field=name | grep translate
'
```

期待: `translatepress-multilingual` が表示される。

- [ ] **Step 2: 韓国語を追加し、URL構造を `/ko/` に設定**

```bash
ssh -i ~/.ssh/pamun_lp_ci -p 10022 buzzreach@sv5149.xserver.jp '
cd ~/pamun.jp/public_html/wpstg.pamun.jp
wp option patch update trp_settings default-language "ja"
wp option patch update trp_settings publish-languages "[\"ja\",\"ko_KR\"]" --format=json
wp option patch update trp_settings translation-languages "[\"ja\",\"ko_KR\"]" --format=json
wp option patch update trp_settings add-subdirectory-to-default-language "no"
wp option get trp_settings --format=json
'
```

⚠️ WP-CLIでの設定が効かない／構造が違う場合は、管理画面
（`https://wpstg.pamun.jp/wp-admin/options-general.php?page=translate-press`）から
「All Languages」に韓国語を追加する方が確実。設定後に上記 `wp option get` で結果を記録すること。

期待: `default-language: ja` / `publish-languages` に `ko_KR` が含まれる。

- [ ] **Step 3: パーマリンクを再生成**

```bash
ssh -i ~/.ssh/pamun_lp_ci -p 10022 buzzreach@sv5149.xserver.jp '
cd ~/pamun.jp/public_html/wpstg.pamun.jp
wp rewrite flush --hard
'
```

- [ ] **Step 4: 韓国語URLが200を返すことを確認**

```bash
curl -su pamun:PASSWORD https://wpstg.pamun.jp/ko/ -o /dev/null -w "ko top: %{http_code}\n"
curl -su pamun:PASSWORD https://wpstg.pamun.jp/ -o /dev/null -w "ja top: %{http_code}\n"
```

期待: 両方 `200`。この時点で翻訳は未投入なので、`/ko/` の中身はまだ日本語のままでよい。

- [ ] **Step 5: `/monitor/` がTranslatePressの影響を受けていないことを確認**（設計書R4の実証）

```bash
curl -s https://pamun.jp/monitor/ -o /dev/null -w "prod monitor: %{http_code}\n"
curl -su pamun:PASSWORD https://wpstg.pamun.jp/monitor/ -o /dev/null -w "stg monitor: %{http_code}\n"
```

期待: 本番 `/monitor/` は `200`（検証環境の作業は本番に何ら影響しない）。
検証環境側の `/monitor/` は `404`（Task 1 Step 2 で除外したため存在しない）＝想定通り。

---

## Task 5: 翻訳カバレッジの実測（本プランの核心）

設計書 §4 の「TCD087のテーマオプション文言もTranslatePressなら拾える」という**仮説を実測で検証する**。
ここで得られる「訳せない箇所の一覧」が、有料版購入とスケジュールの判断材料になる。

- [ ] **Step 1: Google翻訳APIキーを使わず、まず自動翻訳なしで翻訳可能文字列を抽出**

TranslatePressは翻訳エディタを開いたページの翻訳可能文字列をDBに記録する。
主要ページを一度巡回して文字列を収集させる。

```bash
for p in "" "ko/"; do
  for page in "" "about/" "faq/" "news/" "contact/"; do
    curl -su pamun:PASSWORD "https://wpstg.pamun.jp/${p}${page}" -o /dev/null -w "${p}${page} %{http_code}\n"
  done
done
```

⚠️ 実際の固定ページのスラッグは以下で確認してから上のリストを差し替えること:
```bash
ssh -i ~/.ssh/pamun_lp_ci -p 10022 buzzreach@sv5149.xserver.jp '
cd ~/pamun.jp/public_html/wpstg.pamun.jp
wp post list --post_type=page --post_status=publish --fields=ID,post_title,post_name
'
```

- [ ] **Step 2: 収集された翻訳可能文字列の件数を確認**

```bash
ssh -i ~/.ssh/pamun_lp_ci -p 10022 buzzreach@sv5149.xserver.jp '
cd ~/pamun.jp/public_html/wpstg.pamun.jp
wp db query "SELECT COUNT(*) AS strings FROM wp_trp_dictionary_ja_ko_kr;" 2>&1
wp db query "SELECT original FROM wp_trp_dictionary_ja_ko_kr LIMIT 20;" 2>&1
'
```

期待: 数百件レベルの文字列が入っている。テーブル名が違う場合は
`wp db query "SHOW TABLES LIKE '%trp%';"` で実テーブル名を確認する。

- [ ] **Step 3: トップページの韓国語版で「日本語のまま残っている箇所」を洗い出す**

管理画面の翻訳エディタ（`https://wpstg.pamun.jp/wp-admin/admin.php?page=trp_translation_manager`）を開き、
トップページをビジュアル確認する。あわせてHTMLベースでも機械的に確認する:

```bash
curl -su pamun:PASSWORD https://wpstg.pamun.jp/ko/ \
  | grep -oE '>[^<>]{4,}<' \
  | grep -P '[\x{3040}-\x{30ff}\x{4e00}-\x{9faf}]' \
  | sort -u > /private/tmp/claude-501/ko_untranslated.txt
wc -l /private/tmp/claude-501/ko_untranslated.txt
head -40 /private/tmp/claude-501/ko_untranslated.txt
```

これは「`/ko/` に残る日本語テキスト」の一覧。翻訳投入前は全件出るのが正常なので、
**この一覧が「翻訳エディタで編集できる文字列」に含まれているかどうか**が検証ポイント。

- [ ] **Step 4: 検証結果をドキュメント化**

`docs/superpowers/specs/2026-07-16-pamun-wp-korean-i18n-design.md` の §5 リスク表に実測結果を追記する。
最低限、以下を記録すること:

- テーマオプション由来の文言（トップのキャッチコピー・スライダー見出し・CTAボタン）が翻訳エディタに出るか → R1の結論
- `/ko/` でPWAのキャッシュ混線が起きるか → R2の結論
- CF7 / MW WP Form のフォームが `/ko/` で表示・送信できるか → R3の結論
- 訳せない箇所があった場合、その一覧と回避策（文字列翻訳／テーマの子テーマ対応／諦めて日本語のまま）

- [ ] **Step 5: コミット**

```bash
git add docs/superpowers/specs/2026-07-16-pamun-wp-korean-i18n-design.md
git commit -m "docs(ko): TranslatePress翻訳カバレッジの実測結果を反映

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## 🚦 Task 6: 判定チェックポイント（山口さん）

Task 5 の実測結果を見て、進むか止まるかを人間が判断する。**ここを通過するまで課金しない。**

- [ ] **Step 1: カバレッジ実測レポートを確認**

- [ ] **Step 2: 判断**
  - **GO**: 主要文言が訳せている → Task 7 へ（Personal €99/年を購入）
  - **条件付きGO**: 一部訳せないが許容範囲 → 回避策を決めてから Task 7 へ
  - **NO GO**: テーマオプション文言が大量に訳せない → 設計書 §3.1 に立ち返り、Polylang＋TCD個別対応 or Astro側へのLP移行（C案）を再検討

- [ ] **Step 3: GOの場合、TranslatePress Personal を購入**
  - https://translatepress.com/pricing/ → Personal（€99/年）
  - ライセンスキーを控える

---

## Task 7: 有料版導入とSEO設定

**前提:** Task 6 で GO 判定かつライセンス購入済み。

- [ ] **Step 1: TranslatePress Pro とSEO Packアドオンを導入**

購入後のアカウントページから以下2つのzipをダウンロードし、検証環境にアップロードして有効化する:
- `translatepress-business`（Pro本体）
- `translatepress-seo-pack`（SEOアドオン）

管理画面 →「プラグイン」→「新規追加」→「プラグインのアップロード」から導入。
その後 Settings → TranslatePress → License にライセンスキーを入力してアクティベート。

```bash
ssh -i ~/.ssh/pamun_lp_ci -p 10022 buzzreach@sv5149.xserver.jp '
cd ~/pamun.jp/public_html/wpstg.pamun.jp
wp plugin list --status=active --field=name | grep -i trans
'
```

期待: Pro本体とSEO Packが有効。

- [ ] **Step 2: hreflangが出力されることを確認**

```bash
curl -su pamun:PASSWORD https://wpstg.pamun.jp/ | grep -i hreflang
curl -su pamun:PASSWORD https://wpstg.pamun.jp/ko/ | grep -i hreflang
```

期待: `<link rel="alternate" hreflang="ja" ...>` と `hreflang="ko-KR"` の両方が、
日本語版・韓国語版の**どちらのページにも**出力される。

- [ ] **Step 3: Rank Mathの多言語サイトマップに `/ko/` が載ることを確認**（設計書R5）

```bash
curl -su pamun:PASSWORD https://wpstg.pamun.jp/sitemap_index.xml
curl -su pamun:PASSWORD https://wpstg.pamun.jp/page-sitemap.xml | grep -c "/ko/"
```

期待: `/ko/` を含むURLが1件以上。0件の場合は TranslatePress → SEO Pack の設定と
Rank Math のサイトマップ設定を確認する（両者は公式に相互対応しているため、
通常は追加設定なしで動く）。

- [ ] **Step 4: スラッグ翻訳を有効化して1ページで試す**

翻訳エディタで固定ページを1つ開き、「Slug」欄に韓国語スラッグを設定する。

```bash
curl -su pamun:PASSWORD "https://wpstg.pamun.jp/ko/<韓国語スラッグ>/" -o /dev/null -w "%{http_code}\n"
```

期待: `200`。

---

## Task 8: 韓国語翻訳の投入

- [ ] **Step 1: Google翻訳APIキーを設定して自動翻訳を実行**

Settings → TranslatePress → Automatic Translation → Google Translate v2 を選択し、APIキーを入力。
「Automatically translate slugs」もONにする。
その後サイトを巡回して自動翻訳を蓄積させる（Task 5 Step 1 の curl ループを再実行）。

- [ ] **Step 2: 自動翻訳の結果を人手で校正**

⚠️ **自動翻訳のまま公開しない。** 韓国語SEOが目的である以上、不自然な韓国語は
直帰率とブランド毀損に直結する。最低限、以下は必ず人手で確認する:
- トップのキャッチコピー・CTAボタン文言
- サービス名「Pamun」など固有名詞が誤訳されていないか
- フォームのラベル・エラーメッセージ・送信完了文言

- [ ] **Step 3: LPリンクを韓国語版に差し替え**（設計書 §6）

翻訳エディタで、韓国語版ページ内の `/monitor/` へのリンクURLを `/monitor/ko/` に変更する。

```bash
curl -su pamun:PASSWORD https://wpstg.pamun.jp/ko/ | grep -oE 'href="[^"]*monitor[^"]*"' | sort -u
```

期待: `/monitor/ko/` を指している。`/monitor/`（日本語版）が残っていたら翻訳エディタで修正。

- [ ] **Step 4: 全ページを通しで目視確認**

`https://wpstg.pamun.jp/ko/` から全リンクを辿り、レイアウト崩れ・未翻訳・リンク切れを確認する。

---

## Task 9: 本番展開

**前提:** Task 8 完了。山口さんの最終確認済み。

- [ ] **Step 1: 本番のバックアップを取得（必須・ロールバックの生命線）**

```bash
ssh -i ~/.ssh/pamun_lp_ci -p 10022 buzzreach@sv5149.xserver.jp '
cd ~/pamun.jp/public_html
mkdir -p ~/backup/pre-translatepress
wp db export ~/backup/pre-translatepress/db-$(date +%Y%m%d).sql --add-drop-table
cp wp-config.php .htaccess ~/backup/pre-translatepress/
ls -lh ~/backup/pre-translatepress/
'
```

期待: 50MB前後のダンプと設定ファイルが保存されている。

- [ ] **Step 2: 本番にTranslatePress Pro + SEO Packを導入**

管理画面 `https://pamun.jp/wp-admin/` からzipをアップロードして有効化し、ライセンスをアクティベート。
⚠️ Personalは**1サイトライセンス**。検証環境で消費している場合は、
検証環境側でライセンスを解除（deactivate）してから本番でアクティベートする。

- [ ] **Step 3: 検証環境の翻訳データを本番へ移送**

TranslatePressの翻訳は `wp_trp_dictionary_*` テーブルに入っている。これだけを移送する。

```bash
ssh -i ~/.ssh/pamun_lp_ci -p 10022 buzzreach@sv5149.xserver.jp '
cd ~/pamun.jp/public_html/wpstg.pamun.jp
wp db query "SHOW TABLES LIKE \"%trp_%\";"
wp db export ~/trp_tables.sql --tables=$(wp db query "SHOW TABLES LIKE \"%trp_%\";" --skip-column-names | tr "\n" "," | sed "s/,$//")
ls -lh ~/trp_tables.sql
'
```

続いて本番へインポート:

```bash
ssh -i ~/.ssh/pamun_lp_ci -p 10022 buzzreach@sv5149.xserver.jp '
cd ~/pamun.jp/public_html
wp db import ~/trp_tables.sql
wp search-replace "https://wpstg.pamun.jp" "https://pamun.jp" --all-tables-with-prefix --precise --report-changed-only
'
```

⚠️ このimportは**本番DBへの書き込み**。Step 1のバックアップ取得を必ず先に済ませること。
`--tables` 指定により `wp_trp_*` 以外のテーブルは触らない。

- [ ] **Step 4: 本番の設定を反映**

```bash
ssh -i ~/.ssh/pamun_lp_ci -p 10022 buzzreach@sv5149.xserver.jp '
cd ~/pamun.jp/public_html
wp option patch update trp_settings publish-languages "[\"ja\",\"ko_KR\"]" --format=json
wp rewrite flush --hard
wp option get blog_public
'
```

期待: `blog_public` が `1`（本番はインデックス許可）。**`0` なら即修正**すること。

- [ ] **Step 5: 本番の動作確認**

```bash
curl -s https://pamun.jp/ -o /dev/null -w "ja: %{http_code}\n"
curl -s https://pamun.jp/ko/ -o /dev/null -w "ko: %{http_code}\n"
curl -s https://pamun.jp/monitor/ -o /dev/null -w "monitor ja: %{http_code}\n"
curl -s https://pamun.jp/monitor/ko/ -o /dev/null -w "monitor ko: %{http_code}\n"
curl -s https://pamun.jp/ko/ | grep -i hreflang
```

期待: 全て `200`。hreflangが出力されている。
**①で構築したAstro LP（`/monitor/`）が無傷であることの確認が特に重要。**

- [ ] **Step 6: Search Consoleに韓国語サイトマップを登録**（山口さん作業）

Google Search Console → `pamun.jp` プロパティ → サイトマップ →
`sitemap_index.xml` を再送信し、`/ko/` のURLが検出されることを確認。

- [ ] **Step 7: ロールバック手順（問題発生時のみ）**

```bash
ssh -i ~/.ssh/pamun_lp_ci -p 10022 buzzreach@sv5149.xserver.jp '
cd ~/pamun.jp/public_html
wp plugin deactivate translatepress-multilingual
wp db import ~/backup/pre-translatepress/db-YYYYMMDD.sql
wp rewrite flush --hard
'
```

---

## Task 10: 検証環境の撤去

**前提:** Task 9 完了・本番が安定して1週間経過。

- [ ] **Step 1: 撤去して良いか山口さんに確認**

将来の改善サイクル（③Claude駆動LP改善）で検証環境を再利用する可能性がある。
残す判断もあり得るため、**独断で削除しない**。

- [ ] **Step 2: 撤去する場合**

```bash
ssh -i ~/.ssh/pamun_lp_ci -p 10022 buzzreach@sv5149.xserver.jp '
# ⚠️ uploadsはsymlink。-rでたどらないよう、先にリンクを外す
rm -f ~/pamun.jp/public_html/wpstg.pamun.jp/wp-content/uploads
ls -ld ~/pamun.jp/public_html/wp-content/uploads
'
```

⚠️ **本番uploadsが無傷であることを確認してから**、次を実行:

```bash
ssh -i ~/.ssh/pamun_lp_ci -p 10022 buzzreach@sv5149.xserver.jp '
rm -rf ~/pamun.jp/public_html/wpstg.pamun.jp/
'
```

その後、Xserverパネルで `wpstg.pamun.jp` サブドメインと `buzzreach_wpstg` DBを削除（山口さん作業）。

- [ ] **Step 3: メモリを更新**

`project_pamun_lp_growth_platform.md` に本サブシステムの完了状況を追記する。

---

## 完了の定義

- `https://pamun.jp/ko/` が200を返し、主要ページが韓国語で表示される
- hreflangが ja / ko-KR 両方向で出力されている
- Rank Mathのサイトマップに `/ko/` のURLが含まれ、Search Consoleで検出されている
- 韓国語訳が人手で校正済み（自動翻訳のままでない）
- `https://pamun.jp/monitor/` および `/monitor/ko/`（①の成果物）が無傷
- 本番バックアップとロールバック手順が存在する
