/**
 * CGマスターDB — Pamunアンケートデータ配信 Web App
 * =====================================================
 * CGマスターDBのApps Scriptに追加するコードです。
 * コード.gs の末尾にそのまま貼り付けてください。
 *
 * デプロイ手順は README_SURVEY_SETUP.md を参照。
 */

// ── 認証トークン（Script Propertiesで上書き可能） ──
var SURVEY_TOKEN_DEFAULT = 'cg_pamun_2025';

/**
 * GAS Web App エントリポイント
 */
function doGet(e) {
  var params  = e && e.parameter ? e.parameter : {};
  var token   = params.token || '';
  var props   = PropertiesService.getScriptProperties();
  var expected = props.getProperty('WEB_APP_SECRET') || SURVEY_TOKEN_DEFAULT;

  if (token !== expected) {
    return json_({ error: 'unauthorized' });
  }

  try {
    var data = buildSurveyJson_();
    return json_(data);
  } catch (err) {
    Logger.log('doGet error: ' + err.message);
    return json_({ error: err.message });
  }
}

/**
 * メインデータ構築
 */
function buildSurveyJson_() {
  var ss        = SpreadsheetApp.getActiveSpreadsheet();
  var hubSheet  = ss.getSheetByName('アンケートハブ');

  if (!hubSheet) throw new Error('アンケートハブシートが見つかりません');

  var hubData   = hubSheet.getDataRange().getValues();
  var responses = [];
  var fileStats = [];

  // アンケートハブの構造:
  //   行1(idx0): セットアップ行（フォルダID入力欄）
  //   行2(idx1): 警告テキスト
  //   行3(idx2): ヘッダ行（ファイル名|ファイルID|商品カテゴリ|回答数|最終同期日時|…）
  //   行4+     : データ行
  for (var i = 3; i < hubData.length; i++) {
    var row      = hubData[i];
    var fileName = String(row[0] || '').trim();
    var fileId   = String(row[1] || '').trim();
    var category = String(row[2] || '未分類').trim();
    var count    = row[3] || 0;

    if (!fileId) continue;

    fileStats.push({
      fileName: fileName,
      fileId:   fileId,
      category: category,
      count:    count
    });

    try {
      var fileResps = readSurveyFile_(fileId, category, fileName);
      for (var j = 0; j < fileResps.length; j++) {
        responses.push(fileResps[j]);
      }
    } catch (e) {
      Logger.log('Skip file ' + fileId + ': ' + e.message);
    }
  }

  // アンケートサマリーシートも読む
  var summarySheet = ss.getSheetByName('アンケートサマリー');
  var summary = summarySheet ? sheetToArray_(summarySheet) : [];

  return {
    responses:  responses,
    fileStats:  fileStats,
    summary:    summary,
    updatedAt:  new Date().toISOString(),
    totalCount: responses.length
  };
}

/**
 * 個別アンケートスプレッドシートを開いて回答を取得
 */
function readSurveyFile_(fileId, category, fileName) {
  var ss      = SpreadsheetApp.openById(fileId);
  var sheets  = ss.getSheets();
  var results = [];

  for (var s = 0; s < sheets.length; s++) {
    var sheet = sheets[s];
    var data  = sheet.getDataRange().getValues();
    if (data.length < 2) continue;

    var rawHeaders = data[0];
    var headers    = rawHeaders.map(function(h) { return String(h || '').trim(); });

    // ヘッダが全部空なら別シート
    var hasHeader = headers.some(function(h) { return h !== ''; });
    if (!hasHeader) continue;

    for (var i = 1; i < data.length; i++) {
      var row  = data[i];
      var resp = {
        _category: category,
        _fileName: fileName,
        _fileId:   fileId,
      };

      var hasValue = false;
      for (var j = 0; j < headers.length; j++) {
        if (!headers[j]) continue;
        var val = row[j];
        if (val === '' || val === null || val === undefined) continue;

        var key = normalizeKey_(headers[j]);
        resp[key] = val instanceof Date ? val.toISOString() : val;
        hasValue  = true;
      }

      if (hasValue) results.push(resp);
    }
  }
  return results;
}

/**
 * 列名を正規化キーに変換
 */
function normalizeKey_(header) {
  var h = String(header).toLowerCase();

  if (/タイムスタンプ|timestamp|回答日時/.test(h)) return 'timestamp';
  if (/会社名|企業名|クライアント|company/.test(h))  return 'company';
  if (/nps|何点|おすすめ|推薦|紹介/.test(h))          return 'nps';
  if (/満足度|satisfaction/.test(h))                  return 'satisfaction';
  if (/ジャンル|カテゴリ|genre/.test(h))               return 'genre';
  if (/継続|リピート|また使いたい/.test(h))            return 'intention';
  if (/理由|選んだ|きっかけ|reason/.test(h))           return 'reason';
  if (/改善|フィードバック|要望|improvement/.test(h)) return 'improvement';
  if (/メールアドレス|email/.test(h))                  return 'email';
  if (/お名前|氏名|名前|name/.test(h))                 return 'name';
  if (/商品名|製品名|product/.test(h))                 return 'product';

  // デフォルトはそのまま返す
  return header;
}

/**
 * シートを [{col:val, ...}] の配列に変換
 */
function sheetToArray_(sheet) {
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  var headers = data[0].map(function(h) { return String(h || '').trim(); });
  return data.slice(1)
    .filter(function(row) { return row.some(function(v) { return v !== ''; }); })
    .map(function(row) {
      var obj = {};
      headers.forEach(function(h, i) { if (h) obj[h] = row[i]; });
      return obj;
    });
}

/**
 * JSON レスポンス生成ヘルパー
 */
function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── ローカルテスト用（GASエディタで直接実行して確認） ──
function testWebApp() {
  var result = buildSurveyJson_();
  Logger.log('総回答数: ' + result.totalCount);
  Logger.log('ファイル数: ' + result.fileStats.length);
  if (result.responses.length > 0) {
    Logger.log('サンプル回答: ' + JSON.stringify(result.responses[0]));
  }
}
