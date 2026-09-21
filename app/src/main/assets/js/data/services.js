/* Which streaming service a title is on, and the mark that says so. */
import {$, esc} from '../core/dom.js';
import {store} from '../core/store.js';
import {addons, catalogFetch} from './addons.js';
import {SC_ID} from './catalogs.js';
import {pool} from './hebrew.js';

/* ---------- which streaming service a title is on (from the Streaming Catalogs add-on) ---------- */
/** Every service the add-on can list: [code, name, initials, colour] - the initials on the colour stand for
    it where there is no logo of its own. The first ones are the services most watched here; the rest are
    offered under "more" (Settings -> Streaming services). */
export const PROVIDERS_MAIN = [
  ['nfx', 'Netflix', 'N', '#e50914'], ['nfk', 'Netflix Kids', 'NK', '#e50914'], ['dnp', 'Disney+', 'D+', '#1f4bd8'],
  ['amp', 'Prime Video', 'PV', '#0b8fd0'], ['atp', 'Apple TV+', 'TV', '#4f5157'], ['hbm', 'HBO Max', 'HBO', '#7b2ff2'],
  ['pmp', 'Paramount+', 'P+', '#1266ff'], ['cru', 'Crunchyroll', 'CR', '#f47521'], ['mbi', 'Mubi', 'MUBI', '#1b1f7a'],
  ['cts', 'Curiosity Stream', 'CS', '#0f9bb8'], ['mgl', 'MagellanTV', 'MG', '#b5842a']];
export const PROVIDERS_MORE = [
  ['hlu', 'Hulu', 'hulu', '#16a864'], ['pcp', 'Peacock', 'P', '#3d3d3d'], ['sst', 'SkyShowtime', 'SST', '#1a2b6b'],
  ['stz', 'Starz', 'STZ', '#2b2b2b'], ['crc', 'Criterion Channel', 'CC', '#2b2b2b'], ['shd', 'Shudder', 'SHU', '#c8161d'],
  ['dpe', 'Discovery+', 'DSC', '#1d6ce0'], ['bbc', 'BBC iPlayer', 'BBC', '#d6246e'], ['itv', 'ITVX', 'ITVX', '#15375e'],
  ['al4', 'Channel 4', '4', '#2b2b2b'], ['bbo', 'BritBox', 'BB', '#b8124e'], ['act', 'Acorn TV', 'ACN', '#1f7a3c'],
  ['sha', 'Shahid VIP', 'SHA', '#1a9c8c'], ['vik', 'Rakuten Viki', 'VIKI', '#1f8ff0'], ['iqi', 'iQIYI', 'iQ', '#1a9c1a'],
  ['zee', 'Zee5', 'Z5', '#8230c6'], ['jhs', 'JioHotstar', 'JH', '#16206b'], ['sonyliv', 'Sony Liv', 'SL', '#3d3d3d'],
  ['hay', 'Hayu', 'HAYU', '#7d2ae8'], ['cpd', 'Canal+', 'C+', '#2b2b2b'], ['mp9', 'Movistar+', 'M+', '#0a86c9'],
  ['sgo', 'Sky Go', 'SKY', '#0a64b0'], ['nlz', 'NLZIET', 'NLZ', '#e0631a'], ['vil', 'Videoland', 'VL', '#d20a11'],
  ['clv', 'Clarovideo', 'CV', '#d11f18'], ['gop', 'Globoplay', 'GP', '#e0053a']];
export const PROVIDERS = [...PROVIDERS_MAIN, ...PROVIDERS_MORE];
export const SERVICES = Object.fromEntries(PROVIDERS.map(([code, name]) => [code, name]));
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
export const SVC_MARK = Object.fromEntries(PROVIDERS.map(([, name, txt, bg]) => [name, [txt, bg]]));
export const svcMark = name => {
  const file = SVC_LOGO[name];
  if(file) return `<span class="svcm logo" title="${esc(name)}"><img src="svc/${file}.png" alt="${esc(name)}" loading="lazy"></span>`;
  const [txt, bg] = SVC_MARK[name] || [name.slice(0, 2).toUpperCase(), '#5a6072'];
  return `<span class="svcm" style="background:${bg}" title="${esc(name)}">${esc(txt)}</span>`;
};
/* Each glyph's width for its height (tools/svc_glyphs.py prints them when it makes the glyphs). */
const GLYPH_RATIO = {nfx: .553, cts: 1, atp: 2.259, dnp: 2.915, amp: 3.857, hbm: 1.394, pmp: 1.259};
/**
 * A service as a one-colour glyph - its logo without its tile (assets/svc/g, made from the logos by
 * tools/svc_glyphs.py), or its initials where there is no logo. For where marks sit side by side or
 * over a picture - the source tabs, the corner of a poster - and eight coloured tiles would be noise.
 * The logo is a mask filled with the text colour, so it is dark on a light skin, light on a dark one,
 * and turns with the rest of a button when the remote is on it.
 */
export const svcGlyph = name => {
  const file = SVC_LOGO[name];
  if(!file) return `<b class="glyph txt">${esc((SVC_MARK[name] || [name.slice(0, 2).toUpperCase()])[0])}</b>`;
  const url = `url(svc/g/${file}.png)`;
  return `<i class="glyph" role="img" aria-label="${esc(name)}" style="-webkit-mask-image:${url};mask-image:${url};--r:${GLYPH_RATIO[file] || 1}"></i>`;
};
/* A service is recognised by its colour before its name is read, so the label wears it: the service's
   own colour, laid on thinly enough to stay a label rather than becoming a button. The tint is worked
   out here rather than in the stylesheet, because a television's browser is not always new enough for
   the colour functions CSS has for this. */
const tint = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};
/** The inline dress of a label for [name]: its colour, thinly - or nothing for a name that is not a service. */
export const svcDress = name => {
  const hex = SVC_MARK[name]?.[1];
  return hex ? `background:${tint(hex, .22)};border-color:${tint(hex, .6)}` : '';
};
/** Its icon, or nothing for a name that is not a service we know. */
export const svcIcon = name => SVC_MARK[name] ? svcMark(name) : '';
export const svcFacts = id => svcOf(id).map(n => `<span class="svcf" style="${svcDress(n)}">${svcMark(n)}${esc(n)}</span>`).join('');
/** IMDb's mark, in IMDb's yellow, with the rating beside it. */
export const imdbTag = rating => `<span class="imdb"><i>IMDb</i>${esc(rating)}</span>`;
/** The catalogues answer after the cards are drawn, so the marks are added to what is already on screen:
    in the corner of each picture that does not carry one yet (ui/cards.js). */
export function applyBadges(){
  if(document.querySelector('#app .srcmark')) return;   // a page all of one service says so once, behind it (screens/home.js)
  document.querySelectorAll('a.poster[data-id]').forEach(a => {
    const art = a.querySelector('.art');
    const svc = svcOf(a.dataset.id)[0];
    if(art && svc && !art.querySelector('.svcbadge')) art.insertAdjacentHTML('beforeend', `<span class="svcbadge">${svcGlyph(svc)}</span>`);
  });
}
/** The services listed changed (Settings): which title is on which is collected again. */
export function resetServices(){
  svcMap = {};
  store.set('svcMap', null);
  return loadServices();
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
