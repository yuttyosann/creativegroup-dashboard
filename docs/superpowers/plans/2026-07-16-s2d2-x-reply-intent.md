# S2d-2: X リプライ転換質診断（Apify＋Claude）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 候補DBのX候補のリプライをApifyで取得し、懸賞投稿を除外した上でClaudeが購買意向を判定して `転換質%` を埋める。

**Architecture:** 純粋関数（懸賞/PR/bot判定・プロンプト生成）を `lib/` に置き node:test で単体テスト。Apify I/Oは `scripts/apify/fetch_x_replies.js`。`POST /api/cockpit/x-intent` は**1アカウント/リクエスト**（Cloud Runの300秒制限のため。既存IG診断と同型でフロントがループ）。書き戻しは既存 `registerCand`＋`mergeInfluencer`（空でない値だけ上書き）を再利用。

**Tech Stack:** Node.js/Express、`@anthropic-ai/sdk`（`claude-sonnet-4-6`）、Apify（`apidojo~twitter-profile-scraper`）、axios、node:test、Vanilla JS。

参照設計書: `docs/superpowers/specs/2026-07-16-s2d2-x-reply-intent.md`

**作業ディレクトリ:** `/Users/yuttyo/claude/creativegroup-dashboard/.worktrees/s2d2`（ブランチ `docs/s2d2-x-reply-intent`）。
※メインの作業ツリーは別セッションが使用中のため、必ずこのworktree内で作業すること。

---

## File Structure

- **`lib/x-reply-filter.js`（新規）** — 懸賞/PR/bot判定と投稿選定の純粋関数のみ。外部依存なし。精度の要なので厚くテストする。
- **`test/x-reply-filter.test.js`（新規）** — 上記の単体テスト。
- **`lib/x-intent-prompt.js`（新規）** — Claude判定プロンプトの組み立てのみ。`lib/analyze-prompt.js` と同型。
- **`test/x-intent-prompt.test.js`（新規）** — 上記の単体テスト。
- **`scripts/apify/fetch_x_replies.js`（新規）** — Apify I/O＋上記libでの前処理。`@@JSON@@` 出力。外部API依存のため手動検証。
- **`cockpit-server.js`（修正）** — `runScriptJson` ヘルパ追加＋`POST /api/cockpit/x-intent`。
- **`public/cg-cockpit.html`（修正）** — 候補DBタブに「🐦 X転換質診断」カード＋逐次ループ。

Task 1→2 は独立。Task 3 は Task 1 に依存。Task 4 は Task 2・3 に依存。Task 5 は Task 4 に依存。順に実施すること。

---

### Task 1: 懸賞・PR・botフィルタ `lib/x-reply-filter.js`

**Files:**
- Create: `lib/x-reply-filter.js`
- Test: `test/x-reply-filter.test.js`

- [ ] **Step 1: Write the failing test**

`test/x-reply-filter.test.js` を作成:

```javascript
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { isGiveawayPost, isPRPost, selectPosts, cleanReplies } = require('../lib/x-reply-filter');

test('isGiveawayPost: 懸賞マーカーを検出する', () => {
  assert.ok(isGiveawayPost('【プレゼント企画】フォロー&RTで抽選5名様に当たる！'));
  assert.ok(isGiveawayPost('応募はこちらから'));
  assert.ok(isGiveawayPost('フォロー＆リポストで当選のチャンス'));
  assert.ok(isGiveawayPost('キャンペーン実施中'));
});

test('isGiveawayPost: 大文字小文字を問わない', () => {
  assert.ok(isGiveawayPost('フォロー&RTで参加'));
  assert.ok(isGiveawayPost('フォロー&rtで参加'));
});

test('isGiveawayPost: 通常のコスメ投稿は懸賞と判定しない', () => {
  assert.equal(isGiveawayPost('この美容液、毛穴に効いて最高だった。リピ確定です'), false);
});

test('isPRPost: PR表記を検出する', () => {
  assert.ok(isPRPost({ text: '#PR いただきました' }));
  assert.ok(isPRPost({ text: '案件です' }));
  assert.ok(isPRPost({ text: '提供：ABC社' }));
});

test('isPRPost: 通常投稿はPRと判定しない', () => {
  assert.equal(isPRPost({ text: '今日のメイク' }), false);
});

test('selectPosts: 懸賞を除外しリプライ数の多い順に上位maxPostsを返す', () => {
  const posts = [
    { text: '通常A', replyCount: 10 },
    { text: 'プレゼント企画', replyCount: 999 },
    { text: '通常B', replyCount: 30 },
    { text: '通常C', replyCount: 20 },
  ];
  assert.deepEqual(selectPosts(posts, { maxPosts: 2 }).map((p) => p.text), ['通常B', '通常C']);
});

test('selectPosts: 全部懸賞なら空配列', () => {
  assert.deepEqual(selectPosts([{ text: '抽選で当たる', replyCount: 100 }], { maxPosts: 5 }), []);
});

test('cleanReplies: 定型・URLのみ・絵文字のみ・空・重複を落とす', () => {
  const got = cleanReplies([
    { text: 'これ買いました！' },
    { text: 'フォローしました' },
    { text: 'https://example.com' },
    { text: '🎉🎉' },
    { text: 'これ買いました！' },
    { text: '' },
  ], { maxPerPost: 50 });
  assert.deepEqual(got, ['これ買いました！']);
});

test('cleanReplies: 懸賞目当てのリプライを落とし、通常の「欲しい」は残す', () => {
  assert.deepEqual(cleanReplies([{ text: '応募します！欲しい' }, { text: '普通に欲しい' }], {}), ['普通に欲しい']);
});

test('cleanReplies: 投稿者本人の自己リプ（連投）を除外する', () => {
  const got = cleanReplies([
    { text: '続きです', authorHandle: 'me' },
    { text: '買いました', authorHandle: 'fan' },
  ], { authorHandle: 'me' });
  assert.deepEqual(got, ['買いました']);
});

test('cleanReplies: maxPerPostで打ち切る', () => {
  const replies = Array.from({ length: 10 }, (_, i) => ({ text: 'コメント' + i }));
  assert.equal(cleanReplies(replies, { maxPerPost: 3 }).length, 3);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/x-reply-filter.test.js`
Expected: FAIL — `Cannot find module '../lib/x-reply-filter'`

- [ ] **Step 3: Write minimal implementation**

`lib/x-reply-filter.js` を作成:

```javascript
'use strict';
/**
 * x-reply-filter.js — Xリプライ転換質診断の前処理（純粋関数）
 *
 * Xはプレゼント企画・フォロー&RT懸賞のリプライが「欲しい」で溢れるため、
 * 懸賞投稿を除外しないと懸賞アカウントほど転換質が高く出る（逆転）。
 *
 * 【除外の設計原則】除外は「やや過剰」でよい。
 *   懸賞の取りこぼし → 指標が体系的に歪む（バイアス）
 *   通常投稿の過剰除外 → サンプルが減るだけでバイアスは生まない
 *   よって迷ったら除外する。
 */

const GIVEAWAY_MARKERS = [
  'プレゼント', '懸賞', '抽選', '応募', '当たる', '当選', 'キャンペーン',
  'フォロー&rt', 'フォロー＆rt', 'フォロー&リポスト', 'フォロー＆リポスト',
  'リポストで', 'rtで', 'giveaway',
];

// PR表記の精密マッチ（bare "pr" は誤検出するため使わない）。fetch_instagram.js の PR_MARKERS を踏襲
const PR_MARKERS = [
  '#pr', '#ad', '#提供', '#タイアップ', '提供:', '提供：', 'タイアップ',
  '案件', 'sponsored', 'アンバサダー',
];

// リプライの定型・bot・懸賞目当て
const NOISE_REPLY_MARKERS = [
  'フォローしました', '相互フォロー', '参加します', 'よろしくお願いします',
];

function norm(v) { return String(v == null ? '' : v).toLowerCase(); }

function isGiveawayPost(text) {
  const t = norm(text);
  return GIVEAWAY_MARKERS.some((m) => t.includes(m));
}

function isPRPost(post) {
  const t = norm((post && post.text) || '');
  return PR_MARKERS.some((m) => t.includes(m));
}

function selectPosts(posts, opts) {
  const maxPosts = (opts && opts.maxPosts) || 5;
  return (posts || [])
    .filter((p) => p && !isGiveawayPost(p.text))
    .slice()
    .sort((a, b) => (b.replyCount || 0) - (a.replyCount || 0))
    .slice(0, maxPosts);
}

function cleanReplies(replies, opts) {
  const maxPerPost = (opts && opts.maxPerPost) || 50;
  const author = opts && opts.authorHandle ? norm(opts.authorHandle) : '';
  const seen = new Set();
  const out = [];
  for (const r of replies || []) {
    const text = String((r && r.text) || '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    if (author && norm(r.authorHandle) === author) continue;   // 自己リプ（連投）
    if (/^https?:\/\/\S+$/.test(text)) continue;               // URLのみ
    if (!/[\p{L}\p{N}]/u.test(text)) continue;                 // 絵文字・記号のみ
    const t = norm(text);
    if (NOISE_REPLY_MARKERS.some((m) => t.includes(m))) continue;
    if (isGiveawayPost(text)) continue;                        // 懸賞目当てリプライ
    if (seen.has(t)) continue;                                 // 重複
    seen.add(t);
    out.push(text);
    if (out.length >= maxPerPost) break;
  }
  return out;
}

module.exports = {
  isGiveawayPost, isPRPost, selectPosts, cleanReplies,
  GIVEAWAY_MARKERS, PR_MARKERS, NOISE_REPLY_MARKERS,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/x-reply-filter.test.js`
Expected: PASS — `pass 11 / fail 0`

- [ ] **Step 5: Run the full suite (no regression)**

Run: `npm test 2>&1 | tail -8`
Expected: `fail 0`（既存57件＋新規11件＝68件がpass。`ERROR: failed to copy trust settings` の行は証明書関連のノイズで無関係）

- [ ] **Step 6: Commit**

```bash
git add lib/x-reply-filter.js test/x-reply-filter.test.js
git commit -m "feat(s2d-2): add X reply filter (giveaway/PR/bot) with tests"
```

---

### Task 2: 判定プロンプト `lib/x-intent-prompt.js`

**Files:**
- Create: `lib/x-intent-prompt.js`
- Test: `test/x-intent-prompt.test.js`

- [ ] **Step 1: Write the failing test**

`test/x-intent-prompt.test.js` を作成:

```javascript
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { buildXIntentPrompt } = require('../lib/x-intent-prompt');

test('アカウント名とリプライがuserプロンプトに差し込まれる', () => {
  const { system, user } = buildXIntentPrompt({ account: 'xqueen___a', replies: ['これ買いました', '欲しい'] });
  assert.ok(system.length > 0, 'systemが空でない');
  assert.match(user, /xqueen___a/);
  assert.match(user, /これ買いました/);
  assert.match(user, /欲しい/);
});

test('5分類とJSON出力形式の指示が含まれる', () => {
  const { user } = buildXIntentPrompt({ account: 'a', replies: ['x'] });
  assert.match(user, /purchased/);
  assert.match(user, /willBuy/);
  assert.match(user, /want/);
  assert.match(user, /interest/);
  assert.match(user, /unrelated/);
  assert.match(user, /"counts"/);
  assert.match(user, /"evidence"/);
});

test('懸賞目当ての「欲しい」をunrelatedに落とす指示が含まれる', () => {
  const { user } = buildXIntentPrompt({ account: 'a', replies: ['x'] });
  assert.match(user, /懸賞/);
  assert.match(user, /unrelated/);
});

test('リプライ件数と連番が本文に入る', () => {
  const { user } = buildXIntentPrompt({ account: 'a', replies: ['x', 'y', 'z'] });
  assert.match(user, /【リプライ（3件）】/);
  assert.match(user, /1\. x/);
  assert.match(user, /3\. z/);
});

test('account未指定・replies空はエラー', () => {
  assert.throws(() => buildXIntentPrompt({ replies: ['x'] }), /account/);
  assert.throws(() => buildXIntentPrompt({ account: 'a', replies: [] }), /replies/);
  assert.throws(() => buildXIntentPrompt({ account: 'a', replies: ['  '] }), /replies/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/x-intent-prompt.test.js`
Expected: FAIL — `Cannot find module '../lib/x-intent-prompt'`

- [ ] **Step 3: Write minimal implementation**

`lib/x-intent-prompt.js` を作成:

```javascript
'use strict';
/**
 * x-intent-prompt.js — Xリプライの購買意向判定プロンプト（純粋関数）
 * 設計は docs/superpowers/specs/2026-07-16-s2d2-x-reply-intent.md を正とする。
 */

const SYSTEM =
  'あなたはCreative GroupのX(旧Twitter)リプライ分析の専門アナリストです。' +
  '提示されたリプライのみを根拠に各リプライの購買意向を分類し、指定のJSONのみを出力してください。' +
  '説明文・前置き・コードフェンスは一切出力しないでください。';

const TEMPLATE = `以下は X アカウント @{{account}} の投稿に付いたリプライです。
各リプライを購買意向で5分類し、集計結果をJSONで返してください。

【分類】
- purchased（購入済）: 既に買った・使っている（例:「買いました」「届いた」「リピしてる」）
- willBuy（購入予定）: 買う意思が明確（例:「絶対買う」「ポチる」「注文してくる」）
- want（欲しい）: 欲しいが購入意思は未確定（例:「欲しい」「気になる」「どこで買えますか」）
- interest（興味）: 商品ではなく投稿者・投稿への反応（例:「かわいい」「参考になる」）
- unrelated（無関係）: 雑談・挨拶・スパム

【重要】懸賞・プレゼント企画目当ての「欲しい」は購買意向ではありません。unrelated に分類してください。
文脈から懸賞目当てと判断できるものを want に入れないでください。

【リプライ（{{count}}件）】
{{replies}}

【出力】次のJSONのみを出力（説明文なし）。evidenceは各ラベル最大3件、リプライ本文をそのまま引用。
{
  "total": 判定したリプライ数,
  "counts": { "purchased": 0, "willBuy": 0, "want": 0, "interest": 0, "unrelated": 0 },
  "evidence": { "purchased": [], "willBuy": [], "want": [] },
  "note": "気になった点（80字以内・無ければ空文字）"
}`;

function fill(template, values) {
  return template.replace(/{{(\w+)}}/g, (_, k) => {
    if (!(k in values)) throw new Error('テンプレートキーが見つかりません: ' + k);
    return String(values[k]);
  });
}

function buildXIntentPrompt(payload) {
  payload = payload || {};
  const account = String(payload.account || '').trim().replace(/^@/, '');
  if (!account) throw new Error('必須項目が不足しています: account');
  const list = Array.isArray(payload.replies) ? payload.replies : [];
  const replies = list.map((r) => String(r == null ? '' : r).replace(/\s+/g, ' ').trim()).filter((r) => r);
  if (!replies.length) throw new Error('必須項目が不足しています: replies');
  const numbered = replies.map((r, i) => `${i + 1}. ${r}`).join('\n');
  return { system: SYSTEM, user: fill(TEMPLATE, { account, count: replies.length, replies: numbered }) };
}

module.exports = { buildXIntentPrompt };
```

注: `TEMPLATE` 内のJSON例には `{` が単独で現れるが、`fill` の正規表現は `{{word}}` の二重波括弧のみに一致するため干渉しない。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/x-intent-prompt.test.js`
Expected: PASS — `pass 5 / fail 0`

- [ ] **Step 5: Commit**

```bash
git add lib/x-intent-prompt.js test/x-intent-prompt.test.js
git commit -m "feat(s2d-2): add X reply intent prompt builder with tests"
```

---

### Task 3: Apify取得スクリプト `scripts/apify/fetch_x_replies.js`

**Files:**
- Create: `scripts/apify/fetch_x_replies.js`

外部API依存のため node:test は書かず**手動検証**（既存 `fetch_instagram.js`・Astream系と同じ扱い）。

- [ ] **Step 1: Write the implementation**

`scripts/apify/fetch_x_replies.js` を作成:

```javascript
/**
 * Apify 外部API — X(旧Twitter) プロフィールのツイート＋リプライ取得＆前処理
 *
 * Xは懸賞・プレゼント企画のリプライが「欲しい」で溢れるため、
 * lib/x-reply-filter で懸賞投稿を除外してから対象リプライを返す。
 * 購買意向の判定そのものは呼び出し側（cockpit-server の /api/cockpit/x-intent）がClaudeで行う。
 *
 * 【事前準備】APIFY_TOKEN（https://apify.com → Settings → Integrations → API token）
 *
 * 【使い方】
 *   node scripts/apify/fetch_x_replies.js <handle> --json   # 正規化して @@JSON@@ 出力
 *   node scripts/apify/fetch_x_replies.js <handle> --dump   # Apifyの生JSONを確認（構造検証用）
 *
 * 【コスト目安】1アカウント ≒ $0.1前後
 */
require('dotenv').config();
const axios = require('axios');
const { selectPosts, cleanReplies, isPRPost, isGiveawayPost } = require('../../lib/x-reply-filter');

const TOKEN = process.env.APIFY_TOKEN;
if (!TOKEN) {
  console.error('❌ APIFY_TOKEN がありません。https://apify.com → Settings → Integrations → API token を設定してください。');
  process.exit(1);
}

const ACTOR = 'apidojo~twitter-profile-scraper';
const MAX_POSTS = 5, MAX_REPLIES_PER_POST = 50, DAYS = 90, MIN_REPLY_COUNT = 5, MAX_ITEMS = 300;

const args = process.argv.slice(2);
const handle = (args.find((a) => !a.startsWith('--')) || '').replace(/^@/, '');
if (!handle) {
  console.error('使い方: node scripts/apify/fetch_x_replies.js <handle> --json');
  process.exit(1);
}

function sinceDate(days) {
  return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
}

async function runActor(input) {
  const url = `https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items?token=${TOKEN}`;
  const res = await axios.post(url, input, { timeout: 180000, headers: { 'Content-Type': 'application/json' } });
  return res.data;
}

// Apifyのitemを共通形へ。実レスポンスの揺れに備えて複数のキー名を許容する
function normalize(it) {
  it = it || {};
  const author = it.author || {};
  return {
    id: String(it.id || it.id_str || it.tweetId || ''),
    text: it.text || it.full_text || it.fullText || '',
    url: it.url || it.twitterUrl || '',
    replyCount: Number(it.replyCount != null ? it.replyCount : it.reply_count) || 0,
    isReply: Boolean(it.isReply || it.inReplyToId || it.in_reply_to_status_id_str),
    parentId: String(it.inReplyToId || it.in_reply_to_status_id_str || it.conversationId || ''),
    authorHandle: author.userName || author.screen_name || it.userName || '',
  };
}

(async () => {
  const input = {
    twitterHandles: [handle],
    getReplies: true,
    start: sinceDate(DAYS),
    minReplyCount: MIN_REPLY_COUNT,
    maxItems: MAX_ITEMS,
  };

  let items;
  try {
    items = await runActor(input);
  } catch (e) {
    console.error('Apify実行に失敗: ' + ((e.response && e.response.status) || e.message));
    process.exit(1);
  }

  if (args.includes('--dump')) {
    console.log(JSON.stringify(items, null, 2).slice(0, 20000));
    return;
  }

  const all = (items || []).map(normalize).filter((x) => x.text);
  const own = (x) => !x.authorHandle || x.authorHandle.toLowerCase() === handle.toLowerCase();
  const tweets = all.filter((x) => !x.isReply && own(x));
  const replies = all.filter((x) => x.isReply);

  const giveawayExcluded = tweets.filter((t) => isGiveawayPost(t.text)).length;
  const picked = selectPosts(tweets, { maxPosts: MAX_POSTS });

  const targetReplies = [];
  for (const p of picked) {
    const rs = replies.filter((r) => r.parentId && r.parentId === p.id);
    targetReplies.push(...cleanReplies(rs, { maxPerPost: MAX_REPLIES_PER_POST, authorHandle: handle }));
  }

  let note = '';
  if (!picked.length) note = '対象投稿なし（懸賞のみ、または投稿取得不可）';
  else if (replies.length && !targetReplies.length) note = 'リプライは取得できたが親投稿と紐づきません（normalize()のparentId対応を要確認）';

  console.log('@@JSON@@' + JSON.stringify({
    ok: true,
    account: handle,
    posts: picked.length,
    giveawayExcluded,
    hasPRPost: picked.some((p) => isPRPost(p)),
    replies: targetReplies,
    note,
  }));
})();
```

- [ ] **Step 2: Verify the script loads and guards correctly (no Apify call)**

Run: `node -e "require('./lib/x-reply-filter'); console.log('lib OK')"`
Expected: `lib OK`

Run: `APIFY_TOKEN= node scripts/apify/fetch_x_replies.js someone --json; echo "exit=$?"`
Expected: `❌ APIFY_TOKEN がありません…` と `exit=1`

Run: `APIFY_TOKEN=dummy node scripts/apify/fetch_x_replies.js --json; echo "exit=$?"`
Expected: `使い方: node scripts/apify/fetch_x_replies.js <handle> --json` と `exit=1`（handle未指定）

- [ ] **Step 3: Verify the actor response shape with a real call (要APIFY_TOKEN)**

**この手順は `APIFY_TOKEN` が無い場合は実行できない。** その場合はこのステップを SKIP し、
「未実施」であることを最終報告に明記すること（勝手に成功扱いにしない）。

Run: `node scripts/apify/fetch_x_replies.js <実在するXコスメアカウント> --dump | head -60`
Expected: Apifyの生JSON。以下を目視で確認する:
- ツイートの本文フィールドが `text` か（`full_text`/`fullText` のどれか）
- リプライが `isReply` / `inReplyToId` / `conversationId` のどれで親と紐づくか
- 投稿者ハンドルが `author.userName` か `userName` か

`normalize()` の想定と実レスポンスがズレていたら **`normalize()` を実データに合わせて直す**。
直した内容を最終報告に書くこと。

- [ ] **Step 4: Verify the normalized output (要APIFY_TOKEN)**

Run: `node scripts/apify/fetch_x_replies.js <同じアカウント> --json`
Expected: `@@JSON@@{"ok":true,"account":"...","posts":N,"giveawayExcluded":N,"hasPRPost":bool,"replies":[...],"note":""}`
- `replies` に実際のリプライ本文が入っている（空配列でない）
- `note` が `リプライは取得できたが親投稿と紐づきません…` でない（出たら `parentId` の対応が誤り）

`APIFY_TOKEN` が無い場合は SKIP し、未実施と報告すること。

- [ ] **Step 5: Commit**

```bash
git add scripts/apify/fetch_x_replies.js
git commit -m "feat(s2d-2): add Apify X replies fetch script"
```

---

### Task 4: サーバー `runScriptJson` ＋ `POST /api/cockpit/x-intent`

**Files:**
- Modify: `cockpit-server.js`（require追加＝40行目付近／ヘルパ追加＝`runScriptThen` の直後・102行目付近／ルート追加＝`/api/cockpit/analyze` の直後・192行目付近）

- [ ] **Step 1: Add the require**

`cockpit-server.js` の `const { buildAnalyzePrompt } = require('./lib/analyze-prompt');`（40行目）の直後に追加:

```javascript
const { buildXIntentPrompt } = require('./lib/x-intent-prompt');
```

- [ ] **Step 2: Add the `runScriptJson` helper**

`runScriptThen` 関数の閉じ `}`（102行目付近）の直後に追加:

```javascript
// スクリプトを実行して @@JSON@@ をPromiseで返す版。
// runScriptThen は after() の例外を握り潰して「実行に失敗しました」に丸めるため、
// 取得段と判定段のエラーを区別したい呼び出し元はこちらを使う。
function runScriptJson(scriptRel, scriptArgs) {
  const script = path.join(__dirname, scriptRel);
  return new Promise((resolve, reject) => {
    execFile('node', [script, ...scriptArgs], { cwd: __dirname, timeout: 180000, maxBuffer: 10 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const marker = (stdout || '').split('\n').find((l) => l.startsWith('@@JSON@@'));
        if (marker) {
          try { return resolve(JSON.parse(marker.slice(8))); } catch (e) { /* 下のrejectへ */ }
        }
        reject(new Error(String(stderr || (err && err.message) || 'JSON出力が見つかりませんでした').slice(0, 400)));
      });
  });
}
```

- [ ] **Step 3: Add the route**

`app.post('/api/cockpit/analyze', ...)` ブロックの閉じ `});`（192行目付近）の直後に追加:

```javascript
// X リプライ転換質診断（Apify取得＋Claude判定）— 1アカウントずつ（フロントで複数ループ）
// Cloud Runのリクエストタイムアウトが300秒のため、バッチ処理にはしない（既存のIG診断と同型）
app.post('/api/cockpit/x-intent', requireAuth, async (req, res) => {
  const account = String((req.body || {}).account || '').trim().replace(/^@/, '');
  if (!account) return res.status(400).json({ ok: false, error: 'アカウント名を入力してください' });
  if (!process.env.APIFY_TOKEN) return res.status(400).json({ ok: false, error: 'APIFY_TOKEN未設定（Cloud Runの環境変数に追加してください）' });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(400).json({ ok: false, error: 'ANTHROPIC_API_KEY未設定（Cloud Runの環境変数に追加してください）' });

  // 1) Apify取得＋懸賞投稿の除外
  let data;
  try {
    data = await runScriptJson('scripts/apify/fetch_x_replies.js', [account, '--json']);
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'リプライ取得に失敗しました: ' + String(e.message || e).slice(0, 400) });
  }
  // 「対象投稿なし」は 0% と意味が違う（0%＝反応はあるが買う気ゼロ）ので conversion を null で返す
  if (!data.posts) {
    return res.json({ ok: true, account, conversion: null, reason: data.note || '対象投稿なし（懸賞のみ）', posts: 0, giveawayExcluded: data.giveawayExcluded || 0 });
  }
  if (!data.replies || !data.replies.length) {
    return res.json({ ok: true, account, conversion: null, reason: data.note || '判定対象のリプライがありません', posts: data.posts, giveawayExcluded: data.giveawayExcluded || 0 });
  }

  // 2) Claude判定
  let prompt;
  try { prompt = buildXIntentPrompt({ account, replies: data.replies }); }
  catch (e) { return res.status(400).json({ ok: false, error: e.message }); }

  let judged;
  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 120000 });
    const msg = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: prompt.system,
      messages: [{ role: 'user', content: prompt.user }],
    });
    const text = (msg.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('JSONが見つかりません');
    judged = JSON.parse(m[0]);
  } catch (e) {
    return res.status(500).json({ ok: false, error: '判定結果の解析に失敗しました: ' + String(e.message || e).slice(0, 300) });
  }

  // 3) 転換質% = (購入済＋購入予定＋欲しい) ÷ 判定数。重み付けはしない（未検証の任意定数を入れないため）
  const c = judged.counts || {};
  const total = Number(judged.total) || data.replies.length;
  const hit = (Number(c.purchased) || 0) + (Number(c.willBuy) || 0) + (Number(c.want) || 0);
  const conversion = total > 0 ? +((hit / total) * 100).toFixed(1) : null;

  res.json({
    ok: true, account, conversion, total,
    counts: c,
    evidence: judged.evidence || {},
    note: judged.note || '',
    posts: data.posts,
    giveawayExcluded: data.giveawayExcluded || 0,
    hasPRPost: !!data.hasPRPost,
    lowSample: total < 20,
  });
});
```

- [ ] **Step 4: Verify syntax and route registration**

Run: `node --check cockpit-server.js && echo "SYNTAX OK"`
Expected: `SYNTAX OK`

Run: `node -e "const s=require('fs').readFileSync('cockpit-server.js','utf8'); console.log(['/api/cockpit/x-intent','runScriptJson','buildXIntentPrompt'].map(k=>k+'='+s.includes(k)).join(' '))"`
Expected: `/api/cockpit/x-intent=true runScriptJson=true buildXIntentPrompt=true`

- [ ] **Step 5: Run the full suite (no regression)**

Run: `npm test 2>&1 | tail -8`
Expected: `fail 0`

- [ ] **Step 6: Commit**

```bash
git add cockpit-server.js
git commit -m "feat(s2d-2): add /api/cockpit/x-intent endpoint"
```

---

### Task 5: コックピット「🐦 X転換質診断」カード

**Files:**
- Modify: `public/cg-cockpit.html`（カード追加＝`idb()` 内・`<div id="idb_list" ...></div></div>` の直後・298行目付近／JS追加＝`applyIdbFilter` の閉じ `};` の直後・802行目付近）

- [ ] **Step 1: Add the card**

`idb()` が返すHTML内、`<div id="idb_list" style="margin-top:6px;font-size:12.5px">読み込み中…</div></div>`（298行目）の直後、
`<div class="card"><h3>＋ 手動で候補を追加</h3>` の直前に挿入:

```html
    <div class="card"><h3>🐦 X転換質診断（Apify＋Claude）</h3>
      <p style="font-size:12.5px;color:var(--muted);margin-bottom:8px">候補DBのX候補のリプライを取得し、購買意向を判定して「転換質%」を埋めます。懸賞・プレゼント企画の投稿は自動除外します。1件あたり1〜1.5分・最大20件。</p>
      <div class="note" style="margin-bottom:8px">⚠️ v0.1・未較正：<b>X内の相対比較にのみ</b>使用してください。YouTube/IGの転換質とは較正されていないため、媒体をまたいで並べないでください。要 APIFY_TOKEN。</div>
      <div style="margin-bottom:8px">
        <button class="btn" style="background:var(--purple)" onclick="loadXCands()">X候補を読み込む</button>
        <button class="btn" id="xibtn" onclick="runXIntentBatch()">選択した候補を診断</button>
      </div>
      <div id="xi_list" style="font-size:12.5px"></div>
      <div id="xi_result" style="margin-top:10px;font-size:13px"></div>
    </div>
```

- [ ] **Step 2: Add the JS**

`window.applyIdbFilter=()=>{...};` ブロックの閉じ `};`（802行目付近、`// 候補をDBにupsert登録` コメントの直前）の直後に挿入:

```javascript
// X転換質診断（S2d-2）— 候補DBのX候補を1件ずつ診断（Cloud Runの300秒制限のためバッチにしない）
window.loadXCands=()=>{
  const el=document.getElementById("xi_list");
  const xs=(IDB_ALL||[]).filter(x=>x.media==="X");
  if(!xs.length){ el.innerHTML="<span style='color:var(--muted)'>X候補がありません。上の「再読込」を押すか、診断タブの「Astream X CSV取込」で登録してください。</span>"; return; }
  window.__xiCands=xs;
  el.innerHTML=`<div style="font-size:12px;color:var(--muted);margin-bottom:6px">X候補 ${xs.length}件（最大20件まで選択可）</div>`+
    xs.map((x,i)=>`<div style="padding:4px 0;border-bottom:1px solid var(--line)">
      <input type="checkbox" class="xi_ck" data-i="${i}" style="width:auto;margin-right:6px">
      <b>@${escapeHtml(x.account)}</b>
      ${x.conversion?`<span class="pill p-gray">現在 転換質${escapeHtml(x.conversion)}%</span>`:`<span class="pill p-gray">未診断</span>`}
      <span style="color:var(--muted);font-size:11.5px">フォロワー${(num(x.followers)||0).toLocaleString()}</span>
      <span id="xi_cell${i}" style="font-size:11.5px"></span></div>`).join("");
};

window.runXIntentBatch=async()=>{
  const btn=document.getElementById("xibtn"), res=document.getElementById("xi_result");
  const cks=[...document.querySelectorAll(".xi_ck:checked")];
  if(!cks.length){ res.innerHTML="<span style='color:#A32D2D'>診断する候補を選択してください</span>"; return; }
  if(cks.length>20){ res.innerHTML="<span style='color:#A32D2D'>一度に診断できるのは20件までです</span>"; return; }
  btn.disabled=true; res.innerHTML="";
  let done=0;
  for(const ck of cks){
    const i=+ck.dataset.i, cand=window.__xiCands[i], cell=document.getElementById("xi_cell"+i);
    btn.textContent=`診断中… ${done}/${cks.length}`;
    cell.innerHTML=" ⏳ 実行中…（1〜1.5分）";
    try{
      const d=await api("/api/cockpit/x-intent",{account:cand.account});
      if(!d||!d.ok){ cell.innerHTML=`<span style="color:#A32D2D"> エラー: ${escapeHtml((d&&d.error)||"失敗")}</span>`; }
      else if(d.conversion==null){
        cell.innerHTML=`<span style="color:var(--muted)"> ${escapeHtml(d.reason||"算出不可")}（懸賞除外${d.giveawayExcluded||0}件）</span>`;
      }else{
        const badge=d.conversion>=15?"p-green":d.conversion>=5?"p-orange":"p-gray";
        const c=d.counts||{}, ev=d.evidence||{};
        cell.innerHTML=` <span class="pill ${badge}">転換質${d.conversion}%</span>`+
          `<span style="color:var(--muted)"> 購入済${c.purchased||0}／予定${c.willBuy||0}／欲しい${c.want||0}／興味${c.interest||0}／無関係${c.unrelated||0}（計${d.total}）${d.lowSample?' <b style="color:#A35A2D">⚠️サンプル不足</b>':""}</span>`;
        const ex=[...(ev.purchased||[]),...(ev.willBuy||[]),...(ev.want||[])].slice(0,3);
        if(ex.length) cell.innerHTML+=`<br><span style="color:var(--muted);font-size:11px">根拠: ${ex.map(t=>escapeHtml(String(t).slice(0,40))).join(" ／ ")}</span>`;
        const rb=document.createElement("button");
        rb.className="btn"; rb.style.cssText="margin-left:6px;padding:1px 7px;font-size:11px"; rb.textContent="DBに反映";
        rb.onclick=()=>registerCand({account:cand.account, media:"X", conversion:d.conversion}, rb);
        cell.appendChild(rb);
        done++;
      }
    }catch(e){ cell.innerHTML=`<span style="color:#A32D2D"> ${escapeHtml(e.message||"失敗")}</span>`; }
  }
  btn.disabled=false; btn.textContent="選択した候補を診断";
  res.innerHTML=`✅ ${done}/${cks.length}件の診断が完了しました。各行の「DBに反映」で候補DBの転換質%が更新されます。`;
};
```

注: `registerCand({account, media:'X', conversion})` は `mergeInfluencer` が空でない値だけ上書きするため、
S2d-1が入れたフォロワー・適性メモ・URLは保持される（`lib/influencer-store.js:42-49` で確認済み）。

- [ ] **Step 3: Verify IDs, helper reuse, and balance**

Run: `node -e "
const s=require('fs').readFileSync('public/cg-cockpit.html','utf8');
const ids=['asxcsv','ascsv','xi_list','xi_result','xibtn'];
ids.forEach(id=>console.log(id+' 出現数='+(s.match(new RegExp('id=\"'+id+'\"','g'))||[]).length));
['loadXCands','runXIntentBatch','__xiCands'].forEach(k=>console.log(k+'='+s.includes(k)));
"`
Expected: `xi_list`・`xi_result`・`xibtn` が各1、`asxcsv`/`ascsv` は各1（衝突なし）、3つの関数名が `true`

`escapeHtml`・`num`・`api`・`registerCand`・`IDB_ALL` は既存定義を再利用すること（**再定義しない**）。

- [ ] **Step 4: Run the full suite (no regression)**

Run: `npm test 2>&1 | tail -8`
Expected: `fail 0`

- [ ] **Step 5: Commit**

```bash
git add public/cg-cockpit.html
git commit -m "feat(s2d-2): add X reply intent card to cockpit candidate DB tab"
```

---

## デプロイ / 設定手順（ユーザー作業・実装後）

1. **`APIFY_TOKEN` を Cloud Run に設定（未設定のため必須。これが無いと動かない）**
   ```
   gcloud run services update cg-cockpit --region asia-northeast1 \
     --update-env-vars APIFY_TOKEN=<Apifyのトークン>
   ```
2. コックピット再デプロイ（GAS不要・新Sheetsタブなし）
3. 最新 `public/cg-cockpit.html` を Xserver に再アップロード
4. **懸賞垢を1件混ぜて診断し、転換質が不当に高く出ないことを確認**（本設計の要）

---

## Self-Review（spec照合）

- **ゴール1（フィルタ純粋関数）** → Task 1。`isGiveawayPost`/`isPRPost`/`selectPosts`/`cleanReplies` とマーカー定義、11本のテスト。
- **ゴール2（プロンプトビルダー）** → Task 2。`buildXIntentPrompt`・5分類・JSON形式・懸賞→unrelated指示、5本のテスト。
- **ゴール3（Apifyスクリプト）** → Task 3。`apidojo~twitter-profile-scraper`・`twitterHandles`/`getReplies`/`start`/`minReplyCount`/`maxItems`、`--dump` で実レスポンス検証。
- **ゴール4（エンドポイント・1アカウント/リクエスト）** → Task 4。`runScriptJson` で取得段と判定段のエラーを分離。
- **ゴール5（候補DBタブのカード）** → Task 5。X候補一覧＋チェックボックス→逐次診断→根拠表示→`registerCand` で書き戻し。
- **転換質%の定義** → Task 4 Step 3。`(purchased+willBuy+want)/total*100`、重み付けなし、内訳は全返却。
- **エラー設計** → Task 4: APIFY_TOKEN/ANTHROPIC_API_KEY未設定・取得失敗・**対象ゼロはconversion=nullで0%と区別**・JSONパース失敗。Task 5: 選択0件/20件超・ループ継続・`lowSample`警告表示。
- **較正スタンス** → Task 5 Step 1 のカード内 `note`（v0.1・未較正・X内比較のみ）に明示。
- **サンプリング** → Task 3 の定数（`MAX_POSTS=5`・`MAX_REPLIES_PER_POST=50`・`DAYS=90`・`MIN_REPLY_COUNT=5`・`MAX_ITEMS=300`）。
- **非ゴール**（媒体横断較正・客層取得・YouTube/IGロジック変更・診断ログ記録）はいずれのタスクにも含めていない。
- **未確定事項（アクターのレスポンス形状）** → Task 3 Step 3 で `--dump` により実データで確定させ、ズレたら `normalize()` を直して報告する手順を明記。
- **プレースホルダ:** なし（全ステップに実コードと期待出力を記載）。
- **型・名称の整合:** `conversion`（数値/null）・`counts.{purchased,willBuy,want,interest,unrelated}`・`evidence.{purchased,willBuy,want}`・`lowSample`・`giveawayExcluded`・`posts`・`note`/`reason` を Task 3→4→5 で一貫使用。`x-reply-filter` の4関数名も Task 1→3 で一致。
