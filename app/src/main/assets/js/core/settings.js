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
/** Every choice and what it is until the viewer makes it - the one list of them (booth.html reads the
    few it paints before the page is up from the stored settings, falling back to the same values). */
export const DEFAULTS = {skin: 'veo', lang: 'he', uiLang: UI, nosrc: 'grey', start: 'vod', kids: 'off',
  preview: 'on', subs: 'auto', cap: 'all', kidsAge: 'kids'};
/* One door for every set of settings there will ever be. The two that the whole stylesheet depends
   on are pinned here rather than written by each caller: a reset that forgot them once put
   data-layout="undefined" on the page, and every rule written for the layout stopped matching. */
const pinned = s => Object.assign({}, DEFAULTS, s, {layout: LAYOUT, poster: POSTER_SIZE});
/* The settings are the profile's (core/store.js) - but the choices about the device rather than about
   who is watching it, what the television can decode, are kept once for the device and every profile
   sees the same. They were a profile's own before there were profiles: the first one's are adopted. */
const DEVICE = ['cap'];
const deviceOwn = () => store.get('device', {});
{
  const own = store.get('settings', {}), dev = deviceOwn();
  const missing = DEVICE.filter(k => !(k in dev) && k in own);
  if(missing.length) store.set('device', {...dev, ...Object.fromEntries(missing.map(k => [k, own[k]]))});
}
export let settings = pinned({...store.get('settings', {}), ...deviceOwn()});

/** The kids profile's levels: the oldest age a title may be rated for. Up to 12 the profile is a child's -
    family and animated titles only, and the broadcasters' programmes and live TV are kept out; from 14 it
    is a teenager's, and a title is judged by its rating (data/kids.js). booth.html paints the tier from
    the same table before the page is up. */
export const AGE_LEVELS = {young: 6, kids: 9, older: 12, teen14: 14, teen16: 16, adult18: 18};
export const TEEN_AGE = 14;
/** The age the kids profile is set to (9 when the level is not one there is). */
export const kidsAge = () => AGE_LEVELS[settings.kidsAge] ?? 9;
/** 'off', or the kids profile's tier: 'child' (up to 12), 'teen' (14) or 'teen16' (16 and 18). */
export const kidsTier = () => settings.kids !== 'on' ? 'off' : kidsAge() >= 16 ? 'teen16' : kidsAge() >= TEEN_AGE ? 'teen' : 'child';

/* The subtitles' size belongs to the player, which is also where it is changed from (its panel) - but it
   is the viewer's choice: each profile keeps its own, hands it to the player when the page opens in it,
   and takes back what the player changed whenever the page is shown again. */
const nativeScale = () => { try{ const v = +window.BoothAndroid?.getSubScale?.(); return v > 0 ? v : null; }catch(e){ return null; } };
if(settings.subScale == null && nativeScale()) settings.subScale = nativeScale();
addEventListener('visibilitychange', () => {
  const n = document.visibilityState === 'visible' && nativeScale();
  if(n && n !== settings.subScale){ settings.subScale = n; store.set('settings', settings); }
});
/**
 * The player draws its own banner and channel list in native views: hand it this skin and direction -
 * and the choices it acts on itself: whether subtitles come on by themselves, and whether the kids
 * profile is on (it then opens nothing outside the app: YouTube, a web page, another app).
 */
export function syncNativeTheme(){
  const s = getComputedStyle(document.documentElement), v = n => s.getPropertyValue(n).trim();
  try{
    window.BoothAndroid?.setTheme?.(JSON.stringify({dir: document.documentElement.dir,
      night: v('--night'), raise: v('--raise'), line: v('--line'),
      light: v('--light'), muted: v('--muted'), accent: v('--tungsten'), onAccent: v('--on-accent'),
      subs: settings.subs, kids: settings.kids}));
    if(settings.subScale) window.BoothAndroid?.setSubScale?.(+settings.subScale);
  }catch(e){}
}
export function applySettings(){
  const r = document.documentElement;
  r.dataset.skin = settings.skin; r.dataset.layout = settings.layout; r.dataset.poster = settings.poster; r.dataset.nosrc = settings.nosrc;
  r.dataset.kids = kidsTier();
  setUiLang(settings.uiLang);                       // the strings' own module decides what is a language
  syncNativeTheme();
}
applySettings();

/** Replace every setting at once; the page is repainted by the caller. */
export function setSettings(next){
  settings = pinned({...next, ...deviceOwn()});
  store.set('settings', settings);
  applySettings();
}
/** Change one choice: kept, and applied to the page at once. */
export function setSetting(key, value){
  settings[key] = value;
  store.set('settings', settings);
  if(DEVICE.includes(key)) store.set('device', {...deviceOwn(), [key]: value});
  applySettings();
}
/**
 * Every choice back to what it was on the first day - except the ones a reset must never take away:
 * the language (a reset must not strand anyone in one they cannot read) and the kids profile (a child
 * must not be able to leave it by resetting). Titles and summaries follow the interface language.
 */
export function resetSettings(){
  setSettings({uiLang: settings.uiLang, lang: settings.uiLang === 'he' ? 'he' : 'en', kids: settings.kids, kidsAge: settings.kidsAge});
}
