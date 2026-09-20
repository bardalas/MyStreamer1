# VEO — Android & Android TV media app

## Overview
Android/Android TV frontend for Stremio-compatible add-ons (Cinemeta, Torrentio, and others the
user installs), with native Media3/ExoPlayer playback and a built-in BitTorrent engine (FrostWire
jlibtorrent). Hebrew RTL UI. Formerly named **המקרן / HaMakren / "Booth"** — renamed to **VEO** in
0.33.0 (see `CHANGELOG.md`); `applicationId` changed `com.booth.player` → `com.veo.player` as part
of that rename, done pre-launch so it is a clean switch, not an in-place update path.

The whole UI is one WebView (`booth.html`) talking to a thin native layer over a JavaScript
bridge (`window.BoothAndroid` — **the bridge object's name was deliberately left unrenamed**, see
Gotchas). Native code exists only where the WebView cannot do the job itself: video/DRM playback,
torrent downloading, and a local HTTP file server to feed the torrent data to ExoPlayer.

## Files
- `app/src/main/assets/booth.html` (~2,900 lines) — **the entire app**: UI, routing, all catalog/
  streaming-source integrations (Stremio protocol, Kaltura OTT for Reshet 13, `__NEXT_DATA__`
  scraping for mako, Kan, the Israeli Film Archive), Hebrew title/plot lookup (Wikidata +
  Wikipedia), subtitle matching, settings, and the TV remote navigation model. One `<html>` file,
  three inline `<script>` blocks, no build step — edit it directly and reload.
- `app/src/main/java/com/veo/player/`
  - `MainActivity.kt` — hosts the WebView, the `BoothAndroid` JS bridge (play/torrent/subtitle/
    fetch-proxy/update calls), in-app self-update (download + hand off to the system installer).
  - `PlayerActivity.kt` — ExoPlayer screen: VOD, live TV with channel zapping, the info banner
    (channel + EPG "now/next"), the on-screen error panel, Hebrew subtitle rendering.
  - `BrowserActivity.kt` — a plain in-app browser window for broadcaster sites the WebView can't
    embed directly (mako, Kan BOX, the Israeli Film Archive's own player).
  - `TorrentEngine.kt` — wraps jlibtorrent: sequential/prioritized piece download so playback can
    start before the file finishes.
  - `StreamServer.kt` — a local `http://127.0.0.1` server that serves the (partially) downloaded
    torrent file to ExoPlayer as a normal HTTP range-requestable resource.
  - `Subtitles.kt` — Hebrew subtitle lookup (Wizdom, OpenSubtitles) matched against the release
    name, downloaded and handed to ExoPlayer as a side-loaded track.
- `.github/workflows/build-apk.yml` — the only build path that produces a signed APK (see
  Building). Also builds an unsigned debug APK with x86_64 torrent natives for PC emulator testing.
- `tools/setup-tv-emulator.ps1` — one-shot Windows setup for a local Android TV emulator (SDK
  command-line tools + an Android TV x86_64 image), so the app can be tested without a real box.

## Architecture

### The WebView/native split
`booth.html` owns all UI and business logic. It calls into Kotlin only for what a WebView
genuinely cannot do:
- `playUrl` / `playTorrent` / `playLive` / `playChannels` / `playDrm` / `playVod` — hand a stream
  to `PlayerActivity`.
- `fetchText` — a fetch proxy for the JS side, used where a site's CORS policy or a custom
  User-Agent/Referer would block a direct `fetch()` from the page.
- `isTv` — tells the page whether this is a television (drives `IS_TV_DEVICE` in booth.html; the
  D-pad navigation model is gated on this, not on the *chosen layout* — see Gotchas).
- `updateApp` — downloads a new release APK with progress reported back through the same status
  card the torrent engine uses, then launches the system package installer.
- `openSite` / `openExternal` / `openYouTube` / `showKeyboard` / `cancelTorrent`.

### Interface language and direction (`booth.html`)
The app's own text is `STRINGS.he` / `STRINGS.en` (one flat table per language, in the `<script>` that
follows the static markup) read through `tr(key, vars)`; static markup uses `data-i18n`,
`data-i18n-ph` and `data-i18n-aria`. `settings.uiLang` picks the language; it also sets `<html lang dir>`,
so layout follows (`dirOf`). `missingStrings()` in the console lists keys one language lacks. Adding a
language = one table + one row in `UI_LANGS`. **Never name anything `t`** in new code that also calls
`tr()`; the file has many local `t` variables (that is why the function is `tr`).
`NAMES` holds names of things add-ons describe in English (genres, types, catalogues): shown as they
come unless a table has them. `settings.lang` is a different thing: Hebrew vs original *titles and
summaries* from Wikidata. CSS mirrors physical offsets with `--flip` (1 in RTL, -1 in LTR); the D-pad
"forward" key is `FWD()` (ArrowLeft in RTL). Still Hebrew-only: the Channels/Live TV pages, the library
and search pages, the native player's strings and status messages.

### Browsing model (`booth.html`)
The rail lists *collections* (All, Movies, Series, and `CATEGORIES`: Israeli, Kids, Documentaries); the
pills on every page (`SORT_GROUPS`: Genre, Year, Rating, Sort) *refine* the current collection. When any
pill is on, `gridFrom()` shows one ranked grid and states how many titles, how sorted and from which
sources; a genre also pulls Cinemeta's popular/top-rated titles of that genre (`withGenreRows`). Rows carry
a small tag (`rowTag`): type and source, or the services merged into the row. Genres are not a page any
more (`viewGenre` just sets the filter, for old links).

### Title page and the TV screen
On the TV a series page never scrolls the page (`body.titlefit`): the header keeps its size and the
episode list fills the rest, scrolling inside itself. Play, the quality shortcuts, library and trailer are
one row (`.playrow`, one D-pad row); the long source list opens under it (`#palt`). A menu column
(`.seasonbar`, `.stabs`) no longer traps Up/Down at its ends: they lead to the row above/below.

### Boot sequence (`booth.html`, bottom of the file)
`boot()`: starts loading add-ons, races them against a 6-second timeout, renders the route with
whatever answered in time, and — if add-ons were still loading — re-renders home once they finish
so a slow add-on doesn't leave the home screen permanently empty. Then schedules `loadServices`
(streaming-service availability badges) and the update check.

### TV remote navigation model (`booth.html`, search `ROWS_SEL` / `tvRows` / `tvMove`)
There is no native focus system in a WebView, so one is built from scratch:
- `ROWS_SEL` is the single list of CSS selectors for every "row" the D-pad can stand on, grouped
  by screen in a comment. **Any new focusable control must be inside one of these, or the D-pad
  cannot reach it** — this was the single largest source of navigation bugs during development.
- `tvRows()` collects matches, keeps only the *innermost* match when one matched element contains
  another (so a wrapper accidentally also matching a selector can't break its child's row), and
  returns them in **document order** (not visual/CSS order — see Gotchas for why).
- `tvMove(dir)` moves within a row on Up/Down by checking whether any item sits on a different
  visual line than the active one; if none does (a genuinely horizontal strip), it falls through
  to "next row". This one check correctly handles horizontal strips, vertical lists, and grids
  without needing to special-case which kind a row is.
- A "column" row (`.stabs`, `.seasonbar`, the category rail) is handled separately: Up/Down pick
  an entry *and open it*, Left/Right step into what the column controls (via `data-pane` on the
  row, e.g. `data-pane="#eps"`).
- `isTvLayout()` gates the whole system: `IS_TV_DEVICE || settings.layout === 'tv'`. The **device**
  check must never be removed — see Gotchas.

### Live TV (`PlayerActivity.kt`)
Channel data (`Source`) carries `num`/`logo`/`epg` (a per-channel EPG endpoint URL) sent from
`booth.html`'s `watchChannel()`. The info banner (`showBanner`/`paintBanner`/`paintNow`) shows the
channel, current programme with a progress bar, and what's next, refreshing every 30s while up.
Live playback sets `view.useController = false` (the controls would steal the D-pad), so every key is
handled in `dispatchKeyEvent`:
- **Up/Down** raise the banner and page through the channels *in the banner* (`browseBy`): the banner
  describes the channel pointed at (`shownIndex`), the video does not change; **OK** tunes to it,
  Back cancels, and paging left alone ends after 12s.
- **Hold OK** opens the channel list, a floating `ListView` over the picture (`chPanel`); OK on a row
  tunes, holding OK on a row opens that channel's catch-up. OK is decided on *release* (`okLong`) so a
  hold never also fires the short action.
- **CHANNEL_UP/DOWN and PAGE_UP/DOWN** switch straight away (up = the next number).
- **Play/Pause** pauses; **Left/Right** (and REWIND/FAST_FORWARD) step 10s back/forward, held = 60s. A
  live stream can only go back as far as its DVR window.

### Torrent playback
`TorrentEngine` reports *JSON phases* (`{"p":"buffer","peers":..,"got":..,"need":..}`) and failures as
`e:<code>`; the page words them (`torrentText` in `booth.html`) so the language stays the page's job.
The status bar is shown only for waits over ~0.9s. Sources are ranked in `rank()` with a penalty for big
files, because a stream starts when the first *piece* has arrived and pieces grow with the file.
The metadata comes from `fetchMagnet`, which drops the magnet's trackers — they are re-added to the
handle after `session.download`, otherwise the download finds peers through DHT alone.
**Start-up focus (the big one):** until the first pieces are in, `bufferStart` gives every other piece
priority 0 (`prioritizePieces`), then restores the file priorities. Left alone, libtorrent hands each of
dozens of slow peers a piece of its own and the *first* piece completes last: a 2 MB piece took 40-80s
with ~10 MB already downloaded. Focused, the same titles start in 6-8s on the emulator. Timeouts
(`request_timeout`, `piece_timeout`) made no difference; do not spend time there again.

### Torrent playback path
`TorrentEngine` downloads sequentially/prioritized starting from the requested byte range;
`StreamServer` exposes the partial download over local HTTP so ExoPlayer can play it like any
other HTTP source, with range requests satisfied as data arrives.

## Building and debugging locally
Gradle 9.6.0 + Android Studio's bundled JDK build the debug APK (`gradle --no-daemon :app:assembleDebug`);
`local.properties` needs `sdk.dir` with **forward slashes**. Debug builds enable WebView remote debugging:
`adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>` then attach chrome://inspect or the
DevTools protocol to see focus, DOM and console of the real TV screen.

## Building
CI is the only supported build path (it holds the release signing secrets):
```
git push origin main          # unsigned-artifact test build
git tag vX.Y.Z && git push origin vX.Y.Z   # signed release + GitHub Release
```
`versionName` in `app/build.gradle.kts` must match the pushed tag (`v$versionName`) or CI fails
the build deliberately. `versionCode` convention: `major*10000 + minor*100 + patch`.

No Gradle wrapper is committed (CI provisions Gradle 9.6.0 + JDK 17 itself via
`gradle/actions/setup-gradle`). To build locally you need your own JDK 17, Gradle, and an Android
SDK with `compileSdk 36` — none of that was present on this machine as of the VEO rename; nothing
below "structural checks + booth.html JS syntax via a real JS engine" was verified locally for
that change. `tools/setup-tv-emulator.ps1` provisions an SDK (command-line tools + an Android TV
system image) for local testing in an emulator; it does not by itself give you a build toolchain
for `gradle assembleRelease` (no signing secrets exist outside CI anyway).

## Known gotchas (hard-won — re-breaking these is easy)

- **`visible()` cannot use `offsetParent`.** `offsetParent` is `null` for every
  `position:fixed` element per spec, even when plainly on screen. Three UI pieces are
  `position:fixed` (the category rail, the update card, the torrent-status card); an
  `offsetParent`-based visibility check silently makes all of them unreachable by the D-pad. The
  current `visible()` uses a `getBoundingClientRect()` size check instead — keep it that way.
- **`inset-inline-start`/`-end` are direction-relative, not "left/right".** In this RTL page,
  `inset-inline-end: 0` pins to the **left**. Getting this backwards was a real, shipped bug (the
  category rail on the wrong side). When something needs to sit on a physical side regardless of
  direction, verify against `dir="rtl"` explicitly, don't assume.
- **A `<select>` traps the D-pad.** The keydown handler deliberately lets Up/Down through to the
  native listbox when focus is on a `<select>`, so there is no way to *leave* it via D-pad — this
  directly conflicts with "Up/Down moves between rows" everywhere else in the app. Every
  multi-choice picker in the TV UI (season, live-channel group filter) is a row of buttons, not a
  `<select>`, for exactly this reason. Don't reintroduce a native `<select>` into any TV-reachable
  screen.
- **CSS `order` breaks document-order-based row sequencing.** `tvRows()` used to sort by
  `getBoundingClientRect().top`, which shuffled the moment a sticky top bar (which always reports
  `top: 0` regardless of scroll) was scrolled past — Up jumped to the top menu instead of paging
  up a long list. Panels that need a different visual order (e.g. "watching" before "episodes" on
  a title page) are ordered correctly in the **markup** instead, and `tvRows()` stays in plain
  document order. Do not swap this back to a position-based sort without solving the sticky-header
  problem first.
- **`isTvLayout()` must check the device, not the chosen layout.** It used to be
  `settings.layout === 'tv'` alone — picking "Poster wall" or "List" on an actual television
  silently turned off all D-pad navigation. `IS_TV_DEVICE` (from `BoothAndroid.isTv()`) covers the
  real device; `settings.layout === 'tv'` alone is kept only so the TV nav model can be exercised
  from a desktop browser during development.
- **Kotlin string templates must be plain `$`.** A file once contained `${'$'}{x}` (from a shell heredoc)
  which prints literally: the live banner showed "src.num" and the updater's FileProvider authority was
  wrong. Grep for `'$'` after generating Kotlin from a script.
- **`web.requestFocus()` on a WebView that already has focus steals it**: it re-picks the first focusable
  element and took the caret out of the search box. `showKeyboard()` only requests focus when it has none.
- **A row counts for the D-pad only if something in it is visible** (`tvRows`): a row whose only focusable
  is hidden would swallow Down.
- **`window.BoothAndroid` was deliberately left unrenamed** during the VEO rebrand. It's called
  from hundreds of sites across `booth.html`; renaming it is a pure mechanical risk (JS bridge
  calls fail silently at runtime, not at compile time) for zero user-visible benefit, since it's
  never seen by anyone. Leave it as `BoothAndroid` unless there's an actual reason to touch it.
- **A `Runnable` that reschedules itself needs an explicit type.** Kotlin can't infer the type of
  a `val` initializer that references the `val` being defined (self-referential lambda) — declare
  it as `val x: Runnable = Runnable { ...; handler.postDelayed(x, ...) }`.
- **Only one `companion object` per class.** Trivial, but easy to introduce by patching in a new
  block without checking whether one already exists (as happened once with `PlayerActivity`).
- **GitHub's release-asset URLs redirect, sometimes across protocol.** `HttpURLConnection` will
  not follow a redirect that changes protocol; the in-app updater follows redirects itself
  (capped at 5 hops) rather than relying on `setInstanceFollowRedirects(true)`.
- **The legacy add-on URL filter in `booth.html` (`defaultsRev` migration, search
  `raw.githubusercontent.com/bardalas/MyStreamer1`) must keep the *old* repo name.** It matches a
  URL that is actually stored in existing installs' `localStorage` from before the rename — it is
  describing historical data, not a live pointer, and renaming it to `VEO` would break the
  migration for anyone upgrading from a pre-rename build.
