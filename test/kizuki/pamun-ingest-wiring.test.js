'use strict';
/**
 * pamun_ingest.js の I/O 配線テスト（純粋関数は review-ingest.test.js が担当）。
 *
 * スクリプトを子プロセスで本物のまま起動し、lib/sheets だけプリロードで差し替える。
 * 検証対象は「どのシートの・どのタブを・どの条件で読み・何を引数に渡すか」＝
 * 例外が出ないまま静かに間違いうる層。dry-run なので LLM も呼ばず書き込みもしない。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const PRELOAD = path.join(__dirname, 'helpers', 'fake-sheets-preload.js');
const SCRIPT = path.join(ROOT, 'scripts', 'kizuki', 'pamun_ingest.js');

const SHEET = 'test-sheet-id';        // コックピット（台帳・シグナル・マッピング）
const REPORT = 'report-sheet-id';     // 施策レポート／フォーム生回答（別スプレッドシート）

const LEDGER = '気づきワード台帳';
const REVIEW = 'モニターシグナル';
const MAPPING = 'Pamun取込マッピング';
const MAPPING_HEADER = ['campaign_id', 'report_sheet_id', 'survey_tab', 'case_id', 'n'];

// 台帳: [case, 商品, word_id, ワード, ...]
const ledgerTab = () => [
  ['ケース', '商品', 'word_id', 'ワード'],
  ['case-a', '商品A', 'w001', 'しっとり'],
  ['case-a', '商品A', 'w002', 'ベタつかない'],
  ['case-b', '商品B', 'w003', '香りが良い'],
];

// フォーム生回答: [タイムスタンプ, メール, 氏名, ご年齢, 感想, 満足度]
const surveyRows = (n) => {
  const rows = [['タイムスタンプ', 'メールアドレス', '氏名（漢字表記）', 'ご年齢',
    '商品の感想を教えてください', '商品の満足度を教えてください']];
  for (let i = 0; i < n; i++) {
    rows.push([`2026/06/20 10:0${i}:00`, `u${i}@example.com`, `回答者${i}`, String(20 + i),
      `良かった点${i}`, '①とても満足']);
  }
  return rows;
};

const reviewTab = () => [
  ['word_id', 'レビュー件数', '購買意向共感率', '代表クリエイティブURL', '2次利用可否',
    'source', 'campaign_id', 'confidence'],
];

function runIngest(sheets, args = []) {
  const res = spawnSync(process.execPath, ['--require', PRELOAD, SCRIPT, '--dry-run', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, SHEET_ID: SHEET, FAKE_SHEETS_JSON: JSON.stringify(sheets) },
  });
  return { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
}

/** 既定の構成。report_sheet_id を指定して別スプレッドシートのタブを読む。 */
function baseSheets(mappingRows, respondents = 3) {
  return {
    [SHEET]: {
      [MAPPING]: [MAPPING_HEADER, ...mappingRows],
      [LEDGER]: ledgerTab(),
      [REVIEW]: reviewTab(),
    },
    [REPORT]: { 'フォームの回答 1': surveyRows(respondents) },
  };
}

test('配線: report_sheet_id で別スプレッドシートのアンケートを読む', () => {
  const r = runIngest(baseSheets([['c001', REPORT, 'フォームの回答 1', 'case-a', '']]));
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /DRY-RUN: c001 回答3人 \/ n=3/);
});

test('配線: report_sheet_id が空なら同じスプレッドシート内のタブを読む', () => {
  const r = runIngest({
    [SHEET]: {
      [MAPPING]: [MAPPING_HEADER, ['c001', '', '2026-06-AVENE《事後アンケート》詳細', 'case-a', '']],
      [LEDGER]: ledgerTab(),
      [REVIEW]: reviewTab(),
      '2026-06-AVENE《事後アンケート》詳細': surveyRows(5),
    },
  });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /回答5人 \/ n=5/);
});

test('配線: 存在しないシートIDを指定したら黙って0件成功せず落ちる', () => {
  const r = runIngest(baseSheets([['c001', 'no-such-sheet', 'フォームの回答 1', 'case-a', '']]));
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /Requested entity was not found: no-such-sheet/);
});

test('配線: n をマッピングで指定すると回答数ではなくその値が分母になる', () => {
  const r = runIngest(baseSheets([['c001', REPORT, 'フォームの回答 1', 'case-a', '50']]));
  assert.strictEqual(r.status, 0, r.stderr);
  // 回答3人でも共感率の分母は50（＝普及率。言及しなかった人も分母に残る）
  assert.match(r.stdout, /回答3人 \/ n=50/);
});

test('配線: 台帳に該当 case_id が無ければ警告して skip（落ちない）', () => {
  const r = runIngest(baseSheets([['c001', REPORT, 'フォームの回答 1', 'case-zzz', '']]));
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stderr, /候補ワードが台帳にありません case=case-zzz/);
});

test('配線: --campaign で対象を1施策に絞れる', () => {
  const sheets = baseSheets([
    ['c001', REPORT, 'フォームの回答 1', 'case-a', ''],
    ['c002', REPORT, '別タブ', 'case-b', ''],
  ]);
  sheets[REPORT]['別タブ'] = surveyRows(7);

  const both = runIngest(sheets);
  assert.match(both.stdout, /c001/);
  assert.match(both.stdout, /c002/);

  const one = runIngest(sheets, ['--campaign', 'c002']);
  assert.strictEqual(one.status, 0, one.stderr);
  assert.match(one.stdout, /c002 回答7人/);
  assert.doesNotMatch(one.stdout, /c001/);
});

test('配線: マッピングに無い campaign を指定したら黙って0件成功せず落ちる', () => {
  const r = runIngest(baseSheets([['c001', REPORT, 'フォームの回答 1', 'case-a', '']]),
    ['--campaign', 'c999']);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /対象施策がマッピングにありません/);
});

test('回帰: マッピングのヘッダーが1行目でないとヘッダー行が施策として読まれる', () => {
  // CG_気づきワード台帳.gs の体裁（2行目タイトル帯・3行目ヘッダー）を真似た場合。
  // readMapping は rows.slice(1) 前提なのでヘッダー行が施策データになり、
  // survey_tab に 'survey_tab' という実在しないタブ名を読みに行って落ちる。
  const r = runIngest({
    [SHEET]: {
      [MAPPING]: [[], ['Creative Group — Pamun取込マッピング'], MAPPING_HEADER,
        ['c001', REPORT, 'フォームの回答 1', 'case-a', '']],
      [LEDGER]: ledgerTab(),
      [REVIEW]: reviewTab(),
    },
    [REPORT]: { 'フォームの回答 1': surveyRows(3) },
  });
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /Requested entity was not found: report_sheet_id/);
});

test('配線: アンケート回答が0件なら生成なしで正常終了する', () => {
  const r = runIngest(baseSheets([['c001', REPORT, 'フォームの回答 1', 'case-a', '30']], 0));
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /事後アンケート回答0件（n=30）→ 生成なし/);
});

test('氏名だけの名簿行は回答者に数えない（分母nを水増ししない）', () => {
  const sheets = baseSheets([['c001', REPORT, 'フォームの回答 1', 'case-a', '']], 2);
  sheets[REPORT]['フォームの回答 1'].push(['', '', '名簿だけの人']);
  const r = runIngest(sheets);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /回答2人 \/ n=2/);
});
