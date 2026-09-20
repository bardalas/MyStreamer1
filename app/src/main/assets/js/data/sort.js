/* Sorting and filtering: one pill per subject, and the grid they turn a screen into. */
import {$, esc, lazyBg} from '../core/dom.js';
import {store} from '../core/store.js';
import {addons, catalogFetch} from './addons.js';
import {CINEMETA_ID, SC_ID} from './catalogs.js';
import {heTitle} from './hebrew.js';
import {genreName, srcName} from './names.js';
import {SERVICES, noteServices, svcOf} from './services.js';
import {UI, tr} from '../i18n.js';
import {card, skeletons} from '../ui/cards.js';

/* ---------- sorting and filtering ----------
   Real IMDb ratings and years come with the catalogue itself, so a category can be re-ordered
   without asking anything else: one tap per choice, and the rows become one ranked grid. */
export const GENRES = ['Comedy', 'Action', 'Drama', 'Thriller', 'Horror', 'Sci-Fi', 'Romance', 'Animation', 'Family', 'Crime', 'Adventure',
  'Fantasy', 'Documentary', 'Mystery', 'History', 'War', 'Music', 'Sport', 'Western'];
export const SORT_GROUPS = [
  {key: 'genre', label: 'sort.genre', opts: [['', 'sort.genre.all'], ...GENRES.map(g => [g, ''])]},
  {key: 'svc', label: 'sort.svc', opts: [['', 'sort.svc.all'], ...Object.keys(SERVICES).map(k => [k, ''])]},
  {key: 'year', label: 'sort.year', opts: [['', 'sort.year.all'], ['2020', 'sort.year.2020'], ['2010', 'sort.year.2010'], ['2000', 'sort.year.2000'], ['old', 'sort.year.old']]},
  {key: 'rate', label: 'sort.rate', opts: [['', 'sort.rate.all'], ['7', 'sort.rate.7'], ['8', 'sort.rate.8']]},
  {key: 'by', label: 'sort.by', opts: [['pop', 'sort.by.pop'], ['rating', 'sort.by.rating'], ['year', 'sort.by.year'], ['az', 'sort.by.az']]},
];
/** The words of one choice: genres come from the names table, everything else from the strings. */
export const optLabel = (g, [v, n]) => g.key === 'genre' && v ? genreName(v) : g.key === 'svc' && v ? SERVICES[v] : tr(n);
export let sortState = Object.assign({genre: '', svc: '', by: 'pop', year: '', rate: ''}, store.get('sort', {}));
export const sortActive = () => sortState.by !== 'pop' || !!sortState.year || !!sortState.rate || !!sortState.genre || !!sortState.svc;
export const yearOfMeta = m => +String(m.year || m.releaseInfo || '').slice(0, 4) || 0;
export const rateOf = m => parseFloat(m.imdbRating) || 0;

/** One pill per subject, each showing what is chosen; the first option of a subject is its "off" state. */
export function sortBar(){
  const pills = SORT_GROUPS.map(g => {
    const cur = g.opts.find(([v]) => v === sortState[g.key]) || g.opts[0];
    return `<button class="sortpill${sortState[g.key] !== g.opts[0][0] ? ' on' : ''}" data-sk="${g.key}" aria-haspopup="dialog"><span>${tr(g.label)}</span><b>${esc(optLabel(g, cur))}</b></button>`;
  }).join('');
  return `<div class="sortbar" role="group" aria-label="${esc(tr('sort.aria'))}">${pills}${sortActive() ? `<button class="sortpill clear" data-sclear>${tr('sort.clear')}</button>` : ''}</div>`;
}
/** [redraw] is called after every change. */
export function wireSortBar(redraw){
  document.querySelectorAll('.sortpill[data-sk]').forEach(b => b.onclick = () => openSortSheet(b.dataset.sk, redraw));
  const clear = document.querySelector('[data-sclear]');
  if(clear) clear.onclick = () => { sortState = {genre: '', svc: '', by: 'pop', year: '', rate: ''}; store.set('sort', sortState); redraw(); };
}
/** The choices of one subject, in a sheet the remote stays inside (Back closes it). */
export function openSortSheet(key, redraw){
  const g = SORT_GROUPS.find(x => x.key === key);
  const sheet = document.createElement('div');
  sheet.className = 'sheet';
  sheet.innerHTML = `<div role="dialog" aria-label="${esc(tr(g.label))}"><header><b>${tr(g.label)}</b><button aria-label="${esc(tr('common.close'))}">✕</button></header>
    <div class="body sortopts">${g.opts.map(([v, n]) => `<button class="sopt${sortState[key] === v ? ' on' : ''}" data-v="${v}">${esc(optLabel(g, [v, n]))}</button>`).join('')}</div></div>`;
  document.body.appendChild(sheet);
  sheet.onclick = e => { if(e.target === sheet) sheet.remove(); };
  sheet.querySelector('header button').onclick = () => sheet.remove();
  sheet.querySelectorAll('.sopt').forEach(b => b.onclick = () => {
    sortState[key] = b.dataset.v; store.set('sort', sortState);
    sheet.remove(); redraw();
    document.querySelector(`.sortpill[data-sk="${key}"]`)?.focus();
  });
  (sheet.querySelector('.sopt.on') || sheet.querySelector('.sopt')).focus();
}
/** Apply the current choice to a list of titles. */
export function applySort(list){
  const {by, year, rate, genre, svc} = sortState;
  let out = list.filter(m => {
    const y = yearOfMeta(m);
    if(genre && !(m.genres || m.genre || []).includes(genre)) return false;
    if(svc && !svcOf(m.id).includes(SERVICES[svc])) return false;
    if(year === '2020' && y < 2020) return false;
    if(year === '2010' && (y < 2010 || y > 2019)) return false;
    if(year === '2000' && (y < 2000 || y > 2009)) return false;
    if(year === 'old' && (!y || y >= 2000)) return false;
    if(rate && rateOf(m) < +rate) return false;
    return true;
  });
  if(by === 'rating') out = out.sort((a, b) => rateOf(b) - rateOf(a));
  if(by === 'year') out = out.sort((a, b) => yearOfMeta(b) - yearOfMeta(a));
  if(by === 'az') out = out.sort((a, b) => heTitle(a.id, a.name).localeCompare(heTitle(b.id, b.name), UI));
  return out;
}

/** Everything a set of rows holds, as one ranked grid: used whenever a filter or a sort is on. A genre widens
    the set with that genre's popular and top-rated titles, so it works from any page. [redraw] shows the page again. */
export async function gridFrom(rows, heading, redraw){
  const app = $('#app');
  const all = withServiceRows(withGenreRows(rows));
  app.innerHTML = `<div class="page"><h1>${esc(heading)}</h1>${sortBar()}<p class="sortnote" id="gnote"></p><div class="grid" id="grid">${skeletons(18)}</div></div>`;
  wireSortBar(redraw);
  const lists = await Promise.all(all.filter(x => x.a && x.c).map(x =>
    catalogFetch(x.a, x.c.type, x.c.id, x.extra).then(d => {
      const metas = d.metas || [];
      if(SERVICES[x.c.id]) metas.forEach(m => noteServices(m.id, SERVICES[x.c.id]));   // a service's own catalogue says so
      return metas;
    }).catch(() => [])));
  const seen = new Set(), metas = [];
  for(const l of lists) for(const m of l) if(!seen.has(m.id)){ seen.add(m.id); metas.push(m); }
  const grid = $('#grid');
  if(!grid) return;
  const out = applySort(metas);
  grid.innerHTML = out.length ? out.slice(0, 200).map(card).join('') : `<p class="note">${tr('sort.none')}</p>`;
  const by = SORT_GROUPS.find(g => g.key === 'by');
  $('#gnote').textContent = tr('sort.summary', {n: Math.min(out.length, 200), by: optLabel(by, by.opts.find(([v]) => v === sortState.by)),
    from: [...new Set(all.filter(x => x.a).map(x => srcName(x.a)))].join(', ')});
  lazyBg(grid);
}
/** A chosen service adds that service's own catalogue, so the filter has something to show everywhere. */
export function withServiceRows(rows){
  const sc = sortState.svc && addons.find(a => a.manifest.id === SC_ID);
  if(!sc) return rows;
  return [...rows, ...(sc.manifest.catalogs || []).filter(c => c.id === sortState.svc).map(c => ({a: sc, c}))];
}
/** A chosen genre adds Cinemeta's popular and top-rated titles of that genre to whatever the page holds. */
export function withGenreRows(rows){
  const cm = sortState.genre && addons.find(a => a.manifest.id === CINEMETA_ID);
  if(!cm) return rows;
  const extra = [];
  for(const id of ['top', 'imdbRating']) for(const c of cm.manifest.catalogs || [])
    if(c.id === id) extra.push({a: cm, c, extra: `genre=${encodeURIComponent(sortState.genre)}`});
  return [...rows, ...extra];
}
