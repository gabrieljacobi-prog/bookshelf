import { toIsbn13, lookupAll } from './lookup.js';

const $ = (id) => document.getElementById(id);
const video = $('video');
const STORE = 'bookshelf.scanTest.v1';

let stream = null;
let zxingControls = null;
let nativeLoop = null;
let torchOn = false;
let queue = load();

// --- Persistence ---------------------------------------------------------------

function load() {
  try { return JSON.parse(localStorage.getItem(STORE)) || []; } catch { return []; }
}
function save() {
  try { localStorage.setItem(STORE, JSON.stringify(queue)); } catch { /* private mode */ }
}

// --- Feedback ------------------------------------------------------------------

let audioCtx;
function beep(ok = true) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.frequency.value = ok ? 1320 : 330;
    g.gain.setValueAtTime(0.12, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.15);
    o.connect(g).connect(audioCtx.destination);
    o.start(); o.stop(audioCtx.currentTime + 0.16);
  } catch { /* no audio */ }
  if (navigator.vibrate) navigator.vibrate(ok ? 60 : [40, 60, 40]);
}

let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), 1800);
}

function status(msg) { $('status').textContent = msg; }

// --- Detection: accept a code only after two identical reads -------------------

let lastRead = { code: null, at: 0 };
const recent = new Map(); // isbn -> timestamp, prevents re-adding while it's still in view

function onRawCode(text) {
  const isbn = toIsbn13(text);
  if (!isbn) return; // not a book barcode (e.g. the 5-digit price add-on)
  const now = Date.now();
  if (lastRead.code !== isbn || now - lastRead.at > 1500) {
    lastRead = { code: isbn, at: now };
    return;
  }
  lastRead = { code: null, at: 0 };
  if (recent.has(isbn) && now - recent.get(isbn) < 4000) return;
  recent.set(isbn, now);
  flash();
  addIsbn(isbn, 'camera');
}

function flash() {
  const g = $('guide');
  g.classList.add('hit');
  setTimeout(() => g.classList.remove('hit'), 350);
}

// --- Camera --------------------------------------------------------------------

async function startCamera(deviceId) {
  await stopCamera();
  const constraints = {
    audio: false,
    video: deviceId
      ? { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } }
      : { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
  };
  try {
    stream = await navigator.mediaDevices.getUserMedia(constraints);
  } catch (e) {
    status('');
    toast(e.name === 'NotAllowedError' ? 'Camera permission was denied' : 'Could not open the camera: ' + e.message);
    return;
  }
  video.srcObject = stream;
  await video.play();
  $('idle').hidden = true;
  $('guide').hidden = false;
  $('stop').disabled = false;

  const track = stream.getVideoTracks()[0];
  const caps = track.getCapabilities ? track.getCapabilities() : {};
  $('torch').hidden = !caps.torch;
  // Ask for continuous autofocus where the browser supports it.
  if (caps.focusMode?.includes('continuous')) track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {});

  await listCameras(track.getSettings().deviceId);
  startDetection();
}

async function stopCamera() {
  if (nativeLoop) { cancelAnimationFrame(nativeLoop); nativeLoop = null; }
  if (zxingControls) { try { zxingControls.stop(); } catch {} zxingControls = null; }
  if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
  video.srcObject = null;
  torchOn = false;
  $('guide').hidden = true;
  $('idle').hidden = false;
  $('stop').disabled = true;
  $('torch').hidden = true;
  status('');
}

async function listCameras(currentId) {
  const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
  const sel = $('cams');
  if (devices.length < 2) { sel.hidden = true; return; }
  sel.innerHTML = devices.map((d, i) => `<option value="${d.deviceId}">${d.label || 'Camera ' + (i + 1)}</option>`).join('');
  sel.value = currentId || '';
  sel.hidden = false;
}

async function startDetection() {
  // Chrome on Android has a native detector; Firefox does not, so ZXing does the work there.
  let native = false;
  if ('BarcodeDetector' in window) {
    try { native = (await BarcodeDetector.getSupportedFormats()).includes('ean_13'); } catch {}
  }
  if (native) {
    const det = new BarcodeDetector({ formats: ['ean_13'] });
    status('Scanning (built-in detector)…');
    let busy = false;
    const tick = async () => {
      if (!stream) return;
      if (!busy && video.readyState >= 2) {
        busy = true;
        try { (await det.detect(video)).forEach((c) => onRawCode(c.rawValue)); } catch {}
        busy = false;
      }
      nativeLoop = requestAnimationFrame(tick);
    };
    tick();
  } else {
    const Z = window.ZXingBrowser;
    const hints = new Map([[2 /* POSSIBLE_FORMATS */, [Z.BarcodeFormat.EAN_13]], [3 /* TRY_HARDER */, true]]);
    const reader = new Z.BrowserMultiFormatOneDReader(hints, { delayBetweenScanAttempts: 120, delayBetweenScanSuccess: 300 });
    status('Scanning (ZXing)…');
    zxingControls = await reader.decodeFromVideoElement(video, (result) => {
      if (result) onRawCode(result.getText());
    });
  }
}

// --- Queue ---------------------------------------------------------------------

async function addIsbn(isbn, via) {
  const existing = queue.find((q) => q.isbn === isbn);
  if (existing) { beep(false); toast('Already scanned: ' + (existing.merged?.title || isbn)); return; }
  beep(true);
  const item = { isbn, via, at: new Date().toISOString(), pending: true };
  queue.unshift(item);
  render();
  const res = await lookupAll(isbn);
  Object.assign(item, res, { pending: false, coverIdx: 0 });
  save();
  render();
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function sourceTag(key, label, r) {
  if (!r) return `<span class="tag miss">${label}: not found</span>`;
  if (r.error) return `<span class="tag err" title="${esc(r.error)}">${label}: error</span>`;
  return `<span class="tag ok">${label} ✓</span>`;
}

function render() {
  $('count').textContent = queue.length ? `(${queue.length})` : '';
  $('empty').hidden = queue.length > 0;
  $('queue').innerHTML = queue.map((q, i) => {
    if (q.pending) {
      return `<div class="item card"><div class="cover none">…</div><div><h3>${q.isbn}</h3><div class="meta">Looking up…</div></div></div>`;
    }
    const m = q.merged;
    const covers = m?.covers || [];
    const cover = covers[q.coverIdx || 0];
    const r = q.results || {};
    const rows = ['google', 'openlibrary', 'libris'].map((k) => {
      const x = r[k];
      const label = { google: 'Google', openlibrary: 'Open Library', libris: 'LIBRIS' }[k];
      if (!x || x.error) return `<tr><th>${label}</th><td class="muted">${x?.error ? 'error: ' + esc(x.error) : 'not found'}</td></tr>`;
      return `<tr><th>${label}</th><td>${esc(x.title)}${x.subtitle ? ': ' + esc(x.subtitle) : ''}<br><span class="muted">${esc(x.authors.join(', '))} · ${esc(x.publisher || '—')} · ${esc(x.year || '—')} · ${esc(x.language || '—')}</span></td></tr>`;
    }).join('');
    return `
      <div class="item card" data-i="${i}">
        ${cover ? `<img class="cover" src="${esc(cover.url)}" alt="" onerror="this.dataset.broken=1;this.replaceWith(Object.assign(document.createElement('div'),{className:'cover none',textContent:'cover failed'}))">` : `<div class="cover none">no cover</div>`}
        <div>
          <h3>${m ? esc(m.title) : 'Not found'}</h3>
          <div class="meta">${m ? esc((m.authors || []).join(', ') || 'Unknown author') + ' · ' + esc(m.publisher || '—') + ' · ' + esc(m.year || '—') + ' · ' + esc(m.language || '?') : 'No source knows this ISBN'} · ${q.isbn}</div>
          <div class="sources">${sourceTag('google', 'Google', r.google)}${sourceTag('openlibrary', 'Open Library', r.openlibrary)}${sourceTag('libris', 'LIBRIS', r.libris)}</div>
          ${covers.length > 1 ? `<div class="alts">${covers.map((c, j) => `<img src="${esc(c.url)}" title="${esc(c.source)}" class="${j === (q.coverIdx || 0) ? 'sel' : ''}" data-cover="${j}" onerror="this.remove()">`).join('')}</div>` : ''}
          <div class="row" style="justify-content:space-between">
            <details><summary>Compare sources</summary><table>${rows}</table></details>
            <button class="x" data-remove="${i}">Remove</button>
          </div>
        </div>
      </div>`;
  }).join('');
}

$('queue').addEventListener('click', (e) => {
  const card = e.target.closest('[data-i]');
  if (!card) return;
  const q = queue[Number(card.dataset.i)];
  if (e.target.dataset.cover !== undefined) { q.coverIdx = Number(e.target.dataset.cover); save(); render(); }
  if (e.target.dataset.remove !== undefined) { queue.splice(Number(e.target.dataset.remove), 1); save(); render(); }
});

// --- Report: a compact text summary to paste back into the chat -------------------

function report() {
  const lines = queue.filter((q) => !q.pending).map((q) => {
    const r = q.results || {};
    const s = (x) => (!x ? '–' : x.error ? 'E' : '✓');
    const coverOk = (q.merged?.covers || []).length ? 'cover' : 'NO COVER';
    return `${q.isbn} | G${s(r.google)} OL${s(r.openlibrary)} L${s(r.libris)} | ${coverOk} | ${q.merged?.title || 'NOT FOUND'}`;
  });
  return `Scanner test — ${navigator.userAgent}\n${lines.length} books\n` + lines.join('\n');
}

$('report').onclick = async () => {
  const text = report();
  try { await navigator.clipboard.writeText(text); toast('Report copied'); }
  catch { prompt('Copy this report:', text); }
};
$('clear').onclick = () => { if (confirm('Clear all scanned books?')) { queue = []; save(); render(); } };

// --- Wiring --------------------------------------------------------------------

$('start').onclick = () => startCamera();
$('stop').onclick = () => stopCamera();
$('cams').onchange = (e) => startCamera(e.target.value);
$('torch').onclick = async () => {
  const track = stream?.getVideoTracks()[0];
  if (!track) return;
  torchOn = !torchOn;
  try { await track.applyConstraints({ advanced: [{ torch: torchOn }] }); } catch { toast('Light not available'); }
};
$('manual').onsubmit = (e) => {
  e.preventDefault();
  const isbn = toIsbn13($('isbnIn').value);
  if (!isbn) { toast('That doesn’t look like a valid ISBN'); return; }
  $('isbnIn').value = '';
  addIsbn(isbn, 'typed');
};
document.addEventListener('visibilitychange', () => { if (document.hidden) stopCamera(); });

if (!navigator.mediaDevices?.getUserMedia) {
  $('start').disabled = true;
  status('This browser can’t open the camera here (it needs HTTPS).');
}
render();
