/**
 * CreativeGroup グロースハック マスターDB セットアップスクリプト
 * ver 2.0 - Googleドライブ一括読み込み対応
 *
 * ▼ 実行手順（Chromeで手動実行）
 *   1. https://sheets.new でGoogleスプレッドシートを新規作成
 *   2. 拡張機能 > Apps Script を開く
 *   3. このファイルの内容をすべて貼り付けて Ctrl+S で保存
 *   4. 関数リスト: setupGrowthHackDB を選択 → 「実行」
 *   5. Googleアカウントのアクセス許可ダイアログ → 「許可」
 *
 * ▼ アンケートをGoogleドライブから読み込む手順
 *   1. Googleドライブに「アンケート回答」フォルダを作成
 *   2. 各商品のGoogleフォーム回答スプレッドシートをそのフォルダに移動（またはショートカットを置く）
 *   3. 作成されたアンケートハブシートの B1 セルにフォルダIDを入力
 *      （フォルダURLの https://drive.google.com/drive/folders/【ここ】 の部分）
 *   4. Apps Scriptエディタで syncSurveysFromDrive を実行
 *
 * ⚠️ 実行前に下の CONFIG を自社内容に編集してください
 */

// ============================================================
// CONFIG
// ============================================================
const CONFIG = {
  services: [
    '動画制作', 'デザイン制作', 'Webサイト制作', 'SNS運用',
    '広告運用', 'コンサルティング', '写真撮影', 'ブランディング',
    'コピーライティング', 'その他'
  ],
  channels: [
    '紹介', 'Google広告', 'Meta広告', 'SNSオーガニック',
    '展示会・イベント', 'Web問い合わせフォーム', 'アップセル',
    'クロスセル', 'テレアポ', 'メール営業', 'その他'
  ],
  industries: [
    'コスメ・美容', 'アパレル・ファッション', '食品・飲料',
    'EC・小売', 'IT・SaaS', 'メーカー', 'サービス業',
    'ヘルスケア', 'エンタメ', 'その他'
  ],
  salesReps: ['担当A', '担当B', '担当C', '担当D'], // ← 実際の名前に変更

  // アンケートの列を自動マッピングするキーワード（小文字で判定）
  // フォームの設問文にこれらのキーワードが含まれていれば自動認識
  surveyKeywords: {
    timestamp:   ['タイムスタンプ', 'timestamp', '回答日時', '日時'],
    company:     ['会社名', '会社', '社名', '企業名', '組織名', '法人名'],
    nps:         ['おすすめ', '推薦', '紹介したい', 'nps', '知人に'],
    satisfaction:['満足度', '満足', '評価', 'rating', '星', '点数', '総合'],
    genre:       ['商品名', '製品名', 'ジャンル', 'カテゴリ', '商品カテゴリ', '対象商品'],
    reason:      ['選んだ理由', '決め手', '選んだきっかけ', 'ご購入理由', '購入理由'],
    improvement: ['改善', '不満', '要望', 'あったらいい', '欲しい機能', 'ご意見'],
    continuity:  ['継続', 'また使いたい', 'リピート', '引き続き'],
  },
};

// ============================================================
// メイン実行関数
// ============================================================
function setupGrowthHackDB() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const defaultSheet = ss.getSheets()[0];
  if (['シート1', 'Sheet1'].includes(defaultSheet.getName())) {
    defaultSheet.setName('KPIダッシュボード');
  }

  const sheetDefs = [
    { name: '顧客マスタ',       tabColor: '#1a73e8' },
    { name: '受注マスタ',       tabColor: '#0f9d58' },
    { name: '商談マスタ',       tabColor: '#f4b400' },
    { name: '広告マスタ',       tabColor: '#db4437' },
    { name: 'アンケートハブ',    tabColor: '#9c27b0' },
    { name: 'アンケートサマリー', tabColor: '#6d4c41' },
    { name: 'KPIダッシュボード', tabColor: '#00897b' },
  ];

  sheetDefs.forEach(({ name, tabColor }) => {
    let sheet = ss.getSheetByName(name);
    if (!sheet) sheet = ss.insertSheet(name);
    sheet.setTabColor(tabColor);
  });

  setupClientMaster(ss);
  setupOrderMaster(ss);
  setupDealMaster(ss);
  setupAdMaster(ss);
  setupSurveyHub(ss);
  setupSurveySummary(ss);
  setupKPIDashboard(ss);

  const order = [
    'KPIダッシュボード', '顧客マスタ', '受注マスタ', '商談マスタ',
    '広告マスタ', 'アンケートハブ', 'アンケートサマリー'
  ];
  order.forEach((name, i) => {
    const sheet = ss.getSheetByName(name);
    if (sheet) { ss.setActiveSheet(sheet); ss.moveActiveSheet(i + 1); }
  });

  SpreadsheetApp.getUi().alert(
    '✅ セットアップ完了！\n\n' +
    '次のステップ:\n' +
    '① CONFIGの担当営業名・サービス種別を実際の内容に変更\n' +
    '② アンケートハブシートの B1 にGoogleドライブのフォルダIDを入力\n' +
    '③ syncSurveysFromDrive() を実行してフォームデータを取り込む'
  );
}

// ============================================================
// ユーティリティ
// ============================================================
function applyHeader(sheet, headers, bgColor, fontColor = '#ffffff') {
  sheet.clearContents();
  sheet.clearFormats();
  const range = sheet.getRange(1, 1, 1, headers.length);
  range.setValues([headers]);
  range.setBackground(bgColor);
  range.setFontColor(fontColor);
  range.setFontWeight('bold');
  range.setVerticalAlignment('middle');
  sheet.setFrozenRows(1);
  sheet.setRowHeight(1, 32);
}

function addDropdown(sheet, rangeA1, values) {
  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(values, true).setAllowInvalid(false).build();
  sheet.getRange(rangeA1).setDataValidation(rule);
}

function addConditionalFormat(sheet, rangeA1, type, value, bg, font) {
  const range = sheet.getRange(rangeA1);
  const rules = sheet.getConditionalFormatRules();
  let b = SpreadsheetApp.newConditionalFormatRule().setRanges([range]);
  if (type === 'text')    b = b.whenTextEqualTo(value);
  else if (type === 'lt') b = b.whenNumberLessThan(value);
  else if (type === 'gte')b = b.whenNumberGreaterThanOrEqualTo(value);
  else if (type === 'between') b = b.whenNumberBetween(value[0], value[1]);
  else if (type === 'formula') b = b.whenFormulaSatisfied(value);
  b = b.setBackground(bg);
  if (font) b = b.setFontColor(font);
  rules.push(b.build());
  sheet.setConditionalFormatRules(rules);
}

// ============================================================
// Sheet 1: 顧客マスタ
// ============================================================
function setupClientMaster(ss) {
  const sheet = ss.getSheetByName('顧客マスタ');
  applyHeader(sheet, [
    'client_id', '会社名', '業種', '担当営業', '初回契約日',
    'MF取引先ID', '紹介元client_id', 'ステータス',
    '累計売上（自動）', '最終受注日（自動）', '備考'
  ], '#1a73e8');

  [90,200,130,100,110,120,140,100,130,130,220]
    .forEach((w,i) => sheet.setColumnWidth(i+1,w));

  addDropdown(sheet, 'C2:C1000', CONFIG.industries);
  addDropdown(sheet, 'D2:D1000', CONFIG.salesReps);
  addDropdown(sheet, 'H2:H1000', ['アクティブ', '休眠', '解約']);

  sheet.getRange('E2:E1000').setNumberFormat('yyyy/mm/dd');
  sheet.getRange('J2:J1000').setNumberFormat('yyyy/mm/dd');
  sheet.getRange('I2:I1000').setNumberFormat('#,##0');

  sheet.getRange('I2').setFormula(
    '=ARRAYFORMULA(IF(A2:A="","",IFERROR(SUMIF(受注マスタ!B:B,A2:A,受注マスタ!F:F),0)))'
  );
  sheet.getRange('J2').setFormula(
    '=ARRAYFORMULA(IF(A2:A="","",IFERROR(MAXIFS(受注マスタ!D:D,受注マスタ!B:B,A2:A),"")))'
  );
  sheet.getRange('I1:J1').setBackground('#c8e6c9');
  sheet.getRange('I1').setNote('受注マスタから自動集計');
  sheet.getRange('J1').setNote('受注マスタの最新契約日（自動）');

  addConditionalFormat(sheet,'H2:H1000','text','アクティブ','#e8f5e9','#1b5e20');
  addConditionalFormat(sheet,'H2:H1000','text','休眠',      '#fff8e1','#e65100');
  addConditionalFormat(sheet,'H2:H1000','text','解約',      '#fce8e6','#c62828');
}

// ============================================================
// Sheet 2: 受注マスタ
// ============================================================
function setupOrderMaster(ss) {
  const sheet = ss.getSheetByName('受注マスタ');
  applyHeader(sheet, [
    'order_id', 'client_id', '会社名（自動）', '契約日', 'サービス種別',
    '契約金額', '原価', '粗利（自動）', '粗利率（自動）', '受注経路',
    'リードソース詳細', '広告キャンペーン名', 'MF請求書ID', '担当営業', '備考'
  ], '#0f9d58');

  [90,90,180,100,140,110,100,110,110,130,180,180,120,100,220]
    .forEach((w,i) => sheet.setColumnWidth(i+1,w));

  addDropdown(sheet,'E2:E1000', CONFIG.services);
  addDropdown(sheet,'J2:J1000', CONFIG.channels);
  addDropdown(sheet,'N2:N1000', CONFIG.salesReps);

  sheet.getRange('C2').setFormula(
    '=ARRAYFORMULA(IF(B2:B="","",IFERROR(VLOOKUP(B2:B,顧客マスタ!A:B,2,0),B2:B)))'
  );
  sheet.getRange('H2').setFormula(
    '=ARRAYFORMULA(IF(F2:F="","",F2:F-IF(G2:G="",0,G2:G)))'
  );
  sheet.getRange('I2').setFormula(
    '=ARRAYFORMULA(IF(F2:F="","",IF(F2:F=0,0,H2:H/F2:F)))'
  );

  sheet.getRange('D2:D1000').setNumberFormat('yyyy/mm/dd');
  sheet.getRange('F2:H1000').setNumberFormat('#,##0');
  sheet.getRange('I2:I1000').setNumberFormat('0.0%');

  ['C1','H1','I1'].forEach(c => {
    sheet.getRange(c).setBackground('#c8e6c9').setNote('自動計算列（直接入力不要）');
  });

  addConditionalFormat(sheet,'I2:I1000','lt', 0.2,'#fce8e6','#c62828');
  addConditionalFormat(sheet,'I2:I1000','gte',0.4,'#e8f5e9','#1b5e20');
}

// ============================================================
// Sheet 3: 商談マスタ
// ============================================================
function setupDealMaster(ss) {
  const sheet = ss.getSheetByName('商談マスタ');
  applyHeader(sheet, [
    'deal_id','client_id','会社名','商談開始日','商談フェーズ',
    '見込み金額','受注確率','クローズ予定日','受注日','order_id',
    '失注日','失注理由','失注詳細','担当営業','次回アクション','次回アクション日'
  ], '#f4b400', '#000000');

  [90,90,180,110,120,110,90,120,100,100,100,130,200,100,220,130]
    .forEach((w,i) => sheet.setColumnWidth(i+1,w));

  addDropdown(sheet,'E2:E1000',['初回接触','ヒアリング','提案','見積提出','交渉中','受注','失注']);
  addDropdown(sheet,'G2:G1000',['10%','25%','50%','75%','90%','100%']);
  addDropdown(sheet,'L2:L1000',[
    '価格・予算','競合他社','タイミング','ニーズ不一致',
    '担当者変更','社内方針変更','連絡途絶','その他'
  ]);
  addDropdown(sheet,'N2:N1000', CONFIG.salesReps);

  ['D','H','I','K','P'].forEach(c =>
    sheet.getRange(`${c}2:${c}1000`).setNumberFormat('yyyy/mm/dd')
  );
  sheet.getRange('F2:F1000').setNumberFormat('#,##0');

  addConditionalFormat(sheet,'E2:E1000','text','受注',  '#e8f5e9','#1b5e20');
  addConditionalFormat(sheet,'E2:E1000','text','失注',  '#fce8e6','#c62828');
  addConditionalFormat(sheet,'E2:E1000','text','交渉中','#fff8e1','#e65100');
  addConditionalFormat(sheet,'E2:E1000','text','提案',  '#e3f2fd','#0d47a1');
  addConditionalFormat(sheet,'P2:P1000','formula',
    '=AND(P2<>"",P2<TODAY(),E2<>"受注",E2<>"失注")','#fce8e6','#c62828');
}

// ============================================================
// Sheet 4: 広告マスタ
// ============================================================
function setupAdMaster(ss) {
  const sheet = ss.getSheetByName('広告マスタ');
  applyHeader(sheet, [
    '日付','媒体','キャンペーン名','広告セット名',
    '広告費','インプレッション','クリック数','CTR（自動）',
    'CV数','CPA（自動）','ROAS（自動）','紐づくorder_id','備考'
  ], '#db4437');

  [100,110,210,190,100,140,110,110,80,110,110,140,200]
    .forEach((w,i) => sheet.setColumnWidth(i+1,w));

  addDropdown(sheet,'B2:B1000',
    ['Google広告','Meta広告','Instagram','Twitter/X','TikTok','YouTube','その他']);

  sheet.getRange('H2').setFormula(
    '=ARRAYFORMULA(IF(F2:F="","",IFERROR(G2:G/F2:F,0)))'
  );
  sheet.getRange('J2').setFormula(
    '=ARRAYFORMULA(IF(E2:E="","",IFERROR(E2:E/IF(I2:I=0,1,I2:I),0)))'
  );
  sheet.getRange('K2').setFormula(
    '=ARRAYFORMULA(IF(L2:L="","",IFERROR(VLOOKUP(L2:L,受注マスタ!A:F,6,0)/E2:E,"")))'
  );

  sheet.getRange('A2:A1000').setNumberFormat('yyyy/mm/dd');
  sheet.getRange('E2:G1000').setNumberFormat('#,##0');
  sheet.getRange('H2:H1000').setNumberFormat('0.00%');
  sheet.getRange('J2:J1000').setNumberFormat('#,##0');
  sheet.getRange('K2:K1000').setNumberFormat('0.00');
  ['H1','J1','K1'].forEach(c =>
    sheet.getRange(c).setBackground('#fce4ec').setNote('自動計算列')
  );
}

// ============================================================
// Sheet 5: アンケートハブ
// ============================================================
/**
 * Googleドライブのフォルダに入っているすべてのフォーム回答シートを
 * 一覧管理し、syncSurveysFromDrive() の起点となるシート。
 *
 * 設定:
 *   B1 = GoogleドライブのフォルダID
 *        （フォルダURL末尾の長い英数字の文字列）
 *
 * 列定義:
 *   ファイル名     : Googleドライブ上のスプレッドシート名
 *   ファイルID     : DriveファイルのID（リンク生成用）
 *   商品カテゴリ   : 手動で分類（化粧水 / スキンケア など）
 *   回答数         : 取り込み済み件数
 *   最終同期日時   : syncSurveysFromDrive() の最終実行日時
 *   マッピング確認 : 列マッピングが正しいか（OK / 要確認）
 *   マッピング詳細 : どの列をどのフィールドに対応させたか
 */
function setupSurveyHub(ss) {
  const sheet = ss.getSheetByName('アンケートハブ');
  sheet.clearContents();
  sheet.clearFormats();

  // フォルダID入力欄
  sheet.getRange('A1').setValue('GoogleドライブフォルダID:')
    .setFontWeight('bold').setBackground('#ede7f6').setVerticalAlignment('middle');
  sheet.getRange('B1').setValue('← ここにフォルダIDを貼り付ける')
    .setFontColor('#9e9e9e').setFontStyle('italic').setBackground('#ede7f6');
  sheet.getRange('C1').setValue('▶ フォルダIDの確認方法: DriveでフォルダをクリックするとURLが\nhttps://drive.google.com/drive/folders/【このID】になります')
    .setFontColor('#666666').setFontSize(9).setBackground('#ede7f6').setWrap(true);
  sheet.getRange('A1:C1').setBackground('#ede7f6');
  sheet.setRowHeight(1, 40);

  // 「同期実行」ボタン案内
  sheet.getRange('E1').setValue('⚡ Apps Scriptで syncSurveysFromDrive() を実行してください')
    .setFontColor('#9c27b0').setFontWeight('bold').setFontStyle('italic');

  // ファイル一覧ヘッダー（3行目から）
  const headers = [
    'ファイル名', 'ファイルID', '商品カテゴリ（手動入力）',
    '回答数', '最終同期日時', 'マッピング確認', 'マッピング詳細（自動）'
  ];
  const headerRange = sheet.getRange(3, 1, 1, headers.length);
  headerRange.setValues([headers])
    .setBackground('#9c27b0').setFontColor('#ffffff')
    .setFontWeight('bold').setVerticalAlignment('middle');
  sheet.setRowHeight(3, 28);
  sheet.setFrozenRows(3);

  [250, 220, 180, 80, 160, 100, 400]
    .forEach((w,i) => sheet.setColumnWidth(i+1,w));

  sheet.getRange('D4:D1000').setNumberFormat('0');
  sheet.getRange('E4:E1000').setNumberFormat('yyyy/mm/dd HH:mm');

  addConditionalFormat(sheet,'F4:F1000','text','OK',      '#e8f5e9','#1b5e20');
  addConditionalFormat(sheet,'F4:F1000','text','要確認',  '#fce8e6','#c62828');

  sheet.getRange('A2').setValue(
    '⚠️ 同期前に C列（商品カテゴリ）を手動で入力してください。'
    + '同名カテゴリは1つのシートに集約されます。'
  ).setFontColor('#e65100').setFontStyle('italic');
}

// ============================================================
// Sheet 6: アンケートサマリー
// ============================================================
function setupSurveySummary(ss) {
  const sheet = ss.getSheetByName('アンケートサマリー');
  sheet.clearContents();
  sheet.clearFormats();

  // タイトル
  sheet.getRange('A1:F1').merge();
  sheet.getRange('A1').setValue('📊 アンケートサマリー（商品カテゴリ別）')
    .setFontSize(14).setFontWeight('bold')
    .setBackground('#4a148c').setFontColor('#ffffff')
    .setHorizontalAlignment('center').setVerticalAlignment('middle');
  sheet.setRowHeight(1, 36);

  sheet.getRange('G1').setFormula('="更新: "&TEXT(NOW(),"yyyy/mm/dd")')
    .setFontColor('#888888').setHorizontalAlignment('right').setVerticalAlignment('middle');

  // 説明
  sheet.getRange('A2:G2').merge();
  sheet.getRange('A2').setValue(
    'このシートは syncSurveysFromDrive() を実行すると自動更新されます。'
    + '各商品タブのデータを集計して表示します。'
  ).setFontColor('#666666').setFontStyle('italic').setFontSize(10);

  // サマリーヘッダー（4行目から）
  const headers = [
    '商品カテゴリ', '回答数', '平均NPS', 'NPS分布（推薦者%）',
    'NPS分布（中立者%）', 'NPS分布（批判者%）',
    '平均満足度', '主なキーフレーズ（AI分析）', '改善要望Top3（AI分析）'
  ];
  sheet.getRange(4, 1, 1, headers.length)
    .setValues([headers]).setBackground('#6a1b9a').setFontColor('#ffffff')
    .setFontWeight('bold').setVerticalAlignment('middle');
  sheet.setFrozenRows(4);
  sheet.setRowHeight(4, 28);

  [160, 80, 100, 140, 140, 140, 110, 280, 280]
    .forEach((w,i) => sheet.setColumnWidth(i+1,w));

  sheet.getRange('C5:C100').setNumberFormat('0.0');
  sheet.getRange('D5:F100').setNumberFormat('0.0%');
  sheet.getRange('G5:G100').setNumberFormat('0.0');

  // 初期案内メッセージ
  sheet.getRange('A5').setValue('← syncSurveysFromDrive() を実行すると自動入力されます')
    .setFontColor('#bdbdbd').setFontStyle('italic');
}

// ============================================================
// アンケートデータをGoogleドライブから同期
// ============================================================
/**
 * 実行方法: Apps Scriptエディタで syncSurveysFromDrive を選択して「実行」
 *
 * 処理フロー:
 *   1. アンケートハブシートの B1 からフォルダIDを取得
 *   2. フォルダ内のすべてのGoogleスプレッドシートを列挙
 *   3. 各ファイルの最初のシート（フォーム回答）を開く
 *   4. ヘッダー行をキーワードで自動マッピング
 *   5. 商品カテゴリ別のシートを作成（なければ新規）
 *   6. 未取り込みの回答を追記
 *   7. アンケートサマリーを更新
 */
function syncSurveysFromDrive() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const hubSheet = ss.getSheetByName('アンケートハブ');

  // フォルダIDを取得
  const folderId = hubSheet.getRange('B1').getValue().toString().trim();
  if (!folderId || folderId.includes('←')) {
    SpreadsheetApp.getUi().alert(
      '⚠️ エラー\n\nアンケートハブシートの B1 にGoogleドライブのフォルダIDを入力してください。'
    );
    return;
  }

  let folder;
  try {
    folder = DriveApp.getFolderById(folderId);
  } catch(e) {
    SpreadsheetApp.getUi().alert(`フォルダが見つかりません。\nID: ${folderId}\n\n${e.message}`);
    return;
  }

  // フォルダ内のスプレッドシートを列挙
  const files = folder.getFilesByType(MimeType.GOOGLE_SHEETS);
  const fileList = [];
  while (files.hasNext()) {
    fileList.push(files.next());
  }

  if (fileList.length === 0) {
    SpreadsheetApp.getUi().alert('フォルダ内にスプレッドシートが見つかりませんでした。');
    return;
  }

  // アンケートハブの既存登録を読み込む（ファイルID → 行番号）
  const hubData = hubSheet.getRange(4, 1, Math.max(hubSheet.getLastRow() - 3, 1), 7).getValues();
  const registeredFiles = {};
  hubData.forEach((row, i) => {
    if (row[1]) registeredFiles[row[1]] = i + 4; // fileId → row number
  });

  let newCount = 0;
  let syncedCount = 0;

  fileList.forEach(file => {
    const fileId   = file.getId();
    const fileName = file.getName();

    // アンケートハブの商品カテゴリ列を確認
    let category = '';
    const hubRow = registeredFiles[fileId];
    if (hubRow) {
      category = hubSheet.getRange(hubRow, 3).getValue().toString().trim();
    } else {
      // 新規ファイル → ハブに追記
      const nextRow = hubSheet.getLastRow() + 1;
      hubSheet.getRange(nextRow, 1).setValue(fileName);
      hubSheet.getRange(nextRow, 2).setValue(fileId);
      hubSheet.getRange(nextRow, 6).setValue('要確認').setFontColor('#c62828');
      registeredFiles[fileId] = nextRow;
      newCount++;
    }

    // カテゴリ未入力なら一旦スキップ（ハブへの登録はする）
    if (!category) return;

    // フォーム回答シートを開く
    let srcSS, srcSheet;
    try {
      srcSS    = SpreadsheetApp.openById(fileId);
      srcSheet = srcSS.getSheets()[0]; // 最初のシート（フォーム回答）
    } catch(e) {
      const r = registeredFiles[fileId];
      hubSheet.getRange(r, 6).setValue('要確認').setNote('アクセスエラー: ' + e.message);
      return;
    }

    if (srcSheet.getLastRow() < 2) return; // データなし

    // ヘッダー行を取得してマッピング
    const srcHeaders = srcSheet.getRange(1, 1, 1, srcSheet.getLastColumn()).getValues()[0];
    const mapping    = detectColumnMapping(srcHeaders);
    const mapDesc    = Object.entries(mapping)
      .filter(([,v]) => v >= 0)
      .map(([k,v]) => `${k}→列${v+1}(${srcHeaders[v]})`)
      .join(' / ');

    // カテゴリ別シートを取得または作成
    const catSheet = getOrCreateCategorySheet(ss, category);

    // 既存の取り込み済みタイムスタンプを収集（重複防止）
    const existingTs = new Set();
    if (catSheet.getLastRow() > 1) {
      catSheet.getRange(2, 1, catSheet.getLastRow() - 1, 1)
        .getValues().forEach(r => { if (r[0]) existingTs.add(r[0].toString()); });
    }

    // 全回答を読み込んで追記
    const allData  = srcSheet.getRange(2, 1, srcSheet.getLastRow() - 1, srcSheet.getLastColumn()).getValues();
    const newRows  = [];

    allData.forEach(row => {
      const ts = row[mapping.timestamp >= 0 ? mapping.timestamp : 0];
      if (existingTs.has(ts.toString())) return; // 重複スキップ

      const unified = buildUnifiedRow(row, mapping, srcHeaders, fileName);
      newRows.push(unified);
    });

    if (newRows.length > 0) {
      const startRow = catSheet.getLastRow() + 1;
      catSheet.getRange(startRow, 1, newRows.length, newRows[0].length)
        .setValues(newRows);
    }

    // ハブ更新
    const hRow = registeredFiles[fileId];
    hubSheet.getRange(hRow, 1).setValue(fileName);
    hubSheet.getRange(hRow, 2).setValue(fileId);
    hubSheet.getRange(hRow, 4).setValue(
      (catSheet.getLastRow() > 1 ? catSheet.getLastRow() - 1 : 0)
    );
    hubSheet.getRange(hRow, 5).setValue(new Date());
    hubSheet.getRange(hRow, 6).setValue(mapping._confidence === 'high' ? 'OK' : '要確認');
    hubSheet.getRange(hRow, 7).setValue(mapDesc);

    syncedCount++;
  });

  // サマリーシートを更新
  updateSurveySummary(ss);

  SpreadsheetApp.getUi().alert(
    `✅ 同期完了！\n\n` +
    `処理ファイル数: ${syncedCount}\n` +
    `新規登録ファイル: ${newCount}（商品カテゴリを入力して再実行してください）\n\n` +
    `アンケートハブで「要確認」のファイルは列マッピングを確認してください。`
  );
}

// ============================================================
// 列の自動マッピング
// ============================================================
/**
 * フォームのヘッダー行から、共通フィールドを自動検出する。
 * CONFIG.surveyKeywords のキーワードと部分一致で判定。
 * 戻り値: { timestamp, company, nps, satisfaction, genre, reason, improvement, continuity, _confidence }
 */
function detectColumnMapping(headers) {
  const mapping = {
    timestamp:    -1,
    company:      -1,
    nps:          -1,
    satisfaction: -1,
    genre:        -1,
    reason:       -1,
    improvement:  -1,
    continuity:   -1,
    _confidence:  'low',
  };

  headers.forEach((h, i) => {
    const lower = h.toString().toLowerCase();
    Object.entries(CONFIG.surveyKeywords).forEach(([field, keywords]) => {
      if (mapping[field] === -1 && keywords.some(kw => lower.includes(kw.toLowerCase()))) {
        mapping[field] = i;
      }
    });
  });

  // 信頼度判定（タイムスタンプ + 満足度 or NPS が取れていれば high）
  const detectedCount = Object.values(mapping).filter(v => v >= 0).length;
  if (mapping.timestamp >= 0 && (mapping.nps >= 0 || mapping.satisfaction >= 0)) {
    mapping._confidence = detectedCount >= 4 ? 'high' : 'medium';
  }

  return mapping;
}

// ============================================================
// 統一行データの構築
// ============================================================
/**
 * フォームの生データを統一フォーマットに変換する。
 * 統一行の列構成:
 *   [0] タイムスタンプ
 *   [1] 元ファイル名（どのフォームか）
 *   [2] 会社名
 *   [3] 商品ジャンル
 *   [4] NPSスコア
 *   [5] 満足度
 *   [6] 選んだ理由（自由記述）
 *   [7] 改善してほしい点（自由記述）
 *   [8] 継続意向
 *   [9] 全回答（JSON形式で原文保存）
 *   [10] AI分析タグ（空欄 → Claude分析スキルで入力）
 *   [11] 主要キーフレーズ（空欄）
 *   [12] 感情スコア（空欄）
 */
function buildUnifiedRow(row, mapping, headers, sourceFileName) {
  const get = (field) => mapping[field] >= 0 ? row[mapping[field]] : '';

  // 全回答をJSON形式で保存（原文保持）
  const rawJson = JSON.stringify(
    headers.reduce((obj, h, i) => { obj[h] = row[i]; return obj; }, {})
  );

  return [
    get('timestamp'),
    sourceFileName,
    get('company'),
    get('genre'),
    get('nps'),
    get('satisfaction'),
    get('reason'),
    get('improvement'),
    get('continuity'),
    rawJson,
    '', // AI分析タグ（Claude分析スキルで入力）
    '', // 主要キーフレーズ
    '', // 感情スコア
  ];
}

// ============================================================
// 商品カテゴリ別シートを取得または作成
// ============================================================
function getOrCreateCategorySheet(ss, category) {
  const sheetName = `📋 ${category}`;
  let sheet = ss.getSheetByName(sheetName);
  if (sheet) return sheet;

  // 新規作成
  sheet = ss.insertSheet(sheetName);
  sheet.setTabColor('#7b1fa2');

  const headers = [
    'タイムスタンプ', '元ファイル名', '会社名', '商品ジャンル',
    'NPSスコア（0-10）', '満足度（1-5）',
    '選んだ理由（自由記述）', '改善してほしい点（自由記述）', '継続意向',
    '全回答JSON（原文）',
    '── AI分析 ──', 'AI分析タグ', '主要キーフレーズ', '感情スコア'
  ];

  sheet.getRange(1, 1, 1, headers.length)
    .setValues([headers]).setBackground('#7b1fa2').setFontColor('#ffffff')
    .setFontWeight('bold').setVerticalAlignment('middle');
  sheet.setFrozenRows(1);
  sheet.setRowHeight(1, 30);

  [140,180,150,130,130,110,300,300,110,200,110,160,220,110]
    .forEach((w,i) => sheet.setColumnWidth(i+1,w));

  sheet.getRange('A2:A1000').setNumberFormat('yyyy/mm/dd HH:mm');
  sheet.getRange('K1:N1').setBackground('#4a148c');

  // NPS色分け
  addConditionalFormat(sheet,'E2:E1000','gte',9,   '#e8f5e9','#1b5e20');
  addConditionalFormat(sheet,'E2:E1000','between',[7,8],'#fff8e1',null);
  addConditionalFormat(sheet,'E2:E1000','lt', 7,   '#fce8e6','#c62828');

  // 全回答JSONの列は折りたたみやすいよう薄いグレーに
  sheet.getRange('J1:J1000').setBackground('#f5f5f5').setFontColor('#999999');

  return sheet;
}

// ============================================================
// アンケートサマリーの更新
// ============================================================
function updateSurveySummary(ss) {
  const summarySheet = ss.getSheetByName('アンケートサマリー');
  const hubSheet     = ss.getSheetByName('アンケートハブ');

  // カテゴリ一覧をハブから取得
  const hubData = hubSheet.getRange(4, 1, Math.max(hubSheet.getLastRow() - 3, 1), 3).getValues();
  const categories = [...new Set(hubData.map(r => r[2]).filter(c => c))];

  // サマリーの既存データを消去（4行目ヘッダーより下）
  if (summarySheet.getLastRow() > 4) {
    summarySheet.getRange(5, 1, summarySheet.getLastRow() - 4, 9).clearContent();
  }

  categories.forEach((cat, i) => {
    const catSheet = ss.getSheetByName(`📋 ${cat}`);
    if (!catSheet || catSheet.getLastRow() < 2) return;

    const data = catSheet.getRange(2, 1, catSheet.getLastRow() - 1, 14).getValues();
    const npsValues  = data.map(r => parseFloat(r[4])).filter(v => !isNaN(v) && v !== '');
    const satValues  = data.map(r => parseFloat(r[5])).filter(v => !isNaN(v) && v !== '');

    const count  = data.length;
    const avgNps = npsValues.length > 0 ? npsValues.reduce((a,b) => a+b, 0) / npsValues.length : '';
    const avgSat = satValues.length  > 0 ? satValues.reduce((a,b)  => a+b, 0) / satValues.length  : '';

    const promoters  = npsValues.filter(v => v >= 9).length;
    const passives   = npsValues.filter(v => v >= 7 && v < 9).length;
    const detractors = npsValues.filter(v => v < 7).length;
    const nTotal     = npsValues.length || 1;

    const row = summarySheet.getRange(5 + i, 1, 1, 9);
    row.setValues([[
      cat, count, avgNps,
      promoters / nTotal,
      passives  / nTotal,
      detractors/ nTotal,
      avgSat,
      '← Claude分析スキルで自動入力', '← Claude分析スキルで自動入力'
    ]]);

    // 偶数行に薄い背景
    if (i % 2 === 1) summarySheet.getRange(5+i, 1, 1, 9).setBackground('#f3e5f5');
  });

  summarySheet.getRange('G1').setFormula('="更新: "&TEXT(NOW(),"yyyy/mm/dd HH:mm")');
}

// ============================================================
// Sheet 7: KPIダッシュボード
// ============================================================
function setupKPIDashboard(ss) {
  const sheet = ss.getSheetByName('KPIダッシュボード');
  sheet.clearContents();
  sheet.clearFormats();

  sheet.getRange('A1:G1').merge();
  sheet.getRange('A1')
    .setValue('📊 CreativeGroup グロースハック KPIダッシュボード')
    .setFontSize(15).setFontWeight('bold')
    .setBackground('#263238').setFontColor('#ffffff')
    .setVerticalAlignment('middle').setHorizontalAlignment('center');
  sheet.setRowHeight(1, 44);

  sheet.getRange('H1:I1').merge();
  sheet.getRange('H1').setFormula('="更新: "&TEXT(NOW(),"yyyy/mm/dd HH:mm")')
    .setFontColor('#888888').setHorizontalAlignment('right').setVerticalAlignment('middle');

  const writeSection = (row, emoji, title, color) => {
    sheet.getRange(row, 1, 1, 9).merge();
    sheet.getRange(row, 1).setValue(`${emoji}  ${title}`)
      .setBackground(color).setFontColor('#ffffff')
      .setFontWeight('bold').setFontSize(12).setVerticalAlignment('middle');
    sheet.setRowHeight(row, 30);
  };

  const writeKPI = (row, label, formulaOrVal, fmt, note) => {
    sheet.getRange(row, 1, 1, 5).merge();
    sheet.getRange(row, 1).setValue(label).setVerticalAlignment('middle');
    const cell = sheet.getRange(row, 6, 1, 2);
    cell.merge();
    if (typeof formulaOrVal === 'string' && formulaOrVal.startsWith('='))
      cell.setFormula(formulaOrVal);
    else
      cell.setValue(formulaOrVal);
    if (fmt) cell.setNumberFormat(fmt);
    if (note) cell.setNote(note);
    cell.setFontWeight('bold').setHorizontalAlignment('right').setFontSize(13);
    sheet.setRowHeight(row, 26);
    if (row % 2 === 0) sheet.getRange(row, 1, 1, 9).setBackground('#f5f5f5');
  };

  let r = 3;

  writeSection(r++, '💰', 'Revenue（収益）', '#6a1b9a');
  writeKPI(r++,'今月の売上合計',
    '=SUMIFS(受注マスタ!F:F,受注マスタ!D:D,">="&DATE(YEAR(TODAY()),MONTH(TODAY()),1),受注マスタ!D:D,"<="&EOMONTH(TODAY(),0))',
    '#,##0');
  writeKPI(r++,'今月の粗利合計',
    '=SUMIFS(受注マスタ!H:H,受注マスタ!D:D,">="&DATE(YEAR(TODAY()),MONTH(TODAY()),1),受注マスタ!D:D,"<="&EOMONTH(TODAY(),0))',
    '#,##0');
  writeKPI(r++,'今月の平均粗利率', `=IFERROR(F${r-1}/F${r-2},"")`, '0.0%');
  writeKPI(r++,'平均契約単価（累計）',
    '=IFERROR(AVERAGEIF(受注マスタ!F:F,">"&0),"")', '#,##0');
  writeKPI(r++,'累計売上', '=SUM(受注マスタ!F:F)', '#,##0');
  r++;

  writeSection(r++, '🎯', 'Acquisition（獲得）', '#1565c0');
  writeKPI(r++,'今月の新規商談数',
    '=COUNTIFS(商談マスタ!D:D,">="&DATE(YEAR(TODAY()),MONTH(TODAY()),1),商談マスタ!D:D,"<="&EOMONTH(TODAY(),0))', '0');
  writeKPI(r++,'今月の受注数',
    '=COUNTIFS(商談マスタ!E:E,"受注",商談マスタ!I:I,">="&DATE(YEAR(TODAY()),MONTH(TODAY()),1))', '0');
  writeKPI(r++,'受注率（今月）', `=IFERROR(F${r-1}/F${r-2},"")`, '0.0%');
  writeKPI(r++,'今月の広告費合計',
    '=SUMIFS(広告マスタ!E:E,広告マスタ!A:A,">="&DATE(YEAR(TODAY()),MONTH(TODAY()),1))', '#,##0');
  r++;

  writeSection(r++, '🔄', 'Retention（継続）', '#e65100');
  writeKPI(r++,'アクティブクライアント数', '=COUNTIF(顧客マスタ!H:H,"アクティブ")', '0');
  writeKPI(r++,'休眠クライアント数',       '=COUNTIF(顧客マスタ!H:H,"休眠")',       '0');
  writeKPI(r++,'解約クライアント数',       '=COUNTIF(顧客マスタ!H:H,"解約")',       '0');
  writeKPI(r++,'継続率',
    '=IFERROR(COUNTIF(顧客マスタ!H:H,"アクティブ")/COUNTA(顧客マスタ!A2:A),"")', '0.0%');
  r++;

  writeSection(r++, '🌱', 'Referral（紹介）', '#2e7d32');
  writeKPI(r++,'紹介経由の受注数（累計）', '=COUNTIF(受注マスタ!J:J,"紹介")', '0');
  writeKPI(r++,'紹介経由の売上合計',       '=SUMIF(受注マスタ!J:J,"紹介",受注マスタ!F:F)', '#,##0');
  writeKPI(r++,'紹介比率（件数）',
    `=IFERROR(F${r-2}/COUNTIF(受注マスタ!J:J,"<>"),"")`, '0.0%');
  r++;

  writeSection(r++, '📋', 'アンケート / 顧客インサイト', '#ad1457');
  writeKPI(r++,'全商品アンケート回答数（累計）',
    '=MAX(0,COUNTA(アンケートサマリー!B5:B100)-COUNTIF(アンケートサマリー!B5:B100,""))',
    '0', 'アンケートサマリーの回答数合計');
  writeKPI(r++,'アンケート登録商品カテゴリ数',
    '=COUNTA(アンケートサマリー!A5:A100)', '0');
  r++;

  writeSection(r++, '📈', '営業パイプライン（現在）', '#37474f');
  writeKPI(r++,'進行中の商談数',
    '=COUNTIFS(商談マスタ!E:E,"<>受注",商談マスタ!E:E,"<>失注",商談マスタ!E:E,"<>")', '0');
  writeKPI(r++,'パイプライン合計見込み額',
    '=SUMIFS(商談マスタ!F:F,商談マスタ!E:E,"<>受注",商談マスタ!E:E,"<>失注")', '#,##0');
  writeKPI(r++,'期限切れアクション数',
    '=COUNTIFS(商談マスタ!P:P,"<="&TODAY(),商談マスタ!P:P,"<>",商談マスタ!E:E,"<>受注",商談マスタ!E:E,"<>失注")',
    '0', '今日以前に期限が設定されている未フォロー商談');

  sheet.setColumnWidth(1, 30);
  [2,3,4,5].forEach(c => sheet.setColumnWidth(c, 40));
  sheet.setColumnWidth(6, 140);
  sheet.setColumnWidth(7, 80);
  sheet.setColumnWidth(8, 60);
  sheet.setColumnWidth(9, 60);
  sheet.setFrozenRows(1);
}
