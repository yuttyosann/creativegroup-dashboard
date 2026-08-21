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
// 【取得を2回に分ける理由】用途が違い、1回の取得では両立できない。
//  ・転換質  … リプライが要る。minReplyCount で「反応の多い投稿」に絞ると、その分リプライが多く取れる。
//  ・PR実績  … PR投稿はリプライが少ないので、上のフィルタをかけると測定対象そのものが抜け落ちる。
// S2d-4で後者に合わせてフィルタを外したところ、本人の投稿が取得枠を食い尽くし、
// リプライが実測120件中5件しか取れず転換質が算出不能になった（S2d-2の回帰）。よって分離する。
const MAX_POSTS = 5, MAX_REPLIES_PER_POST = 50, DAYS = 90, MIN_REPLY_COUNT = 5;
const MAX_ITEMS = 300;    // 転換質用（S2d-2の従来値）
const MAX_TWEETS = 200;   // PR実績・ジャンル用（本人の投稿のみ・リプライを取らないので軽い）
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
  // ① PR実績・ジャンル用：本人の投稿を広く。リプライは取らない（枠を食わせない）
  let profileItems = [], replyItems = [], fetchNote = '';
  try {
    profileItems = await runActor({
      twitterHandles: [handle],
      getReplies: false,
      start: sinceDate(DAYS),
      maxItems: MAX_TWEETS,
    });
  } catch (e) {
    fetchNote += '投稿の取得に失敗（PR実績・ジャンルなし）。';
  }

  // ② 転換質用：S2d-2の従来条件。リプライの多い投稿に絞ることで、その分リプライが多く取れる
  try {
    replyItems = await runActor({
      twitterHandles: [handle],
      getReplies: true,
      start: sinceDate(DAYS),
      minReplyCount: MIN_REPLY_COUNT,
      maxItems: MAX_ITEMS,
    });
  } catch (e) {
    fetchNote += 'リプライの取得に失敗（転換質なし）。';
  }

  if (!profileItems.length && !replyItems.length) {
    console.error('Apify実行に失敗: ' + (fetchNote || '両方の取得が空でした'));
    process.exit(1);
  }

  if (args.includes('--dump')) {
    console.log(JSON.stringify({ profileItems: profileItems.slice(0, 3), replyItems: replyItems.slice(0, 3) }, null, 2).slice(0, 20000));
    return;
  }

  const own = (x) => !x.authorHandle || x.authorHandle.toLowerCase() === handle.toLowerCase();
  const profileAll = profileItems.map(normalize).filter((x) => x.text);
  const replyAll = replyItems.map(normalize).filter((x) => x.text);

  // --- ①の結果からPR実績・ジャンル ---
  const tweets = profileAll.filter((x) => !x.isReply && own(x));
  const followers = (tweets.find((t) => t.followers) || {}).followers || 0;
  const description = (tweets.find((t) => t.description) || {}).description || '';
  const pr = summarizePR(tweets, followers);

  // --- ②の結果から転換質 ---
  const ownTweets = replyAll.filter((x) => !x.isReply && own(x));
  const replies = replyAll.filter((x) => x.isReply);

  // 【重要】アクターが返すリプライは、replyCountが多い投稿に付いたものとは限らない（実測で判明）。
  // こちらで「リプライが多そうな投稿」を選んでも、返ってきたリプライの親と一致せず紐付けが全滅する。
  // よって「実際にリプライが取れた投稿」だけを対象にする。
  const parentIds = new Set(replies.map((r) => r.parentId).filter(Boolean));
  const withReplies = ownTweets.filter((t) => parentIds.has(t.id));

  const giveawayExcluded = withReplies.filter((t) => isGiveawayPost(t.text)).length;
  const picked = selectPosts(withReplies, { maxPosts: MAX_POSTS });

  const targetReplies = [];
  for (const p of picked) {
    const rs = replies.filter((r) => r.parentId && r.parentId === p.id);
    targetReplies.push(...cleanReplies(rs, { maxPerPost: MAX_REPLIES_PER_POST, authorHandle: handle }));
  }

  // 親子の紐付け自体は実データで検証済み（inReplyToId/conversationIdとも100%一致）。
  // ここに入るのは「選んだ投稿にリプライが付いていない」ケースなので、そう書く。
  let note = fetchNote;
  if (!picked.length) note += '転換質の対象投稿なし（懸賞のみ、またはリプライの多い投稿が無い）';
  else if (replies.length && !targetReplies.length) note += 'リプライは取得できましたが、対象に選んだ投稿に紐づくものがありませんでした';

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
    truncated: profileAll.length >= MAX_TWEETS,
  }));
})();
