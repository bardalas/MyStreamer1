# VEO Android changelog

## 0.39.0 — 2026-09-20
- **The app has a shape.** What was one four-thousand-line page is now a stylesheet per layer and
  forty small modules in `core / data / providers / ui / screens`, with one file on top that says
  what the app is made of. Nothing is global any more: what one part needs from another it asks for
  by name, and `tools/rewire.py` writes every one of those lines from what the code actually uses -
  so moving a function between files can no longer leave a stale reference behind. On the Android
  side the off-screen window that reads a broadcaster's site, and the skin the player wears, left the
  activities they were lodged in. Nothing about the app changed while this happened - which is the
  point - but everything after it is easier to get right.
- **Moving through the app is quicker on a television**: titles no longer arrive one animation at a
  time, the page jumps to where the remote went instead of gliding there, and the marker is measured
  after the page has moved, so it lands on the thing it is around.
- **Coming out of a title waits for the list to come back** - however long its rows take - and then
  lands on the title you opened.
- **Left, from the side menu, lands on the titles**, not on the pills above them.
- **The taste**: half a minute rather than ten seconds, with subtitles, without the quality being
  forced down (which is what made it stall), and starting a moment after the artwork.
- The name of the subtitle file is no longer announced over the film.

## 0.38.0 — 2026-09-20
- **A film starts much sooner.** The torrent is added to the session once and kept: until now its details
  were fetched in a session of their own, thrown away, and the download then looked for every peer a
  second time - most of the wait before a film began. It also starts on the first piece under the
  opening rather than on a minute and a half of it.
- **Running through a film.** Holding an arrow runs the banner forward - slowly at first, then minutes at
  a time - while the picture keeps playing underneath, and the film is taken there once, when the key is
  let go. A jump lands on the nearest picture the file starts from, and asks the swarm for the pieces
  where it landed. One press is half a minute; several presses in a row are one jump, not ten.
- The banner of a film no longer brings the player's own controls up with it, and its times read left to
  right on a right-to-left screen.
- **The taste has sound**, lasts ten seconds and does not repeat.
- **Subtitles**: their size can be set from the same panel (Up while a film plays), alongside the
  translation and the sync.
- The marker keeps up with the remote now instead of gliding after it.
- A channel card is the channel: the catch-up button is gone from it (holding OK on a channel still opens
  its guide), so walking the list no longer walks through a button on every card.
- **Catch-up on RaspberryTV**: the app asks the service which spelling of the archive it answers to, the
  first time the channel list is opened, and remembers it - instead of guessing at the moment of playing.

## 0.37.0 — 2026-09-20
- **The app has an address.** Until now its page was opened as a file, which is why YouTube refused to
  play anything inside it ("error 153"). It is now served to itself over https, so **trailers and the
  taste behind a title actually play**, and add-ons that turned away a request with no origin answer it.
  Everything kept on the device - library, watch history, settings, the RaspberryTV key - is carried over
  the first time the new version runs.
- **Movement.** The app moves now: the marker slides from one thing to the next instead of blinking
  somewhere else, screens arrive from just below themselves, titles are dealt out one after another, the
  side menu spreads open instead of jumping, and a press gives a little under the finger. A television
  gets all of it (only transform and opacity are animated, which its GPU carries), and whoever asked
  their system for less motion still gets none.
- **Playing and choosing are two things.** The blue button plays; the quality pills only say in what
  quality, and the one in use wears the accent. Choosing an episode watches it, at that quality.
- **A title with nothing to watch says so** instead of offering a button that fails: sources nobody is
  sharing are listed as weak, never as "play", and such a title is dimmed in the lists (on the television
  too, which never checked before). "Remind me when a source appears" keeps it on a list that is looked
  at when the app starts, and the first title that became watchable announces itself.
- Each streaming service is its **own app icon** beside the title - small, square, on its own colour.
- **Live TV is a wall of channels**, each with its logo, number and what is on now, instead of a table.
- **In the player**: up and down change the channel at once; left and right walk the channel's archive in
  the banner and OK tunes to what it stopped at; holding them runs inside what is playing. A film has the
  same banner - where you are, and how much is left - and **jumping forward in a film is quick**: a jump
  now cancels the old queue and asks the swarm for the pieces where you landed.
- The programme guide loads three channels at a time and is kept for half an hour.
- Settings: themes are a list you read down, and the layouts differ - Wall hides every title until you
  arrive on it, List gives each title a line of its own.
- A card over the picture (an update, a source opening) keeps the remote inside it until it is answered.
- **Coming out of a title lands where you were** - the same place in the list, on the very title you opened.
- **Faster.** A catalogue the app already has is shown at once and refreshed quietly behind it, so a screen
  that was open before comes back without the network; sources are remembered for ten minutes, so a title
  opened twice answers immediately.

## 0.36.0 — 2026-09-20
- **Kan, inside VEO.** Kan's site turns plain requests away, so the app now opens its pages in a browser
  window of its own and reads them there: כאן BOX arrives as rows of programmes, a programme opens on its
  seasons and episodes, and an episode plays in VEO's player instead of sending you to the website.
- **A title card that watches.** On a series the card now offers the episode you are up to ("עונה 1 פרק 3")
  and plays it; the second button goes to all the episodes and seasons - two buttons, two different places.
- **A taste where the artwork was**: opening a title starts its trailer behind the words, on the card and on
  the page, at the quality that starts fastest.
- **A trailer stays here.** It plays inside VEO; only if YouTube refuses to embed it does a button offer to
  open it there.
- Each streaming service is now its own logo beside the title, instead of two letters.
- **Subtitles**: a panel (Up, while a film plays) to choose which translation is shown and to move it half
  a second at a time until it fits the picture.
- **A film opens on the film** - no controls in the way until you ask for them.
- **Live TV, the way a television behaves**: up is the next channel, and left/right are mirrored with the
  writing - a press steps to the programme before or after in the archive, holding them runs inside what is
  playing, and the bar in the banner says where you are. A programme that will not open is retried at the
  other addresses the service might use for its archive.
- The programme guide is fetched a few channels at a time, with a short patience, and kept for half an hour:
  opening the channel list is no longer a wait.
- On a phone: a title opens on its poster, name and Play - not on half a screen of artwork - and the update
  card no longer squeezes its buttons into eggs.

## 0.35.0 — 2026-09-20
- **A featured title** takes the top of the home screen and of every collection: a different one on each
  visit, with its year, rating and genres, and - when the title came with a trailer - a quiet taste of it
  playing behind the words. The taste is only shown once it is really playing, so a trailer that cannot be
  embedded leaves the artwork alone; it can be turned off in Settings → Startup & viewing.
- A screen left open for a quarter of an hour draws itself again when you come back to it, with fresh
  titles and another featured one.
- **More sources.** ThePirateBay+ and WatchHub are installed alongside Torrentio. A source nobody is
  seeding right now is listed last instead of being hidden - that alone is why Curiosity Stream and other
  rarities looked unplayable - and a title that is only on a subscription service now offers to open it
  there ("Watch on …") instead of saying there is nothing.
- The service a title streams on is a small mark beside its name, in the service's own colour, instead of
  a label over the artwork, and a Service filter joins the pills: choosing one brings in that service's
  own catalogue.
- **Live TV catch-up**: with the banner up on a channel that keeps an archive, left and right walk through
  its programmes and back to the live edge.
- The lines explaining which key does what are gone from the player.
- On a phone: an add-on's description no longer widens the page, the search takes its own line on narrow
  screens, and a large system font no longer stretches the text out of its boxes.

## 0.34.3 — 2026-09-20
- The side menu rests as a narrow column of marks, one per collection, and opens into the full menu
  when the pointer or the remote arrives on it. It opens over the page instead of pushing it, so
  nothing moves under you.

## 0.34.2 — 2026-09-20
- A film watched to the end carries a tick in the corner of its poster and steps out of "continue
  watching"; one left in the middle carries a bar showing how far it got, and how long is left.
  What was watched used to be forgotten the moment it finished; the newest 400 videos are kept now.

## 0.34.1 — 2026-09-20
- The update card says a new version is out and offers it, and nothing else: what changed belongs in
  the release notes, not on the television.
- Updating from inside the app works again. 0.33.0 handed the downloaded file to Android's installer
  under a provider name it never filled in, so the install never started ("couldn't find meta-data for
  provider with authority $packageName.files"); 0.34.x has to be installed by hand once.

## 0.34.0 — 2026-09-20
- **Interface language**: every word the app itself writes now comes from a per-language table, with
  Hebrew and English to choose from (Settings → Startup & viewing). The layout direction follows the
  language, including the remote's Left/Right and the live channel list, which keeps to the side the
  layout runs from. Still Hebrew-only: the Channels and Live TV pages, the library and search.
- **Browsing**: the side rail lists collections (All, Movies, Series, Israeli, Kids, Documentaries) and
  genres became a filter instead of a second, overlapping branch. Genre, years, rating and sorting are
  pills on every listing; a filtered listing is one ranked grid that says how many titles it holds, how
  they are sorted and which sources they came from. Rows carry their type and source, and each poster
  shows its IMDb score beside the title.
- **A title's page** fits a television screen: play, the quality shortcuts, the library and the trailer
  in one row, and a series' episodes in a single column that fills the rest of the screen without
  scrolling the page.
- **Torrents start in seconds instead of a minute or more.** The engine used to let every peer work on a
  different piece, so the first one finished last; it now wants only the beginning of the file until
  playback can start. Sources with smaller, well-seeded files rank higher, and the status is a slim bar
  that only appears when the wait is noticeable.
- **Live TV**: Up/Down page through the channels in the banner (nothing changes until OK), holding OK
  opens the channel list over the picture, the channel keys switch straight away, and the play/pause key
  pauses with Left/Right stepping back and forth.
- **A VEO skin**, taken from the icon's own blues, is the default; the player's banner and channel list
  follow the chosen skin. The launcher icon has more room around the mark, and Android TV's home screen
  shows the VEO logo.
- Fixes: search works with the remote again; Down from the top menu no longer lands in the search box;
  the live banner showed "src.num" instead of the channel number; leaving a torrent while it was loading
  could close the app.

## 0.33.0 — 2026-09-20
- Renamed from המקרן (HaMakren / "Booth") to **VEO**: app label, in-app header mark and icon
  (adaptive + legacy launcher icons regenerated from the approved VEO media kit), release
  artifact names, and every in-app reference to the app's own name.
- Application ID changed `com.booth.player` → `com.veo.player` (pre-launch, so this is a clean
  rename rather than an in-place update — anyone on an old build reinstalls as a separate app).
- Repo layout unchanged otherwise; the functional color scheme (amber/gold accent, dark theme)
  was deliberately **not** touched in this pass — only the name and the launcher/header icon.

## 0.21.0 — 2026-09-20
- Remote: arrows jump between titles and rows (the page follows the focus) instead of scrolling.
- The projector logo resumes the last live channel watched.
- Live TV player: OK opens a channel bar (channel list + hints), OK again switches channel;
  play/pause pauses the live stream; holding OK opens that channel's catch-up guide in the app.

## 0.20.1 — 2026-09-20
- Search stays in the top row next to the menu (it shrinks instead of dropping to its own row).
- Smaller posters (default 132, small 104, large 168); the TV layout no longer enlarges them.

## 0.20.0 — 2026-09-20
- Content first: no per-service categories. Home = popular films / series, new films / series on the
  streaming services (merged), then Israeli, comedy, kids, documentaries. Each title appears once per page.
- Streaming service shown as a badge on the poster and as "available on" in the quick view and title page.
- Android TV speed: posters load only when near the screen; at most 24 titles per row and 10 rows on
  the home screen; no background source checks and fewer lookups on TV; no animations.
- Remote: search fields no longer pop up the keyboard when focus passes over them — press OK to type;
  Back closes an open panel before leaving the page; the remote's Search key jumps to search.

## 0.19.0 — 2026-09-19
- Keshet 12 from mako.co.il instead of YouTube: all 654 programmes with genre chips (reality, docu,
  drama, comedy, cooking, news) and search; programme pages with seasons and sections
  (episodes / specials / sketches). Episodes open on mako's own page and player in an in-app window.
- In-app site window (full-screen video, DRM via WebView) — also offered for Kan BOX when Kan's
  site turns the app's requests away, instead of YouTube.
- YouTube removed from the Channels area and the kids category.

## 0.18.1 — 2026-09-19
- Fix: Keshet 12 and Kan (YouTube fallback) showed no shows on phones. YouTube sent its mobile site to
  the app's phone user-agent; YouTube requests now ask for the desktop page, and the parser also
  understands the mobile page format.

## 0.18.0 — 2026-09-19
- The app is now called **המקרן**, with a projector icon (adaptive icon incl. themed/monochrome,
  legacy icon for Android 7) and an Android TV home-screen banner; projector logo in the app.
- Films & series: no banner; tapping a poster opens a quick view under the row (backdrop,
  Hebrew title, rating, year, genres, Hebrew synopsis). Tapping it again opens the title.
- Android TV: focus lands on the page so the remote works at once; releases also carry a fixed-name
  HaMakren.apk for a permanent download link.

## 0.17.0 — 2026-09-19
- New "ערוצים" area in the top menu, separate from films & series: one tab per broadcaster
  (כאן 11 · רשת 13 · קשת 12), each with its own sections and a "▶ שידור חי" button.
  Kan shows all its BOX sections; Reshet recently aired + all shows; Keshet via its official YouTube.
- Broadcaster rows removed from the films & series categories.
- Kan: when the site turns the app away (Cloudflare 403), fall back to Kan's official YouTube channel;
  episode playback sends Kan's site as referer, like its own player.

## 0.16.0 — 2026-09-19
- Kan BOX (kan.org.il) in ערוצי הטלוויזיה: דרמה, קומדיה וסאטירה, דוקו ריאליטי, בידור, סרטים, דוקו —
  programme pages with seasons and episodes; episodes play in the app (plain HLS from Kan's CDN).
  Kan comedy and documentary sections also appear in the קומדיה and תיעודי categories.
- Native page fetches send browser-like headers (Kan rejects the default Java agent).
- Keshet 12 stays on its official YouTube channel: mako.co.il is behind bot protection.

## 0.15.0 — 2026-09-19
- Reshet 13 VOD (13tv.co.il) in ערוצי הטלוויזיה: "שודר לאחרונה" and all 293 shows, show pages with
  seasons and episodes; episodes play in the app (DASH + Widevine, licensed by Reshet's own
  Kaltura licence server, as on the website).
- Reshet 13 live channels in Live TV: רשת 13, ערוץ הקומדיות, ריאליטי, ערוץ הנופש.
- Player: DASH and Widevine support.

## 0.14.0 — 2026-09-19
- New categories: ערוצי הטלוויזיה (official Kan 11 / Keshet 12 / Reshet 13 YouTube: latest videos
  and shows), קומדיה (popular, best-rated, Israeli comedy films and series), ילדים (Kan Kids,
  animation, family). Israeli category adds Israeli comedies.
- Shows open as an episode list; episodes play in the YouTube app.
- Genres page with big genre tiles (replaces the dropdowns).
- Settings: start screen (films & series / live TV), kids mode, and which home categories to show
  and in what order.

## 0.13.1 — 2026-09-19
- Live TV: when a channel fails, retry automatically (twice, 3 s apart) — IPTV servers may still
  count the previous channel's session. Short pause between channels when zapping.
- If a channel still fails, the error stays on screen with the HTTP status and reason.
- Long press on a channel (or hold OK on a remote) opens catch-up: the week's programme guide.

## 0.13.0 — 2026-09-19
- Simple Live TV mode: top menu is now סרטים וסדרות | שידור חי | הספרייה | הגדרות.
  Live TV is a channel list (number, logo, name, what's on now + progress) with
  "▶ המשך לצפות" for the last channel and a ⟲ button for catch-up.
- Channel zapping in the player: ▲/▼ buttons, swipe up/down, remote up/down and CH+/CH-,
  with the channel name shown on switch.
- RaspberryTV: live plays the playlist URL exactly as given (fixes channels not playing), with a
  browser User-Agent; catch-up URLs derived for both URL layouts. Access key and M3U playlists
  are managed once in Settings.
- Player shows the reason when a stream can't be played.
- Fix: Hebrew plots/titles missing after Wikidata error responses were cached as "no entry".
- Fix: popular titles wrongly showing no sources — details page now shows load errors with a
  retry, availability checks are gentler and grey out only after two empty answers.

## 0.12.0 — 2026-09-19
- RaspberryTV in Live TV: enter your 8-character access key (stored only on the device) to get
  your channel list, as in OTT-Play.
- Catch-up: channels with an archive show "⟲ N ימים אחורה"; tapping one opens a sheet with
  "▶ שידור חי" and the programme guide by day — tap any past programme to watch it.
  Without a guide, jump back to any time within the archive window.
- M3U parser: unquoted attributes, tvg-id and tvg-rec (catch-up days).

## 0.11.0 — 2026-09-19
- All content is fetched live by the app; nothing is hosted in the repository any more:
  Israeli catalogs, Hebrew titles and Hebrew search come from the Wikidata API, plots from
  Hebrew Wikipedia. (Removed the repo-hosted catalogs, title map, generator and daily job.)
- Hebrew titles are looked up only for posters on screen and cached on the device.
- Minimal design: calmer banner, no glow effects, text-tab categories, neutral badges.
- Sources: one "▶ נגן" button that picks the best source automatically, quality shortcuts,
  and a collapsed list of other sources. No filters; CAM copies hidden.
- Titles without sources are greyed out (or hidden, in Settings), checked as they scroll into view.
- Removed the Arabic category.

## 0.10.1 — 2026-09-19
- Hebrew titles: strip Wikidata disambiguators such as "(סרט, 2025)".

## 0.10.0 — 2026-09-19
- Full Hebrew interface, right-to-left: menus, categories, pages, sources list, Live TV,
  settings, add-ons, messages and the app's torrent/subtitle notices.
- Genres, content types and catalog names translated; brand names kept intact in RTL.
- Hebrew-capable fonts (Rubik, Heebo) alongside the existing Latin fonts.

## 0.9.0 — 2026-09-19
- Hebrew titles on posters, banners and details pages (Wikidata), with the original title shown under it.
- Hebrew plot on the details page, from the "עלילה" section of Hebrew Wikipedia (with "קרא עוד" and attribution).
- Hebrew search: queries in Hebrew also search Wikidata (e.g. "חומות של תקווה", "פאודה").
- Hebrew titles for all catalog titles are precomputed daily on GitHub (addon/he.json);
  other titles are looked up on demand and cached on the phone.
- Settings: "Titles & plots" language (עברית / English).

## 0.8.0 — 2026-09-19
- Category bar on Home: All, Netflix, Apple TV+, Disney+, Prime Video, HBO Max, Paramount+,
  Documentaries (Curiosity Stream, MagellanTV, popular documentaries), Israeli, Arabic, Live TV.
- New default add-ons: Streaming Catalogs (Israel region) and Booth Catalogs (Israeli/Hebrew and
  Arabic films & series, generated weekly from Wikidata by tools/build_catalogs.py).
- Live TV: official Israeli channels built in (Kan 11, Now 14, Makan 33, i24NEWS Hebrew/Arabic,
  Channel 9) plus any M3U playlist you add (e.g. TVHeadend / Threadfin on a Raspberry Pi),
  with group filter and search. Playlists are fetched natively, so LAN addresses and
  user:pass@ logins work; per-channel User-Agent/Referer honoured.

## 0.7.0 — 2026-09-19
- New Settings page (top menu), applied instantly and remembered:
  - Skins: Tungsten, Midnight (OLED black), Velvet, Forest, Daylight (light).
  - Layouts: Cinema (banner + rows), Poster wall, List (compact, for phones), TV (10-foot, remote-friendly).
  - Poster size: small / medium / large.
- Android TV devices default to the TV layout.
- Fix: Discover's "Load more" button was restyled by the sources list (class clash).
- Fix: top bar overflowed on tablet-width screens; search now wraps to its own row.

## 0.6.0 — 2026-09-19
- Hebrew subtitles added automatically to every movie and episode.
  Sources: Wizdom and OpenSubtitles; the 3 subtitles whose release name best matches the
  chosen video are downloaded (so timing fits), and the best one is turned on by default.
- Other matches (and embedded Hebrew tracks) selectable from the player's subtitles button.
- Larger outlined subtitle text for readability; UTF-8 and Windows-1255 Hebrew files supported.

## 0.5.4 — 2026-09-19
- Sources grouped by quality (4K / 1080p / 720p / SD / CAM / Other), collapsed, each showing
  source count, best seeders and size range, with a "▶ Best" button that plays the top-seeded source.
- Filters: quality chips (CAM off by default), minimum seeders, maximum size, sort order; remembered.
- Each group previews its top 5 sources with "Show all"; rows show seeders, size, provider, HDR/DV/HEVC tags, languages.

## 0.5.3 — 2026-09-19
- Torrents now **stream**: playback starts after ~8 MB is buffered instead of after the full download.
  A local HTTP server feeds the player while downloading; seeking re-prioritises the needed pieces.
- Fix: torrents stuck on "Getting torrent info". Torrentio's trackers are now passed to the engine
  (plus public trackers), and the DHT is bootstrapped at app start.
- Progress shown in an on-screen status bar with Cancel, instead of a backlog of toasts.
- Leaving the player stops the torrent and deletes its data; old downloads are cleared at start.

## 0.5.2 — 2026-09-19
- Smaller APK (~15 MB instead of 52 MB): ARM-only native libraries (arm64 + armv7), compressed.
- Faster CI builds: Gradle build/configuration cache, parallel execution, no release lint.

## 0.5.1 — 2026-09-19
- Release builds are signed with a permanent key, so new versions install over old ones (no uninstall).
- Tagged versions are published as GitHub Releases; phones can auto-update via Obtainium.
- Fix: returning to the player from Home/another app no longer shows a black screen; playback resumes where it left off.

## 0.5.0 — 2026-09-19
- Native BitTorrent download/playback via FrostWire jlibtorrent 2.0.12.9.
- Torrentio infoHash sources fetch metadata, pick the requested (or largest video) file, and download it sequentially.
- Completed downloads open in the internal Media3 player.
- Download progress, speed, and peer count shown as status toasts.

## 0.4.0 — 2026-09-19
- First Android/Android TV project.
- Existing Booth HTML UI packaged as an Android asset.
- Cinemeta + Torrentio manifests preconfigured.
- Native Media3/ExoPlayer activity for direct HTTP/HLS sources.
- Android phone launcher and Android TV Leanback launcher declarations.
- JavaScript bridge captures torrent infoHash/fileIdx.
- Torrent playback engine is **not yet implemented** in this release.
- Semantic versioning and monotonically increasing Android versionCode established.
