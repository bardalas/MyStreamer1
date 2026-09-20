/* The viewer's choices - theme, layout, language - and what the app looks like because of them. */
import {store} from './store.js';
import {STRINGS, UI, applyUiLang} from '../i18n.js';

export const IS_TV_DEVICE = (() => { try{ return !!window.BoothAndroid?.isTv?.(); }catch(e){ return false; } })();
export const isTvLayout = () => IS_TV_DEVICE || (typeof settings !== 'undefined' && settings.layout === 'tv');
export const rowMax = () => isTvLayout() ? 24 : 40;


export const SKINS = [
  {id: 'veo', c: ['#050a16', '#16203a', '#3d8bff', '#e9f0ff']},
  {id: 'tungsten', c: ['#14161f', '#272c3f', '#f0b429', '#efe6cf']},
  {id: 'midnight', c: ['#000000', '#171b22', '#3dd6d0', '#e8eef5']},
  {id: 'velvet', c: ['#1a0f14', '#331e27', '#e8b86b', '#f6e7dc']},
  {id: 'forest', c: ['#0f1a15', '#1e3027', '#9be15d', '#e6efe4']},
  {id: 'daylight', c: ['#f4efe6', '#ebe3d5', '#c8412d', '#1d1a16']},
];
export const LAYOUTS = [
  {id: 'cinema', prev: '<i class="b"></i><span class="r">' + '<i></i>'.repeat(5) + '</span>'},
  {id: 'grid', prev: ('<span class="r">' + '<i></i>'.repeat(6) + '</span>').repeat(3)},
  {id: 'list', prev: '<span class="l"><i></i><em></em></span>'.repeat(3)},
  {id: 'tv', prev: '<i class="b"></i><span class="r big">' + '<i></i>'.repeat(3) + '</span>'},
];
export const POSTER_SIZES = ['s', 'm', 'l'];
export const isTv = () => !!(window.BoothAndroid && BoothAndroid.isTv && BoothAndroid.isTv());
export let settings = Object.assign({skin: 'veo', layout: isTv() ? 'tv' : 'cinema', poster: 'm', lang: 'he', uiLang: UI, nosrc: 'grey', start: 'vod', kids: 'off', preview: 'on'}, store.get('settings', {}));
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
  if(STRINGS[settings.uiLang] && settings.uiLang !== UI){ UI = settings.uiLang; applyUiLang(); }
  syncNativeTheme();
}
applySettings();

/** Replace every setting at once (the reset in Settings); the page is repainted by the caller. */
export function setSettings(next){
  settings = next;
  store.set('settings', settings);
  applySettings();
}
