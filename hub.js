/* ==========================================================
   hub.js — "ชุมชน" ใน Lobby: ห้องแชตแบบ Discord + ห้องคุยเสียง
   - ข้อความ: ตาราง hub_channels / hub_messages (supabase/hub.sql) + Realtime
   - เสียง: WebRTC ต่อกันตรงๆ (mesh) โดยใช้ Supabase Realtime จับคู่ (ไม่ต้องมีตาราง)
   ต้องล็อกอิน (Auth.cloud) · ต่อ Minecraft ภายหลังผ่านตาราง hub_messages (source='mc')
   ========================================================== */
window.Hub = (() => {
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const CFG = window.AI_CONFIG || {}, A = () => window.Auth, B = () => window.AppBridge;
const ic = (n, c = '') => `<svg class="i ${c}" aria-hidden="true"><use href="#i-${n}"/></svg>`;
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sb = () => A().sb;
const ICE = CFG.ICE_SERVERS || [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }];
const VROOMS = CFG.VOICE_ROOMS || [{ id: 'lounge', name: 'ห้องรวม', desc: 'คุยเล่นทั่วไป' }, { id: 'game', name: 'ห้องเกม', desc: 'เล่นเกมไปคุยไป' }, { id: 'chill', name: 'ห้องชิล', desc: 'นั่งชิลๆ' }];
const MAXV = CFG.VOICE_MAX || 8;
const VCHAN = CFG.VOICE_CHANNEL || 'fa-voice-v1';
let started = false, tab = 'text';

const me = { key: (crypto.randomUUID && crypto.randomUUID()) || String(Math.random()).slice(2), name: '', avatar: '' };
const initial = n => (String(n || '?').trim()[0] || '?').toUpperCase();
const avatarHtml = (name, url, cls = '') => url
  ? `<span class="av ${cls}"><img src="${esc(url)}" alt="" referrerpolicy="no-referrer"></span>`
  : `<span class="av ${cls}">${esc(initial(name))}</span>`;
const toast = t => B()?.toast?.(t);

/* ===================== ข้อความ ===================== */
const T = { chans: [], cur: null, msgs: new Map(), unread: new Set(), sub: null };

async function loadChans() {
  const { data, error } = await sb().from('hub_channels').select('id,name').order('created_at', { ascending: true });
  if (error) { textNote('อ่านห้องแชตไม่ได้ — ยังไม่ได้รัน supabase/hub.sql ใช่ไหม? (' + error.message + ')'); return; }
  T.chans = data || [];
  if (!T.cur || !T.chans.find(c => c.id === T.cur)) T.cur = T.chans[0]?.id || null;
  textNote(''); renderChans(); await loadMsgs();
}
async function loadMsgs() {
  if (!T.cur) { renderMsgs(); return; }
  const { data, error } = await sb().from('hub_messages').select('id,channel_id,user_id,author_name,avatar_url,body,source,created_at')
    .eq('channel_id', T.cur).order('created_at', { ascending: false }).limit(60);
  if (error) { textNote('โหลดข้อความไม่ได้: ' + error.message); return; }
  T.msgs.set(T.cur, (data || []).slice().reverse()); renderMsgs(true);
}
function subscribeText() {
  T.sub = sb().channel('hub-db')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'hub_messages' }, p => addMsg(p.new))
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'hub_channels' }, p => {
      if (!T.chans.find(c => c.id === p.new.id)) { T.chans.push({ id: p.new.id, name: p.new.name }); renderChans(); }
    })
    .subscribe();
}
function addMsg(row) {
  if (!row || !row.id) return;
  const list = T.msgs.get(row.channel_id) || (T.msgs.set(row.channel_id, []), T.msgs.get(row.channel_id));
  if (list.some(m => m.id === row.id)) return;
  list.push(row); if (list.length > 200) list.shift();
  if (row.channel_id === T.cur && tab === 'text') renderMsgs(false);
  else { T.unread.add(row.channel_id); renderChans(); badge(); }
}
function textNote(t) { const n = $('#hubTextNote'); n.textContent = t || ''; n.hidden = !t; }
function renderChans() {
  const box = $('#hubChans');
  box.innerHTML = T.chans.map(c => `<button class="ch-chip${c.id === T.cur ? ' on' : ''}${T.unread.has(c.id) ? ' unread' : ''}" data-c="${esc(c.id)}"><b>#</b>${esc(c.name)}</button>`).join('')
    + `<button class="ch-chip add" id="hubAddCh" title="สร้างห้องแชต">${ic('plus')}</button>`;
}
const hhmm = iso => { const d = new Date(iso); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
function renderMsgs(forceBottom) {
  const box = $('#hubMsgs'), list = T.msgs.get(T.cur) || [];
  const near = box.scrollHeight - box.scrollTop - box.clientHeight < 90;
  if (!T.cur) { box.innerHTML = '<p class="empty-note">ยังไม่มีห้องแชต — กด + เพื่อสร้าง</p>'; return; }
  if (!list.length) { box.innerHTML = '<p class="empty-note">ยังไม่มีข้อความในห้องนี้ — เริ่มทักทายเลย 👋</p>'; return; }
  let html = '', prev = null;
  list.forEach(m => {
    const grp = prev && prev.author_name === m.author_name && prev.source === m.source && (new Date(m.created_at) - new Date(prev.created_at)) < 300000;
    html += `<div class="hm${grp ? ' grp' : ''}${m.user_id && m.user_id === (A().user && A().user.id) ? ' mine' : ''}">`
      + (grp ? '<span class="av ghost"></span>' : avatarHtml(m.author_name, m.avatar_url))
      + `<div class="hm-b">${grp ? '' : `<div class="hm-h"><b>${esc(m.author_name)}</b>${m.source === 'mc' ? '<i class="mc-b">MC</i>' : ''}<small>${hhmm(m.created_at)}</small></div>`}<p>${esc(m.body)}</p></div></div>`;
    prev = m;
  });
  box.innerHTML = html;
  if (forceBottom || near) box.scrollTop = box.scrollHeight;
}
async function sendText(e) {
  e.preventDefault();
  const inp = $('#hubIn'), body = inp.value.trim(); if (!body || !T.cur) return;
  inp.value = '';
  const { data, error } = await sb().from('hub_messages').insert({ channel_id: T.cur, body }).select().single();
  if (error) { inp.value = body; toast('ส่งไม่สำเร็จ: ' + error.message); return; }
  if (data) addMsg(data);
}
async function createChan(e) {
  e.preventDefault();
  const inp = $('#hubNewChName'), name = inp.value.trim().replace(/\s+/g, '-').slice(0, 24); if (!name) return;
  const { data, error } = await sb().from('hub_channels').insert({ name }).select().single();
  if (error) { toast(/duplicate|unique/i.test(error.message) ? 'มีห้องชื่อนี้อยู่แล้ว' : 'สร้างห้องไม่สำเร็จ: ' + error.message); return; }
  inp.value = ''; $('#hubNewCh').hidden = true;
  if (!T.chans.find(c => c.id === data.id)) T.chans.push({ id: data.id, name: data.name });
  T.cur = data.id; renderChans(); loadMsgs();
}
$('#hubChans').addEventListener('click', e => {
  if (e.target.closest('#hubAddCh')) { const f = $('#hubNewCh'); f.hidden = !f.hidden; if (!f.hidden) $('#hubNewChName').focus(); return; }
  const b = e.target.closest('[data-c]'); if (!b) return;
  T.cur = b.dataset.c; T.unread.delete(T.cur); renderChans(); badge(); loadMsgs();
});
$('#hubForm').addEventListener('submit', sendText);
$('#hubNewCh').addEventListener('submit', createChan);
function badge() { const d = $('#hubTabs [data-t=text]'); d && d.classList.toggle('has-new', T.unread.size > 0); }

/* ===================== เสียง (WebRTC) ===================== */
const V = { ch: null, ready: false, members: {}, room: null, roomName: '', joinedAt: 0, muted: false, deaf: false, local: null, ctx: null };
const peers = new Map(), early = new Map(), fails = new Map(), levels = new Map();

const vcNote = t => { const n = $('#vcNote'); n.textContent = t || ''; n.hidden = !t; };
function connectVoice() {
  V.ch = sb().channel(VCHAN, { config: { broadcast: { self: false }, presence: { key: me.key } } });
  V.ch.on('presence', { event: 'sync' }, onSync);
  V.ch.on('broadcast', { event: 'sig' }, ({ payload }) => onSig(payload));
  V.ch.subscribe(async st => {
    if (st === 'SUBSCRIBED') { V.ready = true; vcNote(''); await track(); }
    else if (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT') vcNote('เชื่อมต่อระบบเสียงไม่ได้ (Realtime) — ลองรีเฟรชหน้า');
  });
}
const track = () => V.ch && V.ready ? V.ch.track({
  name: me.name, avatar: me.avatar, room: V.room, roomName: V.roomName, joinedAt: V.joinedAt, muted: V.muted, deaf: V.deaf, mc: M.link ? M.link.mc_name : ''
}) : Promise.resolve();

function onSync() {
  const st = V.ch.presenceState(), m = {};
  Object.entries(st).forEach(([k, arr]) => { if (arr && arr[0]) m[k] = arr[0]; });
  V.members = m; reconcile(); renderVoice();
}
function reconcile() {
  if (!V.room) return;
  const inRoom = Object.entries(V.members).filter(([k, m]) => k !== me.key && m.room === V.room);
  for (const [k, p] of [...peers]) {
    const m = V.members[k];
    if (!m || m.room !== V.room || (m.joinedAt && p.since && m.joinedAt !== p.since)) dropPeer(k);
  }
  inRoom.forEach(([k, m]) => {
    if (peers.has(k) || (fails.get(k) || 0) >= 3) return;
    const iOffer = V.joinedAt > m.joinedAt || (V.joinedAt === m.joinedAt && me.key > k);
    if (iOffer) startPeer(k, m.joinedAt);
  });
}
function sendSig(to, payload) { V.ch.send({ type: 'broadcast', event: 'sig', payload: { from: me.key, to, room: V.room, ...payload } }); }
function makePeer(k, since) {
  const pc = new RTCPeerConnection({ iceServers: ICE });
  const p = { pc, since, pending: early.get(k) || [], remote: false, state: 'connecting' };
  early.delete(k);
  if (V.local) V.local.getTracks().forEach(t => pc.addTrack(t, V.local));
  pc.onicecandidate = e => { if (e.candidate) sendSig(k, { t: 'ice', c: e.candidate.toJSON() }); };
  pc.ontrack = e => attachRemote(k, e.streams[0] || new MediaStream([e.track]));
  pc.onconnectionstatechange = () => {
    p.state = pc.connectionState; renderVoice();
    if (pc.connectionState === 'failed') {
      fails.set(k, (fails.get(k) || 0) + 1);
      setTimeout(() => { if (peers.get(k) === p) { dropPeer(k, true); reconcile(); renderVoice(); } }, 1200);
    } else if (pc.connectionState === 'connected') fails.delete(k);
  };
  peers.set(k, p); return p;
}
async function startPeer(k, since) {
  const p = makePeer(k, since);
  try {
    const o = await p.pc.createOffer(); await p.pc.setLocalDescription(o);
    sendSig(k, { t: 'offer', sdp: p.pc.localDescription.sdp });
  } catch (e) { dropPeer(k); }
}
async function flush(p) { p.remote = true; for (const c of p.pending.splice(0)) { try { await p.pc.addIceCandidate(c); } catch {} } }
async function onSig(m) {
  if (!m || m.to !== me.key || !V.room || m.room !== V.room) return;
  try {
    if (m.t === 'offer') {
      if (peers.has(m.from)) dropPeer(m.from, true);
      const p = makePeer(m.from, V.members[m.from] && V.members[m.from].joinedAt);
      await p.pc.setRemoteDescription({ type: 'offer', sdp: m.sdp }); await flush(p);
      const a = await p.pc.createAnswer(); await p.pc.setLocalDescription(a);
      sendSig(m.from, { t: 'answer', sdp: p.pc.localDescription.sdp });
    } else if (m.t === 'answer') {
      const p = peers.get(m.from); if (!p) return;
      await p.pc.setRemoteDescription({ type: 'answer', sdp: m.sdp }); await flush(p);
    } else if (m.t === 'ice') {
      const p = peers.get(m.from);
      if (p && p.remote) { try { await p.pc.addIceCandidate(m.c); } catch {} }
      else if (p) p.pending.push(m.c);
      else { const l = early.get(m.from) || []; l.push(m.c); early.set(m.from, l); }
    }
  } catch (e) { console.warn('sig', e); }
}
function attachRemote(k, stream) {
  let a = $(`#vcAudio audio[data-k="${CSS.escape(k)}"]`);
  if (!a) { a = document.createElement('audio'); a.dataset.k = k; a.autoplay = true; a.setAttribute('playsinline', ''); $('#vcAudio').append(a); }
  a.srcObject = stream; a.muted = V.deaf; a.play && a.play().catch(() => {});
  watch(k, stream);
}
function watch(k, stream) {
  try {
    if (!V.ctx) return;
    const src = V.ctx.createMediaStreamSource(stream), an = V.ctx.createAnalyser(); an.fftSize = 512; src.connect(an);
    levels.set(k, { an, buf: new Uint8Array(an.fftSize), src });
  } catch {}
}
function dropPeer(k, keepFails) {
  const p = peers.get(k); if (p) { try { p.pc.close(); } catch {} peers.delete(k); }
  const a = $(`#vcAudio audio[data-k="${CSS.escape(k)}"]`); if (a) { a.srcObject = null; a.remove(); }
  const l = levels.get(k); if (l) { try { l.src.disconnect(); } catch {} levels.delete(k); }
  if (!keepFails) fails.delete(k);
}
setInterval(() => {                               // ไฟแสดงคนพูด
  if (!V.room) return;
  levels.forEach((l, k) => {
    l.an.getByteTimeDomainData(l.buf); let s = 0;
    for (let i = 0; i < l.buf.length; i++) { const v = (l.buf[i] - 128) / 128; s += v * v; }
    const on = Math.sqrt(s / l.buf.length) > 0.035 && !(k === me.key && V.muted);
    const t = $(`#vcTiles [data-k="${CSS.escape(k)}"]`); if (t) t.classList.toggle('speaking', on);
  });
}, 130);

async function joinRoom(id, name) {
  if (!V.ready) return toast('ระบบเสียงยังไม่พร้อม');
  if (V.room === id) return;
  if (id === 'mc') {
    if (!M.link) { toast('ผูกชื่อในเกมก่อน: แท็บ "เกม" → ใส่รหัสจากไอเทมรีโมท'); setTab('mc'); return; }
    if (M.cfg.voice === false) return toast('OP ปิดห้องเสียงระยะใกล้อยู่');
  }
  if (V.room) await leave();
  const cnt = Object.values(V.members).filter(m => m.room === id).length;
  if (cnt >= MAXV) return toast('ห้องเต็มแล้ว (สูงสุด ' + MAXV + ' คน)');
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return toast('เบราว์เซอร์นี้ไม่รองรับไมโครโฟน (ต้องเปิดผ่าน https)');
  try {
    V.local = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
  } catch (e) { return toast('ใช้ไมโครโฟนไม่ได้ — อนุญาตไมค์ในเบราว์เซอร์ก่อนนะ'); }
  V.ctx = V.ctx || new (window.AudioContext || window.webkitAudioContext)(); V.ctx.resume && V.ctx.resume();
  V.room = id; V.roomName = name; V.joinedAt = Date.now(); V.muted = false; V.deaf = false;
  if (id === 'mc') { const mp = mcMe(); if (mp && mp.mic === false) V.muted = true; M.lastMic = mp ? mp.mic : null; applyMute(); }
  watch(me.key, V.local);
  await track(); reconcile(); renderVoice(); pill();
}
async function leave() {
  for (const k of [...peers.keys()]) dropPeer(k);
  early.clear(); fails.clear();
  if (V.local) { V.local.getTracks().forEach(t => t.stop()); V.local = null; }
  const l = levels.get(me.key); if (l) { try { l.src.disconnect(); } catch {} levels.delete(me.key); }
  V.room = null; V.roomName = ''; V.joinedAt = 0; V.muted = V.deaf = false;
  await track(); renderVoice(); pill();
}
function applyMute() {
  if (V.local) V.local.getAudioTracks().forEach(t => { t.enabled = !V.muted; });
  $$('#vcAudio audio').forEach(a => { a.muted = V.deaf; });
}
async function toggleMute() { if (!V.room) return; V.muted = !V.muted; if (!V.muted) V.deaf = false; applyMute(); mcPushMic(); await track(); renderVoice(); pill(); }
async function toggleDeaf() { if (!V.room) return; V.deaf = !V.deaf; V.muted = V.deaf ? true : V.muted; applyMute(); mcPushMic(); await track(); renderVoice(); pill(); }

function roomsList() {
  const map = new Map(); if (!M.missing) map.set('mc', { id: 'mc', name: 'Minecraft · ระยะใกล้', desc: 'ยิ่งใกล้ยิ่งได้ยินชัด' });
  VROOMS.forEach(r => map.set(r.id, { ...r }));
  Object.values(V.members).forEach(m => { if (m.room && !map.has(m.room)) map.set(m.room, { id: m.room, name: m.roomName || m.room, desc: 'ห้องส่วนตัว', custom: true }); });
  return [...map.values()];
}
function renderVoice() {
  const online = Object.keys(V.members).length;
  $('#hubSub').textContent = A().cloud ? ('ออนไลน์ ' + online + ' คน') : 'ต้องล็อกอิน';
  // รายการห้อง
  const L = $('#vcRooms'); if (!L) return;
  L.innerHTML = roomsList().map(r => {
    const ms = Object.entries(V.members).filter(([, m]) => m.room === r.id);
    const here = V.room === r.id;
    return `<div class="vr-card${here ? ' here' : ''}"><div class="vr-top"><span class="vr-ic">${ic('hash')}</span><div class="vr-t"><b>${esc(r.name)}</b><small>${esc(r.desc || '')}${ms.length ? ' · ' + ms.length + ' คน' : ''}</small></div>`
      + (here ? `<button class="btn sm" data-leave>ออก</button>` : `<button class="btn primary sm" data-join="${esc(r.id)}" data-name="${esc(r.name)}">เข้าร่วม</button>`)
      + `</div>${ms.length ? `<div class="vr-who">${ms.map(([, m]) => `<span class="vr-p">${avatarHtml(m.name, m.avatar, 'sm')}${esc(m.name)}${m.muted ? ' ' + ic('mic-off') : ''}</span>`).join('')}</div>` : ''}</div>`;
  }).join('');
  // แผงในสาย
  const call = $('#vcCall'), ctl = $('#vcCtl'); call.hidden = ctl.hidden = !V.room;
  if (V.room) {
    $('#vcRoomName').textContent = V.roomName;
    const ids = [me.key, ...[...peers.keys()].filter(k => V.members[k])];
    $('#vcCount').textContent = (Object.values(V.members).filter(m => m.room === V.room).length) + ' คนในห้อง';
    $('#vcTiles').innerHTML = ids.map(k => {
      const m = k === me.key ? { name: me.name + ' (คุณ)', avatar: me.avatar, muted: V.muted, deaf: V.deaf } : V.members[k];
      const st = k === me.key ? '' : (peers.get(k)?.state || '');
      const stTxt = st === 'connected' ? '' : st === 'failed' ? 'เชื่อมต่อไม่ได้' : st ? 'กำลังเชื่อมต่อ…' : '';
      return `<div class="vt" data-k="${esc(k)}">${avatarHtml(m.name, m.avatar, 'lg')}<b>${esc(m.name)}</b><span class="vt-s"><em class="vt-d" data-d></em>${m.muted ? ic('mic-off') : ''}${m.deaf ? ic('headphones-off') : ''}${stTxt ? `<em>${stTxt}</em>` : ''}</span></div>`;
    }).join('');
    $('#vcMic').classList.toggle('off', V.muted); $('#vcMic').innerHTML = ic(V.muted ? 'mic-off' : 'mic');
    $('#vcDeaf').classList.toggle('off', V.deaf); $('#vcDeaf').innerHTML = ic(V.deaf ? 'headphones-off' : 'headphones');
    // คืนไฟพูดหลัง re-render ใช้การ poll ถัดไป
  }
}
function pill() {
  const p = $('#vcPill'); if (!p) return;
  const show = !!V.room && !(curPage === 'hub' && tab === 'voice');
  p.hidden = !show; if (!show) return;
  $('#vcPillName').textContent = V.roomName;
  $('#vcPillMic').innerHTML = ic(V.muted ? 'mic-off' : 'mic'); $('#vcPillMic').classList.toggle('off', V.muted);
}
$('#vcRooms').addEventListener('click', e => {
  const j = e.target.closest('[data-join]'); if (j) return joinRoom(j.dataset.join, j.dataset.name);
  if (e.target.closest('[data-leave]')) leave();
});
$('#vcMic').onclick = toggleMute; $('#vcDeaf').onclick = toggleDeaf; $('#vcLeave').onclick = leave;
$('#vcPillMic').onclick = e => { e.stopPropagation(); toggleMute(); };
$('#vcPillLeave').onclick = e => { e.stopPropagation(); leave(); };
$('#vcPill').onclick = () => { B().go('hub'); setTab('voice'); };
$('#vcNew').addEventListener('submit', e => {
  e.preventDefault();
  const inp = $('#vcNewName'), name = inp.value.trim().slice(0, 24); if (!name) return;
  const id = 'c-' + name.toLowerCase().replace(/\s+/g, '-'); inp.value = ''; joinRoom(id, name);
});


/* ===================== Minecraft (เกม) ===================== */
const M = { link: null, players: [], cfg: {}, missing: false, lastMic: null, sig: '', ctlBuilt: false, tick: 0, hist: [] };
const mcMe = () => (M.link ? M.players.find(p => p.name === M.link.mc_name) : null) || null;
const isOpMe = () => !!(mcMe() && mcMe().is_op);

async function mcInit() {
  const [l, c] = await Promise.all([
    sb().from('mc_links').select('mc_name').maybeSingle(),
    sb().from('mc_config').select('key,value')
  ]);
  if (l.error || c.error) {
    const msg = (l.error || c.error).message || '';
    if (/does not exist|schema cache|relation/i.test(msg)) { M.missing = true; renderMc(true); renderVoice(); return; }
  }
  M.link = (l.data) || null;
  M.cfg = Object.fromEntries(((c.data) || []).map(r => [r.key, r.value]));
  applyCfg();
  sb().channel('mc-cfg').on('postgres_changes', { event: '*', schema: 'public', table: 'mc_config' }, reloadCfg).subscribe();
  await loadPlayers(); renderVoice(); track();
  setInterval(mcTick, 2000);
}
async function reloadCfg() {
  const { data } = await sb().from('mc_config').select('key,value');
  M.cfg = Object.fromEntries((data || []).map(r => [r.key, r.value])); applyCfg();
}
async function loadPlayers() {
  if (M.missing) return;
  const { data, error } = await sb().from('mc_players').select('name,x,y,z,dim,online,is_op,mic,hear_range,updated_at').order('name', { ascending: true });
  if (error) return;
  M.players = data || [];
  syncTabs(); if (tab === 'mc' && curPage === 'hub') renderMc(false);
  if (tab === 'ctl') syncCtl();
  mcVoiceSync();
}
function mcTick() {
  if (document.hidden) return; M.tick++;
  const fast = V.room === 'mc' || (curPage === 'hub' && (tab === 'mc' || tab === 'ctl'));
  if (fast || (curPage === 'hub' && M.tick % 5 === 0)) loadPlayers();
}
function syncTabs() {
  const b = $('#hubTabs [data-t=ctl]'); if (b) b.hidden = !isOpMe();
  if (!isOpMe() && tab === 'ctl') setTab('mc');
}

/* ---- หน้าตาเว็บตามที่ OP ตั้ง ---- */
function applyCfg() {
  const c = M.cfg, pg = $('#pg-hub');
  const setv = (k, v, flag) => { if (v) { pg.style.setProperty(k, v); pg.dataset[flag] = '1'; } else { pg.style.removeProperty(k); delete pg.dataset[flag]; } };
  setv('--hub-ac', c.accent, 'ac'); setv('--hub-bg', c.bg, 'bg');
  pg.dataset.bold = c.bold ? '1' : '0'; pg.dataset.italic = c.italic ? '1' : '0'; pg.dataset.size = c.size || 'normal';
  $('#hubTitle').textContent = c.title || 'ชุมชน';
  const a = $('#hubAnn'); a.textContent = c.announce || ''; a.hidden = !c.announce;
  if (c.voice === false && V.room === 'mc') { leave(); toast('OP ปิดห้องเสียงระยะใกล้แล้ว'); }
  if (tab === 'ctl') syncCtl();
}

/* ---- แท็บ "เกม": เชื่อมชื่อ + ตั้งค่าของฉัน + ผู้เล่นออนไลน์ ---- */
const distTxt = n => n >= 10 ? Math.round(n) : n.toFixed(1);
function renderMc(force) {
  const box = $('#mcMe'), list = $('#mcList'); if (!box) return;
  if (M.missing) { box.innerHTML = '<p class="empty-note">ยังไม่ได้รัน supabase/mc.sql — รันใน SQL Editor ก่อนนะ</p>'; list.innerHTML = ''; return; }
  const me_ = mcMe();
  const sig = JSON.stringify([M.link && M.link.mc_name, me_ && [me_.is_op, me_.mic, me_.hear_range, me_.online]]);
  const dragging = document.activeElement && document.activeElement.id === 'mcRange';
  if (force || (sig !== M.sig && !dragging)) {
    M.sig = sig;
    if (!M.link) {
      box.innerHTML = `<div class="mc-card glass"><h4>เชื่อมกับตัวละครในเกม</h4>
        <p class="hint">ในเกมกดใช้ไอเทม <b>Fontaine Voice Remote</b> → จะเห็น "รหัสเชื่อมเว็บ" 6 หลัก (ถ้าไม่มีไอเทม ให้ OP พิมพ์ <code>/give @s fontaine:voice_remote</code>) แล้วใส่ด้านล่าง ทำครั้งเดียวจบ</p>
        <form id="mcLinkForm" class="mc-link"><input id="mcName" type="text" placeholder="ชื่อในเกม (Gamertag)" autocomplete="off" maxlength="32"><input id="mcCode" type="text" inputmode="numeric" placeholder="รหัส 6 หลัก" autocomplete="off" maxlength="8"><button class="btn primary">เชื่อมต่อ</button></form></div>`;
    } else {
      const mic = !me_ || me_.mic !== false, rng = me_ ? me_.hear_range : 24;
      box.innerHTML = `<div class="mc-card glass"><div class="mc-me">${avatarHtml(M.link.mc_name, '', 'lg')}<div class="mc-who"><b>${esc(M.link.mc_name)}${me_ && me_.is_op ? '<i class="op-b">OP</i>' : ''}</b><small>${me_ && me_.online ? '<span class="on-dot"></span> อยู่ในเกม' : 'ออฟไลน์'}</small></div><button class="btn sm" id="mcUnlink">เลิกเชื่อม</button></div>
        <div class="row-sw"><span>${ic(mic ? 'mic' : 'mic-off')} ไมค์</span><label class="tg"><input type="checkbox" id="mcMicSw" ${mic ? 'checked' : ''}><i></i></label></div>
        <div class="row-rg"><div class="row-h"><span>ระยะที่ได้ยินเสียง</span><b id="mcRangeV">${rng} บล็อก</b></div><input type="range" id="mcRange" class="rg" min="4" max="128" step="2" value="${rng}"></div>
        <p class="hint">ตั้งได้ทั้งที่นี่และจากไอเทมในเกม — ซิงก์กันอัตโนมัติ</p></div>`;
    }
  }
  const on = M.players.filter(p => p.online), my = mcMe();
  list.innerHTML = `<div class="mc-card glass"><h4>ผู้เล่นออนไลน์ <small>${on.length} คน</small></h4>${on.length ? on.map(p => {
    const d = my && my.online && my.dim === p.dim && p.name !== my.name ? Math.hypot(p.x - my.x, p.y - my.y, p.z - my.z) : null;
    return `<div class="pl-row">${avatarHtml(p.name, '')}<div class="pl-n"><b>${esc(p.name)}${p.is_op ? '<i class="op-b">OP</i>' : ''}</b><small>${esc(p.dim)} · ${Math.round(p.x)}, ${Math.round(p.y)}, ${Math.round(p.z)}${d !== null ? ' · ห่าง ' + distTxt(d) + ' บล็อก' : ''}</small></div><span class="pl-i">${ic(p.mic === false ? 'mic-off' : 'mic')}</span></div>`;
  }).join('') : '<p class="empty-note">ยังไม่มีใครออนไลน์ในเกม — เซิร์ฟเวอร์เปิดและตั้ง Addon แล้วหรือยัง?</p>'}</div>`;
}
$('#hubMc').addEventListener('submit', async e => {
  if (e.target.id !== 'mcLinkForm') return; e.preventDefault();
  const name = $('#mcName').value.trim(), code = $('#mcCode').value.trim(); if (!name || !code) return toast('กรอกชื่อและรหัสก่อนนะ');
  const { data, error } = await sb().rpc('mc_link', { p_name: name, p_code: code });
  if (error) return toast('เชื่อมไม่สำเร็จ: ' + error.message);
  if (!data) return toast('ไม่พบผู้เล่นนี้ หรือรหัสไม่ถูก (ผู้เล่นต้องเคยเข้าเกมตอน Addon ทำงานอยู่)');
  const l = await sb().from('mc_links').select('mc_name').maybeSingle(); M.link = l.data || null;
  toast('เชื่อมกับ ' + (M.link ? M.link.mc_name : name) + ' แล้ว ✓'); await loadPlayers(); renderMc(true); renderVoice(); track(); syncTabs();
});
$('#hubMc').addEventListener('click', async e => {
  if (e.target.closest('#mcUnlink')) { await sb().rpc('mc_unlink'); M.link = null; if (V.room === 'mc') leave(); renderMc(true); renderVoice(); track(); syncTabs(); }
});
$('#hubMc').addEventListener('input', e => { if (e.target.id === 'mcRange') $('#mcRangeV').textContent = e.target.value + ' บล็อก'; });
$('#hubMc').addEventListener('change', async e => {
  if (e.target.id === 'mcMicSw') {
    const v = e.target.checked, r = await sb().rpc('mc_set_my', { p_mic: v, p_range: null }); if (r.error) return toast(r.error.message);
    const p = mcMe(); if (p) p.mic = v; if (V.room === 'mc') { V.muted = !v; M.lastMic = v; applyMute(); track(); renderVoice(); pill(); }
    M.sig = ''; renderMc(true);
  }
  if (e.target.id === 'mcRange') {
    const r = await sb().rpc('mc_set_my', { p_mic: null, p_range: parseInt(e.target.value) }); if (r.error) return toast(r.error.message);
    const p = mcMe(); if (p) p.hear_range = parseInt(e.target.value);
  }
});

/* ---- ซิงก์ไมค์กับไอเทม + เสียงตามระยะ ---- */
function mcPushMic() {
  if (V.room !== 'mc' || !M.link) return;
  M.lastMic = !V.muted; sb().rpc('mc_set_my', { p_mic: !V.muted, p_range: null }); const p = mcMe(); if (p) p.mic = !V.muted;
}
function mcVoiceSync() {
  if (V.room !== 'mc') return; const p = mcMe(); if (!p) return;
  if (M.lastMic !== p.mic) {                       // ไอเทม/เว็บอีกเครื่องเปลี่ยนไมค์
    M.lastMic = p.mic; V.muted = p.mic === false; if (!V.muted) V.deaf = false;
    applyMute(); track(); renderVoice(); pill();
  }
}
function proxVolume(d, R) { if (d >= R) return 0; const inner = R * 0.2; return d <= inner ? 1 : Math.pow((R - d) / (R - inner), 1.5); }
setInterval(() => {
  if (V.room !== 'mc') return;
  const my = mcMe(), cap = M.cfg.range || 128, R = my ? Math.min(my.hear_range || 24, cap) : 24;
  $$('#vcAudio audio').forEach(a => {
    const m = V.members[a.dataset.k], pl = m && m.mc ? M.players.find(p => p.name === m.mc) : null;
    let vol = 0, txt = '';
    if (my && my.online && pl && pl.online && pl.dim === my.dim) {
      const d = Math.hypot(pl.x - my.x, pl.y - my.y, pl.z - my.z); vol = proxVolume(d, R); txt = distTxt(d) + ' บล็อก';
    } else if (pl && pl.online) txt = 'คนละมิติ';
    else txt = 'ไม่อยู่ในเกม';
    try { a.volume = Math.max(0, Math.min(1, vol)); } catch { }
    const t = $(`#vcTiles [data-k="${CSS.escape(a.dataset.k)}"] [data-d]`); if (t) t.textContent = txt;
  });
}, 300);

/* ---- แท็บ "ควบคุม" (เฉพาะ OP): GUI ตั้งค่าเว็บ + สั่งคำสั่งในเกม ---- */
const SWATCH = ['#00a6d6', '#7c5cff', '#ec4899', '#ef4444', '#f97316', '#eab308', '#22c55e', '#111111'];
const QUICK = [['เช้า', '/time set day'], ['กลางคืน', '/time set night'], ['ฝนหยุด', '/weather clear'], ['ฝนตก', '/weather rain'], ['สงบสุข', '/difficulty peaceful'], ['ปกติ', '/difficulty normal'], ['เก็บของตอนตาย', '/gamerule keepInventory true']];
function buildCtl() {
  if (M.ctlBuilt) return; M.ctlBuilt = true;
  $('#hubCtl .st-scroll').innerHTML = `
  <div class="mc-card glass"><h4>หน้าตาของชุมชน</h4>
    <div class="row-h"><span>สีหลัก</span><input type="color" id="ctlAccent" class="clr"></div>
    <div class="swatches" id="ctlSw">${SWATCH.map(c => `<button type="button" class="swatch" data-c="${c}" style="background:${c}" aria-label="${c}"></button>`).join('')}<button type="button" class="swatch clear" data-c="" title="ค่าเริ่มต้น">✕</button></div>
    <div class="row-h"><span>พื้นหลังแชต</span><span class="row-r"><input type="color" id="ctlBg" class="clr"><button type="button" class="btn sm" id="ctlBgClr">ล้าง</button></span></div>
    <div class="row-sw"><span><b>B</b> ตัวหนา</span><label class="tg"><input type="checkbox" id="ctlBold"><i></i></label></div>
    <div class="row-sw"><span><i>I</i> ตัวเอียง</span><label class="tg"><input type="checkbox" id="ctlItalic"><i></i></label></div>
    <div class="row-h"><span>ขนาดตัวอักษร</span><span class="seg" id="ctlSize"><button type="button" data-v="small">เล็ก</button><button type="button" data-v="normal">กลาง</button><button type="button" data-v="large">ใหญ่</button></span></div>
    <form class="row-in" id="ctlTitleF"><input id="ctlTitle" type="text" maxlength="40" placeholder="ชื่อหัวเว็บ (เช่น ชุมชนฟอนเทน)"><button class="btn sm primary">บันทึก</button></form>
    <form class="row-in" id="ctlAnnF"><input id="ctlAnn" type="text" maxlength="200" placeholder="ประกาศขึ้นหัวหน้าเว็บ"><button class="btn sm primary">ประกาศ</button><button type="button" class="btn sm" id="ctlAnnClr">ลบ</button></form>
  </div>
  <div class="mc-card glass"><h4>เสียงระยะใกล้</h4>
    <div class="row-sw"><span>เปิดห้อง Minecraft ระยะใกล้</span><label class="tg"><input type="checkbox" id="ctlVoice"><i></i></label></div>
    <div class="row-rg"><div class="row-h"><span>ระยะสูงสุด (ทุกคน)</span><b id="ctlRangeV">48 บล็อก</b></div><input type="range" id="ctlRange" class="rg" min="4" max="128" step="2" value="48"></div>
  </div>
  <div class="mc-card glass"><h4>สั่งคำสั่งในเกม</h4>
    <div class="chips" id="ctlQuick">${QUICK.map(([n, c]) => `<button type="button" class="ch-chip" data-cmd="${c}">${n}</button>`).join('')}</div>
    <form class="row-in" id="ctlCmdF"><input id="ctlCmd" type="text" maxlength="200" placeholder="/say สวัสดี" autocomplete="off"><button class="btn sm primary">รัน</button></form>
    <div id="ctlHist" class="cmd-hist"></div>
    <p class="hint">เซิร์ฟเวอร์รับคำสั่งทุก ~2 วินาที · ในเกม OP พิมพ์ <code>!web help</code> เพื่อปรับหน้าเว็บจากแชตได้เหมือนกัน</p>
  </div>`;
  const P = $('#hubCtl');
  const save = async (k, v) => {
    const { error } = await sb().rpc('mc_set_config', { p_key: k, p_value: v });
    if (error) return toast('บันทึกไม่ได้: ' + (/op_only/.test(error.message) ? 'ต้องเป็น OP ที่เชื่อมแล้ว' : error.message));
    if (v === null) delete M.cfg[k]; else M.cfg[k] = v; applyCfg();
  };
  P.addEventListener('change', e => {
    const t = e.target;
    if (t.id === 'ctlAccent') save('accent', t.value);
    else if (t.id === 'ctlBg') save('bg', t.value);
    else if (t.id === 'ctlBold') save('bold', t.checked);
    else if (t.id === 'ctlItalic') save('italic', t.checked);
    else if (t.id === 'ctlVoice') save('voice', t.checked);
    else if (t.id === 'ctlRange') save('range', parseInt(t.value));
  });
  P.addEventListener('input', e => { if (e.target.id === 'ctlRange') $('#ctlRangeV').textContent = e.target.value + ' บล็อก'; });
  P.addEventListener('click', e => {
    const sw = e.target.closest('#ctlSw [data-c]'); if (sw) return save('accent', sw.dataset.c || null);
    const sz = e.target.closest('#ctlSize [data-v]'); if (sz) return save('size', sz.dataset.v);
    if (e.target.closest('#ctlBgClr')) return save('bg', null);
    if (e.target.closest('#ctlAnnClr')) return save('announce', null);
    const q = e.target.closest('[data-cmd]'); if (q) return runCmd(q.dataset.cmd);
  });
  $('#ctlTitleF').addEventListener('submit', e => { e.preventDefault(); const v = $('#ctlTitle').value.trim(); save('title', v || null); });
  $('#ctlAnnF').addEventListener('submit', e => { e.preventDefault(); const v = $('#ctlAnn').value.trim(); if (v) save('announce', v); });
  $('#ctlCmdF').addEventListener('submit', e => { e.preventDefault(); const v = $('#ctlCmd').value.trim(); if (v) { $('#ctlCmd').value = ''; runCmd(v); } });
}
function syncCtl() {
  if (!M.ctlBuilt) return; const c = M.cfg, foc = id => document.activeElement && document.activeElement.id === id;
  const set = (id, fn) => { const el = $('#' + id); if (el && !foc(id)) fn(el); };
  set('ctlAccent', el => el.value = c.accent || '#00a6d6'); set('ctlBg', el => el.value = c.bg || '#ffffff');
  set('ctlBold', el => el.checked = !!c.bold); set('ctlItalic', el => el.checked = !!c.italic);
  set('ctlTitle', el => el.value = c.title || ''); set('ctlAnn', el => el.value = c.announce || '');
  set('ctlVoice', el => el.checked = c.voice !== false);
  set('ctlRange', el => { el.value = c.range || 48; $('#ctlRangeV').textContent = el.value + ' บล็อก'; });
  $$('#ctlSize [data-v]').forEach(b => b.classList.toggle('on', b.dataset.v === (c.size || 'normal')));
}
async function runCmd(cmd) {
  const { data: id, error } = await sb().rpc('mc_run', { p_cmd: cmd });
  if (error) return toast('สั่งไม่ได้: ' + (/op_only/.test(error.message) ? 'ต้องเป็น OP ที่เชื่อมแล้ว' : error.message));
  const h = { id, cmd, st: 'รอเซิร์ฟเวอร์…' }; M.hist.unshift(h); M.hist = M.hist.slice(0, 8); renderHist();
  for (let i = 0; i < 12; i++) {
    await new Promise(r => setTimeout(r, 1500));
    const { data } = await sb().from('mc_commands').select('status,result').eq('id', id).maybeSingle();
    if (data && (data.status === 'done' || data.status === 'fail')) { h.st = (data.status === 'done' ? '✓ ' : '✗ ') + (data.result || ''); h.bad = data.status === 'fail'; renderHist(); return; }
  }
  h.st = 'ไม่มีตอบกลับ — เซิร์ฟเวอร์ออนไลน์ไหม?'; h.bad = true; renderHist();
}
function renderHist() { const b = $('#ctlHist'); if (b) b.innerHTML = M.hist.map(h => `<div class="cmd-h${h.bad ? ' bad' : ''}"><code>${esc(h.cmd)}</code><small>${esc(h.st)}</small></div>`).join(''); }

/* ===================== หน้า/แท็บ ===================== */
let curPage = 'chat';
function setTab(t) {
  tab = t;
  $$('#hubTabs .hub-t').forEach(b => b.classList.toggle('on', b.dataset.t === t));
  $('#hubText').hidden = t !== 'text'; $('#hubVoice').hidden = t !== 'voice';
  $('#hubMc').hidden = t !== 'mc'; $('#hubCtl').hidden = t !== 'ctl';
  if (t === 'mc') { renderMc(true); loadPlayers(); }
  if (t === 'ctl') { buildCtl(); syncCtl(); }
  if (t === 'text') { T.unread.delete(T.cur); renderChans(); badge(); renderMsgs(true); }
  pill();
}
$('#hubTabs').addEventListener('click', e => { const b = e.target.closest('[data-t]'); if (b) setTab(b.dataset.t); });
$('#hubBack').onclick = () => B().go('lobby');

function start() {
  if (started) return; started = true;
  const a = A();
  me.name = a.displayName(); me.avatar = (a.profile && a.profile.avatar_url) || '';
  loadChans(); subscribeText(); connectVoice(); mcInit();
}
function onPage(p) {
  curPage = p;
  if (p === 'hub') {
    if (!A().cloud) { textNote('ต้องตั้งค่า Supabase และล็อกอินก่อน จึงจะใช้ห้องแชต/ห้องเสียงได้'); vcNote('ต้องล็อกอินก่อนจึงจะใช้ห้องเสียงได้'); $('#hubSub').textContent = 'ต้องล็อกอิน'; }
    else start();
    setTab(tab);
  }
  pill();
}
window.addEventListener('pagehide', () => { try { if (V.ch) V.ch.untrack(); } catch {} });
return { onPage, _V: V, _T: T, _me: me, _peers: peers, _M: M };
})();
