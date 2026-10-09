package com.brewedops.kapevault

import android.app.Activity
import android.content.Context
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.webkit.WebView
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsCompat.Type
import com.getcapacitor.BridgeActivity
import com.getcapacitor.WebViewListener
import com.getcapacitor.plugin.WebView as WebViewPlugin

class MainActivity : BridgeActivity() {
    // Set by a plugin while a system dialog it opened sits over the app (the camera permission, Play's
    // purchase sheet): the dialog pauses this activity, but the user has not left the app. Leaving from
    // it still stops it.
    var ownDialog = false
    private var quiet = false // a pause that sent no background event
    private var safeArea = "" // the page's --safe-area-inset-* as a script, from the last insets

    override fun onCreate(savedInstanceState: Bundle?) {
        // No screenshots, screen recordings or recent-apps preview of the vault, from the first frame.
        // Settings can turn it off (ScreenCapturePlugin) once the page has read that setting.
        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        enableEdgeToEdge()
        // The page is only ever the bundled one. A server path the page persisted (WebView plugin,
        // SharedPreferences) is read by the Bridge while super.onCreate builds it, and would load files
        // the page wrote, with every plugin: so it is dropped first. DisabledCorePlugins closes the
        // plugin that writes it; this also covers a path written some other way (a file written into
        // shared_prefs, an old install).
        getSharedPreferences(WebViewPlugin.WEBVIEW_PREFS_NAME, Context.MODE_PRIVATE).edit().remove(WebViewPlugin.CAP_SERVER_PATH).commit()
        registerPlugins(listOf(DisabledWebViewPlugin::class.java, R2OnlyHttpPlugin::class.java))
        registerPlugin(VaultKeystorePlugin::class.java)
        registerPlugin(SecureClipboardPlugin::class.java)
        registerPlugin(QrScannerPlugin::class.java)
        registerPlugin(AutofillPlugin::class.java)
        registerPlugin(ScreenCapturePlugin::class.java)
        registerPlugin(BillingPlugin::class.java)
        registerPlugin(DurableFilePlugin::class.java)
        // Before super.onCreate, so the plugins' own Back handlers (the camera view) sit above it.
        onBackPressedDispatcher.addCallback(pageBack)
        super.onCreate(savedInstanceState)
        guardAgainstOverlays(this, bridge.webView)
        keepFromAbusiveAccessibilityServices(bridge.webView)
        drawBehindSystemBars()
    }

    // Android's Back walks the page's history first: an open item, sheet or the drawer holds one entry
    // (use-back-layer.ts), so Back closes it. With none open the app goes to the background, still
    // unlocked for the lock grace period. This callback stays on: left to Android, Back on the first
    // screen FINISHES the activity on Android 17 (even from the launcher), which destroys the page, so
    // coming back within the grace period meant the lock screen. The cost is Android's back-to-home
    // preview animation. (Capacitor leaves Back to its App plugin, which is not used here.)
    private val pageBack = object : OnBackPressedCallback(true) {
        override fun handleOnBackPressed() {
            val webView = bridge?.webView
            if (webView != null && webView.canGoBack()) webView.goBack() else moveTaskToBack(true)
        }
    }

    // The page draws behind the status and navigation bars on every Android and WebView version, and
    // keeps clear of them with --safe-area-inset-* (its --sat / --sab). Capacitor's SystemBars does this
    // only on WebView 140+ and otherwise pads the window, which shows white strips (insetsHandling is
    // "disable" in capacitor.config.js). Only the keyboard pads the window, so the page sits above it.
    private fun drawBehindSystemBars() {
        ViewCompat.setOnApplyWindowInsetsListener(window.decorView) { view, insets ->
            val bars = insets.getInsets(Type.systemBars() or Type.displayCutout())
            val keyboard = insets.isVisible(Type.ime())
            view.setPadding(0, 0, 0, if (keyboard) insets.getInsets(Type.ime()).bottom else 0)
            val dp = resources.displayMetrics.density
            safeArea = listOf("top" to bars.top, "right" to bars.right, "bottom" to if (keyboard) 0 else bars.bottom, "left" to bars.left)
                .joinToString("") { (side, px) -> "s.setProperty('--safe-area-inset-$side', '${(px / dp).toInt()}px');" }
            showSafeArea()
            // The keyboard is handled here; the views below (the WebView, the QR camera view) see the bars only.
            WindowInsetsCompat.Builder(insets).setInsets(Type.ime(), Insets.NONE).build()
        }
        bridge.addWebViewListener(object : WebViewListener() {
            override fun onPageCommitVisible(view: WebView, url: String) = showSafeArea()
        })
    }

    // Capacitor destroys its WebView when the window detaches. An activity Android recreates before its
    // window ever attached (a config change it cannot absorb, during a cold start) never detaches, so its
    // WebView would keep running a second copy of the vault page beside the new one.
    override fun onDestroy() {
        val webView = bridge?.webView
        super.onDestroy()
        if (webView != null && !webView.isAttachedToWindow) {
            webView.removeAllViews()
            webView.destroy()
        }
    }

    // Before the page has a document (first launch), there is nothing to set; the page's first commit
    // sets it again.
    private fun showSafeArea() {
        if (safeArea.isNotEmpty()) bridge?.webView?.evaluateJavascript("(() => { const s = document.documentElement?.style; if (s) { $safeArea } })()", null)
    }

    // A window event for the page. The first onResume comes before the page and Capacitor's bridge in it
    // have loaded (Bridge.triggerWindowJSEvent would throw there): nothing listens yet, so nothing is sent.
    private fun pageEvent(name: String) {
        bridge?.webView?.evaluateJavascript("window.Capacitor?.triggerEvent?.('$name', 'window')", null)
    }

    override fun onPause() {
        super.onPause()
        // The page locks the vault on this. Home, the app switcher and the power button all pass here;
        // our own fingerprint prompt does not, so it is not suppressed.
        if (ownDialog) quiet = true else pageEvent("kapevault:background")
    }

    override fun onStop() {
        super.onStop()
        // Left the app while our own dialog was up: that is a background after all.
        if (!quiet) return
        quiet = false
        pageEvent("kapevault:background")
    }

    override fun onResume() {
        super.onResume()
        // Back in front: the page decides whether the grace period ran out and it must lock.
        if (quiet) quiet = false else pageEvent("kapevault:resume")
    }

    // A touch through another app's window is refused (see guardAgainstOverlays), but never silently:
    // on Android 11 a screen dimmer or chat head would otherwise make every tap do nothing.
    override fun dispatchTouchEvent(ev: MotionEvent): Boolean {
        if (ev.flags and MotionEvent.FLAG_WINDOW_IS_OBSCURED != 0) {
            val now = SystemClock.uptimeMillis()
            if (ev.actionMasked == MotionEvent.ACTION_DOWN && now - lastObscuredNote > OBSCURED_NOTE_MS) {
                lastObscuredNote = now
                Toast.makeText(this, "Another app is drawing over KAPEVault. Close it to tap here.", Toast.LENGTH_LONG).show()
            }
            return true
        }
        return super.dispatchTouchEvent(ev)
    }

    private var lastObscuredNote = 0L

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        SecureClipboardPlugin.onFocus(applicationContext, hasFocus)
    }
}

private const val OBSCURED_NOTE_MS = 4_000L // one toast per this long while taps go through an overlay

/**
 * Tapjacking: another app's window drawn over the vault could trick a tap into it. Android 12+ hides
 * every other app's floating window while this one is up (HIDE_OVERLAY_WINDOWS); on every version a touch
 * that came through such a window is dropped by the view (MainActivity also says why, with a toast).
 * The system's own windows are not affected.
 */
fun guardAgainstOverlays(activity: Activity, view: View?) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) activity.window.setHideOverlayWindows(true)
    view?.filterTouchesWhenObscured = true
}

/**
 * Banking trojans read other apps' screens and tap their buttons through an accessibility service, which
 * FLAG_SECURE does not stop. On Android 14+ a view marked data-sensitive is shown only to services that
 * declare isAccessibilityTool (TalkBack and the like); any other service gets no node for it or its
 * children (View.includeForAccessibility) and its events are withheld. filterTouchesWhenObscured, set
 * above, already implies this by default; it is stated here so it does not hang on that side effect.
 * Earlier Androids have no such switch. A service that declares itself a tool, or one the user enabled
 * before this flag mattered to it, is not stopped.
 */
fun keepFromAbusiveAccessibilityServices(view: View?) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) view?.setAccessibilityDataSensitive(View.ACCESSIBILITY_DATA_SENSITIVE_YES)
}
