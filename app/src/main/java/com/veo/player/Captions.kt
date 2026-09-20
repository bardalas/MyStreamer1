package com.veo.player

import java.io.File

/**
 * A subtitle file, held as lines with times, so that moving it in time costs nothing.
 *
 * The player can side-load a subtitle file, but it cannot shift one: to move a translation half a
 * second you would have to rewrite the file and build the player again, losing a second of the film
 * every time you nudge it. So the file is read once, here, and the line to show is looked up against
 * the clock with the offset applied - which makes syncing instant, and the same work whether the
 * offset is half a second or a minute.
 */
class Captions private constructor(private val cues: List<Cue>) {

    private class Cue(val from: Long, val to: Long, val text: String)

    /** Where the translation sits against the film, in milliseconds. Positive = later. */
    var shiftMs: Long = 0

    /** What should be on screen at [positionMs], or "" - the search is a walk from where it last was. */
    fun at(positionMs: Long): String {
        if (cues.isEmpty()) return ""
        val t = positionMs - shiftMs
        var i = last.coerceIn(0, cues.size - 1)
        if (cues[i].from > t) {                                   // jumped back
            while (i > 0 && cues[i - 1].to > t) i--
        }
        while (i < cues.size - 1 && cues[i].to < t) i++            // and forward
        last = i
        val c = cues[i]
        return if (t in c.from..c.to) c.text else ""
    }

    private var last = 0

    companion object {
        /** Read an .srt (or the .vtt the same shape covers); an unreadable file is simply no captions. */
        fun of(file: File): Captions = runCatching {
            val out = ArrayList<Cue>()
            var from = -1L
            var to = -1L
            val text = StringBuilder()
            fun flush() {
                if (from >= 0 && text.isNotEmpty()) out.add(Cue(from, to, text.toString().trim()))
                from = -1; to = -1; text.setLength(0)
            }
            file.forEachLine { raw ->
                val line = raw.trim().removePrefix("﻿")
                val times = TIMES.find(line)
                when {
                    times != null -> {
                        flush()
                        from = ms(times.groupValues[1])
                        to = ms(times.groupValues[2])
                    }
                    line.isEmpty() -> flush()
                    line.toIntOrNull() != null && text.isEmpty() -> Unit      // the cue's number
                    from >= 0 -> {
                        if (text.isNotEmpty()) text.append('\n')
                        text.append(line.replace(TAGS, ""))
                    }
                }
            }
            flush()
            Captions(out.sortedBy { it.from })
        }.getOrDefault(Captions(emptyList()))

        private val TIMES = Regex("""(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})""")
        private val TAGS = Regex("""</?[a-zA-Z][^>]*>""")

        private fun ms(stamp: String): Long {
            val p = stamp.replace(',', '.').split(':', '.')
            return p[0].toLong() * 3_600_000 + p[1].toLong() * 60_000 + p[2].toLong() * 1_000 +
                p.getOrElse(3) { "0" }.padEnd(3, '0').take(3).toLong()
        }
    }
}
