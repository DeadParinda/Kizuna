import { state } from './state.js?v=11';
import { sb, HISTORY_MAX, TYPING_DEBOUNCE, CHUNK_SIZE, LS_MESSAGES, LS_MEDIA, SB_TABLE_HIST } from './config.js?v=11';
import { avatarForUser, getDisplayAvatar, avImg, timeAgo, fmtFull, esc, arrayBufToB64, b64toBlob, parseMarkdown } from './utils.js?v=11';
import { dcSend, broadcastExcept } from './webrtc.js?v=11';
import { showReactPicker, openLB, openModal, closeModal, showToast, closeAll, closeCtxMenu, jumpTo, doCopy } from './ui.js?v=11';
import { autoResize, scrollBot, updateScrollBtn, fetchAndCacheProfiles } from './main.js?v=11';

export async function sendMsg() {
  const inp = document.getElementById('msgInput');
  const text = inp.value.trim(); if (!text) return;
  const rd = state.replyToMsg ? { ...state.replyToMsg } : null;
  clearReply(); inp.value = ''; autoResize(inp); closeAll();
  const m = { id: crypto.randomUUID(), senderId: state.myId, senderName: state.myName, content: text, type: 'text', ts: Date.now(), reactions: {}, replyTo: rd, edited: false };
  state.history.push(m); if (state.history.length > HISTORY_MAX) state.history.shift();
  renderMessage(m, true);
  if (!broadcastChat(m)) setPending(m.id, true);
  debouncedSaveHistory();
}
window.sendMsg = sendMsg;

export function debouncedSaveHistory() {
  clearTimeout(state.saveHistoryTimer);
  state.saveHistoryTimer = setTimeout(() => {
    saveLocalMessages();
    if (state.peers.size === 0) saveHistoryToSupabase();
  }, 3000);
}
window.debouncedSaveHistory = debouncedSaveHistory;

export function broadcastChat(m) {
  if (!state.peers.size) return false;
  let sent = false;
  state.peers.forEach((_, pid) => { if (dcSend(pid, { type: 'CHAT', message: m })) sent = true; });
  return sent;
}
window.broadcastChat = broadcastChat;

export async function sendMedia(file) {
  const id = crypto.randomUUID();
  const buf = await file.arrayBuffer();
  const b64 = arrayBufToB64(buf);
  const chunks = [];
  for (let i = 0; i < b64.length; i += CHUNK_SIZE)chunks.push(b64.slice(i, i + CHUNK_SIZE));
  try { localStorage.setItem(LS_MEDIA + id, JSON.stringify({ b64, mime: file.type })); } catch (_) { }
  const url = URL.createObjectURL(new Blob([buf], { type: file.type }));
  const ts = Date.now();
  const m = { id, senderId: state.myId, senderName: state.myName, content: '', type: 'image', ts, reactions: {}, replyTo: null, edited: false, mediaUrl: url, mediaRef: id };
  state.history.push(m); if (state.history.length > HISTORY_MAX) state.history.shift();
  renderMessage(m, true); debouncedSaveHistory();
  setTimeout(() => updateMsgMedia(id, url), 100);
  state.peers.forEach((_, pid) => {
    dcSend(pid, { type: 'MEDIA_META', id, mimeType: file.type, totalChunks: chunks.length, senderId: state.myId, senderName: state.myName, ts });
    chunks.forEach((c, idx) => dcSend(pid, { type: 'MEDIA_CHUNK', id, index: idx, data: c }));
  });
}
window.sendMedia = sendMedia;

export function saveLocalMessages() {
  try { localStorage.setItem(LS_MESSAGES + '_' + state.myRoom, JSON.stringify(state.history.slice(-100))); } catch (_) { }
}
window.saveLocalMessages = saveLocalMessages;

export function loadLocalMessages() {
  try {
    const saved = JSON.parse(localStorage.getItem(LS_MESSAGES + '_' + state.myRoom) || '[]');
    if (!saved.length) return;
    saved.forEach(m => {
      if (m.mediaRef) { try { const s = localStorage.getItem(LS_MEDIA + m.mediaRef); if (s) { const { b64, mime } = JSON.parse(s); m.mediaUrl = URL.createObjectURL(b64toBlob(b64, mime)); } } catch (_) { } }
      if (!state.history.find(h => h.id === m.id)) state.history.push(m);
    });
    const senderIds = [...new Set(state.history.map(m => m.senderId).filter(id => id && id !== state.myId))];
    fetchAndCacheProfiles(senderIds);
    state.history.sort((a, b) => a.ts - b.ts);
    const ds = mkDs('fa-box-archive', 'Local state.history');
    document.getElementById('msgList').appendChild(ds);
    state.history.forEach(m => renderMessage(m, m.senderId === state.myId, false));
    scrollBot(false);
  } catch (_) { }
}
window.loadLocalMessages = loadLocalMessages;

export async function saveHistoryToSupabase() {
  if (!state.myRoom || !state.myId) return;
  const toSave = state.history.filter(h => h.type !== 'image' || !h.mediaUrl);
  // images with blob urls cant be saved, strip mediaUrl
  const clean = state.history.map(h => ({ ...h, mediaUrl: undefined }));
  if (!clean.length) return;

  const { error } = await sb.from(SB_TABLE_HIST).upsert({
    room: state.myRoom,
    data: JSON.stringify(clean),
    updated_at: new Date().toISOString()
  }, { onConflict: 'room' });

  if (error) console.error('saveHistoryToSupabase failed:', error);
  else console.log('state.history saved', clean.length, 'msgs');
}
window.saveHistoryToSupabase = saveHistoryToSupabase;

export async function loadHistoryFromSupabase() {
  try {
    const { data, error } = await sb.from(SB_TABLE_HIST).select('data').eq('room', state.myRoom).single();
    if (error || !data) return;
    mergeHistory(JSON.parse(data.data || '[]'));
    if (state.history.length) document.getElementById('msgList').appendChild(mkDs('fa-clock-rotate-left', 'Previous state.messages'));
  } catch (_) { }
}
window.loadHistoryFromSupabase = loadHistoryFromSupabase;

export function mergeHistory(incoming) {
  incoming.forEach(m => {
    if (!state.history.find(h => h.id === m.id)) {
      if (m.mediaRef) { try { const s = localStorage.getItem(LS_MEDIA + m.mediaRef); if (s) { const { b64, mime } = JSON.parse(s); m.mediaUrl = URL.createObjectURL(b64toBlob(b64, mime)); } } catch (_) { } }
      state.history.push(m);
    }
  });
  // Fetch avatars for all senders in state.history
  const senderIds = [...new Set(state.history.map(m => m.senderId).filter(id => id && id !== state.myId))];
  fetchAndCacheProfiles(senderIds);
  state.history.sort((a, b) => a.ts - b.ts);
  if (state.history.length > HISTORY_MAX) state.history.splice(0, state.history.length - HISTORY_MAX);
  document.getElementById('msgList').innerHTML = ''; state.messages = [];
  state.history.forEach(m => renderMessage(m, m.senderId === state.myId));
}
window.mergeHistory = mergeHistory;

export function mkDs(icon, label) {
  const d = document.createElement('div'); d.className = 'ds';
  d.innerHTML = `<div class="ds-l"></div><div class="ds-t"><i class="fas ${icon}" style="color:var(--orange);margin-right:4px;font-size:.5rem"></i>${label}</div><div class="ds-l"></div>`;
  return d;
}
window.mkDs = mkDs;

export function renderMessage(m, isSent, animate = true) {
  const list = document.getElementById('msgList');
  if (document.querySelector(`[data-msg-id="${m.id}"]`)) { updateMsgEl(m); return; }
  
  const dateObj = new Date(m.ts);
  let showHeader = false;
  if (state.messages.length === 0) {
    showHeader = true;
  } else {
    const lastDate = new Date(state.messages[state.messages.length - 1].ts);
    if (lastDate.toDateString() !== dateObj.toDateString()) showHeader = true;
  }

  if (showHeader) {
    const dateStr = dateObj.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const isToday = dateObj.toDateString() === new Date().toDateString();
    const finalDateStr = isToday ? `Today, ${dateStr}` : dateStr;
    const hd = document.createElement('div');
    hd.className = 'date-header';
    hd.innerHTML = `<span>${finalDateStr}</span>`;
    list.appendChild(hd);
  }

  // Check if grouped
  let isGrouped = false;
  if (state.messages.length > 0 && !showHeader) {
    const prev = state.messages[state.messages.length - 1];
    if (prev.senderId === m.senderId && prev.type !== 'system') {
      isGrouped = true;
    }
  }

  state.messages.push(m);
  const g = document.createElement('div');
  g.dataset.msgId = m.id; g.dataset.senderId = m.senderId;
  g.className = `mg ${isSent ? 'sent' : 'recv'}${animate ? ' msg-anim' : ''}${isGrouped ? ' grouped' : ''}`;
  g.innerHTML = buildMsgHTML(m, isSent, isGrouped);
  list.appendChild(g);
  if (!state.isAtBot && !isSent) { state.unread++; updateScrollBtn(); }
  if (state.isAtBot || isSent) scrollBot(animate);
}
window.renderMessage = renderMessage;

export function buildMsgHTML(m, isSent, isGrouped = false) {
  const { id, senderName, content, type, ts, reactions, replyTo, edited, pending, failed, mediaUrl } = m;
  const avUrl = getDisplayAvatar(m.senderId);
  const avHTML = `<div class="mav" ${isGrouped ? 'style="visibility:hidden"' : ''}><img src="${esc(avUrl)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%" alt="" onerror="this.style.display='none'"></div>`;
  let replyHTML = '';
  if (replyTo) {
    const rt = typeof replyTo === 'object' ? replyTo : null;
    if (rt) replyHTML = `<div class="reply-bar" onclick="jumpTo('${rt.id}')"><div class="rb-sender">${esc(rt.senderName || '')}</div><div class="rb-text">${esc((rt.content || '[media]').slice(0, 60))}</div></div>`;
  }
  let bClass = isSent ? 'bubble sent' : 'bubble recv';
  let bContent = '';
  if (type === 'image') {
    bClass += ' img-bub';
    bContent = mediaUrl
      ? `<img src="${esc(mediaUrl)}" alt="Image" onclick="openLB('${esc(mediaUrl)}')">`
      : `<div style="width:190px;height:80px;display:flex;align-items:center;justify-content:center;color:var(--t3);font-size:.75rem;background:var(--bg3);border-radius:12px"><i class="fas fa-spinner fa-spin me-1"></i>Loading…</div>`;
  } else if (type === 'gif') {
    bClass += ' gif-bub';
    bContent = `<img src="${esc(content)}" alt="GIF" loading="lazy">`;
  } else {
    const previews = extractLinkPreviews(content);
    const displayText = previews.length ? stripPreviewLinks(content, previews) : content;

    if (displayText && isEmoOnly(displayText)) bClass += ' emo-only';

    const isMentioned = !isSent && state.myName && displayText && new RegExp(`@${regEsc(state.myName)}\\b`, 'i').test(displayText);
    if (isMentioned) bClass += ' mentioned-bubble';

    bContent = (displayText ? parseMarkdown(esc(displayText), state.myName) : '') + buildLinkPreviewHTML(previews);
  }
  if (edited) bContent += `<i class="fas fa-pen edited-mark"></i>`;
  if (pending) bContent += `<i class="fas fa-clock pending-mark" title="Sending…"></i>`;
  const editBtn = isSent && type === 'text' ? `<button class="hbtn" onclick="openEdit('${id}')" title="Edit"><i class="fas fa-pen"></i></button>` : '';
  const delBtn = isSent ? `<button class="hbtn" onclick="openDel('${id}')" title="Delete"><i class="fas fa-trash" style="color:#ef4444"></i></button>` : '';
  const bhm = `<div class="bhm-wrap"><div class="bhm">
    <button class="hbtn" onclick="toggleReact('${id}','👍')" title="React">👍</button>
    <button class="hbtn" onclick="toggleReact('${id}','❤️')" title="React">❤️</button>
    <button class="hbtn" onclick="toggleReact('${id}','😂')" title="React">😂</button>
    <button class="hbtn" onclick="showReactPicker(event,'${id}')" title="More Reactions"><i class="fas fa-plus"></i></button>
    <button class="hbtn" onclick="doReply('${id}')" title="Reply"><i class="fas fa-reply"></i></button>
    ${editBtn}${delBtn}
  </div></div>`;
  const rHtml = buildReactHTML(id, reactions || {});
  const failHtml = failed ? `<div class="fail-bar"><i class="fas fa-circle-exclamation"></i>Failed <button class="fail-btn" onclick="retrySend('${id}')">Retry</button></div>` : '';
  
  if (!isSent) {
    const formattedTime = new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const senderLine = isGrouped ? '' : `<div class="msender">${esc(senderName)} <span class="mtime-inline">${formattedTime}</span></div>`;
    return `<div class="mrow recv-row">${avHTML}<div class="msg-content" style="min-width:0;flex:1">${senderLine}<div class="bwrap">${bhm}<div class="${bClass}" id="bub${id}" data-msgid="${id}">${replyHTML}${bContent}</div></div><div id="react${id}">${rHtml}</div>${failHtml}</div></div>`;
  } else {
    return `<div class="mrow"><div class="msg-content"><div class="bwrap">${bhm}<div class="${bClass}" id="bub${id}" data-msgid="${id}">${replyHTML}${bContent}</div></div><div id="react${id}">${rHtml}</div>${failHtml}<div class="mtime" data-ts="${ts}"><span class="ago-l">${timeAgo(ts)}</span><div class="atip">${fmtFull(ts)}</div></div></div></div>`;
  }
}
window.buildMsgHTML = buildMsgHTML;

export function buildReactHTML(id, reactions) {
  const out = [];
  Object.entries(reactions).forEach(([emoji, users]) => {
    if (!users || typeof users !== 'object') return;
    const total = Object.values(users).reduce((a, b) => a + (b || 0), 0);
    if (total <= 0) return;
    const mine = !!(users[state.myId] > 0);
    
    const reactedUserNames = Object.entries(users)
      .filter(([uid, count]) => count > 0)
      .map(([uid]) => {
        if (uid === state.myId) return state.myName;
        const p = state.peers.get(uid); if (p && p.name) return p.name;
        const ou = state.onlineUsers.get(uid); if (ou && ou.name) return ou.name;
        const m = state.history.find(h => h.senderId === uid); if (m) return m.senderName;
        return 'Someone';
      });
      
    const tooltip = reactedUserNames.join(', ');
    const safeEmoji = esc(emoji).replace(/'/g, "\\'");
    const countHtml = total > 1 ? `<span class="rc">${total}</span>` : '';
    
    out.push(`<div class="rpill${mine ? ' mine' : ''}" title="${esc(tooltip)}" onclick="toggleReact('${id}','${safeEmoji}')">${esc(emoji)}${countHtml}</div>`);
  });
  return out.length ? `<div class="reacts">${out.join('')}</div>` : '';
}
window.buildReactHTML = buildReactHTML;

export function updateMsgEl(m) { const g = document.querySelector(`[data-msg-id="${m.id}"]`); if (!g) return; const isGrouped = g.classList.contains('grouped'); g.innerHTML = buildMsgHTML(m, m.senderId === state.myId, isGrouped); }
window.updateMsgEl = updateMsgEl;

export function updateMsgMedia(id, url) {
  const bub = document.getElementById('bub' + id); if (!bub) return;
  const m = state.history.find(h => h.id === id); if (!m) return;
  m.mediaUrl = url; m.pending = false;
  bub.className = (m.senderId === state.myId ? 'bubble sent' : 'bubble recv') + ' img-bub';
  bub.innerHTML = `<img src="${esc(url)}" alt="Image" onclick="openLB('${esc(url)}')")>`;
}
window.updateMsgMedia = updateMsgMedia;

export function setPending(id, val) { const m = state.history.find(h => h.id === id); if (m) { m.pending = val; updateMsgEl(m); } }
window.setPending = setPending;

export function toggleReact(id, emoji) {
  const m = state.history.find(h => h.id === id); if (!m) return;
  if (!m.reactions) m.reactions = {};
  if (!m.reactions[emoji]) m.reactions[emoji] = {};
  const cur = m.reactions[emoji][state.myId] || 0;
  const delta = cur > 0 ? -1 : 1;
  m.reactions[emoji][state.myId] = Math.max(0, cur + delta);
  redrawReact(id, m.reactions);
  broadcastExcept(null, { type: 'REACT', msgId: id, emoji, userId: state.myId, delta });
  debouncedSaveHistory();
}
window.toggleReact = toggleReact;

export function applyReaction(id, emoji, userId, delta) {
  const m = state.history.find(h => h.id === id); if (!m) return;
  if (!m.reactions) m.reactions = {};
  if (!m.reactions[emoji]) m.reactions[emoji] = {};
  m.reactions[emoji][userId] = Math.max(0, (m.reactions[emoji][userId] || 0) + delta);
  redrawReact(id, m.reactions);
  debouncedSaveHistory();
}
window.applyReaction = applyReaction;

export function redrawReact(id, r) { const el = document.getElementById('react' + id); if (!el) return; el.innerHTML = buildReactHTML(id, r); }
window.redrawReact = redrawReact;

export function openEdit(id) { const m = state.history.find(h => h.id === id); if (!m || m.type !== 'text') return; state.editTarget = id; document.getElementById('editTa').value = m.content; openModal('editModal'); closeCtxMenu(); }
window.openEdit = openEdit;

export function commitEdit() { if (!state.editTarget) return; const m = state.history.find(h => h.id === state.editTarget); if (!m) return; const nc = document.getElementById('editTa').value.trim(); if (!nc) { closeModal('editModal'); return; } m.content = nc; m.edited = true; updateMsgEl(m); broadcastExcept(null, { type: 'EDIT', msgId: state.editTarget, newContent: nc }); closeModal('editModal'); state.editTarget = null; showToast('Edited'); }
window.commitEdit = commitEdit;

export function applyEdit(id, nc) { const m = state.history.find(h => h.id === id); if (!m) return; m.content = nc; m.edited = true; updateMsgEl(m); }
window.applyEdit = applyEdit;

export function openDel(id) { const m = state.history.find(h => h.id === id); if (!m) return; state.delTarget = id; document.getElementById('delPreview').textContent = (m.content || '[media]').slice(0, 100); openModal('delModal'); closeCtxMenu(); }
window.openDel = openDel;

export function commitDel() { if (!state.delTarget) return; applyDelete(state.delTarget); broadcastExcept(null, { type: 'DELETE', msgId: state.delTarget }); closeModal('delModal'); state.delTarget = null; showToast('Deleted'); }
window.commitDel = commitDel;

export function applyDelete(id) { state.history = state.history.filter(h => h.id !== id); state.messages = state.messages.filter(mm => mm.id !== id); const g = document.querySelector(`[data-msg-id="${id}"]`); if (g) { g.style.transition = 'opacity .22s,transform .22s'; g.style.opacity = '0'; g.style.transform = 'scale(.96)'; setTimeout(() => g.remove(), 230); } }
window.applyDelete = applyDelete;

export function retrySend(id) { const m = state.history.find(h => h.id === id); if (!m) return; m.failed = false; m.pending = true; updateMsgEl(m); const ok = broadcastChat(m); if (!ok) { m.failed = true; m.pending = false; updateMsgEl(m); } else { m.pending = false; updateMsgEl(m); } }
window.retrySend = retrySend;

export function doReply(id) { const m = state.history.find(h => h.id === id); if (!m) return; state.replyToMsg = { id, senderName: m.senderName, content: m.content || '[media]', type: m.type }; document.getElementById('replyPreview').classList.add('show'); document.getElementById('rpSender').textContent = '↩ ' + m.senderName; document.getElementById('rpText').textContent = (m.content || '[media]').slice(0, 60); document.getElementById('msgInput').focus(); closeCtxMenu(); }
window.doReply = doReply;

export function clearReply() { state.replyToMsg = null; document.getElementById('replyPreview').classList.remove('show'); }
window.clearReply = clearReply;

export function showTypingFor(userId, name, avatarUrl) {
  const ind = document.getElementById('typingInd');
  const av = document.getElementById('typingAv');

  const src = avatarUrl || avatarForUser(userId) || getDisplayAvatar(userId || name || 'typing');
  if (av) av.innerHTML = avImg(src);

  ind.classList.add('show');
  clearTimeout(state.typingShowTimer);
  state.typingShowTimer = setTimeout(() => ind.classList.remove('show'), 3000);
  //scrollBot(true);
}
window.showTypingFor = showTypingFor;

export function handleTyping() {
  if (state.typingTimer) return;

  broadcastExcept(null, {
    type: 'TYPING',
    name: state.myName,
    userId: state.myId,
    avatarUrl: state.myAvatarUrl,
    avatarUpdatedAt: state.myAvatarUpdatedAt
  });

  state.typingTimer = setTimeout(() => { state.typingTimer = null; }, TYPING_DEBOUNCE);
}
window.handleTyping = handleTyping;

export function processMessageContent(text) {
  const urls = [];
  // Regex for YT, MAL, AniList
  const regex = /(https?:\/\/(www\.)?(youtube\.com\/watch\?[^\s]*v=|youtu\.be\/)([a-zA-Z0-9_-]{11})|https?:\/\/(www\.)?myanimelist\.net\/(anime|manga)\/(\d+)[^\s]*|https?:\/\/(www\.)?anilist\.co\/(anime|manga)\/(\d+)[^\s]*)/g;
  let match;
  let cleanText = text;
  while ((match = regex.exec(text)) !== null) {
    const url = match[0];
    // Determine type
    let type = '', id = '', kind = '';
    if (url.includes('youtube') || url.includes('youtu.be')) {
      type = 'yt';
      const vidMatch = url.match(/(v=|\.be\/)([a-zA-Z0-9_-]{11})/);
      id = vidMatch ? vidMatch[2] : '';
    } else if (url.includes('myanimelist')) {
      type = 'mal';
      const m = url.match(/myanimelist\.net\/(anime|manga)\/(\d+)/);
      if (m) { kind = m[1]; id = m[2]; }
    } else if (url.includes('anilist')) {
      type = 'al';
      const m = url.match(/anilist\.co\/(anime|manga)\/(\d+)/);
      if (m) { kind = m[1]; id = m[2]; }
    }
    if (type) {
      urls.push({ url, type, id, kind });
      // Remove URL from text to avoid duplication
      cleanText = cleanText.replace(url, '');
    }
  }
  // Clean up extra spaces left by removal
  cleanText = cleanText.replace(/\s+/g, ' ').trim();
  return { text: cleanText, urls };
}
window.processMessageContent = processMessageContent;

export function buildPreviewCards(urls, msgId) {
  if (!urls.length) return '';
  return urls.map((p, i) => {
    const pid = `prev_${msgId}_${i}`;
    // Kick off async fetch
    setTimeout(() => fetchPreviewData(pid, p), 0);

    if (p.type === 'yt') {
      return `<a href="${esc(p.url)}" target="_blank" rel="noopener" class="yt-preview" id="${pid}">
        <div class="yt-preview-thumb-wrapper">
          <img class="yt-preview-thumb" src="https://img.youtube.com/vi/${esc(p.id)}/mqdefault.jpg" alt="">
          <div class="yt-play-btn"><i class="fas fa-play"></i></div>
        </div>
        <div class="yt-preview-info">
          <div class="yt-preview-source"><i class="fab fa-youtube"></i> YouTube</div>
          <div class="yt-preview-title loading" id="${pid}_t">Loading video title…</div>
        </div>
      </a>`;
    }
    if (p.type === 'mal') {
      return `<a href="${esc(p.url)}" target="_blank" rel="noopener" class="mal-preview" id="${pid}">
        <img class="mal-preview-cover" id="${pid}_img" src="" alt="">
        <div class="mal-preview-info">
          <div class="mal-preview-type"><i class="fas fa-circle" style="font-size:6px"></i> ${p.kind.toUpperCase()}</div>
          <div class="mal-preview-title loading" id="${pid}_t">Loading title…</div>
          <div class="mal-preview-meta" id="${pid}_m"></div>
        </div>
      </a>`;
    }
    if (p.type === 'al') {
      return `<a href="${esc(p.url)}" target="_blank" rel="noopener" class="mal-preview" id="${pid}" style="border-color:rgba(2,169,255,.3)">
        <img class="mal-preview-cover" id="${pid}_img" src="" alt="">
        <div class="mal-preview-info">
          <div class="mal-preview-type" style="color:#02a9ff"><i class="fas fa-circle" style="font-size:6px"></i> ANILIST</div>
          <div class="mal-preview-title loading" id="${pid}_t">Loading title…</div>
          <div class="mal-preview-meta" id="${pid}_m"></div>
        </div>
      </a>`;
    }
    return '';
  }).join('');
}
window.buildPreviewCards = buildPreviewCards;

export async function fetchPreviewData(pid, p) {
  try {
    if (p.type === 'yt') {
      const r = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(p.url)}&format=json`);
      if (!r.ok) return;
      const d = await r.json();
      const el = document.getElementById(`${pid}_t`);
      if (el) { el.textContent = d.title; el.classList.remove('loading'); }
    }
    else if (p.type === 'mal') {
      const r = await fetch(`https://api.jikan.moe/v4/${p.kind}/${p.id}`);
      if (!r.ok) return;
      const { data } = await r.json();
      const t = document.getElementById(`${pid}_t`);
      const m = document.getElementById(`${pid}_m`);
      const img = document.getElementById(`${pid}_img`);
      if (t) { t.textContent = data.title; t.classList.remove('loading'); }
      if (img && data.images?.jpg?.image_url) img.src = data.images.jpg.image_url;
      if (m) {
        const badges = [];
        if (data.score) badges.push(`<span class="mal-meta-badge score">${data.score}</span>`);
        if (data.episodes) badges.push(`<span class="mal-meta-badge">${data.episodes} eps</span>`);
        else if (data.chapters) badges.push(`<span class="mal-meta-badge">${data.chapters} ch</span>`);
        else if (data.status) badges.push(`<span class="mal-meta-badge">${data.status}</span>`);
        m.innerHTML = badges.join('');
      }
    }
    else if (p.type === 'al') {
      const query = `query($id:Int,$type:MediaType){Media(id:$id,type:$type){title{romaji}coverImage{medium}episodes chapters averageScore status}}`;
      const r = await fetch('https://graphql.anilist.co', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query, variables: { id: parseInt(p.id), type: p.kind.toUpperCase() } }) });
      if (!r.ok) return;
      const { data } = await r.json();
      const m = data?.Media; if (!m) return;
      const t = document.getElementById(`${pid}_t`);
      const meta = document.getElementById(`${pid}_m`);
      const img = document.getElementById(`${pid}_img`);
      if (t) { t.textContent = m.title?.romaji || ''; t.classList.remove('loading'); }
      if (img && m.coverImage?.medium) img.src = m.coverImage.medium;
      if (meta) {
        const badges = [];
        if (m.averageScore) badges.push(`<span class="mal-meta-badge score">${(m.averageScore / 10).toFixed(1)}</span>`);
        if (m.episodes) badges.push(`<span class="mal-meta-badge">${m.episodes} eps</span>`);
        else if (m.chapters) badges.push(`<span class="mal-meta-badge">${m.chapters} ch</span>`);
        else if (m.status) badges.push(`<span class="mal-meta-badge">${m.status}</span>`);
        meta.innerHTML = badges.join('');
      }
    }
  } catch (_) { }
}
window.fetchPreviewData = fetchPreviewData;

export function cleanPreviewUrl(url) {
  return String(url || '').replace(/[)\].,!?]+$/, '');
}
window.cleanPreviewUrl = cleanPreviewUrl;

export function extractLinkPreviews(text) {
  const out = [];
  const seen = new Set();

  const push = (p) => {
    if (!p.url || seen.has(p.url)) return;
    seen.add(p.url);
    out.push(p);
  };

  let m;

  const ytRe = /https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?[^\s<]*?v=|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})[^\s<]*/gi;
  while ((m = ytRe.exec(text)) && out.length < 3) {
    push({ type: 'yt', url: cleanPreviewUrl(m[0]), vid: m[1] });
  }

  const malRe = /https?:\/\/(?:www\.)?myanimelist\.net\/(anime|manga)\/(\d+)(?:\/[^\s<]*)?/gi;
  while ((m = malRe.exec(text)) && out.length < 3) {
    push({ type: 'mal', url: cleanPreviewUrl(m[0]), kind: m[1], id: m[2] });
  }

  return out;
}
window.extractLinkPreviews = extractLinkPreviews;

export function regEsc(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
window.regEsc = regEsc;

export function stripPreviewLinks(text, previews) {
  let out = String(text || '');
  previews.forEach(p => {
    out = out.replace(new RegExp(`[\\[\\(<]?${regEsc(p.url)}[\\]\\)>]?`, 'g'), '');
  });
  return out
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([,.!?])/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
window.stripPreviewLinks = stripPreviewLinks;

export function buildLinkPreviewHTML(previews) {
  if (!previews?.length) return '';

  return previews.map(p => {
    const pid = 'lp_' + Math.random().toString(36).slice(2);

    setTimeout(() => fillLinkPreview(pid, p), 0);

    if (p.type === 'yt') {
      return `<a class="yt-preview" href="${esc(p.url)}" target="_blank" rel="noopener" id="${pid}">
        <div class="yt-preview-thumb-wrapper">
          <img class="yt-preview-thumb" src="https://img.youtube.com/vi/${esc(p.vid)}/hqdefault.jpg" alt="">
          <div class="yt-play-btn"></div>
        </div>
        <div class="yt-preview-info">
          <div class="yt-preview-title loading" id="${pid}_title">Loading YouTube…</div>
          <div class="yt-preview-source">
            <i class="fab fa-youtube"></i>
            YouTube
          </div>
        </div>
      </a>`;
    }

    if (p.type === 'mal') {
      return `<a class="mal-preview" href="${esc(p.url)}" target="_blank" rel="noopener" id="${pid}">
        <img class="mal-preview-cover" id="${pid}_img" src="" alt="" onerror="this.style.display='none'">
        <div class="mal-preview-info">
          <div class="mal-preview-type">
            <span class="mal-logo">MAL</span>
            ${esc(p.kind)}
          </div>
          <div class="mal-preview-title loading" id="${pid}_title">Loading MyAnimeList…</div>
          <div class="mal-preview-synopsis" id="${pid}_syn"></div>
          <div class="mal-preview-meta" id="${pid}_meta"></div>
        </div>
      </a>`;
    }

    return '';
  }).join('');
}
window.buildLinkPreviewHTML = buildLinkPreviewHTML;

export async function fillLinkPreview(pid, p) {
  try {
    const cacheKey = p.type + ':' + (p.id || p.vid || p.url);

    if (state.linkPreviewCache.has(cacheKey)) {
      applyLinkPreviewData(pid, p, state.linkPreviewCache.get(cacheKey));
      return;
    }

    let data = null;

    if (p.type === 'yt') {
      const r = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(p.url)}&format=json`);
      if (!r.ok) throw new Error('yt failed');
      const d = await r.json();
      data = { title: d.title || 'YouTube video' };
    }

    if (p.type === 'mal') {
      const r = await fetch(`https://api.jikan.moe/v4/${p.kind}/${p.id}`);
      if (!r.ok) throw new Error('mal failed');
      const { data: d } = await r.json();

      data = {
        title: d.title_english || d.title || 'MyAnimeList',
        image: d.images?.jpg?.image_url || '',
        synopsis: d.synopsis || '',
        score: d.score || null,
        episodes: d.episodes || null,
        chapters: d.chapters || null,
        status: d.status || '',
        year: d.year || d.published?.prop?.from?.year || null
      };
    }

    if (data) {
      state.linkPreviewCache.set(cacheKey, data);
      applyLinkPreviewData(pid, p, data);
    }
  } catch (_) {
    const t = document.getElementById(pid + '_title');
    if (t) {
      t.textContent = p.type === 'yt' ? 'YouTube' : 'MyAnimeList';
      t.classList.remove('loading');
    }
  }
}
window.fillLinkPreview = fillLinkPreview;

export function applyLinkPreviewData(pid, p, data) {
  const title = document.getElementById(pid + '_title');
  if (title) {
    title.textContent = data.title || 'Preview';
    title.classList.remove('loading');
  }

  if (p.type === 'mal') {
    const img = document.getElementById(pid + '_img');
    const syn = document.getElementById(pid + '_syn');
    const meta = document.getElementById(pid + '_meta');

    if (img && data.image) img.src = data.image;
    if (syn) syn.textContent = data.synopsis || '';

    if (meta) {
      const bits = [];
      if (data.score) bits.push(`<span class="mal-meta-badge score">${esc(data.score)}</span>`);
      if (data.episodes) bits.push(`<span class="mal-meta-badge">${esc(data.episodes)} eps</span>`);
      if (data.chapters) bits.push(`<span class="mal-meta-badge">${esc(data.chapters)} ch</span>`);
      if (data.year) bits.push(`<span class="mal-meta-badge">${esc(data.year)}</span>`);
      if (data.status) bits.push(`<span class="mal-meta-badge">${esc(data.status)}</span>`);
      meta.innerHTML = bits.join('');
    }
  }
}
window.applyLinkPreviewData = applyLinkPreviewData;

export function isEmoOnly(s) { return s && /^(\p{Emoji_Presentation}|\p{Extended_Pictographic}|\s){1,4}$/u.test(s.trim()) && s.trim().length <= 8; }
window.isEmoOnly = isEmoOnly;

