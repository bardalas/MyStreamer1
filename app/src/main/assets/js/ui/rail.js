/* The menu down the side: which entry is lit, and - on a phone - opening and closing it. */
import {$} from '../core/dom.js';

/* A wide screen keeps the menu as a column beside the page; a phone keeps it off-screen until it is
   asked for. `body.railed` says which of the two the remote is dealing with (js/ui/tvnav.js). */
export const RAIL_MQ = matchMedia('(min-width: 900px)');
const paintRailed = () => document.body.classList.toggle('railed', RAIL_MQ.matches);
RAIL_MQ.addEventListener?.('change', () => { paintRailed(); openRail(false); });
paintRailed();

/** Open or close the phone's drawer. On a wide screen the menu is always there and this does nothing. */
export function openRail(on){
  document.body.classList.toggle('railopen', on);
  $('#railbtn')?.setAttribute('aria-expanded', String(on));
  const scrim = $('#scrim');
  if(scrim) scrim.hidden = !on;
}
$('#railbtn')?.addEventListener('click', () => openRail(!document.body.classList.contains('railopen')));
$('#scrim')?.addEventListener('click', () => openRail(false));
$('#rail')?.addEventListener('click', e => { if(e.target.closest('a')) openRail(false); });   // going somewhere closes it
addEventListener('hashchange', () => openRail(false));
addEventListener('keydown', e => { if(e.key === 'Escape') openRail(false); });
/* A menu that opens over the page hides the very thing the viewer is looking at, so opening it moves
   the page aside instead. The rows re-centre themselves once the page has finished moving. */
const rail = $('#rail');
const push = on => {
  if(!RAIL_MQ.matches || document.body.classList.contains('railwide') === on) return;
  document.body.classList.toggle('railwide', on);
  setTimeout(() => dispatchEvent(new Event('resize')), 400);
};
rail?.addEventListener('pointerenter', () => push(true));
rail?.addEventListener('pointerleave', () => push(false));
rail?.addEventListener('focusin', () => push(true));
rail?.addEventListener('focusout', e => { if(!rail.contains(e.relatedTarget)) push(false); });
/* The menu is open for as long as the viewer is in it - focus inside it, or the pointer over it. It is closed by the
   focus leaving (focusout, above), but that event does not come when the focused thing is taken away (the list of
   suggestions is cleared when a title is chosen) or when the page moves the focus itself: the menu stayed open over
   the page it had just led to. So the state is also settled from what is true - checked a frame after the focus
   moves anywhere outside it, after a change of screen, after something in the menu is removed, and after any key. */
const settle = () => requestAnimationFrame(() => {
  if(!RAIL_MQ.matches || !document.body.classList.contains('railwide')) return;
  if(!rail.contains(document.activeElement) && !rail.matches(':hover')) push(false);
});
addEventListener('focusin', e => { if(!rail?.contains(e.target)) settle(); });
addEventListener('hashchange', settle);
addEventListener('keydown', settle, true);
if(rail) new MutationObserver(settle).observe(rail, {childList: true, subtree: true});

/* the mark beside the field: on a wide screen it opens the field, on a phone the whole menu */
$('#sf .ic')?.addEventListener('click', () => RAIL_MQ.matches ? $('#q').focus() : openRail(true));
/* Enter searches. A browser's own "press Enter in a field to send the form" is not something every
   WebView does, so the key is heard here instead. On the television the first OK only unlocks the
   field (js/ui/tvnav.js), and while it is locked this listener lets the key pass. */
$('#q')?.addEventListener('keydown', e => {
  // the press that unlocked the field (js/ui/tvnav.js armInput says so by preventing the key's default) is not a search
  if(e.key !== 'Enter' || e.defaultPrevented || $('#q').readOnly) return;
  e.preventDefault();
  $('#sf').requestSubmit ? $('#sf').requestSubmit() : $('#sf').dispatchEvent(new Event('submit'));
});

/**
 * Light the entry the screen belongs to. A screen that is not one of the five - a title, a search,
 * a broadcaster's page - passes nothing and keeps the entry it was opened from lit.
 */
export function markNav(active){
  if(!active) return;
  document.querySelectorAll('.nav a').forEach(x => x.classList.toggle('on', x.dataset.r === active));
}
