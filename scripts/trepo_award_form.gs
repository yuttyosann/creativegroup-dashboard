/**
 * Trepoトレンド大賞2026 エントリーフォーム自動生成スクリプト
 *
 * 使い方:
 *  1. https://script.google.com/ で新規プロジェクトを作成
 *  2. このファイルの内容を全て貼り付け
 *  3. 関数 createTrepoAwardForm を実行（初回は権限承認が必要）
 *  4. 実行ログに出力されるフォームの編集URL/公開URLを開く
 *
 * 仕様出典: docs/superpowers/specs/trepo-award-form-spec.md
 */
function createTrepoAwardForm() {
  var form = FormApp.create('Trepoトレンド大賞2026 エントリーフォーム');

  form.setDescription(
    [
      'トレンドお届けメディアTrepoが主催する「Trepoトレンド大賞2026」のエントリーフォームです。',
      '',
      '■エントリー費用：無料',
      '■エントリー締切：2026年7月15日（水）23:59',
      '■エントリー上限：1社につき3件まで（正規販売店・PR代理店は除く）',
      '　・1対象につき1フォームでご記入ください（複数エントリーは対象ごとに）',
      '　・部門は1対象につき2部門までお選びいただけます',
      '■予選あり。以下は予選通過対象外となる場合があります：',
      '　医薬品／医療行為を伴うもの／サロン・クリニック専売品／体験のみで完結するサービス／',
      '　掲載が難しい表現を含むもの／読者層との親和性が著しく低いもの／極端に高額なもの'
    ].join('\n')
  );
  form.setCollectEmail(false);
  form.setProgressBar(true);

  // ===== セクション1：企業情報 =====
  form.addSectionHeaderItem().setTitle('1. 企業情報');

  form.addTextItem().setTitle('会社名').setRequired(true);
  form.addTextItem().setTitle('クライアント様名（※正規販売店様・PR会社様はご記入ください）').setRequired(false);
  form.addTextItem().setTitle('部署名').setRequired(true);
  form.addTextItem().setTitle('担当者名').setRequired(true);

  var email = form.addTextItem().setTitle('メールアドレス').setRequired(true);
  var emailValidation = FormApp.createTextValidation()
    .setHelpText('正しいメールアドレスを入力してください')
    .requireTextIsEmail()
    .build();
  email.setValidation(emailValidation);

  form.addTextItem().setTitle('電話番号').setRequired(true);
  form.addTextItem().setTitle('コーポレートサイトURL').setRequired(true);

  // ===== セクション2：エントリー情報 =====
  form.addSectionHeaderItem().setTitle('2. エントリー情報');

  form.addTextItem().setTitle('エントリー対象名').setRequired(true);

  form.addMultipleChoiceItem()
    .setTitle('該当するエントリー条件')
    .setHelpText('「来年以降に売っていきたい」等の未来予測のみの対象は対象外です')
    .setChoiceValues([
      'a. 2026年上半期に売れた・話題になった商品・サービス・スポット・コンテンツである',
      'b. 2026年下半期に売れている・話題になっている商品・サービス・スポット・コンテンツである'
    ])
    .setRequired(true);

  form.addListItem()
    .setTitle('カテゴリ')
    .setChoiceValues([
      'コスメ', 'スキンケア', 'ヘアケア', 'ボディケア', 'フレグランス',
      '食品・飲料', 'ライフスタイル雑貨', 'ファッション',
      'おでかけ・スポット', 'エンタメ・コンテンツ', 'その他'
    ])
    .setRequired(true);

  form.addDateItem().setTitle('発売日／開始日').setRequired(true);
  form.addTextItem().setTitle('商品URLまたはサービスURL').setRequired(true);
  form.addTextItem().setTitle('価格').setRequired(true);
  form.addParagraphTextItem().setTitle('商品・サービス概要').setRequired(true);
  form.addTextItem().setTitle('ターゲット層').setRequired(true);
  form.addParagraphTextItem().setTitle('2026年らしいトレンドポイント').setRequired(true);

  form.addCheckboxItem()
    .setTitle('実績・反響（当てはまるものをすべて選択）')
    .setChoiceValues([
      'SNSで話題', '売上好調', 'メディア掲載あり', '店頭反響あり', 'インフルエンサー反響あり', 'その他'
    ])
    .setRequired(true);

  form.addParagraphTextItem()
    .setTitle('実績詳細記入欄')
    .setHelpText('実績を裏付ける具体的な根拠（SNSの反響数・売上やランキング・掲載メディアのURL等）を、できるだけ数値やリンクでご記入ください。選定の参考にいたします。')
    .setRequired(true);

  form.addTextItem()
    .setTitle('画像添付または画像DLリンク')
    .setHelpText('画像のダウンロードリンク（Googleドライブ等の共有URL）をご記入ください')
    .setRequired(true);

  form.addMultipleChoiceItem()
    .setTitle('サンプル提供可否')
    .setChoiceValues(['可能', '不可', '要相談'])
    .setRequired(true);

  form.addCheckboxItem()
    .setTitle('個人情報取扱への同意')
    .setChoiceValues(['同意する'])
    .setRequired(true);

  Logger.log('編集URL: ' + form.getEditUrl());
  Logger.log('公開URL: ' + form.getPublishedUrl());
}
