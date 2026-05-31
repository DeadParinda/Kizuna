import { state } from './state.js?v=11';
import { sb } from './config.js?v=11';
import { setAvatarCache, updateAllAvatarsForUser } from './utils.js?v=11';
import { autoConnect, dropPeer } from './webrtc.js?v=11';
import { renderPeerList, renderSidebar, updateCounts, sysMsg, showToast } from './ui.js?v=11';
import { fetchAndCacheProfiles } from './main.js?v=11';

export function hydrateOnlineProfiles(){
  clearTimeout(state.hydrateProfilesTimer);
  state.hydrateProfilesTimer=setTimeout(async()=>{
    const ids=[...state.onlineUsers.keys()].filter(id=>id!==state.myId);
    if(!ids.length) return;

    const {data}=await sb
      .from('kizuna_profiles')
      .select('id,name,avatar_url,avatar_updated_at')
      .in('id',ids);

    (data||[]).forEach(row=>{
      const u=state.onlineUsers.get(row.id)||{};
      if(row.name && !u.name) u.name=row.name;

      if(row.avatar_url){
        u.avatarUrl=row.avatar_url;
        u.avatarUpdatedAt=row.avatar_updated_at||null;
        setAvatarCache(row.id,row.avatar_url,row.avatar_updated_at||null);
        updateAllAvatarsForUser(row.id,row.avatar_url);
      }

      state.onlineUsers.set(row.id,u);
    });

    renderSidebar();
    if(document.getElementById('peerModal')?.classList.contains('show')) renderPeerList();
  },250);
}
window.hydrateOnlineProfiles = hydrateOnlineProfiles;

export function setupPresence(){
  state.presenceCh=sb.channel('presence:'+state.myRoom,{config:{presence:{key:state.myId}}});
  state.presenceCh
    .on('presence',{event:'sync'},()=>{
  const presState = state.presenceCh.presenceState();
  state.onlineUsers.clear();
  Object.entries(presState).forEach(([uid,arr])=>{
    const p = arr[0];
    state.onlineUsers.set(uid,{name:p.name,room:p.room,ts:p.ts,avatarUrl:p.avatarUrl||''});
    if(p.avatarUrl) setAvatarCache(uid, p.avatarUrl); // cache if presence has it
  });
  renderSidebar(); updateCounts(); autoConnect();

  // ← fetch any missing avatars from DB
  fetchAndCacheProfiles([...state.onlineUsers.keys()].filter(id=>id!==state.myId));
})
    .on('presence',{event:'join'},({newPresences})=>{
      newPresences.forEach(p=>{ if(p.key!==state.myId) sysMsg(p.name+' joined'); });
    })
    .on('presence',{event:'leave'},({leftPresences})=>{
      leftPresences.forEach(p=>{
        if(p.key===state.myId) return;
        state.onlineUsers.delete(p.key);
        sysMsg((p.name||p.key.slice(0,8))+' left the room');
        if(state.peers.has(p.key)) dropPeer(p.key,false);
        renderSidebar(); updateCounts();
      });
    })
    .subscribe(async status=>{
    if(status==='SUBSCRIBED') await state.presenceCh.track({
      name:state.myName,
      room:state.myRoom,
      ts:Date.now(),
      avatarUrl:state.myAvatarUrl,
      avatarUpdatedAt:state.myAvatarUpdatedAt
    }); 
  });
}
window.setupPresence = setupPresence;

export async function refreshOnlineUsers(){if(state.presenceCh){const presState=state.presenceCh.presenceState();state.onlineUsers.clear();Object.entries(presState).forEach(([uid,arr])=>{const p=arr[0];state.onlineUsers.set(uid,{name:p.name,room:p.room});});renderSidebar();updateCounts();autoConnect();}renderPeerList();showToast('Refreshed');}
window.refreshOnlineUsers = refreshOnlineUsers;

