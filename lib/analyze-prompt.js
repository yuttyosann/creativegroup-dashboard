'use strict';
/**
 * analyze-prompt.js — 商品分析/診断プロンプトの組み立て（純粋関数）
 * 文面は CG_インフルエンサー診断_v0.1.md の v0.5/v0.6 を正とする。
 */

const SYSTEM =
  'あなたはCreative Groupのインフルエンサー×商品マッチング診断の専門アナリストです。' +
  '提示された情報のみを根拠に、客観的・対称的に分析し、過学習を避け、指定フォーマットで簡潔に出力してください。';

const PRODUCT_TEMPLATE = `以下の商品を、インフルエンサーマッチング診断のために分析してください。

【商品名・ブランド】{{productName}}
【提供情報】{{info}}

【分析項目】表で整理してください。
1. 商品カテゴリ・主役アイテム（セットの場合どれが核か）
2. 価格帯（定価/メガ割価格/割引率）
3. メイン訴求軸 TOP3
4. 商品の「需要タイプ／needsタイプ」を判定（カバー需要型/ツヤ・保湿需要型/機能解決型/情緒・憧れ型）
   ※これがインフルエンサーの需要・利用文脈適合(M02)判定の基準になる
5. ターゲット肌質・肌悩み（美容以外は利用文脈・needs。レビューから客観抽出）
6. 高評価レビューの頻出テーマ TOP5
7. 不満レビュー・NG訴求
8. 競合商品との差別化
9. メガ割/セールで押すべき訴求 TOP3
10. 商品自体の「ベース力」評価（受賞/ランキング/評価点）
最後に「この商品の核需要を最も実演できるインフルエンサー像」を100字で。`;

const DIAGNOSE_TEMPLATE = `商品分析とインフルエンサー分析をもとにマッチング診断してください。
※実売結果が分かっていても、採点は入力データのみで行う（ブラインド）。結果は最後の検証だけに使う。

【商品分析サマリー】
{{productSummary}}

【インフルエンサー分析サマリー】
{{influencerSummary}}

【施策条件】{{conditions}}

■ STEP1：施策タイプ判定（A レビュー型 / B アンバサダー型）
■ STEP2：10軸採点（入力データのみ・ブラインド）
| 軸 | 配点 |
| M01 商品カテゴリ適合 | 10 |
| M02 需要・利用文脈適合（★商品の需要タイプと客層の需要を突き合わせ） | 15 |
| M03 投稿スタイル適合 | 10 |
| M04 フォロワー層適合 | 10 |
| M05 過去実績（なければ中央値5） | 10 |
| M06 コメント信頼（購買意向コメントのみ・虚栄は除外） | 10 |
| M07 PR自然度 | 10 |
| M08 購買導線 | 10 |
| M09 メガ割/セール適性 | 10 |
| M10 リスク控除 | -20〜0 |
■ STEP3：ROAS試算（損益分岐販売数＝タイアップ費÷想定単価。超える見込みか／契約構造リスク）
■ STEP4：診断結果（総合スコアと判定 85+◎/70-84○/55-69△/-54×・強みTOP3・懸念TOP3・推奨投稿スタイル・避ける表現・起用是非と推奨契約構造）`;

function fill(template, values) {
  return template.replace(/{{(\w+)}}/g, (_, k) => {
    if (!(k in values)) throw new Error('テンプレートキーが見つかりません: ' + k);
    return values[k];
  });
}

function requireFields(payload, fields) {
  for (const f of fields) {
    if (!payload || !String(payload[f] || '').trim()) {
      throw new Error('必須項目が不足しています: ' + f);
    }
  }
}

function buildAnalyzePrompt(kind, payload) {
  payload = payload || {};
  if (kind === 'product') {
    requireFields(payload, ['productName', 'info']);
    return { system: SYSTEM, user: fill(PRODUCT_TEMPLATE, payload) };
  }
  if (kind === 'diagnose') {
    requireFields(payload, ['productSummary', 'influencerSummary']);
    const values = {
      productSummary: payload.productSummary,
      influencerSummary: payload.influencerSummary,
      conditions: String(payload.conditions || '').trim() || '（記載なし）',
    };
    return { system: SYSTEM, user: fill(DIAGNOSE_TEMPLATE, values) };
  }
  throw new Error('unknown kind: ' + kind);
}

module.exports = { buildAnalyzePrompt };
