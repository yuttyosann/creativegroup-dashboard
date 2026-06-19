# S1 コックピット改善＋LLM連携 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 施策進行コックピットの商品分析・診断をClaude API（Sonnet 4.6）でWeb完結させ、候補タブにYouTube検索/Astreamログイン導線を出し、全体フロー説明＋詳細マニュアルタブを追加する。

**Architecture:** 既存の単一ページ構成（`public/cg-cockpit.html` ＋ `cockpit-server.js`、Cloud Run稼働）に、プロンプト組み立て純粋関数 `lib/analyze-prompt.js` と認証付きエンドポイント `POST /api/cockpit/analyze` を1本追加。フロントは既存の `RENDER` ビュー・`api()` ヘルパ・`STEPS` ナビのパターンを踏襲して拡張する。新インフラは増やさない。

**Tech Stack:** Node.js / Express、`@anthropic-ai/sdk`、Vanilla JS（フロント）、node:test（TDD）。

---

## File Structure

- **Create** `lib/analyze-prompt.js` — kindごとにプロンプト（system/user）を組み立てる純粋関数。サーバから分離しテスト可能に。
- **Create** `test/analyze-prompt.test.js` — 上記のユニットテスト。
- **Modify** `package.json` — `@anthropic-ai/sdk` を dependencies に追加。
- **Modify** `cockpit-server.js` — `POST /api/cockpit/analyze` を追加。
- **Modify** `public/cg-cockpit.html` — 商品分析/診断のWeb完結フォーム、候補タブのYouTube検索＋Astreamリンク、flow説明、マニュアルタブ追加。
- **Modify** `docs/superpowers/specs/2026-06-19-s1-cockpit-llm.md` の対の運用手順は `docs/superpowers/setup/cloud-run-deploy.md` に追記。

既存の `public/cg-cockpit.html` は単一ファイルで肥大化しているが、本プロジェクトの確立パターン（`RENDER` オブジェクトに各タブのビュー関数、`window.xxx` にハンドラ）に従う。restructureはしない。

---

## Task 1: プロンプト組み立て関数（TDD）

**Files:**
- Create: `lib/analyze-prompt.js`
- Test: `test/analyze-prompt.test.js`

- [ ] **Step 1: Write the failing test**

`test/analyze-prompt.test.js`:

```javascript
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { buildAnalyzePrompt } = require('../lib/analyze-prompt');

test('product: 商品名と提供情報が user プロンプトに差し込まれる', () => {
  const { system, user } = buildAnalyzePrompt('product', {
    productName: 'ABCトーンアップ美容液',
    info: '公式説明とECレビュー抜粋',
  });
  assert.ok(system.length > 0, 'systemが空でない');
  assert.match(user, /ABCトーンアップ美容液/);
  assert.match(user, /公式説明とECレビュー抜粋/);
  assert.match(user, /需要タイプ/);
});

test('diagnose: 商品/インフル/条件が差し込まれ、条件未指定は既定文言', () => {
  const { user } = buildAnalyzePrompt('diagnose', {
    productSummary: 'カバー需要型・毛穴',
    influencerSummary: '購買意向コメント率高',
  });
  assert.match(user, /カバー需要型・毛穴/);
  assert.match(user, /購買意向コメント率高/);
  assert.match(user, /（記載なし）/);
  assert.match(user, /M02/);
});

test('unknown kind はエラー', () => {
  assert.throws(() => buildAnalyzePrompt('xxx', {}), /unknown kind/);
});

test('必須項目欠落は項目名つきでエラー', () => {
  assert.throws(() => buildAnalyzePrompt('product', { productName: 'x' }), /info/);
  assert.throws(() => buildAnalyzePrompt('diagnose', { productSummary: 'x' }), /influencerSummary/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/analyze-prompt.test.js`
Expected: FAIL（`Cannot find module '../lib/analyze-prompt'`）

- [ ] **Step 3: Write minimal implementation**

`lib/analyze-prompt.js`:

```javascript
'use strict';
/**
 * analyze-prompt.js — 商品分析/診断プロンプトの組み立て（純粋関数）
 * 文面は CG_インフルエンサー診断_v0.1.md の v0.5/v0.6 を正とする。
 */

const SYSTEM =
  'あなたはCreative Groupのインフルエンサー×商品マッチング診断の専門アナリストです。' +
  '提示された情報のみを根拠に、客観的・対称的に分析し、過学習を避け、指定フォーマットで簡潔に出力してください。';

const PRODUCT_TEMPLATE = `以下の商品を、インフルエンサーマッチング診断のために分析してください。

【商品名・ブランド】{{productName}}
【提供情報】{{info}}

【分析項目】表で整理してください。
1. 商品カテゴリ・主役アイテム（セットの場合どれが核か）
2. 価格帯（定価/メガ割価格/割引率）
3. メイン訴求軸 TOP3
4. 商品の「需要タイプ／needsタイプ」を判定（カバー需要型/ツヤ・保湿需要型/機能解決型/情緒・憧れ型）
   ※これがインフルエンサーの需要・利用文脈適合(M02)判定の基準になる
5. ターゲット肌質・肌悩み（美容以外は利用文脈・needs。レビューから客観抽出）
6. 高評価レビューの頻出テーマ TOP5
7. 不満レビュー・NG訴求
8. 競合商品との差別化
9. メガ割/セールで押すべき訴求 TOP3
10. 商品自体の「ベース力」評価（受賞/ランキング/評価点）
最後に「この商品の核需要を最も実演できるインフルエンサー像」を100字で。`;

const DIAGNOSE_TEMPLATE = `商品分析とインフルエンサー分析をもとにマッチング診断してください。
※実売結果が分かっていても、採点は入力データのみで行う（ブラインド）。結果は最後の検証だけに使う。

【商品分析サマリー】
{{productSummary}}

【インフルエンサー分析サマリー】
{{influencerSummary}}

【施策条件】{{conditions}}

■ STEP1：施策タイプ判定（A レビュー型 / B アンバサダー型）
■ STEP2：10軸採点（入力データのみ・ブラインド）
| 軸 | 配点 |
| M01 商品カテゴリ適合 | 10 |
| M02 需要・利用文脈適合（★商品の需要タイプと客層の需要を突き合わせ） | 15 |
| M03 投稿スタイル適合 | 10 |
| M04 フォロワー層適合 | 10 |
| M05 過去実績（なければ中央値5） | 10 |
| M06 コメント信頼（購買意向コメントのみ・虚栄は除外） | 10 |
| M07 PR自然度 | 10 |
| M08 購買導線 | 10 |
| M09 メガ割/セール適性 | 10 |
| M10 リスク控除 | -20〜0 |
■ STEP3：ROAS試算（損益分岐販売数＝タイアップ費÷想定単価。超える見込みか／契約構造リスク）
■ STEP4：診断結果（総合スコアと判定 85+◎/70-84○/55-69△/-54×・強みTOP3・懸念TOP3・推奨投稿スタイル・避ける表現・起用是非と推奨契約構造）`;

function fill(template, values) {
  return template.replace(/{{(\w+)}}/g, (_, k) => values[k]);
}

function requireFields(payload, fields) {
  for (const f of fields) {
    if (!payload || !String(payload[f] || '').trim()) {
      throw new Error('必須項目が不足しています: ' + f);
    }
  }
}

function buildAnalyzePrompt(kind, payload) {
  payload = payload || {};
  if (kind === 'product') {
    requireFields(payload, ['productName', 'info']);
    return { system: SYSTEM, user: fill(PRODUCT_TEMPLATE, payload) };
  }
  if (kind === 'diagnose') {
    requireFields(payload, ['productSummary', 'influencerSummary']);
    const values = {
      productSummary: payload.productSummary,
      influencerSummary: payload.influencerSummary,
      conditions: String(payload.conditions || '').trim() || '（記載なし）',
    };
    return { system: SYSTEM, user: fill(DIAGNOSE_TEMPLATE, values) };
  }
  throw new Error('unknown kind: ' + kind);
}

module.exports = { buildAnalyzePrompt };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/analyze-prompt.test.js`
Expected: PASS（4 tests）

- [ ] **Step 5: Commit**

```bash
git add lib/analyze-prompt.js test/analyze-prompt.test.js
git commit -m "feat: 商品分析/診断プロンプト組み立て関数を追加(TDD)"
```

---

## Task 2: Anthropic SDK 依存の追加

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install the SDK**

Run: `npm install @anthropic-ai/sdk`
Expected: `package.json` の dependencies に `@anthropic-ai/sdk` が追加され、`package-lock.json` が更新される。

- [ ] **Step 2: Verify it loads**

Run: `node -e "require('@anthropic-ai/sdk'); console.log('ok')"`
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "build: @anthropic-ai/sdk を追加"
```

---

## Task 3: 分析エンドポイント `/api/cockpit/analyze`

**Files:**
- Modify: `cockpit-server.js`

- [ ] **Step 1: require を追加**

`cockpit-server.js` の既存 require 群（`const { toDiagnosisRow } = require('./lib/diagnosis-store');` の直後）に追加：

```javascript
const { buildAnalyzePrompt } = require('./lib/analyze-prompt');
const Anthropic = require('@anthropic-ai/sdk');
```

- [ ] **Step 2: エンドポイントを追加**

`app.post('/api/cockpit/astream-ingest', ...)` の定義ブロックの直後（`app.get('/', ...)` の前）に追加：

```javascript
// 商品分析 / マッチング診断（Claude Sonnet 4.6 でWeb完結）
app.post('/api/cockpit/analyze', requireAuth, async (req, res) => {
  const { kind, payload } = req.body || {};
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(400).json({ ok: false, error: 'ANTHROPIC_API_KEY未設定（Cloud Runの環境変数に追加してください）' });
  }
  let prompt;
  try {
    prompt = buildAnalyzePrompt(kind, payload);
  } catch (e) {
    return res.status(400).json({ ok: false, error: e.message });
  }
  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const msg = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: prompt.system,
      messages: [{ role: 'user', content: prompt.user }],
    });
    const text = (msg.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    res.json({ ok: true, text });
  } catch (e) {
    res.status(500).json({ ok: false, error: String((e && e.message) || e).slice(0, 500) });
  }
});
```

- [ ] **Step 3: 構文チェック（キー未設定で400が返ること）**

Run: `node -e "require('./cockpit-server.js')" & sleep 1; curl -s -X POST localhost:3000/api/cockpit/analyze -H 'Content-Type: application/json' -d '{}'; echo; kill %1`
Expected: 認証が先に効くため `{"ok":false,"error":"未ログイン"}`（401）が返る。サーバが構文エラーなく起動することを確認。
（注：ローカルは `.env` の PORT=3000 で待受。Cloud Run では PORT=8080。）

- [ ] **Step 4: Commit**

```bash
git add cockpit-server.js
git commit -m "feat: /api/cockpit/analyze（商品分析・診断のClaude連携）を追加"
```

---

## Task 4: フロント — 商品分析タブをWeb完結フォームに

**Files:**
- Modify: `public/cg-cockpit.html`

参照：`RENDER.product()`（現状はコピペ用 `<pre>` を表示）、`field(id,label,ph,ta)` ヘルパ、`api(path,body)` ヘルパ、`window.runYTBatch` のローディング/結果表示パターン。

- [ ] **Step 1: 結果表示の共通ヘルパを追加**

`function parseTargets(text){...}` の直後に追加（XSS回避のためエスケープして `<pre>` 表示）：

```javascript
function escapeHtml(s){
  return String(s||"").replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
}
function renderAnalyzeResult(elId, text){
  const el=document.getElementById(elId);
  el.innerHTML=`${copyBtn(text)}<pre style="white-space:pre-wrap">${escapeHtml(text)}</pre>`;
}
```

- [ ] **Step 2: product ビューをフォームに置換**

`RENDER.product()` の `return` を次に置換：

```javascript
  product(){
    return `<div class="card"><h3>📦 商品分析（Web完結）</h3>
      <p style="font-size:12.5px;color:var(--muted);margin-bottom:8px">商品情報・レビューを貼り付けて[分析する]。需要タイプと肌悩み（=M02の基準）を抽出します。</p>
      ${field("pa_name","商品名・ブランド","株式会社〇〇 / 商品名")}
      <label>提供情報（公式ページ/商品資料/ECレビュー/SNS反応/競合を貼り付け）</label>
      <textarea id="pa_info" style="min-height:140px" placeholder="公式説明、ECレビューの抜粋、競合との違い 等"></textarea>
      <div style="margin-top:8px"><button class="btn" id="pabtn" onclick="runProduct()">分析する</button></div>
      <div class="note" style="margin-top:8px">⏱ 20〜60秒。完了までこのタブを<b>開いたまま</b>に。</div>
      <div id="paresult" style="margin-top:10px;font-size:13px"></div></div>
    <div class="note">出力の「需要タイプ」「肌悩み」「向くインフルエンサー像」を控えておく。
      <details style="margin-top:6px"><summary style="cursor:pointer">従来のコピペ用プロンプトを見る</summary>
      <pre>${copyBtn(PROMPT_PRODUCT)}${PROMPT_PRODUCT}</pre></details></div>`;
  },
```

注：`field("pa_name",...)` は `<input id="pa_name">` を生成する（localStorage保存つき）。提供情報は保存不要なので素の `<textarea id="pa_info">`。

- [ ] **Step 3: runProduct ハンドラを追加**

`window.runYTBatch=async()=>{...}` の定義の前に追加：

```javascript
window.runProduct=async()=>{
  const productName=(document.getElementById("pa_name").value||"").trim();
  const info=(document.getElementById("pa_info").value||"").trim();
  const el=document.getElementById("paresult");
  const btn=document.getElementById("pabtn");
  if(!productName||!info){el.innerHTML="<span style='color:#A32D2D'>商品名と提供情報を入力してください</span>";return;}
  btn.disabled=true; btn.textContent="分析中…";
  el.innerHTML="分析中…（リロードしないでください）";
  try{
    const r=await api("/api/cockpit/analyze",{kind:"product",payload:{productName,info}});
    if(r.ok){ renderAnalyzeResult("paresult", r.text); }
    else{ el.innerHTML="<span style='color:#A32D2D'>"+escapeHtml(r.error||"分析に失敗しました")+"</span>"; }
  }catch(e){ el.innerHTML="<span style='color:#A32D2D'>"+escapeHtml(e.message)+"</span>"; }
  finally{ btn.disabled=false; btn.textContent="分析する"; }
};
```

- [ ] **Step 4: 手動確認（Step 5 と合わせてTask 6完了後にまとめて）**

ローカルでは ANTHROPIC_API_KEY 未設定のため 400 が表示される。構文・画面描画の確認のみここで行い、実通信の確認はデプロイ後（Task 8）。

- [ ] **Step 5: Commit**

```bash
git add public/cg-cockpit.html
git commit -m "feat: 商品分析タブをWeb完結フォーム化（Claude連携）"
```

---

## Task 5: フロント — 診断プロンプトタブをWeb完結フォームに

**Files:**
- Modify: `public/cg-cockpit.html`

参照：`RENDER.prompts()`（現状は `PROMPT_INFLU` / `PROMPT_MATCH` のコピペ表示）。

- [ ] **Step 1: prompts ビューにマッチング診断フォームを追加**

`RENDER.prompts()` の `return` を次に置換：

```javascript
  prompts(){
    return `<div class="card"><h3>🎯 マッチング診断（Web完結）</h3>
      <p style="font-size:12.5px;color:var(--muted);margin-bottom:8px">商品分析の出力とインフルエンサー分析の出力を貼り付けて[診断する]。10軸採点＋ROAS試算まで返します。</p>
      <label>商品分析サマリー（タブ2の出力を貼り付け）</label>
      <textarea id="dg_product" style="min-height:110px" placeholder="需要タイプ・肌悩み・向くインフルエンサー像 等"></textarea>
      <label>インフルエンサー分析サマリー（下のプロンプトで分析した結果を貼り付け）</label>
      <textarea id="dg_influ" style="min-height:110px" placeholder="ジャンル・投稿スタイル・購買意向コメント率・施策タイプ 等"></textarea>
      ${field("dg_cond","施策条件（任意）","タイアップ費/成果報酬率/想定単価/起用媒体")}
      <div style="margin-top:8px"><button class="btn" id="dgbtn" onclick="runDiagnose()">診断する</button></div>
      <div class="note" style="margin-top:8px">⏱ 20〜60秒。完了までこのタブを<b>開いたまま</b>に。</div>
      <div id="dgresult" style="margin-top:10px;font-size:13px"></div></div>
    <div class="card"><h3>👤 インフルエンサー分析プロンプト（コピペ）</h3>
      <p style="font-size:12.5px;color:var(--muted);margin-bottom:8px">インフルエンサーの客観分析はこのプロンプトで実施し、出力を上の「インフルエンサー分析サマリー」に貼ってください。</p>
      <pre>${copyBtn(PROMPT_INFLU)}${PROMPT_INFLU}</pre></div>
    <div class="note">マッチング診断の旧コピペ版：<details style="margin-top:6px"><summary style="cursor:pointer">従来のコピペ用プロンプトを見る</summary><pre>${copyBtn(PROMPT_MATCH)}${PROMPT_MATCH}</pre></details></div>`;
  },
```

- [ ] **Step 2: runDiagnose ハンドラを追加**

`window.runProduct=async()=>{...}` の直後に追加：

```javascript
window.runDiagnose=async()=>{
  const productSummary=(document.getElementById("dg_product").value||"").trim();
  const influencerSummary=(document.getElementById("dg_influ").value||"").trim();
  const conditions=(document.getElementById("dg_cond").value||"").trim();
  const el=document.getElementById("dgresult");
  const btn=document.getElementById("dgbtn");
  if(!productSummary||!influencerSummary){el.innerHTML="<span style='color:#A32D2D'>商品分析とインフルエンサー分析の両方を入力してください</span>";return;}
  btn.disabled=true; btn.textContent="診断中…";
  el.innerHTML="診断中…（リロードしないでください）";
  try{
    const r=await api("/api/cockpit/analyze",{kind:"diagnose",payload:{productSummary,influencerSummary,conditions}});
    if(r.ok){ renderAnalyzeResult("dgresult", r.text); }
    else{ el.innerHTML="<span style='color:#A32D2D'>"+escapeHtml(r.error||"診断に失敗しました")+"</span>"; }
  }catch(e){ el.innerHTML="<span style='color:#A32D2D'>"+escapeHtml(e.message)+"</span>"; }
  finally{ btn.disabled=false; btn.textContent="診断する"; }
};
```

- [ ] **Step 3: Commit**

```bash
git add public/cg-cockpit.html
git commit -m "feat: 診断プロンプトタブにマッチング診断のWeb完結フォームを追加"
```

---

## Task 6: フロント — 候補タブにYouTube検索＋Astreamログインリンク／フロー説明／マニュアルタブ

**Files:**
- Modify: `public/cg-cockpit.html`

- [ ] **Step 1: source（候補）タブにライブ検索とログインリンクを追加**

`RENDER.source()` 内の `<h3>🔎 YouTube自動検索（1から探す）</h3>` を含む `<div class="card">...</div>` を次に置換（コピペコマンド→ライブ検索ボタン）：

```javascript
    <div class="card"><h3>🔎 YouTube自動検索（1から探す）</h3>
      <p style="font-size:12.5px;color:var(--muted);margin-bottom:8px">キーワードで候補チャンネルを検索し、転換質で粗くランク付けします。</p>
      <div style="display:flex;gap:8px"><input id="srcytkw" placeholder="乾燥肌 ファンデ レビュー"><button class="btn" onclick="searchYTSource()">検索</button></div>
      <div id="srcytresult" style="margin-top:10px;font-size:13px"></div></div>
```

そして `<h3>🤝 Astreamの役割</h3>` を含むカード内の Astream 取込 `<pre>` の直後（`</div>` の前）に、ログインリンクを追加：

```javascript
      <div style="margin-top:10px"><a href="https://astream.jp/" target="_blank" rel="noopener" class="btn" style="display:inline-block;text-decoration:none">Astreamにログイン →</a></div>
```

注：Astreamの正規ログインURLは実装時にユーザーへ確認し、確定URLに差し替える（暫定 `https://astream.jp/`）。

- [ ] **Step 2: searchYTSource ハンドラを追加**

既存の `window.searchYT=async()=>{...}` の直後に、source用の検索ハンドラを追加（既存 `searchYT` のロジックを流用、要素IDのみ変更）：

```javascript
window.searchYTSource=async()=>{
  const kw=(document.getElementById("srcytkw").value||"").trim();
  const el=document.getElementById("srcytresult");
  if(!kw){el.innerHTML="<span style='color:#A32D2D'>キーワードを入力してください</span>";return;}
  el.innerHTML="検索中…（リロードしないでください）";
  try{
    const r=await api("/api/cockpit/yt-search",{keyword:kw,max:12});
    if(r.ok&&r.results&&r.results.length){
      el.innerHTML=`<table style="width:100%;border-collapse:collapse;font-size:12.5px">`
        +`<tr><th style="text-align:left;border-bottom:1px solid var(--line)">チャンネル</th><th style="border-bottom:1px solid var(--line)">登録者</th><th style="border-bottom:1px solid var(--line)">転換質</th></tr>`
        +r.results.map(x=>`<tr><td style="border-bottom:1px solid var(--line)">${escapeHtml(x.title||x.channelId||"")}</td>`
        +`<td style="text-align:right;border-bottom:1px solid var(--line)">${(x.subscribers||0).toLocaleString()}</td>`
        +`<td style="text-align:right;border-bottom:1px solid var(--line)">${x.purchaseIntentRate==null?"—":x.purchaseIntentRate+"%"}</td></tr>`).join("")
        +`</table>`;
    }else{ el.innerHTML="<span style='color:var(--muted)'>"+escapeHtml(r.error||"該当なし")+"</span>"; }
  }catch(e){ el.innerHTML="<span style='color:#A32D2D'>"+escapeHtml(e.message)+"</span>"; }
};
```

注：`search_channels.js --json` の `results` 各要素のキー（`title`/`subscribers`/`purchaseIntentRate`/`channelId`）に依存。実装時に `scripts/youtube/search_channels.js` の `@@JSON@@` 出力キーを確認し、相違あればキー名を合わせる。

- [ ] **Step 3: flow タブの各ステップに1行説明を追加**

`RENDER.flow()` の `steps` 配列を「タイトル｜説明」のペア配列に変更し、描画も2段にする。`flow(){...}` を次に置換：

```javascript
  flow(){
    const steps=[
      ["インフルエンサーPRの発注","ブランドから案件を受注。ゴール・予算・商材を確認する起点。"],
      ["ヒアリング","タブ1で会社・商品・訴求・ターゲット・NGを取得。商品分析の入力になる。"],
      ["★ リスト作成","タブ3でAstream＋YouTube検索から候補を集め、診断3層で絞る。"],
      ["クライアント選定","候補リストをクライアントに提示し、起用候補を選んでもらう。"],
      ["選定者へアプローチ","選ばれたインフルエンサーへ打診・条件交渉。"],
      ["実施者確定","起用確定者を提案ログDBに記録（案件ID×名前で管理）。"],
      ["オリエンシート作成","訴求・必須表現・NG・投稿要件をまとめた指示書を作る。"],
      ["商品体験","インフルエンサーに商品を届け、実際に使ってもらう。"],
      ["投稿下書き作成","本人が投稿原稿（構成・キャプション）を作成。"],
      ["下書き確認・添削","NG表現・薬機法・訴求ズレをチェックして修正依頼。"],
      ["修正","指摘反映。問題なければ投稿GOへ。"],
      ["投稿ポスト","予定日に投稿を公開。"],
      ["★ インサイト回収・成果集計","タブ6で再生/保存/購入/ROASを回収し提案ログDBに蓄積。次回精度に還元。"],
    ];
    return `<div class="card">${steps.map((s,i)=>`<div class="flowstep ${i===2||i===12?'star':''}"><div class="num">${i+1}</div><div><b>${s[0]}</b><br><span style="font-size:12px;color:var(--muted)">${s[1]}</span></div></div>`).join("")}</div>
    <div class="note">★が診断ツールの主戦場。STEP3でリストの質を上げ、STEP13で成果を貯めて精度を上げる。詳しい手順は「8. マニュアル」タブ。</div>`;
  },
```

- [ ] **Step 4: STEPS にマニュアルタブを追加**

`const STEPS = [ ... ];` の `{id:"check", ...}` の直後に1要素追加：

```javascript
  {id:"manual", t:"8. マニュアル", sub:"各工程の目的・操作手順・注意点（詳細版）"},
```

- [ ] **Step 5: manual ビューを追加**

`RENDER` オブジェクト内、`check(){...},` の直後に `manual()` を追加。元ネタは `CG_インフルエンサー提案_業務マニュアル.md`。目次アンカー＋各工程の詳細：

```javascript
  manual(){
    const m=[
      ["m1","1. ヒアリング","会社・担当・商品URL・一番売りたいベネフィット・ターゲット肌質/悩み・予算/目標・NG訴求を取得する。","タブ1のフォームに入力→そのまま商品分析の入力に使える。","売りたいベネフィットとNG訴求は必ず言語化。曖昧なら後工程の判定がぶれる。"],
      ["m2","2. 商品分析","商品の需要タイプ（カバー/ツヤ保湿/機能解決/情緒憧れ）と肌悩み・利用文脈を抽出。M02判定の基準を作る。","タブ2に商品名と提供情報（公式/レビュー/競合）を貼り[分析する]。","出力の『需要タイプ』『向くインフルエンサー像』を控える。EC低評価レビューも必ず入れると精度が上がる。"],
      ["m3","3. 候補を探す","3パターン（ジャンル/ブランド/既存候補）×診断3層で候補リストを作る。","タブ3：YouTube検索で発掘／AstreamのCSVを取込（客層・実在率・PRエンゲージ）。","フォロワー数・ER/CPVは規模・効率であって成果ではない。美容系は低スクリーニングでも落とさずTier1.5へ。"],
      ["m4","4. 診断する","Tier1スクリーニング→Tier1.5転換質→Tier2フル10軸。媒体で転換質の測り方が違う。","タブ4：YouTubeはコメント転換質（強）。IGはAstream PRエンゲージのプロキシ＋人間の目（コメントは虚栄が多い）。","採点は入力データのみ（ブラインド）。実売は最後の検証だけに使い、その場で配点を変えない。"],
      ["m5","5. 診断（マッチング）","商品分析×インフルエンサー分析で10軸採点＋ROAS試算＋施策タイプ判定。","タブ5：商品分析とインフル分析の出力を貼り[診断する]。","M02需要・肌悩み適合（15点）が最重要。10点未満は非推奨。ROAS損益分岐を必ず試算。"],
      ["m6","6. 記録する","全案件を1行=1インフルエンサーで提案ログDBに蓄積。人間の目利き×ツール診断×成果を紐づける。","タブ6：提案時/診断時/選定後/実施後の4段階で記録。","過去案件も『案件ID/ブランド/商品/名前/要望クリア/推薦理由/採用有無』だけで価値がある。"],
      ["m7","7. チェックリスト","各案件で抜け漏れがないか確認。","タブ7：9項目をチェックして進捗バーで確認。","人間評価とツール評価の差は必ずメモ。サンプルが貯まれば配点キャリブレーションに使う。"],
    ];
    return `<div class="card"><h3>目次</h3>${m.map(x=>`<a href="#${x[0]}" style="display:inline-block;margin:2px 8px 2px 0;font-size:13px">${x[1]}</a>`).join("")}</div>
    ${m.map(x=>`<div class="card" id="${x[0]}"><h3>${x[1]}</h3>
      <p style="font-size:13px"><b>目的：</b>${x[2]}</p>
      <p style="font-size:13px"><b>操作手順：</b>${x[3]}</p>
      <p style="font-size:13px;color:var(--muted)"><b>注意点・判断基準：</b>${x[4]}</p></div>`).join("")}`;
  },
```

- [ ] **Step 6: Commit**

```bash
git add public/cg-cockpit.html
git commit -m "feat: 候補タブのライブYouTube検索＋Astreamリンク、フロー説明、マニュアルタブを追加"
```

---

## Task 7: デプロイ手順書に ANTHROPIC_API_KEY を追記

**Files:**
- Modify: `docs/superpowers/setup/cloud-run-deploy.md`

- [ ] **Step 1: 環境変数セクションに追記**

`docs/superpowers/setup/cloud-run-deploy.md` を開き、環境変数を設定している箇所に次の手順を追記：

```markdown
### ANTHROPIC_API_KEY（商品分析・診断のWeb完結に必須）

1. https://console.anthropic.com でAPIキーを発行（**運用者本人が実施**。キーは誰にも共有しない）
2. Cloud Run に環境変数として設定：

   ```bash
   gcloud run services update cg-cockpit \
     --region asia-northeast1 \
     --update-env-vars ANTHROPIC_API_KEY=＜発行したキー＞
   ```

3. 使用モデルは `claude-sonnet-4-6`（コード側で固定）。1回あたり数円〜十数円。
4. キーはサーバ側環境変数のみで保持し、`public/config.js` 等フロントには絶対に置かない。
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/setup/cloud-run-deploy.md
git commit -m "docs: ANTHROPIC_API_KEYの設定手順を追記"
```

---

## Task 8: 結合確認（デプロイ後・手動）

**Files:** なし（運用確認）

> このタスクはユーザー作業を含む。ANTHROPIC_API_KEY の発行・設定・デプロイはユーザーが行う。

- [ ] **Step 1: 全テストを通す**

Run: `node --test`
Expected: 既存（authz / diagnosis-store）＋ analyze-prompt の全テスト PASS。

- [ ] **Step 2: 再デプロイ（ユーザー）**

Run: `gcloud run deploy cg-cockpit --source . --region asia-northeast1`
（ANTHROPIC_API_KEY は Task 7 の手順で設定済みであること）

- [ ] **Step 3: 最新 cg-cockpit.html を Xserver に再アップロード（ユーザー）**

- [ ] **Step 4: 画面で確認（ユーザー）**

- 商品分析タブ：商品名＋提供情報→[分析する]→数十秒で分析結果が表示される
- 診断タブ：商品/インフル分析を貼り[診断する]→10軸＋ROASの診断が表示される
- 候補タブ：キーワード→[検索]で結果テーブル、[Astreamにログイン]でログインページが開く
- フロー：各ステップに説明文、マニュアルタブが目次付きで表示される

---

## Self-Review 結果

- **Spec coverage:** ①商品分析Web完結=Task1,3 / ②診断Web完結=Task1,5 / ③YouTube検索UI=Task6 / ④Astreamリンク=Task6 / ⑤フロー説明=Task6 / ⑥マニュアルタブ=Task6 / LLMエンドポイント=Task2,3 / デプロイ手順=Task7。全要件にタスク対応あり。
- **Placeholder scan:** Astream正規URL・search_channels出力キーは「実装時に確認」と明示（プレースホルダではなく確認事項）。それ以外に未確定なし。
- **Type consistency:** `buildAnalyzePrompt(kind, payload)` の戻り値 `{system, user}` をTask3で使用、payloadキー（productName/info/productSummary/influencerSummary/conditions）はTask1テンプレートとTask4/5フロント送信で一致。`renderAnalyzeResult`/`escapeHtml` はTask4で定義しTask5/6で使用。
