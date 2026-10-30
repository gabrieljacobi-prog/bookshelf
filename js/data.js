// Firebase setup and every read/write the app makes.
// Firestore keeps a local copy on the phone, so the library opens from cache
// and then refreshes from the server.

import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, signOut, onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, getDocs, getDocsFromCache, getDoc, getDocFromCache, setDoc, updateDoc, writeBatch,
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

// Calls onData once from the local cache (if any) and again from the server.
export async function loadCatalogue(onData) {
  const names = ['books', 'authors', 'series'];
  try {
    const cached = await Promise.all(names.map((n) => getDocsFromCache(collection(db, n))));
    if (cached[0].size) onData(...cached.map(toMap), { fromCache: true });
  } catch { /* no cache yet */ }
  const fresh = await Promise.all(names.map((n) => getDocs(collection(db, n))));
  onData(...fresh.map(toMap), { fromCache: false });
}

export async function loadPrivate() {
  return toMap(await getDocs(collection(db, 'private')));
}

// Cover images: thumb for the grid, large ("-l") for the book page.
const coverMem = new Map();
export async function coverImage(bookId, size = 'thumb') {
  const id = size === 'large' ? bookId + '-l' : bookId;
  if (coverMem.has(id)) return coverMem.get(id);
  const p = (async () => {
    const ref = doc(db, 'covers', id);
    let snap;
    try { snap = await getDocFromCache(ref); } catch { snap = await getDoc(ref); }
    return snap.exists() ? snap.data().image : null;
  })();
  coverMem.set(id, p);
  p.catch(() => coverMem.delete(id));
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

// A new cover copied into Firestore: thumb + large, and the book's cover field.
export async function saveCover(bookId, { thumb, large, w, h, source }, extra = {}) {
  const b = writeBatch(db);
  b.set(doc(db, 'covers', bookId), { image: thumb, size: 'thumb', bookId });
  b.set(doc(db, 'covers', bookId + '-l'), { image: large, size: 'large', bookId });
  b.update(doc(db, 'books', bookId), { cover: { id: bookId, w, h, source }, ...extra });
  await b.commit();
  coverMem.delete(bookId); coverMem.delete(bookId + '-l');
}

// The edit form: the book plus any new author or series records, in one batch.
export async function saveEdits(bookId, fields, newAuthors = [], newSeries = null) {
  const b = writeBatch(db);
  b.update(doc(db, 'books', bookId), fields);
  for (const a of newAuthors) { const { id, ...rest } = a; b.set(doc(db, 'authors', id), rest); }
  if (newSeries) b.set(doc(db, 'series', newSeries.id), { name: newSeries.name });
  await b.commit();
}
