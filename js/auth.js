import { state } from './state.js?v=11';
import { DEFAULT_ROOM, sb, PFP_LS_KEY } from './config.js?v=11';
import { getAvatarCacheAll, setAvatarCache, avImg } from './utils.js?v=11';
import { setupSignaling } from './webrtc.js?v=11';
import { setupPresence } from './presence.js?v=11';
import { setSBStatus, flashInput, updateSBBar, sysMsg, showToast, initBubbleTap } from './ui.js?v=11';
import { loadLocalMessages, loadHistoryFromSupabase } from './chat.js?v=11';
import { initScroll } from './main.js?v=11';

export function switchAuthTab(tab){
  document.getElementById('tabLogin').classList.toggle('act',tab==='login');
  document.getElementById('tabSignup').classList.toggle('act',tab==='signup');
  document.getElementById('loginForm').style.display=tab==='login'?'':'none';
  document.getElementById('signupForm').style.display=tab==='signup'?'':'none';
}
window.switchAuthTab = switchAuthTab;

export async function initAuth(){
  setSBStatus('warn','Connecting…');
  const {data:{session}}=await sb.auth.getSession();
  if(session){await enterApp(session.user);return;}
  setSBStatus('ok','Ready');
  sb.auth.onAuthStateChange(async(event,session)=>{
    if(event==='SIGNED_IN'&&session) await enterApp(session.user);
  });
}
window.initAuth = initAuth;

export async function doSignup(){
  const name=document.getElementById('signupName').value.trim();
  const email=document.getElementById('signupEmail').value.trim();
  const pass=document.getElementById('signupPassword').value;
  if(!name){flashInput('signupName');return;}
  if(!email){flashInput('signupEmail');return;}
  if(pass.length<6){flashInput('signupPassword');showToast('Password min 6 chars');return;}
  const btn=document.getElementById('signupBtn');
  btn.disabled=true; setSBStatus('warn','Creating account…');
  const {data,error}=await sb.auth.signUp({email,password:pass});
  if(error){setSBStatus('err',error.message);btn.disabled=false;return;}
  if(data.user) await sb.from('kizuna_profiles').upsert({id:data.user.id,name,avatar_url:'',created_at:new Date().toISOString()},{onConflict:'id'});
  setSBStatus('ok','Account created!');
  btn.disabled=false;
}
window.doSignup = doSignup;

export async function doLogin(){
  const email=document.getElementById('loginEmail').value.trim();
  const pass=document.getElementById('loginPassword').value;
  if(!email){flashInput('loginEmail');return;}
  if(!pass){flashInput('loginPassword');return;}
  const btn=document.getElementById('loginBtn');
  btn.disabled=true; setSBStatus('warn','Signing in…');
  const {error}=await sb.auth.signInWithPassword({email,password:pass});
  if(error){setSBStatus('err',error.message);btn.disabled=false;}
}
window.doLogin = doLogin;

export async function enterApp(user){
  state.myId=user.id; state.myRoom=DEFAULT_ROOM;
  const {data:profile}=await sb
  .from('kizuna_profiles')
  .select('name,avatar_url,avatar_updated_at')
  .eq('id',state.myId)
  .single();
  console.log(profile, state.myId, user)

  state.myName = profile?.name || user.email.split('@')[0];
  state.myAvatarUrl = profile?.avatar_url || '';
  state.myAvatarUpdatedAt = profile?.avatar_updated_at || null;

  // Push into local cache so everything downstream works
  if(state.myAvatarUrl){
    setAvatarCache(state.myId, state.myAvatarUrl, state.myAvatarUpdatedAt);
  } else {
    // Clear stale local cache if DB says no avatar
    const all = getAvatarCacheAll();
    delete all[state.myId];
    localStorage.setItem(PFP_LS_KEY, JSON.stringify(all));
  }
  if(state.myAvatarUrl) setAvatarCache(state.myId,state.myAvatarUrl,state.myAvatarUpdatedAt);
  document.getElementById('myAvTb').innerHTML=avImg(state.myAvatarUrl);
  document.getElementById('topRoomName').textContent='#'+state.myRoom;
  document.getElementById('loginScreen').classList.add('hide');
  const app=document.getElementById('app');
  app.style.display='flex'; app.style.flexDirection='column';
  app.style.height='100dvh'; app.style.overflow='hidden';
  initScroll(); initBubbleTap();
  loadLocalMessages();
  await loadHistoryFromSupabase();
  setupPresence(); setupSignaling();
  sysMsg('You joined #'+state.myRoom);
  updateSBBar(); setSBStatus('ok','Connected');
}
window.enterApp = enterApp;

export async function doSignOut() {
  const btn = document.querySelector('button[onclick="doSignOut()"]');
  if(btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Signing out...'; }
  await sb.auth.signOut();
  window.location.reload();
}
window.doSignOut = doSignOut;
