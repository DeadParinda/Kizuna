import { state } from './state.js?v=11';
import { sb, PFP_COOLDOWN_DAYS, PFP_LS_KEY, BASE_CDN } from './config.js?v=11';

export function avatarForUser(uid){
  return state.onlineUsers.get(uid)?.avatarUrl
    || state.peers.get(uid)?.avatarUrl
    || getDisplayAvatar(uid);
}
window.avatarForUser = avatarForUser;

export function setAvatarCache(uid,url,updatedAt=null){
  if(!uid||!url) return;
  const all=getAvatarCacheAll(), ex=all[uid];
  all[uid]={
    url,
    updatedAt:updatedAt || ex?.updatedAt || null
  };
  localStorage.setItem(PFP_LS_KEY,JSON.stringify(all));
}
window.setAvatarCache = setAvatarCache;

export function getDisplayAvatar(uid){
  const c=getAvatarFromCache(uid);
  if(c?.url) return c.url;
  console.log(c, uid)
  return `https://api.dicebear.com/9.x/fun-emoji/svg?seed=${encodeURIComponent(uid)}&radius=50&size=64&backgroundColor=b6e3f4,c0aede,d1d4f9,ffd5dc,ffdfbf`;
}
window.getDisplayAvatar = getDisplayAvatar;

export function updateAllAvatarsForUser(uid,url){
  document.querySelectorAll(`[data-sender-id="${uid}"] .mav img`).forEach(img=>img.src=url);
  if(uid===state.myId){
    const el=document.getElementById('myAvTb');
    if(el) el.innerHTML=avImg(url);
  }
}
window.updateAllAvatarsForUser = updateAllAvatarsForUser;

export function arrayBufToB64(buf){let s='';new Uint8Array(buf).forEach(b=>s+=String.fromCharCode(b));return btoa(s);}
window.arrayBufToB64 = arrayBufToB64;

export function b64toBlob(b64,mime){const s=atob(b64),a=new Uint8Array(s.length);for(let i=0;i<s.length;i++)a[i]=s.charCodeAt(i);return new Blob([a],{type:mime});}
window.b64toBlob = b64toBlob;

export function calcPfpCooldown(iso){
  if(!iso) return {can:true,daysLeft:0};
  const diff=(Date.now()-new Date(iso).getTime())/(864e5);
  return diff>=PFP_COOLDOWN_DAYS
    ? {can:true,daysLeft:0}
    : {can:false,daysLeft:Math.ceil(PFP_COOLDOWN_DAYS-diff)};
}
window.calcPfpCooldown = calcPfpCooldown;

export async function loadPfpCooldown(){
  const {data}=await sb
    .from('kizuna_profiles')
    .select('avatar_updated_at')
    .eq('id',state.myId)
    .single();

  state.myAvatarUpdatedAt=data?.avatar_updated_at||state.myAvatarUpdatedAt;

  const res=calcPfpCooldown(state.myAvatarUpdatedAt);
  state._pfpCanChange=res.can;
  state._pfpDaysLeft=res.daysLeft;
  return res;
}
window.loadPfpCooldown = loadPfpCooldown;

export function canChangePfp(){
  return {can:state._pfpCanChange,daysLeft:state._pfpDaysLeft};
}
window.canChangePfp = canChangePfp;

export function esc(t){if(!t)return '';const d=document.createElement('div');d.appendChild(document.createTextNode(String(t)));return d.innerHTML;}
window.esc = esc;

export function timeAgo(ts){const s=Math.floor((Date.now()-ts)/1000);if(s<10)return 'just now';if(s<60)return s+'s';const m=Math.floor(s/60);if(m<60)return m+'m';const h=Math.floor(m/60);if(h<24)return h+'h';const d=Math.floor(h/24);return d+'d';}
window.timeAgo = timeAgo;

export function fmtFull(ts){return new Date(ts).toLocaleString([],{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});}
window.fmtFull = fmtFull;

export const getAvatarUrl=(catId,i,ext)=>`${BASE_CDN}/${catId}/${i}.${ext}`;
window.getAvatarUrl = getAvatarUrl;

export const getAvatarCacheAll=()=>{ try{ return JSON.parse(localStorage.getItem(PFP_LS_KEY)||'{}') }catch{ return {} } };
window.getAvatarCacheAll = getAvatarCacheAll;

export const getAvatarFromCache=uid=>getAvatarCacheAll()[uid]||null;
window.getAvatarFromCache = getAvatarFromCache;

export const avImg=src=>`<img src="${src}" style="width:100%;height:100%;object-fit:cover;border-radius:50%" alt="" onerror="this.style.display='none'">`;
window.avImg = avImg;

