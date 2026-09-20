package com.veo.player

import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.appcompat.app.AppCompatActivity
import androidx.webkit.WebViewAssetLoader
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

class MainActivity : AppCompatActivity() {
    /** Where the page lives now, and where it lived before 0.37 (its storage is moved over once). */
    private val PAGE = "https://appassets.androidplatform.net/assets/booth.html"
    private lateinit var web: WebView
    private val REQ_LIVE = 1
    @Volatile private var updateCancelled = false

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        web = findViewById(R.id.web)
        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        web.settings.mediaPlaybackRequiresUserGesture = false
        // A WebView multiplies every text by the system font scale, while the boxes around it keep their
        // size: at the larger settings a phone's screen ends up with text cut off and running over itself.
        // The page sizes its own text for the screen it is on; a little of the viewer's preference still counts.
        web.settings.textZoom = (100 * minOf(resources.configuration.fontScale, 1.1f)).toInt()
        // chrome://inspect can attach to a debug build's page; a release build stays closed
        if (applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE != 0) WebView.setWebContentsDebuggingEnabled(true)
        // The page is served to itself over https instead of being opened as a file. A file has no
        // address, so anything it asks for arrives with no referrer and no origin - which is why YouTube
        // refused to play a trailer inside it ("error 153") and why some add-ons turned its requests
        // away. Served this way it is an ordinary https page, and both simply work.
        val assetsAt = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()
        web.settings.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW   // IPTV and LAN devices are http
        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest) =
                assetsAt.shouldInterceptRequest(request.url)
        }
        web.webChromeClient = WebChromeClient()
        web.addJavascriptInterface(Bridge(), "BoothAndroid")
        web.loadUrl(PAGE)
        web.requestFocus()   // remote D-pad works immediately (Android TV)
        TorrentEngine.warmUp(applicationContext)
    }

    /** Shows torrent progress in the page's status bar (empty = hide; error = red, with dismiss). */
    private fun showStatus(msg: String, error: Boolean = false) = runOnUiThread {
        web.evaluateJavascript("window.boothTorrentStatus && boothTorrentStatus(${JSONObject.quote(msg)}, $error)", null)
    }

    /** The off-screen window that reads broadcasters' sites (see [SiteReader]). */
    private val siteReader by lazy {
        SiteReader(this, web) { id, ok, body ->
            web.evaluateJavascript(
                "window.boothFetchDone && boothFetchDone(${JSONObject.quote(id)}, $ok, ${JSONObject.quote(body)})", null)
        }
    }

    inner class Bridge {
        /** True on Android TV; the page then defaults to its TV (10-foot) layout. */
        @JavascriptInterface fun isTv(): Boolean = packageManager.hasSystemFeature(PackageManager.FEATURE_LEANBACK)

        /** [videoId]/[release] drive the Hebrew subtitle lookup (Stremio id and release/file name). */
        @JavascriptInterface fun playUrl(url: String, title: String, videoId: String, release: String, meta: String, pos: Long) {
            Subtitles.prefetch(applicationContext, videoId, release)
            runOnUiThread {
                startActivity(Intent(this@MainActivity, PlayerActivity::class.java)
                    .putExtra("url", url).putExtra("title", title)
                    .putExtra("vid", videoId).putExtra("meta", meta).putExtra("pos", pos))
            }
        }

        /** [sourcesJson]: the Stremio stream's `sources` array, e.g. ["tracker:udp://…", "dht:…"]. */
        @JavascriptInterface fun playTorrent(
            infoHash: String, fileIdx: Int, title: String, sourcesJson: String, videoId: String, release: String,
            meta: String, pos: Long
        ) {
            Subtitles.prefetch(applicationContext, videoId, release)
            val sources = runCatching {
                JSONArray(sourcesJson).let { a -> List(a.length()) { a.getString(it) } }
            }.getOrDefault(emptyList())
            showStatus("מתחיל טורנט…")
            TorrentEngine.stream(
                applicationContext, infoHash, fileIdx, sources,
                onStatus = { showStatus(it) },
                onReady = { url -> runOnUiThread {
                    startActivity(Intent(this@MainActivity, PlayerActivity::class.java)
                        .putExtra("url", url).putExtra("title", title).putExtra("torrent", true)
                        .putExtra("vid", videoId).putExtra("meta", meta).putExtra("pos", pos))
                } },
                onError = { showStatus("שגיאת טורנט: $it", error = true) }
            )
        }

        /** Live TV / IPTV channel. [userAgent]/[referer] come from the M3U entry (may be blank). */
        @JavascriptInterface fun playLive(url: String, title: String, userAgent: String, referer: String) {
            runOnUiThread {
                startActivity(Intent(this@MainActivity, PlayerActivity::class.java)
                    .putExtra("url", url).putExtra("title", title).putExtra("live", true)
                    .putExtra("ua", userAgent).putExtra("referer", referer))
            }
        }

        /** Official broadcaster videos play in the YouTube app (web page as fallback). */
        @JavascriptInterface fun openYouTube(videoId: String) {
            runOnUiThread {
                val app = Intent(Intent.ACTION_VIEW, android.net.Uri.parse("vnd.youtube:$videoId"))
                val web = Intent(Intent.ACTION_VIEW, android.net.Uri.parse("https://www.youtube.com/watch?v=$videoId"))
                try { startActivity(app) } catch (e: android.content.ActivityNotFoundException) { startActivity(web) }
            }
        }

        /** Broadcaster VOD (e.g. Reshet 13): DASH + Widevine licence URL from the broadcaster's own API. */
        @JavascriptInterface fun playDrm(url: String, licenseUrl: String, title: String) {
            runOnUiThread {
                startActivity(Intent(this@MainActivity, PlayerActivity::class.java)
                    .putExtra("url", url).putExtra("drm", licenseUrl).putExtra("title", title).putExtra("nosubs", true))
            }
        }

        /** Broadcaster VOD with the site's referer (Kan's CDN), optional Widevine licence. */
        @JavascriptInterface fun playVod(url: String, licenseUrl: String, title: String, referer: String) {
            runOnUiThread {
                startActivity(Intent(this@MainActivity, PlayerActivity::class.java)
                    .putExtra("url", url).putExtra("drm", licenseUrl).putExtra("title", title)
                    .putExtra("referer", referer).putExtra("nosubs", true))
            }
        }

        /** Opens the on-screen keyboard for the focused field (TV: only after OK on the field). */
        @JavascriptInterface fun showKeyboard() {
            runOnUiThread {
                // requestFocus() on a WebView that already has focus makes it re-pick the first focusable
                // element of the page - it took the caret away from the very field being typed into
                if (!web.hasFocus()) web.requestFocus()
                (getSystemService(INPUT_METHOD_SERVICE) as android.view.inputmethod.InputMethodManager)
                    .showSoftInput(web, android.view.inputmethod.InputMethodManager.SHOW_IMPLICIT)
            }
        }

        /** The page's skin and direction, kept for PlayerActivity (which draws its own views). */
        @JavascriptInterface fun setTheme(json: String) {
            val o = JSONObject(json)
            getSharedPreferences("veo", MODE_PRIVATE).edit().apply {
                for (k in o.keys()) putString(k, o.optString(k))
            }.apply()
        }

        /** This build's version name, so the page can tell whether a newer one was released. */
        @JavascriptInterface fun appVersion(): String =
            runCatching { packageManager.getPackageInfo(packageName, 0).versionName ?: "" }.getOrDefault("")

        /** In-app update, at the user's request: download the new APK into the app cache and hand
         *  it to Android's package installer, which asks the user to confirm. The page shows the
         *  progress through the same status card the torrent engine uses. */
        @JavascriptInterface fun updateApp(url: String) {
            updateCancelled = false
            Thread {
                val status = { msg: String, err: Boolean -> runOnUiThread {
                    web.evaluateJavascript("window.boothTorrentStatus && boothTorrentStatus(${JSONObject.quote(msg)}, $err)", null)
                } }
                try {
                    val file = java.io.File(cacheDir, "update.apk")
                    // GitHub sends the release asset on to its storage host; HttpURLConnection will
                    // not follow a redirect that changes protocol, so follow them ourselves.
                    var link = url
                    var conn: HttpURLConnection
                    var hops = 0
                    while (true) {
                        conn = URL(link).openConnection() as HttpURLConnection
                        conn.instanceFollowRedirects = false
                        conn.connectTimeout = 15_000
                        conn.readTimeout = 30_000
                        conn.setRequestProperty("Accept", "application/octet-stream")
                        conn.connect()
                        val next = if (conn.responseCode in 301..308) conn.getHeaderField("Location") else null
                        if (next == null || ++hops > 5) break
                        conn.disconnect()
                        link = URL(URL(link), next).toString()
                    }
                    if (conn.responseCode !in 200..299) throw java.io.IOException("HTTP ${conn.responseCode}")
                    val total = conn.contentLengthLong
                    conn.inputStream.use { input ->
                        file.outputStream().use { out ->
                            val buf = ByteArray(64 * 1024)
                            var done = 0L; var lastPct = -1
                            while (true) {
                                if (updateCancelled) { file.delete(); status("", false); return@Thread }
                                val n = input.read(buf)
                                if (n < 0) break
                                out.write(buf, 0, n); done += n
                                val pct = if (total > 0) (done * 100 / total).toInt() else -1
                                if (pct != lastPct) { lastPct = pct
                                    status(if (pct >= 0) "מוריד את העדכון… $pct%" else "מוריד את העדכון…", false)
                                }
                            }
                        }
                    }
                    // An error page saved under the APK's name installs nothing: every APK is a zip.
                    val head = file.inputStream().use { ByteArray(2).also { b -> it.read(b) } }
                    if (file.length() < 1_000_000 || head[0] != 'P'.code.toByte() || head[1] != 'K'.code.toByte())
                        throw java.io.IOException("הקובץ שהתקבל אינו גרסה תקינה")
                    status("", false)
                    val uri = androidx.core.content.FileProvider.getUriForFile(
                        this@MainActivity, "$packageName.files", file)
                    val install = Intent(Intent.ACTION_VIEW)
                        .setDataAndType(uri, "application/vnd.android.package-archive")
                        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
                    runOnUiThread {
                        // Android 8+: installing needs this app to be allowed as an install source.
                        // Without it the installer just refuses, so send the viewer to grant it.
                        if (android.os.Build.VERSION.SDK_INT >= 26 && !packageManager.canRequestPackageInstalls()) {
                            status("אשר התקנה מ-VEO, ואז לחץ שוב על עדכן", false)
                            runCatching {
                                startActivity(Intent(android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                                    android.net.Uri.parse("package:$packageName")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                            }.onFailure { status("צריך לאשר למקרן להתקין עדכונים בהגדרות המכשיר", true) }
                            return@runOnUiThread
                        }
                        runCatching { startActivity(install) }
                            .onFailure { status("לא נמצאה דרך להתקין את העדכון במכשיר הזה", true) }
                    }
                } catch (e: Exception) {
                    status("הורדת העדכון נכשלה (${e.message ?: "שגיאה"})", true)
                }
            }.start()
        }

        /** Hand a link to the system (browser / downloader): used to fetch a new version's APK.
         *  Android's own installer asks the viewer to confirm - the app never installs anything itself. */
        @JavascriptInterface fun openExternal(url: String) {
            runOnUiThread {
                runCatching {
                    startActivity(Intent(Intent.ACTION_VIEW, android.net.Uri.parse(url))
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                }.onFailure { startActivity(BrowserActivity.intent(this@MainActivity, url)) }
            }
        }

        /** A broadcaster's own web page (its player plays the video) in an in-app window. */
        @JavascriptInterface fun openSite(url: String) {
            runOnUiThread { startActivity(BrowserActivity.intent(this@MainActivity, url)) }
        }

        /** Live TV with channel zapping: [channelsJson] = [{name, url, ua, referer}], starting at [index]. */
        @JavascriptInterface fun playChannels(channelsJson: String, index: Int) {
            runOnUiThread {
                startActivityForResult(Intent(this@MainActivity, PlayerActivity::class.java)
                    .putExtra("channels", channelsJson).putExtra("index", index).putExtra("live", true), REQ_LIVE)
            }
        }

        /**
         * Fetches text (M3U playlists) natively: no CORS limits and it reaches LAN devices such as
         * a Raspberry Pi. Supports user:pass@host URLs. Result goes to window.boothFetchDone(id, ok, body).
         */
        /**
         * Read a page of a broadcaster's site in a window that behaves like a browser (see [sitePage]).
         * [reader] is the body of a function taking the document and returning text - usually JSON.
         */
        @JavascriptInterface fun siteExtract(url: String, reader: String, callbackId: String) {
            runOnUiThread { siteReader.read(url, reader, callbackId) }
        }

        @JavascriptInterface fun fetchText(url: String, callbackId: String) {
            Thread {
                val (ok, body) = try {
                    val conn = URL(url).openConnection() as HttpURLConnection
                    conn.connectTimeout = 10_000
                    conn.readTimeout = 30_000
                    // Browser-like headers: some broadcaster sites (Kan) turn away the default Java agent.
                    // YouTube serves its mobile site to phone agents; ask for the desktop page the app parses.
                    val desktop = conn.url.host.endsWith("youtube.com")
                    conn.setRequestProperty("User-Agent",
                        if (desktop) "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36"
                        else "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36")
                    conn.setRequestProperty("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
                    conn.setRequestProperty("Accept-Language", "he-IL,he;q=0.9,en;q=0.8")
                    PlayerActivity.basicAuth(url)?.let { conn.setRequestProperty("Authorization", it) }
                    if (conn.responseCode >= 400) throw IllegalStateException("HTTP ${conn.responseCode}")
                    true to conn.inputStream.use { it.readBytes().toString(Charsets.UTF_8) }
                } catch (t: Throwable) {
                    false to (t.message ?: t.javaClass.simpleName)
                }
                runOnUiThread {
                    web.evaluateJavascript(
                        "window.boothFetchDone && boothFetchDone(${JSONObject.quote(callbackId)}, $ok, ${JSONObject.quote(body)})", null)
                }
            }.start()
        }

        @JavascriptInterface fun cancelTorrent() {
            updateCancelled = true
            TorrentEngine.cancelPending()
            Thread { TorrentEngine.stopCurrent() }.start()
            showStatus("")
        }
    }

    // Back: let the page close an open panel/keyboard first, then go back, then leave the app.
    override fun onResume() {
        super.onResume()
        // Progress written by the player while watching -> "continue watching" in the page.
        val prefs = getSharedPreferences("watch", MODE_PRIVATE)
        val progress = prefs.getString("progress", null)
        if (!progress.isNullOrBlank() && progress != "{}") {
            prefs.edit().remove("progress").apply()
            web.evaluateJavascript("window.boothProgress && boothProgress(${JSONObject.quote(progress)})", null)
        }
    }

    // The player closed with "catch-up" for a channel: open its programme guide in the page.
    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        val channel = data?.getStringExtra("catchup")
        if (requestCode == REQ_LIVE && resultCode == RESULT_OK && !channel.isNullOrBlank()) {
            web.evaluateJavascript("window.boothCatchup && boothCatchup(${JSONObject.quote(channel)})", null)
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        // The page walks its own ladder (one level up per press); at the top, Back leaves the app.
        web.evaluateJavascript("(window.boothBack && boothBack()) ? 'y' : 'n'") { handled ->
            if (handled?.contains("y") != true) finish()
        }
    }

    // Remote Search key jumps to the search field.
    override fun dispatchKeyEvent(event: android.view.KeyEvent): Boolean {
        if (event.keyCode == android.view.KeyEvent.KEYCODE_SEARCH && event.action == android.view.KeyEvent.ACTION_DOWN) {
            web.evaluateJavascript("window.boothSearchKey && boothSearchKey()", null)
            return true
        }
        return super.dispatchKeyEvent(event)
    }
}
