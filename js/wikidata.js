// Authors on Wikidata: who a name most likely is, and their nationality,
// gender and years. Two kinds of request, both open to browsers (origin=*):
// - a search per name, limited to people (items that are "instance of: human");
// - one query to the Wikidata query service for the details of many people at once.
// Only the few fields we keep come back, so a whole library costs a few MB, not hundreds.

const API = 'https://www.wikidata.org/w/api.php';
const SPARQL = 'https://query.wikidata.org/sparql';

// Occupations that make a match likely to be the person on the book.
const BOOKISH = [
  'Q36180', 'Q6625963', 'Q49757', 'Q482980', 'Q333634', 'Q1607826', 'Q644687', 'Q715301', 'Q1114448',
  'Q4853732', 'Q18844224', 'Q15949613', 'Q11774202', 'Q1930187', 'Q214917', 'Q28389', 'Q4964182', 'Q201788',
];
const BOOKISH_DESC = /writer|novelist|poet|author|translator|editor|illustrat|comic|cartoonist|essayist|journalist|philosopher|historian|playwright|dramatist|screenwriter|artist|scientist|physicist|biologist|anthropologist|sociologist|economist|chef|cook|designer|photographer|critic|scholar|professor|academic|psycholog|mycologist|naturalist|game designer/i;

// Countries that no longer exist rarely have an English demonym on Wikidata.
const OLD_COUNTRIES = {
  'Russian Empire': 'Russian', 'Soviet Union': 'Soviet', 'Empire of Brazil': 'Brazilian',
  'United Kingdom of Great Britain and Ireland': 'British', 'Kingdom of Great Britain': 'British', 'Kingdom of England': 'English',
  'Kingdom of Scotland': 'Scottish', 'Kingdom of Ireland': 'Irish', 'Irish Free State': 'Irish',
  'Austria-Hungary': 'Austro-Hungarian', 'German Empire': 'German', 'Nazi Germany': 'German', 'Weimar Republic': 'German',
  'Kingdom of Prussia': 'Prussian', 'East Germany': 'East German', 'West Germany': 'West German', 'Kingdom of Italy': 'Italian',
  'Roman Empire': 'Roman', 'Ancient Rome': 'Roman', 'Roman Republic': 'Roman', "Polish People's Republic": 'Polish',
  'Czechoslovakia': 'Czechoslovak', 'Yugoslavia': 'Yugoslav', 'Socialist Federal Republic of Yugoslavia': 'Yugoslav',
  'Kingdom of Portugal': 'Portuguese', 'United Kingdom of Portugal, Brazil and the Algarves': 'Portuguese',
  'Kingdom of Sweden': 'Swedish', 'Sweden–Norway': 'Swedish', 'Union between Sweden and Norway': 'Swedish',
  'Ottoman Empire': 'Ottoman', 'Qing dynasty': 'Chinese', 'Empire of Japan': 'Japanese', 'Kingdom of France': 'French',
  'French Second Republic': 'French', 'Second French Empire': 'French', 'French Third Republic': 'French',
  'Spanish Empire': 'Spanish', 'Crown of Castile': 'Spanish', 'Dutch Republic': 'Dutch', 'Kingdom of the Netherlands': 'Dutch',
  'Grand Duchy of Finland': 'Finnish', 'Mandatory Palestine': 'Palestinian', 'British Raj': 'Indian', 'Dominion of India': 'Indian',
  'Republic of Florence': 'Florentine', 'Republic of Venice': 'Venetian', 'Papal States': 'Italian',
  'Colony of Kenya': 'Kenyan', 'Kenya Colony': 'Kenyan', 'Union of South Africa': 'South African',
};
const GENDERS = { Q6581072: 'woman', Q6581097: 'man', Q1052281: 'woman', Q2449503: 'man', Q48270: 'non-binary' };

const qid = (uri) => String(uri).split('/').pop();
// Letters only: "J. R. R. Tolkien" and "J.R.R. Tolkien" are the same name.
export const nameKey = (s) => String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const lastWord = (s) => nameKey(String(s).trim().split(/\s+/).pop());

async function getJson(url, tries = 3) {
  for (let i = 0; ; i++) {
    const r = await fetch(url);
    if (r.ok) return r.json();
    if (i + 1 >= tries || ![429, 500, 502, 503, 504].includes(r.status)) throw new Error(`Wikidata said ${r.status}`);
    await new Promise((ok) => setTimeout(ok, 1500 * (i + 1) + Math.random() * 500));
  }
}

// People on Wikidata whose name matches, best first (Q ids).
export async function searchPeople(name) {
  const run = async (q) => {
    const u = `${API}?action=query&list=search&srsearch=${encodeURIComponent(`${q} haswbstatement:P31=Q5`)}&srnamespace=0&srlimit=6&srprop=&format=json&origin=*`;
    const j = await getJson(u);
    return (j.query?.search || []).map((x) => x.title).filter((t) => /^Q\d+$/.test(t));
  };
  let ids = await run(name.replace(/["\\]/g, ' '));
  // "Ursula Kroeber Le Guin" style names: try first and last name only.
  const words = name.trim().split(/\s+/);
  if (!ids.length && words.length > 2) ids = await run(`${words[0]} ${words.at(-1)}`);
  return ids;
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

// Details for many people at once: { Q…: { id, label, about, names, nationality, gender, born, died, bookish, links } }.
export async function peopleDetails(ids) {
  const out = {};
  for (let i = 0; i < ids.length; i += 40) {
    const part = ids.slice(i, i + 40);
    const q = `SELECT ?item (SAMPLE(?l) AS ?label) (SAMPLE(?d) AS ?desc)
  (GROUP_CONCAT(DISTINCT ?n; separator="|") AS ?names)
  (GROUP_CONCAT(DISTINCT CONCAT(STR(?g), "~", ?gl); separator="|") AS ?genders)
  (GROUP_CONCAT(DISTINCT CONCAT(STR(?c), "~", ?cl, "~", ?dm); separator="|") AS ?countries)
  (SAMPLE(?b) AS ?born) (SAMPLE(?x) AS ?died) (SAMPLE(?sl) AS ?links) (MAX(?w) AS ?bookish)
WHERE {
  VALUES ?item { ${part.map((x) => 'wd:' + x).join(' ')} }
  OPTIONAL { ?item rdfs:label ?l FILTER(LANG(?l) = "en") }
  OPTIONAL { ?item schema:description ?d FILTER(LANG(?d) = "en") }
  OPTIONAL { { ?item rdfs:label ?n } UNION { ?item skos:altLabel ?n } FILTER(LANG(?n) IN ("mul","en","pt","sv","nl","es","fr","de","it","pl","da","no")) }
  OPTIONAL { ?item wdt:P21 ?g . OPTIONAL { ?g rdfs:label ?gl0 FILTER(LANG(?gl0) = "en") } BIND(COALESCE(?gl0, "") AS ?gl) }
  OPTIONAL { ?item wdt:P27 ?c .
    OPTIONAL { ?c rdfs:label ?cl0 FILTER(LANG(?cl0) = "en") }
    OPTIONAL { ?c wdt:P1549 ?dm0 FILTER(LANG(?dm0) = "en") }
    BIND(COALESCE(?cl0, "") AS ?cl) BIND(COALESCE(STR(?dm0), "") AS ?dm) }
  OPTIONAL { ?item wdt:P569 ?b }
  OPTIONAL { ?item wdt:P570 ?x }
  OPTIONAL { ?item wikibase:sitelinks ?sl }
  OPTIONAL { ?item wdt:P106 ?o . VALUES ?o { ${BOOKISH.map((x) => 'wd:' + x).join(' ')} } BIND(1 AS ?w) }
} GROUP BY ?item`;
    const j = await getJson(`${SPARQL}?format=json&query=${encodeURIComponent(q)}`);
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
        id, label: v('label') || id, about,
        names: v('names').split('|').filter(Boolean),
        nationality: nats.join(' / ') || null,
        gender: [...new Set(g)].join(' / ') || null,
        born: year(v('born')), died: year(v('died')),
        bookish: v('bookish') === '1' || BOOKISH_DESC.test(about),
        links: Number(v('links')) || 0,
      };
    }
  }
  return out;
}

// How well a Wikidata person fits a name on the books. Ranked candidates come
// back with `sure` when the best one is plainly the person: the same name,
// known for writing (or drawing, translating…), and no rival that fits as well.
export function rank(name, ids, details) {
  const k = nameKey(name), last = lastWord(name);
  const cands = ids.map((id, i) => details[id]).filter(Boolean).map((d, i) => {
    const keys = [d.label, ...d.names].map(nameKey);
    const exact = keys.includes(k);
    const surname = !exact && [d.label, ...d.names].some((n) => lastWord(n) === last);
    const score = (exact ? 3 : surname ? 1 : 0) + (d.bookish ? 2 : 0) + Math.min(1, Math.log10(1 + d.links) / 2) - i * 0.15;
    return { ...d, exact, score };
  }).filter((c) => c.exact || c.score >= 1.5).sort((a, b) => b.score - a.score);
  const [a, b] = cands;
  const sure = !!a && a.exact && a.bookish && !(b && b.exact && b.bookish && b.links > a.links / 4);
  // Only what's shown and saved (the list of other names can be long).
  const slim = ({ id, label, about, nationality, gender, born, died, exact: ex }) => ({ id, label, about, nationality, gender, born, died, exact: ex });
  return { cands: cands.slice(0, 4).map(slim), sure };
}

// One name: search, details, ranking.
export async function lookupPerson(name) {
  const ids = await searchPeople(name);
  if (!ids.length) return { cands: [], sure: false };
  return rank(name, ids, await peopleDetails(ids));
}

// Many people ([{ id, name }]): searches a few at a time, then the details in
// large batches. onProgress(done, total, phase). Returns Map authorId → { cands, sure } or { error }.
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
  onProgress(0, all.length, 'details');
  let details = {};
  for (let i = 0; i < all.length; i += 120) {
    Object.assign(details, await peopleDetails(all.slice(i, i + 120)));
    onProgress(Math.min(all.length, i + 120), all.length, 'details');
  }
  const out = new Map();
  for (const p of people) {
    const ids = found.get(p.id);
    out.set(p.id, Array.isArray(ids) ? rank(p.name, ids, details) : { error: ids?.error || 'failed', cands: [], sure: false });
  }
  return out;
}

// The fields an author record gets from a chosen match.
export const fieldsFrom = (c) => ({
  wikidata: c.id, about: c.about || null, nationality: c.nationality, gender: c.gender,
  born: c.born, died: c.died, checked: true, lookedUp: true, source: 'wikidata',
});

export const wikidataUrl = (id) => `https://www.wikidata.org/wiki/${encodeURIComponent(id)}`;
