// Turning an image (a URL or a photo from the phone) into the two cover sizes
// stored in Firestore. Same sizes as the import.

export const THUMB = { edge: 600, budget: 150_000 };   // grid
export const LARGE = { edge: 1600, budget: 880_000 };  // book page; the rule caps at 900 000

export function loadImage(src, cors) {
  return new Promise((res, rej) => {
    const img = new Image();
    if (cors) img.crossOrigin = 'anonymous';
    const t = setTimeout(() => rej(new Error('timeout')), 20000);
    img.onload = () => { clearTimeout(t); img.naturalWidth > 10 ? res(img) : rej(new Error('empty')); };
    img.onerror = () => { clearTimeout(t); rej(new Error(cors ? 'cors' : 'load')); };
    img.src = cors && /^https?:/.test(src) ? src + (src.includes('?') ? '&' : '?') + 'c=1' : src;
  });
}

export function encode(img, { edge, budget }) {
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  const scale = Math.min(1, edge / Math.max(iw, ih));
  const w = Math.round(iw * scale), h = Math.round(ih * scale);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, w, h);
  g.drawImage(img, 0, 0, w, h);
  // Images already smaller than this size (often the only cover there is) are
  // kept at near-full quality: they fit the budget easily, so no need to lose more.
  const qs = scale === 1 ? [0.95, 0.9, 0.85, 0.78, 0.7, 0.6, 0.5, 0.4] : [0.85, 0.78, 0.7, 0.6, 0.5, 0.4];
  for (const q of qs) {
    const url = c.toDataURL('image/jpeg', q);
    if (url.length < budget) return url;
  }
  return null;
}

function both(img, source) {
  const thumb = encode(img, THUMB), large = encode(img, LARGE);
  if (!thumb || !large) throw new Error('image too large to store');
  return { thumb, large, w: img.naturalWidth || img.width, h: img.naturalHeight || img.height, source };
}

// From a URL: copied when the source allows it, else { url } to keep as a link.
export async function coverFromUrl(url, source) {
  try {
    return { mode: 'copied', ...both(await loadImage(url, true), source) };
  } catch {
    const img = await loadImage(url, false);
    return { mode: 'link', url, w: img.naturalWidth, h: img.naturalHeight, source };
  }
}

// From an image or canvas already in hand (e.g. the result of the crop step).
export function coverFromImage(img, source) {
  return { mode: 'copied', ...both(img, source) };
}

// --- Photos from the phone: upright, whatever the browser does ----------------------
// A camera stores the picture as the sensor saw it plus a tag saying how to turn
// it ("rotate 90°"). Browsers normally apply the tag; this checks once whether
// this one does, and if not turns the picture here. (A photo taken straight down
// at a book on a table can still come out sideways: the phone can't tell which
// way is up then. That's what Rotate in the crop step is for.)

// 16×8 JPEG, left half black, tagged "rotate 90° clockwise": applied, it's 8×16 with the black half on top.
const TEST = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/4QAiRXhpZgAATU0AKgAAAAgAAQESAAMAAAABAAYAAAAAAAD/2wBDAAIBAQEBAQIBAQECAgICAgQDAgICAgUEBAMEBgUGBgYFBgYGBwkIBgcJBwYGCAsICQoKCgoKBggLDAsKDAkKCgr/2wBDAQICAgICAgUDAwUKBwYHCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgr/wAARCAAIABADAREAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD+f+gD+/ygD//Z';
let applies = null;
function browserApplies() {
  if (!applies) {
    applies = loadImage(TEST, false).then((img) => {
      // Drawn as the browser draws it: if the tag was applied, there's picture at (2, 12).
      const c = document.createElement('canvas');
      c.width = 16; c.height = 16;
      c.getContext('2d').drawImage(img, 0, 0);
      return c.getContext('2d').getImageData(2, 12, 1, 1).data[3] > 0;
    }).catch(() => true);
  }
  return applies;
}

// The rotation tag (1–8) from a JPEG's EXIF block; 1 when there's none.
async function exifOrientation(file) {
  try {
    const v = new DataView(await file.slice(0, 128 * 1024).arrayBuffer());
    if (v.getUint16(0) !== 0xFFD8) return 1;
    let p = 2;
    while (p + 4 < v.byteLength) {
      const marker = v.getUint16(p), len = v.getUint16(p + 2);
      if (marker === 0xFFE1 && v.getUint32(p + 4) === 0x45786966) { // "Exif"
        const t = p + 10, le = v.getUint16(t) === 0x4949;
        const n = v.getUint16(t + v.getUint32(t + 4, le), le);
        for (let i = 0; i < n; i++) {
          const e = t + v.getUint32(t + 4, le) + 2 + i * 12;
          if (v.getUint16(e, le) === 0x0112) return v.getUint16(e + 8, le) || 1;
        }
        return 1;
      }
      if ((marker & 0xFF00) !== 0xFF00 || marker === 0xFFDA) return 1;
      p += 2 + len;
    }
  } catch { /* not a JPEG we can read */ }
  return 1;
}

// A picked photo as an upright canvas, the long edge at most `maxEdge`.
export async function photoCanvas(file, maxEdge) {
  const url = URL.createObjectURL(file);
  try {
    const [img, fix] = await Promise.all([loadImage(url, false), browserApplies().then((ok) => (ok ? 1 : exifOrientation(file)))]);
    const iw = img.naturalWidth, ih = img.naturalHeight;
    const s = Math.min(1, maxEdge / Math.max(iw, ih));
    const w = Math.round(iw * s), h = Math.round(ih * s);
    const side = fix >= 5; // 5–8 turn the picture a quarter
    const c = document.createElement('canvas');
    c.width = side ? h : w; c.height = side ? w : h;
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    const T = { 2: [-1, 0, 0, 1, w, 0], 3: [-1, 0, 0, -1, w, h], 4: [1, 0, 0, -1, 0, h], 5: [0, 1, 1, 0, 0, 0], 6: [0, 1, -1, 0, h, 0], 7: [0, -1, -1, 0, h, w], 8: [0, -1, 1, 0, 0, w] }[fix];
    if (T) g.setTransform(...T);
    g.drawImage(img, 0, 0, w, h);
    return c;
  } finally { URL.revokeObjectURL(url); }
}

// From a photo or file picked on the phone.
export async function coverFromFile(file) {
  return { mode: 'copied', ...both(await photoCanvas(file, LARGE.edge), 'Photo') };
}
