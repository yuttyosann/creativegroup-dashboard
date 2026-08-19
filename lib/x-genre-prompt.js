'use strict';
/**
 * x-genre-prompt.js — Xアカウントのジャンル判定プロンプト（純粋関数）
 *
 * 固定カテゴリから1つだけ選ばせる。自由記述にすると表記がブレて
 * 候補DBでの絞り込み・並べ替えに使えなくなるため。
 */

const GENRES = ['スキンケア', 'メイク', '美容医療', 'ヘアケア', 'ボディケア', 'ファッション', 'ライフスタイル', 'その他'];

const SYSTEM =
  'あなたはCreative GroupのSNSインフルエンサー分析アナリストです。' +
  '提示された情報のみを根拠にアカウントの主ジャンルを1つ選び、指定のJSONのみを出力してください。' +
  '説明文・前置き・コードフェンスは一切出力しないでください。';

const TEMPLATE = `以下は X アカウント @{{account}} のプロフィールと直近の投稿です。
このアカウントの主ジャンルを次の中から1つだけ選んでください。

【カテゴリ】
{{genres}}

どれにも当てはまらない場合は「その他」を選んでください。無理に既存カテゴリへ寄せないでください。

【プロフィール】
{{profile}}

【直近の投稿（{{count}}件）】
{{posts}}

【出力】次のJSONのみを出力（説明文なし）。
{
  "genre": "カテゴリ名（上記のいずれか）",
  "reason": "判断根拠（40字以内）"
}`;

function fill(template, values) {
  return template.replace(/{{(\w+)}}/g, (_, k) => {
    if (!(k in values)) throw new Error('テンプレートキーが見つかりません: ' + k);
    return String(values[k]);
  });
}

function buildXGenrePrompt(payload) {
  payload = payload || {};
  const account = String(payload.account || '').trim().replace(/^@/, '');
  if (!account) throw new Error('必須項目が不足しています: account');

  const profile = String(payload.profile || '').replace(/\s+/g, ' ').trim();
  const list = Array.isArray(payload.posts) ? payload.posts : [];
  const posts = list
    .map((p) => String(p == null ? '' : p).replace(/\s+/g, ' ').trim())
    .filter((p) => p)
    .slice(0, 20);

  if (!profile && !posts.length) throw new Error('必須項目が不足しています: profile または posts');

  const numbered = posts.map((p, i) => `${i + 1}. ${p.slice(0, 120)}`).join('\n');
  return {
    system: SYSTEM,
    user: fill(TEMPLATE, {
      account,
      genres: GENRES.map((g) => '- ' + g).join('\n'),
      profile: profile || '(なし)',
      count: posts.length,
      posts: numbered || '(なし)',
    }),
  };
}

module.exports = { buildXGenrePrompt, GENRES };
