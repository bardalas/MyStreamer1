# Booth Android changelog

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
