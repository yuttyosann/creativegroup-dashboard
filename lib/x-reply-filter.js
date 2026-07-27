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
  'モニター', '募集', '名様', '先着', '当たり',
];

// PR表記の精密マッチ（bare "pr" は誤検出するため使わない）。fetch_instagram.js の PR_MARKERS を踏襲
const PR_MARKERS = [
  '#pr', '#ad', '#提供', '#タイアップ', '提供:', '提供：', 'タイアップ',
  '案件', 'sponsored', 'アンバサダー',
];

// リプライの定型・bot・懸賞目当て
const NOISE_REPLY_MARKERS = [
  'フォローしました', '相互フォロー', '参加します', 'よろしくお願いします', '参加中',
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
