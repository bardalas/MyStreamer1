/* Search results. */
import {$, esc, getJSON, showErr} from '../core/dom.js';
import {addons} from '../data/addons.js';
import {hasHebrew, hebrewSearch} from '../data/hebrew.js';
import {typeName} from '../data/names.js';
import {kanBox, kanCard} from '../providers/kan.js';
import {makoCard, makoPrograms} from '../providers/mako.js';
import {r13card, r13row} from '../providers/reshet.js';
import {card, skeletons} from '../ui/cards.js';

/**
  * The broadcasters' own catalogues are lists the app already holds (or fetches once and keeps), so
  * searching them is a filter rather than a request - and a name typed in Hebrew finds כאן and קשת
  * programmes, which no streaming add-on knows about.
  */
async function searchChannels(q, host){
  const needle = q.trim().toLowerCase();
  const hit = name => (name || '').toLowerCase().includes(needle);
  const rows = [];
  await Promise.all([
    kanBox().then(secs => {
      const seen = new Set(), items = [];
      for(const sec of secs) for(const it of sec.items){
        if(hit(it.name) && !seen.has(it.url)){ seen.add(it.url); items.push(it); }
      }
      if(items.length) rows.push({name: 'כאן 11', html: items.slice(0, 20).map(kanCard).join('')});
    }).catch(() => {}),
    makoPrograms('').then(list => {
      const items = list.filter(x => hit(x.name));
      if(items.length) rows.push({name: 'קשת 12', html: items.slice(0, 20).map(makoCard).join('')});
    }).catch(() => {}),
    r13row('series').then(list => {
      const items = list.filter(o => hit(o.name));
      if(items.length) rows.push({name: 'רשת 13', html: items.slice(0, 20).map(r13card).join('')});
    }).catch(() => {}),
  ]);
  if(!rows.length || !host.isConnected) return;
  host.innerHTML = rows.map(r => `<div class="row"><h2>${esc(r.name)}</h2><div class="strip">${r.html}</div></div>`).join('');
}

export async function viewSearch(q){
  $('#q').value = q;
  const app = $('#app');
  const cats = addons.flatMap(a => (a.manifest.catalogs||[]).filter(c => (c.extra||[]).some(e => e.name === 'search') || (c.extraSupported||[]).includes('search')).map(c => ({a, c})));
  app.innerHTML = `<div class="page"><h1>תוצאות עבור „${esc(q)}”</h1>${cats.map((x,i) => `<div class="row"><h2>${esc(typeName(x.c.type))} <small>${esc(x.a.manifest.name)}</small></h2><div class="strip" id="s${i}">${skeletons(6)}</div></div>`).join('') || '<p class="note">אף אחד מהתוספים שלך לא תומך בחיפוש.</p>'}</div>`;
  // the broadcasters answer from lists already in hand, so their row comes up first
  app.querySelector('.page h1').insertAdjacentHTML('afterend', '<div id="sChan"></div>');
  searchChannels(q, $('#sChan'));
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
