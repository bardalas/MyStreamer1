package com.veo.player

import androidx.media3.common.C
import androidx.media3.common.audio.AudioProcessor.AudioFormat
import androidx.media3.common.audio.AudioProcessor.UnhandledAudioFormatException
import androidx.media3.common.audio.BaseAudioProcessor
import androidx.media3.common.util.UnstableApi
import java.nio.ByteBuffer

/**
 * Moves the sound a little later or earlier than the picture, for a stream whose two are not quite together.
 *
 * Later ([delayMs] above zero): silence is put in front. Earlier: that much of the sound is left out. A change while playing
 * is applied to the very next samples (a hair of silence or a hair cut), so the viewer can tune it by ear.
 */
@UnstableApi
class AudioDelayProcessor : BaseAudioProcessor() {
    @Volatile var delayMs = 0
    private var appliedBytes = 0
    private var silence = 0
    private var drop = 0

    override fun onConfigure(inputAudioFormat: AudioFormat): AudioFormat {
        if (inputAudioFormat.encoding != C.ENCODING_PCM_16BIT) throw UnhandledAudioFormatException(inputAudioFormat)
        return inputAudioFormat
    }

    override fun onFlush() { appliedBytes = 0; silence = 0; drop = 0 }

    override fun queueInput(inputBuffer: ByteBuffer) {
        val frame = inputAudioFormat.bytesPerFrame
        val target = (delayMs.toLong() * inputAudioFormat.sampleRate / 1000).toInt() * frame
        val diff = target - appliedBytes
        if (diff > 0) silence += diff else drop += -diff
        appliedBytes = target
        var n = inputBuffer.remaining()
        if (drop > 0) {
            val d = minOf(drop, n)
            inputBuffer.position(inputBuffer.position() + d)
            drop -= d; n -= d
        }
        val out = replaceOutputBuffer(n + silence)
        if (silence > 0) { out.put(ByteArray(silence)); silence = 0 }
        out.put(inputBuffer)
        out.flip()
    }
}
