/* What the torrent engine is doing, in words. */
import {STRINGS, tr} from '../i18n.js';
import {tvFocus} from './tvnav.js';

/** The engine reports JSON phases, and a failure as "e:<code>"; the words, and the language, are the page's.
    (Anything else - the updater's messages - is already words, and is shown as it is.) */
export function torrentText(raw, isError){
  if(isError && /^e:\w+$/.test(raw || '')) return {msg: tr(STRINGS_HAVE('tor.err.' + raw.slice(2)) ? 'tor.err.' + raw.slice(2) : 'tor.err.other'), frac: null};
  if(!raw || raw[0] !== '{') return {msg: raw, frac: null};
  const o = JSON.parse(raw), mb = b => (b / 1048576).toFixed(1);
  if(o.p === 'start') return {msg: tr('tor.start'), frac: null};
  if(o.p === 'dht') return {msg: tr('tor.dht', o), frac: null};
  if(o.p === 'meta') return {msg: tr('tor.meta'), frac: null};
  // a jump lands where nothing has been downloaded yet: the pieces there are being asked for now
  if(o.p === 'seek') return {msg: `${tr('tor.seek')} · ${tr('tor.stats', o)}`, frac: null};
  if(!o.peers) return {msg: tr('tor.peers'), frac: null};
  return {msg: `${tr('tor.buffer', {got: mb(o.got), need: mb(o.need)})} · ${tr('tor.stats', o)}`, frac: o.need ? Math.min(1, o.got / o.need) : null};
}
const STRINGS_HAVE = key => key in STRINGS.he;
export let tstatTimer = 0;
window.boothTorrentStatus = (raw, isError) => {
  const bar = document.getElementById('tstatus'), btn = document.getElementById('tstatusBtn');
  const {msg, frac} = torrentText(raw, isError);
  clearTimeout(tstatTimer);
  if(!msg){ bar.style.display = 'none'; delete bar.dataset.held; return; }
  const paint = () => {
    document.getElementById('tstatusMsg').textContent = msg;
    const track = document.getElementById('tbar');
    track.hidden = frac == null;
    if(frac != null) document.getElementById('tbarFill').style.width = (frac * 100).toFixed(0) + '%';
    bar.classList.toggle('bad', !!isError);
    btn.textContent = isError ? tr('common.close') : tr('common.cancel');
    btn.onclick = () => { if (!isError && window.BoothAndroid) BoothAndroid.cancelTorrent(); bar.style.display = 'none'; delete bar.dataset.held; tvFocus(); };
  };
  const show = () => { paint(); bar.style.display = 'flex'; if(!bar.dataset.held || isError){ btn.focus(); bar.dataset.held = 1; } };
  // a wait shorter than a second needs no announcement; a failure always does
  if(bar.style.display === 'flex' || isError) show(); else tstatTimer = setTimeout(show, 900);
};
