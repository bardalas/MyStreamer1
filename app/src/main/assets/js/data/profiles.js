/* ---------- profiles: who is watching ----------
   Each member of the household has a profile - a name and an avatar - and the profile keeps everything that
   is theirs apart (core/store.js): the settings, among them whether it is a kids profile and to what age;
   what was watched and how far; the favourites and reminders; the tastes learnt (data/taste.js). The list
   of profiles, and which one the device is in, belong to the device.
   A profile may be locked: entering it then asks for the parent code (ui/pin.js), so that a child who can
   pick any profile on the picker cannot walk into a grown-up's. Entering another profile opens the page
   again in it - every module reads its own copy of what the profile keeps as the page opens. */
import {profileId, store} from '../core/store.js';
import {settings} from '../core/settings.js';
import {esc} from '../core/dom.js';
import {tr} from '../i18n.js';

/* The avatars there are: pictures every television draws, with no file to fetch, each on a deep colour of
   its own - the first is the profile's initial. Film and television, music, sport, the world outside,
   animals, things people are, and a few for the youngest. [picture, colour] */
const SHADES = ['#0f2027,#2c5364', '#1e3c72,#2a5298', '#42275a,#734b6d', '#93291e,#d8342a', '#232526,#4a4d52', '#134e5e,#3f8f6a',
  '#b8430b,#e8912d', '#000428,#004e92', '#4b134f,#b3414a', '#0b6e63,#1ea672', '#373b44,#3f6fc6', '#3a1c71,#a8566a'];
export const AVATARS = [
  ['', 7],
  ['🎬', 4], ['🍿', 3], ['🎞️', 8], ['📺', 1],
  ['🎧', 2], ['🎸', 8], ['🎹', 4], ['🎷', 10], ['🥁', 5],
  ['⚽', 9], ['🏀', 6], ['🎾', 5], ['🏎️', 3], ['🏄', 0], ['🚴', 10], ['🥊', 8],
  ['🌊', 1], ['🏔️', 0], ['🌙', 7], ['🔥', 4], ['⚡', 11], ['🌍', 9], ['🚀', 10], ['🌵', 5],
  ['🦁', 6], ['🐺', 4], ['🦅', 0], ['🦈', 7], ['🐉', 9], ['🦉', 8], ['🐯', 3], ['🦊', 11],
  ['🕶️', 2], ['👑', 3], ['💎', 1], ['🎯', 11], ['♟️', 4], ['🧠', 2], ['📚', 5], ['☕', 6], ['🎨', 0], ['🎮', 7],
  ['🦄', 11], ['🐼', 5], ['🐙', 3], ['🧸', 6]];
/** The most profiles a device keeps - a household, and the picker still one row on a television. */
export const MAX_PROFILES = 6;
const NAME_MAX = 20;

const LIST = 'profiles', ACTIVE = 'profile', CHOSEN = 'veo:who';
export const profiles = () => store.get(LIST, []);
/** The profile this page is in. */
export const currentProfile = () => profiles().find(p => p.id === profileId) || profiles()[0] || {id: profileId, name: '', icon: 0};
export const profileById = id => profiles().find(p => p.id === id);
export const profileName = p => p?.name || tr('prof.me');
/** A profile's avatar, on its colour - the first of them is the initial of its name. */
export function avatar(p, cls = ''){
  const [pic, own] = AVATARS[(p?.icon || 0) % AVATARS.length];
  const letter = (profileName(p).trim()[0] || '?').toUpperCase();
  const face = pic || esc(letter);
  const shade = pic ? own : letter.charCodeAt(0) % SHADES.length;   // an initial takes its colour from the name
  return `<span class="avatar${pic ? '' : ' initial'}${cls ? ' ' + cls : ''}" style="--av:linear-gradient(135deg,${SHADES[shade]})" aria-hidden="true">${face}</span>`;
}
/** A profile's own settings, read without entering it (the one the page is in: the live ones). */
export const settingsOf = p => p.id === profileId ? settings : store.getFor(p.id, 'settings', {});
export const isKids = p => settingsOf(p).kids === 'on';

function saveList(list){ store.set(LIST, list); }
/** Change [id]'s name, avatar or lock. */
export function updateProfile(id, changes){
  const list = profiles(), p = list.find(x => x.id === id);
  if(!p) return;
  Object.assign(p, changes);
  if('name' in changes) p.name = String(changes.name || '').trim().slice(0, NAME_MAX);
  saveList(list);
}
/** Change another profile's settings (whether it is a kids profile, and to what age). */
export const setSettingsOf = (id, changes) => store.setFor(id, 'settings', {...store.getFor(id, 'settings', {}), ...changes});
/** A new profile: it starts in this one's language and look, with nothing watched yet. */
export function addProfile({name, icon, kids, kidsAge}){
  const list = profiles();
  if(list.length >= MAX_PROFILES) return null;
  let id;                                            // never one there is: two made in the same moment are two
  do id = 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); while(list.some(p => p.id === id));
  const p = {id, name: String(name || '').trim().slice(0, NAME_MAX), icon: icon || 0};
  store.setFor(id, 'settings', {uiLang: settings.uiLang, lang: settings.lang, skin: settings.skin, subScale: settings.subScale,
    kids: kids ? 'on' : 'off', kidsAge: kidsAge || 'kids'});
  saveList([...list, p]);
  return p;
}
/** Remove a profile and everything it kept - never the one the page is in, never the last. */
export function removeProfile(id){
  const list = profiles();
  if(id === profileId || list.length < 2 || !list.some(p => p.id === id)) return false;
  store.dropProfile(id);
  saveList(list.filter(p => p.id !== id));
  return true;
}

/* ---------- choosing ----------
   The picker comes up when the app starts - once a session - whenever there is someone to choose, or the
   profile the device was left in is locked. */
const session = {get: () => { try{ return sessionStorage.getItem(CHOSEN); }catch(e){ return '1'; } },
  set: () => { try{ sessionStorage.setItem(CHOSEN, '1'); }catch(e){} }};
export const chosen = () => !!session.get();
export const needsPicker = () => !chosen() && (profiles().length > 1 || !!currentProfile().lock);
/** [id] is who is watching: the page opens again in that profile (false: it is already in it). */
export function enterProfile(id){
  session.set();
  if(id === profileId) return false;
  store.set(ACTIVE, id);
  store.flush();                                     // what this profile had pending is written to it, not the next
  history.replaceState(null, '', location.pathname);   // no screen of this profile's: the next opens on its own start
  location.reload();
  return true;
}
