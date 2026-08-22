'use strict';
/**
 * 勉強会運用ハンドブックの Word 版を生成する。
 * 内容の正は docs/deploy/workshop-ingest-runbook.md。ここはその配布用の写し。
 *
 * 使い方: cd tools/handbook && npm i docx && node build-docx.js
 * 出力: tools/handbook/気づきワード採取ハンドブック.docx
 */
const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, ShadingType, BorderStyle, LevelFormat,
} = require('docx');

const INK = '17211F', MUTED = '5C6B66', ACCENT = '1F6F5C', WARN = '9C4F26';
const RULE = 'D6DEDA', SURFACE = 'F1F4F2', ACCENT_SOFT = 'E4EFEA', WARN_SOFT = 'F6EBE3';
const SANS = 'Yu Gothic', SERIF = 'Yu Mincho', MONO = 'Consolas';
const W = 9600; // 本文幅（DXA）。表の列幅の合計はこれに揃える
const NONE = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };

const run = (text, o = {}) => new TextRun({
  text, font: o.font || SANS, size: o.size || 20, bold: !!o.bold, color: o.color || INK,
});
const p = (text, o = {}) => new Paragraph({
  children: Array.isArray(text) ? text : [run(text, o)],
  spacing: { after: o.after === undefined ? 140 : o.after, line: 300 },
});
const heading = (text, o = {}) => new Paragraph({
  heading: HeadingLevel.HEADING_2, outlineLevel: 1,
  spacing: { before: o.before === undefined ? 320 : o.before, after: 160 },
  children: [run(text, { font: SANS, size: 22, bold: true })],
});
const phase = (num, title, when) => new Paragraph({
  heading: HeadingLevel.HEADING_1, outlineLevel: 0,
  spacing: { before: 480, after: 200 },
  border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: INK, space: 6 } },
  children: [
    run(num + '  ', { font: MONO, size: 18, bold: true, color: ACCENT }),
    run(title, { font: SERIF, size: 30, bold: true }),
    run('    ' + when, { font: MONO, size: 16, color: MUTED }),
  ],
});
const listItems = (ref) => (items) => items.map((t) => new Paragraph({
  numbering: { reference: ref, level: 0 }, spacing: { after: 80, line: 300 },
  children: Array.isArray(t) ? t : [run(t)],
}));
const bullets = listItems('dot');
const ordered = listItems('num');

const framed = (leftColor) => ({
  top: { style: BorderStyle.SINGLE, size: 4, color: RULE },
  bottom: { style: BorderStyle.SINGLE, size: 4, color: RULE },
  left: { style: BorderStyle.SINGLE, size: 18, color: leftColor },
  right: { style: BorderStyle.SINGLE, size: 4, color: RULE },
  insideHorizontal: NONE, insideVertical: NONE,
});
const oneCell = (fill, borders, children) => new Table({
  columnWidths: [W], width: { size: W, type: WidthType.DXA }, borders,
  rows: [new TableRow({ children: [new TableCell({
    width: { size: W, type: WidthType.DXA },
    shading: { type: ShadingType.CLEAR, fill, color: 'auto' },
    margins: { top: 150, bottom: 150, left: 190, right: 190 },
    children,
  })] })],
});
const code = (lines) => oneCell(SURFACE, framed(ACCENT), lines.map((l) => new Paragraph({
  spacing: { after: 0, line: 260 }, children: [run(l, { font: MONO, size: 17 })],
})));
const callout = (label, paras, warn = false) => oneCell(
  warn ? WARN_SOFT : ACCENT_SOFT, framed(warn ? WARN : ACCENT),
  [
    new Paragraph({ spacing: { after: 80 }, children: [run(label, { size: 16, bold: true, color: warn ? WARN : ACCENT })] }),
    ...paras.map((t) => new Paragraph({ spacing: { after: 60, line: 300 }, children: Array.isArray(t) ? t : [run(t)] })),
  ]);

const table = (headers, rows, widths) => new Table({
  columnWidths: widths, width: { size: W, type: WidthType.DXA },
  borders: {
    top: { style: BorderStyle.SINGLE, size: 4, color: RULE },
    bottom: { style: BorderStyle.SINGLE, size: 4, color: RULE },
    left: NONE, right: NONE,
    insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: RULE }, insideVertical: NONE,
  },
  rows: [
    new TableRow({ tableHeader: true, children: headers.map((h, i) => new TableCell({
      width: { size: widths[i], type: WidthType.DXA },
      shading: { type: ShadingType.CLEAR, fill: SURFACE, color: 'auto' },
      margins: { top: 100, bottom: 100, left: 140, right: 140 },
      children: [new Paragraph({ spacing: { after: 0 }, children: [run(h, { size: 16, bold: true, color: MUTED })] })],
    })) }),
    ...rows.map((r) => new TableRow({ children: r.map((cell, i) => new TableCell({
      width: { size: widths[i], type: WidthType.DXA },
      margins: { top: 100, bottom: 100, left: 140, right: 140 },
      children: [new Paragraph({ spacing: { after: 0, line: 280 }, children: Array.isArray(cell) ? cell : [run(cell, { size: 18 })] })],
    })) })),
  ],
});
const check = (text) => new Paragraph({
  spacing: { after: 60, line: 300 },
  border: { bottom: { style: BorderStyle.SINGLE, size: 2, color: RULE, space: 4 } },
  children: [run('☐  ', { size: 22 }), run(text)],
});
const mono = (t) => run(t, { font: MONO, size: 18 });
const b = (t) => run(t, { bold: true });

const children = [
  new Paragraph({ spacing: { after: 120 }, children: [run('気づきワードサイクル / 運用ハンドブック', { font: MONO, size: 16, color: ACCENT })] }),
  new Paragraph({ spacing: { after: 200 }, children: [run('勉強会からワードを採り、台帳に載せるまで', { font: SERIF, size: 44, bold: true })] }),
  p('勉強会は気づきワードの起点です。ここで拾えなかった言葉は、以降のどの工程にも現れません。'
    + 'この手引きは、フォームの点検から台帳への登録、検証フェーズへの引き継ぎまでを時系列でまとめたものです。',
    { color: MUTED, after: 280 }),
  table(['対象', '事前アンケート', '突合キー', '登録先'], [[
    'アベンヌ勉強会 2026-08-22', '38件 回収済（2026-08-21時点）', 'メールアドレス', '気づきワード台帳／勉強会シグナル',
  ]], [2400, 2400, 2400, 2400]),

  phase('01', 'フォームを点検する', '1週間前'),
  heading('自由記述4問の見出し語を変えない', { before: 120 }),
  p([run('候補ワードの源泉はこの4問だけです。スクリプトは '), mono('【】'), run(' の中の言葉で列を見つけます。ここを変えると設問が検出できなくなります。')]),
  table(['見出し語', '役割'], [
    [[mono('【印象に残った言葉】')], [b('主源泉。'), run('抽出時に最も重視されます', { size: 18 })]],
    [[mono('【最も印象が変わった点】')], '認識の変化'],
    [[mono('【説明後に初めて理解できたこと】')], '認識の変化'],
    [[mono('【使いたい部位・場面】')], '使用シーン軸'],
  ], [4200, 5400]),
  p([run('設問文の後半（説明文）は自由に変えて構いません。固定なのは '), mono('【】'), run(' の中だけです。')], { after: 200 }),

  heading('認知度の設問は触らなくてよい（検証済み）'),
  p([run('認知度は選択式ではなく'), b('自由記述'), run('でした。判定はLLMが文章を読んで行うので、'), b('選択肢を控える作業は不要'),
    run('です。設問文に「認知」「ご存知」のいずれかが含まれていれば動きます。')]),
  p('実データ（事前アンケート38件・2026-08-21時点）で検証済みです。'),
  table(['区分', '人数', '割合'], [
    ['ブランド未認知（アベンヌ自体を知らなかった）', '4人', '11%'],
    [[b('商品未認知（CICAラインを知らなかった）')], [b('23人')], [b('61%')]],
    ['どちらか＝シグナルで使う', '23人', '61%'],
  ], [6000, 1800, 1800]),
  p([run('アベンヌ自体は有名なのでブランド未認知はごく少数です。CICAラインを知らなかった層も新規獲得の対象とみなし、'),
    b('どちらか一方でも未認知なら未認知'), run('として扱います。内訳は '), mono('candidates.json'), run(' に別々に残るので、後から定義を変えられます。')]),
  table(['回答', '判定'], [
    ['今回の応募をきっかけに知った', 'ブランド× 商品×'],
    ['化粧水は愛用。シカリップは初めて聞いた', '商品×'],
    ['シカルファットプラスを元々使用。シカリップは初めて', '両方とも認知'],
  ], [6600, 3000]),

  heading('メールアドレスの収集を有効にする'),
  p([run('事前と事後は'), b('メールアドレスで突合します'), run('。これが取れないと、誰が事前に何と答えたか分からず、未認知が全て FALSE になります。')]),
  ...bullets([
    '両フォームで「メールアドレスを収集する」が有効になっていること',
    [run('案内文に'), b('「事前・事後は同じアカウントで回答してください」'), run('と明記すること')],
  ]),

  heading('回答シートのIDを控える'),
  table(['アンケート', 'シートID'], [
    ['事後（必須）', [mono('1OJQSBLgx0J0ZVrKGi_7Q4PXojuAzJTQ6e6nb88PAmpk')]],
    ['事前（任意）', [mono('1BDRR9d_RPXNpgmWz7tBllCkPkrZSfusA4VLNUDIKay0')]],
  ], [2400, 7200]),

  phase('02', '事前アンケートを回収する', '前日まで'),
  p([run('未提出の人は「未認知」集合に入りません。つまり'), b('認知済みとして扱われます'),
    run('。未認知は言及者の過半で判定するので、未提出が多いとフラグが立ちにくくなり、勉強会由来のスコアが実際より低く出ます。')]),
  p([b('2026-08-21時点で38件回収済みです。'), run('残りの参加者からも回収を目指してください。')]),

  phase('03', 'その場で事後アンケートを回収する', '当日'),
  callout('この日の勝負どころ', [[b('自由記述がそのまま気づきワードになります。'),
    run('選択式の設問からはワードは生まれません。ここで書いてもらえなかった言葉は、以降どの工程にも現れません。')]]),
  p('', { after: 160 }),
  ...bullets([
    [b('その場で回答してもらう。'), run('後日回収に回すと回収率が落ち、材料が減ります')],
    [b('自由記述を空欄にしない。'), run('特に【印象に残った言葉】。一言でも構いません')],
    [b('事前と同じメールアドレス'), run('で回答してもらう')],
  ]),
  p('', { after: 80 }),
  callout('数えられない回答がある', [[run('自由記述4問が'), b('すべて空'),
    run('の回答は、回答者として数えられません。選択式だけ答えて自由記述を飛ばした人は、分母にも入りません。')]], true),
  p('', { after: 200 }),
  heading('回答率がそのまま指標の質になる'),
  p([run('回答者数がそのまま '), mono('n'), run(' になります。参加20人・回答18人なら n=18。「何人中何人が言った言葉か」が訴求の強さの根拠になるので、回答率は精度に直結します。')]),

  phase('04', '台帳に取り込む', '翌日'),
  heading('準備', { before: 120 }),
  code(['cd /Users/yuttyo/claude/creativegroup-dashboard', 'export SHEET_ID=1VxAOesBm_gi_jlSlq39FDtTMZNYOQcBm3J53gw3_g3o']),
  p('Google認証（ADC）がなりすまし構成でログイン済みであることが前提です。', { after: 200 }),

  heading('候補ワードを抽出する'),
  code([
    'node .worktrees/kizuki-word-cycle/scripts/kizuki/workshop_extract.js \\',
    '  --post 1OJQSBLgx0J0ZVrKGi_7Q4PXojuAzJTQ6e6nb88PAmpk \\',
    '  --pre  1BDRR9d_RPXNpgmWz7tBllCkPkrZSfusA4VLNUDIKay0 \\',
    '  > candidates.json',
  ]),
  p('', { after: 120 }),
  p([run('シートには書き込みません。実行すると次のログが出ます。'), b('ここを必ず読んでください。')]),
  code([
    '自由記述の設問: 最も印象が変わった点 / 説明後に初めて理解できたこと /',
    '              印象に残った言葉 / 使いたい部位・場面',
    '回答者: 18人',
    '事前アンケートの認知度回答: 38件',
    '  ブランド未認知: 4人 / 商品(CICA)未認知: 23人 / どちらか: 23人',
    '候補ワード: 11件',
  ]),
  p('', { after: 160 }),
  table(['ログの行', '確認すること'], [
    ['自由記述の設問', [b('4問すべて出ているか。'), run('欠けていたら設問名が変わっています', { size: 18 })]],
    ['回答者', '実際の回答数と合っているか。少なければ自由記述が空の人がいます'],
    ['認知度回答', '事前アンケートの実回答数と合っているか'],
    ['未認知の内訳', 'どちらも0人なら判定が効いていません（設問文を確認）'],
  ], [2800, 6800]),
  callout('集計行は自動で除外される', [
    'フォームの回答はA列にタイムスタンプが入るので、それで本物の回答行を切り分けています。'
    + '実データでは52行目以降に「アンケート未回答」等の管理メモが並んでおり、これを数えると実回答38件が80行になります。',
    [b('集計欄は今までどおり自由に作って構いません。')],
  ]),
  p('', { after: 200 }),

  heading('candidates.json を確認・編集する'),
  p([b('ここが人のレビューポイントです。'), run('ワードの文言はここで直します。不要なワードは削除して構いません。')]),
  code([
    '{', '  "respondents": 18,', '  "unaware": ["a@example.com", "..."],',
    '  "unawareBrand": ["..."],', '  "unawareProduct": ["..."],', '  "words": [',
    '    { "word": "肌が生き返る感じがする", "axis": "効能",', '      "quote": "肌が生き返る",',
    '      "mentionedBy": ["a@example.com", "b@example.com"] }', '  ]', '}',
  ]),
  p('', { after: 160 }),
  table(['項目', '見るポイント'], [
    [[mono('word')], '広告コピーの種になる言い回しか。要約文になっていたら直す'],
    [[mono('axis')], '効能 / 情緒 / 使用シーン / 成分 / 価格 のいずれか'],
    [[mono('quote')], [run('根拠になった実際の記述。', { size: 18 }), b('改変しない')]],
    [[mono('mentionedBy')], [run('言及数と未認知判定に使う。', { size: 18 }), b('消さない')]],
  ], [2600, 7000]),

  heading('台帳と勉強会シグナルに登録する'),
  p('まず書き込みなしで内容を確認します。'),
  code([
    'node .worktrees/kizuki-word-cycle/scripts/kizuki/workshop_seed.js candidates.json \\',
    '  --case 2026-08-AVENE-CICA --product CICA',
  ]),
  p('', { after: 120 }),
  code([
    'case=2026-08-AVENE-CICA / 候補ワード 11件 / 回答者 18人', '採番: w016 〜 w026', '',
    'word_id  言及  未認知  ワード', 'w016       9  TRUE    肌が生き返る感じがする', 'w017       5  FALSE   お守りとして持ち歩ける',
  ]),
  p('', { after: 120 }),
  p([run('問題なければ '), mono('--apply'), run(' を付けて再実行します。')]),
  callout('word_id は手で決めない', [
    [run('シグナルは '), mono('word_id'), run(' だけで突合され、案件では絞られません。別案件で同じIDを振ると'),
      b('別案件のシグナルが混ざります'), run('。既存の最大値の続きから自動で採番されるので、番号は触らないでください。')],
    '同じ案件に既にデータがあると中断します。やり直すときは台帳から該当行を消してから再実行します。',
  ], true),
  p('', { after: 200 }),
  heading('スコアに反映する'),
  code(['node .worktrees/kizuki-word-cycle/scripts/kizuki/recalc_job.js']),
  p('', { after: 120 }),
  p('BigQueryが未整備でも台帳の再計算は走ります（広告取込はスキップされ、終了コードは1になります）。'),

  phase('05', '検証フェーズへ引き継ぐ', 'その後'),
  p([run('勉強会だけでは'), b('ワード単位の購買意向は測れません'), run('。ここからは Track A の仕事です。')]),
  ...ordered([
    [run('台帳で検証したいワードの '), b('status を「モニター」に'), run('（5〜8件）')],
    [mono('tracka_questions.js --case 2026-08-AVENE-CICA'), run(' で3択設問を出す')],
    [run('出力を次のPamun事後アンケートに貼る（'), b('末尾の [wNNN] は消さない'), run('）')],
    [run('回答後に '), mono('tracka_ingest.js'), run(' で取り込む')],
  ]),
  p('設問数はワード数と同じになるので、多すぎると回答負担で離脱します。5〜8件が目安です。'),

  phase('06', 'うまくいかないとき', '随時'),
  table(['症状', '原因', '対処'], [
    ['自由記述の設問列が見つかりません', '設問名の【】内が変わった', 'フォームを戻すか判定語を追加'],
    ['設問が4問未満しか出ない', '一部の設問名が変わった', '出ていない設問を確認'],
    ['回答が0件です', '自由記述が全員空、またはシート違い', 'シートIDとタブ名を確認'],
    ['回答者数が実際より少ない', '自由記述を全て空欄で出した人がいる', '仕様どおり。必要なら手で追記'],
    ['回答数が実際より多い', '集計行が混ざっている', '通常は自動除外。A列にタイムスタンプが無いか確認'],
    ['未認知がどちらも0人', '認知度の設問が読めていない', '設問文に「認知」「ご存知」が含まれるか確認'],
    ['未認知が全てFALSE', '事前未回収、またはメール不一致', '回収状況とメールの綴りを確認'],
    ['既に N 行あります', '同じ案件で登録済み', '台帳から該当行を消して再実行'],
    ['スコアが全て0', 'シグナルが勉強会しか無い', '正常。Track A・広告が入ると上がる'],
  ], [3000, 3000, 3600]),

  phase('07', 'チェックリスト', '通し'),
  heading('1週間前', { before: 120 }),
  check('自由記述4問の【】内が変わっていない'),
  check('認知度の設問文に「認知」「ご存知」が含まれている'),
  check('両フォームでメールアドレス収集が有効'),
  check('案内文に「事前・事後を同じアカウントで」と明記した'),
  check('回答シートIDを控えた'),
  heading('前日まで'),
  check('事前アンケートを全員から回収した（8/21時点 38件）'),
  heading('当日'),
  check('その場で事後アンケートを回収した'),
  check('【印象に残った言葉】が空欄の人がいない'),
  heading('翌日'),
  check('抽出ログ（設問4問・回答者数・認知度の内訳）を確認した'),
  check('candidates.json のワード文言を確認・編集した'),
  check('書き込みなしで採番と未認知を確認した'),
  check('--apply で登録した'),
  check('スコアに反映した'),
  check('検証したいワードの status を「モニター」にした'),

  new Paragraph({
    spacing: { before: 480, after: 160 },
    border: { top: { style: BorderStyle.SINGLE, size: 4, color: RULE, space: 10 } },
    children: [run('この導線が測れないもの', { bold: true, size: 20 })],
  }),
  p('勉強会フォームの【購入意向】【推奨意向】は商品全体に対する1問で、ワード単位ではありません。'
    + 'したがってワードごとの購買意向共感率は、このフォームからは出ません。それは Track A の担当です。', { color: MUTED }),
  p([run('勉強会が担うのは、候補ワードの発掘と ', { color: MUTED }), b('言及数'), run('・', { color: MUTED }),
    b('ブランド未認知'), run(' の2つのシグナルです（スコアエンジンが勉強会シグナルから使うのはこの2つだけ）。', { color: MUTED })]),
];

const numLevel = (format, text) => ({
  level: 0, format, text, alignment: AlignmentType.LEFT,
  style: { paragraph: { indent: { left: 420, hanging: 240 } } },
});

const doc = new Document({
  creator: 'Creative Group',
  title: '気づきワード採取ハンドブック',
  description: '勉強会から気づきワードを採り、台帳に載せるまでの運用手引き',
  numbering: { config: [
    { reference: 'dot', levels: [numLevel(LevelFormat.BULLET, '•')] },
    { reference: 'num', levels: [numLevel(LevelFormat.DECIMAL, '%1.')] },
  ] },
  styles: { default: { document: { run: { font: SANS, size: 20, color: INK } } } },
  sections: [{ properties: { page: { margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } }, children }],
});

Packer.toBuffer(doc).then((buf) => {
  const out = path.join(__dirname, '気づきワード採取ハンドブック.docx');
  fs.writeFileSync(out, buf);
  console.log('生成しました:', out, buf.length, 'bytes');
});
