'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { buildXIntentPrompt } = require('../lib/x-intent-prompt');

test('アカウント名とリプライがuserプロンプトに差し込まれる', () => {
  const { system, user } = buildXIntentPrompt({ account: 'xqueen___a', replies: ['これ買いました', '欲しい'] });
  assert.ok(system.length > 0, 'systemが空でない');
  assert.match(user, /xqueen___a/);
  assert.match(user, /これ買いました/);
  assert.match(user, /欲しい/);
});

test('5分類とJSON出力形式の指示が含まれる', () => {
  const { user } = buildXIntentPrompt({ account: 'a', replies: ['x'] });
  assert.match(user, /purchased/);
  assert.match(user, /willBuy/);
  assert.match(user, /want/);
  assert.match(user, /interest/);
  assert.match(user, /unrelated/);
  assert.match(user, /"counts"/);
  assert.match(user, /"evidence"/);
});

test('懸賞目当ての「欲しい」をunrelatedに落とす指示が含まれる', () => {
  const { user } = buildXIntentPrompt({ account: 'a', replies: ['x'] });
  assert.match(user, /懸賞/);
  assert.match(user, /unrelated/);
});

test('リプライ件数と連番が本文に入る', () => {
  const { user } = buildXIntentPrompt({ account: 'a', replies: ['x', 'y', 'z'] });
  assert.match(user, /【リプライ（3件）】/);
  assert.match(user, /1\. x/);
  assert.match(user, /3\. z/);
});

test('account未指定・replies空はエラー', () => {
  assert.throws(() => buildXIntentPrompt({ replies: ['x'] }), /account/);
  assert.throws(() => buildXIntentPrompt({ account: 'a', replies: [] }), /replies/);
  assert.throws(() => buildXIntentPrompt({ account: 'a', replies: ['  '] }), /replies/);
});
