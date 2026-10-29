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
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally {
    clearTimeout(t);
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

export async function googleBooks(isbn) {
  const data = await getJson(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}`);
  const v = data.items?.[0]?.volumeInfo;
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
    cover: null,
  };
}

const SOURCES = { google: googleBooks, openlibrary: openLibrary, libris };

// Runs every source, never throws. Returns { isbn, results: {key: rec|null|{error}}, merged }.
export async function lookupAll(isbn) {
  const entries = await Promise.all(
    Object.entries(SOURCES).map(async ([key, fn]) => {
      const t0 = performance.now();
      try {
        const rec = await fn(isbn);
        return [key, rec ? { ...rec, ms: Math.round(performance.now() - t0) } : null];
      } catch (e) {
        return [key, { error: e.message || String(e) }];
      }
    })
  );
  const results = Object.fromEntries(entries);
  return { isbn, results, merged: merge(isbn, results) };
}

export function merge(isbn, results) {
  const order = isbnRegion(isbn) === 'se' ? ['libris', 'google', 'openlibrary'] : ['google', 'openlibrary', 'libris'];
  const ok = order.map((k) => results[k]).filter((r) => r && !r.error);
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
