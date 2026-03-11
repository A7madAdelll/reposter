// ─── Content Script ───────────────────────────────────────────────────────────
// Runs on every supported platform page

(function () {
  'use strict';

  // ── Platform Detection ──────────────────────────────────────────────────────
  const PLATFORMS = {
    youtube: {
      match: () => location.hostname.includes('youtube.com'),
      isHomePage: () => location.pathname === '/' || location.pathname === '',
      isVideoPage: () => location.pathname.startsWith('/watch') && !!new URLSearchParams(location.search).get('v'),
      getVideoId: () => new URLSearchParams(location.search).get('v'),
      getVideoUrl: () => location.href,
      getVideoTitle: () => document.querySelector('h1.ytd-watch-metadata yt-formatted-string, #title h1, ytd-watch-metadata h1 yt-formatted-string, .title.ytd-watch-metadata')?.textContent?.trim() || document.title.replace(' - YouTube','').trim(),
      getThumbnail: (id) => `https://img.youtube.com/vi/${id}/hqdefault.jpg`,
      getFeedContainers: () => document.querySelectorAll('ytd-rich-item-renderer, ytd-video-renderer'),
      getVideoCardId: (el) => el.querySelector('a#thumbnail')?.href?.match(/v=([^&]+)/)?.[1],
      injectRepostButton: injectYouTubeRepostButton,
      injectFeedSection: injectYouTubeFeedSection,
      name: 'YouTube'
    },
    twitter: {
      match: () => location.hostname.includes('twitter.com') || location.hostname.includes('x.com'),
      isHomePage: () => location.pathname === '/' || location.pathname === '/home',
      isVideoPage: () => false,
      getVideoId: () => location.pathname.match(/status\/(\d+)/)?.[1],
      getVideoUrl: () => location.href,
      getVideoTitle: () => document.querySelector('[data-testid="tweetText"]')?.textContent?.trim(),
      getThumbnail: () => document.querySelector('video')?.poster || '',
      getFeedContainers: () => document.querySelectorAll('article[data-testid="tweet"]'),
      getVideoCardId: (el) => el.querySelector('a[href*="/status/"]')?.href?.match(/status\/(\d+)/)?.[1],
      injectRepostButton: injectGenericRepostButton,
      injectFeedSection: injectGenericFeedSection,
      name: 'X / Twitter'
    },
    tiktok: {
      match: () => location.hostname.includes('tiktok.com'),
      isHomePage: () => location.pathname === '/',
      isVideoPage: () => location.pathname.includes('/video/'),
      getVideoId: () => location.pathname.match(/video\/(\d+)/)?.[1],
      getVideoUrl: () => location.href,
      getVideoTitle: () => document.querySelector('[data-e2e="browse-video-desc"]')?.textContent?.trim(),
      getThumbnail: () => document.querySelector('video')?.poster || '',
      getFeedContainers: () => document.querySelectorAll('[data-e2e="recommend-list-item-container"]'),
      getVideoCardId: (el) => el.querySelector('a[href*="/video/"]')?.href?.match(/video\/(\d+)/)?.[1],
      injectRepostButton: injectGenericRepostButton,
      injectFeedSection: injectGenericFeedSection,
      name: 'TikTok'
    }
  };

  let platform = null;
  for (const [, p] of Object.entries(PLATFORMS)) {
    if (p.match()) { platform = p; break; }
  }
  if (!platform) return;

  // ── State ───────────────────────────────────────────────────────────────────
  let currentUser = null;
  let injectedFeed = false;
  let injectedRepostBtn = false;
  let processedCards = new Set();

  // ── Init ────────────────────────────────────────────────────────────────────
  async function init() {
    const res = await sendMessage({ type: 'GET_CURRENT_USER' });
    currentUser = res?.user || null;
    runPageLogic();
  }

  function runPageLogic() {
    if (platform.isHomePage && platform.isHomePage()) {
      tryInjectFeed();
      observeFeedCards();
    }
    if (platform.isVideoPage && platform.isVideoPage()) {
      tryInjectRepostButton();
    }
  }

  // ── Feed injection ──────────────────────────────────────────────────────────
  async function tryInjectFeed() {
    if (injectedFeed) return;
    if (!currentUser) return;
    injectedFeed = true;

    const res = await sendMessage({ type: 'GET_FEED' });
    const feed = res?.feed || [];

    if (res?.error) {
      console.error('[Repost] GET_FEED error:', res.error);
      return;
    }

    if (feed.length === 0) {
      return;
    }

    // Debug: log what containers exist on the page right now
    const selectors = [
      'ytd-rich-grid-renderer #contents',
      '#primary ytd-rich-grid-renderer',
      'ytd-browse #primary-inner ytd-rich-grid-renderer',
      '#contents.ytd-rich-grid-renderer',
      'ytd-rich-grid-renderer',
      '#primary',
      'ytd-browse',
    ];
    selectors.forEach(s => {
      const el = document.querySelector(s);
    });

    platform.injectFeedSection(feed);
  }

  // ── Video card floating icons ───────────────────────────────────────────────
  function observeFeedCards() {
    const observer = new MutationObserver(() => processVisibleCards());
    observer.observe(document.body, { childList: true, subtree: true });
    processVisibleCards();
  }

  async function processVisibleCards() {
    if (!currentUser) return;
    const containers = platform.getFeedContainers();
    for (const el of containers) {
      const videoId = platform.getVideoCardId(el);
      if (!videoId || processedCards.has(videoId)) continue;
      processedCards.add(videoId);
      const { reposters } = await sendMessage({ type: 'GET_VIDEO_REPOSTERS', videoId });
      if (reposters && reposters.length > 0) {
        attachReposterAvatars(el, reposters);
      }
    }
  }

  function attachReposterAvatars(cardEl, reposters) {
    if (cardEl.querySelector('.rp-avatar-stack')) return;
    const stack = document.createElement('div');
    stack.className = 'rp-avatar-stack';
    reposters.slice(0, 5).forEach((r, i) => {
      const av = document.createElement('div');
      av.className = 'rp-avatar';
      av.style.zIndex = 10 - i;
      av.style.marginLeft = i === 0 ? '0' : '-8px';
      av.title = `${r.displayName} reposted`;
      if (r.photoURL) {
        const img = document.createElement('img');
        img.src = r.photoURL;
        img.alt = r.displayName;
        av.appendChild(img);
      } else {
        av.textContent = r.displayName?.[0]?.toUpperCase() || '?';
      }
      stack.appendChild(av);
    });
    const label = document.createElement('span');
    label.className = 'rp-avatar-label';
    label.textContent = reposters.length === 1
      ? `${reposters[0].displayName} reposted`
      : `${reposters[0].displayName} +${reposters.length - 1} reposted`;
    stack.appendChild(label);
    cardEl.style.position = 'relative';
    cardEl.appendChild(stack);
  }

  // ── YouTube specific injections ─────────────────────────────────────────────
  async function injectYouTubeRepostButton() {
    if (injectedRepostBtn) return;

    // Try multiple selectors — YouTube changes these and they vary by language/layout
    const actionsBar = await waitFor([
      '#top-level-buttons-computed',
      'ytd-watch-metadata #top-level-buttons-computed',
      '#actions #top-level-buttons-computed',
      'ytd-segmented-like-dislike-button-renderer',
      '#menu-container #top-level-buttons-computed',
      'ytd-watch-flexy #top-level-buttons-computed',
    ].join(', '));

    if (!actionsBar) {
      return;
    }
    injectedRepostBtn = true;

    const videoId = platform.getVideoId();
    if (!videoId) return;

    const { reposted } = await sendMessage({ type: 'CHECK_MY_REPOST', videoId });

    const btn = createRepostButton(reposted);
    btn.addEventListener('click', () => handleRepost(btn));

    // Insert after the actions bar, or inside it
    const parent = actionsBar.parentElement || actionsBar;
    parent.insertBefore(btn, actionsBar.nextSibling);

    const { reposters } = await sendMessage({ type: 'GET_VIDEO_REPOSTERS', videoId });
    if (reposters && reposters.length > 0) {
      const titleEl = document.querySelector('h1.ytd-watch-metadata yt-formatted-string, #title h1, ytd-watch-metadata h1');
      if (titleEl) {
        const bar = createRepostersBar(reposters);
        titleEl.closest('h1')?.insertAdjacentElement('afterend', bar);
      }
    }
  }

  async function injectGenericRepostButton() {
    if (injectedRepostBtn) return;
    injectedRepostBtn = true;
    const videoId = platform.getVideoId();
    if (!videoId) return;
    const { reposted } = await sendMessage({ type: 'CHECK_MY_REPOST', videoId });
    const btn = createRepostButton(reposted);
    btn.style.position = 'fixed';
    btn.style.bottom = '80px';
    btn.style.right = '20px';
    btn.style.zIndex = '99999';
    btn.addEventListener('click', () => handleRepost(btn));
    document.body.appendChild(btn);
  }

  function createRepostButton(isReposted) {
    const btn = document.createElement('button');
    btn.className = `rp-repost-btn ${isReposted ? 'rp-reposted' : ''}`;
    btn.dataset.reposted = isReposted ? 'true' : 'false';
    btn.innerHTML = `
      <svg class="rp-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M17 1l4 4-4 4"/>
        <path d="M3 11V9a4 4 0 0 1 4-4h14"/>
        <path d="M7 23l-4-4 4-4"/>
        <path d="M21 13v2a4 4 0 0 1-4 4H3"/>
      </svg>
      <span>${isReposted ? 'Reposted' : 'Repost'}</span>
    `;
    return btn;
  }

  async function handleRepost(btn) {
    if (!currentUser) {
      showToast('Sign in to repost videos');
      return;
    }
    const videoId = platform.getVideoId();
    const isReposted = btn.dataset.reposted === 'true';

    if (isReposted) {
      await sendMessage({ type: 'UNDO_REPOST', videoId });
      btn.classList.remove('rp-reposted');
      btn.dataset.reposted = 'false';
      btn.querySelector('span').textContent = 'Repost';
      showToast('Repost removed');
    } else {
      const title = platform.getVideoTitle() || 'Untitled';
      const thumbnail = platform.getThumbnail ? platform.getThumbnail(videoId) : '';
      const url = platform.getVideoUrl();
      await sendMessage({ type: 'REPOST_VIDEO', videoId, url, title, thumbnail, platform: platform.name });
      btn.classList.add('rp-reposted');
      btn.dataset.reposted = 'true';
      btn.querySelector('span').textContent = 'Reposted';
      showToast('Reposted to your followers! 🔁');
    }
  }

  function createRepostersBar(reposters) {
    const bar = document.createElement('div');
    bar.className = 'rp-reposters-bar';
    const avatarsDiv = document.createElement('div');
    avatarsDiv.className = 'rp-reposters-avatars';
    reposters.slice(0, 7).forEach((r, i) => {
      const av = document.createElement('div');
      av.className = 'rp-avatar rp-avatar-sm';
      av.title = r.displayName;
      av.style.marginLeft = i === 0 ? '0' : '-6px';
      if (r.photoURL) {
        const img = document.createElement('img');
        img.src = r.photoURL;
        av.appendChild(img);
      } else {
        av.textContent = r.displayName?.[0] || '?';
      }
      avatarsDiv.appendChild(av);
    });
    const text = document.createElement('span');
    text.className = 'rp-reposters-text';
    const names = reposters.slice(0, 2).map(r => r.displayName).join(', ');
    text.textContent = reposters.length <= 2
      ? `${names} reposted this`
      : `${names} and ${reposters.length - 2} others reposted this`;
    bar.appendChild(avatarsDiv);
    bar.appendChild(text);
    return bar;
  }

  function injectYouTubeFeedSection(feed, attempt = 0) {
    if (document.querySelector('.rp-feed-section')) return;
    if (attempt > 15) { console.warn('[Repost] Could not find YouTube feed container'); return; }

    // Try multiple YouTube feed container selectors
    const contents = document.querySelector([
      'ytd-rich-grid-renderer #contents',
      '#primary ytd-rich-grid-renderer',
      'ytd-browse #primary-inner ytd-rich-grid-renderer',
      '#contents.ytd-rich-grid-renderer',
      'ytd-rich-grid-renderer',
    ].join(', '));

    if (!contents) {
      setTimeout(() => injectYouTubeFeedSection(feed, attempt + 1), 800);
      return;
    }

    if (document.querySelector('.rp-feed-section')) return;

    const section = document.createElement('div');
    section.className = 'rp-feed-section';
    section.innerHTML = `
      <div class="rp-feed-header">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
        <span>From People You Follow</span>
      </div>
      <div class="rp-feed-grid"></div>
    `;
    const grid = section.querySelector('.rp-feed-grid');
    feed.slice(0, 12).forEach(item => grid.appendChild(createFeedCard(item)));

    // Insert at top — before the first child of the grid renderer
    contents.insertBefore(section, contents.firstChild);
  }

  function injectGenericFeedSection(feed) {
    if (document.querySelector('.rp-feed-section')) return;
    const section = document.createElement('div');
    section.className = 'rp-feed-section rp-feed-section-generic';
    section.innerHTML = `
      <div class="rp-feed-header">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
        <span>Reposts from People You Follow</span>
      </div>
      <div class="rp-feed-grid"></div>
    `;
    const grid = section.querySelector('.rp-feed-grid');
    feed.slice(0, 8).forEach(item => grid.appendChild(createFeedCard(item)));
    document.body.insertBefore(section, document.body.firstChild);
  }

  function createFeedCard(item) {
    const card = document.createElement('a');
    card.className = 'rp-feed-card';
    card.href = item.url;
    card.innerHTML = `
      <div class="rp-feed-card-thumb">
        ${item.thumbnail ? `<img src="${item.thumbnail}" alt="" loading="lazy">` : '<div class="rp-thumb-placeholder"></div>'}
      </div>
      <div class="rp-feed-card-info">
        <p class="rp-feed-card-title">${item.title || 'Untitled'}</p>
        <div class="rp-feed-card-meta">
          <div class="rp-avatar rp-avatar-xs">
            ${item.reposterPhoto ? `<img src="${item.reposterPhoto}" alt="">` : (item.reposterName?.[0] || '?')}
          </div>
          <span>${item.reposterName || 'Someone'}</span>
          <span class="rp-dot">·</span>
          <span>${item.platform || ''}</span>
        </div>
      </div>
    `;
    return card;
  }

  function tryInjectRepostButton() {
    if (!currentUser) return;
    platform.injectRepostButton();
    // YouTube is a SPA and elements load late — retry a few times
    if (platform.name === 'YouTube') retryInjectRepostButton();
  }

  function sendMessage(msg) {
    return new Promise((res) => chrome.runtime.sendMessage(msg, (r) => res(r || {})));
  }

  function waitFor(selector, timeout = 10000) {
    return new Promise(resolve => {
      const el = document.querySelector(selector);
      if (el) { resolve(el); return; }
      const observer = new MutationObserver(() => {
        const found = document.querySelector(selector);
        if (found) { observer.disconnect(); resolve(found); }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => { observer.disconnect(); resolve(null); }, timeout);
    });
  }

  // Retry injection for YouTube SPA — sometimes elements load late
  async function retryInjectRepostButton(attempts = 5, delay = 1500) {
    for (let i = 0; i < attempts; i++) {
      if (injectedRepostBtn) return;
      await new Promise(r => setTimeout(r, delay));
      if (platform.isVideoPage && platform.isVideoPage()) {
        await platform.injectRepostButton();
      }
    }
  }

  function showToast(msg) {
    const existing = document.querySelector('.rp-toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.className = 'rp-toast';
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.classList.add('rp-toast-show'), 10);
    setTimeout(() => { toast.classList.remove('rp-toast-show'); setTimeout(() => toast.remove(), 300); }, 3000);
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'AUTH_STATE_CHANGED') {
      currentUser = msg.user;
      injectedFeed = false;
      injectedRepostBtn = false;
      processedCards.clear();
      runPageLogic();
    }
  });

  let lastPath = location.pathname;
  const navObserver = new MutationObserver(() => {
    if (location.pathname !== lastPath) {
      lastPath = location.pathname;
      injectedFeed = false;
      injectedRepostBtn = false;
      setTimeout(() => runPageLogic(), 800);
    }
  });
  navObserver.observe(document.body, { childList: true, subtree: true });

  init();
})();
