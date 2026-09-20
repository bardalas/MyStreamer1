/* Search results. */
import {$, esc, getJSON, showErr} from '../core/dom.js';
import {addons} from '../data/addons.js';
import {hasHebrew, hebrewSearch} from '../data/hebrew.js';
import {typeName} from '../data/names.js';
import {card, skeletons} from '../ui/cards.js';

export async function viewSearch(q){
  $('#q').value = q;
  const app = $('#app');
  const cats = addons.flatMap(a => (a.manifest.catalogs||[]).filter(c => (c.extra||[]).some(e => e.name === 'search') || (c.extraSupported||[]).includes('search')).map(c => ({a, c})));
  app.innerHTML = `<div class="page"><h1>תוצאות עבור „${esc(q)}”</h1>${cats.map((x,i) => `<div class="row"><h2>${esc(typeName(x.c.type))} <small>${esc(x.a.manifest.name)}</small></h2><div class="strip" id="s${i}">${skeletons(6)}</div></div>`).join('') || '<p class="note">אף אחד מהתוספים שלך לא תומך בחיפוש.</p>'}</div>`;
  if(hasHebrew(q)){
    app.querySelector('.page h1').insertAdjacentHTML('afterend', `<div class="row"><h2>בעברית <small>Wikidata</small></h2><div class="strip" id="sHe">${skeletons(6)}</div></div>`);
    hebrewSearch(q).then(ms => { $('#sHe').innerHTML = ms.map(card).join('') || '<p class="note">לא נמצאו תוצאות.</p>'; })
      .catch(e => showErr($('#sHe'), 'החיפוש בעברית נכשל', e, () => viewSearch(q)));
  }
  cats.forEach(async (x, i) => {
    try{
      const d = await getJSON(`${x.a.base}/catalog/${x.c.type}/${x.c.id}/search=${encodeURIComponent(q)}.json`);
      $('#s'+i).innerHTML = (d.metas||[]).map(card).join('') || '<p class="note">לא נמצאו תוצאות.</p>';
    }catch(e){ showErr($('#s'+i), 'החיפוש נכשל', e, () => viewSearch(q)); }
  });
}
