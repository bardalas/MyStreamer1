# MyStreamer Android

Current release: **v0.5.1-alpha** (`versionCode 501`).

Android / Android TV frontend for Stremio-compatible add-ons (Cinemeta, Torrentio) with native Media3 playback and a built-in BitTorrent engine (FrostWire jlibtorrent).

- Direct HTTP/HLS sources open in the native Media3/ExoPlayer player.
- Torrentio sources: fetches metadata, downloads the selected file sequentially, then plays it (playback starts once the download finishes).

## Install on your phone & get automatic updates
1. Install **[Obtainium](https://github.com/ImranR98/Obtainium/releases/latest)** (free, open source).
2. In Obtainium tap **Add App**, paste `https://github.com/bardalas/MyStreamer1`, tap **Add**, then **Install**.
3. Obtainium checks for new releases in the background and installs them (silently on Android 12+).

Or download the APK manually from [Releases](https://github.com/bardalas/MyStreamer1/releases/latest).

## Releasing a new version
1. Bump `versionCode` / `versionName` in `app/build.gradle.kts` (versionCode = major*10000 + minor*100 + patch) and add a `CHANGELOG.md` entry.
2. Commit, then tag and push: `git tag v0.5.2 && git push origin main v0.5.2`.
3. GitHub Actions builds a signed APK and publishes the Release; phones pick it up automatically.

Pushes to `main` without a tag build a signed test APK as a workflow artifact only.

## Signing
Release builds are signed in CI from these repository secrets: `SIGNING_KEYSTORE_BASE64`, `SIGNING_STORE_PASSWORD`, `SIGNING_KEY_ALIAS`.
**Keep a backup of the keystore** — Android only accepts updates signed with the same key. The application ID `com.booth.player` must also never change.
