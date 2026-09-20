/* The library, and what is waiting for a source. */
import {$, esc} from '../core/dom.js';
import {remind} from '../data/reminders.js';
import {library} from '../data/watch.js';
import {tr} from '../i18n.js';
import {card} from '../ui/cards.js';

export function viewLibrary(){
  const items = Object.values(library).sort((a,b) => b.added - a.added);
  const waiting = Object.values(remind).sort((a,b) => b.at - a.at);
  $('#app').innerHTML = `<div class="page"><h1>${esc(tr('lib.title'))}</h1>${items.length ? `<div class="grid">${items.map(card).join('')}</div>` : `<p class="note">${esc(tr('lib.empty'))}</p>`}
    ${waiting.length ? `<h2 style="margin:28px 0 12px">${esc(tr('lib.waiting'))}</h2><div class="grid">${waiting.map(card).join('')}</div>` : ''}</div>`;
}
