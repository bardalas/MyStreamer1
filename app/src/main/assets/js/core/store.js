/* What the app keeps on the device, and what it carried over from its old address. */
/* ---------- storage ---------- */
export const store = {
  get(k, d){ try{ const v = localStorage.getItem('booth:'+k); return v ? JSON.parse(v) : d; }catch(e){ return d; } },
  set(k, v){
    try{ localStorage.setItem('booth:'+k, JSON.stringify(v)); }
    catch(e){ store.prune(); try{ localStorage.setItem('booth:'+k, JSON.stringify(v)); }catch(e2){} }
  },
  // big caches are written at most once a second, off the scrolling path
  dirty: {},
  lazy(k, v){ store.dirty[k] = v; clearTimeout(store.timer); store.timer = setTimeout(store.flush, 1000); },
  flush(){ const d = store.dirty; store.dirty = {}; for(const k in d) store.set(k, d[k]); },
  /** Storage is full: drop the rebuildable caches, never the library/progress/settings. */
  prune(){
    for(const k of ['heMeta', 'avail', 'svcMap']) try{ localStorage.removeItem('booth:' + k); }catch(e){}
    for(const k of Object.keys(localStorage)) if(k.startsWith('booth:catx:')) try{ localStorage.removeItem(k); }catch(e){}
  },
};
addEventListener('visibilitychange', () => { if(document.visibilityState === 'hidden') store.flush(); });
addEventListener('pagehide', () => store.flush());
/* A backup is everything the device could not work out again: the choices, the favourites, how far
   each thing was watched, which add-ons are installed. The caches are left out - they are the bulk
   of the storage and they come back by themselves. */
const REBUILDABLE = new Set(['heMeta', 'avail', 'svcMap']);
export function dumpStore(){
  const keys = {};
  for(const k of Object.keys(localStorage)){
    if(!k.startsWith('booth:')) continue;
    const name = k.slice(6);
    if(REBUILDABLE.has(name) || name.startsWith('catx:')) continue;
    keys[name] = localStorage.getItem(k);
  }
  return JSON.stringify({app: 'veo', v: 1, at: Date.now(), keys});
}
/** Put a backup back, as it was written. How many entries were restored, or -1 if that is not one. */
export function loadStore(text){
  let o;
  try{ o = JSON.parse(text); }catch(e){ return -1; }
  if(!o || typeof o !== 'object' || !o.keys || typeof o.keys !== 'object') return -1;
  let n = 0;
  for(const [k, v] of Object.entries(o.keys)){
    if(typeof v !== 'string') continue;
    try{ localStorage.setItem('booth:' + k, v); n++; }catch(e){}
  }
  return n;
}

/** Keep a plain object cache under a size limit (oldest-inserted entries go first). */
export function capMap(obj, max){
  const keys = Object.keys(obj);
  if(keys.length <= max) return obj;
  for(const k of keys.slice(0, keys.length - max)) delete obj[k];
  return obj;
}
