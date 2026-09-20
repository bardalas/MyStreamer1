/* Which streaming service a title is on, and the mark that says so. */
import {$, esc} from '../core/dom.js';
import {store} from '../core/store.js';
import {addons, catalogFetch} from './addons.js';
import {SC_ID} from './catalogs.js';
import {pool} from './hebrew.js';

/* ---------- which streaming service a title is on (from the Streaming Catalogs add-on) ---------- */
export const SERVICES = {nfx: 'Netflix', atp: 'Apple TV+', dnp: 'Disney+', amp: 'Prime Video', hbm: 'HBO Max', pmp: 'Paramount+', cts: 'Curiosity Stream', mgl: 'MagellanTV'};
export let svcMap = (() => { const c = store.get('svcMap', null); return c && Date.now() - c.at < 864e5 ? c.map : {}; })();
export const svcOf = id => svcMap[id] || [];
export function noteServices(id, name){
  const list = svcMap[id] ||= [];
  if(!list.includes(name)) list.push(name);
}
// Initials in the service's own colour: a logo would be its trademark, and a name is too long to sit
// beside a title. The mark carries the full name as its tooltip.
/* Each service's own mark, as it appears on its app: the files under assets/svc are the logos
   themselves, so nothing has to be fetched and nothing is a guess. A service with no file of its
   own falls back to its initials on its colour. */
export const SVC_LOGO = {'Netflix': 'nfx', 'Apple TV+': 'atp', 'Disney+': 'dnp', 'Prime Video': 'amp',
  'HBO Max': 'hbm', 'Paramount+': 'pmp', 'Curiosity Stream': 'cts'};
export const SVC_MARK = {'Netflix': ['N', '#e50914'], 'Apple TV+': ['TV', '#4f5157'], 'Disney+': ['D+', '#1f4bd8'],
  'Prime Video': ['PV', '#0b8fd0'], 'HBO Max': ['HBO', '#7b2ff2'], 'Paramount+': ['P+', '#1266ff'],
  'Curiosity Stream': ['CS', '#0f9bb8'], 'MagellanTV': ['MG', '#b5842a']};
export const svcMark = name => {
  const file = SVC_LOGO[name];
  if(file) return `<span class="svcm logo" title="${esc(name)}"><img src="svc/${file}.png" alt="${esc(name)}" loading="lazy"></span>`;
  const [txt, bg] = SVC_MARK[name] || [name.slice(0, 2).toUpperCase(), '#5a6072'];
  return `<span class="svcm" style="background:${bg}" title="${esc(name)}">${esc(txt)}</span>`;
};
/** Up to two marks, and how many more there are. */
export const svcMarks = id => {
  const l = svcOf(id);
  if(!l.length) return '';
  return `<span class="svcs" title="${esc(l.join(' · '))}">${l.slice(0, 2).map(svcMark).join('')}${
    l.length > 2 ? `<span class="svcm" style="background:#5a6072">+${l.length - 2}</span>` : ''}</span>`;
};
export const svcFacts = id => svcOf(id).map(n => `<span class="svcf">${svcMark(n)}${esc(n)}</span>`).join('');
/** The catalogues answer after the cards are drawn, so the marks are added to what is already on screen. */
export function applyBadges(){
  document.querySelectorAll('a.poster[data-id]').forEach(a => {
    const name = a.querySelector('.t [data-heid]');
    if(!name || a.querySelector('.svcs')) return;
    const marks = svcMarks(a.dataset.id);
    if(marks) name.insertAdjacentHTML('afterend', marks);
  });
}
/** Once a day: collect every streaming service's catalogue into id -> services. */
export async function loadServices(){
  const cached = store.get('svcMap', null);
  if(cached && Date.now() - cached.at < 864e5) return;
  const sc = addons.find(a => a.manifest.id === SC_ID);
  if(!sc) return;
  const map = {};
  await pool((sc.manifest.catalogs || []).filter(c => SERVICES[c.id]), 3, async c => {
    try{
      for(const m of (await catalogFetch(sc, c.type, c.id)).metas || []) (map[m.id] ||= []).includes(SERVICES[c.id]) || map[m.id].push(SERVICES[c.id]);
    }catch(e){}
  });
  svcMap = map;
  store.set('svcMap', {at: Date.now(), map});
  applyBadges();
}
