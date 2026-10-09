package com.brewedops.kapevault

import android.content.pm.ApplicationInfo
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.plugin.CapacitorHttp
import java.net.MalformedURLException
import java.net.URL

/**
 * Capacitor registers its own WebView and CapacitorHttp plugins whatever the app needs
 * (Bridge.registerAllPlugins), and the page can call both. Each is a way out of the page's limits for
 * script that got in:
 *  - WebView.setServerBasePath + persistServerBasePath point every later launch at files the page wrote
 *    (with @capacitor/filesystem), so one injection becomes a permanent page with every plugin, the
 *    vault key included. KAPEVault never uses it: the replacement has no @PluginMethod, so a call is
 *    refused as "not implemented".
 *  - CapacitorHttp is a native HTTP client the page's CSP (connect-src) does not govern. KAPEVault needs
 *    it - every R2 request goes through it (native.ts transport) - so the replacement keeps Capacitor's
 *    request code and refuses any address that is not an R2 S3 API host over https, before a connection
 *    is made. A planted script can then reach R2 and nothing else on the internet.
 * Plugins registered by the app come after the core ones in the same map, so one of the same name
 * replaces it.
 */
@CapacitorPlugin(name = "WebView")
class DisabledWebViewPlugin : Plugin()

@CapacitorPlugin(name = "CapacitorHttp")
class R2OnlyHttpPlugin : CapacitorHttp() {
    @PluginMethod
    override fun request(call: PluginCall) {
        if (allowed(call)) super.request(call)
    }

    @PluginMethod
    override fun get(call: PluginCall) {
        if (allowed(call)) super.get(call)
    }

    @PluginMethod
    override fun post(call: PluginCall) {
        if (allowed(call)) super.post(call)
    }

    @PluginMethod
    override fun put(call: PluginCall) {
        if (allowed(call)) super.put(call)
    }

    @PluginMethod
    override fun patch(call: PluginCall) {
        if (allowed(call)) super.patch(call)
    }

    @PluginMethod
    override fun delete(call: PluginCall) {
        if (allowed(call)) super.delete(call)
    }

    private fun allowed(call: PluginCall): Boolean {
        val debuggable = context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0
        if (isR2Url(call.getString("url")) || (debuggable && isLoopbackUrl(call.getString("url")))) return true
        call.reject("Only Cloudflare R2 can be reached from KAPEVault.")
        return false
    }

    companion object {
        // Both parse with java.net.URL, as Capacitor's HttpRequestHandler parses the same string before it
        // connects, so the check and the connection cannot read a different host.
        private fun parse(url: String?): URL? =
            if (url.isNullOrEmpty()) null else try { URL(url) } catch (_: MalformedURLException) { null }

        /**
         * The rule core/r2.js applies to the S3 API URL the user pastes: https on a host under
         * .r2.cloudflarestorage.com. No user info (`https://r2.cloudflarestorage.com@evil.example/`) and
         * only the default port.
         */
        fun isR2Url(url: String?): Boolean {
            val parsed = parse(url) ?: return false
            return parsed.protocol == "https" &&
                parsed.userInfo == null &&
                (parsed.port == -1 || parsed.port == 443) &&
                parsed.host.lowercase().endsWith(".r2.cloudflarestorage.com")
        }

        /**
         * The device tests' fake bucket on the PC, reached through `adb reverse` (device-proof.mjs,
         * two-device.mjs). Accepted only in a debuggable build, as the billing fake is.
         */
        fun isLoopbackUrl(url: String?): Boolean {
            val parsed = parse(url) ?: return false
            return parsed.protocol == "http" && parsed.userInfo == null && parsed.host == "localhost"
        }
    }
}
