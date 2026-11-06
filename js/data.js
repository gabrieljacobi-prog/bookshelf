// Firebase setup and every read/write the app makes.
// Firestore keeps a local copy on the phone. The library opens from that copy
// and then asks the server only for what changed since this phone last synced
// (every write stamps `updatedAt`), listening live so a change made on the
// other phone shows up without a reload. That keeps the free plan's 50,000
// reads a day for real use: an open costs a few reads, not the whole catalogue.

import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, signOut, onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, getDocsFromCache, getDoc, onSnapshot, getDocFromCache, setDoc, updateDoc, writeBatch,
  query, where, getCountFromServer, serverTimestamp, Timestamp, CACHE_SIZE_UNLIMITED,
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js?v=3';

export const MEMBERS = {
  'gabriel.jacobi@gmail.com': 'flor',
  'ingrid.skare@gmail.com': 'ingrid',
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
let db;
try {
  // No size limit: with a limit, large covers could push the catalogue out of the
  // cache (Firestore clears the oldest entries first), and the next open would
  // then read the whole catalogue again. Catalogue plus every cover stays well
  // under what the browser allows a site.
  db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager(), cacheSizeBytes: CACHE_SIZE_UNLIMITED }) });
} catch {
  db = initializeFirestore(app, {}); // private windows can't keep a cache
}

// --- Auth -------------------------------------------------------------------

export function onUser(cb) {
  onAuthStateChanged(auth, (u) => cb(u ? { email: u.email, member: MEMBERS[u.email] || null } : null));
}
export async function signIn() {
  const p = new GoogleAuthProvider();
  try { await signInWithPopup(auth, p); }
  catch (e) {
    // Mobile browsers often block the popup; a redirect always works.
    if (/popup/.test(e.code || '')) await signInWithRedirect(auth, p);
    else throw e;
  }
}
export const signOutUser = () => signOut(auth);

// --- Reads --------------------------------------------------------------------

// One collection, kept in step with the server:
// - The phone's cached copy is shown first.
// - If this phone has synced before, one count query (1 read) checks the copy
//   is complete; then only documents with `updatedAt` after the last sync are
//   asked for, live. An open with nothing new costs about 1–2 reads.
// - Otherwise (first visit on this phone, or the cache cleared or incomplete)
//   the whole collection is read once; then it switches to listening for
//   changes only. (A listener left on the whole collection would read all of
//   it again after the phone had slept for half an hour.)
// Removed authors are kept as { deleted: true } so other phones see the removal;
// they're left out of what the app gets.
const sinceKey = (n) => 'sync:' + n;
const getSince = (n) => { try { return Number(localStorage.getItem(sinceKey(n))) || 0; } catch { return 0; } };
const setSince = (n, ms) => { try { localStorage.setItem(sinceKey(n), String(ms)); } catch { /* private window */ } };
const MARGIN = 60_000; // ask a minute further back than strictly needed

function syncCollection(name, onData, onError) {
  const col = collection(db, name);
  const raw = new Map();
  let latest = 0, unsub = null, stopped = false, emitted = false;
  const live = () => new Map([...raw].filter(([, d]) => !d.deleted));
  const take = (d) => {
    const data = d.data();
    raw.set(d.id, { id: d.id, ...data });
    const t = data.updatedAt?.toMillis?.() || 0;
    if (t > latest) latest = t;
  };
  const emit = (fromCache) => { emitted = true; onData(live(), { fromCache }); };

  const changedSince = (ms) => query(col, where('updatedAt', '>', Timestamp.fromMillis(ms - MARGIN)));
  const listen = (q, full) => {
    if (stopped) return;
    unsub = onSnapshot(q, (snap) => {
      for (const ch of snap.docChanges()) {
        if (ch.type === 'removed') { if (full) raw.delete(ch.doc.id); } // a pending local write briefly drops out of a "since" query
        else take(ch.doc);
      }
      const { fromCache, hasPendingWrites } = snap.metadata;
      const synced = !fromCache && !hasPendingWrites;
      // Synced up to the newest stamp seen. If nothing is stamped yet (documents
      // from before stamping), any later change will carry a server time after
      // now, so now (an hour back, for a phone clock that's off) is safe.
      const to = latest || Date.now() - 3_600_000;
      if (synced) setSince(name, to);
      // This phone's own unconfirmed writes: the app has already applied those.
      if (!(emitted && hasPendingWrites)) emit(fromCache);
      // The whole collection is here now: from here on, only what changes.
      if (full && synced) { unsub(); listen(changedSince(to), false); }
    }, onError);
  };

  (async () => {
    const since = getSince(name);
    let cached = [];
    try { cached = (await getDocsFromCache(col)).docs; } catch { /* no cache */ }
    if (since && cached.length) {
      cached.forEach(take);
      emit(true);
      let complete = true;
      try { complete = (await getCountFromServer(col)).data().count === cached.length; }
      catch { /* offline or out of reads: keep the copy and try the live query */ }
      if (complete) { listen(changedSince(since), false); return; }
      raw.clear(); latest = 0;
    }
    listen(col, true);
  })().catch(onError);

  return () => { stopped = true; unsub?.(); };
}

// Calls onData(books, authors, series, { fromCache }) as soon as all three are
// there (first from the phone's cache, if any), then again whenever any of them
// changes, on this phone or another.
export function watchCatalogue(onData, onError) {
  const names = ['books', 'authors', 'series'];
  const maps = [null, null, null];
  const fromCache = [true, true, true];
  const stops = names.map((n, i) => syncCollection(n, (m, meta) => {
    maps[i] = m;
    fromCache[i] = meta.fromCache;
    if (maps.every(Boolean)) onData(...maps, { fromCache: fromCache.some(Boolean) });
  }, onError));
  return () => stops.forEach((s) => s());
}

// Read status, loans and notes (members only), kept in step the same way.
export function watchPrivate(onData, onError) {
  return syncCollection('private', (m) => onData(m), onError);
}

// Every write to books, authors, series and private carries this.
const stamp = (fields) => ({ ...fields, updatedAt: serverTimestamp() });

// Cover images: thumb for the grid, large ("-l") for the book page.
// Reads try the device's cache first, so a cover changed on another device (or
// browser) would stay stale there. Each saved cover carries a version `v`, in the
// book's cover field and in both cover docs; when the cached doc's v doesn't match
// the book's (the book list always comes fresh from the server), it is fetched
// again. Covers changed before versions existed have no v: those (all marked
// verified) are fetched from the server once per device, remembered in localStorage.
// The image comes back as a blob: link (a short address for the picture held in
// memory), not the base64 text itself: the grid is redrawn as HTML, and pasting
// hundreds of base64 covers into it on every redraw was slow. Thumbs stay for the
// visit; only the last few large ones are kept.
const coverMem = new Map();
const LARGE_KEPT = 4;
const largeKeys = [];
async function blobUrl(dataUrl) {
  if (!dataUrl) return null;
  try { return URL.createObjectURL(await (await fetch(dataUrl)).blob()); }
  catch { return dataUrl; }
}
function keepLarge(key) {
  largeKeys.push(key);
  while (largeKeys.length > LARGE_KEPT) {
    const old = largeKeys.shift();
    const p = coverMem.get(old);
    coverMem.delete(old);
    p?.then((u) => { if (u?.startsWith('blob:')) URL.revokeObjectURL(u); }, () => {});
  }
}
export async function coverImage(bookId, size = 'thumb', book = null) {
  const id = size === 'large' ? bookId + '-l' : bookId;
  const v = book?.cover?.v ?? null;
  const key = id + '@' + (v ?? '');
  if (coverMem.has(key)) return coverMem.get(key);
  const p = (async () => {
    const ref = doc(db, 'covers', id);
    let snap = null;
    try {
      const c = await getDocFromCache(ref);
      if (c.exists() && (c.data().v ?? null) === v) snap = c;
    } catch { /* not cached */ }
    if (!snap) snap = await getDoc(ref);
    return blobUrl(snap.exists() ? snap.data().image : null);
  })();
  coverMem.set(key, p);
  p.catch(() => coverMem.delete(key));
  if (size === 'large') keepLarge(key);
  return p;
}

// --- Writes (members only; the rules enforce it) ---------------------------------

export function savePrivate(bookId, fields) {
  return setDoc(doc(db, 'private', bookId), stamp(fields), { merge: true });
}

export function updateBook(bookId, fields) {
  return updateDoc(doc(db, 'books', bookId), stamp(fields));
}

// Many books at once ([[id, fields], …]), in batches under Firestore's 500-write limit.
export async function updateBooks(updates) {
  for (let i = 0; i < updates.length; i += 450) {
    const b = writeBatch(db);
    for (const [id, fields] of updates.slice(i, i + 450)) b.update(doc(db, 'books', id), stamp(fields));
    await b.commit();
  }
}

// Mixed writes ([{ op: 'update' | 'set' | 'delete', col, id, data }]), for merging
// people and publishers, in batches under Firestore's 500-write limit.
// A delete keeps the document as { deleted: true } so other phones see it go.
export async function applyOps(ops) {
  for (let i = 0; i < ops.length; i += 450) {
    const b = writeBatch(db);
    for (const o of ops.slice(i, i + 450)) {
      const ref = doc(db, o.col, o.id);
      if (o.op === 'delete') b.set(ref, stamp({ deleted: true }));
      else if (o.op === 'set') b.set(ref, stamp(o.data));
      else b.update(ref, stamp(o.data));
    }
    await b.commit();
  }
}

// A copied cover ({ thumb, large, w, h, source }) into a batch: both cover docs,
// with a new version. Returns the book's cover field.
function putCover(b, bookId, { thumb, large, w, h, source }) {
  const v = Date.now();
  b.set(doc(db, 'covers', bookId), { image: thumb, size: 'thumb', bookId, v });
  b.set(doc(db, 'covers', bookId + '-l'), { image: large, size: 'large', bookId, v });
  return { id: bookId, w, h, source, v };
}

// A new cover copied into Firestore: thumb + large, and the book's cover field.
export async function saveCover(bookId, cover, extra = {}) {
  const b = writeBatch(db);
  const field = putCover(b, bookId, cover);
  b.update(doc(db, 'books', bookId), stamp({ cover: field, ...extra }));
  await b.commit();
  return field.v;
}

// The edit form: the book plus any new author or series records, and a new
// copied cover ({ thumb, large, w, h, source }) if one was chosen, in one batch.
export async function saveEdits(bookId, fields, newAuthors = [], newSeries = null, cover = null) {
  const b = writeBatch(db);
  if (cover) fields = { ...fields, cover: putCover(b, bookId, cover) };
  b.update(doc(db, 'books', bookId), stamp(fields));
  for (const a of newAuthors) { const { id, ...rest } = a; b.set(doc(db, 'authors', id), stamp(rest)); }
  if (newSeries) b.set(doc(db, 'series', newSeries.id), stamp({ name: newSeries.name }));
  await b.commit();
  return fields;
}

// A new book (Add book): a fresh id, then the book, its cover docs, any new
// author or series records and who has read it, all in one batch.
export const newBookId = () => doc(collection(db, 'books')).id;

export async function addBook(bookId, fields, newAuthors = [], newSeries = null, cover = null, priv = null) {
  const b = writeBatch(db);
  if (cover) fields = { ...fields, cover: putCover(b, bookId, cover) };
  b.set(doc(db, 'books', bookId), stamp(fields));
  for (const a of newAuthors) { const { id, ...rest } = a; b.set(doc(db, 'authors', id), stamp(rest)); }
  if (newSeries) b.set(doc(db, 'series', newSeries.id), stamp({ name: newSeries.name }));
  if (priv) b.set(doc(db, 'private', bookId), stamp(priv), { merge: true });
  await b.commit();
  return fields;
}
