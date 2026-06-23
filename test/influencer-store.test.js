'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const inf = require('../lib/influencer-store');

const NOW = new Date('2026-06-21T00:00:00Z');

test('toRow↔parse 往復（主要項目）', () => {
  const row = inf.toInfluencerRow({ account: 'sachi', media: 'YouTube', followers: 193000, conversion: 17.9, genre: '美容' }, 'I-0001', NOW);
  const o = inf.parseInfluencer(row);
  assert.strictEqual(o.inf_id, 'I-0001');
  assert.strictEqual(o.account, 'sachi');
  assert.strictEqual(o.media, 'YouTube');
  assert.strictEqual(String(o.followers), '193000');
  assert.strictEqual(String(o.conversion), '17.9');
  assert.strictEqual(o.genre, '美容');
  assert.strictEqual(o.updated, '2026-06-21');
});

test('validateInfluencer: account/media 必須・媒体は選択肢のみ・Xは許可', () => {
  assert.throws(() => inf.validateInfluencer({ media: 'YouTube' }), /アカウント名/);
  assert.throws(() => inf.validateInfluencer({ account: 'a' }), /媒体/);
  assert.throws(() => inf.validateInfluencer({ account: 'a', media: 'LinkedIn' }), /媒体/);
  assert.doesNotThrow(() => inf.validateInfluencer({ account: 'a', media: 'X' }));
});

test('MEDIA_OPTIONS は4媒体', () => {
  assert.deepStrictEqual(inf.MEDIA_OPTIONS, ['YouTube', 'Instagram', 'TikTok', 'X']);
});

test('mergeInfluencer: 空値は既存を保持・非空は上書き・キーは既存維持', () => {
  const existing = { inf_id: 'I-0001', account: 'sachi', media: 'YouTube', genre: '美容', followers: '100', note: 'old' };
  const incoming = { account: 'SACHI', media: 'YouTube', genre: '', followers: '200', note: 'new', conversion: '18' };
  const m = inf.mergeInfluencer(existing, incoming);
  assert.strictEqual(m.inf_id, 'I-0001');
  assert.strictEqual(m.account, 'sachi');
  assert.strictEqual(m.genre, '美容');
  assert.strictEqual(m.followers, '200');
  assert.strictEqual(m.note, 'new');
  assert.strictEqual(m.conversion, '18');
});
