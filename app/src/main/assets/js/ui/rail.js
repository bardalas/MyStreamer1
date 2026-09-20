/* The rail of categories down the side of the screen. */
import {$, esc} from '../core/dom.js';
import {settings} from '../core/settings.js';
import {avail} from '../data/availability.js';
import {catName, rowsFor, userCategories} from '../data/catalogs.js';
import {tr} from '../i18n.js';

export const S = (d, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${d}${extra}</svg>`;
export const CAT_ICONS = {
  all: S('<rect x="3" y="3" width="7.5" height="7.5" rx="1.6"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.6"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.6"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.6"/>'),
  movies: S('<rect x="2.5" y="4.5" width="19" height="15" rx="2"/><path d="M2.5 9.5h19M7 4.5v5M12 4.5v5M17 4.5v5"/>'),
  series: S('<rect x="2.5" y="7" width="19" height="13" rx="2"/><path d="M8 3l4 4 4-4"/>'),
  israeli: S('<path d="M12 21.5s7-6 7-11.5a7 7 0 1 0-14 0c0 5.5 7 11.5 7 11.5z"/><circle cx="12" cy="10" r="2.6"/>'),
  kids: S('<circle cx="12" cy="12" r="9"/><path d="M8.3 14.3c1 1.3 2.3 1.9 3.7 1.9s2.7-.6 3.7-1.9"/>',
          '<circle cx="9" cy="10" r="1.1" fill="currentColor" stroke="none"/><circle cx="15" cy="10" r="1.1" fill="currentColor" stroke="none"/>'),
  docs: S('<rect x="2.5" y="7" width="13" height="10" rx="2"/><path d="M15.5 11.2l6-3.2v8l-6-3.2z"/>'),
  other: S('<circle cx="12" cy="12" r="7.5"/>'),
};

export const RAIL_MQ = matchMedia('(min-width: 900px)');
RAIL_MQ.addEventListener?.('change', () =>
  document.body.classList.toggle('railed', !$('#cats').hidden && RAIL_MQ.matches));

export function renderCats(active){
  const nav = $('#cats');
  const hadFocus = nav.contains(document.activeElement);
  nav.hidden = active == null;
  document.body.classList.toggle('railed', !nav.hidden && RAIL_MQ.matches);
  document.documentElement.style.setProperty('--barh', (document.querySelector('.bar')?.offsetHeight || 72) + 'px');
  if(active == null) return;
  if(settings.kids === 'on'){ nav.hidden = true; document.body.classList.remove('railed'); return; }
  const avail = userCategories().filter(c => rowsFor(c).length);
  // what you are browsing: everything, one type, or a collection - the pills on the page refine it
  const link = (href, icon, on, label) => `<a href="${href}" class="${on ? 'on' : ''}" title="${esc(label)}">
    <span class="ic" aria-hidden="true">${CAT_ICONS[icon] || CAT_ICONS.other}</span><span class="lbl"><bdi>${esc(label)}</bdi></span></a>`;
  nav.innerHTML = [link('#/', 'all', active === 'home', tr('cats.all')),
    link('#/cat/movies', 'movies', active === 'movies', tr('cats.movies')),
    link('#/cat/series', 'series', active === 'series', tr('cats.series')),
    ...avail.map(c => link(`#/cat/${c.id}`, c.id, active === c.id, catName(c)))].join('');
  nav.querySelector('.on')?.scrollIntoView({inline: 'center', block: 'nearest'});
  if(hadFocus) nav.querySelector('.on')?.focus({preventScroll: true});
}

/** After a row's title, quietly: what it holds and where it comes from (a catalogue's add-on, or the services merged in it). */
