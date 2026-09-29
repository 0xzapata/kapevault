package com.brewedops.kapevault

import android.app.PendingIntent
import android.content.Intent
import android.os.CancellationSignal
import android.service.autofill.AutofillService
import android.service.autofill.Dataset
import android.service.autofill.FillCallback
import android.service.autofill.FillRequest
import android.service.autofill.FillResponse
import android.service.autofill.SaveCallback
import android.service.autofill.SaveRequest
import android.widget.RemoteViews

/**
 * Android autofill: on a sign-in screen in another app or a browser, offers one suggestion, "Fill from
 * KAPEVault". It holds no vault data - the vault lives only in the app's page - so the suggestion is a
 * locked dataset: tapping it opens AutofillAuthActivity, which brings up the vault (unlocked as usual)
 * with a picker, and the chosen login comes back as the filled dataset. Nothing is logged or kept here.
 */
class KapeAutofillService : AutofillService() {
    override fun onFillRequest(request: FillRequest, cancellationSignal: CancellationSignal, callback: FillCallback) {
        val structure = request.fillContexts.last().structure
        val compat = request.flags and FillRequest.FLAG_COMPATIBILITY_MODE_REQUEST != 0
        val form = LoginForm.parse(structure, compat)
        if (form == null || !LoginForm.mayFill(this, structure.activityComponent)) return callback.onSuccess(null)
        callback.onSuccess(FillResponse.Builder().addDataset(locked(form, compat)).build())
    }

    // Saving a login typed into another app is not offered (no SaveInfo): the vault is not open here to save it.
    override fun onSaveRequest(request: SaveRequest, callback: SaveCallback) = callback.onSuccess()

    // Every login field, no values, and the vault as its authentication. Android fills the extras the
    // activity needs (the screen's structure) into the intent, so it must stay mutable. It names our
    // own activity, which no fill-in can change. compat: the activity parses the structure again, and the
    // request's compatibility-mode flag is only on the FillRequest, so it rides along as the intent's
    // action: part of the PendingIntent's identity, so the two kinds of request never share one (an extra
    // is not, and would reach every cached dataset), and a fill-in cannot overwrite it (no FILL_IN_ACTION).
    // The builder that takes Presentations is API 33; this app starts at 30.
    @Suppress("DEPRECATION")
    private fun locked(form: LoginForm, compat: Boolean): Dataset {
        val auth = PendingIntent.getActivity(
            this,
            0,
            Intent(this, AutofillAuthActivity::class.java)
                .setAction(if (compat) AutofillAuthActivity.ACTION_AUTH_COMPAT else AutofillAuthActivity.ACTION_AUTH),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE,
        ).intentSender
        val dataset = Dataset.Builder(RemoteViews(packageName, R.layout.autofill_item))
        for (id in form.ids) dataset.setValue(id, null)
        return dataset.setAuthentication(auth).build()
    }
}
