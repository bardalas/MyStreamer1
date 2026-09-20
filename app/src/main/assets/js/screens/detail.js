/* A title's own page. */
import {$, esc} from '../core/dom.js';
import {isTvLayout} from '../core/settings.js';
import {store} from '../core/store.js';
import {fetchMeta, warmSources, yearOf} from '../data/addons.js';
import {heCache, heTitle, hebrewOn, hebrewPlot} from '../data/hebrew.js';
import {genreName} from '../data/names.js';
import {svcFacts} from '../data/services.js';
import {library, progress} from '../data/watch.js';
import {tr} from '../i18n.js';
import {startTaste, trailerId} from '../ui/hero.js';
import {openPlayer} from '../ui/player.js';
import {loadStreams} from '../ui/sources.js';

export async function viewDetail(type, id){
  const app = $('#app');
  app.innerHTML = `<div class="backdrop skel"></div>`;
  if(type === 'movie') warmSources(type, id);                // a movie's sources load while its details do
  const meta = await fetchMeta(type, id);
  if(!meta){ app.innerHTML = `<div class="page"><h1>${tr('detail.notFound')}</h1><p class="note">${tr('detail.notFoundNote')}</p></div>`; return; }
  const saved = !!library[meta.id];
  if(hebrewOn() && /^tt\d+$/.test(meta.id)) hebrewPlot(meta.id).then(plot => {
    const el = $('#desc');
    if(!plot || !el) return;
    const PREVIEW = 650;
    const short = plot.text.length > PREVIEW ? plot.text.slice(0, plot.text.lastIndexOf(' ', PREVIEW)) + '…' : plot.text;
    const link = isTvLayout() ? tr('detail.wikiName')            // a link cannot be followed from a remote
      : `<a href="https://he.wikipedia.org/wiki/${encodeURIComponent(plot.article)}" target="_blank" rel="noopener">${tr('detail.wikiName')}</a>`;
    if($('#dsrc')) $('#dsrc').innerHTML = tr('detail.wikiFrom', {link});
    el.dir = 'rtl';
    el.innerHTML = esc(short).replace(/\n/g, '<br>') + (short !== plot.text ? ` <button class="readmore" id="rm">${tr('detail.readMore')}</button>` : '');
    if($('#rm')) $('#rm').onclick = () => { el.innerHTML = esc(plot.text).replace(/\n/g, '<br>'); };
    const h = app.querySelector('.detail h1');
    if(h && heCache[meta.id]?.t && !h.querySelector('.orig')) h.innerHTML = `${esc(heCache[meta.id].t)}<span class="orig"><bdi>${esc(meta.name)}</bdi></span>`;
  }).catch(() => {});
  const videos = (meta.videos || []).filter(v => v.season !== undefined || type !== 'movie');
  const seasons = [...new Set(videos.map(v => v.season ?? 0))].sort((a,b) => (a===0) - (b===0) || a - b);
  const libLabel = on => tr(on ? 'lib.in' : 'lib.add');
  // Play and the quality shortcuts sit right under the title; a series' episodes get the whole width below.
  app.innerHTML = `<div class="backdrop" style="background-image:url('${esc(meta.background || meta.poster)}')"></div>
    <div class="detail ${seasons.length ? 'series' : 'movie'}">
      <div class="poster-lg" style="background-image:url('${esc(meta.poster)}')"></div>
      <div class="dinfo">
        <h1 dir="auto">${esc(heTitle(meta.id, meta.name))}${heTitle(meta.id, '') ? `<span class="orig"><bdi>${esc(meta.name)}</bdi></span>` : ''}</h1>
        <p class="desc" id="desc" dir="auto">${esc(meta.description)}</p>
        <div class="src" id="dsrc"></div>
        <div class="facts">${svcFacts(meta.id)}${meta.imdbRating ? `<span class="imdb">IMDb ${esc(meta.imdbRating)}</span>` : ''}${yearOf(meta) ? `<span>${esc(yearOf(meta))}</span>` : ''}${meta.runtime ? `<span>${esc(meta.runtime)}</span>` : ''}${(meta.genres||meta.genre||[]).map(g => `<span>${esc(genreName(g))}</span>`).join('')}</div>
        <div class="people">${meta.director?.length ? `<div><b>${tr('detail.director')}</b> ${esc([].concat(meta.director).join(', '))}</div>` : ''}${meta.cast?.length ? `<div><b>${tr('detail.cast')}</b> ${esc(meta.cast.slice(0,6).join(', '))}</div>` : ''}</div>
      </div>
    </div>
    <div class="playrow"><span id="streams" class="psrc"><span class="srcstat">${tr('src.searching')}</span></span>
      <button class="btn ghost ${saved?'saved':''}" id="lib">${libLabel(saved)}</button>
      ${meta.trailers?.[0]?.source ? `<button class="btn ghost" id="trailer">${tr('detail.trailer')}</button>` : ''}</div>
    <div id="palt"></div>
    <div class="panel epanel"><div class="epwrap">
        ${seasons.length > 1 ? `<div class="seasonbar" role="group" aria-label="${esc(tr('detail.season'))}" data-pane="#eps">${seasons.map(s =>
          `<button data-season="${s}">${s === 0 ? tr('detail.specials') : tr('detail.seasonN', {n: s})}</button>`).join('')}</div>` : ''}
        <div class="eps" id="eps"></div></div></div>`;
  document.body.classList.add('titlefit');             // on the TV a title page fits the screen, and its list scrolls
  startTaste('.backdrop', trailerId(meta), 400);                       // the artwork gives way to a taste

  $('#lib').onclick = e => {
    const b = e.currentTarget;
    if(library[meta.id]) delete library[meta.id];
    else library[meta.id] = {id: meta.id, type, name: meta.name, poster: meta.poster, releaseInfo: yearOf(meta), added: Date.now()};
    store.set('library', library);
    const saved = !!library[meta.id];                        // update the button in place, no reload
    b.textContent = libLabel(saved);
    b.classList.toggle('saved', saved);
  };
  if($('#trailer')) $('#trailer').onclick = () => openPlayer({ytId: meta.trailers[0].source}, tr('detail.trailerTitle', {title: heTitle(meta.id, meta.name)}));

  const ctx = {type, meta};
  if(seasons.length){
    const renderEps = s => {
      const eps = videos.filter(v => (v.season ?? 0) == s).sort((a,b) => (a.episode ?? a.number ?? 0) - (b.episode ?? b.number ?? 0));
      $('#eps').innerHTML = eps.map(v => {
        const n = v.episode ?? v.number ?? '';
        const w = progress[v.id];                            // how far this episode was watched
        const pct = w && w.d ? Math.min(100, w.t / w.d * 100) : 0;
        const seen = pct > 92 || (w && !w.d);
        return `<button class="ep${seen ? ' seen' : ''}" data-id="${esc(v.id)}"><span class="n">${esc(n)}</span><span>
          <div>${esc(v.name || v.title || tr('detail.episodeN', {n}))}</div>
          <div class="d">${v.released ? esc(new Date(v.released).toLocaleDateString()) : ''}${pct && !seen ? ` · ${tr('detail.minLeft', {n: Math.max(1, Math.round((w.d - w.t) / 60))})}` : ''}</div>
          ${pct && !seen ? `<div class="bar"><i style="width:${pct}%"></i></div>` : ''}</span></button>`;
      }).join('');
      const pick = (b, watch) => {
        $('#eps').querySelectorAll('.ep').forEach(x => x.classList.remove('on')); b.classList.add('on');
        const v = videos.find(x => x.id === b.dataset.id);
        loadStreams(ctx, v.id, `${meta.name} S${v.season}E${v.episode ?? v.number}`, watch);
      };
      // choosing an episode is asking to watch it; arriving on the page only lines the first one up
      $('#eps').querySelectorAll('.ep').forEach(b => b.onclick = () => pick(b, true));
      // open on the episode you are in the middle of, otherwise the first one you have not seen
      const started = eps.find(v => { const w = progress[v.id]; return w && w.d && w.t / w.d <= .92; });
      const next = started || eps.find(v => !progress[v.id]) || eps[0];
      const btn = next && $('#eps').querySelector(`.ep[data-id="${CSS.escape(next.id)}"]`);
      if(btn){
        pick(btn);
        // the remote lands on the episode you would watch, before any source has answered
        if(isTvLayout() && (!document.activeElement || document.activeElement === document.body)) btn.focus();
      }
    };
    const first = seasons.find(s => s !== 0) ?? seasons[0];
    const pickSeason = s => {
      $('#app').querySelectorAll('.seasonbar [data-season]').forEach(b => b.classList.toggle('on', b.dataset.season == s));
      renderEps(s);
    };
    pickSeason(first);
    $('#app').querySelectorAll('.seasonbar [data-season]').forEach(b => b.onclick = () => pickSeason(b.dataset.season));
  } else {
    // A film is a list of one: the same choice, and the same way of starting it.
    const vid = meta.behaviorHints?.defaultVideoId || meta.id;
    const w = progress[vid];
    const pct = w && w.d ? Math.min(100, w.t / w.d * 100) : 0;
    const seen = pct > 92;
    $('#eps').innerHTML = `<button class="ep${seen ? ' seen' : ''}" data-id="${esc(vid)}"><span class="n">▶</span><span>
      <div>${esc(heTitle(meta.id, meta.name))}</div>
      <div class="d">${[yearOf(meta), meta.runtime].filter(Boolean).map(esc).join(' · ')}${pct && !seen ? ` · ${tr('detail.minLeft', {n: Math.max(1, Math.round((w.d - w.t) / 60))})}` : ''}</div>
      ${pct && !seen ? `<div class="bar"><i style="width:${pct}%"></i></div>` : ''}</span></button>`;
    const row = $('#eps').querySelector('.ep');
    row.onclick = () => { row.classList.add('on'); loadStreams(ctx, vid, meta.name, true); };
    row.classList.add('on');
    if(isTvLayout() && (!document.activeElement || document.activeElement === document.body)) row.focus();
    loadStreams(ctx, vid, meta.name);                    // the sources are looked for straight away
  }
}
