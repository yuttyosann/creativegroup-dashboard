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

const AWARENESS_SCHEMA = {
  type: 'object',
  properties: {
    people: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          index: { type: 'integer' },
          brandUnaware: { type: 'boolean' },
          productUnaware: { type: 'boolean' },
        },
        required: ['index', 'brandUnaware', 'productUnaware'],
        additionalProperties: false,
      },
    },
  },
  required: ['people'],
  additionalProperties: false,
};

const AWARENESS_SYSTEM = [
  '応募者が書いた「ブランドと商品の認知について」の自由記述を分類します。',
  '',
  '判定は2つ。どちらも「応募前の時点で」を基準にする:',
  '- brandUnaware: そのブランド自体を知らなかったなら true。',
  '  ブランド名を知っていた・商品を使ったことがあるなら false。',
  '- productUnaware: 今回の商材ライン（シカ／CICA）を知らなかったなら true。',
  '  そのラインの商品を知っていた・使っていたなら false。',
  '',
  '注意:',
  '- 「ブランドは知っていたがシカ商品は知らなかった」は brandUnaware=false / productUnaware=true。',
  '- 「今回の応募で初めて知った」はブランド自体を指すなら brandUnaware=true。',
  '- どちらとも判断できない記述（イメージだけを述べている等）は、知っていた前提とみなし両方 false。',
  '- 入力の index を必ずそのまま返すこと。',
].join('\n');

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
    if (!workshop.isFormResponse(r)) continue; // 人が下に作った集計行を除く
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

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // 認知度は選択式ではなく自由記述（「アベンヌは知っていたがシカは知らなかった」等）なので、
  // 部分一致では両方向に誤判定する。LLMで brand / product を別々に判定する。
  let sets = { brand: new Set(), product: new Set(), either: new Set() };
  if (PRE_ID) {
    const preRows = await readRows(PRE_ID, PRE_TAB);
    const awareness = workshop.parseAwarenessRows(preRows);
    if (!awareness.length) {
      console.error('⚠ 事前アンケートの認知度回答が0件 → 未認知は全てFALSEになります');
    } else {
      const cls = await callLLM(client, AWARENESS_SYSTEM, AWARENESS_SCHEMA,
        awareness.map((a, i) => ({ index: i, text: a.text })));
      sets = workshop.buildUnawareSets((cls.people || []).map((x) => ({
        email: (awareness[x.index] || {}).email,
        brandUnaware: x.brandUnaware,
        productUnaware: x.productUnaware,
      })));
      console.error('事前アンケートの認知度回答: %d件', awareness.length);
      console.error('  ブランド未認知: %d人 / 商品(CICA)未認知: %d人 / どちらか: %d人',
        sets.brand.size, sets.product.size, sets.either.size);
    }
  } else {
    console.error('⚠ --pre 未指定 → 未認知は全てFALSEになります');
  }
  const { words } = await callLLM(client, SYSTEM, SCHEMA,
    respondents.map((r) => ({ index: r.index, ...r.texts })));

  // index → メールに戻す（勉強会シグナルの未認知判定はメールで突合するため）
  const byIndex = new Map(respondents.map((r) => [r.index, r.email]));
  const out = words.map((w) => ({
    word: w.word,
    axis: w.axis,
    quote: w.quote,
    mentionedBy: (w.mentionedBy || []).map((i) => byIndex.get(i)).filter(Boolean),
  }));
  console.error('候補ワード: %d件', out.length);
  console.log(JSON.stringify({
    respondents: respondents.length,
    unaware: [...sets.either],          // シグナルで使う（どちらか一方でも未認知）
    unawareBrand: [...sets.brand],
    unawareProduct: [...sets.product],
    words: out,
  }, null, 2));
}

/** 構造化出力でLLMを呼ぶ。 */
async function callLLM(client, system, schema, payload) {
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'high', format: { type: 'json_schema', schema } },
    system,
    messages: [{ role: 'user', content: JSON.stringify(payload) }],
  });
  if (msg.stop_reason === 'refusal') throw new Error('LLMがrefusalで停止しました');
  return JSON.parse(msg.content.filter((b) => b.type === 'text').map((b) => b.text).join(''));
}

module.exports = { parseRespondents };

if (require.main === module) {
  main().catch((e) => { console.error('❌ workshop_extract 失敗:', e.message); process.exit(1); });
}
