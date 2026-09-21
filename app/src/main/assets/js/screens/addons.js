/* The add-ons page. */
import {$, esc, getJSON, normUrl} from '../core/dom.js';
import {addonUrls, addons, loadAddons, setAddonUrls} from '../data/addons.js';
import {tr} from '../i18n.js';

export function viewAddons(msg){
  /* Every add-on that was installed, whether or not it is answering today. The list used to be the
     ones whose manifest had just been fetched, so an add-on that went off the air could not be
     removed - it was not on the page - while it went on costing nine seconds of every start. One that
     is silent says so, and its Remove button is there like any other's. */
  const shown = addonUrls.map(url => addons.find(a => a.url === url) || {url, silent: true});
  $('#app').innerHTML = `<div class="page"><h1>${tr('set.addons.title')}</h1>
    <form class="add" id="addf"><input class="field" id="aurl" placeholder="https://…/manifest.json" aria-label="${esc(tr('addons.manifestAria'))}" dir="ltr"><button class="btn primary">${tr('addons.install')}</button></form>
    ${msg ? `<p class="${msg.err?'err':'note'}">${esc(msg.text)}</p>` : ''}
    ${shown.map(a => `<div class="addon">${a.manifest?.logo ? `<img src="${esc(a.manifest.logo)}" alt="">` : '<div class="ph"></div>'}
      <div><h3>${esc(a.manifest?.name || a.url)} ${a.manifest?.version ? `<span class="note">v${esc(a.manifest.version)}</span>` : ''}</h3>
        <p>${a.silent ? `<span class="err">${esc(tr('addons.silent'))}</span>` : esc(a.manifest.description || '')}</p>
        <p>${esc((a.manifest?.resources || []).map(r => r.name || r).join(', '))}</p></div>
      <button class="danger" data-u="${esc(a.url)}">${tr('common.remove')}</button></div>`).join('')}</div>`;
  $('#addf').onsubmit = async e => {
    e.preventDefault();
    const url = $('#aurl').value.trim(); if(!url) return;
    if(addonUrls.includes(url)) return viewAddons({text: tr('addons.already')});
    try{
      const m = await getJSON(normUrl(url));
      if(!m.id || !m.resources) throw new Error(tr('addons.invalid'));
      setAddonUrls([...addonUrls, url]); await loadAddons();
      viewAddons({text: tr('addons.installed', {name: m.name})});
    }catch(err){ viewAddons({text: tr('addons.failed', {err: err.message}), err: true}); }
  };
  document.querySelectorAll('.danger').forEach(b => b.onclick = async () => {
    setAddonUrls(addonUrls.filter(u => u !== b.dataset.u)); await loadAddons(); viewAddons({text: tr('common.removed')});
  });
}
