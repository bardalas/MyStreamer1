/* ---------- age ratings ----------
   How old a viewer should be for a title. The catalogues do not say. IMDb does: the certificate a title
   was given here in Israel, films and series alike (Game of Thrones 18, Stranger Things 16, Friends 13),
   asked for in batches by id and kept on the device; where there is no Israeli one, the American one
   (R, PG-13, TV-14, TV-MA). IMDb answers an app only when it says which client it is, so the question
   goes through the native side (core/bridge.js postText).
   What IMDb has no certificate for is asked of Wikidata, which keeps the ratings films were given in the
   US (MPA), Germany (FSK), the UK (BBFC), Australia (ACB) and Brazil (ClassInd). Those systems disagree
   (Harry Potter's fourth film is PG-13, FSK 12, BBFC 12, ClassInd 12 and ACB M), so there a title's age is
   the middle of them. Wikidata's own query service can be slow (seconds, at busy times a minute), so the
   same data is asked of QLever (the University of Freiburg's copy of Wikidata, much quicker) first and of
   Wikidata only when that fails; the query asks for as little as it can - the rating items themselves, not
   their names: the common ones are known here by their ids, and any other is named once through the
   regular API and kept - and nothing waits on it for long. */
import {postText} from '../core/bridge.js';
import {getJSON} from '../core/dom.js';
import {capMap, store} from '../core/store.js';
import {tr} from '../i18n.js';
import {WDAPI} from './hebrew.js';

/** Where the query is asked, in turn, and how long each is given. */
const SPARQL = [['https://qlever.cs.uni-freiburg.de/api/wikidata?query=', 15000], ['https://query.wikidata.org/sparql?format=json&query=', 30000]];
async function sparql(q){
  let err;
  for(const [url, ms] of SPARQL){
    try{ return await getJSON(url + encodeURIComponent(q), ms); }catch(e){ err = e; }
  }
  throw err;
}
/** The rating systems asked for, by their Wikidata property. */
const PROPS = {P1657: 'mpa', P1981: 'fsk', P2629: 'bbfc', P3156: 'acb', P3216: 'classind'};
/** The age each rating stands for. "Parental guidance" says no age; it is counted as seven. */
const AGES = {
  mpa: {G: 0, PG: 7, 'PG-13': 13, R: 17, 'NC-17': 18},
  bbfc: {U: 0, Uc: 0, PG: 7, '12A': 12, '12': 12, '15': 15, '18': 18, R18: 18},
  acb: {G: 0, PG: 7, M: 15, 'MA 15+': 15, 'R 18+': 18, 'X 18+': 18},
};
/** The ages of the common rating items, by their Wikidata ids (US, German, British, Australian, Brazilian). */
const ITEM_AGES = {
  Q18665330: 0, Q18665334: 7, Q18665339: 13, Q18665344: 17,                       // MPA: G, PG, PG-13, R
  Q20644794: 0, Q20644795: 6, Q20644796: 12, Q20644797: 16,                       // FSK 0, 6, 12, 16
  Q23301853: 0, Q23301854: 7, Q23301856: 12, Q4550895: 15, Q4557532: 18,          // BBFC U, PG, 12, 15, 18
  Q26708075: 0, Q26708076: 7, Q26708077: 15, Q26708078: 15,                       // ACB G, PG, M, MA 15+
  Q26678731: 0, Q26678732: 10, Q26678733: 12, Q26678736: 18,                      // ClassInd L, 10, 12, 18
};
const learnt = store.get('ageItems', {});                // any other rating item: its age once named (-1: none)
function ageOf(sys, label){
  const l = label.replace(/\s*certificate$/i, '').trim();   // BBFC's are named "12A certificate"
  if(sys === 'fsk' || sys === 'classind') return l === 'L' ? 0 : /\d+/.test(l) ? +l.match(/\d+/)[0] : null;
  return AGES[sys]?.[l] ?? null;
}

const ages = store.get('ageRate', {});                   // tt -> age, or -1 when no rating is known
// Before IMDb was asked, most series were kept as having no rating at all: they are asked again, once.
if(store.get('ageRev', 0) < 1){ for(const k of Object.keys(ages)) delete ages[k]; store.set('ageRate', ages); store.set('ageRev', 1); }
/** A title's age, or null when none of the systems rated it. */
export const ageFor = id => ages[id] >= 0 ? ages[id] : null;
/** An age as a viewer reads it: "12+" - or "all ages". */
export const ageLabel = a => a == null ? '' : a === 0 ? tr('age.all') : Math.ceil(a) + '+';

let queue = new Set(), waiting = [], timer = 0;
/** Find the ages of [ids] not already known. Resolves once they are in - or could not be had (offline,
    or Wikidata busy), in which case they are asked again the next time. Asks made together go as one. */
export function ratingsFor(ids){
  const want = ids.filter(id => /^tt\d+$/.test(id) && !(id in ages));
  if(!want.length) return Promise.resolve();
  want.forEach(id => queue.add(id));
  return new Promise(res => { waiting.push(res); clearTimeout(timer); timer = setTimeout(flush, 60); });
}
async function flush(){
  const batch = [...queue], done = waiting;
  queue = new Set(); waiting = [];
  for(let i = 0; i < batch.length; i += IMDB_BATCH){
    const part = batch.slice(i, i + IMDB_BATCH);
    const rest = await fromImdb(part).catch(() => part);
    if(rest.length) await ask(rest).catch(() => {});
  }
  store.lazy('ageRate', capMap(ages, 8000));
  done.forEach(res => res());
}
/* ---------- IMDb's certificates ---------- */
const IMDB = 'https://api.graphql.imdb.com/', IMDB_BATCH = 50;
/** The age each American certificate stands for - cinema and television. "Parental guidance" says no age. */
const US = {G: 0, PG: 8, 'PG-13': 13, R: 17, 'NC-17': 18, X: 18,
  'TV-Y': 0, 'TV-Y7': 7, 'TV-Y7-FV': 7, 'TV-G': 0, 'TV-PG': 10, 'TV-14': 14, 'TV-MA': 17};
/** A certificate's age, or null. Israel's are an age ("16"), "All", or "PG". */
function certAge(rating, country){
  const r = String(rating || '').trim();
  if(!r) return null;
  if(country === 'US') return US[r] ?? null;
  if(/^(all|u|g|l|0)$/i.test(r)) return 0;
  if(/^pg$/i.test(r)) return 8;
  const n = r.match(/\d+/);
  return n ? +n[0] : null;
}
/** The certificates of [ids] in [country]: id -> age, for the ones that have one there. */
async function certificates(ids, country){
  const q = `{titles(ids:${JSON.stringify(ids)}){id certificate{rating country{id}}}}`;
  const d = JSON.parse(await postText(IMDB, JSON.stringify({query: q}),
    {'Content-Type': 'application/json', 'x-imdb-client-name': 'imdb-web-next-localized', 'x-imdb-user-country': country}));
  const out = {};
  for(const t of d?.data?.titles || []){
    const c = t?.certificate;
    const age = c && (c.country?.id === country || !c.country) ? certAge(c.rating, country) : null;
    if(age != null) out[t.id] = age;
  }
  return out;
}
/** The ages IMDb knows of [ids] - Israel's certificate, else America's; returns the ids it knew nothing of. */
async function fromImdb(ids){
  let rest = ids;
  for(const country of ['IL', 'US']){
    if(!rest.length) break;
    const got = await certificates(rest, country);
    for(const [id, age] of Object.entries(got)) ages[id] = age;
    rest = rest.filter(id => !(id in got));
  }
  return rest;
}

/* ---------- Wikidata's ratings ---------- */
async function ask(ids){
  const q = `PREFIX wdt: <http://www.wikidata.org/prop/direct/>
SELECT ?imdb ?p ?v WHERE { VALUES ?imdb { ${ids.map(i => `"${i}"`).join(' ')} } ?item wdt:P345 ?imdb .
    VALUES ?p { ${Object.keys(PROPS).map(p => 'wdt:' + p).join(' ')} } ?item ?p ?v }`;
  const d = await sparql(q);
  const rows = (d.results?.bindings || []).map(b => ({id: b.imdb.value, sys: PROPS[b.p.value.split('/').pop()], item: b.v.value.split('/').pop()}));
  // rating items not known here: named once, through the regular API (quick, unlike the query service)
  const unnamed = [...new Map(rows.filter(r => r.sys && !(r.item in ITEM_AGES) && !(r.item in learnt)).map(r => [r.item, r.sys])).entries()];
  for(let i = 0; i < unnamed.length; i += 50){
    const part = unnamed.slice(i, i + 50);
    const e = (await getJSON(`${WDAPI}action=wbgetentities&props=labels&languages=en&ids=${part.map(([q]) => q).join('|')}`)).entities || {};
    for(const [q, sys] of part) learnt[q] = ageOf(sys, e[q]?.labels?.en?.value || '') ?? -1;
  }
  if(unnamed.length) store.lazy('ageItems', learnt);
  const per = {};                                        // id -> system -> its (highest) age
  for(const {id, sys, item} of rows){
    const age = !sys ? null : item in ITEM_AGES ? ITEM_AGES[item] : learnt[item] >= 0 ? learnt[item] : null;
    if(age == null) continue;
    const m = per[id] ||= {};
    m[sys] = Math.max(m[sys] ?? 0, age);
  }
  for(const id of ids){
    const v = Object.values(per[id] || {}).sort((a, b) => a - b), h = v.length >> 1;
    ages[id] = !v.length ? -1 : v.length % 2 ? v[h] : (v[h - 1] + v[h]) / 2;
  }
}
