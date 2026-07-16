'use strict';
/**
 * x-intent-prompt.js — Xリプライの購買意向判定プロンプト（純粋関数）
 * 設計は docs/superpowers/specs/2026-07-16-s2d2-x-reply-intent.md を正とする。
 */

const SYSTEM =
  'あなたはCreative GroupのX(旧Twitter)リプライ分析の専門アナリストです。' +
  '提示されたリプライのみを根拠に各リプライの購買意向を分類し、指定のJSONのみを出力してください。' +
  '説明文・前置き・コードフェンスは一切出力しないでください。';

const TEMPLATE = `以下は X アカウント @{{account}} の投稿に付いたリプライです。
各リプライを購買意向で5分類し、集計結果をJSONで返してください。

【分類】
- purchased（購入済）: 既に買った・使っている（例:「買いました」「届いた」「リピしてる」）
- willBuy（購入予定）: 買う意思が明確（例:「絶対買う」「ポチる」「注文してくる」）
- want（欲しい）: 欲しいが購入意思は未確定（例:「欲しい」「気になる」「どこで買えますか」）
- interest（興味）: 商品ではなく投稿者・投稿への反応（例:「かわいい」「参考になる」）
- unrelated（無関係）: 雑談・挨拶・スパム

【重要】懸賞・プレゼント企画目当ての「欲しい」は購買意向ではありません。unrelated に分類してください。
文脈から懸賞目当てと判断できるものを want に入れないでください。

【リプライ（{{count}}件）】
{{replies}}

【出力】次のJSONのみを出力（説明文なし）。evidenceは各ラベル最大3件、リプライ本文をそのまま引用。
{
  "total": 判定したリプライ数,
  "counts": { "purchased": 0, "willBuy": 0, "want": 0, "interest": 0, "unrelated": 0 },
  "evidence": { "purchased": [], "willBuy": [], "want": [] },
  "note": "気になった点（80字以内・無ければ空文字）"
}`;

function fill(template, values) {
  return template.replace(/{{(\w+)}}/g, (_, k) => {
    if (!(k in values)) throw new Error('テンプレートキーが見つかりません: ' + k);
    return String(values[k]);
  });
}

function buildXIntentPrompt(payload) {
  payload = payload || {};
  const account = String(payload.account || '').trim().replace(/^@/, '');
  if (!account) throw new Error('必須項目が不足しています: account');
  const list = Array.isArray(payload.replies) ? payload.replies : [];
  const replies = list.map((r) => String(r == null ? '' : r).replace(/\s+/g, ' ').trim()).filter((r) => r);
  if (!replies.length) throw new Error('必須項目が不足しています: replies');
  const numbered = replies.map((r, i) => `${i + 1}. ${r}`).join('\n');
  return { system: SYSTEM, user: fill(TEMPLATE, { account, count: replies.length, replies: numbered }) };
}

module.exports = { buildXIntentPrompt };
