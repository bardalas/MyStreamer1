package com.veo.player

import android.content.Context
import android.util.Base64
import android.webkit.WebResourceResponse
import androidx.webkit.WebViewAssetLoader
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.KeyFactory
import java.security.MessageDigest
import java.security.Signature
import java.security.spec.X509EncodedKeySpec
import java.util.zip.ZipInputStream

/**
 * Over-the-air updates of the web layer (booth.html, js, css): a signed zip published on GitHub releases
 * (tag web-v*, marked pre-release so it never becomes the "latest" the APK updater reads).
 *
 * A bundle is fetched in the background, checked (signature, hash, built for this very app version), unpacked
 * beside the current one and used from the NEXT launch. The page tells us it came up ([ready]); a bundle that
 * has not done so in [TRIES] launches is thrown away and the pages inside the APK are used again. A new APK
 * drops the bundle: what it carries is newer than any bundle made for the old one.
 */
object WebBundle {
    // The public half of the signing key (ECDSA P-256, X.509, base64). The private half is a GitHub secret.
    private const val PUBLIC_KEY = "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE+7RDxXi2E6IZp3WWmuZGcorzUEpDqCVVhaT+2kppW1gHnEiqvDOgl7CbphgxJTys3o0cYnq6D5h5oIzckYBy0A=="
    private const val RELEASES = "https://api.github.com/repos/bardalas/VEO/releases?per_page=8"
    private const val EVERY_MS = 6 * 3600_000L
    private const val TRIES = 2
    private const val MAX_BYTES = 40L * 1024 * 1024
    const val WATCHDOG_MS = 30_000L

    private fun prefs(c: Context) = c.getSharedPreferences("veo_ota", Context.MODE_PRIVATE)
    private fun root(c: Context) = File(c.filesDir, "web")

    /** Called once at launch, before the page is loaded: settle which bundle (if any) is the one to serve. */
    @Synchronized fun start(c: Context, appVersion: Long) {
        val p = prefs(c)
        var active = p.getString("active", null)
        val pending = p.getString("pending", null)
        if (active != null && p.getLong("app", -1) != appVersion) { drop(c, active); active = null }   // a new APK: its own pages are newer
        if (pending != null && p.getLong("pendingApp", -1) == appVersion && File(root(c), pending).isDirectory) {
            if (active != null && active != pending) File(root(c), active).deleteRecursively()
            active = pending
            p.edit().putString("active", active).putLong("app", appVersion).putInt("tries", 0).putBoolean("ready", false)
                .remove("pending").apply()
        }
        if (active != null) {
            val tries = p.getInt("tries", 0)
            if (!p.getBoolean("ready", false) && tries >= TRIES) { markBad(c, active); return }   // it never came up
            p.edit().putInt("tries", tries + 1).apply()
        }
    }

    /** The version being served, or null for the pages inside the APK. */
    fun active(c: Context): String? = prefs(c).getString("active", null)?.takeIf { File(root(c), it).isDirectory }

    /** The page has come up: this bundle is good. */
    fun ready(c: Context) { prefs(c).edit().putBoolean("ready", true).putInt("tries", 0).apply() }

    /** The page did not come up in time: back to the pages inside the APK. Returns whether anything changed. */
    fun rollback(c: Context): Boolean {
        val a = active(c) ?: return false
        if (prefs(c).getBoolean("ready", false)) return false
        markBad(c, a); return true
    }

    private fun markBad(c: Context, v: String) {
        val p = prefs(c)
        p.edit().putStringSet("bad", (p.getStringSet("bad", emptySet()) ?: emptySet()) + v).apply()
        drop(c, v)
    }

    private fun drop(c: Context, v: String) {
        File(root(c), v).deleteRecursively()
        prefs(c).edit().remove("active").remove("app").putInt("tries", 0).putBoolean("ready", false).apply()
    }

    /** The asset handler: files of the active bundle where it has them, otherwise the ones inside the APK. */
    fun handler(c: Context): WebViewAssetLoader.PathHandler {
        val builtIn = WebViewAssetLoader.AssetsPathHandler(c)
        return WebViewAssetLoader.PathHandler { path ->
            val v = active(c)
            val f = if (v == null) null else File(File(root(c), v), path).takeIf { it.isFile && it.canonicalPath.startsWith(File(root(c), v).canonicalPath) }
            if (f != null) WebResourceResponse(mime(path), if (mime(path).startsWith("text") || mime(path).contains("javascript")) "utf-8" else null, f.inputStream())
            else builtIn.handle(path)
        }
    }

    private fun mime(path: String) = when (path.substringAfterLast('.', "").lowercase()) {
        "html" -> "text/html"; "js", "mjs" -> "text/javascript"; "css" -> "text/css"; "json" -> "application/json"
        "svg" -> "image/svg+xml"; "png" -> "image/png"; "jpg", "jpeg" -> "image/jpeg"; "webp" -> "image/webp"
        "woff2" -> "font/woff2"; "woff" -> "font/woff"; "ico" -> "image/x-icon"
        else -> "application/octet-stream"
    }

    /** Looks for a newer bundle (at most every six hours, or at once with [force]) and stages it. Call off the main thread. */
    fun check(c: Context, appVersion: Long, feed: String? = null, force: Boolean = false): String {
        val p = prefs(c)
        if (!force && System.currentTimeMillis() - p.getLong("checked", 0) < EVERY_MS) return "recent"
        p.edit().putLong("checked", System.currentTimeMillis()).apply()
        return try { stage(c, appVersion, feed) } catch (e: Exception) { "failed: ${e.message}" }
    }

    private fun stage(c: Context, appVersion: Long, feed: String?): String {
        val p = prefs(c)
        val bad = p.getStringSet("bad", emptySet()) ?: emptySet()
        val have = maxOf(active(c)?.toLongOrNull() ?: 0, p.getString("pending", null)?.toLongOrNull() ?: 0)
        // the places a bundle can be: a debug feed's folder, or the assets of GitHub's newest web releases
        val bases = ArrayList<String>()
        if (feed != null) bases.add(feed.trimEnd('/') + "/")
        else {
            val rel = JSONArray(get(RELEASES).toString(Charsets.UTF_8))
            for (i in 0 until rel.length()) {
                val r = rel.getJSONObject(i)
                if (r.optBoolean("draft") || !r.optString("tag_name").startsWith("web-v")) continue
                bases.add("https://github.com/bardalas/VEO/releases/download/" + r.getString("tag_name") + "/")
            }
        }
        var best: Triple<String, JSONObject, String>? = null
        for (b in bases) {
            val m = runCatching { JSONObject(get(b + "web-bundle.json").toString(Charsets.UTF_8)) }.getOrNull() ?: continue
            val v = m.optLong("version", 0)
            if (m.optLong("app", -1) != appVersion || v <= have || v.toString() in bad) continue
            if (best == null || v > best.second.getLong("version")) best = Triple(b, m, b)
        }
        val (base, man) = best ?: return "none"
        val zip = get(base + "web-bundle.zip")
        val sig = get(base + "web-bundle.zip.sig")
        if (zip.size.toLong() != man.optLong("size", -1)) return "bad size"
        if (hex(MessageDigest.getInstance("SHA-256").digest(zip)) != man.optString("sha256")) return "bad hash"
        val v = Signature.getInstance("SHA256withECDSA")
        v.initVerify(KeyFactory.getInstance("EC").generatePublic(X509EncodedKeySpec(Base64.decode(PUBLIC_KEY, Base64.DEFAULT))))
        v.update(zip)
        if (!v.verify(sig)) return "bad signature"
        val ver = man.getLong("version").toString()
        val dir = File(root(c), ver)
        val tmp = File(root(c), "$ver.tmp")
        tmp.deleteRecursively(); tmp.mkdirs()
        var total = 0L
        ZipInputStream(zip.inputStream()).use { z ->
            while (true) {
                val e = z.nextEntry ?: break
                if (e.isDirectory) continue
                val out = File(tmp, e.name)
                if (!out.canonicalPath.startsWith(tmp.canonicalPath + File.separator)) { tmp.deleteRecursively(); return "bad path" }
                out.parentFile?.mkdirs()
                out.outputStream().use { total += z.copyTo(it) }
                if (total > MAX_BYTES) { tmp.deleteRecursively(); return "too big" }
            }
        }
        if (!File(tmp, "booth.html").isFile) { tmp.deleteRecursively(); return "no booth.html" }
        dir.deleteRecursively(); tmp.renameTo(dir)
        val old = p.getString("pending", null)
        if (old != null && old != ver) File(root(c), old).deleteRecursively()
        p.edit().putString("pending", ver).putLong("pendingApp", appVersion).apply()
        return "staged $ver"
    }

    private fun get(url: String): ByteArray {
        val cx = URL(url).openConnection() as HttpURLConnection
        cx.connectTimeout = 15_000; cx.readTimeout = 30_000
        cx.setRequestProperty("Accept", "application/vnd.github+json")
        cx.setRequestProperty("User-Agent", "VEO")
        try {
            if (cx.responseCode != 200) throw java.io.IOException("HTTP ${cx.responseCode}")
            return cx.inputStream.use { it.readBytes() }
        } finally { cx.disconnect() }
    }

    private fun hex(b: ByteArray) = b.joinToString("") { "%02x".format(it) }

    /** One line for the About screen. */
    fun info(c: Context): String = active(c) ?: "built-in"
}
