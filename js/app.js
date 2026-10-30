// Bookshelf: library grid and book page, built from the "Bookshelf mockups" canvas.
import { onUser, signIn, signOutUser, loadCatalogue, loadPrivate, coverImage, savePrivate } from './data.js?v=1';

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
  cat: 'All', sort: 'Author', q: '', searching: false, open: null,
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
const today = () => new Date().toISOString().slice(0, 10);
const byLine = (b) => (b.authors || []).join(', ');
const ARTICLE = /^(the|a|an|o|os|as|um|uma|en|ett|den|det|de|het|een|el|la|le|les|il)\s+/;
const titleKey = (b) => norm(b.title).replace(ARTICLE, '');
const volNum = (v) => parseFloat(String(v ?? '').replace(/–.*/, '')) || 0;
const isMember = () => !!S.user?.member;

function compare(sort) {
  const author = (b) => norm(b.authorSort) || '￿';
  const bySeries = (a, b) => norm(a.seriesName).localeCompare(norm(b.seriesName)) || volNum(a.volume) - volNum(b.volume);
  const t = (a, b) => titleKey(a).localeCompare(titleKey(b));
  switch (sort) {
    case 'Title': return t;
    case 'Recently added': return (a, b) => String(b.addedAt || '').localeCompare(String(a.addedAt || '')) || t(a, b);
    case 'Year': return (a, b) => (a.year || 9999) - (b.year || 9999) || t(a, b);
    case 'Language': return (a, b) => (LANGS[a.language] || 'zz').localeCompare(LANGS[b.language] || 'zz') || author(a).localeCompare(author(b)) || t(a, b);
    default: return (a, b) => author(a).localeCompare(author(b)) || bySeries(a, b) || (a.year || 0) - (b.year || 0) || t(a, b);
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

function coverBox(b, W, H, cls = '') {
  const r = b.cover?.w && b.cover?.h ? b.cover.w / b.cover.h : 0.66;
  let w = W, h = Math.round(W / r);
  if (h > H) { h = H; w = Math.round(H * r); }
  const size = `width:${w}px;height:${h}px`;
  if (!b.cover) {
    return `<span class="cover ph ${cls}" style="${size}" aria-hidden="true"><span class="pa">${esc(byLine(b))}</span><span class="pt">${esc(b.title)}</span></span>`;
  }
  const src = b.cover.url ? ` data-url="${esc(b.cover.url)}"` : ` data-cid="${esc(b.id)}"`;
  return `<span class="cover loading ${cls}" style="${size}"${src}><img alt="" decoding="async"></span>`;
}

function renderLibrary() {
  const el = $('#library');
  const n = S.books.size;
  const unverified = [...S.books.values()].filter((b) => !b.verified).length;
  el.innerHTML = `
    <header class="hero">
      <div><div class="count disp">${S.loaded ? n : '&nbsp;'}</div><div class="lbl" style="margin-top:8px">Books</div></div>
      <h1 class="disp">Library</h1>
    </header>
    ${isMember() && unverified && !S.reviewHidden ? `
    <div class="review">
      <button id="wall"><span class="dot"></span><span class="what">${unverified} book${unverified === 1 ? '' : 's'} to check</span><span class="tap go">Cover wall</span></button>
      <button class="x icon-btn" id="hideReview" aria-label="Hide until next import">${I.x}</button>
    </div>` : ''}
    <div class="sticky grain" id="sticky">
      <div class="compact"><div style="display:flex;align-items:baseline;gap:8px"><span class="n disp">${n}</span><span class="lbl">Books</span></div><h1 class="disp">Library</h1></div>
      <div class="toolbar" id="toolbar"></div>
    </div>
    <div class="list" id="list"></div>`;
  $('#wall')?.addEventListener('click', () => soon('The cover wall'));
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
      <button class="tap" data-open="cat" aria-haspopup="true" aria-expanded="${S.open === 'cat'}" aria-label="Category: ${esc(S.cat)}"><span class="cur">${esc(S.cat)}</span>${I.chev}</button>
      ${S.open === 'cat' ? `<div class="menu" role="menu" aria-label="Category">${items([['All'], ...CATS.map((c) => [c])], S.cat, 'cat')}</div>` : ''}
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
        <button data-act="cols">${S.cols === 3 ? 'Four across' : 'Three across'}</button>
        ${u ? `<div class="note">Signed in as ${esc(u.member ? READERS.find(([k]) => k === u.member)[1] : u.email)}${u.member ? '' : '. This account can only browse.'}</div><button data-act="signout">Sign out</button>`
          : '<button data-act="signin">Sign in</button>'}
        <a href="import/">Import tools</a>
        <a href="scan/">Scanner test</a>
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
  const books = [...S.books.values()].filter((b) => (S.cat === 'All' || b.category === S.cat) && matches(b, tokens));
  if (!books.length) {
    list.innerHTML = `<p class="empty">${tokens.length ? 'Nothing on the shelves matches that.' : 'No books here yet.'}</p>`;
    return;
  }
  // Numbered sections are always the four categories, so "03 Comics" means the
  // same thing whatever the filter or sort.
  const html = CATS.map((cat, i) => {
    const inCat = books.filter((b) => b.category === cat).sort(cmp);
    if (!inCat.length) return '';
    const rows = [];
    for (let j = 0; j < inCat.length; j += m.n) rows.push(inCat.slice(j, j + m.n));
    return `
      <section class="section">
        <div class="section-head"><span class="num disp">${String(i + 1).padStart(2, '0')}</span><span class="name">${cat}</span><span class="of">${inCat.length}</span></div>
        <div class="rows">${rows.map((row) => `
          <div>
            <div class="shelf">${row.map((b) => `<a href="#/book/${esc(b.id)}" aria-label="${esc(b.title)}${b.authors?.length ? ' by ' + esc(byLine(b)) : ''}">${coverBox(b, m.W, m.H)}</a>`).join('')}</div>
            <div class="caps">${row.map((b) => `<a href="#/book/${esc(b.id)}" tabindex="-1" aria-hidden="true"><div class="t">${esc(b.title)}</div><div class="a">${esc(byLine(b))}</div></a>`).join('')}</div>
          </div>`).join('')}
        </div>
      </section>`;
  }).join('');
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
  img.onload = () => el.classList.remove('loading');
  img.onerror = () => el.classList.remove('loading');
  if (el.dataset.url) { img.src = el.dataset.url; return; }
  try {
    const src = await coverImage(el.dataset.cid, size);
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
  if (t.dataset.open) { S.open = S.open === t.dataset.open ? null : t.dataset.open; renderToolbar(); return; }
  if (t.dataset.cat) { S.cat = t.dataset.cat; S.open = null; renderToolbar(); renderList(); window.scrollTo(0, 0); return; }
  if (t.dataset.sort) { S.sort = t.dataset.sort; S.open = null; renderToolbar(); renderList(); return; }
  if (t.id === 'openSearch') { S.searching = true; S.open = null; renderToolbar(); return; }
  if (t.dataset.act === 'cols') { S.cols = S.cols === 3 ? 4 : 3; store.set('cols', String(S.cols)); S.open = null; renderToolbar(); renderList(); return; }
  if (t.dataset.act === 'signin') { S.open = null; renderToolbar(); signIn().catch((err) => toast(err.message)); return; }
  if (t.dataset.act === 'signout') { S.open = null; signOutUser(); return; }
  if (S.open && !t.closest('.menu')) { S.open = null; renderToolbar(); }
});

let resizeT;
window.addEventListener('resize', () => {
  clearTimeout(resizeT);
  resizeT = setTimeout(() => { if (!$('#library').hidden) renderList(); }, 150);
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
    ['Publisher', b.publisher], ['Year', b.year], ['Edition note', editionNote],
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
    <div class="book-top"><a class="back tap" href="#/" id="back">${I.back}Library</a></div>
    <section class="plinth">
      ${coverHtml}
      <div class="line" aria-hidden="true"></div>
      <div class="check lbl">${b.verified ? `${I.check}Edition checked` : '<span class="dot"></span>Edition not checked yet'}</div>
    </section>
    <section class="intro">
      ${b.category ? `<div class="lbl">${esc(b.category)}</div>` : ''}
      <h1 class="disp${b.title.length > 22 ? ' long' : ''}">${esc(b.title)}</h1>
      ${b.subtitle ? `<p class="subtitle">${esc(b.subtitle)}</p>` : ''}
      ${b.authors?.length ? `<div class="by">${esc(byLine(b))}</div>` : ''}
      ${translators.length ? `<p class="tr">Translated by ${esc(translators.join(' and '))}</p>` : ''}
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
    coverImage(b.id, 'large').then((src) => { if (src) c.querySelector('img').src = src; }).catch(() => {});
  }
  const cu = el.querySelector('.cover[data-url]');
  if (cu) loadCover(cu, 'thumb');

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

// --- Routing --------------------------------------------------------------------------------

let libScroll = 0;
function route() {
  const h = location.hash;
  const m = h.match(/^#\/book\/(.+)$/);
  if (m) {
    if (!$('#library').hidden) libScroll = window.scrollY;
    $('#library').hidden = true;
    $('#book').hidden = false;
    renderBook(decodeURIComponent(m[1]));
    window.scrollTo(0, 0);
    return;
  }
  // "#/?q=…" opens the library searching (used by the series row).
  const q = h.match(/[?&]q=([^&]*)/);
  if (q) { S.q = decodeURIComponent(q[1]); S.searching = true; S.cat = 'All'; renderToolbar(); renderList(); libScroll = 0; }
  $('#book').hidden = true;
  $('#library').hidden = false;
  requestAnimationFrame(() => window.scrollTo(0, libScroll));
}
window.addEventListener('hashchange', route);

// --- Start ------------------------------------------------------------------------------------

function start() {
  $('#nav').innerHTML = `
    <a href="#/" aria-current="page" class="tap">${I.navLib}Library</a>
    <button class="tap" id="navAdd">${I.navAdd}Add book</button>
    <button class="tap" id="navNext">${I.navNext}Next read</button>`;
  $('#navAdd').addEventListener('click', () => soon('Adding books'));
  $('#navNext').addEventListener('click', () => soon('Next read'));
  $('#nav a').addEventListener('click', (e) => {
    if (location.hash === '' || location.hash === '#/') { e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  });

  renderLibrary();
  route();

  loadCatalogue((books, authors, series) => {
    S.books = books; S.authors = authors; S.series = series; S.loaded = true;
    rerender();
  }).catch((e) => toast('Couldn\'t load the library: ' + e.message));

  onUser(async (u) => {
    S.user = u;
    S.priv = new Map();
    rerender();
    if (u?.member) {
      try { S.priv = await loadPrivate(); rerender(); }
      catch (e) { toast('Couldn\'t load read status: ' + e.message); }
    }
  });
}

function rerender() {
  const m = location.hash.match(/^#\/book\/(.+)$/);
  if (m) renderBook(decodeURIComponent(m[1]));
  const y = window.scrollY;
  renderLibrary();
  if (!$('#library').hidden) window.scrollTo(0, y);
}

start();
