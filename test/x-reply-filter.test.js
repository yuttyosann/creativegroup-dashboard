'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { isGiveawayPost, isPRPost, selectPosts, cleanReplies } = require('../lib/x-reply-filter');

test('isGiveawayPost: 懸賞マーカーを検出する', () => {
  assert.ok(isGiveawayPost('【プレゼント企画】フォロー&RTで抽選5名様に当たる！'));
  assert.ok(isGiveawayPost('応募はこちらから'));
  assert.ok(isGiveawayPost('フォロー＆リポストで当選のチャンス'));
  assert.ok(isGiveawayPost('キャンペーン実施中'));
});

test('isGiveawayPost: 大文字小文字を問わない', () => {
  assert.ok(isGiveawayPost('フォロー&RTで参加'));
  assert.ok(isGiveawayPost('フォロー&rtで参加'));
});

test('isGiveawayPost: 通常のコスメ投稿は懸賞と判定しない', () => {
  assert.equal(isGiveawayPost('この美容液、毛穴に効いて最高だった。リピ確定です'), false);
});

test('isPRPost: PR表記を検出する', () => {
  assert.ok(isPRPost({ text: '#PR いただきました' }));
  assert.ok(isPRPost({ text: '案件です' }));
  assert.ok(isPRPost({ text: '提供：ABC社' }));
});

test('isPRPost: 通常投稿はPRと判定しない', () => {
  assert.equal(isPRPost({ text: '今日のメイク' }), false);
});

test('selectPosts: 懸賞を除外しリプライ数の多い順に上位maxPostsを返す', () => {
  const posts = [
    { text: '通常A', replyCount: 10 },
    { text: 'プレゼント企画', replyCount: 999 },
    { text: '通常B', replyCount: 30 },
    { text: '通常C', replyCount: 20 },
  ];
  assert.deepEqual(selectPosts(posts, { maxPosts: 2 }).map((p) => p.text), ['通常B', '通常C']);
});

test('selectPosts: 全部懸賞なら空配列', () => {
  assert.deepEqual(selectPosts([{ text: '抽選で当たる', replyCount: 100 }], { maxPosts: 5 }), []);
});

test('cleanReplies: 定型・URLのみ・絵文字のみ・空・重複を落とす', () => {
  const got = cleanReplies([
    { text: 'これ買いました！' },
    { text: 'フォローしました' },
    { text: 'https://example.com' },
    { text: '🎉🎉' },
    { text: 'これ買いました！' },
    { text: '' },
  ], { maxPerPost: 50 });
  assert.deepEqual(got, ['これ買いました！']);
});

test('cleanReplies: 懸賞目当てのリプライを落とし、通常の「欲しい」は残す', () => {
  assert.deepEqual(cleanReplies([{ text: '応募します！欲しい' }, { text: '普通に欲しい' }], {}), ['普通に欲しい']);
});

test('cleanReplies: 投稿者本人の自己リプ（連投）を除外する', () => {
  const got = cleanReplies([
    { text: '続きです', authorHandle: 'me' },
    { text: '買いました', authorHandle: 'fan' },
  ], { authorHandle: 'me' });
  assert.deepEqual(got, ['買いました']);
});

test('cleanReplies: maxPerPostで打ち切る', () => {
  const replies = Array.from({ length: 10 }, (_, i) => ({ text: 'コメント' + i }));
  assert.equal(cleanReplies(replies, { maxPerPost: 3 }).length, 3);
});

test('isGiveawayPost: モニター募集・先着・名様も検出する（プローブで発見）', () => {
  assert.ok(isGiveawayPost('モニター募集中！'));
  assert.ok(isGiveawayPost('無料で試せるモニター'));
  assert.ok(isGiveawayPost('先着100名様'));
  assert.ok(isGiveawayPost('5名様に当たる'));
  assert.ok(isGiveawayPost('感想募集中'));
});

test('isGiveawayPost: 当たり（当たりますように等）も検出する', () => {
  assert.ok(isGiveawayPost('当たりますように'));
});

test('cleanReplies: 懸賞目当ての「当たりますように」「参加中です」を落とす', () => {
  assert.deepEqual(
    cleanReplies([{ text: '当たりますように' }, { text: '参加中です' }, { text: 'これ買いました' }], {}),
    ['これ買いました']
  );
});

test('cleanReplies: 通常投稿での素の「ほしいです」は残す（懸賞と混同しない）', () => {
  assert.deepEqual(cleanReplies([{ text: 'ほしいです🙏' }], {}), ['ほしいです🙏']);
});
