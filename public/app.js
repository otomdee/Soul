'use strict';
/* Soul frontend: connect wallet -> wake Souls -> preview -> feed or X */

const api = {
  async get(path) {
    const res = await fetch(path, { headers: authHeaders() });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
    return res.json();
  },
  async post(path, body) {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(body || {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || res.statusText);
    return data;
  },
  async patch(path, body) {
    const res = await fetch(path, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(body || {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || res.statusText);
    return data;
  },
};

function authHeaders() {
  const token = localStorage.getItem('soul_jwt');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

const $ = (id) => document.getElementById(id);
const FALLBACK_AVATAR = '/assets/chog-face.png';
const DEMO_AVATARS = [
  '/assets/demo/avatar-0.png',
  '/assets/demo/avatar-1.png',
  '/assets/demo/avatar-2.png',
  '/assets/demo/avatar-3.png',
];
const FEED_LIMIT = 20;

let feedPage = 1;
let autoTimer = null;
let pendingPreview = null;
let currentTokenIds = [];
let revealObserver = null;
let currentView = null;
let isClaiming = false;

function isAuthed() {
  return Boolean(localStorage.getItem('soul_jwt'));
}

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

function avatarFor(soul) {
  const url = soul && soul.avatarUrl ? String(soul.avatarUrl) : '';
  if (url && !/example\.com/i.test(url)) return url;
  const tokenId = Number(soul && soul.tokenId);
  if (Number.isInteger(tokenId) && tokenId >= 0) {
    return DEMO_AVATARS[tokenId % DEMO_AVATARS.length];
  }
  return FALLBACK_AVATAR;
}

function avatarTag(soul, className = 'post-avatar') {
  return `<img class="${className}" src="${escapeHtml(avatarFor(soul))}" alt="" onerror="this.onerror=null;this.src='${FALLBACK_AVATAR}'" />`;
}

function formatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function postTypeLabel(type) {
  return type === 'trade_idea' ? 'trade idea' : 'regular';
}

function route() {
  const wantProfile = window.location.hash === '#/profile';
  if (wantProfile && !isAuthed()) {
    window.location.hash = '#/';
    return;
  }
  $('view-home').classList.toggle('hidden', wantProfile);
  $('view-profile').classList.toggle('hidden', !wantProfile);
  $('nav-home').classList.toggle('active', !wantProfile);
  $('nav-profile').classList.toggle('active', wantProfile);
  const view = wantProfile ? 'profile' : 'home';
  if (currentView !== view) {
    currentView = view;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  if (wantProfile) {
    refreshSouls(currentTokenIds);
  }
}

function showAuthedUI() {
  $('main-nav').classList.remove('hidden');
  $('top-balance').classList.remove('hidden');
  $('post-section').classList.remove('hidden');
  $('feed-step').textContent = 'step 02';
  document.querySelectorAll('[data-connect]').forEach((button) => {
    button.textContent = 'Reconnect';
  });
  updateClaimButton();
}

function updateClaimButton() {
  const button = $('claim-btn');
  if (!button) return;
  button.classList.toggle('hidden', !isAuthed() || currentTokenIds.length > 0);
}

function setClaimBusy(busy) {
  isClaiming = busy;
  document.querySelectorAll('[data-claim]').forEach((button) => {
    button.disabled = busy;
    button.textContent = busy ? 'Minting your Chog…' : 'Get a free testnet Chog';
  });
}

async function claimChog() {
  if (isClaiming) return;
  if (!isAuthed()) {
    $('wallet-status').textContent = 'Connect your wallet first.';
    return;
  }
  setClaimBusy(true);
  $('wallet-status').textContent = 'Minting a free testnet Chog to your wallet…';
  try {
    const claim = await api.post('/api/chog/claim', {});
    $('wallet-status').textContent = `Chog #${claim.tokenId} minted to ${claim.address}.`;
    const me = await api.get('/api/auth/me');
    currentTokenIds = (me.tokenIds || []).map(Number).sort((a, b) => a - b);
    renderOwned(currentTokenIds);
    updateClaimButton();
    await refreshSouls(currentTokenIds);
    await refreshTopBalance(currentTokenIds);
    window.location.hash = '#/profile';
  } catch (err) {
    $('wallet-status').textContent = `Claim failed: ${err.message}`;
  } finally {
    setClaimBusy(false);
  }
}

function renderOwned(tokenIds) {
  const ids = [...tokenIds].map(Number).sort((a, b) => a - b);
  const list = $('owned-list');
  list.innerHTML = ids.length
    ? ids.map((id) => `<span class="owned-chip">Chog #${id}</span>`).join('')
    : '<p class="tiny-note">No Chog NFTs found on this wallet.</p>';

  const select = $('post-token-id');
  select.innerHTML = ids.map((id) => `<option value="${id}">Chog #${id}</option>`).join('');
  select.disabled = !ids.length;
}

async function refreshTopBalance(tokenIds) {
  let total = 0;
  for (const tokenId of tokenIds) {
    try {
      const soul = await api.get(`/api/souls/${tokenId}`);
      total += soul.soulBalance || 0;
    } catch {
      // No Soul activated for this token yet.
    }
  }
  $('top-balance-val').textContent = String(total);
  $('top-balance').classList.remove('hidden');
}

function ownedTokenIds() {
  return [...$('post-token-id').options].map((option) => Number(option.value));
}

async function connectWallet() {
  if (!window.ethereum) {
    $('wallet-status').textContent = 'No injected wallet found. Install MetaMask.';
    return;
  }
  try {
    const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
    const address = ethers.getAddress(accounts[0]);
    $('wallet-status').textContent = `Connected: ${address}. Requesting nonce…`;
    const { nonce } = await api.get('/api/auth/nonce');
    const provider = new ethers.BrowserProvider(window.ethereum);
    const signer = await provider.getSigner();
    const message = `Sign this message to verify ownership of your Chog NFTs for Soul.\n\nAddress: ${address}\nNonce: ${nonce}`;
    const signature = await signer.signMessage(message);
    const data = await api.post('/api/auth/verify', { address, signature, nonce });

    localStorage.setItem('soul_jwt', data.token);
    currentTokenIds = (data.tokenIds || []).map(Number).sort((a, b) => a - b);
    showAuthedUI();
    $('wallet-status').textContent = `Verified ${data.address} — owns ${currentTokenIds.length} chog(s).`;
    renderOwned(currentTokenIds);
    await refreshSouls(currentTokenIds);
    await refreshTopBalance(currentTokenIds);
  } catch (err) {
    $('wallet-status').textContent = `Connect failed: ${err.message}`;
  }
}

async function restoreSession() {
  if (!isAuthed()) return;
  try {
    const me = await api.get('/api/auth/me');
    currentTokenIds = (me.tokenIds || []).map(Number).sort((a, b) => a - b);
    showAuthedUI();
    $('wallet-status').textContent = `Verified ${me.address} — owns ${currentTokenIds.length} chog(s).`;
    renderOwned(currentTokenIds);
    await refreshSouls(currentTokenIds);
    await refreshTopBalance(currentTokenIds);
  } catch {
    localStorage.removeItem('soul_jwt');
  }
}

async function refreshSouls(tokenIds) {
  const list = $('soul-list');
  list.innerHTML = '';
  if (!tokenIds.length) {
    list.innerHTML = `
      <div class="soul-empty reveal is-visible">
        <img src="/assets/chog-read.png" alt="A Chog reading a book" />
        <p>No Chogs in this wallet yet. Claim a free testnet Chog to get started.</p>
        <button class="btn btn-primary" data-claim>Get a free testnet Chog</button>
      </div>`;
    return;
  }

  for (const tokenId of tokenIds) {
    const row = document.createElement('div');
    row.className = 'soul-row reveal';
    try {
      const soul = await api.get(`/api/souls/${tokenId}`);
      row.innerHTML = `
        ${avatarTag(soul, 'soul-avatar')}
        <div class="soul-main">
          <div class="soul-head">
            <strong>Chog #${tokenId}</strong>
            <span class="soul-balance">${soul.soulBalance} soul</span>
          </div>
          <label class="field-label" for="name-${tokenId}">Name</label>
          <div class="soul-actions">
            <input id="name-${tokenId}" class="soul-name-input" type="text" data-token="${tokenId}" maxlength="120" value="${escapeHtml(soul.displayName || `Chog #${tokenId}`)}" />
            <button data-save-name="${tokenId}" class="btn btn-small">Save name</button>
          </div>
          <span class="field-label personality-label">Personality</span>
          <pre class="personality">${escapeHtml(soul.personality || '')}</pre>
          <label class="field-label" for="steer-${tokenId}">Steer (≤280 chars)</label>
          <textarea id="steer-${tokenId}" data-token="${tokenId}" class="steer" maxlength="280">${escapeHtml(soul.steer || '')}</textarea>
          <button data-save-steer="${tokenId}" class="btn btn-small">Save steer</button>
        </div>`;
    } catch {
      row.innerHTML = `
        ${avatarTag(null, 'soul-avatar')}
        <div class="soul-main">
          <div class="soul-head"><strong>Chog #${tokenId}</strong></div>
          <p class="tiny-note">No Soul yet. Wake it up and let the chaos begin.</p>
          <button data-activate="${tokenId}" class="btn btn-primary btn-small">Activate Soul</button>
        </div>`;
    }
    list.appendChild(row);
    observeReveals(row);
  }
}

async function onSoulListClick(event) {
  const button = event.target.closest('button');
  if (!button) return;

  if (button.dataset.activate) {
    button.disabled = true;
    try {
      const soul = await api.post('/api/souls', { tokenId: Number(button.dataset.activate) });
      alert(`Soul activated! ${soul.displayName}`);
      const me = await api.get('/api/auth/me');
      currentTokenIds = (me.tokenIds || []).map(Number).sort((a, b) => a - b);
      renderOwned(currentTokenIds);
      await refreshSouls(currentTokenIds);
      await refreshTopBalance(currentTokenIds);
    } catch (err) {
      alert(`Activation failed: ${err.message}`);
      button.disabled = false;
    }
  }

  if (button.dataset.saveSteer) {
    const tokenId = button.dataset.saveSteer;
    const textarea = document.querySelector(`textarea.steer[data-token="${tokenId}"]`);
    try {
      await api.patch(`/api/souls/${tokenId}`, { steer: textarea.value });
      alert('Steer saved.');
    } catch (err) {
      alert(`Save failed: ${err.message}`);
    }
  }

  if (button.dataset.saveName) {
    const tokenId = button.dataset.saveName;
    const input = document.querySelector(`input.soul-name-input[data-token="${tokenId}"]`);
    try {
      const updated = await api.patch(`/api/souls/${tokenId}`, { display_name: input.value });
      input.value = updated.displayName;
      alert(`Chog renamed to ${updated.displayName}.`);
      await loadFeed(true);
    } catch (err) {
      alert(`Rename failed: ${err.message}`);
    }
  }
}

function selectedTokenId() {
  const value = $('post-token-id').value;
  if (!value) return null;
  const tokenId = Number(value);
  return Number.isNaN(tokenId) ? null : tokenId;
}

function selectedPostType() {
  return document.querySelector('input[name="post-type"]:checked').value;
}

function selectedDestination() {
  return document.querySelector('input[name="destination"]:checked').value;
}

function destinationStatus(destination, tokenId) {
  return destination === 'x'
    ? `Preview ready for Chog #${tokenId} — posting to X costs 1 soul token.`
    : `Preview ready for Chog #${tokenId} — confirm to publish (costs 1 soul token).`;
}

async function previewPost() {
  const tokenId = selectedTokenId();
  if (tokenId === null) return alert('No chog selected — connect a wallet that owns one first.');
  hidePreview();
  const destination = selectedDestination();
  $('post-status').textContent = 'Generating preview…';
  try {
    const preview = await api.post('/api/posts/preview', {
      tokenId,
      postType: selectedPostType(),
      destination,
    });
    pendingPreview = { ...preview, destination };
    $('preview-text').textContent = preview.content;
    $('preview-box').classList.remove('hidden');
    $('confirm-btn').textContent = destination === 'x' ? 'Post to X' : 'Confirm & Publish';
    $('post-status').textContent = destinationStatus(destination, tokenId);
  } catch (err) {
    $('post-status').textContent = `Preview failed: ${err.message}`;
  }
}

function hidePreview() {
  pendingPreview = null;
  $('preview-box').classList.add('hidden');
  $('confirm-btn').textContent = 'Confirm & Publish';
}

function renderPublishedPost(post, badgeLabel) {
  const badge = badgeLabel || postTypeLabel(post.postType);
  $('post-result').innerHTML = `
    <div class="post">
      ${avatarTag(post.soul, 'post-avatar')}
      <div class="post-body">
        <div class="post-meta">
          <span class="post-name">Chog #${post.tokenId}</span>
          <span class="badge">${escapeHtml(badge)}</span>
        </div>
        <p class="post-content">${escapeHtml(post.content)}</p>
      </div>
    </div>`;
}

async function confirmPost() {
  if (!pendingPreview) return;
  const destination = pendingPreview.destination || 'feed';
  let xWindow = null;
  if (destination === 'x') {
    xWindow = window.open('', '_blank');
  }
  $('post-status').textContent = destination === 'x' ? 'Preparing your X post…' : 'Publishing…';
  try {
    const post = await api.post('/api/posts', {
      tokenId: pendingPreview.tokenId,
      postType: pendingPreview.postType,
      content: pendingPreview.content,
      destination,
    });
    hidePreview();

    if (destination === 'x') {
      if (xWindow) {
        xWindow.location.href = post.xIntentUrl;
      } else {
        window.open(post.xIntentUrl, '_blank', 'noopener');
      }
      $('post-status').textContent = `Opened X with your post pre-filled — click Post on X. New balance: ${post.balance}`;
      renderPublishedPost(post, 'X');
      $('post-result').innerHTML += `<p class="tiny-note"><a href="${escapeHtml(post.xIntentUrl)}" target="_blank" rel="noopener">Open X compose again ↗</a></p>`;
      await refreshTopBalance(ownedTokenIds());
      return;
    }

    $('post-status').textContent = `Posted! New balance: ${post.balance}`;
    renderPublishedPost(post);
    await refreshTopBalance(ownedTokenIds());
    await loadFeed(true);
  } catch (err) {
    if (xWindow) xWindow.close();
    $('post-status').textContent = `Post failed: ${err.message}`;
  }
}

async function buyTokens() {
  const tokenId = selectedTokenId();
  if (tokenId === null) return alert('No chog selected — connect a wallet that owns one first.');
  try {
    const result = await api.post('/api/tokens/purchase', { tokenId, amount: 10 });
    $('post-status').textContent = `Purchased 10 soul tokens. Balance: ${result.balance}`;
    await refreshTopBalance(ownedTokenIds());
  } catch (err) {
    $('post-status').textContent = `Purchase failed: ${err.message}`;
  }
}

async function loadFeed(reset) {
  if (reset) feedPage = 1;
  try {
    const response = await fetch(`/api/posts?page=${feedPage}&limit=${FEED_LIMIT}`);
    if (!response.ok) throw new Error(response.statusText);
    const data = await response.json();

    if (reset) $('feed').innerHTML = '';

    if (reset && data.posts.length === 0) {
      $('feed').innerHTML = `
        <div class="post-empty reveal is-visible">
          <img src="/assets/chog-read.png" alt="A Chog reading a book" />
          <p>No posts yet. Connect a wallet and wake a Soul.</p>
        </div>`;
      $('more-btn').style.display = 'none';
      return;
    }

    for (const post of data.posts) {
      const card = document.createElement('div');
      card.className = 'post reveal';
      card.innerHTML = `
        ${avatarTag(post.soul, 'post-avatar')}
        <div class="post-body">
          <div class="post-meta">
            <span class="post-name">Chog #${post.tokenId}</span>
            <span class="post-time">${escapeHtml(formatTime(post.createdAt))}</span>
            <span class="badge ${post.postType === 'trade_idea' ? 'trade_idea' : ''}">${escapeHtml(postTypeLabel(post.postType))}</span>
          </div>
          <p class="post-content">${escapeHtml(post.content)}</p>
        </div>`;
      $('feed').appendChild(card);
      observeReveals(card);
    }
    $('more-btn').style.display = data.posts.length < FEED_LIMIT ? 'none' : '';
  } catch (err) {
    $('feed').innerHTML = `<p class="tiny-note">Feed failed: ${escapeHtml(err.message)}</p>`;
  }
}

function initReveal() {
  if (!('IntersectionObserver' in window) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    document.querySelectorAll('.reveal').forEach((element) => element.classList.add('is-visible'));
    return;
  }
  revealObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('is-visible');
      revealObserver.unobserve(entry.target);
    }
  }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
  observeReveals();
}

function observeReveals(scope = document) {
  const targets = [];
  if (scope.matches && scope.matches('.reveal:not(.is-visible)')) targets.push(scope);
  if (scope.querySelectorAll) targets.push(...scope.querySelectorAll('.reveal:not(.is-visible)'));
  targets.forEach((element) => {
    if (revealObserver) revealObserver.observe(element);
    else element.classList.add('is-visible');
  });
}

function initParallax() {
  const items = [...document.querySelectorAll('[data-parallax]')];
  if (!items.length || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  let ticking = false;
  const update = () => {
    const scrollY = window.scrollY;
    for (const element of items) {
      const speed = Number(element.dataset.parallax) || 0;
      element.style.setProperty('--parallax-y', `${scrollY * speed}px`);
    }
    ticking = false;
  };
  window.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(update);
  }, { passive: true });
  update();
}

function initHeroTilt() {
  const hero = $('hero');
  const inner = document.querySelector('.hero-art-inner');
  if (!hero || !inner || window.matchMedia('(hover: none)').matches || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  hero.addEventListener('mousemove', (event) => {
    const rect = hero.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width - 0.5;
    const y = (event.clientY - rect.top) / rect.height - 0.5;
    inner.style.setProperty('--tilt-x', `${(-y * 7).toFixed(2)}deg`);
    inner.style.setProperty('--tilt-y', `${(x * 10).toFixed(2)}deg`);
  });
  hero.addEventListener('mouseleave', () => {
    inner.style.setProperty('--tilt-x', '0deg');
    inner.style.setProperty('--tilt-y', '0deg');
  });
}

function initCursorGlow() {
  const glow = $('cursor-glow');
  if (!glow || window.matchMedia('(hover: none)').matches) return;
  let frame = null;
  window.addEventListener('mousemove', (event) => {
    if (frame) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      glow.style.left = `${event.clientX}px`;
      glow.style.top = `${event.clientY}px`;
    });
  }, { passive: true });
}

function initHeaderScroll() {
  const header = $('site-header');
  const update = () => header.classList.toggle('scrolled', window.scrollY > 24);
  window.addEventListener('scroll', update, { passive: true });
  update();
}

document.querySelectorAll('[data-connect]').forEach((button) => {
  button.addEventListener('click', connectWallet);
});
document.addEventListener('click', (event) => {
  const claim = event.target.closest('[data-claim]');
  if (!claim) return;
  event.preventDefault();
  claimChog();
});
$('soul-list').addEventListener('click', onSoulListClick);
$('preview-btn').addEventListener('click', previewPost);
$('confirm-btn').addEventListener('click', confirmPost);
$('regen-btn').addEventListener('click', previewPost);
$('buy-btn').addEventListener('click', buyTokens);
$('refresh-btn').addEventListener('click', () => loadFeed(true));
$('more-btn').addEventListener('click', () => {
  feedPage += 1;
  loadFeed(false);
});
$('autorefresh').addEventListener('change', (event) => {
  if (autoTimer) clearInterval(autoTimer);
  if (event.target.checked) autoTimer = setInterval(() => loadFeed(true), 30000);
});
document.querySelectorAll('input[name="destination"]').forEach((input) => {
  input.addEventListener('change', () => {
    if (!pendingPreview) return;
    pendingPreview.destination = selectedDestination();
    $('confirm-btn').textContent = pendingPreview.destination === 'x' ? 'Post to X' : 'Confirm & Publish';
    $('post-status').textContent = destinationStatus(pendingPreview.destination, pendingPreview.tokenId);
  });
});

window.addEventListener('hashchange', route);

initReveal();
initParallax();
initHeroTilt();
initCursorGlow();
initHeaderScroll();
route();
loadFeed(true);
restoreSession();
