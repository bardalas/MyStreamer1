/* The home screen, and a category of it. */
import {esc} from '../core/dom.js';
import {isTvLayout, settings} from '../core/settings.js';
import {store} from '../core/store.js';
import {addons} from '../data/addons.js';
import {BOOTH_ID, CATEGORIES, CINEMETA_ID, SC_ID, catName, mergedRow, rowsFor, userCategories} from '../data/catalogs.js';
import {catalogName, genreName} from '../data/names.js';
import {GENRES, gridFrom, pageFilters, sortActive, sortBar, wireSortBar} from '../data/sort.js';
import {progress} from '../data/watch.js';
import {tr} from '../i18n.js';
import {originMark, originName, originsFor} from '../ui/origins.js';
import {renderRows, retune} from '../ui/rows.js';

export function viewGenres(){ viewHome(); }
export function viewGenre(g){
  pageFilters.set('genre', GENRES.includes(g) ? g : '');
  viewHome();
}

/* A whole type - every film, or every series - laid out the way the services people know lay it out:
   what everyone is watching, what is best, then the collections (Israeli titles, and each broadcaster's
   own programmes), and then a row per genre - on Movies and Series, under the wheel the source tabs
   turn. (Their library, screens/library.js, is every one of their titles in one grid instead.) */
export const GENRE_ROWS = {
  movie: ['Family', 'Animation', 'Comedy', 'Action', 'Thriller', 'Documentary', 'Sci-Fi', 'Horror'],
  series: ['Drama', 'Comedy', 'Crime', 'Documentary', 'Animation', 'Sci-Fi', 'Mystery'],
};
/** The broadcasters' own programmes, inside the type they belong to - films with the films, the rest with the series. */
const broadcasterRows = type => type === 'movie'
  ? [{origins: ['kan'], type, title: tr('row.fromKan'), more: '#/tv/kan'}, {origins: ['jfc'], type, title: tr('row.fromArchive'), more: '#/tv/jfc'}]
  : [{origins: ['kan'], type, title: tr('row.fromKan'), more: '#/tv/kan'},
     {origins: ['mako'], type, title: tr('row.fromKeshet'), more: '#/tv/keshet'},
     {origins: ['r13'], type, title: tr('row.fromReshet'), more: '#/tv/reshet'}];

export function typeRows(type){
  const rows = [];
  const cm = addons.find(a => a.manifest.id === CINEMETA_ID);
  const cmCat = id => (cm?.manifest.catalogs || []).find(c => c.id === id && c.type === type);
  const top = cmCat('top'), best = cmCat('imdbRating');
  if(top) rows.push({a: cm, c: top, title: tr('row.popular'), notype: true});
  if(best) rows.push({a: cm, c: best, title: tr('row.best'), notype: true});
  const local = addons.find(a => a.manifest.id === BOOTH_ID);
  if(local) for(const c of local.manifest.catalogs || []) if(c.type === type) rows.push({a: local, c, title: catalogName(c.name)});
  rows.push(...broadcasterRows(type));
  if(top) for(const g of GENRE_ROWS[type] || []) rows.push({a: cm, c: top, extra: `genre=${encodeURIComponent(g)}`, title: genreName(g), notype: true});
  return rows;
}
/** What was left in the middle, of one type (or of every type). */
const unfinished = type => Object.entries(progress).filter(([, x]) => !x.done && (!type || x.type === type))
  .sort(([, x], [, y]) => y.at - x.at).map(([videoId, x]) => ({videoId, ...x})).slice(0, 12);

export async function viewHome(){
  // Cinemeta's popular rows, then the first row of every category.
  if(settings.kids === 'on') return renderRows(rowsFor(CATEGORIES.find(c => c.id === 'kids')));
  const cm = addons.find(a => a.manifest.id === CINEMETA_ID);
  const rows = cm ? (cm.manifest.catalogs || []).filter(c => c.id === 'top').map(c => ({a: cm, c, title: tr(c.type === 'movie' ? 'row.popularMovies' : 'row.popularSeries'), notype: true})) : [];
  if(addons.some(a => a.manifest.id === SC_ID)) rows.push(mergedRow('movie', tr('row.streamingMovies')), mergedRow('series', tr('row.streamingSeries')));
  for(const cat of userCategories()){
    const r = rowsFor(cat);
    if(r.length) rows.push(...r.slice(0, 2).map(x => ({...x, title: cat.prefix ? `${catName(cat)} · ${x.title}` : x.title})));
  }
  if(!rows.length) for(const a of addons) for(const c of a.manifest.catalogs || []){
    if((c.extra||[]).some(e => e.isRequired) || (c.extraRequired||[]).length) continue;
    if(rows.length < 8) rows.push({a, c, title: catalogName(c.name) || c.id});
  }
  if(sortActive()) return gridFrom(rows, tr('cats.all'), viewHome);
  renderRows(isTvLayout() ? rows.slice(0, 10) : rows, {cont: unfinished(), top: `<div class="page pagehead">${sortBar()}</div>`});
  wireSortBar(viewHome);
}

export function viewCategory(id){
  const type = id === 'movies' ? 'movie' : id === 'series' ? 'series' : null;
  if(type) return viewType(type);
  const cat = CATEGORIES.find(c => c.id === id);
  if(!cat) return viewHome();
  const rows = rowsFor(cat);
  const name = catName(cat);
  const Redraw = () => viewCategory(id);
  if(sortActive()) return gridFrom(rows, name, Redraw);
  renderRows(isTvLayout() ? rows.slice(0, 12) : rows, {top: `<div class="page pagehead"><h1>${esc(name)}</h1>${sortBar()}</div>`});
  wireSortBar(Redraw);
}

/* ---------- Movies, Series: a wheel with a tab for every source, and the type's rows ----------
   The page opens on a wheel of titles and, over it, a tab for every place they come from - "All",
   each streaming service, each broadcaster, the archive, the Israeli catalogues - each a small glyph.
   Resting on a tab turns the wheel to that source; every poster carries its source's mark in the
   corner. Under the wheel are the type's rows; the library, with the filters, is one button away. The
   tab last chosen is remembered for each type. */
const TAB_KEY = 'srcTab';
/** How many rows a television draws of the page: they load only as they come near the screen. */
const TV_ROWS = 18;
/** How long the remote rests on a tab before the wheel turns to it - passing over one loads nothing. */
const TAB_SETTLE_MS = 350;
const ALL = 'all';
export function viewType(type){
  const origins = originsFor(type);
  const chosen = store.get(TAB_KEY, {})[type];
  const tab = origins.some(o => o.id === chosen) ? chosen : ALL;
  const idsOf = id => id === ALL ? origins.map(o => o.id) : [id];
  const tabs = [`<button class="srctab all${tab === ALL ? ' on' : ''}" data-src="${ALL}">${tr('src.all')}</button>`,
    ...origins.map(o => `<button class="srctab${tab === o.id ? ' on' : ''}" data-src="${o.id}" title="${esc(originName(o))}" aria-label="${esc(originName(o))}">${originMark(o)}</button>`)];
  const top = `<div class="page pagehead typehead"><h1>${esc(tr(type === 'movie' ? 'cats.movies' : 'cats.series'))}</h1>
    <div class="srctabs" role="tablist">${tabs.join('')}<a class="libgo" href="#/all/${type}">${tr('lib.enter')}</a></div></div>`;
  // the wheel the tabs turn, then the type's rows - what is popular, what is best, the collections, the genres
  const rows = [{origins: idsOf(tab), type, tabbed: true, badge: true, title: ''}, ...typeRows(type)];
  renderRows(isTvLayout() ? rows.slice(0, TV_ROWS) : rows, {top, cont: unfinished(type), contAt: 1});
  let settle = 0;
  const pick = b => {
    clearTimeout(settle);
    if(b.classList.contains('on')) return;
    document.querySelectorAll('.srctab.on').forEach(x => x.classList.remove('on'));
    b.classList.add('on');
    store.set(TAB_KEY, {...store.get(TAB_KEY, {}), [type]: b.dataset.src});
    retune(0, idsOf(b.dataset.src));
  };
  document.querySelectorAll('.srctab').forEach(b => {
    b.onclick = () => pick(b);
    b.onfocus = () => { clearTimeout(settle); settle = setTimeout(() => b.isConnected && document.activeElement === b && pick(b), TAB_SETTLE_MS); };
  });
}
