'use strict';
/**
 * scripts/kizuki/*.js を「本物のまま」起動しつつ lib/sheets だけ差し替えるプリロード。
 *
 * node --require <このファイル> scripts/kizuki/pamun_ingest.js --dry-run
 *
 * スクリプト側を testable に書き換えずに配線（タブ名の組み立て・行の絞り込み・
 * 引数の受け渡し）を検証するのが目的。タブの中身は環境変数 FAKE_SHEETS_JSON に
 * {"タブ名": [[行],[行]], ...} で渡す。存在しないタブを読むと Sheets API と同じく
 * 例外になる（タブ名の組み立てミスをここで落とすため）。
 *
 * 書き込みは実行せず FAKE_SHEETS_WRITES_PATH に JSON で追記記録する（任意）。
 */
const path = require('path');
const fs = require('fs');

const tabs = JSON.parse(process.env.FAKE_SHEETS_JSON || '{}');
const writesPath = process.env.FAKE_SHEETS_WRITES_PATH || '';
const writes = [];

function flushWrites() {
  if (writesPath) fs.writeFileSync(writesPath, JSON.stringify(writes, null, 2));
}

function requireTab(tabName) {
  if (!Object.prototype.hasOwnProperty.call(tabs, tabName)) {
    // 実際の Sheets API も存在しないタブ名は 400 で落ちる。挙動を合わせる。
    const e = new Error(`Unable to parse range: ${tabName}!A:Z`);
    e.code = 400;
    throw e;
  }
  return tabs[tabName];
}

const fake = {
  async readRows(_spreadsheetId, tabName) {
    return requireTab(tabName).map((r) => r.slice());
  },
  async appendRow(_spreadsheetId, tabName, rowArray) {
    requireTab(tabName).push(rowArray.slice());
    writes.push({ op: 'append', tab: tabName, row: rowArray });
    flushWrites();
  },
  async updateRowAt(_spreadsheetId, tabName, rowNumber, rowArray) {
    requireTab(tabName)[rowNumber - 1] = rowArray.slice();
    writes.push({ op: 'update', tab: tabName, rowNumber, row: rowArray });
    flushWrites();
  },
  async updateRowById(_spreadsheetId, tabName, idColIndex, id, rowArray) {
    const rows = requireTab(tabName);
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
