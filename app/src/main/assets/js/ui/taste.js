/* The taste: a few seconds of a title's trailer, playing inside whatever picture it belongs to. */
import {$} from '../core/dom.js';
import {settings} from '../core/settings.js';

/** A title's trailer on YouTube, if it came with one. */
export const trailerId = m => {
  const id = m.trailerStreams?.[0]?.ytId || (m.trailers || []).map(t => t.source).find(Boolean) || '';
  return /^[\w-]{6,20}$/.test(id) ? id : '';
};
export let tasteTimer = 0, tasteStop = null;
/** Drop whatever the taste left behind: its timers, its listener and the frame itself. */
export function endTaste(){ clearTimeout(tasteTimer); tasteStop?.(); tasteStop = null; }
/**
 * A taste of [yt] behind whatever is in [host]: a few seconds of the trailer - with its sound unless
 * [quiet] - at the
 * quality that starts fastest - nobody is going to study it - and out of the remote's reach. It starts
 * muted because that is the only way a page is allowed to start anything, and is unmuted the moment it
 * is really playing; that same moment is when it is revealed, so a trailer that cannot be embedded
 * leaves the artwork alone instead of putting a black box over it. One taste at a time: starting
 * another, or leaving the screen, ends this one.
 */
export function startTaste(hostSel, yt, delay = 1500, quiet = false){
  endTaste();
  if(!yt || settings.preview === 'off') return;
  tasteTimer = setTimeout(() => {
    const host = $(hostSel);
    if(!host || host.querySelector('.taste') || document.visibilityState !== 'visible') return;
    host.insertAdjacentHTML('afterbegin', `<iframe class="taste" tabindex="-1" allow="autoplay" title=""
      src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(yt)}?autoplay=1&mute=1&controls=0&playsinline=1&rel=0&modestbranding=1&iv_load_policy=3&disablekb=1&fs=0&enablejsapi=1&cc_load_policy=1&cc_lang_pref=iw"></iframe>`);
    const frame = host.querySelector('.taste');
    /* Cover the box it was put in - a letterboxed trailer beside the artwork looks like a mistake -
       and then some: the frame writes the film's name and where it is playing from across its own top
       for the first seconds, and a frame wider and taller than what shows of it puts those words
       outside the picture. It is centred, so the crop is even. */
    const box = host.getBoundingClientRect();
    const crop = 1.34;
    frame.style.width = Math.ceil(Math.max(box.width, box.height * 16 / 9) * crop) + 'px';
    frame.style.height = Math.ceil(Math.max(box.height, box.width * 9 / 16) * crop) + 'px';
    const say = msg => frame.contentWindow?.postMessage(JSON.stringify(msg), '*');
    frame.onload = () => say({event: 'listening', id: 1, channel: 'widget'});
    let over = 0;
    const heard = e => {
      if(!frame.isConnected || !/youtube/.test(e.origin) || !/"playerState":\s*1/.test(String(e.data))) return;
      const cmd = (func, args = []) => say({event: 'command', func, args, id: 1, channel: 'widget'});
      cmd('setPlaybackQuality', ['small']);
      cmd('setPlaybackQuality', ['medium']);        // a full-screen frame otherwise asks for HD, and stalls
      // while browsing it stays quiet: a row of trailers shouting at the viewer is not a taste, it is
      // a takeover. The sound belongs to the title they chose to open.
      if(!quiet){ cmd('unMute'); cmd('setVolume', [60]); }
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
