// dashboard.js — MFクラウドAPIからデータを取得してダッシュボードを更新

let revenueChart     = null;
let clientHistChart  = null;
let teamChart        = null;
let serviceChart     = null;
let contractChart    = null;

// ── 金額フォーマット（M なし・全数値） ───────────────────
function formatYen(yen) {
  return '¥' + Math.round(yen).toLocaleString('ja-JP');
}

// Y 軸ティック用（コンパクト表示）
function yTickFormat(v) {
  if (v >= 100000000) return '¥' + (v / 100000000).toFixed(1) + '億';
  if (v >= 10000000)  return '¥' + (v / 10000000).toFixed(1) + '千万';
  if (v >= 1000000)   return '¥' + (v / 1000000).toFixed(1) + '百万';
  return '¥' + v.toLocaleString('ja-JP');
}

// ── 月ピッカー初期値設定 ──────────────────────────────
function initMonthPickers() {
  const now     = new Date();
  const toMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  // チーム別：デフォルト = 当月
  const teamFrom = document.getElementById('team-from');
  const teamTo   = document.getElementById('team-to');
  if (teamFrom) teamFrom.value = toMonth;
  if (teamTo)   teamTo.value   = toMonth;

  // クライアント別：デフォルト = 直近6ヶ月
  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);
  const fromMonth    = `${sixMonthsAgo.getFullYear()}-${String(sixMonthsAgo.getMonth() + 1).padStart(2, '0')}`;
  const clientFrom   = document.getElementById('client-from');
  const clientTo     = document.getElementById('client-to');
  if (clientFrom) clientFrom.value = fromMonth;
  if (clientTo)   clientTo.value   = toMonth;
}

// ── 初期化 ────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('today-date').textContent =
    new Date().toLocaleDateString('ja-JP', {year:'numeric', month:'long', day:'numeric'});

  initMonthPickers();
  await loadAllData();
});

async function loadAllData() {
  showLoading(true);
  try {
    const [summary, billings, partners] = await Promise.all([
      fetch('/api/summary').then(r => r.json()),
      fetch('/api/billings?status=unpaid').then(r => r.json()),
      fetch('/api/partners').then(r => r.json()),
    ]);

    updateKPIs(summary, billings);
    renderRevenueChart(summary);
    renderUnpaidTable(billings);
    renderClientCards(partners);
  } catch (err) {
    console.error('Data load error:', err);
    showError('データの取得に失敗しました。再ログインしてください。');
  } finally {
    showLoading(false);
  }
}

// ── KPI更新 ───────────────────────────────────────────
function updateKPIs(summary, billings) {
  const months     = summary.months || [];
  const current    = months[months.length - 1] || {};
  const prev       = months[months.length - 2] || {};
  const revenue    = current.revenue    || 0;
  const prevRev    = prev.revenue       || 0;
  const changeRate = prevRev > 0 ? ((revenue - prevRev) / prevRev * 100).toFixed(1) : 0;

  // 当月売上
  document.getElementById('kpi-revenue').textContent = formatYen(revenue);
  document.getElementById('kpi-revenue-change').textContent =
    `${changeRate > 0 ? '↑' : '↓'} ${Math.abs(changeRate)}% 前月比`;
  document.getElementById('kpi-revenue-change').className =
    `kpi-change ${changeRate >= 0 ? 'up' : 'down'}`;

  // 未入金
  const unpaid = billings.total || 0;
  document.getElementById('kpi-unpaid').textContent = formatYen(unpaid);

  // 累計売上
  const annual = months.reduce((s, m) => s + (m.revenue || 0), 0);
  document.getElementById('kpi-annual').textContent = formatYen(annual);
}

// ── 売上推移グラフ（修正版） ────────────────────────────
function renderRevenueChart(summary) {
  const months   = summary.months || [];
  const labels   = months.map(m => m.month);
  const revenues = months.map(m => m.revenue || 0);   // 生の円単位
  const unpaidData = months.map(m => m.unpaid || 0);

  if (revenueChart) revenueChart.destroy();
  const canvas = document.getElementById('revenueChart');
  if (!canvas) return;

  // Canvas に固定高さを設定してアスペクト比を安定させる
  canvas.style.height = '280px';

  revenueChart = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: '売上',
          data: revenues,
          backgroundColor: 'rgba(201,168,76,0.15)',
          borderColor: '#c9a84c',
          borderWidth: 1.5,
          borderRadius: 4,
          order: 2,
          yAxisID: 'y',
        },
        {
          label: '未入金',
          data: unpaidData,
          type: 'line',
          borderColor: '#c4613a',
          backgroundColor: 'transparent',
          borderWidth: 2,
          tension: 0.3,
          pointBackgroundColor: '#c4613a',
          pointRadius: 4,
          pointHoverRadius: 6,
          order: 1,
          yAxisID: 'y',
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          labels: { font: { family: 'Noto Sans JP', size: 11 }, color: '#8a857d' },
        },
        tooltip: {
          callbacks: {
            label: ctx => `${ctx.dataset.label}: ${formatYen(ctx.parsed.y)}`,
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { font: { size: 10 }, color: '#8a857d' },
        },
        y: {
          beginAtZero: true,
          grid: { color: 'rgba(26,20,16,0.05)' },
          ticks: {
            font: { size: 10 },
            color: '#8a857d',
            callback: v => yTickFormat(v),
            maxTicksLimit: 6,
          },
        },
      },
    },
  });
}

// ── 未入金テーブル ─────────────────────────────────────
function renderUnpaidTable(billings) {
  const tbody = document.getElementById('unpaid-tbody');
  if (!tbody) return;

  const list = billings.billings || [];
  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:24px">未入金の請求書はありません 🎉</td></tr>';
    return;
  }

  tbody.innerHTML = list.map(b => {
    const due      = new Date(b.dueDate);
    const today    = new Date();
    const diffDays = Math.floor((due - today) / (1000 * 60 * 60 * 24));
    let statusClass, statusLabel;
    if (diffDays < 0)       { statusClass = 'overdue';  statusLabel = '● 期限超過'; }
    else if (diffDays <= 7) { statusClass = 'due-soon'; statusLabel = '● 入金間近'; }
    else                    { statusClass = 'upcoming'; statusLabel = '● 予定内'; }

    return `
      <tr>
        <td>${b.client}</td>
        <td>${b.title || '-'}</td>
        <td class="amount-cell">${formatYen(b.amount)}</td>
        <td>${b.dueDate || '-'}</td>
        <td><span class="status-badge ${statusClass}">${statusLabel}</span></td>
      </tr>
    `;
  }).join('');
}

// ── クライアント別収益カード（今月サマリー） ──────────────
function renderClientCards(partners) {
  const container = document.getElementById('client-grid');
  if (!container) return;

  const list = partners.partners || [];
  if (list.length === 0) {
    container.innerHTML = '<p style="color:var(--muted);font-size:13px">今月の請求データがありません</p>';
    return;
  }

  const maxRevenue = Math.max(...list.map(p => p.revenue));
  const colors     = ['#c9a84c', '#8a9e7e', '#c4613a', '#6b8fa3', '#1a1410', '#a07c5a', '#7a6e9e', '#5a8a7e'];

  container.innerHTML = list.slice(0, 8).map((p, i) => {
    const pct = maxRevenue > 0 ? Math.round(p.revenue / maxRevenue * 100) : 0;
    return `
      <div class="client-card">
        <div class="client-name">${p.name}</div>
        <div class="client-service">請求 ${p.count}件</div>
        <div class="client-metric">
          <span class="client-metric-label">月間売上</span>
          <span class="client-metric-val">${formatYen(p.revenue)}</span>
        </div>
        <div class="margin-bar-wrap">
          <div class="margin-bar" style="width:${pct}%;background:${colors[i % colors.length]}"></div>
        </div>
        <div class="margin-label">
          <span>¥0</span>
          <span>${formatYen(p.revenue)}</span>
        </div>
      </div>
    `;
  }).join('');
}

// ── クライアント別収益 折れ線グラフ（月別推移） ──────────
const CLIENT_LINE_COLORS = [
  '#c9a84c','#4a7c59','#c4613a','#6b8fa3','#8b5cf6',
  '#d97706','#dc2626','#059669',
];

async function loadClientHistory() {
  const from = document.getElementById('client-from') ? document.getElementById('client-from').value : '';
  const to   = document.getElementById('client-to')   ? document.getElementById('client-to').value   : '';
  try {
    const qs   = from && to ? `from_month=${from}&to_month=${to}` : 'months=6';
    const data = await fetch(`/api/client-history?${qs}`).then(r => r.json());
    renderClientHistoryChart(data);
  } catch (e) {
    console.error('Client history error:', e);
  }
}

function renderClientHistoryChart(data) {
  const labels  = data.months  || [];
  const clients = data.clients || [];

  if (clientHistChart) clientHistChart.destroy();
  const canvas = document.getElementById('clientHistChart');
  if (!canvas) return;

  canvas.style.height = '320px';

  clientHistChart = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels,
      datasets: clients.map((c, i) => ({
        label:                c.name,
        data:                 c.data,
        borderColor:          CLIENT_LINE_COLORS[i % CLIENT_LINE_COLORS.length],
        backgroundColor:      CLIENT_LINE_COLORS[i % CLIENT_LINE_COLORS.length] + '18',
        borderWidth:          2,
        tension:              0.3,
        pointRadius:          4,
        pointHoverRadius:     6,
        fill:                 false,
      })),
    },
    options: {
      responsive:          true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          position: 'bottom',
          labels: { font: { family: 'Noto Sans JP', size: 11 }, color: '#555', padding: 12 },
        },
        tooltip: {
          callbacks: {
            label: ctx => `${ctx.dataset.label}: ${formatYen(ctx.parsed.y)}`,
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { font: { size: 11 }, color: '#8a857d' },
        },
        y: {
          beginAtZero: true,
          grid: { color: 'rgba(26,20,16,0.05)' },
          ticks: {
            font: { size: 10 },
            color: '#8a857d',
            callback: v => yTickFormat(v),
            maxTicksLimit: 6,
          },
        },
      },
    },
  });
}

// ── タブ切り替え（グローバル） ────────────────────────────
function switchTab(el, name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  ['overview', 'teams', 'unpaid', 'clients', 'pamun'].forEach(t => {
    const tab = document.getElementById('tab-' + t);
    if (tab) tab.style.display = t === name ? '' : 'none';
  });
  if (name === 'teams')   loadTeamSummary();
  if (name === 'clients') loadClientHistory();
  if (name === 'pamun')   loadSurveys();
}

// ── チーム別売上 ───────────────────────────────────────
const TEAM_COLORS = {
  'Marketing':     { bg: 'rgba(74,124,89,0.8)',   border: '#4a7c59' },
  'PR':            { bg: 'rgba(44,110,158,0.8)',   border: '#2c6e9e' },
  'Advertisement': { bg: 'rgba(139,92,246,0.8)',   border: '#8b5cf6' },
  'Casting':       { bg: 'rgba(217,119,6,0.8)',    border: '#d97706' },
  'Media':         { bg: 'rgba(220,38,38,0.8)',    border: '#dc2626' },
  '未分類':         { bg: 'rgba(156,163,175,0.8)', border: '#9ca3af' },
};

async function loadTeamSummary() {
  const from = document.getElementById('team-from') ? document.getElementById('team-from').value : '';
  const to   = document.getElementById('team-to')   ? document.getElementById('team-to').value   : '';
  try {
    const qs   = from && to ? `from_month=${from}&to_month=${to}` : 'months=1';
    const data = await fetch(`/api/team-summary?${qs}`).then(r => r.json());
    renderTeamChart(data.teams || []);
    renderTeamCards(data.teams || []);
    renderServiceChart(data.services || []);
    renderServiceCards(data.services || []);
    renderContractChart(data.contracts || []);
    renderContractCards(data.contracts || []);
  } catch (e) {
    console.error('Team summary error:', e);
  }
}

function renderTeamChart(teams) {
  const labels       = teams.map(t => t.name);
  const revenues     = teams.map(t => t.revenue);
  const bgColors     = teams.map(t => (TEAM_COLORS[t.name] || TEAM_COLORS['未分類']).bg);
  const borderColors = teams.map(t => (TEAM_COLORS[t.name] || TEAM_COLORS['未分類']).border);

  if (teamChart) teamChart.destroy();
  const canvas = document.getElementById('teamChart');
  if (!canvas) return;

  canvas.style.height = '280px';

  teamChart = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label:           '売上',
        data:            revenues,
        backgroundColor: bgColors,
        borderColor:     borderColors,
        borderWidth:     1.5,
        borderRadius:    6,
      }],
    },
    options: {
      responsive:          true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: c => formatYen(c.parsed.y) } },
      },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 12, family: 'Noto Sans JP' }, color: '#555' } },
        y: {
          beginAtZero: true,
          grid: { color: 'rgba(26,20,16,0.05)' },
          ticks: { font: { size: 10 }, color: '#8a857d', callback: v => yTickFormat(v), maxTicksLimit: 6 },
        },
      },
    },
  });
}

// ── サービス別売上 ─────────────────────────────────────
const SERVICE_COLORS = [
  '#4a7c59','#2c6e9e','#8b5cf6','#d97706','#dc2626',
  '#059669','#db2777','#0891b2','#65a30d','#ea580c','#9ca3af',
];

function renderServiceChart(services) {
  const active      = services.filter(s => s.revenue > 0);
  const labels      = active.map(s => s.name);
  const revenues    = active.map(s => s.revenue);
  const bgColors    = active.map((_, i) => SERVICE_COLORS[i % SERVICE_COLORS.length] + 'cc');
  const borderColors = active.map((_, i) => SERVICE_COLORS[i % SERVICE_COLORS.length]);

  if (serviceChart) serviceChart.destroy();
  const serviceCanvas = document.getElementById('serviceChart');
  if (!serviceCanvas) return;
  serviceCanvas.style.height = '280px';
  serviceChart = new Chart(serviceCanvas.getContext('2d'), {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label:           '売上',
        data:            revenues,
        backgroundColor: bgColors,
        borderColor:     borderColors,
        borderWidth:     1.5,
        borderRadius:    6,
      }],
    },
    options: {
      responsive:          true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: c => formatYen(c.parsed.y) } },
      },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 11, family: 'Noto Sans JP' }, color: '#555' } },
        y: {
          beginAtZero: true,
          grid: { color: 'rgba(26,20,16,0.05)' },
          ticks: { font: { size: 10 }, color: '#8a857d', callback: v => yTickFormat(v), maxTicksLimit: 6 },
        },
      },
    },
  });
}

function renderServiceCards(services) {
  const container = document.getElementById('service-cards');
  if (!container) return;
  const total  = services.reduce((s, t) => s + t.revenue, 0);
  const active = services.filter(s => s.revenue > 0);
  if (active.length === 0) {
    container.innerHTML = '<p class="muted-text">データがありません</p>';
    return;
  }
  container.innerHTML = active.map((s, i) => {
    const color = SERVICE_COLORS[i % SERVICE_COLORS.length];
    const pct   = total > 0 ? (s.revenue / total * 100).toFixed(1) : 0;
    return `
      <div class="team-card" style="border-left:4px solid ${color}">
        <div class="team-card-name">${s.name}</div>
        <div class="team-card-revenue">${formatYen(s.revenue)}</div>
        <div class="team-card-sub">
          <span>構成比 ${pct}%</span>
          <span>請求 ${s.count}件</span>
          ${s.unpaid > 0 ? `<span style="color:#c4613a">未入金 ${formatYen(s.unpaid)}</span>` : ''}
        </div>
        <div class="margin-bar-wrap" style="margin-top:8px">
          <div class="margin-bar" style="width:${pct}%;background:${color}"></div>
        </div>
      </div>
    `;
  }).join('');
}

// ── 契約形態別売上 ─────────────────────────────────────
const CONTRACT_COLORS = {
  '単発':    { bg: 'rgba(5,150,105,0.8)',   border: '#059669' },
  'サブスク': { bg: 'rgba(124,58,237,0.8)',  border: '#7c3aed' },
  '未分類':  { bg: 'rgba(156,163,175,0.6)', border: '#9ca3af' },
};

function renderContractChart(contracts) {
  const active = contracts.filter(c => c.revenue > 0);
  if (contractChart) contractChart.destroy();
  const ctx = document.getElementById('contractChart');
  if (!ctx) return;
  ctx.style.height = '240px';
  contractChart = new Chart(ctx.getContext('2d'), {
    type: 'doughnut',
    data: {
      labels: active.map(c => c.name),
      datasets: [{
        data:            active.map(c => c.revenue),
        backgroundColor: active.map(c => (CONTRACT_COLORS[c.name] || CONTRACT_COLORS['未分類']).bg),
        borderColor:     active.map(c => (CONTRACT_COLORS[c.name] || CONTRACT_COLORS['未分類']).border),
        borderWidth:     2,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { font: { family: 'Noto Sans JP', size: 12 }, padding: 16 } },
        tooltip: { callbacks: { label: c => `${c.label}: ${formatYen(c.parsed)}` } },
      },
      cutout: '62%',
    },
  });
}

function renderContractCards(contracts) {
  const container = document.getElementById('contract-cards');
  if (!container) return;
  const total = contracts.reduce((s, c) => s + c.revenue, 0);
  if (total === 0) {
    container.innerHTML = '<p class="muted-text">データがありません</p>';
    return;
  }
  container.innerHTML = contracts.map(c => {
    const color = (CONTRACT_COLORS[c.name] || CONTRACT_COLORS['未分類']).border;
    const pct   = total > 0 ? (c.revenue / total * 100).toFixed(1) : 0;
    return `
      <div class="team-card" style="border-left:4px solid ${color}">
        <div class="team-card-name">${c.name}</div>
        <div class="team-card-revenue">${formatYen(c.revenue)}</div>
        <div class="team-card-sub">
          <span>構成比 ${pct}%</span>
          <span>請求 ${c.count}件</span>
        </div>
      </div>
    `;
  }).join('');
}

function renderTeamCards(teams) {
  const container = document.getElementById('team-cards');
  if (!container) return;
  const total = teams.reduce((s, t) => s + t.revenue, 0);
  if (total === 0) {
    container.innerHTML = '<p class="muted-text" style="padding:20px 0">データがありません。チーム分類を設定してください。</p>';
    return;
  }
  container.innerHTML = teams.map(t => {
    const color = (TEAM_COLORS[t.name] || TEAM_COLORS['未分類']).border;
    const pct   = total > 0 ? (t.revenue / total * 100).toFixed(1) : 0;
    return `
      <div class="team-card" style="border-left:4px solid ${color}">
        <div class="team-card-name">${t.name}</div>
        <div class="team-card-revenue">${formatYen(t.revenue)}</div>
        <div class="team-card-sub">
          <span>構成比 ${pct}%</span>
          <span>請求 ${t.count}件</span>
          ${t.unpaid > 0 ? `<span style="color:#c4613a">未入金 ${formatYen(t.unpaid)}</span>` : ''}
        </div>
        <div class="margin-bar-wrap" style="margin-top:8px">
          <div class="margin-bar" style="width:${pct}%;background:${color}"></div>
        </div>
      </div>
    `;
  }).join('');
}

// ── ユーティリティ ────────────────────────────────────
function showLoading(flag) {
  const el = document.getElementById('loading-bar');
  if (el) el.style.display = flag ? 'block' : 'none';
}

function showError(msg) {
  const el = document.getElementById('error-msg');
  if (el) { el.textContent = msg; el.style.display = 'block'; }
}

// ══════════════════════════════════════════════════════
// ── Pamunアンケート ────────────────────────────────────
// ══════════════════════════════════════════════════════

let pamunNpsChart        = null;
let pamunGenreChart      = null;
let pamunNpsDistChart    = null;
let pamunIntentionChart  = null;
let pamunIntraGenreChart = null;
let allSurveyData        = null; // raw responses[]
let pamunViewMode        = 'file'; // 'file' | 'brand'

// ── ブランド名抽出（ファイル名から日付パターンを除去） ──────────────
function extractBrand(fileName) {
  let s = String(fileName || '');
  // Step1: 「2024年3月」「2024年03月分」
  s = s.replace(/\d{4}年\d{1,2}月(?:分)?/g, '');
  // Step2: 「2024/09/01」「2024/9」
  s = s.replace(/\d{4}\/\d{1,2}(?:\/\d{1,2})?/g, '');
  // Step3: アンダーバー・スペース正規化（\bが_を単語文字と見なすため先に正規化）
  s = s.replace(/[_\s　・]+/g, ' ').trim();
  // Step4: 6〜8桁の純数字（202409, 20240901）— スペース区切り又は端
  s = s.replace(/(^|\s)\d{6,8}(\s|$)/g, ' ').trim();
  // Step5: 「アンケート回答」「回答」プレフィックス/サフィックス除去
  s = s.replace(/アンケート回答/g, '');
  s = s.replace(/^\s*回答[\s]?|[\s]?回答\s*$/g, '');
  s = s.trim();
  // Step6: 空になった【】を除去
  s = s.replace(/【\s*】/g, '').trim();
  // Step7: 【】内の商品名を優先表示
  const m = s.match(/【(.+?)】/);
  if (m) {
    const t = m[1].trim();
    return t.length > 28 ? t.slice(0, 28) + '…' : t;
  }
  // 前後の空白・区切り文字を除去して返却
  s = s.replace(/^[\s・]+|[\s・]+$/g, '').trim();
  return s.length > 28 ? s.slice(0, 28) + '…' : (s || '不明');
}

// ── Pamun 表示モード切替 ──────────────────────────────────────────
function setPamunView(mode) {
  pamunViewMode = mode;
  const btnFile  = document.getElementById('btn-by-file');
  const btnBrand = document.getElementById('btn-by-brand');
  if (btnFile)  { btnFile.classList.toggle('active',  mode === 'file');  }
  if (btnBrand) { btnBrand.classList.toggle('active', mode === 'brand'); }
  filterPamun();
}

// 満足度テキスト値を 1-5 数値に変換
// 「1.とても良かった」形式: 先頭数字を読み、1=最高→5点, 5=最悪→1点 に逆変換
function parseSat(val) {
  if (val === null || val === undefined || val === '') return NaN;
  const s = String(val).trim();
  const n = parseFloat(s);
  if (!isNaN(n)) {
    if (n >= 1 && n <= 5 && /^[1-5][^0-9]/.test(s)) return 6 - n; // "1.とても良かった" → 5
    if (n >= 0 && n <= 10) return n; // 純数値はそのまま
    return NaN;
  }
  if (/とても良|非常に良/i.test(s)) return 5;
  if (/良かった|良い/i.test(s)) return 4;
  if (/普通|どちらでもない/i.test(s)) return 3;
  if (/悪かった|悪い/i.test(s)) return 2;
  if (/とても悪|非常に悪/i.test(s)) return 1;
  return NaN;
}

// ファイル名から短縮表示名を取得
function shortFileName(fn) {
  const m = fn.match(/【(.+?)】/);
  if (m) { const t = m[1]; return t.length > 22 ? t.slice(0, 22) + '…' : t; }
  return fn.length > 25 ? fn.slice(0, 25) + '…' : fn;
}

// intention フィールドを実データから取得
function getIntention(r) {
  return r.intention
    || r['④また使用したいと思いますか？']
    || r['再購入の意思（購入意思）はありますか？']
    || r['継続意向']
    || null;
}

async function loadSurveys(forceRefresh = false) {
  document.getElementById('pamun-sync-status').textContent = '取得中...';
  const url = forceRefresh ? '/api/surveys?refresh=1' : '/api/surveys';
  try {
    const data = await fetch(url).then(r => r.json());
    if (data.error) throw new Error(data.error);

    allSurveyData = data.responses || [];
    renderPamunFilters(data.fileStats || []);
    filterPamun();

    // ファイル一覧
    renderFileList(data.fileStats || []);

    const synced = data.updatedAt ? new Date(data.updatedAt) : null;
    document.getElementById('pamun-sync-status').textContent =
      synced ? `最終取得: ${synced.toLocaleDateString('ja-JP')} ${synced.toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'})}` : '';
  } catch (e) {
    document.getElementById('pamun-sync-status').textContent = 'エラー: ' + e.message;
    if (!allSurveyData) {
      document.getElementById('pamun-total').textContent = '未設定';
      document.getElementById('pamun-sync-status').textContent =
        '.envにSURVEY_WEBAPP_URLを設定してください';
    }
  }
}

function renderPamunFilters(fileStats) {
  const genres    = [...new Set(fileStats.map(f => f.category).filter(Boolean))].sort();
  // company がない場合は _fileName の短縮版でフィルター
  const companies = [...new Set(allSurveyData.map(r => r.company || shortFileName(r._fileName || '')).filter(Boolean))].sort();

  const gSel = document.getElementById('pamun-genre-filter');
  const cSel = document.getElementById('pamun-company-filter');
  if (!gSel || !cSel) return;

  const gOpts = genres.map(g => `<option value="${g}">${g}</option>`).join('');
  gSel.innerHTML = '<option value="">すべてのジャンル</option>' + gOpts;

  const cOpts = companies.map(c => `<option value="${escH(c)}">${escH(c)}</option>`).join('');
  cSel.innerHTML = '<option value="">すべてのクライアント</option>' + cOpts;
}

function filterPamun() {
  if (!allSurveyData) return;
  const genre   = document.getElementById('pamun-genre-filter')   ? document.getElementById('pamun-genre-filter').value   : '';
  const company = document.getElementById('pamun-company-filter') ? document.getElementById('pamun-company-filter').value : '';

  const filtered = allSurveyData.filter(r => {
    if (genre   && r._category !== genre && r.genre !== genre) return false;
    if (company) {
      const rc = r.company || shortFileName(r._fileName || '');
      if (rc !== company) return false;
    }
    return true;
  });

  renderPamunKpi(filtered);
  renderPamunNpsChart(filtered);
  renderPamunGenreChart(filtered);
  renderPamunNpsDistChart(filtered);
  renderPamunIntentionChart(filtered);
  renderPamunIntraGenreChart(filtered, genre);
}

function renderPamunKpi(responses) {
  const npsVals = responses.map(r => parseFloat(r.nps)).filter(v => !isNaN(v));
  const satVals = responses.map(r => parseSat(r.satisfaction)).filter(v => !isNaN(v));
  const promoters = npsVals.filter(v => v >= 9).length;
  // 満足度5段階で「5=とても良かった」が全体の何%か（推奨者率相当）
  const satPromoters = satVals.filter(v => v >= 4).length;

  document.getElementById('pamun-total').textContent    = responses.length.toLocaleString('ja-JP');
  document.getElementById('pamun-avg-nps').textContent  = npsVals.length ? (npsVals.reduce((s,v)=>s+v,0)/npsVals.length).toFixed(1) : '—';
  document.getElementById('pamun-avg-sat').textContent  = satVals.length ? (satVals.reduce((s,v)=>s+v,0)/satVals.length).toFixed(1) : '—';
  document.getElementById('pamun-promoter').textContent = npsVals.length
    ? Math.round(promoters/npsVals.length*100)
    : (satVals.length ? Math.round(satPromoters/satVals.length*100) : '—');
}

function renderPamunNpsChart(responses) {
  // 商品別（またはブランド別）の満足度平均グラフ
  // チャートタイトルをモードに合わせて更新
  const titleEl = document.getElementById('pamun-nps-chart-title');
  if (titleEl) titleEl.textContent = pamunViewMode === 'brand'
    ? 'ブランド別 満足度スコア（1-5点）'
    : '商品別 満足度スコア（1-5点）';

  const byFile = {};
  responses.forEach(r => {
    const key = pamunViewMode === 'brand'
      ? extractBrand(r._fileName || r.company || '不明')
      : shortFileName(r._fileName || r.company || '不明');
    const v = parseSat(r.satisfaction);
    if (isNaN(v)) return;
    if (!byFile[key]) byFile[key] = [];
    byFile[key].push(v);
  });

  const entries = Object.entries(byFile)
    .map(([k, vals]) => ({ label: k, avg: vals.reduce((s,v)=>s+v,0)/vals.length, count: vals.length }))
    .filter(e => e.count >= 1)
    .sort((a, b) => b.avg - a.avg)
    .slice(0, 15);

  const ctx = document.getElementById('pamunNpsChart');
  if (!ctx) return;
  if (pamunNpsChart) pamunNpsChart.destroy();

  const colors = entries.map(e => e.avg >= 4 ? 'rgba(74,124,89,0.8)' : e.avg >= 3 ? 'rgba(201,168,76,0.8)' : 'rgba(196,97,58,0.8)');

  pamunNpsChart = new Chart(ctx.getContext('2d'), {
    type: 'bar',
    data: {
      labels:   entries.map(e => e.label),
      datasets: [{ label: '平均満足度', data: entries.map(e => e.avg.toFixed(1)), backgroundColor: colors, borderRadius: 4 }],
    },
    options: {
      maintainAspectRatio: false,
      responsive: true,
      indexAxis: 'y',
      plugins: { legend: { display: false }, tooltip: { callbacks: {
        label: c => `満足度: ${c.parsed.x}/5 (${entries[c.dataIndex].count}件)`
      }}},
      scales: { x: { min: 0, max: 5, ticks: { font: { size: 11 } } }, y: { ticks: { font: { size: 11 } } } },
    },
  });
}

function renderPamunGenreChart(responses) {
  const byGenre = {};
  responses.forEach(r => {
    const genre = r._category || r.genre || '未分類';
    const nps   = parseFloat(r.nps);
    const sat   = parseSat(r.satisfaction);
    if (!byGenre[genre]) byGenre[genre] = { nps: [], sat: [], count: 0 };
    byGenre[genre].count++;
    if (!isNaN(nps)) byGenre[genre].nps.push(nps);
    if (!isNaN(sat)) byGenre[genre].sat.push(sat);
  });

  const genres = Object.keys(byGenre).filter(g => byGenre[g].count > 0);
  const avg    = arr => arr.length ? arr.reduce((s,v)=>s+v,0)/arr.length : 0;

  const ctx = document.getElementById('pamunGenreChart');
  if (!ctx) return;
  if (pamunGenreChart) pamunGenreChart.destroy();

  pamunGenreChart = new Chart(ctx.getContext('2d'), {
    type: 'radar',
    data: {
      labels: genres,
      datasets: [
        {
          label: 'NPS (0-10)',
          data:  genres.map(g => avg(byGenre[g].nps).toFixed(1)),
          backgroundColor: 'rgba(74,124,89,0.2)',
          borderColor: '#4a7c59', borderWidth: 2, pointRadius: 4,
        },
        {
          label: '満足度 (0-5換算)',
          data:  genres.map(g => (avg(byGenre[g].sat) * 2).toFixed(1)), // 5→10スケール
          backgroundColor: 'rgba(44,110,158,0.2)',
          borderColor: '#2c6e9e', borderWidth: 2, pointRadius: 4,
        },
      ],
    },
    options: {
      maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom', labels: { font: { size: 11 } } } },
      scales: { r: { min: 0, max: 10, ticks: { font: { size: 10 }, stepSize: 2 } } },
    },
  });
}

function renderPamunNpsDistChart(responses) {
  // NPS がある場合はNPS分布、なければ満足度5段階分布
  const npsVals = responses.map(r => parseFloat(r.nps)).filter(v => !isNaN(v));
  if (npsVals.length > 0) {
    const promoters  = npsVals.filter(v => v >= 9).length;
    const passives   = npsVals.filter(v => v >= 7 && v < 9).length;
    const detractors = npsVals.filter(v => v < 7).length;
    const ctx = document.getElementById('pamunNpsDistChart');
    if (!ctx) return;
    if (pamunNpsDistChart) pamunNpsDistChart.destroy();
    ctx.style.height = '240px';
    pamunNpsDistChart = new Chart(ctx.getContext('2d'), {
      type: 'doughnut',
      data: {
        labels: [`推奨者 9-10 (${promoters}件)`, `中立者 7-8 (${passives}件)`, `批判者 0-6 (${detractors}件)`],
        datasets: [{ data: [promoters, passives, detractors],
          backgroundColor: ['rgba(74,124,89,0.85)', 'rgba(201,168,76,0.85)', 'rgba(196,97,58,0.85)'],
          borderWidth: 2 }],
      },
      options: { maintainAspectRatio: false, cutout: '60%',
        plugins: { legend: { position: 'bottom', labels: { font: { size: 11 }, padding: 12 } } } },
    });
    return;
  }

  // 満足度5段階分布
  const LABELS = ['5 とても良かった', '4 良かった', '3 普通', '2 悪かった', '1 とても悪かった'];
  const counts = [0, 0, 0, 0, 0];
  responses.forEach(r => {
    const v = parseSat(r.satisfaction);
    if (!isNaN(v) && v >= 1 && v <= 5) counts[5 - v]++;
  });
  const total = counts.reduce((s,c) => s+c, 0);

  const ctx = document.getElementById('pamunNpsDistChart');
  if (!ctx) return;
  if (pamunNpsDistChart) pamunNpsDistChart.destroy();
  ctx.style.height = '240px';

  if (total === 0) {
    // データなし表示
    pamunNpsDistChart = null;
    ctx.getContext('2d').clearRect(0, 0, ctx.width, ctx.height);
    return;
  }

  pamunNpsDistChart = new Chart(ctx.getContext('2d'), {
    type: 'doughnut',
    data: {
      labels: LABELS.map((l, i) => `${l} (${counts[i]}件)`).filter((_, i) => counts[i] > 0),
      datasets: [{ data: counts.filter(c => c > 0),
        backgroundColor: ['rgba(74,124,89,0.85)', 'rgba(113,168,130,0.85)', 'rgba(201,168,76,0.85)', 'rgba(196,97,58,0.7)', 'rgba(196,97,58,0.9)'].filter((_, i) => counts[i] > 0),
        borderWidth: 2 }],
    },
    options: { maintainAspectRatio: false, cutout: '60%',
      plugins: { legend: { position: 'bottom', labels: { font: { size: 11 }, padding: 10 } } } },
  });
}

function renderPamunIntentionChart(responses) {
  const ORDER = ['非常に高い', '高い', '普通', '低い', '非常に低い'];
  const counts = {};
  ORDER.forEach(k => { counts[k] = 0; });
  responses.forEach(r => {
    const raw = getIntention(r);
    if (!raw) return;
    const v = String(raw).trim();
    if (counts[v] !== undefined) counts[v]++;
    else counts[v] = (counts[v] || 0) + 1;
  });
  const labels = Object.keys(counts).filter(k => counts[k] > 0);
  const COLORS  = { '非常に高い':'rgba(74,124,89,0.8)', '高い':'rgba(74,124,89,0.5)', '普通':'rgba(201,168,76,0.8)', '低い':'rgba(196,97,58,0.5)', '非常に低い':'rgba(196,97,58,0.9)' };

  const ctx = document.getElementById('pamunIntentionChart');
  if (!ctx) return;
  if (pamunIntentionChart) pamunIntentionChart.destroy();
  ctx.style.height = '240px';

  pamunIntentionChart = new Chart(ctx.getContext('2d'), {
    type: 'doughnut',
    data: {
      labels: labels.map(l => `${l} (${counts[l]}件)`),
      datasets: [{ data: labels.map(l => counts[l]),
        backgroundColor: labels.map(l => COLORS[l] || 'rgba(156,163,175,0.8)'),
        borderWidth: 2 }],
    },
    options: {
      maintainAspectRatio: false,
      cutout: '60%',
      plugins: { legend: { position: 'bottom', labels: { font: { size: 11 }, padding: 10 } } },
    },
  });
}

// ── ジャンル内 商品別比較チャート ──────────────────────────────────
function renderPamunIntraGenreChart(responses, selectedGenre) {
  const card = document.getElementById('pamun-intra-genre-card');
  const ctx  = document.getElementById('pamunIntraGenreChart');
  if (!card || !ctx) return;

  if (!selectedGenre) {
    card.style.display = 'none';
    if (pamunIntraGenreChart) { pamunIntraGenreChart.destroy(); pamunIntraGenreChart = null; }
    return;
  }

  // 選択ジャンルの回答のみ
  const inGenre = responses.filter(r =>
    (r._category || r.genre || '未分類') === selectedGenre
  );

  // 商品（またはブランド）ごとに集計
  const byProduct = {};
  inGenre.forEach(r => {
    const key = pamunViewMode === 'brand'
      ? extractBrand(r._fileName || r.company || '不明')
      : shortFileName(r._fileName || r.company || '不明');
    if (!byProduct[key]) byProduct[key] = { satVals: [], npsVals: [] };
    const sat = parseSat(r.satisfaction);
    if (!isNaN(sat)) byProduct[key].satVals.push(sat);
    const nps = parseFloat(r.nps);
    if (!isNaN(nps)) byProduct[key].npsVals.push(nps);
  });

  const entries = Object.entries(byProduct)
    .map(([label, d]) => ({
      label,
      avg: d.satVals.length ? d.satVals.reduce((s,v)=>s+v,0)/d.satVals.length : 0,
      count: d.satVals.length + d.npsVals.length,
    }))
    .filter(e => e.count >= 1)
    .sort((a, b) => b.avg - a.avg);

  // 比較対象が1商品以下なら非表示
  if (entries.length < 2) {
    card.style.display = 'none';
    if (pamunIntraGenreChart) { pamunIntraGenreChart.destroy(); pamunIntraGenreChart = null; }
    return;
  }

  card.style.display = 'block';
  const titleEl = document.getElementById('pamun-intra-genre-title');
  if (titleEl) titleEl.textContent =
    `【${selectedGenre}】ジャンル内 商品別満足度比較（${entries.length}商品）`;

  if (pamunIntraGenreChart) pamunIntraGenreChart.destroy();
  ctx.style.height = '320px';

  const colors = entries.map(e =>
    e.avg >= 4 ? 'rgba(74,124,89,0.8)' :
    e.avg >= 3 ? 'rgba(201,168,76,0.8)' : 'rgba(196,97,58,0.8)'
  );

  pamunIntraGenreChart = new Chart(ctx.getContext('2d'), {
    type: 'bar',
    data: {
      labels: entries.map(e => e.label),
      datasets: [{
        label: '平均満足度',
        data:  entries.map(e => parseFloat(e.avg.toFixed(2))),
        backgroundColor: colors,
        borderRadius: 4,
      }],
    },
    options: {
      maintainAspectRatio: false,
      responsive: true,
      indexAxis: 'y',
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: {
          label: c => `満足度: ${c.parsed.x.toFixed(2)}/5 (${entries[c.dataIndex].count}件)`,
        }},
      },
      scales: {
        x: { min: 0, max: 5, ticks: { font: { size: 11 } } },
        y: { ticks: { font: { size: 11 } } },
      },
    },
  });
}

// ── Excel エクスポート ────────────────────────────────────────────
function exportPamunExcel() {
  if (!allSurveyData || !allSurveyData.length) {
    alert('エクスポートするデータがありません。先にアンケートデータを取得してください。');
    return;
  }
  if (typeof XLSX === 'undefined') {
    alert('SheetJS ライブラリの読み込みに失敗しました。ページを再読み込みしてください。');
    return;
  }

  const genre   = document.getElementById('pamun-genre-filter')?.value   || '';
  const company = document.getElementById('pamun-company-filter')?.value || '';

  // 現在のフィルタを適用
  const filtered = allSurveyData.filter(r => {
    if (genre   && r._category !== genre && r.genre !== genre) return false;
    if (company) {
      const rc = r.company || shortFileName(r._fileName || '');
      if (rc !== company) return false;
    }
    return true;
  });

  // ── Sheet 1: サマリー（商品/ブランド別集計） ──
  const byKey = {};
  filtered.forEach(r => {
    const key = pamunViewMode === 'brand'
      ? extractBrand(r._fileName || r.company || '不明')
      : shortFileName(r._fileName || r.company || '不明');
    if (!byKey[key]) byKey[key] = { label: key, category: r._category || '', satVals: [], npsVals: [], count: 0 };
    byKey[key].count++;
    const sat = parseSat(r.satisfaction);
    if (!isNaN(sat)) byKey[key].satVals.push(sat);
    const nps = parseFloat(r.nps);
    if (!isNaN(nps)) byKey[key].npsVals.push(nps);
  });

  const summaryRows = [['商品名', 'ジャンル', '回答数', '平均満足度(1-5)', '平均NPS(0-10)', '推奨者数(満足5点)']];
  Object.values(byKey)
    .sort((a, b) => {
      const sa = a.satVals.length ? a.satVals.reduce((s,v)=>s+v,0)/a.satVals.length : 0;
      const sb = b.satVals.length ? b.satVals.reduce((s,v)=>s+v,0)/b.satVals.length : 0;
      return sb - sa;
    })
    .forEach(e => {
      const avgSat  = e.satVals.length ? parseFloat((e.satVals.reduce((s,v)=>s+v,0)/e.satVals.length).toFixed(2)) : '';
      const avgNps  = e.npsVals.length ? parseFloat((e.npsVals.reduce((s,v)=>s+v,0)/e.npsVals.length).toFixed(2)) : '';
      const promo   = e.satVals.filter(v => v >= 5).length;
      summaryRows.push([e.label, e.category, e.count, avgSat, avgNps, promo]);
    });

  // ── Sheet 2: ジャンル別集計 ──
  const byGenre = {};
  filtered.forEach(r => {
    const g = r._category || r.genre || '未分類';
    if (!byGenre[g]) byGenre[g] = { genre: g, satVals: [], npsVals: [], count: 0 };
    byGenre[g].count++;
    const sat = parseSat(r.satisfaction);
    if (!isNaN(sat)) byGenre[g].satVals.push(sat);
    const nps = parseFloat(r.nps);
    if (!isNaN(nps)) byGenre[g].npsVals.push(nps);
  });
  const genreRows = [['ジャンル', '回答数', '平均満足度(1-5)', '平均NPS(0-10)']];
  Object.values(byGenre).sort((a, b) => b.count - a.count).forEach(g => {
    const avgSat = g.satVals.length ? parseFloat((g.satVals.reduce((s,v)=>s+v,0)/g.satVals.length).toFixed(2)) : '';
    const avgNps = g.npsVals.length ? parseFloat((g.npsVals.reduce((s,v)=>s+v,0)/g.npsVals.length).toFixed(2)) : '';
    genreRows.push([g.genre, g.count, avgSat, avgNps]);
  });

  // ── Sheet 3: 全回答（生データ）──
  const ALL_COLS = ['_fileName', '_category', 'company', 'satisfaction', 'nps', 'intention', 'reason', 'improvement'];
  const extraCols = [...new Set(filtered.flatMap(r => Object.keys(r).filter(k => !k.startsWith('_'))))].filter(k => !ALL_COLS.includes(k));
  const allCols = [...ALL_COLS, ...extraCols];
  const rawRows = [
    ['ファイル名', 'ジャンル', 'クライアント', '満足度', 'NPS', '継続意向', '良かった点', '改善点', ...extraCols],
    ...filtered.map(r => allCols.map(k => r[k] ?? '')),
  ];

  // Workbook 作成
  const wb = XLSX.utils.book_new();
  const wsSum   = XLSX.utils.aoa_to_sheet(summaryRows);
  const wsGenre = XLSX.utils.aoa_to_sheet(genreRows);
  const wsRaw   = XLSX.utils.aoa_to_sheet(rawRows);

  // 列幅設定
  wsSum['!cols']   = [{ wch:30 }, { wch:14 }, { wch:8 }, { wch:14 }, { wch:12 }, { wch:12 }];
  wsGenre['!cols'] = [{ wch:16 }, { wch:8 }, { wch:14 }, { wch:12 }];
  wsRaw['!cols']   = allCols.map(() => ({ wch: 20 }));

  XLSX.utils.book_append_sheet(wb, wsSum,   'サマリー');
  XLSX.utils.book_append_sheet(wb, wsGenre, 'ジャンル別');
  XLSX.utils.book_append_sheet(wb, wsRaw,   '全回答データ');

  const suffix = genre ? `_${genre}` : company ? `_${company}` : '';
  XLSX.writeFile(wb, `Pamunアンケート${suffix}_${new Date().toISOString().slice(0,10)}.xlsx`);
}

// ── PDF 印刷エクスポート ──────────────────────────────────────────
function exportPamunPdf() {
  window.print();
}

// ── 全件取得（サマリーキャッシュ方式 / GAS buildSummaryBatch() 必要） ──────
function loadAllSurveys() {
  const btn      = document.getElementById('btn-load-all');
  const progress = document.getElementById('pamun-load-progress');
  const status   = document.getElementById('pamun-sync-status');
  if (btn) btn.disabled = true;
  if (progress) { progress.style.display = 'block'; progress.textContent = '全件サマリーを取得中...'; }

  const isRefresh = btn && btn.dataset.refresh === '1';
  const url = isRefresh ? '/api/surveys/summary-stream?refresh=1' : '/api/surveys/summary-stream';
  const es  = new EventSource(url);

  es.onmessage = (e) => {
    const msg = JSON.parse(e.data);

    if (msg.type === 'build-status') {
      if (msg.status === 'building') {
        const pct = msg.total > 0 ? Math.round(msg.processed / msg.total * 100) : 0;
        if (progress) progress.textContent =
          `⚙️ GASキャッシュ構築中 ${msg.processed}/${msg.total}ファイル (${pct}%)`;
      }

    } else if (msg.type === 'progress') {
      const bs = msg.buildStatus || {};
      let txt = `サマリー取得中 ${msg.loaded} / ${msg.total || '?'} ファイル...`;
      if (bs.status === 'building') txt += ` ⚙️ (GAS構築中: ${bs.processed}/${bs.total})`;
      if (progress) progress.textContent = txt;

    } else if (msg.type === 'done') {
      es.close();
      renderFromSummaries(msg.summaries || [], msg.buildStatus);
      const bs = msg.buildStatus || {};
      if (bs.status === 'building') {
        const pct = bs.total > 0 ? Math.round(bs.processed / bs.total * 100) : 0;
        if (progress) progress.textContent =
          `${msg.total}ファイル取得済 ⚙️ GASキャッシュ構築中 ${bs.processed}/${bs.total} (${pct}%) — 2分後に自動更新`;
        if (btn) { btn.disabled = false; btn.dataset.refresh = '1'; }
        setTimeout(() => { if (document.getElementById('tab-pamun')?.style.display !== 'none') loadAllSurveys(); }, 120000);
      } else {
        if (progress) progress.style.display = 'none';
        if (btn) { btn.disabled = false; btn.dataset.refresh = ''; }
        if (status) status.textContent =
          `全件: ${msg.total}ファイル ${msg.updatedAt ? '('+new Date(msg.updatedAt).toLocaleDateString('ja-JP')+')' : ''}`;
      }

    } else if (msg.type === 'error') {
      es.close();
      if (progress) {
        progress.style.cssText = 'display:block;color:#c4613a;padding:6px 0;font-size:12px';
        progress.innerHTML = `⚠️ ${escH(msg.message)}` +
          (msg.buildStatus && msg.buildStatus.status === 'idle'
            ? ' → <strong>GASで setupSummaryTrigger() を実行してください</strong>' : '');
      }
      if (btn) btn.disabled = false;
    }
  };

  es.onerror = () => {
    es.close();
    if (progress) progress.textContent = '⚠️ 接続エラー。サーバーを確認してください。';
    if (btn) btn.disabled = false;
  };
}

// ── サマリーデータからKPI・チャートを更新 ───────────────────────────
function renderFromSummaries(summaries, buildStatus) {
  if (!summaries || !summaries.length) return;

  // fileId が空のヘッダー行・空行・説明行を除外
  summaries = summaries.filter(s => s.fileId && String(s.fileId).trim().length > 10);

  if (!summaries.length) return;

  // ── 集計 ──
  let totalResp = 0;
  let satWSum = 0, satWCnt = 0, npsWSum = 0, npsWCnt = 0;
  let promoSum = 0, promoCnt = 0;
  const byKey   = {};
  const byGenre = {};
  const allFiles = [];

  summaries.forEach(s => {
    const cnt     = parseInt(s.responseCount) || 0;
    const avgSat  = parseFloat(s.avgSatisfaction);
    const avgNps  = parseFloat(s.avgNps);
    const promRate = parseFloat(s.promoterRate);

    totalResp += cnt;
    if (!isNaN(avgSat) && cnt > 0) { satWSum += avgSat * cnt; satWCnt += cnt; }
    if (!isNaN(avgNps) && cnt > 0) { npsWSum += avgNps * cnt; npsWCnt += cnt; }
    if (!isNaN(promRate) && cnt > 0) { promoSum += (promRate / 100) * cnt; promoCnt += cnt; }

    const key = pamunViewMode === 'brand'
      ? extractBrand(s.fileName || '') : shortFileName(s.fileName || '');
    if (!byKey[key]) byKey[key] = { satSum: 0, satCnt: 0, total: 0 };
    byKey[key].total += cnt;
    if (!isNaN(avgSat) && cnt > 0) { byKey[key].satSum += avgSat * cnt; byKey[key].satCnt += cnt; }

    const genre = String(s.category || '未分類');
    if (!byGenre[genre]) byGenre[genre] = { satSum: 0, satCnt: 0, total: 0 };
    byGenre[genre].total += cnt;
    if (!isNaN(avgSat) && cnt > 0) { byGenre[genre].satSum += avgSat * cnt; byGenre[genre].satCnt += cnt; }

    allFiles.push({ fileName: s.fileName || '', category: s.category || '未分類', count: cnt });
  });

  // ── KPI ──
  const el = id => document.getElementById(id);
  if (el('pamun-total'))    el('pamun-total').textContent    = totalResp.toLocaleString('ja-JP');
  if (el('pamun-avg-sat'))  el('pamun-avg-sat').textContent  = satWCnt  > 0 ? (satWSum / satWCnt).toFixed(1)  : '—';
  if (el('pamun-avg-nps'))  el('pamun-avg-nps').textContent  = npsWCnt  > 0 ? (npsWSum / npsWCnt).toFixed(1)  : '—';
  if (el('pamun-promoter')) el('pamun-promoter').textContent = promoCnt > 0
    ? Math.round(promoSum / promoCnt * 100) : '—';

  // ── 満足度上位チャート ──
  const entries = Object.entries(byKey)
    .map(([label, d]) => ({ label, avg: d.satCnt > 0 ? d.satSum / d.satCnt : 0, count: d.total }))
    .filter(e => e.count > 0)
    .sort((a, b) => b.avg - a.avg)
    .slice(0, 15);

  const titleEl = el('pamun-nps-chart-title');
  if (titleEl) titleEl.textContent = pamunViewMode === 'brand'
    ? `ブランド別 満足度 上位15（全${Object.keys(byKey).length}ブランド）`
    : `商品別 満足度 上位15（全${summaries.length}件）`;

  const ctx = el('pamunNpsChart');
  if (ctx) {
    if (pamunNpsChart) pamunNpsChart.destroy();
    const colors = entries.map(e =>
      e.avg >= 4 ? 'rgba(74,124,89,0.8)' : e.avg >= 3 ? 'rgba(201,168,76,0.8)' : 'rgba(196,97,58,0.8)');
    pamunNpsChart = new Chart(ctx.getContext('2d'), {
      type: 'bar',
      data: { labels: entries.map(e => e.label),
        datasets: [{ label: '平均満足度', data: entries.map(e => parseFloat(e.avg.toFixed(2))),
          backgroundColor: colors, borderRadius: 4 }] },
      options: {
        maintainAspectRatio: false, responsive: true, indexAxis: 'y',
        plugins: { legend: { display: false },
          tooltip: { callbacks: { label: c => `満足度: ${c.parsed.x.toFixed(2)}/5 (${entries[c.dataIndex].count}件)` } } },
        scales: { x: { min:0, max:5, ticks:{ font:{size:11} } }, y: { ticks:{ font:{size:11} } } },
      },
    });
  }

  // ── ジャンル別レーダー ──
  const genres   = Object.keys(byGenre).filter(g => byGenre[g].total > 0).sort();
  const genreCtx = el('pamunGenreChart');
  if (genreCtx && genres.length > 0) {
    if (pamunGenreChart) pamunGenreChart.destroy();
    pamunGenreChart = new Chart(genreCtx.getContext('2d'), {
      type: 'radar',
      data: {
        labels: genres,
        datasets: [{
          label: '満足度（×2で10点換算）',
          data:  genres.map(g => {
            const d = byGenre[g];
            return d.satCnt > 0 ? parseFloat(((d.satSum / d.satCnt) * 2).toFixed(1)) : 0;
          }),
          backgroundColor: 'rgba(74,124,89,0.2)',
          borderColor: '#4a7c59', borderWidth: 2, pointRadius: 4,
        }],
      },
      options: {
        maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { font: { size: 11 } } } },
        scales: { r: { min: 0, max: 10, ticks: { font: { size: 10 }, stepSize: 2 } } },
      },
    });
  }

  // ── ジャンルフィルター更新 ──
  const gSel = el('pamun-genre-filter');
  if (gSel) {
    const cur = gSel.value;
    gSel.innerHTML = `<option value="">すべてのジャンル（${summaries.length}ファイル）</option>` +
      genres.map(g => `<option value="${escH(g)}">${escH(g)} (${byGenre[g].total}件)</option>`).join('');
    gSel.value = cur;
    // ジャンル内比較チャートを更新
    if (cur) renderPamunIntraGenreFromSummaries(summaries, cur);
  }

  // ── ファイルリスト（上位150件）──
  allFiles.sort((a, b) => b.count - a.count);
  renderFileList(allFiles.slice(0, 150));
}

// ── サマリーデータからジャンル内比較チャート（サマリー版）────────────
function renderPamunIntraGenreFromSummaries(summaries, selectedGenre) {
  const card = document.getElementById('pamun-intra-genre-card');
  const ctx  = document.getElementById('pamunIntraGenreChart');
  if (!card || !ctx || !selectedGenre) { if (card) card.style.display = 'none'; return; }

  const inGenre = summaries.filter(s => (s.category || '未分類') === selectedGenre);
  const byProduct = {};
  inGenre.forEach(s => {
    const key = pamunViewMode === 'brand'
      ? extractBrand(s.fileName || '') : shortFileName(s.fileName || '');
    const cnt = parseInt(s.responseCount) || 0;
    const avg = parseFloat(s.avgSatisfaction);
    if (!byProduct[key]) byProduct[key] = { satSum: 0, satCnt: 0, total: 0 };
    byProduct[key].total += cnt;
    if (!isNaN(avg) && cnt > 0) { byProduct[key].satSum += avg * cnt; byProduct[key].satCnt += cnt; }
  });

  const entries = Object.entries(byProduct)
    .map(([label, d]) => ({ label, avg: d.satCnt > 0 ? d.satSum / d.satCnt : 0, count: d.total }))
    .filter(e => e.count > 0)
    .sort((a, b) => b.avg - a.avg);

  if (entries.length < 2) { card.style.display = 'none'; return; }
  card.style.display = 'block';
  const ti = document.getElementById('pamun-intra-genre-title');
  if (ti) ti.textContent = `【${selectedGenre}】ジャンル内 商品別満足度比較（${entries.length}商品）`;
  if (pamunIntraGenreChart) pamunIntraGenreChart.destroy();
  const colors = entries.map(e =>
    e.avg >= 4 ? 'rgba(74,124,89,0.8)' : e.avg >= 3 ? 'rgba(201,168,76,0.8)' : 'rgba(196,97,58,0.8)');
  pamunIntraGenreChart = new Chart(ctx.getContext('2d'), {
    type: 'bar',
    data: { labels: entries.map(e => e.label),
      datasets: [{ label: '平均満足度', data: entries.map(e => parseFloat(e.avg.toFixed(2))),
        backgroundColor: colors, borderRadius: 4 }] },
    options: {
      maintainAspectRatio: false, responsive: true, indexAxis: 'y',
      plugins: { legend: { display: false },
        tooltip: { callbacks: { label: c => `${c.parsed.x.toFixed(2)}/5 (${entries[c.dataIndex].count}件)` } } },
      scales: { x: { min:0, max:5 }, y: { ticks: { font: { size: 11 } } } },
    },
  });
}

function renderFileList(fileStats) {
  const tbody = document.getElementById('pamun-file-list');
  if (!tbody) return;
  if (fileStats.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" style="padding:20px;text-align:center;color:#bbb">データなし</td></tr>';
    return;
  }
  tbody.innerHTML = fileStats.map(f => `
    <tr style="border-bottom:1px solid #f0eee8">
      <td style="padding:10px 16px;font-size:13px">${escH(f.fileName)}</td>
      <td style="padding:10px 16px;font-size:12px;color:#888">${escH(f.category)}</td>
      <td style="padding:10px 16px;font-size:12px;color:#888;text-align:right">${f.count || '—'}件</td>
    </tr>`).join('');
}

async function generateInsight() {
  const btn = document.getElementById('btn-insight');
  const status = document.getElementById('insight-status');
  const body   = document.getElementById('insight-body');
  if (!allSurveyData) { body.textContent = 'まずアンケートデータを取得してください。'; return; }

  btn.disabled    = true;
  status.textContent = '分析中...（30秒ほどかかります）';
  body.textContent   = '';

  const genre   = document.getElementById('pamun-genre-filter')   ? document.getElementById('pamun-genre-filter').value   : '';
  const company = document.getElementById('pamun-company-filter') ? document.getElementById('pamun-company-filter').value : '';

  const filtered = allSurveyData.filter(r => {
    if (genre   && r._category !== genre && r.genre !== genre) return false;
    if (company && r.company   !== company) return false;
    return true;
  });

  // AIに必要なフィールドのみに絞ってサイズ削減
  const slim = filtered.map(r => ({
    nps:         r.nps,
    reason:      r.reason      || r['購入・使用理由'] || r['おすすめしたい理由'] || '',
    improvement: r.improvement || r['改善点']         || r['改善してほしい点']   || '',
    satisfaction: r.satisfaction,
  })).filter(r => r.reason || r.improvement);

  try {
    const res = await fetch('/api/surveys/insights', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ responses: slim, company, genre }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    body.innerHTML     = mdToHtml(data.insight);
    status.textContent = `${filtered.length}件の回答をもとに分析`;
  } catch (e) {
    status.textContent = 'エラー: ' + e.message;
    body.textContent   = '';
  }
  btn.disabled = false;
}

function escH(str) {
  return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// 簡易マークダウン → HTML 変換
function mdToHtml(md) {
  const lines = String(md || '').split('\n');
  let html = '';
  let inUl = false;
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^##\s+/.test(line)) {
      if (inUl) { html += '</ul>'; inUl = false; }
      html += '<h2>' + inlineMd(line.replace(/^##\s+/, '')) + '</h2>';
    } else if (/^[-*]\s+/.test(line)) {
      if (!inUl) { html += '<ul>'; inUl = true; }
      html += '<li>' + inlineMd(line.replace(/^[-*]\s+/, '')) + '</li>';
    } else if (/^---+$/.test(line)) {
      if (inUl) { html += '</ul>'; inUl = false; }
      // 区切り線はスキップ（セクションの h2 で十分）
    } else if (line === '') {
      if (inUl) { html += '</ul>'; inUl = false; }
    } else {
      if (inUl) { html += '</ul>'; inUl = false; }
      html += '<p>' + inlineMd(line) + '</p>';
    }
  }
  if (inUl) html += '</ul>';
  return html;
}
function inlineMd(s) {
  return escH(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`(.+?)`/g, '<code style="background:#f3f2ef;padding:1px 5px;border-radius:3px;font-size:12px">$1</code>');
}

