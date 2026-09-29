package com.brewedops.kapevault

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import android.view.autofill.AutofillManager
import androidx.activity.result.ActivityResult
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * The vault page's side of autofill (KapeAutofillService): whether KAPEVault is the phone's autofill
 * service, and the fill request waiting for a pick. The page sends the chosen login's username and
 * password once, to fill(), with the id of the request it showed (a newer request may have replaced it
 * since); they go into the dataset for the other app and are not kept here.
 *
 * Events: "request" (a fill request came in while the page is up), "ended" (it was answered or
 * cancelled elsewhere, e.g. the user went back to the other app).
 */
@CapacitorPlugin(name = "Autofill")
class AutofillPlugin : Plugin() {
    private val manager get() = context.getSystemService(AutofillManager::class.java)

    private val listener = object : PendingFill.Listener {
        override fun onRequest(request: PendingFill.Request) = notifyListeners("request", target(request))
        override fun onEnded() = notifyListeners("ended", JSObject())
    }

    override fun load() {
        bridge.executeOnMainThread { PendingFill.listener = listener }
    }

    override fun handleOnDestroy() {
        if (PendingFill.listener === listener) PendingFill.listener = null
    }

    @PluginMethod
    fun status(call: PluginCall) = call.resolve(status())

    // Android's "Autofill service" picker, with KAPEVault chosen. It answers at once, with no screen,
    // when KAPEVault already is the service.
    @PluginMethod
    fun openSettings(call: PluginCall) {
        val intent = Intent(Settings.ACTION_REQUEST_SET_AUTOFILL_SERVICE).setData(Uri.parse("package:${context.packageName}"))
        try {
            startActivityForResult(call, intent, "settingsClosed")
        } catch (e: ActivityNotFoundException) {
            call.resolve(status()) // a phone whose Settings has no such screen: nothing changes
        }
    }

    @ActivityCallback
    private fun settingsClosed(call: PluginCall, @Suppress("UNUSED_PARAMETER") result: ActivityResult) = call.resolve(status())

    // Only the service in use may turn itself off.
    @PluginMethod
    fun disable(call: PluginCall) {
        if (manager?.hasEnabledAutofillServices() == true) manager?.disableAutofillServices()
        call.resolve(status())
    }

    @PluginMethod
    fun pending(call: PluginCall) {
        bridge.executeOnMainThread {
            call.resolve(PendingFill.current?.let { JSObject().put("target", target(it)) } ?: JSObject())
        }
    }

    // The page's pick, for the request it showed. The vault goes to the background, and the other app is filled.
    @PluginMethod
    fun fill(call: PluginCall) {
        val id = call.getString("id").orEmpty()
        val username = call.getString("username").orEmpty()
        val password = call.getString("password").orEmpty()
        bridge.executeOnMainThread {
            val request = PendingFill.current ?: return@executeOnMainThread call.reject("Nothing is waiting to be filled.")
            if (request.id != id) return@executeOnMainThread call.reject("Another app asked since. Pick the login again.")
            val dataset = request.form.filled(username, password) ?: return@executeOnMainThread call.reject("This login has nothing to fill.")
            PendingFill.end(request.auth, dataset)
            activity.moveTaskToBack(true)
            call.resolve()
        }
    }

    @PluginMethod
    fun cancel(call: PluginCall) {
        bridge.executeOnMainThread {
            PendingFill.current?.let {
                PendingFill.end(it.auth, null)
                activity.moveTaskToBack(true)
            }
            call.resolve()
        }
    }

    private fun status() = JSObject()
        .put("supported", manager?.isAutofillSupported == true)
        .put("enabled", manager?.hasEnabledAutofillServices() == true)

    // What the page shows and matches on. A checked browser's page is named by its site and scheme; any
    // other app by its package, and its claimed domain is left out (any app can claim any domain in its web
    // views). id: this request's, for fill().
    private fun target(request: PendingFill.Request) = JSObject()
        .put("id", request.id)
        .put("packageName", request.form.packageName)
        .put("appLabel", request.appLabel)
        .put("webDomain", if (request.browser) request.form.webDomain else null)
        .put("webScheme", if (request.browser) request.form.webScheme else null)
        .put("addressBar", request.browser && request.form.addressBar)
        .put("browser", request.browser)
        .put("username", request.form.hasUsername)
        .put("password", request.form.hasPassword)
}
