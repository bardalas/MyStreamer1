/* The home screen, and a category of it. */
import {isTvLayout, settings} from '../core/settings.js';
import {store} from '../core/store.js';
import {addons} from '../data/addons.js';
import {BOOTH_ID, CATEGORIES, CINEMETA_ID, SC_ID, catName, mergedRow, rowsFor, userCategories} from '../data/catalogs.js';
import {catalogName} from '../data/names.js';
import {GENRES, gridFrom, sortActive, sortBar, sortState, wireSortBar} from '../data/sort.js';
import {progress} from '../data/watch.js';
import {tr} from '../i18n.js';
import {renderCats} from '../ui/rail.js';
import {renderRows} from '../ui/rows.js';

export function viewGenres(){ viewHome(); }
export function viewGenre(g){
  sortState.genre = GENRES.includes(g) ? g : '';
  store.set('sort', sortState);
  viewHome();
}

/** Resolve a category's row specs against the installed add-ons. */

export function typeRows(type){
  const cm = addons.find(a => a.manifest.id === CINEMETA_ID);
  const rows = [];
  if(cm) for(const id of ['top', 'imdbRating']) for(const c of cm.manifest.catalogs || [])
    if(c.id === id && c.type === type) rows.push({a: cm, c, title: tr(id === 'top' ? 'row.popular' : 'row.best'), notype: true});
  if(addons.some(a => a.manifest.id === SC_ID)) rows.push({...mergedRow(type, tr('row.newStreaming')), notype: true});
  const local = addons.find(a => a.manifest.id === BOOTH_ID);
  if(local) for(const c of local.manifest.catalogs || []) if(c.type === type) rows.push({a: local, c, title: catalogName(c.name)});
  return rows;
}

export async function viewHome(){
  renderCats('home');
  // Cinemeta's popular rows, then the first row of every category.
  if(settings.kids === 'on') return renderRows(rowsFor(CATEGORIES.find(c => c.id === 'kids')), {hero: false});
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
  const cont = Object.values(progress).filter(x => !x.done).sort((x,y) => y.at - x.at).slice(0, 12);
  renderRows(isTvLayout() ? rows.slice(0, 10) : rows, {cont, hero: settings.layout === 'cinema', top: `<div class="page" style="padding-bottom:0">${sortBar()}</div>`});
  wireSortBar(viewHome);
}

export function viewCategory(id){
  const type = id === 'movies' ? 'movie' : id === 'series' ? 'series' : null;
  const cat = CATEGORIES.find(c => c.id === id);
  if(!type && !cat) return viewHome();
  renderCats(id);
  const rows = type ? typeRows(type) : rowsFor(cat);
  const name = type ? tr('cats.' + id) : catName(cat);
  const redraw = () => viewCategory(id);
  if(sortActive()) return gridFrom(rows, name, redraw);
  renderRows(rows, {hero: settings.layout === 'cinema', heading: name, top: `<div class="page" style="padding-bottom:0">${sortBar()}</div>`});
  wireSortBar(redraw);
}

/** The title with the place of honour: a different one on every visit, out of the best the page holds.
    Nothing without artwork and a few words about it can hold the spot; null means "not from this row". */
