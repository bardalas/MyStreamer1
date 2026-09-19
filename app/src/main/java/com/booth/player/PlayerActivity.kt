package com.booth.player

import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
import androidx.media3.common.MediaItem
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView

class PlayerActivity : AppCompatActivity() {
    private var player: ExoPlayer? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_player)
        val url = intent.getStringExtra("url") ?: run { finish(); return }
        player = ExoPlayer.Builder(this).build().also {
            findViewById<PlayerView>(R.id.playerView).player = it
            it.setMediaItem(MediaItem.fromUri(url))
            it.prepare()
            it.playWhenReady = true
        }
    }

    override fun onStop() {
        super.onStop()
        player?.release()
        player = null
    }
}
