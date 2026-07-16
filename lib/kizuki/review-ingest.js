'use strict';

const { toNum } = require('./format');

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

module.exports = { SOURCES, S, parseSurveyRows };
