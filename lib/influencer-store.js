'use strict';
/**
 * influencer-store.js — インフルエンサーDBの列定義・行マッパー・バリデーション・upsertマージ（純粋関数）
 * Sheetsの列順はここを単一の正とする。
 */

const INFLUENCER_HEADERS = [
  'inf_id', 'アカウント名', '媒体', 'ジャンル', 'コンテンツ型', 'フォロワー',
  '女性%', '中核年齢25-44%', 'スクリーニング', '転換質%', '実在率%', 'PRエンゲージ%',
  '適性メモ・向く商品', '実績サマリー', 'URL', '登録者', '最終更新',
];
const MEDIA_OPTIONS = ['YouTube', 'Instagram', 'TikTok', 'X'];

const FIELDS = ['account', 'media', 'genre', 'contentType', 'followers', 'female', 'coreAge', 'screening', 'conversion', 'realRate', 'prEngage', 'note', 'result', 'url', 'registrant'];

function isoDate(now) { return now.toISOString().slice(0, 10); }
function nonEmpty(v) { return v != null && String(v).trim() !== ''; }

function validateInfluencer(o) {
  if (!o || !nonEmpty(o.account)) throw new Error('必須項目が不足しています: アカウント名');
  if (!nonEmpty(o.media)) throw new Error('必須項目が不足しています: 媒体');
  if (!MEDIA_OPTIONS.includes(o.media)) throw new Error('不正な媒体: ' + o.media);
}

function toInfluencerRow(o, id, now = new Date()) {
  return [
    id, o.account || '', o.media || '', o.genre || '', o.contentType || '', o.followers || '',
    o.female || '', o.coreAge || '', o.screening || '', o.conversion || '', o.realRate || '', o.prEngage || '',
    o.note || '', o.result || '', o.url || '', o.registrant || '', isoDate(now),
  ];
}

function parseInfluencer(r) {
  return {
    inf_id: r[0] || '', account: r[1] || '', media: r[2] || '', genre: r[3] || '', contentType: r[4] || '',
    followers: r[5] || '', female: r[6] || '', coreAge: r[7] || '', screening: r[8] || '', conversion: r[9] || '',
    realRate: r[10] || '', prEngage: r[11] || '', note: r[12] || '', result: r[13] || '', url: r[14] || '',
    registrant: r[15] || '', updated: r[16] || '',
  };
}

function mergeInfluencer(existing, incoming) {
  const out = { ...existing };
  for (const f of FIELDS) {
    if (f === 'account' || f === 'media') continue;
    if (nonEmpty(incoming[f])) out[f] = incoming[f];
  }
  return out;
}

module.exports = { INFLUENCER_HEADERS, MEDIA_OPTIONS, validateInfluencer, toInfluencerRow, parseInfluencer, mergeInfluencer };
