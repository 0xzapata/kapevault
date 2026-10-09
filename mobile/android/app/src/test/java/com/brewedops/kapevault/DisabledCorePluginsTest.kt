package com.brewedops.kapevault

import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

// Capacitor registers its WebView and CapacitorHttp plugins first and lets the app's own plugin of the
// same name replace them (Bridge.registerAllPlugins, then Bridge.registerPlugin's map put). The page then
// finds a plugin of that name with no methods. That a replacement keeps the core name, and offers no
// method of its own (Plugin's listener and permission methods stay) is what these check; that Capacitor
// really lets it win is proven on the emulator (proof.mjs).
class DisabledCorePluginsTest {
    private fun nameOf(plugin: Class<*>) = plugin.getAnnotation(CapacitorPlugin::class.java)!!.name
    private fun methodsOf(plugin: Class<*>) = plugin.declaredMethods.filter { it.isAnnotationPresent(PluginMethod::class.java) }

    @Test
    fun `the WebView replacement takes the core plugin's name and offers no method`() {
        assertEquals("WebView", nameOf(DisabledWebViewPlugin::class.java))
        assertTrue(methodsOf(DisabledWebViewPlugin::class.java).isEmpty())
    }

    @Test
    fun `the CapacitorHttp replacement takes the core plugin's name and guards every request method`() {
        assertEquals("CapacitorHttp", nameOf(R2OnlyHttpPlugin::class.java))
        // Each of Capacitor's request methods is overridden (an un-overridden one would skip the check).
        val core = methodsOf(com.getcapacitor.plugin.CapacitorHttp::class.java).map { it.name }.toSet()
        assertEquals(core, methodsOf(R2OnlyHttpPlugin::class.java).map { it.name }.toSet())
    }

    @Test
    fun `only an R2 S3 API host over https passes`() {
        for (ok in listOf(
            "https://0123abcd.r2.cloudflarestorage.com/kapevault/vault.kapevault",
            "https://0123ABCD.R2.CloudflareStorage.com/b?list-type=2",
            "https://a.eu.r2.cloudflarestorage.com:443/b",
        )) assertTrue(ok, R2OnlyHttpPlugin.isR2Url(ok))
        for (bad in listOf(
            null, "", "not a url", "https://example.com",
            "http://0123abcd.r2.cloudflarestorage.com/b", // not https
            "https://r2.cloudflarestorage.com.evil.example/b", // the suffix must end the host
            "https://evilr2.cloudflarestorage.com/b", // no dot before r2
            "https://x.r2.cloudflarestorage.com@evil.example/b", // user info: the host is evil.example
            "https://user:pw@x.r2.cloudflarestorage.com/b",
            "https://x.r2.cloudflarestorage.com:8443/b",
            "ftp://x.r2.cloudflarestorage.com/b",
        )) assertTrue(bad.toString(), !R2OnlyHttpPlugin.isR2Url(bad))
    }

    @Test
    fun `the test bucket on localhost is a separate rule, used only by debuggable builds`() {
        assertTrue(R2OnlyHttpPlugin.isLoopbackUrl("http://localhost:41234/kapevault-e2e"))
        assertTrue(!R2OnlyHttpPlugin.isR2Url("http://localhost:41234/kapevault-e2e"))
        for (bad in listOf("http://localhost.evil.example/", "http://127.0.0.1.evil.example/", "https://example.com", "http://user@localhost/", "https://localhost/", "ftp://localhost/"))
            assertTrue(bad, !R2OnlyHttpPlugin.isLoopbackUrl(bad))
    }

    @Test
    fun `the names are the ones Capacitor's own plugins register under`() {
        // The core classes are com.getcapacitor.plugin.WebView and .CapacitorHttp, named by class (no name set).
        assertEquals("WebView", com.getcapacitor.plugin.WebView::class.java.simpleName)
        assertEquals("CapacitorHttp", com.getcapacitor.plugin.CapacitorHttp::class.java.simpleName)
        assertTrue(com.getcapacitor.plugin.WebView::class.java.getAnnotation(CapacitorPlugin::class.java)!!.name.isEmpty())
        assertTrue(com.getcapacitor.plugin.CapacitorHttp::class.java.getAnnotation(CapacitorPlugin::class.java)!!.name.isEmpty())
        // The core WebView plugin has the methods the page must not reach.
        assertTrue(methodsOf(com.getcapacitor.plugin.WebView::class.java).map { it.name }.containsAll(listOf("setServerBasePath", "persistServerBasePath")))
    }
}
