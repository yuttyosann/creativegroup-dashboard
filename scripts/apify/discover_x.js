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
    excluded: excluded.map((x) => ({ account: x.account, followers: x.followers, reason: x.reason, url: x.url })),
    excludedBreakdown: breakdown,
    note,
  }));
})();
