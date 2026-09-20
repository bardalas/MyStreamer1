/* Settings. */
import {route} from '../app.js';
import {fetchText} from '../core/bridge.js';
import {$, esc} from '../core/dom.js';
import {LAYOUTS, POSTER_SIZES, SKINS, applySettings, isTv, setSettings, settings} from '../core/settings.js';
import {store} from '../core/store.js';
import {addons} from '../data/addons.js';
import {CATEGORIES, catName} from '../data/catalogs.js';
import {UI_LANGS, tr} from '../i18n.js';
import {parseM3U, playlistCache, playlists, setPlaylists} from '../providers/live.js';
import {forgetRtv, loadRtv, openRtvKey, rtvArchiveTemplate} from '../providers/rtv.js';
import {APP_VERSION, checkUpdate} from '../ui/update.js';

/* Settings: one page per subject, chosen from the menu on the side. Nothing is more than
   two moves away with the remote, and every screen fits without scrolling. */
export const SETTINGS_TABS = ['start', 'look', 'home', 'live', 'addons', 'about'];
export let setTab = 'start';

export function viewSettings(tab){
  setTab = SETTINGS_TABS.includes(tab) ? tab : setTab;
  $('#app').innerHTML = `<div class="page"><h1>${tr('set.title')}</h1>
    <div class="sgrid">
      <nav class="stabs" role="tablist" aria-label="${esc(tr('set.tabsAria'))}">${SETTINGS_TABS.map(id =>
        `<button role="tab" data-tab="${id}" class="${setTab === id ? 'on' : ''}" aria-selected="${setTab === id}">${tr('set.tab.' + id)}</button>`).join('')}</nav>
      <div class="spane" id="spane" role="tabpanel"></div>
    </div></div>`;
  $('.stabs').querySelectorAll('[data-tab]').forEach(b => b.onclick = () => {
    if(setTab === b.dataset.tab) return;
    setTab = b.dataset.tab;
    $('.stabs').querySelectorAll('[data-tab]').forEach(x => {
      x.classList.toggle('on', x.dataset.tab === setTab);
      x.setAttribute('aria-selected', x.dataset.tab === setTab);
    });
    paintSettings();
  });
  paintSettings();
}

/** Draw the chosen subject into the pane (the menu keeps its focus). */
export function paintSettings(){
  const pane = $('#spane');
  if(!pane) return;
  const a = document.activeElement;
  const focusKey = a?.dataset?.g ? `[data-g="${a.dataset.g}"][data-v="${a.dataset.v}"]` : null;
  // One line per choice, saying what it is set to; pressing it takes the next value there is. A
  // remote then needs one press per change, and the page never hides what is chosen behind a row of
  // pills that all look alike.
  const seg = (g, label, opts, note = '') => {
    const i = Math.max(0, opts.findIndex(([v]) => v === settings[g]));
    const next = opts[(i + 1) % opts.length][0];
    return `<section class="sset"><button class="tact" data-g="${g}" data-v="${esc(next)}">${label}
      <span class="sub">${opts[i][1]}</span></button>
      ${note ? `<p class="note" style="margin:8px 0 0">${note}</p>` : ''}</section>`;
  };
  const optCard = (g, o, preview) => `<button class="setopt ${settings[g] === o.id ? 'on' : ''}" data-g="${g}" data-v="${o.id}" aria-pressed="${settings[g] === o.id}">
      ${preview}<span class="sn">${tr(`${g}.${o.id}.name`)}</span><span class="sd">${tr(`${g}.${o.id}.note`)}</span></button>`;
  const optRow = (g, o, preview) => `<button class="setopt ${settings[g] === o.id ? 'on' : ''}" data-g="${g}" data-v="${o.id}" aria-pressed="${settings[g] === o.id}">
      ${preview}<span class="txt"><span class="sn">${tr(`${g}.${o.id}.name`)}</span><span class="sd">${tr(`${g}.${o.id}.note`)}</span></span></button>`;
  const swatch = o => `<span class="swatch" style="background:${o.c[0]}" aria-hidden="true"><i style="background:${o.c[1]}"></i><i style="background:${o.c[2]}"></i><b style="color:${o.c[3]}">Aa</b></span>`;
  const hidden = new Set(settings.hiddenCats || []);
  const ordered = [...(settings.cats || []), ...CATEGORIES.map(c => c.id).filter(id => !(settings.cats || []).includes(id))]
    .map(id => CATEGORIES.find(c => c.id === id)).filter(Boolean);
  const rtv = store.get('rtvKey', '');

  const panes = {
    start: () => seg('uiLang', tr('set.uilang.title'), UI_LANGS, tr('set.uilang.note'))
      + seg('start', tr('set.start.title'), [['vod', tr('nav.home')], ['live', tr('nav.live')]], tr('set.start.note'))
      + seg('kids', tr('set.kids.title'), [['off', tr('set.kids.off')], ['on', tr('set.kids.on')]], tr('set.kids.note'))
      + seg('preview', tr('set.preview.title'), [['on', tr('common.on')], ['off', tr('common.off')]], tr('set.preview.note'))
      + seg('lang', tr('set.lang.title'), [['he', tr('set.lang.he')], ['en', tr('set.lang.en')]], tr('set.lang.note')),

    look: () => `<section class="sset"><h2>${tr('set.skin.title')}</h2><div class="sopts slist">${SKINS.map(o => optRow('skin', o, swatch(o))).join('')}</div></section>
      <section class="sset"><h2>${tr('set.layout.title')}</h2><div class="sopts">${LAYOUTS.map(o => optCard('layout', o, `<span class="lprev" aria-hidden="true">${o.prev}</span>`)).join('')}</div></section>`
      + seg('poster', tr('set.poster.title'), POSTER_SIZES.map(id => [id, tr('poster.' + id)]))
      + seg('nosrc', tr('set.nosrc.title'), [['grey', tr('set.nosrc.grey')], ['hide', tr('set.nosrc.hide')]], tr('set.nosrc.note')),

    home: () => `<section class="sset"><h2>${tr('set.home.title')}</h2>
      <p class="note" style="margin:0 0 10px">${tr('set.home.note')}</p>
      <div class="catorder">${ordered.map((c, i) => `<div>
        <label><input type="checkbox" data-cat="${c.id}" ${hidden.has(c.id) ? '' : 'checked'}><bdi>${esc(catName(c))}</bdi></label>
        <button data-up="${i}" aria-label="${esc(tr('set.home.up'))}" ${i ? '' : 'disabled'}>▲</button><button data-down="${i}" aria-label="${esc(tr('set.home.down'))}" ${i < ordered.length - 1 ? '' : 'disabled'}>▼</button></div>`).join('')}</div></section>`,

    live: () => `<section class="sset"><h2>RaspberryTV</h2>
      ${rtv ? `<p class="note" style="margin:0 0 10px">${tr('set.rtv.connected', {code: `<b dir="ltr">${esc(rtv.slice(0, 2))}••••••</b>`})}</p>
        <p class="note" id="rtvShape" dir="ltr" style="margin:0 0 10px;font-size:12px;opacity:.65;word-break:break-all;white-space:pre-line"></p>
        <button class="danger" id="rtvClear">${tr('set.rtv.clear')}</button>`
      : `<p class="note" style="margin:0 0 10px">${tr('set.rtv.help')}</p>
        <div class="keyform"><button class="btn primary" id="rtvSet">${tr('set.rtv.enter')}</button></div>`}</section>
      <section class="sset"><h2>${tr('set.pl.title')}</h2>
      ${playlists.map(p => `<div class="plrow"><b>${esc(p.name)}</b><code dir="ltr">${esc(p.url)}</code><button class="danger" data-plrm="${esc(p.url)}">${tr('common.remove')}</button></div>`).join('')}
      <form class="addpl" id="plf"><input class="field" id="pln" placeholder="${esc(tr('set.pl.name'))}" aria-label="${esc(tr('set.pl.nameAria'))}">
        <input class="field" id="plu" placeholder="http://192.168.1.50:9981/playlist/channels.m3u" aria-label="${esc(tr('set.pl.urlAria'))}" dir="ltr"><button class="btn primary">${tr('common.add')}</button></form>
      <p class="hint" style="margin:0">${tr('set.pl.hint')}</p></section>`,

    addons: () => `<section class="sset"><h2>${tr('set.addons.title')}</h2>
      <p class="note" style="margin:0 0 10px">${tr('set.addons.note')}</p>
      <div class="keyform"><a class="btn primary" href="#/addons">${tr('set.addons.manage')}</a></div></section>
      <section class="sset"><h2>${tr('set.subs.title')}</h2><p class="note" style="margin:0">${tr('set.subs.note')}</p></section>`,

    about: () => `<section class="sset"><h2>${tr('set.reset.title')}</h2>
      <p class="note" style="margin:0 0 10px">${tr('set.reset.note')}</p>
      <div class="keyform"><button class="danger" id="sreset">${tr('set.reset.btn')}</button></div></section>
      <section class="sset"><h2>${tr('set.about.title')}</h2>
      <p class="note" style="margin:0 0 10px">VEO${APP_VERSION ? tr('set.about.version', {v: esc(APP_VERSION)}) : tr('set.about.browser')}</p>
      <div class="keyform"><button class="btn primary" id="supd">${tr('set.about.check')}</button></div></section>`,
  };
  pane.innerHTML = (panes[setTab] || panes.start)();

  // one place that stores a choice, whichever pane it came from
  pane.querySelectorAll('[data-g]').forEach(b => b.onclick = () => {
    settings[b.dataset.g] = b.dataset.v;
    store.set('settings', settings); applySettings();
    if(b.dataset.g === 'uiLang'){                    // every word on screen changes: draw the whole screen again
      route();
      document.querySelector(`[data-g="uiLang"][data-v="${b.dataset.v}"]`)?.focus();
    } else paintSettings();
  });
  if($('#rtvSet')) $('#rtvSet').onclick = () => openRtvKey(paintSettings);
  // The shape of a channel's addresses, with every key and token blotted out: which spelling of the
  // archive a service answers to is the one thing its playlist does not say, and this is how to see it.
  if($('#rtvShape')) loadRtv().then(ch => {
    const c = (ch || []).find(x => x.rec) || (ch || [])[0];
    const box = $('#rtvShape');
    if(!c || !box?.isConnected) return;
    const hide = u => u.replace(/[A-Za-z0-9_-]{8,}/g, m => m.slice(0, 3) + '…');
    const tried = store.get('archTried', []);
    box.textContent = [`${c.name}${c.rec ? ` · ${c.rec}h` : ''}`, hide(c.url),
      ...rtvArchiveTemplate(c).split('|').filter(Boolean).map(hide),
      ...(tried.length ? ['— מה שנוסה לאחרונה —', ...tried] : [])].join('\n');
  }).catch(() => {});
  if($('#rtvClear')) $('#rtvClear').onclick = () => { store.set('rtvKey', ''); forgetRtv(); paintSettings(); };
  pane.querySelectorAll('[data-plrm]').forEach(b => b.onclick = () => {
    setPlaylists(playlists.filter(p => p.url !== b.dataset.plrm)); paintSettings();
  });
  if($('#plf')) $('#plf').onsubmit = async e => {
    e.preventDefault();
    const url = $('#plu').value.trim(), name = $('#pln').value.trim() || tr('set.pl.default');
    if(!url) return;
    try{
      const chans = parseM3U(await fetchText(url));
      if(!chans.length) throw new Error(tr('set.pl.empty'));
      playlistCache[url] = chans;
      setPlaylists(playlists.filter(p => p.url !== url).concat({name, url}));
      store.set('playlists', playlists);
      alert(tr('set.pl.added', {name, n: chans.length}));
      paintSettings();
    }catch(err){ alert(tr('set.pl.failed', {err: err.message})); }
  };
  const saveCats = ids => { settings.cats = ids; store.set('settings', settings); paintSettings(); };
  pane.querySelectorAll('[data-cat]').forEach(cb => cb.onchange = () => {
    const h = new Set(settings.hiddenCats || []);
    cb.checked ? h.delete(cb.dataset.cat) : h.add(cb.dataset.cat);
    settings.hiddenCats = [...h]; store.set('settings', settings);
  });
  pane.querySelectorAll('[data-up],[data-down]').forEach(b => b.onclick = () => {
    const ids = ordered.map(c => c.id), i = +(b.dataset.up ?? b.dataset.down), j = b.dataset.up != null ? i - 1 : i + 1;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    saveCats(ids);
  });
  if($('#supd')) $('#supd').onclick = async () => {
    store.set('updSkip', '');
    $('#supd').textContent = tr('set.about.checking');
    await checkUpdate(true);
    $('#supd').textContent = document.querySelector('.update') ? tr('set.about.found') : tr('set.about.latest');
  };
  if($('#sreset')) $('#sreset').onclick = () => {          // the language stays: resetting must never strand someone in a language they cannot read
    setSettings({skin: 'veo', layout: isTv() ? 'tv' : 'cinema', poster: 'm', lang: 'he', uiLang: settings.uiLang, nosrc: 'grey', start: 'vod', kids: 'off', preview: 'on'});
    store.set('settings', settings); applySettings(); paintSettings();
  };
  if(focusKey) pane.querySelector(focusKey)?.focus();
}
