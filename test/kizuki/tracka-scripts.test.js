'use strict';
/**
 * Track A の2スクリプト（設問生成・取込）の I/O 配線テスト。
 * 子プロセスで本物のまま起動し lib/sheets だけプリロードで差し替える。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const PRELOAD = path.join(__dirname, 'helpers', 'fake-sheets-preload.js');
const QUESTIONS = path.join(ROOT, 'scripts', 'kizuki', 'tracka_questions.js');
const INGEST = path.join(ROOT, 'scripts', 'kizuki', 'tracka_ingest.js');

const SHEET = 'test-sheet-id';
const REPORT = 'report-sheet-id';
const LEDGER = '気づきワード台帳';
const REVIEW = 'モニターシグナル';
const MAPPING = 'Pamun取込マッピング';
const SURVEY = 'フォームの回答 1';

// 台帳: [案件ID, 商品ID, word_id, ワード本文, 訴求軸タグ, 起点, status, ...]
const ledgerTab = (statuses = {}) => [
  ['案件ID', '商品ID', 'word_id', 'ワード本文', '訴求軸タグ', '起点', 'status'],
  ['case-a', 'P1', 'w001', '伸びが良くてスッと塗りやすい', '効能', 'レビュー', statuses.w001 || 'モニター'],
  ['case-a', 'P1', 'w002', '白浮きしないから顔にも使える', '効能', 'レビュー', statuses.w002 || 'モニター'],
  ['case-a', 'P1', 'w003', 'ベタつかないから塗った後も快適', '効能', 'レビュー', statuses.w003 || '候補'],
  ['case-b', 'P2', 'w900', '別ケースのワード', '情緒', 'レビュー', 'モニター'],
];

const reviewTab = () => [['word_id', 'レビュー件数', '購買意向共感率', '代表クリエイティブURL',
  '2次利用可否', 'source', 'campaign_id', 'confidence']];

const q = (word, wordId) => `「${word}」について、あなたに一番近いものは？ [${wordId}]`;

const surveyTab = (rows) => [
  ['タイムスタンプ', 'メールアドレス',
    q('伸びが良くてスッと塗りやすい', 'w001'), q('白浮きしないから顔にも使える', 'w002')],
  ...rows,
];

function run(script, sheets, args = [], writesPath) {
  const res = spawnSync(process.execPath, ['--require', PRELOAD, script, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      SHEET_ID: SHEET,
      FAKE_SHEETS_JSON: JSON.stringify(sheets),
      ...(writesPath ? { FAKE_SHEETS_WRITES_PATH: writesPath } : {}),
    },
  });
  return { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
}

const baseSheets = (surveyRows) => ({
  [SHEET]: {
    [LEDGER]: ledgerTab(),
    [REVIEW]: reviewTab(),
    [MAPPING]: [
      ['campaign_id', 'report_sheet_id', 'survey_tab', 'case_id', 'n'],
      ['c001', REPORT, SURVEY, 'case-a', ''],
    ],
  },
  [REPORT]: { [SURVEY]: surveyTab(surveyRows) },
});

// --- 設問生成 -------------------------------------------------------------

test('設問生成: status=モニター の行だけを設問にし、末尾に word_id を付ける', () => {
  const r = run(QUESTIONS, { [SHEET]: { [LEDGER]: ledgerTab() } }, ['--case', 'case-a']);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /\[w001\]/);
  assert.match(r.stdout, /\[w002\]/);
  assert.doesNotMatch(r.stdout, /\[w003\]/); // status=候補 は対象外
  assert.doesNotMatch(r.stdout, /\[w900\]/); // 別ケース
});

test('設問生成: 選択肢3つを出力する', () => {
  const r = run(QUESTIONS, { [SHEET]: { [LEDGER]: ledgerTab() } }, ['--case', 'case-a']);
  assert.match(r.stdout, /① ピンとこない/);
  assert.match(r.stdout, /② 共感する/);
  assert.match(r.stdout, /③ 共感するし/);
});

test('設問生成: 5件未満なら警告（回答負担ではなく検証力の問題）', () => {
  const r = run(QUESTIONS, { [SHEET]: { [LEDGER]: ledgerTab() } }, ['--case', 'case-a']);
  assert.match(r.stderr, /5〜8件/);
});

test('設問生成: 対象が0件なら落ちる（黙って空の設問を出さない）', () => {
  const r = run(QUESTIONS, { [SHEET]: { [LEDGER]: ledgerTab() } }, ['--case', 'case-zzz']);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /status=モニター のワードがありません/);
});

// --- 取込 -----------------------------------------------------------------

test('取込: 3択から件数と意向を集計する（LLM不要なので dry-run でも行が出る）', () => {
  const r = run(INGEST, baseSheets([
    ['t', 'a@x', '③ 共感するし、これがあるから買いたい', '① ピンとこない'],
    ['t', 'b@x', '③ 共感するし、これがあるから買いたい', '② 共感する'],
    ['t', 'c@x', '② 共感する', '② 共感する'],
  ]), ['--dry-run']);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /回答3人 \/ n=3 \/ モニターシグナル生成 2行/);
});

test('取込: 台帳にあるのに設問列が無いワードは警告する（文言修正でのズレ検知）', () => {
  const sheets = baseSheets([['t', 'a@x', '③ 買いたい', '② 共感する']]);
  sheets[SHEET][LEDGER] = ledgerTab({ w003: 'モニター' }); // w003 はモニターだが設問列が無い
  const r = run(INGEST, sheets, ['--dry-run']);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stderr, /設問列が見つからないワード.*w003/);
});

test('取込: 台帳に無い word_id の設問列は候補外としてスキップする', () => {
  const sheets = baseSheets([['t', 'a@x', '③ 買いたい', '② 共感する', '③ 買いたい']]);
  sheets[REPORT][SURVEY][0].push(q('台帳に無いワード', 'w777'));
  const r = run(INGEST, sheets, ['--dry-run']);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /モニターシグナル生成 2行/); // w777 は載らない
});

test('取込: 設問に1つも答えていない行は分母nに数えない', () => {
  const r = run(INGEST, baseSheets([
    ['t', 'a@x', '③ 買いたい', '② 共感する'],
    ['t', 'b@x', '② 共感する', '③ 買いたい'],
    ['', '', '', ''],
    ['', '', '名簿だけ'],
  ]), ['--dry-run']);
  assert.match(r.stdout, /回答2人 \/ n=2/);
});

test('取込: 本実行で source=trackA としてモニターシグナルに書き込む', () => {
  const writes = path.join(os.tmpdir(), `tracka-writes-${process.pid}.json`);
  try {
    const r = run(INGEST, baseSheets([
      ['t', 'a@x', '③ 共感するし、これがあるから買いたい', '① ピンとこない'],
      ['t', 'b@x', '② 共感する', '② 共感する'],
    ]), [], writes);
    assert.strictEqual(r.status, 0, r.stderr);
    const rows = JSON.parse(fs.readFileSync(writes, 'utf8'));
    assert.strictEqual(rows.length, 2);
    rows.forEach((w) => {
      assert.strictEqual(w.op, 'append');
      assert.strictEqual(w.tab, 'モニターシグナル');
      assert.strictEqual(w.row[5], 'trackA');   // source
      assert.strictEqual(w.row[6], 'c001');     // campaign_id
      assert.strictEqual(w.row[7], '');         // confidence は trackA では空
    });
    // w001: ②③が2人 → 件数2・意向1 → 共感率 1/2 = 50%
    const w001 = rows.find((w) => w.row[0] === 'w001');
    assert.strictEqual(w001.row[1], 2);
    assert.strictEqual(w001.row[2], '50%');
  } finally {
    if (fs.existsSync(writes)) fs.unlinkSync(writes);
  }
});
