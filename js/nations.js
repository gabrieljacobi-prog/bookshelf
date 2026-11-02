// Nationalities as the library shows and filters them.
// Wikidata lists every country a person was a citizen of, including ones that no
// longer exist: Lispector comes back "Ukrainian Soviet Socialist Republic /
// Brazilian", Achebe "Colonial Nigeria / Nigerian". Shown and filtered, those
// read badly and split one nationality across several entries, so a former
// state is dropped whenever the person also has a present-day nationality, and
// kept (as a demonym) only when it's all there is (Marcus Aurelius stays Roman).

// Former states → demonym, for country labels that arrive without one.
export const OLD_COUNTRIES = {
  'Russian Empire': 'Russian', 'Soviet Union': 'Soviet', 'Empire of Brazil': 'Brazilian',
  'Ukrainian Soviet Socialist Republic': 'Soviet', 'Byelorussian Soviet Socialist Republic': 'Soviet',
  'Russian Soviet Federative Socialist Republic': 'Soviet', 'Russian Socialist Federative Soviet Republic': 'Soviet',
  'United Kingdom of Great Britain and Ireland': 'British', 'Kingdom of Great Britain': 'British', 'Kingdom of England': 'English',
  'Kingdom of Scotland': 'Scottish', 'Kingdom of Ireland': 'Irish', 'Irish Free State': 'Irish',
  'Austria-Hungary': 'Austro-Hungarian', 'Cisleithania': 'Austro-Hungarian', 'Austrian Empire': 'Austrian',
  'German Empire': 'German', 'Nazi Germany': 'German', 'Weimar Republic': 'German', 'German Reich': 'German',
  'Kingdom of Prussia': 'Prussian', 'East Germany': 'East German', 'West Germany': 'West German',
  'Free City of Danzig': 'Danziger', 'Kingdom of Italy': 'Italian',
  'Roman Empire': 'Roman', 'Ancient Rome': 'Roman', 'Roman Republic': 'Roman', "Polish People's Republic": 'Polish',
  'Second Polish Republic': 'Polish', 'Congress Poland': 'Polish',
  'Czechoslovakia': 'Czechoslovak', 'First Czechoslovak Republic': 'Czechoslovak', 'Czechoslovak Socialist Republic': 'Czechoslovak',
  'Yugoslavia': 'Yugoslav', 'Socialist Federal Republic of Yugoslavia': 'Yugoslav', 'Kingdom of Yugoslavia': 'Yugoslav',
  "Federal People's Republic of Yugoslavia": 'Yugoslav', 'Federal Republic of Yugoslavia': 'Yugoslav', 'Serbia and Montenegro': 'Yugoslav',
  'Kingdom of Portugal': 'Portuguese', 'United Kingdom of Portugal, Brazil and the Algarves': 'Portuguese',
  'Kingdom of Sweden': 'Swedish', 'Sweden–Norway': 'Swedish', 'Union between Sweden and Norway': 'Swedish',
  'Ottoman Empire': 'Ottoman', 'Qing dynasty': 'Chinese', 'Empire of Japan': 'Japanese', 'Kingdom of France': 'French',
  'French Second Republic': 'French', 'Second French Empire': 'French', 'French Third Republic': 'French',
  'Spanish Empire': 'Spanish', 'Crown of Castile': 'Spanish', 'Dutch Republic': 'Dutch', 'Kingdom of the Netherlands': 'Dutch',
  'Grand Duchy of Finland': 'Finnish', 'Mandatory Palestine': 'Palestinian', 'British Raj': 'Indian', 'Dominion of India': 'Indian',
  'Republic of Florence': 'Florentine', 'Republic of Venice': 'Venetian', 'Papal States': 'Italian',
  'Colony of Kenya': 'Kenyan', 'Kenya Colony': 'Kenyan', 'Union of South Africa': 'South African',
  'Colonial Nigeria': 'Nigerian', 'British Nigeria': 'Nigerian', 'Southern Rhodesia': 'Rhodesian', 'Rhodesia': 'Rhodesian',
  'Gold Coast': 'Ghanaian', 'Portuguese Mozambique': 'Mozambican', 'Overseas Province of Mozambique': 'Mozambican',
  'Dominion of Ceylon': 'Sri Lankan', 'British Ceylon': 'Sri Lankan', 'Dominion of Newfoundland': 'Newfoundlander',
  'Persia': 'Iranian', 'Qajar Iran': 'Iranian', 'Pahlavi Iran': 'Iranian', 'Imperial State of Iran': 'Iranian',
};

// Demonyms of states that are gone; dropped when a present-day one is there too.
const FORMER = new Set(['Soviet', 'Yugoslav', 'Serbo-Montenegrin', 'Czechoslovak', 'Austro-Hungarian', 'Ottoman',
  'Prussian', 'East German', 'West German', 'Danziger', 'Rhodesian', 'Newfoundlander', 'Roman', 'Florentine', 'Venetian']);
// The parts of the UK, dropped next to "British" ("English / British" → "British").
const UK_PARTS = new Set(['English', 'Scottish', 'Welsh', 'Northern Irish']);
// A country's name rather than a demonym (a label with no demonym on Wikidata).
const STATE_WORDS = /\b(Republic|Empire|Kingdom|Colony|Colonial|Free City|Federation|Federative|Dominion|Protectorate|Mandate|Socialist|Duchy|Principality|Confederation|dynasty)\b/i;

const isFormer = (n) => FORMER.has(n) || STATE_WORDS.test(n);

// "Federal People's Republic of Yugoslavia / … / Yugoslav / Serbo-Montenegrin / Serbian" → "Serbian".
export function cleanNationality(s) {
  if (!s) return s ?? null;
  let parts = String(s).split(/\s*\/\s*/).map((p) => p.trim()).filter(Boolean)
    .map((p) => OLD_COUNTRIES[p] || p);
  parts = [...new Set(parts)];
  const now = parts.filter((p) => !isFormer(p));
  if (now.length) parts = now;
  else {
    // Only former states: keep their demonyms, not leftover country names.
    const dems = parts.filter((p) => !STATE_WORDS.test(p));
    if (dems.length) parts = dems;
  }
  if (parts.includes('British')) parts = parts.filter((p) => !UK_PARTS.has(p));
  return parts.join(' / ') || null;
}

// Each nationality on its own, for filtering ("French / British" → both).
export const nationalities = (s) => (cleanNationality(s) || '').split(' / ').filter(Boolean);
