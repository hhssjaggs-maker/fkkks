/* ==========================================================
   runner.js — ระบบทดสอบโค้ดอัตโนมัติ (รันใน sandbox ของเบราว์เซอร์)
   รองรับ: HTML/CSS/JS, JavaScript (Worker), Python (Pyodide), JSON
   ========================================================== */
window.Runner = (() => {
const RUN_TIMEOUT = 8000;      // ms — JS/HTML
const SETTLE = 1200;           // ms — รอ timer/async หลังโหลดเสร็จ
const PY_LOAD_TIMEOUT = 90000; // ms — โหลด Pyodide ครั้งแรก
const PY_RUN_TIMEOUT = 15000;  // ms — รัน Python
const MAX_LINES = 200;
const PYODIDE = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/';
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

const LANG = { js: 'js', javascript: 'js', mjs: 'js', node: 'js', jsx: 'jsx', html: 'html', htm: 'html', css: 'css',
  py: 'py', python: 'py', python3: 'py', json: 'json', ts: 'ts', typescript: 'ts', tsx: 'ts', sql: 'sql', sh: 'sh', bash: 'sh' };
const DEFNAME = { html: 'index.html', css: 'style.css', js: 'script.js', py: 'main.py', json: 'data.json', ts: 'main.ts', jsx: 'App.jsx', sql: 'query.sql', sh: 'run.sh' };
const NODE_ONLY = /\brequire\s*\(|\bprocess\.(argv|env|exit|stdin|stdout|cwd)|from\s+['"](?:node:)?(?:fs|path|http|https|os|child_process|crypto|url|stream|net|readline)['"]|import\s+[^;\n]*['"]node:/;
const DOMISH = /\bdocument\.|\bwindow\.|\blocalStorage\b|\bsessionStorage\b|\bnavigator\.|\balert\s*\(|getElementById|querySelector|addEventListener\(\s*['"](?:DOMContentLoaded|click|load)/;

/* ---------- แยก code block ---------- */
function extract(text) {
  const out = [], re = /```([^\n`]*)\n([\s\S]*?)```/g; let m;
  while ((m = re.exec(text))) {
    const info = m[1].trim(), parts = info.split(/\s+/), tok = (parts[0] || '').toLowerCase();
    const lang = LANG[tok] || tok || 'text';
    let name = null;
    const nm = info.match(/(?:file(?:name)?|title)\s*[=:]\s*["']?([\w./-]+)["']?/i)
      || parts.slice(1).map(t => t.match(/^["']?([\w./-]+\.\w+)["']?$/)).find(Boolean);
    if (nm) name = nm[1];
    if (!name) { const fm = m[2].split('\n', 1)[0].match(/file(?:name)?\s*:\s*([\w./-]+)/i); if (fm) name = fm[1]; }
    out.push({ lang, code: m[2].replace(/\n$/, ''), name, idx: out.length });
  }
  return out;
}
function fileNames(blocks) {
  const used = new Set();
  return blocks.map(b => {
    let n = b.name || DEFNAME[b.lang] || `file${b.idx + 1}.${b.lang === 'text' ? 'txt' : b.lang}`;
    if (used.has(n)) { const i = n.lastIndexOf('.'); let k = 2, c; do { c = i > 0 ? `${n.slice(0, i)}-${k}${n.slice(i)}` : `${n}-${k}`; k++; } while (used.has(c)); n = c; }
    used.add(n); return n;
  });
}

/* ---------- รวม HTML + CSS + JS ---------- */
const ensureDoc = h => /<html[\s>]|<!doctype/i.test(h) ? h
  : `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>${h}</body></html>`;
function inject(html, snippet, marker) {
  if (!snippet) return html;
  const i = html.toLowerCase().lastIndexOf(marker);
  return i >= 0 ? html.slice(0, i) + snippet + '\n' + html.slice(i) : html + '\n' + snippet;
}
const isModule = c => /^\s*(import|export)\s/m.test(c);
const safeScript = c => c.replace(/<\/script/gi, '<\\/script');
function bundleHTML(html, css, js) {
  let h = ensureDoc(html);
  if (css.length || js.length) {
    h = h.replace(/<link[^>]+href=["'](?!https?:|\/\/|data:)[^"']+\.css["'][^>]*>/gi, '')
         .replace(/<script[^>]+src=["'](?!https?:|\/\/|data:)[^"']+\.m?js["'][^>]*>\s*<\/script>/gi, '');
    h = inject(h, css.map(b => `<style>\n${b.code}\n</style>`).join('\n'), '</head>');
    h = inject(h, js.map(b => `<script${isModule(b.code) ? ' type="module"' : ''}>\n${safeScript(b.code)}\n</script>`).join('\n'), '</body>');
  }
  return h;
}
const jsDoc = code => `<!doctype html><html><head><meta charset="utf-8"></head><body><script${isModule(code) ? ' type="module"' : ''}>\n${safeScript(code)}\n</script></body></html>`;

/* ---------- วางแผนการทดสอบ ---------- */
function plan(blocks) {
  const tasks = [], used = new Set();
  const htmls = blocks.filter(b => b.lang === 'html' && /<\s*(!doctype|html|body|div|script|canvas|main|section|h1|p|button|form)/i.test(b.code));
  if (htmls.length === 1) {
    const h = htmls[0], css = blocks.filter(b => b.lang === 'css'), js = blocks.filter(b => b.lang === 'js' && !NODE_ONLY.test(b.code));
    [h, ...css, ...js].forEach(b => used.add(b));
    tasks.push({ kind: 'html', title: 'เว็บ (HTML' + (css.length ? '+CSS' : '') + (js.length ? '+JS' : '') + ')', doc: bundleHTML(h.code, css, js), blocks: [h, ...css, ...js] });
  } else htmls.forEach((h, i) => { used.add(h); tasks.push({ kind: 'html', title: `HTML #${i + 1}`, doc: ensureDoc(h.code), blocks: [h] }); });

  blocks.forEach(b => {
    if (used.has(b)) return;
    const n = b.idx + 1;
    if (b.lang === 'js') {
      if (NODE_ONLY.test(b.code)) tasks.push({ kind: 'js-syntax', title: `JavaScript (Node) #${n}`, code: b.code, blocks: [b] });
      else if (DOMISH.test(b.code)) tasks.push({ kind: 'html', title: `JavaScript (DOM) #${n}`, doc: jsDoc(b.code), blocks: [b] });
      else tasks.push({ kind: 'js', title: `JavaScript #${n}`, code: b.code, blocks: [b] });
    } else if (b.lang === 'py') tasks.push({ kind: 'py', title: `Python #${n}`, code: b.code, blocks: [b] });
    else if (b.lang === 'json') tasks.push({ kind: 'json', title: `JSON #${n}`, code: b.code, blocks: [b] });
  });
  return tasks;
}
function taskForBlock(block, all) {
  return plan(all).find(t => t.blocks.includes(block)) || null;
}

/* ---------- sandbox: iframe (HTML) ---------- */
const BOOT = `<script>(function(){var ID="__ID__";function P(t,m){try{parent.postMessage({__run:ID,t:t,m:m},"*")}catch(e){}}
function F(a){return Array.prototype.map.call(a,function(x){try{if(typeof x==="string")return x;if(x instanceof Error)return x.stack||x.message;if(typeof x==="undefined")return "undefined";return JSON.stringify(x)}catch(e){return String(x)}}).join(" ")}
["log","info","warn","error","debug"].forEach(function(k){var o=console[k];console[k]=function(){P(k,F(arguments));try{o.apply(console,arguments)}catch(e){}}});
addEventListener("error",function(e){if(e.target&&e.target!==window){P("resource",(e.target.src||e.target.href||e.target.tagName)+"");return}P("exception",(e.message||"error")+(e.lineno?" (บรรทัด "+e.lineno+")":""))},true);
addEventListener("unhandledrejection",function(e){P("exception","Unhandled promise rejection: "+F([e.reason]))});
window.alert=function(m){P("log","[alert] "+m)};window.confirm=function(){return true};window.prompt=function(){return ""};
addEventListener("load",function(){var n=0;try{n=document.body?document.body.querySelectorAll("*:not(script):not(style)").length:0}catch(e){}P("dom",String(n));P("load","")});
})()<\/script>`;

function withBootstrap(doc, id) {
  const boot = BOOT.replace('__ID__', () => id);
  let m = doc.match(/<head[^>]*>/i);
  if (m) return doc.replace(m[0], () => m[0] + boot);
  m = doc.match(/<html[^>]*>/i);
  if (m) return doc.replace(m[0], () => m[0] + '<head>' + boot + '</head>');
  m = doc.match(/<!doctype[^>]*>/i);
  if (m) return doc.replace(m[0], () => m[0] + boot);
  return boot + doc;
}
const rid = () => 'r' + Math.random().toString(36).slice(2);
const push = (arr, v) => { if (arr.length < MAX_LINES) arr.push(String(v).slice(0, 2000)); };

function sandboxRun(doc, { settle = SETTLE, timeout = RUN_TIMEOUT } = {}) {
  return new Promise(resolve => {
    const id = rid(), f = document.createElement('iframe');
    f.setAttribute('sandbox', 'allow-scripts');
    f.style.cssText = 'position:fixed;left:-99999px;top:0;width:1024px;height:768px;border:0;visibility:hidden';
    const res = { logs: [], errors: [], warns: [], resources: [], dom: -1, loaded: false, timedOut: false };
    let done = false, t1, t2;
    const finish = why => {
      if (done) return; done = true; clearTimeout(t1); clearTimeout(t2);
      removeEventListener('message', on); res.timedOut = why === 'timeout';
      setTimeout(() => f.remove(), 30); resolve(res);
    };
    function on(e) {
      if (e.source !== f.contentWindow) return;
      const d = e.data; if (!d || d.__run !== id) return;
      switch (d.t) {
        case 'log': case 'info': case 'debug': push(res.logs, d.m); break;
        case 'warn': push(res.warns, d.m); break;
        case 'error': push(res.errors, 'console.error: ' + d.m); break;
        case 'exception': push(res.errors, d.m); break;
        case 'resource': push(res.resources, d.m); break;
        case 'dom': res.dom = +d.m; break;
        case 'load': res.loaded = true; t2 = setTimeout(() => finish('settled'), settle); break;
      }
    }
    addEventListener('message', on);
    t1 = setTimeout(() => finish('timeout'), timeout);
    f.srcdoc = withBootstrap(doc, id);
    document.body.appendChild(f);
  });
}

/* ---------- sandbox: Worker (JS ล้วน — ฆ่าได้ถ้า loop ไม่จบ) ---------- */
const WORKER_BOOT = `(function(){function F(a){return Array.prototype.map.call(a,function(x){try{if(typeof x==="string")return x;if(x instanceof Error)return x.stack||x.message;if(typeof x==="undefined")return "undefined";return JSON.stringify(x)}catch(e){return String(x)}}).join(" ")}["log","info","warn","error","debug"].forEach(function(k){var o=console[k];console[k]=function(){postMessage({t:k,m:F(arguments)});try{o.apply(console,arguments)}catch(e){}}});self.addEventListener("error",function(e){postMessage({t:"exception",m:(e.message||"error")+(e.lineno?" (บรรทัด "+Math.max(1,e.lineno-1)+")":"")});e.preventDefault()});self.addEventListener("unhandledrejection",function(e){postMessage({t:"exception",m:"Unhandled promise rejection: "+F([e.reason])});e.preventDefault()});})();`;

function workerRun(code, { settle = 700, timeout = RUN_TIMEOUT } = {}) {
  return new Promise(resolve => {
    const res = { logs: [], errors: [], warns: [], timedOut: false };
    const seen = new Set(); const err = m => { if (!seen.has(m)) { seen.add(m); push(res.errors, m); } };
    const src = WORKER_BOOT + '\n' + code + '\n;postMessage({t:"end"});';
    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    let w, done = false, t1, t2;
    const finish = why => {
      if (done) return; done = true; clearTimeout(t1); clearTimeout(t2);
      res.timedOut = why === 'timeout'; try { w.terminate(); } catch {} URL.revokeObjectURL(url); resolve(res);
    };
    try { w = new Worker(url, isModule(code) ? { type: 'module' } : undefined); }
    catch (e) { err(String(e.message || e)); URL.revokeObjectURL(url); return resolve(res); }
    w.onmessage = e => {
      const d = e.data || {};
      switch (d.t) {
        case 'log': case 'info': case 'debug': push(res.logs, d.m); break;
        case 'warn': push(res.warns, d.m); break;
        case 'error': err('console.error: ' + d.m); break;
        case 'exception': err(d.m); clearTimeout(t2); t2 = setTimeout(() => finish('error'), 150); break;
        case 'end': clearTimeout(t2); t2 = setTimeout(() => finish('settled'), settle); break;
      }
    };
    w.onerror = e => { err(e.message || 'Worker error'); e.preventDefault?.(); clearTimeout(t2); t2 = setTimeout(() => finish('error'), 150); };
    t1 = setTimeout(() => finish('timeout'), timeout);
  });
}

/* ---------- Python (Pyodide ใน Worker) ---------- */
const PY_WORKER = `
importScripts('${PYODIDE}pyodide.js');
let py = null;
onmessage = async (e) => {
  const code = e.data.code;
  try {
    if (!py) { postMessage({t:'status', m:'กำลังโหลด Python (ครั้งแรกอาจใช้เวลาสักครู่)…'}); py = await loadPyodide({indexURL:'${PYODIDE}'}); }
    postMessage({t:'ready'});
    py.setStdout({ batched: s => postMessage({t:'out', m:s}) });
    py.setStderr({ batched: s => postMessage({t:'warn', m:s}) });
    try { await py.loadPackagesFromImports(code); } catch (pe) { postMessage({t:'warn', m:'โหลดแพ็กเกจไม่สำเร็จ: ' + pe.message}); }
    const g = py.globals.get('dict')();
    try { await py.runPythonAsync(code, { globals: g }); } finally { g.destroy(); }
  } catch (err) { postMessage({t:'exception', m: String(err && err.message || err)}); }
  postMessage({t:'done'});
};`;
let pyWorker = null;
function getPy() {
  if (!pyWorker) pyWorker = new Worker(URL.createObjectURL(new Blob([PY_WORKER], { type: 'text/javascript' })));
  return pyWorker;
}
function pyRun(code, onStatus) {
  return new Promise(resolve => {
    const res = { logs: [], errors: [], warns: [], timedOut: false };
    let w, done = false, tLoad, tRun;
    const finish = (killed) => {
      if (done) return; done = true; clearTimeout(tLoad); clearTimeout(tRun);
      if (w) { w.onmessage = null; w.onerror = null; }
      if (killed && w) { try { w.terminate(); } catch {} pyWorker = null; }
      resolve(res);
    };
    try { w = getPy(); } catch (e) { push(res.errors, 'สร้าง Worker ไม่สำเร็จ: ' + (e.message || e)); return finish(false); }
    tLoad = setTimeout(() => { push(res.errors, 'โหลด Python ไม่สำเร็จ (หมดเวลา / ออฟไลน์?)'); res.timedOut = true; finish(true); }, PY_LOAD_TIMEOUT);
    w.onmessage = e => {
      const d = e.data || {};
      if (d.t === 'status') onStatus && onStatus(d.m);
      else if (d.t === 'ready') { clearTimeout(tLoad); tRun = setTimeout(() => { push(res.errors, `โค้ดรันนานเกิน ${PY_RUN_TIMEOUT / 1000} วินาที (อาจมี infinite loop)`); res.timedOut = true; finish(true); }, PY_RUN_TIMEOUT); }
      else if (d.t === 'out') push(res.logs, d.m);
      else if (d.t === 'warn') push(res.warns, d.m);
      else if (d.t === 'exception') push(res.errors, d.m);
      else if (d.t === 'done') finish(false);
    };
    w.onerror = e => { push(res.errors, 'Python worker error: ' + (e.message || 'โหลด Pyodide ไม่ได้ (เช็กอินเทอร์เน็ต)')); finish(true); };
    w.postMessage({ code });
  });
}

/* ---------- รันทีละ task ---------- */
async function runTask(t, onStatus) {
  const t0 = performance.now();
  const r = { kind: t.kind, title: t.title, status: 'pass', logs: [], errors: [], warns: [], note: '', ms: 0 };
  try {
    if (t.kind === 'html') {
      const x = await sandboxRun(t.doc);
      r.logs = x.logs; r.errors = x.errors; r.warns = x.warns.concat(x.resources.map(u => 'โหลดไฟล์ไม่สำเร็จ: ' + u));
      if (!x.loaded) r.errors.push(`หน้าเว็บไม่โหลดเสร็จใน ${RUN_TIMEOUT / 1000} วินาที (อาจมี loop ไม่จบ)`);
      else if (x.dom === 0) r.warns.push('body ไม่มี element แสดงผลเลย (หน้าว่าง?)');
      r.note = x.dom >= 0 ? `DOM ${x.dom} elements` : '';
    } else if (t.kind === 'js') {
      const x = await workerRun(t.code);
      r.logs = x.logs; r.errors = x.errors; r.warns = x.warns;
      if (x.timedOut) r.errors.push(`โค้ดรันนานเกิน ${RUN_TIMEOUT / 1000} วินาที (อาจมี infinite loop)`);
    } else if (t.kind === 'py') {
      const x = await pyRun(t.code, onStatus);
      r.logs = x.logs; r.errors = x.errors; r.warns = x.warns;
    } else if (t.kind === 'json') {
      JSON.parse(t.code); r.note = 'JSON ถูกต้อง';
    } else if (t.kind === 'js-syntax') {
      r.status = 'skip'; r.note = 'โค้ด Node.js — ตรวจ syntax อย่างเดียว (ไม่รันในเบราว์เซอร์)';
      if (!isModule(t.code)) { try { new AsyncFunction(t.code); r.status = 'pass'; r.note += ' ✓ syntax ถูกต้อง'; } catch (e) { r.errors.push('SyntaxError: ' + e.message); } }
    }
  } catch (e) { r.errors.push(String(e.message || e)); }
  if (r.errors.length) r.status = 'fail';
  r.ms = Math.round(performance.now() - t0);
  return r;
}

async function runAll(text, onStatus) {
  const blocks = extract(text), tasks = plan(blocks), results = [];
  for (let i = 0; i < tasks.length; i++) {
    onStatus && onStatus(`🧪 กำลังทดสอบ ${i + 1}/${tasks.length}: ${tasks[i].title}`);
    results.push(await runTask(tasks[i], m => onStatus && onStatus('🧪 ' + m)));
  }
  const failed = results.filter(r => r.status === 'fail').length;
  return {
    tasks: results, total: results.length, failed,
    passed: results.filter(r => r.status === 'pass').length,
    skipped: results.filter(r => r.status === 'skip').length,
    ok: failed === 0
  };
}
function feedback(rep) {
  const L = ['ระบบทดสอบอัตโนมัติรันโค้ดของคุณใน sandbox แล้ว พบปัญหา:'];
  rep.tasks.filter(t => t.status === 'fail').forEach(t => {
    L.push(`\n❌ [${t.title}]`);
    t.errors.slice(0, 6).forEach(e => L.push('  - ' + e.slice(0, 700)));
    if (t.logs.length) L.push('  เอาต์พุตก่อนพัง: ' + t.logs.slice(0, 8).join(' | ').slice(0, 500));
  });
  L.push('\nช่วยแก้ให้ผ่าน แล้วส่งโค้ดฉบับเต็มที่แก้แล้ว (ไม่ใช่เฉพาะส่วนที่เปลี่ยน) อธิบายสาเหตุสั้นๆ 1–2 บรรทัด');
  return L.join('\n');
}

/* ---------- รันสด (ปุ่ม ▶ ในแชต) ---------- */
function live(task, { frame, con, onStatus }) {
  con.textContent = '';
  const add = (cls, m) => { const d = document.createElement('div'); d.className = cls; d.textContent = m; con.appendChild(d); con.scrollTop = con.scrollHeight; };
  frame.hidden = true; frame.srcdoc = '';
  let stop = () => {};
  if (task.kind === 'html') {
    const id = rid(); frame.hidden = false;
    const on = e => {
      if (e.source !== frame.contentWindow) return; const d = e.data; if (!d || d.__run !== id) return;
      if (d.t === 'log' || d.t === 'info' || d.t === 'debug') add('l', d.m);
      else if (d.t === 'warn') add('w', '⚠ ' + d.m);
      else if (d.t === 'error') add('e', '✖ ' + d.m);
      else if (d.t === 'exception') add('e', '✖ ' + d.m);
      else if (d.t === 'resource') add('w', '⚠ โหลดไม่สำเร็จ: ' + d.m);
    };
    addEventListener('message', on);
    frame.setAttribute('sandbox', 'allow-scripts allow-forms');
    frame.srcdoc = withBootstrap(task.doc, id);
    stop = () => { removeEventListener('message', on); frame.srcdoc = ''; };
  } else {
    add('w', 'กำลังรัน…');
    const p = task.kind === 'py' ? pyRun(task.code, onStatus) : workerRun(task.code);
    p.then(x => {
      con.textContent = '';
      x.logs.forEach(m => add('l', m)); x.warns.forEach(m => add('w', '⚠ ' + m)); x.errors.forEach(m => add('e', '✖ ' + m));
      if (!x.logs.length && !x.errors.length && !x.warns.length) add('w', '(ไม่มีเอาต์พุต)');
    });
  }
  return () => stop();
}

/* ---------- ดาวน์โหลด / ZIP ---------- */
const CT = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = b => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CT[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
function zip(files) {
  const enc = new TextEncoder(), local = [], central = []; let off = 0;
  const u16 = n => [n & 255, (n >> 8) & 255], u32 = n => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
  files.forEach(f => {
    const nb = enc.encode(f.name), data = enc.encode(f.data), crc = crc32(data);
    const head = [...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nb.length), ...u16(0)];
    local.push(new Uint8Array([0x50, 0x4b, 3, 4, ...head]), nb, data);
    central.push(new Uint8Array([0x50, 0x4b, 1, 2, ...u16(20), ...head.slice(0, 26), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(off)]), nb);
    off += 30 + nb.length + data.length;
  });
  const cdSize = central.reduce((s, p) => s + p.length, 0);
  const end = new Uint8Array([0x50, 0x4b, 5, 6, ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(cdSize), ...u32(off), ...u16(0)]);
  return new Blob([...local, ...central, end], { type: 'application/zip' });
}
function download(name, data) {
  const blob = data instanceof Blob ? data : new Blob([data], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

return { extract, fileNames, plan, taskForBlock, runTask, runAll, feedback, live, zip, download, _internal: { withBootstrap, bundleHTML, workerRun, crc32 } };
})();
