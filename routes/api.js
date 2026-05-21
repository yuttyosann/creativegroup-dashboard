'use strict';
/**
 * routes/api.js
 * MFクラウド請求書API v3 プロキシルート
 *
 * エンドポイント一覧:
 *   GET /api/auth-status   — 認証状態確認（フロントが使用）
 *   GET /api/summary       — 直近12ヶ月の月次売上サマリー
 *   GET /api/billings      — 請求書一覧（?status=unpaid で未入金フィルタ）
 *   GET /api/partners      — クライアント別収益（今月）
 *   GET /api/team-summary  — チーム・サービス・契約形態別サマリー
 *   GET /api/classifications  — 分類マッピング取得
 *   POST /api/classifications — 分類マッピング保存
 *
 * 認証:
 *   全APIルート（auth-status と classifications 以外）に
 *   refreshIfNeeded ミドルウェアを適用し、トークン期限切れを自動更新する。
 */

const express = require('express');
const axios   = require('axios');
const path    = require('path');
const fs      = require('fs');
const { refreshAccessToken } = require('./auth');

const router = express.Router();

// MFクラウド請求書API ベースURL
const MF_API_BASE = 'https://invoice.moneyforward.com/api/v3';

// ── マスタ定義 ─────────────────────────────────────────────
const TEAMS          = ['Marketing', 'PR', 'Advertisement', 'Casting', 'Media'];
const SERVICES       = ['Pamun', 'インフルエンサー', 'PR', 'Trepo', '雑誌', '美容医療', 'SNS運用', '広告', 'オフラインイベント', '制作', 'その他'];
const CONTRACT_TYPES = ['単発', 'サブスク'];

// ── 分類データ永続化 ───────────────────────────────────────
const DATA_DIR            = path.join(__dirname, '..', 'data');
const CLASSIFICATIONS_FILE = path.join(DATA_DIR, 'classifications.json');

function loadClassifications() {
  try {
    if (fs.existsSync(CLASSIFICATIONS_FILE)) {
      return JSON.parse(fs.readFileSync(CLASSIFICATIONS_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('classifications load error:', e.message);
  }
  return { mappings: {} };
}

function saveClassifications(data) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(CLASSIFICATIONS_FILE, JSON.stringify(data, null, 2));
}

// ── Axios インスタンスファクトリ ──────────────────────────
/**
 * mfClient — 現在のアクセストークンを付与した Axios インスタンスを返す
 * 呼び出しのたびに最新トークンを参照するため、クロージャではなく関数にする
 */
function mfClient(sharedToken) {
  return axios.create({
    baseURL: MF_API_BASE,
    headers: { Authorization: `Bearer ${sharedToken.accessToken}` },
    timeout: 30000,
  });
}

// ── トークン自動更新ミドルウェア ───────────────────────────
/**
 * refreshIfNeeded
 * アクセストークンが存在しない場合は 401 を返す。
 * 期限の5分前を超えていればリフレッシュトークンで自動更新する。
 */
async function refreshIfNeeded(req, res, next) {
  const shared = req.app.locals.sharedToken;

  if (!shared.accessToken) {
    return res.status(401).json({
      error:    'not_authenticated',
      redirect: '/auth/login',
    });
  }

  // 期限5分前に自動更新
  if (Date.now() > shared.tokenExpiry - 5 * 60 * 1000) {
    try {
      const { accessToken, refreshToken, expiresIn } = await refreshAccessToken(shared.refreshToken);
      shared.accessToken  = accessToken;
      shared.refreshToken = refreshToken;
      shared.tokenExpiry  = Date.now() + expiresIn * 1000;
      console.log('トークンを自動更新しました');
    } catch (err) {
      // リフレッシュ失敗 → ログアウト状態にして再認証を促す
      shared.accessToken  = null;
      shared.refreshToken = null;
      shared.tokenExpiry  = null;
      return res.status(401).json({
        error:    'token_refresh_failed',
        redirect: '/auth/login',
      });
    }
  }

  next();
}

// ── ページネーション対応 全件取得ヘルパー ─────────────────
/**
 * fetchAllPages
 * MFクラウドAPIは1回最大100件。pageパラメータでループして全件取得する。
 *
 * @param {AxiosInstance} client
 * @param {string} endpoint - 例: '/billings', '/partners'
 * @param {object} params   - 追加クエリパラメータ
 * @returns {Promise<Array>}
 */
async function fetchAllPages(client, endpoint, params = {}) {
  const items    = [];
  let   page     = 1;
  const perPage  = 100;
  const MAX_PAGE = 100; // 最大10,000件（安全策）

  while (page <= MAX_PAGE) {
    const res   = await client.get(endpoint, { params: { ...params, per_page: perPage, page } });
    const batch = res.data.data || [];
    items.push(...batch);

    console.log(`  ${endpoint} page=${page} 件数=${batch.length} 累計=${items.length}`);

    if (batch.length < perPage) break; // 最終ページ
    page++;
  }

  return items;
}

// ── 日付ユーティリティ ─────────────────────────────────────
function monthStart(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`;
}

function monthEnd(date) {
  const last = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  return `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`;
}

/**
 * buildMonthRange — "YYYY-MM" 形式の開始・終了月から月ラベル配列を生成する
 * @param {string} fromYM - 例: "2025-10"
 * @param {string} toYM   - 例: "2026-03"
 * @returns {string[]} 例: ["2025-10", "2025-11", ..., "2026-03"]
 */
function buildMonthRange(fromYM, toYM) {
  const labels = [];
  let [fy, fm] = fromYM.split('-').map(Number);
  const [ty, tm] = toYM.split('-').map(Number);
  // 最大36ヶ月まで（安全策）
  let count = 0;
  while ((fy < ty || (fy === ty && fm <= tm)) && count < 36) {
    labels.push(`${fy}-${String(fm).padStart(2, '0')}`);
    fm++;
    if (fm > 12) { fm = 1; fy++; }
    count++;
  }
  return labels;
}

// ── ルート定義 ─────────────────────────────────────────────

/**
 * GET /api/auth-status
 * フロントエンドが認証済みかどうかを確認するためのエンドポイント。
 * 認証不要（トークン有無を返すだけ）。
 */
router.get('/auth-status', (req, res) => {
  const shared = req.app.locals.sharedToken;
  res.json({ authenticated: !!shared.accessToken });
});

/**
 * GET /api/summary
 * 直近12ヶ月分の月次売上・未入金サマリーを返す。
 * billing_date でフィルタし、月ごとに集計する。
 */
router.get('/summary', refreshIfNeeded, async (req, res) => {
  try {
    const client  = mfClient(req.app.locals.sharedToken);
    const now     = new Date();
    const results = [];

    for (let i = 11; i >= 0; i--) {
      const d    = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const from = monthStart(d);
      const to   = monthEnd(d);

      const billings = await fetchAllPages(client, '/billings', {
        from,
        to,
        range_key: 'billing_date',
      });

      const revenue = billings.reduce((sum, b) => sum + (parseFloat(b.total_price) || 0), 0);
      const unpaid  = billings
        .filter(b => b.payment_status === '未入金')
        .reduce((sum, b) => sum + (parseFloat(b.total_price) || 0), 0);

      results.push({
        month:   `${d.getMonth() + 1}月`,
        year:    d.getFullYear(),
        revenue,
        unpaid,
        count:   billings.length,
      });
    }

    res.json({ months: results });
  } catch (err) {
    console.error('Summary error:', (err.response && err.response.data) || err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/billings
 * 請求書一覧を返す。
 * クエリ: ?status=unpaid — 未入金のみにフィルタ
 */
router.get('/billings', refreshIfNeeded, async (req, res) => {
  try {
    const client = mfClient(req.app.locals.sharedToken);
    const { status } = req.query;

    let billings = await fetchAllPages(client, '/billings');

    if (status === 'unpaid') {
      billings = billings.filter(b => b.payment_status === '未入金');
    }

    const mapped = billings.map(b => ({
      id:          b.id,
      client:      b.partner_name || '不明',
      amount:      parseFloat(b.total_price) || 0,
      dueDate:     b.due_date,
      billingDate: b.billing_date,
      status:      b.payment_status,
      title:       b.title,
    }));

    res.json({
      billings: mapped,
      total:    mapped.reduce((s, b) => s + b.amount, 0),
    });
  } catch (err) {
    console.error('Billings error:', (err.response && err.response.data) || err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/partners
 * 今月の請求書を取引先ごとに集計して収益ランキングを返す。
 */
router.get('/partners', refreshIfNeeded, async (req, res) => {
  try {
    const client = mfClient(req.app.locals.sharedToken);
    const now    = new Date();
    const from   = monthStart(now);

    const billings = await fetchAllPages(client, '/billings', {
      from,
      range_key: 'billing_date',
    });

    const partnerMap = {};
    billings.forEach(b => {
      const name = b.partner_name || '不明';
      if (!partnerMap[name]) {
        partnerMap[name] = { name, revenue: 0, count: 0 };
      }
      partnerMap[name].revenue += parseFloat(b.total_price) || 0;
      partnerMap[name].count++;
    });

    const sorted = Object.values(partnerMap).sort((a, b) => b.revenue - a.revenue);
    res.json({ partners: sorted });
  } catch (err) {
    console.error('Partners error:', (err.response && err.response.data) || err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/client-history
 * クライアント別売上推移を返す。
 * クエリ:
 *   ?from_month=YYYY-MM&to_month=YYYY-MM  — 月範囲指定（優先）
 *   ?months=1|3|6|12                       — 直近N ヶ月（デフォルト: 6）
 */
router.get('/client-history', refreshIfNeeded, async (req, res) => {
  try {
    const client = mfClient(req.app.locals.sharedToken);
    const now    = new Date();

    // 月ラベル（"YYYY-MM" 配列）を決定
    let monthLabels;
    if (req.query.from_month && req.query.to_month) {
      monthLabels = buildMonthRange(req.query.from_month, req.query.to_month);
    } else {
      const months = Math.min(parseInt(req.query.months, 10) || 6, 36);
      monthLabels  = [];
      for (let i = months - 1; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        monthLabels.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
      }
    }

    // 月ごとに個別フェッチ（/summary と同じ方式でAPIの挙動を安定させる）
    const clientMap = {};
    for (const ym of monthLabels) {
      const [y, m] = ym.split('-').map(Number);
      const d      = new Date(y, m - 1, 1);

      const billings = await fetchAllPages(client, '/billings', {
        from:      monthStart(d),
        to:        monthEnd(d),
        range_key: 'billing_date',
      });

      billings.forEach(b => {
        const name   = b.partner_name || '不明';
        const amount = parseFloat(b.total_price) || 0;

        if (!clientMap[name]) {
          clientMap[name] = { name, months: {}, total: 0 };
          monthLabels.forEach(ml => { clientMap[name].months[ml] = 0; });
        }
        clientMap[name].months[ym] += amount;
        clientMap[name].total      += amount;
      });
    }

    // 合計売上上位8社に絞る
    const clients = Object.values(clientMap)
      .sort((a, b) => b.total - a.total)
      .slice(0, 8)
      .map(c => ({
        name:  c.name,
        total: c.total,
        data:  monthLabels.map(m => c.months[m] || 0),
      }));

    // 表示用ラベル（"4月" 形式）
    const displayLabels = monthLabels.map(ym => {
      const [, mm] = ym.split('-');
      return `${parseInt(mm, 10)}月`;
    });

    res.json({ months: displayLabels, clients });
  } catch (err) {
    console.error('Client history error:', (err.response && err.response.data) || err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/team-summary
 * チーム・サービス・契約形態別の売上を集計する。
 * 分類マッピング（data/classifications.json）を使用して取引先を振り分ける。
 * クエリ:
 *   ?from_month=YYYY-MM&to_month=YYYY-MM  — 月範囲指定（優先）
 *   ?months=1|3|6|12                       — 直近N ヶ月（デフォルト: 1）
 */
router.get('/team-summary', refreshIfNeeded, async (req, res) => {
  try {
    const client   = mfClient(req.app.locals.sharedToken);
    const data         = loadClassifications();
    const mappings     = data.mappings     || {};
    const itemMappings = data.itemMappings || {};
    const now      = new Date();

    let from, to;
    if (req.query.from_month && req.query.to_month) {
      const [fy, fm] = req.query.from_month.split('-').map(Number);
      const [ty, tm] = req.query.to_month.split('-').map(Number);
      from = monthStart(new Date(fy, fm - 1, 1));
      to   = monthEnd(new Date(ty, tm - 1, 1));
    } else {
      const months    = parseInt(req.query.months, 10) || 1;
      const startDate = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1);
      from = monthStart(startDate);
      to   = monthEnd(now);
    }

    const billings = await fetchAllPages(client, '/billings', {
      from,
      to,
      range_key: 'billing_date',
    });

    // 集計コンテナを初期化
    const teamStats = {};
    TEAMS.forEach(t => { teamStats[t] = { name: t, revenue: 0, unpaid: 0, count: 0 }; });
    teamStats['未分類'] = { name: '未分類', revenue: 0, unpaid: 0, count: 0 };

    const serviceStats = {};
    SERVICES.forEach(s => { serviceStats[s] = { name: s, revenue: 0, unpaid: 0, count: 0 }; });
    serviceStats['未分類'] = { name: '未分類', revenue: 0, unpaid: 0, count: 0 };

    const contractStats = {
      '単発':    { name: '単発',    revenue: 0, unpaid: 0, count: 0 },
      'サブスク': { name: 'サブスク', revenue: 0, unpaid: 0, count: 0 },
      '未分類':   { name: '未分類',  revenue: 0, unpaid: 0, count: 0 },
    };

    // 集計ヘルパー
    function addToStats(statsObj, key, amount, isUnpaid) {
      if (!statsObj[key]) statsObj[key] = { name: key, revenue: 0, unpaid: 0, count: 0 };
      statsObj[key].revenue += amount;
      statsObj[key].count++;
      if (isUnpaid) statsObj[key].unpaid += amount;
    }

    billings.forEach(b => {
      const partner    = b.partner_name || '不明';
      const partnerMap = mappings[partner] || {};
      const isUnpaid   = b.payment_status === '未入金';

      // billing_items がある場合 → 品目レベルで分類（品目マッピング優先、なければ取引先マッピング）
      const billingItems = b.billing_items && Array.isArray(b.billing_items) ? b.billing_items : [];

      if (billingItems.length > 0) {
        billingItems.forEach(item => {
          const itemName = item.name || '';
          // 優先順: 品目名キー → 取引先マッピング
          const mapping  = (itemName && itemMappings[itemName]) || partnerMap;
          const team         = (typeof mapping === 'string' ? mapping : mapping.team) || '未分類';
          const service      = mapping.service      || '未分類';
          const contractType = mapping.contractType || '未分類';
          const amount       = parseFloat(item.amount || item.price || 0);
          addToStats(teamStats,     team,         amount, isUnpaid);
          addToStats(serviceStats,  service,      amount, isUnpaid);
          addToStats(contractStats, contractType, amount, isUnpaid);
        });
      } else {
        // billing_items なし → 取引先レベルで分類（従来の動作）
        const mapping      = partnerMap;
        const team         = (typeof mapping === 'string' ? mapping : mapping.team) || '未分類';
        const service      = mapping.service      || '未分類';
        const contractType = mapping.contractType || '未分類';
        const amount       = parseFloat(b.total_price) || 0;
        addToStats(teamStats,     team,         amount, isUnpaid);
        addToStats(serviceStats,  service,      amount, isUnpaid);
        addToStats(contractStats, contractType, amount, isUnpaid);
      }
    });

    // 順序を維持しながら出力
    const teamResult = TEAMS.map(t => teamStats[t]);
    if (teamStats['未分類'].count > 0) teamResult.push(teamStats['未分類']);

    const serviceResult = SERVICES.map(s => serviceStats[s]);
    if (serviceStats['未分類'].count > 0) serviceResult.push(serviceStats['未分類']);

    res.json({
      teams:     teamResult,
      services:  serviceResult,
      contracts: Object.values(contractStats),
      period:    { from, to },
    });
  } catch (err) {
    console.error('Team summary error:', (err.response && err.response.data) || err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/item-names
 * 品目名一覧を返す。キャッシュがあればそれを返す。
 * ?refresh=true でMFクラウドから再取得してキャッシュを更新する。
 */
router.get('/item-names', refreshIfNeeded, async (req, res) => {
  const shouldRefresh = req.query.refresh === 'true';
  const clsData = loadClassifications();

  if (!shouldRefresh && clsData.cachedItems && clsData.cachedItems.length > 0) {
    return res.json({
      items:      clsData.cachedItems,
      lastSynced: clsData.itemsLastSynced || null,
      fromCache:  true,
    });
  }

  try {
    const client    = mfClient(req.app.locals.sharedToken);
    const now       = new Date();
    const startDate = new Date(now.getFullYear(), now.getMonth() - 11, 1);
    const itemMap   = {};

    // 1. 品目マスタ（/items）を取得してitemMapに登録
    try {
      const masterItems = await fetchAllPages(client, '/items', {});
      masterItems.forEach(item => {
        const name = item.name || '';
        if (!name) return;
        if (!itemMap[name]) itemMap[name] = { name, count: 0 };
      });
      console.log(`  品目マスタ: ${masterItems.length}件`);
    } catch (e) {
      console.warn('  品目マスタ取得スキップ:', e.message);
    }

    // 2. 直近12ヶ月の全請求書を取得し、全件の詳細から billing_items のコンテキストを取得
    const recentBillings = await fetchAllPages(client, '/billings', {
      from:      monthStart(startDate),
      range_key: 'billing_date',
    });
    console.log(`  コンテキスト取得対象: ${recentBillings.length}件の請求書`);

    // 全件を個別取得して billing_items を収集（バッチ10件並列）
    const toFetch      = recentBillings;
    const itemContextMap = {}; // itemName → { partnerName, billingTitle }
    let   structureLogged = false;

    const BATCH = 10;
    for (let i = 0; i < toFetch.length; i += BATCH) {
      const batch = toFetch.slice(i, i + BATCH);

      await Promise.all(batch.map(async b => {
        try {
          const partnerName  = b.partner_name || '不明';
          const billingTitle = b.title        || '';

          // パターン1: GET /billings/{id} — { billing: {..., billing_items:[...] } }
          const detailRes = await client.get(`/billings/${b.id}`);
          const raw = detailRes.data;
          const detail = raw.billing || raw.data || raw;

          // 初回のみ構造をログ
          if (!structureLogged) {
            structureLogged = true;
            console.log('  [detail] top keys:', Object.keys(raw).join(', '));
            console.log('  [detail] obj keys:', Object.keys(detail).join(', '));
            console.log('  [detail] billing_items:', detail.billing_items
              ? `${detail.billing_items.length}件`
              : 'フィールドなし');
          }

          let bItems = detail.billing_items || detail.items || [];

          // パターン2: billing_items が空なら sub-resource を試みる
          if (bItems.length === 0) {
            try {
              const subRes = await client.get(`/billings/${b.id}/billing_items`);
              const subRaw = subRes.data;
              bItems = subRaw.billing_items || subRaw.data || subRaw || [];
              if (!Array.isArray(bItems)) bItems = [];
              if (!structureLogged || i === 0) {
                console.log(`  [sub-resource] billing_items: ${bItems.length}件`);
              }
            } catch (subErr) {
              // sub-resource なし → スキップ
            }
          }

          bItems.forEach(item => {
            const name = item.name || item.item_name || '';
            if (!name) return;
            if (!itemContextMap[name]) itemContextMap[name] = {
              partnerName:  detail.partner_name || partnerName,
              billingTitle: detail.title        || billingTitle,
            };
          });
        } catch (e) {
          // 個別取得失敗は無視して続行
        }
      }));
    }
    console.log(`  billing_items コンテキスト取得完了: ${Object.keys(itemContextMap).length}品目`);

    // 品目マスタに取引先・請求書名コンテキストをマージ
    const items = Object.values(itemMap)
      .map(item => ({
        ...item,
        partnerName:  (itemContextMap[item.name] || {}).partnerName  || '',
        billingTitle: (itemContextMap[item.name] || {}).billingTitle || '',
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ja'));
    const lastSynced = new Date().toISOString();

    clsData.cachedItems     = items;
    clsData.itemsLastSynced = lastSynced;
    saveClassifications(clsData);

    res.json({ items, lastSynced, fromCache: false });
  } catch (err) {
    console.error('Item names error:', (err.response && err.response.data) || err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/debug-billing — 請求書詳細APIのレスポンス構造確認用（一時）
 */
router.get('/debug-billing', refreshIfNeeded, async (req, res) => {
  try {
    const client   = mfClient(req.app.locals.sharedToken);
    const listRes  = await client.get('/billings', { params: { per_page: 1, page: 1 } });
    const listData = listRes.data;
    const first    = (listData.data || [])[0];
    if (!first) return res.json({ error: 'no billings' });

    const detailRes  = await client.get(`/billings/${first.id}`);
    const detailRaw  = detailRes.data;
    const detailObj  = detailRaw.billing || detailRaw.data || detailRaw;

    res.json({
      list_item_keys:    Object.keys(first),
      detail_top_keys:   Object.keys(detailRaw),
      detail_obj_keys:   Object.keys(detailObj),
      billing_items:     detailObj.billing_items
                           ? `${detailObj.billing_items.length}件 / first item keys: ${Object.keys(detailObj.billing_items[0] || {}).join(', ')}`
                           : 'なし',
      partner_name:      detailObj.partner_name || detailObj.member_name || '(なし)',
      title:             detailObj.title || '(なし)',
    });
  } catch (err) {
    res.status(500).json({ error: err.message, detail: err.response && err.response.data });
  }
});

/**
 * GET /api/classifications
 * 保存済みのマッピング（取引先レベル・品目レベル）とキャッシュ品目を返す。
 */
router.get('/classifications', (req, res) => {
  const data = loadClassifications();
  res.json({
    mappings:      data.mappings      || {},
    itemMappings:  data.itemMappings  || {},
    cachedItems:   data.cachedItems   || [],
    lastSynced:    data.itemsLastSynced || null,
    teams:         TEAMS,
    services:      SERVICES,
    contractTypes: CONTRACT_TYPES,
  });
});

/**
 * POST /api/classifications
 * マッピングを保存する。
 * body: { mappings?: {...}, itemMappings?: {...} }
 */
router.post('/classifications', express.json(), (req, res) => {
  const { mappings, itemMappings } = req.body;
  if (mappings === undefined && itemMappings === undefined) {
    return res.status(400).json({ error: 'mappings または itemMappings が必要です' });
  }
  const current = loadClassifications();
  if (mappings     !== undefined) current.mappings     = mappings;
  if (itemMappings !== undefined) current.itemMappings = itemMappings;
  saveClassifications(current);
  res.json({ ok: true });
});

// ── アンケートデータ（GAS Web App 経由） ──────────────────

let surveyCache = null; // { ts: number, data: object }

/**
 * GET /api/surveys
 * GAS Web AppからPamunアンケートデータを取得してキャッシュ返却。
 */
router.get('/surveys', async (req, res) => {
  const webAppUrl = process.env.SURVEY_WEBAPP_URL;
  const token     = process.env.SURVEY_WEBAPP_TOKEN || 'cg_pamun_2025';

  if (!webAppUrl) {
    return res.status(503).json({ error: 'SURVEY_WEBAPP_URL が .env に未設定です' });
  }

  const CACHE_TTL = 60 * 60 * 1000; // 1時間
  const now = Date.now();
  if (!req.query.refresh && surveyCache && (now - surveyCache.ts) < CACHE_TTL) {
    return res.json({ ...surveyCache.data, fromCache: true });
  }

  try {
    const resp = await axios.get(webAppUrl, {
      params:  { token },
      timeout: 60000,
      // GAS Web Appはリダイレクトするのでfollow
      maxRedirects: 5,
    });
    surveyCache = { ts: now, data: resp.data };
    res.json({ ...resp.data, fromCache: false });
  } catch (err) {
    console.error('Surveys fetch error:', err.message);
    // キャッシュがあれば返す
    if (surveyCache) return res.json({ ...surveyCache.data, fromCache: true, stale: true });
    res.status(500).json({ error: err.message });
  }
});

// ── サマリーキャッシュ（全3646件対応） ───────────────────────────
let surveySummaryCache = null; // { ts: number, data: object }

/**
 * GET /api/surveys/cache-status
 * GAS側のサマリーキャッシュ構築状態を返す。
 */
router.get('/surveys/cache-status', async (req, res) => {
  const webAppUrl = process.env.SURVEY_WEBAPP_URL;
  const token     = process.env.SURVEY_WEBAPP_TOKEN || 'cg_pamun_2025';
  if (!webAppUrl) return res.status(503).json({ error: 'SURVEY_WEBAPP_URL が .env に未設定です' });
  try {
    const resp = await axios.get(webAppUrl, {
      params: { token, mode: 'status' },
      timeout: 15000,
      maxRedirects: 5,
    });
    res.json(resp.data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/surveys/summary-stream
 * GAS アンケートサマリーシートから全ファイルの集計データをSSEでストリーミング。
 * GAS側に mode=summary サポートが必要（setupSummaryTrigger() 実行後）。
 */
router.get('/surveys/summary-stream', async (req, res) => {
  const webAppUrl = process.env.SURVEY_WEBAPP_URL;
  const token     = process.env.SURVEY_WEBAPP_TOKEN || 'cg_pamun_2025';

  res.writeHead(200, {
    'Content-Type':      'text/event-stream',
    'Cache-Control':     'no-cache',
    'Connection':        'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();

  const send = obj => res.write(`data: ${JSON.stringify(obj)}\n\n`);

  if (!webAppUrl) {
    send({ type: 'error', message: 'SURVEY_WEBAPP_URL が .env に未設定です' });
    return res.end();
  }

  // キャッシュ有効なら即返す（30分TTL）
  const CACHE_TTL = 30 * 60 * 1000;
  if (!req.query.refresh && surveySummaryCache && (Date.now() - surveySummaryCache.ts) < CACHE_TTL) {
    const d = surveySummaryCache.data;
    send({ type: 'progress', loaded: d.total, total: d.total });
    send({ type: 'done', ...d, fromCache: true });
    return res.end();
  }

  try {
    // ① ビルドステータス確認
    let buildStatus = {};
    try {
      const st = await axios.get(webAppUrl, {
        params: { token, mode: 'status' }, timeout: 15000, maxRedirects: 5,
      });
      buildStatus = st.data || {};
      send({ type: 'build-status', ...buildStatus });
    } catch (e) { /* ignore */ }

    // サマリーが未構築の場合はエラー
    if (!buildStatus.processed || buildStatus.processed === 0) {
      send({
        type:    'error',
        message: 'サマリーキャッシュが未構築です。GASエディタで setupSummaryTrigger() を実行してください。',
        buildStatus,
      });
      return res.end();
    }

    // ② ページネーションで全サマリー取得
    const LIMIT = 500;
    let allSummaries = [];
    let offset       = 0;
    let total        = null;
    let latestBuild  = buildStatus;

    while (true) {
      const resp = await axios.get(webAppUrl, {
        params: { token, mode: 'summary', offset, limit: LIMIT },
        timeout: 60000,
        maxRedirects: 5,
      });
      const data = resp.data;
      if (!data.summaries || !Array.isArray(data.summaries)) break;
      if (total === null) total = data.total || 0;
      if (data.buildStatus) {
        latestBuild = {
          status:    data.buildStatus,
          processed: data.buildProcessed,
          total:     data.buildTotal,
        };
      }
      allSummaries = allSummaries.concat(data.summaries);
      send({ type: 'progress', loaded: allSummaries.length, total, buildStatus: latestBuild });
      if (!data.hasMore || !data.supportsOffset) break;
      offset += LIMIT;
    }

    const result = {
      summaries:   allSummaries,
      total:       allSummaries.length,
      buildStatus: latestBuild,
      updatedAt:   new Date().toISOString(),
    };
    surveySummaryCache = { ts: Date.now(), data: result };
    send({ type: 'done', ...result, fromCache: false });
    res.end();
  } catch (err) {
    console.error('summary-stream error:', err.message);
    if (surveySummaryCache) {
      send({ type: 'done', ...surveySummaryCache.data, fromCache: true, stale: true });
    } else {
      send({ type: 'error', message: err.message });
    }
    res.end();
  }
});

// ── 全件取得キャッシュ（別途管理） ──────────────────────────────
let surveyAllCache = null; // { ts: number, data: object }

/**
 * GET /api/surveys/all
 * GAS Web AppをオフセットつきでN回呼び出し、全件マージして返す。
 * GAS側が ?offset=N&limit=M をサポートしている必要あり。
 * サポートしていない場合は通常の /api/surveys と同等の結果を返す。
 */
router.get('/surveys/all', async (req, res) => {
  const webAppUrl = process.env.SURVEY_WEBAPP_URL;
  const token     = process.env.SURVEY_WEBAPP_TOKEN || 'cg_pamun_2025';

  if (!webAppUrl) {
    return res.status(503).json({ error: 'SURVEY_WEBAPP_URL が .env に未設定です' });
  }

  const CACHE_TTL = 60 * 60 * 1000;
  const now = Date.now();
  if (!req.query.refresh && surveyAllCache && (now - surveyAllCache.ts) < CACHE_TTL) {
    return res.json({ ...surveyAllCache.data, fromCache: true });
  }

  const BATCH = 20;
  let allResponses = [];
  let allFileStats = [];
  let offset = 0;
  let total  = null;

  try {
    while (true) {
      const resp = await axios.get(webAppUrl, {
        params:       { token, offset, limit: BATCH },
        timeout:      60000,
        maxRedirects: 5,
      });
      const data = resp.data;
      if (total === null && data.total) total = data.total;

      const batch = data.responses || [];
      allResponses = allResponses.concat(batch);
      if (data.fileStats && data.fileStats.length) allFileStats = data.fileStats;

      // GASがoffset/limitに非対応の場合は1回のみで終了
      if (!data.supportsOffset) break;
      if (batch.length < BATCH) break;
      if (total !== null && allResponses.length >= total) break;
      offset += BATCH;
    }

    const result = {
      responses:  allResponses,
      fileStats:  allFileStats,
      totalCount: allResponses.length,
      totalFiles: allFileStats.length,
      updatedAt:  new Date().toISOString(),
    };
    surveyAllCache = { ts: now, data: result };
    res.json({ ...result, fromCache: false });
  } catch (err) {
    console.error('Surveys/all error:', err.message);
    if (surveyAllCache) return res.json({ ...surveyAllCache.data, fromCache: true, stale: true });
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/surveys/all-stream
 * Server-Sent Events (SSE) で全件取得の進捗をリアルタイム通知。
 * フロントエンドの EventSource で受信してプログレスバーを更新する。
 */
router.get('/surveys/all-stream', async (req, res) => {
  const webAppUrl = process.env.SURVEY_WEBAPP_URL;
  const token     = process.env.SURVEY_WEBAPP_TOKEN || 'cg_pamun_2025';

  if (!webAppUrl) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
    res.write(`data: ${JSON.stringify({ type: 'error', message: 'SURVEY_WEBAPP_URL が .env に未設定です' })}\n\n`);
    return res.end();
  }

  // SSEヘッダー設定
  res.writeHead(200, {
    'Content-Type':  'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection':    'keep-alive',
    'X-Accel-Buffering': 'no', // Nginx経由でもバッファリング無効
  });
  res.flushHeaders();

  const send = (obj) => {
    res.write(`data: ${JSON.stringify(obj)}\n\n`);
  };

  // キャッシュがあれば即返却
  const CACHE_TTL = 60 * 60 * 1000;
  const now = Date.now();
  if (!req.query.refresh && surveyAllCache && (now - surveyAllCache.ts) < CACHE_TTL) {
    send({ type: 'progress', loaded: surveyAllCache.data.totalCount, total: surveyAllCache.data.totalCount });
    send({ type: 'done', ...surveyAllCache.data, fromCache: true });
    return res.end();
  }

  const BATCH = 20;
  let allResponses = [];
  let allFileStats = [];
  let offset = 0;
  let total  = null;

  try {
    while (true) {
      const resp = await axios.get(webAppUrl, {
        params:       { token, offset, limit: BATCH },
        timeout:      60000,
        maxRedirects: 5,
      });
      const data = resp.data;
      if (total === null) total = data.total || data.totalFiles || 0;

      const batch = data.responses || [];
      allResponses = allResponses.concat(batch);
      if (data.fileStats && data.fileStats.length) allFileStats = data.fileStats;

      // 進捗通知
      send({ type: 'progress', loaded: allResponses.length, total });

      // GASがoffset/limitに非対応の場合や最終ページは終了
      if (!data.supportsOffset) break;
      if (batch.length < BATCH) break;
      if (total > 0 && allResponses.length >= total) break;
      offset += BATCH;
    }

    const result = {
      responses:  allResponses,
      fileStats:  allFileStats,
      totalCount: allResponses.length,
      totalFiles: allFileStats.length,
      updatedAt:  new Date().toISOString(),
    };
    surveyAllCache = { ts: now, data: result };
    send({ type: 'done', ...result, fromCache: false });
    res.end();
  } catch (err) {
    console.error('Surveys/all-stream error:', err.message);
    if (surveyAllCache) {
      send({ type: 'progress', loaded: surveyAllCache.data.totalCount, total: surveyAllCache.data.totalCount });
      send({ type: 'done', ...surveyAllCache.data, fromCache: true, stale: true });
    } else {
      send({ type: 'error', message: err.message });
    }
    res.end();
  }
});

/**
 * POST /api/surveys/insights
 * Claude APIでアンケート自由記述を分析してインサイトを返す。
 * body: { responses: [...], company?: string, genre?: string }
 */
router.post('/surveys/insights', express.json(), async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: 'ANTHROPIC_API_KEY が .env に未設定です' });
  }

  const { responses = [], company, genre } = req.body;

  const freeTexts = responses
    .filter(r => r.reason || r.improvement)
    .map(r => [r.reason, r.improvement].filter(Boolean).join('　'))
    .slice(0, 60)
    .map(t => `・${t}`)
    .join('\n');

  if (!freeTexts) {
    return res.json({ insight: '自由記述データがありません。' });
  }

  const avgNps = responses.filter(r => r.nps !== undefined).length > 0
    ? (responses.reduce((s, r) => s + (parseFloat(r.nps) || 0), 0) / responses.filter(r => r.nps !== undefined).length).toFixed(1)
    : null;

  const prompt = `あなたはコスメ商品マーケティングのアナリストです。
以下のPamunアンケートデータを分析し、**簡潔に3セクション**でレポートしてください。

${company ? `クライアント: ${company}` : '対象: 全クライアント'}${genre ? ` ／ ジャンル: ${genre}` : ''}${avgNps ? ` ／ 平均NPS: ${avgNps}/10` : ''} ／ 回答数: ${responses.length}件

【自由記述】
${freeTexts}

---
以下のフォーマットで出力してください（各セクション3〜4行以内、箇条書き推奨）：

## 📣 ユーザーの声（主要テーマ）
- 最も多かった声を3〜4点、具体的な言葉を交えて箇条書き

## 💡 営業・提案への活用ポイント
- Pamun継続・拡大受注につながる根拠を2〜3点

## 🔧 クライアントへの改善提案
- 優先度の高い改善アクションを2〜3点

**厳守事項**: 各セクション4行以内、全体で400字以内、余分な前置き不要。`;

  try {
    const resp = await axios.post('https://api.anthropic.com/v1/messages', {
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 700,
      messages:   [{ role: 'user', content: prompt }],
    }, {
      headers: {
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
      },
      timeout: 30000,
    });
    res.json({ insight: resp.data.content[0].text });
  } catch (err) {
    console.error('Insights API error:', (err.response && err.response.data) || err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── ポータル用API ─────────────────────────────────────────

const PORTAL_CARDS_FILE = path.join(__dirname, '..', 'data', 'portal-cards.json');

/**
 * GET /api/portal/me — ログイン中のユーザー情報とロールを返す
 */
router.get('/portal/me', (req, res) => {
  const user = req.session?.googleUser;
  if (!user) return res.status(401).json({ error: 'not_authenticated' });
  res.json({
    email:   user.email,
    name:    user.name,
    picture: user.picture,
    role:    user.role,
  });
});

/**
 * GET /api/portal/cards — ログインユーザーのロールに応じたカード一覧を返す
 * isAdmin: true のカードは管理ツールセクション用なのでフィルタリングに含む
 */
router.get('/portal/cards', (req, res) => {
  const role = req.session?.googleUser?.role;
  if (!role) return res.status(401).json({ error: 'not_authenticated' });
  try {
    const allCards = JSON.parse(fs.readFileSync(PORTAL_CARDS_FILE, 'utf8'));
    const filtered = allCards.filter(c => c.roles.includes(role));
    res.json(filtered);
  } catch (err) {
    console.error('portal-cards.json read error:', err.message);
    res.status(500).json({ error: 'config_read_error' });
  }
});

module.exports = router;
