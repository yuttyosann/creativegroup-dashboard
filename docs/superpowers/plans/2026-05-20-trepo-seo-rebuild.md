# trepo.jp SEO再構築・AI検索最適化・テスト環境構築 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** trepo.jp にステージング環境・SEO改善・AI検索最適化を順番に実施し、非技術メンバーがデザイン変更を安全に確認できる体制を整える。

**Architecture:** Xserver上に `staging.trepo.jp` を構築し、Duplicatorで本番を複製する。ClaudeがSSH経由でテーマファイルを直接編集し、ステージングで確認後に本番に適用する。SEO改善はRank Math設定変更・テーマ編集・構造化データの3層で実施する。

**Tech Stack:** WordPress, Rank Math SEO, Xserver (SSH port 10022), Duplicator Plugin, PHP (shortcode), CSS (child theme)

---

## 事前確認事項（作業前に用意）

以下をXserverサーバーパネルで確認してメモしておく:

| 項目 | 確認場所 | 例 |
|------|---------|-----|
| サーバーID | サーバーパネル左上 | `sv12345` |
| FTPホスト名 | FTP設定 | `sv12345.xserver.jp` |
| MySQLホスト名 | MySQL設定 | `localhost` |
| 本番WordPressパス | FTP確認 | `/home/sv12345/trepo.jp/public_html` |
| WordPressテーマ名 | WP管理画面 → 外観 → テーマ | `sango` 等 |
| 本番DB名 | Xserver MySQL設定 | `sv12345_trepo` |
| 本番DBユーザー | Xserver MySQL設定 | `sv12345_user` |
| 本番DBパスワード | Xserver MySQL設定 | — |

---

## Phase 1: ステージング環境構築

### Task 1: Xserver にサブドメイン staging.trepo.jp を作成する

**Files:** なし（Xserverサーバーパネルのみ）

- [ ] **Step 1: サーバーパネルにログイン**

  `https://www.xserver.ne.jp/login_server_panel.php` を開いてログインする。

- [ ] **Step 2: サブドメイン設定を開く**

  左メニュー「ドメイン」→「サブドメイン設定」をクリック。

- [ ] **Step 3: staging.trepo.jp を追加**

  `trepo.jp` を選択 → 「サブドメイン設定追加」タブ → サブドメイン欄に `staging` と入力 → 「確認画面へ進む」→「追加する」。

- [ ] **Step 4: 確認**

  一覧に `staging.trepo.jp` が追加されていることを確認する。DNS反映に最大1時間かかる場合がある。

- [ ] **Step 5: WordPressかんたんインストール**

  左メニュー「WordPress」→「WordPressかんたんインストール」→ `staging.trepo.jp` を選択 → インストール先ディレクトリは空欄（ルートに設置）→ 任意のWP管理者情報を入力して「インストール」。

  インストール完了後、WP管理者ユーザー名・パスワード・DB名・DBユーザー・DBパスワードをメモする。

- [ ] **Step 6: インストール確認**

  `https://staging.trepo.jp/` にアクセスしてWordPressのデフォルトテーマが表示されることを確認する。

---

### Task 2: Duplicator で本番を staging.trepo.jp に複製する

**Files:** なし（WordPressプラグイン操作 + FTP）

- [ ] **Step 1: 本番にDuplicatorをインストール**

  `https://trepo.jp/wp-admin/` → 「プラグイン」→「新規追加」→ 「Duplicator」を検索 → 「今すぐインストール」→「有効化」。

- [ ] **Step 2: パッケージを作成**

  WP管理画面左メニューに追加された「Duplicator」→「Packages」→「Create New」→ 名前はデフォルトのまま「Next」→ スキャン結果を確認して「Build」ボタンをクリック。

  完了後、`archive_YYYYMMDD_trepo_jp.zip` と `installer.php` の2ファイルが表示される。両方をダウンロードする。

- [ ] **Step 3: ステージングのファイルを準備**

  FTPクライアント（FileZilla等）でXserverに接続し、`/home/buzzreach/staging.trepo.jp/public_html/` 内の既存ファイルをすべて削除する（WordPressかんたんインストールで設置されたファイル）。

- [ ] **Step 4: FTPでアップロード**

  ダウンロードした `archive_YYYYMMDD_trepo_jp.zip` と `installer.php` を `/home/buzzreach/staging.trepo.jp/public_html/` にアップロードする。

- [ ] **Step 5: installer.php を実行**

  ブラウザで `https://staging.trepo.jp/installer.php` にアクセス。

  - Step 1 (Deploy): 「I have read...」にチェック → Next
  - Step 2 (Install): DBホスト=`localhost`、DB名・DBユーザー・DBパス=Task 1でメモしたステージング用の値を入力 → Test Database → 成功したら Next
  - Step 3 (Update Paths): サイトURL が `https://staging.trepo.jp` になっていることを確認 → Next
  - Step 4 (Complete): 「Admin Login」をクリックしてWP管理画面にログイン

- [ ] **Step 6: 複製確認**

  `https://staging.trepo.jp/` にアクセスし、trepo.jpの本番と同じデザイン・コンテンツが表示されることを確認する。

---

### Task 3: ステージングに Basic 認証と noindex を設定する

**Files:**
- Create: `/home/buzzreach/staging.trepo.jp/public_html/.htpasswd`
- Modify: `/home/buzzreach/staging.trepo.jp/public_html/.htaccess`

- [ ] **Step 1: SSHかFTPで .htpasswd を作成**

  ターミナルで以下を実行してパスワードハッシュを生成する（`YOUR_PASSWORD` を実際のパスワードに変える）:

  ```bash
  python3 -c "
  import crypt, getpass
  pw = 'YOUR_PASSWORD'
  print('staging:' + crypt.crypt(pw, crypt.mksalt(crypt.METHOD_SHA512)))
  "
  ```

  出力された1行（例: `staging:$6$xxxx...`）を `.htpasswd` ファイルとして FTP で `/home/buzzreach/staging.trepo.jp/public_html/.htpasswd` にアップロードする。

- [ ] **Step 2: .htaccess に Basic 認証を追加**

  FTPで `/home/buzzreach/staging.trepo.jp/public_html/.htaccess` を開き、ファイルの先頭に以下を追記する（既存内容は消さずに追記）:

  ```apache
  # Basic Auth for staging
  AuthType Basic
  AuthName "Trepo Staging"
  AuthUserFile /home/buzzreach/staging.trepo.jp/public_html/.htpasswd
  Require valid-user
  ```

  `buzzreach` は実際のXserverサーバーIDに置き換える。

- [ ] **Step 3: Basic 認証確認**

  `https://staging.trepo.jp/` にアクセスし、ユーザー名・パスワードを求めるダイアログが表示されることを確認する。`staging` と設定したパスワードでログインできることを確認する。

- [ ] **Step 4: noindex を有効化**

  `https://staging.trepo.jp/wp-admin/` にログイン → 「設定」→「表示設定」→「検索エンジンがサイトをインデックスしないようにする」にチェック → 「変更を保存」。

- [ ] **Step 5: noindex 確認**

  ブラウザで `https://staging.trepo.jp/` を開き、ページのHTMLソースに以下が含まれることを確認する（右クリック → ページのソースを表示）:

  ```html
  <meta name='robots' content='noindex,nofollow' />
  ```

- [ ] **Step 6: コミット（記録用）**

  ```bash
  cd /Users/yuttyo/claude/creativegroup-dashboard
  git add -A
  git commit -m "docs: staging.trepo.jp 構築完了（Basic認証・noindex設定済み）"
  ```

---

## Phase 2: SSH 接続設定

### Task 4: SSH キーペアを生成して Xserver に登録する

**Files:**
- Create: `~/.ssh/id_ed25519_trepo`（SSHキー）
- Modify: `~/.ssh/config`

- [ ] **Step 1: SSHキーペアを生成**

  ```bash
  ssh-keygen -t ed25519 -C "trepo-claude" -f ~/.ssh/id_ed25519_trepo -N ""
  ```

  `~/.ssh/id_ed25519_trepo`（秘密鍵）と `~/.ssh/id_ed25519_trepo.pub`（公開鍵）が生成される。

- [ ] **Step 2: 公開鍵の内容を確認**

  ```bash
  cat ~/.ssh/id_ed25519_trepo.pub
  ```

  `ssh-ed25519 AAAA...` で始まる1行が表示される。この内容をコピーしておく。

- [ ] **Step 3: XserverパネルでSSHアクセスを有効化**

  Xserverサーバーパネル → 「アカウント」→「SSH設定」→ 「SSHアクセス」を「ON」に切り替えて「設定する」をクリック。

- [ ] **Step 4: 公開鍵を Xserver に登録**

  SSH設定画面の「公開鍵登録・更新」タブ → テキストボックスに Step 2 でコピーした公開鍵を貼り付け → 「公開鍵を登録する」。

- [ ] **Step 5: ~/.ssh/config に接続情報を追加**

  `~/.ssh/config` に以下を追記する（`buzzreach` を実際のサーバーIDに置き換える）:

  ```
  Host xserver-trepo
    HostName buzzreach.xsrv.jp
    User buzzreach
    Port 10022
    IdentityFile ~/.ssh/id_ed25519_trepo
    ServerAliveInterval 60
  ```

- [ ] **Step 6: SSH接続テスト**

  ```bash
  ssh xserver-trepo "echo SSH接続成功"
  ```

  期待出力: `SSH接続成功`

  接続できない場合はXserverのSSH設定反映に数分かかるため、5分待って再試行する。

---

### Task 5: Claude Code の SSH 権限を設定する

**Files:**
- Modify: `/Users/yuttyo/claude/creativegroup-dashboard/.claude/settings.local.json`

- [ ] **Step 1: 現在の settings.local.json を確認**

  ```bash
  cat /Users/yuttyo/claude/creativegroup-dashboard/.claude/settings.local.json
  ```

- [ ] **Step 2: SSH・SFTPコマンドの許可を追加**

  `.claude/settings.local.json` の `permissions.allow` 配列に以下を追加する:

  ```json
  "Bash(ssh xserver-trepo*)",
  "Bash(sftp*)",
  "Bash(scp*)",
  "Bash(ssh-keygen*)"
  ```

- [ ] **Step 3: 設定確認**

  Claude Code のセッションを再起動し、以下コマンドが許可なしで実行できることを確認する:

  ```bash
  ssh xserver-trepo "pwd"
  ```

  期待出力: `/home/buzzreach`

---

### Task 6: テーマファイルを確認し SSH ワークフローをテストする

**Files:** なし（確認のみ）

- [ ] **Step 1: WordPressテーマ名を確認**

  ```bash
  ssh xserver-trepo "ls /home/buzzreach/staging.trepo.jp/public_html/wp-content/themes/"
  ```

  有効テーマ名（例: `sango`, `lightning` 等）をメモする。以降 `snow-monkey` をこの値に置き換える。

- [ ] **Step 2: テーマのstyle.cssを確認**

  ```bash
  ssh xserver-trepo "head -20 /home/buzzreach/staging.trepo.jp/public_html/wp-content/themes/snow-monkey/style.css"
  ```

  テーマ名・バージョン等が表示されることを確認する。

- [ ] **Step 3: CSS編集テスト（ステージングのみ）**

  ステージングのテーマCSSにテスト用のコメントを追加する:

  ```bash
  ssh xserver-trepo "echo '/* Claude SSH test - $(date) */' >> /home/buzzreach/staging.trepo.jp/public_html/wp-content/themes/snow-monkey/style.css"
  ```

- [ ] **Step 4: ブラウザで確認**

  `https://staging.trepo.jp/` をリロードし、表示が崩れていないことを確認する。

- [ ] **Step 5: テスト用コメントを削除**

  ```bash
  ssh xserver-trepo "sed -i '$ d' /home/buzzreach/staging.trepo.jp/public_html/wp-content/themes/snow-monkey/style.css"
  ```

- [ ] **Step 6: コミット**

  ```bash
  git commit -m "feat: Xserver SSH接続設定完了・ステージング編集ワークフロー確認済み"
  ```

---

## Phase 3: SEO 技術改善

### Task 7: Rank Math で構造化データを設定する

**Files:** なし（WordPress管理画面の設定変更）

ステージングで設定・確認後、同じ手順を本番でも実施する。

- [ ] **Step 1: ステージングのRank Mathスキーマ設定を開く**

  `https://staging.trepo.jp/wp-admin/` → 左メニュー「Rank Math」→「一般設定」→「Schema（構造化データ）」タブ。

- [ ] **Step 2: Article スキーマを設定**

  - 「投稿タイプ」→「投稿」のスキーマタイプを「Article」に設定
  - Article Type: `BlogPosting`（ブログ記事の場合）に設定
  - 「保存」

- [ ] **Step 3: WebSite スキーマを設定**

  「Rank Math」→「一般設定」→「スニペット（Schema）」→ ホームページのスキーマタイプを「WebSite」に設定して保存。

- [ ] **Step 4: BreadcrumbList を有効化**

  「Rank Math」→「一般設定」→「パンくずリスト（Breadcrumbs）」→「パンくずリストを有効化」をON → 保存。

- [ ] **Step 5: 構造化データをテスト**

  Googleのリッチリザルトテストツール（`https://search.google.com/test/rich-results`）を開き、`https://staging.trepo.jp/beauty/212946/` を入力して検索 → `Article` スキーマが検出されることを確認する。

- [ ] **Step 6: 本番に同じ設定を適用**

  `https://trepo.jp/wp-admin/` で Step 2〜4 と同じ設定を行う。

  本番での確認: `https://search.google.com/test/rich-results` で `https://trepo.jp/beauty/212946/` を検証する。

---

### Task 8: Rank Math でタイトルと meta description を最適化する

**Files:** なし（WordPress管理画面の設定変更）

- [ ] **Step 1: タイトルテンプレートを設定（ステージング）**

  「Rank Math」→「タイトルとメタ」→「投稿」→ タイトルテンプレートを以下に変更:

  ```
  %title% | Trepo（トレポ）
  ```

- [ ] **Step 2: カテゴリページのタイトルを設定**

  同画面の「カテゴリ」タブ → タイトルテンプレート:

  ```
  %term% の記事一覧 | Trepo（トレポ）
  ```

- [ ] **Step 3: 著者アーカイブページを設定**

  「ユーザー」タブ → タイトルテンプレート:

  ```
  %name% の記事一覧 | Trepo（トレポ）
  ```

  Descriptionテンプレート:

  ```
  %name% がTrepo（トレポ）に書いた記事の一覧です。
  ```

- [ ] **Step 4: ホームページの meta description を設定**

  「Rank Math」→「タイトルとメタ」→「ホームページ」→ Meta Descriptionに以下を入力（100〜160文字）:

  ```
  Trepo（トレポ）は、グルメ・ファッション・美容・旅行・ライフスタイルなど、女性の日常をもっと楽しくする情報メディアです。インターン生ライターが体験・取材をもとにリアルな情報をお届けします。
  ```

- [ ] **Step 5: ステージングで確認**

  `https://staging.trepo.jp/` のHTMLソースで `<title>` と `<meta name="description"` タグが意図通りに出力されていることを確認する。

- [ ] **Step 6: 本番に適用**

  `https://trepo.jp/wp-admin/` で Step 1〜4 を同様に設定する。

---

### Task 9: OGP と Twitter Card を設定する

**Files:** なし（WordPress管理画面の設定変更）

- [ ] **Step 1: ソーシャル設定を開く（ステージング）**

  「Rank Math」→「一般設定」→「ソーシャルメタ（Social Meta）」→ Facebookタブ。

- [ ] **Step 2: OGP デフォルト画像を設定**

  「デフォルトの Facebook サムネイル」に trepo.jp のOGP用デフォルト画像（1200×630px）をアップロードして設定する。

  ※ 画像がなければ `https://trepo.jp/wp-content/uploads/` から既存のアイキャッチ画像を流用する。

- [ ] **Step 3: Twitter Card を有効化**

  Twitterタブ → 「Twitter カードのメタを使用」をON → カードタイプを「サマリー（大きな画像）」に設定 → 保存。

- [ ] **Step 4: OGP をテスト**

  `https://developers.facebook.com/tools/debug/` を開き、`https://staging.trepo.jp/beauty/212946/` を入力して「デバッグ」→ `og:title`・`og:description`・`og:image` が正しく表示されることを確認する。

- [ ] **Step 5: 本番に適用**

  `https://trepo.jp/wp-admin/` で Step 1〜3 を同様に設定する。

---

### Task 10: 著者ページの E-E-A-T を強化する

**Files:**
- Modify（SSH）: `/home/buzzreach/staging.trepo.jp/public_html/wp-content/themes/snow-monkey/author.php` または対応するテンプレートファイル

- [ ] **Step 1: 著者テンプレートを確認**

  ```bash
  ssh xserver-trepo "ls /home/buzzreach/staging.trepo.jp/public_html/wp-content/themes/snow-monkey/ | grep -i author"
  ```

  `author.php` が存在しない場合は `archive.php` または `index.php` が使われている。

- [ ] **Step 2: 各ライターのプロフィールを更新（WP管理画面）**

  `https://staging.trepo.jp/wp-admin/users.php` → 各ユーザーの「編集」→ 以下を入力:
  - 「プロフィール情報」: 経歴・専門分野（50〜100文字）
  - 「ウェブサイト」: InstagramまたはTwitter/XのURL

  ライター1名分を試験的に入力してステージングで著者ページ（例: `https://staging.trepo.jp/author/{ユーザー名}/`）を確認する。

- [ ] **Step 3: 著者ページにSNSリンクを表示するコードを追加**

  著者テンプレートファイルに以下のPHPスニペットを追加する（`author.php` の著者情報表示部分に挿入）:

  ```php
  <?php
  $author_url = get_the_author_meta('url');
  if ($author_url) : ?>
    <a href="<?php echo esc_url($author_url); ?>" target="_blank" rel="noopener noreferrer">
      SNS プロフィール
    </a>
  <?php endif; ?>
  ```

  SSHで直接編集する場合:

  ```bash
  ssh xserver-trepo "cat /home/buzzreach/staging.trepo.jp/public_html/wp-content/themes/snow-monkey/author.php"
  ```

  ファイルの内容を確認してから、Claudeが適切な箇所に追記する。

- [ ] **Step 4: ステージングで確認**

  `https://staging.trepo.jp/author/{ユーザー名}/` を開き、プロフィール文とSNSリンクが表示されることを確認する。

- [ ] **Step 5: 本番に適用**

  SSH で同じコードを本番テーマに適用する:

  ```bash
  ssh xserver-trepo "cat /home/buzzreach/trepo.jp/public_html/wp-content/themes/snow-monkey/author.php"
  ```

  内容を確認後、ステージングと同じ変更を加える。

- [ ] **Step 6: コミット**

  ```bash
  git commit -m "feat: 著者ページE-E-A-T強化・SNSリンク追加"
  ```

---

### Task 11: 画像 alt 属性の未設定状況を確認する

**Files:**
- Create: `docs/trepo-media-alt-audit.txt`（確認結果の記録）

- [ ] **Step 1: alt未設定画像数をDBで確認**

  SSHでWordPressのDBに接続して確認する:

  ```bash
  ssh xserver-trepo "mysql -u{DB_USER} -p{DB_PASS} {DB_NAME} -e \"SELECT COUNT(*) as total_images, SUM(CASE WHEN meta_value = '' OR meta_value IS NULL THEN 1 ELSE 0 END) as missing_alt FROM wp_postmeta WHERE meta_key = '_wp_attachment_image_alt';\""
  ```

  結果をメモして、alt未設定の画像数を把握する。

- [ ] **Step 2: アイキャッチ画像のalt未設定を確認**

  ```bash
  ssh xserver-trepo "mysql -u{DB_USER} -p{DB_PASS} {DB_NAME} -e \"SELECT p.ID, p.post_title FROM wp_posts p LEFT JOIN wp_postmeta m ON p.ID = m.post_id AND m.meta_key = '_wp_attachment_image_alt' WHERE p.post_type = 'attachment' AND p.post_mime_type LIKE 'image/%' AND (m.meta_value IS NULL OR m.meta_value = '') LIMIT 20;\""
  ```

- [ ] **Step 3: 優先修正リストを作成**

  alt未設定のアイキャッチ画像を `https://trepo.jp/wp-admin/upload.php` で開き、「代替テキスト」を入力して順次修正する（週10件を目安に継続）。

- [ ] **Step 4: 新規記事ガイドラインにaltルールを追記**

  後述の Task 14（ライター向けガイドライン）にalt属性ルールを含める。

---

## Phase 4: AI 検索最適化

### Task 12: 要約ボックスショートコードをステージングに実装する

**Files:**
- Modify（SSH）: `/home/buzzreach/staging.trepo.jp/public_html/wp-content/themes/snow-monkey/functions.php`

- [ ] **Step 1: ステージングのfunctions.phpに追記**

  > ⚠️ functions.php の末尾に `?>` がある場合は先に削除してから追記すること。`?>` の後にPHPコードを追加しても実行されない。確認方法: `ssh xserver-trepo "tail -3 /home/buzzreach/staging.trepo.jp/public_html/wp-content/themes/snow-monkey/functions.php"`

  ```bash
  ssh xserver-trepo "cat >> /home/buzzreach/staging.trepo.jp/public_html/wp-content/themes/snow-monkey/functions.php" << 'EOF'

  // Trepo 要約ボックス ショートコード
  function trepo_summary_box( $atts, $content = null ) {
      $atts = shortcode_atts( array(
          'title' => 'この記事でわかること',
      ), $atts );
      $title   = esc_html( $atts['title'] );
      $content = do_shortcode( wp_kses_post( $content ) );
      return '<div class="trepo-summary-box" role="note">'
           . '<p class="trepo-summary-box__title">' . $title . '</p>'
           . '<div class="trepo-summary-box__content">' . $content . '</div>'
           . '</div>';
  }
  add_shortcode( 'summary', 'trepo_summary_box' );
  EOF
  ```

- [ ] **Step 2: 要約ボックスのCSSをステージングに追加**

  ```bash
  ssh xserver-trepo "cat >> /home/buzzreach/staging.trepo.jp/public_html/wp-content/themes/snow-monkey/style.css" << 'EOF'

  /* Trepo 要約ボックス */
  .trepo-summary-box {
    background: #f8f4ff;
    border-left: 4px solid #9333ea;
    border-radius: 8px;
    padding: 16px 20px;
    margin: 24px 0 32px;
  }
  .trepo-summary-box__title {
    font-weight: 700;
    color: #9333ea;
    margin: 0 0 10px;
    font-size: 14px;
    letter-spacing: 0.02em;
  }
  .trepo-summary-box__content ul {
    margin: 0;
    padding-left: 20px;
  }
  .trepo-summary-box__content li {
    margin-bottom: 6px;
    font-size: 14px;
    line-height: 1.6;
  }
  EOF
  ```

- [ ] **Step 3: ステージングの記事でショートコードをテスト**

  `https://staging.trepo.jp/wp-admin/post.php?action=edit&post={任意の記事ID}` を開き、本文に以下を挿入して「更新」:

  ```
  [summary]
  <ul>
  <li>このショートコードが要約ボックスとして表示される</li>
  <li>紫色のボーダーとタイトルが表示される</li>
  </ul>
  [/summary]
  ```

- [ ] **Step 4: ブラウザで確認**

  該当記事をステージングで開き、要約ボックスが正しくデザイン表示されることを確認する。スマホ表示も確認する（Chrome DevTools → モバイルビュー）。

- [ ] **Step 5: 本番に適用**

  ステージングで確認後、同じコードを本番テーマに適用する:

  ```bash
  ssh xserver-trepo "cat >> /home/buzzreach/trepo.jp/public_html/wp-content/themes/snow-monkey/functions.php" << 'EOF'
  [Step 1と同じコードを貼る]
  EOF
  ```

  ```bash
  ssh xserver-trepo "cat >> /home/buzzreach/trepo.jp/public_html/wp-content/themes/snow-monkey/style.css" << 'EOF'
  [Step 2と同じコードを貼る]
  EOF
  ```

- [ ] **Step 6: コミット**

  ```bash
  git commit -m "feat: 要約ボックスショートコード [summary] を追加"
  ```

---

### Task 13: Rank Math FAQ ブロックを設定する

**Files:** なし（WordPress管理画面の設定変更）

- [ ] **Step 1: FAQ設定を確認（ステージング）**

  `https://staging.trepo.jp/wp-admin/` → 「Rank Math」→「一般設定」→「Schema（構造化データ）」→「FAQページ」スキーマが有効になっていることを確認する。有効でなければONにして保存。

- [ ] **Step 2: テスト記事にFAQブロックを追加**

  任意の記事の編集画面を開き、ブロックエディターで「+」→「Rank Math FAQ Block」を追加する（「FAQ」で検索）。

  以下の形式で質問と回答を入力:
  - 質問: `{記事テーマ}とは何ですか？`
  - 回答: 記事の内容をもとに2〜3文で回答

- [ ] **Step 3: FAQ スキーマをテスト**

  `https://search.google.com/test/rich-results` で該当記事のURLを検証 → `FAQPage` スキーマが検出されることを確認する。

- [ ] **Step 4: 本番ライターへの展開方針を決める**

  新規・更新記事にFAQブロックを追加するルールをTask 14のガイドラインに記載する。

---

### Task 14: ライター向けコンテンツガイドラインを作成する

**Files:**
- Create: `docs/trepo-writer-guideline-ai-seo.md`

- [ ] **Step 1: ガイドラインファイルを作成**

  ```bash
  mkdir -p /Users/yuttyo/claude/creativegroup-dashboard/docs
  ```

  以下の内容で `docs/trepo-writer-guideline-ai-seo.md` を作成する:

  ````markdown
  # Trepo ライター向け記事作成ガイドライン（SEO・AI検索対応）

  ## なぜこのガイドラインが必要か
  GoogleやChatGPT・Perplexityなどのリサーチ系AIは、「直接・明確に答えている記事」を優先して引用します。
  このガイドラインに従うことで、検索結果での上位表示とAI引用の両方を狙えます。

  ---

  ## 記事構成ルール

  ### 1. 記事冒頭に要約ボックスを入れる
  投稿ページの本文先頭に以下のショートコードを使って「この記事でわかること」を書く（3〜5点）。

  ```
  [summary]
  <ul>
  <li>〇〇の特徴と使い方がわかる</li>
  <li>〇〇を選ぶときのポイント3つ</li>
  <li>実際に使ってみた正直レビュー</li>
  </ul>
  [/summary]
  ```

  ### 2. h2の直下に結論を書く（結論ファースト）
  ❌ 悪い例: h2「〇〇の選び方」→ 長い前置き → 最後に結論
  ✅ 良い例: h2「〇〇の選び方」→ 1文目に「ポイントは◯◯・◯◯・◯◯の3つです」→ 詳細説明

  ### 3. 見出しに検索キーワードを含める
  ❌ 悪い例: h2「実際に使ってみました」
  ✅ 良い例: h2「【実食レビュー】〇〇は本当においしいか？カロリー・価格も解説」

  ### 4. 比較・ランキングはリスト形式で
  テキストで「AはBよりよくて〜」と書くより、箇条書きや表で整理する方がAIに引用されやすい。

  ### 5. 数字・固有名詞を積極的に使う
  ❌「安い」→ ✅「税込980円」
  ❌「人気がある」→ ✅「Instagramいいね数1,000超え」

  ---

  ## FAQ の追加ルール

  記事の末尾に「よくある質問」セクションをRank Math FAQブロックで追加する。
  最低2問、最大5問。形式は以下:
  - 「〇〇とは何ですか？」→ 記事の主題をひとことで説明
  - 「〇〇はどこで買えますか？」→ 購入場所・価格を明記
  - 「〇〇の注意点は？」→ ネガティブ情報も正直に

  ---

  ## 画像のルール

  すべての画像に**alt属性（代替テキスト）**を入力する。
  - アイキャッチ画像: 「{記事タイトルの要約} - Trepo」
  - 商品画像: 「{ブランド名} {商品名}」
  - 人物写真: 「{ライター名} が {場所・状況} で撮影した写真」

  ---

  ## 新規スラッグルール

  2026年6月以降の新規記事は、数字IDではなく日本語の内容を表す英語スラッグを設定する。
  - ❌ `/beauty/253728/`
  - ✅ `/beauty/korean-skincare-review-2026/`

  設定場所: 記事編集画面右側の「パーマリンク」欄
  ````

- [ ] **Step 2: ガイドラインをコミット**

  ```bash
  git add docs/trepo-writer-guideline-ai-seo.md
  git commit -m "docs: Trepoライター向けSEO・AI検索対応ガイドライン追加"
  ```

- [ ] **Step 3: Notionまたは社内共有ツールに転記**

  ガイドラインをライターが読めるNotionページやGoogleドキュメントに転記し、全ライターに共有する。

---

## 効果測定チェックリスト（月次）

毎月月初に以下を確認する:

- [ ] Google Search Console → 「検索パフォーマンス」でクリック数・表示回数の推移を確認
- [ ] Google Search Console → 「リッチリザルト」でArticle・FAQスキーマのエラーがないか確認
- [ ] `https://search.google.com/test/rich-results` で代表記事3本を検証
- [ ] Perplexity で「trepo {主要カテゴリキーワード}」と検索し、引用されているか確認
- [ ] GA4 でオーガニック流入数の前月比を確認
