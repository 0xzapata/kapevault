package com.brewedops.kapevault

import com.getcapacitor.Plugin
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * The foss flavor's stand-in for the Play flavor's BillingPlugin (src/play): same name, so MainActivity
 * registers it the same way, but no Google Play Billing library and no method. The page calls
 * Billing.status() or buy() and Capacitor answers "not implemented" (code UNIMPLEMENTED), which
 * host/pro.ts turns into "Pro is not available in this build". Pro cannot be bought here.
 */
@CapacitorPlugin(name = "Billing")
class BillingPlugin : Plugin()
