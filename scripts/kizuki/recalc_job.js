'use strict';
/**
 * 気づきワードサイクル Phase3 スライス1 バッチ本体。
 * BQ(ad_creative_daily)＋Sheet(広告マッピング) → ad-ingest → 広告シグナルを creative_id upsert
 * → ledger-store でスコア再計算し台帳へ書戻し。Cloud Run Job として Cloud Scheduler が日次実行。
 * 仕様: docs/superpowers/specs/2026-07-10-kizuki-word-cycle-phase3-slice1-ad-ingest.md
 *
 * 使い方: node scripts/kizuki/recalc_job.js [--dry-run]
 */
require('dotenv').config({ override: true });
const { readRows, updateRowById, appendRow } = require('../../lib/sheets');
const adIngest = require('../../lib/kizuki/ad-ingest');
const ledger = require('../../lib/kizuki/ledger-store');

const SHEET_ID = process.env.SHEET_ID;
const BQ_PROJECT = process.env.BQ_PROJECT || 'cg-project-491303';
const BQ_DATASET = process.env.BQ_DATASET || 'cg_analytics';
const AD_MAPPING_TAB = '広告マッピング';
const DRY_RUN = process.argv.includes('--dry-run');

/** BQ の ad_creative_daily を creative 粒度で集計取得（累計）。--dry-run では空配列。 */
async function fetchAdRowsFromBQ() {
  if (DRY_RUN) return [];
  const { BigQuery } = require('@google-cloud/bigquery');
  const bq = new BigQuery({ projectId: BQ_PROJECT });
  const sql = `
    SELECT creative_id,
           SUM(impressions) AS impressions,
           SUM(clicks) AS clicks,
           SUM(conversions) AS conversions,
           SUM(cost) AS cost,
           SUM(revenue) AS revenue,
           ANY_VALUE(demographics) AS demographics
    FROM \`${BQ_PROJECT}.${BQ_DATASET}.ad_creative_daily\`
    GROUP BY creative_id`;
  const [rows] = await bq.query({ query: sql });
  return rows;
}

/** 広告マッピングタブを [{creative_id, word_id}] で読む（ヘッダー: creative_id,word_id,...）。 */
async function readMapping() {
  const rows = await readRows(SHEET_ID, AD_MAPPING_TAB);
  return rows.slice(1)
    .filter((r) => r[0] && r[1])
    .map((r) => ({ creative_id: r[0], word_id: r[1] }));
}

/** 広告シグナルを creative_id(列index1) で upsert。マッピング外の手入力行は触らない。 */
async function upsertAdSignals(signalRows) {
  const existing = await readRows(SHEET_ID, ledger.TABS.AD);
  const existingIds = new Set(existing.slice(1).map((r) => r[1]).filter(Boolean));
  for (const row of signalRows) {
    const creativeId = row[1];
    if (existingIds.has(creativeId)) {
      await updateRowById(SHEET_ID, ledger.TABS.AD, 1, creativeId, row);
    } else {
      await appendRow(SHEET_ID, ledger.TABS.AD, row);
      existingIds.add(creativeId);
    }
  }
}

/** 台帳の全ワードを score.js で再計算し書戻し（Phase2 /recalc と同一ロジック）。1件失敗しても継続。 */
async function recalcLedger() {
  const [ledgerRows, workshopRows, reviewRows, adRows, collabRows] = await Promise.all([
    readRows(SHEET_ID, ledger.TABS.LEDGER),
    readRows(SHEET_ID, ledger.TABS.WORKSHOP),
    readRows(SHEET_ID, ledger.TABS.REVIEW),
    readRows(SHEET_ID, ledger.TABS.AD),
    readRows(SHEET_ID, ledger.TABS.COLLAB),
  ]);
  const words = ledger.buildWordRows({ ledgerRows, workshopRows, reviewRows, adRows, collabRows }, '');
  const dataRows = ledgerRows.slice(1);
  let updated = 0;
  for (const w of words) {
    try {
      const row = dataRows.find((r) => r[ledger.L.wordId] === w.wordId);
      if (!row) continue;
      await updateRowById(SHEET_ID, ledger.TABS.LEDGER, ledger.L.wordId, w.wordId, ledger.buildLedgerScoreUpdate(row, w.computed));
      updated += 1;
    } catch (e) {
      console.error('⚠ 再計算失敗 word=%s: %s', w.wordId, e.message);
    }
  }
  return updated;
}

async function main() {
  const bqRows = await fetchAdRowsFromBQ();
  const mapping = DRY_RUN ? [] : await readMapping();
  const signalRows = adIngest.buildAdSignalRows(bqRows, mapping);
  if (DRY_RUN) {
    console.log('DRY-RUN: BQ %d行 / マッピング %d件 / 広告シグナル生成 %d行（書込なし）',
      bqRows.length, mapping.length, signalRows.length);
    return;
  }
  await upsertAdSignals(signalRows);
  const updated = await recalcLedger();
  console.log('✅ 広告シグナル upsert %d行 / 台帳スコア再計算 %d件', signalRows.length, updated);
}

main().catch((e) => { console.error('❌ recalc_job 失敗:', e.message); process.exit(1); });
