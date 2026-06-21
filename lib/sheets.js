'use strict';
const { google } = require('googleapis');

// 認証（Cloud Runのサービスアカウント or GOOGLE_APPLICATION_CREDENTIALS）
async function getClient() {
  const auth = new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth: await auth.getClient() });
}

/** 指定タブに1行追記 */
async function appendRow(spreadsheetId, tabName, rowArray) {
  const sheets = await getClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${tabName}!A:Z`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [rowArray] },
  });
}

/** 指定タブの全行を取得（ヘッダー含む） */
async function readRows(spreadsheetId, tabName) {
  const sheets = await getClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId, range: `${tabName}!A:Z`,
  });
  return res.data.values || [];
}

/** 許可リストタブを [{email, role}] として読む（1行目ヘッダー: 氏名,Gmail,権限） */
async function readAllowlist(spreadsheetId) {
  const rows = await readRows(spreadsheetId, '許可リスト');
  return rows.slice(1)
    .filter((r) => r[1])
    .map((r) => ({ name: r[0] || '', email: r[1], role: r[2] || 'member' }));
}

/** rows（ヘッダー込み）から idColIndex列がidの行の1始まり行番号を返す。無ければ-1。 */
function findRowNumber(rows, idColIndex, id) {
  for (let i = 1; i < rows.length; i++) {
    if ((rows[i] || [])[idColIndex] === id) return i + 1;
  }
  return -1;
}

/** idColIndex列がidの行をrowArrayで上書きする。 */
async function updateRowById(spreadsheetId, tabName, idColIndex, id, rowArray) {
  const rows = await readRows(spreadsheetId, tabName);
  const rowNumber = findRowNumber(rows, idColIndex, id);
  if (rowNumber === -1) throw new Error('対象が見つかりません: ' + id);
  const sheets = await getClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${tabName}!A${rowNumber}:Z${rowNumber}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [rowArray] },
  });
}

module.exports = { appendRow, readRows, readAllowlist, findRowNumber, updateRowById };
