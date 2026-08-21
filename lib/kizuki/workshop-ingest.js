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

// フォームの回答は A列にタイムスタンプが入る。人が回答シートの下に作る集計行・管理メモには
// 入らないので、これで「本物の回答行」を切り分ける（実データで集計行42行が混ざっていた）。
const TIMESTAMP_RE = /^\d{4}[/-]\d{1,2}[/-]\d{1,2}/;

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

/** 実際のフォーム回答行か（A列がタイムスタンプ）。人が下に作った集計行を除くため。 */
function isFormResponse(row) {
  return !!row && TIMESTAMP_RE.test(str(row[0]).trim());
}

/**
 * 事前アンケートの生行 → [{email, text}]（認知度の自由記述）。
 * 認知度は選択式ではなく自由記述なので、判定は呼び出し側でLLMに任せる。
 * 「アベンヌは知っていたがシカ商品は知らなかった」のような回答が多数を占め、
 * 部分一致では両方向に誤判定するため。
 */
function parseAwarenessRows(preRows) {
  const rows = preRows || [];
  const col = detectAwarenessColumn(rows[0]);
  if (col === null) return [];
  return rows.slice(1)
    .filter(isFormResponse)
    .map((r) => ({ email: normEmail(r[1]), text: str(r[col]) }))
    .filter((x) => x.email && x.text.trim());
}

/**
 * LLMの分類結果 → 未認知の集合。
 * brand=ブランド自体を知らなかった / product=シカラインを知らなかった。
 * either はどちらか一方でも未認知なら含む。アベンヌ自体は有名でブランド未認知が
 * ごく少数になるため、シグナルには either を使う。
 */
function buildUnawareSets(classified) {
  const brand = new Set(), product = new Set(), either = new Set();
  for (const c of classified || []) {
    const email = normEmail(c && c.email);
    if (!email) continue;
    if (c.brandUnaware) { brand.add(email); either.add(email); }
    if (c.productUnaware) { product.add(email); either.add(email); }
  }
  return { brand, product, either };
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
  FREE_TEXT_LABELS,
  detectFreeTextColumns, detectAwarenessColumn, isFormResponse,
  parseAwarenessRows, buildUnawareSets, majorityUnaware,
  anonymizeParticipant, buildWorkshopSignalRows,
};
