// Cleans the old Bookshelf app's CSV export into our Firestore layout.
// Pure functions, no DOM: the import page uses them in the browser and
// the same code is tested in Node against the real export.
//
// cleanExport(csvText) → { books, privates, authors, series, notes }
//   books[]    → books/{id}     (public)
//   privates[] → private/{id}   (readBy, lentTo, notes; members only)
//   authors[]  → authors/{id}   (nationality/gender filled later from Wikidata)
//   series[]   → series/{id}
//   notes[]    → what the cleanup changed or couldn't decide, for the review table

// --- CSV --------------------------------------------------------------------

// RFC 4180: quoted fields may hold commas, quotes ("") and newlines.
export function parseCsv(text) {
  text = text.replace(/^﻿/, '');
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else q = false;
      } else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [head, ...body] = rows.filter((r) => r.some((f) => f.trim()));
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}

// --- Small helpers ------------------------------------------------------------

// Letters NFKD can't take apart: "Stanisław" → "stanislaw", not "stanis-aw".
const FOLD = { ł: 'l', Ł: 'L', ø: 'o', Ø: 'O', đ: 'd', Đ: 'D', ß: 'ss', æ: 'ae', Æ: 'Ae', œ: 'oe', Œ: 'Oe', ı: 'i', þ: 'th', Þ: 'Th' };
export function slug(s) {
  const base = String(s).replace(/[łŁøØđĐßæÆœŒıþÞ]/g, (c) => FOLD[c]).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  if (base) return base;
  // Japanese and other non-Latin names: a short stable hash instead.
  let h = 2166136261;
  for (const ch of String(s)) h = Math.imul(h ^ ch.codePointAt(0), 16777619) >>> 0;
  return 'x' + h.toString(36);
}

const list = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);

// --- Categories -----------------------------------------------------------------

const CATEGORIES = {
  'Ficção': 'Fiction',
  'Não Ficção': 'Non-fiction',
  'Quadrinhos': 'Comics',
  'Referências': 'Reference',
};

// --- Languages ----------------------------------------------------------------

const LANGS = { en: 'en', english: 'en', pt: 'pt', 'pt br': 'pt', br: 'pt', sv: 'sv', nl: 'nl', ja: 'ja' };

// Books the export left blank or marked "un"; decided by title/edition.
const LANG_FIXES = {
  '9781568650029': 'en', // The Chronicles of Amber: Volume II
  '9788574795577': 'pt', // Fazes-me Falta
  '9780380414345': 'en', // Strangeness
  '9786580309313': 'pt', // Torto Arado
  '9780241995457': 'en', // The Chrysalids
  '9781838458577': 'en', // The CRPG Book
};

// --- People ---------------------------------------------------------------------

// The old app garbled some names that came from library catalogues
// ("Last, First" with the comma lost, or a note stuck in the middle).
export function fixName(raw) {
  let n = raw.replace(/\s+/g, ' ').trim();
  // "Henri pseud. för Charles Henri Dewisme. Vernes" → "Henri Vernes"
  // "Ana Paula author. Maia", "Sven universitetslektor. Nilsson" → first + last
  let m = n.match(/^(.+?) (?:pseud\. för .+|author|universitetslektor|[a-zåäö]+)\. (\S+)$/u);
  if (m) return fixName(`${m[1]} ${m[2]}`);
  // "Wyndham. John" → "John Wyndham"
  m = n.match(/^(\p{Lu}[\p{L}'-]+)\. (\p{Lu}[\p{L}'-]+)$/u);
  if (m) return `${m[2]} ${m[1]}`;
  // "Jr. James Tiptree" → "James Tiptree Jr."
  m = n.match(/^(Jr|Sr)\. (.+)$/);
  if (m) return `${m[2]} ${m[1]}.`;
  // Initials: "W.G. Sebald" → "W. G. Sebald" (Wikidata's form)
  n = n.replace(/\b(\p{Lu})\.(?=\p{Lu}\b)/gu, '$1. ');
  return n;
}

// Sort key: surname first. Keeps particles with the surname ("Le Guin", "van Houten").
export function sortName(name) {
  const parts = name.split(' ');
  if (parts.length < 2 || /[぀-ヿ一-鿿]/.test(name)) return name;
  let suffix = '';
  if (/^(Jr\.?|Sr\.?|II|III)$/.test(parts.at(-1))) suffix = ' ' + parts.pop();
  // Brazilian "Junior/Filho/Neto" belong to the surname: "Vieira Junior, Itamar"
  if (/^(Junior|Júnior|Filho|Neto|Sobrinho)$/.test(parts.at(-1)) && parts.length > 2) {
    const tail = parts.pop(); parts[parts.length - 1] += ' ' + tail;
  }
  let i = parts.length - 1;
  while (i > 0 && /^(van|von|de|da|do|dos|das|der|den|le|la|du|di)$/i.test(parts[i - 1])) i--;
  if (i > 0 && /^Le$/.test(parts[i - 1])) i--;
  const last = parts.slice(i).join(' ');
  return `${last}, ${parts.slice(0, i).join(' ')}${suffix}`;
}

const NOT_A_PERSON = new Set(['Various', 'Various Artists', 'Unknown']);

// --- Titles and series ------------------------------------------------------------

const ROMAN = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10 };

// Marketing text some sources append to titles.
const TITLE_JUNK = [/\s*\(Gin Book\)$/, /\s*\(Art Books, Gifts for Artists[^)]*\)$/];

// Old app's series names that differ from the one in the title.
const SERIES_NAMES = { 'Thomas Cromwell Trilogy': 'Thomas Cromwell', 'Commissario Montalbano': 'Montalbano' };

// Portuguese/English words kept lowercase when fixing ALL-CAPS titles.
const SMALL = new Set('a o as os e de da do das dos em no na nos nas um uma por para pela pelo com à ao of the and in on to for an'.split(' '));

function fixCaps(t) {
  if (/\p{Ll}/u.test(t) || t.length < 4) return t;
  return t.toLowerCase().split(' ').map((w, i) =>
    i > 0 && SMALL.has(w) ? w : w.replace(/^(\p{Ll})/u, (c) => c.toUpperCase())).join(' ')
    .replace(/: (\p{Ll})/u, (m, c) => ': ' + c.toUpperCase());
}

// Pulls "(Series, #3)", "(Series #1-2)" and "Vol. 2" out of a title.
export function splitTitle(raw) {
  let title = raw.replace(/\s+/g, ' ').trim();
  let series = null, volume = null, editionNote = null;
  for (const re of TITLE_JUNK) title = title.replace(re, '');
  const m = title.match(/^(.*?)\s*\(([^()]+?),?\s*#\s*([\d.]+(?:\s*[-–]\s*[\d.]+)?)\)$/);
  if (m) {
    title = m[1];
    series = m[2].trim();
    volume = m[3].replace(/\s*[-–]\s*/, '–');
  }
  // "… Omnibus (DM Edition) Vol.2" → volume 2, edition note "DM Edition"
  const v = title.match(/^(.*?)\s*(?:\(([^()]*Edition)\)\s*)?Vol\.\s*(\d+)$/i);
  if (v) {
    title = v[1].replace(/,$/, '');
    if (v[2]) editionNote = v[2];
    series = series || title;
    volume = v[3];
  }
  // "The Chronicles of Amber: Volume II" — the title's own number beats "#1-2"
  const r = title.match(/^(.*?):\s*Volume\s+([IVX]+)$/);
  if (r && ROMAN[r[2]]) { series = series || r[1]; volume = String(ROMAN[r[2]]); }
  return { title: fixCaps(title.trim()), series, volume, editionNote };
}

const PUBLISHER_FIXES = { 'Pan MacMillan': 'Pan Macmillan', 'Chaosium Inc': 'Chaosium Inc.' };

// --- Main ---------------------------------------------------------------------

export function cleanExport(csvText) {
  const rows = parseCsv(csvText);
  const books = [], privates = [], notes = [];
  const authors = new Map(), series = new Map();
  const note = (book, kind, from, to) => notes.push({ bookId: book.id, title: book.title, kind, from, to });

  // Publisher spellings that differ only in case/trailing "s": keep the most common.
  const pubCount = new Map();
  for (const r of rows) if (r.Publisher) pubCount.set(r.Publisher, (pubCount.get(r.Publisher) || 0) + 1);
  const pubKey = (p) => p.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/s$/, '');
  const pubBest = new Map();
  const caps = (p) => !/\p{Ll}/u.test(p);
  for (const [p, n] of pubCount) {
    const k = pubKey(p), cur = pubBest.get(k);
    // Never pick an ALL-CAPS spelling over a normal one; otherwise the most common.
    if (!cur || (caps(cur) && !caps(p)) || (caps(cur) === caps(p) && n > pubCount.get(cur))) pubBest.set(k, p);
  }
  for (const [k, p] of pubBest) if (PUBLISHER_FIXES[p]) pubBest.set(k, PUBLISHER_FIXES[p]);

  function person(rawName, role, book) {
    const name = fixName(rawName);
    if (NOT_A_PERSON.has(name)) return null;
    if (name !== rawName.trim()) note(book, 'name', rawName.trim(), name);
    const id = slug(name);
    if (!authors.has(id)) {
      authors.set(id, { id, name, sortName: sortName(name), nationality: null, gender: null, checked: false, source: null });
    }
    return { role, name, authorId: id };
  }

  for (const r of rows) {
    const id = 'bs' + r['Book Id'];
    const book = { id, title: r.Title };

    // Category
    const catRaw = (r.Bookshelf || '').trim();
    book.category = CATEGORIES[catRaw] || null;
    if (!book.category) note(book, 'category', catRaw, '(none)');

    // Title, series, volume
    const t = splitTitle(r.Title);
    book.title = t.title;
    book.subtitle = r.Subtitle || null;
    if (t.title !== r.Title.trim()) note(book, 'title', r.Title, t.title);
    let sName = (r.Series || '').trim() || t.series;
    if (sName) sName = SERIES_NAMES[sName] || sName;
    // The title's own number wins when it's a range ("#1-3") or a "Volume II".
    const titleWins = t.volume && (t.volume.includes('–') || /:\s*Volume\s+[IVX]+$/.test(t.title));
    const vol = titleWins ? t.volume : (r.Volume || t.volume || null);
    if (sName) {
      const sid = slug(sName);
      if (!series.has(sid)) series.set(sid, { id: sid, name: sName });
      book.seriesId = sid;
      book.seriesName = sName;
      book.volume = vol;
      if (!r.Series) note(book, 'series', '(from title)', `${sName}${vol ? ' #' + vol : ''}`);
    } else {
      book.seriesId = null; book.seriesName = null; book.volume = null;
    }

    // People. Comics name the writer and the artist.
    const comics = book.category === 'Comics';
    book.people = [
      ...list(r.Authors).map((n) => person(n, comics ? 'writer' : 'author', book)),
      ...list(r.Illustrators).map((n) => person(n, comics ? 'artist' : 'illustrator', book)),
      ...list(r.Translators).map((n) => person(n, 'translator', book)),
      ...list(r.Editors).map((n) => person(n, 'editor', book)),
      ...list(r.Photographers).map((n) => person(n, 'photographer', book)),
    ].filter(Boolean);
    const main = book.people.filter((p) => p.role === 'author' || p.role === 'writer');
    book.authors = main.map((p) => p.name); // for search and the grid caption
    book.authorSort = main.length ? authors.get(main[0].authorId).sortName : '';

    // Language
    const langRaw = (r.Language || '').trim();
    book.language = LANG_FIXES[r.ISBN] || LANGS[langRaw.toLowerCase()] || null;
    if (!LANGS[langRaw.toLowerCase()] || LANGS[langRaw.toLowerCase()] !== langRaw) {
      note(book, 'language', langRaw || '(blank)', book.language || '(unknown, ask)');
    }

    // Edition
    book.isbn = r.ISBN || null;
    const pub = r.Publisher ? pubBest.get(pubKey(r.Publisher)) : null;
    if (pub && pub !== r.Publisher) note(book, 'publisher', r.Publisher, pub);
    book.publisher = pub || null;
    const y = (r['Published At'] || '').slice(0, 4);
    book.year = /^\d{4}$/.test(y) && y !== '1970' ? Number(y) : null;
    if (y === '1970') note(book, 'year', r['Published At'], '(none: placeholder date)');
    book.pages = Number(r['Page Count']) || null;
    book.format = r.Format === 'ebook' ? 'ebook' : 'physical';
    book.binding = ['paperback', 'hardcover'].includes(r.Format) ? r.Format : null;
    const ed = (r.Edition || '').trim();
    book.editionNote = [t.editionNote, ed && !/^(1|Main)$/i.test(ed) ? ed : null].filter(Boolean).join(', ') || null;
    book.signed = r.Signed === '1';

    // Extra text from the old sources. Genres are unconfirmed hints for Next read.
    book.description = r.Description || null;
    book.sourceGenres = [...new Set(list(r.Categories))];

    // Bookkeeping
    book.addedAt = r['Date added'] || null;
    book.verified = false;
    book.cover = null; // set by the import page: { id } stored in covers/, or { url } if it can't be copied
    book.legacyId = r['Book Id'];

    // Private: who read it, loans
    const tags = list(r.Tags);
    const readBy = [];
    if (tags.includes('Read (Flor)')) readBy.push('flor');
    if (tags.includes('Read (Ingrid)')) readBy.push('ingrid');
    const lentTo = r['Loan Type'] === 'lent' ? { name: r['Loan Name'].trim(), since: r['Loan Start Date'] || null } : null;
    privates.push({ id, readBy, lentTo, notes: null });

    books.push(book);
  }

  return { books, privates, authors: [...authors.values()], series: [...series.values()], notes };
}
