/* ==========================================================
   auth.js — ด่านเข้าระบบ: คีย์ + ล็อกอิน Discord (Supabase Auth)
   ลำดับ: ใส่คีย์ → เข้าสู่ระบบด้วย Discord → ระบบแลกคีย์ที่ฐานข้อมูล
          (ครั้งต่อไปไม่ต้องใส่คีย์อีก เพราะบัญชี Discord ถูกบันทึกเป็นสมาชิกแล้ว)
   ถ้ายังไม่ได้ตั้ง SUPABASE_URL ใน config.js → ข้ามด่านนี้ (โหมดในเครื่อง)
   ========================================================== */
window.Auth = (() => {
const CFG = window.AI_CONFIG, $ = s => document.querySelector(s);
const enabled = !!(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY);
const api = { enabled, cloud: false, sb: null, user: null, profile: null };
const PENDING = 'fa_pending_key';

function setMsg(t, bad) { const m = $('#gMsg'); m.textContent = t || ''; m.classList.toggle('bad', !!bad); }
function state(s, msg, bad) {
  const g = $('#gate'); g.hidden = false; g.dataset.state = s;
  requestAnimationFrame(() => g.classList.add('show')); setMsg(msg, bad);
}
function hide() { const g = $('#gate'); g.classList.remove('show'); setTimeout(() => { g.hidden = true; }, 600); }
function who() {
  const m = (api.user && api.user.user_metadata) || {};
  return m.custom_claims?.global_name || m.full_name || m.name || 'ผู้เยี่ยมเยือน';
}
function fail(e) {
  const t = String(e && e.message || e);
  state('error', /relation .* does not exist|schema cache|members/i.test(t)
    ? 'อ่านฐานข้อมูลไม่ได้ — ยังไม่ได้รัน supabase/schema.sql ใช่ไหม? (' + t + ')'
    : 'เกิดข้อผิดพลาด: ' + t, true);
}

async function getMember() {
  const { data, error } = await api.sb.from('members').select('user_id,discord_name,avatar_url').eq('user_id', api.user.id).maybeSingle();
  if (error) throw error;
  return data;
}
async function redeem(key) {
  const { data, error } = await api.sb.rpc('redeem_key', { p_key: key });
  if (error) {
    if (/too_many_attempts/.test(error.message)) return { ok: false, error: 'ใส่คีย์ผิดบ่อยเกินไป — รอ 15 นาทีแล้วลองใหม่' };
    return { ok: false, error: 'ตรวจคีย์ไม่สำเร็จ: ' + error.message };
  }
  return data === true ? { ok: true } : { ok: false, error: 'คีย์ไม่ถูกต้อง' };
}

async function check() {
  try {
    const { data: { session } } = await api.sb.auth.getSession();
    if (!session) return state('login');
    api.user = session.user; state('loading', 'กำลังตรวจสอบสิทธิ์…');
    let prof = await getMember();
    const pending = sessionStorage.getItem(PENDING);
    if (!prof && pending) {
      sessionStorage.removeItem(PENDING);
      const r = await redeem(pending);
      if (r.ok) prof = await getMember();
      else { $('#gWho').textContent = who(); return state('needkey', r.error, true); }
    }
    if (prof) { api.profile = prof; hide(); api._resolve(api); }
    else { $('#gWho').textContent = who(); state('needkey'); }
  } catch (e) { fail(e); }
}

function bind() {
  const login = async () => {
    const key = $('#gKey').value.trim();
    if (key) sessionStorage.setItem(PENDING, key); else sessionStorage.removeItem(PENDING);
    setMsg('กำลังพาไปที่ Discord…');
    const { error } = await api.sb.auth.signInWithOAuth({
      provider: 'discord', options: { redirectTo: location.origin + location.pathname }
    });
    if (error) setMsg('เข้าสู่ระบบไม่สำเร็จ: ' + error.message, true);
  };
  const doRedeem = async () => {
    const key = $('#gKey2').value.trim();
    if (!key) return setMsg('ใส่คีย์ก่อนนะ', true);
    setMsg('กำลังตรวจคีย์…');
    const r = await redeem(key);
    if (r.ok) { $('#gKey2').value = ''; check(); } else setMsg(r.error, true);
  };
  $('#gDiscord').onclick = login;
  $('#gKey').addEventListener('keydown', e => { if (e.key === 'Enter') login(); });
  $('#gRedeem').onclick = doRedeem;
  $('#gKey2').addEventListener('keydown', e => { if (e.key === 'Enter') doRedeem(); });
  $('#gSignOut').onclick = () => api.signOut();
  $('#gRetry').onclick = () => location.reload();
}

api.start = async function () {
  if (!enabled) return api;
  bind();
  if (!window.supabase) { state('error', 'โหลดไลบรารี Supabase ไม่สำเร็จ (เช็กอินเทอร์เน็ต)', true); return new Promise(() => {}); }
  api.sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' }
  });
  api.cloud = true;
  state('loading', 'กำลังเตรียมโรงละคร…');
  api.sb.auth.onAuthStateChange(ev => { if (ev === 'SIGNED_OUT') location.reload(); });
  return new Promise(resolve => { api._resolve = resolve; check(); });
};
api.token = async () => (await api.sb.auth.getSession()).data.session?.access_token;
api.signOut = async () => { try { await api.sb.auth.signOut(); } finally { location.reload(); } };
api.displayName = () => api.profile?.discord_name || who();
return api;
})();
