/**
 * Instagram 投稿分析 — 取得済みデータ（CSV or BigQuery）から
 * 相関・リーチ上位/下位比較・カルーセル枚数別を算出しレポート出力する。
 *
 * 【使い方】
 *   node scripts/instagram/analyze.js                       # 当日のCSVを自動検出
 *   node scripts/instagram/analyze.js --date 2026-06-30     # 日付指定CSV
 *   node scripts/instagram/analyze.js --min-reach 100       # 低リーチ除外しきい値
 *   node scripts/instagram/analyze.js --min-age-hours 24    # 48時間→24時間に変更
 *   node scripts/instagram/analyze.js --keep-fresh          # 48時間未満も含める
 *   node scripts/instagram/analyze.js --keep-ads            # 広告/キャンペーン投稿も含める
 *
 * 既定では「48時間未満・広告(is_boosted)・キャンペーン/プレゼント投稿」を除外する。
 *
 * 【出力】分析レポート/instagram_data/<日付>_分析レポート.md ＋ <日付>_scatter.csv
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { computeFeaturesWithStats, runCorrelations, topBottomCompare, carouselBreakdown } = require('../../lib/ig-analyze');

const args = process.argv.slice(2);
const dateArg = (() => { const i = args.indexOf('--date'); return i >= 0 ? args[i + 1] : new Date().toISOString().slice(0, 10); })();
const minReach = (() => { const i = args.indexOf('--min-reach'); return i >= 0 && args[i + 1] ? parseInt(args[i + 1], 10) : 0; })();
const keepFresh = args.includes('--keep-fresh');
const keepAds = args.includes('--keep-ads');
const minAgeHours = (() => { const i = args.indexOf('--min-age-hours'); return i >= 0 && args[i + 1] ? parseInt(args[i + 1], 10) : 48; })();

const dataDir = path.join(__dirname, '../../分析レポート/instagram_data');

/** 簡易CSVパーサ（ヘッダ付き・ダブルクオート対応）。数値は自動変換。 */
function parseCsv(text) {
  const rows = [];
  const lines = text.split(/\r?\n/).filter((l) => l.length);
  if (!lines.length) return rows;
  const split = (line) => {
    const out = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') q = false;
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',') { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out;
  };
  const headers = split(lines[0]);
  for (let r = 1; r < lines.length; r++) {
    const cells = split(lines[r]);
    const obj = {};
    headers.forEach((h, i) => {
      const v = cells[i];
      if (v === '' || v == null) obj[h] = null;
      else if (/^-?\d+(\.\d+)?$/.test(v)) obj[h] = Number(v);
      else if (v === 'true' || v === 'false') obj[h] = v === 'true';
      else obj[h] = v;
    });
    rows.push(obj);
  }
  return rows;
}

function loadCsv(name) {
  const p = path.join(dataDir, name);
  if (!fs.existsSync(p)) {
    console.error('❌ CSVが見つかりません: %s', p);
    console.error('   先に node scripts/instagram/fetch_insights.js を実行してください。');
    process.exit(1);
  }
  return parseCsv(fs.readFileSync(p, 'utf8'));
}

const fmt = (v) => (v == null ? 'N/A' : (typeof v === 'number' ? (Math.abs(v) < 1 ? v.toFixed(3) : v.toFixed(2)) : v));

function main() {
  const media = loadCsv(`${dateArg}_media_raw.csv`);
  const insights = loadCsv(`${dateArg}_insights_raw.csv`);
  const { features, excluded } = computeFeaturesWithStats(media, insights, {
    minReach,
    minAgeHours: keepFresh ? 0 : minAgeHours,
    excludeBoosted: !keepAds,
    excludeCampaign: !keepAds,
  });
  if (!features.length) {
    console.error('❌ 有効な特徴量が0件です（除外条件: 48時間未満/広告/キャンペーン/minReach/reach欠損 を確認）。');
    process.exit(1);
  }

  const cors = runCorrelations(features);
  const cmp = topBottomCompare(features, 0.25);
  const breakdown = carouselBreakdown(features);

  // Markdownレポート
  const L = [];
  L.push(`# Instagram 投稿分析レポート（${dateArg}）`);
  L.push('');
  L.push('## 1. 全体サマリー');
  L.push(`- 分析対象投稿: ${features.length}件`);
  L.push('- 除外内訳:');
  L.push(`    - 投稿${minAgeHours}時間未満: ${excluded.tooFresh}件${keepFresh ? '（--keep-freshのため除外無効）' : ''}`);
  L.push(`    - 広告(is_boosted): ${excluded.boosted}件${keepAds ? '（--keep-adsのため除外無効）' : ''}`);
  L.push(`    - キャンペーン/プレゼント: ${excluded.campaign}件${keepAds ? '（--keep-adsのため除外無効）' : ''}`);
  L.push(`    - 低リーチ(minReach<${minReach}): ${excluded.lowReach}件`);
  L.push(`    - reach欠損: ${excluded.missingReach}件 / Insights取得不可: ${excluded.noInsights}件`);
  L.push('');
  L.push('## 2. 相関（Pearson / Spearman）');
  L.push('| x | y | n | Pearson | Spearman |');
  L.push('|---|---|---|---|---|');
  for (const c of cors) L.push(`| ${c.x} | ${c.y} | ${c.n} | ${fmt(c.pearson)} | ${fmt(c.spearman)} |`);
  L.push('');
  L.push('## 3. リーチ上位25% × 下位25%（中央値）');
  L.push('| 指標 | 上位25% | 下位25% |');
  L.push('|---|---|---|');
  for (const k of ['carousel_count', 'engagement_rate', 'save_rate', 'share_rate', 'hour']) {
    L.push(`| ${k} | ${fmt(cmp.top.medians[k])} | ${fmt(cmp.bottom.medians[k])} |`);
  }
  L.push('');
  L.push(`**上位25%代表投稿（n=${cmp.top.n}）:**`);
  cmp.top.permalinks.slice(0, 10).forEach((u) => L.push(`- ${u}`));
  L.push('');
  L.push(`**下位25%代表投稿（n=${cmp.bottom.n}）:**`);
  cmp.bottom.permalinks.slice(0, 10).forEach((u) => L.push(`- ${u}`));
  L.push('');
  L.push('## 4. カルーセル枚数別（中央値）');
  L.push('| 枚数 | n | engagement_rate | save_rate | reach |');
  L.push('|---|---|---|---|---|');
  for (const b of breakdown) L.push(`| ${b.carousel_count} | ${b.n} | ${fmt(b.median_engagement_rate)} | ${fmt(b.median_save_rate)} | ${fmt(b.median_reach)} |`);
  L.push('');
  L.push('## 5. 注意点');
  L.push('- 相関は因果ではない。傾向把握として読むこと。');
  L.push('- サンプル数が少ない枚数・群は結論を強く言い切らず仮説として扱う。');
  L.push('- 広告(is_boosted)・キャンペーン/プレゼント投稿・投稿48時間未満は既定で除外済み（上記サマリー参照）。');
  L.push('- 広告フラグ(is_boosted)は手動マーク前提。media_rawで未マークの広告は混在しうる。');
  L.push('- キャンペーン判定はcaptionキーワードによるヒューリスティックのため、取りこぼし・誤除外がありうる。');
  L.push('- Insights指標は反映遅延・保持期間・広告由来の扱いに制約がある。');
  L.push('');
  L.push('## 6. 次アクション（手動 → Claude）');
  L.push('- 上位25%投稿に theme_tag / hook_type を手動付与する。');
  L.push('- 引き渡し資料11章の分析プロンプトでClaudeに勝ちパターンを仮抽出させる。');

  const mdPath = path.join(dataDir, `${dateArg}_分析レポート.md`);
  fs.writeFileSync(mdPath, L.join('\n'));

  // scatter CSV
  const scatterCols = ['carousel_count', 'n', 'median_engagement_rate', 'median_save_rate', 'median_reach'];
  const scatterCsv = [scatterCols.join(','), ...breakdown.map((b) => scatterCols.map((c) => (b[c] == null ? '' : b[c])).join(','))].join('\n');
  fs.writeFileSync(path.join(dataDir, `${dateArg}_scatter.csv`), scatterCsv);

  console.log('✅ レポート出力: %s', mdPath);
  console.log(L.slice(0, 18).join('\n'));
}

main();
