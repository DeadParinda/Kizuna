import { state } from './state.js?v=11';
import { GIPHY_KEY, sb, BASE_TITLE, HISTORY_MAX, AVATAR_CATS } from './config.js?v=11';
import { avatarForUser, getAvatarUrl, setAvatarCache, getDisplayAvatar, canChangePfp, updateAllAvatarsForUser, avImg, esc, loadPfpCooldown } from './utils.js?v=11';
import { initiateConnection, broadcastExcept } from './webrtc.js?v=11';
import { debouncedSaveHistory, broadcastChat, sendMedia, saveHistoryToSupabase, renderMessage, toggleReact, openEdit, openDel, doReply } from './chat.js?v=11';
import { autoResize, scrollBot } from './main.js?v=11';

export function updateTitle() {
  if (state.isTabFocused) {
    document.title = BASE_TITLE;
    return;
  }
  if (state.unreadReplies > 0) document.title = `(${state.unreadReplies}) ${BASE_TITLE}`;
  else if (state.hasUnreadMessages) document.title = `● ${BASE_TITLE}`;
  else document.title = BASE_TITLE;
}
window.updateTitle = updateTitle;

export function notifyNewMessage(m) {
  // ignore own state.messages and when tab is focused
  if (!state.myId || m.senderId === state.myId || state.isTabFocused) return;

  // is it a reply to one of MY state.messages?
  if (m.replyTo) {
    const rt = typeof m.replyTo === 'object' ? m.replyTo : null;
    const parentId = rt?.id;
    if (parentId) {
      // check if the replied-to message is mine
      const parent = state.history.find(h => h.id === parentId);
      if (parent && parent.senderId === state.myId) {
        state.unreadReplies++;
        updateTitle();
        return;
      }
    }
  }

  state.hasUnreadMessages = true;
  updateTitle();
}
window.notifyNewMessage = notifyNewMessage;

export function initPasteHandler() {
  document.addEventListener('paste', e => {
    // Only when app is visible
    if (document.getElementById('loginScreen').classList.contains('hide') === false) return;
    const items = [...(e.clipboardData?.items || [])];
    const imgItem = items.find(it => it.type.startsWith('image/'));
    if (!imgItem) return;
    e.preventDefault();
    const file = imgItem.getAsFile();
    if (!file) return;
    state._pastedFile = file;
    const url = URL.createObjectURL(file);
    document.getElementById('pastePreviewImg').src = url;
    document.getElementById('pastePreview').classList.add('show');
    // highlight input
    document.getElementById('iwrap').classList.add('paste-highlight');
  });
}
window.initPasteHandler = initPasteHandler;

export function sendPastedImage() {
  if (!state._pastedFile) return;
  sendMedia(state._pastedFile);
  cancelPaste();
}
window.sendPastedImage = sendPastedImage;

export function cancelPaste() {
  state._pastedFile = null;
  const prev = document.getElementById('pastePreview');
  prev.classList.remove('show');
  const img = document.getElementById('pastePreviewImg');
  if (img.src.startsWith('blob:')) URL.revokeObjectURL(img.src);
  img.src = '';
  document.getElementById('iwrap').classList.remove('paste-highlight');
}
window.cancelPaste = cancelPaste;

export function initEmojiMart() {
  state.emojiPickerInst = new EmojiMart.Picker({
    native: true,
    onEmojiSelect: e => insertEmoji(e.native),
    theme: 'dark', previewPosition: 'none', skinTonePosition: 'none',
    navPosition: 'bottom', perLine: 8,
  });
  document.getElementById('emojiMartWrap').appendChild(state.emojiPickerInst);
}
window.initEmojiMart = initEmojiMart;

export function initTribute() {
  if (typeof Tribute === 'undefined' || typeof EmojiMart === 'undefined') return;
  const tribute = new Tribute({
    trigger: ':',
    requireLeadingSpace: true,
    lookup: 'id',
    fillAttr: 'native',
    values: async function (text, cb) {
      if (!text) return cb([]);
      try {
        const results = await EmojiMart.SearchIndex.search(text);
        if (results && results.length > 0) {
          cb(results.slice(0, 10)); // Limit to 10 for performance/UI
        } else {
          cb([]);
        }
      } catch (e) { cb([]); }
    },
    selectTemplate: function (item) {
      if (typeof item === 'undefined') return null;
      return item.original.skins ? item.original.skins[0].native : item.original.native;
    },
    menuItemTemplate: function (item) {
      const native = item.original.skins ? item.original.skins[0].native : item.original.native;
      return `<span style="font-size: 1.2rem; margin-right: 8px;">${native}</span><span>:${item.original.id}:</span>`;
    }
  });

  const msgInput = document.getElementById('msgInput');
  if (msgInput) {
    tribute.attach(msgInput);
    msgInput.addEventListener('tribute-replaced', function (e) {
      msgInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
}
window.initTribute = initTribute;

export function initReactPicker(onSelect) {
  const wrap = document.getElementById('reactPickerWrap');
  wrap.innerHTML = '';
  state.reactPickerInst = new EmojiMart.Picker({
    native: true,
    onEmojiSelect: e => { onSelect(e.native); closeReactPicker(); },
    theme: 'dark', previewPosition: 'none', skinTonePosition: 'none',
    navPosition: 'bottom', perLine: 8,
  });
  wrap.appendChild(state.reactPickerInst);
}
window.initReactPicker = initReactPicker;

export function insertEmoji(native) {
  const inp = document.getElementById('msgInput');
  const p = inp.selectionStart || inp.value.length;
  inp.value = inp.value.slice(0, p) + native + inp.value.slice(p);
  inp.selectionStart = inp.selectionEnd = p + [...native].length;
  inp.focus(); autoResize(inp);
}
window.insertEmoji = insertEmoji;

export function switchPickerTab(tab) {
  state.pickerTab = tab;
  document.getElementById('ptabEmoji').classList.toggle('act', tab === 'emoji');
  document.getElementById('ptabGif').classList.toggle('act', tab === 'gif');
  document.getElementById('tabEmoji').classList.toggle('show', tab === 'emoji');
  document.getElementById('tabGif').classList.toggle('show', tab === 'gif');
  if (tab === 'gif' && document.getElementById('gifGrid').children.length === 0) fetchGifs('anime');
}
window.switchPickerTab = switchPickerTab;

export function onGifSearch(q) {
  clearTimeout(state.gifSearchTimer);
  state.gifSearchTimer = setTimeout(() => fetchGifs(q || 'anime'), 450);
}
window.onGifSearch = onGifSearch;

export async function fetchGifs(q) {
  const grid = document.getElementById('gifGrid');
  grid.innerHTML = '<div class="gif-status"><i class="fas fa-spinner fa-spin me-1"></i>Loading…</div>';
  try {
    const url = `https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_KEY}&q=${encodeURIComponent(q)}&limit=12&rating=pg-13`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Giphy error');
    const { data: gifs } = await res.json();
    if (!gifs.length) { grid.innerHTML = '<div class="gif-status">No results</div>'; return; }
    grid.innerHTML = '';
    gifs.forEach(gif => {
      const thumb = gif.images.fixed_height_small.url;
      const orig = gif.images.original.url;
      const div = document.createElement('div');
      div.className = 'gif-item';
      div.innerHTML = `<img src="${thumb}" loading="lazy" alt="gif">`;
      div.onclick = () => { sendGifMsg(orig); closePicker(); };
      grid.appendChild(div);
    });
  } catch (e) {
    grid.innerHTML = `<div class="gif-status">Add your GIPHY API key to enable GIFs</div>`;
  }
}
window.fetchGifs = fetchGifs;

export function sendGifMsg(url) {
  const m = { id: crypto.randomUUID(), senderId: state.myId, senderName: state.myName, content: url, type: 'gif', ts: Date.now(), reactions: {}, replyTo: null, edited: false };
  state.history.push(m); if (state.history.length > HISTORY_MAX) state.history.shift();
  renderMessage(m, true); broadcastChat(m); debouncedSaveHistory();
}
window.sendGifMsg = sendGifMsg;

export function showReactPicker(e, msgId) {
  e.stopPropagation();
  state.reactTargetId = msgId;
  const wrap = document.getElementById('reactPickerWrap');
  initReactPicker(emoji => {
    toggleReact(state.reactTargetId, emoji);
    state.reactTargetId = null;
  });
  wrap.classList.add('show');
  const x = Math.min(e.clientX, window.innerWidth - 330);
  const y = Math.max(e.clientY - 380, 8);
  wrap.style.left = x + 'px';
  wrap.style.top = y + 'px';
}
window.showReactPicker = showReactPicker;

export function closeReactPicker() {
  document.getElementById('reactPickerWrap').classList.remove('show');
  state.reactTargetId = null;
}
window.closeReactPicker = closeReactPicker;

export function setSBStatus(type, txt) {
  document.getElementById('sbDot').className = 'sdot ' + (type === 'ok' ? 'ok' : type === 'warn' ? 'warn' : 'err');
  document.getElementById('sbTxt').textContent = txt;
}
window.setSBStatus = setSBStatus;

export function flashInput(id) { const el = document.getElementById(id); el.style.borderColor = '#ef4444'; el.focus(); setTimeout(() => el.style.borderColor = '', 2000); }
window.flashInput = flashInput;

export async function openProfileModal() {
  state._selPfpUrl = state.myAvatarUrl;
  state._profCatIdx = 0;
  document.getElementById('profileNameDisplay').textContent = state.myName;
  document.getElementById('profileAvImg').src = state.myAvatarUrl || getDisplayAvatar(state.myId);
  const { can, daysLeft } = await loadPfpCooldown();
  const badge = document.getElementById('profileCooldownBadge');
  badge.textContent = can ? '' : ` ⏳ ${daysLeft}d cooldown`;
  // Category bar
  const bar = document.getElementById('profileCatBar'); bar.innerHTML = '';
  AVATAR_CATS.forEach((cat, i) => {
    const btn = document.createElement('button');
    btn.style.cssText = 'padding:2px 8px;border-radius:20px;border:1px solid var(--border);background:var(--bg3);color:var(--t3);font-size:.62rem;font-weight:700;cursor:pointer;white-space:nowrap;font-family:Nunito,sans-serif;flex-shrink:0;transition:all .2s';
    btn.textContent = cat.label;
    btn.title = cat.name || cat.label;
    if (i === 0) { btn.style.borderColor = 'var(--orange)'; btn.style.color = 'var(--orange)'; btn.style.background = 'var(--os)'; }
    btn.onclick = () => {
      bar.querySelectorAll('button').forEach(b => { b.style.borderColor = 'var(--border)'; b.style.color = 'var(--t3)'; b.style.background = 'var(--bg3)'; });
      btn.style.borderColor = 'var(--orange)'; btn.style.color = 'var(--orange)'; btn.style.background = 'var(--os)';
      state._profCatIdx = i; renderProfileAvatarGrid(cat);
    };
    bar.appendChild(btn);
  });
  renderProfileAvatarGrid(AVATAR_CATS[0]);
  openModal('profileModal');
}
window.openProfileModal = openProfileModal;

export function renderProfileAvatarGrid(cat) {
  const { can } = canChangePfp();
  const grid = document.getElementById('profileAvatarGrid'); grid.innerHTML = '';
  for (let i = 1; i <= cat.count; i++) {
    const url = getAvatarUrl(cat.id, i, cat.ext);
    const div = document.createElement('div');
    div.style.cssText = `aspect-ratio:1;border-radius:50%;border:2px solid transparent;overflow:hidden;transition:all .2s;background:var(--bg4);${can ? 'cursor:pointer;' : 'cursor:not-allowed;opacity:.55;'}`;
    div.innerHTML = `<img src="${url}" style="width:100%;height:100%;object-fit:cover;display:block" loading="lazy" alt="">`;
    if (state._selPfpUrl === url) div.style.borderColor = 'var(--orange)';
    if (can) div.onclick = () => {
      grid.querySelectorAll('div').forEach(d => d.style.borderColor = 'transparent');
      div.style.borderColor = 'var(--orange)';
      state._selPfpUrl = url;
      document.getElementById('profileAvImg').src = url;
    };
    grid.appendChild(div);
  }
}
window.renderProfileAvatarGrid = renderProfileAvatarGrid;

export async function saveProfile() {
  const btn = document.getElementById('profileSaveBtn');
  btn.disabled = true;
  const { can, daysLeft } = await loadPfpCooldown();
  let avatarChanged = false;
  if (state._selPfpUrl && state._selPfpUrl !== state.myAvatarUrl) {
    showToast(`Avatar: wait ${daysLeft} more days`);
    avatarChanged = true;
  }
  if (!avatarChanged) { btn.disabled = false; closeModal('profileModal'); return; }
  const update = { id: state.myId };

  if (avatarChanged) {
    update.avatar_url = state._selPfpUrl;
    update.avatar_updated_at = new Date().toISOString();
  }

  const { error } = await sb
    .from('kizuna_profiles')
    .upsert(update, { onConflict: 'id' });

  if (error) { showToast('Save failed'); btn.disabled = false; return; }

  if (avatarChanged) {
    state.myAvatarUrl = state._selPfpUrl;
    state.myAvatarUpdatedAt = update.avatar_updated_at;
    setAvatarCache(state.myId, state.myAvatarUrl, state.myAvatarUpdatedAt);
    document.getElementById('myAvTb').innerHTML = avImg(state.myAvatarUrl);
    updateAllAvatarsForUser(state.myId, state.myAvatarUrl);
    broadcastExcept(null, {
      type: 'PROFILE_UPDATE',
      userId: state.myId,
      name: state.myName,
      avatarUrl: state.myAvatarUrl
    });
    if (state.presenceCh) await state.presenceCh.track({
      name: state.myName,
      room: state.myRoom,
      ts: Date.now(),
      avatarUrl: state.myAvatarUrl
    });
  }

  btn.disabled = false;
  closeModal('profileModal');
  showToast('Avatar saved!');
  renderSidebar();
}
window.saveProfile = saveProfile;

export function jumpTo(id) { const g = document.querySelector(`[data-msg-id="${id}"]`); if (!g) return; g.scrollIntoView({ behavior: 'smooth', block: 'center' }); g.style.transition = 'background .2s'; g.style.background = 'rgba(255,107,0,.08)'; setTimeout(() => g.style.background = '', 1300); }
window.jumpTo = jumpTo;

export function doCopy(id) { const m = state.history.find(h => h.id === id); if (!m || m.type !== 'text') return; navigator.clipboard.writeText(m.content).catch(() => { }); showToast('Copied!'); closeCtxMenu(); }
window.doCopy = doCopy;

export function openCtx(e, id, isSent) {
  e.preventDefault(); e.stopPropagation();
  state.ctxTarget = { id, isSent, x: e.clientX, y: e.clientY };
  document.body.classList.add('ctx-open');
  document.getElementById('ctxEdit').style.display = isSent ? 'flex' : 'none';
  document.getElementById('ctxDel').style.display = isSent ? 'flex' : 'none';
  const menu = document.getElementById('ctxMenuWrap'); menu.classList.add('show');
  const mw = 220, mh = 250;
  menu.style.left = Math.min(e.clientX, window.innerWidth - mw - 8) + 'px';
  menu.style.top = Math.min(e.clientY, window.innerHeight - mh - 8) + 'px';
}
window.openCtx = openCtx;

export function closeCtxMenu() { 
  document.getElementById('ctxMenuWrap').classList.remove('show'); 
  document.body.classList.remove('ctx-open');
  state.ctxTarget = null; 
}
window.closeCtxMenu = closeCtxMenu;

export function ctxReact(emoji) {
  if (!state.ctxTarget) return;
  const { id } = state.ctxTarget; closeCtxMenu();
  toggleReact(id, emoji);
}
window.ctxReact = ctxReact;

export function ctx(action) {
  if (!state.ctxTarget) return;
  const { id, x, y } = state.ctxTarget; 
  closeCtxMenu();
  setTimeout(() => {
    if (action === 'react') showReactPicker({ clientX: x, clientY: y, stopPropagation: () => { } }, id);
    else if (action === 'reply') doReply(id);
    else if (action === 'copy') doCopy(id);
    else if (action === 'edit') openEdit(id);
    else if (action === 'delete') openDel(id);
  }, 10);
}
window.ctx = ctx;

export function initBubbleTap() {
  const list = document.getElementById('msgList');
  list.addEventListener('contextmenu', e => {
    const bwrap = e.target.closest('.bwrap');
    if (!bwrap) return;
    e.preventDefault();
    const bub = bwrap.querySelector('.bubble');
    if (!bub) return;
    const id = bub.dataset.msgid; if (!id) return;
    const mg = bwrap.closest('.mg');
    openCtx(e, id, mg?.classList.contains('sent'));
  });
  list.addEventListener('click', e => {
    if (window.innerWidth > 640) return;
    const bub = e.target.closest('.bubble');
    if (!bub) return;
    const id = bub.dataset.msgid; if (!id) return;
    doReply(id);
  });
}
window.initBubbleTap = initBubbleTap;

export function openPeerModal() { state.peerTab = 'online'; switchPeerTab('online'); openModal('peerModal'); }
window.openPeerModal = openPeerModal;

export function switchPeerTab(tab) { state.peerTab = tab; document.querySelectorAll('.peer-tab').forEach(t => t.classList.remove('act')); document.getElementById('pt' + tab.charAt(0).toUpperCase() + tab.slice(1)).classList.add('act'); renderPeerList(); }
window.switchPeerTab = switchPeerTab;

export function renderPeerList() {
  const c = document.getElementById('peerListContent'); c.innerHTML = '';
  if (state.peerTab === 'online') {
    state.onlineUsers.forEach((u, uid) => {
      if (uid === state.myId) return;
      const connected = state.peers.has(uid) && state.peers.get(uid).status === 'connected';
      const div = document.createElement('div'); div.className = 'peer-list-item';
      div.innerHTML = `<div class="pl-av"><img src="${getDisplayAvatar(uid)}" style="width:100%;height:100%;object-fit:cover" alt=""></div><div class="pl-info"><div class="pl-name">${esc(u.name)} <span class="conn-badge ${connected ? 'connected' : 'pending'}">${connected ? 'Connected' : 'Not connected'}</span></div><div class="pl-status">In #${esc(u.room)}</div></div>${!connected ? `<button class="pl-action" onclick="initiateConnection('${uid}');renderPeerList()"><i class="fas fa-link me-1"></i>Connect</button>` : ''}`;
      c.appendChild(div);
    });
    if (!c.children.length) c.innerHTML = '<div style="text-align:center;color:var(--t3);font-size:.78rem;padding:.8rem">No other users online</div>';
  } else if (state.peerTab === 'connected') {
    state.peers.forEach((p, pid) => {
      const div = document.createElement('div'); div.className = 'peer-list-item';
      div.innerHTML = `<div class="pl-av"><img src="${getDisplayAvatar(pid)}" style="width:100%;height:100%;object-fit:cover" alt=""></div><div class="pl-info"><div class="pl-name">${esc(p.name)}${p.isSuper ? ' <span class="sb-badge">SUPER</span>' : ''}</div><div class="pl-status">${p.status}</div></div>`;
      c.appendChild(div);
    });
    if (!c.children.length) c.innerHTML = '<div style="text-align:center;color:var(--t3);font-size:.78rem;padding:.8rem">No P2P connections</div>';
  } else {
    const h = document.createElement('div'); h.style.cssText = 'font-size:.75rem;color:var(--t2);padding:.4rem'; h.textContent = `${state.history.length} state.messages in state.history`; c.appendChild(h);
    const b = document.createElement('button'); b.className = 'btn-sec'; b.style.marginTop = '.5rem';
    b.innerHTML = '<i class="fas fa-trash me-1"></i>Clear state.history'; b.onclick = () => { state.history = []; state.messages = []; document.getElementById('msgList').innerHTML = ''; saveHistoryToSupabase(); renderPeerList(); showToast('Cleared'); }; c.appendChild(b);
  }
}
window.renderPeerList = renderPeerList;

export function renderSidebar() {
  const list = document.getElementById('sbList'); list.innerHTML = '';
  const all = new Map();
  all.set(state.myId, { name: state.myName, status: 'online', isSuper: state.isSuperPeer });
  state.peers.forEach((p, pid) => {
    if (p.status === 'connected') all.set(pid, { name: p.name, status: 'connected', isSuper: p.isSuper });
  });
  state.onlineUsers.forEach((u, uid) => {
    if (!all.has(uid)) all.set(uid, { name: u.name, status: 'online', isSuper: false });
  });
  document.getElementById('sbCount').textContent = all.size + ' online';
  all.forEach((u, uid) => {
    const av = avatarForUser(uid)
    const div = document.createElement('div'); div.className = 'sb-user';
    const p2p = state.peers.has(uid) && state.peers.get(uid).status === 'connected';
    div.innerHTML = `<div class="sb-av-w"><div class="sb-av"><img src="${av}" style="width:100%;height:100%;object-fit:cover;border-radius:50%" alt="" onerror="this.style.display='none'"></div><div class="sb-dot"></div></div><div class="sb-info"><div class="sb-name">${esc(u.name)}${uid === state.myId ? ' <span class="sb-badge">you</span>' : ''}${u.isSuper ? ' <span class="sb-badge">SUPER</span>' : ''}</div><div class="sb-status">${uid === state.myId ? 'Online' : p2p ? 'P2P Connected' : 'Signaling'}</div></div>`;
    list.appendChild(div);
  });
}
window.renderSidebar = renderSidebar;

export function toggleSB() { state.sbOpen = !state.sbOpen; document.getElementById('sidebar').classList.toggle('closed', !state.sbOpen); document.getElementById('sbToggle').classList.toggle('act', state.sbOpen); }
window.toggleSB = toggleSB;

export function updateConnQuality() {
  const n = [...state.peers.values()].filter(p => p.status === 'connected').length;
  const icon = document.getElementById('connQualIcon'), btn = document.getElementById('connQualBtn');
  if (n === 0) { icon.className = 'fas fa-signal'; btn.style.color = 'var(--t3)'; }
  else if (n === 1) { icon.className = 'fas fa-signal'; btn.style.color = '#f59e0b'; }
  else if (n <= 2) { icon.className = 'fas fa-signal'; btn.style.color = '#22c55e'; }
  else { icon.className = 'fas fa-signal'; btn.style.color = '#00d4ff'; }
  //document.getElementById('connStatusNote').textContent=n?n+' peer'+(n>1?'s':'')+' connected':'No state.peers';
}
window.updateConnQuality = updateConnQuality;

export function updateCounts() {
  const connectedPeers = [...state.peers.values()].filter(p => p.status === 'connected');
  document.getElementById('peerCnt').textContent = connectedPeers.length;

  const uniqueUsers = new Set();
  uniqueUsers.add(state.myId);

  // Actually, let's just use the same logic as renderSidebar:
  state.peers.forEach((p, pid) => { if (p.status === 'connected') uniqueUsers.add(pid); });
  state.onlineUsers.forEach((u, uid) => uniqueUsers.add(uid));

  document.getElementById('onlineCnt').textContent = uniqueUsers.size;
}
window.updateCounts = updateCounts;

export function updateSBBar() { updateConnQuality(); updateCounts(); }
window.updateSBBar = updateSBBar;

export function sysMsg(text) { const d = document.createElement('div'); d.className = 'sys-msg'; d.innerHTML = `<span><i class="fas fa-circle-info" style="color:var(--orange);margin-right:4px;font-size:.55rem"></i>${esc(text)}</span>`; document.getElementById('msgList').appendChild(d); if (state.isAtBot) scrollBot(false); }
window.sysMsg = sysMsg;

export function togglePlus() { state.plusOpen = !state.plusOpen; document.getElementById('plusMenu').classList.toggle('show', state.plusOpen); document.getElementById('plusBtn').classList.toggle('act', state.plusOpen); if (state.plusOpen && state.pickerOpen) closePicker(); }
window.togglePlus = togglePlus;

export function closePlus() { state.plusOpen = false; document.getElementById('plusMenu').classList.remove('show'); document.getElementById('plusBtn').classList.remove('act'); }
window.closePlus = closePlus;

export function togglePicker() { state.pickerOpen ? closePicker() : openPicker(); }
window.togglePicker = togglePicker;

export function openPicker() { state.pickerOpen = true; closePlus(); document.getElementById('pickerPanel').classList.add('show'); document.getElementById('emojiBtn').classList.add('act'); }
window.openPicker = openPicker;

export function closePicker() { state.pickerOpen = false; document.getElementById('pickerPanel').classList.remove('show'); document.getElementById('emojiBtn').classList.remove('act'); }
window.closePicker = closePicker;

export function closeAll() { closePlus(); closePicker(); }
window.closeAll = closeAll;

export function openLB(src) { document.getElementById('lbImg').src = src; document.getElementById('lightbox').classList.add('show'); }
window.openLB = openLB;

export function closeLB() { document.getElementById('lightbox').classList.remove('show'); }
window.closeLB = closeLB;

export function openModal(id) { document.getElementById(id).classList.add('show'); }
window.openModal = openModal;

export function closeModal(id) { document.getElementById(id).classList.remove('show'); }
window.closeModal = closeModal;

export function showToast(msg) { const t = document.getElementById('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(state.toastT); state.toastT = setTimeout(() => t.classList.remove('show'), 2300); }
window.showToast = showToast;

