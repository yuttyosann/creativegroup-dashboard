# S2c 実績（ROAS）入力→候補DB反映 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新「実績」タブで案件完了後の実績（売上/費用）を入力してROASを自動計算・保存し、候補DB（インフルエンサーDB）の実績サマリーへ案件ごとに追記反映する。

**Architecture:** S2a/S2bと同じ Node/Sheets 構成。ROAS計算とサマリー生成を純粋関数 `lib/result-store.js` にTDDで切り出し、`cockpit-server.js` にエンドポイント3本、`public/cg-cockpit.html` に実績タブを追加。反映は既存の `lib/influencer-store.js` のupsertを再利用。

**Tech Stack:** Node.js / Express、googleapis（Sheets）、Vanilla JS、node:test（TDD）、Google Apps Script。

---

## File Structure

- **Create** `lib/result-store.js` — 実績の列定義・ROAS計算・行マッパー・バリデーション・サマリー生成（純粋関数）。
- **Create** `test/result-store.test.js`
- **Modify** `cockpit-server.js` — GET `case-influencers` / GET `results` / POST `results`（upsert＋候補DB反映）。
- **Modify** `public/cg-cockpit.html` — 実績タブ（案件選択→インフル自動列挙→実績入力→保存）。
- **Create** `scripts/setup/build_result_db.gs` — 実績タブ作成GAS。

既存パターン（`lib/`純粋関数＋`test/`、`RENDER`/`STEPS`/`api`/`apiGet`、`updateRowById`/`nextId`）に従う。

---

## Task 1: 実績計算・行マッパー・サマリー生成（TDD）

**Files:**
- Create: `lib/result-store.js`
- Test: `test/result-store.test.js`

- [ ] **Step 1: Write the failing test**

`test/result-store.test.js`:

```javascript
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const rst = require('../lib/result-store');

const NOW = new Date('2026-06-24T00:00:00Z');

test('computeResult: 既存式（総コスト=費+売上×報酬率, ROAS=売上/総コスト×100, 損益=売上-総コスト）', () => {
  // 売上8,586,717 / タイアップ費2,000,000 / 報酬20%
  const c = rst.computeResult({ sales: 8586717, fee: 2000000, rewardRate: 20 });
  const totalCost = 2000000 + 8586717 * 0.2; // 3,717,343.4
  assert.strictEqual(c.totalCost, totalCost);
  assert.strictEqual(c.roas, Math.round(8586717 / totalCost * 100)); // 231
  assert.strictEqual(c.profit, 8586717 - totalCost);
});

test('computeResult: 総コスト0ならROAS0（ゼロ除算回避）', () => {
  const c = rst.computeResult({ sales: 0, fee: 0, rewardRate: 0 });
  assert.strictEqual(c.totalCost, 0);
  assert.strictEqual(c.roas, 0);
  assert.strictEqual(c.profit, 0);
});

test('computeResult: カンマ/空文字は数値化', () => {
  const c = rst.computeResult({ sales: '1,000', fee: '500', rewardRate: '' });
  assert.strictEqual(c.totalCost, 500);
  assert.strictEqual(c.roas, 200);
  assert.strictEqual(c.profit, 500);
});

test('buildSummaryLine: profit≥0で黒字・<0で赤字', () => {
  assert.strictEqual(rst.buildSummaryLine('6月メガ割', 231, 100), '6月メガ割 ROAS231% 黒字');
  assert.strictEqual(rst.buildSummaryLine('6月メガ割', 80, -50), '6月メガ割 ROAS80% 赤字');
  assert.strictEqual(rst.buildSummaryLine('', 120, 10), 'ROAS120% 黒字'); // ラベル空
});

test('mergeSummaryLine: 新規追記・同一案件IDは置換・他案件は保持', () => {
  assert.strictEqual(rst.mergeSummaryLine('', 'C-0001', 'ROAS231% 黒字'), 'C-0001 ROAS231% 黒字');
  const merged = rst.mergeSummaryLine('C-0001 古い\nC-0002 維持', 'C-0001', '6月メガ割 ROAS50% 赤字');
  assert.strictEqual(merged, 'C-0002 維持\nC-0001 6月メガ割 ROAS50% 赤字');
});

test('validateResult: case_id/account 必須', () => {
  assert.throws(() => rst.validateResult({ account: 'a' }), /案件ID/);
  assert.throws(() => rst.validateResult({ case_id: 'C-0001' }), /アカウント名/);
  assert.doesNotThrow(() => rst.validateResult({ case_id: 'C-0001', account: 'a' }));
});

test('toResultRow↔parseResult 往復（計算列含む）', () => {
  const row = rst.toResultRow({ case_id: 'C-0001', account: 'sachi', media: 'YouTube', sales: 1000, fee: 500, rewardRate: 0 }, 'R-0001', NOW);
  const o = rst.parseResult(row);
  assert.strictEqual(o.result_id, 'R-0001');
  assert.strictEqual(o.case_id, 'C-0001');
  assert.strictEqual(o.account, 'sachi');
  assert.strictEqual(String(o.roas), '200');
  assert.strictEqual(o.updated, '2026-06-24');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/result-store.test.js`
Expected: FAIL（`Cannot find module '../lib/result-store'`）

- [ ] **Step 3: Write minimal implementation**

`lib/result-store.js`:

```javascript
'use strict';
/**
 * result-store.js — 実績の列定義・ROAS計算・行マッパー・サマリー生成（純粋関数）
 * ROAS式は既存案件DB(GAS)の慣習に合わせる：総コスト=タイアップ費+売上×成果報酬率、ROAS=売上/総コスト。
 */

const RESULT_HEADERS = [
  'result_id', '案件ID', 'アカウント名', '媒体', '実施日', '実売数', '売上', 'タイアップ費',
  '成果報酬率%', '総コスト', 'ROAS%', '損益', 'メモ', '記録者', '最終更新',
];

function isoDate(now) { return now.toISOString().slice(0, 10); }
function num(v) { const n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, '')); return isNaN(n) ? 0 : n; }

function computeResult({ sales, fee, rewardRate } = {}) {
  const s = num(sales), f = num(fee), r = num(rewardRate);
  const totalCost = f + s * (r / 100);
  const roas = totalCost > 0 ? Math.round(s / totalCost * 100) : 0;
  const profit = s - totalCost;
  return { totalCost, roas, profit };
}

function validateResult(o) {
  if (!o || !String(o.case_id || '').trim()) throw new Error('必須項目が不足しています: 案件ID');
  if (!String(o.account || '').trim()) throw new Error('必須項目が不足しています: アカウント名');
}

function toResultRow(o, id, now = new Date()) {
  const c = computeResult({ sales: o.sales, fee: o.fee, rewardRate: o.rewardRate });
  return [
    id, o.case_id || '', o.account || '', o.media || '', o.date || '', o.units || '',
    o.sales || '', o.fee || '', o.rewardRate || '', c.totalCost, c.roas, c.profit,
    o.note || '', o.registrant || '', isoDate(now),
  ];
}

function parseResult(r) {
  return {
    result_id: r[0] || '', case_id: r[1] || '', account: r[2] || '', media: r[3] || '', date: r[4] || '',
    units: r[5] || '', sales: r[6] || '', fee: r[7] || '', rewardRate: r[8] || '', totalCost: r[9] || '',
    roas: r[10] || '', profit: r[11] || '', note: r[12] || '', registrant: r[13] || '', updated: r[14] || '',
  };
}

function buildSummaryLine(caseLabel, roas, profit) {
  const head = caseLabel ? caseLabel + ' ' : '';
  return `${head}ROAS${roas}% ${num(profit) >= 0 ? '黒字' : '赤字'}`;
}

// 既存サマリー（改行区切り）から行頭が同じ案件IDの行を除き、新行を「<caseId> <line>」として追記
function mergeSummaryLine(existingSummary, caseId, line) {
  const lines = String(existingSummary || '').split('\n').map((s) => s.trim()).filter(Boolean)
    .filter((l) => !l.startsWith(caseId + ' '));
  lines.push(caseId + ' ' + line);
  return lines.join('\n');
}

module.exports = { RESULT_HEADERS, computeResult, validateResult, toResultRow, parseResult, buildSummaryLine, mergeSummaryLine };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/result-store.test.js`
Expected: PASS（7 tests）

- [ ] **Step 5: Commit**

```bash
git add lib/result-store.js test/result-store.test.js
git commit -m "feat: 実績のROAS計算・サマリー生成・行マッパーを追加(TDD)"
```

---

## Task 2: 実績エンドポイント（case-influencers / results GET・POST upsert＋反映）

**Files:**
- Modify: `cockpit-server.js`

- [ ] **Step 1: Add the require**

既存の `const inf = require('./lib/influencer-store');` の直後に追加：

```javascript
const rst = require('./lib/result-store');
```

- [ ] **Step 2: Add the endpoints**

`app.post('/api/cockpit/influencers', ...)` ブロックの直後（`app.get('/', ...)` の前）に追加：

```javascript
// --- 実績 ---
// 案件で診断したインフルを診断ログから列挙（診断ログ列: [案件ID,日付,実行者,媒体,チャンネル名,...]）
app.get('/api/cockpit/case-influencers', requireAuth, async (req, res) => {
  try {
    const caseId = String(req.query.case_id || '');
    if (!caseId) return res.json({ ok: true, influencers: [] });
    const rows = await readRows(SHEET_ID, '診断ログ');
    const seen = new Set(); const out = [];
    rows.slice(1).forEach((r) => {
      if ((r[0] || '') !== caseId) return;
      const account = (r[4] || '').trim(); const media = (r[3] || '').trim();
      const key = media + '|' + account.toLowerCase();
      if (account && !seen.has(key)) { seen.add(key); out.push({ account, media }); }
    });
    res.json({ ok: true, influencers: out });
  } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e).slice(0, 300) }); }
});
app.get('/api/cockpit/results', requireAuth, async (req, res) => {
  try {
    const caseId = String(req.query.case_id || '');
    const rows = await readRows(SHEET_ID, '実績');
    let results = rows.slice(1).map(rst.parseResult);
    if (caseId) results = results.filter((x) => x.case_id === caseId);
    res.json({ ok: true, results });
  } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e).slice(0, 300) }); }
});
app.post('/api/cockpit/results', requireAuth, async (req, res) => {
  try {
    const body = req.body || {};
    rst.validateResult(body);
    const caseId = String(body.case_id || '').trim();
    const account = String(body.account || '').trim().replace(/^@/, '');
    const media = String(body.media || '').trim();
    const incoming = { ...body, case_id: caseId, account, media, registrant: req.user.email };
    // 1) 実績タブにupsert（案件ID＋アカウント名）
    const rows = await readRows(SHEET_ID, '実績');
    const parsed = rows.slice(1).map(rst.parseResult);
    const existing = parsed.find((x) => x.case_id === caseId && (x.account || '').toLowerCase() === account.toLowerCase());
    let resultId;
    if (existing) {
      resultId = existing.result_id;
      await updateRowById(SHEET_ID, '実績', 0, resultId, rst.toResultRow(incoming, resultId));
    } else {
      resultId = nextId('R', parsed.map((x) => x.result_id).filter(Boolean));
      await appendRow(SHEET_ID, '実績', rst.toResultRow(incoming, resultId));
    }
    const comp = rst.computeResult({ sales: body.sales, fee: body.fee, rewardRate: body.rewardRate });
    // 2) 候補DB（インフルエンサーDB）の実績サマリーへ反映
    let reflected = false;
    try {
      const caseLabel = String(body.caseLabel || '').trim();
      const line = rst.buildSummaryLine(caseLabel, comp.roas, comp.profit);
      const irows = await readRows(SHEET_ID, 'インフルエンサーDB');
      const iparsed = irows.slice(1).map(inf.parseInfluencer);
      const iex = iparsed.find((x) => x.media === media && (x.account || '').toLowerCase() === account.toLowerCase());
      const mergedSummary = rst.mergeSummaryLine(iex ? iex.result : '', caseId, line);
      if (iex) {
        const m = inf.mergeInfluencer(iex, { account, media, result: mergedSummary });
        await updateRowById(SHEET_ID, 'インフルエンサーDB', 0, iex.inf_id, inf.toInfluencerRow(m, iex.inf_id));
      } else {
        const iid = nextId('I', iparsed.map((x) => x.inf_id).filter(Boolean));
        await appendRow(SHEET_ID, 'インフルエンサーDB', inf.toInfluencerRow({ account, media, result: mergedSummary, registrant: req.user.email }, iid));
      }
      reflected = true;
    } catch (e) { reflected = false; }
    res.json({ ok: true, result_id: resultId, roas: comp.roas, updated: !!existing, reflected });
  } catch (e) {
    const bad = /必須項目/.test(e.message);
    res.status(bad ? 400 : 500).json({ ok: false, error: String(e.message || e).slice(0, 300) });
  }
});
```

注：`readRows/updateRowById/appendRow/nextId/inf` は既にrequire済み。`rst` はStep 1で追加。

- [ ] **Step 3: Verify boot + auth gate**

Run: `node --check cockpit-server.js && echo OK`
Expected: `OK`

Run:
```bash
node -e "require('./cockpit-server.js')" & SVPID=$!; sleep 1.5; \
curl -s "localhost:3000/api/cockpit/results"; echo; \
curl -s "localhost:3000/api/cockpit/case-influencers?case_id=C-0001"; echo; \
curl -s -X POST localhost:3000/api/cockpit/results -H 'Content-Type: application/json' -d '{}'; echo; \
kill $SVPID 2>/dev/null
```
Expected: いずれも `{"ok":false,"error":"未ログイン"}`。

- [ ] **Step 4: Commit**

```bash
git add cockpit-server.js
git commit -m "feat: 実績エンドポイント（case-influencers/results GET・POST upsert＋候補DB反映）を追加"
```

---

## Task 3: フロント — 実績タブ

**Files:**
- Modify: `public/cg-cockpit.html`

参照：`STEPS`、`RENDER`、`api`（POST）、`apiGet`（GET）、`escapeHtml`。新グローバルは `IDB_ALL` 等のグローバル群の近くに追加。

- [ ] **Step 1: Register the 実績 tab in STEPS**

`const STEPS=[...]` の `{id:"record", ...}` エントリの直後に追加：

```javascript
  {id:"result", t:"実績", sub:"案件完了後の実績(ROAS)を入力し候補DBに反映"},
```

- [ ] **Step 2: Add the result() view to RENDER**

`RENDER` オブジェクトの `record(){...},` メソッドの直後に追加：

```javascript
  result(){
    return `<div class="card"><h3>📈 案件実績の入力</h3>
      <p style="font-size:12.5px;color:var(--muted);margin-bottom:8px">案件を選ぶと、その案件で診断したインフルが自動で並びます。実績を入力して保存すると候補DBの実績サマリーに反映されます。</p>
      <label>案件を選択</label>
      <select id="rs_case" onchange="onResultCaseChange()"><option value="">―</option></select>
      <div id="rs_rows" style="margin-top:10px;font-size:12.5px"></div>
      <div style="margin-top:8px"><button class="btn" onclick="addResultRow()">＋ インフルを手動追加</button></div></div>`;
  },
```

- [ ] **Step 3: Add the result-tab handlers**

`window.setActiveCase=...` 付近のグローバル群（`let IDB_ALL=[];` の近く）に追加：

```javascript
let RS_CASES=[];
window.__rsN=0;
async function loadResultCases(){
  const sel=document.getElementById("rs_case"); if(!sel) return;
  try{ const r=await apiGet("/api/cockpit/cases"); RS_CASES=(r.ok&&r.cases)?r.cases:[];
    sel.innerHTML='<option value="">―</option>'+RS_CASES.map(c=>`<option value="${c.case_id}">${escapeHtml(c.case_id+" "+c.name)}</option>`).join("");
  }catch(e){}
}
function rsCaseLabel(){ const c=RS_CASES.find(x=>x.case_id===document.getElementById("rs_case").value); return c?(c.name||c.season||c.case_id):""; }
function rsNum(v){ const n=parseFloat(String(v).replace(/[^0-9.\-]/g,"")); return isNaN(n)?0:n; }
function addResultRowSeed(inf, ex){
  const el=document.getElementById("rs_rows");
  const i=window.__rsN++;
  const med=['YouTube','Instagram','TikTok','X'];
  const v=(k)=> (ex&&ex[k]!=null)?ex[k]:"";
  const div=document.createElement("div");
  div.className="card"; div.style.padding="8px"; div.style.marginTop="6px";
  div.innerHTML=`<div class="row"><div><label>アカウント名</label><input id="rs_acc${i}" value="${escapeHtml(inf.account||"")}"></div>
      <div><label>媒体</label><select id="rs_med${i}">${med.map(m=>`<option ${m===inf.media?"selected":""}>${m}</option>`).join("")}</select></div></div>
    <div class="row"><div><label>売上</label><input id="rs_sales${i}" type="number" value="${escapeHtml(String(v('sales')))}" oninput="rsPreview(${i})"></div>
      <div><label>タイアップ費</label><input id="rs_fee${i}" type="number" value="${escapeHtml(String(v('fee')))}" oninput="rsPreview(${i})"></div></div>
    <div class="row"><div><label>成果報酬率%</label><input id="rs_rew${i}" type="number" value="${escapeHtml(String(v('rewardRate')))}" oninput="rsPreview(${i})"></div>
      <div><label>実売数</label><input id="rs_units${i}" type="number" value="${escapeHtml(String(v('units')))}"></div></div>
    <div class="row"><div><label>実施日</label><input id="rs_date${i}" value="${escapeHtml(String(v('date')))}" placeholder="2026-06"></div>
      <div><label>ROAS（自動）</label><input id="rs_roas${i}" readonly value="${v('roas')?v('roas')+'%':''}"></div></div>
    <button class="btn" onclick="saveResult(${i})">保存</button> <span id="rs_msg${i}" style="font-size:12px"></span>`;
  el.appendChild(div);
}
window.onResultCaseChange=async()=>{
  const cid=document.getElementById("rs_case").value;
  const el=document.getElementById("rs_rows");
  window.__rsN=0; el.innerHTML="";
  if(!cid) return;
  el.innerHTML="読み込み中…";
  let infls=[], results=[];
  try{ const a=await apiGet("/api/cockpit/case-influencers?case_id="+encodeURIComponent(cid)); if(a.ok) infls=a.influencers||[]; }catch(e){}
  try{ const b=await apiGet("/api/cockpit/results?case_id="+encodeURIComponent(cid)); if(b.ok) results=b.results||[]; }catch(e){}
  el.innerHTML="";
  const seen=new Set();
  infls.forEach(x=>{ const ex=results.find(r=>r.media===x.media && (r.account||"").toLowerCase()===(x.account||"").toLowerCase()); addResultRowSeed(x, ex||null); seen.add(x.media+"|"+(x.account||"").toLowerCase()); });
  results.forEach(r=>{ const k=r.media+"|"+(r.account||"").toLowerCase(); if(!seen.has(k)){ addResultRowSeed({account:r.account,media:r.media}, r); seen.add(k);} });
  if(!el.children.length) el.innerHTML="<span style='color:var(--muted)'>診断ログに該当インフルがありません。下の「手動追加」で入力できます。</span>";
};
window.addResultRow=()=>{ if(!document.getElementById("rs_case").value){ alert("先に案件を選択してください"); return; } if(document.getElementById("rs_rows").querySelector("span")) document.getElementById("rs_rows").innerHTML=""; addResultRowSeed({account:"",media:"Instagram"}, null); };
window.rsPreview=(i)=>{
  const s=rsNum(document.getElementById("rs_sales"+i).value), f=rsNum(document.getElementById("rs_fee"+i).value), r=rsNum(document.getElementById("rs_rew"+i).value);
  const tc=f+s*(r/100); const roas=tc>0?Math.round(s/tc*100):0;
  document.getElementById("rs_roas"+i).value=roas+"%";
};
window.saveResult=async(i)=>{
  const msg=document.getElementById("rs_msg"+i);
  const account=(document.getElementById("rs_acc"+i).value||"").trim().replace(/^@/,"");
  if(!account){ msg.innerHTML="<span style='color:#A32D2D'>アカウント名を入力してください</span>"; return; }
  const payload={ case_id:document.getElementById("rs_case").value, caseLabel:rsCaseLabel(), account,
    media:document.getElementById("rs_med"+i).value, date:document.getElementById("rs_date"+i).value,
    units:document.getElementById("rs_units"+i).value, sales:document.getElementById("rs_sales"+i).value,
    fee:document.getElementById("rs_fee"+i).value, rewardRate:document.getElementById("rs_rew"+i).value };
  try{ const r=await api("/api/cockpit/results",payload);
    if(r.ok){ document.getElementById("rs_roas"+i).value=r.roas+"%"; msg.innerHTML=`<span style='color:#1E7A46'>✅ 保存 ROAS${r.roas}% ${r.reflected?"（候補DB反映）":"（候補DB未登録のため新規作成）"}</span>`; }
    else msg.innerHTML="<span style='color:#A32D2D'>"+escapeHtml(r.error||"保存失敗")+"</span>";
  }catch(e){ msg.innerHTML="<span style='color:#A32D2D'>"+escapeHtml(e.message)+"</span>"; }
};
```

- [ ] **Step 4: Load cases when entering the result tab**

`window.go=(id)=>{...}` の関数本体に `result` 分岐を追加（既存の case/idb 分岐は保持）。`window.go` を次に置換：

```javascript
window.go=(id)=>{current=id;render();window.scrollTo(0,0);
  if(id==="case"){ fillBrandSelect(); loadCases(); }
  if(id==="idb"){ loadIdb(); }
  if(id==="result"){ loadResultCases(); }
};
```

- [ ] **Step 5: Verify parse + identifiers**

Run:
```bash
node -e 'const fs=require("fs"),vm=require("vm");const h=fs.readFileSync("public/cg-cockpit.html","utf8");const s=[...h.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);s.forEach((x,i)=>{try{new vm.Script(x)}catch(e){console.log("ERR",i,e.message)}});console.log("parsed",s.length)'
```
Expected: `parsed 1`、ERRなし。

Run: `grep -n 'id:"result"\|onResultCaseChange\|window.saveResult\|addResultRowSeed\|if(id==="result")' public/cg-cockpit.html`
Expected: 各識別子が存在。

- [ ] **Step 6: Commit**

```bash
git add public/cg-cockpit.html
git commit -m "feat: 実績タブ（案件選択→インフル自動列挙→ROAS入力→候補DB反映）を追加"
```

---

## Task 4: 実績タブ初期化GAS

**Files:**
- Create: `scripts/setup/build_result_db.gs`

- [ ] **Step 1: Create the GAS script**

`scripts/setup/build_result_db.gs`:

```javascript
/**
 * build_result_db.gs — 実績タブ作成（1行目ヘッダー）
 * 使い方：対象スプレッドシートの拡張機能 > Apps Script に貼り、buildResultDb を実行。冪等。
 */
function buildResultDb() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var headers = ['result_id','案件ID','アカウント名','媒体','実施日','実売数','売上','タイアップ費',
    '成果報酬率%','総コスト','ROAS%','損益','メモ','記録者','最終更新'];
  var sh = ss.getSheetByName('実績');
  if (!sh) sh = ss.insertSheet('実績');
  sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  sh.setFrozenRows(1);
  SpreadsheetApp.getUi().alert('✅ 実績タブを準備しました');
}
```

- [ ] **Step 2: Commit**

```bash
git add scripts/setup/build_result_db.gs
git commit -m "feat: 実績タブ初期化GAS(build_result_db.gs)を追加"
```

---

## Task 5: 全テスト＆結合確認（デプロイ後・手動）

**Files:** なし（検証）

- [ ] **Step 1: Run the full test suite**

Run: `node --test`
Expected: 既存＋ result-store の全テスト PASS。

- [ ] **Step 2: Sheets初期化（ユーザー）**

`scripts/setup/build_result_db.gs` を対象スプレッドシートのApps Scriptに貼り、`buildResultDb` を実行。実績タブができることを確認。

- [ ] **Step 3: 再デプロイ（ユーザー）**

Run: `gcloud run deploy cg-cockpit --source . --region asia-northeast1`

- [ ] **Step 4: 最新HTMLをXserver再アップロード（ユーザー）**

- [ ] **Step 5: 画面で確認（ユーザー）**

- 実績タブ：案件を選ぶ→その案件で診断したインフルが自動で並ぶ（無ければ手動追加）
- 売上/タイアップ費/成果報酬率を入力→ROASが自動表示→保存
- 保存後、候補DBタブでそのインフルの「実績サマリー」に `<案件名> ROAS<x>% 黒字/赤字` が入る（同一案件の再保存はその行が更新される）

---

## Self-Review 結果

- **Spec coverage:**
  - 実績タブ（result_id採番・案件ID＋アカウント名upsert）= Task1,2,4
  - ROAS自動計算（既存式）= Task1（computeResult）, Task3（プレビュー）
  - 対象インフル自動列挙（診断ログ）＋手動追加 = Task2（case-influencers）, Task3
  - 候補DB反映（案件ごと追記・案件ID重複排除・無ければ新規作成）= Task1（mergeSummaryLine/buildSummaryLine）, Task2（POST反映）
  - エラーハンドリング（必須400・総コスト0でROAS0・反映失敗でもreflected:false・認証・Sheets500）= Task1,2
  - GET results / case-influencers / POST results = Task2／デプロイ手順 = Task4,5
- **Placeholder scan:** 「実装時に確定」（カンマ除去・caseLabel）はTask1 `num()`／Task2/3 `caseLabel` として明示実装済み。プレースホルダなし。
- **Type consistency:**
  - `computeResult({sales,fee,rewardRate})→{totalCost,roas,profit}` Task1定義→Task2使用／Task3はクライアント側で同式を再現（保存時はサーバ再計算が正）。
  - `buildSummaryLine(caseLabel,roas,profit)`・`mergeSummaryLine(existing,caseId,line)`・`validateResult`・`toResultRow`/`parseResult` Task1定義→Task2使用。
  - フロント `loadResultCases`/`onResultCaseChange`/`addResultRowSeed`/`rsPreview`/`saveResult`/`rsCaseLabel`/`rsNum` Task3定義、go()分岐Task3 Step4で使用。
  - 反映は `inf.parseInfluencer`/`mergeInfluencer`/`toInfluencerRow`（S2b）を再利用、`result` フィールド経由。診断ログ列インデックス（媒体=3, チャンネル名=4）は `toDiagnosisRow`（案件ID先頭）と一致。
