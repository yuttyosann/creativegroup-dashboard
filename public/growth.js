'use strict';

const STATUS_LABELS = {
  idea:        { text: 'アイデア',  cls: 'status-idea' },
  planned:     { text: '計画中',    cls: 'status-planned' },
  in_progress: { text: '実行中',    cls: 'status-in_progress' },
  done:        { text: '完了',      cls: 'status-done' },
};

const FUNNEL_STEPS = [
  { key: 'acquisition', label: 'Acquisition（認知）', color: '#1565c0' },
  { key: 'interest',    label: 'Interest（興味）',    color: '#1976d2' },
  { key: 'conversion',  label: 'Conversion（成約）',  color: '#42a5f5' },
  { key: 'retention',   label: 'Retention（継続）',   color: '#90caf9' },
  { key: 'revenue',     label: 'Revenue（売上）',     color: '#bbdefb' },
];

async function loadKpi() {
  const res = await fetch('/api/growth/kpi');
  if (res.status === 401) { window.location.href = '/auth/google'; return; }
  const kpi = await res.json();
  document.getElementById('kpi-sales').textContent     = kpi.monthlySales ? `¥${(kpi.monthlySales/1000000).toFixed(1)}M` : '—';
  document.getElementById('kpi-deals').textContent     = kpi.newDeals     ?? '—';
  document.getElementById('kpi-retention').textContent = kpi.retentionRate ? `${kpi.retentionRate}%` : '—';
  document.getElementById('kpi-roas').textContent      = kpi.roas         ? `${kpi.roas}x` : '—';
  document.getElementById('kpi-active').textContent    = kpi.activeInitiatives ?? 0;

  // ファネル描画
  const stepsEl = document.getElementById('funnel-steps');
  const margin = [0, 12, 24, 36, 48];
  stepsEl.innerHTML = FUNNEL_STEPS.map((step, i) => {
    const val = kpi.funnel?.[step.key];
    const textColor = i >= 3 ? '#2c2c2c' : '#fff';
    return `<div class="funnel-step" style="background:${step.color};margin:0 ${margin[i]}px 5px;color:${textColor}">
      <span>${step.label}</span>
      <strong>${val ?? '—'}</strong>
    </div>`;
  }).join('');
}

async function loadInitiatives() {
  const res = await fetch('/api/growth/initiatives');
  if (res.status === 401) { window.location.href = '/auth/google'; return; }
  const list = await res.json();
  const tbody = document.getElementById('initiatives-tbody');
  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#aaa;padding:20px">施策がまだありません。追加してください。</td></tr>';
    return;
  }
  tbody.innerHTML = list.map(item => {
    const s = STATUS_LABELS[item.status] || STATUS_LABELS.idea;
    const scoreClass = item.iceScore >= 7 ? 'score-high' : item.iceScore >= 5 ? 'score-mid' : 'score-low';
    return `<tr>
      <td>
        <div style="font-weight:600">${escHtml(item.title)}</div>
        ${item.description ? `<div style="font-size:11px;color:#888;margin-top:2px">${escHtml(item.description)}</div>` : ''}
      </td>
      <td class="center">${item.impact}</td>
      <td class="center">${item.confidence}</td>
      <td class="center">${item.ease}</td>
      <td class="center ice-score ${scoreClass}">${item.iceScore}</td>
      <td class="center">
        <select class="form-input" style="font-size:11px;padding:3px 6px;width:auto" onchange="updateStatus('${item.id}', this.value)">
          ${Object.entries(STATUS_LABELS).map(([v, l]) =>
            `<option value="${v}" ${item.status === v ? 'selected' : ''}>${l.text}</option>`
          ).join('')}
        </select>
      </td>
    </tr>`;
  }).join('');
}

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function openModal() {
  document.getElementById('modal').classList.add('open');
  document.getElementById('f-title').focus();
}

function closeModal() {
  document.getElementById('modal').classList.remove('open');
}

async function saveInitiative() {
  const title      = document.getElementById('f-title').value.trim();
  const impact     = Number(document.getElementById('f-impact').value);
  const confidence = Number(document.getElementById('f-confidence').value);
  const ease       = Number(document.getElementById('f-ease').value);
  const description = document.getElementById('f-desc').value.trim();

  if (!title) { alert('施策名を入力してください'); return; }

  await fetch('/api/growth/initiatives', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ title, impact, confidence, ease, description, status: 'idea' }),
  });

  closeModal();
  document.getElementById('f-title').value = '';
  document.getElementById('f-desc').value  = '';
  loadInitiatives();
}

async function updateStatus(id, status) {
  await fetch(`/api/growth/initiatives/${id}`, {
    method:  'PUT',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ status }),
  });
  loadKpi(); // KPIの「実行中」カウントを更新
}

// モーダル外クリックで閉じる
document.getElementById('modal').addEventListener('click', e => {
  if (e.target === e.currentTarget) closeModal();
});

loadKpi();
loadInitiatives();
