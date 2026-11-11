/* ==========================================================
   app.js — ตรรกะหลัก (แชต, โหมด, API, ไฟล์, สกิล, ค้นเว็บ,
            ฐานข้อมูล Supabase, ทดสอบโค้ดอัตโนมัติ)
   ========================================================== */
(() => {
const CFG = window.AI_CONFIG, Runner = window.Runner, Auth = window.Auth;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const KEY = 'fontaine_ai_v2', OLD_KEY = 'fontaine_ai_v1';
const ICON = 'furina-icon.jpg';

/* ---------- state ---------- */
const def = {
  source: 'own', provider: 'openai', apiKey: '', tavilyKey: '', rules: '',
  baseUrl: { openai: CFG.PROVIDERS.openai.baseUrl, anthropic: CFG.PROVIDERS.anthropic.baseUrl, gemini: CFG.PROVIDERS.gemini.baseUrl },
  model:   { openai: CFG.PROVIDERS.openai.model,   anthropic: CFG.PROVIDERS.anthropic.model,   gemini: CFG.PROVIDERS.gemini.model },
  mode: 'furina', web: false, autotest: true, skills: [], localMessages: []
};
let S = load();
function load() {
  try {
    const raw = localStorage.getItem(KEY) || localStorage.getItem(OLD_KEY);
    const o = raw ? JSON.parse(raw) : null;
    if (!o) return structuredClone(def);
    if (o.messages && !o.localMessages) o.localMessages = o.messages;
    delete o.messages;
    return { ...def, ...o, baseUrl: { ...def.baseUrl, ...o.baseUrl }, model: { ...def.model, ...o.model } };
  } catch { return structuredClone(def); }
}
const slim = m => ({ role: m.role, text: m.text, notice: m.notice, hidden: m.hidden, draft: m.draft, mode: m.mode, fileNames: m.fileNames, report: m.report, fix: m.fix });
function save() {
  try {
    const o = { ...S, localMessages: Auth.cloud ? [] : cur.messages.slice(-60).map(slim) };
    localStorage.setItem(KEY, JSON.stringify(o));
  } catch (e) { console.warn(e); }
}

let cur = { id: null, title: 'แชทใหม่', messages: [] };
let convs = [];
let busy = false, abortCtl = null, pending = [], pvStop = null;

/* ---------- helpers ---------- */
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(() => el.classList.remove('show'), 2600); }
const persona = (mode = S.mode) => CFG.PERSONAS[mode === 'code' ? 'focalors' : 'furina'];
const sb = () => Auth.sb;
function relTime(iso) {
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 60) return 'เมื่อสักครู่'; if (d < 3600) return Math.floor(d / 60) + ' นาทีที่แล้ว';
  if (d < 86400) return Math.floor(d / 3600) + ' ชม.ที่แล้ว'; if (d < 604800) return Math.floor(d / 86400) + ' วันที่แล้ว';
  return new Date(iso).toLocaleDateString('th-TH');
}
const raceAbort = (p, signal) => new Promise(res => {
  if (signal.aborted) return res(null);
  signal.addEventListener('abort', () => res(null), { once: true });
  p.then(res, () => res(null));
});

/* ---------- format: *narration* เทา, code block พร้อมปุ่ม ---------- */
function inlineFmt(p) {
  const keep = [];
  let h = esc(p).replace(/`([^`\n]+)`/g, (_, c) => { keep.push(`<code class="in">${c}</code>`); return `\u0000${keep.length - 1}\u0000`; });
  h = h.replace(/\*\*([^*\n]+)\*\*|\*([^*\n]+)\*/g, (_, a, b) => `<span class="act">${a || b}</span>`);
  h = h.replace(/\u0000(\d+)\u0000/g, (_, i) => keep[i]);
  return h ? `<span class="txt">${h}</span>` : '';
}
function codeBox(lang, name, code, btns) {
  return `<div class="code"><div class="code-h"><span>${esc(lang)}${name ? ' · ' + esc(name) : ''}</span><span class="code-b">${btns}</span></div><pre><code>${esc(code)}</code></pre></div>`;
}
function fmt(src, m) {
  const blocks = Runner.extract(src), names = Runner.fileNames(blocks);
  let runnable = new Set();
  if (m && m.done && m.mode === 'code' && m.role === 'assistant') {
    Runner.plan(blocks).forEach(t => { if (t.kind === 'html' || t.kind === 'js' || t.kind === 'py') t.blocks.forEach(b => runnable.add(b.idx)); });
  }
  const showDl = !!(m && m.done && m.role === 'assistant');
  let k = 0;
  return src.split(/(```[^\n`]*\n[\s\S]*?```)/g).map((tok, i) => {
    if (i % 2 === 1) {
      const idx = k++, b = blocks[idx];
      if (!b) return '';
      let btns = '<button data-copy>คัดลอก</button>';
      if (runnable.has(idx)) btns = `<button data-run="${idx}">▶ รัน</button>` + btns;
      if (showDl) btns += `<button data-dl="${idx}">⬇</button>`;
      return codeBox(b.lang, names[idx], b.code, btns);
    }
    const o = tok.indexOf('```');
    if (o < 0) return inlineFmt(tok);
    const open = tok.slice(o).match(/^```([^\n`]*)\n?([\s\S]*)$/);   // โค้ดที่กำลังสตรีมอยู่ (ยังไม่ปิด)
    return inlineFmt(tok.slice(0, o)) + (open ? codeBox((open[1] || 'code').trim() || 'code', '', open[2], '') : '');
  }).join('');
}

/* ---------- rendering ---------- */
const chat = $('#chat'), rowMap = new WeakMap();
function scrollDown(force) {
  const near = chat.scrollHeight - chat.scrollTop - chat.clientHeight < 160;
  if (force || near) chat.scrollTo({ top: chat.scrollHeight });
}
function avatarEl(m) {
  const av = document.createElement('div'); av.className = 'av';
  if (m.role === 'user') {
    const u = Auth.profile?.avatar_url;
    if (u) { const i = document.createElement('img'); i.src = u; i.alt = ''; i.referrerPolicy = 'no-referrer'; av.append(i); } else av.textContent = '🙂';
  } else { av.classList.toggle('code', m.mode === 'code'); const i = document.createElement('img'); i.src = ICON; i.alt = ''; av.append(i); }
  return av;
}
function addMsg(m, animate = true) {
  if (m.hidden) return null;
  if (m.notice) {
    const d = document.createElement('div'); d.className = 'sys'; d.textContent = m.text; chat.append(d); m.row = d; return d;
  }
  const row = document.createElement('div'); row.className = 'msg ' + m.role;
  if (!animate) row.style.animation = 'none';
  const b = document.createElement('div'); b.className = 'bubble';
  row.append(avatarEl(m), b); chat.append(row); m.el = b; m.row = row; rowMap.set(row, m); paint(m); return row;
}
function reportHTML(r, fix) {
  if (!r) return '';
  const ok = r.failed === 0;
  const head = ok
    ? `✅ ทดสอบผ่าน ${r.passed}${r.skipped ? ` · ข้าม ${r.skipped}` : ''}/${r.total}${fix ? ` · แก้อัตโนมัติ ${fix} รอบ` : ''}`
    : `❌ ทดสอบไม่ผ่าน ${r.failed}/${r.total}${fix ? ` · แก้แล้ว ${fix} รอบแต่ยังไม่ผ่าน` : ''}`;
  const rows = r.tasks.map(t => {
    const ic = t.status === 'pass' ? '✓' : t.status === 'fail' ? '✖' : '–';
    let h = `<div class="t ${t.status}"><b>${ic} ${esc(t.title)}</b><small>${t.ms || 0}ms${t.note ? ' · ' + esc(t.note) : ''}</small>`;
    if (t.errors?.length) h += `<pre class="e">${esc(t.errors.join('\n'))}</pre>`;
    if (t.warns?.length) h += `<pre class="w">${esc(t.warns.join('\n'))}</pre>`;
    if (t.logs?.length) h += `<pre>${esc(t.logs.join('\n'))}</pre>`;
    return h + '</div>';
  }).join('');
  return `<details class="test ${ok ? 'ok' : 'bad'}" ${ok ? '' : 'open'}><summary>${head}</summary>${rows}</details>`;
}
function paint(m) {
  if (!m.el) return;
  let h = '';
  if (m.files?.length) h += '<div class="atts">' + m.files.map(f => f.kind === 'image' ? `<img src="${f.dataUrl}" alt="${esc(f.name)}">` : `<span class="file">📄 ${esc(f.name)}</span>`).join('') + '</div>';
  else if (m.fileNames?.length) h += '<div class="atts">' + m.fileNames.map(n => `<span class="file">📎 ${esc(n)}</span>`).join('') + '</div>';
  let body = '';
  if (m.role === 'assistant' && !m.text && !m.error) body = '<span class="typing"><i></i><i></i><i></i></span>';
  else body = fmt(m.text || '', m);
  if (m.draft) body = `<details class="test bad"><summary>🔧 ฉบับร่างที่ทดสอบไม่ผ่าน (ระบบส่งกลับให้ AI แก้แล้ว)</summary><div class="t">${body}</div></details>`;
  h += body;
  if (m.error) h += `<div class="err">${esc(m.error)}</div>`;
  if (m.status) h += `<div class="status"><span class="spin"></span><span>${esc(m.status)}</span></div>`;
  if (m.report) h += reportHTML(m.report, m.fix);
  if (m.done && m.role === 'assistant' && m.mode === 'code' && !m.draft && m.text) {
    const blocks = Runner.extract(m.text), tasks = Runner.plan(blocks);
    const hasHtml = tasks.some(t => t.kind === 'html');
    let t = '';
    if (hasHtml) t += '<button data-runweb>🌐 เปิดดูเว็บ</button>';
    if (blocks.length >= 2) t += '<button data-zip>📦 ดาวน์โหลดทั้งหมด (.zip)</button>';
    if (t) h += `<div class="msg-tools">${t}</div>`;
  }
  m.el.innerHTML = h;
}
let rafId = 0;
function paintSoon(m) { if (rafId) return; rafId = requestAnimationFrame(() => { rafId = 0; paint(m); scrollDown(); }); }

function greeting() {
  return S.mode === 'code'
    ? '*ผิวน้ำนิ่งสนิท แสงสีฟ้าเรืองรองไหลเป็นสายโค้ดบนหน้าจอ* ข้าคือโฟคาลอร์ส… บอกมาเถิดว่าต้องการสร้างระบบอะไร ข้าจะเขียนให้สมบูรณ์ แล้วทดสอบรันในเงาน้ำก่อนส่งให้เจ้าทุกครั้ง 🧪'
    : '*สาดแสงสปอตไลต์ลงกลางเวที แล้วหมุนตัวหนึ่งรอบอย่างสง่างาม* ยินดีต้อนรับสู่โรงละครของข้า! ข้าคือฟูริน่า ดาราเอกแห่งฟองแตน… มีอะไรอยากคุยหรืออยากให้ช่วยก็บอกมาได้เลย~ (ถ้าอยากให้เขียนโค้ด พิมพ์ว่า "เปลี่ยนโหมดเป็นเขียนโค้ดขั้นสูง" ได้เลยนะ)';
}
function renderAll() {
  chat.innerHTML = '';
  addMsg({ role: 'assistant', text: greeting(), mode: S.mode, done: true }, false);
  cur.messages.forEach(m => addMsg(m, false));
  scrollDown(true);
}

/* ---------- ฐานข้อมูล (Supabase) ---------- */
let warnedDb = false;
const dbWarn = e => { console.warn(e); if (!warnedDb) { warnedDb = true; toast('บันทึกลงฐานข้อมูลไม่สำเร็จ: ' + (e.message || e)); } };
const metaOf = m => ({ mode: m.mode, hidden: !!m.hidden, draft: !!m.draft, notice: !!m.notice, fileNames: m.fileNames || [], report: m.report || null, fix: m.fix || 0 });
async function persist(m) {
  if (!Auth.cloud || !cur.id || m.saved) return;
  m.saved = true;
  const { data, error } = await sb().from('messages').insert({ conversation_id: cur.id, role: m.notice ? 'system' : m.role, content: m.text || '', meta: metaOf(m) }).select('id').single();
  if (error) { m.saved = false; return dbWarn(error); }
  m.id = data.id;
  const now = new Date().toISOString();
  sb().from('conversations').update({ updated_at: now }).eq('id', cur.id).then(() => {}, () => {});
  const c = convs.find(x => x.id === cur.id); if (c) { c.updated_at = now; }
}
async function ensureConv(titleHint) {
  if (!Auth.cloud || cur.id) return;
  const title = (titleHint || 'แชทใหม่').replace(/\s+/g, ' ').slice(0, 40) || 'แชทใหม่';
  const { data, error } = await sb().from('conversations').insert({ title, mode: S.mode }).select('id,title,mode,updated_at').single();
  if (error) return dbWarn(error);
  cur.id = data.id; cur.title = data.title; convs.unshift(data); renderConvs();
  // เก็บข้อความที่ค้างอยู่ (เช่น แจ้งเตือนสลับโหมด)
  for (const m of cur.messages) if (!m.saved && !m.partial) await persist(m);
}
async function loadConvs() {
  const { data, error } = await sb().from('conversations').select('id,title,mode,updated_at').order('updated_at', { ascending: false }).limit(100);
  if (error) { dbWarn(error); return; }
  convs = data || []; renderConvs();
}
function renderConvs() {
  const box = $('#convList'); if (!box) return; box.innerHTML = '';
  if (!convs.length) { box.innerHTML = '<p class="hint pad">ยังไม่มีประวัติแชท</p>'; return; }
  convs.forEach(c => {
    const d = document.createElement('div'); d.className = 'conv' + (c.id === cur.id ? ' active' : '');
    d.innerHTML = `<button class="conv-t"><b>${c.mode === 'code' ? '⚡' : '🎭'} ${esc(c.title)}</b><small>${relTime(c.updated_at)}</small></button><button class="conv-x" title="ลบ">🗑️</button>`;
    d.querySelector('.conv-t').onclick = () => { openConv(c.id); closeDrawer(); };
    d.querySelector('.conv-x').onclick = async () => {
      if (!confirm(`ลบแชท "${c.title}" ?`)) return;
      const { error } = await sb().from('conversations').delete().eq('id', c.id);
      if (error) return dbWarn(error);
      convs = convs.filter(x => x.id !== c.id);
      if (cur.id === c.id) newChat(); else renderConvs();
    };
    box.append(d);
  });
}
async function openConv(id) {
  if (busy) abortCtl?.abort();
  const { data, error } = await sb().from('messages').select('id,role,content,meta,created_at').eq('conversation_id', id).order('created_at', { ascending: true }).limit(500);
  if (error) return dbWarn(error);
  const c = convs.find(x => x.id === id) || {};
  cur = { id, title: c.title || 'แชท', messages: data.map(r => ({
    id: r.id, saved: true, done: true, role: r.role === 'system' ? 'system' : r.role, text: r.content,
    notice: !!r.meta?.notice, hidden: !!r.meta?.hidden, draft: !!r.meta?.draft, mode: r.meta?.mode,
    fileNames: r.meta?.fileNames, report: r.meta?.report, fix: r.meta?.fix
  })) };
  if (c.mode && c.mode !== S.mode) { S.mode = c.mode; applyMode(); }
  renderAll(); renderConvs(); save();
}
function newChat() {
  if (busy) abortCtl?.abort();
  cur = { id: null, title: 'แชทใหม่', messages: [] }; renderAll(); renderConvs(); save();
}
async function pullSettings() {
  if (!Auth.cloud) return;
  try {
    const { data } = await sb().from('user_settings').select('data').eq('user_id', Auth.user.id).maybeSingle();
    if (data?.data) { if (Array.isArray(data.data.skills)) S.skills = data.data.skills; if (typeof data.data.rules === 'string') S.rules = data.data.rules; }
  } catch (e) { console.warn(e); }
}
let pushT;
function pushSettings() {
  if (!Auth.cloud) return; clearTimeout(pushT);
  pushT = setTimeout(() => { sb().from('user_settings').upsert({ user_id: Auth.user.id, data: { skills: S.skills, rules: S.rules }, updated_at: new Date().toISOString() }).then(() => {}, () => {}); }, 800);
}

/* drawer */
const openDrawer = () => { document.body.classList.add('drawer-open'); loadConvs(); };
const closeDrawer = () => document.body.classList.remove('drawer-open');
$('#btnMenu').onclick = openDrawer; $('#btnCloseDrawer').onclick = closeDrawer; $('#scrim').onclick = closeDrawer;
$('#btnNewChat').onclick = () => { newChat(); closeDrawer(); };
$('#btnSignOut').onclick = () => Auth.signOut();

/* ---------- mode ---------- */
function setMode(m, announce = true) {
  if (S.mode === m) return;
  S.mode = m; applyMode();
  if (announce) {
    const n = { role: 'system', notice: true, done: true, text: m === 'code' ? '⚡ ร่างเปลี่ยนเป็น Focalors — โหมดเขียนโค้ดขั้นสูง' : '🎭 กลับเป็นฟูริน่า — โหมดสนทนา' };
    cur.messages.push(n); addMsg(n); scrollDown(true); persist(n);
  }
  if (Auth.cloud && cur.id) sb().from('conversations').update({ mode: m }).eq('id', cur.id).then(() => {}, () => {});
  save();
}
function applyMode() {
  document.body.dataset.mode = S.mode;
  $$('.seg-b').forEach(b => b.classList.toggle('active', b.dataset.m === S.mode));
  $('#pName').textContent = persona().name; $('#pTag').textContent = persona().tag;
  $('#input').placeholder = S.mode === 'code' ? 'บอกสิ่งที่ต้องการสร้าง…' : 'พิมพ์ข้อความ…';
  document.querySelector('meta[name=theme-color]').content = S.mode === 'code' ? '#0a3447' : '#c8d8e1';
}
$$('.seg-b').forEach(b => b.onclick = () => setMode(b.dataset.m));

/* ---------- ทางลัดโหมดโค้ด ---------- */
const QUICK = [
  ['🐞 หาบั๊ก', 'ช่วยหาบั๊กในโค้ดนี้ อธิบายสาเหตุ และส่งโค้ดที่แก้แล้วฉบับเต็ม:\n'],
  ['🧪 เขียนเทสต์', 'เขียน unit test ครอบคลุมกรณีปกติ กรณีขอบ และกรณี error ให้โค้ดนี้ (ให้รันได้เองและพิมพ์ผลผ่าน/ไม่ผ่าน):\n'],
  ['♻️ Refactor', 'Refactor โค้ดนี้ให้อ่านง่าย แยกหน้าที่ชัดเจน โดยพฤติกรรมเดิมไม่เปลี่ยน:\n'],
  ['🚀 เพิ่มความเร็ว', 'วิเคราะห์คอขวดด้านประสิทธิภาพของโค้ดนี้ และปรับปรุงพร้อมอธิบายว่าดีขึ้นเพราะอะไร:\n'],
  ['🔒 ตรวจความปลอดภัย', 'ตรวจโค้ดนี้หาช่องโหว่ด้านความปลอดภัย (XSS, injection, auth, secrets ฯลฯ) จัดลำดับความรุนแรง และแก้ให้:\n'],
  ['📖 อธิบายโค้ด', 'อธิบายโค้ดนี้ทีละส่วนให้เข้าใจง่าย พร้อมแผนภาพลำดับการทำงานแบบข้อความ:\n'],
  ['🧱 ออกแบบระบบ', 'ช่วยออกแบบสถาปัตยกรรมและโครงสร้างโฟลเดอร์สำหรับ: '],
  ['🗄️ ออกแบบฐานข้อมูล', 'ออกแบบ schema ฐานข้อมูล (พร้อม index, ความสัมพันธ์, และ SQL สร้างตาราง) สำหรับ: '],
  ['🔁 แปลงภาษา', 'แปลงโค้ดนี้เป็นภาษา/เฟรมเวิร์ก ____ โดยรักษาพฤติกรรมเดิม:\n'],
  ['📝 เขียน README', 'เขียน README.md ที่ดีให้โปรเจกต์นี้ (ติดตั้ง, วิธีใช้, ตัวอย่าง, โครงสร้าง):\n']
];
$('#quick').innerHTML = QUICK.map((q, i) => `<button data-q="${i}">${q[0]}</button>`).join('');
$('#quick').addEventListener('click', e => {
  const b = e.target.closest('[data-q]'); if (!b) return;
  const tpl = QUICK[+b.dataset.q][1], ex = input.value.trim();
  input.value = tpl + (ex ? '\n' + ex : ''); autosize(); input.focus();
  if (!ex) input.setSelectionRange(input.value.length, input.value.length);
});
$('#btnTest').onclick = () => { S.autotest = !S.autotest; syncTest(); save(); toast(S.autotest ? '🧪 เปิดทดสอบโค้ดอัตโนมัติ' : 'ปิดทดสอบโค้ดอัตโนมัติ'); };
function syncTest() { $('#btnTest').setAttribute('aria-pressed', S.autotest); }

/* ---------- system prompt ---------- */
function systemPrompt(mode) {
  const parts = [persona(mode).prompt];
  if (mode === 'code') { parts.push(CFG.CODE_TOOLS_PROMPT); if (S.autotest) parts.push(CFG.AUTOTEST_PROMPT); }
  const rules = [CFG.CUSTOM_RULES, S.rules].map(x => (x || '').trim()).filter(Boolean).join('\n');
  if (rules) parts.push('## กฎเพิ่มเติมจากผู้ใช้\n' + rules);
  const sk = S.skills.filter(s => s.on);
  if (sk.length) parts.push('## สกิลที่เปิดใช้งาน\n' + sk.map(s => `### ${s.name}\n${s.body}`).join('\n\n'));
  parts.push(`วันที่ปัจจุบัน: ${new Date().toLocaleString('th-TH', { dateStyle: 'full', timeStyle: 'short' })}`);
  return parts.join('\n\n');
}

/* ---------- attachments ---------- */
const fileInput = $('#fileInput');
$('#btnAttach').onclick = () => fileInput.click();
fileInput.onchange = () => { addFiles([...fileInput.files]); fileInput.value = ''; };
$('#input').addEventListener('paste', e => { const f = [...e.clipboardData.files]; if (f.length) { e.preventDefault(); addFiles(f); } });
['dragover', 'drop'].forEach(ev => document.addEventListener(ev, e => {
  e.preventDefault(); if (ev === 'drop' && e.dataTransfer.files.length) addFiles([...e.dataTransfer.files]);
}));
const readAs = (f, how) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r[how](f); });
async function shrinkImage(f) {
  const url = await readAs(f, 'readAsDataURL');
  if (f.type === 'image/gif' || f.type === 'image/svg+xml') return { url, type: f.type };
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
  const max = 1568, k = Math.min(1, max / Math.max(img.width, img.height));
  if (k === 1 && f.size < 1.5e6) return { url, type: f.type };
  const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return { url: c.toDataURL('image/jpeg', .88), type: 'image/jpeg' };
}
async function addFiles(files) {
  for (const f of files) {
    try {
      if (f.type.startsWith('image/')) {
        const { url, type } = await shrinkImage(f);
        pending.push({ kind: 'image', name: f.name || 'image', mime: type, dataUrl: url });
      } else if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) {
        if (f.size > 20e6) { toast('PDF ใหญ่เกิน 20MB'); continue; }
        pending.push({ kind: 'pdf', name: f.name, mime: 'application/pdf', dataUrl: await readAs(f, 'readAsDataURL') });
      } else {
        if (f.size > 1.5e6) { toast(`${f.name} ใหญ่เกินไป (จำกัด ~1.5MB)`); continue; }
        pending.push({ kind: 'text', name: f.name, text: (await readAs(f, 'readAsText')).slice(0, 200000) });
      }
    } catch { toast('อ่านไฟล์ไม่สำเร็จ: ' + f.name); }
  }
  renderChips();
}
function renderChips() {
  const box = $('#chips'); box.innerHTML = '';
  pending.forEach((f, i) => {
    const c = document.createElement('div'); c.className = 'chip';
    c.innerHTML = (f.kind === 'image' ? `<img src="${f.dataUrl}">` : '<span>📄</span>') + `<span>${esc(f.name.slice(0, 22))}</span><button title="เอาออก">✕</button>`;
    c.querySelector('button').onclick = () => { pending.splice(i, 1); renderChips(); };
    box.append(c);
  });
}

/* ---------- web search ---------- */
const isOpenRouter = () => /openrouter\.ai/.test(S.baseUrl.openai);
const nativeSearch = () => S.provider === 'anthropic' || S.provider === 'gemini' || (S.provider === 'openai' && (isOpenRouter() || S.source === 'proxy'));
async function tavily(q, signal) {
  const r = await fetch('https://api.tavily.com/search', {
    method: 'POST', signal, headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: S.tavilyKey, query: q.slice(0, 380), max_results: 5, include_answer: true })
  });
  if (!r.ok) throw new Error('Tavily: ' + r.status);
  const j = await r.json();
  return `[ผลค้นเว็บ]\n${j.answer ? 'สรุป: ' + j.answer + '\n' : ''}` + (j.results || []).map((x, i) => `${i + 1}. ${x.title} — ${x.url}\n${(x.content || '').slice(0, 500)}`).join('\n');
}
$('#btnWeb').onclick = () => { S.web = !S.web; syncWeb(); save(); toast(S.web ? '🌐 เปิดการค้นเว็บแล้ว' : 'ปิดการค้นเว็บแล้ว'); };
function syncWeb() { $('#btnWeb').setAttribute('aria-pressed', S.web); }

/* ---------- API layer ---------- */
async function readSSE(res, onData) {
  if (!res.ok) { let t = ''; try { t = await res.text(); } catch {} throw new Error(`HTTP ${res.status} ${t.slice(0, 400)}`); }
  const rd = res.body.getReader(), dec = new TextDecoder(); let buf = '';
  for (;;) {
    const { done, value } = await rd.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    let i; while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line.startsWith('data:')) continue;
      const d = line.slice(5).trim(); if (!d || d === '[DONE]') continue;
      let j; try { j = JSON.parse(d); } catch { continue; }
      onData(j);
    }
  }
}
const b64 = u => u.split(',')[1];
function fullText(m) {
  let t = m.text || '';
  (m.files || []).filter(f => f.kind === 'text').forEach(f => t += `\n\n[ไฟล์: ${f.name}]\n\`\`\`\n${f.text}\n\`\`\``);
  if (m.ctx) t += '\n\n' + m.ctx;
  return t || '(ดูไฟล์แนบ)';
}
function hist(exclude) {
  let a = cur.messages.filter(m => !m.notice && m !== exclude && (m.text || m.files?.length));
  a = a.slice(-CFG.MAX_HISTORY);
  while (a.length && a[0].role !== 'user') a.shift();
  const out = [];   // รวมข้อความที่ role ซ้ำติดกัน (บาง API ไม่รับ)
  a.forEach(m => {
    const p = out[out.length - 1];
    if (p && p.role === m.role) out[out.length - 1] = { role: m.role, text: [p.text, m.text].filter(Boolean).join('\n\n'), files: [...(p.files || []), ...(m.files || [])], ctx: m.ctx || p.ctx };
    else out.push({ role: m.role, text: m.text, files: m.files, ctx: m.ctx });
  });
  return out;
}

const PROVIDER_FN = {
  openai(msgs, sys) {
    const model = S.model.openai + (S.web && (isOpenRouter() || S.source === 'proxy') && !/:online$/.test(S.model.openai) ? ':online' : '');
    const messages = [{ role: 'system', content: sys }, ...msgs.map(m => {
      if (m.role === 'assistant') return { role: 'assistant', content: m.text };
      const imgs = (m.files || []).filter(f => f.kind === 'image');
      if (!imgs.length) return { role: 'user', content: fullText(m) };
      return { role: 'user', content: [{ type: 'text', text: fullText(m) }, ...imgs.map(f => ({ type: 'image_url', image_url: { url: f.dataUrl } }))] };
    })];
    return {
      model, url: S.baseUrl.openai.replace(/\/$/, '') + '/chat/completions',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + S.apiKey, 'X-Title': 'Fontaine AI' },
      body: { model, messages, stream: true, max_tokens: CFG.MAX_TOKENS },
      parse: (j, on) => { const d = j.choices?.[0]?.delta?.content; if (d) on(d); }
    };
  },
  anthropic(msgs, sys) {
    const messages = msgs.map(m => {
      if (m.role === 'assistant') return { role: 'assistant', content: m.text };
      const c = [];
      (m.files || []).forEach(f => {
        if (f.kind === 'image') c.push({ type: 'image', source: { type: 'base64', media_type: f.mime, data: b64(f.dataUrl) } });
        if (f.kind === 'pdf') c.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64(f.dataUrl) } });
      });
      c.push({ type: 'text', text: fullText(m) }); return { role: 'user', content: c };
    });
    const body = { model: S.model.anthropic, max_tokens: CFG.MAX_TOKENS, system: sys, messages, stream: true };
    if (S.web) body.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }];
    return {
      model: S.model.anthropic, url: S.baseUrl.anthropic.replace(/\/$/, '') + '/v1/messages',
      headers: { 'Content-Type': 'application/json', 'x-api-key': S.apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body,
      parse: (j, on) => {
        if (j.type === 'content_block_delta' && j.delta?.type === 'text_delta') on(j.delta.text);
        if (j.type === 'error') throw new Error(j.error?.message || 'API error');
      }
    };
  },
  gemini(msgs, sys) {
    const contents = msgs.map(m => {
      if (m.role === 'assistant') return { role: 'model', parts: [{ text: m.text }] };
      const parts = [{ text: fullText(m) }];
      (m.files || []).forEach(f => { if (f.kind === 'image' || f.kind === 'pdf') parts.push({ inlineData: { mimeType: f.mime, data: b64(f.dataUrl) } }); });
      return { role: 'user', parts };
    });
    const body = { systemInstruction: { parts: [{ text: sys }] }, contents, generationConfig: { maxOutputTokens: CFG.MAX_TOKENS } };
    if (S.web) body.tools = [{ google_search: {} }];
    return {
      model: S.model.gemini,
      url: `${S.baseUrl.gemini.replace(/\/$/, '')}/v1beta/models/${encodeURIComponent(S.model.gemini)}:streamGenerateContent?alt=sse`,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': S.apiKey },
      body,
      parse: (j, on) => { (j.candidates?.[0]?.content?.parts || []).forEach(p => p.text && on(p.text)); }
    };
  }
};
const useProxy = () => S.source === 'proxy' && Auth.cloud;
async function request(req, signal) {
  if (useProxy()) {
    const token = await Auth.token();
    return fetch(CFG.SUPABASE_URL.replace(/\/$/, '') + '/functions/v1/ai-proxy', {
      method: 'POST', signal,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, apikey: CFG.SUPABASE_ANON_KEY },
      body: JSON.stringify({ provider: S.provider, model: req.model, body: req.body })
    });
  }
  return fetch(req.url, { method: 'POST', signal, headers: req.headers, body: JSON.stringify(req.body) });
}
async function stream(am, msgs, sys, signal) {
  const req = PROVIDER_FN[S.provider](msgs, sys);
  const res = await request(req, signal);
  await readSSE(res, j => req.parse(j, d => { am.text += d; paintSoon(am); }));
}

/* ---------- send ---------- */
const input = $('#input'), btnSend = $('#btnSend');
function autosize() { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 180) + 'px'; }
input.addEventListener('input', autosize);
input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } });
btnSend.onclick = () => busy ? abortCtl?.abort() : send();

const slimReport = r => ({
  total: r.total, failed: r.failed, passed: r.passed, skipped: r.skipped,
  tasks: r.tasks.map(t => ({ title: t.title, status: t.status, note: t.note, ms: t.ms,
    errors: t.errors.slice(0, 4).map(x => x.slice(0, 500)), warns: t.warns.slice(0, 3).map(x => x.slice(0, 300)), logs: t.logs.slice(0, 6).map(x => x.slice(0, 300)) }))
});

async function send() {
  if (busy) return;
  const text = input.value.trim();
  if (!text && !pending.length) return;
  if (!useProxy() && !S.apiKey) { openModal('#mSettings'); fillSettings(); toast('ใส่ API Key ก่อนนะ'); return; }

  if (CFG.CODE_TRIGGERS.some(r => r.test(text))) setMode('code');
  else if (CFG.CHAT_TRIGGERS.some(r => r.test(text))) setMode('furina');
  const mode = S.mode;

  const files = pending; pending = []; renderChips();
  const um = { role: 'user', text, files, fileNames: files.map(f => f.name), mode, done: true };
  cur.messages.push(um); addMsg(um);
  input.value = ''; autosize(); scrollDown(true);

  busy = true; btnSend.classList.add('busy'); abortCtl = new AbortController();
  const signal = abortCtl.signal;
  const dbReady = (async () => { await ensureConv(text || files[0]?.name); await persist(um); })();
  const testing = mode === 'code' && S.autotest;
  let fixRounds = 0;
  try {
    if (S.web && !nativeSearch()) {
      if (S.tavilyKey) { try { um.ctx = await tavily(text, signal); } catch (e) { if (e.name === 'AbortError') throw e; toast('ค้นเว็บไม่สำเร็จ: ' + e.message); } }
      else toast('โมเดลนี้ไม่มีระบบค้นเว็บในตัว — ใส่ Tavily Key ในตั้งค่าเพื่อใช้ค้นเว็บ');
    }
    for (;;) {
      const am = { role: 'assistant', text: '', mode, partial: true };
      cur.messages.push(am); addMsg(am); scrollDown(true);
      try {
        await stream(am, hist(am), systemPrompt(mode), signal);
        if (!am.text) am.text = '*เงียบไปครู่หนึ่ง…* (ไม่ได้รับข้อความตอบกลับจาก API)';
      } catch (e) {
        if (e.name === 'AbortError') { if (!am.text) am.text = '*หยุดการตอบแล้ว*'; }
        else am.error = '⚠️ ' + (e.message || e) + (/Failed to fetch/i.test(e.message) ? ' (เช็กอินเทอร์เน็ต / Base URL / CORS ของผู้ให้บริการ)' : '');
      }
      let again = false;
      if (testing && !am.error && !signal.aborted && am.text) {
        const hasCode = Runner.plan(Runner.extract(am.text)).length > 0;
        if (hasCode) {
          am.status = '🧪 เตรียมทดสอบโค้ด…'; paint(am); scrollDown();
          const rep = await raceAbort(Runner.runAll(am.text, s => { am.status = s; paintSoon(am); }), signal);
          am.status = '';
          if (rep && rep.total) {
            am.report = slimReport(rep); am.fix = fixRounds;
            if (!rep.ok && fixRounds < CFG.MAX_AUTOFIX && !signal.aborted) {
              am.draft = true; again = true; fixRounds++;
              const note = { role: 'system', notice: true, done: true, text: `🔧 ทดสอบไม่ผ่าน (${rep.failed}/${rep.total}) — ส่งผลให้ AI แก้อัตโนมัติ รอบที่ ${fixRounds}/${CFG.MAX_AUTOFIX}` };
              const fb = { role: 'user', hidden: true, done: true, text: Runner.feedback(rep), mode };
              am.partial = false; am.done = true; paint(am);
              cur.messages.push(note); addMsg(note);
              cur.messages.push(fb);
              await dbReady; await persist(am); await persist(note); await persist(fb);
            }
          }
        }
      }
      if (!again) { am.partial = false; am.done = true; am.status = ''; paint(am); scrollDown(); await dbReady; await persist(am); break; }
    }
  } catch (e) {
    toast('เกิดข้อผิดพลาด: ' + (e.message || e));
  } finally {
    busy = false; btnSend.classList.remove('busy'); abortCtl = null;
    delete um.ctx; save();
    if (Auth.cloud) renderConvs();
  }
}

/* ---------- ปุ่มในแชต: คัดลอก / รัน / ดาวน์โหลด / ZIP ---------- */
chat.addEventListener('click', e => {
  const t = e.target.closest('[data-copy],[data-run],[data-dl],[data-zip],[data-runweb]'); if (!t) return;
  if (t.hasAttribute('data-copy')) {
    navigator.clipboard.writeText(t.closest('.code').querySelector('code').textContent).then(() => { t.textContent = 'คัดลอกแล้ว ✓'; setTimeout(() => t.textContent = 'คัดลอก', 1400); });
    return;
  }
  const m = rowMap.get(t.closest('.msg')); if (!m) return;
  const blocks = Runner.extract(m.text), names = Runner.fileNames(blocks);
  if (t.hasAttribute('data-dl')) { const i = +t.dataset.dl; Runner.download(names[i], blocks[i].code); }
  else if (t.hasAttribute('data-zip')) Runner.download('fontaine-code.zip', Runner.zip(blocks.map((b, i) => ({ name: names[i], data: b.code }))));
  else if (t.hasAttribute('data-run')) { const task = Runner.taskForBlock(blocks[+t.dataset.run], blocks); if (task) openPreview(task); }
  else if (t.hasAttribute('data-runweb')) { const task = Runner.plan(blocks).find(x => x.kind === 'html'); if (task) openPreview(task); }
});
function openPreview(task) {
  pvStop?.(); $('#pvTitle').textContent = '▶ ' + task.title;
  pvStop = Runner.live(task, { frame: $('#pvFrame'), con: $('#pvCon'), onStatus: m => { $('#pvTitle').textContent = '▶ ' + m; } });
  openModal('#mPreview');
}

/* ---------- modals ---------- */
function openModal(id) { $(id).classList.add('open'); }
function closeWrap(w) { w.classList.remove('open'); if (w.id === 'mPreview') { pvStop?.(); pvStop = null; } }
function closeModal(id) { closeWrap($(id)); }
$$('.modal-wrap').forEach(w => {
  w.addEventListener('mousedown', e => { if (e.target === w) closeWrap(w); });
  $$('.close', w).forEach(b => b.onclick = () => closeWrap(w));
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') { $$('.modal-wrap.open').forEach(closeWrap); closeDrawer(); } });

/* settings */
const fProvider = $('#fProvider'), fSource = $('#fSource');
Object.entries(CFG.PROVIDERS).forEach(([k, v]) => fProvider.add(new Option(v.label, k)));
function syncOwn() { $$('[data-own]').forEach(el => el.hidden = fSource.value === 'proxy'); }
function fillSettings() {
  fSource.querySelector('option[value=proxy]').disabled = !Auth.cloud;
  fSource.value = useProxy() ? 'proxy' : 'own'; syncOwn();
  fProvider.value = S.provider; $('#fKey').value = S.apiKey; $('#fTavily').value = S.tavilyKey; $('#fRules').value = S.rules;
  $('#fBase').value = S.baseUrl[S.provider]; $('#fModel').value = S.model[S.provider];
}
fSource.onchange = syncOwn;
fProvider.onchange = () => { S.provider = fProvider.value; $('#fBase').value = S.baseUrl[S.provider]; $('#fModel').value = S.model[S.provider]; };
$('#btnSettings').onclick = () => { fillSettings(); openModal('#mSettings'); };
$('#sCancel').onclick = () => closeModal('#mSettings');
$('#sSave').onclick = () => {
  S.source = fSource.value; S.provider = fProvider.value; S.apiKey = $('#fKey').value.trim(); S.tavilyKey = $('#fTavily').value.trim(); S.rules = $('#fRules').value;
  S.baseUrl[S.provider] = $('#fBase').value.trim() || def.baseUrl[S.provider];
  S.model[S.provider] = $('#fModel').value.trim() || def.model[S.provider];
  save(); pushSettings(); closeModal('#mSettings'); toast('บันทึกแล้ว ✓');
};

/* skills */
function renderSkills() {
  const box = $('#skillList'); box.innerHTML = '';
  if (!S.skills.length) box.innerHTML = '<p class="hint">ยังไม่มีสกิล — เพิ่มด้านล่างได้เลย</p>';
  S.skills.forEach((s, i) => {
    const d = document.createElement('div'); d.className = 'skill';
    d.innerHTML = `<div class="si"><b>${esc(s.name)}</b><small>${esc(s.body.slice(0, 80))}</small></div>
      <label class="sw"><input type="checkbox" ${s.on ? 'checked' : ''}><span></span></label><button class="del" title="ลบ">🗑️</button>`;
    d.querySelector('input').onchange = e => { s.on = e.target.checked; save(); pushSettings(); updSkillBadge(); };
    d.querySelector('.del').onclick = () => { S.skills.splice(i, 1); save(); pushSettings(); renderSkills(); updSkillBadge(); };
    box.append(d);
  });
}
function updSkillBadge() { const n = S.skills.filter(s => s.on).length; const b = $('#skillCount'); b.hidden = !n; b.textContent = n; }
$('#btnSkills').onclick = () => { renderSkills(); openModal('#mSkills'); };
$('#skClose').onclick = () => closeModal('#mSkills');
$('#skAdd').onclick = () => {
  const name = $('#skName').value.trim(), body = $('#skBody').value.trim();
  if (!name || !body) return toast('ใส่ชื่อและคำสั่งของสกิลด้วยนะ');
  S.skills.push({ name, body, on: true }); $('#skName').value = $('#skBody').value = '';
  save(); pushSettings(); renderSkills(); updSkillBadge(); toast('เพิ่มสกิลแล้ว ✨');
};
$('#skExport').onclick = () => Runner.download('skills.json', new Blob([JSON.stringify(S.skills, null, 2)], { type: 'application/json' }));
$('#skImport').onclick = () => $('#skFile').click();
$('#skFile').onchange = async e => {
  try {
    const arr = JSON.parse(await readAs(e.target.files[0], 'readAsText'));
    arr.filter(s => s.name && s.body).forEach(s => S.skills.push({ name: String(s.name), body: String(s.body), on: s.on !== false }));
    save(); pushSettings(); renderSkills(); updSkillBadge(); toast('นำเข้าแล้ว');
  } catch { toast('ไฟล์ JSON ไม่ถูกต้อง'); }
  e.target.value = '';
};

/* clear */
$('#btnClear').onclick = async () => {
  if (busy) abortCtl?.abort();
  if (Auth.cloud && cur.id) {
    if (!confirm('ลบแชทนี้ออกจากฐานข้อมูล?')) return;
    const { error } = await sb().from('conversations').delete().eq('id', cur.id);
    if (error) return dbWarn(error);
    convs = convs.filter(c => c.id !== cur.id);
  }
  cur = { id: null, title: 'แชทใหม่', messages: [] }; save(); renderAll(); renderConvs(); toast('ล้างแชตแล้ว');
};

/* ripple on buttons */
document.addEventListener('pointerdown', e => {
  const b = e.target.closest('.btn'); if (!b) return;
  const r = b.getBoundingClientRect(), s = Math.max(r.width, r.height) / 2, el = document.createElement('span');
  el.className = 'ripple'; el.style.cssText = `width:${s}px;height:${s}px;left:${e.clientX - r.left - s / 2}px;top:${e.clientY - r.top - s / 2}px`;
  b.append(el); setTimeout(() => el.remove(), 650);
});

/* ---------- bubbles background ---------- */
(function bubbles() {
  const cv = $('#bubbles'), cx = cv.getContext('2d');
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  let W, H, dpr, list = [];
  const resize = () => { dpr = Math.min(devicePixelRatio || 1, 2); W = cv.width = innerWidth * dpr; H = cv.height = innerHeight * dpr; };
  resize(); addEventListener('resize', resize);
  const mk = (init) => ({ x: Math.random() * W, y: init ? Math.random() * H : H + 20, r: (3 + Math.random() * 11) * dpr, v: (.2 + Math.random() * .6) * dpr, ph: Math.random() * 6.28, a: .25 + Math.random() * .35 });
  for (let i = 0; i < 28; i++) list.push(mk(true));
  (function loop(t) {
    if (!document.hidden) {
      cx.clearRect(0, 0, W, H);
      const code = document.body.dataset.mode === 'code';
      list.forEach((b, i) => {
        b.y -= b.v; b.x += Math.sin(t / 1100 + b.ph) * .4 * dpr;
        if (b.y < -30) list[i] = mk(false);
        const g = cx.createRadialGradient(b.x - b.r * .3, b.y - b.r * .3, b.r * .1, b.x, b.y, b.r);
        g.addColorStop(0, `rgba(255,255,255,${b.a + .2})`); g.addColorStop(1, code ? `rgba(94,191,224,${b.a * .3})` : `rgba(0,173,193,${b.a * .25})`);
        cx.fillStyle = g; cx.beginPath(); cx.arc(b.x, b.y, b.r, 0, 6.283); cx.fill();
        cx.strokeStyle = `rgba(255,255,255,${b.a * .8})`; cx.lineWidth = dpr; cx.stroke();
      });
    }
    requestAnimationFrame(loop);
  })(0);
})();

/* ---------- init ---------- */
(async function init() {
  applyMode(); syncWeb(); syncTest(); updSkillBadge();
  await Auth.start();                       // ด่านคีย์ + Discord (ข้ามถ้ายังไม่ตั้ง Supabase)
  document.body.dataset.cloud = Auth.cloud ? '1' : '0';
  if (Auth.cloud) {
    $('#uName').textContent = Auth.displayName();
    const av = $('#uAv'); if (Auth.profile?.avatar_url) { av.src = Auth.profile.avatar_url; av.referrerPolicy = 'no-referrer'; av.hidden = false; }
    await pullSettings(); updSkillBadge();
    await loadConvs();
    if (convs.length) await openConv(convs[0].id); else renderAll();
  } else {
    cur.messages = (S.localMessages || []).map(m => ({ ...m, done: true, saved: true }));
    renderAll();
  }
  if (!useProxy() && !S.apiKey) setTimeout(() => toast('เริ่มต้น: กด ⚙️ แล้วใส่ API Key'), 800);
})();
})();
