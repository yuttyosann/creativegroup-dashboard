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
  /\bofficial\b/,
  '公式', '株式会社', '有限会社', '(株)', '（株）',
  'inc.', 'co.,ltd', 'co., ltd', 'オンラインストア', '通販サイト',
];

const BOT_MARKERS = [
  /\bbot\b/, /\bnews\b/,
  'ボット', 'まとめ', '速報', 'ニュース',
  '自動投稿', '相互フォロー',
];

function norm(v) { return String(v == null ? '' : v).toLowerCase(); }

function profileText(author) {
  return norm((author && author.name) || '') + ' ' + norm((author && author.description) || '');
}

function hasMarker(text, markers) {
  return markers.some((m) => (m instanceof RegExp ? m.test(text) : text.includes(norm(m))));
}

function isOfficialAccount(author) {
  const t = profileText(author);
  // 「非公式」ファンアカウントは公式ではない（日本語は単語境界が使えないため明示的に除く）
  if (/非公式/.test(t) || /\bunofficial\b/.test(t)) return false;
  return hasMarker(t, OFFICIAL_MARKERS);
}

function isBotAccount(author) {
  const t = profileText(author);
  return hasMarker(t, BOT_MARKERS);
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
