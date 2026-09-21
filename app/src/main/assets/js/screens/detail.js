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
import {card} from '../ui/cards.js';
import {startTaste, trailerId} from '../ui/taste.js';
import {openPlayer} from '../ui/player.js';
import {loadStreams} from '../ui/sources.js';

/** One thing to watch, as a card in the row: its picture, its number and name, and how far it got. */
function epCard(v, meta){
  const n = v.episode ?? v.number ?? '';
  const w = progress[v.id];
  const pct = w && w.d ? Math.min(100, w.t / w.d * 100) : 0;
  const seen = pct > 92 || (w && !w.d);
  return `<button class="epcard${seen ? ' seen' : ''}" data-id="${esc(v.id)}">
    <span class="t"><b>${n !== '' ? `${esc(n)}. ` : ''}${esc(v.name || v.title || tr('detail.episodeN', {n}))}</b>
      <small>${[v.released ? new Date(v.released).toLocaleDateString() : '', pct && !seen ? tr('detail.minLeft', {n: Math.max(1, Math.round((w.d - w.t) / 60))}) : ''].filter(Boolean).map(esc).join(' · ')}</small></span></button>`;
}

/* Two marks, drawn in the line's own colour. */
const IC = {
  heart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20.3s-7.2-4.4-7.2-9.4a3.9 3.9 0 0 1 7.2-2.1 3.9 3.9 0 0 1 7.2 2.1c0 5-7.2 9.4-7.2 9.4z"/></svg>',
  trailer: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M10.3 8.6 16 12l-5.7 3.4z"/></svg>',
};

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
  app.innerHTML = `<div class="backdrop" style="background-image:url('${esc(meta.background || meta.poster)}')" title="${esc(tr('qv.play'))}">
      <div class="bprog" id="bprog" hidden><i></i></div></div>
    <div class="detail-overlay">
      <div class="detail ${seasons.length ? 'series' : 'movie'}">
        <div class="dinfo">
          <h1 dir="auto">${esc(heTitle(meta.id, meta.name))}${heTitle(meta.id, '') ? `<span class="orig"><bdi>${esc(meta.name)}</bdi></span>` : ''}</h1>
          <p class="desc" id="desc" dir="auto">${esc(meta.description)}</p>
          <div class="src" id="dsrc"></div>
          <div class="facts">${svcFacts(meta.id)}${meta.imdbRating ? `<span class="imdb">IMDb ${esc(meta.imdbRating)}</span>` : ''}${yearOf(meta) ? `<span>${esc(yearOf(meta))}</span>` : ''}${meta.runtime ? `<span>${esc(meta.runtime)}</span>` : ''}${(meta.genres||meta.genre||[]).map(g => `<span>${esc(genreName(g))}</span>`).join('')}</div>
          <div class="people">${meta.director?.length ? `<div><b>${tr('detail.director')}</b> ${esc([].concat(meta.director).join(', '))}</div>` : ''}${meta.cast?.length ? `<div><b>${tr('detail.cast')}</b> ${esc(meta.cast.slice(0,6).join(', '))}</div>` : ''}</div>
        </div>
      </div>
      <div class="tacts">
        <button class="tact ic ${saved?'saved':''}" id="lib" aria-label="${esc(libLabel(saved))}" title="${esc(libLabel(saved))}">${IC.heart}</button>
        ${meta.trailers?.[0]?.source ? `<button class="tact ic" id="trailer" aria-label="${esc(tr('detail.trailer'))}" title="${esc(tr('detail.trailer'))}">${IC.trailer}</button>` : ''}
        <button class="tact" id="restart" hidden>${tr('detail.fromStart')}</button>
        <span id="streams" class="psrc"></span>
      </div>
      <div id="palt"></div>
      <div class="epanel"><div class="epwrap">
          ${seasons.length > 1 ? `<div class="seasonbar" role="group" aria-label="${esc(tr('detail.season'))}" data-pane="#eps">${seasons.map(s =>
            `<button data-season="${s}" class="sbtn">${s === 0 ? tr('detail.specials') : tr('detail.seasonN', {n: s})}</button>`).join('')}</div>` : ''}
          <div class="eps" id="eps"></div></div></div>
    </div>`;
  document.body.classList.add('titlefit');             // on the TV a title page fits the screen, and its list scrolls
  startTaste('.backdrop', trailerId(meta), 400);                       // the artwork gives way to a taste

  // the picture is the play button: there is nothing else it could mean
  $('.backdrop').onclick = () => play();
  $('#lib').onclick = e => {
    const b = e.currentTarget;
    if(library[meta.id]) delete library[meta.id];
    else library[meta.id] = {id: meta.id, type, name: meta.name, poster: meta.poster, releaseInfo: yearOf(meta), added: Date.now()};
    store.set('library', library);
    const saved = !!library[meta.id];                        // update the mark in place, no reload
    b.setAttribute('aria-label', libLabel(saved));
    b.title = libLabel(saved);
    b.classList.toggle('saved', saved);
  };
  if($('#trailer')) $('#trailer').onclick = () => openPlayer({ytId: meta.trailers[0].source}, tr('detail.trailerTitle', {title: heTitle(meta.id, meta.name)}));

  const ctx = {type, meta};
  /** How far into what is lined up the viewer got, drawn along the foot of the picture. */
  const showProgress = id => {
    const w = progress[id], bar = $('#bprog');
    if(!bar) return;
    const pct = w && w.d ? Math.min(100, w.t / w.d * 100) : 0;
    bar.hidden = !pct;
    bar.firstElementChild.style.width = pct.toFixed(1) + '%';
  };
  // The first button plays whatever the list has chosen; the list is one press below it.
  let chosen = null;                                   // {id, label}
  const play = (fromStart = false) => { if(chosen) loadStreams(ctx, chosen.id, chosen.label, true, fromStart); };
  /** Where the viewer stopped, as a clock reads it. */
  const clock = s => {
    const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = Math.floor(s % 60);
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`;
  };
  /** The line that starts it says which of the two it will do; "from the beginning" is offered beside it. */
  const sayWhere = id => {
    const w = progress[id], part = w && w.d && w.t < w.d - 60 ? w.t : 0;
    const line = $('#eps')?.querySelector('.epcard.solo b');
    if(line) line.textContent = part ? tr('detail.resumeAt', {t: clock(part)}) : tr('detail.startFilm');
    const again = $('#restart');
    if(again) again.hidden = !part;
  };
  if(seasons.length){
    const renderEps = s => {
      const eps = videos.filter(v => (v.season ?? 0) == s).sort((a,b) => (a.episode ?? a.number ?? 0) - (b.episode ?? b.number ?? 0));
      $('#eps').innerHTML = eps.map(v => epCard(v, meta)).join('');
      const pick = (b, watch) => {
        $('#eps').querySelectorAll('.epcard').forEach(x => x.classList.remove('on')); b.classList.add('on');
        const v = videos.find(x => x.id === b.dataset.id);
        const label = `${meta.name} S${v.season}E${v.episode ?? v.number}`;
        chosen = {id: v.id, label};
        showProgress(v.id);
        const w = progress[v.id];
        const again = $('#restart');
        if(again){
          again.hidden = !(w && w.d && w.t < w.d - 60);
          again.onclick = () => play(true);
        }
        loadStreams(ctx, v.id, label, watch);
      };
      // choosing an episode is asking to watch it; arriving on the page only lines the first one up
      $('#eps').querySelectorAll('.epcard').forEach(b => b.onclick = () => pick(b, true));
      // open on the episode you are in the middle of, otherwise the first one you have not seen
      const started = eps.find(v => { const w = progress[v.id]; return w && w.d && w.t / w.d <= .92; });
      const next = started || eps.find(v => !progress[v.id]) || eps[0];
      const btn = next && $('#eps').querySelector(`.epcard[data-id="${CSS.escape(next.id)}"]`);
      if(btn){
        pick(btn);
        // the remote lands on the episode you would watch, before any source has answered
        if(isTvLayout() && (!document.activeElement || document.activeElement === document.body)) btn.focus({preventScroll: true});
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
    // The name of the film is already the heading of the page; the line under it is the one thing
    // there is to do with it, so it says that - and being the only line, it wears no band of its own.
    $('#eps').innerHTML = epCard({id: vid, name: tr('detail.startFilm'),
      released: null, episode: ''}, meta).replace('<small></small>',
      `<small>${[yearOf(meta), meta.runtime].filter(Boolean).map(esc).join(' · ')}</small>`)
      .replace('class="epcard', 'class="epcard solo');
    const row = $('#eps').querySelector('.epcard');
    chosen = {id: vid, label: meta.name};
    showProgress(vid);
    row.onclick = () => { row.classList.add('on'); play(); };
    row.classList.add('on');
    sayWhere(vid);                                   // "continue from 41:20", or "start playing"
    if($('#restart')) $('#restart').onclick = () => play(true);
    loadStreams(ctx, vid, meta.name);                    // the sources are looked for straight away
  }
}
