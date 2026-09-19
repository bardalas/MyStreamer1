package com.booth.player

import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.appcompat.app.AppCompatActivity
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

class MainActivity : AppCompatActivity() {
    private lateinit var web: WebView
    private val REQ_LIVE = 1

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        web = findViewById(R.id.web)
        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        web.settings.mediaPlaybackRequiresUserGesture = false
        web.webViewClient = WebViewClient()
        web.webChromeClient = WebChromeClient()
        web.addJavascriptInterface(Bridge(), "BoothAndroid")
        web.loadUrl("file:///android_asset/booth.html")
        web.requestFocus()   // remote D-pad works immediately (Android TV)
        TorrentEngine.warmUp(applicationContext)
    }

    /** Shows torrent progress in the page's status bar (empty = hide; error = red, with dismiss). */
    private fun showStatus(msg: String, error: Boolean = false) = runOnUiThread {
        web.evaluateJavascript("window.boothTorrentStatus && boothTorrentStatus(${JSONObject.quote(msg)}, $error)", null)
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
                web.requestFocus()
                (getSystemService(INPUT_METHOD_SERVICE) as android.view.inputmethod.InputMethodManager)
                    .showSoftInput(web, android.view.inputmethod.InputMethodManager.SHOW_IMPLICIT)
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
        web.evaluateJavascript("(window.boothBack && boothBack()) ? 'y' : 'n'") { handled ->
            if (handled?.contains("y") == true) return@evaluateJavascript
            if (web.canGoBack()) web.goBack() else finish()
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
