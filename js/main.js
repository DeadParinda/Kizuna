import './auth.js?v=11';
import './webrtc.js?v=11';
import './presence.js?v=11';
import './ui.js?v=11';
import './chat.js?v=11';
import './utils.js?v=11';
import './config.js?v=11';
import { state } from './state.js?v=11';
import { sb } from './config.js?v=11';
import { setAvatarCache, getAvatarFromCache, updateAllAvatarsForUser } from './utils.js?v=11';
import { renderSidebar, closePlus } from './ui.js?v=11';
import { sendMsg, sendMedia } from './chat.js?v=11';

export function handleKey(e) {
  const tributeMenu = document.querySelector('.tribute-container');
  if (tributeMenu && tributeMenu.style.display !== 'none') {
    // Tribute is active, let it handle the Enter key.
    return;
  }

  if (e.key === 'Escape') {
    if (state._pastedFile && window.cancelPaste) {
      window.cancelPaste();
    }
    if (state.replyToMsg && window.clearReply) {
      window.clearReply();
    }
    return;
  }

  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    if (state._pastedFile && window.sendPastedImage) {
      window.sendPastedImage();
    }
    const text = document.getElementById('msgInput').value.trim();
    if (text) {
      sendMsg();
    }
  }
}
window.handleKey = handleKey;

export function autoResize(el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 110) + 'px'; }
window.autoResize = autoResize;

export function trigImg() { document.getElementById('fileInput').click(); closePlus(); }
window.trigImg = trigImg;

export function handleImgUp(e) { const f = e.target.files[0]; if (!f) return; sendMedia(f); closePlus(); e.target.value = ''; }
window.handleImgUp = handleImgUp;

export function initScroll() { const area = document.getElementById('messagesArea'); area.addEventListener('scroll', () => { state.isAtBot = area.scrollTop + area.clientHeight >= area.scrollHeight - 130; if (state.isAtBot) state.unread = 0; updateScrollBtn(); }); }
window.initScroll = initScroll;

export function scrollBot(smooth = true) { const area = document.getElementById('messagesArea'); setTimeout(() => { area.scrollTo({ top: area.scrollHeight, behavior: smooth ? 'smooth' : 'auto' }); state.isAtBot = true; state.unread = 0; updateScrollBtn(); }, 40); }
window.scrollBot = scrollBot;

export function updateScrollBtn() { const btn = document.getElementById('scrollBtn'), badge = document.getElementById('ubBadge'); btn.classList.toggle('show', !state.isAtBot); if (state.unread > 0) { badge.textContent = state.unread; badge.style.display = 'flex'; } else badge.style.display = 'none'; }
window.updateScrollBtn = updateScrollBtn;

export async function fetchAndCacheProfiles(uids) { const toFetch = uids.filter(id => { const c = getAvatarFromCache(id); return !c?.url; }); if (!toFetch.length) return; const { data } = await sb.from('kizuna_profiles').select('id,name,avatar_url,avatar_updated_at').in('id', toFetch); (data || []).forEach(row => { if (row.avatar_url) { setAvatarCache(row.id, row.avatar_url, row.avatar_updated_at || null); updateAllAvatarsForUser(row.id, row.avatar_url); } const ou = state.onlineUsers.get(row.id); if (ou && row.name) ou.name = row.name; const p = state.peers.get(row.id); if (p && row.name) p.name = row.name; }); renderSidebar(); }
window.fetchAndCacheProfiles = fetchAndCacheProfiles;


function runInit() {
  document.getElementById('sidebar').classList.toggle('closed', !state.sbOpen);
  const sbToggle = document.getElementById('sbToggle');
  if (sbToggle) sbToggle.classList.toggle('act', state.sbOpen);
  if (window.initEmojiMart) window.initEmojiMart();
  if (window.initTribute) window.initTribute();
  if (window.initAuth) window.initAuth();
  if (window.buildMsgListeners) window.buildMsgListeners();
  if (window.fetchGifs) window.fetchGifs();
  if (window.initPasteHandler) window.initPasteHandler();
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', runInit);
} else {
  setTimeout(runInit, 0);
}

document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') { saveLocalMessages(); saveHistoryToSupabase(); } }); window.addEventListener('focus', () => { state.isTabFocused = true; state.unreadReplies = 0; state.hasUnreadMessages = false; updateTitle(); }); window.addEventListener('blur', () => { state.isTabFocused = false; }); document.addEventListener('visibilitychange', () => { state.isTabFocused = !document.hidden; if (state.isTabFocused) { state.unreadReplies = 0; state.hasUnreadMessages = false; updateTitle(); } }); window.addEventListener('beforeunload', e => { const payload = JSON.stringify({ room: state.myRoom, data: JSON.stringify(state.history.map(h => ({ ...h, mediaUrl: undefined }))), updated_at: new Date().toISOString() }); navigator.sendBeacon(`${SB_URL}/rest/v1/meshchat_history?on_conflict=room`, new Blob([payload], { type: 'application/json' })); state.peers.forEach((_, pid) => dropPeer(pid, false)); });

document.getElementById('lightbox').addEventListener('click', e => { if (e.target === e.currentTarget) closeLB(); }); document.querySelectorAll('.mover').forEach(el => el.addEventListener('click', e => { if (e.target === el) el.classList.remove('show'); }));

document.addEventListener('click', e => { const pm = document.getElementById('plusMenu'), pb = document.getElementById('plusBtn'); const pp = document.getElementById('pickerPanel'), eb = document.getElementById('emojiBtn'); const cm = document.getElementById('ctxMenuWrap'); const rw = document.getElementById('reactPickerWrap'); const pv = document.getElementById('pastePreview'); if (state.plusOpen && !pm.contains(e.target) && !pb.contains(e.target)) closePlus(); if (state.pickerOpen && !pp.contains(e.target) && !eb.contains(e.target)) closePicker(); if (state.ctxTarget && !cm.contains(e.target)) closeCtxMenu(); if (state.reactTargetId && !rw.contains(e.target)) closeReactPicker(); }); 

document.addEventListener('contextmenu', e => {
  if (!e.target.closest('.bwrap') && !e.target.closest('#ctxMenuWrap')) closeCtxMenu();
});

export function buildMsgListeners() { ['loginEmail', 'loginPassword'].forEach(id => document.getElementById(id).addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); }));['signupName', 'signupEmail', 'signupPassword'].forEach(id => document.getElementById(id).addEventListener('keydown', e => { if (e.key === 'Enter') doSignup(); })); } window.buildMsgListeners = buildMsgListeners;
