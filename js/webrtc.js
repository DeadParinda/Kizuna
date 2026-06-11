import { state } from './state.js?v=11';
import { sb, ICE_CFG, HISTORY_MAX, SP_THRESH, LS_MEDIA, CHUNK_SIZE } from './config.js?v=11';
import { setAvatarCache, updateAllAvatarsForUser, b64toBlob } from './utils.js?v=11';
import { notifyNewMessage, renderSidebar, updateConnQuality, updateCounts, sysMsg } from './ui.js?v=11';
import { saveHistoryToSupabase, mergeHistory, renderMessage, updateMsgMedia, applyReaction, applyEdit, applyDelete, showTypingFor } from './chat.js?v=11';
import { fetchAndCacheProfiles } from './main.js?v=11';

export function setupSignaling(){
  state.signalCh=sb.channel('signal:'+state.myRoom);
  state.signalCh.on('broadcast',{event:'signal'},({payload})=>{
    if(payload.to!==state.myId) return;
    handleSignal(payload);
  }).subscribe();
}
window.setupSignaling = setupSignaling;

export async function sendSignal(toId,data){
  if(!state.signalCh) return;
  await state.signalCh.send({type:'broadcast',event:'signal',payload:{from:state.myId,to:toId,fromName:state.myName,...data}});
}
window.sendSignal = sendSignal;

export async function handleSignal({from,fromName,sigType,sdp,candidate}) {
  if(from===state.myId) return;
  if(sigType==='offer'){
    createPeer(from,false);
    const p=state.peers.get(from);
    if(fromName) p.name=fromName;
    await p.pc.setRemoteDescription(new RTCSessionDescription(sdp));
    if(p.iceQueue && p.iceQueue.length>0) {
      for(const c of p.iceQueue) await p.pc.addIceCandidate(new RTCIceCandidate(c));
      p.iceQueue=[];
    }
    const answer=await p.pc.createAnswer();
    await p.pc.setLocalDescription(answer);
    sendSignal(from,{sigType:'answer',sdp:p.pc.localDescription});
  } else if(sigType==='answer'){
    const p=state.peers.get(from);
    if(!p) return;
    await p.pc.setRemoteDescription(new RTCSessionDescription(sdp));
    if(p.iceQueue && p.iceQueue.length>0) {
      for(const c of p.iceQueue) await p.pc.addIceCandidate(new RTCIceCandidate(c));
      p.iceQueue=[];
    }
  } else if(sigType==='ice'){
    const p=state.peers.get(from);
    if(!p) return;
    if(p.pc.remoteDescription && p.pc.remoteDescription.type) {
      await p.pc.addIceCandidate(new RTCIceCandidate(candidate));
    } else {
      if(!p.iceQueue) p.iceQueue=[];
      p.iceQueue.push(candidate);
    }
  }
}
window.handleSignal = handleSignal;

export function autoConnect(){
  state.onlineUsers.forEach((u,uid)=>{
    if(uid===state.myId||state.peers.has(uid)) return;
    // only the lexicographically smaller id initiates
    if(state.myId<uid){
      const jitter=Math.random()*800;
      setTimeout(()=>{
        // double check still not connected after jitter
        if(!state.peers.has(uid) && state.onlineUsers.has(uid)){
          initiateConnection(uid);
        }
      },jitter);
    }
  });
}
window.autoConnect = autoConnect;

export async function initiateConnection(peerId){
  if(state.peers.has(peerId)) return;
  createPeer(peerId,true);
  const p=state.peers.get(peerId); if(!p) return;
  const offer=await p.pc.createOffer();
  await p.pc.setLocalDescription(offer);
  sendSignal(peerId,{sigType:'offer',sdp:p.pc.localDescription});
}
window.initiateConnection = initiateConnection;

export function createPeer(peerId,isInitiator){
  const pc=new RTCPeerConnection(ICE_CFG);
  
  const po={pc,dc:null,name:state.onlineUsers.get(peerId)?.name||peerId.slice(0,8),status:'connecting',isSuper:false,iceQueue:[],mediaTransfer:null};
  state.peers.set(peerId,po);
  pc.onicecandidate=({candidate})=>{if(candidate)sendSignal(peerId,{sigType:'ice',candidate});};
  pc.oniceconnectionstatechange=()=>{
  const s=pc.iceConnectionState;
  if(s==='connected'||s==='completed'){
    po.status='connected';
    updateSuperPeer();renderSidebar();updateCounts();updateConnQuality();
  }
  else if(s==='failed'){
    console.warn('ICE failed for',peerId,'— restarting');
    try{ pc.restartIce(); }catch(_){}
    // if still failed after 5s, drop and retry
    setTimeout(()=>{
      if(pc.iceConnectionState==='failed'){
        dropPeer(peerId,false);
        // re-attempt connection
        setTimeout(()=>{
          if(state.myId<peerId) initiateConnection(peerId);
        },1000);
      }
    },5000);
  }
  else if(s==='disconnected'){
    // dont drop immediately, might recover
    setTimeout(()=>{
      if(pc.iceConnectionState==='disconnected'||pc.iceConnectionState==='failed'){
        dropPeer(peerId,true);
      }
    },4000);
  }
  else if(s==='closed') dropPeer(peerId,true);
};
  if(isInitiator){const dc=pc.createDataChannel('chat',{ordered:true});wireChannel(peerId,dc);}
  else pc.ondatachannel=({channel})=>wireChannel(peerId,channel);
  return po;
}
window.createPeer = createPeer;

export function wireChannel(peerId,dc){
  const p=state.peers.get(peerId);if(!p)return;
  p.dc=dc;
  dc.onopen=()=>{
    p.status='connected';renderSidebar();updateCounts();updateConnQuality();
    dcSend(peerId,{
      type:'HELLO',
      id:state.myId,
      name:state.myName,
      avatarUrl:state.myAvatarUrl,
      avatarUpdatedAt:state.myAvatarUpdatedAt
    });
    if(state.history.length) dcSend(peerId,{type:'HISTORY',messages:state.history.slice(-50).map(h=>({...h,mediaUrl:undefined}))});
  };
  dc.onmessage=({data})=>{try{handleDCMsg(peerId,JSON.parse(data));}catch(e){console.warn(e);}};
  dc.onclose=()=>dropPeer(peerId,true);
  dc.onerror=()=>dropPeer(peerId,true);
  fetchAndCacheProfiles([peerId]);
}
window.wireChannel = wireChannel;

export function dcSend(peerId,obj){
  const p=state.peers.get(peerId);
  if(!p||!p.dc||p.dc.readyState!=='open') return false;
  try{p.dc.send(JSON.stringify(obj));return true;}catch{return false;}
}
window.dcSend = dcSend;

export function broadcastExcept(exceptId,obj){
  state.peers.forEach((_,pid)=>{if(pid!==exceptId)dcSend(pid,obj);});
}
window.broadcastExcept = broadcastExcept;

export function dropPeer(peerId,notify=true){
  const p=state.peers.get(peerId);if(!p)return;
  try{p.dc&&p.dc.close();p.pc&&p.pc.close();}catch(_){}
  const name=p.name;
  state.peers.delete(peerId);
  state.onlineUsers.delete(peerId);
  updateSuperPeer();renderSidebar();updateCounts();updateConnQuality();
  if(notify)sysMsg(name+' disconnected');

  if(state.peers.size===0) saveHistoryToSupabase();

}
window.dropPeer = dropPeer;

export function handleDCMsg(fromId,msg){
  const p=state.peers.get(fromId);if(!p)return;
  switch(msg.type){
    case 'HELLO':
      p.name=msg.name;

      if(msg.avatarUrl){
        p.avatarUrl=msg.avatarUrl;
        setAvatarCache(msg.id||fromId,msg.avatarUrl,msg.avatarUpdatedAt||null);
        updateAllAvatarsForUser(msg.id||fromId,msg.avatarUrl);

        const ou=state.onlineUsers.get(msg.id||fromId);
        if(ou){
          ou.avatarUrl=msg.avatarUrl;
          ou.avatarUpdatedAt=msg.avatarUpdatedAt||null;
        }
      }

      renderSidebar();
      break;
    case 'HISTORY': mergeHistory(msg.messages||[]); break;
    case 'CHAT':{
      const m=msg.message;
      if(state.history.find(h=>h.id===m.id)) break;
      state.history.push(m);if(state.history.length>HISTORY_MAX)state.history.shift();
      renderMessage(m,false);
      notifyNewMessage(m);
      broadcastExcept(fromId,{type:'CHAT',message:m});
      break;
    }
    case 'MEDIA_REQ': {
      const ref = msg.ref;
      if (!ref) break;
      try {
        const s = localStorage.getItem(LS_MEDIA + ref);
        if (s) {
          const { b64, mime } = JSON.parse(s);
          const chunks = [];
          for (let i = 0; i < b64.length; i += CHUNK_SIZE) chunks.push(b64.slice(i, i + CHUNK_SIZE));
          
          dcSend(fromId, { type: 'MEDIA_META', id: ref, mimeType: mime, totalChunks: chunks.length, senderId: state.myId, senderName: state.myName, ts: Date.now() });
          chunks.forEach((c, idx) => dcSend(fromId, { type: 'MEDIA_CHUNK', id: ref, index: idx, data: c }));
        }
      } catch (_) {}
      break;
    }
    case 'MEDIA_META':{
      if(!state.history.find(h=>h.id===msg.id)){
        const ph={id:msg.id,senderId:msg.senderId,senderName:msg.senderName,content:'',type:'image',ts:msg.ts||Date.now(),reactions:{},replyTo:null,edited:false,mediaUrl:null,pending:true};
        state.history.push(ph);if(state.history.length>HISTORY_MAX)state.history.shift();
        renderMessage(ph,ph.senderId===state.myId);
        notifyNewMessage(ph);
        broadcastExcept(fromId,{type:'MEDIA_META',...msg});
      }
      p.mediaTransfer={id:msg.id,mimeType:msg.mimeType,totalChunks:msg.totalChunks,chunks:[],senderId:msg.senderId,senderName:msg.senderName,ts:msg.ts};
      break;
    }
    case 'MEDIA_CHUNK':{
      if(!p.mediaTransfer||p.mediaTransfer.id!==msg.id) break;
      p.mediaTransfer.chunks[msg.index]=msg.data;
      broadcastExcept(fromId,{type:'MEDIA_CHUNK',...msg});
      if(p.mediaTransfer.chunks.filter(Boolean).length>=p.mediaTransfer.totalChunks){
        const blob=b64toBlob(p.mediaTransfer.chunks.join(''),p.mediaTransfer.mimeType);
        const url=URL.createObjectURL(blob);
        try{localStorage.setItem(LS_MEDIA+p.mediaTransfer.id,JSON.stringify({b64:p.mediaTransfer.chunks.join(''),mime:p.mediaTransfer.mimeType}));}catch(_){}
        const hm=state.history.find(h=>h.id===p.mediaTransfer.id);
        if(hm){hm.mediaUrl=url;hm.pending=false;}
        updateMsgMedia(p.mediaTransfer.id,url);
        p.mediaTransfer=null;
      }
      break;
    }
    case 'TYPING':
      if(msg.avatarUrl){
        setAvatarCache(msg.userId||fromId,msg.avatarUrl,msg.avatarUpdatedAt||null);
      }
      showTypingFor(msg.userId||fromId,msg.name,msg.avatarUrl);
      break;
    case 'REACT':
      applyReaction(msg.msgId,msg.emoji,msg.userId,msg.delta);
      broadcastExcept(fromId,{type:'REACT',...msg});
      break;
    case 'EDIT':
      applyEdit(msg.msgId,msg.newContent);
      broadcastExcept(fromId,{type:'EDIT',msgId:msg.msgId,newContent:msg.newContent});
      break;
    case 'DELETE':
      applyDelete(msg.msgId);
      broadcastExcept(fromId,{type:'DELETE',msgId:msg.msgId});
      break;
    case 'SUPERPEER_UPDATE': if(p)p.isSuper=msg.isSuper;renderSidebar(); break;
    case 'PROFILE_UPDATE':
      if(msg.userId){
        if(msg.avatarUrl){setAvatarCache(msg.userId,msg.avatarUrl);updateAllAvatarsForUser(msg.userId,msg.avatarUrl);}
        if(p&&msg.name)p.name=msg.name;
        const ou=state.onlineUsers.get(msg.userId);
        if(ou&&msg.name)ou.name=msg.name;
        renderSidebar();
      }
      break;
  }
}
window.handleDCMsg = handleDCMsg;

export function updateSuperPeer(){
  const n=[...state.peers.values()].filter(p=>p.status==='connected').length;
  const was=state.isSuperPeer;state.isSuperPeer=n>=SP_THRESH;
  if(state.isSuperPeer!==was)broadcastExcept(null,{type:'SUPERPEER_UPDATE',isSuper:state.isSuperPeer});
}
window.updateSuperPeer = updateSuperPeer;

