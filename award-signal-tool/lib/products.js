// ブランド→商品の解決: 採用されたブランドから「具体的な商品」を発掘して提案する。
// ※受賞対象は商品/サービス単位（お試し会・商品サンプル取寄せ・重複排除ルールが商品前提）。
// ※ここでもNotionには一切書き込まない。登録は承認後の adoptCandidates() のみ。
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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
