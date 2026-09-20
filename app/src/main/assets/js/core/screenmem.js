/* Where the viewer was: the place in a list they left, and the title they went into. */
import {isTvLayout} from './settings.js';
import {card} from '../ui/cards.js';
import {focusItem} from '../ui/tvnav.js';

export const screenMem = new Map();
export let memHash = location.hash;
/** The title the viewer went into, so that coming back out lands on it rather than at the top. */
export let lastOpened = null;

/** A title was opened from a list: coming back out lands on it, not at the top of the screen. */
export function noteOpened(hash, id){ lastOpened = {hash, id}; }
export function rememberScreen(){
  const card = document.activeElement?.closest?.('.poster, .ep, .chmain');
  const opened = lastOpened?.hash === memHash ? lastOpened.id : null;
  screenMem.set(memHash, {y: scrollY, id: card?.dataset.id || opened});
  memHash = location.hash;
}
export function restoreScreen(){
  const mem = screenMem.get(location.hash);
  if(!mem || (!mem.y && !mem.id)){ scrollTo(0, 0); return; }
  // The rows of a screen come back one answer at a time, and the one the viewer was on may be the last
  // of them - so the place is looked for until it is there (about six seconds), and given up the moment
  // the viewer moves themselves.
  let tries = 0, stop = false;
  const cancel = () => { stop = true; };
  addEventListener('wheel', cancel, {once: true});
  addEventListener('touchstart', cancel, {once: true});
  addEventListener('keydown', cancel, {once: true});
  const tick = () => {
    if(stop) return;
    if(mem.id){
      const el = document.querySelector(`.poster[data-id="${CSS.escape(mem.id)}"]`);
      if(el){ isTvLayout() ? focusItem(el) : el.scrollIntoView({block: 'center', behavior: 'smooth'}); stop = true; return; }
    }
    if(Math.abs(scrollY - mem.y) > 4 && document.documentElement.scrollHeight > mem.y) scrollTo(0, mem.y);
    if(++tries < 40) setTimeout(tick, 250);
  };
  tick();
  // …and the moment the title itself arrives, whenever that is: a row can take longer than any wait
  if(mem.id){
    const watch = new MutationObserver(() => { if(!stop) tick(); if(stop) watch.disconnect(); });
    watch.observe(document.getElementById('app'), {childList: true, subtree: true});
    setTimeout(() => watch.disconnect(), 20000);
  }
}
