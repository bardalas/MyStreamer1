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
        @JavascriptInterface fun playUrl(url: String, title: String, videoId: String, release: String) {
            Subtitles.prefetch(applicationContext, videoId, release)
            runOnUiThread {
                startActivity(Intent(this@MainActivity, PlayerActivity::class.java)
                    .putExtra("url", url).putExtra("title", title))
            }
        }

        /** [sourcesJson]: the Stremio stream's `sources` array, e.g. ["tracker:udp://…", "dht:…"]. */
        @JavascriptInterface fun playTorrent(
            infoHash: String, fileIdx: Int, title: String, sourcesJson: String, videoId: String, release: String
        ) {
            Subtitles.prefetch(applicationContext, videoId, release)
            val sources = runCatching {
                JSONArray(sourcesJson).let { a -> List(a.length()) { a.getString(it) } }
            }.getOrDefault(emptyList())
            showStatus("Starting torrent…")
            TorrentEngine.stream(
                applicationContext, infoHash, fileIdx, sources,
                onStatus = { showStatus(it) },
                onReady = { url -> runOnUiThread {
                    startActivity(Intent(this@MainActivity, PlayerActivity::class.java)
                        .putExtra("url", url).putExtra("title", title).putExtra("torrent", true))
                } },
                onError = { showStatus("Torrent error: $it", error = true) }
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

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (web.canGoBack()) web.goBack() else super.onBackPressed()
    }
}
