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

function stripNoise(v) {
  return String(v == null ? '' : v)
    .replace(/https?:\/\/\S+/g, ' ')      // URL（/pr/ を含むパスで誤検出しない）
    .replace(/@[A-Za-z0-9_]+/g, ' ');     // @メンション（@pr_cosme を PR と誤判定しない）
}

// 全角英字を半角に寄せる。日本語圏では【ＰＲ】のように全角で書かれることがある。
function toHalfWidth(v) {
  return String(v).replace(/[Ａ-Ｚａ-ｚ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
}

function isExplicitPR(text) {
  return BARE_PR.test(toHalfWidth(stripNoise(text)));
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
