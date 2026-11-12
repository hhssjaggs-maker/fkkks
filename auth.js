/* ==========================================================
   auth.js — ด่านเข้าระบบ: ล็อกอินด้วย Google หรือ Discord (Supabase Auth)
   ไม่มีคีย์แล้ว — กดปุ่มแล้วเข้าได้เลย
   ถ้ายังไม่ได้ตั้ง SUPABASE_URL ใน config.js → ข้ามด่านนี้ (โหมดในเครื่อง)
   ========================================================== */
window.Auth = (() => {
const CFG = window.AI_CONFIG, $ = s => document.querySelector(s);
const enabled = !!(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY);
const api = { enabled, cloud: false, sb: null, user: null, profile: null, guest: false };
const GUEST = 'fa_guest';
const VER = 'auth v3';
let log = []; try { log = JSON.parse(sessionStorage.getItem('fa_auth_log') || '[]'); } catch {}
function note(t) {
  const d = new Date(), p = n => String(n).padStart(2, '0');
  log.push(p(d.getMinutes()) + ':' + p(d.getSeconds()) + ' ' + t); log = log.slice(-14);
  try { sessionStorage.setItem('fa_auth_log', JSON.stringify(log)); } catch {}
  const el = document.querySelector('#gLog'); if (el) el.textContent = VER + ' · ' + log.join(' › ');
}

function setMsg(t, bad) { const m = $('#gMsg'); m.textContent = t || ''; m.classList.toggle('bad', !!bad); }
function state(s, msg, bad) {
  note('state:' + s);
  const g = $('#gate'); g.hidden = false; g.dataset.state = s;
  requestAnimationFrame(() => g.classList.add('show')); setMsg(msg, bad);
}
function hide() { const g = $('#gate'); g.classList.remove('show'); setTimeout(() => { g.hidden = true; }, 600); }
function meta() { return (api.user && api.user.user_metadata) || {}; }
function who() {
  const m = meta();
  return m.custom_claims?.global_name || m.full_name || m.name || api.user?.email || 'ผู้เยี่ยมเยือน';
}
function fail(e) {
  const t = String(e && e.message || e);
  state('error', /relation .* does not exist|schema cache|touch_profile|function .* does not exist/i.test(t)
    ? 'อ่านฐานข้อมูลไม่ได้ — ยังไม่ได้รัน supabase/schema.sql ใช่ไหม? (' + t + ')'
    : 'เกิดข้อผิดพลาด: ' + t, true);
}

async function check() {
  try {
    const { data: { session } } = await api.sb.auth.getSession();
    if (!session) return state('login');
    api.user = session.user; state('loading', 'กำลังตรวจสอบสิทธิ์…');
    const { data: ok, error } = await api.sb.rpc('touch_profile');
    if (error) throw error;
    if (!ok) { $('#gWho').textContent = who(); return state('denied'); }
    const m = meta();
    api.profile = {
      name: who(), avatar_url: m.avatar_url || m.picture || '',
      provider: api.user.app_metadata?.provider || ''
    };
    hide(); api._resolve(api);
  } catch (e) { fail(e); }
}

async function oauth(provider) {
  setMsg('กำลังพาไปที่ ' + (provider === 'google' ? 'Google' : 'Discord') + '…');
  const { error } = await api.sb.auth.signInWithOAuth({
    provider, options: { redirectTo: location.origin + location.pathname }
  });
  if (error) setMsg('เข้าสู่ระบบไม่สำเร็จ: ' + error.message, true);
}

function bind() {
  $('#gGoogle').onclick = () => oauth('google');
  $('#gDiscord').onclick = () => oauth('discord');
  $('#gSignOut').onclick = () => api.signOut();
  $('#gRetry').onclick = () => location.reload();
  const gl = $('#gGuest');
  if (gl) {
    gl.hidden = !CFG.ALLOW_GUEST;
    gl.onclick = () => { try { localStorage.setItem(GUEST, '1'); } catch {} location.reload(); };
  }
}

api.start = async function () {
  if (!enabled) return api;
  let guest = false; try { guest = CFG.ALLOW_GUEST && localStorage.getItem(GUEST) === '1'; } catch {}
  if (guest) { api.guest = true; return api; }           // โหมดผู้เยี่ยมเยือน (เก็บในเครื่อง)
  note('start ' + (location.search.includes('code=') ? 'with-code' : 'no-code'));
  bind();
  if (!window.supabase) { state('error', 'โหลดไลบรารี Supabase ไม่สำเร็จ (เช็กอินเทอร์เน็ต)', true); return new Promise(() => {}); }
  api.sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' }
  });
  api.cloud = true;
  state('loading', 'กำลังเตรียมโรงละคร…');
  api.sb.auth.onAuthStateChange((ev, sess) => {
    note(ev + (sess ? '+session' : ''));
    if (ev !== 'SIGNED_OUT' || api._leaving) return;
    // ถูกออกจากระบบโดยไม่ได้กดเอง → เช็กซ้ำก่อน ไม่รีโหลดวนๆ
    setTimeout(async () => {
      const { data: { session } } = await api.sb.auth.getSession();
      if (!session) state('error', 'ระบบถูกออกจากระบบเอง (SIGNED_OUT) · เหตุการณ์: ' + log.join(' › ') + ' — กด "ลองใหม่" แล้วล็อกอินอีกครั้ง; ถ้ายังซ้ำ แคปหน้านี้ส่งให้ผู้ช่วย', true);
    }, 600);
  });
  return new Promise(resolve => { api._resolve = resolve; check(); });
};
api.token = async () => (await api.sb.auth.getSession()).data.session?.access_token;
api.signOut = async () => {
  api._leaving = true;
  try { localStorage.removeItem(GUEST); } catch {}
  try { if (api.sb) await api.sb.auth.signOut(); } finally { location.reload(); }
};
api.displayName = () => api.profile?.name || (api.guest ? 'ผู้เยี่ยมเยือน' : 'คุณ');
return api;
})();
