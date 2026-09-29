package com.brewedops.kapevault

import android.os.Build
import android.view.WindowManager
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * Settings' "Hide from screen capture". MainActivity starts every launch with FLAG_SECURE (no
 * screenshots, recordings, screen sharing or recent-apps preview from the first frame); the page turns
 * it off here once it has read a setting that says so. With it off, Android 13+ still keeps the
 * recent-apps preview blank: that is not sharing, and it would show the vault as it was left.
 */
@CapacitorPlugin(name = "ScreenCapture")
class ScreenCapturePlugin : Plugin() {
    @PluginMethod
    fun setHidden(call: PluginCall) {
        val hidden = call.getBoolean("hidden") ?: return call.reject("hidden is missing.")
        activity.runOnUiThread {
            if (hidden) activity.window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
            else activity.window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) activity.setRecentsScreenshotEnabled(hidden)
            call.resolve()
        }
    }
}
