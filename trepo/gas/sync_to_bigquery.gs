/**
 * Trepo スプレッドシート → BigQuery 同期スクリプト
 *
 * 【設置手順】
 * 1. Trepo管理シートを開く
 *    https://docs.google.com/spreadsheets/d/1kJuaZsyQBxqgnl_CiMXmipLviWdJKF8HiyQ_obr7KLU/
 * 2. 拡張機能 → Apps Script
 * 3. このスクリプトを貼り付け
 * 4. 「実行 → setup」で初回設定（トリガー登録）
 * 5. GCPプロジェクトとの連携設定（プロジェクト設定 → GCPプロジェクト番号: 620587423995）
 *
 * 【appsscript.json に追加する oauthScopes】
 * "https://www.googleapis.com/auth/bigquery"
 * "https://www.googleapis.com/auth/spreadsheets"
 * "https://www.googleapis.com/auth/script.external_request"
 */

const CONFIG = {
  GCP_PROJECT_ID: 'cg-project-491303',
  BQ_DATASET:     'trepo_analytics',

  // ---- Trepo管理シート（記事） ----
  ARTICLE_SPREADSHEET_ID: '1kJuaZsyQBxqgnl_CiMXmipLviWdJKF8HiyQ_obr7KLU',
  ARTICLE_SHEETS: [
    { sheetName: '全体記事管理シート', category: '通常記事' },
    { sheetName: '芸能取材',          category: '芸能記事' },
  ],

  // ---- IGネタ会議シート ----
  IG_SPREADSHEET_ID: '1Yb9G1_HzmcCBxHnJx3jQ8hwbB2og_PMCeJmV2f1UFcE',

  SYNC_HOUR: 3,  // 毎日AM3時
};

// ============================================================
// メイン: 全データを同期
// ============================================================
function syncAllSheetsToBigQuery() {
  syncArticles();
  syncIgSchedule();
  Logger.log('✅ 全同期完了: ' + new Date().toLocaleString('ja-JP'));
}

// ============================================================
// 記事データの同期（全体記事管理シート + 芸能取材）
// ============================================================
function syncArticles() {
  const ss = SpreadsheetApp.openById(CONFIG.ARTICLE_SPREADSHEET_ID);
  const allRows = [];

  // ---- 全体記事管理シート（ヘッダー3行目、データ5行目〜） ----
  const artSheet = ss.getSheetByName('全体記事管理シート');
  if (!artSheet) {
    Logger.log('⚠️ シートが見つかりません: 全体記事管理シート');
  } else {
    const lastRow = artSheet.getLastRow();
    const lastCol = artSheet.getLastColumn();
    if (lastRow >= 5) {
      const headers = artSheet.getRange(3, 1, 1, lastCol).getValues()[0].map(h => h.toString().trim());
      const dataValues = artSheet.getRange(5, 1, lastRow - 4, lastCol).getValues();
      const rows = dataValues.filter(row => row.some(cell => cell !== ''));

      rows.forEach(row => {
        const obj = {};
        headers.forEach((h, i) => {
          const v = row[i];
          if (v instanceof Date) {
            obj[h] = Utilities.formatDate(v, 'Asia/Tokyo', 'yyyy-MM-dd');
          } else if (v !== '' && v !== null && v !== undefined) {
            obj[h] = v;
          }
        });
        if (!obj['タイトル']) return;
        allRows.push({
          article_id:     String(obj['No.'] || Utilities.getUuid()),
          title:          obj['タイトル'],
          author_id:      String(obj['執筆者名'] || ''),
          category:       obj['カテゴリ'] || '通常記事',
          published_date: obj['公開日'] || null,
          url:            obj['公開URL'] || obj['プレビューURL'] || null,
          is_pickup:      false,
          is_tieup:       obj['記事タイプ'] === '案件',
          status:         obj['記事チェック'] || '未確認',
          updated_at:     new Date().toISOString(),
        });
      });
      Logger.log('全体記事管理シート: ' + rows.length + '行 読み込み完了');
    }
  }

  // ---- 芸能取材（ヘッダー2行目、データ3行目〜） ----
  const geinoSheet = ss.getSheetByName('芸能取材');
  if (!geinoSheet) {
    Logger.log('⚠️ シートが見つかりません: 芸能取材');
  } else {
    const lastRow = geinoSheet.getLastRow();
    const lastCol = geinoSheet.getLastColumn();
    if (lastRow >= 3) {
      const headers = geinoSheet.getRange(2, 1, 1, lastCol).getValues()[0].map(h => h.toString().trim());
      const dataValues = geinoSheet.getRange(3, 1, lastRow - 2, lastCol).getValues();
      const rows = dataValues.filter(row => row.some(cell => cell !== ''));

      rows.forEach(row => {
        const obj = {};
        headers.forEach((h, i) => {
          const v = row[i];
          if (v instanceof Date) {
            obj[h] = Utilities.formatDate(v, 'Asia/Tokyo', 'yyyy-MM-dd');
          } else if (v !== '' && v !== null && v !== undefined) {
            obj[h] = v;
          }
        });
        const title = obj['案件'] || obj['登壇者名'] || null;
        if (!title) return;
        allRows.push({
          article_id:     Utilities.getUuid(),
          title:          title,
          author_id:      String(obj['ペン担当者名'] || obj['代表者名（進行担当）'] || ''),
          category:       '芸能記事',
          published_date: (typeof obj['取材日'] === 'string' && obj['取材日'].match(/^\d{4}-\d{2}-\d{2}$/)) ? obj['取材日'] : null,
          url:            obj['記事URL'] || null,
          is_pickup:      false,
          is_tieup:       false,
          status:         obj['記事URL'] ? '公開済み' : '未公開',
          updated_at:     new Date().toISOString(),
        });
      });
      Logger.log('芸能取材: ' + rows.length + '行 読み込み完了');
    }
  }

  if (allRows.length === 0) return;

  insertToBigQuery('trepo_articles', allRows, true);
  Logger.log('✅ trepo_articles: ' + allRows.length + '件 同期完了');
}

// ============================================================
// IGスケジュールの同期（カレンダーグリッド形式パーサー）
// 構造: 4行1セット → [日付行][種別行][ライター行][発案者行]
//       col0=メンバー名(名簿), col1=担当回数, col2-8=日〜土
// ============================================================
function syncIgSchedule() {
  const ss = SpreadsheetApp.openById(CONFIG.IG_SPREADSHEET_ID);
  const sheets = ss.getSheets();
  const allRows = [];
  // TBD プレースホルダー（名前として使わない）
  const PLACEHOLDERS = ['ライター', '発案者', '担当者', ''];

  sheets.forEach(sheet => {
    const name = sheet.getName();
    if (!name.match(/^\d{4}年\d{1,2}月分?$/)) {
      Logger.log('スキップ: ' + name);
      return;
    }

    const data = sheet.getDataRange().getValues();
    let count = 0;

    for (let i = 0; i < data.length - 3; i++) {
      const row = data[i];
      // 日付行の検出: col2〜8 のどこかに Date オブジェクトが入っている行
      if (!(row[2] instanceof Date)) continue;

      const datesRow    = data[i];
      const typesRow    = data[i + 1] || [];
      const writersRow  = data[i + 2] || [];
      const proposersRow = data[i + 3] || [];

      // 日〜土（col2〜col8）を処理
      for (let d = 2; d <= 8; d++) {
        const postDate    = datesRow[d];
        const contentType = String(typesRow[d]  || '').trim();
        const writer      = String(writersRow[d]  || '').trim();
        const proposer    = String(proposersRow[d] || '').trim();

        if (!(postDate instanceof Date)) continue;
        if (!contentType) continue;

        const memberId = PLACEHOLDERS.includes(writer) ? '' : writer;
        const notes    = PLACEHOLDERS.includes(proposer) ? null : proposer;

        allRows.push({
          schedule_id:   Utilities.getUuid(),
          post_date:     Utilities.formatDate(postDate, 'Asia/Tokyo', 'yyyy-MM-dd'),
          member_id:     memberId,
          content_title: null,
          content_type:  contentType,
          status:        '予定',
          notes:         notes,
          updated_at:    new Date().toISOString(),
        });
        count++;
      }
    }

    Logger.log(name + ': ' + count + '件 パース完了');
  });

  if (allRows.length === 0) {
    Logger.log('同期対象データなし');
    return;
  }

  insertToBigQuery('trepo_ig_schedule', allRows, true);
  Logger.log('✅ trepo_ig_schedule: ' + allRows.length + '件 同期完了');
}

// ============================================================
// BigQuery insertAll（バッチ500件）
// ============================================================
function insertToBigQuery(tableName, rows, truncate) {
  const token = ScriptApp.getOAuthToken();
  const PROJECT = CONFIG.GCP_PROJECT_ID;
  const DATASET = CONFIG.BQ_DATASET;

  if (truncate) {
    // 洗い替え: まず全削除
    const deleteUrl = `https://bigquery.googleapis.com/bigquery/v2/projects/${PROJECT}/jobs`;
    const deleteJob = {
      configuration: {
        query: {
          query: `TRUNCATE TABLE \`${PROJECT}.${DATASET}.${tableName}\``,
          useLegacySql: false,
        }
      }
    };
    const delRes = UrlFetchApp.fetch(deleteUrl, {
      method: 'POST',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + token },
      payload: JSON.stringify(deleteJob),
      muteHttpExceptions: true,
    });
    // ジョブ完了を待機（最大30秒）
    const delJob = JSON.parse(delRes.getContentText());
    if (delJob.error) {
      Logger.log('❌ DELETE jobエラー [' + tableName + ']: ' + JSON.stringify(delJob.error));
    }
    waitForJob(delJob.jobReference, token);
  }

  // バッチ挿入（500件ずつ）
  const BATCH = 500;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const insertRows = batch.map((row, idx) => ({
      insertId: `row_${i + idx}_${Date.now()}`,
      json: row,
    }));

    const url = `https://bigquery.googleapis.com/bigquery/v2/projects/${PROJECT}/datasets/${DATASET}/tables/${tableName}/insertAll`;
    const res = UrlFetchApp.fetch(url, {
      method: 'POST',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + token },
      payload: JSON.stringify({ rows: insertRows, skipInvalidRows: true, ignoreUnknownValues: true }),
      muteHttpExceptions: true,
    });

    const result = JSON.parse(res.getContentText());
    if (result.error) {
      Logger.log('❌ BQ APIエラー [' + tableName + ']: ' + JSON.stringify(result.error));
    }
    if (result.insertErrors && result.insertErrors.length > 0) {
      Logger.log('⚠️ insertエラー: ' + JSON.stringify(result.insertErrors[0]));
    }
  }
}

// ============================================================
// BQジョブ完了待機
// ============================================================
function waitForJob(jobRef, token) {
  if (!jobRef) return;
  const url = `https://bigquery.googleapis.com/bigquery/v2/projects/${jobRef.projectId}/jobs/${jobRef.jobId}`;
  for (let i = 0; i < 10; i++) {
    Utilities.sleep(3000);
    const res = UrlFetchApp.fetch(url, {
      headers: { Authorization: 'Bearer ' + token },
      muteHttpExceptions: true,
    });
    const job = JSON.parse(res.getContentText());
    if (job.status?.state === 'DONE') return;
  }
}

// ============================================================
// セットアップ（初回1回のみ実行）
// ============================================================
function setup() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'syncAllSheetsToBigQuery')
    .forEach(t => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger('syncAllSheetsToBigQuery')
    .timeBased()
    .everyDays(1)
    .atHour(CONFIG.SYNC_HOUR)
    .create();

  Logger.log('✅ トリガー設定完了: 毎日AM' + CONFIG.SYNC_HOUR + '時に同期');
}

// 手動テスト実行
function manualSync() {
  Logger.log('手動同期を開始...');
  syncAllSheetsToBigQuery();
}

// シート名確認（設定確認用）
function listAllSheets() {
  Logger.log('--- Trepo管理シート ---');
  SpreadsheetApp.openById(CONFIG.ARTICLE_SPREADSHEET_ID).getSheets()
    .forEach(s => Logger.log(' - ' + s.getName()));

  Logger.log('--- IGネタ会議シート ---');
  SpreadsheetApp.openById(CONFIG.IG_SPREADSHEET_ID).getSheets()
    .forEach(s => Logger.log(' - ' + s.getName()));
}

// 全列名確認（列名が合わない場合に実行）
function debugHeaders() {
  const articleSS = SpreadsheetApp.openById(CONFIG.ARTICLE_SPREADSHEET_ID);

  // 全体記事管理シート: ヘッダー行3, データ行5〜
  const artSheet = articleSS.getSheetByName('全体記事管理シート');
  if (artSheet) {
    const hRow = artSheet.getRange(3, 1, 1, artSheet.getLastColumn()).getValues()[0];
    Logger.log('[全体記事管理シート] ヘッダー(行3): ' + hRow.map((h, i) => (i+1)+'='+h).filter(s => !s.endsWith('=')).join(' | '));
    const d5 = artSheet.getRange(5, 1, 1, artSheet.getLastColumn()).getValues()[0];
    Logger.log('[全体記事管理シート] データ例(行5): ' + d5.map((v, i) => (i+1)+'='+(v instanceof Date ? v.toLocaleDateString('ja') : v)).filter(s => !s.endsWith('=')).join(' | '));
  }

  // 芸能取材: ヘッダー行2, データ行3〜
  const geino = articleSS.getSheetByName('芸能取材');
  if (geino) {
    const hRow = geino.getRange(2, 1, 1, geino.getLastColumn()).getValues()[0];
    Logger.log('[芸能取材] ヘッダー(行2): ' + hRow.map((h, i) => (i+1)+'='+h).filter(s => !s.endsWith('=')).join(' | '));
    const d3 = geino.getRange(3, 1, 1, geino.getLastColumn()).getValues()[0];
    Logger.log('[芸能取材] データ例(行3): ' + d3.map((v, i) => (i+1)+'='+(v instanceof Date ? v.toLocaleDateString('ja') : v)).filter(s => !s.endsWith('=')).join(' | '));
  }
}
