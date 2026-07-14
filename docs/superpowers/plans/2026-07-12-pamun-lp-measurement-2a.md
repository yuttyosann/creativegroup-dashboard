# Pamun LP 計測基盤（②a）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新LP（pamun.jp/monitor/ ja・ko）に既存 `GTM-5KWRC39`/GA4 を載せ、「LP流入→CTA→フォーム送信CV」を GA4・BigQuery でファネル計測できる状態にする。

**Architecture:** LPを独立させず既存GA4プロパティ（`G-HR6XF36RCZ`/`273371278`、BQ export `analytics_273371278` 稼働中）に相乗り。LP(Astro)側は GTMスニペット搭載・CTAを実フォームへ送客・`lp_cta_click` を dataLayer push するだけ。GA4イベント転送とCF7の送信CV(`generate_lead`)は GTM-5KWRC39 コンテナ側で設定する。LP別分析は landing_page=`/monitor/*` で分離。

**Tech Stack:** Astro（静的）/ GTM(GTM-5KWRC39) / GA4(G-HR6XF36RCZ) / Contact Form 7(WordPress) / BigQuery / GitHub Actions

**親仕様書:** [② Pamun LP 計測基盤 設計書](../specs/2026-07-12-pamun-lp-measurement-2a-design.md)

---

## 前提と規約

- **実装リポジトリ**: `pamun-lp`（`~/claude/pamun-lp`）。パスはリポジトリルート基準。
- **CV送客先**: ja=`https://pamun.jp/document-inquiry/`（既存）、ko=`https://pamun.jp/document-inquiry-ko/`（Task 0で新設）
- **GTMコンテナ**: `GTM-5KWRC39`（pamun.jp既設）。LPは同一コンテナを載せる
- **コミット末尾**:
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  ```

---

## 👤 Task 0: 人間側の事前準備（山口さん作業）

- [ ] **Step 1: GTM-5KWRC39 の編集権限を確認**
  - https://tagmanager.google.com/ で `GTM-5KWRC39` コンテナに編集者権限でアクセスできることを確認
  - できない場合は権限付与を依頼（Task 4 で必要）

- [ ] **Step 2: WordPressに韓国語資料請求ページを新設**
  - WP管理画面 → 固定ページ新規作成、スラッグ `document-inquiry-ko`（URL `https://pamun.jp/document-inquiry-ko/`）
  - Contact Form 7 で韓国語ラベルのフォームを作成し、当該ページに設置（項目は既存 `document-inquiry` と同等：会社名/氏名/メール/内容）
  - 通知先メール・自動返信（韓国語）を設定。**韓国語問い合わせの対応担当を決める**
  - 公開後、`https://pamun.jp/document-inquiry-ko/` が 200 で表示され、`GTM-5KWRC39` が読み込まれることを確認（テーマ共通のため自動のはず）

- [ ] **Step 3: 完了確認**
  - `curl -s -o /dev/null -w "%{http_code}\n" https://pamun.jp/document-inquiry-ko/` が `200`

---

## Task 1: CTA導線を実フォームへ（i18n + Hero/ページ配線）

**Files:**
- Modify: `src/i18n/ja.json`, `src/i18n/ko.json`
- Modify: `src/components/Hero.astro`
- Modify: `src/pages/index.astro`, `src/pages/ko/index.astro`
- Test: `test/measurement.test.mjs`

- [ ] **Step 1: 失敗するテストを書く `test/measurement.test.mjs`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('ja LP links CTA to document-inquiry form', () => {
  const html = readFileSync('dist/index.html', 'utf8');
  assert.match(html, /href="https:\/\/pamun\.jp\/document-inquiry\/"/);
});

test('ko LP links CTA to Korean document-inquiry form', () => {
  const html = readFileSync('dist/ko/index.html', 'utf8');
  assert.match(html, /href="https:\/\/pamun\.jp\/document-inquiry-ko\/"/);
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm run build && node --test test/measurement.test.mjs`
Expected: FAIL（まだCTAは `#contact` を指している）

- [ ] **Step 3: i18n辞書にCTA送客先URLを追加**

`src/i18n/ja.json` に追記（`cta.button` の次の行など）:
```json
  "cta.href": "https://pamun.jp/document-inquiry/",
```
`src/i18n/ko.json` に追記:
```json
  "cta.href": "https://pamun.jp/document-inquiry-ko/",
```

- [ ] **Step 4: `src/components/Hero.astro` を href対応にする**

```astro
---
import CtaButton from './CtaButton.astro';
interface Props { headline: string; sub: string; cta: string; ctaHref: string; }
const { headline, sub, cta, ctaHref } = Astro.props;
---
<section style="padding:64px 0;text-align:center;background:linear-gradient(180deg,#fff0f4,#fff);">
  <div class="container">
    <h1 style="font-size:2rem;margin:0 0 12px;">{headline}</h1>
    <p style="color:var(--color-muted);margin:0 0 28px;">{sub}</p>
    <CtaButton label={cta} href={ctaHref} id="hero" />
  </div>
</section>
```

- [ ] **Step 5: `src/pages/index.astro` のCTAにhrefを配線**

`Hero` 呼び出しと下部CTAを次のように変更:
```astro
  <Hero headline={t('hero.headline')} sub={t('hero.sub')} cta={t('hero.cta')} ctaHref={t('cta.href')} />
```
下部の `<section id="contact">` 内の CtaButton:
```astro
      <CtaButton label={t('cta.button')} href={t('cta.href')} id="footer" />
```

- [ ] **Step 6: `src/pages/ko/index.astro` も同様に配線**

`Hero` 呼び出し:
```astro
  <Hero headline={t('hero.headline')} sub={t('hero.sub')} cta={t('hero.cta')} ctaHref={t('cta.href')} />
```
下部 CtaButton:
```astro
      <CtaButton label={t('cta.button')} href={t('cta.href')} id="footer" />
```

- [ ] **Step 7: テストが通ることを確認**

Run: `npm run build && node --test test/measurement.test.mjs`
Expected: 2テスト PASS

- [ ] **Step 8: Commit**

```bash
git add src/i18n src/components/Hero.astro src/pages test/measurement.test.mjs
git commit -m "feat: link LP CTAs to document-inquiry forms (ja/ko)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: `lp_cta_click` を dataLayer に push

**Files:**
- Modify: `src/components/CtaButton.astro`
- Modify: `src/layouts/BaseLayout.astro`
- Test: `test/measurement.test.mjs`

- [ ] **Step 1: 失敗するテストを追記 `test/measurement.test.mjs`**

ファイル末尾に追記:
```js
test('CTA buttons carry a data-cta-id for tracking', () => {
  const html = readFileSync('dist/index.html', 'utf8');
  assert.match(html, /data-cta-id="hero"/);
  assert.match(html, /data-cta-id="footer"/);
});

test('lp_cta_click dataLayer listener is present', () => {
  const html = readFileSync('dist/index.html', 'utf8');
  assert.match(html, /lp_cta_click/);
  assert.match(html, /data-cta-id/);
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm run build && node --test test/measurement.test.mjs`
Expected: 新規2テストが FAIL

- [ ] **Step 3: `src/components/CtaButton.astro` に id属性を追加**

```astro
---
interface Props { label: string; href?: string; id?: string; }
const { label, href = '#contact', id = 'cta' } = Astro.props;
---
<a href={href} data-cta-id={id} style="display:inline-block;background:var(--color-accent);color:#fff;padding:14px 32px;border-radius:999px;text-decoration:none;font-weight:700;">{label}</a>
```

- [ ] **Step 4: `src/layouts/BaseLayout.astro` にクリックリスナーを追加**

`</body>` の直前（footerの後）に、GTMスニペットとは別の`<script is:inline>`を追加:
```astro
    <script is:inline>
      window.dataLayer = window.dataLayer || [];
      document.addEventListener('click', function (e) {
        var el = e.target.closest && e.target.closest('[data-cta-id]');
        if (!el) return;
        window.dataLayer.push({
          event: 'lp_cta_click',
          cta_id: el.getAttribute('data-cta-id'),
          page_locale: document.documentElement.lang || 'ja'
        });
      });
    </script>
```

- [ ] **Step 5: テストが通ることを確認**

Run: `npm run build && node --test test/measurement.test.mjs`
Expected: 4テスト全部 PASS

- [ ] **Step 6: Commit**

```bash
git add src/components/CtaButton.astro src/layouts/BaseLayout.astro test/measurement.test.mjs
git commit -m "feat: push lp_cta_click to dataLayer on CTA click

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: CIビルドで GTM を有効化

**Files:**
- Modify: `.github/workflows/deploy.yml`
- Test: `test/measurement.test.mjs`

- [ ] **Step 1: 失敗するテストを追記 `test/measurement.test.mjs`**

ファイル末尾に追記:
```js
test('GTM container is embedded when PUBLIC_GTM_ID is set at build', () => {
  const gtm = process.env.PUBLIC_GTM_ID;
  if (!gtm) return; // 環境変数なしビルドではスキップ
  const html = readFileSync('dist/index.html', 'utf8');
  assert.match(html, new RegExp('googletagmanager\\.com/gtm\\.js'));
  assert.ok(html.includes(gtm), `dist に ${gtm} が含まれない`);
});
```

- [ ] **Step 2: PUBLIC_GTM_ID を渡してビルド→テストが通ることをローカル確認**

Run: `PUBLIC_GTM_ID=GTM-5KWRC39 npm run build && PUBLIC_GTM_ID=GTM-5KWRC39 node --test test/measurement.test.mjs`
Expected: 全テスト PASS（distにGTM-5KWRC39が埋め込まれる）

- [ ] **Step 3: `.github/workflows/deploy.yml` の Build ステップに env を追加**

`- name: Build` の `env:` に `PUBLIC_GTM_ID` を追加:
```yaml
      - name: Build
        run: npm run build
        env:
          DEPLOY_TARGET: ${{ steps.target.outputs.deploy_target }}
          PUBLIC_GTM_ID: GTM-5KWRC39
```
同様に `- name: Test dist` の `env:` にも追加（テストがGTM検証を行うため）:
```yaml
      - name: Test dist
        run: npm test
        env:
          DEPLOY_TARGET: ${{ steps.target.outputs.deploy_target }}
          PUBLIC_GTM_ID: GTM-5KWRC39
```

- [ ] **Step 4: `package.json` の test が measurement テストも拾うことを確認**

`test` スクリプトは `node --test test/*.test.mjs`（Task①で設定済み）なので `test/measurement.test.mjs` も自動実行される。
Run: `PUBLIC_GTM_ID=GTM-5KWRC39 npm run build && PUBLIC_GTM_ID=GTM-5KWRC39 npm test`
Expected: `dist.test.mjs` と `measurement.test.mjs` の全テスト PASS

- [ ] **Step 5: YAML検証 & Commit**

```bash
ruby -ryaml -e "YAML.load_file('.github/workflows/deploy.yml'); puts 'YAML OK'"
git add .github/workflows/deploy.yml test/measurement.test.mjs
git commit -m "ci: embed GTM-5KWRC39 into LP builds

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## 👤 Task 4: GTM-5KWRC39 コンテナ設定（山口さん＋Claude伴走）

GTM管理画面での作業。Claudeは手順を提示し、画面共有ベースで伴走する。

- [ ] **Step 1: `lp_cta_click` を受け取るトリガーを作成**
  - GTM →「トリガー」→ 新規 → タイプ「カスタムイベント」→ イベント名 `lp_cta_click`

- [ ] **Step 2: データレイヤー変数を作成**
  - `cta_id`（データレイヤーの変数 `cta_id`）、`page_locale`（同 `page_locale`）

- [ ] **Step 3: GA4イベントタグを作成**
  - タイプ「GA4イベント」→ 測定ID `G-HR6XF36RCZ` → イベント名 `lp_cta_click`
  - イベントパラメータ: `cta_id={{cta_id}}`, `page_locale={{page_locale}}`
  - トリガー: Step 1 の `lp_cta_click`

- [ ] **Step 4: CF7送信CV（`generate_lead`）の有無を確認・無ければ設定**
  - 既存で `wpcf7mailsent` → GA4 `generate_lead` が設定済みか確認
  - 無ければ: カスタムHTMLタグ（全ページ/フォームページ）で `document.addEventListener('wpcf7mailsent', function(e){ window.dataLayer.push({event:'wpcf7_sent', form_id: e.detail && e.detail.contactFormId}); });` を発火 → カスタムイベント `wpcf7_sent` トリガー → GA4イベント `generate_lead`（パラメータ `form_id`）
  - GA4管理画面で `generate_lead` を「キーイベント（コンバージョン）」にマーク

- [ ] **Step 5: GTMプレビューで検証してから公開**
  - プレビューモードで pamun.jp/monitor/ を開き、CTAクリックで `lp_cta_click` GA4タグ発火を確認
  - フォーム送信で `generate_lead` 発火を確認
  - 問題なければ「送信（バージョン公開）」

---

## Task 5: デプロイ & GA4/BigQuery 検証（E2E・Claude伴走）

- [ ] **Step 1: LP変更を本番反映**

```bash
cd ~/claude/pamun-lp
git push origin main
```
Expected: GitHub Actions 成功、`https://pamun.jp/monitor/` に GTM-5KWRC39 が入る

- [ ] **Step 2: 本番HTMLにGTMとCTA導線が反映されたか確認**

```bash
curl -sS https://pamun.jp/monitor/ | grep -o 'GTM-5KWRC39' | head -1
curl -sS https://pamun.jp/monitor/ | grep -o 'document-inquiry/' | head -1
curl -sS https://pamun.jp/monitor/ko/ | grep -o 'document-inquiry-ko/' | head -1
```
Expected: それぞれ一致文字列が返る

- [ ] **Step 3: GA4 リアルタイム/DebugView で発火確認**
  - GA4（プロパティ 273371278）→ DebugView（GTMプレビュー中）or リアルタイム
  - `/monitor/` を開いて `page_view`、CTAクリックで `lp_cta_click` を確認
  - `/monitor/ko/` でも同様（`page_locale=ko`）

- [ ] **Step 4: フォーム送信CVのファネル確認**
  - `/monitor/` → CTA → `/document-inquiry/` でテスト送信 → GA4で `generate_lead` 計上を確認
  - `/monitor/ko/` → `/document-inquiry-ko/` でも確認

- [ ] **Step 5: BigQuery 着弾確認（翌日以降）**

```bash
export PATH="/Users/yuttyo/google-cloud-sdk/bin:$PATH"
bq query --project_id=cg-project-491303 --nouse_legacy_sql --maximum_bytes_billed=2000000000 \
"SELECT (SELECT value.string_value FROM UNNEST(event_params) WHERE key='page_location') AS loc, event_name, COUNT(*) c
 FROM \`cg-project-491303.analytics_273371278.events_*\`
 WHERE _TABLE_SUFFIX >= FORMAT_DATE('%Y%m%d', DATE_SUB(CURRENT_DATE(), INTERVAL 2 DAY))
   AND (SELECT value.string_value FROM UNNEST(event_params) WHERE key='page_location') LIKE '%/monitor/%'
 GROUP BY loc, event_name ORDER BY c DESC LIMIT 20"
```
Expected: `/monitor/` の `page_view` / `lp_cta_click` が行として返る

- [ ] **Step 6: ②a 完了確認（DoD）**
  1. LP(ja/ko)に GTM-5KWRC39 搭載、GA4で `/monitor/` の `page_view`/`lp_cta_click` 発火 ✅
  2. BigQuery `analytics_273371278` に `/monitor/` イベント着弾 ✅
  3. `document-inquiry`/`document-inquiry-ko` の送信が `generate_lead` として計上 ✅
  4. landing_page=`/monitor/*` → CTA → CV のファネルでLP別CVRが算出できる ✅
  5. ja/ko 両方でCV導線が機能 ✅

---

## Task 6: UTM規約とGTMメモをREADMEに追記

**Files:**
- Modify: `README.md`

- [ ] **Step 1: `README.md` に「計測」節を追記**

````markdown
## 計測（②a）
- LPは既存 GTM `GTM-5KWRC39` / GA4 `G-HR6XF36RCZ`(プロパティ273371278) に相乗り。BQ export `analytics_273371278`。
- ビルド時 `PUBLIC_GTM_ID=GTM-5KWRC39` でGTMを埋め込む（GitHub Actionsで設定済み）。
- CTA送客先: ja=`/document-inquiry/`, ko=`/document-inquiry-ko/`。CTAクリックで `lp_cta_click` を dataLayer push。
- LP別分析は GA4/BQ で landing_page=`/monitor/*` で分離。

### UTM命名規約（広告入稿時に付与）
- `utm_source`: `google` | `meta` | `tiktok` | `line` …（媒体）
- `utm_medium`: `cpc` | `paid_social` | `display`
- `utm_campaign`: `<商戦>_<媒体>_<案>`（例 `2026aki_meta_a`）
- `utm_content`: バナー/クリエイティブ識別（②bで活用）
````

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add measurement + UTM convention notes

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## 完了後の次アクション
- **②b 広告連携・ROAS分析** のブレストへ。Google Ads(AW-799179729)・Meta・TikTok を BigQuery に集約し、UTM規約・`generate_lead` CV と突き合わせて LP別/チャネル別 ROAS を可視化する。
