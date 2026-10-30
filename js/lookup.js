import { firebaseConfig } from './firebase-config.js?v=3';

// Book metadata lookup: Google Books → Open Library → LIBRIS.
// Each source returns a normalised record or null. lookupAll() runs them in
// parallel and merges the results, preferring LIBRIS for Swedish ISBNs.

const LANG3 = { eng: 'en', por: 'pt', swe: 'sv', dut: 'nl', nld: 'nl', jpn: 'ja', spa: 'es', fre: 'fr', fra: 'fr', ger: 'de', deu: 'de', ita: 'it', dan: 'da', nor: 'no', pol: 'pl' };

export function normLang(code) {
  if (!code) return null;
  const c = String(code).trim().toLowerCase().replace('/languages/', '');
  if (c.length === 3) return LANG3[c] || c;
  if (c.startsWith('pt')) return 'pt';
  return c.slice(0, 2);
}

// --- ISBN helpers -----------------------------------------------------------

export function cleanIsbn(raw) {
  return String(raw || '').replace(/[^0-9Xx]/g, '').toUpperCase();
}

export function isValidIsbn13(s) {
  if (!/^97[89]\d{10}$/.test(s)) return false;
  const sum = [...s.slice(0, 12)].reduce((a, d, i) => a + Number(d) * (i % 2 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === Number(s[12]);
}

export function isbn10to13(s) {
  if (!/^\d{9}[\dX]$/.test(s)) return null;
  const core = '978' + s.slice(0, 9);
  const sum = [...core].reduce((a, d, i) => a + Number(d) * (i % 2 ? 3 : 1), 0);
  return core + ((10 - (sum % 10)) % 10);
}

export function toIsbn13(raw) {
  const s = cleanIsbn(raw);
  if (s.length === 13) return isValidIsbn13(s) ? s : null;
  if (s.length === 10) return isbn10to13(s);
  return null;
}

// Rough origin from the registration group, used to order sources.
export function isbnRegion(isbn) {
  const g = isbn.slice(3);
  if (g.startsWith('91')) return 'se';
  if (g.startsWith('85') || g.startsWith('65')) return 'br';
  if (g.startsWith('972') || g.startsWith('989')) return 'pt';
  if (g.startsWith('90') || g.startsWith('94')) return 'nl';
  if (g.startsWith('4')) return 'jp';
  if (g.startsWith('0') || g.startsWith('1')) return 'en';
  return 'other';
}

// --- Sources ------------------------------------------------------------------

async function getJson(url, ms = 9000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) {
      let detail = '';
      try { detail = (await r.json())?.error?.message || ''; } catch {}
      throw new Error('HTTP ' + r.status + (detail ? ' ' + detail.slice(0, 160) : ''));
    }
    return await r.json();
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('timeout');
    if (e instanceof TypeError) throw new Error('blocked (network/CORS)');
    throw e;
  } finally {
    clearTimeout(t);
  }
}

// Google answers bursts with 503/429. Wait and try again a few times.
async function withBackoff(fn, tries = 4) {
  for (let i = 0; ; i++) {
    try { return await fn(); }
    catch (e) {
      if (i >= tries - 1 || !/HTTP (503|429|500)/.test(e.message)) throw e;
      await new Promise((r) => setTimeout(r, 800 * 2 ** i + Math.random() * 400));
    }
  }
}

function jsonp(url, ms = 9000) {
  return new Promise((resolve, reject) => {
    const cb = '__libris' + Math.random().toString(36).slice(2);
    const s = document.createElement('script');
    const t = setTimeout(() => { cleanup(); reject(new Error('timeout')); }, ms);
    function cleanup() { clearTimeout(t); delete window[cb]; s.remove(); }
    window[cb] = (data) => { cleanup(); resolve(data); };
    s.onerror = () => { cleanup(); reject(new Error('script error')); };
    s.src = url + (url.includes('?') ? '&' : '?') + 'callback=' + cb;
    document.head.appendChild(s);
  });
}

// Google Books rejects most anonymous browser requests, so we send the
// project's API key (Books API must be enabled for it). If the key isn't
// allowed to call Books yet, fall back to an anonymous request.
export async function googleBooks(isbn) {
  const base = `https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}`;
  let data;
  try {
    data = await withBackoff(() => getJson(`${base}&key=${firebaseConfig.apiKey}`));
  } catch (e) {
    if (!/HTTP 403/.test(e.message)) throw e;
    try { data = await getJson(base); }
    catch (e2) { throw new Error('with key: ' + e.message + ' | anonymous: ' + e2.message.slice(0, 20)); }
  }
  let v = data.items?.[0]?.volumeInfo;
  if (!v) {
    // isbn: searches miss books that a plain query finds, so try that too.
    try {
      const d2 = await withBackoff(() => getJson(`https://www.googleapis.com/books/v1/volumes?q=${isbn}&key=${firebaseConfig.apiKey}`));
      v = (d2.items || []).map((i) => i.volumeInfo).find((x) => (x.industryIdentifiers || []).some((id) => id.identifier.replace(/-/g, '') === isbn));
    } catch { /* keep null */ }
  }
  if (!v) return null;
  let cover = v.imageLinks?.thumbnail || v.imageLinks?.smallThumbnail || null;
  if (cover) cover = cover.replace('http://', 'https://').replace('&edge=curl', '');
  return {
    source: 'Google Books',
    title: v.title || null,
    subtitle: v.subtitle || null,
    authors: v.authors || [],
    publisher: v.publisher || null,
    year: v.publishedDate ? v.publishedDate.slice(0, 4) : null,
    language: normLang(v.language),
    pages: v.pageCount || null,
    cover,
  };
}

export async function openLibrary(isbn) {
  const data = await getJson(`https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`);
  const b = data[`ISBN:${isbn}`];
  if (!b) return null;
  return {
    source: 'Open Library',
    title: b.title || null,
    subtitle: b.subtitle || null,
    authors: (b.authors || []).map((a) => a.name),
    publisher: b.publishers?.[0]?.name || null,
    year: (b.publish_date || '').match(/\d{4}/)?.[0] || null,
    language: null,
    pages: b.number_of_pages || null,
    // ?default=false makes the cover URL 404 instead of returning a blank image
    cover: b.cover?.large || `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg?default=false`,
  };
}

export async function libris(isbn) {
  const url = `https://libris.kb.se/xsearch?query=isbn:${isbn}&format=json`;
  let data;
  try { data = await getJson(url); } catch { data = await jsonp(url); }
  const rec = data?.xsearch?.list?.[0];
  if (!rec) return null;
  const pick = (x) => (Array.isArray(x) ? x[0] : x) || null;
  const creators = [].concat(rec.creator || []).map((c) => c.replace(/,?\s*\d{4}-(\d{4})?\.?$/, '').trim());
  return {
    source: 'LIBRIS',
    title: pick(rec.title)?.replace(/\s*\/.*$/, '') || null,
    subtitle: null,
    authors: creators,
    publisher: pick(rec.publisher),
    year: (pick(rec.date) || '').match(/\d{4}/)?.[0] || null,
    language: normLang(pick(rec.language)),
    pages: null,
    // LIBRIS's website shows publisher covers from its image service, keyed by ISBN.
    cover: `https://xinfo.libris.kb.se/xinfo/getxinfo?identifier=/PICTURE/bokrondellen/isbn/${isbn}/${isbn}.jpg/orginal`,
  };
}

// BrasilAPI aggregates Brazilian sources (CBL, Mercado Editorial…) with covers.
export async function brasilApi(isbn) {
  let b;
  try { b = await getJson(`https://brasilapi.com.br/api/isbn/v1/${isbn}`); }
  catch (e) { if (/HTTP 404/.test(e.message)) return null; throw e; }
  if (!b?.title) return null;
  return {
    source: 'BrasilAPI',
    title: b.title,
    subtitle: b.subtitle || null,
    authors: b.authors || [],
    publisher: b.publisher || null,
    year: b.year ? String(b.year) : null,
    language: 'pt',
    pages: b.page_count || null,
    cover: b.cover_url || null,
  };
}

// Last fallback, covers only. Not a documented API: Amazon serves product images
// by ISBN-10 at this address, and a 1×1 GIF when it has none (the load check
// rejects that). May stop working at any time; nothing else depends on it.
export function isbn13to10(isbn) {
  if (!/^978\d{10}$/.test(isbn)) return null; // 979 ISBNs have no ISBN-10
  const core = isbn.slice(3, 12);
  const sum = [...core].reduce((a, d, i) => a + Number(d) * (10 - i), 0);
  const c = (11 - (sum % 11)) % 11;
  return core + (c === 10 ? 'X' : String(c));
}

export async function amazonCover(isbn) {
  const i10 = isbn13to10(isbn);
  if (!i10) return null;
  return {
    source: 'Amazon', title: null, subtitle: null, authors: [], publisher: null,
    year: null, language: null, pages: null,
    cover: `https://images-na.ssl-images-amazon.com/images/P/${i10}.01.LZZZZZZZ.jpg`,
  };
}

const SOURCES = { amazon: amazonCover, google: googleBooks, openlibrary: openLibrary, libris, brasil: brasilApi };

// Runs every source, never throws. Returns { isbn, results: {key: rec|null|{error}}, merged }.
async function run1(key, isbn) {
  const t0 = performance.now();
  try {
    const rec = await SOURCES[key](isbn);
    return rec ? { ...rec, ms: Math.round(performance.now() - t0) } : null;
  } catch (e) {
    return { error: e.message || String(e) };
  }
}

// A cover counts only if the image actually loads (Open Library and LIBRIS
// hand out URLs that may 404). Browser-only.
export function coverLoads(url, ms = 7000) {
  if (!url || typeof Image === 'undefined') return Promise.resolve(false);
  return new Promise((res) => {
    const img = new Image();
    const t = setTimeout(() => res(false), ms);
    img.onload = () => { clearTimeout(t); res(img.naturalWidth > 10); };
    img.onerror = () => { clearTimeout(t); res(false); };
    img.src = url;
  });
}

async function firstWorkingCover(recs) {
  for (const r of recs) if (r && !r.error && r.cover && (await coverLoads(r.cover))) return r.cover;
  return null;
}

// Open Library + LIBRIS (+ BrasilAPI for Brazilian ISBNs) run together.
// Google is asked only when they miss the book or have no cover that loads;
// its ISBN search proved slow and inconsistent. Never throws.
export async function lookupAll(isbn, { all = false } = {}) {
  const br = isbnRegion(isbn) === 'br';
  const [openlibrary, librisRes, brasil] = await Promise.all([
    run1('openlibrary', isbn), run1('libris', isbn), br ? run1('brasil', isbn) : Promise.resolve(null),
  ]);
  const firstRound = [brasil, openlibrary, librisRes];
  const found = firstRound.some((r) => r && !r.error);
  // Drop cover URLs that don't load, so the record only lists real covers.
  for (const r of firstRound) if (r && !r.error && r.cover && !(await coverLoads(r.cover))) r.cover = null;
  const hasCover = firstRound.some((r) => r && !r.error && r.cover);
  let google = { skipped: true };
  if (all || !found || !hasCover) {
    google = await run1('google', isbn);
    if (google && !google.error && google.cover && !(await coverLoads(google.cover))) google.cover = null;
  }
  const results = { google, openlibrary, libris: librisRes };
  if (br) results.brasil = brasil;
  const anyCover = [...firstRound, google].some((r) => r && !r.error && !r.skipped && r.cover);
  if (!anyCover) {
    const amazon = await run1('amazon', isbn);
    if (amazon && !amazon.error && !(await coverLoads(amazon.cover))) amazon.cover = null;
    if (amazon?.cover) results.amazon = amazon;
  }
  return { isbn, results, merged: merge(isbn, results) };
}

export function merge(isbn, results) {
  const region = isbnRegion(isbn);
  const order = region === 'se' ? ['libris', 'openlibrary', 'google']
    : region === 'br' ? ['brasil', 'openlibrary', 'google', 'libris']
    : ['openlibrary', 'libris', 'google'];
  order.push('amazon');
  const ok = order.map((k) => results[k]).filter((r) => r && !r.error && !r.skipped);
  if (!ok.length) return null;
  const first = (f) => ok.map((r) => r[f]).find((v) => (Array.isArray(v) ? v.length : v)) ?? null;
  return {
    isbn,
    title: first('title'),
    subtitle: first('subtitle'),
    authors: first('authors') || [],
    publisher: first('publisher'),
    year: first('year'),
    language: first('language'),
    pages: first('pages'),
    covers: ok.filter((r) => r.cover).map((r) => ({ source: r.source, url: r.cover })),
  };
}
