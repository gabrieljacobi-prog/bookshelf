// Barcode scanning for the Add book page: the camera loop from the scanner test,
// as a module. Firefox on Android has no BarcodeDetector, so ZXing decodes there
// (loaded only when the camera is first opened; it's 440 KB).
import { toIsbn13 } from './lookup.js?v=11';

let zxingP = null;
function loadZxing() {
  if (window.ZXingBrowser) return Promise.resolve(window.ZXingBrowser);
  zxingP ||= new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'vendor/zxing-browser.min.js';
    s.onload = () => (window.ZXingBrowser ? res(window.ZXingBrowser) : rej(new Error('scanner library missing')));
    s.onerror = () => { zxingP = null; rej(new Error('couldn\'t load the scanner')); };
    document.head.appendChild(s);
  });
  return zxingP;
}

function makeReader(Z) {
  const hints = new Map([[2 /* POSSIBLE_FORMATS */, [Z.BarcodeFormat.EAN_13, Z.BarcodeFormat.UPC_A]], [3 /* TRY_HARDER */, true]]);
  return new Z.BrowserMultiFormatOneDReader(hints);
}

export function beep(ok = true) {
  try {
    beep.ctx ||= new (window.AudioContext || window.webkitAudioContext)();
    const a = beep.ctx, o = a.createOscillator(), g = a.createGain();
    o.frequency.value = ok ? 1320 : 330;
    g.gain.setValueAtTime(0.12, a.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + 0.15);
    o.connect(g).connect(a.destination);
    o.start(); o.stop(a.currentTime + 0.16);
  } catch { /* no audio */ }
  navigator.vibrate?.(ok ? 60 : [40, 60, 40]);
}

// Opens the back camera in `video` and calls onIsbn(isbn) once a code has been
// read twice in a row. onNonIsbn() for a price barcode. Returns stop().
export async function startScanner(video, { onIsbn, onNonIsbn, onError }) {
  let stream, timer = null, raf = null, stopped = false;
  const stop = () => {
    stopped = true;
    clearTimeout(timer); cancelAnimationFrame(raf);
    stream?.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
  };
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    });
  } catch (e) {
    onError?.(e.name === 'NotAllowedError' ? 'The camera wasn\'t allowed. Allow it for this site in the browser, or take a photo of the barcode instead.' : 'Couldn\'t open the camera: ' + e.message);
    return stop;
  }
  if (stopped) { stop(); return stop; }
  video.srcObject = stream;
  try { await video.play(); } catch { /* autoplay quirks; frames still arrive */ }
  const track = stream.getVideoTracks()[0];
  const caps = track.getCapabilities?.() || {};
  if (caps.focusMode?.includes('continuous')) track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {});

  let last = { code: null, at: 0 }, lastNon = 0, done = false;
  const onRaw = (text) => {
    if (done) return;
    const isbn = toIsbn13(text);
    if (!isbn) {
      if (String(text).replace(/\D/g, '').length >= 12 && Date.now() - lastNon > 4000) { lastNon = Date.now(); onNonIsbn?.(); }
      return;
    }
    const now = Date.now();
    if (last.code !== isbn || now - last.at > 1500) { last = { code: isbn, at: now }; return; }
    done = true;
    stop();
    onIsbn(isbn);
  };

  let native = false;
  if ('BarcodeDetector' in window) {
    try { native = (await BarcodeDetector.getSupportedFormats()).includes('ean_13'); } catch { /* no */ }
  }
  if (native) {
    const det = new BarcodeDetector({ formats: ['ean_13', 'upc_a'] });
    let busy = false;
    const tick = async () => {
      if (stopped) return;
      if (!busy && video.readyState >= 2) {
        busy = true;
        try { (await det.detect(video)).forEach((c) => onRaw(c.rawValue)); } catch { /* frame not ready */ }
        busy = false;
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return stop;
  }
  let Z;
  try { Z = await loadZxing(); } catch (e) { stop(); onError?.(e.message); return stop; }
  const reader = makeReader(Z);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  let frames = 0;
  // Each frame is cropped to the guide band and scaled down; every 4th frame
  // looks at the whole picture in case the barcode is off-centre.
  const tick = () => {
    if (stopped) return;
    const vw = video.videoWidth, vh = video.videoHeight;
    if (vw && vh) {
      const full = ++frames % 4 === 0;
      const sw = full ? vw : vw * 0.8, sh = full ? vh : vh * 0.45;
      const scale = Math.min(1, 1000 / sw);
      canvas.width = Math.round(sw * scale);
      canvas.height = Math.round(sh * scale);
      ctx.drawImage(video, (vw - sw) / 2, (vh - sh) / 2, sw, sh, 0, 0, canvas.width, canvas.height);
      try { onRaw(reader.decodeFromCanvas(canvas).getText()); } catch { /* nothing in this frame */ }
    }
    timer = setTimeout(() => { raf = requestAnimationFrame(tick); }, 80);
  };
  tick();
  return stop;
}

// A still taken with the phone's own camera: tries the whole photo, then bands,
// each also turned 90°. Returns an ISBN-13, 'price' for a non-ISBN code, or null.
export async function isbnFromPhoto(file) {
  const Z = await loadZxing();
  const reader = makeReader(Z);
  let bmp;
  try { bmp = await createImageBitmap(file); }
  catch { bmp = new Image(); bmp.src = URL.createObjectURL(file); await bmp.decode(); }
  const W = bmp.width, H = bmp.height;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  let sawPrice = false;
  const attempt = (sx, sy, sw, sh, rotate, maxW) => {
    const scale = Math.min(1, maxW / sw);
    const w = Math.round(sw * scale), h = Math.round(sh * scale);
    canvas.width = rotate ? h : w;
    canvas.height = rotate ? w : h;
    ctx.save();
    if (rotate) { ctx.translate(h, 0); ctx.rotate(Math.PI / 2); }
    ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, w, h);
    ctx.restore();
    try { return reader.decodeFromCanvas(canvas).getText(); } catch { return null; }
  };
  const tries = [[0, 0, W, H, 1600], [0, 0, W, H, 1000]];
  for (let i = 0; i < 5; i++) tries.push([0, (H * i) / 6, W, H / 3, 1400]);
  for (const rot of [false, true]) {
    for (const [sx, sy, sw, sh, maxW] of tries) {
      const text = attempt(sx, sy, sw, sh, rot, maxW);
      if (!text) continue;
      const isbn = toIsbn13(text);
      if (isbn) return isbn;
      sawPrice = true;
    }
  }
  return sawPrice ? 'price' : null;
}
