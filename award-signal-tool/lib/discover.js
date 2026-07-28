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
 * カテゴリ均等＋ローテーションでシードを選ぶ（純粋関数・ネットワーク不要）。
 * ・タグ空カテゴリを除外。カテゴリ内/カテゴリ間の重複タグを除去（初出のみ）。
 * ・各カテゴリを rotation で回転させ、ラウンドロビンで cap 件まで選ぶ
 *   （＝タグを持つ全カテゴリが必ず1つ以上代表される。cap≥カテゴリ数のとき。
 *   ※同名タグがカテゴリ間で重複しない前提。重複する場合はグローバル重複除去が優先され、
 *     後発カテゴリが代表を得られないことがある）。
 * @param {Array<{category:string, tags:string[]}>} categories
 * @param {number} cap 1回で選ぶ最大シード数
 * @param {number} rotation 日次ローテーション用の整数（同じ値なら決定的）
 * @returns {{selected:{tag:string,category:string}[], deferred:{tag:string,category:string}[]}}
 */
export function selectSeeds(categories, cap, rotation = 0) {
  const limit = Math.max(0, Math.trunc(cap) || 0);
  const rot = Number.isFinite(rotation) ? Math.trunc(rotation) : 0;
  // 1) タグ空カテゴリを除外し、カテゴリ内の重複タグを除去（順序維持）
  const cats = [];
  for (const c of categories || []) {
    const seen = new Set();
    const tags = [];
    for (const t of c?.tags || []) {
      const v = normalize(t);
      if (v && !seen.has(v)) { seen.add(v); tags.push(v); }
    }
    if (tags.length) cats.push({ category: c.category, tags });
  }
  // 2) 各カテゴリを rotation で回転
  const rotated = cats.map((c) => {
    const n = c.tags.length;
    const off = ((rot % n) + n) % n;
    return { category: c.category, tags: c.tags.map((_, i) => c.tags[(off + i) % n]) };
  });
  // 3) ラウンドロビンで選ぶ（グローバル重複タグは初出のみ）
  const used = new Set();
  const selected = [];
  const maxLen = rotated.length ? Math.max(...rotated.map((c) => c.tags.length)) : 0;
  for (let r = 0; r < maxLen && selected.length < limit; r++) {
    for (const c of rotated) {
      if (selected.length >= limit) break;
      const tag = c.tags[r];
      if (tag === undefined || used.has(tag)) continue;
      used.add(tag);
      selected.push({ tag, category: c.category });
    }
  }
  // 4) 残り = deferred（選ばれなかったもの。グローバル重複も初出のみ）
  const deferred = [];
  for (const c of rotated) {
    for (const tag of c.tags) {
      if (used.has(tag)) continue;
      used.add(tag);
      deferred.push({ tag, category: c.category });
    }
  }
  return { selected, deferred };
}

/**
 * シード設定DB → TikTok共起タグ発掘 → Claude精選 → 既存候補を除外して「提案」を返す。
 * Notionには一切書き込まない。
 * 戻り値: [{name, category, reason}]
 */
export async function proposeCandidates(onLog) {
  const log = (s) => onLog && onLog(s);

  // 1) シード設定DBの「自動検索ON」を カテゴリ→タグ で集める（フラット化しない）
  const seeds = await listSeeds();
  const categories = [];
  const allSeedTags = new Set(); // 候補から除外する用（シード自身は候補にしない）
  for (const s of seeds) {
    if (!s.autoOn || !s.hashtags || s.hashtags === "—") continue;
    const tags = [];
    for (const t of s.hashtags.split(/[\s、,]+/)) {
      const v = normalize(t);
      if (v) { tags.push(v); allSeedTags.add(v); }
    }
    if (tags.length) categories.push({ category: s.category, tags });
  }
  if (!allSeedTags.size) { log("⚠ シード設定DBに有効なハッシュタグがありません"); return []; }

  // 2) カテゴリ均等＋日次ローテーションで今回のシードを選ぶ（上限14≒実証済み7〜8分）
  const CAP = 14;
  const rotation = Math.floor(Date.now() / 86400000); // 経過日数（ステートレス）
  const { selected, deferred } = selectSeeds(categories, CAP, rotation);
  const tags = selected.map((s) => s.tag);
  log(`対象カテゴリ ${categories.length}件 / 今回のシード ${tags.length}件（上限${CAP}）`);
  const byCat = {};
  for (const s of selected) (byCat[s.category] ??= []).push(s.tag);
  for (const [c, ts] of Object.entries(byCat)) log(`  ${c}: ${ts.join(", ")}`);
  if (deferred.length) log(`  今回見送り（次回ローテーション）: ${deferred.map((d) => d.tag).join(", ")}`);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "discover-"));
  const rawCsv = path.join(tmp, "raw.csv");
  const pickedCsv = path.join(tmp, "picked.csv");

  // 3) TikTok共起タグ発掘（件数はlib側で --max-seeds に明示指定して制御）
  await spawnP("node", [
    "scripts/apify/discover_tiktok.js", ...tags,
    "--per", "30", "--top", "8", "--max-seeds", String(tags.length), "--out", rawCsv,
  ], log);
  if (!fs.existsSync(rawCsv)) throw new Error("発掘結果CSVが生成されませんでした");
  if (!parseCSV(fs.readFileSync(rawCsv, "utf-8")).length) {
    log("⚠ 共起タグが1件も取れませんでした（Apifyのクレジット残高やシードを確認してください）");
    return [];
  }

  // 4) Claude精選（総称語・persona語・表記ゆれを落とし、カテゴリを補正）
  await spawnP("node", [
    "scripts/ai/filter_candidates.js", "--csv", rawCsv, "--out", pickedCsv,
  ], log);
  if (!fs.existsSync(pickedCsv)) throw new Error("精選結果CSVが生成されませんでした");
  const picked = parseCSV(fs.readFileSync(pickedCsv, "utf-8"));

  // 5) 既存候補・シード自体・重複を除外して提案リストにする（登録はしない）
  const existing = new Set((await listCandidates()).map((c) => c.name.trim()));
  const seen = new Set();
  const proposals = [];
  for (const r of picked) {
    const name = normalize(r.name);
    if (!name || seen.has(name) || existing.has(name) || allSeedTags.has(name)) continue;
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
