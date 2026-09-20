/* A newer version of the app. */
import {$, esc, getJSON} from '../core/dom.js';
import {isTvLayout} from '../core/settings.js';
import {store} from '../core/store.js';
import {tr} from '../i18n.js';
import {card} from './cards.js';

/* ---------- new version ----------
   On every start the app asks GitHub for the latest release. If it is newer than this build, a card
   offers it (just that, no release notes); "עדכן" hands the APK to Android's own downloader and installer, which asks before it
   installs. Nothing is downloaded or installed behind the viewer's back. */
export const RELEASES = 'https://api.github.com/repos/bardalas/VEO/releases/latest';
export const APK_URL = 'https://github.com/bardalas/VEO/releases/latest/download/VEO.apk';
export const APP_VERSION = (() => { try{ return window.BoothAndroid?.appVersion?.() || ''; }catch(e){ return ''; } })();

/** "0.23.0" vs "0.24.1" -> is the second one newer? */
export function isNewer(latest, current){
  const a = String(latest).replace(/^v/, '').split('.').map(Number);
  const b = String(current).replace(/^v/, '').split('.').map(Number);
  for(let i = 0; i < 3; i++){ const x = a[i] || 0, y = b[i] || 0; if(x !== y) return x > y; }
  return false;
}

export async function checkUpdate(force){
  if(!APP_VERSION || !window.BoothAndroid?.openExternal) return;        // only inside the app
  if(document.querySelector('.update')) return;                         // one card at a time
  // a cold start always checks; returning to the foreground re-checks at most twice an hour
  if(!force && Date.now() - (store.get('updCheck', 0) || 0) < 30 * 60e3) return;
  let rel;
  try{ rel = await getJSON(RELEASES, 8000); }catch(e){ return; }
  store.set('updCheck', Date.now());
  const tag = (rel.tag_name || '').replace(/^v/, '');
  if(!tag || !isNewer(tag, APP_VERSION) || store.get('updSkip', '') === tag) return;
  const card = document.createElement('div');
  card.className = 'update';
  card.innerHTML = `<span><b>${tr('update.available', {tag: esc(tag)})}</b></span>
    <span class="btns"><button class="go" id="updGo">${tr('update.now')}</button><button id="updLater">${tr('update.later')}</button></span>`;
  document.body.appendChild(card);
  $('#updGo').onclick = () => {
    card.remove();
    try{ BoothAndroid.updateApp(APK_URL); }         // downloads and installs inside the app
    catch(e){ BoothAndroid.openExternal(APK_URL); } // only builds older than 0.29 land here
  };
  $('#updLater').onclick = () => { store.set('updSkip', tag); card.remove(); };
  if(isTvLayout()) $('#updGo').focus();
}
