/* Keeping the household's profiles the same on every device that is signed in to the account (data/account.js).
   The pieces synced are the profile list and, for each profile, the keys it keeps (PROFILE_KEYS in core/store.js) -
   one row each, in the profile_data table. Everything else (add-ons, caches, the parent code) belongs to the device.
   The rule is the newest write wins, per piece; the watch history is the exception - it is merged title by title,
   so what was watched on the television and what was watched on the phone both stay. */
import {PROFILE_KEYS, store, profileId} from '../core/store.js';
import {accessToken, accountId, call, signedIn} from './account.js';

const META = 'syncMeta';                        // {pulled: iso time, dirty: {'<profile>/<key>': true}}
const LIST = 'profiles';
const meta = () => store.get(META, {pulled: '1970-01-01T00:00:00Z', dirty: {}});
const saveMeta = m => store.set(META, m);
let applying = false, busy = false;

/** Every write of a synced piece is noted, to be sent at the next push. */
store.watch = (pid, k) => {
  if(applying || !signedIn() || !(PROFILE_KEYS.has(k) || k === LIST)) return;
  const m = meta();
  m.dirty[(k === LIST ? '' : pid) + '/' + k] = true;
  saveMeta(m);
  schedule();
};
let timer = 0;
const schedule = () => { clearTimeout(timer); timer = setTimeout(() => sync().catch(() => {}), 8000); };

/** The progress of two devices, joined: for each video the later of the two entries. */
const mergeProgress = (a = {}, b = {}) => {
  const out = {...a};
  for(const [id, x] of Object.entries(b)) if(!out[id] || (x.at || 0) > (out[id].at || 0)) out[id] = x;
  return out;
};

async function rest(path, opts){
  const token = await accessToken();
  if(!token) throw new Error('signed out');
  return call('/rest/v1/' + path, {...opts, token});
}

/** Send what changed here. */
async function push(){
  const m = meta(), uid = accountId();
  const names = Object.keys(m.dirty);
  if(!names.length || !uid) return 0;
  const now = new Date().toISOString();
  const rows = [], profs = [];
  for(const n of names){
    const [pid, ...rest] = n.split('/'), key = rest.join('/');
    if(key === LIST){
      for(const p of store.get(LIST, [])) profs.push({account_id: uid, id: p.id, data: p, deleted: false, updated_at: now});
    }else rows.push({account_id: uid, profile_id: pid, key, value: store.getFor(pid, key, null), updated_at: now});
  }
  const up = {method: 'POST', extra: {Prefer: 'resolution=merge-duplicates,return=minimal'}};
  if(profs.length) await rest('profiles?on_conflict=account_id,id', {...up, body: profs});
  if(rows.length) await rest('profile_data?on_conflict=account_id,profile_id,key', {...up, body: rows});
  const after = meta();
  for(const n of names) delete after.dirty[n];
  saveMeta(after);
  return rows.length + profs.length;
}

/** Take what changed elsewhere. Returns whether anything of the profile in use changed (the page then reads it again). */
async function pull(){
  const m = meta(), since = encodeURIComponent(m.pulled);
  const started = new Date().toISOString();
  const [profs, data] = await Promise.all([
    rest(`profiles?select=id,data,deleted,updated_at&updated_at=gt.${since}`),
    rest(`profile_data?select=profile_id,key,value,updated_at&updated_at=gt.${since}`)]);
  let changedHere = false;
  applying = true;
  try{
    if(profs?.length){
      const list = store.get(LIST, []);
      for(const r of profs){
        const i = list.findIndex(p => p.id === r.id);
        if(r.deleted){ if(i >= 0) list.splice(i, 1); continue; }
        if(i >= 0) list[i] = {...list[i], ...r.data}; else list.push(r.data);
      }
      // a device that was never used holds one empty profile of its own: the account's profiles replace it
      store.set(LIST, list);
      changedHere = true;
    }
    for(const r of data || []){
      if(!PROFILE_KEYS.has(r.key)) continue;
      const mine = meta().dirty[r.profile_id + '/' + r.key];
      let v = r.value;
      if(r.key === 'progress') v = mergeProgress(store.getFor(r.profile_id, 'progress', {}), v || {});
      else if(mine) continue;                                     // changed here since: it is sent, and wins
      store.setFor(r.profile_id, r.key, v);
      if(r.profile_id === profileId) changedHere = true;
    }
  }finally{ applying = false; }
  const after = meta(); after.pulled = started; saveMeta(after);
  return changedHere;
}

/** One round: take, then send. Safe to call at any time; one runs at once. */
export async function sync(){
  if(!signedIn() || busy) return {changed: false};
  busy = true;
  try{
    const changed = await pull();
    await push();
    return {changed};
  }finally{ busy = false; }
}

/** The account has just been joined by this device: it sends everything it has, and takes what the account has. */
export async function firstSync(){
  const m = meta();
  m.pulled = '1970-01-01T00:00:00Z';
  // whatever this device holds is the first thing to send - unless the account already has profiles, when the account is
  // the household and a device that was never used adopts it
  const remote = await rest('profiles?select=id&limit=1');
  const mine = store.get(LIST, []);
  const untouched = mine.length <= 1 && !mine[0]?.name && !Object.keys(store.getFor(mine[0]?.id, 'progress', {})).length
    && !Object.keys(store.getFor(mine[0]?.id, 'library', {})).length;
  if(remote?.length && untouched){ applying = true; try{ store.set(LIST, []); }finally{ applying = false; } m.dirty = {}; }
  else{
    m.dirty = {};
    m.dirty['/' + LIST] = true;
    for(const p of store.get(LIST, [])) for(const k of PROFILE_KEYS) if(store.getFor(p.id, k, undefined) !== undefined) m.dirty[p.id + '/' + k] = true;
  }
  saveMeta(m);
  return sync();
}
