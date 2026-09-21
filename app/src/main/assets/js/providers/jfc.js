/* The Israeli Film Archive of the Jerusalem Cinematheque. */
import {fetchText, sitePull} from '../core/bridge.js';
import {esc} from '../core/dom.js';
import {openSite} from './mako.js';
import {openPlayer} from '../ui/player.js';

/* ---------- Israeli Film Archive · Jerusalem Cinematheque (jfc.org.il) ----------
   130 years of films made here: features, documentaries, newsreels and home movies, with a Hebrew
   synopsis for every one. The archive plays its films on its own site, behind a free account (and a
   payment for some of the newer features), so the catalogue is read here and the film itself opens
   in the in-app window, signed in with the viewer's own account. */
export const JFC = 'https://jfc.org.il';
export const JFC_LOBBIES = [
  ['/lobby/israeli-cinema/', 'סרטי קולנוע'],
  ['/lobby/archive-materials/', 'חומרי ארכיון'],
  ['/lobby/a-selection-of-israel-film-service-films/', 'שירות הסרטים הישראלי'],
  ['/collection/', 'אוספים'],
];
export const jfcCache = {};

/** One lobby page of the archive, as rows of films (the page is served ready-made). */
export async function jfcLobby(path){
  if(jfcCache[path]) return jfcCache[path];
  const html = await fetchText(JFC + path);
  const rows = [];
  // a page is a series of "stripes", each with a heading and a row of items
  const parts = html.split(/<div class="stripe-row/).slice(1);
  for(const part of parts){
    const title = (part.match(/<h2 class="stripe-title[^"]*"[^>]*>([\s\S]*?)<\/h2>/) || [])[1];
    if(!title) continue;
    const items = jfcItems(part);
    if(items.length) rows.push({title: jfcText(title), items});
  }
  if(!rows.length){                                          // a plain grid page (collections)
    const items = jfcItems(html);
    if(items.length) rows.push({title: 'הכל', items});
  }
  jfcCache[path] = rows;
  return rows;
}

export const jfcText = t => t.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"').trim();

/** Every film link on a page, with its poster, kind, year and whether it costs money. */
export function jfcItems(html){
  const out = [], seen = new Set();
  // films, newsreel moments, home movies, collections - every kind the archive lists
  for(const m of html.matchAll(/<a href='(https:\/\/jfc\.org\.il\/(?:movie|news_journal|general_film|collection|compilation|interviews-with-creators)\/[^']+)'([\s\S]*?)<\/a>/g)){
    const [, url, body] = m;
    if(seen.has(url) || !/class='item/.test(body)) continue;
    const title = jfcText((body.match(/<h3 class='item_title'>([\s\S]*?)<\/h3>/) || [])[1] || '');
    if(!title) continue;
    seen.add(url);
    out.push({
      url, title,
      poster: (body.match(/(?:background-image: url\(|data-bg=')([^')]+)/) || [])[1] || '',
      kind: jfcText((body.match(/item_type_with_icon[^>]*>[\s\S]*?<span>([\s\S]*?)<\/span>/) || [])[1] || ''),
      by: jfcText((body.match(/extra-by-post-container[^>]*>([\s\S]*?)<\/div>/) || [])[1] || ''),
      len: jfcText((body.match(/<p class='item-length'>([\s\S]*?)<\/p>/) || [])[1] || ''),
      paid: /item_tag kind[^>]*>\s*בתשלום/.test(body),
    });
  }
  return out;
}

/**
 * A film of the archive, played here rather than on their site.
 *
 * The archive puts its films behind a free account, and the page of a film it lets you watch carries
 * the stream itself. The app's hidden window shares the same cookies as the in-app browser, so once
 * the viewer has signed in there, the page can be read and the film played in VEO's own player -
 * with the site kept as the way in for anything the reading does not find (a film behind a payment,
 * or one the site plays some other way).
 */
const JFC_STREAM_READER = `
  const h = d.documentElement.outerHTML;
  const m = h.match(/https?:\\/\\/[^"'\\s<>\\\\]+?\\.(?:m3u8|mp4)[^"'\\s<>\\\\]*/);
  return JSON.stringify(m ? m[0].replace(/&amp;/g, '&') : '');`;

export async function jfcPlay(url, title){
  try{
    const stream = await sitePull(url, JFC_STREAM_READER);
    if(!stream) throw new Error('no stream');
    if(window.BoothAndroid?.playVod) BoothAndroid.playVod(stream, '', title, JFC + '/');
    else openPlayer({url: stream}, title, null);
  }catch(e){
    openSite(url);                                   // signed out, or a film it keeps to itself
  }
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-jfc]');
  // a film of the archive carries its own address; anything else wearing this mark is not ours
  if(b && /^https?:/.test(b.dataset.jfc)){ e.preventDefault(); jfcPlay(b.dataset.jfc, b.dataset.title || ''); }
});

export function jfcCard(x){
  const art = x.poster ? `<div class="art" data-bg="${esc(x.poster)}">${x.paid ? '<span class="svc">בתשלום</span>' : ''}</div>`
                       : `<div class="art ph"></div>`;
  return `<button class="poster" data-jfc="${esc(x.url)}" data-title="${esc(x.title)}" title="${esc(x.title)}">${art}
    <div class="t" dir="rtl">${esc(x.title)}</div><div class="y">${esc([x.by, x.len].filter(Boolean).join(' · '))}</div></button>`;
}
