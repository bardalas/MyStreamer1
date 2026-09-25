/* Search while it is typed: the titles the app knows that the words could be, at once, and what the catalogues find a
   moment later - listed in the menu under the field, where the remote already goes (Down from the field). */
import {$, esc} from '../core/dom.js';
import {addons, catalogFetch} from '../data/addons.js';
import {known} from '../data/known.js';
import {heTitle} from '../data/hebrew.js';
import {tr} from '../i18n.js';

const box = $('#sug'), field = $('#q');
const LOCAL_MS = 120, REMOTE_MS = 450, REMOTE_WAIT = 3500, MAX = 6;
let localTimer = 0, remoteTimer = 0, asked = '', shown = [];

const catalogs = () => addons.flatMap(a => (a.manifest.catalogs || [])
  .filter(c => (c.extra || []).some(e => e.name === 'search') || (c.extraSupported || []).includes('search'))
  .filter(c => c.type === 'movie' || c.type === 'series').map(c => ({a, c})));

/** What the catalogues find for [q], the first few of each kind - never waited for longer than a moment. */
async function remote(q){
  const asks = catalogs().slice(0, 2).map(({a, c}) => Promise.race([
    catalogFetch(a, c.type, c.id, `search=${encodeURIComponent(q)}`).then(d => (d.metas || []).slice(0, 4).map(m => ({id: m.id, type: m.type || c.type, names: [m.name], poster: m.poster || '', year: m.releaseInfo || ''}))),
    new Promise(res => setTimeout(() => res([]), REMOTE_WAIT))]).catch(() => []));
  return (await Promise.all(asks)).flat().filter(x => /^tt\d+$/.test(x.id || ''));
}

function paint(items, q){
  shown = items;
  if(!q){ box.hidden = true; box.innerHTML = ''; return; }
  box.hidden = false;
  box.innerHTML = items.map(x => `<a class="sugi" href="#/detail/${esc(x.type)}/${encodeURIComponent(x.id)}" title="${esc(x.names[0])}">
      <span class="lbl" dir="auto">${esc(heTitle(x.id, x.names[0]))}</span>${x.year ? `<small class="lbl">${esc(String(x.year).slice(0, 4))}</small>` : ''}</a>`).join('')
    + `<a class="sugi all" href="#/search/${encodeURIComponent(q)}"><span class="lbl" dir="auto">${esc(tr('search.all', {q}))}</span></a>`;
}

/** Take the typed words: what is known at once, and then what the catalogues add. */
function typed(){
  const q = field.value.trim();
  clearTimeout(localTimer); clearTimeout(remoteTimer);
  if(q.length < 2){ asked = ''; paint([], ''); return; }
  localTimer = setTimeout(() => paint(known(q, MAX), q), LOCAL_MS);
  remoteTimer = setTimeout(async () => {
    asked = q;
    const found = await remote(q);
    if(asked !== q || field.value.trim() !== q) return;                    // typed on since: this answer is about other words
    const seen = new Set(), merged = [...known(q, MAX), ...found].filter(x => !seen.has(x.id) && seen.add(x.id));
    paint(merged.slice(0, MAX), q);
  }, REMOTE_MS);
}

/** Put the list away: a search was sent, or the viewer went somewhere else. */
export function clearSuggest(){
  clearTimeout(localTimer); clearTimeout(remoteTimer);
  asked = ''; paint([], '');
}

field?.addEventListener('input', typed);
$('#sf')?.addEventListener('submit', clearSuggest);
addEventListener('hashchange', clearSuggest);
