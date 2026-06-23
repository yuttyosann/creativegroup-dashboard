/**
 * build_influencer_db.gs — インフルエンサーDBタブ作成（1行目ヘッダー）
 * 使い方：対象スプレッドシートの拡張機能 > Apps Script に貼り、buildInfluencerDb を実行。冪等。
 */
function buildInfluencerDb() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var headers = ['inf_id','アカウント名','媒体','ジャンル','コンテンツ型','フォロワー',
    '女性%','中核年齢25-44%','スクリーニング','転換質%','実在率%','PRエンゲージ%',
    '適性メモ・向く商品','実績サマリー','URL','登録者','最終更新'];
  var sh = ss.getSheetByName('インフルエンサーDB');
  if (!sh) sh = ss.insertSheet('インフルエンサーDB');
  sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  sh.setFrozenRows(1);
  SpreadsheetApp.getUi().alert('✅ インフルエンサーDBタブを準備しました');
}
