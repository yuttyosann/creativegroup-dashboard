/**
 * build_result_db.gs — 実績タブ作成（1行目ヘッダー）
 * 使い方：対象スプレッドシートの拡張機能 > Apps Script に貼り、buildResultDb を実行。冪等。
 */
function buildResultDb() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var headers = ['result_id','案件ID','アカウント名','媒体','実施日','実売数','売上','タイアップ費',
    '成果報酬率%','総コスト','ROAS%','損益','メモ','記録者','最終更新'];
  var sh = ss.getSheetByName('実績');
  if (!sh) sh = ss.insertSheet('実績');
  sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  sh.setFrozenRows(1);
  SpreadsheetApp.getUi().alert('✅ 実績タブを準備しました');
}
