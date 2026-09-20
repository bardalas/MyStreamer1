package com.veo.player

import android.net.Uri
import com.frostwire.jlibtorrent.Priority
import com.frostwire.jlibtorrent.TorrentHandle
import java.io.BufferedOutputStream
import java.io.EOFException
import java.io.File
import java.io.IOException
import java.io.RandomAccessFile
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket

/**
 * Minimal localhost HTTP server with Range support that serves a file while it is still
 * downloading. A read blocks until the needed piece is present and gives that piece and the
 * next few a deadline, so seeking in the player re-prioritises the download.
 */
class StreamServer(
    private val handle: TorrentHandle,
    private val media: Media,
    /** Says what the reader is waiting for, so a jump forward is not a frozen picture. */
    private val onStatus: (String) -> Unit = {},
) {

    /** The streamed file's position inside the torrent's piece space. */
    data class Media(val file: File, val offset: Long, val size: Long, val pieceLength: Long) {
        fun pieceAt(filePos: Long) = ((offset + filePos) / pieceLength).toInt()
        val firstPiece get() = pieceAt(0)
        val lastPiece get() = pieceAt(size - 1)
        /** End (exclusive, file-relative) of the given piece. */
        fun pieceEnd(piece: Int) = (piece + 1) * pieceLength - offset
    }

    private val socket = ServerSocket(0, 8, InetAddress.getByName("127.0.0.1"))
    @Volatile private var closed = false

    val url: String get() = "http://127.0.0.1:${socket.localPort}/${Uri.encode(media.file.name)}"

    fun start() {
        Thread({
            while (!closed) {
                val client = try { socket.accept() } catch (e: IOException) { break }
                Thread { serve(client) }.start()
            }
        }, "stream-server").start()
    }

    fun stop() {
        closed = true
        runCatching { socket.close() }
    }

    private fun serve(client: Socket) {
        var raf: RandomAccessFile? = null
        try {
            client.use { s ->
                val reader = s.getInputStream().bufferedReader(Charsets.ISO_8859_1)
                val requestLine = reader.readLine() ?: return
                var start = 0L
                var end = media.size - 1
                var partial = false
                while (true) {
                    val line = reader.readLine() ?: break
                    if (line.isEmpty()) break
                    if (line.startsWith("Range:", ignoreCase = true)) {
                        val m = RANGE.find(line) ?: continue
                        val (a, b) = m.destructured
                        if (a.isNotEmpty()) {
                            start = a.toLong()
                            if (b.isNotEmpty()) end = minOf(b.toLong(), media.size - 1)
                        } else if (b.isNotEmpty()) {
                            start = maxOf(0L, media.size - b.toLong())
                        }
                        partial = true
                    }
                }

                val out = BufferedOutputStream(s.getOutputStream(), 64 * 1024)
                if (start >= media.size || start > end) {
                    out.write("HTTP/1.1 416 Range Not Satisfiable\r\nContent-Range: bytes */${media.size}\r\nConnection: close\r\n\r\n".toByteArray())
                    out.flush()
                    return
                }
                val header = buildString {
                    append(if (partial) "HTTP/1.1 206 Partial Content\r\n" else "HTTP/1.1 200 OK\r\n")
                    append("Content-Type: ${mimeType(media.file.name)}\r\n")
                    append("Accept-Ranges: bytes\r\n")
                    append("Content-Length: ${end - start + 1}\r\n")
                    if (partial) append("Content-Range: bytes $start-$end/${media.size}\r\n")
                    append("Connection: close\r\n\r\n")
                }
                out.write(header.toByteArray(Charsets.ISO_8859_1))
                if (requestLine.startsWith("HEAD")) { out.flush(); return }

                val buf = ByteArray(64 * 1024)
                var pos = start
                while (pos <= end) {
                    val piece = media.pieceAt(pos)
                    awaitPiece(piece)
                    val file = raf ?: RandomAccessFile(media.file, "r").also { raf = it }
                    val chunkEnd = minOf(end + 1, media.pieceEnd(piece))
                    file.seek(pos)
                    while (pos < chunkEnd) {
                        val n = file.read(buf, 0, minOf(buf.size.toLong(), chunkEnd - pos).toInt())
                        if (n < 0) throw EOFException()
                        out.write(buf, 0, n)
                        pos += n
                    }
                }
                out.flush()
            }
        } catch (_: IOException) {
            // Player closed the connection (seek / exit) or the stream was stopped.
        } catch (_: RuntimeException) {
            // The torrent was removed under a read that was waiting for a piece ("invalid torrent handle"):
            // that ends this connection, it must not take the app down with it.
        } catch (_: InterruptedException) {
        } finally {
            runCatching { raf?.close() }
        }
    }

    /** The piece the reader last asked for: anything far from it is a jump, not a read. */
    @Volatile private var atPiece = -1

    /**
     * Blocks until [piece] is downloaded, having asked for it and the window after it first.
     *
     * A jump is what makes streaming a torrent feel slow: after the opening minutes the whole file is
     * wanted equally, so the swarm hands out pieces from everywhere and the ones under the playhead
     * arrive last. Every jump therefore cancels the old queue and puts the pieces at the new position
     * at the top of it - the same trick that gets the first minutes in quickly.
     */
    private fun awaitPiece(piece: Int) {
        if (handle.havePiece(piece)) { atPiece = piece; return }
        val jumped = piece < atPiece || piece > atPiece + READ_AHEAD_PIECES
        atPiece = piece
        if (jumped) runCatching { handle.clearPieceDeadlines() }
        for (i in 0 until READ_AHEAD_PIECES) {
            val p = piece + i
            if (p > media.lastPiece || handle.havePiece(p)) continue
            runCatching { handle.piecePriority(p, if (i < 4) Priority.SEVEN else Priority.SIX) }
            handle.setPieceDeadline(p, i * 200)
        }
        val began = System.currentTimeMillis()
        var told = false
        while (!handle.havePiece(piece)) {
            if (closed) throw IOException("stream stopped")
            // a wait long enough to be noticed says so, and says how the pieces are coming in
            if (System.currentTimeMillis() - began > 700) {
                told = true
                val st = handle.status()
                onStatus("""{"p":"seek","kbs":${st.downloadRate() / 1024},"peers":${st.numPeers()}}""")
            }
            Thread.sleep(100)
        }
        if (told) onStatus("")
    }

    private fun mimeType(name: String) = when (name.substringAfterLast('.').lowercase()) {
        "mp4", "m4v" -> "video/mp4"
        "mkv" -> "video/x-matroska"
        "webm" -> "video/webm"
        "avi" -> "video/x-msvideo"
        else -> "application/octet-stream"
    }

    private companion object {
        val RANGE = Regex("bytes=(\\d*)-(\\d*)")
        const val READ_AHEAD_PIECES = 8
    }
}
