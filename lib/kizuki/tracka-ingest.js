'use strict';

/**
 * Track A（標準化3択アンケート）の回答シートを、tallyTrackA に渡せる形へ変換する純粋関数。
 * 集計そのものは review-ingest の tallyTrackA が担う（ここでは再実装しない）。
 * 仕様: docs/superpowers/specs/2026-08-16-kizuki-word-cycle-tracka-ingest.md
 *
 * 設問は1ワード1問で、見出しの末尾に [word_id] が入っている:
 *   「〇〇」について、あなたに一番近いものは？ [w002]
 *     ① ピンとこない／当てはまらない                        → 分母のみ
 *     ② 共感する（でも購入の決め手ではない）                 → 件数+1・意向0（虚栄の受け皿）
 *     ③ 共感するし、これがあるから買いたい／使い続けたい      → 件数+1・意向+1
 */

const WORD_ID_IN_HEADER = /\[\s*(w\d+)\s*\]/i;
const MARU = { '①': 1, '②': 2, '③': 3 };

const str = (v) => (v === null || v === undefined ? '' : String(v));

/**
 * ヘッダー行から設問列を拾う → [{index, wordId}]。
 * 文言は運用の都合で随時修正されるため、突合は word_id だけで行う。
 * 同じ word_id が複数列にあれば先の列を採る（再掲設問で二重計上しない）。
 */
function detectWordColumns(headerRow) {
  const out = [];
  const seen = new Set();
  (headerRow || []).forEach((cell, index) => {
    const m = str(cell).match(WORD_ID_IN_HEADER);
    if (!m) return;
    const wordId = m[1].toLowerCase();
    if (seen.has(wordId)) return;
    seen.add(wordId);
    out.push({ index, wordId });
  });
  return out;
}

/**
 * 選択肢の値から 1|2|3 を取り出す。取れなければ null（＝未回答扱い）。
 *
 * ⚠️ 必ず number を返すこと。tallyTrackA は `choice !== 2 && choice !== 3` の厳密比較なので、
 * Sheets 由来の文字列 '3' をそのまま渡すと全ワードが0件に潰れる。例外は出ない。
 */
function parseChoice(value) {
  const s = str(value).trim();
  if (!s) return null;
  const head = s[0];
  if (MARU[head]) return MARU[head];
  const m = s.match(/^([123])(?!\d)/);
  return m ? Number(m[1]) : null;
}

/**
 * 生行（ヘッダー込み）→ [[{wordId, choice}], ...]（1要素=1回答者）。
 *
 * 設問列に1つも回答が無い行は回答者に数えない。生の回答シートには氏名だけの名簿行や
 * 自由記述しか埋まっていない行が混ざることがあり、数えると共感率の分母nが膨らむ。
 * 未回答の設問はその回答者の配列に載せない（分母には残るが件数・意向には数えない）。
 */
function parseTrackAResponses(rows) {
  const all = rows || [];
  const cols = detectWordColumns(all[0]);
  if (!cols.length) return [];
  const out = [];
  for (const r of all.slice(1)) {
    if (!r) continue;
    const answers = [];
    for (const { index, wordId } of cols) {
      const choice = parseChoice(r[index]);
      if (choice !== null) answers.push({ wordId, choice });
    }
    if (!answers.length) continue;
    out.push(answers);
  }
  return out;
}

module.exports = { detectWordColumns, parseChoice, parseTrackAResponses };
