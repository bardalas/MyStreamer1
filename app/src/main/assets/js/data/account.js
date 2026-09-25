/* The household's account: one sign-in for every television and phone. The backend is VEO's own Supabase project;
   this module speaks to it with plain requests (no library). A television is signed in without typing anything:
   it asks for a pairing code and shows it as a QR; a phone that is signed in approves the code (docs/link/), and
   the television collects the session. See supabase/veo_sync.sql. */
import {store} from '../core/store.js';

export const SUPABASE_URL = 'https://gnlrnsvkupifmsjyyual.supabase.co';
/** The publishable key: meant to be public - what it may do is decided by the rules in the database. */
export const SUPABASE_KEY = 'sb_publishable_cAmKGGFKQLCWw4Xw97J9ig_Yhq6v7JP';
/** The page a phone opens from the QR. */
export const LINK_PAGE = 'https://bardalas.github.io/VEO/link/';

const KEY = 'acct';                       // a device key: the account belongs to the device, not to a profile
const read = () => store.get(KEY, null);
const write = a => store.set(KEY, a);

export const signedIn = () => !!read()?.refresh;
export const accountEmail = () => read()?.email || '';
export const accountId = () => read()?.uid || '';
export function signOut(){ store.set(KEY, null); }

const headers = (token, extra = {}) => ({apikey: SUPABASE_KEY, 'Content-Type': 'application/json',
  Authorization: 'Bearer ' + (token || SUPABASE_KEY), ...extra});

/** A call to the backend: [path] under the project's address; JSON in and out. */
export async function call(path, {method = 'GET', body, token, extra} = {}){
  const r = await fetch(SUPABASE_URL + path, {method, headers: headers(token, extra), body: body === undefined ? undefined : JSON.stringify(body)});
  const text = await r.text();
  let data = null;
  try{ data = text ? JSON.parse(text) : null; }catch(e){ data = text; }
  if(!r.ok) throw Object.assign(new Error((data && (data.message || data.msg || data.error_description)) || ('HTTP ' + r.status)), {status: r.status, data});
  return data;
}

/** A session kept from what the backend returned (a token response). */
function keep(d, fallback = {}){
  const acct = {refresh: d.refresh_token, access: d.access_token, exp: Date.now() + ((d.expires_in || 3600) - 60) * 1000,
    uid: d.user?.id || fallback.uid || read()?.uid || '', email: d.user?.email || fallback.email || read()?.email || ''};
  write(acct);
  return acct;
}
/** A refresh token turned into a session, kept. */
async function exchange(refresh){
  const d = await call('/auth/v1/token?grant_type=refresh_token', {method: 'POST', body: {refresh_token: refresh}});
  return keep(d);
}

let renewing = null;
/** A valid access token, renewed when it is about to end; null when there is no account (or it was ended elsewhere). */
export async function accessToken(){
  const a = read();
  if(!a?.refresh) return null;
  if(a.access && a.exp > Date.now()) return a.access;
  renewing ||= exchange(a.refresh).finally(() => { renewing = null; });
  try{ return (await renewing).access; }
  catch(e){
    if(e.status === 400 || e.status === 401 || e.status === 403) signOut();   // the account was signed out from elsewhere
    return null;
  }
}

/* ---------- signing a television in ---------- */
/** Ask for a pairing code: {code, secret, url} - [url] is what the QR holds. */
export async function pairStart(){
  const d = await call('/rest/v1/rpc/pair_start', {method: 'POST', body: {}});
  const r = Array.isArray(d) ? d[0] : d;
  return {code: r.code, secret: r.secret, url: `${LINK_PAGE}?c=${r.code}`};
}
/**
 * Wait for a phone to approve [pair]. Resolves true when this device has been signed in, false when the code ran
 * out (ten minutes) or [cancelled]() says stop.
 */
export async function pairWait(pair, cancelled = () => false){
  const until = Date.now() + 10 * 60e3;
  while(Date.now() < until && !cancelled()){
    await new Promise(r => setTimeout(r, 3000));
    if(cancelled()) return false;
    let r = null;
    try{ r = await call('/functions/v1/pair-collect', {method: 'POST', body: {code: pair.code, secret: pair.secret}}); }catch(e){ if(e.status === 404) return false; continue; }
    if(r?.refresh_token){ await exchange(r.refresh_token); return true; }   // a session of its own: no other device shares it
  }
  return false;
}

/* ---------- signing in on this device with an email code (a phone; a television has the QR) ---------- */
/** Send a sign-in code to [email]. */
export const otpSend = email => call('/auth/v1/otp', {method: 'POST', body: {email: String(email).trim(), create_user: true}});
/** Check the code; on success this device is signed in. */
export async function otpVerify(email, token){
  const d = await call('/auth/v1/verify', {method: 'POST', body: {type: 'email', email: String(email).trim(), token: String(token).trim()}});
  return keep(d, {email: String(email).trim()});
}

/** This device is signed in: approve another device's pairing code with the account (the other one gets a session of its own). */
export async function approvePairing(code){
  const token = await accessToken();
  if(!token) throw new Error('signed out');
  return call('/rest/v1/rpc/pair_approve_account', {method: 'POST', body: {p_code: code}, token});
}
