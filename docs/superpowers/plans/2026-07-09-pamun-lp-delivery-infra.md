# Pamun LP 制作・配信基盤（①）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 広告の受け皿となるキャンペーンLPを、Claude指示で高速に作成・改善できるよう、Astro製の日本語+韓国語LPを `stg.pamun.jp`（Xserver staging）→ `pamun.jp/<slug>/`（Xserver本番・WP共存）へ自動デプロイするパイプラインを構築する。

**Architecture:** 新規専用リポジトリ `pamun-lp` に Astro + 組込みi18n（ja=ルート, ko=/ko/）でLPを実装。完全静的ビルドを GitHub Actions が SSH鍵で Xserver に rsync する。本番はWordPressルート配下の物理サブディレクトリに配置し（WPの`.htaccess`は実在dirを書き換えないため衝突しない）、stagingは同一Xserver上のサブドメインに置く。Firebase/GCPは①では使わない。

**Tech Stack:** Astro（静的サイト）/ Astro built-in i18n / Node.js組込みテストランナー（`node --test`）/ GitHub Actions / rsync over SSH / Xserver

**親仕様書:** [① Pamun LP 制作・配信基盤 設計書](../specs/2026-07-09-pamun-lp-delivery-infra-design.md)

---

## 前提と規約

- **新規リポジトリ**: このプランは `creativegroup-dashboard` とは別の新規リポジトリ `pamun-lp` を作る。以下のパスはすべて `pamun-lp/` リポジトリのルート基準。
- **slug（本番の公開パス）**: 本プランでは具体化のため既定値 `monitor`（本番URL = `https://pamun.jp/monitor/`）を使う。変更は `astro.config.mjs` の `PROD_BASE` 環境変数のみで完結する。
- **ロケール**: `ja`（デフォルト・ルート配信）/ `ko`（`/ko/` 配信）。将来 `en` 等を足せる構造にする。
- **コミット**: 各タスク末尾でコミット。コミットメッセージ末尾に必ず以下を付ける。
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  ```

---

## 👤 Task 0: 人間側の事前準備（山口さん作業・コード不要）

このタスクはコードではなく、山口さんがWeb管理画面で行う準備。完了後にチェックを入れる。以降のCIタスクはこれが揃っていることが前提。

- [ ] **Step 1: GitHub に空の新規リポジトリ `pamun-lp` を作成**（private推奨、READMEなしで作成）

- [ ] **Step 2: Xserver で SSH を有効化し鍵を用意**
  - Xserverサーバーパネル →「SSH設定」→ ONにする
  - 公開鍵登録方式にする（GitHub Actions用の鍵ペアをローカルで生成: `ssh-keygen -t ed25519 -C "pamun-lp-ci" -f ~/.ssh/pamun_lp_ci`）
  - 生成した公開鍵 `~/.ssh/pamun_lp_ci.pub` をXserverの「公開鍵登録・設定」に登録
  - SSH接続情報を控える: ホスト名（例 `svXXXX.xserver.jp`）／ユーザー名（サーバーID）／ポート `10022`

- [ ] **Step 3: `stg.pamun.jp` サブドメインを作成**
  - Xserverパネル →「サブドメイン設定」→ `stg.pamun.jp` を追加
  - 生成されるドキュメントルート（通常 `/home/<serverID>/pamun.jp/public_html/stg/`）を控える
  - 本番LPのドキュメントルートは `/home/<serverID>/pamun.jp/public_html/monitor/`（CIが自動作成するので手動作成不要）

- [ ] **Step 4: GitHub リポジトリに Secrets を登録**（Settings → Secrets and variables → Actions）
  - `SSH_PRIVATE_KEY`: `~/.ssh/pamun_lp_ci` の中身（秘密鍵）
  - `SSH_HOST`: Xserverホスト名（例 `svXXXX.xserver.jp`）
  - `SSH_USER`: XserverサーバーID
  - `SSH_PORT`: `10022`
  - `REMOTE_STG_PATH`: `/home/<serverID>/pamun.jp/public_html/stg/`
  - `REMOTE_PROD_PATH`: `/home/<serverID>/pamun.jp/public_html/monitor/`

- [ ] **Step 5: 完了確認**
  - ローカルから `ssh -p 10022 <serverID>@<host> -i ~/.ssh/pamun_lp_ci "pwd"` が成功することを確認

---

## Task 1: Astro プロジェクト雛形の作成

**Files:**
- Create: `package.json`, `astro.config.mjs`, `tsconfig.json`, `.gitignore`, `src/pages/index.astro`

- [ ] **Step 1: Astro を最小構成で初期化**

Run:
```bash
npm create astro@latest . -- --template minimal --no-install --no-git --yes
npm install
```
Expected: `src/pages/index.astro` 等が生成され、`npm install` が成功する。

- [ ] **Step 2: `.gitignore` に成果物とローカル鍵を追加**

`.gitignore` に以下が含まれることを確認（なければ追記）:
```
dist/
node_modules/
.astro/
*.log
.DS_Store
```

- [ ] **Step 3: ビルドが通ることを確認**

Run: `npm run build`
Expected: `dist/index.html` が生成され、エラーなく完了する。

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: scaffold Astro minimal project

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: i18n と base path の設定

**Files:**
- Modify: `astro.config.mjs`

- [ ] **Step 1: `astro.config.mjs` を i18n + 環境切替 base に書き換え**

`astro.config.mjs` を以下の内容にする:
```js
import { defineConfig } from 'astro/config';

// DEPLOY_TARGET=prod のとき本番slug配下、それ以外(stg/local)はルート配信
const isProd = process.env.DEPLOY_TARGET === 'prod';
const PROD_BASE = process.env.PROD_BASE || '/monitor/';

export default defineConfig({
  site: 'https://pamun.jp',
  base: isProd ? PROD_BASE : '/',
  trailingSlash: 'always',
  i18n: {
    defaultLocale: 'ja',
    locales: ['ja', 'ko'],
    routing: {
      prefixDefaultLocale: false, // ja はルート、ko は /ko/
    },
  },
});
```

- [ ] **Step 2: 本番ビルドで base が効くことを確認**

Run: `DEPLOY_TARGET=prod npm run build`
Expected: `dist/index.html` 内の生成アセットURLが `/monitor/` 始まりになっている（次タスクのテストで自動検証する）。

- [ ] **Step 3: Commit**

```bash
git add astro.config.mjs
git commit -m "feat: configure Astro i18n (ja/ko) and env-based base path

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: 翻訳辞書と i18n ヘルパ

**Files:**
- Create: `src/i18n/ja.json`, `src/i18n/ko.json`, `src/i18n/ui.ts`

- [ ] **Step 1: 日本語辞書 `src/i18n/ja.json`**

```json
{
  "meta.title": "Pamun｜発売前から、売れる理由をつくる",
  "meta.description": "美容ブランドのための口コミ・UGCマーケティング。サクラなしのリアルな口コミで、発売前から売れる理由をつくります。",
  "hero.headline": "発売前から、売れる理由をつくる",
  "hero.sub": "美容ブランドのための口コミ・UGCマーケティング",
  "hero.cta": "資料をダウンロード",
  "solutions.title": "Pamunが選ばれる4つの理由",
  "solutions.item1": "サクラなしのリアルな口コミ",
  "solutions.item2": "大規模なシーディング",
  "solutions.item3": "インサイトへの転換",
  "solutions.item4": "資産として再利用できる",
  "faq.title": "よくある質問",
  "faq.q1": "サクラや自作自演の口コミではないですか？",
  "faq.a1": "実際に商品を使ったモニターによるリアルな口コミのみを扱います。",
  "cta.headline": "まずは資料をご覧ください",
  "cta.button": "資料をダウンロード"
}
```

- [ ] **Step 2: 韓国語辞書 `src/i18n/ko.json`**

```json
{
  "meta.title": "Pamun｜출시 전부터, 팔리는 이유를 만듭니다",
  "meta.description": "뷰티 브랜드를 위한 입소문·UGC 마케팅. 조작 없는 진짜 입소문으로 출시 전부터 팔리는 이유를 만듭니다.",
  "hero.headline": "출시 전부터, 팔리는 이유를 만듭니다",
  "hero.sub": "뷰티 브랜드를 위한 입소문·UGC 마케팅",
  "hero.cta": "자료 다운로드",
  "solutions.title": "Pamun이 선택받는 4가지 이유",
  "solutions.item1": "조작 없는 진짜 입소문",
  "solutions.item2": "대규모 시딩",
  "solutions.item3": "인사이트로의 전환",
  "solutions.item4": "자산으로 재사용 가능",
  "faq.title": "자주 묻는 질문",
  "faq.q1": "조작이나 자작 후기가 아닌가요?",
  "faq.a1": "실제로 제품을 사용한 모니터의 진짜 후기만 다룹니다.",
  "cta.headline": "먼저 자료를 확인해 보세요",
  "cta.button": "자료 다운로드"
}
```

- [ ] **Step 3: i18nヘルパ `src/i18n/ui.ts`**

```ts
import ja from './ja.json';
import ko from './ko.json';

export const languages = { ja: '日本語', ko: '한국어' } as const;
export type Locale = keyof typeof languages;
export const defaultLocale: Locale = 'ja';

const dictionaries: Record<Locale, Record<string, string>> = { ja, ko };

/** ロケール別の翻訳取得関数を返す。キーが無ければ ja にフォールバック。 */
export function useTranslations(locale: Locale) {
  return function t(key: string): string {
    return dictionaries[locale][key] ?? dictionaries[defaultLocale][key] ?? key;
  };
}

/** 韓国向けだけセクションを差し替えたい場合の判定に使う（柔軟設計の土台）。 */
export function isLocale(value: string): value is Locale {
  return value === 'ja' || value === 'ko';
}
```

- [ ] **Step 4: `tsconfig.json` で JSON import を許可**

`tsconfig.json` の `compilerOptions` に以下が含まれることを確認（なければ追記）:
```json
{
  "compilerOptions": {
    "resolveJsonModule": true,
    "esModuleInterop": true
  }
}
```

- [ ] **Step 5: 型チェックが通ることを確認**

Run: `npx astro check --minimal 2>/dev/null || npx tsc --noEmit`
Expected: `src/i18n/*` に型エラーが無い（ページ未作成の警告は次タスクで解消）。

- [ ] **Step 6: Commit**

```bash
git add src/i18n tsconfig.json
git commit -m "feat: add ja/ko translation dictionaries and i18n helper

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: 共通レイアウト（hreflang・言語切替・GTM挿入口）

**Files:**
- Create: `src/layouts/BaseLayout.astro`, `src/styles/tokens.css`

- [ ] **Step 1: ブランドトークン `src/styles/tokens.css`**

```css
:root {
  --color-bg: #ffffff;
  --color-text: #222222;
  --color-accent: #e5567b;
  --color-muted: #666666;
  --font-ja: "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif;
  --font-ko: "Noto Sans KR", "Malgun Gothic", sans-serif;
  --maxw: 960px;
}
* { box-sizing: border-box; }
body { margin: 0; color: var(--color-text); background: var(--color-bg); line-height: 1.7; }
:lang(ko) { font-family: var(--font-ko); }
:lang(ja) { font-family: var(--font-ja); }
.container { max-width: var(--maxw); margin: 0 auto; padding: 0 20px; }
```

- [ ] **Step 2: `src/layouts/BaseLayout.astro`**

```astro
---
import '../styles/tokens.css';
import { useTranslations, languages, type Locale } from '../i18n/ui';

interface Props { locale: Locale; }
const { locale } = Astro.props;
const t = useTranslations(locale);

// GTMコンテナIDは②計測基盤で設定。未設定なら挿入しない。
const GTM_ID = import.meta.env.PUBLIC_GTM_ID;

// hreflang 用の相互リンク（ja=ルート, ko=/ko/）
const base = import.meta.env.BASE_URL; // '/monitor/' or '/'
const alt = {
  ja: base,
  ko: `${base}ko/`,
};
---
<!doctype html>
<html lang={locale}>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{t('meta.title')}</title>
    <meta name="description" content={t('meta.description')} />
    <link rel="alternate" hreflang="ja" href={new URL(alt.ja, Astro.site)} />
    <link rel="alternate" hreflang="ko" href={new URL(alt.ko, Astro.site)} />
    <link rel="alternate" hreflang="x-default" href={new URL(alt.ja, Astro.site)} />
    {GTM_ID && (
      <script is:inline set:html={`(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${GTM_ID}');`} />
    )}
  </head>
  <body>
    <header class="container" style="display:flex;justify-content:flex-end;gap:12px;padding-top:16px;">
      {Object.entries(languages).map(([code, label]) => (
        <a href={code === 'ja' ? base : `${base}${code}/`} hreflang={code} style={`color:${code===locale?'var(--color-accent)':'var(--color-muted)'};text-decoration:none;`}>{label}</a>
      ))}
    </header>
    <main>
      <slot />
    </main>
    <footer class="container" style="padding:40px 20px;color:var(--color-muted);font-size:13px;">
      © {new Date().getFullYear()} Creative Group — Pamun
    </footer>
  </body>
</html>
```

- [ ] **Step 3: Commit**

```bash
git add src/layouts src/styles
git commit -m "feat: add BaseLayout with hreflang, language switcher, and GTM slot

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: 再利用LPコンポーネント

**Files:**
- Create: `src/components/Hero.astro`, `src/components/Solutions.astro`, `src/components/Faq.astro`, `src/components/CtaButton.astro`

- [ ] **Step 1: `src/components/CtaButton.astro`**

```astro
---
interface Props { label: string; href?: string; }
const { label, href = '#contact' } = Astro.props;
---
<a href={href} style="display:inline-block;background:var(--color-accent);color:#fff;padding:14px 32px;border-radius:999px;text-decoration:none;font-weight:700;">{label}</a>
```

- [ ] **Step 2: `src/components/Hero.astro`**

```astro
---
import CtaButton from './CtaButton.astro';
interface Props { headline: string; sub: string; cta: string; }
const { headline, sub, cta } = Astro.props;
---
<section style="padding:64px 0;text-align:center;background:linear-gradient(180deg,#fff0f4,#fff);">
  <div class="container">
    <h1 style="font-size:2rem;margin:0 0 12px;">{headline}</h1>
    <p style="color:var(--color-muted);margin:0 0 28px;">{sub}</p>
    <CtaButton label={cta} />
  </div>
</section>
```

- [ ] **Step 3: `src/components/Solutions.astro`**

```astro
---
interface Props { title: string; items: string[]; }
const { title, items } = Astro.props;
---
<section style="padding:56px 0;">
  <div class="container">
    <h2 style="text-align:center;margin:0 0 32px;">{title}</h2>
    <ul style="list-style:none;padding:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;">
      {items.map((item) => (
        <li style="border:1px solid #eee;border-radius:12px;padding:20px;text-align:center;">{item}</li>
      ))}
    </ul>
  </div>
</section>
```

- [ ] **Step 4: `src/components/Faq.astro`**

```astro
---
interface Props { title: string; qas: { q: string; a: string }[]; }
const { title, qas } = Astro.props;
---
<section style="padding:56px 0;background:#fafafa;">
  <div class="container">
    <h2 style="text-align:center;margin:0 0 32px;">{title}</h2>
    {qas.map(({ q, a }) => (
      <details style="border-bottom:1px solid #eee;padding:14px 0;">
        <summary style="cursor:pointer;font-weight:700;">{q}</summary>
        <p style="color:var(--color-muted);margin:10px 0 0;">{a}</p>
      </details>
    ))}
  </div>
</section>
```

- [ ] **Step 5: Commit**

```bash
git add src/components
git commit -m "feat: add reusable LP components (Hero, Solutions, Faq, CtaButton)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: 日本語・韓国語のLPページ

**Files:**
- Modify: `src/pages/index.astro`
- Create: `src/pages/ko/index.astro`

- [ ] **Step 1: `src/pages/index.astro`（ja）を実装**

```astro
---
import BaseLayout from '../layouts/BaseLayout.astro';
import Hero from '../components/Hero.astro';
import Solutions from '../components/Solutions.astro';
import Faq from '../components/Faq.astro';
import CtaButton from '../components/CtaButton.astro';
import { useTranslations } from '../i18n/ui';
const t = useTranslations('ja');
---
<BaseLayout locale="ja">
  <Hero headline={t('hero.headline')} sub={t('hero.sub')} cta={t('hero.cta')} />
  <Solutions title={t('solutions.title')} items={[t('solutions.item1'), t('solutions.item2'), t('solutions.item3'), t('solutions.item4')]} />
  <Faq title={t('faq.title')} qas={[{ q: t('faq.q1'), a: t('faq.a1') }]} />
  <section id="contact" style="padding:64px 0;text-align:center;">
    <div class="container">
      <h2 style="margin:0 0 24px;">{t('cta.headline')}</h2>
      <CtaButton label={t('cta.button')} />
    </div>
  </section>
</BaseLayout>
```

- [ ] **Step 2: `src/pages/ko/index.astro`（ko）を実装**

```astro
---
import BaseLayout from '../../layouts/BaseLayout.astro';
import Hero from '../../components/Hero.astro';
import Solutions from '../../components/Solutions.astro';
import Faq from '../../components/Faq.astro';
import CtaButton from '../../components/CtaButton.astro';
import { useTranslations } from '../../i18n/ui';
const t = useTranslations('ko');
---
<BaseLayout locale="ko">
  <Hero headline={t('hero.headline')} sub={t('hero.sub')} cta={t('hero.cta')} />
  <Solutions title={t('solutions.title')} items={[t('solutions.item1'), t('solutions.item2'), t('solutions.item3'), t('solutions.item4')]} />
  <Faq title={t('faq.title')} qas={[{ q: t('faq.q1'), a: t('faq.a1') }]} />
  <section id="contact" style="padding:64px 0;text-align:center;">
    <div class="container">
      <h2 style="margin:0 0 24px;">{t('cta.headline')}</h2>
      <CtaButton label={t('cta.button')} />
    </div>
  </section>
</BaseLayout>
```

- [ ] **Step 3: 両ロケールがビルドされることを確認**

Run: `npm run build`
Expected: `dist/index.html`（ja）と `dist/ko/index.html`（ko）が生成される。

- [ ] **Step 4: Commit**

```bash
git add src/pages
git commit -m "feat: add bilingual (ja/ko) campaign LP pages

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: ビルド成果物の自動検証テスト

Astroに単体テストの標準はないため、生成された `dist/` を Node組込みテストランナーで検証する（追加依存なし）。

**Files:**
- Create: `test/dist.test.mjs`
- Modify: `package.json`（`scripts.test` 追加）

- [ ] **Step 1: 失敗するテストを書く `test/dist.test.mjs`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const base = process.env.DEPLOY_TARGET === 'prod' ? (process.env.PROD_BASE || '/monitor/') : '/';

test('ja page exists and has Japanese headline', () => {
  assert.ok(existsSync('dist/index.html'), 'dist/index.html が無い');
  const html = readFileSync('dist/index.html', 'utf8');
  assert.match(html, /発売前から、売れる理由をつくる/);
  assert.match(html, /<html lang="ja"/);
});

test('ko page exists and has Korean headline', () => {
  assert.ok(existsSync('dist/ko/index.html'), 'dist/ko/index.html が無い');
  const html = readFileSync('dist/ko/index.html', 'utf8');
  assert.match(html, /출시 전부터/);
  assert.match(html, /<html lang="ko"/);
});

test('hreflang alternates are present on ja page', () => {
  const html = readFileSync('dist/index.html', 'utf8');
  assert.match(html, /hreflang="ja"/);
  assert.match(html, /hreflang="ko"/);
  assert.match(html, /hreflang="x-default"/);
});

test('asset URLs honor the base path', () => {
  const html = readFileSync('dist/index.html', 'utf8');
  // base='/monitor/' のとき生成アセットは /monitor/_astro/... になる
  const assetMatch = html.match(/(?:href|src)="(\/[^"]*_astro\/[^"]+)"/);
  if (assetMatch) {
    assert.ok(assetMatch[1].startsWith(base), `asset ${assetMatch[1]} が base ${base} で始まらない`);
  }
});
```

- [ ] **Step 2: `package.json` にテストスクリプトを追加**

`package.json` の `scripts` に追記:
```json
{
  "scripts": {
    "test": "node --test test/"
  }
}
```

- [ ] **Step 3: staging想定（base=/）でテストが通ることを確認**

Run: `npm run build && npm test`
Expected: 4テストすべて PASS。

- [ ] **Step 4: 本番想定（base=/monitor/）でもテストが通ることを確認**

Run: `DEPLOY_TARGET=prod npm run build && DEPLOY_TARGET=prod npm test`
Expected: 4テストすべて PASS（アセットURLが `/monitor/` 始まり）。

- [ ] **Step 5: Commit**

```bash
git add test package.json
git commit -m "test: verify dist output for both locales, hreflang, and base path

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: GitHub Actions デプロイワークフロー

**Files:**
- Create: `.github/workflows/deploy.yml`

- [ ] **Step 1: `.github/workflows/deploy.yml` を作成**

```yaml
name: Deploy

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

concurrency:
  group: deploy-${{ github.ref }}
  cancel-in-progress: true

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm

      - run: npm ci

      # main 以外(PR等)は staging、main は 本番
      - name: Set deploy target
        id: target
        run: |
          if [ "${{ github.ref }}" = "refs/heads/main" ]; then
            echo "deploy_target=prod" >> "$GITHUB_OUTPUT"
            echo "remote_path=${{ secrets.REMOTE_PROD_PATH }}" >> "$GITHUB_OUTPUT"
          else
            echo "deploy_target=stg" >> "$GITHUB_OUTPUT"
            echo "remote_path=${{ secrets.REMOTE_STG_PATH }}" >> "$GITHUB_OUTPUT"
          fi

      - name: Build
        run: npm run build
        env:
          DEPLOY_TARGET: ${{ steps.target.outputs.deploy_target }}

      - name: Test dist
        run: npm test
        env:
          DEPLOY_TARGET: ${{ steps.target.outputs.deploy_target }}

      - name: Setup SSH
        run: |
          mkdir -p ~/.ssh
          echo "${{ secrets.SSH_PRIVATE_KEY }}" > ~/.ssh/id_ed25519
          chmod 600 ~/.ssh/id_ed25519
          ssh-keyscan -p ${{ secrets.SSH_PORT }} -H ${{ secrets.SSH_HOST }} >> ~/.ssh/known_hosts 2>/dev/null

      - name: Deploy via rsync
        run: |
          rsync -avz --delete \
            -e "ssh -p ${{ secrets.SSH_PORT }} -i ~/.ssh/id_ed25519" \
            dist/ \
            ${{ secrets.SSH_USER }}@${{ secrets.SSH_HOST }}:"${{ steps.target.outputs.remote_path }}"

      - name: Report URL
        run: |
          if [ "${{ steps.target.outputs.deploy_target }}" = "prod" ]; then
            echo "Deployed to https://pamun.jp/monitor/"
          else
            echo "Deployed to https://stg.pamun.jp/"
          fi
```

> ⚠️ 安全策: `--delete` は rsync のソース `dist/` とリモートの `remote_path` 配下のみを同期する。`remote_path` は必ずサブディレクトリ（`.../public_html/monitor/` や `.../public_html/stg/`）を指し、WordPress本体の `public_html/` ルートは絶対に指定しないこと。

- [ ] **Step 2: ワークフローYAMLの構文を確認**

Run: `npx --yes @action-validator/cli .github/workflows/deploy.yml 2>/dev/null || python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/deploy.yml')); print('YAML OK')"`
Expected: 構文エラーが無い（`YAML OK` もしくはバリデータがpass）。

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/deploy.yml
git commit -m "ci: add GitHub Actions deploy (PR->stg / main->prod) via rsync

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 9: README（セットアップ・運用手順）

**Files:**
- Create: `README.md`

- [ ] **Step 1: `README.md` を作成**

````markdown
# pamun-lp

Pamun のキャンペーンLP（Astro + i18n）。本番は Xserver の `pamun.jp/monitor/`、staging は `stg.pamun.jp`。

## 開発
```bash
npm install
npm run dev      # http://localhost:4321
npm run build    # dist/ を生成
npm test         # dist/ を検証
```

## ロケール
- 日本語: `/`（`src/pages/index.astro`）
- 韓国語: `/ko/`（`src/pages/ko/index.astro`）
- 文言は `src/i18n/ja.json` / `ko.json` を編集。韓国向けだけ差し替えたいセクションは `src/i18n/ui.ts` の仕組みで上書き可能。

## デプロイ
- PR作成/更新 → `stg.pamun.jp` に自動デプロイ
- main マージ → `pamun.jp/monitor/` に自動デプロイ
- 本番slug変更は `astro.config.mjs` の `PROD_BASE` と GitHub Secrets `REMOTE_PROD_PATH` を合わせて変更する。

## 必要な GitHub Secrets
`SSH_PRIVATE_KEY` / `SSH_HOST` / `SSH_USER` / `SSH_PORT` / `REMOTE_STG_PATH` / `REMOTE_PROD_PATH`

## 計測（②で設定）
`PUBLIC_GTM_ID` を環境変数で渡すと GTM スニペットが挿入される。
````

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add README with setup and deploy instructions

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 10: エンドツーエンドのパイプライン検証（人間協働）

Task 0 の準備と Task 1–9 の実装が揃った状態で、実際にパイプラインを通す。

- [ ] **Step 1: リモートを設定して push**

```bash
git remote add origin git@github.com:<org>/pamun-lp.git
git branch -M main
git push -u origin main
```
Expected: main への push で「本番デプロイ」ワークフローが起動する。

- [ ] **Step 2: 本番デプロイの成功を確認**

- GitHub Actions のログが緑（build/test/deploy すべて成功）
- ブラウザで `https://pamun.jp/monitor/`（ja）と `https://pamun.jp/monitor/ko/`（ko）が表示される
- アセット（CSS等）が404にならず正しく読み込まれる（base path確認）

- [ ] **Step 3: WordPress 本体に影響が無いことを確認**

- `https://pamun.jp/`（WPトップ）が従来どおり表示される
- WP管理画面 `https://pamun.jp/wp-admin/` にログインできる

- [ ] **Step 4: staging フローを確認**

```bash
git checkout -b test/stg-pipeline
# 例: src/i18n/ja.json の hero.sub を軽微に変更
git commit -am "test: tweak hero copy for stg verification

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push -u origin test/stg-pipeline
# GitHub上でPRを作成
```
Expected: PR作成で staging ワークフローが起動し、`https://stg.pamun.jp/` に変更が反映される。

- [ ] **Step 5: ①の完了確認（Definition of Done）**

設計書の完了条件をすべて満たすことを確認:
1. `pamun-lp` リポジトリ雛形（Astro+i18n+コンポーネント）✅
2. 日本語+韓国語の実LPが stg → 本番まで公開できる ✅
3. PR→stg / main→本番 が自動で動く ✅
4. Xserver 手順が README 化されている ✅
5. WordPress に影響なし ✅

---

## 完了後の次アクション
- サブプロジェクト **②計測・データ基盤**（GA4/GTM設置・広告媒体→BigQuery）のブレストへ。既に GA4→BigQuery export（`analytics_*` データセット）が稼働している点を起点にできる。
