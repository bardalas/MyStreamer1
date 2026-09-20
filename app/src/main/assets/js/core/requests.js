/* Async work belongs to the view that started it, including same-route redraws. */
import {tr} from '../i18n.js';

let viewRevision = 0;
export function invalidateView(){ viewRevision++; }
export function guardView(el){
  const revision = viewRevision, hash = location.hash;
  return () => revision === viewRevision && hash === location.hash && el.isConnected;
}

/** Bound a multi-step provider operation as well as its individual network requests.
    This ignores late results; it does not abort the provider's shared/cacheable work. */
export function withDeadline(task, ms = 15000){
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(tr('net.noResponse'))), ms);
  });
  return Promise.race([Promise.resolve().then(task), timeout]).finally(() => clearTimeout(timer));
}
