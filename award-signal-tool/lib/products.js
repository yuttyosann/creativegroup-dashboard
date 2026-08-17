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
