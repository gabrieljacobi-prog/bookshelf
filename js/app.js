// Bookshelf: library grid and book page, built from the "Bookshelf mockups" canvas.
import { onUser, signIn, signOutUser, watchCatalogue, watchPrivate, coverImage, savePrivate, updateBook, saveCover, saveEdits, newBookId, addBook } from './data.js?v=7';
import { slug, sortName, fixName, splitTitle } from './import-clean.js?v=1';
import { toIsbn13, lookupAll, firstPublished } from './lookup.js?v=12';
import { startScanner, isbnFromPhoto, beep } from './scanner.js?v=2';
import { coverFromUrl, coverFromImage } from './covers.js?v=2';
import { cropImage } from './crop.js?v=3';
import { findEditions, imageSearchUrl, searchBooks } from './editions.js?v=5';

const CATS = ['Fiction', 'Non-fiction', 'Comics', 'Reference'];
const SORTS = [['Author', 'Author'], ['Title', 'Title'], ['Recently added', 'Added'], ['Year', 'Year'], ['Language', 'Language']];
const LANGS = { en: 'English', pt: 'Portuguese', sv: 'Swedish', nl: 'Dutch', ja: 'Japanese' };
const ROLES = { author: 'Author', writer: 'Writer', artist: 'Artist', illustrator: 'Illustrator', translator: 'Translator', editor: 'Editor', photographer: 'Photographer' };
const READERS = [['flor', 'Flor'], ['ingrid', 'Ingrid']];

const store = {
  get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private window */ } },
};

const S = {
  books: new Map(), authors: new Map(), series: new Map(), priv: new Map(),
  loaded: false, user: null,
  cat: 'All', sort: 'Recently added', q: '', searching: false, open: null,
  read: 'any', lent: false, // member-only filters
  theme: ['light', 'dark'].includes(store.get('theme', '')) ? store.get('theme') : 'system',
  cols: store.get('cols', '3') === '4' ? 4 : 3,
  reviewHidden: store.get('reviewHidden', '') === '1',
};

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const norm = (s) => String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();

// --- Icons (stroke, from the mockups) ---------------------------------------------
const I = {
  chev: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>',
  sort: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true" style="color:var(--muted)"><path d="M7 4v16M3.5 16.5L7 20l3.5-3.5M14 6h7M14 11h5M14 16h3"/></svg>',
  search: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>',
  menu: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><path d="M3 9h18M9 15h12"/></svg>',
  x: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  check: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7"/></svg>',
  ring: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" aria-hidden="true"><circle cx="12" cy="12" r="7"/></svg>',
  back: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><path d="M20 12H4M10 6l-6 6 6 6"/></svg>',
  right: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true" style="color:var(--muted)"><path d="M9 6l6 6-6 6"/></svg>',
  lend: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><path d="M4 12h13M12 7l5 5-5 5M20 5v14"/></svg>',
  navLib: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><path d="M5 4v16M9.5 4v16M14 5.5l4.5 14.5M3 20h18"/></svg>',
  navAdd: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v9M7.5 12h9"/></svg>',
  scan: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" aria-hidden="true"><path d="M3 8V5h3M18 5h3v3M21 16v3h-3M6 19H3v-3M7 8v8M9.5 8v8M12 8v8M15 8v8M17 8v8"/></svg>',
  navNext: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><path d="M12 6.5C10 5 7 4.5 3.5 5v13c3.5-.5 6.5 0 8.5 1.5 2-1.5 5-2 8.5-1.5V5C17 4.5 14 5 12 6.5zM12 6.5v13"/></svg>',
};

// --- Helpers --------------------------------------------------------------------------

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { t.hidden = true; }, 2600);
}
const soon = (what) => toast(`${what} isn't built yet. It's next on the list.`);
const fmtDate = (d) => {
  const x = new Date(d);
  return isNaN(x) ? d : x.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};
const today = () => new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD, local
const byLine = (b) => (b.authors || []).join(', ');
const ARTICLE = /^(the|a|an|o|os|as|um|uma|en|ett|den|det|de|het|een|el|la|le|les|il)\s+/;
const titleKey = (b) => norm(b.title).replace(ARTICLE, '');
const volNum = (v) => parseFloat(String(v ?? '').replace(/–.*/, '')) || 0;
const isMember = () => !!S.user?.member;

const READ_FILTERS = [['any', 'Anyone'], ['flor', 'Flor'], ['ingrid', 'Ingrid'], ['both', 'Both'], ['neither', 'Neither']];
function passesFilters(b) {
  if (S.cat !== 'All' && b.category !== S.cat) return false;
  if (!isMember()) return true;
  const p = S.priv.get(b.id) || {};
  const r = p.readBy || [];
  if (S.read === 'flor' && !r.includes('flor')) return false;
  if (S.read === 'ingrid' && !r.includes('ingrid')) return false;
  if (S.read === 'both' && !(r.includes('flor') && r.includes('ingrid'))) return false;
  if (S.read === 'neither' && r.length) return false;
  if (S.lent && !p.lentTo) return false;
  return true;
}
function filterLabel() {
  const parts = [];
  if (S.cat !== 'All') parts.push(S.cat);
  if (isMember() && S.read !== 'any') parts.push(S.read === 'neither' ? 'Unread' : S.read === 'both' ? 'Read by both' : `Read by ${S.read === 'flor' ? 'Flor' : 'Ingrid'}`);
  if (isMember() && S.lent) parts.push('Lent out');
  return parts.join(' · ') || 'All';
}
const otherFilters = () => isMember() && (S.read !== 'any' || S.lent);

function applyTheme() {
  const root = document.documentElement;
  if (S.theme === 'system') delete root.dataset.theme; else root.dataset.theme = S.theme;
  const dark = S.theme === 'dark' || (S.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
    m.removeAttribute('media');
    m.content = dark ? '#2E2B29' : '#EAE5DA';
  });
}
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);

const yr = (b) => b.firstYear ?? b.year ?? null; // when the work came out, else this edition
function compare(sort) {
  const author = (b) => norm(b.authorSort) || '￿';
  const bySeries = (a, b) => norm(a.seriesName).localeCompare(norm(b.seriesName)) || volNum(a.volume) - volNum(b.volume);
  const t = (a, b) => titleKey(a).localeCompare(titleKey(b));
  switch (sort) {
    case 'Title': return t;
    case 'Recently added': return (a, b) => String(b.addedAt || '').localeCompare(String(a.addedAt || '')) || t(a, b);
    case 'Year': return (a, b) => (yr(a) ?? 9999) - (yr(b) ?? 9999) || t(a, b);
    case 'Language': return (a, b) => (LANGS[a.language] || 'zz').localeCompare(LANGS[b.language] || 'zz') || author(a).localeCompare(author(b)) || t(a, b);
    default: return (a, b) => author(a).localeCompare(author(b)) || bySeries(a, b) || (yr(a) ?? 0) - (yr(b) ?? 0) || t(a, b);
  }
}

function matches(b, tokens) {
  if (!tokens.length) return true;
  const hay = norm([b.title, b.subtitle, b.seriesName, b.publisher, b.isbn, ...(b.people || []).map((p) => p.name)].join(' '));
  return tokens.every((t) => hay.includes(t));
}

// --- Library ------------------------------------------------------------------------------

function metrics() {
  const width = Math.min(document.documentElement.clientWidth, 600);
  const n = S.cols, gap = n === 4 ? 12 : 16;
  const W = Math.floor((width - 40 - gap * (n - 1)) / n);
  return { n, gap, W, H: Math.round(W * 1.585) };
}

const shownCovers = new Map(); // cover key → thumb src that has loaded once
function coverBox(b, W, H, cls = '') {
  const r = b.cover?.w && b.cover?.h ? b.cover.w / b.cover.h : 0.66;
  let w = W, h = Math.round(W / r);
  if (h > H) { h = H; w = Math.round(H * r); }
  const size = `width:${w}px;height:${h}px`;
  if (!b.cover) {
    return `<span class="cover ph ${cls}" style="${size}" aria-hidden="true"><span class="pa">${esc(byLine(b))}</span><span class="pt">${esc(b.title)}</span></span>`;
  }
  const key = b.cover.url || `${b.id}@${b.cover.v ?? ''}`;
  const seen = shownCovers.get(key);
  if (seen) return `<span class="cover ${cls}" style="${size}"><img alt="" src="${esc(seen)}"></span>`;
  const src = b.cover.url ? ` data-url="${esc(b.cover.url)}"` : ` data-cid="${esc(b.id)}"`;
  return `<span class="cover loading ${cls}" style="${size}"${src} data-key="${esc(key)}"><img alt="" decoding="async"></span>`;
}

function renderLibrary() {
  const el = $('#library');
  const n = S.books.size;
  const fixN = toFix().length;
  el.innerHTML = `
    <header class="hero">
      <div><div class="count disp">${S.loaded ? n : '&nbsp;'}</div><div class="lbl" style="margin-top:8px">Books</div></div>
      <h1 class="disp">Library</h1>
    </header>
    ${isMember() && fixN && !S.reviewHidden ? `
    <div class="review">
      <button id="reviewGo"><span class="dot"></span><span class="what">${fixN} book${fixN === 1 ? '' : 's'} to fix</span><span class="tap go">To fix</span></button>
      <button class="x icon-btn" id="hideReview" aria-label="Hide (the menu brings it back)">${I.x}</button>
    </div>` : ''}
    <div class="sticky grain" id="sticky">
      <div class="compact"><div style="display:flex;align-items:baseline;gap:8px"><span class="n disp">${n}</span><span class="lbl">Books</span></div><h1 class="disp">Library</h1></div>
      <div class="toolbar" id="toolbar"></div>
    </div>
    <div class="list" id="list"></div>`;
  $('#reviewGo')?.addEventListener('click', () => { location.hash = '#/fix'; });
  $('#hideReview')?.addEventListener('click', () => { S.reviewHidden = true; store.set('reviewHidden', '1'); renderLibrary(); });
  renderToolbar();
  renderList();
  watchStuck();
}

function renderToolbar() {
  const tb = $('#toolbar');
  if (!tb) return;
  if (S.searching) {
    tb.innerHTML = `
      <div class="search">
        <span style="padding:0 6px;color:var(--muted)">${I.search}</span>
        <input id="q" type="search" placeholder="Title, author, series…" value="${esc(S.q)}" aria-label="Search the library" autocomplete="off">
        <button class="icon-btn" id="qx" aria-label="Close search">${I.x}</button>
      </div>`;
    const q = $('#q');
    q.addEventListener('input', () => { S.q = q.value; renderList(); });
    $('#qx').addEventListener('click', () => { S.searching = false; S.q = ''; renderToolbar(); renderList(); });
    q.focus();
    return;
  }
  const sortShort = (SORTS.find(([l]) => l === S.sort) || [S.sort, S.sort])[1];
  const items = (list, cur, key) => list.map(([label]) => `<button role="menuitemradio" aria-checked="${label === cur}" data-${key}="${esc(label)}">${esc(label)}${label === cur ? I.check : ''}</button>`).join('');
  const u = S.user;
  tb.innerHTML = `
    <div class="dd">
      <button class="tap" data-open="cat" aria-haspopup="true" aria-expanded="${S.open === 'cat'}" aria-label="Show: ${esc(filterLabel())}"><span class="cur">${esc(filterLabel())}</span>${I.chev}</button>
      ${S.open === 'cat' ? `<div class="menu" role="menu" aria-label="Show">
        <div class="mh lbl">Category</div>
        ${items([['All'], ...CATS.map((c) => [c])], S.cat, 'cat')}
        ${isMember() ? `
        <div class="mh lbl">Read by</div>
        ${READ_FILTERS.map(([k, label]) => `<button role="menuitemradio" aria-checked="${S.read === k}" data-rf="${k}">${label}${S.read === k ? I.check : ''}</button>`).join('')}
        <div class="mh lbl">Loans</div>
        <button role="menuitemcheckbox" aria-checked="${S.lent}" data-lentf="1">Lent out${S.lent ? I.check : ''}</button>` : ''}
      </div>` : ''}
    </div>
    <span class="sep" aria-hidden="true"></span>
    <div class="dd">
      <button class="tap" data-open="sort" aria-haspopup="true" aria-expanded="${S.open === 'sort'}" aria-label="Sort by ${esc(S.sort)}">${I.sort}<span>${esc(sortShort)}</span>${I.chev}</button>
      ${S.open === 'sort' ? `<div class="menu" role="menu" aria-label="Sort by">${items(SORTS, S.sort, 'sort')}</div>` : ''}
    </div>
    <span class="grow"></span>
    <button class="icon-btn" id="openSearch" aria-label="Search">${I.search}</button>
    <div class="dd">
      <button class="icon-btn" data-open="menu" aria-haspopup="true" aria-expanded="${S.open === 'menu'}" aria-label="Menu">${I.menu}</button>
      ${S.open === 'menu' ? `<div class="menu right" role="menu">
        <div class="mh lbl">Books per row</div>
        ${[[3, 'Three'], [4, 'Four']].map(([n, l]) => `<button role="menuitemradio" aria-checked="${S.cols === n}" data-cols="${n}">${l}${S.cols === n ? I.check : ''}</button>`).join('')}
        <div class="mh lbl">Theme</div>
        ${[['system', 'Same as phone'], ['light', 'Light'], ['dark', 'Dark']].map(([k, l]) => `<button role="menuitemradio" aria-checked="${S.theme === k}" data-theme-pick="${k}">${l}${S.theme === k ? I.check : ''}</button>`).join('')}
        <div class="mh lbl">Account</div>
        ${u ? `<div class="note" style="border-top:0">Signed in as ${esc(u.member ? READERS.find(([k]) => k === u.member)[1] : u.email)}${u.member ? '' : '. This account can only browse.'}</div><button data-act="signout">Sign out</button>`
          : '<button data-act="signin">Sign in</button>'}
        ${isMember() ? `
        <div class="mh lbl">Checking books</div>
        <button data-go="#/fix">To fix</button>
        ${S.reviewHidden ? '<button data-act="showReview">Show the reminder bar</button>' : ''}` : ''}
        <div class="mh lbl">Temporary tools</div>
        <a href="import/" class="tool">Import</a>
        <a href="scan/" class="tool">Scanner test</a>
      </div>` : ''}
    </div>`;
}

function renderList() {
  const list = $('#list');
  if (!list) return;
  if (!S.loaded) { list.innerHTML = '<p class="empty">Opening the library…</p>'; return; }
  const m = metrics();
  list.style.cssText = `--cols:${m.n};--gap:${m.gap}px;--H:${m.H}px;` + (m.n === 4
    ? '--capT:11px;--capA:10px;--phA:7px;--phT:10px;--phPad:6px 6px 7px;'
    : '--capT:12px;--capA:11px;--phA:9px;--phT:13px;--phPad:9px 8px 10px;');
  const tokens = norm(S.q).split(/\s+/).filter(Boolean);
  const cmp = compare(S.sort);
  const books = [...S.books.values()].filter((b) => passesFilters(b) && matches(b, tokens)).sort(cmp);
  if (!books.length) {
    list.innerHTML = `<p class="empty">${tokens.length || otherFilters() || S.cat !== 'All' ? 'Nothing on the shelves matches that.' : 'No books here yet.'}</p>`;
    return;
  }
  const rows = [];
  for (let j = 0; j < books.length; j += m.n) rows.push(books.slice(j, j + m.n));
  // A category gets its numbered heading ("03 Comics"); "All" is one continuous
  // shelf, so a sort like Recently added mixes the categories.
  const ci = CATS.indexOf(S.cat);
  const filtered = ci >= 0 || otherFilters() || tokens.length;
  const head = ci >= 0
    ? `<div class="section-head"><span class="num disp">${String(ci + 1).padStart(2, '0')}</span><span class="name">${esc(filterLabel())}</span><span class="of">${books.length}</span></div>`
    : filtered ? `<div class="section-head"><span class="name">${esc(tokens.length ? 'Search results' : filterLabel())}</span><span class="of">${books.length}</span></div>`
    : '<div style="height:24px"></div>';
  const html = `
    <section class="section">
      ${head}
      <div class="rows">${rows.map((row) => `
        <div>
          <div class="shelf">${row.map((b) => `<a href="#/book/${esc(b.id)}" aria-label="${esc(b.title)}${b.authors?.length ? ' by ' + esc(byLine(b)) : ''}">${coverBox(b, m.W, m.H)}</a>`).join('')}</div>
          <div class="caps">${row.map((b) => `<a href="#/book/${esc(b.id)}" tabindex="-1" aria-hidden="true"><div class="t">${esc(b.title)}</div><div class="a">${esc(byLine(b))}</div></a>`).join('')}</div>
        </div>`).join('')}
      </div>
    </section>`;
  list.innerHTML = html;
  observeCovers(list);
}

// Covers load as they come near the screen.
const io = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
  for (const e of entries) if (e.isIntersecting) { io.unobserve(e.target); loadCover(e.target, 'thumb'); }
}, { rootMargin: '800px 0px' }) : null;

function observeCovers(root) {
  root.querySelectorAll('.cover[data-cid], .cover[data-url]').forEach((el) => (io ? io.observe(el) : loadCover(el, 'thumb')));
}

async function loadCover(el, size) {
  const img = el.querySelector('img');
  if (!img) return;
  img.onload = () => { el.classList.remove('loading'); if (size === 'thumb' && el.dataset.key) shownCovers.set(el.dataset.key, img.src); };
  img.onerror = () => el.classList.remove('loading');
  if (el.dataset.url) { img.src = el.dataset.url; return; }
  try {
    const src = await coverImage(el.dataset.cid, size, S.books.get(el.dataset.cid));
    if (src) img.src = src;
    else el.classList.remove('loading');
  } catch { el.classList.remove('loading'); }
}

// Compact header once the big one has scrolled away.
let stuckObs;
function watchStuck() {
  stuckObs?.disconnect();
  const hero = $('.hero'), sticky = $('#sticky');
  if (!hero || !sticky || !('IntersectionObserver' in window)) return;
  stuckObs = new IntersectionObserver(([e]) => sticky.classList.toggle('is-stuck', !e.isIntersecting));
  stuckObs.observe(hero);
}

document.addEventListener('click', async (e) => {
  const t = e.target.closest('button, a');
  if (!t || !$('#library').contains(t)) {
    if (S.open && !e.target.closest('.menu')) { S.open = null; renderToolbar(); }
    return;
  }
  if (t.tagName === 'A' && t.closest('.menu')) { S.open = null; return; }
  if (t.dataset.open) { S.open = S.open === t.dataset.open ? null : t.dataset.open; renderToolbar(); return; }
  if (t.dataset.cat) { S.cat = t.dataset.cat; renderToolbar(); renderList(); return; }
  if (t.dataset.rf) { S.read = t.dataset.rf; renderToolbar(); renderList(); return; }
  if (t.dataset.lentf) { S.lent = !S.lent; renderToolbar(); renderList(); return; }
  if (t.dataset.themePick) { S.theme = t.dataset.themePick; store.set('theme', S.theme); applyTheme(); renderToolbar(); return; }
  if (t.dataset.sort) { S.sort = t.dataset.sort; S.open = null; renderToolbar(); renderList(); return; }
  if (t.id === 'openSearch') { S.searching = true; S.open = null; renderToolbar(); return; }
  if (t.dataset.cols) { S.cols = Number(t.dataset.cols); store.set('cols', String(S.cols)); renderToolbar(); renderList(); return; }
  if (t.dataset.act === 'signin') { S.open = null; renderToolbar(); signIn().catch((err) => toast(err.message)); return; }
  if (t.dataset.act === 'signout') { S.open = null; signOutUser(); return; }
  if (t.dataset.go) { S.open = null; location.hash = t.dataset.go; return; }
  if (t.dataset.act === 'showReview') { S.open = null; S.reviewHidden = false; store.set('reviewHidden', ''); renderLibrary(); return; }
  if (S.open && !t.closest('.menu')) { S.open = null; renderToolbar(); }
});

// Only a change of width changes the grid. On a phone the browser's address bar
// sliding away while scrolling also counts as a resize (height only); redrawing
// the grid then made every cover blank and fade back in.
let resizeT, gridWidth = document.documentElement.clientWidth;
window.addEventListener('resize', () => {
  clearTimeout(resizeT);
  resizeT = setTimeout(() => {
    const w = document.documentElement.clientWidth;
    if (w === gridWidth) return;
    gridWidth = w;
    if (!$('#library').hidden) renderList();
  }, 150);
});

// --- Book page ------------------------------------------------------------------------------

const lendUI = new Map(); // bookId → 'form' while the lend form is open

function renderBook(id) {
  const el = $('#book');
  const b = S.books.get(id);
  if (!b) {
    el.innerHTML = `<div class="book-top"><a class="back tap" href="#/">${I.back}Library</a></div><p class="empty">${S.loaded ? 'This book isn\'t in the library.' : 'Opening…'}</p>`;
    return;
  }
  const member = isMember();
  const p = S.priv.get(id) || {};
  const readBy = p.readBy || [];
  const people = b.people || [];
  const translators = people.filter((x) => x.role === 'translator').map((x) => x.name);

  // Cover on its plinth: fit a 220 × 300 box, never cropped.
  const r = b.cover?.w ? b.cover.w / b.cover.h : 0.66;
  let cw = 220, chh = Math.round(220 / r);
  if (chh > 300) { chh = 300; cw = Math.round(300 * r); }
  const coverHtml = !b.cover
    ? `<span class="cover ph" style="width:${cw}px;height:${chh}px" role="img" aria-label="No cover yet for ${esc(b.title)}"><span class="pa">${esc(byLine(b))}</span><span class="pt">${esc(b.title)}</span></span>`
    : `<span class="cover loading" style="width:${cw}px;height:${chh}px"${b.cover.url ? ` data-url="${esc(b.cover.url)}"` : ` data-cid="${esc(b.id)}"`}><img alt="Cover of ${esc(b.title)}"></span>`;

  const editionNote = [b.editionNote, b.signed ? 'Signed' : null].filter(Boolean).join(', ');
  const format = b.format === 'ebook' ? 'Ebook' : b.binding ? b.binding[0].toUpperCase() + b.binding.slice(1) : 'Physical';
  const edition = [
    ['Publisher', b.publisher], ['This edition', b.year], ['Edition note', editionNote],
    ['Language', LANGS[b.language] || b.language], ['Format', format], ['Pages', b.pages], ['ISBN', b.isbn],
  ].filter(([, v]) => v);

  const seriesRow = b.seriesName ? `
    <a class="series" href="#/?q=${encodeURIComponent(b.seriesName)}">
      ${b.volume ? `<span class="lbl">Volume ${esc(b.volume)}</span>` : ''}
      <span class="s">${esc(b.seriesName)}</span>${I.right}
    </a>` : '';

  const readers = member ? `
    <div class="readers">${READERS.map(([k, name]) => {
      const on = readBy.includes(k);
      return `<button data-read="${k}" aria-pressed="${on}"><span class="lbl" style="display:block">${name}</span><span class="st">${on ? I.check : I.ring}<span>${on ? 'Read' : 'Not yet'}</span></span></button>`;
    }).join('')}</div>` : '';

  let lending = '';
  if (member) {
    const other = S.user.member === 'flor' ? 'Ingrid' : 'Flor';
    if (p.lentTo) {
      lending = `<div class="lend"><div class="card ch12"><div class="ch12i">
        <div style="flex:1;min-width:0"><div class="lbl">Lent to</div><div class="who">${esc(p.lentTo.name)}</div>${p.lentTo.since ? `<div class="since">Since ${esc(fmtDate(p.lentTo.since))}</div>` : ''}</div>
        <button class="btn-ink tap ch8" id="returned">Returned</button>
      </div></div></div>`;
    } else if (lendUI.get(id) === 'form') {
      const past = [...new Set([...S.priv.values()].flatMap((x) => [x.lentTo?.name, ...(x.lendHistory || []).map((h) => h.name)]).filter(Boolean))].sort();
      lending = `<div class="lend"><form class="card ch12" id="lendForm"><div class="ch12i">
        <label for="borrower" class="lbl">Lend to</label>
        <input id="borrower" type="text" placeholder="Name" autocomplete="off" required>
        ${past.length ? `<div class="past"><span class="lbl">Lent before</span>${past.map((n) => `<button type="button" class="chip ch6" data-name="${esc(n)}"><span class="ch6i">${esc(n)}</span></button>`).join('')}</div>` : ''}
        <div class="muted" style="font-size:14px">Dated today. Only you and ${other} see loans.</div>
        <div class="acts"><button type="button" class="cancel tap" id="cancelLend">Cancel</button><button type="submit" class="btn-ink tap ch8" style="padding:0 26px">Lend</button></div>
      </div></form></div>`;
    } else {
      lending = `<div class="lend"><button class="btn-line ch8" id="openLend" style="width:100%;height:56px"><span class="ch8i tap">${I.lend}Lend this book</span></button></div>`;
    }
  }

  const initials = (name) => /[぀-ヿ一-鿿]/.test(name) ? name[0]
    : name.split(/[\s.]+/).filter(Boolean).map((w) => w[0]).filter((c) => /\p{Lu}/u.test(c)).slice(0, 3).join('') || name[0];
  const peopleHtml = people.map((x) => {
    const a = S.authors.get(x.authorId) || {};
    const meta = [a.nationality, a.gender, a.checked ? 'checked' : null].filter(Boolean).join(' · ');
    return `<div class="person">
      <div class="arch" aria-hidden="true">${esc(initials(x.name))}</div>
      <div style="flex:1;min-width:0"><div class="lbl">${ROLES[x.role] || x.role}</div><div class="nm">${esc(x.name)}</div><div class="meta">${meta ? esc(meta) : 'Not looked up yet'}</div></div>
    </div>`;
  }).join('');

  el.innerHTML = `
    <div class="book-top"><a class="back tap" href="${backTo.href}" id="back">${I.back}${backTo.label}</a>${member ? `<a class="icon-btn" href="#/book/${esc(id)}/edit" aria-label="Edit book"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg></a>` : ''}</div>
    <section class="plinth">
      ${coverHtml}
      <div class="line" aria-hidden="true"></div>
      <div class="check lbl">${b.verified ? `${I.check}Edition checked` : b.needsFix ? '<span class="dot"></span>Marked as the wrong edition' : '<span class="dot"></span>Edition not checked yet'}</div>
    </section>
    ${fixPanelHtml(b)}
    <section class="intro">
      ${b.category ? `<div class="lbl">${esc(b.category)}</div>` : ''}
      <h1 class="disp${b.title.length > 22 ? ' long' : ''}">${esc(b.title)}</h1>
      ${b.subtitle ? `<p class="subtitle">${esc(b.subtitle)}</p>` : ''}
      ${b.authors?.length ? `<div class="by">${esc(byLine(b))}</div>` : ''}
      ${translators.length ? `<p class="tr">Translated by ${esc(translators.join(' and '))}</p>` : ''}
      ${b.firstYear ? `<p class="tr">First published ${b.firstYear < 0 ? `${-b.firstYear} BC` : b.firstYear}</p>` : ''}
      ${seriesRow}
    </section>
    ${readers}
    ${lending}
    <section class="block">
      <h2 class="disp">The edition</h2>
      <dl>${edition.map(([k, v]) => `<div><dt class="lbl">${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
    </section>
    ${people.length ? `<section class="block" style="padding-bottom:40px"><h2 class="disp">The people</h2><div class="people">${peopleHtml}</div></section>` : ''}`;

  // Large cover: show the grid thumb at once, swap in the big one when it arrives.
  const c = el.querySelector('.cover[data-cid]');
  if (c) {
    loadCover(c, 'thumb');
    coverImage(b.id, 'large', b).then((src) => { if (src) c.querySelector('img').src = src; }).catch(() => {});
  }
  const cu = el.querySelector('.cover[data-url]');
  if (cu) loadCover(cu, 'thumb');

  wireFixPanel(el, id);

  // Read status
  el.querySelectorAll('[data-read]').forEach((btn) => btn.addEventListener('click', async () => {
    const k = btn.dataset.read;
    const before = S.priv.get(id) || { readBy: [] };
    const next = before.readBy?.includes(k) ? before.readBy.filter((x) => x !== k) : [...(before.readBy || []), k];
    S.priv.set(id, { ...before, readBy: next });
    renderBook(id);
    try { await savePrivate(id, { readBy: next }); }
    catch (err) { S.priv.set(id, before); renderBook(id); toast('Couldn\'t save: ' + err.message); }
  }));

  // Lending
  $('#openLend', el)?.addEventListener('click', () => { lendUI.set(id, 'form'); renderBook(id); $('#borrower')?.focus(); });
  $('#cancelLend', el)?.addEventListener('click', () => { lendUI.delete(id); renderBook(id); });
  el.querySelectorAll('[data-name]').forEach((chip) => chip.addEventListener('click', () => { $('#borrower').value = chip.dataset.name; }));
  $('#lendForm', el)?.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const name = $('#borrower').value.trim();
    if (!name) return;
    const before = S.priv.get(id) || {};
    const lentTo = { name, since: today() };
    S.priv.set(id, { ...before, lentTo });
    lendUI.delete(id);
    renderBook(id);
    try { await savePrivate(id, { lentTo }); }
    catch (err) { S.priv.set(id, before); renderBook(id); toast('Couldn\'t save: ' + err.message); }
  });
  $('#returned', el)?.addEventListener('click', async () => {
    const before = S.priv.get(id) || {};
    const lendHistory = [...(before.lendHistory || []), { ...before.lentTo, returned: today() }];
    S.priv.set(id, { ...before, lentTo: null, lendHistory });
    renderBook(id);
    try { await savePrivate(id, { lentTo: null, lendHistory }); }
    catch (err) { S.priv.set(id, before); renderBook(id); toast('Couldn\'t save: ' + err.message); }
  });
}

const toFix = () => [...S.books.values()].filter((b) => b.needsFix || !b.cover);

// --- To fix ----------------------------------------------------------------------------------

function renderFixList() {
  const el = $('#fix');
  if (!isMember()) {
    el.innerHTML = `<div class="page-top"><a class="back tap" href="#/">${I.back}Library</a></div><p class="empty">Sign in from the library menu to fix books.</p>`;
    return;
  }
  const all = toFix().sort(compare('Author'));
  const wrong = all.filter((b) => b.needsFix);
  const noCover = all.filter((b) => !b.needsFix && !b.cover);
  const row = (b) => `
    <a class="fix-row" href="#/book/${esc(b.id)}">
      <span class="cv">${coverBox(b, 44, 66)}</span>
      <span style="flex:1;min-width:0"><span class="tt" style="display:block">${esc(b.title)}</span><span class="sub" style="display:block">${esc([byLine(b), b.publisher, b.year].filter(Boolean).join(' · '))}</span></span>
      ${I.right}
    </a>`;
  el.innerHTML = `
    <div class="page-top"><a class="back tap" href="#/">${I.back}Library</a></div>
    <header class="page-head"><h1 class="disp">To fix</h1>
      <p>${all.length ? 'Open a book to find the right edition, pick another cover, or take a photo of yours.' : 'Nothing to fix.'}</p></header>
    ${wrong.length ? `<div class="section-head" style="padding-top:12px"><span class="name">Wrong edition</span><span class="of">${wrong.length}</span></div><div class="fix-list">${wrong.map(row).join('')}</div>` : ''}
    ${noCover.length ? `<div class="section-head"><span class="name">No cover</span><span class="of">${noCover.length}</span></div><div class="fix-list">${noCover.map(row).join('')}</div>` : ''}
    <div style="height:40px"></div>`;
  observeCovers(el);
}

// --- Fix panel (book page) -------------------------------------------------------------------

const fixState = new Map(); // bookId → { open, loading, results, errors, pick, busy, status }

function fixPanelHtml(b) {
  if (!isMember()) return '';
  const st = fixState.get(b.id) || {};
  const needs = b.needsFix || !b.cover;
  if (!needs && b.verified && !st.open) return '';
  if (!needs && !st.open) {
    return `<div class="fixp ch12"><div class="ch12i q">
      <span class="what">Is this your copy's edition?</span>
      <button class="btn-ink tap ch8" data-fx="yes" style="height:44px;padding:0 20px">Yes</button>
      <button class="btn-line ch8" data-fx="no" style="height:44px"><span class="ch8i tap" style="padding:0 18px">No</span></button>
    </div></div>`;
  }
  const eds = st.results || [];
  return `<div class="fixp ch12"><div class="ch12i">
    <h3>${!b.cover && !b.needsFix ? 'Find a cover' : 'Find the right edition'}</h3>
    <p class="hint">Search other editions, look on Google Images (save the picture, then use Photo), or photograph your copy and drag the corners onto the cover's. For books with many editions, add what's printed in your copy.</p>
    <div class="refine">
      <div class="fr"><label class="lbl" for="fx-pub">Publisher</label><input id="fx-pub" value="${esc(st.pub || '')}" placeholder="e.g. Penguin" autocomplete="off"></div>
      <div class="fr"><label class="lbl" for="fx-year">Year</label><input id="fx-year" value="${esc(st.year || '')}" inputmode="numeric" maxlength="4" autocomplete="off"></div>
      <div class="fr wide"><label class="lbl" for="fx-isbn">Or the ISBN from the copyright page</label><input id="fx-isbn" value="${esc(st.isbn || '')}" inputmode="numeric" autocomplete="off"></div>
    </div>
    <div class="acts">
      <button class="btn-line ch8" data-fx="search"${st.loading || st.busy ? ' disabled' : ''}><span class="ch8i tap">${st.results ? 'Search again' : 'Search editions'}</span></button>
      <a class="btn-line ch8" href="${esc(imageSearchUrl(b))}" target="_blank" rel="noopener" style="height:44px;text-decoration:none"><span class="ch8i tap" style="padding:0 14px">Google Images</span></a>
      <label class="btn-line ch8" style="height:44px;cursor:pointer"><span class="ch8i tap" style="padding:0 14px">Photo</span><input type="file" accept="image/*" data-fx="photo" hidden></label>
    </div>
    ${st.status ? `<p class="status" role="status">${esc(st.status)}</p>` : ''}
    ${eds.length ? `<div class="eds">${eds.map((e, i) => `
      <button data-ed="${i}" aria-pressed="${st.pick === i}">
        <span class="im"><img src="${esc(e.thumb)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.closest('button').remove()"></span>
        <span class="m">${esc([e.publisher, e.year, LANGS[e.language] || e.language].filter(Boolean).join(' · ') || e.source)}</span>
      </button>`).join('')}</div>` : ''}
    ${st.pick != null && eds[st.pick] ? `<div class="pickbar">
      <button class="btn-ink tap ch8" data-fx="use" style="height:44px"${st.busy ? ' disabled' : ''}>Use this edition</button>
      <button class="btn-line ch8" data-fx="coveronly" style="height:44px"${st.busy ? ' disabled' : ''}><span class="ch8i tap">Cover only</span></button>
    </div>
    <p class="hint" style="margin:8px 0 0">"Use this edition" also takes its ISBN, publisher and year.</p>` : ''}
    ${b.needsFix ? `<button class="ok tap" data-fx="right">It's right after all</button>` : ''}
  </div></div>`;
}

function setFix(id, patch) {
  fixState.set(id, { ...(fixState.get(id) || {}), ...patch });
  renderBook(id);
}

async function finishFix(id, fields, msg) {
  const b = S.books.get(id);
  Object.assign(b, fields, { verified: true, needsFix: false });
  fixState.delete(id);
  renderBook(id);
  toast(msg);
}

function wireFixPanel(el, id) {
  const b = S.books.get(id);
  el.querySelectorAll('[data-fx]').forEach((x) => {
    const act = x.dataset.fx;
    if (act === 'photo') {
      x.addEventListener('change', async () => {
        const file = x.files?.[0];
        x.value = '';
        if (!file) return;
        let img;
        try { img = await cropImage(file); }
        catch (e) { setFix(id, { status: 'Couldn\'t open that image: ' + e.message }); return; }
        if (!img) return;
        setFix(id, { busy: true, status: 'Saving your photo…' });
        try {
          const c = coverFromImage(img, 'Photo');
          const v = await saveCover(id, c, { verified: true, needsFix: false });
          finishFix(id, { cover: { id, w: c.w, h: c.h, source: c.source, v } }, 'Cover saved.');
        } catch (e) { setFix(id, { busy: false, status: 'Couldn\'t save the photo: ' + e.message }); }
      });
      return;
    }
    x.addEventListener('click', async () => {
      const st = fixState.get(id) || {};
      if (act === 'yes') {
        try { await updateBook(id, { verified: true, needsFix: false }); finishFix(id, {}, 'Marked as checked.'); }
        catch (e) { toast('Couldn\'t save: ' + e.message); }
      } else if (act === 'no') {
        b.needsFix = true;
        setFix(id, { open: true });
        updateBook(id, { needsFix: true }).catch((e) => toast('Couldn\'t save: ' + e.message));
      } else if (act === 'right') {
        try { await updateBook(id, { verified: true, needsFix: false }); finishFix(id, {}, 'Marked as checked.'); }
        catch (e) { toast('Couldn\'t save: ' + e.message); }
      } else if (act === 'search') {
        const pub = $('#fx-pub').value.trim(), yr = $('#fx-year').value.trim(), isbn = $('#fx-isbn').value.trim();
        const opts = { publisher: pub || null, year: /^\d{4}$/.test(yr) ? Number(yr) : null, isbn: isbn || null };
        setFix(id, { open: true, loading: true, pick: null, pub, year: yr, isbn, status: isbn ? 'Looking up that ISBN…' : pub || yr ? 'Looking through the editions…' : 'Looking for other editions…' });
        const { editions, errors, exact } = await findEditions(b, opts);
        const what = [pub, yr].filter(Boolean).join(', ');
        setFix(id, {
          loading: false, results: editions, pick: exact && editions.length === 1 ? 0 : null,
          status: editions.length
            ? (exact ? `Found that edition. ${editions.length > 1 ? 'Pick the best of its covers.' : 'Check the cover, then use it.'}`
              : `${editions.length} edition${editions.length === 1 ? '' : 's'} with a cover${what ? ` matching ${what}` : ''}. Tap the one that matches your copy.`)
            : `${exact || isbn ? 'Nothing found for that ISBN' : `No editions with a cover found${what ? ` matching ${what}` : ''}`}${errors.length ? ` (${errors.join('; ')})` : ''}. ${what ? 'Try without the year, or a shorter publisher name. ' : ''}Or try Google Images or a photo.`,
        });
      } else if (act === 'use' || act === 'coveronly') {
        const e = st.results?.[st.pick];
        if (!e) return;
        setFix(id, { busy: true, status: 'Saving…' });
        const details = act === 'use' ? Object.fromEntries(Object.entries({
          isbn: e.isbn, publisher: e.publisher, year: e.year ? Number(e.year) : null, language: e.language,
        }).filter(([, v]) => v)) : {};
        try {
          const c = await coverFromUrl(e.cover, e.source);
          let cover;
          if (c.mode === 'copied') {
            const v = await saveCover(id, c, { ...details, verified: true, needsFix: false });
            cover = { id, w: c.w, h: c.h, source: c.source, v };
          } else {
            cover = { url: c.url, w: c.w, h: c.h, source: c.source };
            await updateBook(id, { cover, ...details, verified: true, needsFix: false });
          }
          finishFix(id, { cover, ...details }, act === 'use' ? 'Edition and cover saved.' : 'Cover saved.');
        } catch (err) { setFix(id, { busy: false, status: 'Couldn\'t use that one: ' + err.message }); }
      }
    });
  });
  el.querySelectorAll('[data-ed]').forEach((x) => x.addEventListener('click', () => setFix(id, { pick: Number(x.dataset.ed) })));
}

// --- Edit a book -------------------------------------------------------------------------------
// Everything about the edition and the people. New names get an author record
// (nationality and gender come later from Wikidata); new series get a series record.

const EDIT_ROLES = ['author', 'writer', 'artist', 'illustrator', 'translator', 'editor', 'photographer'];
const EDIT_LANGS = [['en', 'English'], ['pt', 'Portuguese'], ['sv', 'Swedish'], ['nl', 'Dutch'], ['ja', 'Japanese'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['it', 'Italian']];
const editDraft = new Map(); // bookId → people rows while editing

function renderEdit(id) {
  const el = $('#book');
  const isNew = id === NEW;
  const b = bookOf(id);
  const backHref = isNew ? '#/add' : `#/book/${esc(id)}`;
  if (!b || !isMember()) {
    el.innerHTML = `<div class="book-top"><a class="back tap" href="${backHref}">${I.back}${isNew ? 'Add book' : 'Book'}</a></div><p class="empty">${!isMember() ? `Sign in from the library menu to ${isNew ? 'add' : 'edit'} books.` : isNew ? 'Start from Add book.' : S.loaded ? 'This book isn\'t in the library.' : 'Opening…'}</p>`;
    return;
  }
  if (!editDraft.has(id)) {
    const rows = (b.people || []).map((p) => ({ ...p }));
    editDraft.set(id, rows.length || !isNew ? rows : [{ role: 'author', name: '' }]);
  }
  const people = editDraft.get(id);
  const opt = (v, label, cur) => `<option value="${esc(v)}"${String(cur ?? '') === String(v) ? ' selected' : ''}>${esc(label)}</option>`;
  const fmt = b.format === 'ebook' ? 'ebook' : b.binding || 'physical';
  const langKnown = !b.language || EDIT_LANGS.some(([k]) => k === b.language);
  const publishers = [...new Set([...S.books.values()].map((x) => x.publisher).filter(Boolean))].sort();
  const seriesNames = [...S.series.values()].map((x) => x.name).sort();
  const names = [...S.authors.values()].map((x) => x.name).sort();
  const field = (label, name, value, extra = '') => `
    <div class="fr"><label class="lbl" for="f-${name}">${label}</label><input id="f-${name}" name="${name}" value="${esc(value ?? '')}" autocomplete="off" ${extra}></div>`;

  el.innerHTML = `
    <div class="book-top"><a class="back tap" href="${backHref}">${I.back}${isNew ? 'Back' : 'Cancel'}</a></div>
    <header class="page-head"><h1 class="disp">${isNew ? 'Add' : 'Edit'}</h1><p>${isNew ? (b.title ? `Check what came with the ISBN against your copy, add what's missing, then Save.` : 'Fill in what\'s printed in your copy. Title and category are enough to start.') : esc(b.title)}</p></header>
    <form class="editf" id="editForm" novalidate>
      <section class="block" id="editCover">${editCoverHtml(b)}</section>
      <section class="block">
        <h2 class="disp">The book</h2>
        ${field('Title', 'title', b.title, 'required')}
        ${field('Subtitle', 'subtitle', b.subtitle)}
        <div class="fr"><label class="lbl" for="f-category">Category</label><select id="f-category" name="category">${isNew ? opt('', 'Choose…', b.category || '') : ''}${CATS.map((c) => opt(c, c, b.category)).join('')}</select></div>
        ${field('Series', 'seriesName', b.seriesName, 'list="dl-series"')}
        ${field('Volume', 'volume', b.volume, 'inputmode="decimal" style="max-width:120px"')}
        <div class="fr"><label class="lbl" for="f-firstYear">First published</label>
          <div class="fy"><input id="f-firstYear" name="firstYear" value="${esc(b.firstYear ?? '')}" autocomplete="off" inputmode="numeric" maxlength="4" style="max-width:120px">
          <button type="button" class="tap" id="fyLook">Look up</button><span class="hint" id="fyNote" style="margin:0"></span></div></div>
      </section>
      <section class="block">
        <h2 class="disp">The edition</h2>
        ${field('Publisher', 'publisher', b.publisher, 'list="dl-pub"')}
        ${field('This edition', 'year', b.year, 'inputmode="numeric" maxlength="4" style="max-width:120px"')}
        <div class="fr"><label class="lbl" for="f-language">Language</label><select id="f-language" name="language">${opt('', '—', b.language || '')}${EDIT_LANGS.map(([k, l]) => opt(k, l, b.language)).join('')}${langKnown ? '' : opt(b.language, b.language, b.language)}</select></div>
        <div class="fr"><label class="lbl" for="f-format">Format</label><select id="f-format" name="format">${[['paperback', 'Paperback'], ['hardcover', 'Hardcover'], ['physical', 'Other physical'], ['ebook', 'Ebook']].map(([k, l]) => opt(k, l, fmt)).join('')}</select></div>
        ${field('Pages', 'pages', b.pages, 'inputmode="numeric" style="max-width:120px"')}
        ${field('ISBN', 'isbn', b.isbn, 'inputmode="numeric"')}
        ${field('Edition note', 'editionNote', b.editionNote, 'placeholder="Book club edition, Zephyr Books…"')}
        <div class="fr check"><input type="checkbox" id="f-signed" name="signed"${b.signed ? ' checked' : ''}><label for="f-signed">Signed copy</label></div>
      </section>
      <section class="block">
        <h2 class="disp">The people</h2>
        <div class="ppl">${people.map((p, i) => `
          <div class="pr">
            <select aria-label="Role" data-pi="${i}" data-pk="role">${EDIT_ROLES.map((r) => opt(r, ROLES[r], p.role)).join('')}</select>
            <input aria-label="Name" data-pi="${i}" data-pk="name" value="${esc(p.name)}" list="dl-names" autocomplete="off" placeholder="Name">
            <button type="button" class="icon-btn" data-pdel="${i}" aria-label="Remove ${esc(p.name || 'person')}">${I.x}</button>
          </div>`).join('')}
        </div>
        <button type="button" class="btn-line ch8" id="addPerson" style="height:44px;margin-top:14px"><span class="ch8i tap" style="padding:0 16px">Add a person</span></button>
      </section>
      ${isNew ? `<section class="block">
        <h2 class="disp">Read by</h2>
        ${READERS.map(([k, name]) => `<div class="fr check"><input type="checkbox" id="f-read-${k}" name="read-${k}"><label for="f-read-${k}">${name}</label></div>`).join('')}
      </section>` : ''}
      <p class="status" id="editStatus" role="status" style="padding:0 20px;color:var(--accentText)"></p>
      <div class="edit-acts">
        <a class="cancel tap" href="${backHref}">${isNew ? 'Back' : 'Cancel'}</a>
        <button type="submit" class="btn-ink tap ch8" style="padding:0 30px">${isNew ? 'Add to the library' : 'Save'}</button>
      </div>
      <datalist id="dl-pub">${publishers.map((p) => `<option value="${esc(p)}">`).join('')}</datalist>
      <datalist id="dl-series">${seriesNames.map((p) => `<option value="${esc(p)}">`).join('')}</datalist>
      <datalist id="dl-names">${names.map((p) => `<option value="${esc(p)}">`).join('')}</datalist>
    </form>`;

  el.querySelectorAll('[data-pi]').forEach((x) => x.addEventListener(x.tagName === 'SELECT' ? 'change' : 'input', () => {
    people[Number(x.dataset.pi)][x.dataset.pk] = x.value;
  }));
  el.querySelectorAll('[data-pdel]').forEach((x) => x.addEventListener('click', () => {
    keepFields();
    people.splice(Number(x.dataset.pdel), 1);
    renderEditKeep(id);
  }));
  $('#addPerson').addEventListener('click', () => {
    keepFields();
    people.push({ role: people.length ? 'translator' : 'author', name: '' });
    renderEditKeep(id);
    const inputs = el.querySelectorAll('[data-pk="name"]');
    inputs[inputs.length - 1]?.focus();
  });
  $('#editForm').addEventListener('submit', (e) => { e.preventDefault(); saveEdit(id); });
  $('#fyLook').addEventListener('click', () => lookFirstYear(id, true));
  wireEditCover(id);
  // A new book: look up when the work first came out, in the background.
  if (isNew && b.title && !b.firstYear && !fyTried.has(b.isbn || b.title)) { fyTried.add(b.isbn || b.title); lookFirstYear(id, false); }
}

// First published: Open Library's year for the work, by ISBN or title + author.
// Never later than this edition's year (Open Library sometimes only knows reprints).
const fyTried = new Set();
async function lookFirstYear(id, asked) {
  const btn = $('#fyLook'), note = $('#fyNote');
  if (!btn) return;
  const isbn = toIsbn13(($('#f-isbn')?.value || '').replace(/[^0-9Xx]/g, ''));
  const title = $('#f-title')?.value.trim();
  const author = editDraft.get(id)?.find((p) => p.name && (p.role === 'author' || p.role === 'writer'))?.name;
  if (!isbn && !title) { note.textContent = 'Needs a title or ISBN.'; return; }
  btn.disabled = true; note.textContent = 'Looking…';
  let r = null;
  try { r = await firstPublished({ isbn, title, author }); } catch { /* shown below */ }
  if (!$('#fyLook')) return; // left the form
  btn.disabled = false;
  const f = $('#f-firstYear'), ed = Number($('#f-year').value) || null;
  if (!r) { note.textContent = asked ? 'Not found. Type it if you know it.' : ''; return; }
  const y = ed && r.year > ed ? ed : r.year;
  if (f.value.trim() && !asked) { note.textContent = ''; return; } // typed meanwhile
  f.value = y;
  note.textContent = `From ${r.source}${r.how === 'title' ? ', by title' : ''}`;
}

// --- Cover in the edit form ---------------------------------------------------------------
// A new cover (photo or another edition's) is staged and saved with the rest on
// Save, so Cancel still discards everything. Choosing a cover marks the edition checked.

const coverDraft = new Map(); // bookId → { pending, results, loading, pick, status, busy }

function editCoverHtml(b) {
  const st = coverDraft.get(b.id) || {};
  const c = st.pending || b.cover;
  const r = c?.w && c?.h ? c.w / c.h : 0.66;
  let w = 110, h = Math.round(110 / r);
  if (h > 170) { h = 170; w = Math.round(170 * r); }
  const size = `width:${w}px;height:${h}px`;
  const preview = st.pending
    ? `<span class="cover" style="${size}"><img alt="New cover" src="${esc(st.pending.mode === 'copied' ? st.pending.thumb : st.pending.url)}" referrerpolicy="no-referrer"></span>`
    : coverBox(b, 110, 170);
  const eds = st.results || [];
  return `
    <h2 class="disp">The cover</h2>
    <div class="ecov">
      <div class="cv">${preview}</div>
      <div class="side">
        <div class="lbl">${st.pending ? (b.id === NEW ? `From ${esc(st.pending.source || 'a photo')}` : 'New cover, saved with Save') : b.cover ? `From ${esc(b.cover.source || 'unknown')}` : 'No cover yet'}</div>
        <div class="acts">
          <label class="btn-line ch8"><span class="ch8i tap">Photo</span><input type="file" accept="image/*" data-ec="photo" hidden></label>
          <button type="button" class="btn-line ch8" data-ec="search"${st.loading || st.busy ? ' disabled' : ''}><span class="ch8i tap">${st.results ? 'Search again' : 'Search editions'}</span></button>
          <a class="btn-line ch8" href="${esc(imageSearchUrl(b))}" target="_blank" rel="noopener" data-ec="gimg"><span class="ch8i tap">Google Images</span></a>
          ${c ? `<button type="button" class="btn-line ch8" data-ec="crop"${st.busy ? ' disabled' : ''}><span class="ch8i tap">Crop</span></button>` : ''}
        </div>
        ${st.pending ? `<button type="button" class="ok tap" data-ec="keep">${b.id === NEW ? 'No cover for now' : 'Keep the current cover'}</button>` : ''}
      </div>
    </div>
    <p class="hint">Photo takes a picture or picks a saved image; you then drag its corners onto the cover's. Crop straightens the cover shown. Search editions uses the publisher and year below, if filled in.</p>
    ${st.status ? `<p class="status" role="status">${esc(st.status)}</p>` : ''}
    ${eds.length ? `<div class="eds">${eds.map((e, i) => `
      <button type="button" data-eced="${i}" aria-pressed="${st.pick === i}"${st.busy ? ' disabled' : ''}>
        <span class="im"><img src="${esc(e.thumb)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.closest('button').remove()"></span>
        <span class="m">${esc([e.publisher, e.year, LANGS[e.language] || e.language].filter(Boolean).join(' · ') || e.source)}</span>
      </button>`).join('')}</div>` : ''}
    ${st.pick != null && eds[st.pick] && st.pending ? `<div class="pickbar">
      <button type="button" class="btn-line ch8" data-ec="details"><span class="ch8i tap">Also use its details</span></button>
      <span class="hint" style="margin:0">Fills in its ISBN, publisher, year and language below.</span>
    </div>` : ''}`;
}

function renderEditCover(id) {
  const sec = $('#editCover');
  const b = bookOf(id);
  if (!sec || !b) return;
  sec.innerHTML = editCoverHtml(b);
  observeCovers(sec);
  wireEditCover(id);
}
function setCover(id, patch) {
  coverDraft.set(id, { ...(coverDraft.get(id) || {}), ...patch });
  renderEditCover(id);
}

function wireEditCover(id) {
  const sec = $('#editCover');
  if (!sec) return;
  observeCovers(sec);
  const b = bookOf(id);
  sec.querySelector('[data-ec="photo"]')?.addEventListener('change', async (ev) => {
    const file = ev.target.files?.[0];
    ev.target.value = '';
    if (!file) return;
    try {
      const img = await cropImage(file);
      if (img) setCover(id, { pending: coverFromImage(img, 'Photo'), pick: null, status: null });
    } catch (e) { setCover(id, { status: 'Couldn\'t use that image: ' + e.message }); }
  });
  // Crop the cover shown (a saved one, or the one just picked), e.g. a book shot at an angle.
  sec.querySelector('[data-ec="crop"]')?.addEventListener('click', async () => {
    const st = coverDraft.get(id) || {};
    const p = st.pending;
    setCover(id, { busy: true, status: 'Opening the cover…' });
    try {
      const srcUrl = p ? (p.mode === 'copied' ? p.large : p.url)
        : b.cover.id ? await coverImage(id, 'large', b) || await coverImage(id, 'thumb', b) : b.cover.url;
      if (!srcUrl) throw new Error('no image');
      setCover(id, { busy: false, status: null });
      const img = await cropImage(srcUrl);
      if (img) setCover(id, { pending: coverFromImage(img, (p || b.cover).source || 'Photo'), pick: null });
    } catch (e) {
      setCover(id, { busy: false, status: /cors|load/.test(e.message) ? 'This cover\'s source doesn\'t allow editing it here. Save it from Google Images and use Photo instead.' : 'Couldn\'t open the cover: ' + e.message });
    }
  });
  // Google Images searches what's in the form now (it may have been typed since).
  sec.querySelector('[data-ec="gimg"]')?.addEventListener('click', (ev) => {
    const title = $('#f-title')?.value.trim() || b.title;
    const author = editDraft.get(id)?.find((p) => p.name && (p.role === 'author' || p.role === 'writer'))?.name || b.authors?.[0];
    ev.currentTarget.href = imageSearchUrl({ title, authors: author ? [author] : [] });
  });
    sec.querySelector('[data-ec="keep"]')?.addEventListener('click', () => setCover(id, { pending: null, pick: null, status: null }));
  sec.querySelector('[data-ec="search"]')?.addEventListener('click', async () => {
    const pub = $('#f-publisher').value.trim(), yr = $('#f-year').value.trim();
    const isbnTyped = $('#f-isbn').value.replace(/[^0-9Xx]/g, '');
    const newIsbn = isbnTyped && isbnTyped !== String(b.isbn || '').replace(/[^0-9Xx]/g, '') && toIsbn13(isbnTyped) !== b.isbn ? isbnTyped : null; // a newly typed ISBN = that exact edition
    const title = $('#f-title').value.trim() || b.title;
    const author = editDraft.get(id)?.find((p) => p.name && (p.role === 'author' || p.role === 'writer'))?.name || b.authors?.[0];
    if (!title && !newIsbn) { setCover(id, { status: 'Type the title (or the ISBN) below first.' }); return; }
    const opts = newIsbn ? { isbn: newIsbn } : { publisher: pub || null, year: /^\d{4}$/.test(yr) ? Number(yr) : null };
    setCover(id, { loading: true, pick: null, status: newIsbn ? 'Looking up that ISBN…' : 'Looking for other editions…' });
    const { editions, errors, exact } = await findEditions({ ...b, title, authors: author ? [author] : [] }, opts);
    const what = newIsbn ? '' : [pub, yr].filter(Boolean).join(', ');
    setCover(id, {
      loading: false, results: editions,
      status: editions.length
        ? `${editions.length} ${exact ? 'cover' : 'edition'}${editions.length === 1 ? '' : 's'}${what ? ` matching ${what}` : ''}. Tap one to use its cover.`
        : `Nothing found${what ? ` matching ${what}` : ''}${errors.length ? ` (${errors.join('; ')})` : ''}. ${what ? 'Try clearing the year. ' : ''}Or try Google Images or a photo.`,
    });
  });
  sec.querySelectorAll('[data-eced]').forEach((x) => x.addEventListener('click', async () => {
    const i = Number(x.dataset.eced);
    const e = coverDraft.get(id)?.results?.[i];
    if (!e) return;
    setCover(id, { busy: true, pick: i, status: 'Fetching that cover…' });
    try { setCover(id, { busy: false, pending: await coverFromUrl(e.cover, e.source), status: null }); }
    catch (err) { setCover(id, { busy: false, pick: null, status: 'Couldn\'t load that cover: ' + err.message }); }
  }));
  sec.querySelector('[data-ec="details"]')?.addEventListener('click', () => {
    const st = coverDraft.get(id);
    const e = st?.results?.[st.pick];
    if (!e) return;
    if (e.isbn) $('#f-isbn').value = e.isbn;
    if (e.publisher) $('#f-publisher').value = e.publisher;
    if (e.year) $('#f-year').value = e.year;
    if (e.language && [...$('#f-language').options].some((o) => o.value === e.language)) $('#f-language').value = e.language;
    toast('Details filled in. Check them, then Save.');
  });
  if (coverDraft.get(id)?.autoSearch) {
    coverDraft.get(id).autoSearch = false;
    sec.querySelector('[data-ec="search"]')?.click();
  }
}

// Adding or removing a person re-renders the form; keep what was typed elsewhere.
let keptFields = null;
function keepFields() { keptFields = Object.fromEntries(new FormData($('#editForm')).entries()); keptFields.signed = $('#f-signed').checked; }
function renderEditKeep(id) {
  renderEdit(id);
  if (!keptFields) return;
  for (const [k, v] of Object.entries(keptFields)) {
    const f = $(`#f-${k}`);
    if (!f) continue;
    if (f.type === 'checkbox') f.checked = v === true || v === 'on'; else f.value = v;
  }
  keptFields = null;
}

async function saveEdit(id) {
  const isNew = id === NEW;
  const b = bookOf(id);
  const fd = Object.fromEntries(new FormData($('#editForm')).entries());
  const status = (s) => { $('#editStatus').textContent = s; };
  const title = fd.title.trim();
  if (!title) { status('A title is needed.'); $('#f-title').focus(); return; }
  if (!fd.category) { status('Pick a category.'); $('#f-category').focus(); return; }
  const isbnRaw = fd.isbn.replace(/[^0-9Xx]/g, '');
  const isbn = isbnRaw ? toIsbn13(isbnRaw) : null;
  if (isbnRaw && !isbn) { status('That ISBN doesn\'t look right (check the digits).'); $('#f-isbn').focus(); return; }
  const year = fd.year.trim() ? Number(fd.year) : null;
  if (fd.year.trim() && !(year > 1400 && year <= new Date().getFullYear() + 1)) { status('The edition year should be four digits.'); $('#f-year').focus(); return; }
  const fyRaw = (fd.firstYear || '').trim();
  const firstYear = fyRaw ? Number(fyRaw) : null;
  if (fyRaw && !(/^-?\d{1,4}$/.test(fyRaw) && firstYear <= new Date().getFullYear() + 1)) { status('First published should be a year.'); $('#f-firstYear').focus(); return; }
  if (firstYear && year && firstYear > year) { status('First published is later than this edition.'); $('#f-firstYear').focus(); return; }

  // People: names cleaned up, each linked to an author record.
  const people = editDraft.get(id).map((p) => ({ role: p.role, name: fixName(p.name || '') })).filter((p) => p.name);
  const newAuthors = [];
  for (const p of people) {
    const existing = [...S.authors.values()].find((a) => norm(a.name) === norm(p.name));
    if (existing) { p.authorId = existing.id; p.name = existing.name; continue; }
    p.authorId = slug(p.name);
    if (!S.authors.has(p.authorId)) newAuthors.push({ id: p.authorId, name: p.name, sortName: sortName(p.name), nationality: null, gender: null, checked: false, source: null });
  }
  const main = people.filter((p) => p.role === 'author' || p.role === 'writer');

  // Series
  const seriesName = fd.seriesName.trim() || null;
  let seriesId = null, newSeries = null;
  if (seriesName) {
    const existing = [...S.series.values()].find((x) => norm(x.name) === norm(seriesName));
    seriesId = existing ? existing.id : slug(seriesName);
    if (!existing) newSeries = { id: seriesId, name: seriesName };
  }

  let fields = {
    title, subtitle: fd.subtitle.trim() || null, category: fd.category,
    seriesId, seriesName: existingSeriesName(seriesId) || seriesName, volume: seriesName ? (fd.volume.trim() || null) : null,
    publisher: fd.publisher.trim() || null, year, firstYear, language: fd.language || null,
    format: fd.format === 'ebook' ? 'ebook' : 'physical', binding: ['paperback', 'hardcover'].includes(fd.format) ? fd.format : null,
    pages: Number(fd.pages) || null, isbn, editionNote: fd.editionNote.trim() || null, signed: $('#f-signed').checked,
    people, authors: main.map((p) => p.name),
    authorSort: main.length ? (S.authors.get(main[0].authorId)?.sortName || newAuthors.find((a) => a.id === main[0].authorId)?.sortName || sortName(main[0].name)) : '',
  };
  // A new cover chosen above: saved in the same batch, and it marks the edition checked.
  const pending = coverDraft.get(id)?.pending;
  let newCover = null;
  if (pending) {
    fields.verified = true; fields.needsFix = false;
    if (pending.mode === 'copied') newCover = pending;
    else fields.cover = { url: pending.url, w: pending.w, h: pending.h, source: pending.source };
  }
  if (isNew) return saveNew(fields, newAuthors, newSeries, newCover, READERS.map(([k]) => k).filter((k) => $(`#f-read-${k}`)?.checked), status);
  status('Saving…');
  try {
    fields = await saveEdits(id, fields, newAuthors, newSeries, newCover);
    coverDraft.delete(id);
    for (const a of newAuthors) S.authors.set(a.id, a);
    if (newSeries) S.series.set(newSeries.id, newSeries);
    Object.assign(b, fields);
    editDraft.delete(id);
    location.hash = `#/book/${id}`;
    toast('Saved.');
  } catch (e) { status('Couldn\'t save: ' + e.message); }
}
const existingSeriesName = (sid) => (sid ? S.series.get(sid)?.name : null);

// A new book: checked against the copy while adding, so it starts verified.
async function saveNew(fields, newAuthors, newSeries, newCover, readBy, status) {
  const id = newBookId();
  fields = {
    ...fields, cover: fields.cover || null, verified: true, needsFix: false, addedAt: today(),
    description: null, sourceGenres: null, legacyId: null,
  };
  status('Adding…');
  try {
    fields = await addBook(id, fields, newAuthors, newSeries, newCover, readBy.length ? { readBy } : null);
    for (const a of newAuthors) S.authors.set(a.id, a);
    if (newSeries) S.series.set(newSeries.id, newSeries);
    S.books.set(id, { id, ...fields });
    if (readBy.length) S.priv.set(id, { ...(S.priv.get(id) || {}), readBy });
    resetAdd();
    location.hash = `#/book/${id}`;
    toast('Added to the library.');
  } catch (e) { status('Couldn\'t add it: ' + e.message); }
}

// --- Add a book ---------------------------------------------------------------------------
// Scan (or photograph, or type) the ISBN → look it up → "Is this your copy?" →
// the edit form, prefilled, for category, read by and anything missing → Save.
// No ISBN: straight to the form. The book being added lives in ADD.draft under
// the id NEW until it's saved and gets a real one.

const NEW = 'new';
const bookOf = (id) => (id === NEW ? ADD.draft : S.books.get(id));
const freshAdd = () => ({ step: 'start', isbn: '', rec: null, pick: 0, dupes: null, msg: null, busy: false, draft: null, search: null });
let ADD = freshAdd();
let stopScan = null;

function resetAdd() {
  endScan();
  ADD = freshAdd();
  editDraft.delete(NEW);
  coverDraft.delete(NEW);
}
function endScan() {
  stopScan?.();
  stopScan = null;
  if (ADD.step === 'scanning') ADD.step = 'start';
}

// "Sebald, W. G." (library catalogues) → "W. G. Sebald"
const flipName = (n) => {
  const m = String(n).match(/^([^,]+),\s*([^,]+)$/);
  return m && !/^(Jr|Sr)\.?$/.test(m[2].trim()) ? `${m[2].trim()} ${m[1].trim()}` : String(n);
};

// Shop-style titles: an imprint in brackets moves to the edition note
// ("… (Penguin Classics)"), and ALL CAPS becomes title case.
const IMPRINT = /classics|edition|paperback|hardcover|hardback|library|collection|series|vintage|penguin|books?$/i;
function cleanTitle(raw) {
  let title = String(raw || '').replace(/\s+/g, ' ').trim(), note = null;
  const m = title.match(/^(.+?)\s*\(([^()]+)\)$/);
  if (m && IMPRINT.test(m[2]) && !/#\s*\d/.test(m[2])) { title = m[1]; note = m[2].trim(); }
  const t = splitTitle(title);
  return { ...t, editionNote: t.editionNote || note };
}

function draftFrom(rec, isbn) {
  const t = cleanTitle(rec?.title);
  const pubs = [...new Set([...S.books.values()].map((x) => x.publisher).filter(Boolean))];
  const pub = rec?.publisher ? pubs.find((x) => norm(x) === norm(rec.publisher)) || rec.publisher : null;
  const people = (rec?.authors || []).map((n) => ({ role: 'author', name: fixName(flipName(n)) })).filter((p) => p.name);
  return {
    id: NEW, title: t.title, subtitle: rec?.subtitle || null, category: null,
    seriesName: t.series, volume: t.volume, editionNote: t.editionNote,
    publisher: pub, year: rec?.year ? Number(rec.year) || null : null, language: rec?.language || null,
    pages: rec?.pages || null, isbn: isbn || null, format: 'physical', binding: null, signed: false,
    people, authors: people.map((p) => p.name), cover: null,
  };
}

// Same ISBN, or the same title with an author in common.
function dupesFor(isbn, rec) {
  const all = [...S.books.values()];
  const same = all.filter((b) => isbn && b.isbn === isbn);
  if (same.length) return { exact: true, books: same };
  if (!rec?.title) return null;
  const tk = titleKey({ title: cleanTitle(rec.title).title });
  const names = new Set((rec.authors || []).map((n) => norm(fixName(flipName(n)))));
  const like = all.filter((b) => titleKey(b) === tk && (!names.size || (b.authors || []).some((a) => names.has(norm(a)))));
  return like.length ? { exact: false, books: like } : null;
}

function renderAdd() {
  const el = $('#add');
  if (!isMember()) {
    el.innerHTML = `<header class="page-head" style="padding-top:28px"><h1 class="disp">Add a book</h1></header><p class="empty">Sign in from the library menu to add books.</p>`;
    return;
  }
  const A = ADD;
  const msg = A.msg ? `<p class="add-msg" role="status">${esc(A.msg)}</p>` : '';
  if (A.step === 'start' || A.step === 'scanning') {
    const scanning = A.step === 'scanning';
    el.innerHTML = `
      <header class="page-head" style="padding-top:28px"><h1 class="disp">Add a book</h1>
        <p>Scan the barcode on the back. Older paperbacks often have it inside the front cover.</p></header>
      <section class="scanbox">
        <div class="scanv${scanning ? ' on' : ''}">
          <video id="addVideo" playsinline muted></video>
          ${scanning ? '<div class="guide" id="addGuide"></div>' : `<button class="scan-go" id="scanGo">${I.scan}<span class="tap">Scan the barcode</span></button>`}
        </div>
        ${scanning ? `<div class="scan-acts"><span class="lbl">Hold the barcode inside the band</span><button class="cancel tap" id="scanStop">Stop</button></div>` : ''}
      </section>
      ${msg}
      <section class="add-alt">
        <label class="btn-line ch8"><span class="ch8i tap">Photo of the barcode</span><input type="file" accept="image/*" capture="environment" id="barPhoto" hidden></label>
        <form class="isbnf" id="isbnForm" novalidate>
          <label class="lbl" for="addIsbn">Or type the ISBN</label>
          <div class="row"><input id="addIsbn" inputmode="numeric" autocomplete="off" placeholder="978…" value="${esc(A.isbn)}"><button type="submit" class="btn-ink tap ch8">Look up</button></div>
        </form>
        <div class="add-or">
          <button class="btn-line ch8" id="toSearch"><span class="ch8i tap">Search by title or author</span></button>
          <span class="hint">When there's no barcode or it won't scan.</span>
        </div>
        <button class="ok tap" id="noIsbn">Or fill it in by hand</button>
      </section>`;
    $('#scanGo')?.addEventListener('click', startAddScan);
    $('#scanStop')?.addEventListener('click', () => { endScan(); renderAdd(); });
    $('#barPhoto').addEventListener('change', async (ev) => {
      const file = ev.target.files?.[0];
      ev.target.value = '';
      if (!file) return;
      endScan();
      ADD.msg = 'Reading the photo…';
      renderAdd();
      try {
        const r = await isbnFromPhoto(file);
        if (r && r !== 'price') { beep(true); lookupIsbn(r); return; }
        beep(false);
        ADD.msg = r === 'price' ? 'That\'s a price code, not the ISBN. Look for another barcode, often inside the front cover.' : 'No barcode found in the photo. Try closer, with the barcode sharp and level, or type the ISBN.';
      } catch (e) { ADD.msg = 'Couldn\'t read the photo: ' + e.message; }
      renderAdd();
    });
    $('#isbnForm').addEventListener('submit', (ev) => {
      ev.preventDefault();
      const raw = $('#addIsbn').value;
      const isbn = toIsbn13(raw);
      ADD.isbn = raw;
      if (!isbn) { ADD.msg = 'That ISBN doesn\'t look right. Check the digits (10 or 13, as printed).'; renderAdd(); $('#addIsbn').focus(); return; }
      endScan();
      lookupIsbn(isbn);
    });
    $('#noIsbn').addEventListener('click', () => toDetails(draftFrom(null, null), null));
    $('#toSearch').addEventListener('click', () => { endScan(); openSearch(); });
    return;
  }

  if (A.step === 'search') { renderAddSearch(el); return; }

  if (A.step === 'looking') {
    el.innerHTML = `
      <div class="page-top"><button class="back tap" id="addRestart">${I.back}Start over</button></div>
      <header class="page-head"><h1 class="disp">Looking it up</h1><p>ISBN ${esc(A.isbn)}. Asking the libraries and booksellers…</p></header>`;
    $('#addRestart').addEventListener('click', () => { resetAdd(); renderAdd(); });
    return;
  }

  const dup = A.dupes ? `
    <div class="fixp ch12 dup"><div class="ch12i">
      <h3>${A.dupes.exact ? 'Already in the library' : 'A book with this title is already in the library'}</h3>
      <div class="fix-list" style="margin:8px 0 0">${A.dupes.books.map((b) => `
        <a class="fix-row" href="#/book/${esc(b.id)}"><span class="cv">${coverBox(b, 44, 66)}</span>
          <span style="flex:1;min-width:0"><span class="tt" style="display:block">${esc(b.title)}</span><span class="sub" style="display:block">${esc([byLine(b), b.publisher, b.year].filter(Boolean).join(' · '))}</span></span>${I.right}</a>`).join('')}</div>
      <p class="hint" style="margin:12px 0 0">${A.dupes.exact ? 'Adding it again makes a second copy.' : 'Check it isn\'t the same copy before adding it.'}</p>
    </div></div>` : '';

  if (A.step === 'notfound') {
    el.innerHTML = `
      <div class="page-top"><button class="back tap" id="addRestart">${I.back}Start over</button></div>
      <header class="page-head"><h1 class="disp">Not found</h1><p>None of the sources know ISBN ${esc(A.isbn)}. You can still add it from what's printed in the copy, with a photo for the cover.</p></header>
      ${dup}
      <div class="add-acts">
        <button class="btn-ink tap ch8" id="toSearch2">Search by title or author</button>
        <button class="btn-line ch8" id="byHand"><span class="ch8i tap">Fill it in by hand</span></button>
        <button class="btn-line ch8" id="addRestart2"><span class="ch8i tap">Scan another</span></button>
      </div>`;
    $('#addRestart').addEventListener('click', () => { resetAdd(); renderAdd(); });
    $('#addRestart2').addEventListener('click', () => { resetAdd(); renderAdd(); });
    $('#byHand').addEventListener('click', () => toDetails(draftFrom(null, A.isbn), null));
    $('#toSearch2').addEventListener('click', () => openSearch());
    observeCovers(el);
    return;
  }

  // Found: "Is this your copy?"
  const r = A.rec;
  const covers = r.covers || [];
  const cur = covers[A.pick];
  const d = draftFrom(r, A.isbn);
  const rows = [['Publisher', d.publisher], ['Year', d.year], ['Language', LANGS[d.language] || d.language], ['Pages', d.pages], ['ISBN', A.isbn]].filter(([, v]) => v);
  el.innerHTML = `
    <div class="page-top"><button class="back tap" id="addRestart">${I.back}${A.search ? 'Results' : 'Start over'}</button></div>
    ${dup}
    <section class="plinth addcov">
      ${cur ? `<img src="${esc(cur.url)}" alt="Cover found for ${esc(d.title)}" referrerpolicy="no-referrer">`
        : `<span class="cover ph" style="width:160px;height:240px" role="img" aria-label="No cover found"><span class="pa">${esc(byLine(d))}</span><span class="pt">${esc(d.title || 'No cover found')}</span></span>`}
      <div class="line" aria-hidden="true"></div>
      <div class="check lbl">${cur ? `Cover from ${esc(cur.source)}` : 'No cover found'}</div>
      ${covers.length > 1 ? `<div class="covpick">${covers.map((c, i) => `<button data-cp="${i}" aria-pressed="${i === A.pick}" aria-label="Cover from ${esc(c.source)}"><img src="${esc(c.url)}" alt="" referrerpolicy="no-referrer" onerror="this.closest('button').remove()"></button>`).join('')}</div>` : ''}
    </section>
    <div class="fixp ch12"><div class="ch12i q">
      <span class="what">Is this your copy?</span>
      <button class="btn-ink tap ch8" id="addYes" style="height:44px;padding:0 20px"${A.busy ? ' disabled' : ''}>Yes</button>
      <button class="btn-line ch8" id="addNo" style="height:44px"${A.busy ? ' disabled' : ''}><span class="ch8i tap" style="padding:0 16px">Not my edition</span></button>
      ${msg ? `<div style="flex-basis:100%">${msg}</div>` : ''}
    </div></div>
    <section class="intro">
      <h1 class="disp${d.title.length > 22 ? ' long' : ''}">${esc(d.title || 'Untitled')}</h1>
      ${d.subtitle ? `<p class="subtitle">${esc(d.subtitle)}</p>` : ''}
      ${d.authors.length ? `<div class="by">${esc(byLine(d))}</div>` : ''}
    </section>
    <section class="block" style="padding-bottom:40px"><dl>${rows.map(([k, v]) => `<div><dt class="lbl">${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl></section>`;
  $('#addRestart').addEventListener('click', () => {
    if (A.search) { ADD = { ...freshAdd(), step: 'search', search: A.search }; renderAdd(); window.scrollTo(0, A.search.y || 0); }
    else { resetAdd(); renderAdd(); }
  });
  el.querySelectorAll('[data-cp]').forEach((x) => x.addEventListener('click', () => { ADD.pick = Number(x.dataset.cp); renderAdd(); }));
  $('#addYes').addEventListener('click', async () => {
    let pending = null;
    if (cur) {
      ADD.busy = true; ADD.msg = 'Fetching the cover…'; renderAdd();
      try { pending = await coverFromUrl(cur.url, cur.source); }
      catch { pending = null; }
      ADD.busy = false; ADD.msg = null;
    }
    toDetails(d, pending ? { pending } : null);
    if (cur && !pending) toast('The cover wouldn\'t load. Pick one in the form.');
  });
  // The details usually belong to the scanned ISBN; it's the cover that's off.
  // The form opens with the edition search already running.
  $('#addNo').addEventListener('click', () => toDetails(d, { autoSearch: true }));
  observeCovers(el);
}

// --- Search by title or author (no barcode, or one that won't scan) ---------------------

function openSearch() {
  const prev = ADD.search;
  ADD = { ...freshAdd(), step: 'search', search: prev || { title: '', author: '', results: null } };
  renderAdd();
  window.scrollTo(0, 0);
  $('#sq-title')?.focus();
}

const recFromResult = (e, author) => ({
  title: e.title, subtitle: e.subtitle || null,
  authors: e.authors?.length ? e.authors : author ? [author] : [],
  publisher: e.publisher, year: e.year, language: e.language, pages: e.pages || null,
  covers: e.cover ? [{ source: e.source, url: e.cover }] : [],
});

function renderAddSearch(el) {
  const q = ADD.search;
  const res = q.results || [];
  el.innerHTML = `
    <div class="page-top"><button class="back tap" id="addRestart">${I.back}Add book</button></div>
    <header class="page-head"><h1 class="disp">Search</h1><p>Type the title, the author, or both, as printed in the book.</p></header>
    <form class="editf sform" id="searchForm" novalidate>
      <div class="fr"><label class="lbl" for="sq-title">Title</label><input id="sq-title" value="${esc(q.title)}" autocomplete="off" enterkeyhint="search"></div>
      <div class="fr"><label class="lbl" for="sq-author">Author</label><input id="sq-author" value="${esc(q.author)}" list="dl-snames" autocomplete="off" enterkeyhint="search"></div>
      <datalist id="dl-snames">${[...S.authors.values()].map((a) => `<option value="${esc(a.name)}">`).join('')}</datalist>
      <div class="acts"><button type="submit" class="btn-ink tap ch8"${q.loading ? ' disabled' : ''}>${q.results ? 'Search again' : 'Search'}</button></div>
    </form>
    ${q.status ? `<p class="add-msg" role="status">${esc(q.status)}</p>` : ''}
    ${res.length ? `<div class="eds sres">${res.map((e, i) => `
      <button data-sr="${i}"${q.busy ? ' disabled' : ''}>
        <span class="im"><img src="${esc(e.thumb)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.closest('button').remove()"></span>
        <span class="t">${esc(e.title || '')}</span>
        <span class="m">${esc([e.authors?.[0], e.publisher, e.year, LANGS[e.language] || e.language].filter(Boolean).join(' · ') || e.source)}</span>
      </button>`).join('')}</div>` : ''}
    ${q.results ? `<div class="add-alt" style="padding-top:28px">
      <p class="hint" style="margin:0">${res.length ? 'Tap the one that looks like your copy. The cover and details can still be changed after.' : ''}</p>
      <button class="ok tap" id="sByHand">${res.length ? 'None of these? Fill it in by hand' : 'Fill it in by hand'}</button>
    </div>` : ''}`;
  $('#addRestart').addEventListener('click', () => { ADD = freshAdd(); ADD.search = null; renderAdd(); });
  $('#searchForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const title = $('#sq-title').value.trim(), author = $('#sq-author').value.trim();
    Object.assign(q, { title, author });
    if (!title && !author) { q.status = 'Type a title or an author first.'; renderAdd(); return; }
    document.activeElement?.blur(); // closes the keyboard so the results show
    Object.assign(q, { loading: true, status: 'Searching…', results: q.results });
    renderAdd();
    const { editions, errors } = await searchBooks({ title, author });
    if (ADD.search !== q) return;
    Object.assign(q, {
      loading: false, results: editions,
      status: editions.length ? `${editions.length} found${title ? ' with a cover' : ''}.`
        : `Nothing found${errors.length ? ` (${errors.join('; ')})` : ''}. ${title && author ? 'Try just the title, or check the spelling. ' : ''}You can still fill it in by hand.`,
    });
    renderAdd();
  });
  el.querySelectorAll('[data-sr]').forEach((x) => x.addEventListener('click', () => {
    const e = q.results[Number(x.dataset.sr)];
    if (!e) return;
    q.y = window.scrollY;
    if (e.isbn) { lookupIsbn(e.isbn, e); return; }
    const rec = recFromResult(e, q.author);
    ADD = { ...freshAdd(), step: 'found', search: q, isbn: '', rec, dupes: dupesFor(null, rec) };
    renderAdd();
    window.scrollTo(0, 0);
  }));
  $('#sByHand')?.addEventListener('click', () => {
    const d = draftFrom({ title: q.title, authors: q.author ? [q.author] : [] }, null);
    toDetails(d, null);
  });
}

function toDetails(draft, cover) {
  endScan();
  ADD.draft = draft;
  editDraft.delete(NEW);
  if (cover) coverDraft.set(NEW, cover); else coverDraft.delete(NEW);
  location.hash = '#/add/details';
}

async function startAddScan() {
  ADD.step = 'scanning';
  ADD.msg = null;
  renderAdd();
  const video = $('#addVideo');
  stopScan = await startScanner(video, {
    onIsbn: (isbn) => {
      stopScan = null;
      beep(true);
      $('#addGuide')?.classList.add('hit');
      setTimeout(() => lookupIsbn(isbn), 250);
    },
    onNonIsbn: () => { beep(false); toast('That\'s a price code, not the ISBN. Look for another barcode, often inside the front cover.'); },
    onError: (m) => { stopScan = null; ADD.step = 'start'; ADD.msg = m; renderAdd(); },
  });
  if (ADD.step !== 'scanning' || viewOf(location.hash) !== 'add') endScan(); // left while the camera was opening
}

async function lookupIsbn(isbn, picked = null) {
  ADD = { ...freshAdd(), step: 'looking', isbn, search: picked ? ADD.search : null };
  renderAdd();
  let merged = null;
  try { ({ merged } = await lookupAll(isbn)); } catch { merged = null; }
  if (ADD.step !== 'looking' || ADD.isbn !== isbn) return; // started over meanwhile
  if (picked) {
    // From the search: its cover comes first, and it fills in what the ISBN lookup lacks.
    const base = recFromResult(picked);
    merged = merged ? { ...base, ...Object.fromEntries(Object.entries(merged).filter(([, v]) => (Array.isArray(v) ? v.length : v))) } : base;
    merged.covers = [base.covers[0], ...(merged.covers || []).filter((c) => c.url !== picked.cover)].filter(Boolean);
  }
  ADD.rec = merged;
  ADD.step = merged?.title ? 'found' : 'notfound';
  ADD.dupes = dupesFor(isbn, merged);
  renderAdd();
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden && stopScan) { endScan(); if (viewOf(location.hash) === 'add') renderAdd(); }
});

// --- Routing --------------------------------------------------------------------------------

const VIEWS = ['library', 'book', 'fix', 'add'];
function show(v) {
  for (const x of VIEWS) $('#' + x).hidden = x !== v;
}
const viewOf = (h) => (/^#\/book\/.+\/edit$/.test(h) ? 'edit' : /^#\/book\//.test(h) ? 'book' : h.startsWith('#/fix') ? 'fix'
  : h.startsWith('#/add/details') ? 'adddetails' : h.startsWith('#/add') ? 'add' : 'library');

let libScroll = 0;
// The book page's back link returns to where the book was opened from.
let backTo = { href: '#/', label: 'Library' };
let lastView = 'library';
function route() {
  const h = location.hash;
  const v = viewOf(h);
  if (v === 'book' && lastView !== 'book' && lastView !== 'edit') {
    backTo = lastView === 'fix' ? { href: '#/fix', label: 'To fix' }
      : lastView === 'adddetails' || lastView === 'add' ? { href: '#/add', label: 'Add another' }
      : { href: '#/', label: 'Library' };
  }
  lastView = v;
  if (v !== 'add') endScan();
  const adding = v === 'add' || v === 'adddetails';
  $('#navLib')?.setAttribute('aria-current', adding ? 'false' : 'page');
  $('#navAdd')?.setAttribute('aria-current', adding ? 'page' : 'false');
  if (!$('#library').hidden && v !== 'library') libScroll = window.scrollY;
  if (v === 'add') { show('add'); renderAdd(); window.scrollTo(0, 0); return; }
  if (v === 'adddetails') { show('book'); renderEdit(NEW); window.scrollTo(0, 0); return; }
  if (v === 'edit') { show('book'); renderEdit(decodeURIComponent(h.slice(7, -5))); window.scrollTo(0, 0); return; }
  if (v === 'book') { show('book'); editDraft.clear(); coverDraft.clear(); renderBook(decodeURIComponent(h.slice(7))); window.scrollTo(0, 0); return; }
  if (h.startsWith('#/wall')) { location.replace('#/fix'); return; } // old bookmarks
  if (v === 'fix') { show('fix'); renderFixList(); window.scrollTo(0, 0); return; }
  // "#/?q=…" opens the library searching (used by the series row).
  const q = h.match(/[?&]q=([^&]*)/);
  if (q) { S.q = decodeURIComponent(q[1]); S.searching = true; S.cat = 'All'; libScroll = 0; }
  show('library');
  renderLibrary();
  requestAnimationFrame(() => window.scrollTo(0, libScroll));
}
window.addEventListener('hashchange', route);

// --- Start ------------------------------------------------------------------------------------

function start() {
  applyTheme();
  $('#nav').innerHTML = `
    <a href="#/" aria-current="page" class="tap" id="navLib">${I.navLib}Library</a>
    <a href="#/add" class="tap" id="navAdd">${I.navAdd}Add book</a>
    <button class="tap" id="navNext">${I.navNext}Next read</button>`;
  $('#navNext').addEventListener('click', () => soon('Next read'));
  $('#navLib').addEventListener('click', (e) => {
    if (location.hash === '' || location.hash === '#/') { e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  });

  route();

  watchCatalogue((books, authors, series) => {
    const first = !S.loaded;
    S.books = books; S.authors = authors; S.series = series; S.loaded = true;
    first ? rerender() : liveRerender();
  }, (e) => toast('Couldn\'t load the library: ' + e.message));

  let stopPrivate = null;
  onUser((u) => {
    S.user = u;
    if (!u?.member) { S.read = 'any'; S.lent = false; }
    stopPrivate?.(); stopPrivate = null;
    S.priv = new Map();
    rerender();
    if (u?.member) {
      let first = true;
      stopPrivate = watchPrivate((priv) => {
        S.priv = priv;
        // The grid shows no read status or loans, so it only redraws for them
        // when a Read by / Lent out filter is on.
        const v = viewOf(location.hash);
        if (first || v !== 'library' || S.read !== 'any' || S.lent) first ? rerender() : liveRerender();
        first = false;
      }, (e) => toast('Couldn\'t load read status: ' + e.message));
    }
  });
}

// A change from the other phone. Wait while something is being typed (a lend
// name, a fix-panel field) so the field isn't wiped; redraw once it's left.
let livePending = false, liveTimer = null;
function liveRerender() {
  const a = document.activeElement;
  if (a && a !== document.body && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) {
    if (!livePending) {
      livePending = true;
      a.addEventListener('blur', () => { livePending = false; setTimeout(liveRerender, 0); }, { once: true });
    }
    return;
  }
  clearTimeout(liveTimer);
  liveTimer = setTimeout(rerender, 150);
}

function rerender() {
  const v = viewOf(location.hash);
  const y = window.scrollY;
  if (v === 'edit') { if (!$('#editForm')) renderEdit(decodeURIComponent(location.hash.slice(7, -5))); }
  else if (v === 'adddetails') { if (!$('#editForm')) renderEdit(NEW); }
  else if (v === 'add') { if (ADD.step !== 'scanning') renderAdd(); } // don't cut the camera off
  else if (v === 'book') renderBook(decodeURIComponent(location.hash.slice(7)));
  else if (v === 'fix') renderFixList();
  else renderLibrary();
  window.scrollTo(0, y);
}

start();
