/* The add-ons page. */
import {$, esc, getJSON, normUrl} from '../core/dom.js';
import {addonUrls, addons, loadAddons, setAddonUrls} from '../data/addons.js';
import {tr} from '../i18n.js';

export function viewAddons(msg){
  const shown = addons.filter(a => !a.local);
  $('#app').innerHTML = `<div class="page"><h1>${tr('set.addons.title')}</h1>
    <p class="note" style="max-width:68ch">${tr('addons.intro')}</p>
    <form class="add" id="addf"><input class="field" id="aurl" placeholder="https://…/manifest.json" aria-label="${esc(tr('addons.manifestAria'))}" dir="ltr"><button class="btn primary">${tr('addons.install')}</button></form>
    ${msg ? `<p class="${msg.err?'err':'note'}">${esc(msg.text)}</p>` : ''}
    ${shown.map(a => `<div class="addon">${a.manifest.logo ? `<img src="${esc(a.manifest.logo)}" alt="">` : '<div class="ph"></div>'}
      <div><h3>${esc(a.manifest.name)} <span class="note">v${esc(a.manifest.version)}</span></h3><p>${esc(a.manifest.description)}</p><p>${esc((a.manifest.resources||[]).map(r => r.name||r).join(', '))}</p></div>
      <button class="danger" data-u="${esc(a.url)}">${tr('common.remove')}</button></div>`).join('')}
    ${addonUrls.length > shown.length ? `<p class="err">${tr('addons.hidden', {n: addonUrls.length - shown.length})}</p>` : ''}</div>`;
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
