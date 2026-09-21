/* A title as a card: its artwork, its name, and how far it was watched. */
import {$, esc} from '../core/dom.js';
import {yearOf} from '../data/addons.js';
import {avail, isNoSrc} from '../data/availability.js';
import {hasHebrew, heTitle} from '../data/hebrew.js';
import {svcGlyph, svcOf} from '../data/services.js';
import {progressIdx} from '../data/watch.js';
import {tr} from '../i18n.js';

/* The catalogues hand out their smallest poster, about 240 pixels wide. A poster on a television is
   drawn over three hundred device pixels wide, so that picture was being stretched - which is why the
   posters looked soft. The same address serves the same poster at 500 and 780 pixels; the middle one
   is sharp at the size a row draws it and still light enough for a screen of forty. */
export const posterAt = (url, size) => (url || '').replace(/\/poster\/(small|medium|large)\//, `/poster/${size}/`);

/**
 * A title as a poster. The service it is on is marked once, in the corner of the picture - not again
 * beside its name. [opts.mark] puts another mark there instead: a row of one source's titles marks them
 * with that source (ui/origins.js).
 */
export function card(m, opts = {}){
  const p = progressIdx.get(m.id);
  // A film that was watched to the end carries a tick; one left in the middle carries how far it got.
  // A series' entry is whichever episode was last played, so it never means the whole series is watched.
  const done = !!p?.done && p.type !== 'series';
  const pct = p && p.d && !p.done ? Math.min(100, p.t / p.d * 100) : 0;
  const marks = (done ? `<span class="seen" title="${esc(tr('card.watched'))}">✓</span>` : '')
    + (pct ? `<span class="track" title="${esc(tr('card.left', {n: Math.max(1, Math.round((p.d - p.t) / 60))}))}"><i style="width:${pct.toFixed(0)}%"></i></span>` : '');
  const svc = svcOf(m.id)[0];
  const mark = opts.mark ?? (svc ? svcGlyph(svc) : '');
  const badge = mark ? `<span class="svcbadge">${mark}</span>` : '';
  const art = m.poster
    ? `<div class="art" data-bg="${esc(posterAt(m.poster, 'medium'))}">${marks}${badge}</div>`
    : `<div class="art noart">${esc(m.name)}${marks}${badge}</div>`;
  const name = heTitle(m.id, m.name);
  const key = /^tt\d+$/.test(m.id) && (m.type === 'movie' || m.type === 'series') ? `${m.type}:${m.id}` : '';
  const none = key && typeof avail !== 'undefined' && isNoSrc(avail[key]);
  const rating = m.imdbRating ? `<small class="rate" title="IMDb">★ ${esc(m.imdbRating)}</small>` : '';
  return `<a class="poster${none ? ' nosrc' : ''}${done ? ' watched' : ''}" data-id="${esc(m.id)}" ${key ? `data-avail="${key}"` : ''} href="#/detail/${esc(m.type)}/${encodeURIComponent(m.id)}">${art}<div class="t"><span data-heid="${esc(m.id)}" dir="${hasHebrew(name) ? 'rtl' : 'auto'}">${esc(name)}</span>${rating}</div><div class="y">${esc(yearOf(m))}</div></a>`;
}
export const skeletons = n => Array.from({length:n}, () => `<div class="poster"><div class="art skel"></div></div>`).join('');
