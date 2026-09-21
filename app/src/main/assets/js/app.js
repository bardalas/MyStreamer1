import {migrateStore} from './core/bridge.js';
import {$, bgObserver, lazyBg} from './core/dom.js';
import {invalidateView} from './core/requests.js';
import {rememberScreen, restoreScreen} from './core/screenmem.js';
import {store} from './core/store.js';
import {loadAddons} from './data/addons.js';
import {availObserver, resetAvailBudget} from './data/availability.js';
import {armHeAndAvail, heObserver} from './data/hebrew.js';
import {checkReminders} from './data/reminders.js';
import {loadServices} from './data/services.js';
import {indexProgress, progress, pruneProgress} from './data/watch.js';
import {tr} from './i18n.js';
import {viewKanProgram} from './providers/kan.js';
import {liveChannels, watchChannel} from './providers/live.js';
import {viewMakoProgram} from './providers/mako.js';
import {viewR13Series} from './providers/reshet.js';
import {openChannel} from './providers/rtv.js';
import {viewAddons} from './screens/addons.js';
import {viewTv} from './screens/broadcasters.js';
import {viewAll} from './screens/catalog.js';
import {viewDetail} from './screens/detail.js';
import {viewCategory, viewGenre, viewGenres, viewHome} from './screens/home.js';
import {viewLibrary} from './screens/library.js';
import {viewLive} from './screens/live.js';
import {viewSearch} from './screens/search.js';
import {viewSettings} from './screens/settings.js';
import {endTaste} from './ui/taste.js';
import {markNav} from './ui/rail.js';
import {checkUpdate} from './ui/update.js';
import './ui/tvnav.js';
import './ui/torrent.js';
import './ui/player.js';
import './ui/sources.js';
import './ui/reel.js';
import './providers/kan.js';
import './providers/reshet.js';
import './providers/mako.js';
import './data/availability.js';
import './data/watch.js';

// Loaded for the work they do as they load: the observers that fill in Hebrew titles and dim what
// cannot be watched, the remote, the status of a torrent, and the listeners each provider registers.

/* ---------- router ---------- */
$('#sf').onsubmit = e => { e.preventDefault(); const q = $('#q').value.trim(); if(q) location.hash = '#/search/' + encodeURIComponent(q); };
/** Let go of the previous screen's observers; the MutationObserver re-arms whatever the new one renders. */
export function resetObservers(){
  endTaste();                                        // whatever was about to start playing, is not
  resetAvailBudget();                                // a new screen may ask about its own titles
  for(const o of [bgObserver, heObserver, availObserver]) o.disconnect();
  document.querySelectorAll('[data-bgw]').forEach(el => { if(!el.style.backgroundImage) delete el.dataset.bgw; });
  requestAnimationFrame(() => { lazyBg(document); armHeAndAvail(document); });
}

/* Where every screen was left off (scroll, and on TV which poster had focus), so Back puts you
   back where you were instead of at the top of the page. */
export let listHash = '#/';                                 // the list a title was opened from
export let lastPaint = 0;                                   // when this screen was drawn, so a stale one is redrawn
export async function route(){
  invalidateView();                                 // cancel work from the previous view before rendering
  rememberScreen();
  resetObservers();
  document.body.classList.remove('titlefit');
  // the new screen comes up from just below itself; restarting the class restarts the movement
  const canvas = $('#app');
  canvas.classList.remove('fresh'); void canvas.offsetWidth; canvas.classList.add('fresh');
  const [, r = '', a, b, c] = location.hash.split('/').map(decodeURIComponent);
  // the menu lights the place you are in; a title or a search keeps the one it was opened from
  markNav(r === 'cat' ? (['movies', 'series'].includes(a) ? a : '') : r === 'all' ? (a === 'movie' ? 'movies' : 'series')
    : ['live', 'library', 'settings'].includes(r) ? r : '');
  if(['', 'cat', 'all', 'genres', 'genre', 'search', 'library'].includes(r)) listHash = location.hash || '#/';
  if(r === 'genres') viewGenres();
  else if(r === 'genre') viewGenre(a);
  else if(r === 'r13') viewR13Series(a, b);
  else if(r === 'kan') viewKanProgram(a, b);
  else if(r === 'tv') viewTv(a);
  else if(r === 'mako') viewMakoProgram(a, b);
  else if(r === 'cat') viewCategory(a);
  else if(r === 'all') viewAll(a);
  else if(r === 'live') viewLive();
  else if(r === 'search') viewSearch(a);
  else if(r === 'detail') viewDetail(a, b);
  else if(r === 'library') viewLibrary();
  else if(r === 'addons') viewAddons();
  else if(r === 'settings') viewSettings(a);
  else viewHome();
  restoreScreen();
  lastPaint = Date.now();
}
/** The projector logo: back to the last live channel (or home, if nothing was watched yet). */
document.querySelector('.logo').addEventListener('click', async e => {
  const last = store.get('lastChannel', null);
  if(!last){ location.hash = '#/'; return; }           // no channel yet: the logo is just "home"
  e.preventDefault();
  try{
    const chans = await liveChannels(last.src);
    const i = chans.findIndex(c => c.name === last.name);
    if(i >= 0) return watchChannel(chans, i, last.src);
  }catch(err){}
  location.hash = '#/live';
});
/** The player reports how far the viewer got; it feeds "המשך צפייה" and resuming. */
window.boothProgress = json => {
  try{
    const entries = JSON.parse(json);
    for(const [videoId, e] of Object.entries(entries)){
      if(!e || !e.d) continue;
      const w = {t: +e.t || 0, d: +e.d || 0, at: +e.at || Date.now(), metaId: e.metaId || videoId, type: e.type || 'movie', name: e.name || '', poster: e.poster || ''};
      w.done = w.t > w.d - 60;            // watched to the end: a tick on the poster, and out of "continue watching"
      progress[videoId] = w;
    }
    pruneProgress();
    store.set('progress', progress);
    indexProgress();
    if(['', '#/', '#'].includes(location.hash)) route();
  }catch(e){}
};

/** The player asks for a channel's catch-up (long press OK while watching). */
window.boothCatchup = async name => {
  const last = store.get('lastChannel', null);
  try{
    const chans = await liveChannels(last?.src || 'il');
    const c = chans.find(x => x.name === name);
    if(c) openChannel(c);
  }catch(e){}
};

addEventListener('hashchange', route);
/* No connection: one bar at the bottom instead of a screenful of errors; the screen reloads by itself
   as soon as the line is back. */
export const offbar = Object.assign(document.createElement('div'), {id: 'offbar', role: 'status'});
offbar.innerHTML = `<span data-i18n="net.offbar">${tr('net.offbar')}</span>`;
document.body.appendChild(offbar);
export const paintNet = () => offbar.classList.toggle('on', !navigator.onLine);
addEventListener('offline', paintNet);
addEventListener('online', () => { paintNet(); route(); });
paintNet();
/* ---------- boot ---------- */
export async function boot(){
  if(await migrateStore()) return;                     // what was kept before is being brought over
  const ready = loadAddons();
  const first = await Promise.race([ready, new Promise(r => setTimeout(() => r('slow'), 6000))]);
  route();                                             // render now, with whatever has answered
  if(first === 'slow'){
    await ready;                                       // and when the add-ons finally arrive,
    if(['', '#/', '#'].includes(location.hash)) route();   // fill the home screen they left empty
  }
  setTimeout(loadServices, 3000);
  setTimeout(() => checkUpdate(true), 2500);
  setTimeout(checkReminders, 9000);
}
boot();
addEventListener('visibilitychange', () => {
  if(document.visibilityState !== 'visible'){ endTaste(); return; }
  checkUpdate();
  checkReminders();
  // a screen left open for a while is old news: draw it again, with fresh titles and another featured one
  if(Date.now() - lastPaint > 15 * 60e3) route();
});

// Torrent progress from the Android engine. Empty message hides the bar.
