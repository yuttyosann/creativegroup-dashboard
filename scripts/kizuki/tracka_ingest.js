'use strict';
/**
 * 気づきワードサイクル Track A（標準化3択アンケート）取込バッチ。
 * Sheet(Pamun取込マッピング) → 施策ごとの事後アンケート → 3択を決定的に集計
 * → review-ingest でモニターシグナル行を生成 → (word_id, campaign_id, source) で upsert。
 * 仕様: docs/superpowers/specs/2026-08-16-kizuki-word-cycle-tracka-ingest.md
 *
 * 使い方: node scripts/kizuki/tracka_ingest.js [--campaign <campaign_id>] [--dry-run]
 *
 * pamun_ingest（Track B）と同じマッピング行・同じ回答シートを見る。
 * LLM を使わないので dry-run でも実際の集計結果が出る。
 * 台帳スコアの再計算は recalc_job.js が行う。
 */
require('dotenv').config({ override: true });
const { readRows, appendRow, updateRowAt, findRowNumberByKey } = require('../../lib/sheets');
const { toNum } = require('../../lib/kizuki/format');
const ledger = require('../../lib/kizuki/ledger-store');
const reviewIngest = require('../../lib/kizuki/review-ingest');
const trackaIngest = require('../../lib/kizuki/tracka-ingest');

const SHEET_ID = process.env.SHEET_ID;
const MAPPING_TAB = 'Pamun取込マッピング';
const TARGET_STATUS = 'モニター';
const DRY_RUN = process.argv.includes('--dry-run');
const CAMPAIGN_ARG = (() => {
  const i = process.argv.indexOf('--campaign');
  return i >= 0 ? process.argv[i + 1] : null;
})();

/** Pamun取込マッピング（campaign_id, report_sheet_id, survey_tab, case_id, n）を読む。 */
async function readMapping() {
  const rows = await readRows(SHEET_ID, MAPPING_TAB);
  return rows.slice(1)
    .filter((r) => r[0] && r[2] && r[3])
    .map((r) => ({
      campaignId: r[0],
      reportSheetId: r[1] || SHEET_ID,
      surveyTab: r[2],
      caseId: r[3],
      n: toNum(r[4]),
    }));
}

/** 台帳から case の候補ワードを引く（status も持つ。設問化対象の判定に使う）。 */
async function readCandidates(caseId) {
  const rows = await readRows(SHEET_ID, ledger.TABS.LEDGER);
  return rows.slice(1)
    .filter((r) => r[ledger.L.wordId] && r[ledger.L.case] === caseId)
    .map((r) => ({
      wordId: r[ledger.L.wordId],
      word: r[ledger.L.word],
      status: r[ledger.L.status],
    }));
}

/** モニターシグナルを (word_id, campaign_id, source) で upsert。他sourceの行は触らない。 */
async function upsertReviewSignals(signalRows) {
  let inserted = 0, updated = 0;
  for (const row of signalRows) {
    const existing = await readRows(SHEET_ID, ledger.TABS.REVIEW);
    const rowNumber = findRowNumberByKey(existing, reviewIngest.signalKey, reviewIngest.signalKey(row));
    if (rowNumber === -1) {
      await appendRow(SHEET_ID, ledger.TABS.REVIEW, row);
      inserted += 1;
    } else {
      await updateRowAt(SHEET_ID, ledger.TABS.REVIEW, rowNumber, row);
      updated += 1;
    }
  }
  return { inserted, updated };
}

async function ingestCampaign(m) {
  const surveyRows = await readRows(m.reportSheetId, m.surveyTab);
  const respondents = trackaIngest.parseTrackAResponses(surveyRows);
  const candidates = await readCandidates(m.caseId);
  if (!candidates.length) {
    console.error('⚠ 候補ワードが台帳にありません case=%s（skip）', m.caseId);
    return { rows: [] };
  }

  // status=モニター にしたのに設問列が無いワードは、黙って0件にせず警告する。
  // フォーム側で設問を消したり [wNNN] を落としたりすると、そのワードだけ静かに欠測になる。
  const asked = new Set(trackaIngest.detectWordColumns(surveyRows[0]).map((c) => c.wordId));
  const missing = candidates.filter((c) => c.status === TARGET_STATUS && !asked.has(c.wordId));
  if (missing.length) {
    console.error('⚠ %s: 設問列が見つからないワード: %s', m.campaignId,
      missing.map((c) => c.wordId).join(', '));
    console.error('  台帳で status=%s だが回答シートに [wNNN] の列がありません。', TARGET_STATUS);
  }

  if (!respondents.length) {
    console.log('· %s: 3択の回答0件（n=%d）→ 生成なし', m.campaignId, m.n !== null ? m.n : 0);
    return { rows: [] };
  }
  const n = m.n !== null ? m.n : respondents.length;
  const rows = reviewIngest.buildReviewSignalRows(reviewIngest.tallyTrackA(respondents), {
    n,
    campaignId: m.campaignId,
    source: reviewIngest.SOURCES.TRACK_A,
    candidateWordIds: candidates.map((c) => c.wordId),
  });
  return { rows, n, respondents: respondents.length };
}

async function main() {
  if (!SHEET_ID) throw new Error('SHEET_ID が未設定です');
  const mapping = await readMapping();
  const targets = CAMPAIGN_ARG ? mapping.filter((m) => m.campaignId === CAMPAIGN_ARG) : mapping;
  if (!targets.length) throw new Error('対象施策がマッピングにありません（許可リストに追加してください）');

  let totalRows = 0;
  for (const m of targets) {
    const { rows, n, respondents } = await ingestCampaign(m);
    totalRows += rows.length;
    if (DRY_RUN) {
      console.log('DRY-RUN: %s 回答%s人 / n=%s / モニターシグナル生成 %d行（書込なし）',
        m.campaignId, respondents ?? 0, n ?? 0, rows.length);
      continue;
    }
    if (!rows.length) continue;
    const { inserted, updated } = await upsertReviewSignals(rows);
    console.log('✅ %s: モニターシグナル 追加%d行 / 更新%d行（n=%d）', m.campaignId, inserted, updated, n);
  }
  if (!DRY_RUN) {
    console.log('計 %d行。台帳スコアの再計算は recalc_job.js で反映されます', totalRows);
  }
}

main().catch((e) => { console.error('❌ tracka_ingest 失敗:', e.message); process.exit(1); });
