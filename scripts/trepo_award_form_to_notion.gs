/**
 * Trepoトレンド大賞2026 — エントリーフォーム回答 → Notion候補プールDB 自動連携
 *
 * フォーム送信時に onFormSubmit トリガーで発火し、回答を候補プールDBに
 * 「流入経路=インバウンド」「段階=0次」で1レコード自動作成する。
 *
 * 【セットアップ】
 *  1. trepo_award_form.gs でフォームを作った Apps Script プロジェクトに本ファイルを追加
 *     （別プロジェクトでも可。その場合フォームIDで紐づく）
 *  2. プロジェクトの設定 → スクリプト プロパティ に以下を登録（コードに直書きしない）:
 *       NOTION_TOKEN   … NotionインテグレーションのAPIトークン
 *       NOTION_DB_ID   … 候補プールDBのID（3832a9c9-20f7-81ad-a21e-fee38dfd4b8c）※Trepo編集部配下
 *       FORM_ID        … 対象フォームのID（フォーム編集URLの /d/ と /edit の間）
 *  3. 関数 setupTrigger を1回実行（初回は権限承認）。これで自動連携が有効化される。
 *  4. テスト送信して、候補プールDBに行が増えることを確認。
 *
 * 注意: Notionの select 値（カテゴリ等）はフォーム選択肢とDBオプションを一致させてある。
 */

function _props() {
  var p = PropertiesService.getScriptProperties();
  return {
    token: p.getProperty('NOTION_TOKEN'),
    db: p.getProperty('NOTION_DB_ID'),
    formId: p.getProperty('FORM_ID'),
  };
}

/** onFormSubmit トリガーを設置（1回だけ実行） */
function setupTrigger() {
  var cfg = _props();
  if (!cfg.formId) throw new Error('スクリプト プロパティ FORM_ID が未設定です。');
  // 既存の同名トリガーを除去（重複防止）
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'onTrepoFormSubmit') ScriptApp.deleteTrigger(t);
  });
  var form = FormApp.openById(cfg.formId);
  ScriptApp.newTrigger('onTrepoFormSubmit').forForm(form).onFormSubmit().create();
  Logger.log('✅ onFormSubmit トリガーを設置しました。');
}

/** フォーム送信ハンドラ */
function onTrepoFormSubmit(e) {
  var cfg = _props();
  if (!cfg.token || !cfg.db) throw new Error('NOTION_TOKEN / NOTION_DB_ID が未設定です。');

  // 回答を {設問タイトル: 回答} に変換
  var a = {};
  e.response.getItemResponses().forEach(function (ir) {
    a[ir.getItem().getTitle()] = ir.getResponse();
  });

  // ---- 値の整形 ----
  var company = a['会社名'] || '';
  var client = a['クライアント様名（※正規販売店様・PR会社様はご記入ください）'] || '';
  if (client) company += '（クライアント: ' + client + '）';

  var contact = [
    a['部署名'] ? '部署: ' + a['部署名'] : '',
    a['担当者名'] ? '担当: ' + a['担当者名'] : '',
    a['メールアドレス'] || '',
    a['電話番号'] || '',
  ].filter(String).join(' / ');

  var condRaw = (a['該当するエントリー条件'] || '');
  var cond = condRaw.charAt(0) === 'a' ? 'a 上半期'
           : condRaw.charAt(0) === 'b' ? 'b 下半期' : null;

  var reactions = a['実績・反響（当てはまるものをすべて選択）'];
  if (Array.isArray(reactions)) reactions = reactions.join('、');

  var selfReport = [
    a['発売日／開始日'] ? '発売日: ' + a['発売日／開始日'] : '',
    a['ターゲット層'] ? 'ターゲット: ' + a['ターゲット層'] : '',
    reactions ? '実績反響: ' + reactions : '',
    a['実績詳細記入欄'] ? '実績詳細: ' + a['実績詳細記入欄'] : '',
    a['画像添付または画像DLリンク'] ? '画像: ' + a['画像添付または画像DLリンク'] : '',
    a['サンプル提供可否'] ? 'サンプル: ' + a['サンプル提供可否'] : '',
    a['コーポレートサイトURL'] ? 'コーポレートサイト: ' + a['コーポレートサイトURL'] : '',
  ].filter(String).join('\n');

  // ---- Notion プロパティ組み立て ----
  function rt(s) { return { rich_text: [{ text: { content: String(s).slice(0, 1990) } }] }; }
  function sel(name) { return { select: { name: name } }; }

  var props = {
    '対象名': { title: [{ text: { content: a['エントリー対象名'] || '(無題エントリー)' } }] },
    '流入経路': sel('インバウンド'),
    '段階': sel('0次'),
  };
  if (a['カテゴリ']) props['カテゴリ'] = sel(a['カテゴリ']);
  if (cond) props['エントリー条件'] = sel(cond);
  if (company) props['企業名'] = rt(company);
  if (contact) props['担当者・連絡先'] = rt(contact);
  if (a['価格']) props['価格'] = rt(a['価格']);
  if (a['商品・サービス概要']) props['概要'] = rt(a['商品・サービス概要']);
  if (a['2026年らしいトレンドポイント']) props['トレンドポイント'] = rt(a['2026年らしいトレンドポイント']);
  if (selfReport) props['応募詳細(自己申告)'] = rt(selfReport);

  var url = a['商品URLまたはサービスURL'] || '';
  if (/^https?:\/\//.test(url)) props['商品/サービスURL'] = { url: url };

  // ---- Notion API ----
  var res = UrlFetchApp.fetch('https://api.notion.com/v1/pages', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'Authorization': 'Bearer ' + cfg.token, 'Notion-Version': '2022-06-28' },
    payload: JSON.stringify({ parent: { database_id: cfg.db }, properties: props }),
    muteHttpExceptions: true,
  });
  var code = res.getResponseCode();
  if (code >= 300) {
    Logger.log('❌ Notion登録失敗 ' + code + ': ' + res.getContentText());
    throw new Error('Notion登録失敗 ' + code);
  }
  Logger.log('✅ Notion登録: ' + (a['エントリー対象名'] || ''));
}
