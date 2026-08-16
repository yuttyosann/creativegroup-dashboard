'use strict';
/**
 * pamun_ingest.js の I/O 配線テスト（純粋関数は review-ingest.test.js が担当）。
 *
 * スクリプトを子プロセスで本物のまま起動し、lib/sheets だけプリロードで差し替える。
 * 検証対象は「どのタブを・どの条件で読み・何を引数に渡すか」＝例外が出ないまま
 * 静かに間違いうる層。dry-run なので LLM も呼ばず書き込みもしない。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const PRELOAD = path.join(__dirname, 'helpers', 'fake-sheets-preload.js');
const SCRIPT = path.join(ROOT, 'scripts', 'kizuki', 'pamun_ingest.js');

const LEDGER = '気づきワード台帳';
const REVIEW = 'モニターシグナル';
const MAPPING = 'Pamun取込マッピング';
const surveyTab = (reportName) => `${reportName}《事後アンケート》詳細`;

// 台帳: [case, 商品, word_id, ワード, ...]
const ledgerTab = () => [
  ['ケース', '商品', 'word_id', 'ワード'],
  ['case-a', '商品A', 'w001', 'しっとり'],
  ['case-a', '商品A', 'w002', 'ベタつかない'],
  ['case-b', '商品B', 'w003', '香りが良い'],
];

// 事後アンケート: [年代, 満足度, 良かった点, 改善点, 容器希望, お気に入り]
const surveyRows = (n) => {
  const rows = [['年代', '満足度', '良かった点', '改善点', '容器希望', 'お気に入り']];
  for (let i = 0; i < n; i++) {
    rows.push([String(20 + i), '満足', `良かった点${i}`, '', 'ポンプ', '商品A']);
  }
  return rows;
};

const reviewTab = () => [
  ['word_id', 'レビュー件数', '購買意向共感率', '代表クリエイティブURL', '2次利用可否', 'source', 'campaign_id', 'confidence'],
];

function runIngest(tabs, args = []) {
  const res = spawnSync(process.execPath, ['--require', PRELOAD, SCRIPT, '--dry-run', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      SHEET_ID: 'test-sheet-id',
      FAKE_SHEETS_JSON: JSON.stringify(tabs),
    },
  });
  return { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
}

test('配線: マッピング→レポートタブ名→候補ワードが繋がり、回答数とnが出る', () => {
  const r = runIngest({
    [MAPPING]: [
      ['campaign_id', 'report_name', 'case_id', 'n'],
      ['c001', '2026-06_A社', 'case-a', ''],
    ],
    [LEDGER]: ledgerTab(),
    [REVIEW]: reviewTab(),
    [surveyTab('2026-06_A社')]: surveyRows(3),
  });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /DRY-RUN: c001 回答3人 \/ n=3/);
});

test('配線: n をマッピングで指定すると回答数ではなくその値が分母になる', () => {
  const r = runIngest({
    [MAPPING]: [
      ['campaign_id', 'report_name', 'case_id', 'n'],
      ['c001', '2026-06_A社', 'case-a', '50'],
    ],
    [LEDGER]: ledgerTab(),
    [REVIEW]: reviewTab(),
    [surveyTab('2026-06_A社')]: surveyRows(3),
  });
  assert.strictEqual(r.status, 0, r.stderr);
  // 回答3人でも共感率の分母は50（＝普及率。言及しなかった人も分母に残る）
  assert.match(r.stdout, /回答3人 \/ n=50/);
});

test('配線: 台帳に該当 case_id が無ければ警告して skip（落ちない）', () => {
  const r = runIngest({
    [MAPPING]: [
      ['campaign_id', 'report_name', 'case_id', 'n'],
      ['c001', '2026-06_A社', 'case-zzz', ''],
    ],
    [LEDGER]: ledgerTab(),
    [REVIEW]: reviewTab(),
    [surveyTab('2026-06_A社')]: surveyRows(3),
  });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stderr, /候補ワードが台帳にありません case=case-zzz/);
});

test('配線: --campaign で対象を1施策に絞れる', () => {
  const tabs = {
    [MAPPING]: [
      ['campaign_id', 'report_name', 'case_id', 'n'],
      ['c001', '2026-06_A社', 'case-a', ''],
      ['c002', '2026-06_B社', 'case-b', ''],
    ],
    [LEDGER]: ledgerTab(),
    [REVIEW]: reviewTab(),
    [surveyTab('2026-06_A社')]: surveyRows(3),
    [surveyTab('2026-06_B社')]: surveyRows(7),
  };
  const both = runIngest(tabs);
  assert.match(both.stdout, /c001/);
  assert.match(both.stdout, /c002/);

  const one = runIngest(tabs, ['--campaign', 'c002']);
  assert.strictEqual(one.status, 0, one.stderr);
  assert.match(one.stdout, /c002 回答7人/);
  assert.doesNotMatch(one.stdout, /c001/);
});

test('配線: マッピングに無い campaign を指定したら黙って0件成功せず落ちる', () => {
  const r = runIngest({
    [MAPPING]: [
      ['campaign_id', 'report_name', 'case_id', 'n'],
      ['c001', '2026-06_A社', 'case-a', ''],
    ],
    [LEDGER]: ledgerTab(),
    [REVIEW]: reviewTab(),
    [surveyTab('2026-06_A社')]: surveyRows(3),
  }, ['--campaign', 'c999']);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /対象施策がマッピングにありません/);
});

test('回帰: マッピングのヘッダーが1行目でないとヘッダー行が施策として読まれる', () => {
  // CG_気づきワード台帳.gs の体裁（2行目タイトル帯・3行目ヘッダー）を真似た場合。
  // readMapping は rows.slice(1) 前提なのでヘッダー行が施策データになり、
  // 'report_name《事後アンケート》詳細' という実在しないタブを読みに行って落ちる。
  const r = runIngest({
    [MAPPING]: [
      [],
      ['Creative Group — Pamun取込マッピング'],
      ['campaign_id', 'report_name', 'case_id', 'n'],
      ['c001', '2026-06_A社', 'case-a', ''],
    ],
    [LEDGER]: ledgerTab(),
    [REVIEW]: reviewTab(),
    [surveyTab('2026-06_A社')]: surveyRows(3),
  });
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /Unable to parse range: report_name《事後アンケート》詳細/);
});

test('配線: アンケート回答が0件なら生成なしで正常終了する', () => {
  const r = runIngest({
    [MAPPING]: [
      ['campaign_id', 'report_name', 'case_id', 'n'],
      ['c001', '2026-06_A社', 'case-a', '30'],
    ],
    [LEDGER]: ledgerTab(),
    [REVIEW]: reviewTab(),
    [surveyTab('2026-06_A社')]: surveyRows(0),
  });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /事後アンケート回答0件（n=30）→ 生成なし/);
});

test('空白のみの回答行は幽霊回答者として分母 n を水増ししない', () => {
  const rows = surveyRows(2);
  rows.push(['', '  ', '　', '', ' ', '']); // 半角/全角スペース・NBSP のみ
  const r = runIngest({
    [MAPPING]: [
      ['campaign_id', 'report_name', 'case_id', 'n'],
      ['c001', '2026-06_A社', 'case-a', ''],
    ],
    [LEDGER]: ledgerTab(),
    [REVIEW]: reviewTab(),
    [surveyTab('2026-06_A社')]: rows,
  });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /回答2人 \/ n=2/);
});
