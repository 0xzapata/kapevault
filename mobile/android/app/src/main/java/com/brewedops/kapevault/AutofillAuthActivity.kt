package com.brewedops.kapevault

import android.app.Activity
import android.app.assist.AssistStructure
import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.service.autofill.Dataset
import android.view.WindowManager
import android.view.autofill.AutofillManager
import androidx.core.content.IntentCompat
import java.util.UUID

/**
 * The "Fill from KAPEVault" suggestion's authentication. Android starts it for a result on top of the
 * app being filled; it hands the request to the vault (MainActivity, its own task, where the page
 * unlocks as usual and shows the picker) and waits. The picked login comes back through PendingFill
 * as the filled dataset, and this activity returns it to Android. Coming back here without a pick
 * (Back at the vault's list, the app switcher) is a cancel. It draws nothing and is FLAG_SECURE.
 *
 * MainActivity cannot be the authentication itself: it is singleTask, and Android cancels the result
 * of an activity started into another task.
 */
class AutofillAuthActivity : Activity() {
    private var handedOver = false // the vault has the request; the next resume here is a return

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        guardAgainstOverlays(this, window.decorView)
        if (savedInstanceState?.getBoolean(HANDED_OVER) == true) {
            handedOver = true
            return
        }
        // The structure comes in the fill-in, which the filled app's process relays, so it is read as untrusted:
        // a parcel that does not read, or names no screen, is refused instead of crashing the vault's process.
        val structure = try {
            IntentCompat.getParcelableExtra(intent, AutofillManager.EXTRA_ASSIST_STRUCTURE, AssistStructure::class.java)
        } catch (e: RuntimeException) {
            null
        }
        val screen: ComponentName? = structure?.activityComponent
        // Android starts this for a result from the screen being filled, so that screen's app is the caller.
        // A structure that names another app (a trusted browser, to borrow its trust) is not the caller's own.
        if (structure == null || screen == null || callingActivity?.packageName != screen.packageName) return answer(null)
        val form = LoginForm.parse(structure, intent.action == ACTION_AUTH_COMPAT)
        if (form == null || !LoginForm.mayFill(this, screen) || AppSigners.refuses(this, form.packageName)) return answer(null)
        PendingFill.start(PendingFill.Request(form, appLabel(form.packageName), TrustedBrowsers.isTrusted(packageManager, form.packageName), this))
        startActivity(Intent(this, MainActivity::class.java).setAction(ACTION_FILL))
    }

    override fun onResume() {
        super.onResume()
        if (!handedOver) {
            handedOver = true
            return
        }
        // Back here without a pick. After Android recreated this activity, the request went with the old one.
        if (PendingFill.current?.auth === this) PendingFill.end(this, null) else answer(null)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        outState.putBoolean(HANDED_OVER, handedOver)
    }

    // Gone (finished, or recreated by Android): the vault's picker closes, and a pick can no longer land here.
    override fun onDestroy() {
        super.onDestroy()
        PendingFill.end(this, null)
    }

    // The ephemeral flag (Android 12+): the filled dataset is used once, never kept by Android in place
    // of the locked one, so the next fill asks the vault again.
    fun answer(dataset: Dataset?) {
        if (isFinishing || isDestroyed) return
        if (dataset == null) {
            setResult(RESULT_CANCELED)
        } else {
            setResult(
                RESULT_OK,
                Intent()
                    .putExtra(AutofillManager.EXTRA_AUTHENTICATION_RESULT, dataset)
                    .putExtra(AutofillManager.EXTRA_AUTHENTICATION_RESULT_EPHEMERAL_DATASET, true),
            )
        }
        finish()
    }

    // The app's name as the phone shows it; its package name when Android keeps it from us.
    private fun appLabel(packageName: String) = try {
        packageManager.getApplicationLabel(packageManager.getApplicationInfo(packageName, 0)).toString()
    } catch (e: PackageManager.NameNotFoundException) {
        packageName
    }

    companion object {
        const val ACTION_FILL = "com.brewedops.kapevault.action.FILL"
        // The auth intent's action: whether the request was a compatibility-mode one (KapeAutofillService).
        const val ACTION_AUTH = "com.brewedops.kapevault.action.AUTH"
        const val ACTION_AUTH_COMPAT = "com.brewedops.kapevault.action.AUTH_COMPAT"
        private const val HANDED_OVER = "handedOver"
    }
}

/**
 * The one fill request waiting for the vault's pick (main thread only). It carries field ids and the
 * app's name, never a value; the picked login goes straight from the page into the dataset.
 */
object PendingFill {
    // browser: a known browser with its own signing certificate, so its page domain is trusted. id: new for
    // every request, so a pick made for one never fills the next.
    class Request(val form: LoginForm, val appLabel: String, val browser: Boolean, val auth: AutofillAuthActivity) {
        val id: String = UUID.randomUUID().toString()
    }

    interface Listener {
        fun onRequest(request: Request)
        fun onEnded()
    }

    var current: Request? = null
        private set
    var listener: Listener? = null // AutofillPlugin, while the vault page is up

    // A newer request replaces an older one, which is cancelled.
    fun start(request: Request) {
        current?.let { end(it.auth, null) }
        current = request
        listener?.onRequest(request)
    }

    // Answers the request `auth` made (a dataset, or null to cancel), if it is still the waiting one.
    fun end(auth: AutofillAuthActivity, dataset: Dataset?) {
        val request = current?.takeIf { it.auth === auth } ?: return
        current = null
        if (dataset != null && !request.browser) AppSigners.remember(request.auth.applicationContext, request.form.packageName)
        request.auth.answer(dataset)
        listener?.onEnded()
    }
}
