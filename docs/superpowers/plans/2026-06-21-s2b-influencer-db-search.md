# S2b インフルエンサーDB＋フィルター検索（Mode B）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** コックピットが読み書きする「インフルエンサーDB」タブを新設し、YouTube診断・Astream取込の結果から「DBに登録」ボタンで候補をupsert、候補DBタブでフィルター検索できるようにする。

**Architecture:** S1/S2aと同じ Node/Sheets 構成。純粋ロジック（行マッパー・upsertマージ）を `lib/influencer-store.js` にTDDで切り出し、`cockpit-server.js` にGET/POST(upsert)エンドポイント、`public/cg-cockpit.html` に候補DBタブと「DBに登録」ボタンを追加。フィルタはクライアント側JS。

**Tech Stack:** Node.js / Express、googleapis（Sheets）、Vanilla JS、node:test（TDD）、Google Apps Script。

---

## File Structure

- **Create** `lib/influencer-store.js` — インフルエンサーDBの列定義・行マッパー・バリデーション・upsertマージ（純粋関数）。
- **Create** `test/influencer-store.test.js`
- **Modify** `cockpit-server.js` — GET/POST `/api/cockpit/influencers`（POSTは媒体＋アカウント名でupsert）。
- **Modify** `public/cg-cockpit.html` — 候補DBタブ（フィルタ＋テーブル＋手動追加）、`registerCand` ヘルパ、YouTube/Astream結果に「DBに登録」ボタン。
- **Create** `scripts/setup/build_influencer_db.gs` — インフルエンサーDBタブ作成GAS。

既存パターン（`lib/` 純粋関数＋`test/`、`RENDER`/`STEPS`/`api`/`apiGet`）に従う。

---

## Task 1: インフルエンサー行マッパー＋upsertマージ（TDD）

**Files:**
- Create: `lib/influencer-store.js`
- Test: `test/influencer-store.test.js`

- [ ] **Step 1: Write the failing test**

`test/influencer-store.test.js`:

```javascript
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
  assert.strictEqual(m.inf_id, 'I-0001');     // キー維持
  assert.strictEqual(m.account, 'sachi');     // キー維持（既存）
  assert.strictEqual(m.genre, '美容');         // 空は上書きしない
  assert.strictEqual(m.followers, '200');     // 非空は上書き
  assert.strictEqual(m.note, 'new');
  assert.strictEqual(m.conversion, '18');     // 新規フィールド反映
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/influencer-store.test.js`
Expected: FAIL（`Cannot find module '../lib/influencer-store'`）

- [ ] **Step 3: Write minimal implementation**

`lib/influencer-store.js`:

```javascript
'use strict';
/**
 * influencer-store.js — インフルエンサーDBの列定義・行マッパー・バリデーション・upsertマージ（純粋関数）
 * Sheetsの列順はここを単一の正とする。
 */

const INFLUENCER_HEADERS = [
  'inf_id', 'アカウント名', '媒体', 'ジャンル', 'コンテンツ型', 'フォロワー',
  '女性%', '中核年齢25-44%', 'スクリーニング', '転換質%', '実在率%', 'PRエンゲージ%',
  '適性メモ・向く商品', '実績サマリー', 'URL', '登録者', '最終更新',
];
const MEDIA_OPTIONS = ['YouTube', 'Instagram', 'TikTok', 'X'];

// objのフィールド ↔ 列のマッピング順（inf_id/最終更新を除く本体フィールド）
const FIELDS = ['account', 'media', 'genre', 'contentType', 'followers', 'female', 'coreAge', 'screening', 'conversion', 'realRate', 'prEngage', 'note', 'result', 'url', 'registrant'];

function isoDate(now) { return now.toISOString().slice(0, 10); }
function nonEmpty(v) { return v != null && String(v).trim() !== ''; }

function validateInfluencer(o) {
  if (!o || !nonEmpty(o.account)) throw new Error('必須項目が不足しています: アカウント名');
  if (!nonEmpty(o.media)) throw new Error('必須項目が不足しています: 媒体');
  if (!MEDIA_OPTIONS.includes(o.media)) throw new Error('不正な媒体: ' + o.media);
}

function toInfluencerRow(o, id, now = new Date()) {
  return [
    id, o.account || '', o.media || '', o.genre || '', o.contentType || '', o.followers || '',
    o.female || '', o.coreAge || '', o.screening || '', o.conversion || '', o.realRate || '', o.prEngage || '',
    o.note || '', o.result || '', o.url || '', o.registrant || '', isoDate(now),
  ];
}

function parseInfluencer(r) {
  return {
    inf_id: r[0] || '', account: r[1] || '', media: r[2] || '', genre: r[3] || '', contentType: r[4] || '',
    followers: r[5] || '', female: r[6] || '', coreAge: r[7] || '', screening: r[8] || '', conversion: r[9] || '',
    realRate: r[10] || '', prEngage: r[11] || '', note: r[12] || '', result: r[13] || '', url: r[14] || '',
    registrant: r[15] || '', updated: r[16] || '',
  };
}

// 既存に incoming の「空でない値だけ」を上書き。キー（inf_id/account/media）は既存維持。
function mergeInfluencer(existing, incoming) {
  const out = { ...existing };
  for (const f of FIELDS) {
    if (f === 'account' || f === 'media') continue; // upsertキーは既存維持
    if (nonEmpty(incoming[f])) out[f] = incoming[f];
  }
  return out;
}

module.exports = { INFLUENCER_HEADERS, MEDIA_OPTIONS, validateInfluencer, toInfluencerRow, parseInfluencer, mergeInfluencer };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/influencer-store.test.js`
Expected: PASS（4 tests）

- [ ] **Step 5: Commit**

```bash
git add lib/influencer-store.js test/influencer-store.test.js
git commit -m "feat: インフルエンサーDBの行マッパー・upsertマージを追加(TDD)"
```

---

## Task 2: インフルエンサーDBエンドポイント（GET一覧＋POST upsert）

**Files:**
- Modify: `cockpit-server.js`

- [ ] **Step 1: Add the require**

既存の `const { nextId } = require('./lib/id-gen');` の直後に追加：

```javascript
const inf = require('./lib/influencer-store');
```

- [ ] **Step 2: Add the endpoints**

`app.patch('/api/cockpit/cases', ...)` ブロックの直後（`app.get('/', ...)` の前）に追加：

```javascript
// --- インフルエンサーDB ---
app.get('/api/cockpit/influencers', requireAuth, async (req, res) => {
  try {
    const rows = await readRows(SHEET_ID, 'インフルエンサーDB');
    res.json({ ok: true, influencers: rows.slice(1).map(inf.parseInfluencer) });
  } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e).slice(0, 300) }); }
});
app.post('/api/cockpit/influencers', requireAuth, async (req, res) => {
  try {
    const body = req.body || {};
    inf.validateInfluencer(body);
    const account = String(body.account || '').trim().replace(/^@/, '');
    const media = String(body.media || '').trim();
    const rows = await readRows(SHEET_ID, 'インフルエンサーDB');
    const parsed = rows.slice(1).map(inf.parseInfluencer);
    const incoming = { ...body, account, media, registrant: req.user.email };
    const existing = parsed.find((x) => x.media === media && (x.account || '').toLowerCase() === account.toLowerCase());
    if (existing) {
      const merged = inf.mergeInfluencer(existing, incoming);
      await updateRowById(SHEET_ID, 'インフルエンサーDB', 0, existing.inf_id, inf.toInfluencerRow(merged, existing.inf_id));
      return res.json({ ok: true, inf_id: existing.inf_id, updated: true });
    }
    const id = nextId('I', parsed.map((x) => x.inf_id).filter(Boolean));
    await appendRow(SHEET_ID, 'インフルエンサーDB', inf.toInfluencerRow(incoming, id));
    res.json({ ok: true, inf_id: id, updated: false });
  } catch (e) {
    const bad = /必須項目|媒体/.test(e.message);
    res.status(bad ? 400 : 500).json({ ok: false, error: String(e.message || e).slice(0, 300) });
  }
});
```

注：`readRows / updateRowById / appendRow / nextId` は既にrequire済み（S2aで取り込み済み）。`inf` はStep 1で追加。

- [ ] **Step 3: Verify boot + auth gate**

Run: `node --check cockpit-server.js && echo OK`
Expected: `OK`

Run:
```bash
node -e "require('./cockpit-server.js')" & SVPID=$!; sleep 1.5; \
curl -s localhost:3000/api/cockpit/influencers; echo; \
curl -s -X POST localhost:3000/api/cockpit/influencers -H 'Content-Type: application/json' -d '{}'; echo; \
kill $SVPID 2>/dev/null
```
Expected: 両方 `{"ok":false,"error":"未ログイン"}`（requireAuthが先に効く）。

- [ ] **Step 4: Commit**

```bash
git add cockpit-server.js
git commit -m "feat: インフルエンサーDBのGET一覧＋POST upsertエンドポイントを追加"
```

---

## Task 3: フロント — 候補DBタブ（フィルタ・テーブル・手動追加・登録ヘルパ）

**Files:**
- Modify: `public/cg-cockpit.html`

参照：`STEPS`、`RENDER`、`field`、`api`（POST）、`apiGet`（GET）、`escapeHtml`、`CASE_STATUSES`の定義位置（このあたりにヘルパを足す）。

- [ ] **Step 1: Register the 候補DB tab in STEPS**

`const STEPS = [...]` の `{id:"source", ...}` エントリの直後に追加：

```javascript
  {id:"idb", t:"候補DB", sub:"採点済みインフルエンサーを貯めてフィルター検索"},
```

- [ ] **Step 2: Add the idb() view to RENDER**

`RENDER` オブジェクトの `source(){...},` メソッドの直後に追加：

```javascript
  idb(){
    const media=['YouTube','Instagram','TikTok','X'];
    return `<div class="card"><h3>🔎 候補をフィルター検索</h3>
      <div class="row">
        <div><label>媒体</label><select id="f_media"><option value="">すべて</option>${media.map(m=>`<option>${m}</option>`).join("")}</select></div>
        <div><label>ジャンル（含む）</label><input id="f_genre" placeholder="美容 等"></div>
      </div>
      <div class="row">
        <div><label>フォロワー下限</label><input id="f_fmin" type="number" placeholder="0"></div>
        <div><label>フォロワー上限</label><input id="f_fmax" type="number" placeholder="上限なし"></div>
      </div>
      <div class="row">
        <div><label>転換質%下限</label><input id="f_cv" type="number" placeholder="0"></div>
        <div><label>スクリーニング下限</label><input id="f_scr" type="number" placeholder="0"></div>
      </div>
      <div class="row">
        <div><label>女性%下限</label><input id="f_fem" type="number" placeholder="0"></div>
        <div><label>フリーワード（名前・メモ）</label><input id="f_q" placeholder="キーワード"></div>
      </div>
      <div style="margin-top:8px"><button class="btn" onclick="applyIdbFilter()">検索</button>
        <button class="btn" style="background:var(--purple)" onclick="loadIdb()">再読込</button></div>
      <div id="idb_count" style="margin-top:8px;font-size:12px;color:var(--muted)"></div>
      <div id="idb_list" style="margin-top:6px;font-size:12.5px">読み込み中…</div></div>

    <div class="card"><h3>＋ 手動で候補を追加</h3>
      <div class="row">${field("ia_account","アカウント名","@は不要")}<div><label>媒体</label><select id="ia_media">${media.map(m=>`<option>${m}</option>`).join("")}</select></div></div>
      <div class="row">${field("ia_genre","ジャンル","美容 等")}${field("ia_followers","フォロワー","数値")}</div>
      <div class="row">${field("ia_conversion","転換質%","数値")}${field("ia_screening","スクリーニング","数値")}</div>
      ${field("ia_note","適性メモ・向く商品","","ta")}
      ${field("ia_url","URL","")}
      <button class="btn" onclick="addInfluencer()">DBに追加</button>
      <div id="ia_msg" style="margin-top:6px;font-size:12.5px"></div></div>`;
  },
```

- [ ] **Step 3: Add idb data/load/filter/render + registerCand + addInfluencer handlers**

`window.setActiveCase=...` の定義の直後（または `CASE_STATUSES` 付近のグローバル群の末尾）に追加：

```javascript
let IDB_ALL = [];
function num(v){ const n=parseFloat(String(v).replace(/[^0-9.\-]/g,"")); return isNaN(n)?0:n; }
async function loadIdb(){
  const el=document.getElementById("idb_list"); if(!el) return;
  el.innerHTML="読み込み中…";
  try{
    const r=await apiGet("/api/cockpit/influencers");
    IDB_ALL = (r.ok && r.influencers) ? r.influencers : [];
    applyIdbFilter();
  }catch(e){ el.innerHTML="<span style='color:#A32D2D'>"+escapeHtml(e.message)+"</span>"; }
}
window.applyIdbFilter=()=>{
  const el=document.getElementById("idb_list"); if(!el) return;
  const g=(document.getElementById("f_media").value||"");
  const genre=(document.getElementById("f_genre").value||"").trim();
  const fmin=document.getElementById("f_fmin").value, fmax=document.getElementById("f_fmax").value;
  const cv=document.getElementById("f_cv").value, scr=document.getElementById("f_scr").value, fem=document.getElementById("f_fem").value;
  const q=(document.getElementById("f_q").value||"").trim().toLowerCase();
  let rows=IDB_ALL.filter(x=>{
    if(g && x.media!==g) return false;
    if(genre && !(x.genre||"").includes(genre)) return false;
    if(fmin!=="" && num(x.followers)<num(fmin)) return false;
    if(fmax!=="" && num(x.followers)>num(fmax)) return false;
    if(cv!=="" && num(x.conversion)<num(cv)) return false;
    if(scr!=="" && num(x.screening)<num(scr)) return false;
    if(fem!=="" && num(x.female)<num(fem)) return false;
    if(q && !((x.account||"").toLowerCase().includes(q) || (x.note||"").toLowerCase().includes(q) || (x.result||"").toLowerCase().includes(q))) return false;
    return true;
  });
  rows.sort((a,b)=>num(b.conversion)-num(a.conversion));
  document.getElementById("idb_count").textContent=`${rows.length}件 / 全${IDB_ALL.length}件`;
  if(!rows.length){ el.innerHTML="<span style='color:var(--muted)'>該当なし</span>"; return; }
  el.innerHTML=rows.map(x=>`<div style="padding:6px 0;border-bottom:1px solid var(--line)">
    <b>${escapeHtml(x.account)}</b> <span class="pill p-gray">${escapeHtml(x.media)}</span>
    ${x.conversion?`<span class="pill ${num(x.conversion)>=15?'p-green':num(x.conversion)>=5?'p-orange':'p-gray'}">転換質${escapeHtml(x.conversion)}%</span>`:""}
    <span style="color:var(--muted);font-size:11.5px">${escapeHtml(x.genre||"")} ／ フォロワー${(num(x.followers)||0).toLocaleString()} ／ 女性${escapeHtml(x.female||"-")} ／ スクリーニング${escapeHtml(x.screening||"-")}</span>
    ${x.note?`<br><span style="font-size:11.5px">${escapeHtml(x.note)}</span>`:""}
    ${x.result?`<br><span style="font-size:11.5px;color:#1E7A46">実績: ${escapeHtml(x.result)}</span>`:""}
    ${x.url?` <a class="link" href="${escapeHtml(x.url)}" target="_blank">開く</a>`:""}</div>`).join("");
};
// 候補をDBにupsert登録（YouTube/Astream結果・手動から共用）
window.registerCand=async(payload, btn)=>{
  if(btn){ btn.disabled=true; btn.textContent="登録中…"; }
  try{
    const r=await api("/api/cockpit/influencers",payload);
    if(r.ok){ if(btn){ btn.textContent=(r.updated?"更新済 ":"登録済 ")+r.inf_id; } return true; }
    if(btn){ btn.disabled=false; btn.textContent="DBに登録"; }
    alert("登録に失敗: "+(r.error||"")); return false;
  }catch(e){ if(btn){ btn.disabled=false; btn.textContent="DBに登録"; } alert("登録に失敗: "+e.message); return false; }
};
window.addInfluencer=async()=>{
  const msg=document.getElementById("ia_msg");
  const payload={
    account:(document.getElementById("ia_account").value||"").trim().replace(/^@/,""),
    media:document.getElementById("ia_media").value,
    genre:(document.getElementById("ia_genre").value||"").trim(),
    followers:(document.getElementById("ia_followers").value||"").trim(),
    conversion:(document.getElementById("ia_conversion").value||"").trim(),
    screening:(document.getElementById("ia_screening").value||"").trim(),
    note:(document.getElementById("ia_note").value||"").trim(),
    url:(document.getElementById("ia_url").value||"").trim(),
  };
  if(!payload.account){ msg.innerHTML="<span style='color:#A32D2D'>アカウント名を入力してください</span>"; return; }
  const ok=await registerCand(payload, null);
  if(ok){ msg.innerHTML="✅ 追加しました"; await loadIdb(); }
  else { msg.innerHTML="<span style='color:#A32D2D'>追加に失敗しました</span>"; }
};
```

注：`field("ia_note",...,"ta")` はtextareaを生成。`num()` は "85%" や "193,000" のような文字列も数値化する。

- [ ] **Step 4: Load idb data when entering the tab**

`window.go=(id)=>{...}` を次に置換（既存の case 分岐を保持しつつ idb を追加）：

```javascript
window.go=(id)=>{current=id;render();window.scrollTo(0,0);
  if(id==="case"){ fillBrandSelect(); loadCases(); }
  if(id==="idb"){ loadIdb(); }
};
```

- [ ] **Step 5: Verify parse + identifiers**

Run:
```bash
node -e 'const fs=require("fs"),vm=require("vm");const h=fs.readFileSync("public/cg-cockpit.html","utf8");const s=[...h.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);s.forEach((x,i)=>{try{new vm.Script(x)}catch(e){console.log("ERR",i,e.message)}});console.log("parsed",s.length)'
```
Expected: `parsed 1`、ERRなし。

Run: `grep -n 'id:"idb"\|window.registerCand\|window.addInfluencer\|applyIdbFilter\|IDB_ALL' public/cg-cockpit.html`
Expected: 各識別子が存在。

- [ ] **Step 6: Commit**

```bash
git add public/cg-cockpit.html
git commit -m "feat: 候補DBタブ（フィルター検索・手動追加・登録ヘルパ）を追加"
```

---

## Task 4: フロント — YouTube/Astream結果に「DBに登録」ボタン

**Files:**
- Modify: `public/cg-cockpit.html`

参照：`window.runYTBatch`（YouTube一括の成功セル描画は `cell.innerHTML = ...` で `d.title/d.subscribers/d.purchaseIntentRate` を使う）、`window.runAstreamIngest`（`runCsvTool("/api/cockpit/astream-ingest", rows=>{...})` の render コールバックで各行 `r["インフルエンサー"]` 等を使う）、Task 3で定義した `window.registerCand`。

- [ ] **Step 1: Add a "DBに登録" button to each successful YouTube row**

`runYTBatch` の成功分岐（`cell.innerHTML=` で `<b>${d.title}</b> ...` を描画している箇所）の直後、`done++;` の前に、登録ボタンを追記する。該当の `else {` ブロックを次に置換：

```javascript
      else{
        const badge=d.purchaseIntentRate>=15?"p-green":d.purchaseIntentRate>=5?"p-orange":"p-gray";
        cell.innerHTML=`<b>${d.title}</b> <span class="pill ${badge}">転換質${d.purchaseIntentRate}%</span><br>
          <span style="color:var(--muted);font-size:11.5px">登録${(d.subscribers||0).toLocaleString()} ／ ER${d.avgER}% ／ ${prOnly?"PR投稿":"人気投稿"}・${d.commentsAnalyzed}コメント</span>`;
        const rb=document.createElement("button");
        rb.className="btn"; rb.style.cssText="margin-top:6px;padding:2px 8px;font-size:11.5px"; rb.textContent="DBに登録";
        rb.onclick=()=>registerCand({account:d.title, media:"YouTube", followers:d.subscribers, conversion:d.purchaseIntentRate, contentType:(prOnly?"レビュー型":"")}, rb);
        cell.appendChild(document.createElement("br")); cell.appendChild(rb);
        done++;
      }
```

- [ ] **Step 2: Add "DBに登録" buttons to the Astream ingest results**

`window.runAstreamIngest=()=>runCsvTool("/api/cockpit/astream-ingest", rows=>{...})` の render コールバックを次に置換（各行に登録ボタンを付け、行データを `window.__asCand` に退避してインデックス参照する）：

```javascript
window.runAstreamIngest=()=>runCsvTool("/api/cockpit/astream-ingest", rows=>{
  if(!rows.length) return "対象なし";
  window.__asCand={};
  const head=`<div style="font-size:12px;color:var(--muted);margin-bottom:6px">マスタDB取込（上位${Math.min(rows.length,20)}件・暫定スコア順）。各行を候補DBに登録できます</div>`;
  const body=rows.slice(0,20).map((r,i)=>{
    window.__asCand[i]={
      account:String(r["インフルエンサー"]||"").replace(/^@/,""), media:"Instagram",
      genre:r["ジャンル推定"]||"", followers:r["フォロワー"]||"", female:r["女性%"]||"",
      coreAge:r["中核年齢25-44%"]||"", realRate:r["実在率%"]||"", prEngage:r["PRエンゲージ%"]||"",
      screening:r["暫定スコア(客層+実在+PR/45)"]||"", url:r["URL"]||""
    };
    return `<div style="padding:5px 0;border-bottom:1px solid var(--line);font-size:12.5px">
      ${i+1}. <b>@${escapeHtml(String(r["インフルエンサー"]||""))}</b> <span class="pill p-purple">暫定${escapeHtml(String(r["暫定スコア(客層+実在+PR/45)"]||""))}/45</span>
      <span style="color:var(--muted);font-size:11.5px">${(num(r["フォロワー"])||0).toLocaleString()}人 女性${escapeHtml(String(r["女性%"]||""))} 実在${escapeHtml(String(r["実在率%"]||""))} ${escapeHtml(String(r["ジャンル推定"]||""))}</span>
      <button class="btn" style="margin-left:6px;padding:1px 7px;font-size:11px" onclick="registerCand(window.__asCand[${i}],this)">DBに登録</button></div>`;
  }).join("");
  return head+body;
});
```

注：`num()`・`registerCand`・`escapeHtml` はTask 3／既存で定義済み。元の `runAstreamIngest` は `r["アカウント名"]` ではなく `r["インフルエンサー"]` を使っていた点に注意（ingest_csv.py の出力キーは「インフルエンサー」）。

- [ ] **Step 3: Verify parse + identifiers**

Run:
```bash
node -e 'const fs=require("fs"),vm=require("vm");const h=fs.readFileSync("public/cg-cockpit.html","utf8");const s=[...h.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);s.forEach((x,i)=>{try{new vm.Script(x)}catch(e){console.log("ERR",i,e.message)}});console.log("parsed",s.length)'
```
Expected: `parsed 1`、ERRなし。

Run: `grep -n 'registerCand({account:d.title\|window.__asCand\|registerCand(window.__asCand' public/cg-cockpit.html`
Expected: YouTube用とAstream用の登録呼び出しが存在。

- [ ] **Step 4: Commit**

```bash
git add public/cg-cockpit.html
git commit -m "feat: YouTube/Astream結果に「DBに登録」ボタンを追加"
```

---

## Task 5: インフルエンサーDBタブ初期化GAS

**Files:**
- Create: `scripts/setup/build_influencer_db.gs`

- [ ] **Step 1: Create the GAS script**

`scripts/setup/build_influencer_db.gs`:

```javascript
/**
 * build_influencer_db.gs — インフルエンサーDBタブ作成（1行目ヘッダー）
 * 使い方：対象スプレッドシートの拡張機能 > Apps Script に貼り、buildInfluencerDb を実行。冪等。
 */
function buildInfluencerDb() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var headers = ['inf_id','アカウント名','媒体','ジャンル','コンテンツ型','フォロワー',
    '女性%','中核年齢25-44%','スクリーニング','転換質%','実在率%','PRエンゲージ%',
    '適性メモ・向く商品','実績サマリー','URL','登録者','最終更新'];
  var sh = ss.getSheetByName('インフルエンサーDB');
  if (!sh) sh = ss.insertSheet('インフルエンサーDB');
  sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  sh.setFrozenRows(1);
  SpreadsheetApp.getUi().alert('✅ インフルエンサーDBタブを準備しました');
}
```

- [ ] **Step 2: Commit**

```bash
git add scripts/setup/build_influencer_db.gs
git commit -m "feat: インフルエンサーDBタブ初期化GAS(build_influencer_db.gs)を追加"
```

---

## Task 6: 全テスト＆結合確認（デプロイ後・手動）

**Files:** なし（検証）

- [ ] **Step 1: Run the full test suite**

Run: `node --test`
Expected: 既存＋ influencer-store の全テスト PASS。

- [ ] **Step 2: Sheets初期化（ユーザー）**

`scripts/setup/build_influencer_db.gs` を対象スプレッドシートのApps Scriptに貼り、`buildInfluencerDb` を実行。インフルエンサーDBタブができることを確認。

- [ ] **Step 3: 再デプロイ（ユーザー）**

Run: `gcloud run deploy cg-cockpit --source . --region asia-northeast1`

- [ ] **Step 4: 最新HTMLをXserver再アップロード（ユーザー）**

- [ ] **Step 5: 画面で確認（ユーザー）**

- 候補DBタブ：手動追加→一覧に出る／フィルタ（媒体・フォロワー・転換質等）が効く
- YouTube一括診断→結果行の「DBに登録」→候補DBに反映（再登録で更新）
- Astream取込→各行「DBに登録」→Instagram候補として反映（女性%・実在率等が入る）

---

## Self-Review 結果

- **Spec coverage:**
  - インフルエンサーDBタブ（1行目ヘッダー・inf_id採番）= Task1,2,5
  - 媒体4種（YouTube/Instagram/TikTok/X）= Task1（MEDIA_OPTIONS）, Task3（UI）
  - 「DBに登録」ボタン（YouTube/Astream）＋手動追加 = Task3,4
  - upsert（媒体＋アカウント名・空でない値のみ上書き）= Task1（mergeInfluencer）, Task2（endpoint）
  - フィルタ（媒体/ジャンル/フォロワー範囲/転換質/スクリーニング/女性%/フリーワード）＋転換質降順 = Task3
  - 実績サマリー手動メモ列 = Task1（result列）, Task3（表示）
  - エラーハンドリング（account/media必須400・媒体選択肢外400・認証・Sheets500）= Task1,2
  - GET一覧／POST upsert = Task2／デプロイ手順 = Task5,6
- **Placeholder scan:** 「実装時に確定」項目（@除去）はTask2/3で `.replace(/^@/,'')` として明示実装済み。プレースホルダなし。
- **Type consistency:**
  - obj フィールド名（account/media/genre/contentType/followers/female/coreAge/screening/conversion/realRate/prEngage/note/result/url/registrant）は Task1（FIELDS/toRow/parse）と Task2（endpoint）・Task3/4（フロントpayload）で一致。
  - `registerCand(payload, btn)` Task3定義→Task4使用。`num()` Task3定義→Task3/4使用。`IDB_ALL`/`loadIdb`/`applyIdbFilter` Task3定義→Task3 go()分岐で使用。
  - `mergeInfluencer`/`toInfluencerRow`/`parseInfluencer`/`validateInfluencer`/`MEDIA_OPTIONS` Task1定義→Task2使用。
