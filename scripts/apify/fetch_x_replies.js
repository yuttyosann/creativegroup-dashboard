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
const { summarizePR } = require('../../lib/x-pr-filter');

const TOKEN = process.env.APIFY_TOKEN;
if (!TOKEN) {
  console.error('❌ APIFY_TOKEN がありません。https://apify.com → Settings → Integrations → API token を設定してください。');
  process.exit(1);
}

const ACTOR = 'apidojo~twitter-profile-scraper';
// MIN_REPLY_COUNT は取得条件ではなく「転換質判定に使う投稿の絞り込み」に使う（下記参照）。
// PR投稿はリプライが少なく、取得段で切るとPR率が測れないため。
const MAX_POSTS = 5, MAX_REPLIES_PER_POST = 50, DAYS = 90, MIN_REPLY_COUNT = 5, MAX_ITEMS = 500;
const RECENT_POSTS_FOR_GENRE = 20;

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
    likeCount: Number(it.likeCount != null ? it.likeCount : it.favorite_count) || 0,
    retweetCount: Number(it.retweetCount != null ? it.retweetCount : it.retweet_count) || 0,
    isReply: Boolean(it.isReply || it.inReplyToId || it.in_reply_to_status_id_str),
    isRetweet: Boolean(it.isRetweet),
    parentId: String(it.inReplyToId || it.in_reply_to_status_id_str || it.conversationId || ''),
    authorHandle: author.userName || author.screen_name || it.userName || '',
    followers: Number(author.followers != null ? author.followers : author.followers_count) || 0,
    description: author.description || '',
  };
}

(async () => {
  // minReplyCount は指定しない。PR投稿はリプライが少なく、取得段で切ると
  // PR率・PRエンゲージ率が測れなくなるため（S2d-4）。絞り込みは取得後に行う。
  const input = {
    twitterHandles: [handle],
    getReplies: true,
    start: sinceDate(DAYS),
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

  // フォロワー数・プロフィールは本人の投稿から拾う（S2d-4のPR集計とジャンル判定に使う）
  const followers = (tweets.find((t) => t.followers) || {}).followers || 0;
  const description = (tweets.find((t) => t.description) || {}).description || '';

  // PR実績（本人の非リプライ・非RT投稿が母数）
  const pr = summarizePR(tweets, followers);

  // 転換質判定に使う投稿は従来どおりリプライの多いものに絞る（取得段のフィルタをやめた分ここで担保）
  const engaged = tweets.filter((t) => (t.replyCount || 0) >= MIN_REPLY_COUNT);
  const giveawayExcluded = engaged.filter((t) => isGiveawayPost(t.text)).length;
  const picked = selectPosts(engaged, { maxPosts: MAX_POSTS });

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
})();
