# Booth Android changelog

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
