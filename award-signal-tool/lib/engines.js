// 実績シグナル取得エンジン：既存スクリプトを子プロセスで実行し、出力CSVをパースする
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../.."); // creativegroup-dashboard

// シグナル → 実行コマンドと出力CSVの読み方
export const ENGINES = {
  search: {
    label: "検索の伸び",
    build: (inCsv, outCsv) => ["python3", [
      "scripts/trends/google_trends.py", "score",
      "--csv", inCsv, "--col", "対象名", "--out", outCsv,
    ]],
    nameCol: "keyword",
    pointCol: "suggested_point",
    evidence: (r) => `伸び率 ${r.rising_ratio || "-"} / 関心 ${r.mean_interest || "-"}`,
  },
  media: {
    label: "メディア掲載",
    build: (inCsv, outCsv) => ["python3", [
      "scripts/media/fetch_media.py",
      "--csv", inCsv, "--col", "対象名", "--out", outCsv,
    ]],
    nameCol: "keyword",
    pointCol: "suggested_point",
    evidence: (r) => `News ${r.news_count || 0} / PR TIMES ${r.prtimes_total || r.prtimes_count || 0}`,
  },
  sns: {
    label: "SNS話題量",
    build: (inCsv, outCsv) => ["node", [
      "scripts/apify/fetch_tiktok.js",
      "--csv", inCsv, "--col", "対象名", "--out", outCsv,
    ]],
    nameCol: "対象",
    pointCol: "話題量_点(1-5)",
    evidence: (r) => `総再生数 ${r["総再生数"] || 0} / 動画 ${r["サンプル動画数"] || 0}`,
  },
};

// 簡易CSVパーサ（クオート対応）
function parseCSV(text) {
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
  return rows.slice(1).filter((r) => r.some((x) => x !== "")).map((r) => {
    const o = {};
    header.forEach((h, i) => (o[h] = r[i] ?? ""));
    return o;
  });
}

function spawnP(cmd, args, onLog) {
  return new Promise((resolve, reject) => {
    const ps = spawn(cmd, args, { cwd: REPO_ROOT, env: process.env });
    let stderr = "";
    ps.stdout.on("data", (d) => onLog && onLog(d.toString()));
    ps.stderr.on("data", (d) => { stderr += d.toString(); onLog && onLog(d.toString()); });
    ps.on("error", reject);
    ps.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`exit ${code}: ${stderr.slice(-300)}`))));
  });
}

/**
 * 1シグナルを candidates(配列 {id,name}) に対して実行。
 * 戻り値: [{name, point, evidence}]
 */
export async function runEngine(signalKey, candidates, onLog) {
  const eng = ENGINES[signalKey];
  if (!eng) throw new Error("unknown signal " + signalKey);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "award-"));
  const inCsv = path.join(tmp, "in.csv");
  const outCsv = path.join(tmp, "out.csv");
  // 入力CSV（ヘッダは 対象名）
  const lines = ["対象名", ...candidates.map((c) => `"${String(c.name).replace(/"/g, '""')}"`)];
  fs.writeFileSync(inCsv, lines.join("\n"), "utf-8");

  const [cmd, args] = eng.build(inCsv, outCsv);
  onLog && onLog(`▶ ${eng.label}: ${cmd} ${args.join(" ")}\n`);
  await spawnP(cmd, args, onLog);

  if (!fs.existsSync(outCsv)) throw new Error("出力CSVが生成されませんでした");
  const rows = parseCSV(fs.readFileSync(outCsv, "utf-8"));
  const byName = new Map(rows.map((r) => [String(r[eng.nameCol]).trim(), r]));
  return candidates.map((c) => {
    const r = byName.get(String(c.name).trim());
    if (!r) return { name: c.name, point: null, evidence: "データなし" };
    const p = r[eng.pointCol];
    return {
      name: c.name,
      point: p === "" || p == null ? null : Number(p),
      evidence: eng.evidence(r),
    };
  });
}
