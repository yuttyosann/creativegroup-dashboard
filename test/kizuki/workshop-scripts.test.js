'use strict';
/**
 * 勉強会取込の2スクリプト（抽出・登録）の I/O 配線テスト。
 * 子プロセスで本物のまま起動し、lib/sheets と Anthropic SDK をプリロードで差し替える。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const PRELOAD = path.join(__dirname, 'helpers', 'fake-sheets-preload.js');
const EXTRACT = path.join(ROOT, 'scripts', 'kizuki', 'workshop_extract.js');
const SEED = path.join(ROOT, 'scripts', 'kizuki', 'workshop_seed.js');

const SHEET = 'test-sheet-id';
const POST = 'post-sheet-id';
const PRE = 'pre-sheet-id';
const TAB = 'フォームの回答 1';
const LEDGER = '気づきワード台帳';
const WORKSHOP = '勉強会シグナル';

const postRows = () => [
  ['タイムスタンプ', 'メールアドレス', '氏名（漢字表記）', 'ご年齢',
    '【最も印象が変わった点】 …', '【説明後に初めて理解できたこと】 …',
    '【印象に残った言葉】 …', '【使いたい部位・場面】 …',
    '【購入意向】 …', '【推奨意向】 …'],
  ['t', 'a@example.com', '山田', 30, '低刺激だと知った', '成分の役割', '肌が生き返る', '夜のケアに', 'はい', 'はい'],
  ['t', 'b@example.com', '佐藤', 41, '', '', 'お守りみたい', '', 'はい', 'はい'],
  ['', '', '名簿だけの人'], // 自由記述が全て空 → 回答者に数えない
];

const preRows = () => [
  ['タイムスタンプ', 'メールアドレス', '氏名（漢字表記）', 'ご年齢',
    'アベンヌブランドの認知について ご存知だったか教えてください。'],
  ['t', 'a@example.com', '山田', 30, 'まったく知らなかった'],
  ['t', 'b@example.com', '佐藤', 41, 'よく知っていた'],
];

const LLM = JSON.stringify({
  words: [
    { word: '肌が生き返る感じがする', axis: '効能', quote: '肌が生き返る', mentionedBy: [0, 1] },
    { word: 'お守りとして持ち歩ける', axis: '情緒', quote: 'お守りみたい', mentionedBy: [1] },
  ],
});

function run(script, { sheets, args = [], llm, writesPath }) {
  const res = spawnSync(process.execPath, ['--require', PRELOAD, script, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      SHEET_ID: SHEET,
      FAKE_SHEETS_JSON: JSON.stringify(sheets),
      ...(llm ? { FAKE_LLM_JSON: llm } : {}),
      ...(writesPath ? { FAKE_SHEETS_WRITES_PATH: writesPath } : {}),
    },
  });
  return { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
}

const extractSheets = () => ({
  [SHEET]: {},
  [POST]: { [TAB]: postRows() },
  [PRE]: { [TAB]: preRows() },
});

// --- 抽出 -----------------------------------------------------------------

test('抽出: 自由記述が全て空の行は回答者に数えない', () => {
  const r = run(EXTRACT, { sheets: extractSheets(), args: ['--post', POST, '--pre', PRE], llm: LLM });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stderr, /回答者: 2人/);
});

test('抽出: 認知度の実際の回答値をログに出す（選択肢文言はフォーム依存のため）', () => {
  const r = run(EXTRACT, { sheets: extractSheets(), args: ['--post', POST, '--pre', PRE], llm: LLM });
  assert.match(r.stderr, /まったく知らなかった.*=未認知/);
  assert.match(r.stderr, /未認知と判定した参加者: 1人/);
});

test('抽出: index をメールに戻して出力する（未認知判定はメールで突合するため）', () => {
  const r = run(EXTRACT, { sheets: extractSheets(), args: ['--post', POST, '--pre', PRE], llm: LLM });
  const out = JSON.parse(r.stdout);
  assert.deepStrictEqual(out.words[0].mentionedBy, ['a@example.com', 'b@example.com']);
  assert.deepStrictEqual(out.unaware, ['a@example.com']);
});

test('抽出: --pre 未指定なら警告し、未認知は空になる', () => {
  const r = run(EXTRACT, { sheets: extractSheets(), args: ['--post', POST], llm: LLM });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stderr, /--pre 未指定/);
  assert.deepStrictEqual(JSON.parse(r.stdout).unaware, []);
});

test('抽出: シートに書き込まない', () => {
  const p = path.join(os.tmpdir(), `ws-extract-${process.pid}.json`);
  try {
    run(EXTRACT, { sheets: extractSheets(), args: ['--post', POST, '--pre', PRE], llm: LLM, writesPath: p });
    assert.ok(!fs.existsSync(p), '書き込みが発生している');
  } finally { if (fs.existsSync(p)) fs.unlinkSync(p); }
});

// --- 登録 -----------------------------------------------------------------

const candidates = {
  respondents: 2,
  unaware: ['a@example.com'],
  words: [
    { word: '肌が生き返る感じがする', axis: '効能', quote: '肌が生き返る', mentionedBy: ['a@example.com', 'b@example.com'] },
    { word: 'お守りとして持ち歩ける', axis: '情緒', quote: 'お守りみたい', mentionedBy: ['b@example.com'] },
  ],
};

const seedSheets = (existingLedger = []) => ({
  [SHEET]: {
    [LEDGER]: [['案件ID', '商品ID', 'word_id', 'ワード本文', '訴求軸タグ', '起点', 'status',
      '確度ステージ', '訴求スコア', '判定', 'メモ', '最終更新'], ...existingLedger],
    [WORKSHOP]: [['word_id', '参加者ID(匿名)', '発言抜粋', '言及数', 'アンケ評価', 'ブランド未認知']],
  },
});

function withJson(payload, fn) {
  const p = path.join(os.tmpdir(), `ws-cand-${process.pid}-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(p, JSON.stringify(payload));
  try { return fn(p); } finally { if (fs.existsSync(p)) fs.unlinkSync(p); }
}

test('登録: 既存 word_id と衝突しない採番をする（別案件のシグナル混入を防ぐ）', () => {
  const existing = [['other-case', 'P0', 'w015', '既存ワード', '効能', 'レビュー', '候補', '', '', '', '', '']];
  const r = withJson(candidates, (p) =>
    run(SEED, { sheets: seedSheets(existing), args: [p, '--case', 'case-ws', '--product', 'CICA'] }));
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /採番: w016 〜 w017/);
});

test('登録: ブランド未認知は言及者の過半で決まる', () => {
  const r = withJson(candidates, (p) =>
    run(SEED, { sheets: seedSheets(), args: [p, '--case', 'case-ws'] }));
  // w001: a(未認知)+b → 2人中1人＝同数なので FALSE ／ w002: b のみ → FALSE
  assert.match(r.stdout, /w001\s+2\s+FALSE/);
  assert.match(r.stdout, /w002\s+1\s+FALSE/);
});

test('登録: --apply なしでは書き込まない', () => {
  const p2 = path.join(os.tmpdir(), `ws-seed-writes-${process.pid}.json`);
  try {
    withJson(candidates, (p) =>
      run(SEED, { sheets: seedSheets(), args: [p, '--case', 'case-ws'], writesPath: p2 }));
    assert.ok(!fs.existsSync(p2), '書き込みが発生している');
  } finally { if (fs.existsSync(p2)) fs.unlinkSync(p2); }
});

test('登録: --apply で台帳と勉強会シグナルの両方に書く', () => {
  const p2 = path.join(os.tmpdir(), `ws-seed-apply-${process.pid}.json`);
  try {
    const r = withJson(candidates, (p) =>
      run(SEED, { sheets: seedSheets(), args: [p, '--case', 'case-ws', '--apply'], writesPath: p2 }));
    assert.strictEqual(r.status, 0, r.stderr);
    const writes = JSON.parse(fs.readFileSync(p2, 'utf8'));
    assert.strictEqual(writes.filter((w) => w.tab === LEDGER).length, 2);
    assert.strictEqual(writes.filter((w) => w.tab === WORKSHOP).length, 2);
    const first = writes.find((w) => w.tab === LEDGER);
    assert.strictEqual(first.row[5], '勉強会'); // 起点
    assert.strictEqual(first.row[6], '候補');   // status
  } finally { if (fs.existsSync(p2)) fs.unlinkSync(p2); }
});

test('登録: 同じ case に既にデータがあれば中断する', () => {
  const existing = [['case-ws', 'P0', 'w001', '既存', '効能', '勉強会', '候補', '', '', '', '', '']];
  const r = withJson(candidates, (p) =>
    run(SEED, { sheets: seedSheets(existing), args: [p, '--case', 'case-ws', '--apply'] }));
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /既に 1 行あります/);
});
