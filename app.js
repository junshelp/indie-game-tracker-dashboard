// === State ===
const state = {
  data: null,
  history: null,
  summary: null,
  view: 'timeline',
  country: '전체',
  type: '전체',
  statuses: new Set(['upcoming']),
};

// === DOM refs ===
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const els = {
  statsCards: $('#statsCards'),
  refreshTime: $('#refreshTime'),
  countryFilters: $('#countryFilters'),
  typeFilters: $('#typeFilters'),
  viewTimeline: $('#viewTimeline'),
  viewUpcoming: $('#viewUpcoming'),
  viewHistory: $('#viewHistory'),
};

// === Load data ===
async function init() {
  try {
    const [dataRes, historyRes, summaryRes] = await Promise.all([
      fetch('./data/data.json?v=2'),
      fetch('./data/history.json?v=2'),
      fetch('./data/summary.json?v=2'),
    ]);
    state.data = await dataRes.json();
    state.history = await historyRes.json();
    state.summary = await summaryRes.json();
    
    if (state.data.generatedAt) {
      els.refreshTime.textContent = `마지막 갱신: ${formatDate(state.data.generatedAt)}`;
    }
    
    render();
  } catch (err) {
    console.error('Failed to load data:', err);
    els.viewTimeline.innerHTML = '<div class="empty-state"><div class="empty-icon">⚠️</div>데이터를 불러올 수 없습니다</div>';
  }
}

function formatDate(isoStr) {
  try {
    return new Intl.DateTimeFormat('ko-KR', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    }).format(new Date(isoStr));
  } catch { return isoStr; }
}

function formatDateShort(isoStr) {
  try {
    const d = new Date(isoStr);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  } catch { return isoStr; }
}

function formatDateRange(start, end) {
  const s = new Date(start);
  const e = new Date(end);
  const sStr = `${s.getMonth() + 1}/${s.getDate()}`;
  if (start === end) return sStr;
  const eStr = s.getMonth() === e.getMonth() ? `${e.getDate()}` : `${e.getMonth() + 1}/${e.getDate()}`;
  return `${sStr}-${eStr}`;
}

// === Render ===
function render() {
  renderStats();
  renderFilters();
  renderView();
}

// === Stats cards ===
function renderStats() {
  const s = state.data.summary;
  const cards = [
    { label: '전체 행사', value: s.totalEvents, cls: '' },
    { label: '예정 행사', value: s.upcomingEvents, cls: 'green' },
    { label: '이번 달', value: s.byMonth['8'] || 0, cls: 'accent' },
    { label: '국가 수', value: Object.keys(s.byCountry).length, cls: '' },
    { label: '30일 내', value: s.upcoming30Days, cls: 'amber' },
  ];
  els.statsCards.innerHTML = cards.map(c =>
    `<div class="stat-card ${c.cls}"><div class="stat-value">${c.value}</div><div class="stat-label">${c.label}</div></div>`
  ).join('');
}

// === Filters ===
function renderFilters() {
  const events = state.data.events;
  
  // Country
  const countries = {};
  events.forEach(e => {
    const c = e.countryCode;
    countries[c] = (countries[c] || 0) + 1;
  });
  
  els.countryFilters.innerHTML = [
    `<button class="filter-btn ${state.country === '전체' ? 'active' : ''}" data-country="전체">전체 <span class="count">${events.length}</span></button>`,
    ...Object.entries(countries).map(([code, count]) =>
      `<button class="filter-btn ${state.country === code ? 'active' : ''}" data-country="${code}">${countryLabel(code)} <span class="count">${count}</span></button>`
    )
  ].join('');
  
  // Type
  const types = {};
  events.forEach(e => {
    const t = e.typeLabel;
    types[t] = (types[t] || 0) + 1;
  });
  
  els.typeFilters.innerHTML = [
    `<button class="filter-btn ${state.type === '전체' ? 'active' : ''}" data-type="전체">전체 <span class="count">${events.length}</span></button>`,
    ...Object.entries(types).sort((a, b) => b[1] - a[1]).map(([type, count]) =>
      `<button class="filter-btn ${state.type === type ? 'active' : ''}" data-type="${type}">${type} <span class="count">${count}</span></button>`
    )
  ].join('');
}

function countryLabel(code) {
  const map = { KR: '🇰🇷 한국', JP: '🇯🇵 일본', CN: '🇨🇳 중국', ONLINE: '🌏 온라인', TH: '🇹🇭 태국' };
  return map[code] || code;
}

// === Filter events ===
function filteredEvents() {
  return state.data.events.filter(e => {
    if (state.country !== '전체' && e.countryCode !== state.country) return false;
    if (state.type !== '전체' && e.typeLabel !== state.type) return false;
    if (!state.statuses.has(e.status)) return false;
    return true;
  });
}

// === View rendering ===
function renderView() {
  const events = filteredEvents();
  
  if (state.view === 'timeline') renderTimeline(events);
  else if (state.view === 'upcoming') renderUpcoming(events);
  else if (state.view === 'history') renderHistory();
}

function renderTimeline(events) {
  // Group by month
  const grouped = {};
  events.forEach(e => {
    const m = e.month;
    if (!grouped[m]) grouped[m] = [];
    grouped[m].push(e);
  });
  
  const months = Object.keys(grouped).sort((a, b) => Number(a) - Number(b));
  
  els.viewTimeline.innerHTML = months.map(m => {
    const monthEvents = grouped[m];
    return `
      <div class="month-group">
        <div class="month-header">
          <span>${m}월</span>
          <span class="month-count">${monthEvents.length}개 행사</span>
        </div>
        ${monthEvents.map(e => renderEventCard(e)).join('')}
      </div>
    `;
  }).join('');
}

function renderUpcoming(events) {
  // Sort by date, upcoming first
  const upcoming = events.filter(e => e.status === 'upcoming')
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  
  // Highlight next 14 days
  const today = new Date();
  const twoWeeks = new Date(today);
  twoWeeks.setDate(twoWeeks.getDate() + 14);
  
  els.viewUpcoming.innerHTML = upcoming.length === 0
    ? '<div class="empty-state"><div class="empty-icon">📭</div>다가오는 행사가 없습니다</div>'
    : upcoming.map(e => {
        const start = new Date(e.startDate);
        const urgent = start <= twoWeeks;
        return renderEventCard(e, urgent);
      }).join('');
}

function renderHistory() {
  const hist = state.history.events;
  if (!hist || hist.length === 0) {
    els.viewHistory.innerHTML = '<div class="empty-state"><div class="empty-icon">📋</div>변경 이력이 없습니다</div>';
    return;
  }
  
  els.viewHistory.innerHTML = hist.map(h => `
    <div class="history-item">
      <div class="hi-date">${h.date}</div>
      <div class="hi-badge ${h.type}">${historyTypeLabel(h.type)}</div>
      <div class="hi-text">
        <strong>${h.country} ${escapeHtml(h.name)}</strong><br>
        <span style="color:var(--text3)">${h.detail}</span>
      </div>
    </div>
  `).join('');
}

function historyTypeLabel(type) {
  const map = { discovered: '🆕 신규', confirmed: '✅ 확정', changed: '🔄 변경' };
  return map[type] || type;
}

function renderEventCard(e, urgent = false) {
  const d = new Date(e.startDate);
  const day = d.getDate();
  const month = d.getMonth() + 1;
  
  const countryBadgeClass = {
    KR: 'badge-kr', JP: 'badge-jp', CN: 'badge-cn', ONLINE: 'badge-online'
  }[e.countryCode] || '';
  
  return `
    <div class="event-card ${e.status === 'past' ? 'past' : ''} ${urgent ? 'upcoming-urgent' : ''}">
      <div class="event-date">
        <div class="date-month">${month}월</div>
        <div class="date-main">${day}일</div>
        ${e.startDate !== e.endDate ? `<div style="font-size:0.65rem;color:var(--text3)">~${new Date(e.endDate).getDate()}일</div>` : ''}
      </div>
      <div class="event-body">
        <div class="event-name">${escapeHtml(e.name)}</div>
        <div class="event-meta">
          <span class="badge ${countryBadgeClass}">${countryLabel(e.countryCode)}</span>
          <span class="badge badge-expo">${e.typeLabel}</span>
          ${e.venue ? `<span>📍 ${escapeHtml(e.venue)}</span>` : ''}
          ${e.submissionPeriod ? `<span class="badge badge-deadline">📝 ${escapeHtml(e.submissionPeriod)}</span>` : ''}
        </div>
        ${e.url ? `<div class="event-url"><a href="${escapeHtml(cleanURL(e.url))}" target="_blank" rel="noopener">🔗 바로가기</a></div>` : ''}
      </div>
    </div>
  `;
}

function cleanURL(raw) {
  // Strip markdown link syntax: [text](url) → url
  const m = String(raw || '').match(/\[.*?\]\((https?:\/\/[^\s)]+)\)/);
  return m ? m[1] : raw;
}

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// === Event listeners ===
document.addEventListener('click', (e) => {
  // Tab buttons
  if (e.target.matches('.main-tab')) {
    $$('.main-tab').forEach(t => t.classList.remove('active'));
    e.target.classList.add('active');
    state.view = e.target.dataset.view;
    $$('.view').forEach(v => v.style.display = 'none');
    $(`#view${e.target.dataset.view.charAt(0).toUpperCase() + e.target.dataset.view.slice(1)}`).style.display = '';
    renderView();
  }
  
  // Country filter
  if (e.target.matches('.filter-btn[data-country]')) {
    $$('.filter-btn[data-country]').forEach(b => b.classList.remove('active'));
    e.target.classList.add('active');
    state.country = e.target.dataset.country;
    renderView();
  }
  
  // Type filter
  if (e.target.matches('.filter-btn[data-type]')) {
    $$('.filter-btn[data-type]').forEach(b => b.classList.remove('active'));
    e.target.classList.add('active');
    state.type = e.target.dataset.type;
    renderView();
  }
});

// Status toggles
document.addEventListener('change', (e) => {
  if (e.target.matches('.chip input[data-status]')) {
    const status = e.target.dataset.status;
    if (e.target.checked) state.statuses.add(status);
    else state.statuses.delete(status);
    renderView();
  }
});

// === Init ===
init();
