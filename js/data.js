// Firebase setup and every read/write the app makes.
// Firestore keeps a local copy on the phone, so the library opens from cache
// and then refreshes from the server; after that the app listens live, so a
// change made on the other phone shows up without a reload.

import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, signOut, onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, getDocs, getDocsFromCache, getDoc, onSnapshot, getDocFromCache, setDoc, updateDoc, writeBatch,
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
  db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
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

const toMap = (snap) => new Map(snap.docs.map((d) => [d.id, { id: d.id, ...d.data() }]));

// Calls onData(books, authors, series, { fromCache }) as soon as all three are
// there (first from the phone's cache, if any), then again whenever any of them
// changes, on this phone or another. Snapshots of this phone's own unconfirmed
// writes are skipped: the app has already applied those itself.
export function watchCatalogue(onData, onError) {
  const names = ['books', 'authors', 'series'];
  const maps = [null, null, null];
  const fromCache = [true, true, true];
  const unsubs = names.map((n, i) => onSnapshot(collection(db, n), (snap) => {
    const first = !maps[i];
    if (!first && snap.metadata.hasPendingWrites) return;
    maps[i] = toMap(snap);
    fromCache[i] = snap.metadata.fromCache;
    if (maps.every(Boolean)) onData(...maps, { fromCache: fromCache.some(Boolean) });
  }, onError));
  return () => unsubs.forEach((u) => u());
}

// Read status, loans and notes (members only), live like the catalogue.
export function watchPrivate(onData, onError) {
  let seen = false;
  return onSnapshot(collection(db, 'private'), (snap) => {
    if (seen && snap.metadata.hasPendingWrites) return;
    seen = true;
    onData(toMap(snap));
  }, onError);
}

// Cover images: thumb for the grid, large ("-l") for the book page.
// Reads try the device's cache first, so a cover changed on another device (or
// browser) would stay stale there. Each saved cover carries a version `v`, in the
// book's cover field and in both cover docs; when the cached doc's v doesn't match
// the book's (the book list always comes fresh from the server), it is fetched
// again. Covers changed before versions existed have no v: those (all marked
// verified) are fetched from the server once per device, remembered in localStorage.
const coverMem = new Map();
const REFRESHED = 'coversRefreshed';
let refreshed;
function legacyDone(id) {
  if (!refreshed) { try { refreshed = new Set(JSON.parse(localStorage.getItem(REFRESHED)) || []); } catch { refreshed = new Set(); } }
  return refreshed.has(id);
}
function markLegacyDone(id) {
  refreshed.add(id);
  try { localStorage.setItem(REFRESHED, JSON.stringify([...refreshed])); } catch { /* private window */ }
}

export async function coverImage(bookId, size = 'thumb', book = null) {
  const id = size === 'large' ? bookId + '-l' : bookId;
  const v = book?.cover?.v ?? null;
  const legacy = v == null && book?.verified && !legacyDone(id);
  const key = id + '@' + (v ?? '') + (legacy ? '!' : '');
  if (coverMem.has(key)) return coverMem.get(key);
  const p = (async () => {
    const ref = doc(db, 'covers', id);
    let snap = null;
    if (!legacy) {
      try {
        const c = await getDocFromCache(ref);
        if (c.exists() && (c.data().v ?? null) === v) snap = c;
      } catch { /* not cached */ }
    }
    if (!snap) {
      snap = await getDoc(ref);
      if (legacy) markLegacyDone(id);
    }
    return snap.exists() ? snap.data().image : null;
  })();
  coverMem.set(key, p);
  p.catch(() => coverMem.delete(key));
  return p;
}

// --- Writes (members only; the rules enforce it) ---------------------------------

export function savePrivate(bookId, fields) {
  return setDoc(doc(db, 'private', bookId), fields, { merge: true });
}

export function updateBook(bookId, fields) {
  return updateDoc(doc(db, 'books', bookId), fields);
}

// Many books at once ([[id, fields], …]), in batches under Firestore's 500-write limit.
export async function updateBooks(updates) {
  for (let i = 0; i < updates.length; i += 450) {
    const b = writeBatch(db);
    for (const [id, fields] of updates.slice(i, i + 450)) b.update(doc(db, 'books', id), fields);
    await b.commit();
  }
}

// Mixed writes ([{ op: 'update' | 'set' | 'delete', col, id, data }]), for merging
// people and publishers, in batches under Firestore's 500-write limit.
export async function applyOps(ops) {
  for (let i = 0; i < ops.length; i += 450) {
    const b = writeBatch(db);
    for (const o of ops.slice(i, i + 450)) {
      const ref = doc(db, o.col, o.id);
      if (o.op === 'delete') b.delete(ref);
      else if (o.op === 'set') b.set(ref, o.data);
      else b.update(ref, o.data);
    }
    await b.commit();
  }
}

// A new cover copied into Firestore: thumb + large, and the book's cover field.
export async function saveCover(bookId, { thumb, large, w, h, source }, extra = {}) {
  const v = Date.now();
  const b = writeBatch(db);
  b.set(doc(db, 'covers', bookId), { image: thumb, size: 'thumb', bookId, v });
  b.set(doc(db, 'covers', bookId + '-l'), { image: large, size: 'large', bookId, v });
  b.update(doc(db, 'books', bookId), { cover: { id: bookId, w, h, source, v }, ...extra });
  await b.commit();
  return v;
}

// The edit form: the book plus any new author or series records, and a new
// copied cover ({ thumb, large, w, h, source }) if one was chosen, in one batch.
export async function saveEdits(bookId, fields, newAuthors = [], newSeries = null, cover = null) {
  const b = writeBatch(db);
  const v = Date.now();
  if (cover) {
    b.set(doc(db, 'covers', bookId), { image: cover.thumb, size: 'thumb', bookId, v });
    b.set(doc(db, 'covers', bookId + '-l'), { image: cover.large, size: 'large', bookId, v });
    fields = { ...fields, cover: { id: bookId, w: cover.w, h: cover.h, source: cover.source, v } };
  }
  b.update(doc(db, 'books', bookId), fields);
  for (const a of newAuthors) { const { id, ...rest } = a; b.set(doc(db, 'authors', id), rest); }
  if (newSeries) b.set(doc(db, 'series', newSeries.id), { name: newSeries.name });
  await b.commit();
  return fields;
}

// A new book (Add book): a fresh id, then the book, its cover docs, any new
// author or series records and who has read it, all in one batch.
export const newBookId = () => doc(collection(db, 'books')).id;

export async function addBook(bookId, fields, newAuthors = [], newSeries = null, cover = null, priv = null) {
  const b = writeBatch(db);
  const v = Date.now();
  if (cover) {
    b.set(doc(db, 'covers', bookId), { image: cover.thumb, size: 'thumb', bookId, v });
    b.set(doc(db, 'covers', bookId + '-l'), { image: cover.large, size: 'large', bookId, v });
    fields = { ...fields, cover: { id: bookId, w: cover.w, h: cover.h, source: cover.source, v } };
  }
  b.set(doc(db, 'books', bookId), fields);
  for (const a of newAuthors) { const { id, ...rest } = a; b.set(doc(db, 'authors', id), rest); }
  if (newSeries) b.set(doc(db, 'series', newSeries.id), { name: newSeries.name });
  if (priv) b.set(doc(db, 'private', bookId), priv, { merge: true });
  await b.commit();
  return fields;
}
