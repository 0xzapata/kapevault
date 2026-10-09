package com.brewedops.kapevault

import android.content.Context
import android.util.AttributeSet
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputConnection
import com.getcapacitor.CapacitorWebView

/**
 * The vault page's WebView (res/layout/capacitor_bridge_layout_main.xml, which Capacitor's BridgeActivity
 * inflates). It tells the keyboard not to learn from what is typed: Gboard, SwiftKey (which syncs learned
 * words to its cloud) and Samsung Keyboard would otherwise offer a secure note, an API secret or a shown
 * password back as a suggestion in any other app. A WebView cannot set this per field, so every field of
 * the vault gets it, secret or not. The keyboard may ignore the flag; the system's own keyboards honour it.
 */
class VaultWebView(context: Context, attrs: AttributeSet?) : CapacitorWebView(context, attrs) {
    override fun onCreateInputConnection(outAttrs: EditorInfo): InputConnection? {
        val connection = super.onCreateInputConnection(outAttrs)
        outAttrs.imeOptions = outAttrs.imeOptions or EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING
        return connection
    }
}
