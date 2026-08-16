'use strict';
/**
 * scripts/kizuki/*.js を「本物のまま」起動しつつ lib/sheets だけ差し替えるプリロード。
 *
 * node --require <このファイル> scripts/kizuki/pamun_ingest.js --dry-run
 *
 * スクリプト側を testable に書き換えずに配線（読みに行くシート/タブ・行の絞り込み・
 * 引数の受け渡し）を検証するのが目的。中身は環境変数 FAKE_SHEETS_JSON に
 * {"スプレッドシートID": {"タブ名": [[行],[行]]}, ...} で渡す。
 * 存在しないシートID/タブを読むと Sheets API と同じく例外になる
 * （別スプレッドシートを読む配線のミスをここで落とすため）。
 *
 * 書き込みは実行せず FAKE_SHEETS_WRITES_PATH に JSON で追記記録する（任意）。
 */
const path = require('path');
const fs = require('fs');

const sheets = JSON.parse(process.env.FAKE_SHEETS_JSON || '{}');
const writesPath = process.env.FAKE_SHEETS_WRITES_PATH || '';
const writes = [];

function flushWrites() {
  if (writesPath) fs.writeFileSync(writesPath, JSON.stringify(writes, null, 2));
}

function requireTab(spreadsheetId, tabName) {
  // 実際の Sheets API も、存在しないシートIDは404・存在しないタブ名は400で落ちる。挙動を合わせる。
  if (!Object.prototype.hasOwnProperty.call(sheets, spreadsheetId)) {
    const e = new Error(`Requested entity was not found: ${spreadsheetId}`);
    e.code = 404;
    throw e;
  }
  const tabs = sheets[spreadsheetId];
  if (!Object.prototype.hasOwnProperty.call(tabs, tabName)) {
    const e = new Error(`Unable to parse range: ${tabName}!A:Z`);
    e.code = 400;
    throw e;
  }
  return tabs[tabName];
}

const fake = {
  async readRows(spreadsheetId, tabName) {
    return requireTab(spreadsheetId, tabName).map((r) => r.slice());
  },
  async appendRow(spreadsheetId, tabName, rowArray) {
    requireTab(spreadsheetId, tabName).push(rowArray.slice());
    writes.push({ op: 'append', tab: tabName, row: rowArray });
    flushWrites();
  },
  async updateRowAt(spreadsheetId, tabName, rowNumber, rowArray) {
    requireTab(spreadsheetId, tabName)[rowNumber - 1] = rowArray.slice();
    writes.push({ op: 'update', tab: tabName, rowNumber, row: rowArray });
    flushWrites();
  },
  async updateRowById(spreadsheetId, tabName, idColIndex, id, rowArray) {
    const rows = requireTab(spreadsheetId, tabName);
    const i = rows.findIndex((r, idx) => idx > 0 && r[idColIndex] === id);
    if (i === -1) throw new Error('対象が見つかりません: ' + id);
    rows[i] = rowArray.slice();
    writes.push({ op: 'updateById', tab: tabName, id, row: rowArray });
    flushWrites();
  },
  async readAllowlist() { return []; },
  // 純粋関数は本物をそのまま使う（配線の検証対象なので差し替えない）
  findRowNumber: null,
  findRowNumberByKey: null,
};

// BigQuery も差し替える（FAKE_BQ_JSON=返す行 / FAKE_BQ_ERROR=投げるメッセージ）。
// 未設定なら本物のまま。recalc_job は @google-cloud/bigquery を遅延requireするので、
// ここで require.cache に入れておけば実行時にこちらが使われる。
if (process.env.FAKE_BQ_JSON || process.env.FAKE_BQ_ERROR) {
  const bqRows = JSON.parse(process.env.FAKE_BQ_JSON || '[]');
  const bqError = process.env.FAKE_BQ_ERROR || '';
  class FakeBigQuery {
    async query() {
      if (bqError) throw new Error(bqError);
      return [bqRows];
    }
  }
  const bqPath = require.resolve('@google-cloud/bigquery', {
    paths: [path.join(__dirname, '..', '..', '..')],
  });
  require.cache[bqPath] = {
    id: bqPath, filename: bqPath, loaded: true, children: [], paths: [],
    exports: { BigQuery: FakeBigQuery },
  };
}

// Anthropic SDK も差し替える（FAKE_LLM_JSON=messages.create が返す JSON 文字列）。
if (process.env.FAKE_LLM_JSON) {
  const payload = process.env.FAKE_LLM_JSON;
  class FakeAnthropic {
    constructor() {
      this.messages = {
        create: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: payload }] }),
      };
    }
  }
  const sdkPath = require.resolve('@anthropic-ai/sdk', {
    paths: [path.join(__dirname, '..', '..', '..')],
  });
  require.cache[sdkPath] = {
    id: sdkPath, filename: sdkPath, loaded: true, children: [], paths: [],
    exports: FakeAnthropic,
  };
}

const sheetsPath = require.resolve(path.join(__dirname, '..', '..', '..', 'lib', 'sheets.js'));
const real = require(sheetsPath);
fake.findRowNumber = real.findRowNumber;
fake.findRowNumberByKey = real.findRowNumberByKey;

require.cache[sheetsPath] = {
  id: sheetsPath,
  filename: sheetsPath,
  loaded: true,
  children: [],
  paths: [],
  exports: fake,
};
