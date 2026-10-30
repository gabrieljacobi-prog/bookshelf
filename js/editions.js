// Other editions of a book, found by title and author rather than ISBN.
// Used by the fix panel when the cover or the edition is wrong.
import { firebaseConfig } from './firebase-config.js?v=3';
import { normLang, toIsbn13, lookupAll } from './lookup.js?v=11';

async function getJson(url, ms = 12000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}

const enc = encodeURIComponent;

// Google answers bursts and an empty daily quota with 429/503: wait and retry,
// then try once without the key (a separate, shared allowance).
async function googleJson(url) {
  for (let i = 0; i < 3; i++) {
    try { return await getJson(`${url}&key=${firebaseConfig.apiKey}`); }
    catch (e) {
      if (!/HTTP (429|503)/.test(e.message)) throw e;
      if (i < 2) await new Promise((r) => setTimeout(r, 1200 * 2 ** i));
    }
  }
  try { return await getJson(url); }
  catch (e) { throw new Error(/HTTP 429/.test(e.message) ? 'busy or out of its daily allowance, try again later' : e.message); }
}
const year = (s) => String(s || '').match(/\d{4}/)?.[0] || null;

async function openLibrary(title, author, { publisher, year: wantYear } = {}) {
  const q = `https://openlibrary.org/search.json?title=${enc(title)}${author ? `&author=${enc(author)}` : ''}&limit=3&fields=key`;
  const works = (await getJson(q)).docs || [];
  const out = [];
  // With a publisher or year to match, read far more editions and keep the matching ones.
  const deep = !!(publisher || wantYear);
  for (const w of works.slice(0, 2)) {
    let eds = [];
    for (let offset = 0; offset < (deep ? 1000 : 80); offset += deep ? 200 : 80) {
      const page = (await getJson(`https://openlibrary.org${w.key}/editions.json?limit=${deep ? 200 : 80}&offset=${offset}`)).entries || [];
      eds = eds.concat(page);
      if (page.length < (deep ? 200 : 80)) break;
    }
    if (publisher) eds = eds.filter((e) => (e.publishers || []).some((p) => norm(p).includes(norm(publisher))));
    if (wantYear) eds = eds.filter((e) => Math.abs((Number(year(e.publish_date)) || 0) - wantYear) <= 3);
    for (const e of eds) {
      const id = (e.covers || []).find((c) => c > 0);
      if (!id) continue;
      out.push({
        source: 'Open Library',
        thumb: `https://covers.openlibrary.org/b/id/${id}-M.jpg`,
        cover: `https://covers.openlibrary.org/b/id/${id}-L.jpg`,
        title: e.title || null,
        publisher: e.publishers?.[0] || null,
        year: year(e.publish_date),
        isbn: e.isbn_13?.[0] || toIsbn13(e.isbn_10?.[0] || '') || null,
        language: normLang(e.languages?.[0]?.key),
      });
    }
  }
  return out;
}

async function googleBooks(title, author, { publisher } = {}) {
  const q = `intitle:"${title}"${author ? ` inauthor:"${author}"` : ''}${publisher ? ` inpublisher:"${publisher}"` : ''}`;
  const data = await googleJson(`https://www.googleapis.com/books/v1/volumes?q=${enc(q)}&maxResults=30`);
  return (data.items || []).map((i) => i.volumeInfo).filter((v) => v.imageLinks?.thumbnail).map((v) => {
    const img = v.imageLinks.thumbnail.replace('http://', 'https://').replace('&edge=curl', '');
    const ids = v.industryIdentifiers || [];
    return {
      source: 'Google Books',
      thumb: img,
      cover: img,
      title: v.title || null,
      publisher: v.publisher || null,
      year: year(v.publishedDate),
      isbn: ids.find((x) => x.type === 'ISBN_13')?.identifier || toIsbn13(ids.find((x) => x.type === 'ISBN_10')?.identifier || '') || null,
      language: normLang(v.language),
    };
  });
}

const norm = (s) => String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

// One exact edition from the ISBN printed in the book.
async function byIsbn(isbn) {
  const { merged } = await lookupAll(isbn);
  if (!merged) return [];
  return (merged.covers || []).map((c) => ({
    source: c.source, thumb: c.url, cover: c.url, title: merged.title,
    publisher: merged.publisher, year: merged.year, isbn, language: merged.language,
  }));
}

// → { editions: [...], errors: [...] }.
// opts: { publisher, year, isbn } from what's printed in the copy.
// Order: nearest to the given year, then the book's own language, then those with an ISBN.
export async function findEditions(book, opts = {}) {
  if (opts.isbn) {
    const isbn = toIsbn13(opts.isbn);
    if (!isbn) return { editions: [], errors: ['That ISBN doesn\'t look right'] };
    try { return { editions: await byIsbn(isbn), errors: [], exact: true }; }
    catch (e) { return { editions: [], errors: [e.message] }; }
  }
  const title = String(book.title || '').replace(/:.*$/, '').trim() || book.title;
  const author = book.authors?.[0] || '';
  const errors = [];
  const [ol, gb] = await Promise.all([
    openLibrary(title, author, opts).catch((e) => { errors.push('Open Library: ' + e.message); return []; }),
    googleBooks(title, author, opts).catch((e) => { errors.push('Google Books: ' + e.message); return []; }),
  ]);
  const seen = new Set();
  const all = [...ol, ...gb].filter((e) => {
    const k = e.isbn || e.cover;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const score = (e) => (e.language && e.language === book.language ? 2 : 0) + (e.isbn ? 1 : 0);
  const dist = (e) => (opts.year ? Math.abs((Number(e.year) || 0) - opts.year) : 0);
  all.sort((a, b) => dist(a) - dist(b) || score(b) - score(a));
  return { editions: all.slice(0, 48), errors };
}

export function imageSearchUrl(book) {
  const q = [book.title, book.authors?.[0], 'book cover'].filter(Boolean).join(' ');
  return `https://www.google.com/search?tbm=isch&q=${enc(q)}`;
}
