# S2a データモデル＋案件管理（Mode A）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ブランド→商品→案件の正規化データモデルをSheetsに持ち、コックピットに案件登録・一覧・編集UIと「現在の案件」セレクタを追加し、診断ログに案件IDを紐づける。

**Architecture:** S1と同じ Node/Sheets 構成。純粋ロジック（ID採番・行マッパー）を `lib/` に切り出してTDD、`cockpit-server.js` にCRUDエンドポイント、`public/cg-cockpit.html` に案件タブと現在の案件セレクタを追加。書き込みは全てNodeに一本化。

**Tech Stack:** Node.js / Express、googleapis（Sheets）、Vanilla JS（フロント）、node:test（TDD）、Google Apps Script（タブ初期化スニペット）。

---

## File Structure

- **Create** `lib/id-gen.js` — `nextId(prefix, ids)` 純粋関数（ID自動採番）。
- **Create** `test/id-gen.test.js`
- **Create** `lib/crm-store.js` — ブランド/商品/案件の列定義・行マッパー・バリデーション・ステータス定数。
- **Create** `test/crm-store.test.js`
- **Modify** `lib/diagnosis-store.js` — `toDiagnosisRow` に `caseId` 引数を追加（先頭列）。
- **Modify** `test/diagnosis-store.test.js` — 既存2テストを更新＋caseIdテスト追加。
- **Create** `test/sheets-helpers.test.js` — `findRowNumber` の純粋ロジックをテスト。
- **Modify** `lib/sheets.js` — `findRowNumber` と `updateRowById` を追加。
- **Modify** `cockpit-server.js` — brands/products/cases の CRUDエンドポイント＋youtube診断にcaseId連携。
- **Modify** `public/cg-cockpit.html` — 案件タブ＋現在の案件セレクタ＋runYTBatchにcaseId付与。
- **Create** `scripts/setup/build_crm_sheets.gs` — Sheetsタブ作成＋診断ログ案件ID列のGAS。

既存の `public/cg-cockpit.html` は単一ファイルで肥大化しているが、確立パターン（`RENDER`オブジェクト＋`window.xxx`ハンドラ＋`STEPS`配列）に従う。restructureはしない。

---

## Task 1: ID自動採番（TDD）

**Files:**
- Create: `lib/id-gen.js`
- Test: `test/id-gen.test.js`

- [ ] **Step 1: Write the failing test**

`test/id-gen.test.js`:

```javascript
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { nextId } = require('../lib/id-gen');

test('空配列なら -0001', () => {
  assert.strictEqual(nextId('B', []), 'B-0001');
});

test('既存の最大値+1（4桁ゼロ詰め）', () => {
  assert.strictEqual(nextId('B', ['B-0001', 'B-0003']), 'B-0004');
  assert.strictEqual(nextId('C', ['C-0009']), 'C-0010');
});

test('別prefixや壊れた値は無視する', () => {
  assert.strictEqual(nextId('B', ['C-0009', 'B-xx', '', null, 'B-0002']), 'B-0003');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/id-gen.test.js`
Expected: FAIL（`Cannot find module '../lib/id-gen'`）

- [ ] **Step 3: Write minimal implementation**

`lib/id-gen.js`:

```javascript
'use strict';
/** 既存ID配列から次のIDを生成。<prefix>-<4桁ゼロ詰め>。 */
function nextId(prefix, ids) {
  const re = new RegExp('^' + prefix + '-(\\d+)$');
  let max = 0;
  for (const id of ids || []) {
    const m = String(id == null ? '' : id).match(re);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > max) max = n;
    }
  }
  return prefix + '-' + String(max + 1).padStart(4, '0');
}

module.exports = { nextId };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/id-gen.test.js`
Expected: PASS（3 tests）

- [ ] **Step 5: Commit**

```bash
git add lib/id-gen.js test/id-gen.test.js
git commit -m "feat: ID自動採番ロジックnextIdを追加(TDD)"
```

---

## Task 2: CRM行マッパー＋バリデーション（TDD）

**Files:**
- Create: `lib/crm-store.js`
- Test: `test/crm-store.test.js`

- [ ] **Step 1: Write the failing test**

`test/crm-store.test.js`:

```javascript
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
  assert.strictEqual(o.status, '受注'); // 既定値
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/crm-store.test.js`
Expected: FAIL（`Cannot find module '../lib/crm-store'`）

- [ ] **Step 3: Write minimal implementation**

`lib/crm-store.js`:

```javascript
'use strict';
/**
 * crm-store.js — ブランド/商品/案件の列定義・行マッパー・バリデーション（純粋関数）
 * Sheetsの列順はここを単一の正とする。
 */

const BRAND_HEADERS = ['brand_id', 'ブランド名', '業種・カテゴリ', '担当・連絡先', 'メモ', '作成日', '最終更新'];
const PRODUCT_HEADERS = ['product_id', 'brand_id', '商品名', 'カテゴリ', '価格帯', 'URL', '需要タイプ', 'メモ', '作成日', '最終更新'];
const CASE_HEADERS = ['case_id', 'brand_id', 'product_id', '案件名', 'ステータス', '商戦時期', '予算', '目標', 'メモ', '作成日', '最終更新'];
const CASE_STATUSES = ['受注', 'ヒアリング', '候補リスト作成', 'クライアント選定待ち', '起用交渉', '制作進行', '投稿済み', '成果回収・完了', '見送り・中止'];

function isoDate(now) { return now.toISOString().slice(0, 10); }

function require1(obj, field, label) {
  if (!obj || !String(obj[field] == null ? '' : obj[field]).trim()) {
    throw new Error('必須項目が不足しています: ' + label);
  }
}

// --- ブランド ---
function validateBrand(o) { require1(o, 'name', 'ブランド名'); }
function toBrandRow(o, id, now = new Date(), created) {
  const d = isoDate(now);
  return [id, o.name || '', o.industry || '', o.contact || '', o.note || '', created || d, d];
}
function parseBrand(r) {
  return { brand_id: r[0] || '', name: r[1] || '', industry: r[2] || '', contact: r[3] || '', note: r[4] || '', created: r[5] || '', updated: r[6] || '' };
}

// --- 商品 ---
function validateProduct(o) { require1(o, 'brand_id', 'brand_id'); require1(o, 'name', '商品名'); }
function toProductRow(o, id, now = new Date(), created) {
  const d = isoDate(now);
  return [id, o.brand_id || '', o.name || '', o.category || '', o.price || '', o.url || '', o.demandType || '', o.note || '', created || d, d];
}
function parseProduct(r) {
  return { product_id: r[0] || '', brand_id: r[1] || '', name: r[2] || '', category: r[3] || '', price: r[4] || '', url: r[5] || '', demandType: r[6] || '', note: r[7] || '', created: r[8] || '', updated: r[9] || '' };
}

// --- 案件 ---
function validateCase(o) {
  require1(o, 'brand_id', 'brand_id');
  require1(o, 'product_id', 'product_id');
  require1(o, 'name', '案件名');
  if (o.status && !CASE_STATUSES.includes(o.status)) {
    throw new Error('不正なステータス: ' + o.status);
  }
}
function toCaseRow(o, id, now = new Date(), created) {
  const d = isoDate(now);
  return [id, o.brand_id || '', o.product_id || '', o.name || '', o.status || '受注', o.season || '', o.budget || '', o.goal || '', o.note || '', created || d, d];
}
function parseCase(r) {
  return { case_id: r[0] || '', brand_id: r[1] || '', product_id: r[2] || '', name: r[3] || '', status: r[4] || '', season: r[5] || '', budget: r[6] || '', goal: r[7] || '', note: r[8] || '', created: r[9] || '', updated: r[10] || '' };
}

module.exports = {
  BRAND_HEADERS, PRODUCT_HEADERS, CASE_HEADERS, CASE_STATUSES,
  validateBrand, toBrandRow, parseBrand,
  validateProduct, toProductRow, parseProduct,
  validateCase, toCaseRow, parseCase,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/crm-store.test.js`
Expected: PASS（6 tests）

- [ ] **Step 5: Commit**

```bash
git add lib/crm-store.js test/crm-store.test.js
git commit -m "feat: CRM(ブランド/商品/案件)の行マッパーとバリデーションを追加(TDD)"
```

---

## Task 3: 診断ログに案件IDを追加（TDD・既存修正）

**Files:**
- Modify: `lib/diagnosis-store.js`
- Modify: `test/diagnosis-store.test.js`

- [ ] **Step 1: Update the tests to expect caseId at the front**

`test/diagnosis-store.test.js` の全体を次に置換：

```javascript
const { test } = require('node:test');
const assert = require('node:assert');
const { toDiagnosisRow } = require('../lib/diagnosis-store');

test('YouTube診断結果を診断ログ行に整形する（案件ID先頭・未指定は空）', () => {
  const result = {
    title: 'SACHI沙智ちゃんねる', subscribers: 193000,
    avgER: 1.67, purchaseIntentRate: 17.9, commentsAnalyzed: 145, prOnly: false,
  };
  const row = toDiagnosisRow(result, { email: 'a@example.com' }, new Date('2026-06-18T00:00:00Z'));
  assert.deepStrictEqual(row, [
    '', '2026-06-18', 'a@example.com', 'YouTube', 'SACHI沙智ちゃんねる',
    193000, 1.67, 17.9, 145, '人気投稿',
  ]);
});

test('案件IDを指定すると先頭列に入る', () => {
  const row = toDiagnosisRow(
    { title: 'X', subscribers: 1, avgER: 0, purchaseIntentRate: 0, commentsAnalyzed: 0, prOnly: true },
    { email: 'u@x.com' }, new Date('2026-06-18T00:00:00Z'), 'C-0007');
  assert.strictEqual(row[0], 'C-0007');
  assert.strictEqual(row[9], 'PR投稿');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/diagnosis-store.test.js`
Expected: FAIL（先頭の `''`/`C-0007` が無いため deepStrictEqual / strictEqual が不一致）

- [ ] **Step 3: Add the caseId parameter**

`lib/diagnosis-store.js` を次に置換：

```javascript
'use strict';

/** 診断結果を「診断ログ」シートの1行（配列）に整形する。先頭は案件ID（未指定なら空）。 */
function toDiagnosisRow(result, user, now = new Date(), caseId = '') {
  const date = now.toISOString().slice(0, 10);
  return [
    caseId || '',
    date,
    user.email || '',
    'YouTube',
    result.title || '',
    result.subscribers || 0,
    result.avgER || 0,
    result.purchaseIntentRate || 0,
    result.commentsAnalyzed || 0,
    result.prOnly ? 'PR投稿' : '人気投稿',
  ];
}

module.exports = { toDiagnosisRow };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/diagnosis-store.test.js`
Expected: PASS（2 tests）

- [ ] **Step 5: Commit**

```bash
git add lib/diagnosis-store.js test/diagnosis-store.test.js
git commit -m "feat: 診断ログ行の先頭に案件IDを追加(TDD)"
```

---

## Task 4: Sheets行更新ヘルパ（findRowNumber TDD ＋ updateRowById）

**Files:**
- Modify: `lib/sheets.js`
- Test: `test/sheets-helpers.test.js`

- [ ] **Step 1: Write the failing test for the pure helper**

`test/sheets-helpers.test.js`:

```javascript
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { findRowNumber } = require('../lib/sheets');

const ROWS = [
  ['case_id', 'brand_id'],     // header (row 1)
  ['C-0001', 'B-0001'],        // row 2
  ['C-0002', 'B-0002'],        // row 3
];

test('IDから1始まりの行番号を返す（ヘッダーはスキップ）', () => {
  assert.strictEqual(findRowNumber(ROWS, 0, 'C-0002'), 3);
  assert.strictEqual(findRowNumber(ROWS, 0, 'C-0001'), 2);
});

test('見つからなければ-1', () => {
  assert.strictEqual(findRowNumber(ROWS, 0, 'C-9999'), -1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/sheets-helpers.test.js`
Expected: FAIL（`findRowNumber is not a function`）

- [ ] **Step 3: Add findRowNumber and updateRowById to lib/sheets.js**

`lib/sheets.js` の `module.exports = { appendRow, readRows, readAllowlist };` を次に置換：

```javascript
/** rows（ヘッダー込み）から idColIndex列がidの行の1始まり行番号を返す。無ければ-1。 */
function findRowNumber(rows, idColIndex, id) {
  for (let i = 1; i < rows.length; i++) {
    if ((rows[i] || [])[idColIndex] === id) return i + 1;
  }
  return -1;
}

/** idColIndex列がidの行をrowArrayで上書きする。 */
async function updateRowById(spreadsheetId, tabName, idColIndex, id, rowArray) {
  const rows = await readRows(spreadsheetId, tabName);
  const rowNumber = findRowNumber(rows, idColIndex, id);
  if (rowNumber === -1) throw new Error('対象が見つかりません: ' + id);
  const sheets = await getClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${tabName}!A${rowNumber}:Z${rowNumber}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [rowArray] },
  });
}

module.exports = { appendRow, readRows, readAllowlist, findRowNumber, updateRowById };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/sheets-helpers.test.js`
Expected: PASS（2 tests）

- [ ] **Step 5: Commit**

```bash
git add lib/sheets.js test/sheets-helpers.test.js
git commit -m "feat: Sheets行更新ヘルパ(findRowNumber/updateRowById)を追加"
```

---

## Task 5: CRUDエンドポイント＋診断のcaseId連携（cockpit-server.js）

**Files:**
- Modify: `cockpit-server.js`

- [ ] **Step 1: Add requires**

`const { toDiagnosisRow } = require('./lib/diagnosis-store');` の直後に追加：

```javascript
const crm = require('./lib/crm-store');
const { nextId } = require('./lib/id-gen');
const { readRows, updateRowById } = require('./lib/sheets');
```

注：既存行で `appendRow, readAllowlist` は分割代入済み。`readRows`/`updateRowById` を新たに取り込む。
既存の `const { appendRow, readAllowlist } = require('./lib/sheets');` 行を
`const { appendRow, readAllowlist, readRows, updateRowById } = require('./lib/sheets');` に変更し、
上の `readRows/updateRowById` の追加requireは不要にする（重複requireを避けるためこちらを採用）。

- [ ] **Step 2: Add a small helper for ID column reads**

`async function requireAuth(...)` の定義の前に追加：

```javascript
// 指定タブの既存ID（A列）一覧を返す（採番用）
async function existingIds(tabName) {
  const rows = await readRows(SHEET_ID, tabName);
  return rows.slice(1).map((r) => (r[0] || '')).filter(Boolean);
}
```

- [ ] **Step 3: Add the CRUD endpoints**

`app.post('/api/cockpit/astream-ingest', ...)` ブロックの直後（`app.post('/api/cockpit/analyze' ...)` の前後どちらでも可。ここでは analyze の直後）に追加：

```javascript
// --- ブランド ---
app.get('/api/cockpit/brands', requireAuth, async (req, res) => {
  try {
    const rows = await readRows(SHEET_ID, 'ブランド');
    res.json({ ok: true, brands: rows.slice(1).map(crm.parseBrand) });
  } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e).slice(0, 300) }); }
});
app.post('/api/cockpit/brands', requireAuth, async (req, res) => {
  try {
    crm.validateBrand(req.body || {});
    const id = nextId('B', await existingIds('ブランド'));
    await appendRow(SHEET_ID, 'ブランド', crm.toBrandRow(req.body, id));
    res.json({ ok: true, brand_id: id });
  } catch (e) {
    const bad = /必須項目/.test(e.message);
    res.status(bad ? 400 : 500).json({ ok: false, error: e.message });
  }
});

// --- 商品 ---
app.get('/api/cockpit/products', requireAuth, async (req, res) => {
  try {
    const rows = await readRows(SHEET_ID, '商品');
    let products = rows.slice(1).map(crm.parseProduct);
    if (req.query.brand_id) products = products.filter((p) => p.brand_id === req.query.brand_id);
    res.json({ ok: true, products });
  } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e).slice(0, 300) }); }
});
app.post('/api/cockpit/products', requireAuth, async (req, res) => {
  try {
    crm.validateProduct(req.body || {});
    const id = nextId('P', await existingIds('商品'));
    await appendRow(SHEET_ID, '商品', crm.toProductRow(req.body, id));
    res.json({ ok: true, product_id: id });
  } catch (e) {
    const bad = /必須項目/.test(e.message);
    res.status(bad ? 400 : 500).json({ ok: false, error: e.message });
  }
});

// --- 案件 ---
app.get('/api/cockpit/cases', requireAuth, async (req, res) => {
  try {
    const rows = await readRows(SHEET_ID, '案件');
    let cases = rows.slice(1).map(crm.parseCase);
    if (req.query.brand_id) cases = cases.filter((c) => c.brand_id === req.query.brand_id);
    if (req.query.status) cases = cases.filter((c) => c.status === req.query.status);
    res.json({ ok: true, cases });
  } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e).slice(0, 300) }); }
});
app.post('/api/cockpit/cases', requireAuth, async (req, res) => {
  try {
    crm.validateCase(req.body || {});
    const id = nextId('C', await existingIds('案件'));
    await appendRow(SHEET_ID, '案件', crm.toCaseRow(req.body, id));
    res.json({ ok: true, case_id: id });
  } catch (e) {
    const bad = /必須項目|不正なステータス/.test(e.message);
    res.status(bad ? 400 : 500).json({ ok: false, error: e.message });
  }
});
app.patch('/api/cockpit/cases', requireAuth, async (req, res) => {
  try {
    const { case_id } = req.body || {};
    if (!case_id) return res.status(400).json({ ok: false, error: '必須項目が不足しています: case_id' });
    const rows = await readRows(SHEET_ID, '案件');
    const existing = rows.slice(1).map(crm.parseCase).find((c) => c.case_id === case_id);
    if (!existing) return res.status(404).json({ ok: false, error: '案件が見つかりません: ' + case_id });
    const merged = { ...existing, ...req.body };
    crm.validateCase(merged);
    const row = crm.toCaseRow(merged, case_id, new Date(), existing.created);
    await updateRowById(SHEET_ID, '案件', 0, case_id, row);
    res.json({ ok: true, case_id });
  } catch (e) {
    const bad = /必須項目|不正なステータス/.test(e.message);
    res.status(bad ? 400 : 500).json({ ok: false, error: e.message });
  }
});
```

- [ ] **Step 4: Pass caseId into the YouTube diagnosis log**

既存の youtube エンドポイント内の保存呼び出しを変更。
現在：

```javascript
  runScriptThen('scripts/youtube/fetch_channel.js', a, res, async (data) => {
    if (SHEET_ID && data.ok) {
      try { await appendRow(SHEET_ID, '診断ログ', toDiagnosisRow(data, req.user)); } catch (e) {}
    }
  });
```

を次に変更（リクエストの caseId を刻む）：

```javascript
  const caseId = String((req.body || {}).caseId || '');
  runScriptThen('scripts/youtube/fetch_channel.js', a, res, async (data) => {
    if (SHEET_ID && data.ok) {
      try { await appendRow(SHEET_ID, '診断ログ', toDiagnosisRow(data, req.user, new Date(), caseId)); } catch (e) {}
    }
  });
```

- [ ] **Step 5: Verify the server boots and the new routes are auth-gated**

Run: `node --check cockpit-server.js && echo OK`
Expected: `OK`

Run:
```bash
node -e "require('./cockpit-server.js')" & SVPID=$!; sleep 1.5; \
curl -s -X POST localhost:3000/api/cockpit/cases -H 'Content-Type: application/json' -d '{}'; echo; \
curl -s localhost:3000/api/cockpit/brands; echo; kill $SVPID 2>/dev/null
```
Expected: 両方とも `{"ok":false,"error":"未ログイン"}`（requireAuth が先に効く）。
（ローカルは `.env` の PORT=3000 で待受。）

- [ ] **Step 6: Commit**

```bash
git add cockpit-server.js
git commit -m "feat: ブランド/商品/案件のCRUDエンドポイント＋診断のcaseId連携を追加"
```

---

## Task 6: フロント — 案件タブ＋現在の案件セレクタ＋診断のcaseId付与

**Files:**
- Modify: `public/cg-cockpit.html`

参照：`STEPS`配列、`RENDER`オブジェクト、`field(id,label,ph,ta)`、`api(path,body)`、`escapeHtml`、
`window.runYTBatch`、ヘッダー（`<header>...</header>` が行71-74）、`render()`（`#nav`/`#main`を描画）。

- [ ] **Step 1: Add the current-case bar element under the header**

`</header>` の直後、`<div class="wrap">` の前に追加：

```html
<div id="casebar" style="padding:6px 16px;background:#F4F7FB;border-bottom:1px solid var(--line);font-size:12.5px;display:flex;align-items:center;gap:8px;flex-wrap:wrap"></div>
```

- [ ] **Step 2: Add active-case state and the case-bar renderer**

`let current="flow";` の直前に追加：

```javascript
let ACTIVE_CASE = localStorage.getItem("cg_active_case") || "";
function caseId(){ return ACTIVE_CASE; }
async function renderCaseBar(){
  const bar=document.getElementById("casebar");
  let cases=[];
  try{ const r=await api("/api/cockpit/cases",{}); if(r.ok) cases=r.cases||[]; }catch(e){}
  const opts=['<option value="">（現在の案件：未選択）</option>']
    .concat(cases.map(c=>`<option value="${c.case_id}" ${c.case_id===ACTIVE_CASE?"selected":""}>${escapeHtml(c.case_id+" "+c.name+"（"+c.status+"）")}</option>`));
  bar.innerHTML=`<b>現在の案件</b>
    <select id="activecase" onchange="setActiveCase(this.value)" style="max-width:60%">${opts.join("")}</select>
    <span style="color:var(--muted)">選択中は診断結果がこの案件に紐づきます</span>`;
}
window.setActiveCase=(v)=>{ ACTIVE_CASE=v||""; localStorage.setItem("cg_active_case",ACTIVE_CASE); };
```

注：`api()` は GET 用に作られていない（POST固定）。`/api/cockpit/cases` の一覧取得は GET だが、
本ハンドラ群は GET も用意している。`api()` はPOSTを送るため、ここでは一覧取得専用の軽い GET ヘルパを使う。
`api()` 定義の直後に次を追加：

```javascript
async function apiGet(path){
  let r;
  try{ r=await fetch(API_BASE+path,{ headers:{ "Authorization":"Bearer "+ID_TOKEN } }); }
  catch(e){ throw new Error("通信エラー（リロードせず再実行してください）"); }
  if(r.status===401){ showLogin("再ログインしてください"); throw new Error("未ログイン"); }
  if(r.status===403){ showLogin("このアカウントは許可リストにありません"); throw new Error("許可リスト外"); }
  try{ return await r.json(); }catch(e){ throw new Error("応答の解析に失敗（HTTP "+r.status+"）"); }
}
```

そして `renderCaseBar` 内の `await api("/api/cockpit/cases",{})` を `await apiGet("/api/cockpit/cases")` に変更。

- [ ] **Step 3: Register the 案件 tab in STEPS**

`const STEPS = [...]` の `{id:"hearing", ...}` の直後に追加（案件を上流に置く）：

```javascript
  {id:"case", t:"案件", sub:"ブランド→商品→案件を登録し、現在の案件にセット"},
```

- [ ] **Step 4: Add the case() view to RENDER**

`RENDER` オブジェクトの `hearing(){...},` の直後に追加：

```javascript
  case(){
    return `<div class="card"><h3>① ブランド</h3>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">
        <div style="flex:1;min-width:160px"><label>既存ブランドを選択</label><select id="cs_brand" onchange="onBrandChange()"><option value="">―</option></select></div>
      </div>
      <details style="margin-top:8px"><summary style="cursor:pointer">＋ 新規ブランドを登録</summary>
        ${field("cs_b_name","ブランド名","株式会社〇〇 / ブランド名")}
        <div class="row">${field("cs_b_industry","業種・カテゴリ","美容/食品 等")}${field("cs_b_contact","担当・連絡先（任意）","")}</div>
        <button class="btn" onclick="createBrand()">ブランドを登録</button>
      </details>
      <div id="cs_brand_msg" style="margin-top:6px;font-size:12.5px"></div></div>

    <div class="card"><h3>② 商品</h3>
      <div><label>このブランドの商品を選択</label><select id="cs_product"><option value="">―</option></select></div>
      <details style="margin-top:8px"><summary style="cursor:pointer">＋ 新規商品を登録</summary>
        ${field("cs_p_name","商品名","")}
        <div class="row">${field("cs_p_category","カテゴリ","スキンケア 等")}${field("cs_p_price","価格帯","定価/メガ割")}</div>
        ${field("cs_p_url","URL（任意）","Qoo10/公式")}
        <button class="btn" onclick="createProduct()">商品を登録</button>
      </details>
      <div id="cs_product_msg" style="margin-top:6px;font-size:12.5px"></div></div>

    <div class="card"><h3>③ 案件を作成</h3>
      ${field("cs_c_name","案件名","〇〇コスメ 6月メガ割 等")}
      <div class="row">${field("cs_c_season","商戦時期","2026-06 メガ割 等")}${field("cs_c_budget","予算","")}</div>
      ${field("cs_c_goal","目標","目標売上・KPI 等","ta")}
      <button class="btn" onclick="createCase()">案件を作成して現在の案件にセット</button>
      <div id="cs_case_msg" style="margin-top:6px;font-size:12.5px"></div></div>

    <div class="card"><h3>📋 案件一覧</h3>
      <div style="margin-bottom:6px"><label>ステータスで絞り込み</label>
        <select id="cs_filter" onchange="loadCases()"><option value="">すべて</option>${crm_status_options()}</select></div>
      <div id="cs_list" style="font-size:12.5px">読み込み中…</div></div>`;
  },
```

- [ ] **Step 5: Add the case-tab handlers and the status options helper**

`window.setActiveCase=...` の直後に追加：

```javascript
const CASE_STATUSES = ['受注','ヒアリング','候補リスト作成','クライアント選定待ち','起用交渉','制作進行','投稿済み','成果回収・完了','見送り・中止'];
function crm_status_options(){ return CASE_STATUSES.map(s=>`<option value="${s}">${s}</option>`).join(""); }

async function fillBrandSelect(){
  const sel=document.getElementById("cs_brand"); if(!sel) return;
  try{ const r=await apiGet("/api/cockpit/brands"); if(r.ok){
    sel.innerHTML='<option value="">―</option>'+r.brands.map(b=>`<option value="${b.brand_id}">${escapeHtml(b.name)}</option>`).join("");
  }}catch(e){}
}
window.onBrandChange=async()=>{
  const bid=document.getElementById("cs_brand").value;
  const sel=document.getElementById("cs_product"); sel.innerHTML='<option value="">―</option>';
  if(!bid) return;
  try{ const r=await apiGet("/api/cockpit/products?brand_id="+encodeURIComponent(bid)); if(r.ok){
    sel.innerHTML='<option value="">―</option>'+r.products.map(p=>`<option value="${p.product_id}">${escapeHtml(p.name)}</option>`).join("");
  }}catch(e){}
};
window.createBrand=async()=>{
  const msg=document.getElementById("cs_brand_msg");
  const body={ name:(document.getElementById("cs_b_name").value||"").trim(),
    industry:(document.getElementById("cs_b_industry").value||"").trim(),
    contact:(document.getElementById("cs_b_contact").value||"").trim() };
  if(!body.name){ msg.innerHTML="<span style='color:#A32D2D'>ブランド名を入力してください</span>"; return; }
  try{ const r=await api("/api/cockpit/brands",body);
    if(r.ok){ msg.innerHTML="✅ 登録: "+r.brand_id; await fillBrandSelect(); document.getElementById("cs_brand").value=r.brand_id; onBrandChange(); }
    else msg.innerHTML="<span style='color:#A32D2D'>"+escapeHtml(r.error)+"</span>";
  }catch(e){ msg.innerHTML="<span style='color:#A32D2D'>"+escapeHtml(e.message)+"</span>"; }
};
window.createProduct=async()=>{
  const msg=document.getElementById("cs_product_msg");
  const brand_id=document.getElementById("cs_brand").value;
  if(!brand_id){ msg.innerHTML="<span style='color:#A32D2D'>先にブランドを選択してください</span>"; return; }
  const body={ brand_id, name:(document.getElementById("cs_p_name").value||"").trim(),
    category:(document.getElementById("cs_p_category").value||"").trim(),
    price:(document.getElementById("cs_p_price").value||"").trim(),
    url:(document.getElementById("cs_p_url").value||"").trim() };
  if(!body.name){ msg.innerHTML="<span style='color:#A32D2D'>商品名を入力してください</span>"; return; }
  try{ const r=await api("/api/cockpit/products",body);
    if(r.ok){ msg.innerHTML="✅ 登録: "+r.product_id; await onBrandChange(); document.getElementById("cs_product").value=r.product_id; }
    else msg.innerHTML="<span style='color:#A32D2D'>"+escapeHtml(r.error)+"</span>";
  }catch(e){ msg.innerHTML="<span style='color:#A32D2D'>"+escapeHtml(e.message)+"</span>"; }
};
window.createCase=async()=>{
  const msg=document.getElementById("cs_case_msg");
  const brand_id=document.getElementById("cs_brand").value;
  const product_id=document.getElementById("cs_product").value;
  if(!brand_id||!product_id){ msg.innerHTML="<span style='color:#A32D2D'>ブランドと商品を選択してください</span>"; return; }
  const body={ brand_id, product_id, name:(document.getElementById("cs_c_name").value||"").trim(),
    season:(document.getElementById("cs_c_season").value||"").trim(),
    budget:(document.getElementById("cs_c_budget").value||"").trim(),
    goal:(document.getElementById("cs_c_goal").value||"").trim() };
  if(!body.name){ msg.innerHTML="<span style='color:#A32D2D'>案件名を入力してください</span>"; return; }
  try{ const r=await api("/api/cockpit/cases",body);
    if(r.ok){ setActiveCase(r.case_id); msg.innerHTML="✅ 作成して現在の案件にセット: "+r.case_id; await renderCaseBar(); await loadCases(); }
    else msg.innerHTML="<span style='color:#A32D2D'>"+escapeHtml(r.error)+"</span>";
  }catch(e){ msg.innerHTML="<span style='color:#A32D2D'>"+escapeHtml(e.message)+"</span>"; }
};
window.loadCases=async()=>{
  const el=document.getElementById("cs_list"); if(!el) return;
  const f=document.getElementById("cs_filter"); const status=f?f.value:"";
  try{
    const r=await apiGet("/api/cockpit/cases"+(status?"?status="+encodeURIComponent(status):""));
    if(!r.ok){ el.innerHTML="<span style='color:#A32D2D'>"+escapeHtml(r.error||"取得失敗")+"</span>"; return; }
    if(!r.cases.length){ el.innerHTML="<span style='color:var(--muted)'>案件がありません</span>"; return; }
    el.innerHTML=r.cases.map(c=>`<div style="padding:6px 0;border-bottom:1px solid var(--line)">
      <b>${escapeHtml(c.case_id)}</b> ${escapeHtml(c.name)}
      <select onchange="updateCaseStatus('${c.case_id}',this.value)" style="font-size:12px">
        ${CASE_STATUSES.map(s=>`<option ${s===c.status?"selected":""}>${s}</option>`).join("")}
      </select>
      <button class="btn" style="padding:2px 8px;font-size:11.5px" onclick="setActiveCase('${c.case_id}');renderCaseBar()">現在の案件に</button>
      <span style="color:var(--muted);font-size:11.5px">${escapeHtml(c.season||"")} ${escapeHtml(c.brand_id)}/${escapeHtml(c.product_id)}</span></div>`).join("");
  }catch(e){ el.innerHTML="<span style='color:#A32D2D'>"+escapeHtml(e.message)+"</span>"; }
};
window.updateCaseStatus=async(case_id,status)=>{
  try{ await api("/api/cockpit/cases",{case_id,status,_method:"PATCH"}); }catch(e){}
  await renderCaseBar();
};
```

注：`api()` はPOST固定のため、PATCHは下記Step 6でPATCH対応の小ヘルパ `apiPatch` を使う。
上の `updateCaseStatus` の `api(...)` 呼び出しを `apiPatch("/api/cockpit/cases",{case_id,status})` に置換する。

- [ ] **Step 6: Add apiPatch helper and wire diagnosis + tab load**

`apiGet` の直後に追加：

```javascript
async function apiPatch(path, body){
  let r;
  try{ r=await fetch(API_BASE+path,{ method:"PATCH",
    headers:{ "Content-Type":"application/json","Authorization":"Bearer "+ID_TOKEN }, body:JSON.stringify(body) }); }
  catch(e){ throw new Error("通信エラー（リロードせず再実行してください）"); }
  if(r.status===401){ showLogin("再ログインしてください"); throw new Error("未ログイン"); }
  if(r.status===403){ showLogin("このアカウントは許可リストにありません"); throw new Error("許可リスト外"); }
  try{ return await r.json(); }catch(e){ throw new Error("応答の解析に失敗（HTTP "+r.status+"）"); }
}
```

`window.updateCaseStatus` 内の `api("/api/cockpit/cases",{case_id,status,_method:"PATCH"})` を
`apiPatch("/api/cockpit/cases",{case_id,status})` に置換。

`window.runYTBatch=async()=>{` 内の診断呼び出し
`const d=await api("/api/cockpit/youtube",{input:c,prOnly});`（複数箇所がある場合は YouTube一括の該当行）を、
caseId を同送する形に変更：

```javascript
      const d=await api("/api/cockpit/youtube",{input:c,prOnly,caseId:caseId()});
```

（`runYTBatch` の実際の変数名に合わせる。対象は `/api/cockpit/youtube` を呼ぶ箇所のみ。）

- [ ] **Step 7: Render the case bar on load and when entering the case tab**

`render();`（最終行付近、`initAuth();` の後）の直前または直後に、ケースバー初期化とタブ遷移時のロードを追加。
`window.go=(id)=>{current=id;render();window.scrollTo(0,0);};` を次に置換：

```javascript
window.go=(id)=>{current=id;render();window.scrollTo(0,0);
  if(id==="case"){ fillBrandSelect(); loadCases(); }
};
```

そして最終行の `render();` の直後に追加：

```javascript
renderCaseBar();
```

- [ ] **Step 8: Verify inline script parses**

Run:
```bash
node -e 'const fs=require("fs"),vm=require("vm");const h=fs.readFileSync("public/cg-cockpit.html","utf8");const s=[...h.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);s.forEach((x,i)=>{try{new vm.Script(x)}catch(e){console.log("ERR",i,e.message)}});console.log("parsed",s.length)'
```
Expected: `parsed 1`、ERR行なし。

Run: `grep -n 'id:"case"\|renderCaseBar\|window.createCase\|apiPatch\|caseId:caseId()' public/cg-cockpit.html`
Expected: 各識別子が存在する。

- [ ] **Step 9: Commit**

```bash
git add public/cg-cockpit.html
git commit -m "feat: 案件タブ（ブランド/商品/案件登録・一覧）と現在の案件セレクタ、診断のcaseId連携を追加"
```

---

## Task 7: Sheetsタブ初期化GASスニペット

**Files:**
- Create: `scripts/setup/build_crm_sheets.gs`

- [ ] **Step 1: Create the GAS script**

`scripts/setup/build_crm_sheets.gs`:

```javascript
/**
 * build_crm_sheets.gs — CRMタブ（ブランド/商品/案件）作成＋診断ログに案件ID列を追加
 * 使い方：対象スプレッドシートの拡張機能 > Apps Script に貼り、buildCrmSheets を実行。
 * 既存タブがあればヘッダーのみ確認し、無ければ作成する。冪等。
 */
function buildCrmSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var defs = {
    'ブランド': ['brand_id','ブランド名','業種・カテゴリ','担当・連絡先','メモ','作成日','最終更新'],
    '商品': ['product_id','brand_id','商品名','カテゴリ','価格帯','URL','需要タイプ','メモ','作成日','最終更新'],
    '案件': ['case_id','brand_id','product_id','案件名','ステータス','商戦時期','予算','目標','メモ','作成日','最終更新']
  };
  Object.keys(defs).forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    var headers = defs[name];
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sh.setFrozenRows(1);
  });

  // 診断ログの先頭に「案件ID」列を追加（未追加の場合のみ）
  var log = ss.getSheetByName('診断ログ');
  if (log) {
    var first = log.getRange(1, 1).getValue();
    if (first !== '案件ID') {
      log.insertColumnBefore(1);
      log.getRange(1, 1).setValue('案件ID').setFontWeight('bold');
    }
  }
  SpreadsheetApp.getUi().alert('✅ CRMタブを準備しました（ブランド/商品/案件＋診断ログの案件ID列）');
}
```

- [ ] **Step 2: Commit**

```bash
git add scripts/setup/build_crm_sheets.gs
git commit -m "feat: CRMタブ初期化GASスニペット(build_crm_sheets.gs)を追加"
```

---

## Task 8: 全テスト＆結合確認（デプロイ後・手動）

**Files:** なし（検証）

- [ ] **Step 1: Run the full test suite**

Run: `node --test`
Expected: 既存（authz/diagnosis-store/analyze-prompt）＋ id-gen/crm-store/sheets-helpers の全テスト PASS。

- [ ] **Step 2: Sheets初期化（ユーザー）**

`scripts/setup/build_crm_sheets.gs` を対象スプレッドシートのApps Scriptに貼り、`buildCrmSheets` を実行。
ブランド/商品/案件タブ＋診断ログ案件ID列ができることを確認。

- [ ] **Step 3: 再デプロイ（ユーザー）**

Run: `gcloud run deploy cg-cockpit --source . --region asia-northeast1`

- [ ] **Step 4: 最新HTMLをXserver再アップロード（ユーザー）**

- [ ] **Step 5: 画面で確認（ユーザー）**

- 案件タブ：ブランド登録→商品登録→案件作成 ができ、案件一覧に出る
- ヘッダーの「現在の案件」に作成した案件が選択された状態になる
- YouTube一括診断を実行 → 診断ログの「案件ID」列に現在の案件IDが入る
- 案件一覧のステータスを変更 → 再読込しても保持される

---

## Self-Review 結果

- **Spec coverage:**
  - データモデル3タブ＋ID自動採番 = Task1,2,7 / 診断ログ案件ID列 = Task3,7
  - 案件タブ（登録・一覧・編集）= Task6 / 現在の案件セレクタ＋診断自動紐付け = Task5(Step4),6
  - CRUDエンドポイント（brands/products/cases GET/POST/PATCH）= Task5
  - ステータス8段階＋見送り・中止 = Task2（CASE_STATUSES）, Task6（CASE_STATUSES）
  - エラーハンドリング（必須400/不正ステータス400/認証/Sheets500/未選択は許可）= Task5
  - デプロイ手順 = Task7,8
- **Placeholder scan:** 「実際の変数名に合わせる」等は既存コードに依存する1箇所（runYTBatchのcaseId付与）のみで、対象（`/api/cockpit/youtube`呼び出し）と付与内容を明示済み。その他プレースホルダなし。
- **Type consistency:**
  - `toDiagnosisRow(result, user, now, caseId)` をTask3で定義しTask5で使用。
  - `nextId(prefix, ids)` Task1定義→Task5使用。
  - crm `toBrandRow/parseBrand` 等（created任意引数）Task2定義→Task5 POST/PATCHで使用（PATCHは既存created保持）。
  - `findRowNumber/updateRowById` Task4定義→Task5 PATCHで使用。
  - フロント `apiGet`(GET)/`apiPatch`(PATCH)/`api`(POST) を用途別に使用、`caseId()` 定義→runYTBatch使用、`CASE_STATUSES` フロント定義はサーバ定義と同一9値。
