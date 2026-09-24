/* ---------- A YouTube video in the page, dressed as the app's own player ----------
   The app's own player cannot play a YouTube video (YouTube.kt: YouTube cuts its streams off to apps), so
   it plays in YouTube's embedded player - with YouTube's controls turned off, and the app's over it: the
   keys the app's player answers to (OK pauses and plays, the arrows jump ten seconds and thirty when held,
   Back closes), its bar and times, and the captions the app translated, drawn by the page. The picture
   never takes the remote: the page keeps it, and tells the embedded player what to do. */
import {esc} from '../core/dom.js';
import {settings} from '../core/settings.js';
import {tr} from '../i18n.js';

const OSD_MS = 3500;                   // how long the bar stays after a key, while the video plays
const STEP_S = 10, HELD_STEP_S = 30;

let api = null;                        // the IFrame API, loaded once
const loadApi = () => api ||= new Promise(res => {
  if(window.YT?.Player) return res(window.YT);
  const was = window.onYouTubeIframeAPIReady;
  window.onYouTubeIframeAPIReady = () => { was?.(); res(window.YT); };
  const tag = document.createElement('script');
  tag.src = 'https://www.youtube.com/iframe_api';
  tag.onerror = () => { api = null; res(null); };
  document.head.appendChild(tag);
});

let yt = null, now = '', cues = [], tick = 0, hideAt = 0, root = null;
let bufferingSince = 0, recoveryAt = 0;
const pending = {};                    // captions that came before their video: id -> cues

/** Captions for [id], as the text of an .srt file (MainActivity, once they are translated). */
window.boothYtCaptions = (id, srt) => {
  const list = parseSrt(srt);
  if(id === now) cues = list; else pending[id] = list;
};
function parseSrt(srt){
  const ms = t => { const [h, m, s] = t.replace(',', '.').split(':'); return (+h * 3600 + +m * 60 + +s) * 1000; };
  return String(srt || '').split(/\r?\n\r?\n/).map(block => {
    const m = block.match(/(\d+:\d+:\d+[,.]\d+)\s*-->\s*(\d+:\d+:\d+[,.]\d+)\s*\n([\s\S]*)/);
    return m && {from: ms(m[1]), to: ms(m[2]), text: m[3].trim()};
  }).filter(Boolean);
}

const clock = s => {
  s = Math.max(0, Math.floor(s || 0));
  const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
};

/** Play YouTube video [id] in [body] under [title]; [out]: a way out to YouTube itself, or null. */
export async function openYt(body, id, title, out){
  closeYt();
  now = id;
  cues = pending[id] || [];
  delete pending[id];
  body.innerHTML = `<div class="ytp" id="ytp" tabindex="-1">
    <div class="ytpic"><div id="ytframe"></div></div>
    <div class="ytosd on" id="ytosd">
      <div class="yttop"><b dir="auto">${esc(title)}</b></div>
      <div class="ytbot"><i class="ytstate" id="ytstate"></i><span id="ytat">0:00</span>
        <div class="ytbar"><i id="ytfill"></i></div><span id="ytlen"></span></div>
    </div>
    <div class="ytcue" aria-live="off"><span id="ytcue"></span></div>
    <p class="ytsay" id="ytsay" hidden></p></div>`;
  root = body.querySelector('#ytp');
  root.style.setProperty('--subscale', +settings.subScale || 1.25);   // the subtitles' size the viewer chose
  root.focus();
  const YT = await loadApi();
  if(now !== id) return;                                // closed meanwhile
  if(!YT) return fail(out);
  yt = new YT.Player('ytframe', {videoId: id, host: 'https://www.youtube.com', width: '100%', height: '100%',
    playerVars: {autoplay: 1, controls: 0, disablekb: 1, fs: 0, iv_load_policy: 3, modestbranding: 1, rel: 0,
      playsinline: 1, cc_load_policy: 0, origin: location.origin},
    events: {
      onReady: e => { e.target.getIframe().tabIndex = -1; e.target.playVideo(); root?.focus(); },
      // YouTube's own captions come on by themselves for some videos: the app draws its own
      onStateChange: e => {
        if(e.data === 1){ bufferingSince = 0; noCaptions(e.target); }
        else if(e.data === 3 && !bufferingSince) bufferingSince = performance.now();
        paint();
      },
      onError: () => fail(out),
    }});
  tick = setInterval(paint, 250);
}
const noCaptions = p => { for(const m of ['captions', 'cc']) try{ p.unloadModule(m); }catch(e){} };
/** YouTube will not play it here: say so, with the way out where there is one. */
function fail(out){
  const say = document.getElementById('ytsay');
  if(!say) return;
  say.hidden = false;
  say.innerHTML = `${esc(tr('player.ytFailed'))}${out ? `<button class="btn" id="ytgo">${esc(tr('player.openYt'))}</button>` : ''}`;
  if(out){ const b = document.getElementById('ytgo'); b.onclick = out; b.focus(); }
}
export function closeYt(){
  clearInterval(tick);
  try{ yt?.destroy(); }catch(e){}
  yt = null; now = ''; cues = []; root = null; bufferingSince = 0; recoveryAt = 0;
}
/** The bar, the times and the caption, as the video is now. */
function paint(){
  if(!yt?.getCurrentTime || !root?.isConnected) return;
  const t = yt.getCurrentTime() || 0, d = yt.getDuration?.() || 0;
  const state = yt.getPlayerState?.();
  const playing = state === 1;
  // Some Android TV WebViews leave the YouTube iframe in BUFFERING indefinitely. A single
  // seek-to-current-position asks YouTube to refill the active segment without rebuilding the player.
  // Rate-limit recovery so a genuinely slow connection is not hammered in a retry loop.
  if(state === 3){
    if(!bufferingSince) bufferingSince = performance.now();
    const n = performance.now();
    if(n - bufferingSince > 8000 && n - recoveryAt > 15000){
      recoveryAt = n; bufferingSince = n;
      try{ yt.seekTo(t, true); yt.playVideo(); }catch(e){}
    }
  }else if(state !== 3) bufferingSince = 0;
  document.getElementById('ytat').textContent = clock(t);
  document.getElementById('ytlen').textContent = d ? clock(d) : '';
  document.getElementById('ytfill').style.width = d ? `${Math.min(100, t / d * 100)}%` : '0';
  document.getElementById('ytstate').className = 'ytstate' + (playing ? '' : ' paused');
  document.getElementById('ytosd').classList.toggle('on', !playing || performance.now() < hideAt);
  const ms = t * 1000, cue = cues.find(c => c.from <= ms && ms < c.to);
  const line = document.getElementById('ytcue');
  if(line.textContent !== (cue?.text || '')) line.textContent = cue?.text || '';
}
const show = () => { hideAt = performance.now() + OSD_MS; paint(); };

/* The remote, while a video plays here: the page's own movement between items is not wanted then. */
addEventListener('keydown', e => {
  if(!root?.isConnected || !yt?.getPlayerState || document.getElementById('ytgo')) return;
  const k = e.key;
  let done = true;
  if(k === 'Enter' || k === ' ' || k === 'MediaPlayPause'){
    yt.getPlayerState() === 1 ? yt.pauseVideo() : yt.playVideo();
  }else if(k === 'MediaPlay') yt.playVideo();
  else if(k === 'MediaPause') yt.pauseVideo();
  else if(k === 'ArrowRight' || k === 'ArrowLeft' || k === 'MediaFastForward' || k === 'MediaRewind'){
    // a film's timeline runs the way the picture does: right goes forward, in Hebrew as anywhere else
    const dir = k === 'ArrowRight' || k === 'MediaFastForward' ? 1 : -1;
    const d = yt.getDuration() || Infinity;
    yt.seekTo(Math.max(0, Math.min(d - 1, yt.getCurrentTime() + dir * (e.repeat ? HELD_STEP_S : STEP_S))), true);
  }else if(k !== 'ArrowUp' && k !== 'ArrowDown') done = false;
  if(!done) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  show();
}, true);
