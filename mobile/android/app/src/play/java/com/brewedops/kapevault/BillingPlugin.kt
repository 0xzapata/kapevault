package com.brewedops.kapevault

import android.content.pm.ApplicationInfo
import com.android.billingclient.api.AcknowledgePurchaseParams
import com.android.billingclient.api.BillingClient
import com.android.billingclient.api.BillingClient.BillingResponseCode
import com.android.billingclient.api.BillingClient.ProductType
import com.android.billingclient.api.BillingClientStateListener
import com.android.billingclient.api.BillingFlowParams
import com.android.billingclient.api.BillingResult
import com.android.billingclient.api.PendingPurchasesParams
import com.android.billingclient.api.ProductDetails
import com.android.billingclient.api.Purchase
import com.android.billingclient.api.PurchasesUpdatedListener
import com.android.billingclient.api.QueryProductDetailsParams
import com.android.billingclient.api.QueryPurchasesParams
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.File

/**
 * KAPEVault Pro, one-time Google Play purchase of the in-app product "pro" (the page's rule is
 * host/pro.ts). Google Play Billing is bound only when the page calls: status() when the user opens
 * the Pro sheet or taps Restore purchase (or once this install bought Pro), buy() on Buy. Nothing on
 * start. No server: Play's own answer is the proof, and KAPEVault learns only whether Pro was bought.
 *
 * status() -> { owned, pending, price? }: the purchase as Play knows it (a bought one is acknowledged
 * here, or Play refunds it after three days) and the price in the phone's currency. buy() opens Play's
 * purchase sheet -> { owned, pending }; already owned answers as status() does.
 * Rejections: unavailable (no Play Store, not signed in, the product not offered), canceled, failed.
 *
 * Debug builds only: files/billing-fake (approve, owned, pending, refuse, unavailable) stands in for
 * Play on the emulator. A release build is not debuggable, so it never reads it.
 */
@CapacitorPlugin(name = "Billing")
class BillingPlugin : Plugin() {
    private var client: BillingClient? = null
    private var connecting = false
    private var attempt = 0 // the latest connection; a late answer from an earlier one is ignored
    private val waiting = mutableListOf<Pair<PluginCall, (BillingClient) -> Unit>>()
    private var buying: PluginCall? = null // the buy() whose Play sheet is open
    private val main get() = activity as MainActivity

    @PluginMethod
    fun status(call: PluginCall) {
        fake()?.let { return fakeStatus(call, it) }
        ready(call) { billing -> answer(call, billing) }
    }

    @PluginMethod
    fun buy(call: PluginCall) {
        fake()?.let { return fakeBuy(call, it) }
        ready(call) { billing ->
            product(billing) { result, details ->
                // Not offered: Play answered with no product. Any other error is worth trying again.
                if (details == null) {
                    return@product if (result.responseCode == BillingResponseCode.OK) call.reject("KAPEVault Pro is not offered here.", "unavailable") else fail(call, result)
                }
                activity.runOnUiThread {
                    if (buying != null) return@runOnUiThread call.reject("A purchase is already open.", "failed")
                    buying = call
                    // Play's purchase sheet pauses the vault; the user has not left the app.
                    main.ownDialog = true
                    val params = BillingFlowParams.newBuilder()
                        .setProductDetailsParamsList(listOf(BillingFlowParams.ProductDetailsParams.newBuilder().setProductDetails(details).build()))
                        .build()
                    val launched = billing.launchBillingFlow(activity, params)
                    if (launched.responseCode != BillingResponseCode.OK) bought(launched, null)
                }
            }
        }
    }

    // Play's sheet closed. Also called for a purchase that finished while no buy() waited (a pending
    // payment that came through): it is acknowledged, and the page hears of it on its next status().
    private val updated = PurchasesUpdatedListener { result, purchases -> bought(result, purchases) }

    private fun bought(result: BillingResult, purchases: List<Purchase>?) {
        purchases?.forEach { acknowledge(it) }
        val call = buying ?: return
        buying = null
        main.ownDialog = false
        val billing = client
        when {
            result.responseCode == BillingResponseCode.OK && purchases != null -> call.resolve(view(purchases.firstOrNull { PRODUCT in it.products }))
            // Bought before (another phone, a reinstall): Play's own list says so.
            (result.responseCode == BillingResponseCode.ITEM_ALREADY_OWNED || result.responseCode == BillingResponseCode.OK) && billing != null -> answer(call, billing)
            else -> fail(call, result)
        }
    }

    override fun handleOnResume() {
        // Back from Play's sheet: whatever it answers, the next pause is the user's again.
        main.ownDialog = false
    }

    override fun handleOnDestroy() {
        client?.endConnection()
        client = null
    }

    // One client, made on the first call and never before; a call that finds it disconnected connects
    // again. Not enableAutoServiceReconnection: with it a Play Store that cannot bill (not signed in)
    // came back as SERVICE_DISCONNECTED ("try again") instead of BILLING_UNAVAILABLE (emulator, 2026-09-30).
    private fun ready(call: PluginCall, then: (BillingClient) -> Unit) {
        val billing = client ?: BillingClient.newBuilder(context)
            .setListener(updated)
            .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
            .build()
            .also { client = it }
        if (billing.isReady) return then(billing)
        val mine = synchronized(waiting) {
            waiting.add(call to then)
            if (connecting) return
            connecting = true
            ++attempt
        }
        billing.startConnection(object : BillingClientStateListener {
            override fun onBillingSetupFinished(result: BillingResult) {
                val calls = synchronized(waiting) { if (attempt != mine) return; connecting = false; waiting.toList().also { waiting.clear() } }
                for ((waitingCall, action) in calls) if (result.responseCode == BillingResponseCode.OK) action(billing) else fail(waitingCall, result)
            }

            // Lost while connecting: the calls waiting would never hear. Later, the next call connects again (isReady is false).
            override fun onBillingServiceDisconnected() {
                val calls = synchronized(waiting) { if (attempt != mine) return; connecting = false; waiting.toList().also { waiting.clear() } }
                for ((waitingCall) in calls) waitingCall.reject("Google Play did not answer.", "failed")
            }
        })
    }

    // The purchase as Play lists it, plus the price.
    private fun answer(call: PluginCall, billing: BillingClient) {
        billing.queryPurchasesAsync(QueryPurchasesParams.newBuilder().setProductType(ProductType.INAPP).build()) { result, purchases ->
            if (result.responseCode != BillingResponseCode.OK) return@queryPurchasesAsync fail(call, result)
            val pro = purchases.firstOrNull { PRODUCT in it.products }
            pro?.let { acknowledge(it) }
            product(billing) { _, details ->
                val out = view(pro)
                details?.oneTimePurchaseOfferDetails?.formattedPrice?.let { out.put("price", it) }
                call.resolve(out)
            }
        }
    }

    // Play's answer and the "pro" product, or null when Play does not offer it here or did not answer.
    private fun product(billing: BillingClient, then: (BillingResult, ProductDetails?) -> Unit) {
        val product = QueryProductDetailsParams.Product.newBuilder().setProductId(PRODUCT).setProductType(ProductType.INAPP).build()
        billing.queryProductDetailsAsync(QueryProductDetailsParams.newBuilder().setProductList(listOf(product)).build()) { result, details ->
            then(result, if (result.responseCode == BillingResponseCode.OK) details.productDetailsList.firstOrNull() else null)
        }
    }

    private fun view(purchase: Purchase?) = JSObject().apply {
        put("owned", purchase?.purchaseState == Purchase.PurchaseState.PURCHASED)
        put("pending", purchase?.purchaseState == Purchase.PurchaseState.PENDING)
    }

    private fun acknowledge(purchase: Purchase) {
        if (purchase.purchaseState != Purchase.PurchaseState.PURCHASED || purchase.isAcknowledged) return
        // A failure is tried again on the next status().
        client?.acknowledgePurchase(AcknowledgePurchaseParams.newBuilder().setPurchaseToken(purchase.purchaseToken).build()) {}
    }

    private fun fail(call: PluginCall, result: BillingResult) {
        when (result.responseCode) {
            BillingResponseCode.BILLING_UNAVAILABLE, BillingResponseCode.ITEM_UNAVAILABLE, BillingResponseCode.FEATURE_NOT_SUPPORTED -> call.reject("Google Play Billing is not available.", "unavailable")
            BillingResponseCode.USER_CANCELED -> call.reject("Canceled.", "canceled")
            else -> call.reject("Google Play did not answer.", "failed")
        }
    }

    // --- The debug-only fake store (files/billing-fake) -------------------------------------------------

    private fun fake(): File? {
        if (context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE == 0) return null
        return File(context.filesDir, "billing-fake").takeIf { it.isFile }
    }

    private fun fakeStatus(call: PluginCall, file: File) {
        when (val mode = file.readText().trim()) {
            "unavailable" -> call.reject("Google Play Billing is not available.", "unavailable")
            "approve", "owned", "pending", "refuse" -> call.resolve(JSObject().put("owned", mode == "owned").put("pending", mode == "pending").put("price", "US$9.99"))
            else -> call.reject("Google Play did not answer.", "failed")
        }
    }

    private fun fakeBuy(call: PluginCall, file: File) {
        when (file.readText().trim()) {
            "unavailable" -> call.reject("Google Play Billing is not available.", "unavailable")
            "refuse" -> call.reject("Canceled.", "canceled")
            "approve", "owned" -> {
                file.writeText("owned")
                call.resolve(JSObject().put("owned", true).put("pending", false))
            }
            "pending" -> call.resolve(JSObject().put("owned", false).put("pending", true))
            else -> call.reject("Google Play did not answer.", "failed")
        }
    }
}

private const val PRODUCT = "pro"
