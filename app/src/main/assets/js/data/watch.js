/* How far the viewer got in everything they have watched. */
import {store} from '../core/store.js';

/* What the viewer keeps: the titles they saved, and how far they got in everything they played.
   Both are read from the device once, here, and everything else asks this module for them. */
export let library = store.get('library', {});
export let progress = store.get('progress', {});




export let progressIdx = new Map();
/** A title shows the newest thing watched under it (a series: its last episode). */
export function indexProgress(){
  progressIdx = new Map();
  for(const x of Object.values(progress).sort((a, b) => (a.at || 0) - (b.at || 0))) progressIdx.set(x.metaId, x);
}
/** The watch history is kept for the marks on posters, so it needs a limit: the newest 400 videos. */
export function pruneProgress(){
  const ids = Object.keys(progress);
  if(ids.length <= 400) return;
  for(const id of ids.sort((a, b) => (progress[b].at || 0) - (progress[a].at || 0)).slice(400)) delete progress[id];
}
indexProgress();
/** Forget everything watched (Settings): "continue watching" and the marks on posters start from nothing. */
export function clearProgress(){
  for(const id of Object.keys(progress)) delete progress[id];
  store.set('progress', progress);
  indexProgress();
}
