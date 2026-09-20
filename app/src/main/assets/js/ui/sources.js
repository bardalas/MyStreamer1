/* Where a title can be watched from, and what happens when one is chosen. */
import {$, esc} from '../core/dom.js';
import {guardView, withDeadline} from '../core/requests.js';
import {isTvLayout} from '../core/settings.js';
import {store} from '../core/store.js';
import {addons, fetchStreams, supports} from '../data/addons.js';
import {setAvail} from '../data/availability.js';
import {remindButton, wireRemind} from '../data/reminders.js';
import {progress} from '../data/watch.js';
import {tr} from '../i18n.js';
import {kanBox} from '../providers/kan.js';
import {makoPrograms} from '../providers/mako.js';
import {r13meta, r13row} from '../providers/reshet.js';
import {openPlayer} from './player.js';
import {endTaste} from './taste.js';

export function quickPick(type, videoId){
  return new Promise(resolve => {
    const src = addons.filter(a => supports(a.manifest, 'stream', type, videoId));
    const all = [];
    let pending = src.length, done = false;
    if(!pending) return resolve(null);
    const finish = p => { if(!done){ done = true; resolve(p); } };
    for(const a of src){
      fetchStreams(a, type, videoId)
        .then(list => { for(const st of list) all.push(parseStream(st, a.manifest.name, all.length)); })
        .catch(() => {})
        .then(() => {
          const p = bestForNow(all);
          if(--pending === 0 || (p && (p.direct || p.q === '1080p'))) finish(p);
        });
    }
  });
}

/** Which quality the viewer asked for, if any: kept between titles, because a taste for 1080p is a taste. */
export let prefQ = store.get('quality', '');
export const QUALITIES = ['4K', '1080p', '720p', 'SD'];
/** The source to play: the best one of the chosen quality, or simply the best. */
export const pickQ = list => (prefQ && list.find(x => x.q === prefQ)) || list[0];

/** The sensible default: 1080p when its file is small enough to stream, else the best-ranked. */
export function bestForNow(list){
  const ok = list.filter(x => x.q !== 'CAM' && rank(x) > 0).sort((a, b) => rank(b) - rank(a));
  const fits = x => !x.size || x.size < 5 * GB;               // big files start slowly and stall when streamed
  return ok.find(x => x.q === '1080p' && fits(x)) || ok.find(fits) || ok[0] || null;
}




/* ---------- sources: pick the best automatically ---------- */
export const GB = 1024 ** 3;
export let streamsToken = 0;
/** Draw the sources row again (the quality pills change what it says, not what it plays from). */
export let lastStreams = null;
export const fmtSize = b => b >= GB ? (b / GB).toFixed(1) + ' GB' : Math.round(b / 1024 ** 2) + ' MB';
export const isCam = s => /\b(hd)?cam(rip)?\b|\b(hd)?ts\b|telesync|\bscr\b|screener|\btc\b|telecine/i.test(`${s.name || ''}\n${s.title || s.description || ''}`);

/** Pull quality, seeders, size, provider and tags out of a Stremio stream (Torrentio format, with fallbacks). */
export function parseStream(s, addon, i){
  const title = s.title || s.description || '';
  const text = `${s.name || ''}\n${title}\n${s.behaviorHints?.filename || ''}`.toLowerCase();
  const q = /\b(hd)?cam(rip)?\b|\b(hd)?ts\b|telesync|\bscr\b|screener|\btc\b|telecine/.test(text) ? 'CAM'
    : /2160p|\b4k\b|\buhd\b/.test(text) ? '4K'
    : /1080p/.test(text) ? '1080p'
    : /720p/.test(text) ? '720p'
    : /480p|576p|360p|\bsd\b|dvdrip|xvid/.test(text) ? 'SD' : 'Other';
  const seeds = title.match(/👤\s*(\d+)/)?.[1];
  const sm = title.match(/💾\s*([\d.,]+)\s*([KMGT])i?B/i);
  const size = sm ? parseFloat(sm[1].replace(',', '.')) * 1024 ** ('KMGT'.indexOf(sm[2].toUpperCase()) + 1)
                  : (s.behaviorHints?.videoSize || null);
  const tags = [[/\b(dv|dovi|dolby.?vision)\b/, 'DV'], [/\bhdr(10\+?)?(?![a-z])/, 'HDR'], [/x265|hevc|h\.?265/, 'HEVC'],
                [/remux/, 'REMUX'], [/\b3d\b/, '3D']].filter(([re]) => re.test(text)).map(([, t]) => t);
  // A stream that is only a link (WatchHub answers with the service a title is on) is an offer to watch
  // it there, not something this app can play: it is named after the service and kept out of the ranking.
  const external = !!s.externalUrl && !s.url && !s.infoHash && !s.ytId;
  return {
    s, addon, i, q, size, tags, external,
    seeds: seeds != null ? +seeds : null,
    provider: (title.match(/⚙️\s*([^\n]+)/)?.[1] || '').trim(),
    flags: title.match(/[\u{1F1E6}-\u{1F1FF}]{2}/gu) || [],
    name: (external ? s.name : title.split('\n')[0] || s.name || addon).trim(),
    direct: !!(s.url || s.ytId),
  };
}

/** How good a source is to stream on a phone/TV: direct links first, then well-seeded 1080p. */
export function rank(x){
  if(x.external) return -1;                      // a program page is never a playable stream
  if(x.direct) return 1e9;
  const seeds = x.seeds ?? 0;
  // Nobody is sharing it right now: it goes last and never plays by itself, but a documentary with one
  // seeder is all there is for that title, so it is still offered rather than hidden.
  if(seeds < 1) return -1;
  const quality = {'1080p': 1, '720p': .92, '4K': .6, 'SD': .45, 'Other': .35}[x.q] ?? .3;
  // A stream starts when the first piece has arrived, and pieces grow with the file: a small file starts
  // sooner (and huge remuxes stall), so size counts against a source as well as seeders for it.
  const gb = x.size ? x.size / GB : 0;
  const size = !gb || gb <= 3 ? 1 : gb <= 6 ? .85 : gb <= 12 ? .6 : .35;
  return Math.log10(seeds + 1) * quality * size;
}

export function playStream(s, label, ctx){
  endTaste();                    // the trailer's work is done the moment the title itself is asked for
  // Release/file name lets the app pick Hebrew subtitles timed for this exact release.
  const release = s.behaviorHints?.filename || (s.title || s.description || '').split('\n')[0] || '';
  const vid = ctx.videoId || '';
  // what is playing (for "continue watching") and where to resume from
  const meta = JSON.stringify({metaId: ctx.meta?.id || vid, type: ctx.type || 'movie', name: ctx.meta?.name || label, poster: ctx.meta?.poster || ''});
  const done = progress[vid];
  const pos = done && done.d && done.t < done.d - 60 ? Math.floor(done.t * 1000) : 0;
  if(s.externalUrl && s.externalUrl.startsWith('#')){ location.hash = s.externalUrl; return; }
  if(s.url && window.BoothAndroid) BoothAndroid.playUrl(s.url, label, vid, release, meta, pos);
  else if(s.url || s.ytId) openPlayer(s, label, ctx);
  // a page on a service, not a video: it belongs to whatever opens that service on this device
  else if(s.externalUrl && window.BoothAndroid) BoothAndroid.openExternal(s.externalUrl);
  else if(s.externalUrl) window.open(s.externalUrl, '_blank', 'noopener');
  else if(s.infoHash && window.BoothAndroid) BoothAndroid.playTorrent(s.infoHash, Number.isInteger(s.fileIdx) ? s.fileIdx : -1, label, JSON.stringify(s.sources || []), vid, release, meta, pos);
  else alert(tr('src.torrentApp'));
}

/** Play, the quality shortcuts and the rest of the list go into the title's action row (#streams); what is
    still loading is a small note beside them, and the long list opens below the row (#palt). */
export function renderStreams(box, all, pending, label, ctx, errors = [], retry, isCurrent = () => true){
  if(!isCurrent()) return;
  const alt = $('#palt');
  const wasOpen = $('#altToggle')?.getAttribute('aria-expanded') === 'true';
  if(alt) alt.innerHTML = '';
  const list = all.filter(x => !x.external && x.q !== 'CAM').sort((a, b) => rank(b) - rank(a));
  // Somebody has to be sharing a source for it to play. The rest are still listed - for a rare
  // documentary one seeder is all there is - but never behind a button that says "play", and never
  // counted as "this title can be watched".
  const playable = list.filter(x => rank(x) > 0);
  const links = all.filter(x => x.external)
    .map(x => `<button class="qbtn" data-i="${x.i}">${esc(tr('src.watchOn', {svc: x.name || x.addon}))}</button>`).join('');
  const best = pickQ(playable);
  const rest = best ? list.filter(x => x !== best) : list;
  const more = rest.length ? `<button class="altbtn" id="altToggle" aria-expanded="${wasOpen}">${tr(best ? 'src.more' : 'src.weakN', {n: rest.length})}</button>` : '';
  const failure = errors.length ? `<span class="srcstat err">${errors.map(esc).join(' · ')}</span><button class="qbtn" id="sretry">${tr('common.retry')}</button>` : '';
  if(!best){
    // Program links and failed/partial searches must not be labelled "no sources".
    const status = pending ? tr('src.searching') : !links && !errors.length ? tr('src.none') : '';
    box.innerHTML = `${status ? `<span class="srcstat${pending ? '' : ' idle'}">${status}</span>` : ''}${links}${more}${failure}${pending || errors.length ? '' : remindButton(ctx)}`;
  }else{
    // This row chooses; the list below it is what starts. The quality in use wears the accent, and what
    // it will play - its size, and whether anything is still answering - is said beside it.
    const byQuality = QUALITIES.filter(q => playable.some(x => x.q === q));
    const detail = x => [x.q === 'Other' ? '' : x.q, x.size && fmtSize(x.size)].filter(Boolean).join(' · ');
    // One row for the quality, not one per quality: pressing it takes the next one there is.
    const next = byQuality[(byQuality.indexOf(best.q) + 1) % byQuality.length];
    box.innerHTML = `${byQuality.length > 1 ? `<button class="qbtn" id="qnext" data-q="${next}">${tr('src.quality')} · ${best.q}${best.size ? ` · ${fmtSize(best.size)}` : ''}</button>` : ''}
      ${links}${more}${failure}${pending ? `<span class="srcstat">${tr('src.searchingMore')}</span>` : ''}`;
    box.querySelectorAll('[data-q]').forEach(b => b.onclick = () => {
      if(!isCurrent()) return;
      prefQ = b.dataset.q === prefQ ? '' : b.dataset.q;         // pressing the one in use returns to automatic
      store.set('quality', prefQ);
      lastStreams?.();
      // the row is drawn again the moment it is pressed, and the viewer is still standing on it
      const stay = () => document.getElementById('qnext')?.focus();
      stay();
      requestAnimationFrame(stay);
    });
  }
  const retryButton = box.querySelector('#sretry');
  if(retryButton) retryButton.onclick = () => { if(isCurrent()) return retry?.(); };
  wireRemind(box, ctx);
  if(alt && rest.length) alt.innerHTML = `<div class="altlist"${wasOpen ? '' : ' hidden'}>${rest.slice(0, 40).map(x => `<button class="srow" data-i="${x.i}"><b>${x.q === 'Other' ? '—' : x.q}</b><span>${x.size ? fmtSize(x.size) : ''}</span><span>${x.direct ? tr('src.direct') : (x.seeds ?? 0) < 1 ? tr('src.weak') : '👤 ' + x.seeds}</span></button>`).join('')}</div>`;
  [box, alt].forEach(el => el?.querySelectorAll('[data-i]').forEach(b => b.onclick = () => { if(isCurrent()) playStream(all[b.dataset.i].s, label, ctx); }));
  if($('#altToggle')) $('#altToggle').onclick = e => {
    if(!isCurrent()) return;
    const btn = e.currentTarget, open = btn.getAttribute('aria-expanded') === 'true', more = alt.querySelector('.altlist');
    btn.setAttribute('aria-expanded', String(!open));
    more.hidden = open;
    if(!open) more.querySelector('button')?.focus();
  };
}

/* A source list is asked for once: a title's page, its poster being looked at, and the availability
   check all share the same answer for ten minutes. */


export async function loadStreams({type, meta}, videoId, label, autoplay = false){
  if(autoplay) endTaste();                          // they are watching this, not sampling it
  const token = ++streamsToken;                     // invalidate the previous request before any exit
  lastStreams = null;
  const box = $('#streams');
  if(!box) return;
  const inView = guardView(box);
  const current = () => token === streamsToken && inView() && $('#streams') === box;
  const takeFocus = isTvLayout() && (!document.activeElement || document.activeElement === document.body
    || document.activeElement.closest('.eps'));
  const src = addons.filter(a => supports(a.manifest, 'stream', type, videoId));
  const ctx = {videoId, type, meta};
  const all = [], errors = [];
  const clean = t => typeof t === 'string' ? t.trim().toLowerCase() : '';
  const name = clean(meta?.name || label);
  const match = itn => !!itn && (itn === name || (name.length > 3 && (itn.includes(name) || name.includes(itn))));
  // Each built-in is independent of installed stream add-ons. These are navigation links, not media.
  const broadcasters = name ? [
    {name: 'כאן 11', load: () => kanBox(), find: secs => {
      for(const sec of secs) for(const it of sec.items) if(match(clean(it.name)))
        return `#/kan/${encodeURIComponent(it.url.replace('https://www.kan.org.il', ''))}/${encodeURIComponent(it.name)}`;
    }},
    {name: 'mako (קשת 12)', load: () => makoPrograms(''), find: progs => {
      const it = progs.find(it => match(clean(it.name)));
      if(it) return `#/mako/${encodeURIComponent(it.path)}/${encodeURIComponent(it.name)}`;
    }},
    {name: 'רשת 13', load: () => r13row('series'), find: progs => {
      for(const it of progs) if(match(clean(it.name))){
        const sid = r13meta(it, 'SeriesID');
        if(sid) return `#/r13/${encodeURIComponent(sid)}/${encodeURIComponent(it.name)}`;
      }
    }},
  ] : [];
  let pendingAddons = src.length, pendingBroadcasters = broadcasters.length;
  let focused = false, played = false;
  const retry = () => { if(current()) return loadStreams({type, meta}, videoId, label); };
  const render = () => {
    if(!current()) return;
    lastStreams = render;
    renderStreams(box, all, pendingAddons + pendingBroadcasters > 0, label, ctx, errors, retry, current);
    // Broadcaster pages must not delay a playable source from an add-on.
    if(autoplay && !played){
      const ready = pickQ(all.filter(x => !x.external && x.q !== 'CAM' && rank(x) > 0).sort((a, b) => rank(b) - rank(a)));
      if(ready && (!pendingAddons || ready.direct || ready.q === prefQ)){
        played = true;
        playStream(ready.s, label, ctx);
        return;
      }
    }
    const first = $('#eps')?.querySelector('.epcard.on, .epcard');
    if(first && takeFocus && !focused){ focused = true; first.focus({preventScroll: true}); }
  };
  render();
  const broadcasterWork = Promise.all(broadcasters.map(async provider => {
    try{
      const response = await withDeadline(provider.load);
      if(!current()) return;
      const externalUrl = provider.find(response);
      if(externalUrl) all.push({s: {externalUrl}, addon: provider.name, i: all.length,
        q: 'VOD', size: null, tags: [], external: true, name: provider.name, direct: false});
    }catch(e){
      if(current()) errors.push(`${provider.name}: ${e?.message || tr('net.noResponse')}`);
    }finally{ pendingBroadcasters--; render(); }
  }));
  const addonWork = Promise.all(src.map(async a => {
    try{
      // Preserve the provider's existing 12s + retry budget, but bound the whole operation too.
      const streams = await withDeadline(() => fetchStreams(a, type, videoId), 30000);
      if(!current()) return;
      for(const s of streams) all.push(parseStream(s, a.manifest.name, all.length));
    }catch(e){
      if(current()) errors.push(`${a.manifest.name}: ${e?.message || tr('net.noResponse')}`);
    }finally{ pendingAddons--; render(); }
  }));
  await Promise.all([addonWork, broadcasterWork]);
  if(current() && type === 'movie' && meta?.id && src.length){
    const playable = all.some(x => !x.external && x.q !== 'CAM' && rank(x) > 0);
    // An error, no add-ons, or a service page is not evidence of unavailability.
    if(playable) setAvail(`${type}:${meta.id}`, true);
    else if(!errors.length && !all.some(x => x.external)) setAvail(`${type}:${meta.id}`, false);
  }
}
