'use strict';

const INSIGHT_KEYS = ['reach', 'saved', 'shares', 'total_interactions', 'profile_visits', 'follows', 'views'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** カルーセル枚数。CAROUSEL_ALBUM以外は1。 */
function carouselCount(media) {
  if (media && media.media_type === 'CAROUSEL_ALBUM' && media.children && Array.isArray(media.children.data)) {
    return media.children.data.length || 1;
  }
  return 1;
}

/** ISO8601(+0900等) から JST の date/weekday/hour を導出。 */
function deriveTimeFields(timestamp) {
  if (!timestamp) return { date: null, weekday: null, hour: null };
  const d = new Date(timestamp);
  if (Number.isNaN(d.getTime())) return { date: null, weekday: null, hour: null };
  // JST(+9)に変換
  const jst = new Date(d.getTime() + 9 * 3600 * 1000);
  const yyyy = jst.getUTCFullYear();
  const mm = String(jst.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(jst.getUTCDate()).padStart(2, '0');
  return { date: `${yyyy}-${mm}-${dd}`, weekday: WEEKDAYS[jst.getUTCDay()], hour: jst.getUTCHours() };
}

/** ハッシュタグ数。 */
function hashtagCount(caption) {
  if (!caption) return 0;
  const m = String(caption).match(/#[^\s#]+/g);
  return m ? m.length : 0;
}

/** メンション数。 */
function mentionCount(caption) {
  if (!caption) return 0;
  const m = String(caption).match(/@[^\s@]+/g);
  return m ? m.length : 0;
}

/** APIメディアオブジェクト → ig_media_raw 行。 */
function buildMediaRow(media) {
  const t = deriveTimeFields(media.timestamp);
  const childrenData = media.children && Array.isArray(media.children.data) ? media.children.data : [];
  const cc = carouselCount(media);
  return {
    media_id: media.id,
    timestamp: media.timestamp || null,
    date: t.date,
    weekday: t.weekday,
    hour: t.hour,
    permalink: media.permalink || null,
    caption: media.caption || null,
    media_type: media.media_type || null,
    media_product_type: media.media_product_type || null,
    like_count: media.like_count != null ? media.like_count : null,
    comments_count: media.comments_count != null ? media.comments_count : null,
    children_count: childrenData.length,
    carousel_count: cc,
    is_carousel: media.media_type === 'CAROUSEL_ALBUM',
    children_media_types: childrenData.map((c) => c.media_type).filter(Boolean).join(','),
  };
}

/** Insights API の data 配列 → 指標オブジェクト（未取得キーは null）。 */
function parseInsights(apiData) {
  const out = {};
  for (const k of INSIGHT_KEYS) out[k] = null;
  if (!Array.isArray(apiData)) return out;
  for (const item of apiData) {
    if (item && INSIGHT_KEYS.includes(item.name) && Array.isArray(item.values) && item.values.length) {
      const v = item.values[0].value;
      out[item.name] = typeof v === 'number' ? v : null;
    }
  }
  return out;
}

module.exports = { carouselCount, deriveTimeFields, hashtagCount, mentionCount, buildMediaRow, parseInsights, INSIGHT_KEYS };
