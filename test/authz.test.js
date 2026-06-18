const { test } = require('node:test');
const assert = require('node:assert');
const { isAllowed, normalizeEmail } = require('../lib/authz');

const list = [
  { email: 'Alice@Example.com', role: 'admin' },
  { email: 'bob@example.com', role: 'member' },
];

test('許可リストにあるメール（大文字小文字無視）は許可', () => {
  assert.strictEqual(isAllowed('alice@example.com', list), true);
  assert.strictEqual(isAllowed('BOB@EXAMPLE.COM', list), true);
});

test('許可リストにないメールは拒否', () => {
  assert.strictEqual(isAllowed('eve@example.com', list), false);
});

test('空・未定義は拒否', () => {
  assert.strictEqual(isAllowed('', list), false);
  assert.strictEqual(isAllowed(undefined, list), false);
});

test('normalizeEmailは小文字化とトリムを行う', () => {
  assert.strictEqual(normalizeEmail('  Foo@Bar.com '), 'foo@bar.com');
});
