/* The taste: a few seconds of a title's trailer, playing inside whatever picture it belongs to. */
import {$} from '../core/dom.js';
import {isTvLayout, settings} from '../core/settings.js';

/** A title's trailer on YouTube, if it came with one. */
export const trailerId = m => {
  const id = m.trailerStreams?.[0]?.ytId || (m.trailers || []).map(t => t.source).find(Boolean) || '';
  return /^[\w-]{6,20}$/.test(id) ? id : '';
};
export let tasteTimer = 0, tasteStop = null;
/** Drop whatever the taste left behind: its timers, its listener and the frame itself. */
export function endTaste(){ clearTimeout(tasteTimer); tasteStop?.(); tasteStop = null; }
/**
 * A taste of [yt] behind whatever is in [host]: thirty seconds of the trailer - with its sound unless
 * [quiet] - at the quality that starts fastest, and out of the remote's reach. It is revealed only once
 * it is really playing and the player's own controls have faded, so a trailer that cannot be embedded
 * leaves the artwork alone instead of putting a black box over it, and nothing of the player is ever
 * seen. One taste at a time: starting another, or leaving the screen, ends this one.
 */
/** How long a taste plays, once it can be seen. */
const TASTE_MS = 30e3;
/** How long YouTube's own controls stay over the picture after it starts, or after its sound comes on. */
const CONTROLS_FADE_MS = 4500;
export function startTaste(hostSel, yt, delay = 1500, quiet = false){
  endTaste();
  if(!yt || settings.preview === 'off' || !isTvLayout()) return;
  tasteTimer = setTimeout(() => {
    const host = $(hostSel);
    if(!host || host.querySelector('.taste') || document.visibilityState !== 'visible') return;
    host.insertAdjacentHTML('afterbegin', `<iframe class="taste" tabindex="-1" allow="autoplay" title=""
      src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(yt)}?autoplay=1&mute=1&controls=0&playsinline=1&rel=0&modestbranding=1&iv_load_policy=3&disablekb=1&fs=0&enablejsapi=1&cc_load_policy=0&hl=he"></iframe>`);
    const frame = host.querySelector('.taste');
    /* Cover the box it was put in - a letterboxed trailer beside the artwork looks like a mistake -
       and a good deal more, evenly: the player writes the film's name across its top and draws its
       bar along its bottom, and a frame larger than what shows of it keeps both outside the picture
       whenever they appear. */
    const box = host.getBoundingClientRect();
    const crop = 1.34;
    frame.style.width = Math.ceil(Math.max(box.width, box.height * 16 / 9) * crop) + 'px';
    frame.style.height = Math.ceil(Math.max(box.height, box.width * 9 / 16) * crop) + 'px';
    const say = msg => frame.contentWindow?.postMessage(JSON.stringify(msg), '*');
    frame.onload = () => say({event: 'listening', id: 1, channel: 'widget'});
    let over = 0, shown = 0, started = false;
    const cmd = (func, args = []) => say({event: 'command', func, args, id: 1, channel: 'widget'});
    const heard = e => {
      if(!frame.isConnected || !/youtube/.test(e.origin)) return;
      // the trailer ran out before the thirty seconds did: back to the artwork at once
      if(/"playerState":\s*0/.test(String(e.data))){ tasteStop?.(); return; }
      if(started || !/"playerState":\s*1/.test(String(e.data))) return;
      started = true;
      clearTimeout(giveUp);
      cmd('setPlaybackQuality', ['small']);
      cmd('setPlaybackQuality', ['medium']);        // a full-screen frame otherwise asks for HD, and stalls
      // No subtitles: loading them brought the player's bar up over the picture, and a taste is to be
      // looked at, not read.
      // while browsing it stays quiet: a row of trailers shouting at the viewer is not a taste, it is
      // a takeover. The sound belongs to the title they chose to open.
      // while browsing it stays quiet: a row of trailers shouting at the viewer is not a taste, it is
      // a takeover. The sound belongs to the title they chose to open.
      if(!quiet){ cmd('unMute'); cmd('setVolume', [60]); }
      /* YouTube's own player puts its controls over the picture - the round pause button, the film's
         name - for the first seconds of playing, and again when its sound is turned on; there is no
         setting that stops it doing so on a phone or a television. So the picture is shown only once
         those have faded: what appears is the trailer and nothing of the player's. The thirty seconds
         are counted from there. */
      shown = setTimeout(() => {
        frame.classList.add('on');
        over = setTimeout(() => { frame.classList.remove('on'); setTimeout(() => frame.remove(), 900); }, TASTE_MS);
      }, CONTROLS_FADE_MS);
    };
    const giveUp = setTimeout(() => tasteStop?.(), 8000);   // a trailer that will not play is not waited for
    addEventListener('message', heard);
    tasteStop = () => {
      clearTimeout(over); clearTimeout(shown); clearTimeout(giveUp);
      removeEventListener('message', heard); frame.remove(); tasteStop = null;
    };
  }, delay);
}
