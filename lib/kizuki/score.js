'use strict';

/**
 * 気づきワード 訴求スコア計算。
 * 仕様: docs/superpowers/specs/2026-06-30-kizuki-word-cycle-design.md セクション2。
 * 実データ（広告CTR/CVR）を最重視し、言及の多さ（虚栄）だけでは上がらない。
 * これがスコアの単一の正。GAS台帳/コックピット/BQはこの定義に従う。
 */

// 配点（合計100。虚栄控除は別途 -20..0）
const WEIGHTS = {
  workshop: 15, // ①勉強会：言及の質＋ブランド未認知
  review: 25,   // ②Pamun：購買意向共感率
  ad: 40,       // ③広告：CTR/CVR/ROAS（最重視）
  demo: 10,     // ③広告：デモグラ明確度
  collab: 10,   // ④インフル：適合・実売
};

function computeAppealScore(signals = {}) {
  return { score: 0, grade: '×', stage: '暫定', breakdown: {} };
}

module.exports = { computeAppealScore, WEIGHTS };
