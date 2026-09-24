/* Dependency-free regression tests against the actual UI modules.
   Run: node --experimental-vm-modules --test tools/regressions.test.mjs
   Network, native playback and the minimal DOM contract are mocked; this is not visual/device QA. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';

const repo = process.env.VEO_TEST_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assets = path.join(repo, 'app/src/main/assets');
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return {promise, resolve, reject};
};
const flush = async () => { for(let i = 0; i < 30; i++) await Promise.resolve(); };
const metadata = {id: 'show', name: 'Test Show', behaviorHints: {defaultVideoId: 'show:1:1'},
  videos: [{id: 'show:1:1', season: 1, episode: 1}, {id: 'show:1:4', season: 1, episode: 4}]};
const stream = {url: 'https://media.invalid/video.m3u8', name: '1080p'};
const addon = {base: 'https://addon.invalid', manifest: {name: 'Test add-on'}};
const movie = {type: 'movie', meta: {id: 'movie', name: 'Test Show'}};
const kanResult = [{items: [{name: 'Test Show', url: 'https://www.kan.org.il/show'}]}];
const makoResult = [{name: 'Test Show', path: '/show'}];
const r13Result = [{name: 'Test Show', SeriesID: '13'}];

class Element {
  constructor(doc, attrs = {}, tag = 'div'){
    this.doc = doc; this.attrs = {...attrs}; this.tagName = tag; this.children = [];
    this.dataset = {}; this.isConnected = true; this.textContent = ''; this._html = ''; this.writes = 0;
    this.hidden = Object.hasOwn(attrs, 'hidden'); this.disabled = false;
    for(const [k, v] of Object.entries(attrs)) if(k.startsWith('data-')) this.dataset[k.slice(5)] = v;
    if(attrs.id) doc.ids.set(attrs.id, this);
  }
  set innerHTML(html){
    this.writes++;
    for(const c of this.children){ c.isConnected = false; if(c.attrs.id && this.doc.ids.get(c.attrs.id) === c) this.doc.ids.delete(c.attrs.id); }
    this.children = []; this._html = html;
    for(const match of html.matchAll(/<(\w+)(\s[^>]*|)>/g)){
      const attrs = {};
      for(const a of match[2].matchAll(/([\w-]+)(?:="([^"]*)")?/g)) attrs[a[1]] = a[2] || '';
      const child = new Element(this.doc, attrs, match[1]);
      const rest = html.slice(match.index + match[0].length);
      child.textContent = rest.slice(0, rest.indexOf('<'));
      this.children.push(child);
    }
  }
  get innerHTML(){ return this._html; }
  matches(selector){
    if(selector.startsWith('#')) return this.attrs.id === selector.slice(1);
    if(selector.startsWith('[')) return Object.hasOwn(this.attrs, selector.slice(1, -1));
    if(selector.startsWith('.')) return (this.attrs.class || '').split(' ').includes(selector.slice(1));
    return this.tagName === selector;
  }
  querySelectorAll(selector){ return this.children.filter(c => c.matches(selector)); }
  querySelector(selector){ return this.querySelectorAll(selector)[0] || null; }
  setAttribute(k, v){ this.attrs[k] = v; }
  getAttribute(k){ return this.attrs[k] ?? null; }
  removeAttribute(k){ delete this.attrs[k]; }
  focus(){ this.doc.activeElement = this; }
  // the page asks whether the thing the viewer is on is inside a row it is about to redraw
  contains(el){ return el === this || this.children.includes(el); }
  closest(){ return null; }
}

async function fixture(opts = {}){
  const ids = new Map();
  const doc = {ids, activeElement: null, querySelector: s => s.startsWith('#') ? ids.get(s.slice(1)) || null : null,
    querySelectorAll: () => []};
  doc.body = new Element(doc); doc.activeElement = doc.body;
  const app = new Element(doc, {id: 'app'}), box = new Element(doc, {id: 'streams'}), alt = new Element(doc, {id: 'palt'});
  const location = {hash: '#/'};
  const calls = {meta: [], quick: [], plays: [], availability: [], kan: 0, mako: 0, r13: 0, streams: []};
  const timers = new Map(); let timerId = 0, now = 0;
  const clock = {
    setTimeout(fn, ms){ const id = ++timerId; timers.set(id, {fn, at: now + ms}); return id; },
    clearTimeout(id){ timers.delete(id); },
    async tick(ms){ now += ms; for(const [id, t] of [...timers]) if(t.at <= now){ timers.delete(id); t.fn(); } await flush(); },
  };
  const native = opts.native ? {
    playUrl: (...args) => calls.plays.push({native: 'url', args}),
    playTorrent: (...args) => calls.plays.push({native: 'torrent', args}),
    openExternal: (...args) => calls.plays.push({native: 'external', args}),
  } : undefined;
  const tr = (k, p) => p?.svc ? `${k}: ${p.svc}` : k;
  const stubs = {
    'core/dom.js': {$: s => doc.querySelector(s), esc: s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;'}[c])), showErr: () => {}},
    // the taste is reached from the sources module now (it is ended the moment a title is asked
    // for), and it asks the settings for itself: with the preview off, it does nothing here
    'core/settings.js': {rowMax: () => 10, isTvLayout: () => !!opts.tv, IS_TV_DEVICE: !!opts.tv,
      LAYOUT: 'tv', POSTER_SIZE: 'm',
      settings: {layout: 'tv', poster: 'm', lang: 'he', preview: 'off', skin: 'veo'}},
    'core/store.js': {store: {get: (_k, d) => d, set: () => {}}, profileId: 'p1'},
    'data/addons.js': {addons: opts.addons || [], catalogFetch: async () => ({metas: []}),
      fetchMeta: (...a) => { calls.meta.push(a); return (opts.fetchMeta || (async () => metadata))(...a); },
      fetchStreams: (...a) => { calls.streams.push(a); return (opts.fetchStreams || (async () => []))(...a); },
      supports: (...a) => opts.supports ? opts.supports(...a) : true},
    'data/availability.js': {setAvail: (...a) => calls.availability.push(a)},
    // the kids profile is off in these tests: nothing is filtered, no broadcaster link is held back
    'data/kids.js': {kidsOn: () => false},
    'data/reminders.js': {remindButton: () => '<button id="remind">remind</button>', wireRemind: () => {}},
    'data/watch.js': {progress: opts.progress || {}},
    // what the profile likes is learnt as it plays: nothing to learn in these tests
    'data/taste.js': {PLAYED: 3, noteTaste: () => {}},
    'data/catalogs.js': {SC_ID: 'sc'},
    'data/names.js': {srcName: () => '', typeName: () => ''},
    'data/services.js': {SERVICES: {}, noteServices: () => {}, svcDress: () => '', svcIcon: () => ''},
    'i18n.js': {tr},
    'providers/jfc.js': {JFC_LOBBIES: [], jfcCard: () => '', jfcLobby: async () => []},
    'providers/kan.js': {kanBox: () => { calls.kan++; return (opts.kan || (async () => []))(); }, kanCard: () => ''},
    'providers/mako.js': {makoPrograms: () => { calls.mako++; return (opts.mako || (async () => []))(); }, makoCard: () => ''},
    'providers/reshet.js': {r13: {}, r13row: () => { calls.r13++; return (opts.r13 || (async () => []))(); }, r13meta: (o, k) => o[k], r13card: () => ''},
    'ui/cards.js': {card: () => '', skeletons: () => ''},
    'ui/reel.js': {autoSpot: () => {}, reelable: () => false, nextEpisode: m => m?.videos?.[0]},
    'ui/player.js': {openPlayer: (s, label, ctx) => calls.plays.push({s, label, ctx})},
    'ui/torrent.js': {startBusy: () => {}, endBusy: () => {}},              // the busy card over the page: not what is tested here
  };
  if(!opts.realSources) stubs['ui/sources.js'] = {
    quickPick: (...a) => { calls.quick.push(a); return (opts.quickPick || (async () => ({s: stream})))(...a); },
    playStream: (s, label, ctx) => calls.plays.push({s, label, ctx}),
  };
  const context = vm.createContext({console, document: doc, location, window: {BoothAndroid: native}, BoothAndroid: native,
    alert: () => {}, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, CSS: {escape: s => s}});
  const modules = new Map();
  async function get(rel){
    rel = path.posix.normalize(rel);
    if(modules.has(rel)) return modules.get(rel);
    const def = stubs[rel];
    const m = def ? new vm.SyntheticModule(Object.keys(def), function(){ for(const [k, v] of Object.entries(def)) this.setExport(k, v); }, {context, identifier: rel})
      : new vm.SourceTextModule(await readFile(path.join(assets, 'js', rel), 'utf8'), {context, identifier: rel});
    modules.set(rel, m); return m;
  }
  async function load(rel){
    const m = await get(rel);
    if(m.status === 'unlinked') await m.link((s, ref) => get(path.posix.join(path.posix.dirname(ref.identifier), s)));
    if(m.status === 'linked') await m.evaluate();
    return m.namespace;
  }
  return {doc, app, box, alt, location, calls, clock, timers, load};
}

/* The half-watched banner these once covered is gone (0.41.1): what is half-watched is a title in
   its row like any other, and the episode to resume is chosen on the title's own page. */

// Source aggregation, deadlines, navigation and availability.
test('built-in sources run without any matching add-on and link to the program', async () => {
  const f = await fixture({realSources: true, kan: async () => kanResult}); const s = await f.load('ui/sources.js');
  await s.loadStreams(movie, 'movie', 'Test Show');
  assert.equal(f.calls.kan, 1); assert.equal(f.calls.mako, 1); assert.equal(f.calls.r13, 1);
  assert.match(f.box.innerHTML, /src.watchOn/); assert.doesNotMatch(f.box.innerHTML, /src.noAddon|src.none|src.searching/);
  f.box.querySelector('[data-i]').onclick(); assert.equal(f.location.hash, '#/kan/%2Fshow/Test%20Show');
  assert.equal(f.calls.availability.length, 0);
});
test('an empty add-on does not end the search before a late Mako result', async () => {
  const d = deferred(); const f = await fixture({realSources: true, addons: [addon], mako: () => d.promise});
  const s = await f.load('ui/sources.js'); const pending = s.loadStreams(movie, 'movie', 'Test Show'); await flush();
  assert.match(f.box.innerHTML, /src.searching/); assert.doesNotMatch(f.box.innerHTML, /src.none/);
  d.resolve(makoResult); await pending; assert.match(f.box.innerHTML, /mako/); assert.doesNotMatch(f.box.innerHTML, /src.searching/);
});
test('provider failure remains visible alongside another provider result', async () => {
  const f = await fixture({realSources: true, kan: async () => { throw Error('kan failed'); }, mako: async () => makoResult});
  const s = await f.load('ui/sources.js'); await s.loadStreams(movie, 'movie', 'Test Show');
  assert.match(f.box.innerHTML, /kan failed/); assert.match(f.box.innerHTML, /src.watchOn/);
  assert.ok(f.box.querySelector('#sretry')); assert.doesNotMatch(f.box.innerHTML, /src.none|src.searching/);
});
test('provider timeout settles loading once and discards a late result', async () => {
  const d = deferred(); const f = await fixture({realSources: true, kan: () => d.promise});
  const s = await f.load('ui/sources.js'); const pending = s.loadStreams(movie, 'movie', 'Test Show'); await flush();
  await f.clock.tick(15000); await pending;
  assert.doesNotMatch(f.box.innerHTML, /src.searching/); assert.match(f.box.innerHTML, /net.noResponse/);
  const writes = f.box.writes; d.resolve(kanResult); await flush();
  assert.equal(f.box.writes, writes); assert.equal(f.timers.size, 0);
});
test('direct autoplay does not wait for pending broadcasters', async () => {
  const d = deferred(); const f = await fixture({realSources: true, addons: [addon], fetchStreams: async () => [stream], kan: () => d.promise});
  const s = await f.load('ui/sources.js'); const pending = s.loadStreams(movie, 'movie', 'Test Show', true); await flush();
  assert.equal(f.calls.plays.length, 1); d.resolve(kanResult); await pending; assert.equal(f.calls.plays.length, 1);
});
test('last add-on completion permits torrent autoplay before broadcasters finish', async () => {
  const d = deferred(); const f = await fixture({realSources: true, native: true, addons: [addon], kan: () => d.promise,
    fetchStreams: async () => [{infoHash: 'hash', title: '720p\n\u{1F464} 10'}]});
  const s = await f.load('ui/sources.js'); const pending = s.loadStreams(movie, 'movie', 'Test Show', true); await flush();
  assert.equal(f.calls.plays.length, 1); assert.equal(f.calls.plays[0].native, 'torrent');
  d.resolve([]); await pending;
});
test('a program-only result never autoplays or receives a playable rank', async () => {
  const f = await fixture({realSources: true, kan: async () => kanResult}); const s = await f.load('ui/sources.js');
  await s.loadStreams(movie, 'movie', 'Test Show', true); assert.equal(f.calls.plays.length, 0);
  assert.equal(s.rank({external: true, direct: true}), -1);
});
test('episode A results cannot contaminate episode B even when B has no add-on', async () => {
  const d = deferred(); const f = await fixture({realSources: true, addons: [addon], supports: (_m, _r, _t, id) => id === 'A', fetchStreams: () => d.promise});
  const s = await f.load('ui/sources.js'); const first = s.loadStreams(movie, 'A', 'Test Show', true); await flush();
  await s.loadStreams(movie, 'B', 'Test Show', true); const writes = f.box.writes;
  d.resolve([stream]); await first;
  assert.equal(f.calls.plays.length, 0); assert.equal(f.box.writes, writes); assert.equal(f.calls.availability.length, 0);
});
test('missing streams element still invalidates the old request and lastStreams', async () => {
  const d = deferred(); const f = await fixture({realSources: true, addons: [addon], fetchStreams: () => d.promise});
  const s = await f.load('ui/sources.js'); const first = s.loadStreams(movie, 'A', 'Test Show', true); await flush();
  f.doc.ids.delete('streams'); await s.loadStreams(movie, 'B', 'Test Show'); assert.equal(s.lastStreams, null);
  d.resolve([stream]); await first; assert.equal(f.calls.plays.length, 0); assert.equal(f.calls.availability.length, 0);
});
test('same-route view invalidation stops stale source rendering and cache writes', async () => {
  const d = deferred(); const f = await fixture({realSources: true, addons: [addon], fetchStreams: () => d.promise});
  const s = await f.load('ui/sources.js'); const pending = s.loadStreams(movie, 'movie', 'Test Show', true); await flush();
  const redraw = s.lastStreams; (await f.load('core/requests.js')).invalidateView(); const writes = f.box.writes;
  d.resolve([stream]); await pending; redraw();
  assert.equal(f.box.writes, writes); assert.equal(f.calls.plays.length, 0); assert.equal(f.calls.availability.length, 0);
});
test('interleaved provider completion keeps every data-i bound to its correct target', async () => {
  const k = deferred(), m = deferred(), r = deferred();
  const f = await fixture({realSources: true, kan: () => k.promise, mako: () => m.promise, r13: () => r.promise});
  const s = await f.load('ui/sources.js'); const pending = s.loadStreams(movie, 'movie', 'Test Show');
  r.resolve(r13Result); await flush(); m.resolve(makoResult); await flush(); k.resolve(kanResult); await pending;
  const buttons = f.box.querySelectorAll('[data-i]');
  assert.deepEqual(buttons.map(b => b.dataset.i), ['0', '1', '2']);
  const routes = ['#/r13/13/Test%20Show', '#/mako/%2Fshow/Test%20Show', '#/kan/%2Fshow/Test%20Show'];
  for(let i = 0; i < buttons.length; i++){ f.location.hash = '#/'; buttons[i].onclick(); assert.equal(f.location.hash, routes[i]); }
});
test('stale rendered source buttons cannot navigate after the view changes', async () => {
  const f = await fixture({realSources: true, kan: async () => kanResult}); const s = await f.load('ui/sources.js');
  await s.loadStreams(movie, 'movie', 'Test Show'); const btn = f.box.querySelector('[data-i]');
  f.location.hash = '#/library'; btn.onclick(); assert.equal(f.location.hash, '#/library');
});
test('retry creates a new token and ignores the previous pending provider', async () => {
  const old = deferred(); let n = 0;
  const f = await fixture({realSources: true, kan: async () => { if(++n === 1) throw Error('retry me'); return kanResult; },
    mako: () => n === 1 ? old.promise : Promise.resolve([])});
  const s = await f.load('ui/sources.js'); const first = s.loadStreams(movie, 'movie', 'Test Show'); await flush();
  const token = s.streamsToken; const next = f.box.querySelector('#sretry').onclick(); await next;
  assert.equal(s.streamsToken, token + 1); const html = f.box.innerHTML; old.resolve(makoResult); await first;
  assert.equal(f.box.innerHTML, html);
});
for(const [name, opts, expected] of [
  ['all providers answered empty', {}, false],
  ['program page only', {kan: async () => kanResult}, undefined],
  ['add-on error', {fetchStreams: async () => { throw Error('failed'); }}, undefined],
  ['broadcaster error', {kan: async () => { throw Error('failed'); }}, undefined],
  ['playable evidence despite another provider error', {fetchStreams: async () => [stream], kan: async () => { throw Error('failed'); }}, true],
]) test(`availability cache: ${name}`, async () => {
  const f = await fixture({realSources: true, addons: [addon], ...opts}); const s = await f.load('ui/sources.js');
  await s.loadStreams(movie, 'movie', 'Test Show');
  // an empty answer from every add-on is sure (the title's own page asked them all in full)
  assert.deepEqual(f.calls.availability, expected === undefined ? [] : [expected ? ['movie:movie', true] : ['movie:movie', false, true]]);
});
test('missing content title does not launch irrelevant broadcaster searches', async () => {
  const f = await fixture({realSources: true}); const s = await f.load('ui/sources.js');
  await s.loadStreams({type: 'movie', meta: {id: 'movie'}}, 'movie', '');
  assert.equal(f.calls.kan + f.calls.mako + f.calls.r13, 0); assert.equal(f.calls.availability.length, 0);
});
test('empty broadcaster item names do not match every long title', async () => {
  const f = await fixture({realSources: true, mako: async () => [{name: '', path: '/wrong'}]}); const s = await f.load('ui/sources.js');
  await s.loadStreams(movie, 'movie', 'Test Show'); assert.equal(f.box.querySelectorAll('[data-i]').length, 0);
});

test('router invalidates asynchronous work before every view, including same-hash routes', async () => {
  const app = await readFile(path.join(assets, 'js/app.js'), 'utf8');
  assert.match(app, /export async function route\(\)\{\s*invalidateView\(\)/);
});


test('successful in-app report remains usable for another independent issue', async () => {
  const report = await readFile(path.join(assets, 'js/ui/report.js'), 'utf8');
  assert.match(report, /delete btn\.dataset\.busy/);
  assert.match(report, /input\.value = ''/);
  assert.match(report, /input\.focus\(\)/);
  assert.doesNotMatch(report, /btn\.remove\(\)[\s\S]{0,120}#\\\/settings\\\/about/);
});


test('Bubblegum colour scheme remains available in Settings', async () => {
  const settings = await readFile(path.join(assets, 'js/core/settings.js'), 'utf8');
  const tokens = await readFile(path.join(assets, 'css/tokens.css'), 'utf8');
  const i18n = await readFile(path.join(assets, 'js/i18n.js'), 'utf8');
  assert.match(settings, /id:\s*'bubblegum'/);
  assert.match(tokens, /data-skin="bubblegum"/);
  assert.match(tokens, /--tungsten:#ff4f9a/i);
  assert.match(i18n, /skin\.bubblegum\.name/);
});


test('M3U inline stream headers are stripped from URL and preserved as headers', async () => {
  const live = await readFile(path.join(assets, 'js/providers/live.js'), 'utf8');
  assert.match(live, /line\.split\('\|', 2\)/);
  assert.match(live, /headers\.get\('User-Agent'\)/);
  assert.match(live, /headers\.get\('Referer'\)/);
});


test('custom colours use VEO HSV picker and remain reachable by TV navigation', async () => {
  const settings = await readFile(path.join(assets, 'js/screens/settings.js'), 'utf8');
  const nav = await readFile(path.join(assets, 'js/ui/tvnav.js'), 'utf8');
  assert.doesNotMatch(settings, /input type="color"/);
  // a plane to move a point on (hue along, brightness up), and the saturation as a line under it (#105)
  assert.match(settings, /class="spectrum" tabindex="0"/);
  assert.match(settings, /type="range"[^>]*data-hsv="s"/);
  assert.match(settings, /paintSettings\('col:' \+ key\)/);
  assert.match(nav, /\.colorpickers/);
  assert.match(nav, /\.hsvrow/);
  assert.match(nav, /classList\?\.contains\('spectrum'\)/);          // the plane keeps its own arrows
});

test('the colour picker can be finished with the remote: OK and Cancel are reachable from the plane (#104)', async () => {
  const settings = await readFile(path.join(assets, 'js/screens/settings.js'), 'utf8');
  assert.match(settings, /data-done>/); assert.match(settings, /data-cancel>/);
  // Down from the plane's lower edge goes to the saturation, and from the saturation to OK
  assert.match(settings, /sat\.focus\(\); return; \}/);
  assert.match(settings, /e\.key === 'ArrowDown'\)\{ e\.preventDefault\(\); sheet\.querySelector\('\[data-done\]'\)\.focus\(\)/);
});


test('profile editor exposes visible focus states for avatar and name', async () => {
  const css = await readFile(path.join(assets, 'css/profiles.css'), 'utf8');
  assert.match(css, /\.avbtn:focus[^\{]*\{[^\}]*border-color:var\(--light\)/s);
  assert.match(css, /\.profhead \.field:focus[^\{]*\{[^\}]*box-shadow:/s);
});


test('the player names each remote key once: a second branch for a key is never reached (#102)', async () => {
  const kt = await readFile(path.join(repo, 'app/src/main/java/com/veo/player/PlayerActivity.kt'), 'utf8');
  const start = kt.indexOf('override fun dispatchKeyEvent');
  assert.ok(start > 0);
  const body = kt.slice(start);
  const seen = new Map();
  for(const m of body.matchAll(/^\s{12}((?:KeyEvent\.KEYCODE_\w+(?:,\s*)?)+)\s*->/gm))
    for(const key of m[1].split(',').map(k => k.trim()))
      seen.set(key, (seen.get(key) || 0) + 1);
  const twice = [...seen].filter(([, n]) => n > 1).map(([k]) => k);
  assert.deepEqual(twice, [], `keys handled by more than one branch of dispatchKeyEvent's when: ${twice.join(', ')}`);
});


/* ---------- machine translation into Hebrew (#96 #97 #98 #99) ---------- */
// A small loader for modules with few dependencies: real source for what is under test, stubs for the rest.
async function mini(entry, stubs, globals = {}){
  const context = vm.createContext({console, ...globals});
  const modules = new Map();
  const get = async rel => {
    rel = path.posix.normalize(rel);
    if(modules.has(rel)) return modules.get(rel);
    const def = stubs[rel];
    const m = def ? new vm.SyntheticModule(Object.keys(def), function(){ for(const [k, v] of Object.entries(def)) this.setExport(k, v); }, {context, identifier: rel})
      : new vm.SourceTextModule(await readFile(path.join(assets, 'js', rel), 'utf8'), {context, identifier: rel});
    modules.set(rel, m); return m;
  };
  const m = await get(entry);
  await m.link((s, ref) => get(path.posix.join(path.posix.dirname(ref.identifier), s)));
  await m.evaluate();
  return m.namespace;
}
const memStore = () => { const kept = {}; return {kept, store: {get: (k, d) => kept[k] ?? d, set: (k, v) => { kept[k] = v; }, lazy: (k, v) => { kept[k] = v; }, dirty: {}}}; };
/** A translator that answers like Google's: one segment per line, each [translation, original]. */
const gtx = (calls, fail) => async url => {
  calls.push(url);
  if(fail) throw new Error('429');
  const q = decodeURIComponent(url.split('&q=')[1]);
  const ls = q.split('\n');
  return JSON.stringify([ls.map((l, i) => ['HE:' + l + (i < ls.length - 1 ? '\n' : ''), l])]);   // a line break between segments, none after the last
};
const withTranslate = async (fetchText, clock = {t: 0}) => {
  const {store, kept} = (m => ({store: m.store, kept: m.kept}))(memStore());
  const mod = await mini('data/translate.js', {'core/bridge.js': {fetchText}, 'core/store.js': {store}},
    {Date: {now: () => clock.t}, encodeURIComponent});
  return {mod, kept};
};

test('machine translation skips Hebrew and known text, and asks once for the rest, a batch to a request', async () => {
  const calls = []; const {mod} = await withTranslate(gtx(calls));
  await mod.translateTexts(['The Wire', 'עבודה', 'The Wire', 'Lost']);
  assert.equal(calls.length, 1);                                   // one address holds both lines
  assert.equal(mod.known('The Wire'), 'HE:The Wire'); assert.equal(mod.known('Lost'), 'HE:Lost');
  assert.equal(mod.known('עבודה'), '');                            // Hebrew is not translated
  await mod.translateTexts(['The Wire', 'Lost']); assert.equal(calls.length, 1);   // reopening asks for nothing
});

test('a batch that does not come back line for line is not trusted', async () => {
  const {mod} = await withTranslate(async () => JSON.stringify([[['one line only', 'x']]]));
  await mod.translateTexts(['A', 'B']);
  assert.equal(mod.known('A'), ''); assert.equal(mod.known('B'), '');
});

test('a failed request leaves the words as they were and the service alone for a while', async () => {
  const calls = [], clock = {t: 1000}; const {mod} = await withTranslate(gtx(calls, true), clock);
  await mod.translateTexts(['A']); assert.equal(calls.length, 1); assert.equal(mod.known('A'), '');
  await mod.translateTexts(['B']); assert.equal(calls.length, 1);   // still cooling down
  clock.t += 91_000; await mod.translateTexts(['B']); assert.equal(calls.length, 2);
});

test('batches keep to what one address holds, in order', async () => {
  const {mod} = await withTranslate(gtx([]));
  const texts = Array.from({length: 40}, (_, i) => `Title number ${i} ${'x'.repeat(100)}`);
  const parts = mod.batches(texts, 1000);
  assert.ok(parts.length > 1); assert.equal(JSON.stringify(parts.flat()), JSON.stringify(texts));
  for(const part of parts) assert.ok(part.reduce((n, t) => n + encodeURIComponent(t).length + 3, 0) < 1000 + 200);
});

async function hebrewModule(getJSON, calls){
  const {store, kept} = (m => ({store: {...m.store, lazy: (k, v) => { m.kept[k] = v; }}, kept: m.kept}))(memStore());
  store.capMap = undefined;
  const stubs = {
    'core/dom.js': {getJSON},
    'core/settings.js': {isTvLayout: () => false, settings: {lang: 'he'}},
    'core/store.js': {store, capMap: o => o},
    'data/availability.js': {avail: {}, availKnown: () => true, availObserver: {observe(){}, unobserve(){}, disconnect(){}}},
    'ui/cards.js': {card: () => ''},
    'core/bridge.js': {fetchText: gtx(calls)},
  };
  class Obs { constructor(){} observe(){} unobserve(){} disconnect(){} }
  const doc = {body: {}, querySelector: () => null, querySelectorAll: () => []};
  return mini('data/hebrew.js', stubs, {document: doc, IntersectionObserver: Obs, MutationObserver: Obs, Date: {now: () => 5e12}, encodeURIComponent});
}

test('a Hebrew label from Wikidata beats the machine translation of a title', async () => {
  const he = await hebrewModule(async () => ({}), []);
  he.heCache.tt1 = {t: 'שם מוויקינתונים', w: '', mt: 'שם ממכונה'};
  he.heCache.tt2 = {t: '', w: '', mt: 'שם ממכונה'};
  assert.equal(he.heTitle('tt1', 'Original'), 'שם מוויקינתונים');
  assert.equal(he.heTitle('tt2', 'Original'), 'שם ממכונה');         // no label: the machine stands in
  assert.equal(he.heTitle('tt3', 'Original'), 'Original');
});

test('a plot: Hebrew Wikipedia first, then the machine, marked and with the original kept', async () => {
  const calls = [];
  const noArticle = async url => url.includes('list=search') ? {query: {search: []}} : {entities: {}};
  const he = await hebrewModule(noArticle, calls);
  const plot = await he.plotFor('tt9', 'A man walks into a bar.');
  assert.equal(plot.mt, true); assert.equal(plot.text, 'HE:A man walks into a bar.'); assert.equal(plot.original, 'A man walks into a bar.');
  assert.equal(calls.length, 1);
  assert.equal(await he.plotFor('tt9b', 'כבר בעברית'), null);       // already Hebrew: nothing to translate
  const withArticle = async url => url.includes('list=search') ? {query: {search: [{title: 'Q1'}]}}
    : url.includes('wbgetentities') ? {entities: {Q1: {labels: {he: {value: 'שם'}}, sitelinks: {hewiki: {title: 'שם'}}}}}
    : {query: {pages: {1: {extract: 'עלילה מוויקיפדיה'}}}};
  const he2 = await hebrewModule(withArticle, calls);
  const wiki = await he2.plotFor('tt7', 'English plot');
  assert.equal(wiki.text, 'עלילה מוויקיפדיה'); assert.ok(!wiki.mt);  // what people wrote comes first
  assert.equal(calls.length, 1);                                    // and no request was spent on the machine
});


test('kids are set per profile: no Kids page in Settings for a grown-up, the code is changed beside the profiles (#109)', async () => {
  const settings = await readFile(path.join(assets, 'js/screens/settings.js'), 'utf8');
  const profiles = await readFile(path.join(assets, 'js/screens/profiles.js'), 'utf8');
  const tabs = settings.match(/export const SETTINGS_TABS = \[([^\]]*)\]/)[1];
  assert.doesNotMatch(tabs, /'kids'/);                                     // nothing duplicating the profile's own page
  assert.match(settings, /KIDS_SETTINGS_TABS = \[[^\]]*'kids'[^\]]*\]/);   // a kids profile still has its way out
  assert.match(settings, /tab === 'kids' && !kidsOn\(\)\) tab = 'profiles'/);   // an old address lands on Profiles
  assert.doesNotMatch(settings, /kidsOn: async/);                          // the switch is the profile page's now
  assert.match(profiles, /hasPin\(\) \? section\('', lines\(line\(\{fid: 'kidsPin'/);
});


test('the colour plane: OK goes on to the saturation, and from there to OK - Up/Down are the brightness (#115)', async () => {
  const settings = await readFile(path.join(assets, 'js/screens/settings.js'), 'utf8');
  assert.match(settings, /if\(e\.key === 'Enter'\)\{ e\.preventDefault\(\); e\.stopPropagation\(\); sat\.focus\(\); return; \}/);
  assert.match(settings, /e\.key === 'ArrowDown' \|\| e\.key === 'Enter'\)\{[^}]*\[data-done\]'\)\.focus\(\)/);
  assert.match(settings, /data-cue/);                                        // and the screen says what OK does here
});
