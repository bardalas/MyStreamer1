/* The page's own player, for a trailer or a plain video outside the app. */
import {$} from '../core/dom.js';
import {store} from '../core/store.js';
import {indexProgress, progress} from '../data/watch.js';
import {tr} from '../i18n.js';

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

export function openPlayer(s, title, ctx){
  $('#ptitle').textContent = title;
  const body = $('#pbody');
  const head = $('#player header');
  head.querySelector('#ytout')?.remove();
  if(s.ytId){
    // A trailer plays inside VEO. Only if YouTube refuses to embed this one is there a way out, and it
    // is a button the viewer presses - never something the app does to them.
    body.innerHTML = `<iframe src="https://www.youtube.com/embed/${encodeURIComponent(s.ytId)}?autoplay=1&playsinline=1&rel=0&modestbranding=1" allow="autoplay; fullscreen" allowfullscreen></iframe>`;
    if(window.BoothAndroid?.openYouTube){
      head.insertAdjacentHTML('beforeend', `<button class="btn ghost" id="ytout">${tr('player.openYt')}</button>`);
      $('#ytout').onclick = () => { closePlayer(); BoothAndroid.openYouTube(s.ytId); };
    }
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
  $('#pbody').innerHTML = ''; $('#player').classList.remove('open');
}
$('#close').onclick = closePlayer;
addEventListener('keydown', e => { if(e.key === 'Escape') closePlayer(); });
