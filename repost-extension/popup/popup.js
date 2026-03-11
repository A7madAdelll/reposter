// ─── Popup Script ─────────────────────────────────────────────────────────────
'use strict';

const send = (msg) => new Promise((res) => {
  try {
    chrome.runtime.sendMessage(msg, (r) => {
      if (chrome.runtime.lastError) {
        console.error('SW error:', chrome.runtime.lastError.message);
        res({ error: chrome.runtime.lastError.message });
      } else {
        res(r || {});
      }
    });
  } catch(e) {
    console.error('send threw:', e.message);
    res({ error: e.message });
  }
});

let currentUser = null;
let searchDebounce = null;
let activeTab = 'home';

// ── Boot ───────────────────────────────────────────────────────────────────────
async function boot() {
  const { user } = await send({ type: 'GET_CURRENT_USER' });
  if (user) {
    currentUser = user;
    showApp();
  } else {
    showAuth();
  }
}

function showAuth() {
  document.getElementById('auth-screen').style.display = 'flex';
  document.getElementById('app').style.display = 'none';
}

function showApp() {
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  loadTab('home');
  checkPendingRequests();
}

// ── Auth ────────────────────────────────────────────────────────────────────────
document.getElementById('btn-sign-in').addEventListener('click', async () => {
  const btn = document.getElementById('btn-sign-in');
  btn.textContent = 'Signing in…';
  btn.disabled = true;
  const { user, error } = await send({ type: 'SIGN_IN' });
  if (user) {
    currentUser = user;
    showApp();
  } else {
    console.error('Sign in failed:', error);
    btn.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg> Try again`;
    btn.disabled = false;
    if (error) { const e = document.createElement('p'); e.style.cssText='color:#F87171;font-size:11px;text-align:center;margin-top:8px;'; e.textContent = error; btn.parentNode.insertBefore(e, btn.nextSibling); }
  }
});

document.getElementById('btn-sign-out').addEventListener('click', async () => {
  await send({ type: 'SIGN_OUT' });
  currentUser = null;
  showAuth();
});

// ── Tab Navigation ────────────────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.dataset.tab;
    document.getElementById(`tab-${tab}`).classList.add('active');
    activeTab = tab;
    loadTab(tab);
  });
});

async function loadTab(tab) {
  switch (tab) {
    case 'home': await loadFeed(); break;
    case 'people': await loadFollowing(); break;
    case 'requests': await loadRequests(); break;
    case 'profile': await loadProfile(); break;
  }
}

// ── Feed Tab ──────────────────────────────────────────────────────────────────
async function loadFeed() {
  const el = document.getElementById('feed-list');
  el.innerHTML = '<div class="spinner"></div>';
  const { feed } = await send({ type: 'GET_FEED' });
  el.innerHTML = '';

  if (!feed || feed.length === 0) {
    el.innerHTML = emptyState('No reposts yet', 'Follow people and their reposts will appear here.');
    return;
  }

  feed.slice(0, 20).forEach(item => {
    const card = document.createElement('a');
    card.className = 'repost-card';
    card.href = item.url;
    card.target = '_blank';
    card.innerHTML = `
      <div class="repost-thumb">
        ${item.thumbnail ? `<img src="${item.thumbnail}" alt="" loading="lazy">` : ''}
      </div>
      <div class="repost-card-info">
        <p class="repost-card-title">${esc(item.title || 'Untitled')}</p>
        <div class="repost-card-meta">${esc(item.reposterName)} · ${esc(item.platform || '')}</div>
      </div>
    `;
    el.appendChild(card);
  });
}

// ── People Tab ────────────────────────────────────────────────────────────────
async function loadFollowing() {
  const el = document.getElementById('people-list');
  el.innerHTML = '<div class="spinner"></div>';
  document.getElementById('search-label').textContent = 'My Following';
  const { profile } = await send({ type: 'GET_USER_PROFILE', uid: currentUser.uid });
  const following = profile?.following || [];
  el.innerHTML = '';

  if (following.length === 0) {
    el.innerHTML = emptyState('Not following anyone', 'Search for people to follow above.');
    return;
  }

  for (const uid of following.slice(0, 30)) {
    const { profile: p } = await send({ type: 'GET_USER_PROFILE', uid });
    if (p) el.appendChild(makeUserItem(p, uid, 'following'));
  }
}

document.getElementById('user-search').addEventListener('input', (e) => {
  clearTimeout(searchDebounce);
  const q = e.target.value.trim();
  if (q.length < 2) {
    document.getElementById('search-label').textContent = 'My Following';
    loadFollowing();
    return;
  }
  document.getElementById('search-label').textContent = `Results for "${q}"`;
  searchDebounce = setTimeout(() => searchUsers(q), 350);
});

async function searchUsers(q) {
  const el = document.getElementById('people-list');
  el.innerHTML = '<div class="spinner"></div>';
  const { users } = await send({ type: 'SEARCH_USERS', query: q });
  const { profile } = await send({ type: 'GET_USER_PROFILE', uid: currentUser.uid });
  const following = profile?.following || [];
  const pendingRequests = profile?.pendingSent || [];

  el.innerHTML = '';
  const filtered = (users || []).filter(u => u.uid !== currentUser.uid);
  if (filtered.length === 0) {
    el.innerHTML = emptyState('No users found', 'Try a different name.');
    return;
  }
  filtered.forEach(u => {
    const status = following.includes(u.uid) ? 'following' : 'search';
    el.appendChild(makeUserItem(u, u.uid, status));
  });
}

function makeUserItem(p, uid, mode) {
  const div = document.createElement('div');
  div.className = 'user-item';
  div.innerHTML = `
    <div class="user-item-avatar">
      ${p.photoURL ? `<img src="${p.photoURL}" alt="">` : (p.displayName?.[0]?.toUpperCase() || '?')}
    </div>
    <div class="user-item-info">
      <div class="user-item-name">${esc(p.displayName || 'Unknown')}</div>
      <div class="user-item-sub">${(p.reposts || []).length} reposts</div>
    </div>
    <div class="user-item-actions">
      ${mode === 'following'
        ? `<button class="btn btn-outline" data-action="unfollow" data-uid="${uid}">Unfollow</button>`
        : `<button class="btn btn-primary" data-action="request" data-uid="${uid}">Follow</button>`}
    </div>
  `;
  div.querySelector('[data-action]').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const action = btn.dataset.action;
    btn.disabled = true;
    btn.textContent = '…';
    if (action === 'request') {
      await send({ type: 'SEND_FOLLOW_REQUEST', targetUid: uid });
      btn.textContent = 'Requested';
      btn.classList.replace('btn-primary', 'btn-outline');
    } else if (action === 'unfollow') {
      await send({ type: 'UNFOLLOW', targetUid: uid });
      btn.textContent = 'Follow';
      btn.dataset.action = 'request';
      btn.classList.replace('btn-outline', 'btn-primary');
    }
    btn.disabled = false;
    if (error) { const e = document.createElement('p'); e.style.cssText='color:#F87171;font-size:11px;text-align:center;margin-top:8px;'; e.textContent = error; btn.parentNode.insertBefore(e, btn.nextSibling); }
  });
  return div;
}

// ── Requests Tab ──────────────────────────────────────────────────────────────
async function loadRequests() {
  const el = document.getElementById('requests-list');
  el.innerHTML = '<div class="spinner"></div>';
  const { profile } = await send({ type: 'GET_USER_PROFILE', uid: currentUser.uid });
  const requests = profile?.followRequests || [];
  el.innerHTML = '';

  updateRequestBadge(requests.length);

  if (requests.length === 0) {
    el.innerHTML = emptyState('No pending requests', 'When someone wants to follow you, you\'ll see them here.');
    return;
  }

  requests.forEach(req => {
    const div = document.createElement('div');
    div.className = 'user-item';
    div.innerHTML = `
      <div class="user-item-avatar">
        ${req.photoURL ? `<img src="${req.photoURL}" alt="">` : (req.displayName?.[0]?.toUpperCase() || '?')}
      </div>
      <div class="user-item-info">
        <div class="user-item-name">${esc(req.displayName || 'Someone')}</div>
        <div class="user-item-sub">Wants to follow you</div>
      </div>
      <div class="user-item-actions">
        <button class="btn btn-success" data-action="accept" data-uid="${req.uid}">Accept</button>
        <button class="btn btn-outline" data-action="decline" data-uid="${req.uid}">✕</button>
      </div>
    `;
    div.querySelector('[data-action="accept"]').addEventListener('click', async (e) => {
      await send({ type: 'ACCEPT_FOLLOW_REQUEST', requesterUid: req.uid });
      div.remove();
      checkPendingRequests();
    });
    div.querySelector('[data-action="decline"]').addEventListener('click', async (e) => {
      await send({ type: 'DECLINE_FOLLOW_REQUEST', requesterUid: req.uid });
      div.remove();
      checkPendingRequests();
    });
    el.appendChild(div);
  });
}

async function checkPendingRequests() {
  const { profile } = await send({ type: 'GET_USER_PROFILE', uid: currentUser.uid });
  updateRequestBadge((profile?.followRequests || []).length);
}

function updateRequestBadge(count) {
  const badge = document.getElementById('req-badge');
  if (count > 0) {
    badge.textContent = count;
    badge.style.display = 'inline';
  } else {
    badge.style.display = 'none';
  }
}

// ── Profile Tab ───────────────────────────────────────────────────────────────
async function loadProfile() {
  const profileBar = document.getElementById('profile-bar');
  profileBar.innerHTML = `
    <div class="user-avatar">
      ${currentUser.photoURL ? `<img src="${currentUser.photoURL}" alt="">` : (currentUser.displayName?.[0] || '?')}
    </div>
    <div class="user-info">
      <div class="user-name">${esc(currentUser.displayName || 'You')}</div>
      <div class="user-email">${esc(currentUser.email || '')}</div>
    </div>
  `;

  const repostsEl = document.getElementById('my-reposts');
  repostsEl.innerHTML = '<div class="spinner"></div>';
  const { profile } = await send({ type: 'GET_USER_PROFILE', uid: currentUser.uid });
  const reposts = (profile?.reposts || []).sort((a, b) => b.timestamp - a.timestamp);
  repostsEl.innerHTML = '';

  if (reposts.length === 0) {
    repostsEl.innerHTML = emptyState('No reposts yet', 'Hit the Repost button on any video page.');
    return;
  }

  reposts.slice(0, 20).forEach(item => {
    const card = document.createElement('a');
    card.className = 'repost-card';
    card.href = item.url;
    card.target = '_blank';
    card.innerHTML = `
      <div class="repost-thumb">
        ${item.thumbnail ? `<img src="${item.thumbnail}" alt="" loading="lazy">` : ''}
      </div>
      <div class="repost-card-info">
        <p class="repost-card-title">${esc(item.title || 'Untitled')}</p>
        <div class="repost-card-meta">${esc(item.platform || '')} · ${timeAgo(item.timestamp)}</div>
      </div>
    `;
    repostsEl.appendChild(card);
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function esc(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

function emptyState(title, body) {
  return `
    <div class="empty">
      <svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/>
        <path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>
      </svg>
      <strong>${title}</strong><br>${body}
    </div>
  `;
}

function timeAgo(ts) {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

boot();
