'use strict';
/**
 * Track A（標準化3択アンケート）の設問テキストを生成する（読み取りのみ・書き込みなし）。
 * 出力をそのまま Pamun の事後アンケートフォームに貼り付ける。
 * 仕様: docs/superpowers/specs/2026-08-16-kizuki-word-cycle-tracka-ingest.md
 *
 * 使い方: node scripts/kizuki/tracka_questions.js --case <case_id>
 *
 * 設問文の末尾に [word_id] を入れる。取込はこの word_id だけで列を突合するので、
 * 文言はフォーム側で自由に直してよい（[wNNN] を消さない限り壊れない）。
 */
require('dotenv').config({ override: true });
const { readRows } = require('../../lib/sheets');
const ledger = require('../../lib/kizuki/ledger-store');

const SHEET_ID = process.env.SHEET_ID;
const TARGET_STATUS = 'モニター';
const MIN_WORDS = 5;
const MAX_WORDS = 8;
const CASE_ARG = (() => {
  const i = process.argv.indexOf('--case');
  return i >= 0 ? process.argv[i + 1] : null;
})();

const CHOICES = [
  '① ピンとこない／当てはまらない',
  '② 共感する（でも購入の決め手ではない）',
  '③ 共感するし、これがあるから買いたい／使い続けたい',
];

async function main() {
  if (!SHEET_ID) throw new Error('SHEET_ID が未設定です');
  if (!CASE_ARG) throw new Error('--case <case_id> を指定してください');

  const rows = await readRows(SHEET_ID, ledger.TABS.LEDGER);
  const words = rows.slice(1).filter((r) =>
    r[ledger.L.wordId] && r[ledger.L.case] === CASE_ARG && r[ledger.L.status] === TARGET_STATUS);

  if (!words.length) {
    throw new Error(`case=${CASE_ARG} に status=${TARGET_STATUS} のワードがありません`
      + '（設問にするワードの status を「モニター」にしてください）');
  }
  if (words.length < MIN_WORDS || words.length > MAX_WORDS) {
    console.error(`⚠ 設問が %d件です（推奨は %d〜%d件）。`, words.length, MIN_WORDS, MAX_WORDS);
    console.error('  多すぎると回答負担で離脱し、少なすぎると比較する材料が足りません。');
  }

  console.log(`# Track A 設問（case=${CASE_ARG} / ${words.length}問）`);
  console.log('# 各問「1つ選択」形式。末尾の [wNNN] は取込の突合キーなので消さないでください。\n');
  words.forEach((r, i) => {
    console.log(`Q${i + 1}. 「${r[ledger.L.word]}」について、あなたに一番近いものは？ [${r[ledger.L.wordId]}]`);
    CHOICES.forEach((c) => console.log(`    ${c}`));
    console.log('');
  });
}

main().catch((e) => { console.error('❌ tracka_questions 失敗:', e.message); process.exit(1); });
