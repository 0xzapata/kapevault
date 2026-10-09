package com.brewedops.kapevault

import java.io.File
import org.junit.Assert.assertTrue
import org.junit.Test

// The vault page must be invisible to the system autofill provider (Google, Samsung Pass), or it may
// offer to save the master password typed on the unlock screen. The real effect needs a device with
// Google as the autofill provider; this pins that the attribute stays in the bridge layout.
class AutofillExclusionTest {
    private val attr = "android:importantForAutofill=\"noExcludeDescendants\""
    private val layout = File("src/main/res/layout/capacitor_bridge_layout_main.xml").readText()
    private val manifest = File("src/main/AndroidManifest.xml").readText()

    @Test
    fun `the bridge layout excludes the root and the WebView from autofill`() {
        val count = Regex(Regex.escape(attr)).findAll(layout).count()
        assertTrue("root layout and VaultWebView both need $attr (found $count)", count >= 2)
        val webView = Regex("<com\\.brewedops\\.kapevault\\.VaultWebView[^>]*>").find(layout)!!.value
        assertTrue(webView.contains(attr))
    }

    @Test
    fun `KAPEVault's own autofill service for other apps stays declared`() {
        assertTrue(manifest.contains("android:name=\".KapeAutofillService\""))
        assertTrue(manifest.contains("android.service.autofill.AutofillService"))
    }
}
