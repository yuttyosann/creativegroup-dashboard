'use strict';
/**
 * 気づきワードサイクル Phase3 スライス2 バッチ本体（Track B＝既存の従来Pamun進行）。
 * Sheet(Pamun取込マッピング) → レポートの《事後アンケート》詳細 → LLMで候補ワードへ写像
 * → review-ingest でモニターシグナル行を生成 → (word_id, campaign_id, source) で upsert。
 * 仕様: docs/superpowers/specs/2026-07-16-kizuki-word-cycle-phase3-slice2-pamun-ingest.md
 *
 * 使い方: node scripts/kizuki/pamun_ingest.js [--campaign <campaign_id>] [--dry-run]
 * 台帳スコアの再計算は recalc_job.js が行う（即時反映したい場合は続けて実行する）。
 */
require('dotenv').config({ override: true });
const Anthropic = require('@anthropic-ai/sdk');
const { readRows, appendRow, updateRowAt, findRowNumberByKey } = require('../../lib/sheets');
const { toNum } = require('../../lib/kizuki/format');
const ledger = require('../../lib/kizuki/ledger-store');
const reviewIngest = require('../../lib/kizuki/review-ingest');

const SHEET_ID = process.env.SHEET_ID;
const MAPPING_TAB = 'Pamun取込マッピング';
const SURVEY_TAB = '《事後アンケート》詳細';
const MODEL = 'claude-opus-4-8';
const DRY_RUN = process.argv.includes('--dry-run');
const CAMPAIGN_ARG = (() => {
  const i = process.argv.indexOf('--campaign');
  return i >= 0 ? process.argv[i + 1] : null;
})();

/** Pamun取込マッピングタブ（ヘッダー: campaign_id, report_name, case_id, n）を読む。 */
async function readMapping() {
  const rows = await readRows(SHEET_ID, MAPPING_TAB);
  return rows.slice(1)
    .filter((r) => r[0] && r[1] && r[2])
    .map((r) => ({ campaignId: r[0], reportName: r[1], caseId: r[2], n: toNum(r[3]) }));
}

/** 台帳から case の候補ワードを引く（word_id と表記のペア）。 */
async function readCandidates(caseId) {
  const rows = await readRows(SHEET_ID, ledger.TABS.LEDGER);
  return rows.slice(1)
    .filter((r) => r[ledger.L.wordId] && r[ledger.L.case] === caseId)
    .map((r) => ({ wordId: r[ledger.L.wordId], word: r[ledger.L.word] }));
}

const CLASSIFY_SCHEMA = {
  type: 'object',
  properties: {
    respondents: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          index: { type: 'integer' },
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                wordId: { type: 'string' },
                intent: { type: 'boolean' },
                vanity: { type: 'boolean' },
                confidence: { type: 'number' },
              },
              required: ['wordId', 'intent', 'vanity', 'confidence'],
              additionalProperties: false,
            },
          },
        },
        required: ['index', 'items'],
        additionalProperties: false,
      },
    },
  },
  required: ['respondents'],
  additionalProperties: false,
};

const SYSTEM_PROMPT = [
  'あなたはPamunモニターの事後アンケート回答を、与えられた「気づきワード候補」に写像する分類器です。',
  '',
  '厳守事項:',
  '- wordId は与えられた候補一覧のいずれかのみ。新しいワードを作らないこと。該当しなければ items を空配列にする。',
  '- intent は「買いたい／使い続けたい」に相当する記述がある場合のみ true。満足の表明だけでは false。',
  '- vanity は見た目・パッケージ・可愛さ等の反応のみで、機能や体験の価値に触れていない場合に true。',
  '- vanity な反応は購買意向として扱わない（呼び出し側で意向から除外される）。',
  '- confidence は0〜1でその分類の確からしさ。',
  '- 主な判断材料は goodPoints（良かった点）。satisfaction / favorite / improvements は文脈として使う。',
  '- 入力の index を必ずそのまま返すこと。',
].join('\n');

/** 回答者配列 → [[{wordId,intent,vanity,confidence}], ...]（indexで整列）。 */
async function classify(respondents, candidates) {
  if (!respondents.length) return [];
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: CLASSIFY_SCHEMA } },
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: JSON.stringify({
        candidates,
        respondents: respondents.map((r) => ({
          index: r.index, satisfaction: r.satisfaction, goodPoints: r.goodPoints,
          improvements: r.improvements, favorite: r.favorite,
        })),
      }),
    }],
  });
  if (msg.stop_reason === 'refusal') throw new Error('分類がrefusalで停止しました');
  const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  const parsed = JSON.parse(text);

  // index で整列し直す（対応ズレ検知。欠落は「該当なし」として空配列）
  const byIndex = new Map(parsed.respondents.map((r) => [r.index, r.items || []]));
  return respondents.map((r) => byIndex.get(r.index) || []);
}

/** モニターシグナルを (word_id, campaign_id, source) で upsert。手入力/trackA行は触らない。 */
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
  const surveyRows = await readRows(SHEET_ID, `${m.reportName}${SURVEY_TAB}`);
  const respondents = reviewIngest.parseSurveyRows(surveyRows);
  const n = m.n !== null ? m.n : respondents.length;
  const candidates = await readCandidates(m.caseId);
  if (!candidates.length) {
    console.error('⚠ 候補ワードが台帳にありません case=%s（skip）', m.caseId);
    return { campaignId: m.campaignId, rows: [] };
  }
  if (!respondents.length) {
    console.log('· %s: 事後アンケート回答0件（n=%d）→ 生成なし', m.campaignId, n);
    return { campaignId: m.campaignId, rows: [] };
  }
  const classified = DRY_RUN ? respondents.map(() => []) : await classify(respondents, candidates);
  const rows = reviewIngest.buildReviewSignalRows(reviewIngest.tallyTrackB(classified), {
    n,
    campaignId: m.campaignId,
    source: reviewIngest.SOURCES.TRACK_B,
    candidateWordIds: candidates.map((c) => c.wordId),
  });
  return { campaignId: m.campaignId, rows, n, respondents: respondents.length };
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
      console.log('DRY-RUN: %s 回答%s人 / n=%s / モニターシグナル生成 %d行（LLM分類・書込なし）',
        m.campaignId, respondents ?? 0, n ?? 0, rows.length);
      continue;
    }
    if (!rows.length) continue;
    const { inserted, updated } = await upsertReviewSignals(rows);
    console.log('✅ %s: モニターシグナル 追加%d行 / 更新%d行（n=%d）', m.campaignId, inserted, updated, n);
  }
  if (!DRY_RUN) {
    console.log('計 %d行。台帳スコアの再計算は次回の recalc_job.js で反映されます', totalRows);
    console.log('（即時反映する場合: node scripts/kizuki/recalc_job.js）');
  }
}

main().catch((e) => { console.error('❌ pamun_ingest 失敗:', e.message); process.exit(1); });
