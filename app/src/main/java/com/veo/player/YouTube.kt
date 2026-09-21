package com.veo.player

import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.util.concurrent.Executors

/**
 * A YouTube video - a magazine episode, a trailer - as streams the app's own player plays: the picture,
 * its sound, and captions in the viewer's language. They are asked of YouTube the way its own apps ask
 * (the "player" call of its internal API), so the video plays full-screen in VEO's player, with VEO's
 * controls and nothing of YouTube's. The Android app's client is asked first and the iPhone app's after
 * it; both are asked with a visitor id, the one a first visit to YouTube is given. When neither answers
 * with streams, [resolve] says so and the page plays the video the old way, in YouTube's own player.
 */
object YouTube {
    /**
     * [audio] is empty when [video] carries its own sound. [captions] is the captions' address, empty when
     * there are none to show; [translateTo] is the language they are translated into, empty when they are
     * in the viewer's language already; [machine]: they were made by machine, from the speech.
     */
    class Streams(val video: String, val audio: String, val captions: String, val translateTo: String, val machine: Boolean, val ua: String)

    private class Client(val name: String, val num: Int, val version: String, val ua: String, val extra: Map<String, Any>)
    private val CLIENTS = listOf(
        Client("ANDROID", 3, "20.10.38", "com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip",
            mapOf("androidSdkVersion" to 30, "osName" to "Android", "osVersion" to "11")),
        Client("IOS", 5, "20.10.4", "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)",
            mapOf("deviceMake" to "Apple", "deviceModel" to "iPhone16,2", "osName" to "iPhone", "osVersion" to "18.3.2.22D82")),
    )
    /** The tallest picture asked for: above it YouTube has only VP9 and AV1, which not every television decodes. */
    private const val MAX_HEIGHT = 1080
    private val HEBREW = setOf("iw", "he")
    @Volatile private var visitor = ""

    /** [lang]: the interface's language ("he", "en"); captions are for a video spoken in another one. */
    fun resolve(videoId: String, lang: String): Streams? {
        if (visitor.isEmpty()) visitor = runCatching { visitorId() }.getOrDefault("")
        for (c in CLIENTS) runCatching { ask(c, videoId, lang) }.getOrNull()?.let { return it }
        visitor = ""                                   // a stale visitor id is the likeliest reason: the next try gets a new one
        return null
    }

    private fun visitorId(): String {
        val body = String(http("https://www.youtube.com/sw.js_data", "Mozilla/5.0"))
        return Regex("\"(Cg[A-Za-z0-9_%-]{20,})\"").find(body)?.groupValues?.get(1).orEmpty()
    }

    private fun ask(c: Client, videoId: String, lang: String): Streams? {
        val client = JSONObject(c.extra).put("clientName", c.name).put("clientVersion", c.version)
            .put("hl", code(lang)).put("gl", "IL")
        if (visitor.isNotEmpty()) client.put("visitorData", visitor)
        val body = JSONObject().put("context", JSONObject().put("client", client)).put("videoId", videoId)
            .put("contentCheckOk", true).put("racyCheckOk", true)
        val headers = mapOf("Content-Type" to "application/json", "X-YouTube-Client-Name" to c.num.toString(),
            "X-YouTube-Client-Version" to c.version, "X-Goog-Visitor-Id" to visitor)
        val j = JSONObject(String(http("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", c.ua, headers, body.toString())))
        if (j.optJSONObject("playabilityStatus")?.optString("status") != "OK") return null
        val sd = j.optJSONObject("streamingData") ?: return null
        val adaptive = objects(sd.optJSONArray("adaptiveFormats")).filter { it.has("url") }
        // the original sound, where a video carries dubbed ones beside it
        val original = { f: JSONObject -> f.optJSONObject("audioTrack")?.optBoolean("audioIsDefault", true) ?: true }
        val video = adaptive.filter { it.optString("mimeType").startsWith("video/mp4") && "avc1" in it.optString("mimeType") && it.optInt("height") <= MAX_HEIGHT }
            .maxWithOrNull(compareBy({ it.optInt("height") }, { it.optInt("bitrate") }))
        val audio = adaptive.filter { it.optString("mimeType").startsWith("audio/") && original(it) }
            .maxWithOrNull(compareBy({ it.optString("mimeType").startsWith("audio/mp4") }, { it.optInt("bitrate") }))
        val (track, translateTo) = captionsFor(j, lang)
        val captions = track?.let { it.optString("baseUrl").replace(Regex("&fmt=[^&]*"), "") + "&fmt=srv1" }.orEmpty()
        val machine = track?.optString("kind") == "asr"
        if (video != null && audio != null) return Streams(video.getString("url"), audio.getString("url"), captions, translateTo, machine, c.ua)
        // a picture with its sound in one file (360p): better than nothing
        val muxed = objects(sd.optJSONArray("formats")).firstOrNull { it.has("url") } ?: return null
        return Streams(muxed.getString("url"), "", captions, translateTo, machine, c.ua)
    }

    /** YouTube's code for a language: Hebrew is still "iw" there. */
    private fun code(lang: String) = if (lang in HEBREW) "iw" else lang

    /**
     * The captions to show, and the language to translate them into: the video's own in the viewer's
     * language if it has them; or else the ones in the language it is spoken in (made by hand before made
     * by machine), to be translated; and none for a video spoken in the viewer's language already.
     * YouTube's own translation of captions is refused to apps (429), so the app translates them itself.
     */
    private fun captionsFor(j: JSONObject, lang: String): Pair<JSONObject?, String> {
        val want = code(lang)
        val tracks = objects(j.optJSONObject("captions")?.optJSONObject("playerCaptionsTracklistRenderer")?.optJSONArray("captionTracks"))
        val of = { t: JSONObject -> code(t.optString("languageCode")) }
        val asr = { t: JSONObject -> t.optString("kind") == "asr" }
        val spoken = tracks.firstOrNull(asr)?.let(of)
        if (spoken == want) return null to ""
        tracks.firstOrNull { of(it) == want && !asr(it) }?.let { return it to "" }
        val from = tracks.firstOrNull { !asr(it) && of(it) == spoken } ?: tracks.firstOrNull(asr) ?: tracks.firstOrNull() ?: return null to ""
        return from to want
    }

    /* ---------- the captions, as a file the player reads ---------- */
    private class Cue(val from: Long, var to: Long, val text: String)

    /**
     * The captions of [s] as an .srt file's text, in the viewer's language. Captions made by machine come
     * as fragments of a sentence each on screen for a moment, overlapping the next; they are joined into
     * sentences first - a fragment translated alone reads as nonsense - and each then lasts until the next.
     */
    fun captionsText(s: Streams): String {
        if (s.captions.isEmpty()) return ""
        val xml = String(http(s.captions, s.ua), Charsets.UTF_8)
        val raw = Regex("""<text start="([\d.]+)"(?: dur="([\d.]+)")?[^>]*>([\s\S]*?)</text>""").findAll(xml).map { m ->
            val from = (m.groupValues[1].toDouble() * 1000).toLong()
            Cue(from, from + ((m.groupValues[2].toDoubleOrNull() ?: 3.0) * 1000).toLong(), unescape(m.groupValues[3]).replace('\n', ' ').trim())
        }.filter { it.text.isNotEmpty() }.toList()
        if (raw.isEmpty()) return ""
        val cues = if (s.machine) sentences(raw) else raw
        for (i in 0 until cues.size - 1) cues[i].to = minOf(cues[i].to, cues[i + 1].from).coerceAtLeast(cues[i].from + 500)
        val texts = if (s.translateTo.isEmpty()) cues.map { it.text } else translate(cues.map { it.text }, s.translateTo)
        return cues.indices.joinToString("") { i -> "${i + 1}\n${stamp(cues[i].from)} --> ${stamp(cues[i].to)}\n${texts[i]}\n\n" }
    }

    /** Fragments joined until a sentence ends, or until the line is as long as a caption should be. */
    private fun sentences(parts: List<Cue>): List<Cue> {
        val out = ArrayList<Cue>()
        var from = -1L
        val text = StringBuilder()
        for ((i, p) in parts.withIndex()) {
            if (from < 0) from = p.from
            if (text.isNotEmpty()) text.append(' ')
            text.append(p.text)
            val ends = p.text.last() in ".?!" || text.length > 84 || p.to - from > 6_500 || i == parts.lastIndex
            if (ends) { out += Cue(from, p.to, text.toString()); from = -1; text.setLength(0) }
        }
        return out
    }

    private fun stamp(ms: Long) = "%02d:%02d:%02d,%03d".format(ms / 3_600_000, ms / 60_000 % 60, ms / 1_000 % 60, ms % 1_000)

    /** srv1 escapes its text twice ("&amp;#39;"). */
    private fun unescape(s: String): String {
        var t = s
        repeat(2) {
            t = t.replace(Regex("&#(\\d+);")) { it.groupValues[1].toInt().toChar().toString() }
                .replace("&quot;", "\"").replace("&#39;", "'").replace("&lt;", "<").replace("&gt;", ">").replace("&amp;", "&")
        }
        return t.replace(Regex("<[^>]+>"), "")
    }

    /* ---------- translation ----------
       Google's translation, the one the page's words are translated with (providers/web.js): a batch of
       lines to a request, a few requests at once, and a line that does not come back stays as it was. */
    private val pool = Executors.newFixedThreadPool(3)
    private const val BATCH_CHARS = 4_500

    private fun translate(lines: List<String>, to: String): List<String> {
        val batches = ArrayList<IntRange>()
        var start = 0
        var len = 0
        for (i in lines.indices) {
            if (i > start && len + lines[i].length > BATCH_CHARS) { batches += start until i; start = i; len = 0 }
            len += lines[i].length + 1
        }
        batches += start until lines.size
        val out = lines.toMutableList()
        batches.map { r ->
            pool.submit {
                runCatching {
                    val part = lines.subList(r.first, r.last + 1)
                    val body = "q=" + URLEncoder.encode(part.joinToString("\n"), "UTF-8")
                    val j = JSONArray(String(http("https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=$to&dt=t",
                        "Mozilla/5.0 (Linux; Android 14)", mapOf("Content-Type" to "application/x-www-form-urlencoded;charset=UTF-8"), body)))
                    val segs = j.getJSONArray(0)
                    val back = (0 until segs.length()).joinToString("") { segs.getJSONArray(it).optString(0) }.split('\n')
                    if (back.size == part.size) synchronized(out) { back.forEachIndexed { k, t -> if (t.isNotBlank()) out[r.first + k] = t.trim() } }
                }
            }
        }.forEach { runCatching { it.get() } }
        return out
    }

    private fun objects(a: JSONArray?): List<JSONObject> = if (a == null) emptyList() else List(a.length()) { a.getJSONObject(it) }

    private fun http(url: String, ua: String, headers: Map<String, String> = emptyMap(), post: String? = null): ByteArray {
        val conn = URL(url).openConnection() as HttpURLConnection
        conn.connectTimeout = 8_000
        conn.readTimeout = 15_000
        conn.setRequestProperty("User-Agent", ua)
        headers.forEach { (k, v) -> if (v.isNotEmpty()) conn.setRequestProperty(k, v) }
        if (post != null) {
            conn.requestMethod = "POST"
            conn.doOutput = true
            conn.outputStream.use { it.write(post.toByteArray()) }
        }
        return conn.inputStream.use { it.readBytes() }
    }
}
