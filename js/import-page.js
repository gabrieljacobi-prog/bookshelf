import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js';
import {
  getFirestore, collection, getDocs, doc, writeBatch, serverTimestamp, query, where, getDoc,
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js?v=3';
import { lookupAll } from './lookup.js?v=11';

import { cleanExport } from './import-clean.js?v=1';

const MEMBERS = ['gabriel.jacobi@gmail.com', 'ingrid.skare@gmail.com'];
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const $ = (id) => document.getElementById(id);

let user = null;
let data = null;

// --- 1. Sign in ---------------------------------------------------------------

$('signin').onclick = () => signInWithPopup(auth, new GoogleAuthProvider()).catch((e) => { $('who').textContent = e.message; });
onAuthStateChanged(auth, (u) => {
  user = u && MEMBERS.includes(u.email) ? u : null;
  $('who').textContent = !u ? '' : user ? `Signed in as ${u.email}` : `${u.email} can't write to the library.`;
  $('signin').hidden = !!user;
  refreshGo();
});

// --- 2–3. Read and review -------------------------------------------------------

const KIND_LABEL = {
  language: 'Languages normalised or filled in',
  name: 'Author names untangled',
  title: 'Titles cleaned (series and junk removed, ALL CAPS fixed)',
  series: 'Series taken from the title',
  publisher: 'Publisher spellings merged',
  year: 'Placeholder dates dropped',
  category: 'Books without a category',
};

$('file').onchange = async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  data = cleanExport(await f.text());
  const { books, privates, authors, series, notes } = data;
  const cats = count(books.map((b) => b.category));
  const stat = (n, label) => `<div class="card stat"><b>${n}</b><span class="small muted">${label}</span></div>`;
  $('stats').innerHTML = [
    stat(books.length, 'books'),
    ...Object.entries(cats).map(([c, n]) => stat(n, c)),
    stat(authors.length, 'people'),
    stat(series.length, 'series'),
    stat(privates.filter((p) => p.readBy.length).length, 'read by someone'),
    stat(privates.filter((p) => p.lentTo).length, 'lent out'),
  ].join('');
  const byKind = Object.groupBy ? Object.groupBy(notes, (n) => n.kind) : groupBy(notes, (n) => n.kind);
  $('notes').innerHTML = Object.entries(byKind).map(([k, list]) => `
    <details>
      <summary>${KIND_LABEL[k] || k} <span class="muted">(${list.length})</span></summary>
      <table>${list.map((n) => `<tr><td>${esc(n.title)}</td><td class="from">${esc(n.from)}</td><td>${esc(n.to)}</td></tr>`).join('')}</table>
    </details>`).join('');
  $('go').textContent = `Import ${books.length} books`;
  for (const s of ['s-review', 's-covers', 's-import']) $(s).hidden = false;
  refreshGo();
};

function refreshGo() {
  $('go').disabled = !(user && data);
  $('retry').disabled = !user;
  $('tidyLoad').disabled = !user;
}

// --- Covers -----------------------------------------------------------------------

const THUMB = { edge: 600, budget: 150_000 };   // grid: ~40–80 KB
const LARGE = { edge: 1600, budget: 880_000 };  // book page; Firestore rule caps at 900 000

function loadImage(url, cors) {
  return new Promise((res, rej) => {
    const img = new Image();
    if (cors) img.crossOrigin = 'anonymous';
    const t = setTimeout(() => rej(new Error('timeout')), 15000);
    img.onload = () => { clearTimeout(t); img.naturalWidth > 10 ? res(img) : rej(new Error('empty')); };
    img.onerror = () => { clearTimeout(t); rej(new Error(cors ? 'cors' : 'load')); };
    // A separate URL so a cached non-CORS copy (from the lookup's load check) isn't reused.
    img.src = cors ? url + (url.includes('?') ? '&' : '?') + 'c=1' : url;
  });
}

function encode(img, { edge, budget }) {
  const scale = Math.min(1, edge / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; // transparent PNG covers would turn black as JPEG
  g.fillRect(0, 0, w, h);
  g.drawImage(img, 0, 0, w, h);
  for (const q of [0.85, 0.78, 0.7, 0.6, 0.5, 0.4]) {
    const url = c.toDataURL('image/jpeg', q); // throws SecurityError if the source didn't allow CORS
    if (url.length < budget) return url;
  }
  return null;
}

// → { mode: 'copied', thumb, large, w, h, source } | { mode: 'link', url, w, h, source } | null
async function prepareCover(book) {
  if (!book.isbn) return null;
  const res = await lookupAll(book.isbn);
  // Why nothing was found, for the log: source errors (quota, timeouts) vs. genuinely no cover.
  book._why = Object.entries(res.results).filter(([, r]) => r?.error).map(([k, r]) => `${k}: ${r.error}`).join('; ');
  const candidates = res.merged?.covers || [];
  let link = null;
  for (const c of candidates) {
    try {
      const img = await loadImage(c.url, true);
      const thumb = encode(img, THUMB), large = encode(img, LARGE);
      if (thumb && large) return { mode: 'copied', thumb, large, w: img.naturalWidth, h: img.naturalHeight, source: c.source };
    } catch (e) {
      if (!link) {
        try {
          const img = await loadImage(c.url, false);
          link = { mode: 'link', url: c.url, w: img.naturalWidth, h: img.naturalHeight, source: c.source };
        } catch { /* try the next candidate */ }
      }
    }
  }
  return link;
}

$('try').onclick = async () => {
  if (!data) return;
  $('try').disabled = true;
  // A spread: Swedish, Brazilian, English and a few that need Google.
  const pick = pickSample(data.books, 12);
  $('tryout').innerHTML = pick.map((b) => `<figure id="t-${b.id}"><div class="none">${esc(b.title)}</div><figcaption>…</figcaption></figure>`).join('');
  await pool(pick, 4, async (b) => {
    const el = $('t-' + b.id);
    try {
      const c = await prepareCover(b);
      el.innerHTML = c
        ? `<img src="${c.mode === 'copied' ? c.thumb : c.url}" alt=""><figcaption><b>${c.mode === 'copied' ? 'copied' : 'link'}</b> · ${c.source}${c.mode === 'copied' ? ` · ${kb(c.thumb)}/${kb(c.large)} KB` : ''}</figcaption>`
        : `<div class="none">${esc(b.title)}</div><figcaption><b>no cover</b></figcaption>`;
    } catch (e) {
      el.querySelector('figcaption').textContent = 'error: ' + e.message;
    }
  });
  $('try').disabled = false;
};

function pickSample(books, n) {
  const groups = { se: [], br: [], en: [], other: [] };
  for (const b of books) {
    const g = b.isbn?.slice(3);
    (g?.startsWith('91') ? groups.se : g?.startsWith('85') || g?.startsWith('65') ? groups.br : g?.[0] <= '1' ? groups.en : groups.other).push(b);
  }
  const out = [];
  for (let i = 0; out.length < n && i < 50; i++) for (const k of ['se', 'br', 'en', 'en', 'other']) {
    const g = groups[k], b = g[Math.floor((i * 7919 + k.length * 31) % Math.max(g.length, 1))];
    if (b && !out.includes(b) && out.length < n) out.push(b);
  }
  return out;
}

// --- 5. Import ----------------------------------------------------------------------

$('go').onclick = async () => {
  if (!user || !data) return;
  $('go').disabled = true;
  $('progress').hidden = false;
  const redo = $('redo').checked;
  const log = (s) => { $('log').textContent += s + '\n'; $('log').scrollTop = 1e9; };
  const tally = { copied: 0, link: 0, none: 0, skipped: 0, failed: 0 };
  const missing = [];

  try {
    status('Checking what is already there…');
    const [haveBooks, haveAuthors, haveSeries] = await Promise.all(
      ['books', 'authors', 'series'].map(async (c) => new Set((await getDocs(collection(db, c))).docs.map((d) => d.id))));

    // People and series first. Existing ones are left alone, so edits
    // (Wikidata nationality, checked marks) survive a re-run.
    const newPeople = data.authors.filter((a) => !haveAuthors.has(a.id));
    const newSeries = data.series.filter((s) => !haveSeries.has(s.id));
    await writeChunks([
      ...newPeople.map((a) => ['authors', a.id, a]),
      ...newSeries.map((s) => ['series', s.id, s]),
    ]);
    log(`${newPeople.length} people and ${newSeries.length} series added (${data.authors.length - newPeople.length + data.series.length - newSeries.length} already there).`);

    const privates = new Map(data.privates.map((p) => [p.id, p]));
    const todo = data.books.filter((b) => redo || !haveBooks.has(b.id));
    tally.skipped = data.books.length - todo.length;
    if (tally.skipped) log(`${tally.skipped} books already imported, skipped.`);
    let done = 0;
    $('bar').max = todo.length || 1;

    await pool(todo, 3, async (book) => {
      try {
        const cover = await prepareCover(book).catch(() => null);
        const b = writeBatch(db);
        const rec = { ...book, importedAt: serverTimestamp() };
        delete rec.id;
        if (cover?.mode === 'copied') {
          rec.cover = { id: book.id, w: cover.w, h: cover.h, source: cover.source };
          b.set(doc(db, 'covers', book.id), { image: cover.thumb, size: 'thumb', bookId: book.id });
          b.set(doc(db, 'covers', book.id + '-l'), { image: cover.large, size: 'large', bookId: book.id });
        } else if (cover?.mode === 'link') {
          rec.cover = { url: cover.url, w: cover.w, h: cover.h, source: cover.source };
        }
        b.set(doc(db, 'books', book.id), rec);
        const p = { ...privates.get(book.id) };
        delete p.id;
        b.set(doc(db, 'private', book.id), p);
        await b.commit();
        tally[cover?.mode || 'none']++;
        if (!cover) missing.push(book.title);
        log(`${cover ? (cover.mode === 'copied' ? '■' : '□') : '·'} ${book.title}${cover ? ` (${cover.source}${cover.mode === 'link' ? ', link' : ''})` : ' (no cover)'}`);
      } catch (e) {
        tally.failed++;
        log(`✕ ${book.title}: ${e.message}`);
      }
      $('bar').value = ++done;
      status(`${done} of ${todo.length} · ${tally.copied} covers copied · ${tally.link} linked · ${tally.none} without a cover${tally.failed ? ` · ${tally.failed} failed` : ''}`);
    });

    status(`Done. ${tally.copied} covers copied, ${tally.link} linked, ${tally.none} without a cover${tally.failed ? `, ${tally.failed} failed (press Import again to retry them)` : ''}${tally.skipped ? `, ${tally.skipped} skipped` : ''}.`);
    if (missing.length) log('\nNo cover found for:\n' + missing.map((t) => '  ' + t).join('\n'));
  } catch (e) {
    status('Stopped: ' + e.message);
  }
  $('go').disabled = false;
};

async function writeChunks(items) {
  for (let i = 0; i < items.length; i += 400) {
    const b = writeBatch(db);
    for (const [c, id, rec] of items.slice(i, i + 400)) {
      const r = { ...rec };
      delete r.id;
      b.set(doc(db, c, id), r);
    }
    await b.commit();
  }
}

// --- 6. Retry missing covers ---------------------------------------------------------
// Only touches books with no cover. One at a time with a pause, so the sources
// that throttled the parallel import get a fair chance. Doesn't need the CSV.

$('retry').onclick = async () => {
  if (!user) return;
  $('retry').disabled = true;
  $('rprogress').hidden = false;
  const rlog = (s) => { $('rlog').textContent += s + '\n'; $('rlog').scrollTop = 1e9; };
  const rstatus = (s) => { $('rstatus').textContent = s; };
  try {
    rstatus('Finding books without a cover…');
    const snap = await getDocs(query(collection(db, 'books'), where('cover', '==', null)));
    const books = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const t = { copied: 0, link: 0, none: 0 };
    $('rbar').max = books.length || 1;
    let done = 0;
    for (const book of books) {
      let cover = null;
      try { cover = await prepareCover(book); } catch { /* counts as none */ }
      if (cover) {
        const b = writeBatch(db);
        if (cover.mode === 'copied') {
          b.set(doc(db, 'covers', book.id), { image: cover.thumb, size: 'thumb', bookId: book.id });
          b.set(doc(db, 'covers', book.id + '-l'), { image: cover.large, size: 'large', bookId: book.id });
          b.update(doc(db, 'books', book.id), { cover: { id: book.id, w: cover.w, h: cover.h, source: cover.source } });
        } else {
          b.update(doc(db, 'books', book.id), { cover: { url: cover.url, w: cover.w, h: cover.h, source: cover.source } });
        }
        await b.commit();
      }
      t[cover?.mode || 'none']++;
      rlog(`${cover ? (cover.mode === 'copied' ? '■' : '□') : '·'} ${book.title}${cover ? ` (${cover.source}${cover.mode === 'link' ? ', link' : ''})` : book._why ? ` — ${book._why}` : ''}`);
      $('rbar').value = ++done;
      rstatus(`${done} of ${books.length} · ${t.copied} copied · ${t.link} linked · ${t.none} still without`);
      await new Promise((r) => setTimeout(r, 600));
    }
    rstatus(`Done. Found ${t.copied + t.link} more covers (${t.copied} copied, ${t.link} linked); ${t.none} books still without one.`);
  } catch (e) {
    rstatus('Stopped: ' + e.message);
  }
  $('retry').disabled = false;
};

// --- 7. Tidy titles ----------------------------------------------------------------------------
// A fixed list (import/title-fixes.json): shop-listing junk out of titles, edition
// details into the edition note. Only books whose title is still the old one change.

let tidy = [];
$('tidyLoad').onclick = async () => {
  $('tidyLoad').disabled = true;
  const fixes = await (await fetch('title-fixes.json?v=2')).json();
  tidy = [];
  for (const f of fixes) {
    const snap = await getDoc(doc(db, 'books', f.id));
    if (!snap.exists()) continue;
    const b = snap.data();
    if (b.title === f.title) continue; // already tidy
    const note = f.note && !(b.editionNote || '').includes(f.note) ? [b.editionNote, f.note].filter(Boolean).join(', ') : (b.editionNote || null);
    tidy.push({ id: f.id, from: b.title, title: f.title, editionNote: note, addedNote: f.note && note !== (b.editionNote || null) ? f.note : null });
  }
  $('tidyTable').innerHTML = tidy.length
    ? `<table>${tidy.map((t) => `<tr><td class="from">${esc(t.from)}</td><td>${esc(t.title)}${t.addedNote ? `<br><span class="muted">edition note: ${esc(t.addedNote)}</span>` : ''}</td></tr>`).join('')}</table>`
    : '<p class="muted small">Nothing to tidy: every title is already clean.</p>';
  $('tidyApply').hidden = !tidy.length;
  $('tidyApply').textContent = `Apply ${tidy.length} changes`;
  $('tidyLoad').disabled = false;
};
$('tidyApply').onclick = async () => {
  $('tidyApply').disabled = true;
  try {
    const b = writeBatch(db);
    for (const t of tidy) b.update(doc(db, 'books', t.id), { title: t.title, editionNote: t.editionNote });
    await b.commit();
    $('tidyTable').innerHTML = `<p class="small">Done: ${tidy.length} titles tidied. Reload the library to see them.</p>`;
    $('tidyApply').hidden = true;
  } catch (e) {
    $('tidyTable').insertAdjacentHTML('beforeend', `<p class="small" style="color:var(--accent)">Couldn't save: ${esc(e.message)}</p>`);
  }
  $('tidyApply').disabled = false;
};

// --- Helpers --------------------------------------------------------------------------

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) await fn(items[i++]); }));
}
function status(s) { $('status').textContent = s; }
function count(arr) { const o = {}; for (const x of arr) o[x] = (o[x] || 0) + 1; return o; }
function groupBy(arr, f) { const o = {}; for (const x of arr) (o[f(x)] ||= []).push(x); return o; }
function kb(dataUrl) { return Math.round(dataUrl.length * 0.75 / 1024); }
function esc(s) { return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]); }
