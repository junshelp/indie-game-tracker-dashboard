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

// === Init ===
async function fetchJSON(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function todayKST() {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul',
    year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const value = type => parts.find(p => p.type === type).value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}

function refreshEventStats() {
  if (!state.data) return;
  const today = todayKST();
  const cutoff = new Date(`${today}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() + 30);
  const end = cutoff.toISOString().slice(0, 10);
  const events = state.data.events;
  events.forEach(e => { e.status = e.endDate < today ? 'past' : 'upcoming'; });
  state.data.summary = {
    totalEvents: events.length,
    upcomingEvents: events.filter(e => e.status === 'upcoming').length,
    upcoming30Days: events.filter(e => e.status === 'upcoming' && e.startDate >= today && e.startDate <= end).length,
    thisMonth: events.filter(e => e.startDate.slice(0, 7) === today.slice(0, 7)).length,
    byCountry: Object.fromEntries(events.map(e => [e.countryCode, true])),
  };
}

async function init() {
  els.viewTimeline.innerHTML = '<div class="empty-state" role="status">행사 데이터를 불러오는 중입니다…</div>';
  const [data, history] = await Promise.allSettled([
    fetchJSON('./data/data.json?v=69'), fetchJSON('./data/history.json?v=69'),
  ]);
  if (data.status === 'fulfilled' && Array.isArray(data.value.events)) {
    state.data = data.value;
    state.history = history.status === 'fulfilled' ? history.value : { events: [], unavailable: true };
    if (state.data.generatedAt) els.refreshTime.textContent = `데이터 생성: ${formatDate(state.data.generatedAt)} (한국시간)`;
    render();
  } else {
    els.viewTimeline.innerHTML = '<div class="empty-state" role="alert">행사 데이터를 불러올 수 없습니다. <button type="button" data-retry="events">다시 시도</button></div>';
  }
  loadSteamData();
}

function formatDate(isoStr) {
  try {
    return new Intl.DateTimeFormat('ko-KR', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Seoul',
    }).format(new Date(isoStr));
  } catch { return isoStr; }
}

function formatDateShort(isoStr) {
  const [year, month, day] = String(isoStr).slice(0, 10).split('-').map(Number);
  return year && month && day ? `${month}/${day}` : String(isoStr || '미정');
}

function formatDateRange(start, end) {
  if (start === end) return formatDateShort(start);
  return `${formatDateShort(start)}–${formatDateShort(end)}`;
}

function timeAgo(isoStr) {
  if (!isoStr) return '';
  try {
    const diff = Date.now() - new Date(isoStr).getTime();
    if (diff < 0) return '방금 전';
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return '방금 전';
    if (mins < 60) return `${mins}분 전`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}시간 전`;
    const days = Math.floor(hrs / 24);
    return `${days}일 전`;
  } catch { return ''; }
}

// === Render ===
function render() {
  renderStats();
  renderFilters();
  renderView();
}

// === Stats cards ===
function renderStats() {
  if (!state.data) return;
  refreshEventStats();
  const s = state.data.summary;
  const cards = [
    { label: '전체 행사', value: s.totalEvents, cls: '' },
    { label: '예정 행사', value: s.upcomingEvents, cls: 'green' },
    { label: '이번 달', value: s.thisMonth, cls: 'accent' },
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
  const map = { KR: '🇰🇷 한국', JP: '🇯🇵 일본', CN: '🇨🇳 중국', ONLINE: '🌏 온라인', TH: '🇹🇭 태국', TW: '🇹🇼 대만', OTHER: '기타 지역' };
  return map[code] || code;
}

// === Filter events ===
function filteredEvents() {
  if (!state.data) return [];
  refreshEventStats();
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
  else if (state.view === 'steam') renderSteamView();
  
  // Toggle filter panels
  document.querySelector('#eventFilters').style.display = state.view === 'steam' ? 'none' : '';
  document.querySelector('#steamFilters').style.display = state.view === 'steam' ? '' : 'none';
  
  // Render appropriate stats
  if (state.view === 'steam') renderSteamStats();
  else renderStats();
}

function renderTimeline(events) {
  // Group by month
  const grouped = {};
  events.forEach(e => {
    const m = e.startDate.slice(0, 7);
    if (!grouped[m]) grouped[m] = [];
    grouped[m].push(e);
  });
  
  const months = Object.keys(grouped).sort();
  
  if (!events.length) {
    els.viewTimeline.innerHTML = '<div class="empty-state" role="status">조건에 맞는 행사가 없습니다. <button type="button" data-reset-filters>필터 초기화</button></div>';
    return;
  }
  els.viewTimeline.innerHTML = months.map(m => {
    const monthEvents = grouped[m];
    return `
      <div class="month-group">
        <div class="month-header">
          <span>${m.slice(0, 4)}년 ${Number(m.slice(5))}월</span>
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
  if (state.history?.unavailable) {
    els.viewHistory.innerHTML = '<div class="empty-state" role="alert">변경 이력을 불러오지 못했습니다. 행사 목록은 이용할 수 있습니다.</div>';
    return;
  }
  const hist = state.history?.events;
  if (!hist || hist.length === 0) {
    els.viewHistory.innerHTML = '<div class="empty-state"><div class="empty-icon">📋</div>변경 이력이 없습니다</div>';
    return;
  }
  
  els.viewHistory.innerHTML = hist.map(h => `
    <div class="history-item">
      <div class="hi-date">${h.date}</div>
      <div class="hi-badge ${h.type}">${historyTypeLabel(h.type)}</div>
      <div class="hi-text">
        <strong>${escapeHtml(h.country)} ${escapeHtml(h.name)}</strong><br>
        <span style="color:var(--text3)">${escapeHtml(h.detail)}</span>
      </div>
    </div>
  `).join('');
}

function historyTypeLabel(type) {
  const map = { discovered: '🆕 신규', confirmed: '✅ 확정', changed: '🔄 변경' };
  return map[type] || type;
}

function renderEventCard(e, urgent = false) {
  const [, month, day] = e.startDate.split('-').map(Number);
  const url = cleanURL(e.url);
  
  const countryBadgeClass = {
    KR: 'badge-kr', JP: 'badge-jp', CN: 'badge-cn', ONLINE: 'badge-online'
  }[e.countryCode] || '';
  
  return `
    <div class="event-card ${e.status === 'past' ? 'past' : ''} ${urgent ? 'upcoming-urgent' : ''}">
      <div class="event-date">
        <div class="date-month">${month}월</div>
        <div class="date-main">${day}일</div>
        ${e.startDate !== e.endDate ? `<div class="date-range-end">~${formatDateShort(e.endDate)}</div>` : ''}
      </div>
      <div class="event-body">
        <div class="event-name">${escapeHtml(e.name)}</div>
        <div class="event-meta">
          <span class="badge ${countryBadgeClass}">${countryLabel(e.countryCode)}</span>
          <span class="badge badge-expo">${escapeHtml(e.typeLabel)}</span>
          ${e.venue ? `<span>📍 ${escapeHtml(e.venue)}</span>` : ''}
          ${e.submissionPeriod ? `<span class="badge badge-deadline">📝 ${escapeHtml(e.submissionPeriod)}</span>` : ''}
        </div>
        ${url ? `<div class="event-url"><a href="${escapeHtml(url)}" target="_blank" rel="noopener" aria-label="${escapeHtml(e.name)} 행사 정보 열기">🔗 행사 정보</a></div>` : '<div class="event-url">공식 링크 확인 중</div>'}
      </div>
    </div>
  `;
}

function cleanURL(raw) {
  const match = String(raw || '').match(/\[.*?\]\((https?:\/\/[^\s)]+)\)/);
  const value = match ? match[1] : String(raw || '');
  try {
    if (!/^https?:\/\//i.test(value) || /\s/.test(value)) return null;
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// === Event listeners ===
document.addEventListener('click', (e) => {
  const target = e.target.closest('button');
  if (!target) return;
  if (target.dataset.retry === 'events') { init(); return; }
  if (target.dataset.retry === 'steam') { loadSteamData(); return; }
  if (target.hasAttribute('data-reset-filters')) {
    state.country = state.type = '전체';
    state.statuses = new Set(['upcoming']);
    $$('#statusToggles input').forEach(input => input.checked = input.dataset.status === 'upcoming');
    render(); return;
  }
  // Tab buttons
  if (target.matches('.main-tab')) {
    $$('.main-tab').forEach(t => {
      const active = t === target;
      t.classList.toggle('active', active);
      t.setAttribute('aria-selected', String(active));
      t.tabIndex = active ? 0 : -1;
    });
    target.classList.add('active');
    state.view = target.dataset.view;
    $$('.view').forEach(v => v.style.display = 'none');
    const viewId = `#view${target.dataset.view.charAt(0).toUpperCase() + target.dataset.view.slice(1)}`;
    const viewEl = document.querySelector(viewId);
    if (viewEl) viewEl.style.display = '';
    renderView();
  }
  
  // Country filter
  if (target.matches('.filter-btn[data-country]')) {
    $$('.filter-btn[data-country]').forEach(b => b.classList.remove('active'));
    target.classList.add('active');
    state.country = target.dataset.country;
    renderView();
  }
  
  // Type filter
  if (target.matches('.filter-btn[data-type]')) {
    $$('.filter-btn[data-type]').forEach(b => b.classList.remove('active'));
    target.classList.add('active');
    state.type = target.dataset.type;
    renderView();
  }
});

// Status toggles
document.addEventListener('change', (e) => {
  if (e.target.matches('.chip input[data-status]')) {
    const status = e.target.dataset.status;
    const parentId = e.target.closest('[id]')?.id;
    
    if (parentId === 'steamStatusToggles') {
      if (e.target.checked) steamState.statuses.add(status);
      else steamState.statuses.delete(status);
      if (state.view === 'steam') renderSteamView();
    } else {
      if (e.target.checked) state.statuses.add(status);
      else state.statuses.delete(status);
      renderView();
    }
  }
});

// Steam genre filter
document.addEventListener('click', (e) => {
  const target = e.target.closest('button');
  if (!target) return;
  if (target.matches('.filter-btn[data-steam-genre]')) {
    document.querySelectorAll('.filter-btn[data-steam-genre]').forEach(b => b.classList.remove('active'));
    target.classList.add('active');
    steamState.genre = target.dataset.steamGenre;
    renderSteamView();
  }
});

// Steam sort change event
document.addEventListener('change', (e) => {
  if (e.target.id === 'steamSortSelect') {
    steamState.sortBy = e.target.value;
    if (state.view === 'steam') renderSteamView();
  }
});

// === Steam state ===
const steamState = {
  data: null,
  history: null,
  loading: true,
  error: null,
  genre: '전체',
  statuses: new Set(['upcoming', 'released']),
  sortBy: 'smart',  // 'smart' | 'date' | 'recommendations' | 'steam_rank'
};

// === Steam: Load data ===
async function loadSteamData() {
  steamState.loading = true;
  steamState.error = null;
  if (state.view === 'steam') renderSteamView();
  const [data, history] = await Promise.allSettled([
    fetchJSON('./data/steam/data.json?v=69'), fetchJSON('./data/steam/history.json?v=69'),
  ]);
  if (data.status === 'fulfilled' && Array.isArray(data.value.games) && data.value.summary) {
    steamState.data = data.value;
    steamState.history = history.status === 'fulfilled' ? history.value : { changes: [] };
    renderSteamGenreFilters();
  } else steamState.error = 'Steam 데이터를 불러오지 못했습니다.';
  steamState.loading = false;
  if (state.view === 'steam') { renderSteamView(); renderSteamStats(); }
}

function recentSteamEntry(change) {
  if (change.type !== 'new_entry' || !change.date) return false;
  const days = (Date.parse(`${todayKST()}T00:00:00Z`) - Date.parse(`${change.date}T00:00:00Z`)) / 86400000;
  return days >= 0 && days < 3;
}

function releaseSortTime(text) {
  const value = String(text || '').trim();
  if (!value || /announced|coming|TBA|TBD|미정/i.test(value)) return Infinity;
  let match = value.match(/^Q([1-4])\s+(\d{4})$/i);
  if (match) return Date.UTC(Number(match[2]), (Number(match[1]) - 1) * 3, 1);
  if (/^\d{4}$/.test(value)) return Date.UTC(Number(value), 0, 1);
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Infinity : parsed;
}

// === Steam: Filter ===
function filteredSteamGames() {
  if (!steamState.data) return [];
  let games = steamState.data.games.filter(g => {
    if (!steamState.statuses.has(g.status)) return false;
    if (steamState.genre !== '전체' && !(g.genres || []).includes(steamState.genre)) return false;
    return true;
  });

  // === Sort ===
  const sortBy = steamState.sortBy || 'smart';
  
  // Helper: check if new entry from history
  const newAppIds = new Set(
    (steamState.history?.changes || [])
      .filter(recentSteamEntry)
      .map(c => c.appid)
  );
  
  // Helper: parse release date
  function compareRelease(a, b) {
    const first = releaseSortTime(a.release_date), second = releaseSortTime(b.release_date);
    return first === second ? 0 : first < second ? -1 : 1;
  }

  switch (sortBy) {
    case 'date':
      games.sort((a, b) => compareRelease(a, b));
      break;
    case 'recommendations':
      games.sort((a, b) => (b.recommendations || 0) - (a.recommendations || 0));
      break;
    case 'steam_rank':
      games.sort((a, b) => (a.steam_rank || 999) - (b.steam_rank || 999));
      break;
    case 'wishlist':
      games.sort((a, b) => (a.wishlist_rank || 9999) - (b.wishlist_rank || 9999));
      break;
    case 'smart':
    default:
      games.sort((a, b) => {
        // 1st: upcoming before released
        if (a.status !== b.status)
          return a.status === 'upcoming' ? -1 : 1;
        
        if (a.status === 'upcoming') {
          // New entries first
          const aNew = newAppIds.has(a.appid) ? 1 : 0;
          const bNew = newAppIds.has(b.appid) ? 1 : 0;
          if (aNew !== bNew) return bNew - aNew;
          // Sooner release first
          const dd = compareRelease(a, b);
          if (dd !== 0) return dd;
          // Tiebreaker: steam_rank
          return (a.steam_rank || 999) - (b.steam_rank || 999);
        }
        
        // Released: most recommendations first
        const rd = (b.recommendations || 0) - (a.recommendations || 0);
        if (rd !== 0) return rd;
        // Tiebreaker: recent release first
        return compareRelease(b, a);
      });
      break;
  }
  
  return games;
}

// === Steam: Render ===
function buildRankChangeMap() {
  const map = {};
  (steamState.history?.changes || []).forEach(c => {
    if (c.type === 'rank_change' && c.appid != null && !map[c.appid]) {
      map[c.appid] = c;
    }
  });
  return map;
}

function renderSteamView() {
  const view = document.querySelector('#viewSteam');
  view.setAttribute('aria-busy', String(steamState.loading));
  if (steamState.loading) { view.innerHTML = '<div class="empty-state" role="status">Steam 데이터를 불러오는 중입니다…</div>'; return; }
  if (steamState.error) { view.innerHTML = '<div class="empty-state" role="alert">Steam 데이터를 불러오지 못했습니다. <button type="button" data-retry="steam">다시 시도</button></div>'; return; }
  const games = filteredSteamGames();
  if (!games.length) {
    document.querySelector('#viewSteam').innerHTML = '<div class="empty-state"><div class="empty-icon">🎮</div>데이터가 없습니다</div>';
    return;
  }

  const rankChangeMap = buildRankChangeMap();

  // Group by status
  const upcoming = games.filter(g => g.status === 'upcoming');
  const released = games.filter(g => g.status === 'released');

  let html = '';

  html += `<div class="wishlist-banner">⭐ 위시리스트 순위는 Steam 'popularwishlist' 랭킹(상대 순위)입니다. 절대 위시리스트·팔로워 수치는 Steam이 공개하지 않아 제공하지 않습니다.</div>`;
  html += `<div style="font-size:0.75rem;color:var(--text3);margin:6px 2px;">상세 정보 ${steamState.data.games.filter(g => Array.isArray(g.genres)).length}/${steamState.data.games.length}개 확인 · 🕒 Steam 데이터 수집: ${timeAgo(steamState.data?.generatedAt) || '—'} &nbsp;·&nbsp; ▲▼ = 직전 수집 대비 랭킹 변동</div>`;

  if (upcoming.length > 0) {
    html += `<div class="month-group">
      <div class="month-header">
        <span>🆕 출시 예정</span>
        <span class="month-count">${upcoming.length}개</span>
      </div>
      ${upcoming.map(g => renderSteamCard(g, rankChangeMap)).join('')}
    </div>`;
  }

  if (released.length > 0) {
    html += `<div class="month-group">
      <div class="month-header">
        <span>✅ 최근 출시</span>
        <span class="month-count">${released.length}개</span>
      </div>
      ${released.map(g => renderSteamCard(g, rankChangeMap)).join('')}
    </div>`;
  }

  document.querySelector('#viewSteam').innerHTML = html;
}

function renderSteamCard(g, rankChangeMap = {}) {
  const genres = (g.genres || []).slice(0, 3).map(genre => 
    `<span class="badge badge-expo">${escapeHtml(genre)}</span>`
  ).join(' ');
  
  const devs = (g.developers || []).slice(0, 2).join(', ');
  const isUpcoming = g.status === 'upcoming';
  
  // Engagement number: recommendations for released, rank for upcoming
  let engagementHTML = '';
  let reviewBadge = '';
  
  // Review score badge
  if (g.review_summary) {
    const summary = g.review_summary.toLowerCase();
    let color = 'var(--text3)';
    if (summary.includes('overwhelmingly positive')) color = '#1a7f37';
    else if (summary.includes('very positive')) color = '#2ea043';
    else if (summary.includes('positive')) color = '#3fb950';
    else if (summary.includes('mixed')) color = '#d29922';
    else if (summary.includes('negative')) color = '#f85149';
    reviewBadge = `<div style="font-size:0.7rem;color:${color};margin-top:2px;">⭐ ${escapeHtml(g.review_summary).substring(0, 25)}</div>`;
  }
  
  if (g.recommendations) {
    engagementHTML = `<div class="stat-value" style="font-size:1.2rem;color:var(--green)">👍 ${g.recommendations.toLocaleString()}</div>
                      <div class="stat-label">추천</div>
                      ${reviewBadge}`;
  } else if (g.status === 'upcoming') {
    const rc = rankChangeMap[g.appid];
    let trendHTML = '';
    if (rc) {
      const m = (rc.detail || '').match(/\(([↑↓])(\d+)\)/);
      if (m) {
        const up = m[1] === '↑';
        trendHTML = ` <span style="font-size:0.68rem;color:${up ? '#3fb950' : '#f85149'}" title="직전 수집 대비 위시리스트 랭킹 ${up ? '상승' : '하락'} ${m[2]}계단">${m[1]}${m[2]}</span>`;
      }
    }
    if (g.wishlist_rank) {
      engagementHTML = `<div class="stat-value" style="font-size:1.2rem;color:#e3b341" title="위시리스트 상대 순위(팔로워 수 아님) — Steam popularwishlist 랭킹 기준">⭐ #${g.wishlist_rank}${trendHTML}</div>
                        <div class="stat-label">위시리스트 상대순위</div>`;
    } else {
      engagementHTML = `<div class="stat-value" style="font-size:1.2rem;color:var(--accent2)" title="출시 예정 목록 내 상대 순서(날짜순, 위시리스트 랭킹 미포함)">#${g.steam_rank}</div>
                        <div class="stat-label">출시 예정 순</div>`;
    }
  }
  
  // Check if game is newly discovered (from history)
  const isNew = (steamState.history?.changes || []).some(c => c.appid === g.appid && recentSteamEntry(c));
  const newBadge = isNew ? ' 🆕' : '';
  
  return `
    <div class="event-card ${isUpcoming ? '' : 'past'}">
      <div class="event-date" style="width:100px;">
        <div class="date-month">#${g.wishlist_rank || g.steam_rank}</div>
        <div class="date-main" style="font-size:0.7rem;color:var(--${isUpcoming ? 'accent2' : 'text2'})">${isUpcoming ? '출시예정' : '출시일'}</div>
        <div style="font-size:0.65rem;color:var(--text3)">${escapeHtml(g.release_date || '미정')}</div>
      </div>
      <div class="event-body">
        <div class="event-name">${escapeHtml(g.name)}${newBadge}</div>
        <div class="event-meta">
          ${genres}
          ${devs ? `<span>👤 ${escapeHtml(devs)}</span>` : ''}
        </div>
        ${g.short_description ? `<div style="font-size:0.75rem;color:var(--text3);margin-top:4px;">${escapeHtml(g.short_description).substring(0, 120)}</div>` : ''}
        <div class="event-url" style="margin-top:6px;">
          <a href="${escapeHtml(g.store_url || '')}" target="_blank" rel="noopener">🛒 Steam 스토어</a>
          <a href="https://steamdb.info/app/${g.appid}/" target="_blank" rel="noopener" style="margin-left:8px;">📊 SteamDB</a>
        </div>
      </div>
      <div class="event-date" style="width:90px;border-left:1px solid var(--border);padding-left:12px;">
        ${engagementHTML}
      </div>
    </div>
  `;
}

// === Steam: Render genre filters ===
function renderSteamGenreFilters() {
  if (!steamState.data) return;
  const genres = {};
  steamState.data.games.forEach(g => {
    (g.genres || []).forEach(genre => {
      genres[genre] = (genres[genre] || 0) + 1;
    });
  });
  
  const container = document.querySelector('#steamGenreFilters');
  container.innerHTML = [
    `<button class="filter-btn ${steamState.genre === '전체' ? 'active' : ''}" data-steam-genre="전체">전체 <span class="count">${steamState.data.games.length}</span></button>`,
    ...Object.entries(genres).sort((a, b) => b[1] - a[1]).map(([genre, count]) =>
      `<button class="filter-btn ${steamState.genre === genre ? 'active' : ''}" data-steam-genre="${genre}">${escapeHtml(genre)} <span class="count">${count}</span></button>`
    )
  ].join('');
}

// === Steam: Render stats ===
function renderSteamStats() {
  if (steamState.loading || steamState.error || !steamState.data) {
    if (state.view === 'steam') document.querySelector('#statsCards').innerHTML = '';
    return;
  }
  const s = steamState.data.summary;
  const el = document.querySelector('#statsCards');
  if (state.view !== 'steam') return; // only show steam stats on steam tab
  
  el.innerHTML = [
    { label: '트래킹 게임', value: s.total, cls: '' },
    { label: '위시리스트 랭킹', value: s.wishlisted || 0, cls: 'amber' },
    { label: '출시 예정', value: s.upcoming, cls: 'green' },
    { label: '최근 출시', value: s.released, cls: 'accent' },
    { label: '무료 게임', value: s.free_games, cls: '' },
    { label: '장르 수', value: new Set(steamState.data.games.flatMap(g => g.genres || [])).size, cls: 'amber' },
  ].map(c => `<div class="stat-card ${c.cls}"><div class="stat-value">${c.value}</div><div class="stat-label">${c.label}</div></div>`).join('');
}
document.addEventListener('keydown', event => {
  const tab = event.target.closest('[role="tab"]');
  if (!tab || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  const tabs = [...$$('[role="tab"]')];
  const current = tabs.indexOf(tab);
  const index = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 :
    (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
  event.preventDefault(); tabs[index].focus(); tabs[index].click();
});
document.addEventListener('visibilitychange', () => { if (!document.hidden && state.data) renderView(); });

init();
