// ブランド→商品の解決: 採用されたブランドから「具体的な商品」を発掘して提案する。
// ※受賞対象は商品/サービス単位（お試し会・商品サンプル取寄せ・重複排除ルールが商品前提）。
// ※ここでもNotionには一切書き込まない。登録は承認後の adoptCandidates() のみ。
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseCSV } from "./discover.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");

// 商品まで落とすカテゴリ（受賞対象が「商品」であるもの）。
// おでかけ・スポット / エンタメ・コンテンツ は対象そのものが受賞対象なので解決しない。
const PRODUCT_CATEGORIES = new Set([
  "コスメ", "スキンケア", "ヘアケア", "ボディケア", "フレグランス",
  "食品・飲料", "ライフスタイル雑貨", "ファッション",
]);

/**
 * このカテゴリは「ブランド→商品」の解決が必要か（純粋関数）。
 * 未知・空のカテゴリは false（安全側: 無駄な検索を走らせない）。
 * @param {string} category
 * @returns {boolean}
 */
export function needsProductResolution(category) {
  return PRODUCT_CATEGORIES.has(String(category || "").trim());
}

// 1ブランド約30秒（--per 80 実測）。1回の解決はここまで（≒5分）。超過分は次回に回す。
export const BRAND_CAP = 10;

/**
 * 採用ブランドを「今回解決する / 対象外 / 次回に回す」に振り分ける（純粋関数・ネットワーク不要）。
 * ・非商品系カテゴリ（スポット・エンタメ等）は skipped（対象自体が受賞対象のため）
 * ・# と前後空白を正規化し、空名と重複は捨てる
 * ・cap を超えた分は deferred（サイレントに切り捨てない）
 * @param {Array<{name:string, category:string}>} brands
 * @param {number} cap
 * @returns {{run:{name:string,category:string}[], skipped:{brand:string,category:string,why:string}[], deferred:{name:string,category:string}[]}}
 */
export function planResolution(brands, cap = BRAND_CAP) {
  const limit = Math.max(0, Math.trunc(cap) || 0);
  const targets = [], skipped = [], seen = new Set();
  for (const b of brands || []) {
    const name = String(b?.name || "").replace(/^#/, "").trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const category = b?.category || "";
    if (!needsProductResolution(category)) {
      skipped.push({ brand: name, category, why: "このカテゴリは対象自体が受賞対象のため商品解決しません" });
      continue;
    }
    targets.push({ name, category });
  }
  return { run: targets.slice(0, limit), skipped, deferred: targets.slice(limit) };
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

/**
 * 採用されたブランドから具体的な商品を発掘して「提案」を返す。Notionには一切書き込まない。
 * 振り分けは planResolution（純粋関数・テスト済み）に委ねる。
 * @param {Array<{name:string, category:string}>} brands
 * @returns {Promise<{resolved:Array<{brand:string,category:string,products:Array<{name:string,reason:string}>}>,
 *                    skipped:Array<{brand:string,category:string,why:string}>,
 *                    deferred:Array<{name:string,category:string}>}>}
 */
export async function resolveProducts(brands, onLog) {
  const log = (s) => onLog && onLog(s);
  const { run, skipped, deferred } = planResolution(brands, BRAND_CAP);

  if (skipped.length) {
    log(`商品解決の対象外 ${skipped.length}件（スポット/エンタメ等はそのまま登録できます）: ${skipped.map(s => s.brand).join(", ")}`);
  }
  if (!run.length) { log("商品解決が必要なブランドはありません"); return { resolved: [], skipped, deferred }; }
  if (deferred.length) {
    log(`⚠ 今回は ${run.length}件を解決します（上限${BRAND_CAP}）。見送り（次回実行してください）: ${deferred.map(d => d.name).join(", ")}`);
  }
  log(`商品を解決中… ${run.length}ブランド（1件あたり約30秒）: ${run.map(r => r.name).join(", ")}`);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "products-"));
  const rawCsv = path.join(tmp, "raw.csv");
  const pickedCsv = path.join(tmp, "picked.csv");

  // 1) ブランド名でTikTok再検索（既存スクリプトを無変更で再利用）
  //    --per 80 / --top 20 は実測に基づく（2026-07-28）。--per 30 --top 12 だと商品名を取りこぼす:
  //    商品タグは総称語より下位（実測15〜16位）に出るため、サンプル数と取得深度の両方が要る。
  //    時間は --per 30 と変わらない（実測30秒/ブランド。Apify側の固定オーバーヘッドが支配的）。
  await spawnP("node", [
    "scripts/apify/discover_tiktok.js", ...run.map(r => r.name),
    "--per", "80", "--top", "20", "--max-seeds", String(run.length), "--out", rawCsv,
  ], log);
  if (!fs.existsSync(rawCsv)) throw new Error("共起タグCSVが生成されませんでした");
  if (!parseCSV(fs.readFileSync(rawCsv, "utf-8")).length) {
    log("⚠ 共起タグが1件も取れませんでした（Apifyのクレジット残高を確認してください）");
    return { resolved: run.map(r => ({ brand: r.name, category: r.category, products: [] })), skipped, deferred };
  }

  // 2) Claude精選（このブランドの具体的商品はどれか）
  await spawnP("node", [
    "scripts/ai/filter_products.js", "--csv", rawCsv, "--out", pickedCsv,
  ], log);
  if (!fs.existsSync(pickedCsv)) throw new Error("商品精選CSVが生成されませんでした");
  const picked = parseCSV(fs.readFileSync(pickedCsv, "utf-8"));

  // 3) ブランドごとにまとめる。商品0件のブランドも必ず結果に残す（候補を失わないため）
  const byBrand = new Map(run.map(r => [r.name, { brand: r.name, category: r.category, products: [] }]));
  for (const p of picked) {
    const brand = String(p.brand || "").trim();
    const name = String(p.name || "").trim();
    if (!brand || !name) continue;
    const entry = byBrand.get(brand);
    if (!entry) continue;
    if (entry.products.some(x => x.name === name)) continue;
    entry.products.push({ name, reason: p.reason || "" });
  }
  const resolved = [...byBrand.values()];
  for (const r of resolved) {
    log(r.products.length
      ? `  ${r.brand}: ${r.products.map(p => p.name).join(" / ")}`
      : `  ${r.brand}: 商品を特定できませんでした（ブランドのまま登録できます）`);
  }
  return { resolved, skipped, deferred };
}
