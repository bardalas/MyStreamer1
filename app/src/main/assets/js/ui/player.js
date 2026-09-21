/* The page's own player, for a trailer or a plain video outside the app. */
import {$} from '../core/dom.js';
import {store} from '../core/store.js';
import {indexProgress, progress} from '../data/watch.js';
import {UI, tr} from '../i18n.js';
import {closeYt, openYt} from './ytplayer.js';

/* ---------- player ---------- */
export let hls = null;
/** hls.js is only needed by the in-page player (the Android player handles HLS itself). */
export let hlsLoading = null;
export const loadHls = () => window.Hls ? Promise.resolve(window.Hls) : (hlsLoading ||= new Promise(res => {
  const tag = document.createElement('script');
  tag.src = 'https://cdnjs.cloudflare.com/ajax/libs/hls.js/1.5.13/hls.min.js';
  tag.onload = () => res(window.Hls);
  tag.onerror = () => res(null);
  document.head.appendChild(tag);
}));

/* A YouTube video plays here, in YouTube's embedded player dressed as the app's own (ui/ytplayer.js),
   with captions in the viewer's language that the app finds and translates (YouTube.kt). */
export function openPlayer(s, title, ctx){
  $('#ptitle').textContent = title;
  const body = $('#pbody');
  const head = $('#player header');
  head.querySelector('#ytout')?.remove();
  $('#player').classList.toggle('yt', !!s.ytId);
  if(s.ytId){
    // Only if YouTube refuses to play this one here is there a way out, and it is a button the viewer
    // presses - never something the app does to them. The kids profile does not leave for YouTube.
    const out = window.BoothAndroid?.openYouTube && document.documentElement.dataset.kids === 'off'
      ? () => { closePlayer(); BoothAndroid.openYouTube(s.ytId); } : null;
    openYt(body, s.ytId, title, out);
    try{ window.BoothAndroid?.ytCaptions?.(s.ytId, UI); }catch(e){}
  } else {
    body.innerHTML = `<video id="vid" controls autoplay playsinline></video>`;
    const v = $('#vid');
    if(/\.m3u8(\?|$)/.test(s.url)){
      loadHls().then(Hls => { if(Hls?.isSupported()){ hls?.destroy(); hls = new Hls(); hls.loadSource(s.url); hls.attachMedia(v); } else v.src = s.url; });
    }
    else v.src = s.url;
    if(ctx){
      const saved = progress[ctx.videoId];
      if(saved) v.addEventListener('loadedmetadata', () => { if(saved.t < v.duration - 30) v.currentTime = saved.t; }, {once:true});
      let last = 0;
      v.addEventListener('timeupdate', () => {
        if(Math.abs(v.currentTime - last) < 5) return; last = v.currentTime;
        progress[ctx.videoId] = {t: v.currentTime, d: v.duration, at: Date.now(), metaId: ctx.meta.id, type: ctx.type,
          name: ctx.meta.name, poster: ctx.meta.poster, done: v.currentTime > v.duration - 60};
        store.set('progress', progress);
        indexProgress();
      });
      v.addEventListener('error', () => body.insertAdjacentHTML('afterbegin', `<p class="err" style="position:absolute;top:70px;inset-inline-end:20px">${tr('player.badFormat')}</p>`));
    }
  }
  $('#player').classList.add('open');
}
export function closePlayer(){
  if(hls){ hls.destroy(); hls = null; }
  closeYt();
  $('#pbody').innerHTML = ''; $('#player').classList.remove('open');
}
$('#close').onclick = closePlayer;
addEventListener('keydown', e => { if(e.key === 'Escape') closePlayer(); });
