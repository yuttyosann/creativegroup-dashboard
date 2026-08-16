'use strict';
/**
 * 勉強会アンケートから候補ワードを抽出する（読み取りのみ・シートには書き込まない）。
 * 出力JSONを人が確認・編集してから workshop_seed.js で台帳に登録する。
 * 仕様: docs/superpowers/specs/2026-08-17-kizuki-word-cycle-workshop-ingest.md
 *
 * 使い方:
 *   node scripts/kizuki/workshop_extract.js --post <sheet_id> [--pre <sheet_id>] > candidates.json
 *   タブ名が既定と違う場合のみ --post-tab / --pre-tab で指定する。
 */
require('dotenv').config({ override: true });
const Anthropic = require('@anthropic-ai/sdk');
const { readRows } = require('../../lib/sheets');
const workshop = require('../../lib/kizuki/workshop-ingest');

const MODEL = 'claude-opus-5';
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
};
const POST_ID = arg('--post');
const PRE_ID = arg('--pre');
const DEFAULT_TAB = 'フォームの回答 1'; // Googleフォームの回答シートの既定タブ名
const POST_TAB = arg('--post-tab') || DEFAULT_TAB;
const PRE_TAB = arg('--pre-tab') || DEFAULT_TAB;

const SCHEMA = {
  type: 'object',
  properties: {
    words: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          word: { type: 'string' },
          axis: { type: 'string', enum: ['効能', '情緒', '使用シーン', '成分', '価格'] },
          quote: { type: 'string' },
          mentionedBy: { type: 'array', items: { type: 'integer' } },
        },
        required: ['word', 'axis', 'quote', 'mentionedBy'],
        additionalProperties: false,
      },
    },
  },
  required: ['words'],
  additionalProperties: false,
};

const SYSTEM = [
  'あなたは勉強会の事後アンケートから「気づきワード」を抽出する担当です。',
  '気づきワードとは、参加者が実際に語った、広告訴求に転用できる具体的な言い回しのこと。',
  '',
  '厳守事項:',
  '- word は参加者が実際に語った内容に根ざした短い訴求フレーズにする（15〜25字程度）。',
  '  要約的な説明文ではなく、そのまま広告コピーの種になる言い回しにする。',
  '- 同じ内容を指すものは1つにまとめる。8〜14件程度に収める。',
  '- mentionedBy はその内容に言及した回答者の index。与えられた index 以外は使わない。',
  '- quote は根拠となる実際の記述をそのまま1つ引用する（改変しない）。',
  '- 「印象に残った言葉」の記述を最も重視する。他の設問は文脈として使う。',
].join('\n');

/** 事後アンケートの生行 → [{index, email, texts:{label:text}}]。自由記述が全て空の行は除く。 */
function parseRespondents(rows) {
  const cols = workshop.detectFreeTextColumns((rows || [])[0]);
  if (!cols.length) return { cols, respondents: [] };
  const respondents = [];
  for (const r of (rows || []).slice(1)) {
    if (!r) continue;
    const texts = {};
    let has = false;
    for (const { index, label } of cols) {
      const v = r[index] === null || r[index] === undefined ? '' : String(r[index]);
      texts[label] = v;
      if (v.trim()) has = true;
    }
    if (!has) continue;
    respondents.push({ index: respondents.length, email: String(r[1] || '').trim().toLowerCase(), texts });
  }
  return { cols, respondents };
}

async function main() {
  if (!POST_ID) throw new Error('--post <sheet_id>（事後アンケートの回答シート）を指定してください');

  const postRows = await readRows(POST_ID, POST_TAB);
  const { cols, respondents } = parseRespondents(postRows);
  if (!cols.length) throw new Error('自由記述の設問列が見つかりません（設問名を確認してください）');
  if (!respondents.length) throw new Error('回答が0件です');
  console.error('自由記述の設問: %s', cols.map((c) => c.label).join(' / '));
  console.error('回答者: %d人', respondents.length);

  let unawareSet = new Set();
  if (PRE_ID) {
    const preRows = await readRows(PRE_ID, PRE_TAB);
    unawareSet = workshop.buildUnawareSet(preRows);
    // 選択肢の文言はフォーム依存。実際に出現した値を必ず出して判定を確認できるようにする。
    const col = workshop.detectAwarenessColumn(preRows[0]);
    if (col === null) {
      console.error('⚠ 事前アンケートに認知度の設問が見つかりません → ブランド未認知は全てFALSEになります');
    } else {
      const seen = [...new Set(preRows.slice(1).map((r) => String((r || [])[col] || '').trim()).filter(Boolean))];
      console.error('認知度の回答値: %s', seen.map((v) => `「${v}」${workshop.isBrandUnaware(v) ? '=未認知' : ''}`).join(' / '));
      console.error('未認知と判定した参加者: %d人', unawareSet.size);
    }
  } else {
    console.error('⚠ --pre 未指定 → ブランド未認知は全てFALSEになります');
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'high', format: { type: 'json_schema', schema: SCHEMA } },
    system: SYSTEM,
    messages: [{ role: 'user', content: JSON.stringify(respondents.map((r) => ({ index: r.index, ...r.texts }))) }],
  });
  if (msg.stop_reason === 'refusal') throw new Error('抽出がrefusalで停止しました');
  const { words } = JSON.parse(msg.content.filter((b) => b.type === 'text').map((b) => b.text).join(''));

  // index → メールに戻す（勉強会シグナルの未認知判定はメールで突合するため）
  const byIndex = new Map(respondents.map((r) => [r.index, r.email]));
  const out = words.map((w) => ({
    word: w.word,
    axis: w.axis,
    quote: w.quote,
    mentionedBy: (w.mentionedBy || []).map((i) => byIndex.get(i)).filter(Boolean),
  }));
  console.error('候補ワード: %d件', out.length);
  console.log(JSON.stringify({ respondents: respondents.length, unaware: [...unawareSet], words: out }, null, 2));
}

module.exports = { parseRespondents };

if (require.main === module) {
  main().catch((e) => { console.error('❌ workshop_extract 失敗:', e.message); process.exit(1); });
}
