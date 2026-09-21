/* The way to the Android app: a page fetched without CORS, a site read in its own window. */
import {fetchTimed} from './dom.js';
import {freshProfiles, store} from './store.js';

export const siteDoc = async url => new DOMParser().parseFromString(await fetchText(url), 'text/html');
export const kanDoc = siteDoc;

/** Read [url] with [reader] (the body of a function of the document, returning JSON). */
export async function sitePull(url, reader){
  const text = window.BoothAndroid?.siteExtract
    ? await new Promise((res, rej) => {
        const id = 's' + Math.random().toString(36).slice(2);
        nativeCallbacks[id] = {res, rej};
        BoothAndroid.siteExtract(url, reader, id);
      })
    : new Function('d', reader)(await siteDoc(url));
  return JSON.parse(text);
}

export const nativeCallbacks = {};
window.boothFetchDone = (id, ok, body) => {
  const cb = nativeCallbacks[id]; delete nativeCallbacks[id];
  if(cb) ok ? cb.res(body) : cb.rej(new Error(body));
};
/** POST [body] to [url] with [headers] - natively where the app runs: an answer the page could not read
    across origins, or a server that wants headers a page may not send. */
export function postText(url, body, headers = {}){
  if(window.BoothAndroid?.postText) return new Promise((res, rej) => {
    const id = 'p' + Math.random().toString(36).slice(2);
    nativeCallbacks[id] = {res, rej};
    BoothAndroid.postText(url, body, JSON.stringify(headers), id);
  });
  return fetchTimed(url, 15000, {method: 'POST', headers, body}).then(r => { if(!r.ok) throw new Error(r.status + ' from ' + new URL(url).host); return r.text(); });
}
export function fetchText(url){
  if(window.BoothAndroid && BoothAndroid.fetchText) return new Promise((res, rej) => {
    const id = 'f' + Math.random().toString(36).slice(2);
    nativeCallbacks[id] = {res, rej};
    BoothAndroid.fetchText(url, id);
  });
  return fetchTimed(url, 15000).then(r => { if(!r.ok) throw new Error(r.status + ' from ' + new URL(url).host); return r.text(); });
}

/**
 * Until 0.37 this page was opened as a file, and what a file keeps belongs to a different address than
 * what a page keeps. The first time it runs at its new address - and only then - the library, the watch
 * history, the settings and the RaspberryTV key are carried over from the old one. It is called from
 * boot(), not from here: what it uses is declared further down the script.
 */
export async function migrateStore(){
  if(!window.BoothAndroid?.siteExtract || store.get('moved', 0) || !freshProfiles) return;
  try{
    const old = await sitePull('file:///android_asset/export.html', 'return JSON.stringify(localStorage)');
    let moved = 0;
    for(const [k, v] of Object.entries(old || {})) if(k.startsWith('booth:') && !localStorage.getItem(k)){
      try{ localStorage.setItem(k, v); moved++; }catch(e){}
    }
    if(moved){ store.set('moved', 1); location.reload(); return true; }
  }catch(e){}                                          // the old page was busy: try again next time
  return false;
}
