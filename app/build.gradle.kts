plugins { id("com.android.application") }

android {
    namespace = "com.booth.player"
    compileSdk = 36
    defaultConfig {
        applicationId = "com.booth.player"
        minSdk = 24
        targetSdk = 36
        versionCode = 500
        versionName = "0.5.0"
    }
}

dependencies {
    implementation("androidx.appcompat:appcompat:1.8.0")
    val jlibtorrentVersion = "2.0.12.9"
    implementation("com.frostwire:jlibtorrent:$jlibtorrentVersion")
    implementation("com.frostwire:jlibtorrent-android-arm64:$jlibtorrentVersion")
    implementation("com.frostwire:jlibtorrent-android-arm:$jlibtorrentVersion")
    implementation("com.frostwire:jlibtorrent-android-x86_64:$jlibtorrentVersion")
    implementation("com.frostwire:jlibtorrent-android-x86:$jlibtorrentVersion")
    implementation("androidx.media3:media3-exoplayer:1.11.1")
    implementation("androidx.media3:media3-exoplayer-hls:1.11.1")
    implementation("androidx.media3:media3-ui:1.11.1")
}
