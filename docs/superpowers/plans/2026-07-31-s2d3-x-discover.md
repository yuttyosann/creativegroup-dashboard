# S2d-3: X候補検索（Apifyキーワード検索）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** キーワード（カテゴリ語・商品/ブランド名）でXアカウントを発掘し、企業公式・懸賞垢・botを除外したうえでエンゲージ率順に並べ、候補DBに登録できるようにする。

**Architecture:** S2d-2で作った構造をそのまま踏襲する。純粋関数（`lib/`）＋Apify呼び出しスクリプト（`scripts/apify/`）＋`runScriptJson` を使うエンドポイント（`cockpit-server.js`）＋既存カードと同じ形のUI（`public/cg-cockpit.html`）。新しいインフラは増やさない。検索は300件でも数十秒で終わるため、S2d-2の転換質診断と違い1リクエストで完結する。

**Tech Stack:** Node.js / Express / `node:test` / Apify `apidojo~tweet-scraper` / Vanilla JS

**設計書:** `docs/superpowers/specs/2026-07-27-s2d3-x-discover-design.md`

---

## ファイル構成

| ファイル | 種別 | 責務 |
|---|---|---|
| `lib/x-account-filter.js` | 新規 | 除外判定・投稿者集約・エンゲージ率（純粋関数のみ。I/Oを持たない） |
| `test/x-account-filter.test.js` | 新規 | 上記の単体テスト |
| `scripts/apify/discover_x.js` | 新規 | Apify呼び出し＋正規化＋`@@JSON@@` 出力。判定ロジックは持たず `lib/` に委譲 |
| `cockpit-server.js` | 修正 | `POST /api/cockpit/x-discover` を追加 |
| `public/cg-cockpit.html` | 修正 | ①X候補検索カード追加 ②Astream X CSV移設 ③YouTube検索に登録ボタン |

`lib/x-reply-filter.js`（S2d-2）は**変更しない**。`isGiveawayPost` を import して再利用する。

---

## Task 1: 除外判定・集約の純粋関数

**Files:**
- Create: `lib/x-account-filter.js`
- Test: `test/x-account-filter.test.js`

- [ ] **Step 1: 失敗するテストを書く**

Create `test/x-account-filter.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  isOfficialAccount, isBotAccount, classifyAccount,
  engagementRate, aggregateAuthors, sortByRate,
} = require('../lib/x-account-filter');

test('isOfficialAccount: 公式・企業を検出する', () => {
  assert.equal(isOfficialAccount({ name: '◯◯コスメ公式', description: '' }), true);
  assert.equal(isOfficialAccount({ name: 'ABC', description: '株式会社ABCの公式アカウントです' }), true);
  assert.equal(isOfficialAccount({ name: 'ABC Store', description: 'Official account' }), true);
});

test('isOfficialAccount: 一般ユーザーを誤検出しない', () => {
  assert.equal(isOfficialAccount({ name: 'みか', description: '毛穴ケア好きな会社員です' }), false);
  assert.equal(isOfficialAccount({ name: 'コスメ垢', description: '購入品レビューしてます' }), false);
});

test('isBotAccount: bot・まとめ・ニュースを検出する', () => {
  assert.equal(isBotAccount({ name: 'コスメbot', description: '' }), true);
  assert.equal(isBotAccount({ name: '', description: '美容ニュースをまとめて配信' }), true);
  assert.equal(isBotAccount({ name: 'みか', description: 'スキンケア好き' }), false);
});

test('classifyAccount: 懸賞はプロフィールで除外する', () => {
  const r = classifyAccount({ name: '懸賞垢', description: '懸賞・プレゼント応募専用' }, []);
  assert.equal(r.excluded, true);
  assert.equal(r.reason, '懸賞');
});

test('classifyAccount: 懸賞ツイートが過半なら除外する', () => {
  const tweets = [
    { text: 'このプレゼント企画に応募します' },
    { text: 'フォロー&RTで当たる！' },
    { text: '化粧水を買いました' },
  ];
  const r = classifyAccount({ name: 'みか', description: 'コスメ好き' }, tweets);
  assert.equal(r.excluded, true);
  assert.equal(r.reason, '懸賞');
});

test('classifyAccount: 懸賞が1件だけなら除外しない（一般ユーザーを失わない）', () => {
  const tweets = [
    { text: 'このプレゼント企画に応募します' },
    { text: '化粧水を買いました' },
    { text: '毛穴ケアの話' },
  ];
  const r = classifyAccount({ name: 'みか', description: 'コスメ好き' }, tweets);
  assert.equal(r.excluded, false);
  assert.equal(r.reason, null);
});

test('classifyAccount: 通常アカウントは除外しない', () => {
  const r = classifyAccount({ name: 'みか', description: 'スキンケア好きです' }, [{ text: '化粧水いい' }]);
  assert.deepEqual(r, { excluded: false, reason: null });
});

test('engagementRate: (いいね+RT)÷フォロワー×100 を小数1桁で返す', () => {
  assert.equal(engagementRate(100, 20, 10000), 1.2);
});

test('engagementRate: フォロワー100未満は null（分母が小さく率が無意味）', () => {
  assert.equal(engagementRate(50, 10, 99), null);
});

test('engagementRate: フォロワー0でゼロ除算しない', () => {
  assert.equal(engagementRate(50, 10, 0), null);
});

test('aggregateAuthors: 同一アカウントを1件に集約し平均を取る', () => {
  const tweets = [
    { text: 'a', likeCount: 100, retweetCount: 10, replyCount: 2, viewCount: 1000,
      author: { userName: 'mika', name: 'みか', description: 'コスメ好き', followers: 10000 } },
    { text: 'b', likeCount: 200, retweetCount: 30, replyCount: 4, viewCount: 3000,
      author: { userName: 'mika', name: 'みか', description: 'コスメ好き', followers: 10000 } },
  ];
  const out = aggregateAuthors(tweets);
  assert.equal(out.length, 1);
  assert.equal(out[0].account, 'mika');
  assert.equal(out[0].hits, 2);
  assert.equal(out[0].avgLike, 150);
  assert.equal(out[0].avgRt, 20);
  assert.equal(out[0].rate, 1.7);
  assert.equal(out[0].excluded, false);
});

test('aggregateAuthors: userNameが無いツイートは捨てる', () => {
  const out = aggregateAuthors([{ text: 'x', author: {} }]);
  assert.equal(out.length, 0);
});

test('aggregateAuthors: 除外対象にも理由を付けて返す（消さない）', () => {
  const tweets = [
    { text: 'a', likeCount: 10, retweetCount: 1, viewCount: 100,
      author: { userName: 'brand', name: '◯◯公式', description: '', followers: 50000 } },
  ];
  const out = aggregateAuthors(tweets);
  assert.equal(out.length, 1);
  assert.equal(out[0].excluded, true);
  assert.equal(out[0].reason, '公式');
});

test('sortByRate: エンゲージ率の降順・nullは末尾', () => {
  const out = sortByRate([{ rate: 1.0 }, { rate: null }, { rate: 3.0 }]);
  assert.deepEqual(out.map((x) => x.rate), [3.0, 1.0, null]);
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `node --test test/x-account-filter.test.js`
Expected: FAIL（`Cannot find module '../lib/x-account-filter'`）

- [ ] **Step 3: 最小実装を書く**

Create `lib/x-account-filter.js`:

```js
'use strict';
/**
 * x-account-filter.js — X候補検索の投稿者集約・除外（純粋関数）
 *
 * カテゴリ語で検索すると、企業公式・懸賞垢・botが必ず上位に混ざる。
 * これらを除外しないと候補一覧が実用にならない。
 *
 * 【S2d-2との違い】除外したものを消さずに理由付きで返す。
 *   S2d-2（転換質診断）の過剰除外はサンプルが減るだけだが、
 *   検索での過剰除外は候補そのものを失うため、人間が誤除外に気づけるようにする。
 */

const { isGiveawayPost } = require('./x-reply-filter');

const OFFICIAL_MARKERS = [
  '公式', 'official', '株式会社', '有限会社', '(株)', '（株）',
  'inc.', 'co.,ltd', 'co., ltd', 'オンラインストア', '通販サイト',
];

const BOT_MARKERS = [
  'bot', 'ボット', 'まとめ', '速報', 'ニュース', 'news',
  '自動投稿', '相互フォロー',
];

function norm(v) { return String(v == null ? '' : v).toLowerCase(); }

function profileText(author) {
  return norm((author && author.name) || '') + ' ' + norm((author && author.description) || '');
}

function isOfficialAccount(author) {
  const t = profileText(author);
  return OFFICIAL_MARKERS.some((m) => t.includes(norm(m)));
}

function isBotAccount(author) {
  const t = profileText(author);
  return BOT_MARKERS.some((m) => t.includes(norm(m)));
}

/**
 * 懸賞判定は「プロフィールが懸賞語」または「ヒットツイートの過半が懸賞」。
 * 1件でも懸賞なら除外、にはしない（たまたま懸賞に反応した一般ユーザーを失うため）。
 */
function classifyAccount(author, tweets) {
  if (isOfficialAccount(author)) return { excluded: true, reason: '公式' };
  if (isBotAccount(author)) return { excluded: true, reason: 'bot' };
  const desc = (author && author.description) || '';
  const list = tweets || [];
  const giveaway = list.filter((t) => isGiveawayPost((t && t.text) || '')).length;
  if (isGiveawayPost(desc) || (list.length > 0 && giveaway * 2 > list.length)) {
    return { excluded: true, reason: '懸賞' };
  }
  return { excluded: false, reason: null };
}

/** (いいね+RT) ÷ フォロワー × 100。重み付けはしない（未検証の定数を入れない） */
function engagementRate(avgLike, avgRt, followers) {
  const f = Number(followers) || 0;
  if (f < 100) return null;   // 分母が小さすぎて率が爆発し順位が無意味になる
  const e = (Number(avgLike) || 0) + (Number(avgRt) || 0);
  return Math.round((e / f) * 1000) / 10;
}

function aggregateAuthors(tweets) {
  const map = new Map();
  for (const t of tweets || []) {
    const a = (t && t.author) || {};
    const key = norm(a.userName);
    if (!key) continue;
    if (!map.has(key)) {
      map.set(key, {
        account: a.userName, name: a.name || '', description: a.description || '',
        followers: Number(a.followers) || 0, url: a.url || '', items: [],
      });
    }
    map.get(key).items.push(t);
  }

  const out = [];
  for (const v of map.values()) {
    const n = v.items.length;
    const avg = (k) => v.items.reduce((s, t) => s + (Number(t[k]) || 0), 0) / n;
    const avgLike = avg('likeCount');
    const avgRt = avg('retweetCount');
    const cls = classifyAccount({ name: v.name, description: v.description }, v.items);
    out.push({
      account: v.account,
      followers: v.followers,
      hits: n,
      avgLike: Math.round(avgLike),
      avgRt: Math.round(avgRt),
      avgReply: Math.round(avg('replyCount')),
      avgView: Math.round(avg('viewCount')),
      rate: engagementRate(avgLike, avgRt, v.followers),
      excluded: cls.excluded,
      reason: cls.reason,
      sampleText: String((v.items[0] && v.items[0].text) || '').replace(/\s+/g, ' ').slice(0, 80),
      url: v.url || ('https://x.com/' + v.account),
    });
  }
  return out;
}

function sortByRate(list) {
  return (list || []).slice().sort((a, b) => {
    if (a.rate == null && b.rate == null) return 0;
    if (a.rate == null) return 1;
    if (b.rate == null) return -1;
    return b.rate - a.rate;
  });
}

module.exports = {
  isOfficialAccount, isBotAccount, classifyAccount,
  engagementRate, aggregateAuthors, sortByRate,
  OFFICIAL_MARKERS, BOT_MARKERS,
};
```

- [ ] **Step 4: テストが通ることを確認**

Run: `node --test test/x-account-filter.test.js`
Expected: PASS（14テスト全部）

- [ ] **Step 5: 全テストでリグレッションが無いことを確認**

Run: `npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"`
Expected: `fail 0`（既存87＋新14＝101 pass）

- [ ] **Step 6: コミット**

```bash
git add lib/x-account-filter.js test/x-account-filter.test.js
git commit -m "feat(s2d-3): add X account filter (official/giveaway/bot) with tests"
```

---

## Task 2: Apify検索スクリプト

**Files:**
- Create: `scripts/apify/discover_x.js`

このタスクは外部API呼び出しのため単体テストを書かない（S2d-2の `fetch_x_replies.js` と同じ方針）。判定ロジックは Task 1 の純粋関数に委譲済みで、このファイルは取得と正規化だけを持つ。

- [ ] **Step 1: スクリプトを作成**

Create `scripts/apify/discover_x.js`:

```js
/**
 * Apify 外部API — X(旧Twitter) キーワード検索でインフルエンサー候補を発掘
 *
 * カテゴリ語や商品・ブランド名でツイートを検索し、投稿者を集約して候補にする。
 * 企業公式・懸賞垢・botの除外と集約は lib/x-account-filter に委譲する。
 *
 * 【事前準備】APIFY_TOKEN（https://apify.com → Settings → Integrations → API token）
 *
 * 【使い方】
 *   node scripts/apify/discover_x.js 毛穴ケア 化粧水 --json   # 正規化して @@JSON@@ 出力
 *   node scripts/apify/discover_x.js 毛穴ケア --dump          # Apifyの生JSONを確認（構造検証用）
 *
 * 【コスト目安】$0.0004/ツイート。1語100件＝約6円、3語で約18円。
 */
require('dotenv').config();
const axios = require('axios');
const { aggregateAuthors, sortByRate } = require('../../lib/x-account-filter');

const TOKEN = process.env.APIFY_TOKEN;
if (!TOKEN) {
  console.error('❌ APIFY_TOKEN がありません。https://apify.com → Settings → Integrations → API token を設定してください。');
  process.exit(1);
}

const ACTOR = 'apidojo~tweet-scraper';
const PER_KEYWORD = 100;
const MAX_KEYWORDS = 3;

const args = process.argv.slice(2);
const keywords = args.filter((a) => !a.startsWith('--')).slice(0, MAX_KEYWORDS);
if (!keywords.length) {
  console.error('使い方: node scripts/apify/discover_x.js <キーワード> [キーワード2] --json');
  process.exit(1);
}

async function runActor(input) {
  const url = `https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items?token=${TOKEN}`;
  const res = await axios.post(url, input, { timeout: 180000, headers: { 'Content-Type': 'application/json' } });
  return res.data;
}

// Apifyのitemを共通形へ。実レスポンスの揺れに備えて複数のキー名を許容する
function normalize(it) {
  it = it || {};
  const a = it.author || {};
  return {
    id: String(it.id || it.id_str || ''),
    text: it.text || it.fullText || it.full_text || '',
    likeCount: Number(it.likeCount != null ? it.likeCount : it.favorite_count) || 0,
    retweetCount: Number(it.retweetCount != null ? it.retweetCount : it.retweet_count) || 0,
    replyCount: Number(it.replyCount != null ? it.replyCount : it.reply_count) || 0,
    viewCount: Number(it.viewCount) || 0,
    author: {
      userName: a.userName || a.screen_name || '',
      name: a.name || '',
      description: a.description || '',
      followers: Number(a.followers != null ? a.followers : a.followers_count) || 0,
      url: a.url || a.twitterUrl || '',
    },
  };
}

(async () => {
  const input = {
    searchTerms: keywords,
    maxItems: PER_KEYWORD * keywords.length,
    sort: 'Top',
    tweetLanguage: 'ja',
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

  const all = (items || []).map(normalize).filter((x) => x.author.userName);
  const aggregated = aggregateAuthors(all);
  const included = sortByRate(aggregated.filter((x) => !x.excluded));
  const excluded = aggregated.filter((x) => x.excluded);

  const breakdown = { 公式: 0, 懸賞: 0, bot: 0 };
  for (const e of excluded) { if (breakdown[e.reason] != null) breakdown[e.reason] += 1; }

  let note = '';
  if (!all.length) note = '該当ツイートなし（キーワードを変えてください）';
  else if (!included.length) note = '該当者は全員が除外対象でした（公式・懸賞・bot）';

  console.log('@@JSON@@' + JSON.stringify({
    ok: true,
    keywords,
    fetched: all.length,
    candidates: included,
    excluded: excluded.map((x) => ({ account: x.account, followers: x.followers, reason: x.reason })),
    excludedBreakdown: breakdown,
    note,
  }));
})();
```

- [ ] **Step 2: 構文チェック**

Run: `node --check scripts/apify/discover_x.js`
Expected: 出力なし（構文OK）

- [ ] **Step 3: 引数バリデーションを確認（APIは叩かない）**

Run: `node scripts/apify/discover_x.js 2>&1 | head -2`
Expected: `使い方: node scripts/apify/discover_x.js <キーワード> [キーワード2] --json`

- [ ] **Step 4: コミット**

```bash
git add scripts/apify/discover_x.js
git commit -m "feat(s2d-3): add Apify X keyword discovery script"
```

---

## Task 3: サーバーエンドポイント

**Files:**
- Modify: `cockpit-server.js`（`/api/cockpit/x-intent` ルートの直後に追加）

- [ ] **Step 1: エンドポイントを追加**

`cockpit-server.js` を開き、`app.post('/api/cockpit/x-intent', ...)` ルートの**閉じ括弧 `});` の直後**に、以下を挿入する（`// --- 実績 ---` コメントより前）:

```js
// X候補検索（S2d-3）— キーワードでXアカウントを発掘。
// 検索は300件でも数十秒で終わるため、転換質診断と違い1リクエストで完結する。
app.post('/api/cockpit/x-discover', requireAuth, async (req, res) => {
  const raw = (req.body || {}).keywords;
  const keywords = (Array.isArray(raw) ? raw : String(raw || '').split(/[\n,、，]/))
    .map((s) => String(s).trim())
    .filter(Boolean);
  if (!keywords.length) return res.status(400).json({ ok: false, error: 'キーワードを入力してください' });
  if (keywords.length > 3) return res.status(400).json({ ok: false, error: 'キーワードは3つまでです' });
  if (!process.env.APIFY_TOKEN) return res.status(400).json({ ok: false, error: 'APIFY_TOKEN未設定（Cloud Runの環境変数に追加してください）' });

  try {
    const data = await runScriptJson('scripts/apify/discover_x.js', [...keywords, '--json']);
    return res.json(data);
  } catch (e) {
    return res.status(502).json({ ok: false, error: 'X検索に失敗しました: ' + String(e.message || e).slice(0, 400) });
  }
});
```

- [ ] **Step 2: 構文チェック**

Run: `node --check cockpit-server.js`
Expected: 出力なし（構文OK）

- [ ] **Step 3: ルートが1つだけ登録されたことを確認**

Run: `grep -c "x-discover" cockpit-server.js`
Expected: `1`

- [ ] **Step 4: 全テストでリグレッションが無いことを確認**

Run: `npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"`
Expected: `fail 0`（101 pass）

- [ ] **Step 5: コミット**

```bash
git add cockpit-server.js
git commit -m "feat(s2d-3): add /api/cockpit/x-discover endpoint"
```

---

## Task 4: X候補検索カード（UI）

**Files:**
- Modify: `public/cg-cockpit.html`（`source()` メソッド内のHTML、および `searchYTSource` の直後にJS）

- [ ] **Step 1: カードのHTMLを追加**

`source(){` メソッド内で、`🔎 YouTube自動検索` カードの終わり（`<div id="srcytresult" style="margin-top:10px;font-size:13px"></div></div>`）の**直後**、`<div class="card"><h3>🤝 Astreamの役割</h3>` の**直前**に挿入:

```html
    <div class="card"><h3>🔎 X候補検索（Apifyキーワード検索）</h3>
      <p style="font-size:12.5px;color:var(--muted);margin-bottom:8px">カテゴリ語や商品・ブランド名でXを検索し、投稿者を候補として発掘します。企業公式・懸賞垢・botは自動除外します。キーワードは3つまで／1語あたり100件（約6円）。</p>
      <div class="note" style="margin-bottom:8px">⚠️ エンゲージ率は<b>X内の相対比較にのみ</b>使用してください。YouTube/IGの指標とは較正されていないため、媒体をまたいで並べないでください。要 APIFY_TOKEN。</div>
      <div style="display:flex;gap:8px"><input id="xdkw" placeholder="毛穴ケア, 化粧水（カンマ区切りで3つまで）"><button class="btn" style="background:var(--purple)" onclick="runXDiscover()">検索</button></div>
      <div id="xd_result" style="margin-top:10px;font-size:13px"></div></div>
```

- [ ] **Step 2: JSを追加**

`window.searchYTSource=async()=>{ ... };` の閉じ括弧 `};` の**直後**に挿入:

```javascript
// X候補検索（S2d-3）— キーワードで発掘し、選んだものを候補DBに登録する
window.runXDiscover=async()=>{
  const kw=(document.getElementById("xdkw").value||"").trim();
  const el=document.getElementById("xd_result");
  if(!kw){ el.innerHTML="<span style='color:#A32D2D'>キーワードを入力してください</span>"; return; }
  el.innerHTML="検索中…（30秒〜1分・リロードしないでください）";
  try{
    const r=await api("/api/cockpit/x-discover",{keywords:kw});
    if(!r||!r.ok){ el.innerHTML="<span style='color:#A32D2D'>"+escapeHtml((r&&r.error)||"検索に失敗しました")+"</span>"; return; }
    window.__xdCand=r.candidates||[];
    const b=r.excludedBreakdown||{};
    const exLine=`<div style="font-size:11.5px;color:var(--muted);margin-bottom:6px">取得${r.fetched||0}ツイート／候補${window.__xdCand.length}件・除外${(r.excluded||[]).length}件（公式${b["公式"]||0} 懸賞${b["懸賞"]||0} bot${b["bot"]||0}）</div>`;
    if(!window.__xdCand.length){ el.innerHTML=exLine+"<span style='color:var(--muted)'>"+escapeHtml(r.note||"該当なし")+"</span>"; return; }
    el.innerHTML=exLine+window.__xdCand.map((x,i)=>`<div style="padding:5px 0;border-bottom:1px solid var(--line)">
      <b>@${escapeHtml(x.account)}</b>
      <span class="pill ${x.rate!=null&&x.rate>=3?"p-green":x.rate!=null&&x.rate>=1?"p-orange":"p-gray"}">${x.rate==null?"エンゲージ率—":"エンゲージ率"+x.rate+"%"}</span>
      <span style="color:var(--muted);font-size:11.5px">フォロワー${(x.followers||0).toLocaleString()}／ヒット${x.hits}件／平均♥${(x.avgLike||0).toLocaleString()}</span>
      <button class="btn" style="margin-left:6px;padding:1px 7px;font-size:11px" onclick="regXCand(${i},this)">DBに登録</button>
      <br><span style="color:var(--muted);font-size:11px">${escapeHtml(x.sampleText||"")}</span></div>`).join("")
      +((r.excluded||[]).length?`<details style="margin-top:8px"><summary style="cursor:pointer;font-size:12px;color:var(--muted)">除外された${(r.excluded||[]).length}件を見る（誤除外の確認用）</summary>
      <div style="font-size:11.5px;color:var(--muted);margin-top:4px">${(r.excluded||[]).map(e=>`@${escapeHtml(e.account)}（${escapeHtml(e.reason||"")}・フォロワー${(e.followers||0).toLocaleString()}）`).join("／")}</div></details>`:"");
  }catch(e){ el.innerHTML="<span style='color:#A32D2D'>"+escapeHtml(e.message||"検索に失敗しました")+"</span>"; }
};

window.regXCand=(i,btn)=>{
  const x=(window.__xdCand||[])[i]; if(!x) return;
  return registerCand({account:x.account, media:"X", followers:x.followers||"", prEngage:(x.rate==null?"":x.rate), url:x.url||""}, btn);
};
```

- [ ] **Step 3: ID重複と関数の存在を確認**

Run:
```bash
node -e "
const s=require('fs').readFileSync('public/cg-cockpit.html','utf8');
['xdkw','xd_result'].forEach(id=>console.log(id+' 出現数='+(s.match(new RegExp('id=\"'+id+'\"','g'))||[]).length));
['runXDiscover','regXCand','__xdCand'].forEach(k=>console.log(k+'='+s.includes(k)));
console.log('registerCand定義数='+(s.match(/window\.registerCand=/g)||[]).length);
"
```
Expected: `xdkw`/`xd_result` はそれぞれ `1`、3つの関数名が `true`、`registerCand定義数=1`（再定義していない）

- [ ] **Step 4: ブレース・バッククォートの均衡を確認**

Run:
```bash
node -e "
const s=require('fs').readFileSync('public/cg-cockpit.html','utf8');
const seg=s.slice(s.indexOf('window.runXDiscover'), s.indexOf('window.regXCand')+400);
const bal=ch=>seg.split(ch).length-1;
console.log('braces', bal('{'), bal('}'), 'backticks', bal('\`'));
"
```
Expected: `{` と `}` の数が一致、バッククォートが偶数

- [ ] **Step 5: 全テストでリグレッションが無いことを確認**

Run: `npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"`
Expected: `fail 0`（101 pass。HTMLに単体テストは無い）

- [ ] **Step 6: コミット**

```bash
git add public/cg-cockpit.html
git commit -m "feat(s2d-3): add X candidate discovery card to source tab"
```

---

## Task 5: Astream X CSV移設 と YouTube検索の登録ボタン

**Files:**
- Modify: `public/cg-cockpit.html`

設計書の「情報設計の変更」に対応する。`📑 Astream CSV → IG転換質プロキシ` は**移設しない**（転換質を算出する診断機能のため）。

- [ ] **Step 1: Astream X CSV取込カードを diagnose() から削除**

`diagnose(){` メソッド内から、以下のカード**全体**（8行）を削除する:

```html
    <div class="card"><h3>📑 Astream X CSV取込</h3>
      <p style="font-size:12.5px;color:var(--muted);margin-bottom:8px">Astreamが出力するX(旧Twitter)のCSVをアップロードし、各行を候補DBにX候補として登録できます。Xは客層・転換質が構造的に取れないため、フォロワー・エンゲージ率・反応・プロフィールのみ登録します。</p>
      <input type="file" id="asxcsv" accept=".csv">
      <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
        <button class="btn" style="background:var(--purple)" onclick="runXIngest()">X CSVを解析</button>
      </div>
      <div id="asxcsvresult" style="margin-top:10px;font-size:13px"></div>
    </div>
```

- [ ] **Step 2: 同じカードを source() に貼る**

`source(){` メソッド内、Task 4 で追加した `🔎 X候補検索` カードの**直後**（`<div id="xd_result" ...></div></div>` の後）に、Step 1 で削除したカードをそのまま挿入する:

```html
    <div class="card"><h3>📑 Astream X CSV取込</h3>
      <p style="font-size:12.5px;color:var(--muted);margin-bottom:8px">Astreamが出力するX(旧Twitter)のCSVをアップロードし、各行を候補DBにX候補として登録できます。Xは客層・転換質が構造的に取れないため、フォロワー・エンゲージ率・反応・プロフィールのみ登録します。</p>
      <input type="file" id="asxcsv" accept=".csv">
      <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
        <button class="btn" style="background:var(--purple)" onclick="runXIngest()">X CSVを解析</button>
      </div>
      <div id="asxcsvresult" style="margin-top:10px;font-size:13px"></div>
    </div>
```

JS側（`window.runXIngest`）は**変更しない**。カードのHTMLが移るだけで、関数はグローバルなのでそのまま動く。

- [ ] **Step 3: YouTube検索の結果に登録ボタンを追加**

`window.searchYTSource=async()=>{ ... }` の中、`if(r.ok&&r.results&&r.results.length){` のブロックを、以下で**置き換える**（`window.__ytSrc` の保存と、列＋ボタンの追加）:

```javascript
    if(r.ok&&r.results&&r.results.length){
      window.__ytSrc=r.results;
      el.innerHTML=`<table style="width:100%;border-collapse:collapse;font-size:12.5px">`
        +`<tr><th style="text-align:left;border-bottom:1px solid var(--line)">チャンネル</th><th style="border-bottom:1px solid var(--line)">登録者</th><th style="border-bottom:1px solid var(--line)">転換質</th><th style="border-bottom:1px solid var(--line)"></th></tr>`
        +r.results.map((x,i)=>`<tr><td style="border-bottom:1px solid var(--line)">${escapeHtml(x.title||x.channelId||"")}</td>`
        +`<td style="text-align:right;border-bottom:1px solid var(--line)">${(x.subs||0).toLocaleString()}</td>`
        +`<td style="text-align:right;border-bottom:1px solid var(--line)">${x.intent==null?"—":x.intent+"%"}</td>`
        +`<td style="text-align:right;border-bottom:1px solid var(--line)"><button class="btn" style="padding:1px 7px;font-size:11px" onclick="regYtSrc(${i},this)">DBに登録</button></td></tr>`).join("")
        +`</table>`;
    }else{ el.innerHTML="<span style='color:var(--muted)'>"+escapeHtml(r.error||"該当なし")+"</span>"; }
```

- [ ] **Step 4: regYtSrc ヘルパを追加**

`window.searchYTSource=async()=>{ ... };` の閉じ括弧 `};` の**直後**（Task 4 で追加した `runXDiscover` より前）に挿入:

```javascript
// YouTube検索結果を候補DBに登録（S2d-3で追加。従来は表示のみで登録導線が無かった）
window.regYtSrc=(i,btn)=>{
  const x=(window.__ytSrc||[])[i]; if(!x) return;
  return registerCand({account:x.title||x.channelId||"", media:"YouTube", followers:x.subs||"", conversion:(x.intent==null?"":x.intent)}, btn);
};
```

- [ ] **Step 5: 移設とボタン追加を検証**

Run:
```bash
node -e "
const s=require('fs').readFileSync('public/cg-cockpit.html','utf8');
console.log('asxcsv id出現数='+(s.match(/id=\"asxcsv\"/g)||[]).length+' (1なら重複なし)');
console.log('Astream X CSVカード数='+(s.match(/Astream X CSV取込/g)||[]).length+' (1なら移設完了)');
console.log('regYtSrc='+s.includes('window.regYtSrc'));
console.log('__ytSrc='+s.includes('window.__ytSrc'));
const src=s.slice(s.indexOf('  source(){'), s.indexOf('  idb(){'));
console.log('source内にAstream X CSVがある='+src.includes('Astream X CSV取込'));
const dg=s.slice(s.indexOf('  diagnose(){'), s.indexOf('  prompts(){'));
console.log('diagnose内にAstream X CSVが残っていない='+!dg.includes('Astream X CSV取込'));
console.log('diagnose内にIG転換質プロキシが残っている='+dg.includes('IG転換質プロキシ'));
"
```
Expected: `asxcsv id出現数=1`、`Astream X CSVカード数=1`、`regYtSrc=true`、`__ytSrc=true`、`source内にAstream X CSVがある=true`、`diagnose内にAstream X CSVが残っていない=true`、`diagnose内にIG転換質プロキシが残っている=true`

- [ ] **Step 6: 全テストでリグレッションが無いことを確認**

Run: `npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"`
Expected: `fail 0`（101 pass）

- [ ] **Step 7: コミット**

```bash
git add public/cg-cockpit.html
git commit -m "feat(s2d-3): move Astream X CSV card to source tab, add YouTube search register button"
```

---

## 完了後の確認（デプロイはユーザー作業）

**追加の環境変数は不要。** `APIFY_TOKEN` は2026-07-27にCloud Runへ設定済み。

1. PRを作成しレビュー → マージ
2. **mainが最新であることを確認してから**デプロイ（2026-07-27の教訓：古いHTMLが焼き込まれる事故があった）
   ```bash
   gcloud run deploy cg-cockpit --source . --region asia-northeast1
   ```
3. `public/cg-cockpit.html` を Xserver（`/home/buzzreach/buzz-reach.net/public_html/`）へアップロード
4. デプロイ後、配信ファイルに新カードが載ったことをマーカーで検証
5. 実キーワードで検索し、①企業公式が上位に居座らない ②除外内訳が出る ③登録した候補が候補DBに入り、S2d-2のX転換質診断で読み込める（＝導線が繋がった）ことを確認
