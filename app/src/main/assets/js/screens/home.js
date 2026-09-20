/* The home screen, and a category of it. */
import {esc} from '../core/dom.js';
import {isTvLayout, settings} from '../core/settings.js';
import {store} from '../core/store.js';
import {addons} from '../data/addons.js';
import {BOOTH_ID, CATEGORIES, CINEMETA_ID, SC_ID, catName, mergedRow, rowsFor, userCategories} from '../data/catalogs.js';
import {catalogName, genreName} from '../data/names.js';
import {GENRES, gridFrom, sortActive, sortBar, sortState, wireSortBar} from '../data/sort.js';
import {progress} from '../data/watch.js';
import {tr} from '../i18n.js';
import {renderRows} from '../ui/rows.js';

export function viewGenres(){ viewHome(); }
export function viewGenre(g){
  sortState.genre = GENRES.includes(g) ? g : '';
  store.set('sort', sortState);
  viewHome();
}

/* A whole type - every film, or every series - laid out the way the services people know lay it out:
   what is new, what everyone is watching, what is best, then the collections (Israeli titles, and
   each broadcaster's own programmes), and then a row per genre. The pills above the rows filter the
   same set by genre, service, year or rating, so nothing here has to be browsed to be found. */
export const GENRE_ROWS = {
  movie: ['Family', 'Animation', 'Comedy', 'Action', 'Thriller', 'Documentary', 'Sci-Fi', 'Horror'],
  series: ['Drama', 'Comedy', 'Crime', 'Documentary', 'Animation', 'Sci-Fi', 'Mystery'],
};
/** The broadcasters' own programmes, inside the type they belong to - films with the films, the rest with the series. */
export const broadcasterRows = type => type === 'movie'
  ? [{kan: /סרטים/, title: tr('row.fromKan'), more: '#/tv/kan'}, {jfc: true, title: tr('row.fromArchive'), more: '#/tv/jfc'}]
  : [{kanAll: true, title: tr('row.fromKan'), more: '#/tv/kan'},
     {mako: true, title: tr('row.fromKeshet'), more: '#/tv/keshet'},
     {r13: 'series', title: tr('row.fromReshet'), more: '#/tv/reshet'}];

export function typeRows(type){
  const rows = [];
  const cm = addons.find(a => a.manifest.id === CINEMETA_ID);
  const cmCat = id => (cm?.manifest.catalogs || []).find(c => c.id === id && c.type === type);
  const top = cmCat('top'), best = cmCat('imdbRating');
  if(addons.some(a => a.manifest.id === SC_ID)) rows.push({...mergedRow(type, tr('row.newStreaming')), notype: true});
  if(top) rows.push({a: cm, c: top, title: tr('row.popular'), notype: true});
  if(best) rows.push({a: cm, c: best, title: tr('row.best'), notype: true});
  const local = addons.find(a => a.manifest.id === BOOTH_ID);
  if(local) for(const c of local.manifest.catalogs || []) if(c.type === type) rows.push({a: local, c, title: catalogName(c.name)});
  rows.push(...broadcasterRows(type));
  if(top) for(const g of GENRE_ROWS[type] || []) rows.push({a: cm, c: top, extra: `genre=${encodeURIComponent(g)}`, title: genreName(g), notype: true});
  return rows;
}

export async function viewHome(){
  // Cinemeta's popular rows, then the first row of every category.
  if(settings.kids === 'on') return renderRows(rowsFor(CATEGORIES.find(c => c.id === 'kids')));
  const cm = addons.find(a => a.manifest.id === CINEMETA_ID);
  const rows = cm ? (cm.manifest.catalogs || []).filter(c => c.id === 'top').map(c => ({a: cm, c, title: tr(c.type === 'movie' ? 'row.popularMovies' : 'row.popularSeries'), notype: true})) : [];
  if(addons.some(a => a.manifest.id === SC_ID)) rows.push({...mergedRow('movie', tr('row.newStreamingMovies')), notype: true}, {...mergedRow('series', tr('row.newStreamingSeries')), notype: true});
  for(const cat of userCategories()){
    const r = rowsFor(cat);
    if(r.length) rows.push(...r.slice(0, 2).map(x => ({...x, title: cat.prefix ? `${catName(cat)} · ${x.title}` : x.title})));
  }
  if(!rows.length) for(const a of addons) for(const c of a.manifest.catalogs || []){
    if((c.extra||[]).some(e => e.isRequired) || (c.extraRequired||[]).length) continue;
    if(rows.length < 8) rows.push({a, c, title: catalogName(c.name) || c.id});
  }
  if(sortActive()) return gridFrom(rows, tr('cats.all'), viewHome);
  const cont = Object.entries(progress).filter(([id, x]) => !x.done).sort(([,x],[,y]) => y.at - x.at).map(([videoId, x]) => ({videoId, ...x})).slice(0, 12);
  renderRows(isTvLayout() ? rows.slice(0, 10) : rows, {cont, top: `<div class="page pagehead">${sortBar()}</div>`});
  wireSortBar(viewHome);
}

export function viewCategory(id){
  const type = id === 'movies' ? 'movie' : id === 'series' ? 'series' : null;
  const cat = CATEGORIES.find(c => c.id === id);
  if(!type && !cat) return viewHome();
  const rows = type ? typeRows(type) : rowsFor(cat);
  const name = type ? tr('cats.' + id) : catName(cat);
  const Redraw = () => viewCategory(id);
  if(sortActive()) return gridFrom(rows, name, Redraw);
  // what was left in the middle, of this type
  const cont = type ? Object.entries(progress).filter(([id, x]) => !x.done && x.type === type).sort(([,x],[,y]) => y.at - x.at).map(([videoId, x]) => ({videoId, ...x})).slice(0, 12) : [];
  // the name of what you are browsing and the filters share one line, so the titles are the first thing on the screen
  renderRows(isTvLayout() ? rows.slice(0, 12) : rows, {cont, top: `<div class="page pagehead"><h1>${esc(name)}</h1>${sortBar()}</div>`});
  wireSortBar(Redraw);
}

/** The title with the place of honour: a different one on every visit, out of the best the page holds.
    Nothing without artwork and a few words about it can hold the spot; null means "not from this row". */
