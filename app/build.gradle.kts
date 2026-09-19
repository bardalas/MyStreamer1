plugins { id("com.android.application") }

// Release signing comes from CI secrets (see .github/workflows/build-apk.yml).
// Never commit the keystore — installs can only be updated by APKs signed with the same key.
val signingKeystore: String? = System.getenv("SIGNING_KEYSTORE_PATH")

android {
    namespace = "com.booth.player"
    compileSdk = 36
    defaultConfig {
        applicationId = "com.booth.player"
        minSdk = 24
        targetSdk = 36
        versionCode = 1800
        versionName = "0.18.0"
    }
    signingConfigs {
        create("release") {
            if (signingKeystore != null) {
                storeFile = file(signingKeystore)
                storeType = "pkcs12"
                storePassword = System.getenv("SIGNING_STORE_PASSWORD")
                keyAlias = System.getenv("SIGNING_KEY_ALIAS")
                keyPassword = System.getenv("SIGNING_STORE_PASSWORD")
            }
        }
    }
    // Phones and Android TV boxes are ARM; x86 is only needed for emulators.
    // Compressing native libs cuts the APK download size roughly in half.
    packaging {
        jniLibs { useLegacyPackaging = true }
    }
    // Release lint ("lintVital") adds ~30s per CI build; run lint locally when needed.
    lint {
        checkReleaseBuilds = false
    }
    buildTypes {
        release {
            isMinifyEnabled = false
            if (signingKeystore != null) signingConfig = signingConfigs.getByName("release")
        }
    }
}

dependencies {
    implementation("androidx.appcompat:appcompat:1.8.0")
    val jlibtorrentVersion = "2.0.12.9"
    implementation("com.frostwire:jlibtorrent:$jlibtorrentVersion")
    implementation("com.frostwire:jlibtorrent-android-arm64:$jlibtorrentVersion")
    implementation("com.frostwire:jlibtorrent-android-arm:$jlibtorrentVersion")
    implementation("androidx.media3:media3-exoplayer:1.11.1")
    implementation("androidx.media3:media3-exoplayer-hls:1.11.1")
    implementation("androidx.media3:media3-exoplayer-dash:1.11.1")
    implementation("androidx.media3:media3-ui:1.11.1")
}
