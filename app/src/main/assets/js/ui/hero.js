/* The title with the place of honour, and the taste of it that plays behind the words. */
import {$, esc} from '../core/dom.js';
import {settings} from '../core/settings.js';
import {store} from '../core/store.js';
import {yearOf} from '../data/addons.js';
import {heTitle, pool} from '../data/hebrew.js';
import {genreName} from '../data/names.js';
import {svcMarks} from '../data/services.js';
import {tr} from '../i18n.js';

export function pickFeatured(metas){
  const rich = metas.filter(m => m.background && m.description).slice(0, 20);
  // one that came with a trailer, so the taste has something to play; otherwise any with artwork
  const pool = rich.filter(trailerId).length ? rich.filter(trailerId) : rich;
  if(!pool.length) return null;
  const seen = store.get('heroSeen', []);
  const fresh = pool.filter(m => !seen.includes(m.id));
  const from = fresh.length ? fresh : pool;
  const m = from[Math.floor(Math.random() * from.length)];
  store.set('heroSeen', [m.id, ...seen.filter(id => id !== m.id)].slice(0, 12));
  return m;
}
/** A title's trailer on YouTube, if it came with one. */
export const trailerId = m => {
  const id = m.trailerStreams?.[0]?.ytId || (m.trailers || []).map(t => t.source).find(Boolean) || '';
  return /^[\w-]{6,20}$/.test(id) ? id : '';
};
export let tasteTimer = 0, tasteStop = null;
/** Drop whatever the taste left behind: its timers, its listener and the frame itself. */
export function endTaste(){ clearTimeout(tasteTimer); tasteStop?.(); tasteStop = null; }
/**
 * A taste of [yt] behind whatever is in [host]: ten seconds of the trailer, with its sound, at the
 * quality that starts fastest - nobody is going to study it - and out of the remote's reach. It starts
 * muted because that is the only way a page is allowed to start anything, and is unmuted the moment it
 * is really playing; that same moment is when it is revealed, so a trailer that cannot be embedded
 * leaves the artwork alone instead of putting a black box over it. One taste at a time: starting
 * another, or leaving the screen, ends this one.
 */
export function startTaste(hostSel, yt, delay = 1500){
  endTaste();
  if(!yt || settings.preview === 'off') return;
  tasteTimer = setTimeout(() => {
    const host = $(hostSel);
    if(!host || host.querySelector('.taste') || document.visibilityState !== 'visible') return;
    host.insertAdjacentHTML('afterbegin', `<iframe class="taste" tabindex="-1" allow="autoplay" title=""
      src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(yt)}?autoplay=1&mute=1&controls=0&playsinline=1&rel=0&modestbranding=1&iv_load_policy=3&disablekb=1&fs=0&enablejsapi=1&cc_load_policy=1&cc_lang_pref=iw"></iframe>`);
    const frame = host.querySelector('.taste');
    // cover the box it was put in: a letterboxed trailer beside the artwork looks like a mistake
    const box = host.getBoundingClientRect();
    frame.style.width = Math.ceil(Math.max(box.width, box.height * 16 / 9)) + 'px';
    frame.style.height = Math.ceil(Math.max(box.height, box.width * 9 / 16)) + 'px';
    const say = msg => frame.contentWindow?.postMessage(JSON.stringify(msg), '*');
    frame.onload = () => say({event: 'listening', id: 1, channel: 'widget'});
    let over = 0;
    const heard = e => {
      if(!frame.isConnected || !/youtube/.test(e.origin) || !/"playerState":\s*1/.test(String(e.data))) return;
      const cmd = (func, args = []) => say({event: 'command', func, args, id: 1, channel: 'widget'});
      cmd('setPlaybackQuality', ['small']);
      cmd('setPlaybackQuality', ['medium']);        // a full-screen frame otherwise asks for HD, and stalls
      cmd('unMute');
      cmd('setVolume', [60]);
      frame.classList.add('on');
      // a taste is ten seconds: it fades back into the artwork rather than playing on and on
      over = setTimeout(() => { frame.classList.remove('on'); setTimeout(() => frame.remove(), 900); }, 30000);
      done();
    };
    const giveUp = setTimeout(() => { frame.remove(); done(); }, 8000);
    const done = () => { clearTimeout(giveUp); removeEventListener('message', heard); tasteStop = over ? tasteStop : null; };
    addEventListener('message', heard);
    tasteStop = () => { clearTimeout(over); clearTimeout(giveUp); removeEventListener('message', heard); frame.remove(); tasteStop = null; };
  }, delay);
}
export function renderHero(m){
  const h = $('#hero'); if(!h) return;
  const facts = [yearOf(m), m.imdbRating && `IMDb ${m.imdbRating}`, ...(m.genres || m.genre || []).slice(0, 2).map(genreName)]
    .filter(Boolean).map(f => `<span>${esc(f)}</span>`).join('');
  h.innerHTML = `<div class="bg" style="background-image:url('${esc(m.background || m.poster)}')"></div><div class="beam"></div>
    <div class="copy"><h1 data-heid="${esc(m.id)}" dir="auto">${esc(heTitle(m.id, m.name))}${svcMarks(m.id)}</h1>
    <div class="facts">${facts}</div>
    <p dir="auto">${esc((m.description||'').slice(0, 220))}${(m.description||'').length>220?'…':''}</p>
    <div class="acts"><a class="btn primary" href="#/detail/${esc(m.type)}/${encodeURIComponent(m.id)}">${tr('hero.details')}</a></div></div>`;
  startTaste('#hero', trailerId(m), 1200);
}
