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
import {heTitle, hebrewOn, hebrewPlot} from '../data/hebrew.js';
import {genreName} from '../data/names.js';
import {svcMarks} from '../data/services.js';
import {progress} from '../data/watch.js';
import {tr} from '../i18n.js';
import {endTaste, startTaste, trailerId} from './taste.js';
import {playStream, quickPick} from './sources.js';

/* The still point of the wheel is where the row begins - the right, in Hebrew. A title brought to it
   has the whole row ahead of it and nothing wasted behind it, and from the first title on, moving
   along the row turns the wheel rather than moving the viewer. */
const WIDE = matchMedia('(min-width: 900px)');
/* A wheel needs a row. The poster wall and the list lay the same titles out as a grid, and a grid
   has no middle to bring anything to - there the titles stay as they are. */
export const reelable = () => !['grid', 'list'].includes(settings.layout);
const turning = () => reelable() && WIDE.matches;

let spot = null;              // the title in the middle
let act = null;               // its buttons, under the picture
let hadArt = '';              // the artwork the poster carried before the picture widened

/** Let the middle go: the picture narrows back into a poster and the taste stops. */
export function clearSpot(){
  endTaste();
  if(spot?.isConnected){
    spot.classList.remove('spot');
    spot.dataset.wasSpot = '1';      // the row remembers it, for when the viewer comes back to the row
    const art = spot.querySelector('.art');
    if(art){
      art.querySelector('.taste')?.remove();
      art.querySelector('.spotinfo')?.remove();
      art.style.backgroundImage = hadArt;
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
  act.innerHTML = full
    ? `<button class="btn primary" data-go>${esc(tr('qv.play'))}</button><button class="btn ghost" data-more>${esc(tr('qv.more'))}</button>`
    : `<button class="btn primary" data-more>${esc(tr('qv.more'))}</button>`;
  strip.appendChild(act);
  act.querySelector('[data-more]').onclick = () => open(el);
  const go = act.querySelector('[data-go]');
  if(go) go.onclick = () => play(go, el);
  place();
  paint(el, full);
}

/** Put the buttons under the picture, and turn the wheel until the title is in the middle. */
export function place(){
  if(!spot?.isConnected || !act) return;
  const strip = spot.closest('.strip');
  if(!strip) return;
  const art = spot.querySelector('.art');
  act.style.left = spot.offsetLeft + 'px';
  act.style.top = spot.offsetTop + (art?.offsetHeight || 0) + 8 + 'px';
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
async function paint(el, full){
  const art = el.querySelector('.art');
  if(!art) return;
  const name = el.querySelector('.t span')?.textContent || el.querySelector('.t')?.textContent || '';
  art.insertAdjacentHTML('beforeend',
    `<div class="spotinfo"><b dir="auto">${esc(name)}</b><div class="facts"></div><p dir="auto"></p></div>`);
  if(!full) return;                                  // a broadcaster's programme: its picture and its name
  const [, , type, idEnc] = el.getAttribute('href').split('/');
  const id = decodeURIComponent(idEnc);
  warmSources(type, type === 'series' ? `${id}:1:1` : id);     // so that "נגן" has something ready
  const meta = await fetchMeta(type, id).catch(() => null);
  if(spot !== el || !el.isConnected) return;
  const info = art.querySelector('.spotinfo');
  if(!info) return;
  if(meta){
    if(meta.background) art.style.backgroundImage = `url('${meta.background.replace(/'/g, '%27')}')`;
    info.querySelector('b').textContent = heTitle(meta.id, meta.name);
    // one line of it: what it scores, when it is from, how long, what it is - and the marks of whoever has it
    info.querySelector('.facts').innerHTML = [
      meta.imdbRating && `<span class="imdb">IMDb ${esc(meta.imdbRating)}</span>`,
      yearOf(meta) && `<span>${esc(yearOf(meta))}</span>`, meta.runtime && `<span>${esc(meta.runtime)}</span>`,
      ...(meta.genres || meta.genre || []).slice(0, 1).map(g => `<span>${esc(genreName(g))}</span>`),
      svcMarks(id) && `<span>${svcMarks(id)}</span>`].filter(Boolean).join('');
    info.querySelector('p').textContent = meta.description || '';
    const go = act?.querySelector('[data-go]');
    if(go && !go.disabled){
      if(type === 'series'){ const ep = nextEpisode(meta); if(ep) go.textContent = tr(ep.resume ? 'qv.epCont' : 'qv.epPlay', {s: ep.season, e: ep.episode}); }
      else go.textContent = playLabel(id);
    }
    startTaste('.poster.spot .art', trailerId(meta), 1300, true);   // quietly: browsing is not watching
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
/** The watching button: continue where it stopped, or start it. */
export function playLabel(metaId){
  const w = Object.values(progress).find(x => x.metaId === metaId);
  if(w && w.d && w.t < w.d - 60) return tr('qv.continue', {n: Math.max(1, Math.round((w.d - w.t) / 60))});
  return tr('qv.play');
}
/** The full page: everything the row has no room for - the episodes, every source. */
export function open(el){
  const href = el.getAttribute('href');
  noteOpened(location.hash, el.dataset.id);          // where to come back to
  endTaste();
  location.hash = href;
}
/** Watch it now: a film from where it stopped, a series from the episode you are up to. */
export async function play(btn, el){
  const [, , type, idEnc] = el.getAttribute('href').split('/');
  const id = decodeURIComponent(idEnc);
  const was = btn.textContent;
  btn.disabled = true;
  btn.textContent = tr('qv.searching');
  const meta = await fetchMeta(type, id).catch(() => null);
  const ep = type === 'series' ? nextEpisode(meta) : null;
  const videoId = ep ? ep.id : (meta?.behaviorHints?.defaultVideoId || id);
  const pick = await quickPick(type, videoId);
  if(!btn.isConnected) return;
  btn.disabled = false;
  if(!pick){                                          // nothing to play with: the full page lists them all
    btn.textContent = tr('qv.noSource');
    btn.onclick = () => open(el);
    return;
  }
  btn.textContent = was;
  endTaste();
  const name = meta?.name || el.querySelector('.t')?.textContent || '';
  playStream(pick.s, ep ? `${name} S${ep.season}E${ep.episode}` : name, {videoId, type, meta: meta || {id, name}});
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
  // already in the middle: the picture itself is the button
  const go = act?.querySelector('[data-go]');
  go ? play(go, p) : open(p);
});
addEventListener('hashchange', clearSpot);

/** The first title of the first row takes the middle by itself, so a screen opens on its content. */
export function autoSpot(strip){
  if(spot || !strip) return;
  const first = strip.querySelector('a.poster[href]');
  if(first) spotlight(first);
}
