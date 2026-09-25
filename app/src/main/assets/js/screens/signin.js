/* The sign-in screen: the app is the household's account's - with no account nothing else is shown (no profiles are
   kept on a device by themselves). It comes over the app at launch, and when a phone's app is opened by a television's QR code. A television shows the QR; a phone
   asks for an email and sends a code. A device that is signed in already needs none of it: it approves the television
   with the account it has (data/account.js approvePairing). */
import {$, esc} from '../core/dom.js';
import {isTvLayout} from '../core/settings.js';
import {store} from '../core/store.js';
import {tr} from '../i18n.js';
import {approvePairing, otpSend, otpVerify, pairStart, pairWait, signedIn} from '../data/account.js';
import {firstSync} from '../data/sync.js';
import {loadQr} from '../ui/report.js';

let gate = null;

const STYLE = `#acctgate{position:fixed;inset:0;z-index:9999;display:grid;place-items:center;background:var(--bg,#050a16);padding:24px;overflow:auto}
#acctgate .box{width:100%;max-width:520px;text-align:center}
#acctgate img{display:block;margin:0 auto 12px;width:72px;height:72px}
#acctgate h1{margin:0 0 6px;font-size:26px}
#acctgate p{margin:0 0 10px;color:var(--mute,#8e98b4);font-size:17px;line-height:1.5}
#acctgate input{width:100%;font:inherit;font-size:20px;padding:14px;border-radius:14px;border:1px solid var(--line,#25304d);background:rgba(255,255,255,.06);color:inherit;margin-bottom:12px;text-align:center}
#acctgate .btn{display:block;width:100%;margin:8px 0 0}
#acctgate .repqr{display:inline-block;background:#fff;border-radius:16px;padding:6px;margin:0 0 12px}
#acctgate .repqr svg{display:block;width:180px;height:180px}
#acctgate .say{min-height:1.5em;font-size:16px}`;

const close = () => { gate?.remove(); gate = null; };

/** Signed in on this device just now (or already): take the account's data and read it. */
async function joined(){
  try{ await firstSync(); }catch(e){}
  location.reload();
}

/** Open the sign-in screen. [approve]: a television's pairing code to approve once this device is signed in. */
export async function showSignIn({approve = ''} = {}){
  if(gate) return;
  if(!document.getElementById('acctgate-css')){
    const st = document.createElement('style'); st.id = 'acctgate-css'; st.textContent = STYLE; document.head.appendChild(st);
  }
  gate = document.createElement('div');
  gate.id = 'acctgate';
  const tv = isTvLayout() && !approve;
  gate.innerHTML = `<div class="box" role="dialog" aria-modal="true">
    <img src="veo-mark.png" alt="">
    <h1>${esc(tr(approve ? 'gate.titleTv' : 'gate.title'))}</h1>
    <p>${esc(tr(tv ? 'gate.tvText' : 'gate.phoneText'))}</p>
    ${tv ? '<div class="repqr" id="gqr" hidden></div><p class="say" id="gsay" aria-live="polite"></p>'
      : `<form id="gform"><input id="gemail" type="email" inputmode="email" autocomplete="email" dir="ltr" placeholder="${esc(tr('gate.email'))}" required>
         <input id="gcode" inputmode="numeric" autocomplete="one-time-code" dir="ltr" maxlength="8" placeholder="${esc(tr('gate.code'))}" hidden>
         <button class="btn" id="gsend" type="submit">${esc(tr('gate.send'))}</button></form><p class="say" id="gsay" aria-live="polite"></p>`}
    ${tv ? `<button class="btn ghost" id="gnew" type="button">${esc(tr('gate.newCode'))}</button>` : ''}
  </div>`;
  document.body.appendChild(gate);
  const say = t => { const s = $('#gsay'); if(s) s.textContent = t; };
  if(tv){
    // the remote must not wander to the app under the screen: every key stays here
    $('#gnew').focus();
    $('#gnew').onclick = () => { close(); showSignIn({approve}); };
    let alive = true;
    const stop = () => !alive || !gate;
    try{
      const pair = await pairStart();
      const qr = await loadQr();
      if(qr && gate){
        const code = qr(0, 'M'); code.addData(pair.url); code.make();
        const box = $('#gqr'); box.innerHTML = code.createSvgTag({cellSize: 6, margin: 2}); box.hidden = false;
      }
      say(pair.url.replace(/^https?:\/\//, ''));
      if(await pairWait(pair, stop)) return joined();
      if(gate) say(tr('acct.expired'));
    }catch(e){ if(gate) say(tr('acct.fail')); }
    alive = false;
    return;
  }
  // a phone: an email, then the code that was sent to it
  const email = $('#gemail'), code = $('#gcode'), send = $('#gsend');
  email.focus();
  let sent = false;
  $('#gform').onsubmit = async e => {
    e.preventDefault(); send.disabled = true;
    try{
      if(!sent){
        say(tr('gate.sending')); await otpSend(email.value); sent = true;
        code.hidden = false; email.readOnly = true; send.textContent = tr('gate.confirm'); code.focus(); say('');
      }else{
        say(tr('acct.syncing')); await otpVerify(email.value, code.value);
        if(approve){ try{ await approvePairing(approve); }catch(err){} }
        return joined();
      }
    }catch(err){ say(tr('gate.error') + ' ' + (err.message || '')); }
    send.disabled = false;
  };
}

/** A television's QR opened this app (veo://link?c=CODE): approve it with this account, or sign in first. */
window.boothLink = async code => {
  code = String(code || '').toUpperCase();
  if(!/^[A-Z2-9]{8}$/.test(code)) return;
  if(!signedIn()){ showSignIn({approve: code}); return; }
  const note = document.createElement('div');
  note.style.cssText = 'position:fixed;left:50%;bottom:32px;transform:translateX(-50%);z-index:9999;padding:14px 22px;border-radius:14px;background:#0d1526;color:#e9f0ff;border:1px solid #25304d;font-size:18px';
  note.textContent = tr('gate.approving');
  document.body.appendChild(note);
  try{ await approvePairing(code); note.textContent = tr('gate.approved'); }
  catch(e){ note.textContent = tr('gate.approveFail'); }
  setTimeout(() => note.remove(), 4000);
};

/** The remote's keys belong to the sign-in screen while it is up (Back still leaves the app). */
addEventListener('keydown', e => {
  if(!gate || e.key === 'Escape' || e.key === 'Backspace' || e.keyCode === 4) return;
  if(!gate.contains(document.activeElement)) (gate.querySelector('#gnew') || gate.querySelector('input'))?.focus();
  if(!(e.target instanceof HTMLInputElement) && e.key !== 'Enter') e.stopPropagation();
}, true);

/** At launch: with no account the sign-in screen is the first (and only) thing. */
export const askAtLaunch = () => { if(!signedIn()) showSignIn(); };
