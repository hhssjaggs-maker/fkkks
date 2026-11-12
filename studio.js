/* ==========================================================
   studio.js — หน้าสร้างรูป + คลังรูป
   ผู้ให้บริการ: Pollinations (ฟรี) / Gemini / OpenAI / OpenRouter
   คลังรูปเก็บในเครื่องนี้ (IndexedDB) ไม่ขึ้นฐานข้อมูล
   ต้องโหลดหลัง app.js (ใช้ window.AppBridge)
   ========================================================== */
window.Studio = (() => {
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const B = () => window.AppBridge;
const ic = (n, c = '') => `<svg class="i ${c}" aria-hidden="true"><use href="#i-${n}"/></svg>`;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ---------- ค่าตั้งต้น ---------- */
const PROV = {
  pollinations: { label: 'Pollinations (ฟรี)', base: 'https://image.pollinations.ai/prompt', model: 'flux', needKey: false, ref: false,
    note: 'ฟรี ไม่ต้องมี key (ถ้าบริการเปลี่ยนไปให้ใส่ key/Base URL ใหม่) · ไม่รองรับรูปอ้างอิง' },
  gemini: { label: 'Google Gemini', base: 'https://generativelanguage.googleapis.com', model: 'gemini-2.5-flash-image', needKey: true, ref: true,
    note: 'ใช้ Gemini API key (AIza…) · รองรับรูปอ้างอิง/แก้ไขรูป' },
  openai: { label: 'OpenAI Images', base: 'https://api.openai.com/v1', model: 'gpt-image-1', needKey: true, ref: true,
    note: 'ใช้ OpenAI API key · บางบัญชีต้องยืนยันองค์กรก่อนใช้ gpt-image-1' },
  openrouter: { label: 'OpenRouter', base: 'https://openrouter.ai/api/v1', model: 'google/gemini-2.5-flash-image', needKey: true, ref: true,
    note: 'ใช้ OpenRouter key · เลือกโมเดลที่ output เป็นรูปได้' }
};
const STYLES = [
  ['none', 'อิสระ', ''],
  ['anime', 'อนิเมะ', 'anime style illustration, vibrant colors, clean line art, cel shading, highly detailed'],
  ['photo', 'สมจริง', 'photorealistic, ultra detailed, natural lighting, sharp focus, 35mm photograph'],
  ['3d', '3D', '3D render, soft studio lighting, smooth materials, high detail'],
  ['water', 'สีน้ำ', 'watercolor painting, soft washes, paper texture, delicate gradients'],
  ['oil', 'สีน้ำมัน', 'oil painting, rich brush strokes, classical composition, dramatic lighting'],
  ['pixel', 'พิกเซล', 'pixel art, limited palette, crisp pixels, retro game style'],
  ['neon', 'ไซเบอร์พังค์', 'cyberpunk, neon lights, rainy night city, cinematic, high contrast'],
  ['sketch', 'สเก็ตช์', 'pencil sketch, hand drawn, cross hatching, monochrome'],
  ['fantasy', 'แฟนตาซี', 'epic fantasy concept art, dramatic atmosphere, intricate details, volumetric light'],
  ['fontaine', 'ฟองแตน', 'baroque theatrical aesthetic, flowing water and glass-like light, blue and white palette, elegant stage lighting, dreamy']
];
const RATIOS = { '1:1': [1024, 1024], '3:4': [896, 1152], '4:3': [1152, 896], '16:9': [1344, 768], '9:16': [768, 1344] };

/* ---------- state ---------- */
const KEY = 'fontaine_img_v1';
let C = { provider: 'pollinations', key: {}, base: {}, model: {} };
try { C = { ...C, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch {}
const saveC = () => { try { localStorage.setItem(KEY, JSON.stringify(C)); } catch {} };
const cfg = (p = C.provider) => ({
  key: C.key[p] || chatKeyFor(p), base: (C.base[p] || PROV[p].base).replace(/\/$/, ''), model: C.model[p] || PROV[p].model
});
function chatKeyFor(p) {                         // ยืม key จากหน้าแชตถ้าเป็นเจ้าเดียวกัน
  const h = B()?.chatInfo?.(); if (!h || !h.key) return '';
  if (p === 'gemini' && h.provider === 'gemini') return h.key;
  if (p === 'openrouter' && h.provider === 'openai' && /openrouter/i.test(h.base)) return h.key;
  if (p === 'openai' && h.provider === 'openai' && /api\.openai\.com/i.test(h.base)) return h.key;
  return '';
}
let style = 'none', ratio = '1:1', count = 1, refs = [], abortCtl = null, running = false;

/* ---------- IndexedDB (คลังรูป) ---------- */
let dbp;
function db() {
  return dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open('fontaine_gallery', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('imgs', { keyPath: 'id' });
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  }));
}
const tx = async (mode, fn) => { const d = await db(); return new Promise((res, rej) => { const t = d.transaction('imgs', mode); const out = fn(t.objectStore('imgs')); t.oncomplete = () => res(out.result ?? out); t.onerror = () => rej(t.error); }); };
const gPut = rec => tx('readwrite', s => s.put(rec)).catch(() => B().toast('บันทึกลงคลังไม่ได้ (พื้นที่เต็ม/โหมดส่วนตัว)'));
const gDel = id => tx('readwrite', s => s.delete(id));
const gAll = () => tx('readonly', s => s.getAll()).then(a => (a || []).sort((x, y) => y.ts - x.ts)).catch(() => []);
const gClear = () => tx('readwrite', s => s.clear());

/* ---------- ตัวช่วย ---------- */
const urlOf = rec => rec.blob ? URL.createObjectURL(rec.blob) : rec.url;
const b64ToBlob = (b64, mime = 'image/png') => { const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new Blob([u], { type: mime }); };
const dataUrlToBlob = d => { const [h, b] = d.split(','); return b64ToBlob(b, (h.match(/:(.*?);/) || [])[1] || 'image/png'); };
const b64 = d => d.split(',')[1];
async function must(res) {
  if (res.ok) return res;
  let t = ''; try { t = (await res.text()).slice(0, 260); } catch {}
  throw new Error('HTTP ' + res.status + (t ? ' — ' + t.replace(/\s+/g, ' ') : ''));
}
function shrink(file, max = 1280) {            // ย่อรูปอ้างอิงก่อนส่ง
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => {
      const im = new Image();
      im.onload = () => {
        const k = Math.min(1, max / Math.max(im.width, im.height)), c = document.createElement('canvas');
        c.width = Math.round(im.width * k); c.height = Math.round(im.height * k);
        c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
        res({ name: file.name, dataUrl: c.toDataURL('image/jpeg', .9) });
      };
      im.onerror = () => rej(new Error('อ่านรูปไม่ได้')); im.src = fr.result;
    };
    fr.onerror = () => rej(fr.error); fr.readAsDataURL(file);
  });
}
const fullPrompt = (p) => {
  const st = STYLES.find(s => s[0] === style)?.[2];
  const neg = $('#imgNeg').value.trim();
  return [p, st, neg && ('Avoid: ' + neg)].filter(Boolean).join('. ');
};

/* ---------- ตัวเชื่อมแต่ละผู้ให้บริการ: คืน { blob } หรือ { url } ---------- */
const GEN = {
  async pollinations(prompt, { signal }) {
    const c = cfg(), [w, h] = RATIOS[ratio], seed = Math.floor(Math.random() * 1e9);
    const u = `${c.base}/${encodeURIComponent(prompt)}?width=${w}&height=${h}&seed=${seed}&model=${encodeURIComponent(c.model)}&nologo=true`;
    const headers = c.key ? { Authorization: 'Bearer ' + c.key } : {};
    try {
      const res = await must(await fetch(u, { signal, headers }));
      const blob = await res.blob(); if (!/^image\//.test(blob.type)) throw new Error('ไม่ได้รับรูปภาพ');
      return { blob };
    } catch (e) {
      if (e.name === 'AbortError' || /HTTP/.test(e.message)) throw e;
      // CORS ปิด → ลองแสดงผ่านแท็ก <img> แทน (บันทึกเป็นลิงก์)
      await new Promise((ok, no) => { const im = new Image(); im.onload = ok; im.onerror = () => no(new Error('โหลดรูปจาก Pollinations ไม่สำเร็จ (เช็กอินเทอร์เน็ต/บริการอาจเปลี่ยนไป)')); im.src = u; });
      return { url: u };
    }
  },
  async gemini(prompt, { signal }) {
    const c = cfg(); if (!c.key) throw new Error('ยังไม่ได้ใส่ API Key ของ Gemini (กดไอคอนเฟืองในหน้านี้)');
    const parts = [{ text: `${prompt}\n(aspect ratio ${ratio})` }];
    refs.forEach(r => parts.push({ inlineData: { mimeType: 'image/jpeg', data: b64(r.dataUrl) } }));
    const res = await must(await fetch(`${c.base}/v1beta/models/${encodeURIComponent(c.model)}:generateContent`, {
      method: 'POST', signal, headers: { 'Content-Type': 'application/json', 'x-goog-api-key': c.key },
      body: JSON.stringify({ contents: [{ parts }], generationConfig: { responseModalities: ['IMAGE', 'TEXT'], imageConfig: { aspectRatio: ratio } } })
    }));
    const j = await res.json();
    const ps = j.candidates?.[0]?.content?.parts || [];
    const img = ps.find(p => (p.inlineData || p.inline_data));
    if (!img) {
      const why = j.promptFeedback?.blockReason || j.candidates?.[0]?.finishReason || ps.map(p => p.text).filter(Boolean).join(' ').slice(0, 200) || 'ไม่มีรูปในคำตอบ';
      throw new Error('Gemini ไม่ส่งรูปกลับมา: ' + why);
    }
    const d = img.inlineData || img.inline_data;
    return { blob: b64ToBlob(d.data, d.mimeType || d.mime_type || 'image/png') };
  },
  async openai(prompt, { signal }) {
    const c = cfg(); if (!c.key) throw new Error('ยังไม่ได้ใส่ API Key ของ OpenAI');
    const [w, h] = RATIOS[ratio], size = w === h ? '1024x1024' : (w > h ? '1536x1024' : '1024x1536');
    let res;
    if (refs.length) {
      const f = new FormData(); f.append('model', c.model); f.append('prompt', prompt); f.append('size', size);
      refs.forEach((r, i) => f.append('image[]', dataUrlToBlob(r.dataUrl), `ref${i}.jpg`));
      res = await must(await fetch(`${c.base}/images/edits`, { method: 'POST', signal, headers: { Authorization: 'Bearer ' + c.key }, body: f }));
    } else {
      res = await must(await fetch(`${c.base}/images/generations`, {
        method: 'POST', signal, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + c.key },
        body: JSON.stringify({ model: c.model, prompt, size, n: 1 })
      }));
    }
    const d = (await res.json()).data?.[0]; if (!d) throw new Error('ไม่ได้รับรูปจาก OpenAI');
    return d.b64_json ? { blob: b64ToBlob(d.b64_json) } : { url: d.url };
  },
  async openrouter(prompt, { signal }) {
    const c = cfg(); if (!c.key) throw new Error('ยังไม่ได้ใส่ API Key ของ OpenRouter');
    const content = [{ type: 'text', text: `${prompt}\n(aspect ratio ${ratio})` }];
    refs.forEach(r => content.push({ type: 'image_url', image_url: { url: r.dataUrl } }));
    const res = await must(await fetch(`${c.base}/chat/completions`, {
      method: 'POST', signal, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + c.key },
      body: JSON.stringify({ model: c.model, modalities: ['image', 'text'], messages: [{ role: 'user', content }] })
    }));
    const m = (await res.json()).choices?.[0]?.message;
    const u = m?.images?.[0]?.image_url?.url || m?.images?.[0]?.url;
    if (!u) throw new Error('โมเดลนี้ไม่ส่งรูปกลับมา: ' + String(m?.content || '').slice(0, 160));
    return u.startsWith('data:') ? { blob: dataUrlToBlob(u) } : { url: u };
  }
};

/* ---------- UI: ตัวเลือก ---------- */
function buildOptions() {
  $('#imgStyles').innerHTML = STYLES.map(s => `<button class="chip-b${s[0] === style ? ' on' : ''}" data-s="${s[0]}">${esc(s[1])}</button>`).join('');
  $('#imgRatios').innerHTML = Object.keys(RATIOS).map(r => {
    const [w, h] = RATIOS[r], k = 18 / Math.max(w, h);
    return `<button class="rat-b${r === ratio ? ' on' : ''}" data-r="${r}"><i style="width:${Math.round(w * k)}px;height:${Math.round(h * k)}px"></i><span>${r}</span></button>`;
  }).join('');
  $('#imgCount').innerHTML = [1, 2, 3, 4].map(n => `<button class="cnt-b${n === count ? ' on' : ''}" data-n="${n}">${n}</button>`).join('');
}
$('#imgStyles').addEventListener('click', e => { const b = e.target.closest('[data-s]'); if (!b) return; style = b.dataset.s; buildOptions(); });
$('#imgRatios').addEventListener('click', e => { const b = e.target.closest('[data-r]'); if (!b) return; ratio = b.dataset.r; buildOptions(); });
$('#imgCount').addEventListener('click', e => { const b = e.target.closest('[data-n]'); if (!b) return; count = +b.dataset.n; buildOptions(); });

function renderRefs() {
  const box = $('#imgRefs'); box.innerHTML = '';
  refs.forEach((r, i) => {
    const d = document.createElement('div'); d.className = 'ref';
    d.innerHTML = `<img alt=""><button title="เอาออก">${ic('x')}</button>`; d.querySelector('img').src = r.dataUrl;
    d.querySelector('button').onclick = () => { refs.splice(i, 1); renderRefs(); }; box.append(d);
  });
  box.hidden = !refs.length;
  const p = PROV[C.provider];
  $('#imgRefHint').hidden = !(refs.length && !p.ref);
}
$('#imgRef').onclick = () => $('#imgRefFile').click();
$('#imgRefFile').onchange = async e => {
  for (const f of [...e.target.files].slice(0, 3 - refs.length)) { try { refs.push(await shrink(f)); } catch (x) { B().toast(x.message); } }
  e.target.value = ''; renderRefs();
};

/* ปรับ prompt ด้วย AI แชต */
$('#imgEnh').onclick = async () => {
  const t = $('#imgPrompt').value.trim(); if (!t) return B().toast('พิมพ์ไอเดียสั้นๆ ก่อนนะ');
  const b = $('#imgEnh'); b.classList.add('busy');
  try {
    const out = await B().chatOnce('You rewrite short ideas into one rich, vivid English prompt for an image generator: subject, setting, composition, lighting, mood, lens/medium details. Keep the user\'s intent exactly; do not add disclaimers. Output ONLY the prompt text, no quotes, no preface.', t);
    if (out.trim()) { $('#imgPrompt').value = out.trim().replace(/^["“]|["”]$/g, ''); autoH(); B().toast('ปรับ prompt ให้แล้ว ✨'); }
  } catch (e) { B().toast('ปรับ prompt ไม่สำเร็จ: ' + (e.message || e)); }
  b.classList.remove('busy');
};
const autoH = () => { const t = $('#imgPrompt'); t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 200) + 'px'; };
$('#imgPrompt').addEventListener('input', autoH);

/* ---------- สร้างรูป ---------- */
const out = $('#imgOut');
function makeCard(prompt) {
  const d = document.createElement('div'); d.className = 'gcard loading';
  d.innerHTML = `<div class="shim"><span>${ic('image')}</span></div>`;
  d.style.aspectRatio = ratio.replace(':', '/'); out.prepend(d); return d;
}
function fillCard(card, rec) {
  card.classList.remove('loading', 'err'); card.innerHTML = ''; card.dataset.id = rec.id;
  const im = document.createElement('img'); im.alt = rec.prompt; im.src = urlOf(rec); card.append(im);
  card.onclick = () => openViewer(rec);
}
function errCard(card, msg, retry) {
  card.classList.remove('loading'); card.classList.add('err');
  card.innerHTML = `<div class="gerr">${ic('info')}<p>${esc(msg)}</p><button class="btn sm">ลองใหม่</button></div>`;
  card.querySelector('button').onclick = e => { e.stopPropagation(); card.classList.add('loading'); card.classList.remove('err'); card.innerHTML = `<div class="shim"><span>${ic('image')}</span></div>`; retry(); };
}
async function runOne(card, prompt, shown) {
  const my = abortCtl;
  const snap = { style, ratio, provider: C.provider, model: cfg().model };
  try {
    const r = await GEN[C.provider](prompt, { signal: my.signal });
    const rec = { id: crypto.randomUUID?.() || String(Date.now() + Math.random()), ts: Date.now(), prompt: shown, full: prompt, ...snap, ...r };
    fillCard(card, rec); await gPut(rec); refreshGalCount();
  } catch (e) {
    if (e.name === 'AbortError') { card.remove(); return; }
    const m = (e.message || String(e)) + (/Failed to fetch|NetworkError/i.test(e.message) ? ' (เช็กอินเทอร์เน็ต / Base URL / CORS ของผู้ให้บริการ)' : '');
    errCard(card, m, () => { abortCtl = abortCtl && !abortCtl.signal.aborted ? abortCtl : new AbortController(); runOne(card, prompt, shown); });
  }
}
async function go() {
  if (running) { abortCtl?.abort(); return; }
  const raw = $('#imgPrompt').value.trim(); if (!raw) return B().toast('พิมพ์สิ่งที่อยากให้วาดก่อนนะ');
  const c = cfg();
  if (PROV[C.provider].needKey && !c.key) { openSettings(); return B().toast('ใส่ API Key ของผู้ให้บริการรูปก่อนนะ'); }
  running = true; abortCtl = new AbortController(); $('#imgGo').classList.add('busy'); $('#imgEmpty').hidden = true;
  const p = fullPrompt(raw);
  const jobs = Array.from({ length: count }, () => runOne(makeCard(p), p, raw));
  await Promise.allSettled(jobs);
  running = false; $('#imgGo').classList.remove('busy');
}
$('#imgGo').onclick = go;
$('#imgPrompt').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); go(); } });

/* ---------- ตัวดูรูป ---------- */
let viewing = null;
function openViewer(rec) {
  viewing = rec; $('#vImg').src = urlOf(rec);
  $('#vMeta').innerHTML = `<p>${esc(rec.prompt)}</p><small>${esc(PROV[rec.provider]?.label || rec.provider)} · ${esc(rec.model || '')} · ${esc(rec.ratio || '')} · ${new Date(rec.ts).toLocaleString('th-TH')}</small>`;
  $('#mImg').classList.add('open');
}
const closeViewer = () => $('#mImg').classList.remove('open');
$('#mImg').addEventListener('mousedown', e => { if (e.target.id === 'mImg') closeViewer(); });
$('#mImg .close').onclick = closeViewer;
$('#vDl').onclick = async () => {
  if (!viewing) return;
  const ext = (viewing.blob?.type || '').split('/')[1]?.replace('jpeg', 'jpg') || 'png';
  const a = document.createElement('a'); a.download = `fontaine-${viewing.ts}.${ext}`; a.href = urlOf(viewing); a.target = '_blank'; a.rel = 'noopener';
  document.body.append(a); a.click(); a.remove();
};
$('#vCopy').onclick = async () => { try { await navigator.clipboard.writeText(viewing.prompt); B().toast('คัดลอก prompt แล้ว'); } catch { B().toast('คัดลอกไม่ได้'); } };
$('#vReuse').onclick = () => { $('#imgPrompt').value = viewing.prompt; autoH(); closeViewer(); B().go('studio'); };
$('#vRef').onclick = async () => {
  if (!viewing) return;
  try {
    const blob = viewing.blob || await (await fetch(viewing.url)).blob();
    refs.push(await shrink(new File([blob], 'ref.png', { type: blob.type }))); refs = refs.slice(-3); renderRefs(); closeViewer(); B().go('studio'); B().toast('ใช้เป็นรูปอ้างอิงแล้ว');
  } catch { B().toast('ดึงรูปมาเป็นอ้างอิงไม่ได้'); }
};
$('#vDel').onclick = async () => {
  if (!viewing) return; await gDel(viewing.id);
  $$(`[data-id="${viewing.id}"]`).forEach(n => n.remove()); closeViewer(); refreshGalCount(); if (page === 'gallery') renderGallery();
};

/* ---------- คลังรูป ---------- */
let page = '';
async function renderGallery() {
  const list = await gAll(), g = $('#galGrid'); g.innerHTML = '';
  $('#galEmpty').hidden = !!list.length; $('#galClear').hidden = !list.length;
  $('#galCount').textContent = list.length ? list.length + ' รูป' : '';
  list.forEach(rec => {
    const d = document.createElement('button'); d.className = 'gcard'; d.dataset.id = rec.id;
    const im = document.createElement('img'); im.loading = 'lazy'; im.alt = rec.prompt; im.src = urlOf(rec); d.append(im);
    d.onclick = () => openViewer(rec); g.append(d);
  });
}
async function refreshGalCount() { const n = (await gAll()).length; $('#galCount').textContent = n ? n + ' รูป' : ''; }
$('#galClear').onclick = async () => { if (!confirm('ลบรูปทั้งหมดในคลัง (เฉพาะในเครื่องนี้)?')) return; await gClear(); renderGallery(); };

/* ---------- ตั้งค่าผู้ให้บริการรูป ---------- */
const isProv = $('#isProv');
Object.entries(PROV).forEach(([k, v]) => isProv.add(new Option(v.label, k)));
function fillSet() {
  const p = isProv.value, c = cfg(p);
  $('#isKey').value = C.key[p] || ''; $('#isKey').placeholder = PROV[p].needKey ? (chatKeyFor(p) ? 'ใช้ key เดียวกับแชต (เว้นว่างได้)' : 'API Key') : 'ไม่บังคับ';
  $('#isBase').value = C.base[p] || PROV[p].base; $('#isModel').value = C.model[p] || PROV[p].model;
  $('#isNote').textContent = PROV[p].note;
}
function openSettings() { isProv.value = C.provider; fillSet(); $('#mImgSet').classList.add('open'); }
isProv.onchange = fillSet;
$('#imgSet').onclick = openSettings;
$('#mImgSet').addEventListener('mousedown', e => { if (e.target.id === 'mImgSet') e.currentTarget.classList.remove('open'); });
$('#mImgSet .close').onclick = $('#isCancel').onclick = () => $('#mImgSet').classList.remove('open');
$('#isSave').onclick = () => {
  const p = isProv.value; C.provider = p;
  C.key[p] = $('#isKey').value.trim(); C.base[p] = $('#isBase').value.trim() || PROV[p].base; C.model[p] = $('#isModel').value.trim() || PROV[p].model;
  saveC(); $('#mImgSet').classList.remove('open'); syncProv(); renderRefs(); B().toast('บันทึกแล้ว ✓');
};
function syncProv() { $('#imgProv').textContent = PROV[C.provider].label; }

/* ---------- เรียกจากแถบนำทาง ---------- */
function onShow(p) { page = p; if (p === 'gallery') renderGallery(); if (p === 'studio') { autoH(); } }

buildOptions(); syncProv(); renderRefs(); refreshGalCount();
return { onShow, _GEN: GEN, _cfg: C };
})();
