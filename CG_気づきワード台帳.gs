/**
 * Creative Group — 気づきワード台帳 自動生成
 *
 * 「気づきワードサイクル」のデータ連携の背骨。word_id で全モジュールを串刺しする。
 * 中心＝気づきワード台帳。各モジュールはシグナルシートに word_id 単位で追記。
 * 訴求スコアの計算ロジックは lib/kizuki/score.js が単一の正（Phase2でコックピットが自動反映）。
 * 仕様: docs/superpowers/specs/2026-06-30-kizuki-word-cycle-design.md
 *
 * 【使い方】
 * 1. スプレッドシート →「拡張機能」→「Apps Script」にこのコードを貼付
 * 2. buildKizukiLedger を実行（新規・サンプル入り）／ addKizukiLedger（不足シートのみ追加）
 */

const KZ_SHEETS = ['気づきワード台帳', '勉強会シグナル', 'モニターシグナル', '広告シグナル', 'コラボ実績', '記入ガイド'];

function buildKizukiLedger() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const tmp = ss.insertSheet('__tmp__');
  KZ_SHEETS.forEach((n) => { const s = ss.getSheetByName(n); if (s) ss.deleteSheet(s); });
  _kzLedger(ss);
  _kzWorkshop(ss);
  _kzReview(ss);
  _kzAd(ss);
  _kzCollab(ss);
  _kzGuide(ss);
  ss.deleteSheet(tmp);
  ss.setActiveSheet(ss.getSheetByName('気づきワード台帳'));
  SpreadsheetApp.getUi().alert('✅ 気づきワード台帳を作成しました。サンプル（87点◎/64点○/28点×相当）入りです。');
}

function addKizukiLedger() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const added = [];
  const map = { '気づきワード台帳': _kzLedger, '勉強会シグナル': _kzWorkshop, 'モニターシグナル': _kzReview, '広告シグナル': _kzAd, 'コラボ実績': _kzCollab, '記入ガイド': _kzGuide };
  Object.keys(map).forEach((n) => { if (!ss.getSheetByName(n)) { map[n](ss); added.push(n); } });
  SpreadsheetApp.getUi().alert(added.length ? `✅ 追加: ${added.join('、')}` : 'すでに存在します。');
}

// 共通：シート骨格を作る（タイトル帯＋ヘッダー＋データ＋ゼブラ＋固定）
function _kzSheet(ss, idx, name, headerColor, cols, rows) {
  const C = { dark: '#1E2D40', white: '#FFFFFF', zebra: '#F4F6F7' };
  const sh = ss.insertSheet(name, idx);
  const need = cols.length;
  if (sh.getMaxColumns() < need) sh.insertColumnsAfter(sh.getMaxColumns(), need - sh.getMaxColumns());
  cols.forEach((c, i) => sh.setColumnWidth(i + 1, c[1]));
  sh.setRowHeight(2, 34); sh.setRowHeight(3, 38);
  sh.getRange(2, 1, 1, need).merge().setValue('Creative Group — ' + name)
    .setBackground(C.dark).setFontColor(C.white).setFontSize(13).setFontWeight('bold')
    .setHorizontalAlignment('center').setVerticalAlignment('middle');
  sh.getRange(3, 1, 1, need).setValues([cols.map((c) => c[0])])
    .setBackground(headerColor).setFontColor(C.white).setFontSize(8).setFontWeight('bold')
    .setHorizontalAlignment('center').setVerticalAlignment('middle').setWrap(true);
  const DR = 4;
  if (rows && rows.length) {
    sh.getRange(DR, 1, rows.length, need).setValues(rows).setFontSize(9).setVerticalAlignment('middle').setWrap(true);
    for (let r = DR; r < DR + rows.length; r += 2) sh.getRange(r, 1, 1, need).setBackground(C.zebra);
  }
  const emptyStart = rows ? DR + rows.length : DR;
  for (let r = emptyStart; r < emptyStart + 20; r++) {
    if (r % 2 === 0) sh.getRange(r, 1, 1, need).setBackground(C.zebra);
  }
  sh.setFrozenRows(3);
  sh.setFrozenColumns(1);
  return sh;
}

const KZ_DV = (list) => SpreadsheetApp.newDataValidation().requireValueInList(list, true).setAllowInvalid(true).build();

// 中心テーブル：気づきワード台帳
function _kzLedger(ss) {
  const cols = [
    ['案件ID', 140], ['商品ID', 90], ['word_id', 120], ['ワード本文', 240], ['訴求軸タグ', 110],
    ['起点', 90], ['status', 110], ['確度ステージ', 100], ['訴求スコア', 90], ['判定', 60], ['メモ', 220], ['最終更新', 90],
  ];
  const rows = [
    ['2026-06-AVENE', 'AV01', 'w001', '乾燥でゆらいだ日の駆け込み', '使用シーン', '勉強会', '勝ち', '広告確定', 87, '◎', '広告CTR2.1%・30代敏感肌が明確', '2026/06/30'],
    ['2026-06-AVENE', 'AV01', 'w002', '無香料だから夜も気にならない', '情緒', 'レビュー', '広告検証', 'レビュー反映', 64, '○', '候補抽出中', '2026/06/30'],
    ['2026-06-AVENE', 'AV01', 'w003', 'パケが可愛い', '情緒', '勉強会', '見送り', '広告確定', 28, '×', '言及最多だがCVR低・虚栄控除', '2026/06/30'],
  ];
  const sh = _kzSheet(ss, 0, '気づきワード台帳', '#4F46E5', cols, rows);
  sh.getRange(4, 5, 60, 1).setDataValidation(KZ_DV(['効能', '情緒', '使用シーン', '成分', '価格']));
  sh.getRange(4, 6, 60, 1).setDataValidation(KZ_DV(['勉強会', 'レビュー', 'コメント']));
  sh.getRange(4, 7, 60, 1).setDataValidation(KZ_DV(['候補', 'モニター', '広告検証', '勝ち', '見送り']));
  sh.getRange(4, 8, 60, 1).setDataValidation(KZ_DV(['暫定', 'レビュー反映', '広告確定']));
  sh.getRange(4, 10, 60, 1).setDataValidation(KZ_DV(['◎', '○', '△', '×']));
  sh.getRange(3, 9).setNote('lib/kizuki/score.js の computeAppealScore で算出（100点満点＋虚栄控除）。Phase1は手入力/サンプル。Phase2でコックピットが自動反映。');
  sh.getRange(3, 3).setNote('word_id が全シグナルシートを串刺しする連携キー。');
}

// ①勉強会シグナル
function _kzWorkshop(ss) {
  const cols = [['word_id', 120], ['参加者ID(匿名)', 110], ['発言抜粋', 300], ['言及数', 70], ['アンケ評価', 90], ['ブランド未認知', 100]];
  const rows = [
    ['w001', 'U-03', '化粧水なのに、肌が荒れた時に一番に手が伸びる', 8, 4.6, 'TRUE'],
    ['w003', 'U-07', 'まずパッケージが可愛くてテンション上がる', 11, 4.1, 'FALSE'],
  ];
  const sh = _kzSheet(ss, 1, '勉強会シグナル', '#0369A1', cols, rows);
  sh.getRange(4, 6, 60, 1).setDataValidation(KZ_DV(['TRUE', 'FALSE']));
}

// ②モニターシグナル（Pamun）
function _kzReview(ss) {
  const cols = [['word_id', 120], ['レビュー件数', 90], ['購買意向共感率', 110], ['代表クリエイティブURL', 220], ['2次利用可否', 90]];
  const rows = [
    ['w001', 24, '62%', 'https://pamun.example/r/001', 'TRUE'],
    ['w003', 30, '12%', 'https://pamun.example/r/003', 'TRUE'],
  ];
  const sh = _kzSheet(ss, 2, 'モニターシグナル', '#0D9488', cols, rows);
  sh.getRange(4, 3, 60, 1).setNumberFormat('0%');
  sh.getRange(4, 5, 60, 1).setDataValidation(KZ_DV(['TRUE', 'FALSE']));
  sh.getRange(3, 3).setNote('「買いたい/使ってみたい」系の反応 ÷ 総反応。可愛い等の虚栄反応は除外。');
}

// ③広告シグナル
function _kzAd(ss) {
  const cols = [['word_id', 120], ['creative_id', 110], ['CTR%', 70], ['CVR%', 70], ['ROAS', 70], ['勝ちデモグラ', 160], ['デモグラ明確度', 100], ['配信額', 100]];
  const rows = [
    ['w001', 'cr-001a', '2.1%', '1.8%', '2.3', '30代/女性/敏感肌', '0.9', 200000],
    ['w003', 'cr-003a', '0.6%', '0.3%', '0.5', '—', '0.2', 120000],
  ];
  const sh = _kzSheet(ss, 3, '広告シグナル', '#EA580C', cols, rows);
  sh.getRange(4, 3, 60, 1).setNumberFormat('0.0%');
  sh.getRange(4, 4, 60, 1).setNumberFormat('0.0%');
  sh.getRange(4, 8, 60, 1).setNumberFormat('#,##0');
  sh.getRange(3, 7).setNote('刺さる層が立っているか 0..1。後工程のインフル選定精度に直結。');
}

// ④コラボ実績
function _kzCollab(ss) {
  const cols = [['word_id', 120], ['influencer_id', 130], ['適合スコア', 90], ['実売数', 80], ['ROAS', 70]];
  const rows = [['w001', 'inf-SACHI', 87, 320, '2.3']];
  const sh = _kzSheet(ss, 4, 'コラボ実績', '#7C3AED', cols, rows);
  sh.getRange(4, 4, 60, 1).setNumberFormat('#,##0');
  sh.getRange(3, 2).setNote('提案ログDB／実績タブの influencer_id と一致させる。');
}

// 記入ガイド
function _kzGuide(ss) {
  const C = { dark: '#1E2D40', blue: '#2E6DA4', white: '#FFFFFF' };
  const sh = ss.insertSheet('記入ガイド', 5);
  sh.setColumnWidth(1, 20); sh.setColumnWidth(2, 720);
  sh.setRowHeight(2, 40);
  sh.getRange(2, 2).setValue('📋 気づきワード台帳 記入ガイド').setBackground(C.dark).setFontColor(C.white)
    .setFontSize(13).setFontWeight('bold').setVerticalAlignment('middle');
  const secs = [
    ['【このシートの目的】',
      '勉強会・Pamun・広告・インフルの4モジュールを word_id で串刺しし、訴求ワードを実データでスコア化する連携の背骨。\n' +
      'モジュール単体販売でも各シグナルは独立して追記できる。通すほど同じワードに証拠が積み増しされる。'],
    ['【記入のタイミング】',
      '① 勉強会後：気づきワード台帳に word_id を発番し、勉強会シグナルへ言及を記入（確度=暫定）\n' +
      '② Pamunモニター後：モニターシグナルに購買意向共感率を記入（確度=レビュー反映）\n' +
      '③ 広告運用後：広告シグナルにCTR/CVR/ROAS・勝ちデモグラを記入（確度=広告確定）\n' +
      '④ コラボ後：コラボ実績に適合・実売・ROASを記入'],
    ['【訴求スコアの考え方】',
      '実データ（広告CTR/CVR）を最重視。言及が多くても購買につながらなければ低い（虚栄控除）。\n' +
      '配点：勉強会15／Pamun25／広告40／デモグラ明確度10／インフル10／虚栄控除-20〜0。\n' +
      '計算は lib/kizuki/score.js が単一の正。Phase1は手入力、Phase2でコックピットが自動反映。'],
    ['【既存DBとの接続】',
      '案件ID で案件DB、word_id×influencer_id で提案ログDB／実績タブに接続。\n' +
      '勝ち訴求・勝ちデモグラはモジュールCで診断ツールの M01／M02／M04 の入力に流す。'],
  ];
  let r = 4;
  secs.forEach(([t, b]) => {
    sh.setRowHeight(r, 26);
    sh.getRange(r, 2).setValue(t).setBackground(C.blue).setFontColor(C.white).setFontSize(10).setFontWeight('bold').setVerticalAlignment('middle');
    r++;
    sh.setRowHeight(r, b.split('\n').length * 19 + 12);
    sh.getRange(r, 2).setValue(b).setFontSize(9).setWrap(true).setVerticalAlignment('top').setBackground('#F8F9FA');
    r += 2;
  });
}
