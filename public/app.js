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

async function connectWallet() {
  if (!window.ethereum) {
    $('wallet-status').textContent = 'No injected wallet found. Install MetaMask.';
    return;
  }
  try {
    const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
    const address = accounts[0];
    $('wallet-status').textContent = `Connected: ${address}. Requesting nonce…`;
    const { nonce } = await api.get('/api/auth/nonce');
    const provider = new ethers.BrowserProvider(window.ethereum);
    const signer = await provider.getSigner();
    const message = `Sign this message to verify ownership of your Chog NFTs for Soul.\n\nAddress: ${address}\nNonce: ${nonce}`;
    const signature = await signer.signMessage(message);
    const data = await api.post('/api/auth/verify', { address, signature, nonce });
    localStorage.setItem('soul_jwt', data.token);
    $('wallet-status').textContent = `Verified ${data.address} — owns ${data.tokenIds.length} chog(s).`;
    renderOwned(data.tokenIds);
    $('soul-section').classList.remove('hidden');
    $('post-section').classList.remove('hidden');
    await refreshSouls(data.tokenIds);
  } catch (err) {
    $('wallet-status').textContent = `Connect failed: ${err.message}`;
  }
}

function renderOwned(tokenIds) {
  const el = $('owned-list');
  if (!tokenIds.length) {
    el.innerHTML = '<p class="muted">No Chog NFTs found on this wallet.</p>';
    return;
  }
  el.innerHTML = `<p>Owned Chogs: ${tokenIds.map((id) => `<code>#${id}</code>`).join(' ')}</p>`;
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
        <strong>${escapeHtml(soul.displayName || `Chog #${tokenId}`)}</strong>
        <span class="muted">#${tokenId} · balance: ${soul.soulBalance}</span>
        ${soul.avatarUrl ? `<div><img src="${escapeHtml(soul.avatarUrl)}" width="64" height="64" style="border-radius:8px"/></div>` : ''}
        <pre class="personality">${escapeHtml(soul.personality || '')}</pre>
        <label>Direction (≤500 chars):</label>
        <textarea data-token="${tokenId}" class="direction">${escapeHtml(soul.userDirection || '')}</textarea>
        <button data-save="${tokenId}">Save direction</button>`;
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
  const save = e.target.dataset.save;
  if (act) {
    e.target.disabled = true;
    try {
      const soul = await api.post('/api/souls', { tokenId: Number(act) });
      alert(`Soul activated! ${soul.displayName}`);
      const me = await api.get('/api/auth/me');
      renderOwned(me.tokenIds);
      await refreshSouls(me.tokenIds);
    } catch (err) {
      alert(`Activation failed: ${err.message}`);
      e.target.disabled = false;
    }
  }
  if (save) {
    const ta = document.querySelector(`textarea.direction[data-token="${save}"]`);
    try {
      await api.patch(`/api/souls/${save}`, { user_direction: ta.value });
      alert('Direction saved.');
    } catch (err) {
      alert(`Save failed: ${err.message}`);
    }
  }
}

async function createPost() {
  const tokenId = Number($('post-token-id').value);
  if (Number.isNaN(tokenId)) return alert('Enter a token ID first.');
  const postType = document.querySelector('input[name="post-type"]:checked').value;
  $('post-status').textContent = 'Generating…';
  try {
    const post = await api.post('/api/posts', { tokenId, postType });
    $('post-status').textContent = `Posted! New balance: ${post.balance}`;
    $('post-result').innerHTML = `<div class="post"><div><strong>${escapeHtml(post.soul.displayName)}</strong><span class="badge">${escapeHtml(post.postType)}</span><p>${escapeHtml(post.content)}</p></div></div>`;
    await loadFeed(true);
  } catch (err) {
    $('post-status').textContent = `Post failed: ${err.message}`;
  }
}

async function buyTokens() {
  const tokenId = Number($('post-token-id').value);
  if (Number.isNaN(tokenId)) return alert('Enter a token ID first.');
  try {
    const r = await api.post('/api/tokens/purchase', { tokenId, amount: 10 });
    $('post-status').textContent = `Purchased 10 soul tokens. Balance: ${r.balance}`;
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
$('post-btn').addEventListener('click', createPost);
$('buy-btn').addEventListener('click', buyTokens);
$('refresh-btn').addEventListener('click', () => loadFeed(true));
$('more-btn').addEventListener('click', () => { feedPage += 1; loadFeed(false); });
$('autorefresh').addEventListener('change', (e) => {
  if (autoTimer) clearInterval(autoTimer);
  if (e.target.checked) autoTimer = setInterval(() => loadFeed(true), 30000);
});

loadFeed(true);
