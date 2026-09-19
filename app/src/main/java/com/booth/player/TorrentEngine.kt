package com.booth.player

import android.content.Context
import android.net.Uri
import com.frostwire.jlibtorrent.Priority
import com.frostwire.jlibtorrent.SessionManager
import com.frostwire.jlibtorrent.TorrentFlags
import com.frostwire.jlibtorrent.TorrentInfo
import java.io.File

object TorrentEngine {
    private val session = SessionManager()
    @Volatile private var started = false

    @Synchronized private fun ensureStarted() {
        if (!started) {
            session.start()
            started = true
        }
    }

    fun downloadSelected(
        context: Context,
        infoHash: String,
        fileIdx: Int,
        onStatus: (String) -> Unit,
        onReady: (String) -> Unit,
        onError: (String) -> Unit
    ) {
        Thread {
            try {
                ensureStarted()
                val magnet = "magnet:?xt=urn:btih:$infoHash"
                onStatus("Getting torrent metadata…")
                val tempDir = File(context.cacheDir, "torrent-meta").apply { mkdirs() }
                val metadata = session.fetchMagnet(magnet, 90, tempDir)
                    ?: throw IllegalStateException("Could not fetch torrent metadata. Try another source with more seeders.")
                val ti = TorrentInfo(metadata)
                if (ti.numFiles() <= 0) throw IllegalStateException("Torrent contains no files")

                val idx = if (fileIdx in 0 until ti.numFiles()) fileIdx else largestVideoFile(ti)
                val priorities = Priority.array(Priority.IGNORE, ti.numFiles())
                priorities[idx] = Priority.SEVEN
                val saveDir = File(context.filesDir, "torrents/$infoHash").apply { mkdirs() }

                onStatus("Starting torrent…")
                session.download(ti, saveDir, null, priorities, null, TorrentFlags.SEQUENTIAL_DOWNLOAD)
                val hash = ti.infoHashV1() ?: throw IllegalStateException("Unsupported torrent hash")

                var lastPct = -1
                while (true) {
                    val handle = session.find(hash)
                    if (handle != null) {
                        val st = handle.status()
                        val pct = (st.progress() * 100f).toInt().coerceIn(0, 100)
                        if (pct != lastPct) {
                            lastPct = pct
                            onStatus("Downloading… $pct% • ${st.downloadRate() / 1024} KB/s • ${st.numPeers()} peers")
                        }
                        if (st.isFinished()) break
                    }
                    Thread.sleep(1000)
                }

                val relative = ti.files().filePath(idx)
                val media = File(saveDir, relative)
                if (!media.exists()) throw IllegalStateException("Downloaded media file not found: $relative")
                onStatus("Opening video…")
                onReady(Uri.fromFile(media).toString())
            } catch (t: Throwable) {
                onError(t.message ?: t.javaClass.simpleName)
            }
        }.start()
    }

    private fun largestVideoFile(ti: TorrentInfo): Int {
        val fs = ti.files()
        var best = 0
        var bestSize = -1L
        for (i in 0 until ti.numFiles()) {
            val p = fs.filePath(i).lowercase()
            val video = p.endsWith(".mkv") || p.endsWith(".mp4") || p.endsWith(".avi") || p.endsWith(".webm") || p.endsWith(".m4v")
            val size = fs.fileSize(i)
            if (video && size > bestSize) { best = i; bestSize = size }
        }
        if (bestSize >= 0) return best
        for (i in 0 until ti.numFiles()) {
            val size = fs.fileSize(i)
            if (size > bestSize) { best = i; bestSize = size }
        }
        return best
    }
}
