'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { isExplicitPR, summarizePR, engagementRate } = require('../lib/x-pr-filter');

// 実データ（2026-08-19 実測）で確認した表記をそのままケース化する
test('isExplicitPR: 実データのPR表記を検出する', () => {
  assert.equal(isExplicitPR('長年研究している、アスタキサンチンの使い手なのです。【PR/アスタリフト】'), true);
  assert.equal(isExplicitPR('凄いよ、このハイライト当てた様なツヤ。【PR】エイトザタラソSR'), true);
  assert.equal(isExplicitPR('Celladixのこれは3%も入っててマンホール毛穴にぴったりなの👍PR'), true);
  assert.equal(isExplicitPR('これからも愛用しつづけます…😭【PR_オルビス】'), true);
  assert.equal(isExplicitPR('上品なツヤプラスしよ🎀 #PR #水光肌の作り方'), true);
  assert.equal(isExplicitPR('プチプラ日傘はこれです（当方日傘ないと100外出しない超晴れ女👩☀️）PR'), true);
});

test('isExplicitPR: 英単語に埋まった pr を誤検出しない', () => {
  assert.equal(isExplicitPR('this product is great'), false);
  assert.equal(isExplicitPR('press release'), false);
  assert.equal(isExplicitPR('April is coming'), false);
  assert.equal(isExplicitPR('what a surprise'), false);
  assert.equal(isExplicitPR('spray してます'), false);
});

test('isExplicitPR: URL内の文字列を誤検出しない', () => {
  assert.equal(isExplicitPR('詳細はこちら https://example.com/pr/12345'), false);
  assert.equal(isExplicitPR('最後まで搾り取れるパウチ大好き https://t.co/O0AefAuUhF'), false);
});

test('isExplicitPR: 空文字・null で落ちない', () => {
  assert.equal(isExplicitPR(''), false);
  assert.equal(isExplicitPR(null), false);
  assert.equal(isExplicitPR(undefined), false);
});

test('engagementRate: (いいね+RT)÷フォロワー×100 を小数1桁で返す', () => {
  assert.equal(engagementRate(100, 20, 10000), 1.2);
});

test('engagementRate: フォロワー100未満・0は null', () => {
  assert.equal(engagementRate(50, 10, 99), null);
  assert.equal(engagementRate(50, 10, 0), null);
});

test('summarizePR: PR/非PRに分けて集計する', () => {
  const tweets = [
    { text: '新作いいよ【PR】', likeCount: 100, retweetCount: 0, isReply: false, isRetweet: false },
    { text: 'これ好き【PR】', likeCount: 200, retweetCount: 0, isReply: false, isRetweet: false },
    { text: '普通の投稿です', likeCount: 1000, retweetCount: 0, isReply: false, isRetweet: false },
    { text: 'これも普通', likeCount: 2000, retweetCount: 0, isReply: false, isRetweet: false },
  ];
  const s = summarizePR(tweets, 10000);
  assert.equal(s.tweets, 4);
  assert.equal(s.prCount, 2);
  assert.equal(s.prRate, 50);
  assert.equal(s.prEngage, 1.5);      // 平均150 / 10000
  assert.equal(s.nonPrEngage, 15);    // 平均1500 / 10000
  assert.equal(s.prLift, 10);         // 1.5 / 15 = 10%
});

test('summarizePR: リプライとリツイートは分母に入れない', () => {
  const tweets = [
    { text: '本人の投稿【PR】', likeCount: 100, retweetCount: 0, isReply: false, isRetweet: false },
    { text: '返信です', likeCount: 5, retweetCount: 0, isReply: true, isRetweet: false },
    { text: 'RTしたもの', likeCount: 999, retweetCount: 0, isReply: false, isRetweet: true },
  ];
  const s = summarizePR(tweets, 10000);
  assert.equal(s.tweets, 1);
  assert.equal(s.prCount, 1);
  assert.equal(s.prRate, 100);
});

test('summarizePR: PR投稿が無ければ prEngage と prLift は null', () => {
  const tweets = [{ text: '普通の投稿', likeCount: 100, retweetCount: 0, isReply: false, isRetweet: false }];
  const s = summarizePR(tweets, 10000);
  assert.equal(s.prCount, 0);
  assert.equal(s.prRate, 0);
  assert.equal(s.prEngage, null);
  assert.equal(s.prLift, null);
  assert.equal(s.lowPrSample, false);   // 0件は「サンプル不足」ではなく「PRなし」
});

test('summarizePR: 非PR投稿が無ければ prLift は null（比較対象がない）', () => {
  const tweets = [{ text: 'PR投稿だけ【PR】', likeCount: 100, retweetCount: 0, isReply: false, isRetweet: false }];
  const s = summarizePR(tweets, 10000);
  assert.equal(s.prEngage, 1);
  assert.equal(s.nonPrEngage, null);
  assert.equal(s.prLift, null);
});

test('summarizePR: PR投稿が1〜2件なら lowPrSample=true', () => {
  const tweets = [
    { text: 'PR投稿【PR】', likeCount: 100, retweetCount: 0, isReply: false, isRetweet: false },
    { text: '普通', likeCount: 100, retweetCount: 0, isReply: false, isRetweet: false },
  ];
  assert.equal(summarizePR(tweets, 10000).lowPrSample, true);
});

test('summarizePR: 投稿が空でも落ちない', () => {
  const s = summarizePR([], 10000);
  assert.equal(s.tweets, 0);
  assert.equal(s.prCount, 0);
  assert.equal(s.prRate, 0);
  assert.equal(s.prEngage, null);
});

test('isExplicitPR: 全角のＰＲを検出する（日本語圏では全角表記がある）', () => {
  assert.equal(isExplicitPR('【ＰＲ】新作コスメを試しました'), true);
  assert.equal(isExplicitPR('新作コスメを試しました　ＰＲ'), true);
});

test('isExplicitPR: @メンションのハンドル名で誤検出しない', () => {
  assert.equal(isExplicitPR('@pr_cosme さんありがとう'), false);
  assert.equal(isExplicitPR('@PR_official からもらった'), false);
  assert.equal(isExplicitPR('@friend さんに教わった新作【PR】'), true);  // 本物のPRは引き続き検出
});
