/* Rows of titles, and the screen they are laid out on. */
import {$, esc, showErr} from '../core/dom.js';
import {rowMax} from '../core/settings.js';
import {addons, catalogFetch} from '../data/addons.js';
import {SC_ID} from '../data/catalogs.js';
import {srcName, typeName} from '../data/names.js';
import {SERVICES, noteServices} from '../data/services.js';
import {tr} from '../i18n.js';
import {kanBox, kanCard} from '../providers/kan.js';
import {r13, r13card, r13row} from '../providers/reshet.js';
import {card, skeletons} from './cards.js';
import {pickFeatured, renderHero} from './hero.js';

export const rowTag = x => {
  const parts = [];
  if(x.merge) parts.push(x.merge.map(id => SERVICES[id]).join(' · '));
  else if(x.c){ if(!x.notype) parts.push(typeName(x.c.type)); parts.push(srcName(x.a)); }
  return parts.length ? ` <small>${esc(parts.join(' · '))}</small>` : '';
};
/** Hero + "continue watching" + a row per catalog; rows load in parallel. */
export function renderRows(rows, {hero = true, cont = [], heading = '', top = ''} = {}){
  const app = $('#app');
  app.innerHTML = `${hero ? `<section class="hero" id="hero"><div class="bg skel"></div><div class="beam"></div><div class="copy"><h1>&nbsp;</h1></div></section>` : heading ? `<div class="page"><h1>${esc(heading)}</h1></div>` : '<div style="height:8px"></div>'}
    ${top}
    ${cont.length ? `<div class="row"><h2>${tr('row.continue')}</h2><div class="strip">${cont.map(x => card({id:x.metaId,type:x.type,name:x.name,poster:x.poster})).join('')}</div></div>` : ''}
    ${rows.map((x, i) => `<div class="row"><h2><bdi>${esc(x.title)}</bdi>${rowTag(x)}</h2><div class="strip" id="row${i}">${skeletons(8)}</div></div>`).join('')}
    ${!rows.length ? `<p class="note">${tr('row.noCatalogs')}</p>` : ''}`;
  let heroDone = !hero, heroPlain = null;
  // nothing with artwork answered: rather than an empty banner, the first title of the page takes it
  if(hero) setTimeout(() => { if(!heroDone && heroPlain){ heroDone = true; renderHero(heroPlain); } }, 6000);
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
    if(x.r13){
      try{ el.innerHTML = (await r13row(x.r13)).slice(0, rowMax()).map(r13card).join('') || `<p class="note">${tr('row.none')}</p>`; }
      catch(e){ showErr(el, tr('row.failedR13'), e, again); }
      return;
    }
    try{
      const d = await catalogFetch(x.a, x.c.type, x.c.id, x.extra);
      const metas = d.metas || [];
      if(el) el.innerHTML = dedupe(i, metas).slice(0, rowMax()).map(card).join('') || `<p class="note">${tr('row.empty')}</p>`;
      if(!heroDone && metas.length){
        const star = pickFeatured(metas);
        if(star){ heroDone = true; renderHero(star); } else heroPlain ||= metas[0];
      }
    }catch(e){ showErr(el, tr('row.failedCat'), e, again); }
  };
  rows.forEach((x, i) => fillRow(x, i));
}

/** Movies and Series: the same catalogues, one type at a time. */
