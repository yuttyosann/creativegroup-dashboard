'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const crm = require('../lib/crm-store');

const NOW = new Date('2026-06-21T00:00:00Z');

test('ブランド: toRow↔parse 往復', () => {
  const row = crm.toBrandRow({ name: 'ABCコスメ', industry: '美容' }, 'B-0001', NOW);
  const o = crm.parseBrand(row);
  assert.strictEqual(o.brand_id, 'B-0001');
  assert.strictEqual(o.name, 'ABCコスメ');
  assert.strictEqual(o.industry, '美容');
  assert.strictEqual(o.created, '2026-06-21');
  assert.strictEqual(o.updated, '2026-06-21');
});

test('ブランド: 名前必須', () => {
  assert.throws(() => crm.validateBrand({ name: '' }), /ブランド名/);
  assert.doesNotThrow(() => crm.validateBrand({ name: 'X' }));
});

test('商品: brand_idと商品名が必須・往復', () => {
  assert.throws(() => crm.validateProduct({ name: 'x' }), /brand_id/);
  assert.throws(() => crm.validateProduct({ brand_id: 'B-0001' }), /商品名/);
  const row = crm.toProductRow({ brand_id: 'B-0001', name: '美容液', category: 'スキンケア' }, 'P-0001', NOW);
  const o = crm.parseProduct(row);
  assert.strictEqual(o.product_id, 'P-0001');
  assert.strictEqual(o.brand_id, 'B-0001');
  assert.strictEqual(o.name, '美容液');
});

test('案件: 必須項目・ステータス既定値・不正ステータス', () => {
  assert.throws(() => crm.validateCase({ brand_id: 'B-0001', product_id: 'P-0001' }), /案件名/);
  assert.throws(() => crm.validateCase({ brand_id: 'B-0001', product_id: 'P-0001', name: 'x', status: '謎' }), /ステータス/);
  const row = crm.toCaseRow({ brand_id: 'B-0001', product_id: 'P-0001', name: '6月メガ割' }, 'C-0001', NOW);
  const o = crm.parseCase(row);
  assert.strictEqual(o.case_id, 'C-0001');
  assert.strictEqual(o.status, '受注');
  assert.strictEqual(o.name, '6月メガ割');
});

test('案件: 更新時はcreatedを保持できる', () => {
  const row = crm.toCaseRow({ brand_id: 'B-0001', product_id: 'P-0001', name: 'x', status: '制作進行' }, 'C-0001', NOW, '2026-06-01');
  const o = crm.parseCase(row);
  assert.strictEqual(o.created, '2026-06-01');
  assert.strictEqual(o.updated, '2026-06-21');
  assert.strictEqual(o.status, '制作進行');
});

test('CASE_STATUSESは8段階＋見送り・中止', () => {
  assert.strictEqual(crm.CASE_STATUSES.length, 9);
  ['受注', '成果回収・完了', '見送り・中止'].forEach((s) => assert.ok(crm.CASE_STATUSES.includes(s)));
});
