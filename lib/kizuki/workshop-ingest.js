'use strict';

/**
 * 勉強会アンケートから候補ワードと勉強会シグナルを起こすための純粋関数。
 * LLM呼び出し等の副作用は scripts/kizuki/workshop_extract.js 側に置く。
 * 仕様: docs/superpowers/specs/2026-08-17-kizuki-word-cycle-workshop-ingest.md
 *
 * スコアエンジンが勉強会シグナルから使うのは 言及数 と ブランド未認知 の2つだけ
 * （score.js の workshopScore）。発言抜粋・参加者ID・アンケ評価は根拠を追うための列。
 */

const crypto = require('crypto');

// 気づきワードの源泉になる自由記述の設問。意向・選択式はここに含めない
// （購入意向/推奨意向は商品全体に対する1問で、ワード単位ではないため）。
const FREE_TEXT_LABELS = [
  '最も印象が変わった点',
  '説明後に初めて理解できたこと',
  '印象に残った言葉',
  '使いたい部位・場面',
];

// 事前アンケートの認知度設問を見つけるためのキーワード（設問文に含まれる語）
const AWARENESS_KEYWORDS = ['認知', 'ご存知', 'ご存じ'];

// 「未認知」と見なす回答の部分一致。フォームの選択肢文言に依存するため、
// 実際に出現した値は呼び出し側でログに出して確認できるようにする。
const UNAWARE_PATTERNS = ['知らなかった', '知らない', '初めて', '聞いたことがない', '未認知'];

const str = (v) => (v === null || v === undefined ? '' : String(v));
const normEmail = (v) => str(v).trim().toLowerCase();

/** 事後アンケートのヘッダーから自由記述列を拾う → [{index, label}]（FREE_TEXT_LABELS の順）。 */
function detectFreeTextColumns(headerRow) {
  const cells = (headerRow || []).map(str);
  const out = [];
  for (const label of FREE_TEXT_LABELS) {
    const index = cells.findIndex((c) => c.includes(label));
    if (index >= 0) out.push({ index, label });
  }
  return out;
}

/** 事前アンケートのヘッダーから認知度列を探す。見つからなければ null。 */
function detectAwarenessColumn(headerRow) {
  const cells = (headerRow || []).map(str);
  const i = cells.findIndex((c) => AWARENESS_KEYWORDS.some((k) => c.includes(k)));
  return i >= 0 ? i : null;
}

/** 認知度の回答が「未認知」か。選択肢文言に依存するので部分一致で見る。 */
function isBrandUnaware(value) {
  const s = str(value);
  if (!s.trim()) return false;
  return UNAWARE_PATTERNS.some((p) => s.includes(p));
}

/** 事前アンケートの生行 → 未認知だった参加者のメール集合（小文字・trim）。 */
function buildUnawareSet(preRows) {
  const rows = preRows || [];
  const col = detectAwarenessColumn(rows[0]);
  const out = new Set();
  if (col === null) return out;
  for (const r of rows.slice(1)) {
    if (!r) continue;
    const email = normEmail(r[1]);
    if (email && isBrandUnaware(r[col])) out.add(email);
  }
  return out;
}

/**
 * 言及者の過半が未認知か。ちょうど半分は false（弁別力を保つため）。
 * 言及者0人なら false。
 */
function majorityUnaware(emails, unawareSet) {
  const list = (emails || []).map(normEmail).filter(Boolean);
  if (!list.length) return false;
  const hit = list.filter((e) => unawareSet && unawareSet.has(e)).length;
  return hit * 2 > list.length;
}

/** メールを勉強会内で一意な匿名IDにする（シートにメールを書かないため）。 */
function anonymizeParticipant(email) {
  const h = crypto.createHash('sha256').update(normEmail(email)).digest('hex');
  return `U-${h.slice(0, 6)}`;
}

/**
 * 候補ワード → 勉強会シグナル行。ワード単位1行。
 * words = [{wordId, quote, mentionedBy: [email]}]
 * 列順: [word_id, 参加者ID(匿名), 発言抜粋, 言及数, アンケ評価, ブランド未認知]
 *
 * ワード×参加者ではなくワード単位にするのは、ledger-store の aggregateSignals が
 * 同一word_idの ブランド未認知 を some() で OR するため。参加者単位にすると
 * 1人でも未認知でTRUEになり、workshopスコアの重みの半分が全ワードで満点になる。
 */
function buildWorkshopSignalRows(words, unawareSet) {
  return (words || []).map((w) => {
    const mentioned = (w.mentionedBy || []).map(normEmail).filter(Boolean);
    return [
      w.wordId,
      mentioned.length ? anonymizeParticipant(mentioned[0]) : '',
      str(w.quote),
      mentioned.length,
      '', // アンケ評価: 採点に使われず意味が定まっていないので空
      majorityUnaware(mentioned, unawareSet) ? 'TRUE' : 'FALSE',
    ];
  });
}

module.exports = {
  FREE_TEXT_LABELS, UNAWARE_PATTERNS,
  detectFreeTextColumns, detectAwarenessColumn, isBrandUnaware,
  buildUnawareSet, majorityUnaware, anonymizeParticipant, buildWorkshopSignalRows,
};
