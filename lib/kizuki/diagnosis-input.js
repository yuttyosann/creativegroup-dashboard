'use strict';

/**
 * 勝ち訴求（気づきワード）＋勝ちデモグラから、診断ツールの入力（M01/M02/M04の根拠）を生成する。
 * 生成した productSummary / conditions は、コックピットの診断フロー（/api/cockpit/analyze の diagnose）に流す。
 * 仕様: docs/superpowers/specs/2026-07-06-kizuki-word-cycle-phase2-design.md
 */
function buildDiagnosisInput({ word = '', axis = '', demographics = '' } = {}) {
  const demo = String(demographics).trim();
  const productSummary =
    `【広告で勝った訴求】「${word}」（訴求軸：${axis}）\n`
    + `この訴求が広告で最も反応が高かった。M01(カテゴリ)・M02(需要・肌悩み適合)の判定はこの勝ち訴求を軸に行う。`;
  const conditions =
    `【狙う客層＝広告で反応が高かったデモグラ（M04フォロワー層適合の基準）】`
    + (demo ? `${demo}` : `未確定（広告デモグラ未取得。取得後に上書き）`);
  return { productSummary, conditions };
}

module.exports = { buildDiagnosisInput };
