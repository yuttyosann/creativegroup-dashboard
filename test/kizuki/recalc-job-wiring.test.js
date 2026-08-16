'use strict';
/**
 * recalc_job.js の I/O 配線テスト。
 *
 * 主題は「広告取込が失敗しても台帳スコアの再計算まで到達すること」。
 * 広告シグナルの取込（BigQuery）と台帳の採点は本来独立で、台帳の採点は BQ を必要としない。
 * 同じジョブに同居しているために、BQ が無い環境では台帳が一度も採点されなかった。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const PRELOAD = path.join(__dirname, 'helpers', 'fake-sheets-preload.js');
const SCRIPT = path.join(ROOT, 'scripts', 'kizuki', 'recalc_job.js');
const SHEET = 'test-sheet-id';

const ledgerTab = () => [
  ['案件ID', '商品ID', 'word_id', 'ワード本文', '訴求軸タグ', '起点', 'status',
    '確度ステージ', '訴求スコア', '判定', 'メモ', '最終更新'],
  ['case-a', 'P1', 'w001', 'しっとり', '効能', 'レビュー', '候補', '', '', '', '', ''],
];
const reviewTab = () => [
  ['word_id', 'レビュー件数', '購買意向共感率', '代表クリエイティブURL', '2次利用可否',
    'source', 'campaign_id', 'confidence'],
  ['w001', 10, '40%', '', '', 'trackA', 'c001', ''],
];
const headerOnly = (...cols) => [cols];

function sheets({ withAdMapping = true } = {}) {
  const tabs = {
    '気づきワード台帳': ledgerTab(),
    '勉強会シグナル': headerOnly('word_id', '参加者ID(匿名)', '発言抜粋', '言及数', 'アンケ評価', 'ブランド未認知'),
    'モニターシグナル': reviewTab(),
    '広告シグナル': headerOnly('word_id', 'creative_id', 'CTR%', 'CVR%', 'ROAS', '勝ちデモグラ', 'デモグラ明確度', '配信額'),
    'コラボ実績': headerOnly('word_id', 'influencer_id', '適合スコア', '実売数', 'ROAS'),
  };
  if (withAdMapping) tabs['広告マッピング'] = headerOnly('creative_id', 'word_id');
  return { [SHEET]: tabs };
}

function run({ tabs, bqError, bqRows = [], args = [], writesPath }) {
  const res = spawnSync(process.execPath, ['--require', PRELOAD, SCRIPT, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      SHEET_ID: SHEET,
      FAKE_SHEETS_JSON: JSON.stringify(tabs),
      ...(bqError ? { FAKE_BQ_ERROR: bqError } : { FAKE_BQ_JSON: JSON.stringify(bqRows) }),
      ...(writesPath ? { FAKE_SHEETS_WRITES_PATH: writesPath } : {}),
    },
  });
  return { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
}

function withWrites(fn) {
  const p = path.join(os.tmpdir(), `recalc-writes-${process.pid}-${Math.random().toString(36).slice(2)}.json`);
  try {
    const r = fn(p);
    const writes = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : [];
    return { ...r, writes };
  } finally {
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}

test('BigQuery が落ちても台帳スコアの再計算は実行される', () => {
  const { status, stderr, writes } = withWrites((p) => run({
    tabs: sheets(),
    bqError: 'Not found: Table cg-project-491303:cg_analytics.ad_creative_daily was not found',
    writesPath: p,
  }));
  assert.match(stderr, /広告シグナルの取込/);
  assert.match(stderr, /ad_creative_daily/);
  assert.ok(writes.some((w) => w.op === 'updateById' && w.tab === '気づきワード台帳'),
    '台帳への書き戻しが行われていない');
  assert.strictEqual(status, 1, '広告取込の失敗は終了コードで伝える');
});

test('広告マッピングタブが無くても台帳スコアの再計算は実行される', () => {
  const { status, stderr, writes } = withWrites((p) => run({
    tabs: sheets({ withAdMapping: false }),
    writesPath: p,
  }));
  assert.match(stderr, /広告シグナルの取込/);
  assert.ok(writes.some((w) => w.op === 'updateById' && w.tab === '気づきワード台帳'));
  assert.strictEqual(status, 1);
});

test('広告取込が成功すれば終了コード0で両方走る', () => {
  const { status, stdout, writes } = withWrites((p) => run({ tabs: sheets(), writesPath: p }));
  assert.strictEqual(status, 0);
  assert.match(stdout, /台帳スコア再計算 1件/);
  assert.ok(writes.some((w) => w.op === 'updateById' && w.tab === '気づきワード台帳'));
});

test('dry-run は台帳を書き換えない', () => {
  const { status, stdout, writes } = withWrites((p) => run({
    tabs: sheets(), args: ['--dry-run'], writesPath: p,
  }));
  assert.strictEqual(status, 0);
  assert.match(stdout, /DRY-RUN/);
  assert.strictEqual(writes.length, 0, 'dry-run で書き込みが発生している');
});
