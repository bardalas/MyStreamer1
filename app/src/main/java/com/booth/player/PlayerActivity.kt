package com.booth.player

import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
import androidx.media3.common.MediaItem
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView

class PlayerActivity : AppCompatActivity() {
    private var player: ExoPlayer? = null
    private var resumePosition = 0L

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_player)
        if (intent.getStringExtra("url") == null) { finish(); return }
        resumePosition = savedInstanceState?.getLong("pos") ?: 0L
    }

    // Build the player in onStart and release it in onStop, so returning from
    // Home / another app recreates it (at the same position) instead of a black screen.
    override fun onStart() {
        super.onStart()
        val url = intent.getStringExtra("url") ?: return
        player = ExoPlayer.Builder(this).build().also {
            findViewById<PlayerView>(R.id.playerView).player = it
            it.setMediaItem(MediaItem.fromUri(url))
            it.seekTo(resumePosition)
            it.prepare()
            it.playWhenReady = true
        }
    }

    override fun onStop() {
        super.onStop()
        player?.let { resumePosition = it.currentPosition; it.release() }
        player = null
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        outState.putLong("pos", player?.currentPosition ?: resumePosition)
    }
}
