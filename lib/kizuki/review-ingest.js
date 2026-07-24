'use strict';

const { pctStr, toNum } = require('./format');

/**
 * Pamunモニターの回答から「モニターシグナル」行を生成する（唯一のロジック核・純粋関数）。
 * LLM呼び出し等の副作用は scripts/kizuki/pamun_ingest.js 側に置き、ここは決定的変換のみ。
 * 仕様: docs/superpowers/specs/2026-07-16-kizuki-word-cycle-phase3-slice2-pamun-ingest.md
 *
 * 購買意向共感率 = 意向あり人数 ÷ 全回答者n（＝普及率。言及なしも分母に残る）
 * レビュー件数   = そのワードに共感/言及した人数（意向数ではない）
 * モニターシグナル列順: [word_id, レビュー件数, 購買意向共感率, 代表URL, 2次利用可否, source, campaign_id, confidence]
 */

// source（upsertの優先順位は ledger-store 側の REVIEW_SOURCE_PRIORITY が正）
const SOURCES = { MANUAL: 'manual', TRACK_A: 'trackA', TRACK_B: 'trackB' };

// 現行レポート《事後アンケート》詳細シートの列インデックス（0始まり）
const S = { age: 0, satisfaction: 1, goodPoints: 2, improvements: 3, containerWish: 4, favorite: 5 };

const str = (v) => (v === null || v === undefined ? '' : String(v));

/** 生行（ヘッダー込み）→ [{index, age, satisfaction, goodPoints, improvements, favorite}]。空行はスキップ。 */
function parseSurveyRows(rows) {
  const out = [];
  for (const r of (rows || []).slice(1)) {
    // 空白のみのセルも「空」扱い（幽霊回答者が共感率の分母nを水増しするのを防ぐ）。0は有意な値なので残る。
    if (!r || !r.some((c) => c !== null && c !== undefined && String(c).trim() !== '')) continue;
    out.push({
      index: out.length,
      age: toNum(r[S.age]),
      satisfaction: str(r[S.satisfaction]),
      goodPoints: str(r[S.goodPoints]),
      improvements: str(r[S.improvements]),
      favorite: str(r[S.favorite]),
    });
  }
  return out;
}

/** tally のエントリを取得（無ければ作る）。 */
function bucket(tally, wordId) {
  if (!tally[wordId]) tally[wordId] = { count: 0, intentCount: 0, confidences: [] };
  return tally[wordId];
}

/**
 * Track A（標準化3択アンケート）の集計。
 * respondents = [[{wordId, choice: 1|2|3}], ...]（1要素=1回答者）
 * → { wordId: {count, intentCount, confidences} }
 */
function tallyTrackA(respondents) {
  const tally = {};
  for (const answers of respondents || []) {
    const seen = new Set();
    for (const a of answers || []) {
      if (!a || !a.wordId || seen.has(a.wordId)) continue;
      seen.add(a.wordId);
      if (a.choice !== 2 && a.choice !== 3) continue; // ①は分母のみ（tallyに載せない）
      const e = bucket(tally, a.wordId);
      e.count += 1;
      if (a.choice === 3) e.intentCount += 1;
    }
  }
  return tally;
}

/**
 * Track B（既存レポートのLLM分類結果）の集計。
 * respondents = [[{wordId, intent, vanity, confidence}], ...]（1要素=1回答者・該当なしは空配列）
 * → { wordId: {count, intentCount, confidences} }
 * vanity=true（見た目等の反応のみ）は件数には数えるが意向には数えない。
 */
function tallyTrackB(respondents) {
  const tally = {};
  for (const items of respondents || []) {
    const seen = new Set();
    for (const it of items || []) {
      if (!it || !it.wordId || seen.has(it.wordId)) continue;
      seen.add(it.wordId);
      const e = bucket(tally, it.wordId);
      e.count += 1;
      if (it.intent && !it.vanity) e.intentCount += 1;
      // confidence=0 は「最も自信がない」＝要レビューの最強シグナルなので残す。
      // null/undefined/NaN は「値が出なかった」欠損なので落とす（Task5が平均する配列を汚さない）。
      if (Number.isFinite(it.confidence)) e.confidences.push(it.confidence);
    }
  }
  return tally;
}

/** confidence の平均（小数2桁・0は有意値として残す）。空・全て無効なら ''。 */
function avgConfidence(confidences) {
  const a = (confidences || []).filter((v) => Number.isFinite(v));
  if (!a.length) return '';
  return Math.round((a.reduce((s, v) => s + v, 0) / a.length) * 100) / 100;
}

/**
 * tally + メタ からモニターシグナル行の配列を生成。
 * opts = { n, campaignId, source, candidateWordIds? }
 * n = その施策の全回答者数（共感率の分母＝普及率）。candidateWordIds を渡すと候補外をスキップ。
 */
function buildReviewSignalRows(tally, opts) {
  const { n, campaignId, source } = opts || {};
  const allow = opts && opts.candidateWordIds ? new Set(opts.candidateWordIds) : null;
  const rows = [];
  for (const wordId of Object.keys(tally || {})) {
    if (allow && !allow.has(wordId)) continue;
    const e = tally[wordId];
    const rate = pctStr(e.intentCount, n);
    rows.push([
      wordId,
      e.count,
      rate === null ? '' : rate,
      '', // 代表URL: 当面は手入力/任意
      '', // 2次利用可否: 当面は手入力/任意
      source,
      campaignId,
      source === SOURCES.TRACK_B ? avgConfidence(e.confidences) : '',
    ]);
  }
  return rows;
}

/** モニターシグナル行の upsertキー (word_id, campaign_id, source)。 */
function signalKey(row) {
  return [row[0], row[6], row[5]].join('|');
}

module.exports = {
  SOURCES, S,
  parseSurveyRows, tallyTrackA, tallyTrackB,
  avgConfidence, buildReviewSignalRows, signalKey,
};
