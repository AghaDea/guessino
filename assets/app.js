const { createClient } = window.supabase;
const sb = createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

const $ = id => document.getElementById(id);
let mode = "login";
let me = null;
let deviceId = localStorage.getItem("banana_device_id");
if (!deviceId) {
  deviceId = crypto.randomUUID ? crypto.randomUUID() : ("d-" + Date.now() + "-" + Math.random().toString(36).slice(2));
  localStorage.setItem("banana_device_id", deviceId);
}
let clickQueue = 0, flushing = false, challenge = null;

function toast(s) {
  const t = $("toast"); t.textContent = s; t.className = "show";
  clearTimeout(window.__toast); window.__toast = setTimeout(() => t.className="", 2200);
}
function fmt(n){ return Number(n||0).toLocaleString(); }
function xpNeed(level){ return 100 + Math.max(0, level-1)*35; }
function showModal(html){ $("modalBody").innerHTML=html; $("modal").classList.remove("hidden"); }
function closeModal(){ $("modal").classList.add("hidden"); $("modalBody").innerHTML=""; }
$("modalClose").onclick=closeModal; $("modal").querySelector(".modal-bg").onclick=closeModal;

function setAuthTab(m){
  mode=m; $("loginTab").classList.toggle("active",m==="login"); $("registerTab").classList.toggle("active",m==="register");
  $("authSubmit").textContent=m==="login"?"Login":"Create account"; $("password").autocomplete=m==="login"?"current-password":"new-password"; $("authMsg").textContent="";
}
$("loginTab").onclick=()=>setAuthTab("login"); $("registerTab").onclick=()=>setAuthTab("register");

async function boot(){
  const loading=$("loading");
  const auth=$("auth");

  const fail=(message)=>{
    loading.classList.add("hidden");
    auth.classList.remove("hidden");
    $("authMsg").textContent=message;
    console.error("[Banana]",message);
  };

  try{
    if(!window.SUPABASE_URL || !window.SUPABASE_ANON_KEY ||
       window.SUPABASE_URL.includes("YOUR_") ||
       window.SUPABASE_ANON_KEY.includes("YOUR_")){
      fail("Supabase is not configured. Open assets/config.js and enter your Project URL and anon/publishable key.");
      return;
    }

    if(!window.supabase || typeof window.supabase.createClient!=="function"){
      fail("Supabase library did not load. Check your internet connection or the Supabase CDN.");
      return;
    }

    const sessionPromise=sb.auth.getSession();
    const timeout=new Promise((_,reject)=>
      setTimeout(()=>reject(new Error("Supabase connection timed out. Check your internet connection, Supabase URL, and API key.")),10000)
    );
    const result=await Promise.race([sessionPromise,timeout]);
    const session=result?.data?.session;

    if(session){
      await enter(session);
    }else{
      loading.classList.add("hidden");
      auth.classList.remove("hidden");
    }
  }catch(err){
    fail(err?.message || "Could not connect to Supabase.");
  }
}

sb.auth.onAuthStateChange((event,session)=>{
  if(event==="SIGNED_OUT"){
    me=null;
    $("app").classList.add("hidden");
    $("loading").classList.add("hidden");
    $("auth").classList.remove("hidden");
  }
  // Initial session is handled by boot(). Avoid calling enter() twice.
});

async function usernameExists(username){
  const {data,error}=await sb.rpc("username_available",{p_username:username});
  if(error) throw error;
  return data === false;
}
async function authSubmit(e){
  e.preventDefault(); $("authSubmit").disabled=true; $("authMsg").textContent="";
  const username=$("username").value.trim().toLowerCase(), password=$("password").value;
  try{
    if(!/^[a-z0-9_]{3,24}$/.test(username)) throw new Error("Username: 3-24 characters, letters/numbers/_ only.");
    if(mode==="register"){
      if(password.length<6) throw new Error("Password must be at least 6 characters.");
      if(await usernameExists(username)) throw new Error("Username is already taken.");
      const fakeEmail=`${username}@banana.invalid`;
      const {data,error}=await sb.auth.signUp({email:fakeEmail,password});
      if(error) throw error;
      if(!data.session) throw new Error("Registration succeeded, but email confirmation is enabled. Disable Confirm email in Supabase Auth settings.");
      toast("Account created");
      await enter(data.session);
    }else{
      const fakeEmail=`${username}@banana.invalid`;
      const {data,error}=await sb.auth.signInWithPassword({email:fakeEmail,password});
      if(error) throw error;
      await enter(data.session);
    }
  }catch(err){ $("authMsg").textContent=err.message||"Something went wrong"; }
  $("authSubmit").disabled=false;
}
$("authForm").onsubmit=authSubmit;

async function enter(session){
  $("loading").classList.remove("hidden"); $("auth").classList.add("hidden");
  try{
    const rpcPromise=sb.rpc("enter_app",{p_device_id:deviceId});
    const timeout=new Promise((_,reject)=>
      setTimeout(()=>reject(new Error("Supabase did not respond within 10 seconds.")),10000)
    );
    const {data,error}=await Promise.race([rpcPromise,timeout]);
    if(error) throw error;
  if(!data.allowed){
    await sb.auth.signOut(); $("loading").classList.add("hidden"); $("auth").classList.remove("hidden");
    $("authMsg").textContent=data.message||"Access denied."; return;
  }
    me=data.profile;
    $("topUser").textContent="@"+me.username;
    $("profileName").textContent="@"+me.username;
    $("avatar").textContent=me.username[0].toUpperCase();
    $("profileJoined").textContent="Joined "+new Date(me.created_at).toLocaleDateString();
    $("adminBox").classList.toggle("hidden",!me.is_admin);
    $("app").classList.remove("hidden"); $("loading").classList.add("hidden");
    await refreshGame(); await refreshChallenge(); await refreshRanks(); renderProfile();
  }catch(err){
    console.error("[Banana enter]",err);
    try{await sb.auth.signOut();}catch(_){}
    $("loading").classList.add("hidden");
    $("auth").classList.remove("hidden");
    $("authMsg").textContent=err?.message || "Could not enter the app.";
  }
}

async function refreshGame(){
  const {data,error}=await sb.rpc("get_my_game");
  if(error){toast(error.message);return}
  me={...me,...data};
  renderGame();
}
function renderGame(){
  $("coins").textContent=fmt(me.coins); $("level").textContent=me.level; $("power").textContent=me.click_power;
  const need=xpNeed(me.level), pct=Math.min(100,(me.xp/need)*100);
  $("xpText").textContent=`${fmt(me.xp)} / ${fmt(need)}`; $("xpBar").style.width=pct+"%";
  $("upgradeCost").textContent=fmt(me.upgrade_cost);
}
async function flushClicks(){
  if(flushing || clickQueue<=0) return;
  flushing=true; const amount=clickQueue; clickQueue=0;
  try{
    const {data,error}=await sb.rpc("add_clicks",{p_amount:amount,p_device_id:deviceId});
    if(error) throw error;
    me={...me,...data}; renderGame();
  }catch(e){ clickQueue+=amount; toast(e.message); }
  flushing=false;
}
$("coinButton").onclick=()=>{
  if(!me)return;
  clickQueue++;
  me.coins=Number(me.coins)+Number(me.click_power); me.xp=Number(me.xp)+1;
  const need=xpNeed(me.level);
  if(me.xp>=need){me.xp-=need;me.level++;me.click_power++;me.upgrade_cost=Math.floor(25*Math.pow(1.65,me.level-1));toast("Level up!");}
  renderGame();
  const f=document.createElement("span"); f.className="float"; f.textContent="+"+me.click_power;
  f.style.left=(35+Math.random()*30)+"%"; f.style.top=(38+Math.random()*15)+"%"; $("floaters").appendChild(f); setTimeout(()=>f.remove(),800);
  if(clickQueue>=8) flushClicks();
};
setInterval(flushClicks,1500);
document.addEventListener("visibilitychange",()=>{if(document.hidden)flushClicks()});
window.addEventListener("beforeunload",()=>{ if(clickQueue>0) navigator.sendBeacon?.("", ""); });

$("upgradeBtn").onclick=async()=>{
  await flushClicks();
  const {data,error}=await sb.rpc("buy_upgrade",{p_device_id:deviceId});
  if(error){toast(error.message);return}
  me={...me,...data};renderGame();toast("Power upgraded");
};

async function refreshChallenge(){
  const {data,error}=await sb.rpc("get_daily_challenge");
  if(error){$("challengeText").textContent="Unavailable";return}
  challenge=data; $("challengeText").textContent=`${challenge.progress}/${challenge.target} clicks`;
}
$("challengeBtn").onclick=async()=>{
  await refreshChallenge();
  showModal(`<h2>Daily Challenge</h2><div class="mini-grid"><div class="mini"><small>Goal</small><b>${fmt(challenge.target)} clicks</b></div><div class="mini"><small>Progress</small><b>${fmt(challenge.progress)} / ${fmt(challenge.target)}</b></div></div><button class="primary wide" style="margin-top:12px" onclick="closeModal()">Close</button>`);
};

async function refreshRanks(){
  const q=$("rankSearch").value.trim();
  const {data,error}=await sb.rpc("leaderboard",{p_search:q,p_limit:50});
  if(error){$("rankList").innerHTML=`<p class="muted">${error.message}</p>`;return}
  $("rankList").innerHTML=data.map((u,i)=>`
    <button class="rank-row" onclick="openUser('${u.id}')">
      <span class="rank-num">${i+1}</span><span class="rank-avatar">${u.username[0].toUpperCase()}</span>
      <span class="rank-main"><b>@${u.username}</b><small>Level ${u.level} · ${fmt(u.xp)} XP</small></span>
      <span class="rank-score"><b>${fmt(u.coins)}</b><small>coins</small></span>
    </button>`).join("") || `<p class="muted">No users found.</p>`;
}
$("rankSearch").oninput=()=>{clearTimeout(window.__rs);window.__rs=setTimeout(refreshRanks,250)};

async function openUser(id){
  const {data,error}=await sb.rpc("public_profile",{p_user_id:id});
  if(error){toast(error.message);return}
  const admin=me.is_admin;
  showModal(`<h2>@${data.username}</h2>
  <div class="mini-grid">
    <div class="mini"><small>Level</small><b>${data.level}</b></div>
    <div class="mini"><small>XP</small><b>${fmt(data.xp)}</b></div>
    <div class="mini"><small>Coins</small><b>${fmt(data.coins)}</b></div>
    <div class="mini"><small>Total clicks</small><b>${fmt(data.total_clicks)}</b></div>
    <div class="mini"><small>Joined</small><b>${new Date(data.created_at).toLocaleDateString()}</b></div>
    <div class="mini"><small>Last seen</small><b>${data.last_seen?new Date(data.last_seen).toLocaleString():"—"}</b></div>
  </div>
  ${admin?`<hr style="border-color:#29292f;margin:18px 0"><h3>Admin actions</h3>
  <label>Ban type</label><select id="banType"><option value="account">Account</option><option value="device">Device</option></select>
  <label>Duration</label><select id="banDays"><option value="1">1 day</option><option value="7">7 days</option><option value="30">30 days</option><option value="3650">Permanent</option></select>
  <input id="banReason" placeholder="Reason (optional)">
  <button class="danger wide" onclick="adminBan('${data.id}')">Ban user</button>`:""}`);
}
async function adminBan(id){
  const type=$("banType").value, days=Number($("banDays").value), reason=$("banReason").value.trim();
  const {data,error}=await sb.rpc("admin_ban",{p_user_id:id,p_type:type,p_days:days,p_reason:reason});
  if(error){toast(error.message);return} toast("Ban created"); closeModal(); refreshRanks();
}

function renderProfile(){
  $("myStats").innerHTML=`
  <div class="profile-stat"><small>Coins</small><b>${fmt(me.coins)}</b></div>
  <div class="profile-stat"><small>Level</small><b>${me.level}</b></div>
  <div class="profile-stat"><small>XP</small><b>${fmt(me.xp)}</b></div>
  <div class="profile-stat"><small>Total clicks</small><b>${fmt(me.total_clicks)}</b></div>
  <div class="profile-stat"><small>Power</small><b>${me.click_power}</b></div>
  <div class="profile-stat"><small>Streak</small><b>${me.streak} days</b></div>`;
}
$("changePasswordBtn").onclick=()=>{
  showModal(`<h2>Change password</h2><input id="newPass" type="password" minlength="6" placeholder="New password"><button class="primary wide" onclick="changePassword()">Save password</button>`);
};
window.changePassword=async()=>{
  const p=$("newPass").value;if(p.length<6){toast("Minimum 6 characters");return}
  const {error}=await sb.auth.updateUser({password:p}); if(error){toast(error.message);return}
  toast("Password changed");closeModal();
};
$("sessionsBtn").onclick=async()=>{
  const {data,error}=await sb.rpc("my_devices");if(error){toast(error.message);return}
  showModal(`<h2>My devices</h2>${data.map(d=>`<div class="rank-row"><span class="rank-avatar">D</span><span class="rank-main"><b>${d.device_id===deviceId?"This device":"Device"}</b><small>Last seen ${new Date(d.last_seen).toLocaleString()}</small></span></div>`).join("")}<button class="primary wide" style="margin-top:12px" onclick="closeModal()">Close</button>`);
};
$("logoutBtn").onclick=async()=>{await flushClicks();await sb.auth.signOut();location.reload()};
$("settingsBtn").onclick=()=>showModal(`<h2>Settings</h2><p class="muted">Your game data is stored in Supabase. Session authentication is handled by Supabase Auth.</p><button class="secondary wide" onclick="closeModal()">Close</button>`);

document.querySelectorAll(".nav-item").forEach(b=>b.onclick=()=>{
  document.querySelectorAll(".nav-item").forEach(x=>x.classList.remove("active"));b.classList.add("active");
  document.querySelectorAll(".page").forEach(p=>p.classList.add("hidden"));$(b.dataset.page).classList.remove("hidden");
});
boot();
