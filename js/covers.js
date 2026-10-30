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

// From a photo or file picked on the phone (EXIF rotation is applied by the browser).
export async function coverFromFile(file) {
  const url = URL.createObjectURL(file);
  try { return { mode: 'copied', ...both(await loadImage(url, false), 'Photo') }; }
  finally { URL.revokeObjectURL(url); }
}
