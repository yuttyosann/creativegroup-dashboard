// dashboard.js — MFクラウドAPIからデータを取得してダッシュボードを更新

let revenueChart = null;
let pieChart = null;
let teamChart = null;

// ── 初期化 ────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('today-date').textContent =
    new Date().toLocaleDateString('ja-JP', {year:'numeric', month:'long', day:'numeric'});

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
  const months = summary.months || [];
  const current = months[months.length - 1] || {};
  const prev = months[months.length - 2] || {};

  const revenue = current.revenue || 0;
  const prevRevenue = prev.revenue || 0;
  const changeRate = prevRevenue > 0 ? ((revenue - prevRevenue) / prevRevenue * 100).toFixed(1) : 0;

  // 当月売上
  document.getElementById('kpi-revenue').textContent = formatMillion(revenue);
  document.getElementById('kpi-revenue-change').textContent =
    `${changeRate > 0 ? '↑' : '↓'} ${Math.abs(changeRate)}% 前月比`;
  document.getElementById('kpi-revenue-change').className =
    `kpi-change ${changeRate >= 0 ? 'up' : 'down'}`;

  // 未入金
  const unpaid = billings.total || 0;
  document.getElementById('kpi-unpaid').textContent = formatMillion(unpaid);

  // 累計売上
  const annual = months.reduce((s, m) => s + (m.revenue || 0), 0);
  document.getElementById('kpi-annual').textContent = formatMillion(annual);
}

// ── 売上推移グラフ ─────────────────────────────────────
function renderRevenueChart(summary) {
  const months = summary.months || [];
  const labels = months.map(m => m.month);
  const revenues = months.map(m => m.revenue / 1000000); // 百万円単位

  if (revenueChart) revenueChart.destroy();
  const ctx = document.getElementById('revenueChart').getContext('2d');
  revenueChart = new Chart(ctx, {
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
        },
        {
          label: '未入金',
          data: months.map(m => (m.unpaid || 0) / 1000000),
          type: 'line',
          borderColor: '#c4613a',
          backgroundColor: 'rgba(196,97,58,0.05)',
          borderWidth: 2,
          fill: true,
          tension: 0.4,
          pointBackgroundColor: '#c4613a',
          pointRadius: 3,
          order: 1,
        }
      ]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { labels: { font: { family: 'Noto Sans JP', size: 11 }, color: '#8a857d' } }
      },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 10 }, color: '#8a857d' } },
        y: {
          grid: { color: 'rgba(26,20,16,0.05)' },
          ticks: { font: { size: 10 }, color: '#8a857d', callback: v => '¥'+v+'M' }
        }
      }
    }
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
    const due = new Date(b.dueDate);
    const today = new Date();
    const diffDays = Math.floor((due - today) / (1000*60*60*24));
    let statusClass, statusLabel;
    if (diffDays < 0) { statusClass = 'overdue'; statusLabel = '● 期限超過'; }
    else if (diffDays <= 7) { statusClass = 'due-soon'; statusLabel = '● 入金間近'; }
    else { statusClass = 'upcoming'; statusLabel = '● 予定内'; }

    return `
      <tr>
        <td>${b.client}</td>
        <td>${b.title || '-'}</td>
        <td class="amount-cell">¥${b.amount.toLocaleString()}</td>
        <td>${b.dueDate || '-'}</td>
        <td><span class="status-badge ${statusClass}">${statusLabel}</span></td>
      </tr>
    `;
  }).join('');
}

// ── クライアント別収益カード ───────────────────────────
function renderClientCards(partners) {
  const container = document.getElementById('client-grid');
  if (!container) return;

  const list = partners.partners || [];
  if (list.length === 0) {
    container.innerHTML = '<p style="color:var(--muted);font-size:13px">今月の請求データがありません</p>';
    return;
  }

  const maxRevenue = Math.max(...list.map(p => p.revenue));
  const colors = ['#c9a84c', '#8a9e7e', '#c4613a', '#6b8fa3', '#1a1410'];

  container.innerHTML = list.slice(0, 6).map((p, i) => {
    const pct = maxRevenue > 0 ? Math.round(p.revenue / maxRevenue * 100) : 0;
    return `
      <div class="client-card">
        <div class="client-name">${p.name}</div>
        <div class="client-service">請求 ${p.count}件</div>
        <div class="client-metric">
          <span class="client-metric-label">月間売上</span>
          <span class="client-metric-val">¥${p.revenue.toLocaleString()}</span>
        </div>
        <div class="margin-bar-wrap">
          <div class="margin-bar" style="width:${pct}%;background:${colors[i % colors.length]}"></div>
        </div>
        <div class="margin-label"><span>0</span><span>¥${formatMillion(p.revenue)}M</span></div>
      </div>
    `;
  }).join('');
}

// ── ユーティリティ ────────────────────────────────────
function formatMillion(yen) {
  return (yen / 1000000).toFixed(1);
}

function showLoading(flag) {
  const el = document.getElementById('loading-bar');
  if (el) el.style.display = flag ? 'block' : 'none';
}

function showError(msg) {
  const el = document.getElementById('error-msg');
  if (el) { el.textContent = msg; el.style.display = 'block'; }
}

// タブ切り替え（グローバル）
function switchTab(el, name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  ['overview','team','unpaid','clients','import'].forEach(t => {
    const tab = document.getElementById('tab-'+t);
    if (tab) tab.style.display = t === name ? '' : 'none';
  });
}
