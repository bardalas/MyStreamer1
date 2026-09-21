/* The remote control: what the arrows reach, and the marker that follows them. */
import {listHash, route} from '../app.js';
import {$} from '../core/dom.js';
import {IS_TV_DEVICE, isTvLayout, settings} from '../core/settings.js';
import {FWD} from '../i18n.js';

/* Remote control (Android TV): arrows move focus between titles and between rows, and the page
   follows the focus — instead of the browser scrolling on its own. */
export const FOCUSABLE = 'a[href], button:not([disabled]), input:not([type="hidden"]), select, [tabindex]:not([tabindex="-1"])';
/* Every group of controls the remote can stand on. Anything focusable MUST sit inside one of
   these, or the D-pad cannot reach it; tvRows() keeps only the innermost match, so nesting two
   of them is safe. Grouped by the screen that renders them. */
export const ROWS_SEL = [
  '#rail', '.stabs', '.spane', '.sset', '.slines', '.themes',             // chrome: the side menu, the settings menu and its lists
  '.bctabs', '.srctabs', '.strip', '.grid', '.sortbar',                    // browsing rows and pickers
  '.ltabs', '.mkbar', '.oops',                                             // archive/mako tabs, error boxes
  '#desc', '.seasonbar', '.seasons', '.eps', '.eplist',                    // a title: text, episodes
  '.tacts', '#palt', '.src',                                               // a title: what can be done with it
  '.playrow', '.altlist',                                                  // the sources of a title
  '.live-top', '#cont', '#bchead', '.chlist',                              // live TV
  '.days', '.progs', '.keypad', '.keyform', '.cextra',                     // catch-up guide, key entry
  '.sheet header', '.sheet .body', '.tstat', '.update', '#player header',  // sheets and floating cards
  '.catorder', '.addpl', '.add', '.addon',                                 // settings lists, add-ons
].join(', ');
// offsetParent is null for position:fixed elements (per spec) even when they're plainly on
// screen - the rail, the update card and the torrent-status card are all fixed. A size check
// on the box itself, ignoring layout position, doesn't have that blind spot.
export const visible = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
/* While a card is over the picture - a title card, the update notice, a source being opened - the remote
   stays inside it: nothing behind it can take the focus, so the only ways on are its own buttons. */
export function openCard(){
  const sheet = document.querySelector('.sheet, .update');
  if(sheet) return sheet;
  // The status card's display is set inline by the page itself, so its own style attribute is the
  // answer - and reading that, unlike asking for a computed style, does not make the browser lay the
  // whole page out again. This is asked on every change of the screen, so it must cost nothing.
  const st = document.getElementById('tstatus');
  return st && st.style.display && st.style.display !== 'none' ? st : null;
}
export const tvScope = () => openCard() || document;
/**
 * What the arrows can reach, worked out once and kept until the screen changes.
 *
 * Finding it means asking the whole document for every group, and asking every element inside them
 * whether it is on screen - which is hundreds of measurements, and a measurement makes the browser
 * lay the page out again. Doing that on every press is what made a remote feel slow; the screen does
 * not change between two presses, so neither does the answer.
 */
let rowCache = null;
const itemCache = new WeakMap();
let gen = 0;                                       // a change of the screen is a new generation of answers
// A button that was only hidden is still connected, so the isConnected check in itemsOf() cannot see
// it go - nor a source button arriving beside it. The generation is what makes both noticed.
export function forgetRows(){ rowCache = null; gen++; }

export const tvRows = () => {
  const scope = tvScope();
  if(rowCache && rowCache.scope === scope && rowCache.rows.every(r => r.isConnected)) return rowCache.rows;
  const own = scope !== document && scope.matches(ROWS_SEL) ? [scope] : [];
  const all = [...own, ...scope.querySelectorAll(ROWS_SEL)].filter(c => visible(c) && [...c.querySelectorAll(FOCUSABLE)].some(visible));
  // Only the innermost match is a row. Document order IS the order on screen - no CSS reorders
  // rows against the markup - and unlike measuring positions it cannot be shuffled by scrolling
  // or by a sticky bar reporting itself at the top of the viewport.
  const rows = all.filter(r => !all.some(o => o !== r && r.contains(o)));
  rowCache = {scope, rows};
  return rows;
};
export const itemsOf = row => {
  const kept = itemCache.get(row);
  if(kept && kept.gen === gen && kept.items.length && kept.items.every(el => el.isConnected)) return kept.items;
  // the buttons of the title in the middle of a wheel are a step below the row, not part of it
  const items = [...row.querySelectorAll(FOCUSABLE)].filter(el => visible(el) && !el.closest('.spotact'));
  itemCache.set(row, {gen, items});
  return items;
};
/* A screen that is drawn again is a different screen: anything added, removed or hidden forgets what
   the arrows could reach, and says again whether a card is over the page. Both answers are wanted
   once per frame at most - a row of forty titles arrives as dozens of separate changes, and
   answering each of them is what makes a remote feel heavy. */
let pendingLook = 0;
const lookAgain = () => {
  pendingLook = 0;
  forgetRows();
  const held = !!openCard();
  if(document.body.classList.contains('sheeted') !== held) document.body.classList.toggle('sheeted', held);
};
/* A wheel turning is not a new screen. Stepping along a row takes the panel under the middle title
   off and puts it back, writes its position and the row's turn as inline styles (js/ui/reel.js), and a
   poster's picture arrives as an inline style too (js/core/dom.js) - none of which changes what the
   arrows can reach. Treating all of that as a new screen threw the cache above away on every single
   press, which is the cost it exists to avoid. Only the status card hides itself with an inline
   style; everything else that comes and goes does so as an element, or with `hidden`. */
const cosmetic = n => n.nodeType !== 1 || n.classList.contains('spotact')
  || n.classList.contains('spotinfo') || n.classList.contains('taste');
const inTrim = el => el?.nodeType === 1 && !!el.closest?.('.spotact, .art');
new MutationObserver(muts => {
  if(pendingLook) return;
  for(const m of muts){
    const changed = m.type === 'childList'
      ? !inTrim(m.target) && [...m.addedNodes, ...m.removedNodes].some(n => !cosmetic(n))
      : m.attributeName === 'hidden' || m.target.id === 'tstatus';
    if(changed){ pendingLook = requestAnimationFrame(lookAgain); return; }
  }
}).observe(document.body, {childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'style']});
addEventListener('hashchange', forgetRows);
export const centerX = el => { const r = el.getBoundingClientRect(); return r.left + r.width / 2; };
/** Where to land in [row] when arriving from [from]: a season menu's chosen season, else the item nearest across. */
export const bestIn = (row, from, dir) => {
  const cand = itemsOf(row), near = upInto(cand, dir);
  const x = from ? centerX(from) : 0;
  // a wheel always shows its title in the same place, so arriving on one means the title it holds -
  // the one the viewer was on before, or the row's first - not whatever happens to be across the page
  if(row.classList.contains('reel'))
    return cand.find(el => el.classList.contains('spot')) || cand.find(el => el.dataset.wasSpot) || cand[0];
  // the season being shown, the episode lined up to play, and the source the wheel is showing are
  // where arriving on those rows lands
  return ((row.classList.contains('seasonbar') || row.classList.contains('srctabs') || row.classList.contains('stabs')) && cand.find(el => el.classList.contains('on')))
    || (row.classList.contains('eps') && cand.find(el => el.classList.contains('on')))
    || near.reduce((best, el) => Math.abs(centerX(el) - x) < Math.abs(centerX(best) - x) ? el : best, near[0]);
};
/** Arriving from below, the line to land on is the row's last one - the one right above - not its first. */
function upInto(cand, dir){
  if(dir !== 'up' || cand.length < 2) return cand;
  const mid = el => { const r = el.getBoundingClientRect(); return r.top + r.height / 2; };
  const low = Math.max(...cand.map(mid));
  return cand.filter(el => mid(el) > low - 6);
}
/* Move the focus and put the page where a viewer expects it: a title row is shown with its heading
   under the top bar (so the category is always readable), anything else is just brought into view. */
/** Travel to [y]: a short way is slid, a long way is jumped - a viewer should not watch the page fly. */
export function glide(y){
  const to = Math.max(0, Math.round(y));
  const far = Math.abs(scrollY - to) > innerHeight * 1.6;
  scrollTo({top: to, behavior: isTvLayout() || far ? 'auto' : 'smooth'});
}
export function focusItem(el){
  if(!el) return;
  el.focus({preventScroll: true});
  // A television scrolls instantly: a smooth scroll under a held arrow arrives after the next press,
  // which is what makes moving through a list feel heavy.
  const how = isTvLayout() ? 'auto' : 'smooth';
  // the menu scrolls inside itself; the page behind it stays where the viewer left it
  if(el.closest('#rail')) return el.scrollIntoView({block: 'nearest', behavior: how});
  // A title's seasons and episodes scroll inside their own panes. Because focus() uses
  // preventScroll, explicitly keep the focused row fully inside that pane; viewport-only checks
  // miss clipping at the pane's top/bottom edge.
  const pane = el.closest('.eps, .seasonbar, .eplist, .altlist, .spane');
  if(pane){
    const er = el.getBoundingClientRect(), pr = pane.getBoundingClientRect();
    if(er.top < pr.top + 6 || er.bottom > pr.bottom - 6)
      el.scrollIntoView({block: 'nearest', inline: 'nearest', behavior: how});
  }
  // a wheel is not scrolled: it is turned, by whatever took the middle (js/ui/reel.js)
  const strip = el.closest('.strip:not(.reel), .chlist, .stabs');
  if(strip && strip.scrollWidth > strip.clientWidth + 4) el.scrollIntoView({block: 'nearest', inline: 'center', behavior: how});
  const row = el.closest('.row');
  if(row){
    const want = Math.max(0, Math.round(row.getBoundingClientRect().top + scrollY - 14));
    if(Math.abs(scrollY - want) > 4) glide(want);
    return;
  }
  const r = el.getBoundingClientRect();
  if(r.top < 20 || r.bottom > innerHeight - 20) el.scrollIntoView({block: 'center', behavior: how});
}
/* The page draws its own focus (see css/focus.css), so the browser's ring is taken off. */
document.body.classList.add('motion');

/**
 * The taste plays in a frame of YouTube's, and a frame of someone else's can take the focus for
 * itself - after which every arrow press is delivered to YouTube and the page never hears it. The
 * card then looks frozen while the list behind it scrolls. So the focus is taken straight back, to
 * wherever it was before the frame appeared.
 */
let lastFocus = null;
let railReturnFocus = null;                         // exact content item left when the remote enters the side rail
addEventListener('focusin', e => { if(e.target.tagName !== 'IFRAME') lastFocus = e.target; });
const reclaim = () => {
  const a = document.activeElement;
  if(!a || a.tagName !== 'IFRAME') return;
  a.blur();
  const scope = tvScope();
  const back = lastFocus?.isConnected && (scope === document || scope.contains(lastFocus))
    ? lastFocus : itemsOf(tvRows()[0] || document.body)[0];
  focusItem(back);
};
addEventListener('blur', () => setTimeout(reclaim, 0), true);
// only while a trailer is on the screen is there a frame that could take the focus away
setInterval(() => { if(document.querySelector('iframe.taste')) reclaim(); }, 1500);

/* While a card is open the page behind it must not move. `:has()` does this on a recent browser;
   a television's is not always recent, so the class says the same thing in a way that is older
   than the app. */

export function tvMove(dir){
  const rows = tvRows();
  if(!rows.length) return false;
  const active = document.activeElement;
  let row = rows.find(r => r.contains(active));
  if(!row){ focusItem(itemsOf(rows[0])[0]); return true; }
  const items = itemsOf(row);
  const i = items.indexOf(active);
  /* The title in the middle of a wheel carries its own two buttons. They are not part of the row -
     along the row you pass titles, not buttons - so they are a step down from the title and a step
     back up, and below them is whatever the row leads to. */
  const act = row.querySelector?.('.spotact');
  if(act && dir === 'down' && active?.classList.contains('spot')){
    // With no extra buttons under the title, going down jumps to the row below directly
    const below = rows[rows.indexOf(row) + 1];
    if(below) focusItem(bestIn(below, active));
    return true;
  }
  // A side menu is a column: up/down pick an entry, left steps into what it controls - #rail drives
  // the page, .stabs the settings pane, .seasonbar the episode list.
  const pane = row.classList.contains('stabs') ? '#spane'
             : row.classList.contains('seasonbar') ? row.dataset.pane
             : (row.id === 'rail' && document.body.classList.contains('railed')) ? '#app' : null;
  if(pane){
    if(dir === 'up' || dir === 'down'){
      const n = items[i + (dir === 'down' ? 1 : -1)];
      if(n){
        if(row.id === 'rail'){ focusItem(n); return true; }   // a place in the app waits for OK
        n.click();                                  // a tab, though, opens as you arrive on it
        focusItem(n);                               // also scroll its inner pane; focus() alone can leave it clipped
        return true;
      }
      // the ends of a menu lead on to the row above or below it - never into what the menu itself controls
      const next = row.id === 'rail' ? null : rows[rows.indexOf(row) + (dir === 'down' ? 1 : -1)];
      if(next && !$(pane)?.contains(next)) focusItem(bestIn(next, active));
      return true;
    }
    if(dir === FWD()){                              // what the menu controls is on its far side
      const target = $(pane);
      // Returning from the global rail goes back to the exact title/control the viewer left, not
      // to the first row. This preserves both the visual row and the page's current scroll position.
      if(row.id === 'rail' && railReturnFocus?.isConnected && target?.contains(railReturnFocus)){
        focusItem(railReturnFocus);
        return true;
      }
      // the titles are what the viewer came for: the pills above them are not where to land
      const rows = target ? tvRows().filter(r => target.contains(r)) : [];
      const cards = rows.find(r => r.querySelector('.poster, .ep, .chmain, .eprow'));
      const its = target ? itemsOf(target) : [];
      const first = (cards && itemsOf(cards)[0]) || its.find(el => el.classList.contains('on'))
        || rows.flatMap(itemsOf)[0] || its[0];
      if(first) focusItem(first);
      return true;
    }
    // Backwards, a menu inside the page leads on to the rail - the way out of the screen itself.
    // Without this the settings menu was a dead end: the only way out was upwards, past its first
    // entry, which is not where anyone looks for the way back.
    if(row.id !== 'rail' && document.body.classList.contains('railed')){
      const out = $('#rail a.on') || $('#rail a');
      if(out){ focusItem(out); return true; }
    }
    return true;
  }
  if(dir === 'left' || dir === 'right'){
    // ArrowLeft goes forward through a right-to-left row, ArrowRight through a left-to-right one
    const ltr = row.classList.contains('keypad') || getComputedStyle(row).direction === 'ltr';
    const fwd = ltr ? 'right' : FWD();
    // Episodes are a column; a film's two ways in are one line, and Left/Right must move between them
    // - as a column they could not, and the far one was out of reach of the remote altogether.
    const isCol = row.classList.contains('eps') && !row.classList.contains('filmgo') && isTvLayout();
    if(!isCol){
      const step = dir === fwd ? 1 : -1;
      const next = items[i + step];
      /* Only along the line the viewer is on. In a grid the item before the first of a line is the last
         of the line above it: going there took the viewer up through the titles, when the edge of the
         line is where the way back to the side menu is. */
      const a = active.getBoundingClientRect(), n = next?.getBoundingClientRect();
      if(next && n.top < a.bottom && n.bottom > a.top){ focusItem(next); return true; }
    }
    if(dir !== fwd){                              // back to the side menu, if there is one
      const tab = document.querySelector('.stabs button.on') || document.querySelector('.stabs button');
      if(tab && $('#spane')?.contains(active)){ focusItem(tab); return true; }
      const stab = document.querySelector('.seasonbar button.on') || document.querySelector('.seasonbar button');
      if(stab && row.classList.contains('eps')){ focusItem(stab); return true; }
      if(document.body.classList.contains('railed') && $('#app').contains(active)){
        railReturnFocus = active;                    // remember the exact movie/control before entering the rail
        focusItem($('#rail a.on') || $('#rail a'));
        return true;
      }
    } else if(isCol && row.classList.contains('seasonbar')){
      const target = $('#eps');
      const first = target?.querySelector('.epcard.on') || target?.querySelector('.epcard');
      if(first){ focusItem(first); return true; }
    }
    return true;                                    // stay put at the row's edge
  }
  // up / down: move within the row if it has more than one visual line (a grid, or a vertical
  // list); a row that is genuinely one line has nothing on another line, so this falls through to
  // moving to the next row below/above it, correctly, without needing to know which kind it is.
  const x = active ? centerX(active) : 0;
  const ar = active.getBoundingClientRect();
  const mid = el => { const r = el.getBoundingClientRect(); return r.top + r.height / 2; };
  // Another line = an item whose middle lies beyond this one's edge. (Comparing tops made the search box,
  // a little taller than the menu links beside it, look like the line below them.)
  const line = items.filter(el => (dir === 'down' ? mid(el) > ar.bottom : mid(el) < ar.top));
  if(line.length){
    const band = dir === 'down' ? Math.min(...line.map(mid)) : Math.max(...line.map(mid));
    const same = line.filter(el => Math.abs(mid(el) - band) < 6);
    focusItem(same.reduce((best, el) => Math.abs(centerX(el) - x) < Math.abs(centerX(best) - x) ? el : best));
    return true;
  }
  // Down from the source tabs waits for the row they turn: while it is still being filled it cannot take
  // the focus, and the viewer would be carried past it to the row below.
  // Not for longer than a moment, though: a source that is slow to answer does not keep the viewer there.
  const skel = dir === 'down' && row.classList.contains('srctabs') && document.querySelector('#row0 .skel');
  if(skel){
    if(!skel.dataset.since) skel.dataset.since = Date.now();
    if(Date.now() - skel.dataset.since < TABS_WAIT_MS) return true;
  }
  const railed = document.body.classList.contains('railed');
  const flow = rows.filter(r => r === row || !(railed && r.id === 'rail'));
  const ri = flow.indexOf(row);
  const next = flow[ri + (dir === 'down' ? 1 : -1)];
  if(!next) return true;
  focusItem(bestIn(next, active, dir));
  return true;
}
export let lastMoveAt = 0;
addEventListener('keydown', e => {
  // the arrows belong to the remote - and to a wheel, wherever it is turning
  if((!isTvLayout() && !document.activeElement?.closest?.('.strip.reel, .spotact')) || e.altKey || e.ctrlKey || e.metaKey) return;
  const dir = {ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right'}[e.key];
  if(!dir) return;
  const a = document.activeElement;
  if(a && (a.tagName === 'INPUT' && !a.readOnly || a.tagName === 'SELECT')) return;   // typing / picking
  e.preventDefault();
  const now = performance.now();                     // a held key repeats fast: keep one move per ~55ms
  if(now - lastMoveAt < 55) return;
  lastMoveAt = now;
  tvMove(dir);
}, true);

// Remote control (Android TV): text fields stay locked while focus passes over them, so the on-screen
// keyboard doesn't pop up; OK (Enter) unlocks the field and opens the keyboard.
export function armInput(i){
  if(i.dataset.tvArmed) return;
  i.dataset.tvArmed = 1;
  // readOnly stops edits; inputmode="none" is what actually keeps the IME closed on boxes
  // whose keyboard still pops for a focused read-only field
  const lock = () => { if(IS_TV_DEVICE){ i.readOnly = true; i.inputMode = 'none'; } };
  const unlock = e => {
    if(!IS_TV_DEVICE || !i.readOnly) return;
    e?.preventDefault();
    i.readOnly = false;
    i.inputMode = '';
    i.focus();
    window.BoothAndroid?.showKeyboard?.();
  };
  lock();
  i.addEventListener('keydown', e => { if(e.key === 'Enter' && i.readOnly) unlock(e); });
  i.addEventListener('click', unlock);
  i.addEventListener('blur', lock);
}
export const armInputs = root => root.querySelectorAll?.('input[type="search"], input.field:not([type="checkbox"]), #q').forEach(armInput);
armInputs(document);
new MutationObserver(muts => { for(const m of muts) for(const n of m.addedNodes) if(n.nodeType === 1) armInputs(n.matches('input') ? n.parentNode : n); })
  .observe(document.body, {childList: true, subtree: true});
// Back on the remote/phone: close an open panel or keyboard first (called by the app before going back).
/** The longest Down from the source tabs waits for the row they turn (above). */
const TABS_WAIT_MS = 2500;
window.boothBack = () => {
  /* A card over the picture is closed by its own button, whichever card it is: Back then means what
     that button means - the update stays skipped, the download is cancelled, the reminder is put away
     - and there is one list of what counts as a card (openCard) rather than two that drift apart.
     The update card was missing from the old list, so Back left the app while it held the remote. */
  const card = openCard();
  if(card){
    const shut = card.querySelector('[data-back]');
    if(shut){ shut.click(); return true; }
    card.remove();
    tvFocus();
    return true;
  }
  const a = document.activeElement;
  if(a && a.tagName === 'INPUT' && !a.readOnly && IS_TV_DEVICE){ a.blur(); return true; }
  // Back on a settings page steps out to its entry in the settings menu; from the menu it leaves settings
  const entry = a?.closest?.('#spane') && document.querySelector('.stabs .on');
  if(entry){ focusItem(entry); return true; }
  const up = parentHash();
  if(up === null) return false;                      // already at the top: the app closes
  goTo(up);
  return true;
};
/** One level up, by where you are - never back through everything you visited. */
export function parentHash(){
  // A title goes back to the list it was opened from; everything else to what it sits under.
  const r = (location.hash.split('/')[1] || '').split('?')[0];
  if(!r) return null;                                                  // home
  if(['r13', 'kan', 'mako'].includes(r)) return listHash;   // a programme goes back to the list it was opened from
  if(r === 'addons') return '#/settings';
  if(r === 'detail') return listHash;
  if(r === 'all') return location.hash.split('/')[2] === 'series' ? '#/cat/series' : '#/cat/movies';   // a library, to its page
  return '#/';
}
/** Go somewhere without growing the history: Back is our own ladder now. */
export function goTo(hash){
  if(location.hash === hash) return route();
  history.replaceState(null, '', hash || '#/');
  route();
}
// Search key on the remote
window.boothSearchKey = () => { const q = $('#q'); q.focus(); q.readOnly = false; window.BoothAndroid?.showKeyboard?.(); };
// Remote control (Android TV): if nothing has focus after a page renders, focus its first item.
addEventListener('hashchange', () => setTimeout(tvFocus, 900));
export function tvFocus(tries = 0){
  if(settings.layout !== 'tv' || (document.activeElement && document.activeElement !== document.body)) return;
  // the titles are what the viewer came for: the pills and tabs above them are not where to land. A
  // screen whose titles are still on their way (a poster without a link is a placeholder) is given a
  // few more moments for them before anything else is taken.
  // The first row is where a screen begins - and its titles, not whichever row happened to answer first.
  // (A selector list answers in page order, so the title in the middle is asked for on its own.)
  const lead = document.querySelector('#app .strip');
  const waiting = tries < 4;
  const title = document.querySelector('#app .poster.spot') || lead?.querySelector('a.poster[href], button.poster')
    || ((!waiting || !lead?.querySelector('.poster')) && document.querySelector('#app a.poster[href], #app button.poster'));
  const coming = !title && document.querySelector('#app .poster') && waiting;
  // with no title to land on, the chosen source tab - landing on another one would switch the row
  const first = title || (!coming && (document.querySelector('#app .srctab.on') || document.querySelector('#app a[href], #app button')));
  // a screen that has not answered yet is asked again: landing in the menu instead would open it
  // over the very titles the viewer is waiting for
  if(first) first.focus();
  else if(tries < 8) setTimeout(() => tvFocus(tries + 1), 700);
}
setTimeout(tvFocus, 2500);
