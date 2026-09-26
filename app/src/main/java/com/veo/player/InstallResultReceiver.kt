package com.veo.player

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller

/**
 * What the installer says about an update the app handed it through a session (MainActivity.installUpdate).
 *
 * The session keeps the viewer inside the app: the one thing Android still asks - "install this update?" - comes as a
 * small dialog over the page instead of a whole other app taking the screen. When the installer needs that answer it sends
 * an intent for it here; a failure is passed on to the page.
 */
class InstallResultReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                @Suppress("DEPRECATION")
                val ask = intent.getParcelableExtra<Intent>(Intent.EXTRA_INTENT)
                if (ask != null) runCatching { context.startActivity(ask.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
            }
            PackageInstaller.STATUS_SUCCESS -> onDone?.invoke(null)
            PackageInstaller.STATUS_FAILURE_ABORTED -> onDone?.invoke(null)          // the viewer said no
            else -> onDone?.invoke(intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE) ?: "ההתקנה נכשלה")
        }
    }

    companion object {
        /** The page's side of it: null when the update is done or was declined, else why it failed. */
        @Volatile var onDone: ((String?) -> Unit)? = null
    }
}
