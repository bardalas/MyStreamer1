package com.veo.player

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.Charset
import java.nio.charset.CodingErrorAction
import java.util.concurrent.Executors
import java.util.concurrent.Future
import java.util.concurrent.TimeUnit
import java.util.zip.ZipInputStream

/**
 * Finds Hebrew subtitles for the title being played and saves them as UTF-8 .srt files.
 * Sources: Wizdom (Israeli subtitle site, has most Hebrew subs) and OpenSubtitles via
 * Stremio's OpenSubtitles v3 add-on. Results are ranked by how closely the subtitle's
 * release name matches the video's, since timing is release-specific.
 *
 * [prefetch] runs when the user picks a source (in parallel with torrent buffering);
 * the player collects the result with [await].
 */
object Subtitles {
    data class Sub(val file: File, val label: String)

    private const val MAX_SUBS = 3
    private const val WIZDOM = "https://wizdom.xyz/api"
    private const val OPENSUBS = "https://opensubtitles-v3.strem.io"

    private val executor = Executors.newCachedThreadPool()
    @Volatile private var pending: Future<List<Sub>>? = null

    /** [videoId] is a Stremio id: "tt0111161" (movie) or "tt0903747:1:2" (series episode). */
    fun prefetch(context: Context, videoId: String, release: String) {
        pending?.cancel(true)
        pending = executor.submit<List<Sub>> {
            runCatching { find(File(context.cacheDir, "subs"), videoId, release) }.getOrDefault(emptyList())
        }
    }

    /** Captions that come with the video itself (a YouTube video's, translated - YouTube.kt): the one file. */
    fun prefetchFrom(context: Context, label: String, read: () -> String) {
        pending?.cancel(true)
        pending = executor.submit<List<Sub>> {
            runCatching {
                val text = read()
                if (!text.contains("-->")) return@runCatching emptyList<Sub>()
                val dir = File(context.cacheDir, "subs").apply { deleteRecursively(); mkdirs() }
                listOf(Sub(File(dir, "yt.srt").apply { writeText(text) }, label))
            }.getOrDefault(emptyList())
        }
    }

    fun await(timeoutMs: Long): List<Sub> =
        runCatching { pending?.get(timeoutMs, TimeUnit.MILLISECONDS) }.getOrNull() ?: emptyList()

    private data class Candidate(val source: String, val name: String, val score: Double, val download: () -> ByteArray)

    private fun find(dir: File, videoId: String, release: String): List<Sub> {
        val parts = videoId.split(':')
        val imdb = parts[0]
        if (!imdb.startsWith("tt")) return emptyList()
        val season = parts.getOrNull(1)
        val episode = parts.getOrNull(2)

        dir.deleteRecursively()
        dir.mkdirs()

        val candidates = (wizdom(imdb, season, episode, release) + openSubtitles(videoId, season != null, release))
            .sortedByDescending { it.score }

        val subs = mutableListOf<Sub>()
        for (c in candidates) {
            if (subs.size >= MAX_SUBS) break
            val text = runCatching { decode(unzipIfNeeded(c.download())) }.getOrNull() ?: continue
            if (!text.contains("-->")) continue
            val file = File(dir, "he-${subs.size}.srt").apply { writeText(text) }
            subs += Sub(file, "עברית · ${c.source} · ${c.name.take(48)}")
        }
        return subs
    }

    private fun wizdom(imdb: String, season: String?, episode: String?, release: String): List<Candidate> = runCatching {
        var url = "$WIZDOM/search?action=by_id&imdb=$imdb"
        if (season != null && episode != null) url += "&season=$season&episode=$episode"
        val arr = JSONArray(String(get(url)))
        List(arr.length()) { i ->
            val o = arr.getJSONObject(i)
            val id = o.getLong("id")
            val name = o.optString("versioname")
            Candidate("Wizdom", name, similarity(name, release) + 0.01) { get("$WIZDOM/files/sub/$id") }
        }
    }.getOrDefault(emptyList())

    private fun openSubtitles(videoId: String, series: Boolean, release: String): List<Candidate> = runCatching {
        val type = if (series) "series" else "movie"
        val arr = JSONObject(String(get("$OPENSUBS/subtitles/$type/$videoId.json"))).getJSONArray("subtitles")
        (0 until arr.length()).map { arr.getJSONObject(it) }
            .filter { it.optString("lang") in setOf("heb", "he") }
            .map { o ->
                val name = o.optString("subtitleFileName").ifEmpty { o.optString("movieReleaseName") }
                Candidate("OpenSubtitles", name, similarity(name, release)) { get(o.getString("url")) }
            }
    }.getOrDefault(emptyList())

    /** Token overlap between release names, with extra weight for resolution, source and release group. */
    private fun similarity(a: String, b: String): Double {
        val ta = tokens(a)
        val tb = tokens(b)
        if (ta.isEmpty() || tb.isEmpty()) return 0.0
        var score = (ta intersect tb).size.toDouble() / (ta union tb).size
        val keys = setOf("2160p", "1080p", "720p", "480p", "bluray", "brrip", "bdrip", "webrip", "web", "webdl", "hdtv", "dvdrip", "remux", "x265", "hevc")
        score += (ta intersect tb intersect keys).size * 0.1
        // Release group is the part after the last '-', minus any file extension ("x265-RARBG.mp4" -> "rarbg").
        val groupA = a.substringAfterLast('-', "").substringBefore('.').lowercase().trim()
        val groupB = b.substringAfterLast('-', "").substringBefore('.').lowercase().trim()
        if (groupA.isNotEmpty() && groupA == groupB) score += 0.5
        return score
    }

    private fun tokens(s: String) = s.lowercase().replace("web-dl", "webdl").split(Regex("[^a-z0-9]+")).filter { it.isNotEmpty() }.toSet()

    private fun get(url: String): ByteArray {
        val conn = URL(url).openConnection() as HttpURLConnection
        conn.connectTimeout = 8_000
        conn.readTimeout = 10_000
        conn.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android) VEO")
        return conn.inputStream.use { it.readBytes() }
    }

    private fun unzipIfNeeded(bytes: ByteArray): ByteArray {
        if (bytes.size < 4 || bytes[0] != 'P'.code.toByte() || bytes[1] != 'K'.code.toByte()) return bytes
        ZipInputStream(ByteArrayInputStream(bytes)).use { zip ->
            while (true) {
                val entry = zip.nextEntry ?: break
                if (!entry.isDirectory && entry.name.lowercase().endsWith(".srt")) return zip.readBytes()
            }
        }
        throw IllegalStateException("No .srt in archive")
    }

    /** Hebrew subtitles are UTF-8 or Windows-1255; try strict UTF-8 first. */
    private fun decode(bytes: ByteArray): String {
        val utf8 = Charsets.UTF_8.newDecoder()
            .onMalformedInput(CodingErrorAction.REPORT)
            .onUnmappableCharacter(CodingErrorAction.REPORT)
        val text = try {
            utf8.decode(ByteBuffer.wrap(bytes)).toString()
        } catch (_: CharacterCodingException) {
            String(bytes, Charset.forName("windows-1255"))
        }
        return text.removePrefix("﻿")
    }
}
