'use strict';

const ROLE_LABELS = {
  owner:    'オーナー',
  manager:  'マネージャー',
  employee: '社員',
  staff:    'スタッフ',
};

const STATUS_BADGE = {
  active:  { cls: 'badge-active',  text: '稼働中' },
  phase1:  { cls: 'badge-phase1',  text: 'Phase 1' },
  coming:  { cls: 'badge-coming',  text: '準備中' },
  guide:   { cls: 'badge-guide',   text: 'ガイド' },
};

async function init() {
  // ユーザー情報取得（401なら再ログイン）
  const meRes = await fetch('/api/portal/me');
  if (meRes.status === 401) { window.location.href = '/auth/google'; return; }
  const me = await meRes.json();

  // ヘッダー更新
  document.getElementById('user-name').textContent = me.name || me.email;
  document.getElementById('user-role-tag').textContent = ROLE_LABELS[me.role] || me.role;
  const avatarEl = document.getElementById('user-avatar');
  if (me.picture) {
    avatarEl.innerHTML = `<img src="${me.picture}" alt="${me.name}">`;
  } else {
    document.getElementById('user-initial').textContent = (me.name || me.email)[0].toUpperCase();
  }

  // 挨拶
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'おはようございます' : hour < 18 ? 'こんにちは' : 'お疲れ様です';
  document.getElementById('greeting-text').textContent = `${greet}、${me.name?.split(' ')[0] || ''}さん 👋`;
  document.getElementById('greeting-sub').textContent =
    new Date().toLocaleDateString('ja-JP', { year:'numeric', month:'long', day:'numeric', weekday:'long' });

  // カード取得・描画
  const cardsRes = await fetch('/api/portal/cards');
  if (cardsRes.status === 401) { window.location.href = '/auth/google'; return; }
  const cards = await cardsRes.json();
  const normalCards = cards.filter(c => !c.isAdmin);
  const adminCards  = cards.filter(c => c.isAdmin);

  const grid = document.getElementById('cards-grid');
  grid.innerHTML = normalCards.map(card => {
    const badge = STATUS_BADGE[card.status] || STATUS_BADGE.active;
    return `
      <a href="${card.href}" class="portal-card ${card.status === 'coming' ? 'coming' : ''}">
        <div class="card-top">
          <span class="card-icon">${card.icon}</span>
          <span class="card-badge ${badge.cls}">${badge.text}</span>
        </div>
        <div class="card-title">${card.title}</div>
        <div class="card-desc">${card.description}</div>
      </a>
    `;
  }).join('');

  if (adminCards.length > 0) {
    document.getElementById('admin-section').style.display = 'block';
    document.getElementById('admin-tools').innerHTML = adminCards.map(card => `
      <a href="${card.href}" class="admin-tool-link">${card.icon} ${card.title}</a>
    `).join('');
  }
}

init().catch(console.error);
