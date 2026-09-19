package com.booth.player

import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.widget.Toast
import androidx.annotation.OptIn
import androidx.appcompat.app.AppCompatActivity
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.ui.CaptionStyleCompat
import androidx.media3.ui.PlayerView
import androidx.media3.ui.SubtitleView

class PlayerActivity : AppCompatActivity() {
    private var player: ExoPlayer? = null
    private var resumePosition = 0L
    private var started = false
    /** Hebrew subtitles for this video; null until the lookup started at play time has finished. */
    private var subs: List<Subtitles.Sub>? = null

    @OptIn(UnstableApi::class)
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_player)
        if (intent.getStringExtra("url") == null) { finish(); return }
        resumePosition = savedInstanceState?.getLong("pos") ?: 0L

        val view = findViewById<PlayerView>(R.id.playerView)
        view.setShowSubtitleButton(true)
        view.subtitleView?.apply {
            setStyle(CaptionStyleCompat(Color.WHITE, Color.TRANSPARENT, Color.TRANSPARENT,
                CaptionStyleCompat.EDGE_TYPE_OUTLINE, Color.BLACK, null))
            setFractionalTextSize(SubtitleView.DEFAULT_TEXT_SIZE_FRACTION * 1.25f)
        }

        // Live TV has no subtitle lookup.
        if (intent.getBooleanExtra("live", false)) { subs = emptyList(); return }

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
        val url = intent.getStringExtra("url") ?: return
        // Torrent streams are served from localhost and a read can wait while the next
        // piece downloads, so allow long read timeouts and a larger forward buffer.
        val http = DefaultHttpDataSource.Factory()
            .setConnectTimeoutMs(30_000)
            .setReadTimeoutMs(120_000)
            .setAllowCrossProtocolRedirects(true)
        // Per-channel headers from IPTV playlists, and user:pass@host logins (e.g. TVHeadend).
        intent.getStringExtra("ua")?.takeIf { it.isNotBlank() }?.let { http.setUserAgent(it) }
        val headers = buildMap {
            intent.getStringExtra("referer")?.takeIf { it.isNotBlank() }?.let { put("Referer", it) }
            basicAuth(url)?.let { put("Authorization", it) }
        }
        if (headers.isNotEmpty()) http.setDefaultRequestProperties(headers)
        val loadControl = DefaultLoadControl.Builder()
            .setBufferDurationsMs(30_000, 120_000, 2_500, 5_000)
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
            .apply { if (url.contains(".m3u8") || url.contains("m3u8?")) setMimeType(MimeTypes.APPLICATION_M3U8) }
            .build()

        player = ExoPlayer.Builder(this)
            .setMediaSourceFactory(DefaultMediaSourceFactory(DefaultDataSource.Factory(this, http)))
            .setLoadControl(loadControl)
            .build().also {
                // Hebrew subtitles on by default (also picks embedded Hebrew tracks in MKVs).
                it.trackSelectionParameters = it.trackSelectionParameters.buildUpon()
                    .setPreferredTextLanguage("he")
                    .build()
                findViewById<PlayerView>(R.id.playerView).player = it
                it.setMediaItem(item)
                if (!intent.getBooleanExtra("live", false)) it.seekTo(resumePosition)
                it.prepare()
                it.playWhenReady = true
            }
    }

    override fun onStop() {
        super.onStop()
        started = false
        player?.let { resumePosition = it.currentPosition; it.release() }
        player = null
    }

    override fun onDestroy() {
        super.onDestroy()
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
    }
}
