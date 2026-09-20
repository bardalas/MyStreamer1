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
    'core/store.js': {store: {get: (_k, d) => d, set: () => {}}},
    'data/addons.js': {addons: opts.addons || [], catalogFetch: async () => ({metas: []}),
      fetchMeta: (...a) => { calls.meta.push(a); return (opts.fetchMeta || (async () => metadata))(...a); },
      fetchStreams: (...a) => { calls.streams.push(a); return (opts.fetchStreams || (async () => []))(...a); },
      supports: (...a) => opts.supports ? opts.supports(...a) : true},
    'data/availability.js': {setAvail: (...a) => calls.availability.push(a)},
    'data/reminders.js': {remindButton: () => '<button id="remind">remind</button>', wireRemind: () => {}},
    'data/watch.js': {progress: opts.progress || {}},
    'data/catalogs.js': {SC_ID: 'sc'},
    'data/names.js': {srcName: () => '', typeName: () => ''},
    'data/services.js': {SERVICES: {}, noteServices: () => {}},
    'i18n.js': {tr},
    'providers/jfc.js': {JFC_LOBBIES: [], jfcCard: () => '', jfcLobby: async () => []},
    'providers/kan.js': {kanBox: () => { calls.kan++; return (opts.kan || (async () => []))(); }, kanCard: () => ''},
    'providers/mako.js': {makoPrograms: () => { calls.mako++; return (opts.mako || (async () => []))(); }, makoCard: () => ''},
    'providers/reshet.js': {r13: {}, r13row: () => { calls.r13++; return (opts.r13 || (async () => []))(); }, r13meta: (o, k) => o[k], r13card: () => ''},
    'ui/cards.js': {card: () => '', skeletons: () => ''},
    'ui/reel.js': {autoSpot: () => {}, reelable: () => false, nextEpisode: m => m?.videos?.[0]},
    'ui/player.js': {openPlayer: (s, label, ctx) => calls.plays.push({s, label, ctx})},
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
  assert.deepEqual(f.calls.availability, expected === undefined ? [] : [['movie:movie', expected]]);
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
