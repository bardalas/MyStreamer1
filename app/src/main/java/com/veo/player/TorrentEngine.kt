package com.veo.player

import android.content.Context
import com.frostwire.jlibtorrent.Priority
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
    private val session = SessionManager()
    @Volatile private var started = false
    /** Bumped on every new request so a superseded request stops quietly. */
    private val generation = AtomicInteger()

    private var currentHash: Sha1Hash? = null
    private var currentDir: File? = null
    private var server: StreamServer? = null

    /** Bytes buffered from the start of the file before the player opens. */
    private const val START_BUFFER_BYTES = 8L * 1024 * 1024

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
            started = true
        }
    }

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
        Thread {
            try {
                ensureStarted()
                stopCurrent()
                waitForDht(::superseded, onStatus)
                if (superseded()) return@Thread

                onStatus("מקבל את פרטי הטורנט…")
                val tempDir = File(context.cacheDir, "torrent-meta").apply { mkdirs() }
                val metadata = session.fetchMagnet(buildMagnet(infoHash, sources), 60, tempDir)
                    ?: throw IllegalStateException("אף מחשב לא ענה למקור הזה. נסה מקור עם יותר זורעים.")
                if (superseded()) return@Thread

                val ti = TorrentInfo(metadata)
                if (ti.numFiles() <= 0) throw IllegalStateException("הטורנט ריק")
                val idx = if (fileIdx in 0 until ti.numFiles()) fileIdx else largestVideoFile(ti)
                val priorities = Priority.array(Priority.IGNORE, ti.numFiles())
                priorities[idx] = Priority.SEVEN
                val saveDir = File(context.cacheDir, "torrents/$infoHash").apply { mkdirs() }

                session.download(ti, saveDir, null, priorities, null, TorrentFlags.SEQUENTIAL_DOWNLOAD)
                val hash = ti.infoHashV1() ?: throw IllegalStateException("סוג טורנט לא נתמך")
                val handle = waitForHandle(hash)
                handle.prioritizeFiles(priorities)
                synchronized(this) { currentHash = hash; currentDir = saveDir }

                val media = StreamServer.Media(
                    file = File(saveDir, ti.files().filePath(idx)),
                    offset = ti.files().fileOffset(idx),
                    size = ti.files().fileSize(idx),
                    pieceLength = ti.pieceLength().toLong(),
                )
                bufferStart(handle, media, ::superseded, onStatus)
                if (superseded()) return@Thread

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

    private fun buildMagnet(infoHash: String, sources: List<String>): String {
        val trackers = sources.filter { it.startsWith("tracker:") }.map { it.removePrefix("tracker:") } + PUBLIC_TRACKERS
        return buildString {
            append("magnet:?xt=urn:btih:").append(infoHash)
            trackers.distinct().forEach { append("&tr=").append(URLEncoder.encode(it, "UTF-8")) }
        }
    }

    /** DHT-only lookups fail if started before the node table is populated; wait briefly for it. */
    private fun waitForDht(superseded: () -> Boolean, onStatus: (String) -> Unit) {
        val deadline = System.currentTimeMillis() + 10_000
        while (System.currentTimeMillis() < deadline && !superseded()) {
            val nodes = session.stats().dhtNodes()
            if (nodes >= 10) return
            onStatus("מתחבר לרשת הטורנטים… ($nodes צמתים)")
            Thread.sleep(500)
        }
    }

    private fun waitForHandle(hash: Sha1Hash): TorrentHandle {
        repeat(100) {
            session.find(hash)?.let { if (it.isValid) return it }
            Thread.sleep(100)
        }
        throw IllegalStateException("הטורנט לא התחיל")
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
        while (!superseded()) {
            val have = (first..last).count { handle.havePiece(it) }
            if (have == total) return
            val st = handle.status()
            onStatus("טוען… ${have * 100 / total}% • ${st.downloadRate() / 1024} KB/s • ${st.numPeers()} עמיתים")
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
