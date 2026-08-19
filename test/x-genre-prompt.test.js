'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { buildXGenrePrompt, GENRES } = require('../lib/x-genre-prompt');

test('GENRES: 固定8カテゴリを提供する', () => {
  assert.deepEqual(GENRES, ['スキンケア', 'メイク', '美容医療', 'ヘアケア', 'ボディケア', 'ファッション', 'ライフスタイル', 'その他']);
});

test('buildXGenrePrompt: system と user を返す', () => {
  const p = buildXGenrePrompt({ account: 'mika', profile: 'コスメ好き', posts: ['化粧水いい'] });
  assert.ok(p.system.length > 0);
  assert.ok(p.user.includes('@mika'));
});

test('buildXGenrePrompt: 全カテゴリがプロンプトに含まれる', () => {
  const p = buildXGenrePrompt({ account: 'mika', profile: 'コスメ好き', posts: ['化粧水いい'] });
  GENRES.forEach((g) => assert.ok(p.user.includes(g), g + ' が含まれていない'));
});

test('buildXGenrePrompt: 1つだけ選ぶこと・迷ったらその他を指示する', () => {
  const p = buildXGenrePrompt({ account: 'mika', profile: 'コスメ好き', posts: ['化粧水いい'] });
  assert.ok(p.user.includes('1つだけ'));
  assert.ok(p.user.includes('その他'));
});

test('buildXGenrePrompt: 投稿は20件までに制限する', () => {
  const posts = Array.from({ length: 40 }, (_, i) => 'post' + i);
  const p = buildXGenrePrompt({ account: 'mika', profile: 'x', posts });
  assert.ok(p.user.includes('post19'));
  assert.ok(!p.user.includes('post20'));
});

test('buildXGenrePrompt: 空白のみの投稿は除く', () => {
  const p = buildXGenrePrompt({ account: 'mika', profile: 'コスメ好き', posts: ['  ', '', '化粧水いい'] });
  assert.ok(p.user.includes('1. 化粧水いい'));
});

test('buildXGenrePrompt: account が無ければエラー', () => {
  assert.throws(() => buildXGenrePrompt({ profile: 'x', posts: ['y'] }), /account/);
});

test('buildXGenrePrompt: プロフィールも投稿も無ければエラー', () => {
  assert.throws(() => buildXGenrePrompt({ account: 'mika', profile: '', posts: [] }), /profile|posts/);
});

test('buildXGenrePrompt: プロフィールだけでも組み立てられる', () => {
  const p = buildXGenrePrompt({ account: 'mika', profile: 'スキンケア好き', posts: [] });
  assert.ok(p.user.includes('スキンケア好き'));
});

test('buildXGenrePrompt: 出力部でカテゴリを再掲し完全一致を要求する', () => {
  const p = buildXGenrePrompt({ account: 'mika', profile: 'コスメ好き', posts: ['化粧水いい'] });
  assert.ok(p.user.includes('完全に一致'));
  assert.ok(p.user.includes('スキンケア / メイク'));   // 出力直前の再掲
  assert.ok(p.user.includes('変形・複合・独自表記は不可'));
});

test('buildXGenrePrompt: 複数該当時の優先ルールを与える', () => {
  const p = buildXGenrePrompt({ account: 'mika', profile: 'コスメ好き', posts: ['化粧水いい'] });
  assert.ok(p.user.includes('最も多く扱っている話題'));
  assert.ok(p.user.includes('投稿内容を優先'));
});
