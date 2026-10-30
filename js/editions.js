// Other editions of a book, found by title and author rather than ISBN.
// Used by the fix panel when the cover or the edition is wrong.
import { firebaseConfig } from './firebase-config.js?v=3';
import { normLang, toIsbn13 } from './lookup.js?v=11';

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
const year = (s) => String(s || '').match(/\d{4}/)?.[0] || null;

async function openLibrary(title, author) {
  const q = `https://openlibrary.org/search.json?title=${enc(title)}${author ? `&author=${enc(author)}` : ''}&limit=3&fields=key`;
  const works = (await getJson(q)).docs || [];
  const out = [];
  for (const w of works.slice(0, 2)) {
    const eds = (await getJson(`https://openlibrary.org${w.key}/editions.json?limit=80`)).entries || [];
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

async function googleBooks(title, author) {
  const q = `intitle:"${title}"${author ? ` inauthor:"${author}"` : ''}`;
  const data = await getJson(`https://www.googleapis.com/books/v1/volumes?q=${enc(q)}&maxResults=30&key=${firebaseConfig.apiKey}`);
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

// → { editions: [...], errors: [...] }. The book's own language first, then those with an ISBN.
export async function findEditions(book) {
  const title = String(book.title || '').replace(/:.*$/, '').trim() || book.title;
  const author = book.authors?.[0] || '';
  const errors = [];
  const [ol, gb] = await Promise.all([
    openLibrary(title, author).catch((e) => { errors.push('Open Library: ' + e.message); return []; }),
    googleBooks(title, author).catch((e) => { errors.push('Google Books: ' + e.message); return []; }),
  ]);
  const seen = new Set();
  const all = [...ol, ...gb].filter((e) => {
    const k = e.isbn || e.cover;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const score = (e) => (e.language && e.language === book.language ? 2 : 0) + (e.isbn ? 1 : 0);
  all.sort((a, b) => score(b) - score(a));
  return { editions: all.slice(0, 48), errors };
}

export function imageSearchUrl(book) {
  const q = [book.title, book.authors?.[0], 'book cover'].filter(Boolean).join(' ');
  return `https://www.google.com/search?tbm=isch&q=${enc(q)}`;
}
