/* The card that opens on a title: its synopsis, and the two things to do with it. */
import {esc} from '../core/dom.js';
import {noteOpened} from '../core/screenmem.js';
import {fetchMeta, warmSources, yearOf} from '../data/addons.js';
import {heTitle, hebrewOn, hebrewPlot} from '../data/hebrew.js';
import {genreName} from '../data/names.js';
import {svcFacts} from '../data/services.js';
import {progress} from '../data/watch.js';
import {tr} from '../i18n.js';
import {card} from './cards.js';
import {endTaste, startTaste, trailerId} from './hero.js';
import {playStream, quickPick} from './sources.js';

export function nextEpisode(meta){
  const vids = (meta?.videos || []).filter(v => v.id && (v.season ?? 0) > 0)
    .sort((a, b) => (a.season - b.season) || ((a.episode ?? a.number ?? 0) - (b.episode ?? b.number ?? 0)));
  if(!vids.length) return null;
  const at = v => ({id: v.id, season: v.season, episode: v.episode ?? v.number ?? 1});
  const started = vids.find(v => { const w = progress[v.id]; return w && w.d && w.t / w.d <= .92; });
  if(started) return {...at(started), resume: true};
  return {...at(vids.find(v => !progress[v.id]) || vids[0]), resume: false};
}
/** The quick view's main button: continue, or watch from the start. */
export function qvPlayLabel(metaId){
  const w = Object.values(progress).find(x => x.metaId === metaId);
  if(w && w.d && w.t < w.d - 60){
    const left = Math.max(1, Math.round((w.d - w.t) / 60));
    return tr('qv.continue', {n: left});
  }
  return tr('qv.play');
}

/** The default source for a title, as soon as a good one has arrived - never waiting for the slowest add-on. */

/* ---------- the title card ----------
   One click on a poster raises a modest card over the screen: the banner, the Hebrew synopsis
   and the actions. The list stays put behind it; Back or ✕ closes it, "פרטים מלאים" opens the
   full page (episodes, all sources). It is a .sheet, so the remote is trapped inside it. */
export function closeQuickView(){ document.querySelector('.sheet.titleSheet')?.remove(); }

export async function openQuickView(card){
  document.querySelector('.sheet')?.remove();
  const href = card.getAttribute('href');
  const [, , type, idEnc] = href.split('/');
  const id = decodeURIComponent(idEnc);
  const name = card.querySelector('[data-heid]')?.textContent || card.querySelector('.t')?.textContent || '';
  warmSources(type, type === 'series' ? `${id}:1:1` : id);
  const sheet = document.createElement('div');
  sheet.className = 'sheet titleSheet';
  sheet.innerHTML = `<div role="dialog" aria-modal="true" aria-label="${esc(name)}">
      <header><b dir="auto">${esc(name)}</b><button aria-label="${esc(tr('common.close'))}">✕</button></header>
      <div class="tc-banner"></div>
      <div class="body">
        <div class="facts"></div>
        <p class="qvdesc note" dir="auto">${tr('qv.loadingSummary')}</p>
        <div class="qvact">
          <button class="btn primary" id="qvplay">${type === 'movie' ? qvPlayLabel(id) : tr('qv.play')}</button>
          <button class="btn ghost" id="qvmore">${tr(type === 'movie' ? 'qv.more' : 'qv.allEps')}</button></div>
      </div></div>`;
  document.body.appendChild(sheet);
  // the taste belongs to the card: whichever way the card is left, it goes with it
  const shut = () => { endTaste(); sheet.remove(); };
  sheet.querySelector('header button').onclick = shut;
  sheet.onclick = e => { if(e.target === sheet) shut(); };
  const goFull = () => { shut(); location.hash = href; };
  sheet.querySelector('#qvmore').onclick = goFull;
  const playBtn = sheet.querySelector('#qvplay');
  // one button that watches: a film from where it stopped, a series from the episode you are up to
  const epLabel = ep => tr(ep.resume ? 'qv.epCont' : 'qv.epPlay', {s: ep.season, e: ep.episode});
  playBtn.onclick = async () => {
    const was = playBtn.textContent;
    playBtn.disabled = true;
    playBtn.textContent = tr('qv.searching');
    const m = await fetchMeta(type, id).catch(() => null);
    const ep = type === 'series' ? nextEpisode(m) : null;
    const videoId = ep ? ep.id : (m?.behaviorHints?.defaultVideoId || id);
    const pick = await quickPick(type, videoId);
    if(!pick){
      playBtn.textContent = tr('qv.noSource');
      playBtn.disabled = false;
      playBtn.onclick = goFull;
      return;
    }
    playBtn.textContent = was;
    playBtn.disabled = false;
    shut();
    const label = ep ? `${m?.name || name} S${ep.season}E${ep.episode}` : (m?.name || name);
    playStream(pick.s, label, {videoId, type, meta: m || {id, name}});
  };
  playBtn.focus();

  const meta = await fetchMeta(type, id).catch(() => null);
  if(!sheet.isConnected) return;
  if(meta){
    sheet.querySelector('.tc-banner').style.backgroundImage = `url('${(meta.background || meta.poster || '').replace(/'/g, '%27')}')`;
    if(type === 'series' && !playBtn.disabled){
      const ep = nextEpisode(meta);
      if(ep) playBtn.textContent = epLabel(ep);
    }
    startTaste('.titleSheet .tc-banner', trailerId(meta), 400);
    sheet.querySelector('header b').textContent = heTitle(meta.id, meta.name);
    sheet.querySelector('.facts').innerHTML = svcFacts(id) + [meta.imdbRating && `<span class="imdb">IMDb ${esc(meta.imdbRating)}</span>`,
      yearOf(meta) && `<span>${esc(yearOf(meta))}</span>`, meta.runtime && `<span>${esc(meta.runtime)}</span>`,
      ...(meta.genres || meta.genre || []).slice(0, 3).map(g => `<span>${esc(genreName(g))}</span>`)].filter(Boolean).join('');
  }
  const desc = sheet.querySelector('.qvdesc');
  desc.classList.remove('note');
  desc.textContent = meta?.description || tr('qv.noSummary');
  if(hebrewOn() && /^tt\d+$/.test(id)){
    const plot = await hebrewPlot(id).catch(() => null);
    if(plot && sheet.isConnected){ desc.dir = 'rtl'; desc.textContent = plot.text; }
  }
}
document.addEventListener('click', e => {
  const card = e.target.closest('a.poster[href^="#/detail/"]');
  if(!card || !card.closest('.strip, .grid')) return;
  e.preventDefault();
  noteOpened(location.hash, card.dataset.id);                 // where to come back to
  openQuickView(card);
});
