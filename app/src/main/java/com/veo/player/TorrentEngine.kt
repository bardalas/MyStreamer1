package com.veo.player

import android.content.Context
import android.util.Log
import com.frostwire.jlibtorrent.AnnounceEntry
import com.frostwire.jlibtorrent.Priority
import com.frostwire.jlibtorrent.SettingsPack
import com.frostwire.jlibtorrent.swig.settings_pack
import org.json.JSONObject
import com.frostwire.jlibtorrent.SessionManager
import com.frostwire.jlibtorrent.Sha1Hash
import com.frostwire.jlibtorrent.TorrentFlags
import com.frostwire.jlibtorrent.TorrentHandle
import com.frostwire.jlibtorrent.TorrentInfo
import java.io.File
import java.net.URLEncoder
import java.util.concurrent.atomic.AtomicInteger

/**
 * Streams one file of a torrent: fetches metadata (DHT + trackers), downloads the file
 * sequentially with the start prioritised, and serves it over a local HTTP server
 * ([StreamServer]) so playback starts after a few MB instead of after the whole download.
 */
object TorrentEngine {
    private const val TAG = "VEOTorrent"
    private val session = SessionManager()
    @Volatile private var started = false
    /** Bumped on every new request so a superseded request stops quietly. */
    private val generation = AtomicInteger()

    private var currentHash: Sha1Hash? = null
    private var currentDir: File? = null
    private var server: StreamServer? = null

    /**
     * Bytes buffered from the start of the file before the player opens. Just the container header and the
     * first frames: [StreamServer] blocks every later read until its piece arrives, and the player's own
     * read timeout is two minutes, so opening early only moves the waiting into the player.
     */
    private const val START_BUFFER_BYTES = 1536L * 1024

    private val PUBLIC_TRACKERS = listOf(
        "udp://tracker.opentrackr.org:1337/announce",
        "udp://open.demonii.com:1337/announce",
        "udp://open.stealth.si:80/announce",
        "udp://tracker.torrent.eu.org:451/announce",
        "udp://exodus.desync.com:6969/announce",
        "udp://explodie.org:6969/announce",
        "udp://tracker.openbittorrent.com:6969/announce",
        "udp://tracker.dler.org:6969/announce",
    )

    /** Call at app start: clears old downloads and bootstraps DHT so the first stream starts faster. */
    fun warmUp(context: Context) {
        Thread {
            runCatching {
                File(context.filesDir, "torrents").deleteRecursively() // v0.5.x download location
                File(context.cacheDir, "torrents").deleteRecursively()
                ensureStarted()
            }
        }.start()
    }

    @Synchronized private fun ensureStarted() {
        if (!started) {
            session.start()
            // Peers are what a stream waits for: ask every tracker of every tier (not just the first that
            // answers) and open connections faster than the defaults do.
            session.applySettings(
                SettingsPack()
                    .setBoolean(settings_pack.bool_types.announce_to_all_trackers.swigValue(), true)
                    .setBoolean(settings_pack.bool_types.announce_to_all_tiers.swigValue(), true)
                    .setInteger(settings_pack.int_types.connection_speed.swigValue(), 200)
                    .setInteger(settings_pack.int_types.torrent_connect_boost.swigValue(), 100)
                    .setInteger(settings_pack.int_types.connections_limit.swigValue(), 400)
            )
            started = true
        }
    }

    /** Status for the page: JSON the page words itself (it owns the language), errors as "e:<code>". */
    private fun status(vararg pairs: Pair<String, Any>) = JSONObject(mapOf(*pairs)).toString()

    fun stream(
        context: Context,
        infoHash: String,
        fileIdx: Int,
        sources: List<String>,
        onStatus: (String) -> Unit,
        onReady: (String) -> Unit,
        onError: (String) -> Unit
    ) {
        val gen = generation.incrementAndGet()
        fun superseded() = gen != generation.get()
        val t0 = System.currentTimeMillis()
        fun lap(what: String) = Log.i(TAG, "$what after ${System.currentTimeMillis() - t0} ms")
        Thread {
            try {
                ensureStarted()
                stopCurrent()
                lap("session ready")
                waitForDht(::superseded, onStatus)
                lap("dht wait over (${session.stats().dhtNodes()} nodes)")
                if (superseded()) return@Thread

                onStatus(status("p" to "meta"))
                val tempDir = File(context.cacheDir, "torrent-meta").apply { mkdirs() }
                val metadata = session.fetchMagnet(buildMagnet(infoHash, sources), 60, tempDir)
                    ?: throw IllegalStateException("e:nopeers")
                if (superseded()) return@Thread
                lap("metadata")

                val ti = TorrentInfo(metadata)
                if (ti.numFiles() <= 0) throw IllegalStateException("e:empty")
                val idx = if (fileIdx in 0 until ti.numFiles()) fileIdx else largestVideoFile(ti)
                val priorities = Priority.array(Priority.IGNORE, ti.numFiles())
                priorities[idx] = Priority.SEVEN
                val saveDir = File(context.cacheDir, "torrents/$infoHash").apply { mkdirs() }

                session.download(ti, saveDir, null, priorities, null, TorrentFlags.SEQUENTIAL_DOWNLOAD)
                val hash = ti.infoHashV1() ?: throw IllegalStateException("e:type")
                val handle = waitForHandle(hash)
                handle.prioritizeFiles(priorities)
                // The metadata carries no trackers (they lived in the magnet), so without this the download
                // finds peers through DHT alone and sits at zero peers for tens of seconds.
                trackersOf(sources).forEach { handle.addTracker(AnnounceEntry(it)) }
                handle.forceReannounce()
                synchronized(this) { currentHash = hash; currentDir = saveDir }

                val media = StreamServer.Media(
                    file = File(saveDir, ti.files().filePath(idx)),
                    offset = ti.files().fileOffset(idx),
                    size = ti.files().fileSize(idx),
                    pieceLength = ti.pieceLength().toLong(),
                )
                lap("download started")
                bufferStart(handle, media, ::superseded, onStatus)
                if (superseded()) return@Thread
                lap("start buffered")

                val srv = StreamServer(handle, media).also { it.start() }
                synchronized(this) { server = srv }
                onStatus("")
                onReady(srv.url)
            } catch (t: Throwable) {
                if (!superseded()) onError(t.message ?: t.javaClass.simpleName)
            }
        }.start()
    }

    /** Stops the active stream, removes the torrent and deletes its data. */
    fun stopCurrent() {
        val (srv, hash, dir) = synchronized(this) {
            Triple(server, currentHash, currentDir).also { server = null; currentHash = null; currentDir = null }
        }
        srv?.stop()
        hash?.let { h -> session.find(h)?.let { session.remove(it) } }
        dir?.deleteRecursively()
    }

    /** Cancels a request still fetching info/buffering (e.g. the user backed out). */
    fun cancelPending() { generation.incrementAndGet() }

    private fun trackersOf(sources: List<String>): List<String> =
        (sources.filter { it.startsWith("tracker:") }.map { it.removePrefix("tracker:") } + PUBLIC_TRACKERS).distinct()

    private fun buildMagnet(infoHash: String, sources: List<String>): String = buildString {
        append("magnet:?xt=urn:btih:").append(infoHash)
        trackersOf(sources).forEach { append("&tr=").append(URLEncoder.encode(it, "UTF-8")) }
    }

    /** DHT-only lookups fail if started before the node table is populated; wait briefly for it. */
    private fun waitForDht(superseded: () -> Boolean, onStatus: (String) -> Unit) {
        val deadline = System.currentTimeMillis() + 3_000   // the magnet carries trackers, so DHT is a bonus, not a gate
        while (System.currentTimeMillis() < deadline && !superseded()) {
            val nodes = session.stats().dhtNodes()
            if (nodes >= 5) return
            onStatus(status("p" to "dht", "nodes" to nodes))
            Thread.sleep(500)
        }
    }

    private fun waitForHandle(hash: Sha1Hash): TorrentHandle {
        repeat(100) {
            session.find(hash)?.let { if (it.isValid) return it }
            Thread.sleep(100)
        }
        throw IllegalStateException("e:start")
    }

    private fun bufferStart(
        handle: TorrentHandle,
        media: StreamServer.Media,
        superseded: () -> Boolean,
        onStatus: (String) -> Unit
    ) {
        val first = media.firstPiece
        val last = media.pieceAt(minOf(media.size, START_BUFFER_BYTES) - 1)
        for (p in first..last) handle.setPieceDeadline(p, 1000 + (p - first) * 100)
        // The end of the file often holds the index (MP4 "moov"); fetch it early too.
        handle.setPieceDeadline(media.lastPiece, 2000)

        val total = last - first + 1
        val need = total * media.pieceLength
        while (!superseded()) {
            val have = (first..last).count { handle.havePiece(it) }
            if (have == total) return
            val st = handle.status()
            // whole pieces only count once complete, so show the bytes that have arrived towards them
            onStatus(status("p" to "buffer", "peers" to st.numPeers(), "kbs" to st.downloadRate() / 1024,
                "got" to st.totalPayloadDownload().coerceAtMost(need), "need" to need))
            Thread.sleep(500)
        }
    }

    private fun largestVideoFile(ti: TorrentInfo): Int {
        val fs = ti.files()
        val videoExt = listOf(".mkv", ".mp4", ".avi", ".webm", ".m4v")
        val all = (0 until ti.numFiles())
        return all.filter { i -> videoExt.any { fs.filePath(i).lowercase().endsWith(it) } }
            .maxByOrNull { fs.fileSize(it) }
            ?: all.maxBy { fs.fileSize(it) }
    }
}
