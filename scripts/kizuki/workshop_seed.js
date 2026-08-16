'use strict';
/**
 * workshop_extract.js が出した候補ワードJSONを、気づきワード台帳と勉強会シグナルに登録する。
 * 仕様: docs/superpowers/specs/2026-08-17-kizuki-word-cycle-workshop-ingest.md
 *
 * 使い方:
 *   node scripts/kizuki/workshop_seed.js <candidates.json> --case <case_id> --product <product_id> [--apply]
 *   --apply なしは登録予定を表示するだけ（書き込みなし）。
 */
require('dotenv').config({ override: true });
const fs = require('fs');
const { readRows, appendRow } = require('../../lib/sheets');
const ledger = require('../../lib/kizuki/ledger-store');
const workshop = require('../../lib/kizuki/workshop-ingest');

const SHEET_ID = process.env.SHEET_ID;
const APPLY = process.argv.includes('--apply');
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
};
const JSON_PATH = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : null;
const CASE_ID = arg('--case');
const PRODUCT_ID = arg('--product') || '';

/**
 * 既存の word_id と衝突しない採番をする。
 * aggregateSignals はシグナルを word_id だけで突合し case では絞らないため、
 * 別案件で同じ word_id を振るとシグナルが混ざる。台帳全体で一意にする必要がある。
 */
function nextWordIdAllocator(ledgerRows) {
  let max = 0;
  for (const r of (ledgerRows || []).slice(1)) {
    const m = String((r || [])[ledger.L.wordId] || '').match(/^w(\d+)$/i);
    if (m) max = Math.max(max, Number(m[1]));
  }
  let next = max;
  return () => { next += 1; return `w${String(next).padStart(3, '0')}`; };
}

async function main() {
  if (!SHEET_ID) throw new Error('SHEET_ID が未設定です');
  if (!JSON_PATH) throw new Error('candidates.json のパスを指定してください');
  if (!CASE_ID) throw new Error('--case <case_id> を指定してください');

  const payload = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
  const words = payload.words || [];
  if (!words.length) throw new Error('候補ワードが0件です');

  const ledgerRows = await readRows(SHEET_ID, ledger.TABS.LEDGER);
  const already = ledgerRows.slice(1).filter((r) => r[ledger.L.wordId] && r[ledger.L.case] === CASE_ID);
  if (already.length) {
    throw new Error(`case=${CASE_ID} には既に ${already.length} 行あります（重複登録を避けるため中断）`);
  }

  const nextId = nextWordIdAllocator(ledgerRows);
  const unawareSet = new Set(payload.unaware || []);
  const withIds = words.map((w) => ({ ...w, wordId: nextId() }));

  const ledgerNewRows = withIds.map((w) => [
    CASE_ID, PRODUCT_ID, w.wordId, w.word, w.axis,
    '勉強会', '候補', '', '', '',
    `勉強会アンケートから抽出（言及${(w.mentionedBy || []).length}人 / n=${payload.respondents ?? ''}）`, '',
  ]);
  const signalRows = workshop.buildWorkshopSignalRows(withIds, unawareSet);

  console.log('case=%s / 候補ワード %d件 / 回答者 %s人', CASE_ID, withIds.length, payload.respondents ?? '?');
  console.log('採番: %s 〜 %s', withIds[0].wordId, withIds[withIds.length - 1].wordId);
  console.log('');
  console.log('word_id  言及  未認知  ワード');
  signalRows.forEach((s, i) => {
    console.log(`${s[0].padEnd(8)}${String(s[3]).padStart(3)}  ${s[5].padEnd(6)}  ${withIds[i].word}`);
  });
  if (!APPLY) { console.log('\n--apply を付けると台帳と勉強会シグナルに書き込みます。'); return; }

  for (const row of ledgerNewRows) await appendRow(SHEET_ID, ledger.TABS.LEDGER, row);
  for (const row of signalRows) await appendRow(SHEET_ID, ledger.TABS.WORKSHOP, row);
  console.log('\n✅ 台帳 %d行 / 勉強会シグナル %d行を追加しました。', ledgerNewRows.length, signalRows.length);
  console.log('（スコア反映: node scripts/kizuki/recalc_job.js）');
}

module.exports = { nextWordIdAllocator };

if (require.main === module) {
  main().catch((e) => { console.error('❌ workshop_seed 失敗:', e.message); process.exit(1); });
}
