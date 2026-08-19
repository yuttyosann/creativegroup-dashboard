// Trepoトレンド大賞 実績シグナル収集ツール — Expressサーバー（非同期ジョブ）
import express from "express";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listCandidates, listSeeds, writeSignal, SIGNAL_FIELDS } from "./lib/notion.js";
import { runEngine, ENGINES } from "./lib/engines.js";
import { proposeCandidates, adoptCandidates } from "./lib/discover.js";
import { resolveProducts } from "./lib/products.js";
import { requireAuth, authEnabled } from "./lib/auth.js";

// .env 読み込み（Node20.12+ / 24 の process.loadEnvFile）
try { process.loadEnvFile?.(); } catch { /* .env が無くても可 */ }

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());
// 静的配信は実行ディレクトリに依存しないよう絶対パスで（コンテナのCWD=/app対策）
app.use(express.static(path.join(__dirname, "public")));

const jobs = new Map(); // id -> job

// フロントのGoogleサインイン初期化用（公開: クライアントIDのみ返す。未設定ならログイン不要）
app.get("/api/config", (_req, res) => {
  res.json({ clientId: process.env.GOOGLE_OAUTH_CLIENT_ID || "", authEnabled: authEnabled() });
});

app.get("/api/candidates", requireAuth, async (_req, res) => {
  try { res.json(await listCandidates()); }
  catch (e) { res.status(500).json({ error: String(e.message) }); }
});

app.get("/api/seeds", requireAuth, async (_req, res) => {
  try { res.json(await listSeeds()); }
  catch (e) { res.status(500).json({ error: String(e.message) }); }
});

app.get("/api/signals", requireAuth, (_req, res) => {
  res.json(Object.entries(ENGINES).map(([key, e]) => ({ key, label: e.label })));
});

app.post("/api/jobs", requireAuth, async (req, res) => {
  const { candidateIds = [], signals = [] } = req.body || {};
  if (!candidateIds.length || !signals.length) {
    return res.status(400).json({ error: "candidateIds と signals を指定してください" });
  }
  const id = randomUUID();
  const job = { id, status: "running", createdAt: Date.now(), signals, candidateIds, log: [], results: {}, error: null };
  jobs.set(id, job);
  res.json({ jobId: id });
  runJob(job).catch((e) => { job.status = "error"; job.error = String(e.message); });
});

app.get("/api/jobs/:id", requireAuth, (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: "not found" });
  res.json(job);
});

// 候補の提案（シード設定DB → TikTok共起タグ発掘 → Claude精選）
// ここではNotionに登録しない。編集部が選んだものだけ /api/candidates/bulk で登録する。
app.post("/api/discover", requireAuth, (_req, res) => {
  const id = randomUUID();
  const job = { id, status: "running", createdAt: Date.now(), type: "discover", log: [], proposals: [], error: null };
  jobs.set(id, job);
  res.json({ jobId: id });
  runDiscover(job).catch((e) => { job.status = "error"; job.error = String(e.message); });
});

async function runDiscover(job) {
  const log = (s) => { job.log.push(String(s).replace(/\n+$/, "")); };
  log("=== 候補を提案中（TikTok共起タグ発掘 → Claude精選）===");
  const proposals = await proposeCandidates(log);
  job.proposals = proposals;
  log(`=== 完了: ${proposals.length}件を提案しました（採用するものを選んでください）===`);
  job.status = "done";
}

// 承認された候補だけを候補プールDBに登録する
app.post("/api/candidates/bulk", requireAuth, async (req, res) => {
  const { candidates = [] } = req.body || {};
  if (!Array.isArray(candidates) || !candidates.length) {
    return res.status(400).json({ error: "candidates を1件以上指定してください" });
  }
  try {
    res.json(await adoptCandidates(candidates));
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

// 採用したブランドから具体的な商品を解決する（提案のみ。Notionには書かない）
app.post("/api/products/resolve", requireAuth, (req, res) => {
  const { brands = [] } = req.body || {};
  if (!Array.isArray(brands) || !brands.length) {
    return res.status(400).json({ error: "brands を1件以上指定してください" });
  }
  const id = randomUUID();
  const job = { id, status: "running", createdAt: Date.now(), type: "products", log: [], resolved: [], skipped: [], deferred: [], error: null };
  jobs.set(id, job);
  res.json({ jobId: id });
  runResolve(job, brands).catch((e) => { job.status = "error"; job.error = String(e.message); });
});

async function runResolve(job, brands) {
  const log = (s) => { job.log.push(String(s).replace(/\n+$/, "")); };
  log("=== 採用したブランドの具体的な商品を探しています ===");
  const { resolved, skipped, deferred } = await resolveProducts(brands, log);
  job.resolved = resolved;
  job.skipped = skipped;
  job.deferred = deferred;
  const total = resolved.reduce((n, r) => n + r.products.length, 0);
  log(`=== 完了: ${total}件の商品候補が見つかりました ===`);
  job.status = "done";
}

async function runJob(job) {
  const log = (s) => { job.log.push(s.replace(/\n+$/, "")); };
  const all = await listCandidates();
  const targets = all.filter((c) => job.candidateIds.includes(c.id));
  for (const c of targets) job.results[c.id] = { name: c.name, signals: {} };

  for (const sig of job.signals) {
    if (!ENGINES[sig]) { log(`⚠ 未知のシグナル: ${sig}`); continue; }
    log(`=== ${ENGINES[sig].label} 取得開始（${targets.length}件）===`);
    let out;
    try {
      out = await runEngine(sig, targets.map((c) => ({ id: c.id, name: c.name })), log);
    } catch (e) {
      log(`❌ ${ENGINES[sig].label} 失敗: ${e.message}`);
      for (const c of targets) job.results[c.id].signals[sig] = { point: null, evidence: "取得失敗", wrote: false };
      continue;
    }
    // Notion書き戻し（_点は空欄時のみ）
    for (const c of targets) {
      const r = out.find((x) => x.name === c.name) || { point: null, evidence: "データなし" };
      let wrote = false;
      try {
        const w = await writeSignal(c.id, sig, r.point, r.evidence, c.points[sig]);
        wrote = !!w.wrotePoint;
      } catch (e) { log(`  書込失敗 ${c.name}: ${e.message}`); }
      job.results[c.id].signals[sig] = { point: r.point, evidence: r.evidence, wrote };
      log(`  ${c.name}: ${ENGINES[sig].label}=${r.point ?? "—"}（${wrote ? "点を書込" : "点は既存維持/空"}）`);
    }
  }
  job.status = "done";
  log("=== 完了 ===");
}

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`▶ award-signal-tool listening on http://localhost:${PORT}`));
