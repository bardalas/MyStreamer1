/* ---------- A YouTube video in the page, dressed as the app's own player ----------
   The app's own player cannot play a YouTube video (YouTube.kt: YouTube cuts its streams off to apps), so
   it plays in YouTube's embedded player - with YouTube's controls turned off, and the app's over it: the
   keys the app's player answers to (OK pauses and plays, the arrows jump ten seconds and thirty when held,
   Back closes), its bar and times, and the captions the app translated, drawn by the page. The picture
   never takes the remote: the page keeps it, and tells the embedded player what to do. */
import {esc} from '../core/dom.js';
import {setSetting, settings} from '../core/settings.js';
import {store} from '../core/store.js';
import {indexProgress, progress} from '../data/watch.js';
import {UI, tr} from '../i18n.js';

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
let showTitle = '', savedAt = 0, resumeAt = 0;

/* A programme is watched like any other title: how far the viewer got is kept under "yt:<id>", so that it shows in
   "continue watching" (data/watch.js, ui/rows.js) and picks up where it was left. Kept as it plays, every ten
   seconds, and once more as it is left; watched to the end it is done, and out of the row. */
function keep(final){
  if(!now || !yt?.getCurrentTime) return;
  const t = yt.getCurrentTime() || 0, d = yt.getDuration?.() || 0;
  if(!d || (t < 5 && !progress['yt:' + now])) return;                     // not begun: nothing to remember
  const tick = performance.now();
  if(!final && tick - savedAt < 10_000) return;
  savedAt = tick;
  progress['yt:' + now] = {t, d, at: Date.now(), metaId: 'yt:' + now, type: 'show', name: showTitle,
    poster: `https://i.ytimg.com/vi/${now}/hqdefault.jpg`, done: t > d - 60};
  store.lazy('progress', progress);
  indexProgress();
}
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

/** Whether the layout runs from the right: the bar fills from there, and forward is the Left key. */
const rtl = () => document.documentElement.dir === 'rtl';
const clock = s => {
  s = Math.max(0, Math.floor(s || 0));
  const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
};

/** Play YouTube video [id] in [body] under [title]; [out]: a way out to YouTube itself, or null. */
export async function openYt(body, id, title, out){
  closeYt();
  now = id;
  showTitle = title;
  savedAt = 0;
  const before = progress['yt:' + id];
  resumeAt = before && !before.done && before.t > 30 ? before.t : 0;      // back to where it was left
  cues = pending[id] || [];
  delete pending[id];
  body.innerHTML = `<div class="ytp" id="ytp" tabindex="-1">
    <div class="ytpic"><div id="ytframe"></div></div>
    <div class="ytosd on" id="ytosd">
      <div class="ytbanner">
        <div class="ytrow"><button class="ytstate" id="ytstate" type="button" tabindex="-1" aria-label="${esc(tr('player.pause'))}"></button>
          <b class="yttitle" dir="auto">${esc(title)}</b><span class="ytclock" id="ytclock"></span></div>
        <div class="ytpos"><span id="ytat">0:00</span> / <span id="ytlen"></span></div>
        <button class="ytbar" id="ytbar" type="button" tabindex="-1" aria-label="${esc(tr('player.seek'))}"><i id="ytfill"></i></button>
        <div class="ytfoot"><span id="ytleft"></span><span class="ythint">▲ ${esc(tr('yt.subs'))}</span></div>
      </div>
    </div>
    <div class="ytcue" aria-live="off"><span id="ytcue"></span></div>
    <p class="ytsay" id="ytsay" hidden></p></div>`;
  root = body.querySelector('#ytp');
  dressCaptions();
  root.focus();
  const YT = await loadApi();
  if(now !== id) return;                                // closed meanwhile
  if(!YT) return fail(out);
  yt = new YT.Player('ytframe', {videoId: id, host: 'https://www.youtube.com', width: '100%', height: '100%',
    playerVars: {autoplay: 1, controls: 0, disablekb: 1, fs: 0, iv_load_policy: 3, modestbranding: 1, rel: 0,
      playsinline: 1, cc_load_policy: 0, origin: location.origin},
    events: {
      onReady: e => { e.target.getIframe().tabIndex = -1; if(resumeAt) e.target.seekTo(resumeAt, true); e.target.playVideo(); root?.focus(); },
      // YouTube's own captions come on by themselves for some videos: the app draws its own
      onStateChange: e => {
        if(e.data === 1){ bufferingSince = 0; noCaptions(e.target); }
        else if(e.data === 3 && !bufferingSince) bufferingSince = performance.now();
        paint();
      },
      onError: () => fail(out),
    }});
  const stateBtn = document.getElementById('ytstate');
  stateBtn?.addEventListener('click', e => {
    e.stopPropagation();
    if(!yt?.getPlayerState) return;
    yt.getPlayerState() === 1 ? yt.pauseVideo() : yt.playVideo();
    show();
  });
  const bar = document.getElementById('ytbar');
  bar?.addEventListener('click', e => {
    e.stopPropagation();
    const d = yt?.getDuration?.() || 0;
    if(!d) return;
    const r = bar.getBoundingClientRect();
    const across = Math.max(0, Math.min(1, (e.clientX - r.left) / Math.max(1, r.width)));
    const ratio = rtl() ? 1 - across : across;                  // the bar starts at the right in Hebrew
    yt.seekTo(ratio * d, true);
    show();
  });
  root.addEventListener('click', e => { if(!e.target.closest?.('button')) show(); });
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
  keep(true);
  closePanel();
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
  const stateBtn = document.getElementById('ytstate');
  stateBtn.className = 'ytstate' + (playing ? '' : ' paused');
  stateBtn.textContent = playing ? '▶' : '❚❚';                // what the app's own banner says
  stateBtn.setAttribute('aria-label', tr(playing ? 'player.pause' : 'player.play'));
  document.getElementById('ytclock').textContent = new Date().toLocaleTimeString(UI === 'he' ? 'he-IL' : 'en-GB', {hour: '2-digit', minute: '2-digit'});
  document.getElementById('ytleft').textContent = d ? tr('player.left', {t: clock(d - t)}) : '';
  document.getElementById('ytosd').classList.toggle('on', !playing || performance.now() < hideAt);
  const ms = t * 1000, cue = cues.find(c => c.from <= ms && ms < c.to);
  const line = document.getElementById('ytcue');
  // the captions are the viewer's to turn off; while their panel is open a sample stands in, to size and place by
  const words = settings.subs === 'off' ? '' : (cue?.text || '');
  const shown = panel && !words ? tr('yt.sample') : words;
  if(line.textContent !== shown) line.textContent = shown;
  if(playing) keep(false);
}
const show = () => { hideAt = performance.now() + OSD_MS; paint(); };

/* ---------- the captions: on or off, how large, how high (Up opens them, as in a film) ---------- */
const LIFTS = [9, 18, 30, 62];                          // the captions' distance from the bottom, in per cent of the picture
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lift = () => clamp(+settings.subLift || 0, 0, LIFTS.length - 1);
const scale = () => +settings.subScale || 1.25;
/** The captions as the viewer set them: their size and their height, on the picture. */
function dressCaptions(){
  root?.style.setProperty('--subscale', scale());
  root?.style.setProperty('--lift', LIFTS[lift()] + '%');
}
let panel = null, sel = 0;
const ROWS = () => [
  {name: tr('yt.subs'), value: () => tr(settings.subs === 'off' ? 'yt.off' : 'yt.on'),
    step: () => setSetting('subs', settings.subs === 'off' ? 'auto' : 'off')},
  {name: tr('yt.size'), value: () => Math.round(scale() * 100) + '%',
    step: d => setSetting('subScale', Math.round(clamp(scale() + d * .1, .8, 2.4) * 100) / 100)},
  {name: tr('yt.pos'), value: () => tr('yt.pos' + lift()),
    step: d => setSetting('subLift', clamp(lift() + d, 0, LIFTS.length - 1))},
];
function paintPanel(){
  if(!panel) return;
  const rows = ROWS();
  panel.innerHTML = `<h3>${esc(tr('yt.subs'))}</h3>` + rows.map((r, i) =>
    `<button class="ytprow${i === sel ? ' on' : ''}" data-i="${i}" type="button" tabindex="-1"><span>${esc(r.name)}</span><b>${i ? '\u2039  ' : ''}${esc(r.value())}${i ? '  \u203a' : ''}</b></button>`).join('');
  dressCaptions();
  paint();
}
function openPanel(){
  if(panel || !root) return;
  panel = document.createElement('div');
  panel.className = 'ytpanel';
  panel.addEventListener('ytclose', closePanel);
  panel.addEventListener('click', e => {                 // a finger or a mouse: a press on a row changes it
    const b = e.target.closest?.('.ytprow');
    if(!b) return;
    sel = +b.dataset.i;
    ROWS()[sel].step(sel === 2 && lift() === LIFTS.length - 1 ? -(LIFTS.length - 1) : 1);
    paintPanel();
  });
  root.appendChild(panel);
  root.classList.add('capsopen');
  sel = 1;
  paintPanel();
  show();
}
function closePanel(){
  panel?.remove();
  panel = null;
  root?.classList.remove('capsopen');
  paint();
}
/** The remote while the panel is open: Up and Down choose a line, Left and Right change it (Right is more). */
function panelKey(e){
  const k = e.key, rows = ROWS();
  if(k === 'ArrowUp') sel = (sel + rows.length - 1) % rows.length;
  else if(k === 'ArrowDown') sel = (sel + 1) % rows.length;
  else if(k === (rtl() ? 'ArrowLeft' : 'ArrowRight')) rows[sel].step(1);          // more is the way forward is
  else if(k === (rtl() ? 'ArrowRight' : 'ArrowLeft')) rows[sel].step(-1);
  else if(k === 'Enter' || k === ' ') sel === 0 ? rows[0].step(1) : closePanel();
  else if(k === 'Escape' || k === 'Backspace') closePanel();
  else return false;
  paintPanel();
  return true;
}

/* The remote, while a video plays here: the page's own movement between items is not wanted then. */
addEventListener('keydown', e => {
  if(!root?.isConnected || !yt?.getPlayerState || document.getElementById('ytgo')) return;
  if(panel){ if(panelKey(e)){ e.preventDefault(); e.stopImmediatePropagation(); } return; }
  const k = e.key;
  let done = true;
  if(k === 'Enter' || k === ' ' || k === 'MediaPlayPause'){
    yt.getPlayerState() === 1 ? yt.pauseVideo() : yt.playVideo();
  }else if(k === 'MediaPlay') yt.playVideo();
  else if(k === 'MediaPause') yt.pauseVideo();
  else if(k === 'ArrowRight' || k === 'ArrowLeft' || k === 'MediaFastForward' || k === 'MediaRewind'){
    // the timeline runs the way the layout does: in Hebrew the bar fills from the right and forward is Left
    const dir = k === 'MediaFastForward' || k === (rtl() ? 'ArrowLeft' : 'ArrowRight') ? 1 : -1;
    const d = yt.getDuration() || Infinity;
    yt.seekTo(Math.max(0, Math.min(d - 1, yt.getCurrentTime() + dir * (e.repeat ? HELD_STEP_S : STEP_S))), true);
  }else if(k === 'ArrowUp'){ openPanel();
  }else if(k !== 'ArrowDown') done = false;
  if(!done) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  show();
}, true);
