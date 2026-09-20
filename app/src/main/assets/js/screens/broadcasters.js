/* One broadcaster at a time: their own catalogues, inside VEO. */
import {$, esc, lazyBg, showErr} from '../core/dom.js';
import {isTvLayout, rowMax} from '../core/settings.js';
import {store} from '../core/store.js';
import {JFC_LOBBIES, jfcCard, jfcLobby} from '../providers/jfc.js';
import {KAN, kanBox} from '../providers/kan.js';
import {IL_CHANNELS, watchChannel} from '../providers/live.js';
import {viewMakoTab} from '../providers/mako.js';
import {r13, r13channels} from '../providers/reshet.js';
import {renderRows} from '../ui/rows.js';

/* ---------- ערוצים: each broadcaster's own content, separate from films & series ---------- */
export const BC_TABS = [
  {id: 'kan', name: 'כאן 11', color: '#1b9ad6'},
  {id: 'reshet', name: 'רשת 13', color: '#d9262f'},
  {id: 'keshet', name: 'קשת 12', color: '#f29100'},
  {id: 'jfc', name: 'ארכיון הסרטים', color: '#9a6bd8'},
];


export async function viewTv(which){
  const bc = BC_TABS.find(b => b.id === which) || BC_TABS.find(b => b.id === store.get('tvTab', '')) || BC_TABS[0];
  store.set('tvTab', bc.id);
  const tabs = `<div class="page" style="padding-bottom:0"><h1>ערוצים</h1><nav class="bctabs" aria-label="ערוצי שידור">${BC_TABS.map(b =>
    `<a href="#/tv/${b.id}" class="${b.id === bc.id ? 'on' : ''}" style="--bc:${b.color}">${esc(b.name)}</a>`).join('')}</nav>
    <div class="bchead" style="--bc:${bc.color}" id="bchead"></div></div>`;
  let rows = [], note = '', kanSite = false;
  if(bc.id === 'jfc') return viewJfcTab(tabs);
  if(bc.id === 'reshet'){
    rows = [{r13: 'recent', title: 'שודר לאחרונה'}, {r13: 'series', title: 'כל התוכניות'}];
  }else if(bc.id === 'keshet'){
    return viewMakoTab(tabs + `<div class="page" style="padding-top:0"><p class="note" style="margin:0 0 12px">הפרקים מתנגנים בנגן של mako, בתוך האפליקציה.</p></div>`);
  }else{
    try{
      const secs = await kanBox();
      rows = secs.map(sec => ({kan: new RegExp('^' + sec.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$'), title: sec.title}));
    }catch(e){
      // Kan's site sometimes turns the app's requests away (403): offer Kan BOX itself in the in-app window.
      rows = [];
      note = `לא ניתן לטעון את הקטלוג של כאן לתוך האפליקציה (${e.message}).`;
      kanSite = true;
    }
  }
  renderRows(rows, {top: tabs});
  // live button for the broadcaster (Kan 11 and Reshet 13 have official streams)
  const head = $('#bchead');
  head.innerHTML = (note ? `<p class="note">${esc(note)}</p>` : '') +
    (kanSite ? `<button class="btn primary openbtn" data-site="${KAN}/lobby/kan-box/">פתח את כאן BOX בתוך האפליקציה</button>` : '');
  const live = bc.id === 'kan' ? IL_CHANNELS.find(c => c.name === 'Kan 11') : bc.id === 'reshet' ? (await r13channels().catch(() => [])).find(c => c.name === 'רשת 13') : null;
  if(live && head.isConnected){
    head.insertAdjacentHTML('afterbegin', `<button class="livebtn" id="bclive">▶ שידור חי · ${esc(bc.name)}</button>`);
    $('#bclive').onclick = () => watchChannel([live], 0, 'il');
  }
}

/** The archive's tab: pick a lobby, see its rows, open a film on the archive's site. */
export async function viewJfcTab(tabs){
  const path = store.get('jfcLobby', JFC_LOBBIES[0][0]);
  const picker = `<div class="page" style="padding-top:0">
    <div class="ltabs" role="group" aria-label="חלקי הארכיון">${JFC_LOBBIES.map(([u, n]) =>
      `<button class="${u === path ? 'on' : ''}" data-jfc="${esc(u)}">${esc(n)}</button>`).join('')}</div>
    <p class="note" style="margin:10px 0 0">הסרטים מתנגנים באתר הארכיון, בתוך האפליקציה. חלק מהסרטים דורשים חשבון חינם באתר, וחלק בתשלום.</p></div>`;
  $('#app').innerHTML = tabs + picker + `<div id="jfcrows"><p class="note" style="padding:0 28px">טוען מהארכיון…</p></div>`;
  $('#app').querySelectorAll('[data-jfc]').forEach(b => b.onclick = () => { store.set('jfcLobby', b.dataset.jfc); viewJfcTab(tabs); });
  try{
    const rows = await jfcLobby(path);
    const host = $('#jfcrows');
    if(!host) return;
    host.innerHTML = rows.slice(0, isTvLayout() ? 8 : 20).map(r => `<div class="row"><h2><bdi>${esc(r.title)}</bdi></h2>
      <div class="strip">${r.items.slice(0, rowMax()).map(jfcCard).join('')}</div></div>`).join('')
      || '<p class="note" style="padding:0 28px">אין כרגע תכנים בחלק הזה.</p>';
    lazyBg(host);
  }catch(e){ showErr($('#jfcrows'), 'לא ניתן לטעון את ארכיון הסרטים הישראלי', e, () => viewJfcTab(tabs)); }
}
