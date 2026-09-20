package com.veo.player

import android.graphics.Color

/** What the page last told us about its skin; its defaults are the amber skin, for a first run. */
class Skin(private val p: android.content.SharedPreferences) {
    val rtl = p.getString("dir", "rtl") != "ltr"
    private fun c(key: String, fallback: String) =
        runCatching { Color.parseColor(p.getString(key, fallback)!!) }.getOrDefault(Color.parseColor(fallback))
    val night = c("night", "#14161F")
    val line = c("line", "#323850")
    val light = c("light", "#EFE6CF")
    val muted = c("muted", "#8E93A8")
    val accent = c("accent", "#F0B429")
    val onAccent = c("onAccent", "#14161F")
}
/** The same colour at a given opacity (the panels sit over the picture). */
fun fade(color: Int, alpha: Int) = (color and 0xFFFFFF) or (alpha shl 24)
