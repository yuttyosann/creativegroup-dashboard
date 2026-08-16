'use strict';
/**
 * pamun_ingest を初めて実データで動かす前の疎通・前提チェック（読み取りのみ・書き込みなし）。
 *
 * 「タブがあるか」ではなく「スクリプトが読める形になっているか」を確認する。
 * とくに重要なのは *ヘッダー行の位置*: lib/kizuki/* と scripts/kizuki/* はすべて
 * rows.slice(1) つまり「1行目＝ヘッダー、2行目以降＝データ」を前提にしている。
 * 一方 CG_気づきワード台帳.gs が生成するシートは 2行目がタイトル帯・3行目がヘッダーなので、
 * GAS 生成のままだとヘッダー行が data として読まれる。ここで実物を見て判定する。
 *
 * 使い方: node scripts/kizuki/pamun_preflight.js
 * 終了コード: 0=実行可 / 1=要対応（NG あり）
 */
require('dotenv').config({ override: true });
const { google } = require('googleapis');
const ledger = require('../../lib/kizuki/ledger-store');
const reviewIngest = require('../../lib/kizuki/review-ingest');

const SHEET_ID = process.env.SHEET_ID;
const MAPPING_TAB = 'Pamun取込マッピング';
const SURVEY_TAB = '《事後アンケート》詳細';

const MAPPING_HEADER = ['campaign_id', 'report_name', 'case_id', 'n'];
const REVIEW_HEADER_TAIL = ['source', 'campaign_id', 'confidence'];
const SURVEY_MIN_COLS = 6; // A..F（年代/満足度/良かった点/改善点/容器希望/お気に入り）

const results = [];
const ok = (label, detail) => results.push({ level: 'ok', label, detail });
const warn = (label, detail, fix) => results.push({ level: 'warn', label, detail, fix });
const ng = (label, detail, fix) => results.push({ level: 'ng', label, detail, fix });

const norm = (v) => String(v === null || v === undefined ? '' : v).trim().toLowerCase();

/**
 * 先頭5行から、expected の見出しを最も多く含む行を探す。
 * 戻り値 { row, hit } — row は1始まりの行番号、見つからなければ row=0。
 */
function findHeaderRow(rows, expected) {
  let best = { row: 0, hit: 0 };
  const want = expected.map(norm);
  for (let i = 0; i < Math.min(5, rows.length); i++) {
    const cells = (rows[i] || []).map(norm);
    const hit = want.filter((w) => cells.includes(w)).length;
    if (hit > best.hit) best = { row: i + 1, hit };
  }
  return best;
}

async function main() {
  console.log('=== pamun_ingest プリフライト（読み取りのみ）===\n');

  // --- 1. 環境変数 ---------------------------------------------------------
  if (!SHEET_ID) {
    ng('SHEET_ID', '未設定', '.env に SHEET_ID=<コックピットのスプレッドシートID> を追加');
  } else {
    ok('SHEET_ID', SHEET_ID);
  }
  if (process.env.ANTHROPIC_API_KEY) {
    ok('ANTHROPIC_API_KEY', '設定済み');
  } else {
    warn('ANTHROPIC_API_KEY', '未設定（--dry-run は通るが本実行で失敗する）',
      '.env に ANTHROPIC_API_KEY=sk-ant-... を追加');
  }
  if (!SHEET_ID) return finish();

  // --- 2. Sheets 認証（ADC） ----------------------------------------------
  let sheets;
  let meta;
  try {
    const auth = new google.auth.GoogleAuth({ scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
    sheets = google.sheets({ version: 'v4', auth: await auth.getClient() });
    const res = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID, fields: 'properties.title,sheets.properties.title' });
    meta = res.data;
    ok('Sheets 認証', `「${meta.properties.title}」に接続できました`);
  } catch (e) {
    const hint = /insufficient|scope|PERMISSION_DENIED|invalid_scope/i.test(e.message)
      ? 'ADC に spreadsheets スコープがない可能性。gcloud auth application-default login --scopes=https://www.googleapis.com/auth/spreadsheets,https://www.googleapis.com/auth/cloud-platform を実行するか、サービスアカウント鍵を GOOGLE_APPLICATION_CREDENTIALS に設定'
      : 'SHEET_ID が正しいか、その Google アカウント／サービスアカウントに閲覧権限があるか確認';
    ng('Sheets 認証', e.message, hint);
    return finish();
  }

  const titles = meta.sheets.map((s) => s.properties.title);
  const readRows = async (tab) => {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${tab}!A:Z` });
    return res.data.values || [];
  };

  // --- 3. 気づきワード台帳 -------------------------------------------------
  let ledgerRows = [];
  if (!titles.includes(ledger.TABS.LEDGER)) {
    ng(ledger.TABS.LEDGER, 'タブがありません', 'CG_気づきワード台帳.gs の addKizukiLedger() を実行（buildKizukiLedger() は既存タブを削除するので使わない）');
  } else {
    ledgerRows = await readRows(ledger.TABS.LEDGER);
    const h = findHeaderRow(ledgerRows, ['word_id', 'ワード', 'ケース']);
    if (h.row === 1 || h.row === 0) {
      ok(ledger.TABS.LEDGER, `${Math.max(0, ledgerRows.length - 1)} 行`);
    } else {
      ng(ledger.TABS.LEDGER, `ヘッダーが ${h.row} 行目（スクリプトは1行目を前提）`,
        `1〜${h.row - 1} 行目（タイトル帯など）を削除してヘッダーを1行目にする`);
    }
    // GAS が書き込む説明用サンプル行。残すと架空ワードが採点され、候補ワードにも混ざる。
    const sample = ledgerRows.slice(1).filter((r) => norm(r[ledger.L.case]) === '2026-06-avene');
    if (sample.length) {
      ng(`${ledger.TABS.LEDGER} / サンプル行`,
        `GAS のサンプル行が ${sample.length} 件残っています（案件ID=2026-06-AVENE / ${sample.map((r) => r[ledger.L.wordId]).join(',')}）`,
        '台帳と各シグナルタブから説明用サンプル行を削除する（架空ワードが採点され、pamun_ingest の候補ワードにも混ざります）');
    }
  }

  // --- 4. モニターシグナル（source/campaign_id/confidence の3列） ----------
  if (!titles.includes(ledger.TABS.REVIEW)) {
    ng(ledger.TABS.REVIEW, 'タブがありません', 'addKizukiLedger() を実行');
  } else {
    const rows = await readRows(ledger.TABS.REVIEW);
    const h = findHeaderRow(rows, ['word_id', 'レビュー件数', ...REVIEW_HEADER_TAIL]);
    const header = (rows[h.row - 1] || []).map(norm);
    const missing = REVIEW_HEADER_TAIL.filter((c) => !header.includes(c));
    if (h.row !== 1 && h.row !== 0) {
      ng(ledger.TABS.REVIEW, `ヘッダーが ${h.row} 行目（スクリプトは1行目を前提）`,
        `1〜${h.row - 1} 行目を削除してヘッダーを1行目にする`);
    } else if (missing.length) {
      ng(ledger.TABS.REVIEW, `列が不足: ${missing.join(', ')}`,
        `ヘッダー行の F/G/H に ${REVIEW_HEADER_TAIL.join(' / ')} を手で追記（既存の手入力行は source 空欄＝manual 扱いなのでそのままでよい）`);
    } else {
      ok(ledger.TABS.REVIEW, `3列あり（既存 ${Math.max(0, rows.length - 1)} 行）`);
    }
  }

  // --- 5. Pamun取込マッピング ---------------------------------------------
  let mapping = [];
  if (!titles.includes(MAPPING_TAB)) {
    ng(MAPPING_TAB, 'タブがありません',
      `新規タブ「${MAPPING_TAB}」を作り、1行目に ${MAPPING_HEADER.join(' / ')} を入れて2行目からデータを書く（他タブのようなタイトル帯は付けない）`);
  } else {
    const rows = await readRows(MAPPING_TAB);
    const h = findHeaderRow(rows, MAPPING_HEADER);
    if (h.row !== 1) {
      ng(MAPPING_TAB, h.row === 0 ? 'ヘッダー行が見つかりません' : `ヘッダーが ${h.row} 行目（1行目でないと ${h.row} 行目が施策データとして読まれます）`,
        `ヘッダー(${MAPPING_HEADER.join(',')})を1行目に移動する`);
    } else {
      mapping = rows.slice(1)
        .filter((r) => r[0] && r[1] && r[2])
        .map((r) => ({ campaignId: r[0], reportName: r[1], caseId: r[2], n: r[3] }));
      if (!mapping.length) {
        ng(MAPPING_TAB, 'データ行が0件', '取り込む施策を1行以上追加（campaign_id / report_name / case_id は必須）');
      } else {
        ok(MAPPING_TAB, `${mapping.length} 施策`);
      }
    }
  }

  // --- 6. 施策ごとの前提（候補ワード・レポートタブ） -----------------------
  for (const m of mapping) {
    const label = `施策 ${m.campaignId}`;
    const candidates = ledgerRows.slice(1)
      .filter((r) => r[ledger.L.wordId] && r[ledger.L.case] === m.caseId);
    if (!candidates.length) {
      ng(`${label} / 候補ワード`, `台帳に case_id=「${m.caseId}」の行がありません（この施策は skip されます）`,
        '台帳の case 列の表記をマッピングの case_id と一致させる');
    } else {
      ok(`${label} / 候補ワード`, `${candidates.length} 件`);
    }

    const surveyTab = `${m.reportName}${SURVEY_TAB}`;
    if (!titles.includes(surveyTab)) {
      const near = titles.filter((t) => t.includes(SURVEY_TAB));
      ng(`${label} / アンケート`, `タブ「${surveyTab}」がありません`,
        near.length
          ? `report_name を実在タブに合わせる。候補: ${near.map((t) => `「${t.replace(SURVEY_TAB, '')}」`).join(' / ')}`
          : `施策レポート(xlsx)をこのスプレッドシートに取り込み、タブ名を「<report_name>${SURVEY_TAB}」にする`);
      continue;
    }
    const surveyRows = await readRows(surveyTab);
    const respondents = reviewIngest.parseSurveyRows(surveyRows);
    const widthOk = (surveyRows[0] || []).length >= SURVEY_MIN_COLS;
    if (!respondents.length) {
      ng(`${label} / アンケート`, `「${surveyTab}」の回答が0件（生成なしで終わります）`, '1行目がヘッダー・2行目以降が回答になっているか確認');
    } else if (!widthOk) {
      warn(`${label} / アンケート`, `回答 ${respondents.length} 人だが列が ${(surveyRows[0] || []).length} 列（A..F の6列を想定）`,
        '列順が 年代/満足度/良かった点/改善点/容器希望/お気に入り になっているか確認');
    } else {
      const nEff = m.n ? Number(m.n) : respondents.length;
      ok(`${label} / アンケート`, `回答 ${respondents.length} 人 / 共感率の分母 n=${nEff}${m.n ? '（マッピング指定）' : '（回答数を使用）'}`);
    }
  }

  finish();
}

function finish() {
  const icon = { ok: '✅', warn: '⚠️ ', ng: '❌' };
  for (const r of results) {
    console.log(`${icon[r.level]} ${r.label}: ${r.detail}`);
    if (r.fix) console.log(`      → ${r.fix}`);
  }
  const ngCount = results.filter((r) => r.level === 'ng').length;
  console.log('');
  if (ngCount) {
    console.log(`要対応 ${ngCount} 件。上記を直してから再実行してください。`);
    process.exitCode = 1;
  } else {
    console.log('前提OK。次: node scripts/kizuki/pamun_ingest.js --dry-run');
  }
}

main().catch((e) => { console.error('❌ プリフライト自体が失敗:', e.message); process.exit(1); });
