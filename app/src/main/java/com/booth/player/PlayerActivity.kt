package com.booth.player

import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.GestureDetector
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.Gravity
import android.view.View
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.annotation.OptIn
import androidx.appcompat.app.AppCompatActivity
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.datasource.HttpDataSource
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.ui.CaptionStyleCompat
import androidx.media3.ui.PlayerView
import androidx.media3.ui.SubtitleView
import org.json.JSONArray
import kotlin.math.abs

class PlayerActivity : AppCompatActivity() {
    /** One playable item. Live TV passes a whole channel list so the viewer can zap through it. */
    private data class Source(val name: String, val url: String, val ua: String, val referer: String, val drm: String = "")

    private var player: ExoPlayer? = null
    private var resumePosition = 0L
    private var started = false
    /** Hebrew subtitles for this video; null until the lookup started at play time has finished. */
    private var subs: List<Subtitles.Sub>? = null

    private var sources: List<Source> = emptyList()
    private var index = 0
    private val live get() = intent.getBooleanExtra("live", false) || sources.size > 1
    private val handler = Handler(Looper.getMainLooper())
    /** Automatic retries for the current channel (IPTV servers may still hold the previous session). */
    private var retries = 0
    /** Channel bar (live TV): which channel the viewer is pointing at while it is open. */
    private var barIndex = 0
    private val barOpen get() = findViewById<View>(R.id.infobar).visibility == View.VISIBLE

    @OptIn(UnstableApi::class)
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_player)

        sources = intent.getStringExtra("channels")?.let { json ->
            val a = JSONArray(json)
            List(a.length()) { i ->
                a.getJSONObject(i).run { Source(optString("name"), optString("url"), optString("ua"), optString("referer"), optString("drm")) }
            }
        } ?: listOfNotNull(intent.getStringExtra("url")?.let {
            Source(intent.getStringExtra("title") ?: "", it, intent.getStringExtra("ua") ?: "", intent.getStringExtra("referer") ?: "",
                intent.getStringExtra("drm") ?: "")
        })
        if (sources.isEmpty()) { finish(); return }
        index = (savedInstanceState?.getInt("index") ?: intent.getIntExtra("index", 0)).coerceIn(0, sources.size - 1)
        resumePosition = savedInstanceState?.getLong("pos") ?: 0L

        val view = findViewById<PlayerView>(R.id.playerView)
        view.setShowSubtitleButton(!live)
        view.subtitleView?.apply {
            setStyle(CaptionStyleCompat(Color.WHITE, Color.TRANSPARENT, Color.TRANSPARENT,
                CaptionStyleCompat.EDGE_TYPE_OUTLINE, Color.BLACK, null))
            setFractionalTextSize(SubtitleView.DEFAULT_TEXT_SIZE_FRACTION * 1.25f)
        }

        if (sources.size > 1) {
            val zap = findViewById<View>(R.id.zap)
            view.setControllerVisibilityListener(PlayerView.ControllerVisibilityListener { zap.visibility = it })
            findViewById<View>(R.id.chUp).setOnClickListener { zapBy(-1) }
            findViewById<View>(R.id.chDown).setOnClickListener { zapBy(1) }
        }

        if (sources.size > 1) buildChannelBar()

        // Live TV and broadcaster VOD (Hebrew already) have no subtitle lookup.
        if (live || intent.getBooleanExtra("nosubs", false)) { subs = emptyList(); showOsd(); return }

        // Wait (briefly) for the Hebrew subtitle lookup before building the player,
        // because side-loaded subtitles must be part of the MediaItem.
        Thread {
            val found = Subtitles.await(8_000)
            runOnUiThread {
                subs = found
                Toast.makeText(this,
                    if (found.isEmpty()) "לא נמצאו כתוביות בעברית" else "נמצאו ${found.size} כתוביות בעברית",
                    Toast.LENGTH_SHORT).show()
                if (started) buildPlayer()
            }
        }.start()
    }

    // Build the player in onStart and release it in onStop, so returning from
    // Home / another app recreates it (at the same position) instead of a black screen.
    override fun onStart() {
        super.onStart()
        started = true
        if (subs != null) buildPlayer()
    }

    @OptIn(UnstableApi::class)
    private fun buildPlayer() {
        if (player != null) return
        val src = sources[index]
        val url = src.url
        // Torrent streams are served from localhost and a read can wait while the next
        // piece downloads, so allow long read timeouts and a larger forward buffer.
        val http = DefaultHttpDataSource.Factory()
            .setConnectTimeoutMs(30_000)
            .setReadTimeoutMs(120_000)
            .setAllowCrossProtocolRedirects(true)
        // Per-channel headers from IPTV playlists, and user:pass@host logins (e.g. TVHeadend).
        src.ua.takeIf { it.isNotBlank() }?.let { http.setUserAgent(it) }
        val headers = buildMap {
            src.referer.takeIf { it.isNotBlank() }?.let { put("Referer", it) }
            basicAuth(url)?.let { put("Authorization", it) }
        }
        if (headers.isNotEmpty()) http.setDefaultRequestProperties(headers)
        val loadControl = DefaultLoadControl.Builder()
            .setBufferDurationsMs(if (live) 8_000 else 30_000, 120_000, if (live) 1_500 else 2_500, 5_000)
            .build()

        val subtitleConfigs = subs.orEmpty().mapIndexed { i, s ->
            MediaItem.SubtitleConfiguration.Builder(Uri.fromFile(s.file))
                .setMimeType(MimeTypes.APPLICATION_SUBRIP)
                .setLanguage("he")
                .setLabel(s.label)
                .setSelectionFlags(if (i == 0) C.SELECTION_FLAG_DEFAULT else 0)
                .build()
        }
        val item = MediaItem.Builder().setUri(url).setSubtitleConfigurations(subtitleConfigs)
            // IPTV HLS links often carry tokens/query strings, which stop ExoPlayer inferring the type.
            .apply {
                if (url.contains(".m3u8")) setMimeType(MimeTypes.APPLICATION_M3U8)
                // Broadcaster VOD: DASH protected with Widevine, licensed by the broadcaster's own licence server.
                if (src.drm.isNotBlank()) {
                    if (!url.contains(".m3u8")) setMimeType(MimeTypes.APPLICATION_MPD)
                    setDrmConfiguration(MediaItem.DrmConfiguration.Builder(C.WIDEVINE_UUID).setLicenseUri(src.drm).build())
                }
            }
            .build()

        player = ExoPlayer.Builder(this)
            .setMediaSourceFactory(DefaultMediaSourceFactory(DefaultDataSource.Factory(this, http)))
            .setLoadControl(loadControl)
            .build().also {
                // Hebrew subtitles on by default (also picks embedded Hebrew tracks in MKVs).
                it.trackSelectionParameters = it.trackSelectionParameters.buildUpon()
                    .setPreferredTextLanguage("he")
                    .build()
                it.addListener(object : Player.Listener {
                    override fun onPlayerError(error: PlaybackException) = onError(error)
                    override fun onPlaybackStateChanged(state: Int) {
                        if (state == Player.STATE_READY && retries > 0) { retries = 0; handler.postDelayed(hideOsd, 1_500) }
                    }
                })
                findViewById<PlayerView>(R.id.playerView).player = it
                it.setMediaItem(item)
                if (!live) it.seekTo(resumePosition)
                it.prepare()
                it.playWhenReady = true
            }
    }

    /** Channel bar: the channel list along the bottom, for choosing with the remote. */
    private fun buildChannelBar() {
        val row = findViewById<LinearLayout>(R.id.chRow)
        row.removeAllViews()
        sources.forEachIndexed { i, src ->
            val t = TextView(this).apply {
                text = "${i + 1}. ${src.name}"
                textSize = 17f
                setPadding(28, 14, 28, 14)
                gravity = Gravity.CENTER
                setTextColor(Color.WHITE)
                setOnClickListener { pickChannel(i) }
            }
            row.addView(t)
        }
    }

    private fun showChannelBar() {
        if (sources.size < 2) return
        barIndex = index
        findViewById<View>(R.id.infobar).visibility = View.VISIBLE
        findViewById<PlayerView>(R.id.playerView).hideController()
        paintChannelBar()
    }

    private fun hideChannelBar() { findViewById<View>(R.id.infobar).visibility = View.GONE }

    private fun paintChannelBar() {
        val row = findViewById<LinearLayout>(R.id.chRow)
        for (i in 0 until row.childCount) {
            val t = row.getChildAt(i) as TextView
            t.setBackgroundColor(if (i == barIndex) Color.parseColor("#F0B429") else Color.TRANSPARENT)
            t.setTextColor(if (i == barIndex) Color.parseColor("#14161F") else Color.WHITE)
        }
        row.getChildAt(barIndex)?.let { v ->
            findViewById<HorizontalScrollView>(R.id.chScroll).smoothScrollTo(v.left - 200, 0)
        }
        findViewById<TextView>(R.id.infoNow).text =
            "צופה: ${sources[index].name}   ·   OK להחלפה   ·   לחיצה ארוכה על OK: צפייה אחורה"
    }

    private fun moveChannelBar(step: Int) {
        barIndex = (barIndex + step + sources.size) % sources.size
        paintChannelBar()
    }

    private fun pickChannel(i: Int) {
        hideChannelBar()
        if (i != index) zapBy(i - index) else showOsd()
    }

    /** Long press OK: back to the app, opening this channel's catch-up (programme guide). */
    private fun openCatchUp() {
        setResult(RESULT_OK, android.content.Intent().putExtra("catchup", sources[index].name))
        finish()
    }

    /** Live TV: switch to the previous/next channel in the list (wraps around). */
    private fun zapBy(step: Int) {
        if (sources.size < 2) return
        index = (index + step + sources.size) % sources.size
        retries = 0
        player?.release()
        player = null
        showOsd()
        if (barOpen) { barIndex = index; paintChannelBar() }
        // Give the server a moment to close the previous channel's session before opening the next.
        handler.removeCallbacks(rebuild)
        handler.postDelayed(rebuild, 400)
    }

    private val rebuild = Runnable { if (started && player == null) buildPlayer() }

    private fun onError(error: PlaybackException) {
        // HTTP status (e.g. 403 while the server still counts the previous stream) and the root message.
        val status = generateSequence<Throwable>(error) { it.cause }
            .filterIsInstance<HttpDataSource.InvalidResponseCodeException>().firstOrNull()?.responseCode
        val why = generateSequence(error.cause) { it.cause }.mapNotNull { it.message }.firstOrNull()
        if (live && retries < 2) {
            retries++
            showMessage("מנסה שוב… ($retries/2)", 3_500)
            player?.release()
            player = null
            handler.removeCallbacks(rebuild)
            handler.postDelayed(rebuild, 3_000)
            return
        }
        showMessage(buildString {
            append("לא ניתן לנגן את ").append(sources[index].name.ifBlank { "הערוץ" })
            append("\n").append(error.errorCodeName)
            if (status != null) append(" · HTTP ").append(status)
            if (!why.isNullOrBlank()) append("\n").append(why.take(160))
        }, 0)
    }

    /** Message over the video; [ms] = 0 keeps it until the next channel or successful playback. */
    private fun showMessage(text: String, ms: Long) {
        val osd = findViewById<TextView>(R.id.osd)
        osd.text = text
        osd.visibility = View.VISIBLE
        handler.removeCallbacks(hideOsd)
        if (ms > 0) handler.postDelayed(hideOsd, ms)
    }

    private val hideOsd = Runnable { findViewById<TextView>(R.id.osd).visibility = View.GONE }

    private fun showOsd() {
        val osd = findViewById<TextView>(R.id.osd)
        osd.text = if (sources.size > 1) "${index + 1} · ${sources[index].name}" else sources[index].name
        osd.visibility = if (osd.text.isNullOrBlank()) View.GONE else View.VISIBLE
        handler.removeCallbacks(hideOsd)
        handler.postDelayed(hideOsd, 3_000)
    }

    // Remote: OK opens the channel bar (OK again switches), long press opens catch-up,
    // channel keys and up/down zap directly, play/pause pauses the live stream.
    @OptIn(UnstableApi::class)
    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (event.action != KeyEvent.ACTION_DOWN) return super.dispatchKeyEvent(event)
        val controls = findViewById<PlayerView>(R.id.playerView).isControllerFullyVisible
        when (event.keyCode) {
            KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, KeyEvent.KEYCODE_MEDIA_PAUSE, KeyEvent.KEYCODE_MEDIA_PLAY -> {
                player?.let { it.playWhenReady = !it.playWhenReady; showMessage(if (it.playWhenReady) "ממשיך" else "מושהה", 2_000) }
                return true
            }
            KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_NUMPAD_ENTER, KeyEvent.KEYCODE_BUTTON_A -> {
                if (sources.size < 2) return super.dispatchKeyEvent(event)
                if (event.repeatCount > 0) { openCatchUp(); return true }        // held down
                if (barOpen) pickChannel(barIndex) else showChannelBar()
                return true
            }
            KeyEvent.KEYCODE_BACK -> if (barOpen) { hideChannelBar(); return true }
            KeyEvent.KEYCODE_DPAD_LEFT -> if (barOpen) { moveChannelBar(1); return true }    // right-to-left list
            KeyEvent.KEYCODE_DPAD_RIGHT -> if (barOpen) { moveChannelBar(-1); return true }
            KeyEvent.KEYCODE_CHANNEL_UP -> if (sources.size > 1) { zapBy(-1); return true }
            KeyEvent.KEYCODE_CHANNEL_DOWN -> if (sources.size > 1) { zapBy(1); return true }
            KeyEvent.KEYCODE_DPAD_UP -> if (sources.size > 1 && !controls && !barOpen) { zapBy(-1); return true }
            KeyEvent.KEYCODE_DPAD_DOWN -> if (sources.size > 1 && !controls && !barOpen) { zapBy(1); return true }
        }
        return super.dispatchKeyEvent(event)
    }

    // Touch: swipe up = next channel, swipe down = previous.
    private val swipe by lazy {
        GestureDetector(this, object : GestureDetector.SimpleOnGestureListener() {
            override fun onFling(e1: MotionEvent?, e2: MotionEvent, velocityX: Float, velocityY: Float): Boolean {
                if (sources.size < 2 || e1 == null) return false
                val dy = e2.y - e1.y
                if (abs(dy) > 150 && abs(dy) > 2 * abs(e2.x - e1.x) && abs(velocityY) > 800) {
                    zapBy(if (dy < 0) 1 else -1)
                    return true
                }
                return false
            }
        })
    }

    override fun dispatchTouchEvent(ev: MotionEvent): Boolean {
        swipe.onTouchEvent(ev)
        return super.dispatchTouchEvent(ev)
    }

    override fun onStop() {
        super.onStop()
        started = false
        player?.let { resumePosition = it.currentPosition; it.release() }
        player = null
    }

    override fun onDestroy() {
        super.onDestroy()
        handler.removeCallbacksAndMessages(null)
        // Leaving the player ends the torrent stream and frees its downloaded data.
        if (isFinishing && intent.getBooleanExtra("torrent", false)) {
            Thread { TorrentEngine.stopCurrent() }.start()
        }
    }

    companion object {
        /** "Basic …" header for http://user:pass@host/… URLs, else null. */
        fun basicAuth(url: String): String? {
            val info = Uri.parse(url).userInfo ?: return null
            return "Basic " + android.util.Base64.encodeToString(Uri.decode(info).toByteArray(), android.util.Base64.NO_WRAP)
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        outState.putLong("pos", player?.currentPosition ?: resumePosition)
        outState.putInt("index", index)
    }
}
