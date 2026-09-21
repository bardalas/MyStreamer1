/* ---------- age ratings ----------
   How old a viewer should be for a title. The catalogues do not say; Wikidata keeps the ratings films were
   given - in the US (MPA), Germany (FSK), the UK (BBFC), Australia (ACB) and Brazil (ClassInd). They are
   asked for in batches, by IMDb id, with one query, and kept on the device. The systems disagree (Harry
   Potter's fourth film is PG-13, FSK 12, BBFC 12, ClassInd 12 and ACB M), so a title's age is the middle
   of them. Most series have none: for those the kids profile goes by its genres alone.
   Wikidata's own query service can be slow (seconds, at busy times a minute), so the same data is asked
   of QLever (the University of Freiburg's copy of Wikidata, much quicker) first and of Wikidata only when
   that fails; the query asks for as little as it can - the rating items themselves, not their names: the
   common ones are known here by their ids, and any other is named once through the regular API and kept -
   and nothing waits on it for long. */
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
  for(let i = 0; i < batch.length; i += 100) await ask(batch.slice(i, i + 100)).catch(() => {});
  store.lazy('ageRate', capMap(ages, 8000));
  done.forEach(res => res());
}
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
