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
        val num: Int = 0, val logo: String = "", val epg: String = "",
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
    /** Live TV: while Up/Down page through the channels, [barIndex] is the one pointed at (the video does not change until OK). */
    private var browsing = false
    private var barIndex = 0
    /** The channel the banner describes: the one being pointed at while paging, else the one playing. */
    private val shownIndex get() = if (browsing) barIndex else index
    /** OK is decided on release, so that holding it can mean something else. */
    private var okLong = false

    @OptIn(UnstableApi::class)
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_player)

        sources = intent.getStringExtra("channels")?.let { json ->
            val a = JSONArray(json)
            List(a.length()) { i ->
                a.getJSONObject(i).run {
                    Source(optString("name"), optString("url"), optString("ua"), optString("referer"),
                        optString("drm"), optInt("num", i + 1), optString("logo"), optString("epg"))
                }
            }
        } ?: listOfNotNull(intent.getStringExtra("url")?.let {
            Source(intent.getStringExtra("title") ?: "", it, intent.getStringExtra("ua") ?: "", intent.getStringExtra("referer") ?: "",
                intent.getStringExtra("drm") ?: "")
        })
        if (sources.isEmpty()) { finish(); return }
        index = (savedInstanceState?.getInt("index") ?: intent.getIntExtra("index", 0)).coerceIn(0, sources.size - 1)
        resumePosition = savedInstanceState?.getLong("pos") ?: intent.getLongExtra("pos", 0L)

        val view = findViewById<PlayerView>(R.id.playerView)
        view.setShowSubtitleButton(!live)
        view.subtitleView?.apply {
            setStyle(CaptionStyleCompat(Color.WHITE, Color.TRANSPARENT, Color.TRANSPARENT,
                CaptionStyleCompat.EDGE_TYPE_OUTLINE, Color.BLACK, null))
            setFractionalTextSize(SubtitleView.DEFAULT_TEXT_SIZE_FRACTION * 1.25f)
        }

        if (live) view.useController = false     // live has nothing to seek, and controls eat the D-pad
        if (sources.size > 1 && !live) {
            val zap = findViewById<View>(R.id.zap)
            view.setControllerVisibilityListener(PlayerView.ControllerVisibilityListener { zap.visibility = it })
            findViewById<View>(R.id.chUp).setOnClickListener { zapBy(-1) }
            findViewById<View>(R.id.chDown).setOnClickListener { zapBy(1) }
        }

        // Live TV and broadcaster VOD (Hebrew already) have no subtitle lookup.
        if (live || intent.getBooleanExtra("nosubs", false)) {
            subs = emptyList()
            if (live) showBanner(browse = false) else showOsd()      // the banner introduces the channel
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
                showMessage(if (found.isEmpty()) "לא נמצאו כתוביות בעברית" else "כתוביות בעברית: ${found.first().label}", 3_500)
                if (found.isNotEmpty() && started) reloadWithSubs()
            }
        }.start()
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
        val url = src.url
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

        val subtitleConfigs = subs.orEmpty().mapIndexed { i, s ->
            MediaItem.SubtitleConfiguration.Builder(Uri.fromFile(s.file))
                .setMimeType(MimeTypes.APPLICATION_SUBRIP)
                .setLanguage("he")
                .setLabel(s.label)
                .setSelectionFlags(if (i == 0) C.SELECTION_FLAG_DEFAULT else 0)
                .build()
        }
        val item = MediaItem.Builder().setUri(url).setSubtitleConfigurations(subtitleConfigs)
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
                // Hebrew subtitles on by default (also picks embedded Hebrew tracks in MKVs).
                it.trackSelectionParameters = it.trackSelectionParameters.buildUpon()
                    .setPreferredTextLanguage("he")
                    .build()
                it.addListener(object : Player.Listener {
                    override fun onPlayerError(error: PlaybackException) = onError(error)
                    override fun onPlaybackStateChanged(state: Int) {
                        if (state != Player.STATE_READY) return
                        hideErrorPanel()
                        if (retries > 0) { retries = 0; handler.postDelayed(hideOsd, 1_500) }
                    }
                })
                findViewById<PlayerView>(R.id.playerView).player = it
                it.setMediaItem(item)
                if (!live) it.seekTo(resumePosition)
                it.prepare()
                it.playWhenReady = true
            }
    }

    /** Guide per channel (by its endpoint), fetched once and kept for the session. */
    private val guides = HashMap<String, List<Prog>>()
    private val logos = HashMap<String, android.graphics.Bitmap?>()

    /** Fill the banner with the channel and what is on it, then fetch the guide if it is not in yet. */
    private fun paintBanner() {
        val src = sources[shownIndex]
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
        val src = sources.getOrNull(shownIndex) ?: return
        val now = System.currentTimeMillis() / 1000
        val progs = guides[src.epg]
        val playing = progs?.firstOrNull { now in it.from until it.to }
        val next = progs?.firstOrNull { it.from >= (playing?.to ?: now) }
        val title = findViewById<TextView>(R.id.nowTitle)
        val bar = findViewById<ProgressBar>(R.id.nowBar)
        val after = findViewById<TextView>(R.id.nextTitle)
        if (playing != null) {
            title.text = "${hhmm(playing.from)} · ${playing.name}"
            bar.visibility = View.VISIBLE
            bar.progress = (((now - playing.from) * 100) / (playing.to - playing.from).coerceAtLeast(1)).toInt()
            val left = ((playing.to - now) / 60).coerceAtLeast(0)
            after.text = if (next != null) "עוד $left דק׳ · אחר כך ${hhmm(next.from)} ${next.name}"
                         else "נותרו $left דק׳"
        } else {
            title.text = if (progs == null && src.epg.isNotBlank()) "טוען לוח שידורים…"
                         else if (next != null) "הבא: ${hhmm(next.from)} · ${next.name}"
                         else "שידור חי"
            bar.visibility = View.GONE
            after.text = ""
        }
        findViewById<TextView>(R.id.infoNow).text =
            if (sources.size < 2) "לחיצה ארוכה על OK: צפייה אחורה"
            else if (browsing && barIndex != index) "OK: מעבר לערוץ הזה · מעלה/מטה: עוד ערוצים · חזרה: ביטול"
            else "מעלה/מטה: דפדוף בערוצים · OK: בחירה · לחיצה ארוכה על OK: רשימת ערוצים"
    }

    private fun hhmm(epochSeconds: Long): String =
        android.text.format.DateFormat.getTimeFormat(this).format(java.util.Date(epochSeconds * 1000))

    private fun loadGuide(url: String) {
        if (!loadingGuides.add(url)) return
        Thread {
            val list = runCatching {
                val text = java.net.URL(url).openStream().bufferedReader().use { it.readText() }
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
        }.start()
    }

    private fun loadLogo(url: String) {
        Thread {
            val bmp = runCatching {
                java.net.URL(url).openStream().use { android.graphics.BitmapFactory.decodeStream(it) }
            }.getOrNull()
            runOnUiThread {
                logos[url] = bmp
                if (bannerOpen && sources.getOrNull(shownIndex)?.logo == url && bmp != null) {
                    findViewById<ImageView>(R.id.chLogo).apply { setImageBitmap(bmp); visibility = View.VISIBLE }
                }
            }
        }.start()
    }

    /** Raise the banner (every channel change does), and take it down again after a few seconds.
     *  With [browse] Up/Down are paging through the channels, so it stays a little longer and OK will tune. */
    private fun showBanner(browse: Boolean) {
        if (!live) return
        browsing = browse
        barIndex = index
        findViewById<View>(R.id.infobar).visibility = View.VISIBLE
        paintBanner()
        handler.removeCallbacks(hideBanner)
        handler.removeCallbacks(tickBanner)
        handler.postDelayed(tickBanner, 30_000)
        handler.postDelayed(hideBanner, if (browse) 12_000L else 6_000L)
    }

    private val hideBanner = Runnable { hideChannelBar() }
    // explicit type: it schedules itself, which Kotlin cannot infer through
    private val tickBanner: Runnable = Runnable { if (bannerOpen) { paintNow(); handler.postDelayed(tickBanner, 30_000) } }
    private val bannerOpen get() = findViewById<View>(R.id.infobar).visibility == View.VISIBLE

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    private fun hideChannelBar() {
        browsing = false
        handler.removeCallbacks(hideBanner)
        handler.removeCallbacks(tickBanner)
        findViewById<View>(R.id.infobar).visibility = View.GONE
    }

    /** Up/Down: raise the banner and page through the channels in it - nothing changes until OK. */
    private fun browseBy(step: Int) {
        if (!browsing) showBanner(browse = true)
        barIndex = (barIndex + step + sources.size) % sources.size
        paintBanner()                                            // the banner describes the channel pointed at
        handler.removeCallbacks(hideBanner)
        handler.postDelayed(hideBanner, 12_000)                  // paging that is left alone ends by itself
    }

    private fun pickChannel(i: Int) {
        hideChannelBar()
        if (i != index) zapBy(i - index) else showBanner(browse = false)
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
            num.setTextColor(Color.parseColor(if (current) "#F0B429" else "#7F8899"))
            name.text = src.name
            name.setTextColor(if (current) Color.WHITE else Color.parseColor("#D8DCE6"))
            name.typeface = if (current) android.graphics.Typeface.DEFAULT_BOLD else android.graphics.Typeface.DEFAULT
            val seconds = System.currentTimeMillis() / 1000
            val playing = guides[src.epg]?.firstOrNull { seconds in it.from until it.to }
            now.text = playing?.name ?: ""
            now.setTextColor(Color.parseColor("#8E93A8"))
            now.visibility = if (playing != null) View.VISIBLE else View.GONE
            if (src.epg.isNotBlank() && !guides.containsKey(src.epg)) loadGuide(src.epg)
            return row
        }
    }

    private fun openPanel() {
        hideChannelBar()
        val list = findViewById<ListView>(R.id.chList)
        if (list.adapter == null) {
            list.adapter = ChannelAdapter()
            list.setOnItemClickListener { _, _, i, _ -> closePanel(); if (i != index) zapBy(i - index) else showBanner(browse = false) }
            list.setOnItemLongClickListener { _, _, i, _ -> openCatchUp(i); true }
        }
        (list.adapter as BaseAdapter).notifyDataSetChanged()
        findViewById<View>(R.id.chPanel).visibility = View.VISIBLE
        list.requestFocus()
        list.setSelection(index)
    }

    private fun closePanel() { findViewById<View>(R.id.chPanel).visibility = View.GONE }

    /** Step along the stream: a press steps a little, a held key leaps. A live stream keeps a window behind its edge. */
    private fun seekBy(direction: Int, held: Boolean) {
        val p = player ?: return
        val step = if (held) 60_000L else 10_000L
        p.seekTo((p.currentPosition + direction * step).coerceAtLeast(0))
        val behind = p.currentLiveOffset
        showMessage(
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
        index = (index + step + sources.size) % sources.size
        retries = 0
        player?.release()
        player = null
        if (live) showBanner(browse = false)
        else showOsd()
        // Give the server a moment to close the previous channel's session before opening the next.
        handler.removeCallbacks(rebuild)
        handler.postDelayed(rebuild, 250)
    }

    private val rebuild = Runnable { if (started && player == null) buildPlayer() }

    private fun onError(error: PlaybackException) {
        if (error.errorCode == PlaybackException.ERROR_CODE_BEHIND_LIVE_WINDOW) {
            player?.release(); player = null
            handler.removeCallbacks(rebuild); handler.post(rebuild)   // rejoin the live edge now
            return
        }
        // HTTP status (e.g. 403 while the server still counts the previous stream) and the root message.
        val status = generateSequence<Throwable>(error) { it.cause }
            .filterIsInstance<HttpDataSource.InvalidResponseCodeException>().firstOrNull()?.responseCode
        val why = generateSequence(error.cause) { it.cause }.mapNotNull { it.message }.firstOrNull()
        if (live && retries < 2) {
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

    // Remote (live TV): Up/Down raise the banner and page through the channels, OK on one switches to it, holding
    // OK opens the channel list over the picture, the channel keys switch straight away, the play/pause key
    // pauses, and Left/Right then step back and forth (held: further). VOD keeps the player's own controls.
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
        if (ok && sources.size > 1) {
            if (down) {
                if (event.repeatCount == 0) okLong = false
                else if (!okLong) { okLong = true; openPanel() }             // held down
            } else {
                if (!okLong) { if (browsing) pickChannel(barIndex) else showBanner(browse = false) }
                okLong = false
            }
            return true
        }
        if (!down) return super.dispatchKeyEvent(event)
        val controls = findViewById<PlayerView>(R.id.playerView).isControllerFullyVisible
        when (code) {
            KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, KeyEvent.KEYCODE_MEDIA_PAUSE, KeyEvent.KEYCODE_MEDIA_PLAY -> {
                player?.let {
                    it.playWhenReady = !it.playWhenReady
                    showMessage(if (it.playWhenReady) "ממשיך" else "מושהה", if (it.playWhenReady) 2_000 else 0)
                }
                return true
            }
            KeyEvent.KEYCODE_BACK -> if (browsing) { hideChannelBar(); return true }
            KeyEvent.KEYCODE_DPAD_LEFT, KeyEvent.KEYCODE_MEDIA_REWIND -> if (!controls) { seekBy(-1, event.repeatCount > 0); return true }
            KeyEvent.KEYCODE_DPAD_RIGHT, KeyEvent.KEYCODE_MEDIA_FAST_FORWARD -> if (!controls) { seekBy(1, event.repeatCount > 0); return true }
            // the dedicated channel keys switch straight away (up = the next number, as on a television)
            KeyEvent.KEYCODE_CHANNEL_UP, KeyEvent.KEYCODE_PAGE_UP -> if (sources.size > 1) { hideChannelBar(); zapBy(1); return true }
            KeyEvent.KEYCODE_CHANNEL_DOWN, KeyEvent.KEYCODE_PAGE_DOWN -> if (sources.size > 1) { hideChannelBar(); zapBy(-1); return true }
            KeyEvent.KEYCODE_DPAD_UP -> if (sources.size > 1 && !controls) { browseBy(-1); return true }
            KeyEvent.KEYCODE_DPAD_DOWN -> if (sources.size > 1 && !controls) { browseBy(1); return true }
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
