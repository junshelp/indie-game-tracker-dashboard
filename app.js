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
async function init() {
  try {
    const [dataRes, historyRes, summaryRes] = await Promise.all([
      fetch('./data/data.json?v=10'),
      fetch('./data/history.json?v=10'),
      fetch('./data/summary.json?v=10'),
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
  
  // Load Steam data in background
  loadSteamData().then(() => {
    renderSteamGenreFilters();
  }).catch(() => {});
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
    const viewId = `#view${e.target.dataset.view.charAt(0).toUpperCase() + e.target.dataset.view.slice(1)}`;
    const viewEl = document.querySelector(viewId);
    if (viewEl) viewEl.style.display = '';
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
  if (e.target.matches('.filter-btn[data-steam-genre]')) {
    document.querySelectorAll('.filter-btn[data-steam-genre]').forEach(b => b.classList.remove('active'));
    e.target.classList.add('active');
    steamState.genre = e.target.dataset.steamGenre;
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
  genre: '전체',
  statuses: new Set(['upcoming', 'released']),
  sortBy: 'smart',  // 'smart' | 'date' | 'recommendations' | 'steam_rank'
};

// === Steam: Load data ===
async function loadSteamData() {
  try {
    const [dataRes, historyRes] = await Promise.all([
      fetch('./data/steam/data.json?v=10'),
      fetch('./data/steam/history.json?v=10'),
    ]);
    steamState.data = await dataRes.json();
    steamState.history = await historyRes.json();
  } catch (err) {
    console.error('Failed to load Steam data:', err);
  }
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
      .filter(c => c.type === 'new_entry')
      .map(c => c.appid)
  );
  
  // Helper: parse release date
  function parseDate(ds) {
    if (!ds) return new Date(0);
    const d = new Date(ds);
    return isNaN(d.getTime()) ? new Date(0) : d;
  }
  
  switch (sortBy) {
    case 'date':
      games.sort((a, b) => parseDate(a.release_date) - parseDate(b.release_date));
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
          const dd = parseDate(a.release_date) - parseDate(b.release_date);
          if (dd !== 0) return dd;
          // Tiebreaker: steam_rank
          return (a.steam_rank || 999) - (b.steam_rank || 999);
        }
        
        // Released: most recommendations first
        const rd = (b.recommendations || 0) - (a.recommendations || 0);
        if (rd !== 0) return rd;
        // Tiebreaker: recent release first
        return parseDate(b.release_date) - parseDate(a.release_date);
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
  html += `<div style="font-size:0.75rem;color:var(--text3);margin:6px 2px;">🕒 Steam 데이터 수집: ${timeAgo(steamState.data?.generatedAt) || '—'} &nbsp;·&nbsp; ▲▼ = 직전 수집 대비 랭킹 변동</div>`;

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
  const isNew = (steamState.history?.changes || []).some(c => c.appid === g.appid && c.type === 'new_entry');
  const newBadge = isNew ? ' 🆕' : '';
  
  return `
    <div class="event-card ${isUpcoming ? '' : 'past'}">
      <div class="event-date" style="width:100px;">
        <div class="date-month">#${g.wishlist_rank || g.steam_rank}</div>
        <div class="date-main" style="font-size:0.7rem;color:var(--${isUpcoming ? 'accent2' : 'text2'})">${isUpcoming ? '출시예정' : '출시일'}</div>
        <div style="font-size:0.65rem;color:var(--text3)">${escapeHtml(g.release_date || '미정').substring(0, 12)}</div>
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
      `<button class="filter-btn ${steamState.genre === genre ? 'active' : ''}" data-steam-genre="${genre}">${genre} <span class="count">${count}</span></button>`
    )
  ].join('');
}

// === Steam: Render stats ===
function renderSteamStats() {
  if (!steamState.data) return;
  const s = steamState.data.summary;
  const el = document.querySelector('#statsCards');
  if (state.view !== 'steam') return; // only show steam stats on steam tab
  
  el.innerHTML = [
    { label: '트래킹 게임', value: s.total, cls: '' },
    { label: '위시리스트 랭킹', value: s.wishlisted || 0, cls: 'amber' },
    { label: '출시 예정', value: s.upcoming, cls: 'green' },
    { label: '최근 출시', value: s.released, cls: 'accent' },
    { label: '무료 게임', value: s.free_games, cls: '' },
    { label: '장르 수', value: (s.top_genres || []).length, cls: 'amber' },
  ].map(c => `<div class="stat-card ${c.cls}"><div class="stat-value">${c.value}</div><div class="stat-label">${c.label}</div></div>`).join('');
}
init();
