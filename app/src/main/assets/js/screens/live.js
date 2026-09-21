/* The wall of live channels. */
import {$, esc, showErr} from '../core/dom.js';
import {store} from '../core/store.js';
import {liveChannels, liveSources, nowPlaying, watchChannel} from '../providers/live.js';
import {hhmm, openChannel, openRtvKey, rtvArchiveProbe} from '../providers/rtv.js';

export async function viewLive(){
  const app = $('#app');
  const sources = liveSources();
  let sel = store.get('livePl', sources[0].key);
  if(!sources.some(x => x.key === sel)) sel = sources[0].key;
  app.innerHTML = `<div class="page"><h1>שידור חי</h1>
    <div class="live-top">
      ${sources.length > 1 ? sources.map(x => `<button class="chip ${x.key === sel ? 'on' : ''}" data-pl="${esc(x.key)}">${esc(x.name)}</button>`).join('') : ''}
      <span class="live-groups" id="lg" role="group" aria-label="קבוצה" hidden></span>
      <input class="field" id="lq" type="search" placeholder="חיפוש ערוץ" aria-label="חיפוש ערוץ">
    </div>
    <div id="cont"></div>
    <div id="chs"><p class="note">טוען ערוצים…</p></div>
    ${store.get('rtvKey', '') ? '' : `<div class="keyform" style="margin-top:24px"><button class="btn primary" id="rtvOpen">הזן קוד RaspberryTV</button>
      <span class="note">מנוי RaspberryTV? הזן את קוד הגישה פעם אחת והערוצים יופיעו כאן.</span></div>`}</div>`;
  if($('#rtvOpen')) $('#rtvOpen').onclick = () => openRtvKey(viewLive);
  app.querySelectorAll('[data-pl]').forEach(b => b.onclick = () => { store.set('livePl', b.dataset.pl); store.set('liveGroup', ''); viewLive(); });

  // The channels of the playlist that was chosen: another playlist may have been chosen since, and
  // a list that arrives late must not be painted over the one the viewer is now looking at.
  const mine = $('#chs');
  let chans;
  try{ chans = await liveChannels(sel); }
  catch(err){ if(mine.isConnected) showErr(mine, 'לא ניתן לטעון את הערוצים', err, viewLive); return; }
  if(!mine.isConnected) return;

  const groups = [...new Set(chans.map(c => c.group))];
  let liveGroup = store.get('liveGroup', '');
  if(!groups.includes(liveGroup)) liveGroup = '';
  if(groups.length > 1){
    $('#lg').hidden = false;
    $('#lg').innerHTML = [['', `הכל (${chans.length})`], ...groups.map(g => [g, g])].map(([v, n]) =>
      `<button class="chip ${liveGroup === v ? 'on' : ''}" data-g="${esc(v)}">${esc(n)}</button>`).join('');
    $('#lg').querySelectorAll('[data-g]').forEach(b => b.onclick = () => {
      store.set('liveGroup', b.dataset.g);
      $('#lg').querySelectorAll('[data-g]').forEach(x => x.classList.toggle('on', x === b));
      draw();
    });
  }

  // Which spelling of the archive this service answers to is asked once, quietly, while the channels are
  // being read - so that walking back through a channel plays the first time it is tried.
  const withRec = chans.find(c => c.rec && c.url);
  if(withRec && store.get('archFmt', -1) < 0){
    const hour = Math.floor(Date.now() / 1000) - 3600;
    rtvArchiveProbe(withRec, hour, hour + 1800).catch(() => {});
  }

  const last = store.get('lastChannel', null);
  const lastIdx = last && last.src === sel ? chans.findIndex(c => c.name === last.name) : -1;
  $('#cont').innerHTML = lastIdx >= 0 ? `<button class="continue" id="goLast">▶ המשך לצפות · <span>${esc(chans[lastIdx].name)}</span></button>` : '';
  if(lastIdx >= 0) $('#goLast').onclick = () => watchChannel(chans, lastIdx, sel);

  const initials = c => esc(c.name.replace(/[^\p{L}\p{N}]/gu, '').slice(0, 2));
  const numbers = new Map(chans.map((c, i) => [c, i + 1]));   // channel number without scanning the list per row
  let nowIo = null;
  const draw = () => {
    nowIo?.disconnect();
    const q = $('#lq').value.trim().toLowerCase(), g = $('#lg').hidden ? '' : $('#lg').querySelector('.on')?.dataset.g || '';
    const list = chans.filter(c => (!g || c.group === g) && (!q || c.name.toLowerCase().includes(q)));
    $('#chs').innerHTML = list.length ? `<div class="chlist">${list.map((c, i) => `<div class="chrow">
        <button class="chmain" data-i="${i}">
          <span class="chhead"><span class="chlogo">${c.logo ? `<img src="${esc(c.logo)}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{textContent:'${initials(c)}'}))">` : `<span>${initials(c)}</span>`}</span>
            <span class="chinfo"><b>${esc(c.name)}</b><span class="chnum">${numbers.get(c)}${c.group ? ` · ${esc(c.group)}` : ''}</span></span></span>
          <span class="chinfo"><small data-now="${i}">${c.epg ? '' : ''}</small></span></button>
      </div>`).join('')}</div>` : '<p class="note">אין ערוצים שמתאימים.</p>';
    $('#chs').querySelectorAll('[data-i]').forEach(b => {
      const c = list[b.dataset.i];
      let longPressed = false, timer = null;
      b.onclick = () => { if(longPressed){ longPressed = false; return; } watchChannel(list, +b.dataset.i, sel); };
      if(!c.rec) return;
      // Long press (touch, or holding OK on a remote) opens catch-up: the week's programme guide.
      const openBack = () => { longPressed = true; openChannel(c); };
      b.oncontextmenu = e => { e.preventDefault(); openBack(); };
      b.onpointerdown = () => { longPressed = false; clearTimeout(timer); timer = setTimeout(openBack, 600); };
      b.onpointerup = b.onpointerleave = b.onpointercancel = () => clearTimeout(timer);
      b.onkeydown = e => { if(e.key === 'Enter' && e.repeat && !longPressed){ e.preventDefault(); openBack(); } };
    });
    // "now playing" line for visible channels
    const showNow = async el => {
      const p = await nowPlaying(list[el.dataset.now]);
      if(!p || !el.isConnected || el.dataset.done) return;
      el.dataset.done = 1;
      const pct = Math.max(0, Math.min(100, (Date.now() / 1000 - p.t) / (p.to - p.t) * 100));
      el.textContent = `${p.name} · ${hhmm(p.t)}–${hhmm(p.to)}`;
      el.insertAdjacentHTML('afterend', `<span class="bar"><i style="width:${pct.toFixed(0)}%"></i></span>`);
    };
    nowIo = new IntersectionObserver(entries => {
      for(const en of entries) if(en.isIntersecting){ nowIo.unobserve(en.target); showNow(en.target); }
    }, {rootMargin: '200px'});
    list.forEach((c, i) => {
      if(!c.epg) return;
      const el = $('#chs').querySelector(`[data-now="${i}"]`);
      if(i < 12) showNow(el); else nowIo.observe(el);
    });
  };
  let typing = null;
  $('#lq').oninput = () => { clearTimeout(typing); typing = setTimeout(draw, 200); };   // playlists can hold thousands
  draw();
}
