/* The viewer's choices - theme, layout, language - and what the app looks like because of them. */
import {store} from './store.js';
import {UI, setUiLang} from '../i18n.js';

export const IS_TV_DEVICE = (() => { try{ return !!window.BoothAndroid?.isTv?.(); }catch(e){ return false; } })();
export const isTvLayout = () => IS_TV_DEVICE || (typeof settings !== 'undefined' && settings.layout === 'tv');
export const rowMax = () => isTvLayout() ? 24 : 40;


export const SKINS = [
  {id: 'veo', c: ['#050a16', '#16203a', '#3d8bff', '#e9f0ff']},
  {id: 'tungsten', c: ['#14161f', '#272c3f', '#f0b429', '#efe6cf']},
  {id: 'midnight', c: ['#000000', '#171b22', '#3dd6d0', '#e8eef5']},
  {id: 'velvet', c: ['#1a0f14', '#331e27', '#e8b86b', '#f6e7dc']},
  {id: 'forest', c: ['#0f1a15', '#1e3027', '#9be15d', '#e6efe4']},
  {id: 'netflix', c: ['#000000', '#1f1f1f', '#e50914', '#ffffff']},
  {id: 'daylight', c: ['#f4efe6', '#ebe3d5', '#c8412d', '#1d1a16']},
];
/* The app has one layout. It had four, and only one of them ever received the work: the wheel, the
   focus model, the title page, the episode strip and every fix since were built and tried in it,
   while the others quietly stopped matching the page around them. A choice that leads to a screen
   that does not work is not a choice, so it is gone - and anyone who had made it is brought back. */
export const LAYOUT = 'tv';
/* Posters are one size. Three sizes meant three layouts to keep working, and the middle one is the
   size every screen was designed around. */
export const POSTER_SIZE = 'm';
export const isTv = () => !!(window.BoothAndroid && BoothAndroid.isTv && BoothAndroid.isTv());
/* One door for every set of settings there will ever be. The two that the whole stylesheet depends
   on are pinned here rather than written by each caller: a reset that forgot them once put
   data-layout="undefined" on the page, and every rule written for the layout stopped matching. */
const pinned = s => Object.assign({skin: 'veo', lang: 'he', uiLang: UI, nosrc: 'grey', start: 'vod',
  kids: 'off', preview: 'on'}, s, {layout: LAYOUT, poster: POSTER_SIZE});
export let settings = pinned(store.get('settings', {}));
/** The player draws its own banner and channel list in native views: hand it this skin and direction. */
export function syncNativeTheme(){
  const s = getComputedStyle(document.documentElement), v = n => s.getPropertyValue(n).trim();
  try{
    window.BoothAndroid?.setTheme?.(JSON.stringify({dir: document.documentElement.dir,
      night: v('--night'), raise: v('--raise'), line: v('--line'),
      light: v('--light'), muted: v('--muted'), accent: v('--tungsten'), onAccent: v('--on-accent')}));
  }catch(e){}
}
export function applySettings(){
  const r = document.documentElement;
  r.dataset.skin = settings.skin; r.dataset.layout = settings.layout; r.dataset.poster = settings.poster; r.dataset.nosrc = settings.nosrc;
  setUiLang(settings.uiLang);                       // the strings' own module decides what is a language
  syncNativeTheme();
}
applySettings();

/** Replace every setting at once (the reset in Settings); the page is repainted by the caller. */
export function setSettings(next){
  settings = pinned(next);
  store.set('settings', settings);
  applySettings();
}
