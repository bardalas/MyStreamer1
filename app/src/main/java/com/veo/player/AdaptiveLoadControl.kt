package com.veo.player

import androidx.annotation.OptIn
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.LoadControl
import androidx.media3.common.Timeline
import androidx.media3.exoplayer.Renderer
import androidx.media3.exoplayer.analytics.PlayerId
import androidx.media3.exoplayer.source.MediaSource
import androidx.media3.exoplayer.source.TrackGroupArray
import androidx.media3.exoplayer.trackselection.ExoTrackSelection
import androidx.media3.exoplayer.upstream.Allocator

/**
 * How much of a film is fetched ahead, worked out from the line it comes over.
 *
 * The player's own rule is one number for everybody: ninety seconds. On a fast line that is a small fraction of
 * what could be held, and a pause - the moment a viewer most wants the next stretch already in hand - stops the
 * fetching at the same ninety seconds. Here the ceiling moves: when the line is comfortably faster than the
 * stream needs ([FAST] times), more is fetched, up to [CEILING_S] seconds, and never more than [CAP_BYTES]
 * of memory (a television box has little of it, so a high-bitrate film gets fewer extra seconds than a small one).
 * A pause is the same rule with nothing being watched: it goes on filling to that ceiling instead of stopping.
 *
 * Only for a film fetched over the network: a torrent comes from the box itself, a live stream must stay near its
 * edge. Everything else is the default control's, unchanged.
 */
@OptIn(UnstableApi::class)
class AdaptiveLoadControl(
    private val base: DefaultLoadControl,
    /** The line's speed now, in bits a second (0 when it is not known yet). */
    private val lineBps: () -> Long,
    /** The stream's own rate, in bits a second (0 when it is not known yet). */
    private val streamBps: () -> Long,
    private val enabled: () -> Boolean,
) : LoadControl {

    /* Everything but the one decision below is the default control's. (Kotlin's `by` hands on only what an interface
       leaves abstract: the newer default methods - the ones this player version calls - would throw "not
       implemented", so each is handed on by name.) */
    override fun onPrepared(playerId: PlayerId) = base.onPrepared(playerId)
    override fun onTracksSelected(playerId: PlayerId, timeline: Timeline, mediaPeriodId: MediaSource.MediaPeriodId,
        renderers: Array<Renderer>, trackGroups: TrackGroupArray, trackSelections: Array<ExoTrackSelection>) =
        base.onTracksSelected(playerId, timeline, mediaPeriodId, renderers, trackGroups, trackSelections)
    override fun onTracksSelected(parameters: LoadControl.Parameters, trackGroups: TrackGroupArray, trackSelections: Array<ExoTrackSelection>) =
        base.onTracksSelected(parameters, trackGroups, trackSelections)
    override fun onTracksSelected(timeline: Timeline, mediaPeriodId: MediaSource.MediaPeriodId, renderers: Array<Renderer>,
        trackGroups: TrackGroupArray, trackSelections: Array<ExoTrackSelection>) =
        base.onTracksSelected(timeline, mediaPeriodId, renderers, trackGroups, trackSelections)
    override fun onTracksSelected(renderers: Array<Renderer>, trackGroups: TrackGroupArray, trackSelections: Array<ExoTrackSelection>) =
        base.onTracksSelected(renderers, trackGroups, trackSelections)
    override fun onPrepared() = base.onPrepared()
    override fun onStopped() = base.onStopped()
    override fun onReleased() = base.onReleased()
    override fun getBackBufferDurationUs(): Long = base.getBackBufferDurationUs()
    override fun retainBackBufferFromKeyframe(): Boolean = base.retainBackBufferFromKeyframe()
    override fun shouldStartPlayback(timeline: Timeline, mediaPeriodId: MediaSource.MediaPeriodId, bufferedDurationUs: Long,
        playbackSpeed: Float, rebuffering: Boolean, targetLiveOffsetUs: Long): Boolean =
        base.shouldStartPlayback(timeline, mediaPeriodId, bufferedDurationUs, playbackSpeed, rebuffering, targetLiveOffsetUs)
    override fun shouldStartPlayback(bufferedDurationUs: Long, playbackSpeed: Float, rebuffering: Boolean, targetLiveOffsetUs: Long): Boolean =
        base.shouldStartPlayback(bufferedDurationUs, playbackSpeed, rebuffering, targetLiveOffsetUs)
    override fun shouldContinueLoading(playbackPositionUs: Long, bufferedDurationUs: Long, playbackSpeed: Float): Boolean =
        base.shouldContinueLoading(playbackPositionUs, bufferedDurationUs, playbackSpeed)
    override fun onStopped(playerId: PlayerId) = base.onStopped(playerId)
    override fun onReleased(playerId: PlayerId) = base.onReleased(playerId)
    override fun getAllocator(playerId: PlayerId): Allocator = base.getAllocator(playerId)
    override fun getBackBufferDurationUs(playerId: PlayerId): Long = base.getBackBufferDurationUs(playerId)
    override fun retainBackBufferFromKeyframe(playerId: PlayerId): Boolean = base.retainBackBufferFromKeyframe(playerId)
    override fun shouldStartPlayback(parameters: LoadControl.Parameters): Boolean = base.shouldStartPlayback(parameters)
    override fun shouldContinuePreloading(playerId: PlayerId, timeline: Timeline, mediaPeriodId: MediaSource.MediaPeriodId,
        bufferedDurationUs: Long): Boolean = base.shouldContinuePreloading(playerId, timeline, mediaPeriodId, bufferedDurationUs)

    override fun shouldContinueLoading(parameters: LoadControl.Parameters): Boolean {
        if (base.shouldContinueLoading(parameters)) return true
        if (!enabled()) return false
        val ceilingUs = ceilingUs(lineBps(), streamBps())
        // the ceiling is already what fits in CAP_BYTES at this stream's rate (ceilingUs): no second count of memory
        return parameters.bufferedDurationUs < ceilingUs
    }

    companion object {
        /** The default control's ceiling (see PlayerActivity.buildPlayer): what is beyond it is this class's. */
        const val BASE_S = 90L
        const val CEILING_S = 300L
        const val CAP_BYTES = 96L * 1024 * 1024
        const val FAST = 3.0
        private const val UNKNOWN_STREAM_BPS = 4_000_000L      // when the stream's rate is not known: a modest one

        /** The ceiling in microseconds for a line and a stream - 0 when there is nothing to add to the default's. */
        fun ceilingUs(lineBps: Long, streamBps: Long): Long {
            if (lineBps <= 0L) return 0L
            val stream = if (streamBps > 0L) streamBps else UNKNOWN_STREAM_BPS
            if (lineBps < stream * FAST) return 0L               // the line does not have room to spare
            val byMemory = CAP_BYTES / (stream / 8.0)            // seconds that fit in the memory allowed
            val seconds = minOf(CEILING_S.toDouble(), byMemory)
            return if (seconds > BASE_S) (seconds * 1_000_000).toLong() else 0L
        }
    }
}
