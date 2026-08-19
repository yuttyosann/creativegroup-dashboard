# S2d-4: X候補のPR実績・ジャンル診断 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** X候補の明示PR投稿を検出し、PR投稿と非PR投稿のエンゲージ率を比較して「PRで反応が落ちる人」を可視化する。あわせてジャンルを固定カテゴリで判定し、候補DBの `ジャンル`・`PRエンゲージ%` 列を埋める。

**Architecture:** 既存の「🐦 X転換質診断」（`POST /api/cockpit/x-intent`）を拡張する。新しいエンドポイントもUIカードも増やさない。判定ロジックは純粋関数（`lib/`）に置き、Apify呼び出しスクリプトは取得と正規化だけを担う。Claude呼び出しは転換質判定とジャンル判定の2回に分ける（入力の性質が異なり、1つのプロンプトに混ぜると双方の精度が落ちるため）。

**Tech Stack:** Node.js / Express / `node:test` / Apify `apidojo~twitter-profile-scraper` / Anthropic `claude-sonnet-4-6` / Vanilla JS

**設計書:** `docs/superpowers/specs/2026-08-19-s2d4-x-pr-profile-design.md`

---

## ファイル構成

| ファイル | 種別 | 責務 |
|---|---|---|
| `lib/x-pr-filter.js` | 新規 | 明示PR判定・PR/非PR分割・エンゲージ集計（純粋関数。I/Oを持たない） |
| `test/x-pr-filter.test.js` | 新規 | 上記の単体テスト（実データ由来のケースを含む） |
| `lib/x-genre-prompt.js` | 新規 | ジャンル判定プロンプト組み立て（純粋関数） |
| `test/x-genre-prompt.test.js` | 新規 | 上記の単体テスト |
| `scripts/apify/fetch_x_replies.js` | 修正 | 取得条件の変更＋PR集計・プロフィール・直近投稿を追加で返す |
| `cockpit-server.js` | 修正 | ジャンル判定を追加。転換質が出なくてもPR実績とジャンルを返す構造に変更 |
| `public/cg-cockpit.html` | 修正 | PR実績・ジャンルの表示と、`prEngage`/`genre` の書き戻し |

`lib/x-reply-filter.js` は**変更しない**。`isGiveawayPost` / `selectPosts` / `cleanReplies` を引き続き使う。

---

## Task 1: 明示PR判定とエンゲージ集計

**Files:**
- Create: `lib/x-pr-filter.js`
- Test: `test/x-pr-filter.test.js`

- [ ] **Step 1: 失敗するテストを書く**

Create `test/x-pr-filter.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { isExplicitPR, summarizePR, engagementRate } = require('../lib/x-pr-filter');

// 実データ（2026-08-19 実測）で確認した表記をそのままケース化する
test('isExplicitPR: 実データのPR表記を検出する', () => {
  assert.equal(isExplicitPR('長年研究している、アスタキサンチンの使い手なのです。【PR/アスタリフト】'), true);
  assert.equal(isExplicitPR('凄いよ、このハイライト当てた様なツヤ。【PR】エイトザタラソSR'), true);
  assert.equal(isExplicitPR('Celladixのこれは3%も入っててマンホール毛穴にぴったりなの👍PR'), true);
  assert.equal(isExplicitPR('これからも愛用しつづけます…😭【PR_オルビス】'), true);
  assert.equal(isExplicitPR('上品なツヤプラスしよ🎀 #PR #水光肌の作り方'), true);
  assert.equal(isExplicitPR('プチプラ日傘はこれです（当方日傘ないと100外出しない超晴れ女👩☀️）PR'), true);
});

test('isExplicitPR: 英単語に埋まった pr を誤検出しない', () => {
  assert.equal(isExplicitPR('this product is great'), false);
  assert.equal(isExplicitPR('press release'), false);
  assert.equal(isExplicitPR('April is coming'), false);
  assert.equal(isExplicitPR('what a surprise'), false);
  assert.equal(isExplicitPR('spray してます'), false);
});

test('isExplicitPR: URL内の文字列を誤検出しない', () => {
  assert.equal(isExplicitPR('詳細はこちら https://example.com/pr/12345'), false);
  assert.equal(isExplicitPR('最後まで搾り取れるパウチ大好き https://t.co/O0AefAuUhF'), false);
});

test('isExplicitPR: 空文字・null で落ちない', () => {
  assert.equal(isExplicitPR(''), false);
  assert.equal(isExplicitPR(null), false);
  assert.equal(isExplicitPR(undefined), false);
});

test('engagementRate: (いいね+RT)÷フォロワー×100 を小数1桁で返す', () => {
  assert.equal(engagementRate(100, 20, 10000), 1.2);
});

test('engagementRate: フォロワー100未満・0は null', () => {
  assert.equal(engagementRate(50, 10, 99), null);
  assert.equal(engagementRate(50, 10, 0), null);
});

test('summarizePR: PR/非PRに分けて集計する', () => {
  const tweets = [
    { text: '新作いいよ【PR】', likeCount: 100, retweetCount: 0, isReply: false, isRetweet: false },
    { text: 'これ好き【PR】', likeCount: 200, retweetCount: 0, isReply: false, isRetweet: false },
    { text: '普通の投稿です', likeCount: 1000, retweetCount: 0, isReply: false, isRetweet: false },
    { text: 'これも普通', likeCount: 2000, retweetCount: 0, isReply: false, isRetweet: false },
  ];
  const s = summarizePR(tweets, 10000);
  assert.equal(s.tweets, 4);
  assert.equal(s.prCount, 2);
  assert.equal(s.prRate, 50);
  assert.equal(s.prEngage, 1.5);      // 平均150 / 10000
  assert.equal(s.nonPrEngage, 15);    // 平均1500 / 10000
  assert.equal(s.prLift, 10);         // 1.5 / 15 = 10%
});

test('summarizePR: リプライとリツイートは分母に入れない', () => {
  const tweets = [
    { text: '本人の投稿【PR】', likeCount: 100, retweetCount: 0, isReply: false, isRetweet: false },
    { text: '返信です', likeCount: 5, retweetCount: 0, isReply: true, isRetweet: false },
    { text: 'RTしたもの', likeCount: 999, retweetCount: 0, isReply: false, isRetweet: true },
  ];
  const s = summarizePR(tweets, 10000);
  assert.equal(s.tweets, 1);
  assert.equal(s.prCount, 1);
  assert.equal(s.prRate, 100);
});

test('summarizePR: PR投稿が無ければ prEngage と prLift は null', () => {
  const tweets = [{ text: '普通の投稿', likeCount: 100, retweetCount: 0, isReply: false, isRetweet: false }];
  const s = summarizePR(tweets, 10000);
  assert.equal(s.prCount, 0);
  assert.equal(s.prRate, 0);
  assert.equal(s.prEngage, null);
  assert.equal(s.prLift, null);
  assert.equal(s.lowPrSample, false);   // 0件は「サンプル不足」ではなく「PRなし」
});

test('summarizePR: 非PR投稿が無ければ prLift は null（比較対象がない）', () => {
  const tweets = [{ text: 'PR投稿だけ【PR】', likeCount: 100, retweetCount: 0, isReply: false, isRetweet: false }];
  const s = summarizePR(tweets, 10000);
  assert.equal(s.prEngage, 1);
  assert.equal(s.nonPrEngage, null);
  assert.equal(s.prLift, null);
});

test('summarizePR: PR投稿が1〜2件なら lowPrSample=true', () => {
  const tweets = [
    { text: 'PR投稿【PR】', likeCount: 100, retweetCount: 0, isReply: false, isRetweet: false },
    { text: '普通', likeCount: 100, retweetCount: 0, isReply: false, isRetweet: false },
  ];
  assert.equal(summarizePR(tweets, 10000).lowPrSample, true);
});

test('summarizePR: 投稿が空でも落ちない', () => {
  const s = summarizePR([], 10000);
  assert.equal(s.tweets, 0);
  assert.equal(s.prCount, 0);
  assert.equal(s.prRate, 0);
  assert.equal(s.prEngage, null);
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `node --test test/x-pr-filter.test.js`
Expected: FAIL（`Cannot find module '../lib/x-pr-filter'`）

- [ ] **Step 3: 最小実装を書く**

Create `lib/x-pr-filter.js`:

```js
'use strict';
/**
 * x-pr-filter.js — X投稿の明示PR判定とエンゲージ集計（純粋関数）
 *
 * 【なぜ #PR ではなく裸の PR を見るか】
 * 2026-08-19の実測では、ハッシュタグ形式の #PR は2アカウントとも0件だった。
 * 実際の表記は本文中の独立した「PR」で、【PR】【PR/ブランド名】👍PR などの形を取る。
 * S2d-2の isPRPost（#pr/#ad/提供/案件 の部分一致）は「提供」が災害支援の文に、
 * 「ad」が成分名 Celladix に誤反応する一方で真のPR投稿を取りこぼしたため、ここでは使わない。
 *
 * 【なぜPR係数（prLift）が主指標か】
 * フォロワー73万のアカウントでも、PR投稿になると反応が2桁落ちる例が実在する。
 * フォロワー数やエンゲージ率だけでは起用判断を誤るため、PR時の落差を明示する。
 */

// URL除去後、前後が英字でない独立した PR（product / press / April 等に反応しない）
const BARE_PR = /(^|[^A-Za-z])pr([^A-Za-z]|$)/i;

function stripUrl(v) {
  return String(v == null ? '' : v).replace(/https?:\/\/\S+/g, ' ');
}

function isExplicitPR(text) {
  return BARE_PR.test(stripUrl(text));
}

/** (いいね+RT) ÷ フォロワー × 100。S2d-3と定義を揃える（重み付けなし） */
function engagementRate(avgLike, avgRt, followers) {
  const f = Number(followers) || 0;
  if (f < 100) return null;   // 分母が小さすぎて率が無意味になる
  const e = (Number(avgLike) || 0) + (Number(avgRt) || 0);
  return Math.round((e / f) * 1000) / 10;
}

function avgOf(list, key) {
  if (!list.length) return 0;
  return list.reduce((s, t) => s + (Number(t[key]) || 0), 0) / list.length;
}

function round1(n) { return Math.round(n * 10) / 10; }

/**
 * 本人の非リプライ・非リツイート投稿だけを分母にPR実績を集計する。
 * リプライを分母に入れるとPR率が不当に低く出るため。
 */
function summarizePR(tweets, followers) {
  const own = (tweets || []).filter((t) => t && !t.isReply && !t.isRetweet);
  const pr = own.filter((t) => isExplicitPR(t.text));
  const nonPr = own.filter((t) => !isExplicitPR(t.text));

  const prEngage = pr.length
    ? engagementRate(avgOf(pr, 'likeCount'), avgOf(pr, 'retweetCount'), followers)
    : null;
  const nonPrEngage = nonPr.length
    ? engagementRate(avgOf(nonPr, 'likeCount'), avgOf(nonPr, 'retweetCount'), followers)
    : null;

  let prLift = null;
  if (prEngage != null && nonPrEngage != null && nonPrEngage > 0) {
    prLift = round1((prEngage / nonPrEngage) * 100);
  }

  return {
    tweets: own.length,
    prCount: pr.length,
    prRate: own.length ? round1((pr.length / own.length) * 100) : 0,
    prEngage,
    nonPrEngage,
    prLift,
    lowPrSample: pr.length > 0 && pr.length < 3,
    prSamples: pr.slice(0, 3).map((t) => String(t.text || '').replace(/\s+/g, ' ').slice(0, 60)),
  };
}

module.exports = { isExplicitPR, summarizePR, engagementRate, BARE_PR };
```

- [ ] **Step 4: テストが通ることを確認**

Run: `node --test test/x-pr-filter.test.js`
Expected: PASS（12テスト全部）

- [ ] **Step 5: リグレッションが無いことを確認**

Run: `npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"`
Expected: `fail 0`

- [ ] **Step 6: コミット**

```bash
git add lib/x-pr-filter.js test/x-pr-filter.test.js
git commit -m "feat(s2d-4): add explicit PR detection and engagement comparison"
```

---

## Task 2: ジャンル判定プロンプト

**Files:**
- Create: `lib/x-genre-prompt.js`
- Test: `test/x-genre-prompt.test.js`

- [ ] **Step 1: 失敗するテストを書く**

Create `test/x-genre-prompt.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { buildXGenrePrompt, GENRES } = require('../lib/x-genre-prompt');

test('GENRES: 固定8カテゴリを提供する', () => {
  assert.deepEqual(GENRES, ['スキンケア', 'メイク', '美容医療', 'ヘアケア', 'ボディケア', 'ファッション', 'ライフスタイル', 'その他']);
});

test('buildXGenrePrompt: system と user を返す', () => {
  const p = buildXGenrePrompt({ account: 'mika', profile: 'コスメ好き', posts: ['化粧水いい'] });
  assert.ok(p.system.length > 0);
  assert.ok(p.user.includes('@mika'));
});

test('buildXGenrePrompt: 全カテゴリがプロンプトに含まれる', () => {
  const p = buildXGenrePrompt({ account: 'mika', profile: 'コスメ好き', posts: ['化粧水いい'] });
  GENRES.forEach((g) => assert.ok(p.user.includes(g), g + ' が含まれていない'));
});

test('buildXGenrePrompt: 1つだけ選ぶこと・迷ったらその他を指示する', () => {
  const p = buildXGenrePrompt({ account: 'mika', profile: 'コスメ好き', posts: ['化粧水いい'] });
  assert.ok(p.user.includes('1つだけ'));
  assert.ok(p.user.includes('その他'));
});

test('buildXGenrePrompt: 投稿は20件までに制限する', () => {
  const posts = Array.from({ length: 40 }, (_, i) => 'post' + i);
  const p = buildXGenrePrompt({ account: 'mika', profile: 'x', posts });
  assert.ok(p.user.includes('post19'));
  assert.ok(!p.user.includes('post20'));
});

test('buildXGenrePrompt: 空白のみの投稿は除く', () => {
  const p = buildXGenrePrompt({ account: 'mika', profile: 'コスメ好き', posts: ['  ', '', '化粧水いい'] });
  assert.ok(p.user.includes('1. 化粧水いい'));
});

test('buildXGenrePrompt: account が無ければエラー', () => {
  assert.throws(() => buildXGenrePrompt({ profile: 'x', posts: ['y'] }), /account/);
});

test('buildXGenrePrompt: プロフィールも投稿も無ければエラー', () => {
  assert.throws(() => buildXGenrePrompt({ account: 'mika', profile: '', posts: [] }), /profile|posts/);
});

test('buildXGenrePrompt: プロフィールだけでも組み立てられる', () => {
  const p = buildXGenrePrompt({ account: 'mika', profile: 'スキンケア好き', posts: [] });
  assert.ok(p.user.includes('スキンケア好き'));
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `node --test test/x-genre-prompt.test.js`
Expected: FAIL（`Cannot find module '../lib/x-genre-prompt'`）

- [ ] **Step 3: 最小実装を書く**

Create `lib/x-genre-prompt.js`:

```js
'use strict';
/**
 * x-genre-prompt.js — Xアカウントのジャンル判定プロンプト（純粋関数）
 *
 * 固定カテゴリから1つだけ選ばせる。自由記述にすると表記がブレて
 * 候補DBでの絞り込み・並べ替えに使えなくなるため。
 */

const GENRES = ['スキンケア', 'メイク', '美容医療', 'ヘアケア', 'ボディケア', 'ファッション', 'ライフスタイル', 'その他'];

const SYSTEM =
  'あなたはCreative GroupのSNSインフルエンサー分析アナリストです。' +
  '提示された情報のみを根拠にアカウントの主ジャンルを1つ選び、指定のJSONのみを出力してください。' +
  '説明文・前置き・コードフェンスは一切出力しないでください。';

const TEMPLATE = `以下は X アカウント @{{account}} のプロフィールと直近の投稿です。
このアカウントの主ジャンルを次の中から1つだけ選んでください。

【カテゴリ】
{{genres}}

どれにも当てはまらない場合は「その他」を選んでください。無理に既存カテゴリへ寄せないでください。

【プロフィール】
{{profile}}

【直近の投稿（{{count}}件）】
{{posts}}

【出力】次のJSONのみを出力（説明文なし）。
{
  "genre": "カテゴリ名（上記のいずれか）",
  "reason": "判断根拠（40字以内）"
}`;

function fill(template, values) {
  return template.replace(/{{(\w+)}}/g, (_, k) => {
    if (!(k in values)) throw new Error('テンプレートキーが見つかりません: ' + k);
    return String(values[k]);
  });
}

function buildXGenrePrompt(payload) {
  payload = payload || {};
  const account = String(payload.account || '').trim().replace(/^@/, '');
  if (!account) throw new Error('必須項目が不足しています: account');

  const profile = String(payload.profile || '').replace(/\s+/g, ' ').trim();
  const list = Array.isArray(payload.posts) ? payload.posts : [];
  const posts = list
    .map((p) => String(p == null ? '' : p).replace(/\s+/g, ' ').trim())
    .filter((p) => p)
    .slice(0, 20);

  if (!profile && !posts.length) throw new Error('必須項目が不足しています: profile または posts');

  const numbered = posts.map((p, i) => `${i + 1}. ${p.slice(0, 120)}`).join('\n');
  return {
    system: SYSTEM,
    user: fill(TEMPLATE, {
      account,
      genres: GENRES.map((g) => '- ' + g).join('\n'),
      profile: profile || '(なし)',
      count: posts.length,
      posts: numbered || '(なし)',
    }),
  };
}

module.exports = { buildXGenrePrompt, GENRES };
```

- [ ] **Step 4: テストが通ることを確認**

Run: `node --test test/x-genre-prompt.test.js`
Expected: PASS（9テスト全部）

- [ ] **Step 5: リグレッションが無いことを確認**

Run: `npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"`
Expected: `fail 0`

- [ ] **Step 6: コミット**

```bash
git add lib/x-genre-prompt.js test/x-genre-prompt.test.js
git commit -m "feat(s2d-4): add genre classification prompt builder with tests"
```

---

## Task 3: Apify取得スクリプトの変更

**Files:**
- Modify: `scripts/apify/fetch_x_replies.js`

このファイルは外部API呼び出しのため単体テストを書かない（S2d-2からの方針を継続）。判定ロジックは Task 1 の純粋関数に委譲する。

**変更の理由:** 現状は `minReplyCount: 5` で「リプライ5件以上の投稿」だけを取得しているが、**PR投稿はリプライが少なく、この条件では漏れる**（実測でPR投稿のいいねは185〜528）。取得段のフィルタをやめ、絞り込みはコード側で行う。

- [ ] **Step 1: 定数と取得条件を変更**

`scripts/apify/fetch_x_replies.js` の定数行を探す:

```js
const MAX_POSTS = 5, MAX_REPLIES_PER_POST = 50, DAYS = 90, MIN_REPLY_COUNT = 5, MAX_ITEMS = 300;
```

これを次で置き換える:

```js
// MIN_REPLY_COUNT は取得条件ではなく「転換質判定に使う投稿の絞り込み」に使う（下記参照）。
// PR投稿はリプライが少なく、取得段で切るとPR率が測れないため。
const MAX_POSTS = 5, MAX_REPLIES_PER_POST = 50, DAYS = 90, MIN_REPLY_COUNT = 5, MAX_ITEMS = 500;
const RECENT_POSTS_FOR_GENRE = 20;
```

- [ ] **Step 2: import に PR集計を追加**

次の行を探す:

```js
const { selectPosts, cleanReplies, isPRPost, isGiveawayPost } = require('../../lib/x-reply-filter');
```

その直後に追加する（既存行は変更しない）:

```js
const { summarizePR } = require('../../lib/x-pr-filter');
```

- [ ] **Step 3: normalize にPR集計用のフィールドを足す**

`function normalize(it) {` の `return {` ブロックを次で置き換える:

```js
  return {
    id: String(it.id || it.id_str || it.tweetId || ''),
    text: it.text || it.full_text || it.fullText || '',
    url: it.url || it.twitterUrl || '',
    replyCount: Number(it.replyCount != null ? it.replyCount : it.reply_count) || 0,
    likeCount: Number(it.likeCount != null ? it.likeCount : it.favorite_count) || 0,
    retweetCount: Number(it.retweetCount != null ? it.retweetCount : it.retweet_count) || 0,
    isReply: Boolean(it.isReply || it.inReplyToId || it.in_reply_to_status_id_str),
    isRetweet: Boolean(it.isRetweet),
    parentId: String(it.inReplyToId || it.in_reply_to_status_id_str || it.conversationId || ''),
    authorHandle: author.userName || author.screen_name || it.userName || '',
    followers: Number(author.followers != null ? author.followers : author.followers_count) || 0,
    description: author.description || '',
  };
```

- [ ] **Step 4: 取得条件から minReplyCount を外す**

次のブロックを探す:

```js
  const input = {
    twitterHandles: [handle],
    getReplies: true,
    start: sinceDate(DAYS),
    minReplyCount: MIN_REPLY_COUNT,
    maxItems: MAX_ITEMS,
  };
```

次で置き換える:

```js
  // minReplyCount は指定しない。PR投稿はリプライが少なく、取得段で切ると
  // PR率・PRエンゲージ率が測れなくなるため（S2d-4）。絞り込みは取得後に行う。
  const input = {
    twitterHandles: [handle],
    getReplies: true,
    start: sinceDate(DAYS),
    maxItems: MAX_ITEMS,
  };
```

- [ ] **Step 5: 集計処理を差し替える**

次のブロックを探す:

```js
  const giveawayExcluded = tweets.filter((t) => isGiveawayPost(t.text)).length;
  const picked = selectPosts(tweets, { maxPosts: MAX_POSTS });
```

次で置き換える:

```js
  // フォロワー数・プロフィールは本人の投稿から拾う（S2d-4のPR集計とジャンル判定に使う）
  const followers = (tweets.find((t) => t.followers) || {}).followers || 0;
  const description = (tweets.find((t) => t.description) || {}).description || '';

  // PR実績（本人の非リプライ・非RT投稿が母数）
  const pr = summarizePR(tweets, followers);

  // 転換質判定に使う投稿は従来どおりリプライの多いものに絞る（取得段のフィルタをやめた分ここで担保）
  const engaged = tweets.filter((t) => (t.replyCount || 0) >= MIN_REPLY_COUNT);
  const giveawayExcluded = engaged.filter((t) => isGiveawayPost(t.text)).length;
  const picked = selectPosts(engaged, { maxPosts: MAX_POSTS });
```

- [ ] **Step 6: 出力にS2d-4のフィールドを足す**

最後の `console.log('@@JSON@@' + JSON.stringify({ ... }));` ブロック全体を次で置き換える:

```js
  console.log('@@JSON@@' + JSON.stringify({
    ok: true,
    account: handle,
    posts: picked.length,
    giveawayExcluded,
    hasPRPost: pr.prCount > 0,
    replies: targetReplies,
    note,
    // --- S2d-4 ---
    followers,
    profile: description,
    pr,
    recentPosts: tweets.slice(0, RECENT_POSTS_FOR_GENRE).map((t) => t.text),
    // 取得上限に達した場合、集計期間が指定より短くなる（候補ごとに期間が違う点を隠さない）
    truncated: all.length >= MAX_ITEMS,
  }));
```

- [ ] **Step 7: 構文チェック**

Run: `node --check scripts/apify/fetch_x_replies.js`
Expected: 出力なし

- [ ] **Step 8: 旧フィールドが残っていないことを確認**

Run:
```bash
grep -n "minReplyCount" scripts/apify/fetch_x_replies.js
```
Expected: `MIN_REPLY_COUNT` を使う行（定数定義と `engaged` の絞り込み）は出るが、**Apify入力の `minReplyCount:` は出ない**

Run:
```bash
node -e "
const s=require('fs').readFileSync('scripts/apify/fetch_x_replies.js','utf8');
console.log('Apify入力のminReplyCount =', /minReplyCount:\s*MIN_REPLY_COUNT/.test(s), '(falseが正)');
console.log('MAX_ITEMS=500 =', s.includes('MAX_ITEMS = 500'));
console.log('summarizePR import =', s.includes(\"require('../../lib/x-pr-filter')\"));
console.log('pr を返している =', /pr,/.test(s));
console.log('recentPosts を返している =', s.includes('recentPosts'));
"
```
Expected: 全て `true`（1行目のみ `false` が正）

- [ ] **Step 9: 引数バリデーションが壊れていないことを確認（APIは叩かない）**

Run: `APIFY_TOKEN=dummy node scripts/apify/fetch_x_replies.js 2>&1 | head -2`
Expected: `使い方: node scripts/apify/fetch_x_replies.js <handle> --json`

- [ ] **Step 10: リグレッションが無いことを確認**

Run: `npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"`
Expected: `fail 0`

- [ ] **Step 11: コミット**

```bash
git add scripts/apify/fetch_x_replies.js
git commit -m "feat(s2d-4): fetch full timeline for PR stats, return profile and PR summary"
```

---

## Task 4: サーバー側の拡張

**Files:**
- Modify: `cockpit-server.js`

**構造変更の理由:** 現状は転換質が算出できないと早期リターンしてしまうが、**転換質が出なくてもPR実績とジャンルは価値がある**（PR投稿が多くリプライが少ないアカウントなど）。共通部分を先に組み立て、転換質だけを後から足す形に変える。

- [ ] **Step 1: import を追加**

次の行を探す:

```js
const { buildXIntentPrompt } = require('./lib/x-intent-prompt');
```

その直後に追加する:

```js
const { buildXGenrePrompt } = require('./lib/x-genre-prompt');
```

- [ ] **Step 2: Claude呼び出しの共通ヘルパを追加**

`runScriptJson` 関数の閉じ括弧 `}` の直後に、次を挿入する:

```js
// Claudeを呼びJSONだけを取り出す。転換質判定とジャンル判定の2箇所で使う。
async function callClaudeJson(prompt, maxTokens) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 120000 });
  const msg = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: maxTokens || 4096,
    system: prompt.system,
    messages: [{ role: 'user', content: prompt.user }],
  });
  const text = (msg.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('JSONが見つかりません');
  return JSON.parse(m[0]);
}
```

- [ ] **Step 3: x-intent ルートの本体を差し替える**

`app.post('/api/cockpit/x-intent', requireAuth, async (req, res) => {` から、その閉じ括弧 `});` までを**まるごと**次で置き換える:

```js
app.post('/api/cockpit/x-intent', requireAuth, async (req, res) => {
  const account = String((req.body || {}).account || '').trim().replace(/^@/, '');
  if (!account) return res.status(400).json({ ok: false, error: 'アカウント名を入力してください' });
  if (!process.env.APIFY_TOKEN) return res.status(400).json({ ok: false, error: 'APIFY_TOKEN未設定（Cloud Runの環境変数に追加してください）' });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(400).json({ ok: false, error: 'ANTHROPIC_API_KEY未設定（Cloud Runの環境変数に追加してください）' });

  // 1) Apify取得（投稿＋リプライ）＋PR実績の集計
  let data;
  try {
    data = await runScriptJson('scripts/apify/fetch_x_replies.js', [account, '--json']);
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'リプライ取得に失敗しました: ' + String(e.message || e).slice(0, 400) });
  }

  // 2) ジャンル判定。失敗しても診断全体は続ける（ジャンルだけのために結果を失わない）
  let genre = null, genreReason = '';
  try {
    const gp = buildXGenrePrompt({ account, profile: data.profile, posts: data.recentPosts });
    const g = await callClaudeJson(gp, 512);
    genre = g.genre || null;
    genreReason = String(g.reason || '').slice(0, 60);
  } catch (e) { /* ジャンル未判定のまま進む */ }

  // 転換質の可否に関わらず返す共通部分。PR実績は転換質が出なくても価値があるため。
  const base = {
    ok: true, account,
    pr: data.pr || null,
    genre, genreReason,
    followers: data.followers || 0,
    truncated: !!data.truncated,
    giveawayExcluded: data.giveawayExcluded || 0,
  };

  // 「対象投稿なし」は 0% と意味が違う（0%＝反応はあるが買う気ゼロ）ので conversion を null で返す
  if (!data.posts) {
    return res.json(Object.assign({}, base, { conversion: null, reason: data.note || '対象投稿なし（懸賞のみ）', posts: 0 }));
  }
  if (!data.replies || !data.replies.length) {
    return res.json(Object.assign({}, base, { conversion: null, reason: data.note || '判定対象のリプライがありません', posts: data.posts }));
  }

  // 3) 転換質のClaude判定
  let prompt;
  try { prompt = buildXIntentPrompt({ account, replies: data.replies }); }
  catch (e) { return res.status(400).json({ ok: false, error: e.message }); }

  let judged;
  try {
    judged = await callClaudeJson(prompt, 4096);
  } catch (e) {
    return res.status(500).json({ ok: false, error: '判定結果の解析に失敗しました: ' + String(e.message || e).slice(0, 300) });
  }

  // 4) 転換質% = (購入済＋購入予定＋欲しい) ÷ 判定数。重み付けはしない（未検証の任意定数を入れないため）
  const c = judged.counts || {};
  const total = Number(judged.total) || data.replies.length;
  const hit = (Number(c.purchased) || 0) + (Number(c.willBuy) || 0) + (Number(c.want) || 0);
  const conversion = total > 0 ? +((hit / total) * 100).toFixed(1) : null;

  res.json(Object.assign({}, base, {
    conversion, total,
    counts: c,
    evidence: judged.evidence || {},
    note: judged.note || '',
    posts: data.posts,
    hasPRPost: !!data.hasPRPost,
    lowSample: total < 20,
  }));
});
```

- [ ] **Step 4: 構文チェック**

Run: `node --check cockpit-server.js`
Expected: 出力なし

- [ ] **Step 5: 構造の確認**

Run:
```bash
node -e "
const s=require('fs').readFileSync('cockpit-server.js','utf8');
console.log('x-intentルート定義数 =', (s.match(/app\.post\('\/api\/cockpit\/x-intent'/g)||[]).length, '(1が正)');
console.log('x-discoverルート定義数 =', (s.match(/app\.post\('\/api\/cockpit\/x-discover'/g)||[]).length, '(1が正)');
console.log('callClaudeJson定義数 =', (s.match(/async function callClaudeJson/g)||[]).length, '(1が正)');
console.log('buildXGenrePrompt import =', s.includes(\"require('./lib/x-genre-prompt')\"));
console.log('baseにprを含む =', /pr: data\.pr/.test(s));
console.log('旧インライン呼び出しが残っていない =', !/messages\.create\([\s\S]{0,200}buildXIntentPrompt/.test(s));
"
```
Expected: 全て `true` / 該当数は `1`

- [ ] **Step 6: リグレッションが無いことを確認**

Run: `npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"`
Expected: `fail 0`

- [ ] **Step 7: コミット**

```bash
git add cockpit-server.js
git commit -m "feat(s2d-4): add genre classification, always return PR stats"
```

---

## Task 5: 診断結果の表示とDB反映

**Files:**
- Modify: `public/cg-cockpit.html`

- [ ] **Step 1: 結果表示のブロックを差し替える**

`window.runXIntentBatch=async()=>{` の中にある、次のブロック（`if(!d||!d.ok)` から `done++;` を含む `}` まで）を探す:

```javascript
      if(!d||!d.ok){ cell.innerHTML=`<span style="color:#A32D2D"> エラー: ${escapeHtml((d&&d.error)||"失敗")}</span>`; }
      else if(d.conversion==null){
        cell.innerHTML=`<span style="color:var(--muted)"> ${escapeHtml(d.reason||"算出不可")}（懸賞除外${d.giveawayExcluded||0}件）</span>`;
      }else{
```

`}else{` 以降の転換質表示から `done++;` までを含めて、ブロック全体を次で置き換える:

```javascript
      if(!d||!d.ok){ cell.innerHTML=`<span style="color:#A32D2D"> エラー: ${escapeHtml((d&&d.error)||"失敗")}</span>`; }
      else{
        const pr=d.pr||{};
        // PR実績は転換質が出なくても表示する（PR投稿が多くリプライが少ない候補もあるため）
        const prLine=pr.tweets?`<br><span style="color:var(--muted);font-size:11.5px">PR投稿${pr.prCount}/${pr.tweets}件（${pr.prRate}%）`
          +`${pr.prEngage!=null?`／PRエンゲージ${pr.prEngage}%`:""}`
          +`${pr.nonPrEngage!=null?`／通常${pr.nonPrEngage}%`:""}`
          +`${pr.prLift!=null?`／<b style="color:${pr.prLift<30?"#A32D2D":pr.prLift<70?"#A35A2D":"#2D7A4F"}">PR係数${pr.prLift}%</b>`:""}`
          +`${pr.lowPrSample?' <b style="color:#A35A2D">⚠️PR件数少</b>':""}`
          +`${d.truncated?' <span style="color:var(--muted)">※取得上限</span>':""}</span>`:"";
        const genreLine=d.genre?` <span class="pill p-blue">${escapeHtml(d.genre)}</span>`:"";

        if(d.conversion==null){
          cell.innerHTML=`<span style="color:var(--muted)"> ${escapeHtml(d.reason||"転換質は算出不可")}（懸賞除外${d.giveawayExcluded||0}件）</span>`+genreLine+prLine;
        }else{
          const badge=d.conversion>=15?"p-green":d.conversion>=5?"p-orange":"p-gray";
          const c=d.counts||{}, ev=d.evidence||{};
          cell.innerHTML=` <span class="pill ${badge}">転換質${d.conversion}%</span>`+genreLine+
            `<span style="color:var(--muted)"> 購入済${c.purchased||0}／予定${c.willBuy||0}／欲しい${c.want||0}／興味${c.interest||0}／無関係${c.unrelated||0}（計${d.total}）${d.lowSample?' <b style="color:#A35A2D">⚠️サンプル不足</b>':""}</span>`+prLine;
          const ex=[...(ev.purchased||[]),...(ev.willBuy||[]),...(ev.want||[])].slice(0,3);
          if(ex.length) cell.innerHTML+=`<br><span style="color:var(--muted);font-size:11px">根拠: ${ex.map(t=>escapeHtml(String(t).slice(0,40))).join(" ／ ")}</span>`;
        }
        if((pr.prSamples||[]).length) cell.innerHTML+=`<br><span style="color:var(--muted);font-size:11px">PR投稿例: ${pr.prSamples.map(t=>escapeHtml(String(t).slice(0,40))).join(" ／ ")}</span>`;

        // 転換質が出なくてもPR実績・ジャンルは反映できるので、常に反映ボタンを出す
        const rb=document.createElement("button");
        rb.className="btn"; rb.style.cssText="margin-left:6px;padding:1px 7px;font-size:11px"; rb.textContent="DBに反映";
        rb.onclick=()=>registerCand({
          account:cand.account, media:"X",
          conversion:(d.conversion==null?"":d.conversion),
          prEngage:(pr.prEngage==null?"":pr.prEngage),
          genre:d.genre||"",
        }, rb);
        cell.appendChild(rb);
        done++;
      }
```

- [ ] **Step 2: カードの説明文を更新**

「🐦 X転換質診断（Apify＋Claude）」カードの説明文（`<p style="font-size:12.5px;color:var(--muted);margin-bottom:8px">` で始まり `懸賞・プレゼント企画の投稿は自動除外します。1件あたり1〜1.5分・最大20件。</p>` で終わる行）を、次で置き換える:

```html
      <p style="font-size:12.5px;color:var(--muted);margin-bottom:8px">候補DBのX候補について、転換質（リプライの購買意向）に加えて<b>PR実績・ジャンル</b>を診断します。懸賞・プレゼント企画の投稿は自動除外します。1件あたり1〜1.5分・最大20件。</p>
      <div class="note" style="margin-bottom:8px">📌 <b>PR係数</b>＝PR投稿のエンゲージ率÷通常投稿のエンゲージ率。100%なら「PRでも反応が落ちない」、低いほど「フォロワーは多いがPRでは動かない」。PRは本文中の「PR」表記で判定するため、<b>表記のない案件は検出できません</b>（PR投稿0件＝案件なし、とは限りません）。</div>
```

- [ ] **Step 3: ID重複と関数の健全性を確認**

Run:
```bash
node -e "
const s=require('fs').readFileSync('public/cg-cockpit.html','utf8');
console.log('runXIntentBatch定義数 =', (s.match(/window\.runXIntentBatch=/g)||[]).length, '(1が正)');
console.log('registerCand定義数 =', (s.match(/window\.registerCand=/g)||[]).length, '(1が正)');
console.log('PR係数の表示 =', s.includes('PR係数'));
console.log('prEngageの書き戻し =', /prEngage:\(pr\.prEngage==null/.test(s));
console.log('genreの書き戻し =', /genre:d\.genre\|\|\"\"/.test(s));
console.log('conversion==nullでも反映ボタン =', !/else if\(d\.conversion==null\)/.test(s));
"
```
Expected: 定義数は `1`、それ以外は全て `true`

- [ ] **Step 4: HTML内JSの構文チェック**

Run:
```bash
node -e "
const s=require('fs').readFileSync('public/cg-cockpit.html','utf8');
const blocks=[...s.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
blocks.forEach((b,i)=>{ try{ new Function(b); console.log('block'+i+': 構文OK'); }catch(e){ console.log('block'+i+': ★エラー '+e.message); } });
"
```
Expected: `block0: 構文OK`

- [ ] **Step 5: リグレッションが無いことを確認**

Run: `npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"`
Expected: `fail 0`

- [ ] **Step 6: コミット**

```bash
git add public/cg-cockpit.html
git commit -m "feat(s2d-4): show PR stats and genre in X diagnosis, write back to candidate DB"
```

---

## 完了後の確認（デプロイはユーザー作業）

**追加の環境変数は不要**（`APIFY_TOKEN`・`ANTHROPIC_API_KEY` とも設定済み）。

1. PRを作成しレビュー → マージ
2. **mainが最新であることを確認してから** `gcloud run deploy cg-cockpit --source . --region asia-northeast1`
3. `public/cg-cockpit.html` を Xserver（`/home/buzzreach/buzz-reach.net/public_html/`）へアップロード
4. 配信物のサイズとマーカーで反映を検証

**実データでの受け入れ確認（設計書の実測値と突き合わせる）**

- `@marunouchi__ol_` を診断 → PR率が **21%前後**、PR係数が**著しく低い値**になること（実測ではPR投稿185〜528いいねに対し非PRは1〜2万いいね）
- `@kaori_online` を診断 → PR率が **34%前後**になること
- ジャンルが妥当か目視（両者ともスキンケア or メイクが期待値）
- 「DBに反映」で候補DBの `ジャンル`・`PRエンゲージ%` が埋まること
- PR投稿0件の候補で「PR投稿なし」と出て、誤って0%と混同されないこと
