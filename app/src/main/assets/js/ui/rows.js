/* Rows of titles, and the screen they are laid out on. */
import {$, esc, showErr} from '../core/dom.js';
import {rowMax} from '../core/settings.js';
import {addons, catalogFetch} from '../data/addons.js';
import {SC_ID} from '../data/catalogs.js';
import {srcName, typeName} from '../data/names.js';
import {SERVICES, noteServices} from '../data/services.js';
import {tr} from '../i18n.js';
import {JFC_LOBBIES, jfcCard, jfcLobby} from '../providers/jfc.js';
import {kanBox, kanCard} from '../providers/kan.js';
import {makoCard, makoPrograms} from '../providers/mako.js';
import {r13, r13card, r13row} from '../providers/reshet.js';
import {card, skeletons} from './cards.js';
import {autoSpot, reelable} from './reel.js';

export const rowTag = x => {
  const parts = [];
  if(x.merge) parts.push(x.merge.map(id => SERVICES[id]).join(' · '));
  else if(x.c){ if(!x.notype) parts.push(typeName(x.c.type)); parts.push(srcName(x.a)); }
  // a broadcaster's row is a taste of everything they have: its heading leads to the rest
  const more = x.more ? ` <a class="rowmore" href="${esc(x.more)}">${tr('row.all')}</a>` : '';
  return (parts.length ? ` <small>${esc(parts.join(' · '))}</small>` : '') + more;
};
/* "Continue watching" and a row per catalogue, each a wheel of its own (js/ui/reel.js); the rows
   load in parallel. There is no banner over them any more: the first title of the first row takes
   the middle by itself, so a screen opens on its content rather than on an announcement of it. */
export const reel = (inner, id = '') =>
  `<div class="reelwrap"><div class="strip${reelable() ? ' reel' : ''}"${id ? ` id="${id}"` : ''}>${inner}</div></div>`;
export function renderRows(rows, {cont = [], heading = '', top = ''} = {}){
  const app = $('#app');
  app.innerHTML = `${heading ? `<div class="page"><h1>${esc(heading)}</h1></div>` : ''}
    ${top}
    ${cont.length ? `<div class="row"><h2>${tr('row.continue')}</h2>${reel(cont.map(x => card({id:x.metaId,type:x.type,name:x.name,poster:x.poster})).join(''))}</div>` : ''}
    ${rows.map((x, i) => `<div class="row"><h2><bdi>${esc(x.title)}</bdi>${rowTag(x)}</h2>${reel(skeletons(8), 'row' + i)}</div>`).join('')}
    ${!rows.length ? `<p class="note">${tr('row.noCatalogs')}</p>` : ''}`;
  autoSpot($('#app .strip'));
  // Each title appears once per page: it stays in the first (highest) row that has it.
  const claimed = new Map();
  const dedupe = (i, metas) => metas.filter(m => {
    const j = claimed.get(m.id);
    if(j !== undefined && j < i) return false;
    if(j !== undefined && j > i) document.querySelectorAll(`#row${j} [data-id="${CSS.escape(m.id)}"]`).forEach(e => e.remove());
    claimed.set(m.id, i);
    return true;
  });
  const fillRow = async (x, i) => {
    const el = $('#row' + i);
    const again = () => fillRow(x, i);
    if(x.merge){
      try{
        const sc = addons.find(a => a.manifest.id === SC_ID);
        const lists = await Promise.all(x.merge.map(async id => {
          const c = (sc?.manifest.catalogs || []).find(c => c.id === id && c.type === x.type);
          if(!c) return [];
          const metas = (await catalogFetch(sc, c.type, c.id).catch(() => ({metas: []}))).metas || [];
          metas.forEach(m => noteServices(m.id, SERVICES[id]));
          return metas;
        }));
        const merged = [];                                   // round-robin so every service is represented
        for(let k = 0; merged.length < 200 && lists.some(l => l[k]); k++) for(const l of lists) if(l[k] && !merged.some(m => m.id === l[k].id)) merged.push(l[k]);
        if(el) el.innerHTML = dedupe(i, merged).slice(0, rowMax()).map(card).join('') || `<p class="note">${tr('row.none')}</p>`;
      }catch(e){ showErr(el, tr('row.failed'), e, again); }
      return;
    }
    if(x.kan){
      try{
        const secs = await kanBox();
        const sec = secs.find(z => x.kan.test(z.title));
        el.innerHTML = sec ? sec.items.slice(0, rowMax()).map(kanCard).join('') : `<p class="note">${tr('row.none')}</p>`;
      }catch(e){ showErr(el, tr('row.failedKan'), e, again); }
      return;
    }
    // Kan without its films: everything else the broadcaster has, as one row under the series
    if(x.kanAll){
      try{
        const secs = await kanBox();
        const seen = new Set(), items = [];
        for(const sec of secs){
          if(/סרטים/.test(sec.title)) continue;
          for(const it of sec.items) if(!seen.has(it.url)){ seen.add(it.url); items.push(it); }
        }
        if(el) el.innerHTML = items.slice(0, rowMax()).map(kanCard).join('') || `<p class="note">${tr('row.none')}</p>`;
      }catch(e){ showErr(el, tr('row.failedKan'), e, again); }
      return;
    }
    if(x.mako){
      try{ if(el) el.innerHTML = (await makoPrograms('')).slice(0, rowMax()).map(makoCard).join('') || `<p class="note">${tr('row.none')}</p>`; }
      catch(e){ showErr(el, tr('row.failedMako'), e, again); }
      return;
    }
    if(x.jfc){
      try{
        const items = (await jfcLobby(JFC_LOBBIES[0][0])).flatMap(r => r.items);
        if(el) el.innerHTML = items.slice(0, rowMax()).map(jfcCard).join('') || `<p class="note">${tr('row.none')}</p>`;
      }catch(e){ showErr(el, tr('row.failedJfc'), e, again); }
      return;
    }
    if(x.r13){
      try{ el.innerHTML = (await r13row(x.r13)).slice(0, rowMax()).map(r13card).join('') || `<p class="note">${tr('row.none')}</p>`; }
      catch(e){ showErr(el, tr('row.failedR13'), e, again); }
      return;
    }
    try{
      const d = await catalogFetch(x.a, x.c.type, x.c.id, x.extra);
      const metas = d.metas || [];
      if(el) el.innerHTML = dedupe(i, metas).slice(0, rowMax()).map(card).join('') || `<p class="note">${tr('row.empty')}</p>`;
    }catch(e){ showErr(el, tr('row.failedCat'), e, again); }
  };
  // the first row to answer offers the first title to the middle; whoever is already there keeps it
  rows.forEach((x, i) => fillRow(x, i).then(() => autoSpot($('#app .strip'))));
}

/** Movies and Series: the same catalogues, one type at a time. */
