'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  isOfficialAccount, isBotAccount, classifyAccount,
  engagementRate, aggregateAuthors, sortByRate,
} = require('../lib/x-account-filter');

test('isOfficialAccount: 公式・企業を検出する', () => {
  assert.equal(isOfficialAccount({ name: '◯◯コスメ公式', description: '' }), true);
  assert.equal(isOfficialAccount({ name: 'ABC', description: '株式会社ABCの公式アカウントです' }), true);
  assert.equal(isOfficialAccount({ name: 'ABC Store', description: 'Official account' }), true);
});

test('isOfficialAccount: 一般ユーザーを誤検出しない', () => {
  assert.equal(isOfficialAccount({ name: 'みか', description: '毛穴ケア好きな会社員です' }), false);
  assert.equal(isOfficialAccount({ name: 'コスメ垢', description: '購入品レビューしてます' }), false);
});

test('isBotAccount: bot・まとめ・ニュースを検出する', () => {
  assert.equal(isBotAccount({ name: 'コスメbot', description: '' }), true);
  assert.equal(isBotAccount({ name: '', description: '美容ニュースをまとめて配信' }), true);
  assert.equal(isBotAccount({ name: 'みか', description: 'スキンケア好き' }), false);
});

test('classifyAccount: 懸賞はプロフィールで除外する', () => {
  const r = classifyAccount({ name: '懸賞垢', description: '懸賞・プレゼント応募専用' }, []);
  assert.equal(r.excluded, true);
  assert.equal(r.reason, '懸賞');
});

test('classifyAccount: 懸賞ツイートが過半なら除外する', () => {
  const tweets = [
    { text: 'このプレゼント企画に応募します' },
    { text: 'フォロー&RTで当たる！' },
    { text: '化粧水を買いました' },
  ];
  const r = classifyAccount({ name: 'みか', description: 'コスメ好き' }, tweets);
  assert.equal(r.excluded, true);
  assert.equal(r.reason, '懸賞');
});

test('classifyAccount: 懸賞が1件だけなら除外しない（一般ユーザーを失わない）', () => {
  const tweets = [
    { text: 'このプレゼント企画に応募します' },
    { text: '化粧水を買いました' },
    { text: '毛穴ケアの話' },
  ];
  const r = classifyAccount({ name: 'みか', description: 'コスメ好き' }, tweets);
  assert.equal(r.excluded, false);
  assert.equal(r.reason, null);
});

test('classifyAccount: 通常アカウントは除外しない', () => {
  const r = classifyAccount({ name: 'みか', description: 'スキンケア好きです' }, [{ text: '化粧水いい' }]);
  assert.deepEqual(r, { excluded: false, reason: null });
});

test('engagementRate: (いいね+RT)÷フォロワー×100 を小数1桁で返す', () => {
  assert.equal(engagementRate(100, 20, 10000), 1.2);
});

test('engagementRate: フォロワー100未満は null（分母が小さく率が無意味）', () => {
  assert.equal(engagementRate(50, 10, 99), null);
});

test('engagementRate: フォロワー0でゼロ除算しない', () => {
  assert.equal(engagementRate(50, 10, 0), null);
});

test('aggregateAuthors: 同一アカウントを1件に集約し平均を取る', () => {
  const tweets = [
    { text: 'a', likeCount: 100, retweetCount: 10, replyCount: 2, viewCount: 1000,
      author: { userName: 'mika', name: 'みか', description: 'コスメ好き', followers: 10000 } },
    { text: 'b', likeCount: 200, retweetCount: 30, replyCount: 4, viewCount: 3000,
      author: { userName: 'mika', name: 'みか', description: 'コスメ好き', followers: 10000 } },
  ];
  const out = aggregateAuthors(tweets);
  assert.equal(out.length, 1);
  assert.equal(out[0].account, 'mika');
  assert.equal(out[0].hits, 2);
  assert.equal(out[0].avgLike, 150);
  assert.equal(out[0].avgRt, 20);
  assert.equal(out[0].rate, 1.7);
  assert.equal(out[0].excluded, false);
});

test('aggregateAuthors: userNameが無いツイートは捨てる', () => {
  const out = aggregateAuthors([{ text: 'x', author: {} }]);
  assert.equal(out.length, 0);
});

test('aggregateAuthors: 除外対象にも理由を付けて返す（消さない）', () => {
  const tweets = [
    { text: 'a', likeCount: 10, retweetCount: 1, viewCount: 100,
      author: { userName: 'brand', name: '◯◯公式', description: '', followers: 50000 } },
  ];
  const out = aggregateAuthors(tweets);
  assert.equal(out.length, 1);
  assert.equal(out[0].excluded, true);
  assert.equal(out[0].reason, '公式');
});

test('sortByRate: エンゲージ率の降順・nullは末尾', () => {
  const out = sortByRate([{ rate: 1.0 }, { rate: null }, { rate: 3.0 }]);
  assert.deepEqual(out.map((x) => x.rate), [3.0, 1.0, null]);
});

test('isBotAccount: 英単語に埋まった bot を誤検出しない（botanical等）', () => {
  assert.equal(isBotAccount({ name: '', description: 'botanical skincare lover' }), false);
  assert.equal(isBotAccount({ name: '', description: 'I love robots' }), false);
  assert.equal(isBotAccount({ name: 'コスメbot', description: '' }), true);   // 本物は引き続き検出
});

test('isOfficialAccount: unofficial / 非公式 を公式扱いしない', () => {
  assert.equal(isOfficialAccount({ name: '', description: 'unofficial fan account' }), false);
  assert.equal(isOfficialAccount({ name: '◯◯非公式ファン', description: '' }), false);
  assert.equal(isOfficialAccount({ name: '◯◯コスメ公式', description: '' }), true);  // 本物は引き続き検出
});

test('isBotAccount: newspaper を news で誤検出しない', () => {
  assert.equal(isBotAccount({ name: '', description: 'I read the newspaper daily' }), false);
  assert.equal(isBotAccount({ name: '', description: '美容ニュースをまとめて配信' }), true);
});

test('isBotAccount: まとめ買い を bot 扱いしない（購買意欲の高い候補を失わない）', () => {
  assert.equal(isBotAccount({ name: '', description: 'コスメをまとめ買いするのが趣味' }), false);
  assert.equal(isBotAccount({ name: '', description: '新作をまとめ買いしました' }), false);
  assert.equal(isBotAccount({ name: '', description: 'コスメ情報のまとめサイトです' }), true);  // 本物は引き続き検出
});

test('isOfficialAccount: zinc を inc. で誤検出しない', () => {
  assert.equal(isOfficialAccount({ name: '', description: 'zinc oxide 配合が好き' }), false);
  assert.equal(isOfficialAccount({ name: 'ABC Inc.', description: '' }), true);  // 本物は引き続き検出
});
