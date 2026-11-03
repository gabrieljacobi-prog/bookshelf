// Names and titles: small pure helpers shared by the app and the catalogue checks.
// No DOM, no Firebase, so they can be tested on their own in Node.
//
//   fold(s)        strips accents and folds letters NFKD can't take apart (ł, ø, ß …)
//   slug(s)        id for a person or series: "Stanisław Lem" → "stanislaw-lem"
//   fixName(raw)   repairs names garbled by library catalogues
//   sortName(name) "Ursula K. Le Guin" → "Le Guin, Ursula K."
//   splitTitle(raw) pulls "(Series, #3)" and "Vol. 2" out of a title

// --- Letters ----------------------------------------------------------------------

// Letters NFKD can't take apart: "Stanisław" → "stanislaw", not "stanis-aw".
const FOLD = { ł: 'l', Ł: 'L', ø: 'o', Ø: 'O', đ: 'd', Đ: 'D', ß: 'ss', æ: 'ae', Æ: 'Ae', œ: 'oe', Œ: 'Oe', ı: 'i', þ: 'th', Þ: 'Th' };

export const fold = (s) => String(s ?? '').replace(/[łŁøØđĐßæÆœŒıþÞ]/g, (c) => FOLD[c])
  .normalize('NFKD').replace(/[̀-ͯ]/g, '');

export function slug(s) {
  const base = fold(String(s)).toLowerCase()
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  if (base) return base;
  // Japanese and other non-Latin names: a short stable hash instead.
  let h = 2166136261;
  for (const ch of String(s)) h = Math.imul(h ^ ch.codePointAt(0), 16777619) >>> 0;
  return 'x' + h.toString(36);
}

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

// --- Titles ---------------------------------------------------------------------------

const ROMAN = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10 };

// Marketing text some sources append to titles.
const TITLE_JUNK = [/\s*\(Gin Book\)$/, /\s*\(Art Books, Gifts for Artists[^)]*\)$/];

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
