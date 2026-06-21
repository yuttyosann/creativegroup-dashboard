'use strict';
/**
 * crm-store.js — ブランド/商品/案件の列定義・行マッパー・バリデーション（純粋関数）
 * Sheetsの列順はここを単一の正とする。
 */

const BRAND_HEADERS = ['brand_id', 'ブランド名', '業種・カテゴリ', '担当・連絡先', 'メモ', '作成日', '最終更新'];
const PRODUCT_HEADERS = ['product_id', 'brand_id', '商品名', 'カテゴリ', '価格帯', 'URL', '需要タイプ', 'メモ', '作成日', '最終更新'];
const CASE_HEADERS = ['case_id', 'brand_id', 'product_id', '案件名', 'ステータス', '商戦時期', '予算', '目標', 'メモ', '作成日', '最終更新'];
const CASE_STATUSES = ['受注', 'ヒアリング', '候補リスト作成', 'クライアント選定待ち', '起用交渉', '制作進行', '投稿済み', '成果回収・完了', '見送り・中止'];

function isoDate(now) { return now.toISOString().slice(0, 10); }

function require1(obj, field, label) {
  if (!obj || !String(obj[field] == null ? '' : obj[field]).trim()) {
    throw new Error('必須項目が不足しています: ' + label);
  }
}

// --- ブランド ---
function validateBrand(o) { require1(o, 'name', 'ブランド名'); }
function toBrandRow(o, id, now = new Date(), created) {
  const d = isoDate(now);
  return [id, o.name || '', o.industry || '', o.contact || '', o.note || '', created || d, d];
}
function parseBrand(r) {
  return { brand_id: r[0] || '', name: r[1] || '', industry: r[2] || '', contact: r[3] || '', note: r[4] || '', created: r[5] || '', updated: r[6] || '' };
}

// --- 商品 ---
function validateProduct(o) { require1(o, 'brand_id', 'brand_id'); require1(o, 'name', '商品名'); }
function toProductRow(o, id, now = new Date(), created) {
  const d = isoDate(now);
  return [id, o.brand_id || '', o.name || '', o.category || '', o.price || '', o.url || '', o.demandType || '', o.note || '', created || d, d];
}
function parseProduct(r) {
  return { product_id: r[0] || '', brand_id: r[1] || '', name: r[2] || '', category: r[3] || '', price: r[4] || '', url: r[5] || '', demandType: r[6] || '', note: r[7] || '', created: r[8] || '', updated: r[9] || '' };
}

// --- 案件 ---
function validateCase(o) {
  require1(o, 'brand_id', 'brand_id');
  require1(o, 'product_id', 'product_id');
  require1(o, 'name', '案件名');
  if (o.status && !CASE_STATUSES.includes(o.status)) {
    throw new Error('不正なステータス: ' + o.status);
  }
}
function toCaseRow(o, id, now = new Date(), created) {
  const d = isoDate(now);
  return [id, o.brand_id || '', o.product_id || '', o.name || '', o.status || '受注', o.season || '', o.budget || '', o.goal || '', o.note || '', created || d, d];
}
function parseCase(r) {
  return { case_id: r[0] || '', brand_id: r[1] || '', product_id: r[2] || '', name: r[3] || '', status: r[4] || '', season: r[5] || '', budget: r[6] || '', goal: r[7] || '', note: r[8] || '', created: r[9] || '', updated: r[10] || '' };
}

module.exports = {
  BRAND_HEADERS, PRODUCT_HEADERS, CASE_HEADERS, CASE_STATUSES,
  validateBrand, toBrandRow, parseBrand,
  validateProduct, toProductRow, parseProduct,
  validateCase, toCaseRow, parseCase,
};
