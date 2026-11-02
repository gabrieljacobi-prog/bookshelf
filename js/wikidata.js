// Authors on Wikidata: who a name most likely is, and their nationality,
// gender and years, with the reasons each match is likely right or wrong.
// All requests are open to browsers:
// - per name, Wikidata's two searches (by name, and full text limited to people);
// - one query to the Wikidata query service for the details of many people at once;
// - one more that checks whether Wikidata lists a candidate on one of the books
//   they're on in this library (the strongest sign a match is right);
// - for people still unclear, a search for their book's title, to find its
//   author on Wikidata from the other side.

import { OLD_COUNTRIES, cleanNationality } from './nations.js?v=1';

const API = 'https://www.wikidata.org/w/api.php';
const SPARQL = 'https://query.wikidata.org/sparql';

// Occupations that make a match likely to be someone who makes books.
const BOOKISH = [
  'Q36180', 'Q6625963', 'Q49757', 'Q482980', 'Q333634', 'Q1607826', 'Q644687', 'Q715301', 'Q1114448',
  'Q4853732', 'Q18844224', 'Q15949613', 'Q11774202', 'Q1930187', 'Q214917', 'Q28389', 'Q4964182', 'Q201788',
];
const BOOKISH_DESC = /writer|novelist|poet|author|translator|editor|illustrat|comic|cartoonist|essayist|journalist|philosopher|historian|playwright|dramatist|screenwriter|artist|scientist|physicist|biologist|anthropologist|sociologist|economist|chef|cook|designer|photographer|critic|scholar|professor|academic|psycholog|mycologist|naturalist|game designer|publisher|literary/i;
// What a description should say for each role on the books.
const ROLE_DESC = {
  author: /writer|novelist|poet|author|essayist|playwright|dramatist|journalist|historian|philosopher|scientist|scholar|critic|professor|chef|cook|designer|psycholog|biolog|physicist|astronom|anthropolog|economist|theolog|linguist|naturalist|mycolog/i,
  translator: /translat/i,
  artist: /artist|illustrat|comic|cartoonist|painter|graphic|animator|manga/i,
  editor: /editor|anthologist|publisher|writer|critic|scholar/i,
  photographer: /photograph/i,
};
ROLE_DESC.writer = ROLE_DESC.author;
ROLE_DESC.illustrator = ROLE_DESC.artist;
const ROLE_WORD = { author: 'writer', writer: 'writer', translator: 'translator', artist: 'artist', illustrator: 'illustrator', editor: 'editor', photographer: 'photographer' };
// Nationalities that fit a book's language (a Brazilian on a Portuguese book).
const LANG_NATS = {
  pt: /brazil|portug|angol|mozambi|cape verd/i, sv: /swed|finn/i, nl: /dutch|belgi|flemish/i, ja: /japan/i,
  es: /spanish|argentin|mexic|colombia|chile|peru|urugua|cuba|venezuel|bolivia|ecuador|paragua/i,
  fr: /french|belgi|swiss|qu[eé]b|canad|senegal|cameroon|algeria|morocc|tunisia|haiti/i, de: /german|austria|swiss/i,
  it: /italian|florentine|venetian/i, da: /danish/i, no: /norweg/i, pl: /polish/i,
};
const LANG_NAMES = { pt: 'Portuguese', sv: 'Swedish', nl: 'Dutch', ja: 'Japanese', es: 'Spanish', fr: 'French', de: 'German', it: 'Italian', da: 'Danish', no: 'Norwegian', pl: 'Polish' };

// Countries that no longer exist rarely have an English demonym on Wikidata;
// js/nations.js has the table and drops former states next to present-day ones.
const GENDERS = { Q6581072: 'woman', Q6581097: 'man', Q1052281: 'woman', Q2449503: 'man', Q48270: 'non-binary' };
// People, and pen names shared by several (James S. A. Corey).
const PERSONLIKE = ['Q5', 'Q61002', 'Q16017119', 'Q127843'];

const qid = (uri) => String(uri).split('/').pop();
// Letters only: "J. R. R. Tolkien" and "J.R.R. Tolkien" are the same name.
export const nameKey = (s) => String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const lastWord = (s) => nameKey(String(s).trim().split(/\s+/).pop());
const titleKey = (s) => String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));

// Wikidata answers "too busy" either with 429/5xx or with an error inside a 200.
async function getJson(url, opts = {}, tries = 5) {
  for (let i = 0; ; i++) {
    let r = null, j = null;
    try { r = await fetch(url, opts); if (r.ok) j = await r.json(); } catch { /* network: retry */ }
    if (j && !j.error) return j;
    const busy = !r || [429, 500, 502, 503, 504].includes(r.status) || /busy|ratelimit|too many|maxlag/i.test(JSON.stringify(j?.error || ''));
    if (i + 1 >= tries || !busy) throw new Error(r ? `Wikidata said ${j?.error?.code || r.status}` : 'no connection');
    const after = Number(r?.headers?.get('retry-after')) || 0;
    await wait(Math.max(after * 1000, 1200 * 2 ** i) + Math.random() * 600);
  }
}
const sparql = (q) => getJson(`${SPARQL}?format=json`, { method: 'POST', body: new URLSearchParams({ query: q }) });

// Items whose name matches, best first (Q ids, not yet checked to be people).
export async function searchPeople(name) {
  const clean = name.replace(/["\\]/g, ' ').trim();
  const byName = async (q) => {
    const j = await getJson(`${API}?action=wbsearchentities&search=${encodeURIComponent(q)}&language=en&uselang=en&type=item&limit=8&format=json&origin=*`);
    return (j.search || []).map((x) => x.id);
  };
  const fullText = async (q) => {
    const j = await getJson(`${API}?action=query&list=search&srsearch=${encodeURIComponent(`${q} haswbstatement:P31=Q5`)}&srnamespace=0&srlimit=5&srprop=&format=json&origin=*`);
    return (j.query?.search || []).map((x) => x.title);
  };
  const [a, b] = await Promise.all([byName(clean), fullText(clean)]);
  let ids = [...a, ...b];
  // "Ursula Kroeber Le Guin" style names: try first and last name only.
  const words = clean.split(/\s+/);
  if (!ids.length && words.length > 2) ids = await byName(`${words[0]} ${words.at(-1)}`);
  return [...new Set(ids.filter((t) => /^Q\d+$/.test(t)))];
}

const year = (d) => {
  const m = /^(-?)0*(\d+)-/.exec(d || '');
  return m ? Number(m[2]) * (m[1] ? -1 : 1) : null;
};
// A country's English demonym, preferring the adjective ("British", not "Briton").
function demonymOf(label, dems) {
  if (OLD_COUNTRIES[label]) return OLD_COUNTRIES[label];
  const adj = dems.filter((d) => /(ish|ian|an|ese|ic|ch|i|ean|ot)$/i.test(d));
  const pool = (adj.length ? adj : dems).sort((a, b) => a.length - b.length);
  return pool[0] || label || null;
}

// Details for many items at once; only people come back:
// { Q…: { id, label, about, names, nationality, gender, born, died, bookish, links } }.
export async function peopleDetails(ids) {
  const out = {};
  for (let i = 0; i < ids.length; i += 50) {
    const part = ids.slice(i, i + 50);
    const j = await sparql(`SELECT ?item (SAMPLE(?l) AS ?label) (SAMPLE(?d) AS ?desc)
  (GROUP_CONCAT(DISTINCT ?n; separator="|") AS ?names)
  (GROUP_CONCAT(DISTINCT CONCAT(STR(?g), "~", ?gl); separator="|") AS ?genders)
  (GROUP_CONCAT(DISTINCT CONCAT(STR(?c), "~", ?cl, "~", ?dm); separator="|") AS ?countries)
  (SAMPLE(?b) AS ?born) (SAMPLE(?x) AS ?died) (SAMPLE(?sl) AS ?links) (MAX(?w) AS ?bookish)
WHERE {
  VALUES ?item { ${part.map((x) => 'wd:' + x).join(' ')} }
  ?item wdt:P31 ?kind . VALUES ?kind { ${PERSONLIKE.map((x) => 'wd:' + x).join(' ')} }
  OPTIONAL { ?item rdfs:label ?l FILTER(LANG(?l) = "en") }
  OPTIONAL { ?item schema:description ?d FILTER(LANG(?d) = "en") }
  OPTIONAL { { ?item rdfs:label ?n } UNION { ?item skos:altLabel ?n } FILTER(LANG(?n) IN ("mul","en","pt","sv","nl","es","fr","de","it","pl","da","no","ja")) }
  OPTIONAL { ?item wdt:P21 ?g . OPTIONAL { ?g rdfs:label ?gl0 FILTER(LANG(?gl0) = "en") } BIND(COALESCE(?gl0, "") AS ?gl) }
  OPTIONAL { ?item wdt:P27 ?c .
    OPTIONAL { ?c rdfs:label ?cl0 FILTER(LANG(?cl0) = "en") }
    OPTIONAL { ?c wdt:P1549 ?dm0 FILTER(LANG(?dm0) = "en") }
    BIND(COALESCE(?cl0, "") AS ?cl) BIND(COALESCE(STR(?dm0), "") AS ?dm) }
  OPTIONAL { ?item wdt:P569 ?b }
  OPTIONAL { ?item wdt:P570 ?x }
  OPTIONAL { ?item wikibase:sitelinks ?sl }
  OPTIONAL { ?item wdt:P106 ?o . VALUES ?o { ${BOOKISH.map((x) => 'wd:' + x).join(' ')} } BIND(1 AS ?w) }
} GROUP BY ?item`);
    for (const r of j.results?.bindings || []) {
      const v = (k) => r[k]?.value ?? '';
      const id = qid(v('item'));
      // Countries in the order given, each once, with its demonyms.
      const cs = new Map();
      for (const s of v('countries').split('|').filter(Boolean)) {
        const [c, label, dem] = s.split('~');
        const e = cs.get(c) || { label, dems: [] };
        if (dem) e.dems.push(dem);
        cs.set(c, e);
      }
      const nats = [...new Set([...cs.values()].map((e) => demonymOf(e.label, e.dems)).filter(Boolean))];
      const g = v('genders').split('|').filter(Boolean).map((s) => { const [u, l] = s.split('~'); return GENDERS[qid(u)] || l || null; }).filter(Boolean);
      const about = v('desc');
      out[id] = {
        id, label: v('label') || v('names').split('|')[0] || id, about,
        names: v('names').split('|').filter(Boolean),
        nationality: cleanNationality(nats.join(' / ')) || null,
        gender: [...new Set(g)].join(' / ') || null,
        born: year(v('born')), died: year(v('died')),
        bookish: v('bookish') === '1' || BOOKISH_DESC.test(about),
        links: Number(v('links')) || 0,
      };
    }
  }
  return out;
}

// Which (candidate, title) pairs Wikidata links: the candidate is credited on a
// work (or an edition of it) with that title. Returns Map Q id → Set of title keys.
async function titleLinks(pairs) {
  const hits = new Map();
  for (let i = 0; i < pairs.length; i += 150) {
    const part = pairs.slice(i, i + 150);
    const j = await sparql(`SELECT DISTINCT ?item ?t WHERE {
  VALUES (?item ?t) { ${part.map(([q, t]) => `(wd:${q} ${JSON.stringify(t)})`).join(' ')} }
  { ?w wdt:P50|wdt:P655|wdt:P110|wdt:P98|wdt:P170|wdt:P58 ?item } UNION { ?e wdt:P655|wdt:P110|wdt:P98|wdt:P50 ?item ; wdt:P629 ?w }
  ?w rdfs:label|wdt:P1476 ?l .
  FILTER(LCASE(STR(?l)) = ?t)
}`);
    for (const r of j.results?.bindings || []) {
      const q = qid(r.item.value);
      if (!hits.has(q)) hits.set(q, new Set());
      hits.get(q).add(r.t.value);
    }
  }
  return hits;
}
// A book's title as Wikidata would have it (lowercase), with and without the subtitle.
const titleForms = (b) => [...new Set([b.title, b.subtitle ? `${b.title}: ${b.subtitle}` : null].filter(Boolean).map((t) => String(t).toLowerCase().trim()))];

// From the other side: works with this title on Wikidata, and the people credited on them.
async function creatorsOfTitles(titles) {
  const works = new Map(); // work Q id → title key it was found for
  for (const t of titles) {
    try {
      const j = await getJson(`${API}?action=query&list=search&srsearch=${encodeURIComponent(`${t.replace(/["\\]/g, ' ')} haswbstatement:P50`)}&srnamespace=0&srlimit=4&srprop=&format=json&origin=*`);
      for (const x of j.query?.search || []) if (!works.has(x.title)) works.set(x.title, t);
    } catch { /* skip this title */ }
  }
  if (!works.size) return [];
  const j = await sparql(`SELECT DISTINCT ?w ?item ?wl WHERE {
  VALUES ?w { ${[...works.keys()].map((x) => 'wd:' + x).join(' ')} }
  ?w wdt:P50|wdt:P110|wdt:P98|wdt:P58 ?item .
  ?w rdfs:label ?wl .
}`);
  // Keep a work only if one of its labels is the title searched for.
  const ok = new Map();
  for (const r of j.results?.bindings || []) {
    const w = qid(r.w.value), t = works.get(w);
    if (t && titleKey(r.wl.value) === titleKey(t)) ok.set(`${w}|${qid(r.item.value)}`, { item: qid(r.item.value), t });
  }
  return [...ok.values()];
}

// How each candidate fits the name and the books, and how sure the best one is:
// 'certain' — Wikidata lists them on one of the books;
// 'likely'  — same name, and the description fits what they did on the books, no rival as good;
// 'check'   — a best guess, with its reasons;
// 'none'    — nobody found.
export function rank(person, ids, details, links = new Map()) {
  const { name, books = [] } = person;
  const k = nameKey(name), last = lastWord(name);
  const roles = [...new Set(books.map((b) => b.role))];
  const langs = [...new Set(books.map((b) => b.language).filter((l) => LANG_NATS[l]))];
  const firstYear = Math.min(...books.map((b) => Number(b.year) || 9999));
  const byKey = new Map(books.flatMap((b) => titleForms(b).map((t) => [t, b.title])));
  const surnameOf = (c) => [c.label, ...(details[c.id]?.names || [])].some((n) => lastWord(n) === last);
  const cands = ids.map((id) => details[id]).filter(Boolean).map((d, i) => {
    const keys = [d.label, ...d.names].map(nameKey);
    const exact = keys.includes(k);
    const surname = !exact && [d.label, ...d.names].some((n) => lastWord(n) === last);
    const onBooks = [...(links.get(d.id) || [])].map((t) => byKey.get(t) || t);
    const fitRole = roles.find((r) => ROLE_DESC[r]?.test(d.about));
    const fitLang = langs.find((l) => LANG_NATS[l].test(d.nationality || ''));
    const tooYoung = d.born != null && firstYear < 9999 && d.born > firstYear - 12;
    const why = [];
    if (onBooks.length) why.push({ good: true, strong: true, text: `Wikidata lists them on ${onBooks.slice(0, 2).map((t) => `“${t}”`).join(' and ')}` });
    if (exact) why.push({ good: true, text: 'Same name' });
    else if (surname) why.push({ good: false, text: `Name differs (${d.label})` });
    if (fitRole) why.push({ good: true, text: `Known as a ${ROLE_WORD[fitRole]}` });
    else if (d.bookish) why.push({ good: true, text: 'Known for books' });
    else why.push({ good: false, text: d.about ? `Not known for books (${d.about})` : 'Nothing on Wikidata says what they do' });
    if (fitLang) why.push({ good: true, text: `${d.nationality}, and the book is in ${LANG_NAMES[fitLang]}` });
    if (tooYoung) why.push({ good: false, text: `Born ${d.born}, too late for a book from ${firstYear}` });
    const score = (onBooks.length ? 10 : 0) + (exact ? 3 : surname ? 1 : 0) + (fitRole ? 2.5 : d.bookish ? 1.5 : 0) + (fitLang ? 1 : 0)
      - (tooYoung ? 5 : 0) + Math.min(1, Math.log10(1 + d.links) / 2.5) - i * 0.1;
    return { ...d, exact, onBooks: onBooks.length > 0, roleFit: !!fitRole, fit: !!(fitRole || d.bookish), tooYoung, score, why };
  }).filter((c) => c.onBooks || c.exact || (surnameOf(c) && c.score >= 2.5)).sort((a, b) => b.score - a.score);
  const [a, b] = cands;
  let level = 'none';
  if (a) {
    // Someone else with the name who fits as well (as a translator, if the first one is known as one).
    const rival = b && b.exact && !b.tooYoung && !a.onBooks && (a.roleFit ? b.roleFit : b.fit) && b.score > a.score - 1.5;
    level = a.onBooks && (a.exact || !(b && b.onBooks)) ? 'certain'
      : a.exact && a.fit && !a.tooYoung && !rival ? 'likely' : 'check';
  }
  // Only what's shown and saved (the list of other names can be long).
  const slim = ({ id, label, about, nationality, gender, born, died, why }) => ({ id, label, about, nationality, gender, born, died, why });
  return { level, cands: cands.slice(0, 4).map(slim) };
}

// One person ({ name, books: [{ title, subtitle, role, language, year }] }): search, details, books, ranking.
export async function lookupPerson(person) {
  const [r] = (await lookupMany([{ id: 'one', ...person }])).values();
  if (r.error) throw new Error(r.error);
  return r;
}

// Many people ([{ id, name, books }]). onProgress(done, total, phase).
// Returns Map id → { level, cands } or { error }.
export async function lookupMany(people, onProgress = () => {}) {
  const found = new Map();
  let done = 0, next = 0;
  const worker = async () => {
    while (next < people.length) {
      const p = people[next++];
      try { found.set(p.id, await searchPeople(p.name)); }
      catch (e) { found.set(p.id, { error: e.message }); }
      onProgress(++done, people.length, 'search');
    }
  };
  await Promise.all([worker(), worker(), worker()]);

  const all = [...new Set([...found.values()].filter(Array.isArray).flat())];
  const details = {};
  for (let i = 0; i < all.length; i += 150) {
    onProgress(i, all.length, 'details');
    Object.assign(details, await peopleDetails(all.slice(i, i + 150)));
  }

  // Is each candidate credited on Wikidata for one of this person's books?
  onProgress(0, 1, 'books');
  const pairs = [];
  for (const p of people) {
    const ids = found.get(p.id);
    if (!Array.isArray(ids)) continue;
    for (const id of ids) if (details[id]) for (const b of p.books || []) for (const t of titleForms(b)) pairs.push([id, t]);
  }
  let links = new Map();
  try { links = await titleLinks(pairs); } catch { /* the ranking works without it */ }

  const out = new Map();
  for (const p of people) {
    const ids = found.get(p.id);
    out.set(p.id, Array.isArray(ids) ? rank(p, ids, details, links) : { error: ids?.error || 'failed', level: 'none', cands: [] });
  }

  // Still unclear: look for their book on Wikidata and take its author from there.
  const unclear = people.filter((p) => ['check', 'none'].includes(out.get(p.id)?.level) && p.books?.length);
  let n = 0, at = 0;
  const rescue = async () => {
    while (at < unclear.length) {
      const p = unclear[at++];
      try {
        const credits = await creatorsOfTitles(p.books.slice(0, 2).map((b) => b.title));
        onProgress(++n, unclear.length, 'rescue');
        if (!credits.length) continue;
        const k = nameKey(p.name), last = lastWord(p.name);
        const had = Array.isArray(found.get(p.id)) ? found.get(p.id) : [];
        const fresh = [...new Set(credits.map((c) => c.item))].filter((q) => !details[q]);
        const det = { ...details, ...(fresh.length ? await peopleDetails(fresh) : {}) };
        // Only credited people whose name matches this one count.
        const named = (q) => det[q] && [det[q].label, ...det[q].names].some((x) => nameKey(x) === k || lastWord(x) === last);
        const pl = new Map(links);
        for (const c of credits) {
          if (!named(c.item)) continue;
          if (!pl.has(c.item)) pl.set(c.item, new Set());
          pl.get(c.item).add(c.t.toLowerCase().trim());
        }
        const ids = [...new Set([...had, ...credits.map((c) => c.item).filter(named)])];
        const r = rank(p, ids, det, pl);
        if (r.level !== 'none') out.set(p.id, r);
      } catch { onProgress(++n, unclear.length, 'rescue'); /* keep what we had */ }
    }
  };
  await Promise.all([rescue(), rescue(), rescue()]);
  return out;
}

// The fields an author record gets from a chosen match.
export const fieldsFrom = (c) => ({
  wikidata: c.id, about: c.about || null, nationality: c.nationality, gender: c.gender,
  born: c.born, died: c.died, checked: true, lookedUp: true, source: 'wikidata',
});

export const wikidataUrl = (id) => `https://www.wikidata.org/wiki/${encodeURIComponent(id)}`;
