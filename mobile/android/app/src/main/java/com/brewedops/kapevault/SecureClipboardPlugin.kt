package com.brewedops.kapevault

import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.ClipData
import android.content.ClipboardManager
import android.content.ComponentName
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.os.PersistableBundle
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * Copies a secret marked sensitive (Android 13+ keeps it out of the clipboard preview and keyboard
 * suggestions) and clears it 30 s later if it is still ours. Two clears race for it: a main-thread
 * timer, on time while the app's process runs, and a scheduled job, for when Android has frozen or
 * killed the app - exactly when the user is pasting elsewhere. The job runs 30 s later at the
 * earliest and often much later (Android batches jobs). Whichever runs first cancels the other. Both
 * carry the copy's timestamp, so the job works in a fresh process too.
 */
@CapacitorPlugin(name = "SecureClipboard")
class SecureClipboardPlugin : Plugin() {
    private val scheduler get() = context.getSystemService(JobScheduler::class.java)

    @PluginMethod
    fun copy(call: PluginCall) {
        val text = call.getString("text") ?: return call.reject("Nothing to copy.")
        val clipboard = context.getSystemService(ClipboardManager::class.java)
        clipboard.setPrimaryClip(sensitiveClip(text))
        val copiedAt = clipboard.primaryClipDescription?.timestamp ?: 0L
        scheduler.schedule(
            JobInfo.Builder(CLEAR_JOB_ID, ComponentName(context, ClipboardClearJob::class.java))
                .setMinimumLatency(CLEAR_AFTER_MS)
                .setExtras(PersistableBundle().apply { putLong(COPIED_AT, copiedAt) })
                .build(),
        )
        startTimer(context.applicationContext, copiedAt)
        call.resolve()
    }

    // The page calls this when it locks: the pending clear happens now.
    @PluginMethod
    fun clear(call: PluginCall) {
        scheduler.getPendingJob(CLEAR_JOB_ID)?.let {
            clearIfOurs(context, it.extras.getLong(COPIED_AT))
            scheduler.cancel(CLEAR_JOB_ID)
        }
        main.removeCallbacksAndMessages(TIMER)
        call.resolve()
    }

    companion object {
        // = ClipDescription.EXTRA_IS_SENSITIVE (API 33); older Androids ignore it.
        private const val EXTRA_IS_SENSITIVE = "android.content.extra.IS_SENSITIVE"
        private const val CLEAR_JOB_ID = 1
        private const val CLEAR_AFTER_MS = 30_000L
        private const val TIMER = "kapevault-clipboard-clear" // the timer's token on the main handler
        const val COPIED_AT = "copiedAt"

        private val main = Handler(Looper.getMainLooper())

        // Every clip KAPEVault puts on the clipboard: plain text, marked sensitive.
        private fun sensitiveClip(text: String) = ClipData.newPlainText("KAPEVault", text).apply {
            description.extras = PersistableBundle().apply { putBoolean(EXTRA_IS_SENSITIVE, true) }
        }
        // Read and written on the main thread and the plugin thread (clear() on lock).
        @Volatile private var focused = false // the app's window has focus
        @Volatile private var clearedAway = false // a clear happened while the app was out of focus

        private fun startTimer(context: Context, copiedAt: Long) {
            main.removeCallbacksAndMessages(TIMER)
            main.postDelayed({
                clearIfOurs(context, copiedAt)
                context.getSystemService(JobScheduler::class.java).cancel(CLEAR_JOB_ID)
            }, TIMER, CLEAR_AFTER_MS)
        }

        // The job got there first (the timer was frozen with the app).
        fun stopTimer() = main.removeCallbacksAndMessages(TIMER)

        // Android shows the clipboard only to the app in focus. In focus, a newer clip (the user copied
        // something else) is left alone. Out of focus there is no way to tell, and a vault errs on the
        // side of clearing what may still be a password.
        fun clearIfOurs(context: Context, copiedAt: Long) {
            val clipboard = context.getSystemService(ClipboardManager::class.java)
            val current = clipboard.primaryClipDescription
            if (current != null && current.timestamp != copiedAt) return
            clipboard.clearPrimaryClip()
            if (!focused) clearedAway = true
        }

        /**
         * MainActivity's window gained or lost focus. The WebView keeps its own copy of the clipboard
         * and refreshes it only when Android reports a change, which it does only to the app in focus:
         * after a clear the app missed, a paste inside the app still gave the secret. Once back in
         * focus (and able to read the clipboard), an empty clipboard is changed and emptied again, so
         * the WebView hears of it. A clip someone copied meanwhile is left alone. The check waits a
         * moment: until Android has moved the focus here, the clipboard reads empty to this app.
         */
        fun onFocus(context: Context, hasFocus: Boolean) {
            focused = hasFocus
            if (!hasFocus || !clearedAway) return
            main.postDelayed({
                if (!focused || !clearedAway) return@postDelayed
                clearedAway = false
                val clipboard = context.getSystemService(ClipboardManager::class.java)
                if (clipboard.hasPrimaryClip()) return@postDelayed
                clipboard.setPrimaryClip(sensitiveClip(""))
                clipboard.clearPrimaryClip()
            }, FOCUS_SETTLE_MS)
        }

        private const val FOCUS_SETTLE_MS = 300L
    }
}

class ClipboardClearJob : JobService() {
    override fun onStartJob(params: JobParameters): Boolean {
        SecureClipboardPlugin.stopTimer()
        SecureClipboardPlugin.clearIfOurs(this, params.extras.getLong(SecureClipboardPlugin.COPIED_AT))
        return false
    }

    override fun onStopJob(params: JobParameters) = false
}
