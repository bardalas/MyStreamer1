/* A title as a card: its artwork, its name, and how far it was watched. */
import {$, esc} from '../core/dom.js';
import {yearOf} from '../data/addons.js';
import {avail, isNoSrc} from '../data/availability.js';
import {hasHebrew, heTitle} from '../data/hebrew.js';
import {svcMarks} from '../data/services.js';
import {progressIdx} from '../data/watch.js';
import {tr} from '../i18n.js';

export function card(m){
  const p = progressIdx.get(m.id);
  // A film that was watched to the end carries a tick; one left in the middle carries how far it got.
  // A series' entry is whichever episode was last played, so it never means the whole series is watched.
  const done = !!p?.done && p.type !== 'series';
  const pct = p && p.d && !p.done ? Math.min(100, p.t / p.d * 100) : 0;
  const marks = (done ? `<span class="seen" title="${esc(tr('card.watched'))}">✓</span>` : '')
    + (pct ? `<span class="track" title="${esc(tr('card.left', {n: Math.max(1, Math.round((p.d - p.t) / 60))}))}"><i style="width:${pct.toFixed(0)}%"></i></span>` : '');
  const art = m.poster
    ? `<div class="art" data-bg="${esc(m.poster)}">${marks}</div>`
    : `<div class="art noart">${esc(m.name)}${marks}</div>`;
  const name = heTitle(m.id, m.name);
  const key = /^tt\d+$/.test(m.id) && (m.type === 'movie' || m.type === 'series') ? `${m.type}:${m.id}` : '';
  const none = key && typeof avail !== 'undefined' && isNoSrc(avail[key]);
  const rating = m.imdbRating ? `<small class="rate" title="IMDb">★ ${esc(m.imdbRating)}</small>` : '';
  return `<a class="poster${none ? ' nosrc' : ''}${done ? ' watched' : ''}" data-id="${esc(m.id)}" ${key ? `data-avail="${key}"` : ''} href="#/detail/${esc(m.type)}/${encodeURIComponent(m.id)}">${art}<div class="t"><span data-heid="${esc(m.id)}" dir="${hasHebrew(name) ? 'rtl' : 'auto'}">${esc(name)}</span>${svcMarks(m.id)}${rating}</div><div class="y">${esc(yearOf(m))}</div></a>`;
}
export const skeletons = n => Array.from({length:n}, () => `<div class="poster"><div class="art skel"></div></div>`).join('');
