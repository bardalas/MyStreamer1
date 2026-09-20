/* Which titles can actually be watched, so the rest can be dimmed. */
import {capMap, store} from '../core/store.js';
import {addons, fetchStreams, supports} from './addons.js';
import {parseStream, rank} from '../ui/sources.js';

/* ---------- which titles have sources (greys out / hides the rest) ---------- */
export let avail = store.get('avail', {});                 // "type:tt…" -> [ok, checkedAt, emptyAnswers]
if(store.get('availRev', 0) < 1){ avail = {}; store.set('avail', avail); store.set('availRev', 1); }   // 0.11/0.12 results may be wrong
export const AVAIL_TTL = 3 * 864e5;
export const availPending = new Set();
export let availBusy = false;
export const isNoSrc = e => e && !e[0] && (e[2] || 0) >= 2;
// known = available (fresh), or confirmed empty twice (fresh); a single empty answer is re-checked after 10 minutes
export const availKnown = k => { const e = avail[k]; if(!e) return false; const age = Date.now() - e[1];
  return e[0] || isNoSrc(e) ? age < AVAIL_TTL : age < 6e5; };
export function setAvail(key, ok){
  const prev = avail[key];
  avail[key] = ok ? [true, Date.now(), 0] : [false, Date.now(), prev && !prev[0] ? (prev[2] || 1) + 1 : 1];
  store.lazy('avail', capMap(avail, 2000));
  const none = isNoSrc(avail[key]);
  document.querySelectorAll(`[data-avail="${key}"]`).forEach(el => el.classList.toggle('nosrc', none));
}
export async function hasSources(key){
  const [type, id] = key.split(':');
  const vid = type === 'series' ? `${id}:1:1` : id;          // a series counts as available if S1E1 is
  for(const a of addons.filter(a => supports(a.manifest, 'stream', type, vid))){
    try{
      const found = (await fetchStreams(a, type, vid)).map((s, i) => parseStream(s, a.manifest.name, i));
      if(found.some(x => !x.external && x.q !== 'CAM' && rank(x) > 0)) return true;
    }catch(e){ return null; }                                 // unknown: don't grey out on a network error
  }
  return false;
}
export let availScreen = 0;                                          // how many probes this screen already used
addEventListener('hashchange', () => { availPending.clear(); availScreen = 0; });
export function queueAvail(keys){
  if(availScreen > 24) return;                               // never turn a screen into a request storm
  availScreen += keys.length;
  for(const k of keys) if(!availKnown(k)) availPending.add(k);
  if(!availBusy) availFlush();
}
export async function availFlush(){
  availBusy = true;
  while(availPending.size){
    const batch = [...availPending].slice(0, 2);          // gentle on the stream add-on
    batch.forEach(k => availPending.delete(k));
    await Promise.all(batch.map(async k => { const ok = await hasSources(k); if(ok !== null) setAvail(k, ok); }));
    await new Promise(r => setTimeout(r, 300));
  }
  availBusy = false;
}
export const availObserver = new IntersectionObserver(entries => {
  const keys = [];
  for(const en of entries) if(en.isIntersecting){ availObserver.unobserve(en.target); keys.push(en.target.dataset.avail); }
  if(keys.length) queueAvail(keys);
}, {rootMargin: '300px'});
new MutationObserver(muts => {
  const now = [];
  for(const m of muts) for(const n of m.addedNodes){
    if(n.nodeType !== 1) continue;
    for(const el of n.matches('[data-avail]') ? [n] : n.querySelectorAll('[data-avail]')){
      if(availKnown(el.dataset.avail)) continue;
      if([...el.parentNode.children].indexOf(el) < 6) now.push(el.dataset.avail); else availObserver.observe(el);
    }
  }
  if(now.length) queueAvail(now);
}).observe(document.body, {childList: true, subtree: true});
