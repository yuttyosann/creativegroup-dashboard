/**
 * build_crm_sheets.gs — CRMタブ（ブランド/商品/案件）作成＋診断ログに案件ID列を追加
 * 使い方：対象スプレッドシートの拡張機能 > Apps Script に貼り、buildCrmSheets を実行。
 * 既存タブがあればヘッダーのみ確認し、無ければ作成する。冪等。
 */
function buildCrmSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var defs = {
    'ブランド': ['brand_id','ブランド名','業種・カテゴリ','担当・連絡先','メモ','作成日','最終更新'],
    '商品': ['product_id','brand_id','商品名','カテゴリ','価格帯','URL','需要タイプ','メモ','作成日','最終更新'],
    '案件': ['case_id','brand_id','product_id','案件名','ステータス','商戦時期','予算','目標','メモ','作成日','最終更新']
  };
  Object.keys(defs).forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    var headers = defs[name];
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sh.setFrozenRows(1);
  });

  // 診断ログの先頭に「案件ID」列を追加（未追加の場合のみ）
  var log = ss.getSheetByName('診断ログ');
  if (log) {
    var first = log.getRange(1, 1).getValue();
    if (first !== '案件ID') {
      log.insertColumnBefore(1);
      log.getRange(1, 1).setValue('案件ID').setFontWeight('bold');
    }
  }
  SpreadsheetApp.getUi().alert('✅ CRMタブを準備しました（ブランド/商品/案件＋診断ログの案件ID列）');
}
