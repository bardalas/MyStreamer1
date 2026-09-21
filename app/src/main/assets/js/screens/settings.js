/* Settings. */
import {route} from '../app.js';
import {fetchText} from '../core/bridge.js';
import {$, esc} from '../core/dom.js';
import {SKINS, isTvLayout, resetSettings, setSetting, settings} from '../core/settings.js';
import {store} from '../core/store.js';
import {addons} from '../data/addons.js';
import {CATEGORIES, catName} from '../data/catalogs.js';
import {checkPin, failSum, grownUpSum, kidsOn, pinLockedFor, setPin} from '../data/kids.js';
import {clearProgress} from '../data/watch.js';
import {UI_LANGS, tr} from '../i18n.js';
import {parseM3U, playlistCache, playlists, setPlaylists} from '../providers/live.js';
import {forgetRtv} from '../providers/rtv.js';
import {askCode, openRtvKey, pickFrom} from '../ui/sheets.js';
import {QUALITIES, prefQ, setPrefQ} from '../ui/sources.js';
import {APP_VERSION, checkUpdate} from '../ui/update.js';

/* ---------- Settings: a menu of subjects, and the page of the one chosen ----------
   Every setting is one line: what it is, a few words on what it does, and what it is set to. A choice
   of two changes as it is pressed; a longer one opens its list. Nothing is more than two moves away
   with the remote, and after any change the remote is where it was. Actions that cannot be undone ask
   for a second press. In the kids profile the only page is the one that leaves it. */
export const SETTINGS_TABS = ['general', 'watch', 'home', 'look', 'live', 'kids', 'about'];
/** Addresses written before the pages were regrouped. */
const RENAMED = {start: 'general', addons: 'watch'};
const icon = body => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const ICONS = {
  general: icon('<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.4 2.3 3.5 5.2 3.5 8.5s-1.1 6.2-3.5 8.5c-2.4-2.3-3.5-5.2-3.5-8.5s1.1-6.2 3.5-8.5z"/>'),
  watch: icon('<rect x="2.5" y="4.5" width="19" height="15" rx="2"/><path d="M10 9.2v5.6l4.7-2.8z"/>'),
  home: icon('<path d="M3.5 11 12 4l8.5 7"/><path d="M5.5 9.5V20h13V9.5"/>'),
  look: icon('<path d="M12 3.5s6 6.2 6 10.5a6 6 0 0 1-12 0c0-4.3 6-10.5 6-10.5z"/>'),
  live: icon('<circle cx="12" cy="12" r="2.2"/><path d="M8.3 8.3a5.3 5.3 0 0 0 0 7.4M15.7 15.7a5.3 5.3 0 0 0 0-7.4M5.4 5.4a9.3 9.3 0 0 0 0 13.2M18.6 18.6a9.3 9.3 0 0 0 0-13.2"/>'),
  kids: icon('<circle cx="12" cy="12" r="8.5"/><path d="M8.5 14a4.2 4.2 0 0 0 7 0M9.2 9.6h.01M14.8 9.6h.01"/>'),
  about: icon('<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.6h.01"/>'),
};
export let setTab = 'general';
/** The pages there are: in the kids profile, only the one that leaves it. */
const tabsNow = () => kidsOn() ? ['kids'] : SETTINGS_TABS;

export function viewSettings(tab){
  tab = RENAMED[tab] || tab;
  const tabs = tabsNow();
  setTab = tabs.includes(tab) ? tab : tabs.includes(setTab) ? setTab : tabs[0];
  $('#app').innerHTML = `<div class="page setpage"><h1>${tr('set.title')}</h1>
    <div class="sgrid">
      <nav class="stabs" role="tablist" aria-label="${esc(tr('set.tabsAria'))}">${tabs.map(id =>
        `<button role="tab" data-tab="${id}" class="${setTab === id ? 'on' : ''}" aria-selected="${setTab === id}">${ICONS[id]}<span>${tr('set.tab.' + id)}</span></button>`).join('')}</nav>
      <div class="spane" id="spane" role="tabpanel"></div>
    </div></div>`;
  $('.stabs').querySelectorAll('[data-tab]').forEach(b => b.onclick = () => {
    if(setTab === b.dataset.tab) return;
    setTab = b.dataset.tab;
    $('.stabs').querySelectorAll('[data-tab]').forEach(x => {
      x.classList.toggle('on', x.dataset.tab === setTab);
      x.setAttribute('aria-selected', x.dataset.tab === setTab);
    });
    history.replaceState(null, '', '#/settings/' + setTab);   // the page is in the address: coming back finds it
    paintSettings();
  });
  paintSettings();
  // arriving with nothing in hand (Back from the add-ons, say): the remote starts on the page's own entry
  if(isTvLayout() && (!document.activeElement || document.activeElement === document.body)) $('.stabs .on')?.focus();
}

/* ---------- the parts of a page ---------- */
/** One setting on one line: its name and a few words on it at the start, what it is set to at the end. */
function line({fid, label, note = '', value = '', sw, href, danger, attrs = ''}){
  const tag = href ? 'a' : 'button';
  return `<${tag} class="sline${danger ? ' warn' : ''}" data-fid="${esc(fid)}"${href ? ` href="${href}"` : ''}${sw != null ? ` role="switch" aria-checked="${sw}"` : ''} ${attrs}>
    <span class="st"><b>${label}</b>${note ? `<small>${note}</small>` : ''}</span>
    <span class="sv">${sw != null ? `<i class="sw${sw ? ' on' : ''}" aria-hidden="true"></i>` : ''}<span>${esc(value)}</span></span></${tag}>`;
}
/** A line that only says something: nothing to press. */
const info = (label, value) => `<div class="sline info"><span class="st"><b>${label}</b></span><span class="sv"><span>${esc(value)}</span></span></div>`;
/** A part of a page: a quiet heading, an optional word on it, and its lines. */
const section = (title, body, note = '') => `<section class="sset">${title ? `<h2>${esc(title)}</h2>` : ''}${note ? `<p class="snote">${note}</p>` : ''}${body}</section>`;
const lines = body => `<div class="slines">${body}</div>`;

/* ---------- the choices ----------
   Each with its values and their words. Most live in the settings; the quality is the title page's own
   choice (ui/sources.js), and the subtitles' size belongs to the player, which keeps it itself. */
const SUB_SIZES = [['1', '100%'], ['1.25', '125%'], ['1.5', '150%'], ['1.8', '180%']];
const subScale = () => { try{ return +window.BoothAndroid.getSubScale(); }catch(e){ return 1.25; } };
const setSubScale = v => { try{ window.BoothAndroid.setSubScale(+v); }catch(e){} };
const PREFS = {
  uiLang: {title: 'set.uilang.title', note: 'set.uilang.note', opts: () => UI_LANGS},
  lang: {title: 'set.lang.title', note: 'set.lang.note', opts: () => [['he', tr('set.lang.he')], ['en', tr('set.lang.en')]]},
  start: {title: 'set.start.title', note: 'set.start.note', opts: () => [['vod', tr('set.start.home')], ['movies', tr('nav.movies')],
    ['series', tr('nav.series')], ['live', tr('nav.live')], ['lastch', tr('set.start.lastch')]]},
  quality: {title: 'set.q.title', note: 'set.q.note', opts: () => [['', tr('set.q.auto')], ...QUALITIES.map(q => [q, q])],
    get: () => prefQ, set: setPrefQ},
  cap: {title: 'set.cap.title', note: 'set.cap.note', opts: () => [['all', tr('set.cap.all')], ['no4k', tr('set.cap.no4k')], ['nohevc', tr('set.cap.nohevc')]]},
  preview: {title: 'set.preview.title', note: 'set.preview.note', opts: () => [['on', tr('set.preview.on')], ['quiet', tr('set.preview.quiet')], ['off', tr('set.preview.off')]]},
  subs: {title: 'set.subs.title', note: 'set.subs.note', opts: () => [['auto', tr('set.subs.auto')], ['off', tr('set.subs.off')]], sw: 'auto'},
  // the player steps the size in tenths: the line says the size it really is, the list marks the nearest
  subsize: {title: 'set.subsize.title', note: 'set.subsize.note', opts: () => SUB_SIZES,
    get: () => SUB_SIZES.reduce((a, b) => Math.abs(b[0] - subScale()) < Math.abs(a[0] - subScale()) ? b : a)[0],
    say: () => Math.round(subScale() * 100) + '%', exact: v => Math.abs(subScale() - v) < .01, set: setSubScale},
  nosrc: {title: 'set.nosrc.title', note: 'set.nosrc.note', opts: () => [['grey', tr('set.nosrc.grey')], ['hide', tr('set.nosrc.hide')]]},
};
const prefNow = k => PREFS[k].get ? PREFS[k].get() : settings[k];
function prefPut(k, v){
  if(PREFS[k].set) PREFS[k].set(v);
  else setSetting(k, v);
}
/** A choice as a line. A choice between on and off is a switch. */
function pref(k){
  const p = PREFS[k], opts = p.opts(), now = prefNow(k);
  const cur = opts.find(([v]) => v === now) || opts[0];
  return line({fid: 'p:' + k, label: tr(p.title), note: tr(p.note), value: p.say ? p.say() : cur[1], sw: p.sw ? now === p.sw : undefined, attrs: `data-p="${k}"`});
}
/** Pressing a choice: the other one of two, or the list of more. */
async function choose(k){
  const p = PREFS[k], opts = p.opts(), now = prefNow(k);
  const next = opts.length === 2 ? opts.find(([v]) => v !== now)[0] : await pickFrom(tr(p.title), opts, now);
  if(next == null || (next === now && (!p.exact || p.exact(+next)))) return paintSettings('p:' + k);
  prefPut(k, next);
  if(k === 'uiLang'){ route(); $('[data-fid="p:uiLang"]')?.focus(); return; }   // every word changes: the whole screen again
  paintSettings('p:' + k);
}

/* ---------- the pages ---------- */
function categories(){
  const hidden = new Set(settings.hiddenCats || []);
  const order = orderedCats();
  return order.map((c, i) => `<div class="catline">${line({fid: 'cat:' + c.id, label: esc(catName(c)), sw: !hidden.has(c.id),
      value: tr(hidden.has(c.id) ? 'set.home.hidden' : 'set.home.shown'), attrs: `data-cat="${c.id}"`})}
    <button class="mv" data-fid="cat:${c.id}:up" data-mv="${i}" data-d="-1" aria-label="${esc(tr('set.home.up'))}"${i ? '' : ' disabled'}>▲</button>
    <button class="mv" data-fid="cat:${c.id}:down" data-mv="${i}" data-d="1" aria-label="${esc(tr('set.home.down'))}"${i < order.length - 1 ? '' : ' disabled'}>▼</button></div>`).join('');
}
const orderedCats = () => [...(settings.cats || []), ...CATEGORIES.map(c => c.id).filter(id => !(settings.cats || []).includes(id))]
  .map(id => CATEGORIES.find(c => c.id === id)).filter(Boolean);
const themeCard = o => `<button class="theme${settings.skin === o.id ? ' on' : ''}" data-fid="skin:${o.id}" data-skin="${o.id}" aria-pressed="${settings.skin === o.id}">
  <span class="swatch" style="background:${o.c[0]}" aria-hidden="true"><i style="background:${o.c[1]}"></i><i style="background:${o.c[2]}"></i><b style="color:${o.c[3]}">Aa</b></span>
  <span class="tn"><b>${tr(`skin.${o.id}.name`)}</b><small>${tr(`skin.${o.id}.note`)}</small></span></button>`;
const hostOf = u => { try{ return new URL(u).host; }catch(e){ return u; } };
/** What the update check found, said on its line (in whatever language is on then); none until it is pressed. */
let updKey = '';
const UPD_SAYS = {found: 'set.about.found', offline: 'set.about.offline', unsupported: 'set.about.unsupported', busy: ''};

const PANES = {
  general: () => section('', lines(pref('uiLang') + pref('lang') + pref('start'))),
  watch: () => section(tr('set.sec.play'), lines(pref('quality') + pref('cap') + pref('preview')))
    + section(tr('set.sec.subs'), lines(pref('subs') + (window.BoothAndroid?.setSubScale ? pref('subsize') : '')))
    + section(tr('set.sec.sources'), lines(line({fid: 'addons', href: '#/addons', label: tr('set.addons.title'), note: tr('set.addons.note'),
      value: tr('set.addons.count', {n: addons.length})}))),
  home: () => section(tr('set.home.title'), `<div class="catorder">${categories()}</div>`, tr('set.home.note'))
    + section('', lines(pref('nosrc'))),
  look: () => section(tr('set.skin.title'), `<div class="themes">${SKINS.map(themeCard).join('')}</div>`),
  live: () => {
    const rtv = store.get('rtvKey', '');
    return section('RaspberryTV', lines(rtv
        ? line({fid: 'rtv', href: '#/live', label: tr('set.rtv.on'), note: tr('set.rtv.onNote'), value: `${rtv.slice(0, 2)}••••••`})
          + line({fid: 'rtvClear', label: tr('set.rtv.clear'), value: tr('set.rtv.clearBtn'), danger: true, attrs: 'data-act="rtvClear"'})
        : line({fid: 'rtvSet', label: tr('set.rtv.enter'), note: tr('set.rtv.help'), attrs: 'data-act="rtvSet"'})))
      + section(tr('set.pl.title'), (playlists.length ? lines(playlists.map(p => line({fid: 'pl:' + p.url, label: esc(p.name),
          note: `<bdi dir="ltr">${esc(hostOf(p.url))}</bdi>`, value: tr('common.remove'), danger: true, attrs: `data-plrm="${esc(p.url)}"`})).join('')) : '')
        + `<form class="addpl" id="plf"><input class="field" id="pln" placeholder="${esc(tr('set.pl.name'))}" aria-label="${esc(tr('set.pl.nameAria'))}">
          <input class="field" id="plu" placeholder="http://192.168.1.50:9981/playlist/channels.m3u" aria-label="${esc(tr('set.pl.urlAria'))}" dir="ltr">
          <button class="btn primary" data-fid="pladd">${tr('common.add')}</button></form><p class="snote" id="plmsg" role="status"></p>`, tr('set.pl.hint'));
  },
  kids: () => kidsOn()
    ? section(tr('kids.title'), lines(line({fid: 'kidsOff', label: tr('kids.turnOff'), note: tr('kids.turnOffNote'), attrs: 'data-act="kidsOff"'})
        + line({fid: 'kidsPin', label: tr('kids.change'), note: tr('kids.changeNote'), attrs: 'data-act="kidsPin"'})), tr('kids.onNote'))
    : section(tr('kids.title'), `<ul class="kidlist">${['what1', 'what2', 'what3'].map(k => `<li>${tr('kids.' + k)}</li>`).join('')}</ul>`
        + lines(line({fid: 'kidsOn', label: tr('kids.turnOn'), note: tr('kids.turnOnNote'), attrs: 'data-act="kidsOn"'}))),
  about: () => section(tr('set.about.title'), lines(info('VEO', APP_VERSION ? tr('set.about.ver', {v: APP_VERSION}) : tr('set.about.browser'))
      + line({fid: 'upd', label: tr('set.about.check'), note: tr('set.about.checkNote'), value: updKey ? tr(updKey) : '', attrs: 'data-act="upd"'})))
    + section(tr('set.sec.data'), lines(line({fid: 'hist', label: tr('set.hist.title'), note: tr('set.hist.note'), value: tr('set.hist.btn'), danger: true, attrs: 'data-act="hist"'})
      + line({fid: 'reset', label: tr('set.reset.title'), note: tr('set.reset.note'), value: tr('set.reset.btn'), danger: true, attrs: 'data-act="reset"'}))),
};

/**
 * Draw the chosen page into the pane. The remote stays where it was: every control carries a name
 * (data-fid) that survives the drawing, so the same control is found again - [keep] names another one
 * (the button of a row that moved, say). With no control left to stand on, the page's own entry in the
 * menu is where it lands.
 */
export function paintSettings(keep){
  const pane = $('#spane');
  if(!pane) return;
  const a = document.activeElement;
  const fid = keep ?? (pane.contains(a) ? a.dataset.fid : null);
  pane.innerHTML = (PANES[setTab] || PANES.general)();
  wire(pane);
  if(!fid) return;
  const el = pane.querySelector(`[data-fid="${CSS.escape(fid)}"]`);
  const row = fid.startsWith('cat:') && pane.querySelector(`[data-fid="${CSS.escape(fid.split(':').slice(0, 2).join(':'))}"]`);
  (el && !el.disabled ? el : row || $('.stabs .on'))?.focus();
}

/** An action that cannot be undone asks for a second press, within a few seconds. */
function confirmed(b){
  if(b.classList.contains('arm')) return true;
  b.classList.add('arm');
  const say = b.querySelector('.sv span'), was = say.textContent;
  say.textContent = tr('set.confirm');
  clearTimeout(b.armTimer);
  b.armTimer = setTimeout(() => { if(b.isConnected && b.classList.contains('arm')){ b.classList.remove('arm'); say.textContent = was; } }, 4000);
  return false;
}

/* ---------- the kids profile's code ---------- */
const lockedSays = () => { const m = Math.ceil(pinLockedFor() / 60e3); return m ? tr('kids.pin.locked', {m}) : ''; };
/** A new code, typed twice. */
async function choosePin(){
  const a = await askCode({title: tr('kids.pin.new'), note: tr('kids.pin.newNote'), mask: true, ok: tr('common.ok')});
  if(!a) return false;
  const b = await askCode({title: tr('kids.pin.again'), mask: true, ok: tr('common.ok'), check: p => p === a || tr('kids.pin.mismatch')});
  if(!b) return false;
  setPin(a);
  return true;
}
/** The code - or, for a parent who forgot it, a grown-up's sum. */
async function askPin(title){
  const r = await askCode({title, mask: true, ok: tr('common.ok'), note: lockedSays(), check: p => checkPin(p) || lockedSays() || tr('kids.pin.wrong'),
    extra: {label: tr('kids.pin.forgot'), value: 'forgot'}});
  if(r !== 'forgot') return !!r;
  const {q, a} = grownUpSum();
  return !!await askCode({title: tr('kids.sum.title'), note: lockedSays() || tr('kids.sum.note', {q: `<bdi dir="ltr">${q}</bdi>`}), len: a.length, ok: tr('common.ok'),
    check: v => { if(pinLockedFor()) return lockedSays(); if(v === a) return true; failSum(); return lockedSays(); }});
}

const ACTS = {
  rtvSet: () => openRtvKey(() => paintSettings('rtv')),
  rtvClear: () => { store.set('rtvKey', ''); forgetRtv(); paintSettings('rtvSet'); },
  upd: async b => {
    store.set('updSkip', '');
    b.querySelector('.sv span').textContent = tr('set.about.checking');
    const found = await checkUpdate(true);
    updKey = UPD_SAYS[found] ?? 'set.about.latest';
    if(b.isConnected) b.querySelector('.sv span').textContent = updKey ? tr(updKey) : '';
  },
  hist: b => { clearProgress(); b.querySelector('.sv span').textContent = tr('set.hist.done'); },
  // every choice back - the ones kept outside the settings too: the quality, and the subtitles' size the player keeps
  reset: () => { resetSettings(); setPrefQ(''); setSubScale(1.25); paintSettings('reset'); },
  kidsOn: async () => {
    if(!await choosePin()) return paintSettings('kidsOn');
    setSetting('kids', 'on');
    document.querySelectorAll('.update').forEach(c => c.remove());   // nothing on screen offers a way out of it
    location.hash = '#/';                            // the profile starts where a child starts: home
  },
  kidsOff: async () => {
    if(!await askPin(tr('kids.pin.enter'))) return paintSettings('kidsOff');
    setSetting('kids', 'off');
    viewSettings('kids');
    $('[data-fid="kidsOn"]')?.focus();
  },
  kidsPin: async () => {
    const ok = await askPin(tr('kids.pin.current')) && await choosePin();
    paintSettings('kidsPin');
    if(ok) $('[data-fid="kidsPin"] .sv span').textContent = tr('kids.pin.changed');
  },
};

function wire(pane){
  pane.querySelectorAll('[data-p]').forEach(b => b.onclick = () => choose(b.dataset.p));
  pane.querySelectorAll('[data-act]').forEach(b => b.onclick = () => {
    if(b.classList.contains('warn')){
      if(!confirmed(b)) return;
      b.classList.remove('arm');
      clearTimeout(b.armTimer);
    }
    ACTS[b.dataset.act](b);
  });
  pane.querySelectorAll('[data-skin]').forEach(b => b.onclick = () => { setSetting('skin', b.dataset.skin); paintSettings(); });
  pane.querySelectorAll('[data-cat]').forEach(b => b.onclick = () => {
    const h = new Set(settings.hiddenCats || []);
    h.has(b.dataset.cat) ? h.delete(b.dataset.cat) : h.add(b.dataset.cat);
    setSetting('hiddenCats', [...h]);
    paintSettings();
  });
  pane.querySelectorAll('[data-mv]').forEach(b => b.onclick = () => {
    const ids = orderedCats().map(c => c.id), i = +b.dataset.mv, j = i + +b.dataset.d;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    setSetting('cats', ids);
    paintSettings();                                 // the same button, on the row where it now is
  });
  pane.querySelectorAll('[data-plrm]').forEach(b => b.onclick = () => {
    if(!confirmed(b)) return;
    setPlaylists(playlists.filter(p => p.url !== b.dataset.plrm));
    paintSettings('pladd');
  });
  const form = $('#plf');
  if(form) form.onsubmit = async e => {
    e.preventDefault();
    const url = $('#plu').value.trim(), name = $('#pln').value.trim() || tr('set.pl.default');
    const msg = $('#plmsg');
    // busy, not disabled: a disabled button loses the remote's focus, and the viewer is standing on it
    if(!url || form.dataset.busy) return;
    form.dataset.busy = '1'; msg.className = 'snote'; msg.textContent = tr('common.loading');
    try{
      const chans = parseM3U(await fetchText(url));
      if(!chans.length) throw new Error(tr('set.pl.empty'));
      playlistCache[url] = chans;
      setPlaylists(playlists.filter(p => p.url !== url).concat({name, url}));
      if(setTab !== 'live' || !form.isConnected) return;   // kept; the viewer has moved on to another page
      paintSettings('pladd');
      const said = $('#plmsg');
      if(said) said.textContent = tr('set.pl.added', {name, n: chans.length});
    }catch(err){
      delete form.dataset.busy;
      if(!msg.isConnected) return;
      msg.className = 'snote err'; msg.textContent = tr('set.pl.failed', {err: err.message});
    }
  };
}
