package com.booth.player

import android.annotation.SuppressLint
import android.content.Intent
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity

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
    }

    inner class Bridge {
        @JavascriptInterface fun playUrl(url: String, title: String) {
            runOnUiThread {
                startActivity(Intent(this@MainActivity, PlayerActivity::class.java)
                    .putExtra("url", url).putExtra("title", title))
            }
        }

        @JavascriptInterface fun playTorrent(infoHash: String, fileIdx: Int, title: String) {
            runOnUiThread { Toast.makeText(this@MainActivity, "Starting torrent…", Toast.LENGTH_SHORT).show() }
            TorrentEngine.downloadSelected(
                this@MainActivity, infoHash, fileIdx,
                onStatus = { msg -> runOnUiThread { Toast.makeText(this@MainActivity, msg, Toast.LENGTH_SHORT).show() } },
                onReady = { url -> runOnUiThread {
                    startActivity(Intent(this@MainActivity, PlayerActivity::class.java)
                        .putExtra("url", url).putExtra("title", title))
                } },
                onError = { err -> runOnUiThread {
                    Toast.makeText(this@MainActivity, "Torrent error: $err", Toast.LENGTH_LONG).show()
                } }
            )
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (web.canGoBack()) web.goBack() else super.onBackPressed()
    }
}
