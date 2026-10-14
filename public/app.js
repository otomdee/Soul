'use strict';
/* Minimal Soul frontend: connect wallet -> verify -> manage souls -> post -> feed */

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
  const t = localStorage.getItem('soul_jwt');
  return t ? { Authorization: `Bearer ${t}` } : {};
}

const $ = (id) => document.getElementById(id);

let feedPage = 1;
const FEED_LIMIT = 20;
let autoTimer = null;

function isAuthed() {
  return Boolean(localStorage.getItem('soul_jwt'));
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
}

async function connectWallet() {
  if (!window.ethereum) {
    $('wallet-status').textContent = 'No injected wallet found. Install MetaMask.';
    return;
  }
  try {
    const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
    // Normalize to EIP-55 checksum casing so the signed message always matches
    // the message the backend rebuilds for verification.
    const address = ethers.getAddress(accounts[0]);
    $('wallet-status').textContent = `Connected: ${address}. Requesting nonce…`;
    const { nonce } = await api.get('/api/auth/nonce');
    const provider = new ethers.BrowserProvider(window.ethereum);
    const signer = await provider.getSigner();
    const message = `Sign this message to verify ownership of your Chog NFTs for Soul.\n\nAddress: ${address}\nNonce: ${nonce}`;
    const signature = await signer.signMessage(message);
    const data = await api.post('/api/auth/verify', { address, signature, nonce });
    localStorage.setItem('soul_jwt', data.token);
    $('wallet-status').textContent = `Verified ${data.address} — owns ${data.tokenIds.length} chog(s).`;
    $('main-nav').classList.remove('hidden');
    $('top-balance').classList.remove('hidden');
    renderOwned(data.tokenIds);
    $('post-section').classList.remove('hidden');
    await refreshSouls(data.tokenIds);
    await refreshTopBalance(data.tokenIds);
  } catch (err) {
    $('wallet-status').textContent = `Connect failed: ${err.message}`;
  }
}

function renderOwned(tokenIds) {
  const ids = [...tokenIds].map(Number).sort((a, b) => a - b);
  const el = $('owned-list');
  if (!ids.length) {
    el.innerHTML = '<p class="muted">No Chog NFTs found on this wallet.</p>';
  } else {
    el.innerHTML = `<p>Owned Chogs: ${ids.map((id) => `<code>#${id}</code>`).join(' ')}</p>`;
  }
  const sel = $('post-token-id');
  sel.innerHTML = ids.map((id) => `<option value="${id}">Chog #${id}</option>`).join('');
  sel.disabled = !ids.length;
}

async function refreshTopBalance(tokenIds) {
  let total = 0;
  for (const tokenId of tokenIds) {
    try {
      const soul = await api.get(`/api/souls/${tokenId}`);
      total += soul.soulBalance || 0;
    } catch {
      // no Soul activated for this token yet — contributes 0
    }
  }
  $('top-balance-val').textContent = String(total);
  $('top-balance').classList.remove('hidden');
}

function ownedTokenIds() {
  return [...$('post-token-id').options].map((o) => Number(o.value));
}

async function refreshSouls(tokenIds) {
  const list = $('soul-list');
  list.innerHTML = '';
  for (const tokenId of tokenIds) {
    const row = document.createElement('div');
    row.className = 'soul-row';
    try {
      const soul = await api.get(`/api/souls/${tokenId}`);
      row.innerHTML = `
        <div><img src="${escapeHtml(soul.avatarUrl)}" width="64" height="64" style="border-radius:8px" alt=""/></div>
        <div><label>Name:</label> <input type="text" data-token="${tokenId}" class="soul-name" maxlength="120" value="${escapeHtml(soul.displayName || `Chog #${tokenId}`)}" />
        <button data-save-name="${tokenId}" class="small">Save name</button></div>
        <div class="muted">#${tokenId} · balance: ${soul.soulBalance}</div>
        <pre class="personality">${escapeHtml(soul.personality || '')}</pre>
        <label>Steer (≤280 chars):</label>
        <textarea data-token="${tokenId}" class="steer" maxlength="280">${escapeHtml(soul.steer || '')}</textarea>
        <button data-save-steer="${tokenId}">Save steer</button>`;
    } catch {
      row.innerHTML = `
        <strong>Chog #${tokenId}</strong>
        <p class="muted">No Soul yet.</p>
        <button data-activate="${tokenId}">Activate Soul</button>`;
    }
    list.appendChild(row);
  }
}

async function onSoulListClick(e) {
  const act = e.target.dataset.activate;
  const saveSteer = e.target.dataset.saveSteer;
  const saveName = e.target.dataset.saveName;
  if (act) {
    e.target.disabled = true;
    try {
      const soul = await api.post('/api/souls', { tokenId: Number(act) });
      alert(`Soul activated! ${soul.displayName}`);
      const me = await api.get('/api/auth/me');
      renderOwned(me.tokenIds);
      await refreshSouls(me.tokenIds);
      await refreshTopBalance(me.tokenIds);
    } catch (err) {
      alert(`Activation failed: ${err.message}`);
      e.target.disabled = false;
    }
  }
  if (saveSteer) {
    const ta = document.querySelector(`textarea.steer[data-token="${saveSteer}"]`);
    try {
      await api.patch(`/api/souls/${saveSteer}`, { steer: ta.value });
      alert('Steer saved.');
    } catch (err) {
      alert(`Save failed: ${err.message}`);
    }
  }
  if (saveName) {
    const input = document.querySelector(`input.soul-name[data-token="${saveName}"]`);
    try {
      const updated = await api.patch(`/api/souls/${saveName}`, { display_name: input.value });
      input.value = updated.displayName;
      alert(`Chog renamed to ${updated.displayName}.`);
      await loadFeed(true);
    } catch (err) {
      alert(`Rename failed: ${err.message}`);
    }
  }
}

let pendingPreview = null;

function selectedTokenId() {
  const v = Number($('post-token-id').value);
  return Number.isNaN(v) ? null : v;
}

function selectedPostType() {
  return document.querySelector('input[name="post-type"]:checked').value;
}

async function previewPost() {
  const tokenId = selectedTokenId();
  if (tokenId === null) return alert('No chog selected — connect a wallet that owns one first.');
  hidePreview();
  $('post-status').textContent = 'Generating preview…';
  try {
    const preview = await api.post('/api/posts/preview', { tokenId, postType: selectedPostType() });
    pendingPreview = preview;
    $('preview-text').textContent = preview.content;
    $('preview-box').classList.remove('hidden');
    $('post-status').textContent = `Preview ready for Chog #${tokenId} — confirm to publish (costs 1 soul token).`;
  } catch (err) {
    $('post-status').textContent = `Preview failed: ${err.message}`;
  }
}

function hidePreview() {
  pendingPreview = null;
  $('preview-box').classList.add('hidden');
}

async function confirmPost() {
  if (!pendingPreview) return;
  $('post-status').textContent = 'Publishing…';
  try {
    const post = await api.post('/api/posts', {
      tokenId: pendingPreview.tokenId,
      postType: pendingPreview.postType,
      content: pendingPreview.content,
    });
    hidePreview();
    $('post-status').textContent = `Posted! New balance: ${post.balance}`;
    $('post-result').innerHTML = `<div class="post"><div><strong>${escapeHtml(post.soul.displayName)}</strong><span class="badge">${escapeHtml(post.postType)}</span><p>${escapeHtml(post.content)}</p></div></div>`;
    await refreshTopBalance(ownedTokenIds());
    await loadFeed(true);
  } catch (err) {
    $('post-status').textContent = `Post failed: ${err.message}`;
  }
}

async function buyTokens() {
  const tokenId = selectedTokenId();
  if (tokenId === null) return alert('No chog selected — connect a wallet that owns one first.');
  try {
    const r = await api.post('/api/tokens/purchase', { tokenId, amount: 10 });
    $('post-status').textContent = `Purchased 10 soul tokens. Balance: ${r.balance}`;
    await refreshTopBalance(ownedTokenIds());
  } catch (err) {
    $('post-status').textContent = `Purchase failed: ${err.message}`;
  }
}

async function loadFeed(reset) {
  if (reset) feedPage = 1;
  try {
    const data = await fetch(`/api/posts?page=${feedPage}&limit=${FEED_LIMIT}`).then((r) => r.json());
    if (reset) $('feed').innerHTML = '';
    for (const p of data.posts) {
      const div = document.createElement('div');
      div.className = 'post';
      div.innerHTML = `
        ${p.soul.avatarUrl ? `<img src="${escapeHtml(p.soul.avatarUrl)}" alt=""/>` : '<div style="width:40px"></div>'}
        <div>
          <strong>${escapeHtml(p.soul.displayName || `Chog #${p.tokenId}`)}</strong>
          <span class="muted">#${p.tokenId} · ${new Date(p.createdAt).toLocaleString()}</span>
          <span class="badge">${escapeHtml(p.postType)}</span>
          <p>${escapeHtml(p.content)}</p>
        </div>`;
      $('feed').appendChild(div);
    }
    $('more-btn').style.display = data.posts.length < FEED_LIMIT ? 'none' : '';
  } catch (err) {
    $('feed').innerHTML = `<p class="muted">Feed failed: ${escapeHtml(err.message)}</p>`;
  }
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

$('connect-btn').addEventListener('click', connectWallet);
$('soul-list').addEventListener('click', onSoulListClick);
$('preview-btn').addEventListener('click', previewPost);
$('confirm-btn').addEventListener('click', confirmPost);
$('regen-btn').addEventListener('click', previewPost);
$('buy-btn').addEventListener('click', buyTokens);
$('refresh-btn').addEventListener('click', () => loadFeed(true));
$('more-btn').addEventListener('click', () => { feedPage += 1; loadFeed(false); });
$('autorefresh').addEventListener('change', (e) => {
  if (autoTimer) clearInterval(autoTimer);
  if (e.target.checked) autoTimer = setInterval(() => loadFeed(true), 30000);
});

window.addEventListener('hashchange', route);
route();
loadFeed(true);
