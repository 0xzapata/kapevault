package com.brewedops.kapevault

import android.hardware.biometrics.BiometricManager
import android.hardware.biometrics.BiometricManager.Authenticators.BIOMETRIC_STRONG
import android.hardware.biometrics.BiometricPrompt
import android.os.CancellationSignal
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import android.security.keystore.StrongBoxUnavailableException
import android.util.AtomicFile
import android.util.Base64
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import org.json.JSONObject
import java.io.File
import java.security.GeneralSecurityException
import java.security.KeyStore
import java.util.concurrent.atomic.AtomicBoolean
import javax.crypto.AEADBadTagException
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Fingerprint unlock, the phone's Windows Hello: an Android Keystore AES-256-GCM key that only a
 * strong biometric can use wraps the 32-byte vault key, and the wrapped blob sits in app-private
 * no-backup storage. The key is invalidated when a new fingerprint is enrolled. The 14-day master
 * password rule is core/master-due.js; the sealed dates are the page's host (src/app/host/biometric.ts).
 * This plugin only wraps and unwraps.
 *
 * Rejections carry the desktop's codes: unsupported, not-enabled, canceled, locked-out, changed, failed.
 */
@CapacitorPlugin(name = "VaultKeystore")
class VaultKeystorePlugin : Plugin() {
    private val blobFile by lazy { AtomicFile(File(context.noBackupFilesDir, "vault-keystore.json")) }
    private val prompting = AtomicBoolean(false)

    @PluginMethod
    fun isAvailable(call: PluginCall) {
        val status = context.getSystemService(BiometricManager::class.java).canAuthenticate(BIOMETRIC_STRONG)
        val result = JSObject()
            .put("available", status == BiometricManager.BIOMETRIC_SUCCESS)
            .put("enabled", blobFile.baseFile.exists())
        if (status == BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED) result.put("reason", "none-enrolled")
        call.resolve(result)
    }

    @PluginMethod
    fun enable(call: PluginCall) {
        val vaultKey = call.getString("key")?.let { decodeBase64(it) }
        if (vaultKey?.size != KEY_BYTES) {
            vaultKey?.fill(0)
            return call.reject("The vault key must be 32 bytes.", "failed")
        }
        forget() // a cancelled enable leaves it off, never half-replaced
        val cipher = try {
            Cipher.getInstance(TRANSFORMATION).apply { init(Cipher.ENCRYPT_MODE, newWrapKey()) }
        } catch (e: Exception) {
            // GeneralSecurityException, or ProviderException from the TEE fallback in newWrapKey (a
            // RuntimeException): either way the key bytes must not outlive the call.
            vaultKey.fill(0)
            return call.reject("This phone cannot make a fingerprint key.", "unsupported")
        }
        authenticate(call, cipher, "Turn on fingerprint unlock", cleanup = { vaultKey.fill(0) }) { authed ->
            writeBlob(authed.iv, authed.doFinal(vaultKey))
            call.resolve()
        }
    }

    @PluginMethod
    fun unlock(call: PluginCall) {
        if (!blobFile.baseFile.exists()) return call.reject("Fingerprint unlock is off.", "not-enabled")
        val blob = readBlob() ?: run {
            forget()
            return call.reject(CHANGED, "changed")
        }
        val cipher = try {
            val wrapKey = keyStore().getKey(KEY_ALIAS, null) as? SecretKey ?: throw KeyPermanentlyInvalidatedException()
            Cipher.getInstance(TRANSFORMATION).apply { init(Cipher.DECRYPT_MODE, wrapKey, GCMParameterSpec(TAG_BITS, blob.iv)) }
        } catch (e: KeyPermanentlyInvalidatedException) {
            // A fingerprint was added (or the key is gone): only the master password can turn it on again.
            forget()
            return call.reject(CHANGED, "changed")
        } catch (e: GeneralSecurityException) {
            return call.reject("Fingerprint unlock did not work. Use your master password.", "failed")
        }
        authenticate(call, cipher, "Unlock your vault") { authed ->
            val vaultKey = try {
                authed.doFinal(blob.wrapped)
            } catch (e: AEADBadTagException) {
                forget()
                return@authenticate call.reject(CHANGED, "changed")
            }
            try {
                call.resolve(JSObject().put("key", Base64.encodeToString(vaultKey, Base64.NO_WRAP)))
            } finally {
                vaultKey.fill(0)
            }
        }
    }

    @PluginMethod
    fun disable(call: PluginCall) {
        forget()
        call.resolve()
    }

    // Shows the prompt bound to this cipher; onAuthenticated gets the cipher the prompt unlocked.
    // cleanup runs once on every outcome.
    private fun authenticate(
        call: PluginCall,
        cipher: Cipher,
        subtitle: String,
        cleanup: () -> Unit = {},
        onAuthenticated: (Cipher) -> Unit,
    ) {
        if (!prompting.compareAndSet(false, true)) {
            cleanup()
            return call.reject("A fingerprint prompt is already open.", "failed")
        }
        val finish = { cleanup(); prompting.set(false) }
        val activity = activity
        activity.runOnUiThread {
            val prompt = BiometricPrompt.Builder(activity)
                .setTitle("KAPEVault")
                .setSubtitle(subtitle)
                .setAllowedAuthenticators(BIOMETRIC_STRONG)
                .setNegativeButton("Use master password", activity.mainExecutor) { _, _ ->
                    finish()
                    call.reject("Fingerprint unlock was cancelled.", "canceled")
                }
                .build()
            val callback = object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                    try {
                        onAuthenticated(result.cryptoObject?.cipher ?: throw GeneralSecurityException("No cipher from the prompt"))
                    } catch (e: GeneralSecurityException) {
                        call.reject("Fingerprint unlock did not work. Use your master password.", "failed")
                    } finally {
                        finish()
                    }
                }

                override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                    finish()
                    val code = when (errorCode) {
                        BiometricPrompt.BIOMETRIC_ERROR_CANCELED, BiometricPrompt.BIOMETRIC_ERROR_USER_CANCELED -> "canceled"
                        BiometricPrompt.BIOMETRIC_ERROR_LOCKOUT, BiometricPrompt.BIOMETRIC_ERROR_LOCKOUT_PERMANENT -> "locked-out"
                        BiometricPrompt.BIOMETRIC_ERROR_NO_BIOMETRICS, BiometricPrompt.BIOMETRIC_ERROR_HW_NOT_PRESENT,
                        BiometricPrompt.BIOMETRIC_ERROR_HW_UNAVAILABLE -> "unsupported"
                        else -> "failed"
                    }
                    call.reject(errString.toString(), code)
                }
            }
            prompt.authenticate(BiometricPrompt.CryptoObject(cipher), CancellationSignal(), activity.mainExecutor, callback)
        }
    }

    // A fresh key on every enable, so turning it on again after a new fingerprint just works. In the
    // phone's StrongBox (a separate secure chip) when it has one, else in the normal Keystore (the TEE).
    // Some StrongBox chips refuse this key (AES-GCM, a fingerprint on every use) with a plain
    // ProviderException rather than StrongBoxUnavailableException: both fall back to the TEE.
    private fun newWrapKey(): SecretKey = try {
        generateWrapKey(strongBox = true)
    } catch (e: StrongBoxUnavailableException) {
        generateWrapKey(strongBox = false)
    } catch (e: java.security.ProviderException) {
        generateWrapKey(strongBox = false)
    }

    private fun generateWrapKey(strongBox: Boolean): SecretKey {
        val spec = KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .setUserAuthenticationRequired(true)
            .setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG) // 0 = a prompt for every use
            .setInvalidatedByBiometricEnrollment(true)
            .setUnlockedDeviceRequired(true) // unusable while the phone is locked
            .setIsStrongBoxBacked(strongBox)
            .build()
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE).run {
            init(spec)
            generateKey()
        }
    }

    private fun forget() {
        blobFile.delete()
        runCatching { keyStore().deleteEntry(KEY_ALIAS) }
    }

    private class Blob(val iv: ByteArray, val wrapped: ByteArray)

    private fun writeBlob(iv: ByteArray, wrapped: ByteArray) {
        val json = JSONObject()
            .put("version", 1)
            .put("iv", Base64.encodeToString(iv, Base64.NO_WRAP))
            .put("wrapped", Base64.encodeToString(wrapped, Base64.NO_WRAP))
        val out = blobFile.startWrite()
        try {
            out.write(json.toString().toByteArray())
            blobFile.finishWrite(out)
        } catch (e: Exception) {
            blobFile.failWrite(out)
            throw GeneralSecurityException("Could not save the fingerprint key", e)
        }
    }

    // null when the file cannot be read as a blob.
    private fun readBlob(): Blob? = runCatching {
        val json = JSONObject(String(blobFile.readFully()))
        Blob(Base64.decode(json.getString("iv"), Base64.NO_WRAP), Base64.decode(json.getString("wrapped"), Base64.NO_WRAP))
    }.getOrNull()

    private fun decodeBase64(value: String) = runCatching { Base64.decode(value, Base64.NO_WRAP) }.getOrNull()

    private fun keyStore() = KeyStore.getInstance(KEYSTORE).apply { load(null) }

    private companion object {
        const val KEYSTORE = "AndroidKeyStore"
        const val KEY_ALIAS = "kapevault-vault-key"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val TAG_BITS = 128
        const val KEY_BYTES = 32
        const val CHANGED = "Fingerprints changed on this phone. Unlock with your master password, then turn fingerprint unlock on again."
    }
}
