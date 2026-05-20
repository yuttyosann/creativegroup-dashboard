/**
 * ══════════════════════════════════════════════════════════════════
 * GAS追加コード — 全3646件サマリーキャッシュ対応
 * ══════════════════════════════════════════════════════════════════
 *
 * 【使い方】
 * 1. このコードを Apps Script エディタの末尾に貼り付ける
 * 2. doGet(e) 関数の冒頭（トークンチェックの直後）に mode サポートコードを追記（下記参照）
 * 3. setupSummaryTrigger() を手動実行してトリガーを登録
 * 4. 約4時間でキャッシュ完成（3646件 / 15件/回 × 1分トリガー）
 *
 * 【容量】
 * - サマリーシート: 3646行 × 8列 = 約30,000セル（余裕あり）
 * - 1分ごとに15ファイル処理 → 4時間で全件完成
 * - 完成後はdoGet?mode=summaryが1-2秒で全件返却
 * ══════════════════════════════════════════════════════════════════
 */

// ── 定数 ──────────────────────────────────────────────────────────
var SUMMARY_SHEET = 'アンケートサマリー';
var SUMM_COLS     = [
  'fileName', 'fileId', 'category', 'responseCount',
  'avgSatisfaction', 'avgNps', 'promoterRate', 'lastUpdated'
];

// ══════════════════════════════════════════════════════════════════
// doGet に追加するコード（既存の doGet 関数内、トークンチェック直後に挿入）
// ══════════════════════════════════════════════════════════════════
/*
  // ── mode=status / mode=summary サポート ──
  var mode = params.mode || '';

  if (mode === 'status') {
    var p_ = PropertiesService.getScriptProperties();
    return json_({
      status:    p_.getProperty('SUMM_STATUS')  || 'idle',
      processed: parseInt(p_.getProperty('SUMM_IDX')   || '0', 10),
      total:     parseInt(p_.getProperty('SUMM_TOTAL') || '0', 10),
    });
  }

  if (mode === 'summary') {
    var ss_ = SpreadsheetApp.getActiveSpreadsheet();
    var sSheet_ = ss_.getSheetByName(SUMMARY_SHEET);
    if (!sSheet_ || sSheet_.getLastRow() <= 1) {
      return json_({ summaries:[], total:0, hasMore:false,
        message:'setupSummaryTrigger() でキャッシュを構築してください' });
    }
    var sOff_   = parseInt(params.offset || '0',   10);
    var sLim_   = parseInt(params.limit  || '500', 10);
    var sTotal_ = sSheet_.getLastRow() - 1;
    var sStart_ = sOff_ + 2;
    var sRows_  = Math.min(sLim_, sTotal_ - sOff_);
    if (sRows_ <= 0) {
      return json_({ summaries:[], total:sTotal_, hasMore:false, supportsOffset:true });
    }
    var sVals_ = sSheet_.getRange(sStart_, 1, sRows_, SUMM_COLS.length).getValues();
    var sums_  = sVals_.map(function(row) {
      var o_ = {}; SUMM_COLS.forEach(function(h,i){ o_[h] = row[i]; }); return o_;
    });
    var p2_ = PropertiesService.getScriptProperties();
    return json_({
      summaries:      sums_,
      total:          sTotal_,
      offset:         sOff_,
      limit:          sLim_,
      hasMore:        sOff_ + sLim_ < sTotal_,
      buildStatus:    p2_.getProperty('SUMM_STATUS')  || 'idle',
      buildProcessed: parseInt(p2_.getProperty('SUMM_IDX')   || '0', 10),
      buildTotal:     parseInt(p2_.getProperty('SUMM_TOTAL') || '0', 10),
      supportsOffset: true,
    });
  }
*/

// ══════════════════════════════════════════════════════════════════
// 以下を Apps Script の末尾に追加する
// ══════════════════════════════════════════════════════════════════

/**
 * buildSummaryBatch
 * 1分トリガーで呼ばれる。アンケートハブの全ファイルを順次処理して
 * アンケートサマリーシートに集計結果を書き込む。
 * 完成まで約4時間（3646件 / 15件/回 × 1分）。
 */
function buildSummaryBatch() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(3000)) {
    Logger.log('buildSummaryBatch: ロック取得失敗、スキップ');
    return;
  }
  try {
    var props = PropertiesService.getScriptProperties();
    var ss    = SpreadsheetApp.getActiveSpreadsheet();

    // アンケートハブから全ファイルリストを取得
    var hub = ss.getSheetByName('アンケートハブ');
    if (!hub) { Logger.log('アンケートハブが見つかりません'); return; }

    var rows  = hub.getDataRange().getValues();
    var files = [];
    for (var i = 3; i < rows.length; i++) {
      var fid = String(rows[i][1] || '').trim();
      if (!fid) continue;
      files.push({
        fileName: String(rows[i][0] || '').trim(),
        fileId:   fid,
        category: String(rows[i][2] || '未分類').trim(),
      });
    }

    var total = files.length;
    props.setProperty('SUMM_TOTAL', String(total));

    var idx = parseInt(props.getProperty('SUMM_IDX') || '0', 10);
    if (idx >= total) {
      props.setProperty('SUMM_STATUS', 'complete');
      Logger.log('buildSummaryBatch: 完了 total=' + total);
      // 完了したらトリガーを削除（省エネ）
      ScriptApp.getProjectTriggers().forEach(function(t) {
        if (t.getHandlerFunction() === 'buildSummaryBatch') ScriptApp.deleteTrigger(t);
      });
      return;
    }
    props.setProperty('SUMM_STATUS', 'building');

    // サマリーシート取得 or 作成
    var sheet = ss.getSheetByName(SUMMARY_SHEET);
    if (!sheet) {
      sheet = ss.insertSheet(SUMMARY_SHEET);
      sheet.getRange(1, 1, 1, SUMM_COLS.length).setValues([SUMM_COLS]);
      sheet.setFrozenRows(1);
    }

    var BATCH = 15;  // 1回あたり15ファイル処理
    var t0    = Date.now();
    var newRows = [];

    for (var k = idx; k < Math.min(idx + BATCH, total); k++) {
      if (Date.now() - t0 > 45000) {  // 45秒タイムアウトガード
        Logger.log('buildSummaryBatch: タイムアウト idx=' + k);
        break;
      }

      var f      = files[k];
      var satV   = [], npsV = [];
      var cnt    = 0;

      try {
        // readSurveyFile_ は既存関数を再利用
        var rr = readSurveyFile_(f.fileId, f.category, f.fileName);
        cnt = rr.length;
        rr.forEach(function(r) {
          var s = parseFloat(r.satisfaction); if (!isNaN(s)) satV.push(s);
          var n = parseFloat(r.nps);          if (!isNaN(n)) npsV.push(n);
        });
      } catch(e) {
        Logger.log('skip ' + f.fileId + ': ' + e.message);
      }

      var asat = satV.length ? (satV.reduce(function(a,b){return a+b},0)/satV.length).toFixed(2) : '';
      var anps = npsV.length ? (npsV.reduce(function(a,b){return a+b},0)/npsV.length).toFixed(2) : '';
      var prom = '';
      if (npsV.length > 0) {
        prom = (npsV.filter(function(v){return v>=9}).length / npsV.length * 100).toFixed(1);
      } else if (satV.length > 0) {
        prom = (satV.filter(function(v){return v>=4}).length / satV.length * 100).toFixed(1);
      }

      newRows.push([
        f.fileName, f.fileId, f.category, cnt,
        asat, anps, prom !== '' ? parseFloat(prom) : '',
        new Date().toISOString(),
      ]);

      idx = k + 1;
      Logger.log('  processed [' + idx + '/' + total + ']: ' + f.fileName + ' (' + cnt + '件)');
    }

    // バッチを一括書き込み
    if (newRows.length > 0) {
      sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, SUMM_COLS.length).setValues(newRows);
    }

    props.setProperty('SUMM_IDX', String(idx));
    if (idx >= total) props.setProperty('SUMM_STATUS', 'complete');
    Logger.log('buildSummaryBatch: idx=' + idx + '/' + total);

  } finally {
    lock.releaseLock();
  }
}

/**
 * setupSummaryTrigger
 * buildSummaryBatch を1分間隔で実行するトリガーを設定する。
 * 【手動で一度だけ実行すること】
 */
function setupSummaryTrigger() {
  // 既存の重複トリガーを削除
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'buildSummaryBatch') {
      ScriptApp.deleteTrigger(t);
    }
  });
  // 1分間隔トリガーを作成
  ScriptApp.newTrigger('buildSummaryBatch')
    .timeBased()
    .everyMinutes(1)
    .create();
  Logger.log('setupSummaryTrigger: 1分トリガー設定完了（約4時間で完成予定）');
}

/**
 * resetSummaryBuild
 * サマリーキャッシュをリセットして最初からやり直す。
 * ファイルが大幅に増えたときや再構築したいときに使用。
 */
function resetSummaryBuild() {
  var props = PropertiesService.getScriptProperties();
  props.setProperty('SUMM_IDX',    '0');
  props.setProperty('SUMM_STATUS', 'idle');
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SUMMARY_SHEET);
  if (sheet && sheet.getLastRow() > 1) {
    sheet.deleteRows(2, sheet.getLastRow() - 1);
  }
  Logger.log('resetSummaryBuild: リセット完了');
}

/**
 * checkSummaryStatus
 * 現在のキャッシュ構築状態をログに出力する（確認用）。
 */
function checkSummaryStatus() {
  var props = PropertiesService.getScriptProperties();
  var idx   = parseInt(props.getProperty('SUMM_IDX')   || '0', 10);
  var total = parseInt(props.getProperty('SUMM_TOTAL') || '0', 10);
  var pct   = total > 0 ? Math.round(idx / total * 100) : 0;
  Logger.log('サマリーキャッシュ状態:');
  Logger.log('  status:    ' + (props.getProperty('SUMM_STATUS') || 'idle'));
  Logger.log('  processed: ' + idx + ' / ' + total + ' ファイル (' + pct + '%)');

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SUMMARY_SHEET);
  if (sheet) {
    Logger.log('  シート行数: ' + (sheet.getLastRow() - 1) + '件');
  } else {
    Logger.log('  シート: 未作成');
  }
}
