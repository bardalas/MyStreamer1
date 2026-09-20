package com.veo.player

import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.GestureDetector
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.View
import android.widget.BaseAdapter
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ListView
import android.widget.ProgressBar
import android.widget.TextView
import androidx.annotation.OptIn
import androidx.appcompat.app.AppCompatActivity
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.datasource.HttpDataSource
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.SeekParameters
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.ui.CaptionStyleCompat
import androidx.media3.ui.PlayerView
import androidx.media3.ui.SubtitleView
import org.json.JSONArray
import kotlin.math.abs

class PlayerActivity : AppCompatActivity() {
    /** One playable item. Live TV passes a whole channel list so the viewer can zap through it. */
    private data class Source(
        val name: String, val url: String, val ua: String, val referer: String, val drm: String = "",
        val num: Int = 0, val logo: String = "", val epg: String = "", val arch: String = "", val rec: Int = 0,
    )
    /** One programme from a channel's guide. */
    private data class Prog(val from: Long, val to: Long, val name: String)

    private var player: ExoPlayer? = null
    private var resumePosition = 0L
    private var started = false
    /** Hebrew subtitles for this video; null until the lookup started at play time has finished. */
    private var subs: List<Subtitles.Sub>? = null

    private var sources: List<Source> = emptyList()
    private var index = 0
    private val live get() = intent.getBooleanExtra("live", false) || sources.size > 1
    private val handler = Handler(Looper.getMainLooper())
    /** Automatic retries for the current channel (IPTV servers may still hold the previous session). */
    private var retries = 0
    /** What is playing, so the app can offer "continue watching" (written to shared preferences). */
    private val watchId get() = intent.getStringExtra("vid") ?: ""
    /** Live TV: the arrows walk the channel's guide in the banner. [walking] is that state, and
     *  [walkAt] the programme pointed at - null while it points at the live edge. Nothing changes on
     *  the screen until OK. */
    private var walking = false
    private var walkAt: Prog? = null
    /** OK is decided on release, so that holding it can mean something else. */
    private var okLong = false
    /** Catch-up: the past programme being played, or null while the channel is live. */
    private var catchUp: Prog? = null
    /** Which of the channel's archive addresses is being used: services spell them differently, so the
     *  ones that did not answer are stepped through until one plays. */
    private var archTry = 0
    /** Left/Right are decided on release too: a press steps a programme, holding them runs inside it. */
    private var seekLong = false
    /** Where the arrows are heading in a film, and how fast. The film itself does not move until they
     *  stop - see [scrubHold]. */
    private var scrubTo = -1L
    private var scrubDir = 0
    private var scrubTicks = 0
    /** Subtitles: which of the found files is on (-1 = none) and how far they are moved, in milliseconds. */
    private var subPick = 0
    private var subShift = 0L
    /** The chosen translation, read into memory: moving it in time is a subtraction, not a rebuild. */
    private var captions: Captions? = null
    /** How large they are drawn, as a multiple of the player's own size; kept between films. */
    private var subScale = 1.25f
    /** The app's skin and direction, so the banner and the channel list look like the rest of VEO. */
    private val skin by lazy { Skin(getSharedPreferences("veo", MODE_PRIVATE)) }

    @OptIn(UnstableApi::class)
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_player)

        sources = intent.getStringExtra("channels")?.let { json ->
            val a = JSONArray(json)
            List(a.length()) { i ->
                a.getJSONObject(i).run {
                    Source(optString("name"), optString("url"), optString("ua"), optString("referer"),
                        optString("drm"), optInt("num", i + 1), optString("logo"), optString("epg"),
                        optString("arch"), optInt("rec"))
                }
            }
        } ?: listOfNotNull(intent.getStringExtra("url")?.let {
            Source(intent.getStringExtra("title") ?: "", it, intent.getStringExtra("ua") ?: "", intent.getStringExtra("referer") ?: "",
                intent.getStringExtra("drm") ?: "")
        })
        if (sources.isEmpty()) { finish(); return }
        index = (savedInstanceState?.getInt("index") ?: intent.getIntExtra("index", 0)).coerceIn(0, sources.size - 1)
        resumePosition = savedInstanceState?.getLong("pos") ?: intent.getLongExtra("pos", 0L)

        applySkin()

        val view = findViewById<PlayerView>(R.id.playerView)
        subScale = getSharedPreferences("veo", MODE_PRIVATE).getFloat("subScale", 1.25f)
        view.setShowSubtitleButton(!live)
        view.subtitleView?.apply {
            setStyle(CaptionStyleCompat(Color.WHITE, Color.TRANSPARENT, Color.TRANSPARENT,
                CaptionStyleCompat.EDGE_TYPE_OUTLINE, Color.BLACK, null))
            setFractionalTextSize(SubtitleView.DEFAULT_TEXT_SIZE_FRACTION * subScale)
        }

        val remote = packageManager.hasSystemFeature(android.content.pm.PackageManager.FEATURE_LEANBACK)
        if (live || remote) view.useController = false   // a remote has the banner; a touch screen has the controls
        else view.controllerAutoShow = false             // and a film opens on the film either way

        // Live TV and broadcaster VOD (Hebrew already) have no subtitle lookup.
        if (live || intent.getBooleanExtra("nosubs", false)) {
            subs = emptyList()
            if (live) showBanner() else showOsd()      // the banner introduces the channel
            return
        }

        // Play now, look for Hebrew subtitles in the background: side-loaded subtitles have to be part
        // of the MediaItem, so when they arrive the player is rebuilt at the very same position.
        subs = emptyList()
        showMessage("מחפש כתוביות בעברית…", 0)
        Thread {
            val found = Subtitles.await(25_000)
            runOnUiThread {
                if (isFinishing || isDestroyed) return@runOnUiThread
                subs = found
                // which file they came from is not something to read over a film; only their absence is news
                if (found.isEmpty()) showMessage("לא נמצאו כתוביות בעברית", 3_000) else hideOsd.run()
                if (found.isNotEmpty()) useCaptions(0)
            }
        }.start()
    }

    /** Show the chosen translation (or none) from now on. */
    private fun useCaptions(pick: Int) {
        subPick = pick
        val sub = subs.orEmpty().getOrNull(pick)
        captions = sub?.let { Captions.of(it.file) }?.also { it.shiftMs = subShift }
        val view = findViewById<TextView>(R.id.cues)
        view.visibility = if (captions == null) View.GONE else View.VISIBLE
        view.textSize = 18f * subScale
        view.text = ""
        handler.removeCallbacks(tickCaptions)
        if (captions != null) handler.post(tickCaptions)
    }

    /** Move the translation, and see it move: nothing is rebuilt, so a press is a result. */
    private fun shiftCaptions(byMs: Long) {
        subShift = (subShift + byMs).coerceIn(-60_000, 60_000)
        captions?.shiftMs = subShift
        showMessage("סנכרון כתוביות %+.1f שנ׳".format(subShift / 1000.0), 1_500)
    }

    // explicit type: it schedules itself
    private val tickCaptions: Runnable = object : Runnable {
        override fun run() {
            val c = captions ?: return
            val p = player ?: return
            findViewById<TextView>(R.id.cues).text = c.at(p.currentPosition)
            handler.postDelayed(this, 120)
        }
    }

    /** Unused since the words became the app's own; kept out of the way. */
    private fun shiftedSub(sub: Subtitles.Sub, shiftMs: Long): java.io.File {
        if (shiftMs == 0L) return sub.file
        val out = java.io.File(cacheDir, "shift_${shiftMs}_${sub.file.name}")
        if (out.exists() && out.length() > 0) return out
        val stamp = Regex("\\d{2}:\\d{2}:\\d{2},\\d{3}")
        runCatching {
            out.writeText(sub.file.readText().replace(stamp) { m ->
                val p = m.value.split(':', ',')
                val t = (p[0].toLong() * 3600_000 + p[1].toLong() * 60_000 + p[2].toLong() * 1000 + p[3].toLong() + shiftMs)
                    .coerceAtLeast(0)
                "%02d:%02d:%02d,%03d".format(t / 3600_000, t / 60_000 % 60, t / 1000 % 60, t % 1000)
            })
        }.onFailure { return sub.file }
        return out
    }

    /** How large the subtitles are drawn: it takes effect as it is pressed, and is remembered. */
    @OptIn(UnstableApi::class)
    private fun setSubScale(v: Float) {
        subScale = v.coerceIn(0.8f, 2.4f)
        getSharedPreferences("veo", MODE_PRIVATE).edit().putFloat("subScale", subScale).apply()
        findViewById<TextView>(R.id.cues).textSize = 18f * subScale
        findViewById<PlayerView>(R.id.playerView).subtitleView
            ?.setFractionalTextSize(SubtitleView.DEFAULT_TEXT_SIZE_FRACTION * subScale)
    }

    /** Subtitles panel: which translation is shown, how far it is moved, and how large it is drawn. */
    private fun openSubsPanel() {
        val found = subs.orEmpty()
        if (found.isEmpty()) { showMessage(if (subs == null) "מחפש כתוביות…" else "לא נמצאו כתוביות לסרט הזה", 2_500); return }
        val rows = ArrayList<Pair<String, () -> Unit>>()
        found.forEachIndexed { i, s ->
            val mark = if (i == subPick) "● " else "○ "
            rows.add("$mark${s.label}" to { useCaptions(i); openSubsPanel() })
        }
        rows.add((if (subPick < 0) "● " else "○ ") + "ללא כתוביות" to { useCaptions(-1); openSubsPanel() })
        val now = "%+.1f".format(subShift / 1000.0)
        rows.add("הכתוביות מאחרות · הקדם 0.5 שנ׳ · כעת $now" to { shiftCaptions(-500); openSubsPanel() })
        rows.add("הכתוביות מקדימות · אחר 0.5 שנ׳ · כעת $now" to { shiftCaptions(500); openSubsPanel() })
        rows.add("כוונון עדין · 0.1 שנ׳ אחורה" to { shiftCaptions(-100); openSubsPanel() })
        rows.add("כוונון עדין · 0.1 שנ׳ קדימה" to { shiftCaptions(100); openSubsPanel() })
        if (subShift != 0L) rows.add("בטל סנכרון" to { shiftCaptions(-subShift); openSubsPanel() })
        val size = "%d%%".format((subScale * 100).toInt())
        rows.add("כתוביות גדולות יותר · $size" to { setSubScale(subScale + 0.15f); openSubsPanel() })
        rows.add("כתוביות קטנות יותר · $size" to { setSubScale(subScale - 0.15f); openSubsPanel() })
        val list = findViewById<ListView>(R.id.chList)
        val at = if (list.adapter is MenuAdapter) list.selectedItemPosition.coerceAtLeast(0) else 0
        list.adapter = MenuAdapter(rows.map { it.first })
        list.setOnItemClickListener { _, _, i, _ -> rows[i].second() }
        list.setOnItemLongClickListener { _, _, _, _ -> true }
        findViewById<View>(R.id.chPanel).visibility = View.VISIBLE
        list.requestFocus()
        list.setSelection(at.coerceAtMost(rows.size - 1))
    }

    /** A plain list of choices, in the same dress as the channel list. */
    private inner class MenuAdapter(private val items: List<String>) : BaseAdapter() {
        override fun getCount() = items.size
        override fun getItem(position: Int) = items[position]
        override fun getItemId(position: Int) = position.toLong()
        override fun getView(position: Int, convertView: View?, parent: android.view.ViewGroup?): View {
            val row = (convertView as? TextView) ?: TextView(this@PlayerActivity).apply {
                textSize = 18f
                setPadding(dp(22), dp(11), dp(22), dp(11))
                setTextColor(skin.light)
            }
            row.text = items[position]
            return row
        }
    }

    /** Hebrew subtitles arrived: rebuild the player around them, without losing the place. */
    private fun reloadWithSubs() {
        val p = player ?: return
        resumePosition = p.currentPosition
        val wasPlaying = p.playWhenReady
        p.release()
        player = null
        buildPlayer()
        player?.playWhenReady = wasPlaying
    }

    // Build the player in onStart and release it in onStop, so returning from
    // Home / another app recreates it (at the same position) instead of a black screen.
    override fun onStart() {
        super.onStart()
        started = true
        if (subs != null) buildPlayer()
    }

    @OptIn(UnstableApi::class)
    private fun buildPlayer() {
        if (player != null) return
        val src = sources[index]
        // a past programme is the same channel's archive, asked for by the minute it started
        val url = catchUp?.let { archiveUrl(src, it) } ?: src.url
        // Torrent streams come from localhost and a read may wait for the next piece: long
        // timeouts. Live is the opposite - a stalled connection must FAIL fast (seconds) so the
        // automatic retry can rebuild, instead of hanging two minutes looking frozen.
        val http = DefaultHttpDataSource.Factory()
            .setConnectTimeoutMs(if (live) 8_000 else 30_000)
            .setReadTimeoutMs(if (live) 10_000 else 120_000)
            .setAllowCrossProtocolRedirects(true)
        // Per-channel headers from IPTV playlists, and user:pass@host logins (e.g. TVHeadend).
        // Live channels that name no agent get a browser one - some IPTV panels throttle
        // players they do not recognize, which reads as endless buffering.
        val ua = src.ua.ifBlank { if (live) LIVE_UA else "" }
        if (ua.isNotBlank()) http.setUserAgent(ua)
        val headers = buildMap {
            src.referer.takeIf { it.isNotBlank() }?.let { put("Referer", it) }
            basicAuth(url)?.let { put("Authorization", it) }
        }
        if (headers.isNotEmpty()) http.setDefaultRequestProperties(headers)
        val loadControl = DefaultLoadControl.Builder()
            .setBufferDurationsMs(if (live) 8_000 else 30_000, 120_000, if (live) 1_200 else 2_500, 4_000)
            .build()

        // The files that were found are drawn by the app (see [useCaptions]); only tracks inside the
        // video itself are left to the player, so there is never one of each on screen.
        val item = MediaItem.Builder().setUri(url)
            // IPTV HLS links often carry tokens/query strings, which stop ExoPlayer inferring the type.
            .apply {
                if (url.contains(".m3u8")) setMimeType(MimeTypes.APPLICATION_M3U8)
                // Broadcaster VOD: DASH protected with Widevine, licensed by the broadcaster's own licence server.
                if (src.drm.isNotBlank()) {
                    if (!url.contains(".m3u8")) setMimeType(MimeTypes.APPLICATION_MPD)
                    setDrmConfiguration(MediaItem.DrmConfiguration.Builder(C.WIDEVINE_UUID).setLicenseUri(src.drm).build())
                }
            }
            .build()

        player = ExoPlayer.Builder(this)
            .setMediaSourceFactory(DefaultMediaSourceFactory(DefaultDataSource.Factory(this, http)))
            .setLoadControl(loadControl)
            .build().also {
                // Hebrew subtitles on by default (also picks embedded Hebrew tracks in MKVs) - unless the
                // viewer turned them off in the subtitles panel.
                it.trackSelectionParameters = it.trackSelectionParameters.buildUpon()
                    .setPreferredTextLanguage(if (subPick < 0) null else "he")
                    .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, subPick < 0)
                    .build()
                it.addListener(object : Player.Listener {
                    override fun onPlayerError(error: PlaybackException) = onError(error)
                    override fun onPlaybackStateChanged(state: Int) {
                        if (state != Player.STATE_READY) return
                        hideErrorPanel()
                        if (retries > 0) { retries = 0; handler.postDelayed(hideOsd, 1_500) }
                    }
                })
                // a jump lands on the nearest picture the file starts from: far less to fetch, and it is
                // a second either way in a film
                if (!live) it.setSeekParameters(SeekParameters.PREVIOUS_SYNC)
                findViewById<PlayerView>(R.id.playerView).apply { player = it; if (!live) hideController() }
                it.setMediaItem(item)
                if (!live) it.seekTo(resumePosition)
                it.prepare()
                it.playWhenReady = true
            }
    }

    /** The archive addresses a channel offers, in the order they are tried. */
    private fun archList(src: Source) = src.arch.split('|').filter { it.isNotBlank() }
    /** One past programme's address: the template in use, with the programme's own minute and length. */
    private fun archiveUrl(src: Source, p: Prog): String {
        val list = archList(src)
        if (list.isEmpty()) return src.url
        return list[archTry.coerceIn(0, list.size - 1)]
            .replace("{from}", "${p.from}").replace("{dur}", "${p.to - p.from}")
    }

    /** Guide per channel (by its endpoint), fetched once and kept for the session. */
    private val guides = HashMap<String, List<Prog>>()
    private val guideExec = java.util.concurrent.Executors.newFixedThreadPool(3)
    private val logos = HashMap<String, android.graphics.Bitmap?>()

    /** Paint the views this activity owns, and put them on the side the layout runs from. */
    private fun applySkin() {
        val dir = if (skin.rtl) View.LAYOUT_DIRECTION_RTL else View.LAYOUT_DIRECTION_LTR
        findViewById<View>(R.id.infobar).apply { layoutDirection = dir; setBackgroundColor(fade(skin.night, 0xEB)) }
        findViewById<View>(R.id.errbox).apply { layoutDirection = dir; setBackgroundColor(fade(skin.night, 0xF0)) }
        findViewById<TextView>(R.id.chNum).apply { setBackgroundColor(skin.accent); setTextColor(skin.onAccent) }
        findViewById<TextView>(R.id.chName).setTextColor(skin.light)
        findViewById<TextView>(R.id.nowTitle).setTextColor(skin.light)
        findViewById<TextView>(R.id.errTitle).setTextColor(skin.light)
        findViewById<TextView>(R.id.nowClock).setTextColor(skin.muted)
        findViewById<TextView>(R.id.nextTitle).setTextColor(skin.muted)
        findViewById<TextView>(R.id.errWhy).setTextColor(skin.muted)
        findViewById<ProgressBar>(R.id.nowBar).apply {
            progressTintList = android.content.res.ColorStateList.valueOf(skin.accent)
            progressBackgroundTintList = android.content.res.ColorStateList.valueOf(skin.line)
        }
        findViewById<TextView>(R.id.osd).apply { setBackgroundColor(fade(skin.night, 0xC8)); setTextColor(skin.light) }
        // The list keeps to the side the layout runs from, so it never covers what the banner says.
        findViewById<ListView>(R.id.chList).apply {
            layoutDirection = dir
            setBackgroundColor(fade(skin.night, 0xF5))
            divider = android.graphics.drawable.ColorDrawable(fade(skin.line, 0x80))
            dividerHeight = dp(1)
            selector = android.graphics.drawable.ColorDrawable(fade(skin.accent, 0x33))
        }
        findViewById<View>(R.id.chPanel).layoutDirection = dir
    }

    /** Fill the banner with the channel and what is on it, then fetch the guide if it is not in yet. */
    private fun paintBanner() {
        val src = sources[index]
        findViewById<TextView>(R.id.chNum).text = if (src.num > 0) "${src.num}" else "—"
        findViewById<TextView>(R.id.chName).text = src.name
        findViewById<TextView>(R.id.nowClock).text =
            android.text.format.DateFormat.getTimeFormat(this).format(java.util.Date())
        val logo = findViewById<ImageView>(R.id.chLogo)
        val cached = logos[src.logo]
        logo.visibility = if (cached != null) View.VISIBLE else View.GONE
        cached?.let { logo.setImageBitmap(it) }
        if (src.logo.isNotBlank() && !logos.containsKey(src.logo)) loadLogo(src.logo)
        paintNow()
        if (src.epg.isNotBlank() && !guides.containsKey(src.epg)) loadGuide(src.epg)
    }

    /** The "now / next" part, refreshed every minute while the banner is up. */
    private fun paintNow() {
        findViewById<TextView>(R.id.nowTitle).textDirection = View.TEXT_DIRECTION_LOCALE
        val src = sources.getOrNull(index) ?: return
        val now = System.currentTimeMillis() / 1000
        val progs = guides[src.epg]
        // the banner is about the programme being pointed at, else the one playing (live or from the archive)
        val onNow = progs?.firstOrNull { now in it.from until it.to }
        val back = if (walking) walkAt else catchUp
        val playing = back ?: onNow
        val next = progs?.firstOrNull { it.from >= (playing?.to ?: now) }
        val title = findViewById<TextView>(R.id.nowTitle)
        val bar = findViewById<ProgressBar>(R.id.nowBar)
        val after = findViewById<TextView>(R.id.nextTitle)
        if (playing != null) {
            title.text = "${hhmm(playing.from)} · ${playing.name}"
            bar.visibility = View.VISIBLE
            val pos = if (walking) 0L
                      else if (back != null) (player?.currentPosition ?: 0L) / 1000
                      else now - playing.from
            bar.progress = ((pos * 100) / (playing.to - playing.from).coerceAtLeast(1)).toInt().coerceIn(0, 100)
            val left = (((playing.to - playing.from) - pos) / 60).coerceAtLeast(0)
            after.text = if (walking) "OK · ${hhmm(playing.from)}–${hhmm(playing.to)}"
                         else if (back != null) "צפייה אחורה · נותרו $left דק׳"
                         else if (next != null) "עוד $left דק׳ · אחר כך ${hhmm(next.from)} ${next.name}"
                         else "נותרו $left דק׳"
        } else {
            title.text = if (progs == null && src.epg.isNotBlank()) "טוען לוח שידורים…"
                         else if (next != null) "הבא: ${hhmm(next.from)} · ${next.name}"
                         else "שידור חי"
            bar.visibility = View.GONE
            after.text = ""
        }
    }

    private fun hhmm(epochSeconds: Long): String =
        android.text.format.DateFormat.getTimeFormat(this).format(java.util.Date(epochSeconds * 1000))

    private fun loadGuide(url: String) {
        if (!loadingGuides.add(url)) return
        // Every channel in the list wants its guide at once, so they queue three at a time, each with a
        // short patience, and what came back is kept for half an hour: opening the list again is instant.
        guideExec.execute {
            val list = runCatching {
                val kept = java.io.File(cacheDir, "epg_${url.hashCode().toUInt().toString(16)}.json")
                val text = kept.takeIf { it.isFile && System.currentTimeMillis() - it.lastModified() < 30 * 60_000L }
                    ?.readText()
                    ?: (java.net.URL(url).openConnection() as java.net.HttpURLConnection).run {
                        connectTimeout = 6_000
                        readTimeout = 8_000
                        setRequestProperty("User-Agent", LIVE_UA)
                        inputStream.bufferedReader().use { it.readText() }
                    }.also { runCatching { kept.writeText(it) } }
                val arr = org.json.JSONArray(text)
                (0 until arr.length()).mapNotNull { i ->
                    arr.optJSONObject(i)?.let {
                        val from = it.optLong("time"); val to = it.optLong("time_to")
                        if (from > 0 && to > from) Prog(from, to, it.optString("name")) else null
                    }
                }.sortedBy { it.from }
            }.getOrDefault(emptyList())
            runOnUiThread {
                guides[url] = list
                if (bannerOpen) paintNow()
                (findViewById<ListView>(R.id.chList).adapter as? BaseAdapter)?.notifyDataSetChanged()
            }
        }
    }

    private fun loadLogo(url: String) {
        Thread {
            val bmp = runCatching {
                java.net.URL(url).openStream().use { android.graphics.BitmapFactory.decodeStream(it) }
            }.getOrNull()
            runOnUiThread {
                logos[url] = bmp
                if (bannerOpen && sources.getOrNull(index)?.logo == url && bmp != null) {
                    findViewById<ImageView>(R.id.chLogo).apply { setImageBitmap(bmp); visibility = View.VISIBLE }
                }
            }
        }.start()
    }

    /** Raise the banner (every channel change does, and every step through a film), and take it down
     *  again after a few seconds. While the arrows are walking the guide it stays longer: OK is what
     *  it is waiting for. */
    private fun showBanner() {
        // a film on a touch screen is followed by the player's own bar: two of them, facing opposite
        // ways, is one too many
        if (!live && findViewById<PlayerView>(R.id.playerView).useController) return
        findViewById<View>(R.id.infobar).visibility = View.VISIBLE
        if (!live) {
            paintFilm()
            handler.removeCallbacks(hideBanner)
            handler.removeCallbacks(tickBanner)
            handler.postDelayed(tickBanner, if (scrubTo >= 0) 200 else 1_000)
            handler.postDelayed(hideBanner, if (scrubTo >= 0) 9_000 else 5_000)
            return
        }
        paintBanner()
        handler.removeCallbacks(hideBanner)
        handler.removeCallbacks(tickBanner)
        handler.postDelayed(tickBanner, if (catchUp != null && !walking) 1_000 else 30_000)
        handler.postDelayed(hideBanner, if (walking) 12_000L else 8_000L)
    }

    // explicit type: it reschedules itself (a paused picture keeps its banner)
    private val hideBanner: Runnable = Runnable {
        if (player?.playWhenReady == false && !walking) handler.postDelayed(hideBanner, 8_000) else hideChannelBar()
    }
    // explicit type: it schedules itself, which Kotlin cannot infer through. While a past programme is
    // playing the bar is where the viewer is inside it, so it is redrawn every second, not every minute.
    private val tickBanner: Runnable = Runnable {
        if (!bannerOpen) return@Runnable
        if (!live) { paintFilm(); handler.postDelayed(tickBanner, if (scrubTo >= 0) 200 else 1_000); return@Runnable }
        paintNow()
        handler.postDelayed(tickBanner, if (catchUp != null && !walking) 1_000 else 30_000)
    }

    /** The same banner, for a film: its name, where you are in it, and how much of it is left. */
    private fun paintFilm() {
        val p = player ?: return
        val dur = p.duration.coerceAtLeast(0)
        val aim = scrubTo >= 0
        val pos = (if (aim) scrubTo else p.currentPosition).coerceIn(0, if (dur > 0) dur else Long.MAX_VALUE)
        findViewById<TextView>(R.id.chNum).text = if (p.playWhenReady) "▶" else "❚❚"
        findViewById<TextView>(R.id.chName).text = intent.getStringExtra("title").orEmpty()
        findViewById<ImageView>(R.id.chLogo).visibility = View.GONE
        findViewById<TextView>(R.id.nowClock).text =
            android.text.format.DateFormat.getTimeFormat(this).format(java.util.Date())
        val bar = findViewById<ProgressBar>(R.id.nowBar)
        bar.visibility = if (dur > 0) View.VISIBLE else View.GONE
        if (dur > 0) bar.progress = ((pos * 100) / dur).toInt().coerceIn(0, 100)
        // times read left to right even on a right-to-left screen, where they would otherwise be reordered
        findViewById<TextView>(R.id.nowTitle).apply {
            textDirection = View.TEXT_DIRECTION_LTR
            text = if (dur > 0) "${fmtClock(pos)} / ${fmtClock(dur)}" else fmtClock(pos)
        }
        val moved = pos - p.currentPosition
        findViewById<TextView>(R.id.nextTitle).text =
            if (aim) (if (moved >= 0) "קדימה " else "אחורה ") + fmtClock(kotlin.math.abs(moved))
            else if (dur > 0) "נותרו ${fmtClock(dur - pos)}" else ""
    }
    private val bannerOpen get() = findViewById<View>(R.id.infobar).visibility == View.VISIBLE

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    private fun hideChannelBar() {
        walking = false
        walkAt = null
        handler.removeCallbacks(hideBanner)
        handler.removeCallbacks(tickBanner)
        findViewById<View>(R.id.infobar).visibility = View.GONE
    }

    private fun pickChannel(i: Int) {
        hideChannelBar()
        if (i != index) zapBy(i - index) else showBanner()
    }

    /** Long press OK on a channel of the list: back to the app, opening that channel's catch-up (programme guide). */
    private fun openCatchUp(i: Int) {
        setResult(RESULT_OK, android.content.Intent().putExtra("catchup", sources[i].name))
        finish()
    }

    // ---- the channel list: a floating panel over the picture, opened by holding OK ----
    private val panelOpen get() = findViewById<View>(R.id.chPanel).visibility == View.VISIBLE
    private val loadingGuides = HashSet<String>()

    private inner class ChannelAdapter : BaseAdapter() {
        override fun getCount() = sources.size
        override fun getItem(position: Int) = sources[position]
        override fun getItemId(position: Int) = position.toLong()
        override fun getView(position: Int, convertView: View?, parent: android.view.ViewGroup?): View {
            val src = sources[position]
            val row = (convertView as? LinearLayout) ?: LinearLayout(this@PlayerActivity).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = android.view.Gravity.CENTER_VERTICAL
                setPadding(dp(22), dp(9), dp(22), dp(9))
                addView(TextView(context).apply { textSize = 17f; gravity = android.view.Gravity.CENTER; minWidth = dp(44) })
                addView(LinearLayout(context).apply {
                    orientation = LinearLayout.VERTICAL
                    setPadding(dp(14), 0, 0, 0)
                    addView(TextView(context).apply { textSize = 18f; maxLines = 1; ellipsize = android.text.TextUtils.TruncateAt.END })
                    addView(TextView(context).apply { textSize = 13f; maxLines = 1; ellipsize = android.text.TextUtils.TruncateAt.END })
                }, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
            }
            val num = row.getChildAt(0) as TextView
            val text = row.getChildAt(1) as LinearLayout
            val name = text.getChildAt(0) as TextView
            val now = text.getChildAt(1) as TextView
            val current = position == index
            num.text = if (src.num > 0) "${src.num}" else "—"
            num.setTextColor(if (current) skin.accent else fade(skin.muted, 0xCC))
            name.text = src.name
            name.setTextColor(if (current) skin.light else fade(skin.light, 0xCC))
            name.typeface = if (current) android.graphics.Typeface.DEFAULT_BOLD else android.graphics.Typeface.DEFAULT
            val seconds = System.currentTimeMillis() / 1000
            val playing = guides[src.epg]?.firstOrNull { seconds in it.from until it.to }
            now.text = playing?.name ?: ""
            now.setTextColor(skin.muted)
            now.visibility = if (playing != null) View.VISIBLE else View.GONE
            if (src.epg.isNotBlank() && !guides.containsKey(src.epg)) loadGuide(src.epg)
            return row
        }
    }

    private fun openPanel() {
        hideChannelBar()
        val list = findViewById<ListView>(R.id.chList)
        if (list.adapter !is ChannelAdapter) {
            list.adapter = ChannelAdapter()
            list.setOnItemClickListener { _, _, i, _ -> closePanel(); if (i != index) zapBy(i - index) else showBanner() }
            list.setOnItemLongClickListener { _, _, i, _ -> openCatchUp(i); true }
        }
        (list.adapter as BaseAdapter).notifyDataSetChanged()
        findViewById<View>(R.id.chPanel).visibility = View.VISIBLE
        list.requestFocus()
        list.setSelection(index)
    }

    private fun closePanel() {
        findViewById<View>(R.id.chPanel).visibility = View.GONE
        findViewById<ListView>(R.id.chList).adapter = null       // the next opening decides what it lists
    }

    /** Catch-up (RaspberryTV and any playlist with an archive): the programme before or after the one playing. */
    private fun canWalk() = sources[index].arch.isNotBlank() && !guides[sources[index].epg].isNullOrEmpty()

    /** A press of the arrows moves the banner through the guide; the picture does not change yet. */
    private fun walkGuide(back: Boolean): Boolean {
        val progs = guides[sources[index].epg] ?: return false
        val now = System.currentTimeMillis() / 1000
        val here = (if (walking) walkAt else catchUp) ?: progs.firstOrNull { now in it.from until it.to } ?: return false
        val next = if (back) progs.lastOrNull { it.to <= here.from } else progs.firstOrNull { it.from >= here.to }
        walking = true
        // forward past the newest programme is the live edge itself
        walkAt = if (next != null && next.from <= now) next else if (back) walkAt ?: here else null
        showBanner()
        return true
    }

    /** OK on the programme the banner stopped at: that is what plays now. */
    private fun tuneWalk(): Boolean {
        if (!walking) return false
        val target = walkAt
        walking = false
        walkAt = null
        if (target == catchUp) { showBanner(); return true }        // already playing it
        catchUp = target
        archTry = 0
        retries = 0
        player?.release(); player = null
        showBanner()
        handler.removeCallbacks(rebuild)
        handler.postDelayed(rebuild, 150)
        return true
    }

    /**
     * Running through a film. Every jump in a torrent has to be fetched from the swarm, so holding the
     * arrow must not mean fetching again and again: holding only moves where the banner is pointing -
     * slowly at first, then minutes at a time - while the picture keeps playing underneath, and the film
     * is taken there once, when the key is let go.
     */
    private fun nudgeScrub(delta: Long) {
        val p = player ?: return
        val dur = p.duration
        val from = if (scrubTo >= 0) scrubTo else p.currentPosition
        var to = (from + delta).coerceAtLeast(0)
        if (dur > 0) to = to.coerceAtMost(dur - 2_000)
        scrubTo = to
        showBanner()
    }

    /** While the key is held the aim runs on, faster the longer it is held (up to five minutes a second). */
    private val scrubHold: Runnable = object : Runnable {
        override fun run() {
            scrubTicks++
            val step = (2_000L + scrubTicks * 800L).coerceAtMost(30_000L)
            nudgeScrub(scrubDir * step)
            handler.postDelayed(this, 100)
        }
    }

    private fun scrubStart(direction: Int) {
        scrubDir = direction
        scrubTicks = 0
        handler.removeCallbacks(commitScrub)
        handler.removeCallbacks(scrubHold)
        handler.postDelayed(scrubHold, 350)          // a short press is a step, not a run
    }

    private fun scrubEnd(direction: Int) {
        handler.removeCallbacks(scrubHold)
        if (scrubTicks == 0) nudgeScrub(direction * 30_000L)      // one press: half a minute
        scrubTicks = 0
        handler.removeCallbacks(commitScrub)
        handler.postDelayed(commitScrub, 700)      // several presses in a row are one jump, not ten
    }

    private val commitScrub = Runnable {
        val to = scrubTo
        scrubTo = -1L
        if (to >= 0) player?.seekTo(to)
        showBanner()
    }

    /** Step along the stream: a press steps a little, a held key leaps. A live stream keeps a window behind its edge. */
    private fun seekBy(direction: Int, held: Boolean) {
        val p = player ?: return
        val step = if (held) 30_000L else 10_000L
        p.seekTo((p.currentPosition + direction * step).coerceAtLeast(0))
        if (!walking) showBanner()                                 // where you are is what you are looking at
        else if (bannerOpen) paintNow()
        val behind = p.currentLiveOffset
        if (live) showMessage(
            if (behind == C.TIME_UNSET) fmtClock(p.currentPosition)
            else if (behind < 5_000) "בשידור חי" else "${behind / 1000} שנ׳ מאחורי השידור החי",
            if (p.playWhenReady) 2_500 else 0                   // while paused the note stays: it is also the pause sign
        )
    }

    private fun fmtClock(ms: Long): String {
        val s = ms / 1000
        return if (s >= 3600) "%d:%02d:%02d".format(s / 3600, s / 60 % 60, s % 60) else "%d:%02d".format(s / 60, s % 60)
    }

    /** Live TV: switch to the previous/next channel in the list (wraps around). */
    private fun zapBy(step: Int) {
        if (sources.size < 2) return
        catchUp = null                                           // another channel starts at its live edge
        walking = false
        walkAt = null
        index = (index + step + sources.size) % sources.size
        retries = 0
        player?.release()
        player = null
        if (live) showBanner()
        else showOsd()
        // Give the server a moment to close the previous channel's session before opening the next.
        handler.removeCallbacks(rebuild)
        handler.postDelayed(rebuild, 250)
    }

    private val rebuild = Runnable { if (started && player == null) buildPlayer() }

    /** A past programme that will not open: the service may spell its archive differently. */
    private fun nextArchive(): Boolean {
        if (catchUp == null || archTry + 1 >= archList(sources[index]).size) return false
        archTry++
        player?.release(); player = null
        handler.removeCallbacks(rebuild)
        handler.postDelayed(rebuild, 100)
        return true
    }

    private fun onError(error: PlaybackException) {
        if (error.errorCode == PlaybackException.ERROR_CODE_BEHIND_LIVE_WINDOW) {
            player?.release(); player = null
            handler.removeCallbacks(rebuild); handler.post(rebuild)   // rejoin the live edge now
            return
        }
        // A past programme that would not open: the same archive spelled another way may be the one
        // this service answers to.
        if (nextArchive()) { showMessage("מנסה כתובת אחרת לארכיון…", 3_000); return }
        // HTTP status (e.g. 403 while the server still counts the previous stream) and the root message.
        val status = generateSequence<Throwable>(error) { it.cause }
            .filterIsInstance<HttpDataSource.InvalidResponseCodeException>().firstOrNull()?.responseCode
        val why = generateSequence(error.cause) { it.cause }.mapNotNull { it.message }.firstOrNull()
        // A broadcaster's CDN sometimes answers a plain request with "not modified", or a 5xx it will
        // not repeat: one more attempt costs a second and usually plays.
        val retryable = live || status == 304 || (status != null && status >= 500)
        if (retryable && retries < 2) {
            retries++
            showMessage("מנסה שוב… ($retries/2)", 3_500)
            player?.release()
            player = null
            handler.removeCallbacks(rebuild)
            handler.postDelayed(rebuild, 3_000)
            return
        }
        // Say it in plain Hebrew, and put the next step on screen instead of leaving a black picture.
        val reason = when {
            status == 403 || status == 401 -> "המקור דחה את הבקשה. אם זה ערוץ, ייתכן שהמנוי פתוח במקום אחר."
            status == 404 -> "הכתובת של המקור לא קיימת יותר."
            status != null -> "השרת החזיר שגיאה (HTTP $status)."
            error.errorCodeName.contains("TIMEOUT") || error.errorCodeName.contains("NETWORK") ->
                "אין תשובה מהמקור. בדוק את החיבור לאינטרנט."
            error.errorCodeName.contains("DECODER") || error.errorCodeName.contains("FORMAT") ->
                "המכשיר לא יודע לפענח את הפורמט הזה. נסה מקור אחר (למשל 1080p במקום 4K)."
            error.errorCodeName.contains("DRM") -> "ההגנה על התוכן לא אושרה במכשיר הזה."
            else -> why?.take(160) ?: "המקור לא נוגן."
        }
        showErrorPanel("לא ניתן לנגן את ${sources[index].name.ifBlank { "התוכן" }}", reason)
    }

    /** The panel over the video: why it stopped, and the buttons that get the viewer moving again. */
    private fun showErrorPanel(title: String, why: String) {
        handler.removeCallbacks(hideOsd)
        findViewById<TextView>(R.id.osd).visibility = View.GONE
        findViewById<TextView>(R.id.errTitle).text = title
        findViewById<TextView>(R.id.errWhy).text = why
        val box = findViewById<View>(R.id.errbox)
        box.visibility = View.VISIBLE
        findViewById<View>(R.id.errRetry).apply {
            setOnClickListener {
                hideErrorPanel()
                retries = 0
                player?.release(); player = null
                buildPlayer()
            }
            requestFocus()
        }
        findViewById<View>(R.id.errNext).apply {
            visibility = if (sources.size > 1) View.VISIBLE else View.GONE
            setOnClickListener { hideErrorPanel(); zapBy(1) }
        }
        // Back to the app, where the other sources for this title are listed.
        findViewById<View>(R.id.errBack).setOnClickListener { finish() }
    }

    private fun hideErrorPanel() { findViewById<View>(R.id.errbox).visibility = View.GONE }

    /** Message over the video; [ms] = 0 keeps it until the next channel or successful playback. */
    private fun showMessage(text: String, ms: Long) {
        val osd = findViewById<TextView>(R.id.osd)
        osd.text = text
        osd.visibility = View.VISIBLE
        handler.removeCallbacks(hideOsd)
        if (ms > 0) handler.postDelayed(hideOsd, ms)
    }

    private val hideOsd = Runnable { findViewById<TextView>(R.id.osd).visibility = View.GONE }

    private fun showOsd() {
        val osd = findViewById<TextView>(R.id.osd)
        osd.text = if (sources.size > 1) "${index + 1} · ${sources[index].name}" else sources[index].name
        osd.visibility = if (osd.text.isNullOrBlank()) View.GONE else View.VISIBLE
        handler.removeCallbacks(hideOsd)
        handler.postDelayed(hideOsd, 3_000)
    }

    // Remote (live TV): Up/Down change the channel at once (up = the next one), holding OK opens the channel
    // list over the picture, and the play/pause key pauses. Left/Right walk the channel's archive in the
    // banner - a press points at the programme before or after, OK tunes to it, Back gives it up - while
    // holding them runs inside what is already playing. A film keeps the player's own controls, and Up
    // opens its subtitles.
    @OptIn(UnstableApi::class)
    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        val code = event.keyCode
        val down = event.action == KeyEvent.ACTION_DOWN
        val ok = code == KeyEvent.KEYCODE_DPAD_CENTER || code == KeyEvent.KEYCODE_ENTER ||
            code == KeyEvent.KEYCODE_NUMPAD_ENTER || code == KeyEvent.KEYCODE_BUTTON_A
        if (findViewById<View>(R.id.errbox).visibility == View.VISIBLE) {
            if (down && code == KeyEvent.KEYCODE_BACK) { hideErrorPanel(); finish(); return true }
            return super.dispatchKeyEvent(event)                 // arrows move between the panel's buttons
        }
        if (panelOpen) {
            if (code == KeyEvent.KEYCODE_BACK) { if (down) closePanel(); return true }
            if (ok && !down && okLong) { okLong = false; return true }      // the release that ended the long press
            return super.dispatchKeyEvent(event)                 // the list handles the arrows and OK
        }
        if (ok && (sources.size > 1 || walking)) {
            if (down) {
                if (event.repeatCount == 0) okLong = false
                else if (!okLong) { okLong = true; openPanel() }             // held down
            } else {
                if (!okLong) { if (!tuneWalk()) showBanner() }
                okLong = false
            }
            return true
        }
        // Left and Right are decided on release, so that holding them can mean something else; both the
        // press and the release are taken, or the player's own controls would come up on the release.
        // They are mirrored with the layout: where the writing runs right to left, the right arrow goes back.
        val arrow = code == KeyEvent.KEYCODE_DPAD_LEFT || code == KeyEvent.KEYCODE_DPAD_RIGHT
        if (arrow && !findViewById<PlayerView>(R.id.playerView).isControllerFullyVisible) {
            val back = (code == KeyEvent.KEYCODE_DPAD_RIGHT) == skin.rtl
            val dir = if (back) -1 else 1
            if (down) {
                if (event.repeatCount == 0) { seekLong = false; if (!live) scrubStart(dir) }
                else if (live) { seekLong = true; seekBy(dir, held = true) }
            } else if (!live) {
                scrubEnd(dir)
            } else {
                if (!seekLong) { if (canWalk()) walkGuide(back) else seekBy(dir, held = false) }
                seekLong = false
            }
            return true
        }
        if (!down) return super.dispatchKeyEvent(event)
        val controls = findViewById<PlayerView>(R.id.playerView).isControllerFullyVisible
        when (code) {
            KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, KeyEvent.KEYCODE_MEDIA_PAUSE, KeyEvent.KEYCODE_MEDIA_PLAY -> {
                player?.let {
                    it.playWhenReady = !it.playWhenReady
                    if (live) showMessage(if (it.playWhenReady) "ממשיך" else "מושהה", if (it.playWhenReady) 2_000 else 0)
                    else showBanner()
                }
                return true
            }
            KeyEvent.KEYCODE_BACK -> if (walking) { walking = false; walkAt = null; showBanner(); return true }
            KeyEvent.KEYCODE_MEDIA_REWIND -> if (!controls) { seekBy(-1, event.repeatCount > 0); return true }
            KeyEvent.KEYCODE_MEDIA_FAST_FORWARD -> if (!controls) { seekBy(1, event.repeatCount > 0); return true }
            // a film: the subtitles panel - which translation, and how far it is moved
            KeyEvent.KEYCODE_CAPTIONS -> if (!live) { openSubsPanel(); return true }
            // the dedicated channel keys switch straight away (up = the next number, as on a television)
            KeyEvent.KEYCODE_CHANNEL_UP, KeyEvent.KEYCODE_PAGE_UP -> if (sources.size > 1) { hideChannelBar(); zapBy(1); return true }
            KeyEvent.KEYCODE_CHANNEL_DOWN, KeyEvent.KEYCODE_PAGE_DOWN -> if (sources.size > 1) { hideChannelBar(); zapBy(-1); return true }
            // up is the next channel, the way the numbers run on a television - and it switches at once
            KeyEvent.KEYCODE_DPAD_UP -> {
                if (sources.size > 1 && !controls) { zapBy(1); return true }
                if (!live && !controls) { openSubsPanel(); return true }
            }
            KeyEvent.KEYCODE_DPAD_DOWN -> if (sources.size > 1 && !controls) { zapBy(-1); return true }
        }
        return super.dispatchKeyEvent(event)
    }

    // Touch: swipe up = next channel, swipe down = previous.
    private val swipe by lazy {
        GestureDetector(this, object : GestureDetector.SimpleOnGestureListener() {
            override fun onFling(e1: MotionEvent?, e2: MotionEvent, velocityX: Float, velocityY: Float): Boolean {
                if (sources.size < 2 || e1 == null) return false
                val dy = e2.y - e1.y
                if (abs(dy) > 150 && abs(dy) > 2 * abs(e2.x - e1.x) && abs(velocityY) > 800) {
                    zapBy(if (dy < 0) 1 else -1)
                    return true
                }
                return false
            }
        })
    }

    override fun dispatchTouchEvent(ev: MotionEvent): Boolean {
        swipe.onTouchEvent(ev)
        return super.dispatchTouchEvent(ev)
    }

    override fun onStop() {
        super.onStop()
        started = false
        player?.let { resumePosition = it.currentPosition; saveProgress(it.currentPosition, it.duration); it.release() }
        player = null
    }

    /** Store how far the viewer got, for "continue watching" (the page picks it up on return). */
    private fun saveProgress(pos: Long, dur: Long) {
        if (live || watchId.isBlank() || pos < 10_000 || dur <= 0) return
        val meta = intent.getStringExtra("meta") ?: "{}"
        val entry = org.json.JSONObject(meta).apply {
            put("videoId", watchId)
            put("t", pos / 1000)
            put("d", dur / 1000)
            put("at", System.currentTimeMillis())
        }
        val prefs = getSharedPreferences("watch", MODE_PRIVATE)
        val all = org.json.JSONObject(prefs.getString("progress", "{}") ?: "{}")
        all.put(watchId, entry)
        prefs.edit().putString("progress", all.toString()).apply()
    }

    override fun onDestroy() {
        super.onDestroy()
        handler.removeCallbacksAndMessages(null)
        // Leaving the player ends the torrent stream and frees its downloaded data.
        if (isFinishing && intent.getBooleanExtra("torrent", false)) {
            Thread { TorrentEngine.stopCurrent() }.start()
        }
    }

    companion object {
        /** What live requests identify as when the playlist names no agent of its own. */
        private const val LIVE_UA =
            "Mozilla/5.0 (Linux; Android 11) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

        /** "Basic …" header for http://user:pass@host/… URLs, else null. */
        fun basicAuth(url: String): String? {
            val info = Uri.parse(url).userInfo ?: return null
            return "Basic " + android.util.Base64.encodeToString(Uri.decode(info).toByteArray(), android.util.Base64.NO_WRAP)
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        outState.putLong("pos", player?.currentPosition ?: resumePosition)
        outState.putInt("index", index)
    }
}
