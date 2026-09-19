# MyStreamer Android

Current release: **v0.5.0-alpha** (`versionCode 500`).

Android frontend for Stremio-compatible add-ons with native Android Media3 playback.

## v0.5.0-alpha
- Native BitTorrent engine (FrostWire jlibtorrent 2.0.12.9).
- Torrentio infoHash sources fetch metadata, select the requested video file, download it sequentially, and open it in the internal Media3 player once the download completes.
- Direct HTTP/HLS sources open in the native Media3/ExoPlayer player.
- Android TV launcher declaration is present; full D-pad/10-foot UI optimization is planned for a later release.

## Build APK with GitHub Actions
1. Push to `main` (or a `v*` tag), or open **Actions > Build Android APK** and choose **Run workflow**.
2. When the run is green, download the artifact named `MyStreamer-v0.5.0-alpha-debug`.

The workflow uses JDK 17, the runner's preinstalled Android SDK, and Gradle 9.6.0.

## Upgrade identity
The application ID is intentionally kept as `com.booth.player`. Do not change it after installing builds if you want Android to treat later releases as updates to the same app.

For reliable upgrades between CI-built APKs, a later release should use a persistent release signing key stored in GitHub Actions secrets. Debug builds are for initial testing.
