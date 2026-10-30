// Straightening a cover: drag four corners onto the cover's corners and the
// picture is warped flat (perspective correction), so a photo taken at an angle
// comes out like a scan. Works on a photo from the phone or on a saved cover.
//
// cropImage(fileOrUrl) → a canvas (cropped), the whole image (as a canvas), or
// null when cancelled. The result goes on to coverFromImage() in covers.js.
import { loadImage } from './covers.js?v=2';

const WORK = 2400; // long edge of the working copy (phone photos can be 4000+ px)
const OUT = 1600;  // long edge of the result; the large cover is never bigger

export async function cropImage(source) {
  const isBlob = source instanceof Blob;
  const url = isBlob ? URL.createObjectURL(source) : source;
  let src;
  try {
    const img = await loadImage(url, !isBlob && /^https?:/.test(url));
    const iw = img.naturalWidth, ih = img.naturalHeight;
    const s = Math.min(1, WORK / Math.max(iw, ih));
    src = document.createElement('canvas');
    src.width = Math.round(iw * s); src.height = Math.round(ih * s);
    const g = src.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, src.width, src.height);
    g.drawImage(img, 0, 0, src.width, src.height);
  } finally { if (isBlob) URL.revokeObjectURL(url); }
  return new Promise((resolve) => openCropper(src, resolve));
}

// --- The cropping view ---------------------------------------------------------

function openCropper(src, done) {
  const W = src.width, H = src.height;
  const inset = Math.round(Math.min(W, H) * 0.06);
  const pts = [[inset, inset], [W - inset, inset], [W - inset, H - inset], [inset, H - inset]]; // tl, tr, br, bl
  const ov = document.createElement('div');
  ov.className = 'crop grain';
  ov.setAttribute('role', 'dialog');
  ov.setAttribute('aria-modal', 'true');
  ov.setAttribute('aria-label', 'Crop the cover');
  ov.innerHTML = `
    <p class="crop-hint">Drag the four corners onto the corners of the cover.</p>
    <div class="crop-stage"><div class="crop-frame">
      <canvas class="crop-img"></canvas>
      <svg class="crop-svg" aria-hidden="true"></svg>
    </div><canvas class="crop-loupe" hidden></canvas></div>
    <div class="crop-acts">
      <button type="button" class="cancel tap" data-c="cancel">Cancel</button>
      <span style="flex:1"></span>
      <button type="button" class="btn-line ch8" data-c="whole"><span class="ch8i tap">Whole image</span></button>
      <button type="button" class="btn-ink tap ch8" data-c="crop">Crop</button>
    </div>`;
  document.body.appendChild(ov);
  // Nothing behind may scroll or zoom while cropping: on Firefox for Android a
  // drag could scroll the page (hiding the address bar) and leave the buttons
  // off screen or under the picture.
  const html = document.documentElement;
  const prev = [document.body.style.overflow, html.style.overflow];
  document.body.style.overflow = 'hidden';
  html.style.overflow = 'hidden';
  const noScroll = (e) => { if (e.cancelable) e.preventDefault(); };
  ov.addEventListener('touchmove', noScroll, { passive: false });
  // The view covers exactly what's visible, even if the browser's bars move or the page is zoomed.
  const vv = window.visualViewport;
  function fit() {
    if (!vv) return;
    Object.assign(ov.style, { left: vv.offsetLeft + 'px', top: vv.offsetTop + 'px', width: vv.width + 'px', height: vv.height + 'px', right: 'auto', bottom: 'auto' });
  }
  fit();

  const stage = ov.querySelector('.crop-stage'), frame = ov.querySelector('.crop-frame');
  const view = ov.querySelector('.crop-img'), svg = ov.querySelector('.crop-svg'), loupe = ov.querySelector('.crop-loupe');
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  let k = 1; // display px per working px

  function layout() {
    if (drag >= 0) { relayout = true; return; } // after the finger lifts
    const r = stage.getBoundingClientRect();
    if (r.width < 40 || r.height < 40) return;
    k = Math.min((r.width - 32) / W, (r.height - 32) / H);
    const dw = Math.round(W * k), dh = Math.round(H * k);
    frame.style.width = dw + 'px'; frame.style.height = dh + 'px';
    view.width = Math.round(dw * dpr); view.height = Math.round(dh * dpr);
    view.getContext('2d').drawImage(src, 0, 0, view.width, view.height);
    svg.setAttribute('viewBox', `0 0 ${dw} ${dh}`);
    draw();
  }

  function draw() {
    const d = pts.map(([x, y]) => [x * k, y * k]);
    const dw = W * k, dh = H * k;
    const quad = d.map(([x, y]) => `${x},${y}`).join(' ');
    svg.innerHTML = `
      <path d="M0 0H${dw}V${dh}H0Z M${d.map(([x, y]) => `${x} ${y}`).join(' L')}Z" fill="rgba(0,0,0,.5)" fill-rule="evenodd"/>
      <polygon points="${quad}" fill="none" stroke="var(--accent)" stroke-width="1.5"/>
      ${d.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="10" fill="rgba(255,255,255,.25)" stroke="var(--accent)" stroke-width="2"/>`).join('')}`;
  }

  // Dragging: the nearest corner within reach follows the finger.
  let drag = -1, relayout = false;
  const toWork = (e) => {
    const r = frame.getBoundingClientRect();
    return [Math.max(0, Math.min(W, (e.clientX - r.left) / k)), Math.max(0, Math.min(H, (e.clientY - r.top) / k))];
  };
  stage.addEventListener('pointerdown', (e) => {
    const [x, y] = toWork(e);
    let best = -1, bd = 44 / k; // 44 px reach on screen
    pts.forEach(([px, py], i) => { const dd = Math.hypot(px - x, py - y); if (dd < bd) { bd = dd; best = i; } });
    if (best < 0) return;
    drag = best;
    stage.setPointerCapture(e.pointerId);
    e.preventDefault();
    showLoupe(e);
  });
  stage.addEventListener('pointermove', (e) => {
    if (drag < 0) return;
    pts[drag] = toWork(e);
    draw();
    showLoupe(e);
  });
  const end = () => { drag = -1; loupe.hidden = true; if (relayout) { relayout = false; layout(); } };
  stage.addEventListener('pointerup', end);
  stage.addEventListener('pointercancel', end);

  // Magnifier, in the top corner away from the finger, so the corner can be placed exactly.
  const LS = 120, ZOOM = 3;
  function showLoupe(e) {
    const [x, y] = pts[drag];
    const sr = stage.getBoundingClientRect();
    loupe.hidden = false;
    loupe.width = LS * dpr; loupe.height = LS * dpr;
    loupe.style.left = (e.clientX - sr.left < sr.width / 2 ? sr.width - LS - 12 : 12) + 'px';
    loupe.style.top = '12px';
    const g = loupe.getContext('2d');
    const span = LS / (k * ZOOM); // working px shown across the loupe
    g.fillStyle = '#000'; g.fillRect(0, 0, loupe.width, loupe.height);
    g.drawImage(src, x - span / 2, y - span / 2, span, span, 0, 0, loupe.width, loupe.height);
    // Outline of the crop near this corner, then a crosshair on the corner.
    const m = (px, py) => [(px - x) / span * loupe.width + loupe.width / 2, (py - y) / span * loupe.height + loupe.height / 2];
    const acc = getComputedStyle(ov).getPropertyValue('--accent').trim() || '#A8552B';
    g.strokeStyle = acc; g.lineWidth = 1.5 * dpr;
    g.beginPath();
    pts.forEach((p, i) => { const [a, b] = m(...p); i ? g.lineTo(a, b) : g.moveTo(a, b); });
    g.closePath(); g.stroke();
    g.strokeStyle = '#fff'; g.lineWidth = 1 * dpr;
    const c = loupe.width / 2;
    g.beginPath(); g.moveTo(c - 10 * dpr, c); g.lineTo(c + 10 * dpr, c); g.moveTo(c, c - 10 * dpr); g.lineTo(c, c + 10 * dpr); g.stroke();
  }

  let closed = false;
  function close(result) {
    if (closed) return; // a tap can arrive as both pointerup and click
    closed = true;
    ro.disconnect();
    vv?.removeEventListener('resize', fit);
    vv?.removeEventListener('scroll', fit);
    document.removeEventListener('keydown', onKey);
    [document.body.style.overflow, html.style.overflow] = prev;
    ov.remove();
    done(result);
  }
  const onKey = (e) => { if (e.key === 'Escape') close(null); };
  document.addEventListener('keydown', onKey);
  // Re-fit whenever the stage changes size (rotation, browser bars), not just on window resize.
  const ro = new ResizeObserver(() => layout());
  ro.observe(stage);
  vv?.addEventListener('resize', fit);
  vv?.addEventListener('scroll', fit);
  ov.querySelector('[data-c="cancel"]').addEventListener('click', () => close(null));
  ov.querySelector('[data-c="whole"]').addEventListener('click', () => close(src));
  ov.querySelector('[data-c="crop"]').addEventListener('click', () => {
    const b = ov.querySelector('[data-c="crop"]');
    b.disabled = true; b.textContent = 'Straightening…';
    setTimeout(() => close(warp(src, pts)), 30); // let the label paint first
  });
  // Buttons act on pointerup too: if a stray drag swallowed the click, the tap still counts.
  ov.querySelectorAll('[data-c]').forEach((btn) => btn.addEventListener('pointerup', (e) => { if (e.pointerType !== 'mouse') { e.preventDefault(); btn.click(); } }));
  requestAnimationFrame(layout);
}

// --- Perspective warp -------------------------------------------------------------
// Maps the unit square onto the quad (Heckbert's square-to-quad), then samples the
// source bilinearly for every output pixel.

function squareToQuad(p) {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = p;
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
  if (Math.abs(dx3) < 1e-9 && Math.abs(dy3) < 1e-9) {
    return { a: x1 - x0, b: x3 - x0, c: x0, d: y1 - y0, e: y3 - y0, f: y0, g: 0, h: 0 };
  }
  const det = dx1 * dy2 - dx2 * dy1;
  const g = (dx3 * dy2 - dx2 * dy3) / det, h = (dx1 * dy3 - dx3 * dy1) / det;
  return { a: x1 - x0 + g * x1, b: x3 - x0 + h * x3, c: x0, d: y1 - y0 + g * y1, e: y3 - y0 + h * y3, f: y0, g, h };
}

export function warp(src, p) {
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  let w = (dist(p[0], p[1]) + dist(p[3], p[2])) / 2;
  let h = (dist(p[0], p[3]) + dist(p[1], p[2])) / 2;
  const s = Math.min(1, OUT / Math.max(w, h));
  w = Math.max(1, Math.round(w * s)); h = Math.max(1, Math.round(h * s));
  const T = squareToQuad(p);
  const SW = src.width, SH = src.height;
  const sd = src.getContext('2d').getImageData(0, 0, SW, SH).data;
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  const g = out.getContext('2d');
  const od = g.createImageData(w, h), o = od.data;
  let i = 0;
  for (let y = 0; y < h; y++) {
    const v = (y + 0.5) / h;
    for (let x = 0; x < w; x++, i += 4) {
      const u = (x + 0.5) / w;
      const den = T.g * u + T.h * v + 1;
      let sx = (T.a * u + T.b * v + T.c) / den - 0.5;
      let sy = (T.d * u + T.e * v + T.f) / den - 0.5;
      sx = Math.max(0, Math.min(SW - 1.001, sx)); sy = Math.max(0, Math.min(SH - 1.001, sy));
      const ix = sx | 0, iy = sy | 0, fx = sx - ix, fy = sy - iy;
      const p00 = (iy * SW + ix) * 4, p01 = p00 + 4, p10 = p00 + SW * 4, p11 = p10 + 4;
      for (let c = 0; c < 3; c++) {
        const top = sd[p00 + c] + (sd[p01 + c] - sd[p00 + c]) * fx;
        const bot = sd[p10 + c] + (sd[p11 + c] - sd[p10 + c]) * fx;
        o[i + c] = top + (bot - top) * fy;
      }
      o[i + 3] = 255;
    }
  }
  g.putImageData(od, 0, 0);
  return out;
}
