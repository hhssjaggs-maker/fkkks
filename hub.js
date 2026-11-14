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
  name: me.name, avatar: me.avatar, room: V.room, roomName: V.roomName, joinedAt: V.joinedAt, muted: V.muted, deaf: V.deaf
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
  if (V.room) await leave();
  const cnt = Object.values(V.members).filter(m => m.room === id).length;
  if (cnt >= MAXV) return toast('ห้องเต็มแล้ว (สูงสุด ' + MAXV + ' คน)');
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return toast('เบราว์เซอร์นี้ไม่รองรับไมโครโฟน (ต้องเปิดผ่าน https)');
  try {
    V.local = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
  } catch (e) { return toast('ใช้ไมโครโฟนไม่ได้ — อนุญาตไมค์ในเบราว์เซอร์ก่อนนะ'); }
  V.ctx = V.ctx || new (window.AudioContext || window.webkitAudioContext)(); V.ctx.resume && V.ctx.resume();
  V.room = id; V.roomName = name; V.joinedAt = Date.now(); V.muted = false; V.deaf = false;
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
async function toggleMute() { if (!V.room) return; V.muted = !V.muted; if (!V.muted) V.deaf = false; applyMute(); await track(); renderVoice(); pill(); }
async function toggleDeaf() { if (!V.room) return; V.deaf = !V.deaf; V.muted = V.deaf ? true : V.muted; applyMute(); await track(); renderVoice(); pill(); }

function roomsList() {
  const map = new Map(VROOMS.map(r => [r.id, { ...r }]));
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
      return `<div class="vt" data-k="${esc(k)}">${avatarHtml(m.name, m.avatar, 'lg')}<b>${esc(m.name)}</b><span class="vt-s">${m.muted ? ic('mic-off') : ''}${m.deaf ? ic('headphones-off') : ''}${stTxt ? `<em>${stTxt}</em>` : ''}</span></div>`;
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

/* ===================== หน้า/แท็บ ===================== */
let curPage = 'chat';
function setTab(t) {
  tab = t;
  $$('#hubTabs .hub-t').forEach(b => b.classList.toggle('on', b.dataset.t === t));
  $('#hubText').hidden = t !== 'text'; $('#hubVoice').hidden = t !== 'voice';
  if (t === 'text') { T.unread.delete(T.cur); renderChans(); badge(); renderMsgs(true); }
  pill();
}
$('#hubTabs').addEventListener('click', e => { const b = e.target.closest('[data-t]'); if (b) setTab(b.dataset.t); });
$('#hubBack').onclick = () => B().go('lobby');

function start() {
  if (started) return; started = true;
  const a = A();
  me.name = a.displayName(); me.avatar = (a.profile && a.profile.avatar_url) || '';
  loadChans(); subscribeText(); connectVoice();
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
return { onPage, _V: V, _T: T, _me: me, _peers: peers };
})();
