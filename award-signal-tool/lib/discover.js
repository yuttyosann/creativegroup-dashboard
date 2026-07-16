// 候補の自動生成（Layer 1）: シード設定DBのハッシュタグ → TikTok共起タグ発掘 → Claude精選 → 「提案」を返す
// ※Google Trendsは候補発見に使えない（discover=404 / related=429）ため、TikTokを主軸にする。
// ※ここではNotionに登録しない。編集部が承認した候補だけを adoptCandidates() で登録する
//   （設計思想「編集部は探さず"評価"する」。自動登録は過去にDBを90件のノイズで汚した）。
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listSeeds, listCandidates, createCandidate } from "./notion.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");

export function parseCSV(text) {
  text = text.replace(/^﻿/, "");
  const rows = [];
  let field = "", row = [], inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQ = false;
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c === "\r") { /* skip */ }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const header = rows[0];
  return rows.slice(1).filter(r => r.some(x => x !== "")).map(r => {
    const o = {}; header.forEach((h, i) => (o[h] = r[i] ?? "")); return o;
  });
}

function spawnP(cmd, args, onLog) {
  return new Promise((resolve, reject) => {
    const ps = spawn(cmd, args, { cwd: REPO_ROOT, env: process.env });
    let stderr = "";
    ps.stdout.on("data", d => onLog && onLog(d.toString()));
    ps.stderr.on("data", d => { stderr += d.toString(); onLog && onLog(d.toString()); });
    ps.on("error", reject);
    ps.on("close", code => code === 0 ? resolve() : reject(new Error(`exit ${code}: ${stderr.slice(-300)}`)));
  });
}

const normalize = (s) => String(s || "").replace(/^#/, "").trim();

/**
 * シード設定DB → TikTok共起タグ発掘 → Claude精選 → 既存候補を除外して「提案」を返す。
 * Notionには一切書き込まない。
 * 戻り値: [{name, category, reason}]
 */
export async function proposeCandidates(onLog) {
  const log = (s) => onLog && onLog(s);

  // 1) シード設定DBから「自動検索ON」のハッシュタグを集める
  const seeds = await listSeeds();
  const seedTags = new Set();
  for (const s of seeds) {
    if (!s.autoOn || !s.hashtags || s.hashtags === "—") continue;
    for (const t of s.hashtags.split(/[\s、,]+/)) {
      const v = normalize(t);
      if (v) seedTags.add(v);
    }
  }
  if (!seedTags.size) { log("⚠ シード設定DBに有効なハッシュタグがありません"); return []; }
  const tags = [...seedTags];
  log(`シード ${tags.length}件: ${tags.join(", ")}`);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "discover-"));
  const rawCsv = path.join(tmp, "raw.csv");
  const pickedCsv = path.join(tmp, "picked.csv");

  // 2) TikTok共起タグ発掘
  await spawnP("node", [
    "scripts/apify/discover_tiktok.js", ...tags,
    "--per", "30", "--top", "8", "--out", rawCsv,
  ], log);
  if (!fs.existsSync(rawCsv)) throw new Error("発掘結果CSVが生成されませんでした");
  if (!parseCSV(fs.readFileSync(rawCsv, "utf-8")).length) {
    log("⚠ 共起タグが1件も取れませんでした（Apifyのクレジット残高やシードを確認してください）");
    return [];
  }

  // 3) Claude精選（総称語・persona語・表記ゆれを落とし、カテゴリを補正）
  await spawnP("node", [
    "scripts/ai/filter_candidates.js", "--csv", rawCsv, "--out", pickedCsv,
  ], log);
  if (!fs.existsSync(pickedCsv)) throw new Error("精選結果CSVが生成されませんでした");
  const picked = parseCSV(fs.readFileSync(pickedCsv, "utf-8"));

  // 4) 既存候補・シード自体・重複を除外して提案リストにする（登録はしない）
  const existing = new Set((await listCandidates()).map(c => c.name.trim()));
  const seen = new Set();
  const proposals = [];
  for (const r of picked) {
    const name = normalize(r.name);
    if (!name || seen.has(name) || existing.has(name) || seedTags.has(name)) continue;
    seen.add(name);
    proposals.push({ name, category: r.category || "その他", reason: r.reason || "" });
  }
  log(`提案 ${proposals.length}件（既存・シード重複を除外）`);
  return proposals;
}

/**
 * 編集部が承認した候補だけを候補プールDBに登録する。
 * 戻り値: {created:[{name,category}], skipped:[...], failed:[{name,error}]}
 */
export async function adoptCandidates(items, onLog) {
  const log = (s) => onLog && onLog(s);
  const existing = new Set((await listCandidates()).map(c => c.name.trim()));
  const created = [], skipped = [], failed = [];
  for (const it of items) {
    const name = normalize(it?.name);
    if (!name) continue;
    if (existing.has(name)) { skipped.push(name); log(`  − ${name}（既にDBにあります）`); continue; }
    const category = it.category || "その他";
    const note = ["🔎自動生成(TikTok共起タグ→Claude精選)", it.reason].filter(Boolean).join(" ");
    try {
      await createCandidate({ name, category, note });
      existing.add(name);
      created.push({ name, category });
      log(`  ＋ ${name}（${category}）`);
    } catch (e) {
      failed.push({ name, error: e.message });
      log(`  ✗ ${name} 登録失敗: ${e.message}`);
    }
  }
  return { created, skipped, failed };
}
