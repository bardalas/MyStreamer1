/* ---------- The wheel: a row that turns instead of scrolling ----------
   What you are on stands still in the middle of the row and the titles come to it. Whatever stands
   there is not a poster any more but the title itself: its picture wide, a taste of it playing in
   the picture, its name, what it is, two lines about it, and the two things you can do with it.
   The card that used to open over the screen is gone - browsing IS the card now. Nothing here
   announces itself: the taste waits until you have stayed a moment, and ends the instant you move. */
import {esc} from '../core/dom.js';
import {noteOpened} from '../core/screenmem.js';
import {settings} from '../core/settings.js';
import {fetchMeta, warmSources, yearOf} from '../data/addons.js';
import {hebrewOn, hebrewPlot} from '../data/hebrew.js';
import {genreName} from '../data/names.js';
import {svcMarks} from '../data/services.js';
import {progress} from '../data/watch.js';
import {tr} from '../i18n.js';
import {endTaste, startTaste, trailerId} from './taste.js';

/* The still point of the wheel is where the row begins - the right, in Hebrew. A title brought to it
   has the whole row ahead of it and nothing wasted behind it, and from the first title on, moving
   along the row turns the wheel rather than moving the viewer. */
const WIDE = matchMedia('(min-width: 900px)');
/* A wheel needs a row. The poster wall and the list lay the same titles out as a grid, and a grid
   has no middle to bring anything to - there the titles stay as they are. */
export const reelable = () => !['grid', 'list'].includes(settings.layout);
const turning = () => reelable() && WIDE.matches;

let spot = null;              // the title in the middle
let settling = 0;             // what the middle will say, once the viewer has stopped moving
let restingSince = 0;         // when the moving stopped: the taste is measured from there
let act = null;               // its buttons, under the picture
let hadArt = '';              // the artwork the poster carried before the picture widened

/** Let the middle go: the picture narrows back into a poster and the taste stops. */
export function clearSpot(){
  clearTimeout(settling);
  endTaste();
  if(spot?.isConnected){
    spot.classList.remove('spot');
    spot.dataset.wasSpot = '1';      // the row remembers it, for when the viewer comes back to the row
    const art = spot.querySelector('.art');
    if(art){
      art.querySelector('.taste')?.remove();
      art.querySelector('.spotinfo')?.remove();
      art.style.backgroundImage = hadArt;
      art.classList.remove('taste-on');
    }
    // the row stays where the viewer left it - the title they were on, now a poster, keeps the middle
    const strip = spot.closest('.strip');
    if(strip?.classList.contains('reel') && turning()) strip.style.transform = `translateX(${Math.round(turn(strip, spot))}px)`;
  }
  act?.remove();
  spot = null; act = null; hadArt = '';
}

/** Bring [el] to the middle of its row. */
export function spotlight(el){
  if(!el || el === spot || !el.isConnected || !reelable()) return;
  const strip = el.closest('.strip');
  if(!strip) return;
  clearSpot();
  spot = el;
  strip.querySelectorAll('[data-was-spot]').forEach(x => delete x.dataset.wasSpot);
  el.classList.add('spot');
  delete el.dataset.wasSpot;
  const art = el.querySelector('.art');
  hadArt = art?.style.backgroundImage || '';
  const full = (el.getAttribute('href') || '').startsWith('#/detail/');
  act = document.createElement('div');
  act.className = 'spotact';
  // The picture or clicking it takes the user straight to its own full page
  act.innerHTML = ``;
  strip.appendChild(act);
  place();
  /* A viewer running along the row is not reading anything. The picture widens at once - that is what
     a press must answer - but the title's own story, which costs an answer from the add-ons, a page
     of writing and a trailer, waits until they have stopped on it. Otherwise every press pays for
     work the next press throws away, which is the whole of what makes a wheel feel heavy. */
  settling = setTimeout(() => {
    restingSince = performance.now();
    if(spot === el && el.isConnected) paint(el, full);
  }, 600);
}

/** Put the buttons under the picture, and turn the wheel until the title is in the middle. */
export function place(){
  if(!spot?.isConnected || !act) return;
  const strip = spot.closest('.strip');
  if(!strip) return;
  const art = spot.querySelector('.art');
  act.style.left = spot.offsetLeft + 'px';
  // under the whole title - its picture and the name beneath it - not over the name
  act.style.top = spot.offsetTop + spot.offsetHeight + 4 + 'px';
  act.style.width = spot.offsetWidth + 'px';
  if(!turning() || !strip.classList.contains('reel')){ strip.style.transform = ''; return; }
  strip.style.transform = `translateX(${Math.round(turn(strip, spot))}px)`;
}
/**
 * How far the row has to turn to bring the title to the still point - and no further: a wheel that
 * turned past its last title would show the viewer an empty row, so the ends hold.
 */
function turn(strip, el){
  const wide = strip.clientWidth;                    // the row's own width: the wheel turns inside it
  const kids = [...strip.children].filter(el => el.classList.contains('poster'));
  if(!kids.length) return 0;
  const lo = Math.min(...kids.map(k => k.offsetLeft));
  const hi = Math.max(...kids.map(k => k.offsetLeft + k.offsetWidth));
  if(hi - lo <= wide) return 0;                      // a row that fits has nowhere to turn
  const rtl = document.documentElement.dir === 'rtl';
  const want = rtl ? wide - (el.offsetLeft + el.offsetWidth) : -el.offsetLeft;
  return Math.min(Math.max(want, wide - hi), -lo);
}
addEventListener('resize', place);

/** What the title says for itself: the name at once, the rest as the add-ons answer. */
/**
 * Put the wide picture in place of the poster - but only once it has arrived.
 *
 * Setting a background the browser has still to fetch makes it decode a photograph in the middle of
 * whatever else is happening, and passing along a row then asks for one picture after another. Asked
 * for beforehand and put in place when it is ready, a title the viewer only passed costs nothing.
 */
function showArt(art, url){
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
  const put = () => {
    if(art.isConnected && art.closest('.poster')?.classList.contains('spot'))
      art.style.backgroundImage = `url('${url.replace(/'/g, '%27')}')`;
  };
  (img.decode ? img.decode() : Promise.resolve()).then(put, put);
}

async function paint(el, full){
  const art = el.querySelector('.art');
  if(!art) return;
  /* Under the picture, where a title's name always is - not written over the picture itself. The
     name is already there, in the same place as every other title's; what is added is the line that
     says what this one is, and it is added below it rather than in front of the artwork. */
  act.innerHTML = `<div class="spotinfo"><div class="facts"></div><p dir="auto"></p></div>`;
  if(!full) return;                                  // a broadcaster's programme: its picture and its name
  const [, , type, idEnc] = el.getAttribute('href').split('/');
  const id = decodeURIComponent(idEnc);
  warmSources(type, type === 'series' ? `${id}:1:1` : id);     // so that "נגן" has something ready
  const meta = await fetchMeta(type, id).catch(() => null);
  if(spot !== el || !el.isConnected) return;
  const info = act?.querySelector('.spotinfo');
  if(!info) return;
  if(meta){
    if(meta.background) showArt(art, meta.background);
    // one line of it: what it scores, when it is from, how long, what it is - and the marks of whoever has it
    info.querySelector('.facts').innerHTML = [
      meta.imdbRating && `<span class="imdb">IMDb ${esc(meta.imdbRating)}</span>`,
      yearOf(meta) && `<span>${esc(yearOf(meta))}</span>`, meta.runtime && `<span>${esc(meta.runtime)}</span>`,
      ...(meta.genres || meta.genre || []).slice(0, 1).map(g => `<span>${esc(genreName(g))}</span>`),
      svcMarks(id) && `<span>${svcMarks(id)}</span>`].filter(Boolean).join('');
    info.querySelector('p').textContent = meta.description || '';
    // Two seconds from the moment the viewer came to rest - counted from then, not from whenever the
    // add-ons happened to answer, so it is the same wait every time. Quietly: browsing is not watching.
    const waited = performance.now() - restingSince;
    startTaste('.poster.spot .art', trailerId(meta), Math.max(200, 2000 - waited), true);
  }
  if(hebrewOn() && /^tt\d+$/.test(id)){
    const plot = await hebrewPlot(id).catch(() => null);
    if(plot && spot === el && info.isConnected){ info.querySelector('p').dir = 'rtl'; info.querySelector('p').textContent = plot.text; }
  }
}

/* ---------- the two things to do with a title ---------- */
export function nextEpisode(meta){
  const vids = (meta?.videos || []).filter(v => v.id && (v.season ?? 0) > 0)
    .sort((a, b) => (a.season - b.season) || ((a.episode ?? a.number ?? 0) - (b.episode ?? b.number ?? 0)));
  if(!vids.length) return null;
  const at = v => ({id: v.id, season: v.season, episode: v.episode ?? v.number ?? 1});
  const started = vids.find(v => { const w = progress[v.id]; return w && w.d && w.t / w.d <= .92; });
  if(started) return {...at(started), resume: true};
  return {...at(vids.find(v => !progress[v.id]) || vids[0]), resume: false};
}
/** The full page: everything the row has no room for - the episodes, every source. */
export function open(el){
  const href = el.getAttribute('href');
  noteOpened(location.hash, el.dataset.id);          // where to come back to
  endTaste();
  location.hash = href;
}

/* ---------- arriving on a title ---------- */
// by remote, by tab, or by hand: whatever takes the focus takes the middle
document.addEventListener('focusin', e => {
  const p = e.target.closest?.('a.poster');
  if(p && p.closest('.strip')) spotlight(p);
});
document.addEventListener('click', e => {
  if(e.target.closest('.spotact')) return;            // its own buttons speak for themselves
  const p = e.target.closest('a.poster');
  // a wall of posters has no middle: there a title is opened, the ordinary way
  if(!p || !p.closest('.strip') || !reelable()) return;
  e.preventDefault();
  if(p !== spot){ spotlight(p); p.focus({preventScroll: true}); return; }
  // already in the middle: a click on it opens its full page directly
  open(p);
});
addEventListener('hashchange', clearSpot);


/** The first title of the first row takes the middle by itself, so a screen opens on its content. */
export function autoSpot(strip){
  if(spot || !strip) return;
  const first = strip.querySelector('a.poster[href]');
  if(first) spotlight(first);
}
