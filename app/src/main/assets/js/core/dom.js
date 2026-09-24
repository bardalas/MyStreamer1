/* The small things every screen uses: finding an element, escaping text, fetching JSON. */
import {tr} from '../i18n.js';

/* ---------- helpers ---------- */
export const $ = s => document.querySelector(s);
/** Failed load: one calm line and a button that runs the same load again. */
export function showErr(el, what, e, retry){
  if(!el) return;
  const why = !navigator.onLine ? tr('net.offline') : (e?.message || '');
  dispatchEvent(new CustomEvent('veo:error', {detail: `${what}${why ? ' · ' + why : ''}`}));   // for a problem report
  el.innerHTML = `<div class="oops"><span>${esc(what)}${why ? ` · ${esc(why)}` : ''}</span>${retry ? `<button>${tr('common.retry')}</button>` : ''}</div>`;
  const b = el.querySelector('button');
  if(b) b.onclick = () => { el.innerHTML = `<p class="note">${tr('common.loading')}</p>`; retry(); };
}
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const normUrl = u => u.trim().replace(/^stremio:\/\//, 'https://');
export const baseOf = u => normUrl(u).replace(/\/manifest\.json(\?.*)?$/, '');
/** fetch with a deadline: a hung socket must not leave a screen "loading" forever. */
export async function fetchTimed(url, ms, opts){
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try{ return await fetch(url, {...opts, signal: ctl.signal}); }
  catch(e){ throw new Error(e.name === 'AbortError' ? tr('net.noResponse') : e.message); }
  finally{ clearTimeout(timer); }
}
export async function getJSON(url, ms = 9000){
  const r = await fetchTimed(url, ms);
  // the status travels with the error: an answer of "no" is worth repeating to nobody
  if(!r.ok){ const e = new Error(r.status + ' from ' + new URL(url).host); e.status = r.status; throw e; }
  return r.json();
}

/* ---------- lazy images: posters load only when they come near the screen (big win on TV boxes) ---------- */
export const bgObserver = new IntersectionObserver(entries => {
  for(const en of entries) if(en.isIntersecting){
    const el = en.target;
    bgObserver.unobserve(el);
    const url = q => `url("${(q || '').replace(/"/g, '%22')}")`;
    if(!el.dataset.fb){ el.style.backgroundImage = url(el.dataset.bg); continue; }
    // a card cut from the title's wide picture: when it does not come, the poster is the card's picture instead
    const img = new Image();
    img.onload = () => { el.style.backgroundImage = url(el.dataset.bg); };
    img.onerror = () => { el.classList.remove('land'); el.style.backgroundImage = url(el.dataset.fb); };
    img.src = el.dataset.bg;
  }
}, {rootMargin: '400px 600px'});
export function lazyBg(root){
  root.querySelectorAll?.('[data-bg]:not([data-bgw])').forEach(el => { el.dataset.bgw = 1; bgObserver.observe(el); });
}
new MutationObserver(muts => {
  for(const m of muts) for(const n of m.addedNodes) if(n.nodeType === 1) lazyBg(n.matches('[data-bg]') ? n.parentNode : n);
}).observe(document.body, {childList: true, subtree: true});
/* Remote-driven mode. The app says whether this is a television; every layout must navigate
   with the D-pad there - the TV *layout* is only the ten-foot skin. (In a desktop browser,
   choosing the TV layout still turns this on, which is how it is tested.) */
