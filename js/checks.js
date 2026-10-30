// Catalogue checks: things in a book's record that look odd, and near-duplicate
// people and publishers. No DOM and no Firebase, so it can be tested on its own.

// --- Matching ------------------------------------------------------------------------

// Letters NFKD can't take apart, so "Stanisław" and "Stanislaw" match.
const FOLD = { ł: 'l', Ł: 'L', ø: 'o', Ø: 'O', đ: 'd', Đ: 'D', ß: 'ss', æ: 'ae', Æ: 'Ae', œ: 'oe', Œ: 'Oe', ı: 'i', þ: 'th', Þ: 'Th' };
export const fold = (s) => String(s ?? '').replace(/[łŁøØđĐßæÆœŒıþÞ]/g, (c) => FOLD[c])
  .normalize('NFKD').replace(/[̀-ͯ]/g, '');
export const key = (s) => fold(s).toLowerCase().replace(/[^a-z0-9]+/g, '');

function lev(a, b) {
  if (a === b) return 0;
  if (!a.length || !b.length) return a.length || b.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
const nameTokens = (s) => fold(s).toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean);

// Two spellings of one person? "Fiódor Dostoievski" ~ "Fyodor Dostoyevsky",
// "J. R. R. Tolkien" ~ "John Ronald Reuel Tolkien"; "Laura Carvalho" ≁ "Letícia Carvalho".
export function sameName(a, b) {
  const A = nameTokens(a), B = nameTokens(b);
  if (!A.length || !B.length) return false;
  if (A.join('') === B.join('')) return true;
  if (A.length < 2 || B.length < 2) return false;
  const la = A.at(-1), lb = B.at(-1);
  if (lev(la, lb) > (Math.min(la.length, lb.length) >= 7 ? 2 : 1)) return false;
  const fa = A[0], fb = B[0];
  if (fa.length === 1 || fb.length === 1) return fa[0] === fb[0];
  return lev(fa, fb) <= 1;
}

// Publisher names without the words that vary between listings.
const PUB_DROP = new Set(('books book publishing publisher publishers press ltd limited inc incorporated co company '
  + 'uk usa us gb ab group forlag bokforlaget editora publicacoes edicoes 3pl london and e och the').split(' '));
export const pubKey = (p) => fold(p).toLowerCase().replace(/&/g, ' and ').split(/[^a-z0-9]+/)
  .filter((t) => t && !PUB_DROP.has(t)).join('');

// --- Near-duplicates (the People & publishers page) -----------------------------------

const MAIN = (p) => p.role === 'author' || p.role === 'writer';

// Every spelling on the books and in the author records, grouped where they
// look like one person. Each group: [{ name, ids: Set, books: Set }], most-used first.
export function peopleGroups(books, authors) {
  const byName = new Map();
  const add = (name, id, bookId) => {
    if (!name) return;
    if (!byName.has(name)) byName.set(name, { name, ids: new Set(), books: new Set() });
    const e = byName.get(name);
    if (id) e.ids.add(id);
    if (bookId) e.books.add(bookId);
  };
  for (const b of books) for (const p of b.people || []) add(p.name, p.authorId, b.id);
  for (const a of authors) if (byName.has(a.name)) byName.get(a.name).ids.add(a.id);
  const list = [...byName.values()];
  const parent = list.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const shareId = [...list[i].ids].some((x) => list[j].ids.has(x));
      if (shareId || sameName(list[i].name, list[j].name)) parent[find(i)] = find(j);
    }
  }
  const groups = new Map();
  list.forEach((e, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(e); });
  return [...groups.values()].filter((g) => g.length > 1)
    .map((g) => g.sort((x, y) => y.books.size - x.books.size || x.name.localeCompare(y.name)))
    .sort((x, y) => x[0].name.localeCompare(y[0].name));
}

// Author records no book points to any more.
export function unusedAuthors(books, authors) {
  const used = new Set();
  for (const b of books) for (const p of b.people || []) used.add(p.authorId);
  return authors.filter((a) => !used.has(a.id));
}

// Publisher spellings that look like the same publisher: [{ name, books: [ids] }], most-used first.
export function publisherGroups(books) {
  const by = new Map();
  for (const b of books) {
    if (!b.publisher) continue;
    const k = pubKey(b.publisher);
    if (!k) continue;
    if (!by.has(k)) by.set(k, new Map());
    const m = by.get(k);
    if (!m.has(b.publisher)) m.set(b.publisher, []);
    m.get(b.publisher).push(b.id);
  }
  return [...by.values()].filter((m) => m.size > 1)
    .map((m) => [...m].map(([name, ids]) => ({ name, books: ids })).sort((x, y) => y.books.length - x.books.length || x.name.localeCompare(y.name)))
    .sort((x, y) => x[0].name.localeCompare(y[0].name));
}

// The closest existing spelling to a name typed in the edit form, if it's a near
// match but not the same (exact matches, ignoring accents and case, are reused anyway).
export function nearPerson(name, authors) {
  if (!name) return null;
  const k = key(name);
  if (authors.some((a) => key(a.name) === k)) return null;
  return authors.find((a) => sameName(name, a.name))?.name || null;
}
export function nearPublisher(name, publishers) {
  if (!name || publishers.includes(name)) return null;
  const k = pubKey(name);
  return (k && publishers.find((p) => pubKey(p) === k)) || null;
}

// --- Checks on one book ----------------------------------------------------------------

const SMALL = new Set('a an and as at but by for from in into of on or the to with nor'.split(' '));
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// "Stars In My Pocket Like Grains Of Sand" → "Stars in My Pocket Like Grains of Sand"
function smallWords(title) {
  let first = true;
  return title.split(/(\s+)/).map((w) => {
    if (/^\s+$/.test(w)) return w;
    const out = !first && SMALL.has(w.toLowerCase()) ? w.toLowerCase() : w;
    first = /[:—–-]$/.test(w);
    return out;
  }).join('');
}

const SHOP = /\b(best-?sellers?|winner of|prize|deluxe edition|anniversary edition|penguin modern|little black classics|em portugu[eê]s|serieromanen|core rule ?book)\b/i;
const SERIES_WORDS = /^(the )?(book|chronicles|saga|tales|cycle) of (the )?|\b(cycle|saga|series|trilogy|quartet|sequence|omnibus|chronicles)\b/gi;
const NOVEL_HINT = /\b(a novel|romance|roman|novela)\b/i;
const ESSAY_HINT = /\b(essays?|memoirs?|letters|ensaios|a history|lectures?)\b/i;
const FICTION_G = /fiction|novel|fantasy|short stor|thriller|crime|horror|romance|dystopian|space opera/i;
const NONFICTION_G = /non-?fiction|essay|biograph|memoir|histor(y|ical)\b(?!.*fiction)|philosoph|popular science|criticism|literary studies|self-help|travel/i;

// Context for checkBook, built once for the whole library.
export function checkContext(books) {
  const seriesBooks = new Map();
  for (const b of books) if (b.seriesId) { if (!seriesBooks.has(b.seriesId)) seriesBooks.set(b.seriesId, []); seriesBooks.get(b.seriesId).push(b); }
  const pubKeys = new Set(books.map((b) => pubKey(b.publisher)).filter(Boolean));
  return { seriesBooks, pubKeys };
}

// What looks odd about one book: [{ code, msg, fix? }]. `fix` is the fields a
// one-tap fix would write; codes are what "It's fine" remembers (book.oddOk).
export function checkBook(b, cx) {
  const out = [];
  const push = (code, msg, fix) => { if (!(b.oddOk || []).includes(code)) out.push(fix ? { code, msg, fix } : { code, msg }); };
  const title = b.title || '', sub = b.subtitle || '';
  const kt = key(title), ks = key(sub);

  // Title
  let t2 = title.replace(/\s*\((re-?issue|reissue)\)/i, '').replace(/^(.*?),\s*(The|A|An)$/, '$2 $1')
    .replace(/^Great Ideas\s+/, '').replace(/([?!])\.$/, '$1').replace(/_/g, ' ').replace(/\s+:\s+/, ': ').trim();
  if (t2 !== title) push('title', 'The title has catalogue leftovers.', { title: t2 });
  else if ((b.language || 'en') === 'en' && smallWords(title) !== title && title.split(/\s+/).length >= 4) {
    push('caps', 'Every word in the title is capitalised.', { title: smallWords(title) });
  }

  // Subtitle
  if (sub) {
    const parts = title.split(/\s*(?::| - | — )\s*/);
    if (parts.length > 1 && key(parts.slice(1).join(' ')) === ks) {
      push('sub-dup', 'The subtitle is repeated in the title.', { title: parts[0], subtitle: cap(title.slice(parts[0].length).replace(/^\s*(?::| - | — )\s*/, '')) });
    } else if (ks === kt || (ks.length >= 4 && kt.includes(ks))) {
      push('sub-dup', 'The subtitle repeats the title.', { subtitle: null });
    } else if (SHOP.test(sub) || /^[([].*[)\]]$/.test(sub)) {
      push('sub-shop', 'The subtitle looks like shop or catalogue text.', { subtitle: null });
    } else if (/\b(of|and|the|to|in|a)$/i.test(sub)) {
      push('sub-cut', 'The subtitle looks cut off.');
    }
  }

  // People
  const people = b.people || [];
  if (!people.length) push('no-people', 'No author or anyone else listed.');
  const seen = new Map();
  for (const p of people) {
    const n = p.name || '';
    if (/^(unknown|anonymous|various|n\/?a)\b/i.test(n)) {
      push('placeholder:' + p.authorId, `“${n}” is a placeholder.`, { people: people.filter((x) => x !== p), authors: people.filter((x) => x !== p && MAIN(x)).map((x) => x.name) });
      continue;
    }
    if (cx.pubKeys.has(pubKey(n)) || /\b(publishing|books|studios?|editors|press|förlag|editora)\b/i.test(n)) push('company:' + p.authorId, `“${n}” looks like a publisher, not a person.`);
    if (/(^|\s)(I{2,3}|IV)\s/.test(n) || /(\b\p{L}\.?\s+){3,}\p{Lu}[\p{Ll}]/u.test(n) || /(^|\s)(?!(?:Jr|Sr|St|Dr|Mr|Mrs)\.)\p{L}{3,}\.(\s|$)/u.test(n)) {
      push('garbled:' + p.authorId, `“${n}” looks garbled.`);
    }
    if (!seen.has(p.authorId)) seen.set(p.authorId, new Set());
    seen.get(p.authorId).add(p.role);
  }
  for (const [id, roles] of seen) {
    const n = people.find((p) => p.authorId === id)?.name;
    if (roles.has('author') && roles.has('editor')) push('roles:' + id, `${n} is listed as author and editor.`);
    if (roles.has('author') && roles.has('translator')) push('roles:' + id, `${n} is listed as author and translator.`);
  }

  // Category, from what the old sources called it and from the subtitle
  const g = (b.sourceGenres || []).join(' | ');
  if (b.category === 'Non-fiction' && ((FICTION_G.test(g) && !NONFICTION_G.test(g)) || NOVEL_HINT.test(sub))) {
    push('cat', 'Filed as Non-fiction, but it sounds like fiction' + (g ? ` (sources: ${b.sourceGenres.slice(0, 2).join(', ')}).` : '.'), { category: 'Fiction' });
  } else if (b.category === 'Fiction' && ((NONFICTION_G.test(g) && !FICTION_G.test(g)) || ESSAY_HINT.test(sub))) {
    push('cat', 'Filed as Fiction, but it sounds like non-fiction' + (g ? ` (sources: ${b.sourceGenres.slice(0, 2).join(', ')}).` : '.'), { category: 'Non-fiction' });
  }

  // Format
  if (b.format === 'ebook' && (b.binding || b.cover?.source === 'Photo')) push('format', 'Marked as an ebook, but there’s a photo of a printed copy.', { format: 'physical' });
  if (b.format !== 'ebook' && (/\b(digital|ebook|kindle)\b/i.test(b.publisher || '') || /^978(0429|1003)/.test(b.isbn || ''))) push('format', 'A printed copy, but the ISBN or publisher is an ebook’s.');

  // Numbers and gaps
  if (b.pages != null && b.pages <= 4) push('pages', `${b.pages} page${b.pages === 1 ? '' : 's'}?`, { pages: null });
  const miss = [!b.publisher && 'publisher', !b.year && 'edition year'].filter(Boolean);
  if (miss.length) push('missing', `No ${miss.join(' or ')}.`);

  // Series
  const mine = new Set(people.filter(MAIN).map((p) => p.authorId));
  for (const [sid, list] of cx.seriesBooks) {
    if (sid === b.seriesId || list.length < 2) continue;
    if (!list.some((x) => (x.people || []).some((p) => MAIN(p) && mine.has(p.authorId)))) continue;
    const core = key((list[0].seriesName || '').replace(SERIES_WORDS, ' '));
    if (core.length >= 4 && key(title + ' ' + sub).includes(core)) push('series-missing:' + sid, `Looks like part of “${list[0].seriesName}”, but isn’t in it.`);
  }
  if (b.seriesId) {
    const n = cx.seriesBooks.get(b.seriesId)?.length || 0;
    if (n === 1 && key(b.seriesName) === kt) push('series-self', 'A series of one, named after the book.', { seriesId: null, seriesName: null, volume: null });
    else if (n === 1 && /\b(trilogy|quartet|omnibus|complete)\b/i.test(title) && /^\d+$/.test(String(b.volume ?? ''))) push('series-omnibus', `Several volumes in one book, numbered as volume ${b.volume}.`);
  }
  return out;
}
