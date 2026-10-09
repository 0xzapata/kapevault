package com.brewedops.kapevault

import android.content.Context
import android.content.pm.PackageManager
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest

/**
 * Trust on first use for the apps KAPEVault fills (browsers have TrustedBrowsers instead). A login saved
 * as androidapp://<package> matches by package name, and any app can take any package name when
 * sideloaded, so the first fill into a package records the SHA-256 of its signing certificates; a later
 * request from that package with other signers gets nothing from the vault. The record is hashes of
 * public certificates only (package -> list), in noBackupFilesDir so a backup never carries it to another
 * phone; uninstalling KAPEVault clears it. It cannot tell a first install that already is the imposter.
 *
 * A signer rotation is accepted when the new signing lineage (signingCertificateHistory, signed by the
 * old key) contains every recorded certificate, and the record then moves to the new signers. An app
 * with several signers has no lineage, so only the same set passes.
 */
object AppSigners {
    enum class Trust { NEW, SAME, CHANGED }

    private const val FILE = "autofill-app-signers.json"

    // Every certificate the package is signed with now, and the certificates of its signing lineage.
    internal class Signers(val current: Set<String>, val history: Set<String>)

    // What check() decides: the trust, and the signers the record moves to when the app rotated its key.
    internal class Verdict(val trust: Trust, val moveRecordTo: Set<String>? = null)

    // The whole decision, apart from the PackageManager reads and the record file around it.
    // recorded: the signers saved at the first fill (null: never filled); now: null when unreadable.
    internal fun judge(recorded: Set<String>?, now: Signers?): Verdict {
        if (recorded == null) return Verdict(Trust.NEW)
        // An empty set is a subset of every lineage, so it would vouch for any app that rotated its key.
        // remember() never saves one: it means the file was edited, so nothing was recorded to trust.
        if (now == null || recorded.isEmpty()) return Verdict(Trust.CHANGED)
        if (now.current == recorded) return Verdict(Trust.SAME)
        if (now.history.containsAll(recorded)) return Verdict(Trust.SAME, moveRecordTo = now.current)
        return Verdict(Trust.CHANGED)
    }

    // null when the package reports no signing certificate at all.
    internal fun signersOf(current: List<ByteArray>, history: List<ByteArray>): Signers? =
        if (current.isEmpty()) null else Signers(current.map(::sha256).toSet(), history.map(::sha256).toSet())

    // True when the vault's logins must not be offered to this package: its signers are not the recorded ones.
    // Not for KAPEVault itself or a checked browser. A recorded app whose signers cannot be read also counts.
    fun refuses(context: Context, packageName: String) = !exempt(context, packageName) && check(context, packageName) == Trust.CHANGED

    // Called when a login was filled into this package. Records it only the first time.
    @Synchronized
    fun remember(context: Context, packageName: String) {
        if (exempt(context, packageName)) return
        val records = load(context)
        if (packageName in records) return
        val now = read(context.packageManager, packageName) ?: return
        save(context, records.toMutableMap().also { it[packageName] = now.current })
    }

    @Synchronized
    private fun check(context: Context, packageName: String): Trust {
        val records = load(context)
        val recorded = records[packageName] ?: return Trust.NEW
        val verdict = judge(recorded, read(context.packageManager, packageName))
        verdict.moveRecordTo?.let { moved -> save(context, records.toMutableMap().also { it[packageName] = moved }) }
        return verdict.trust
    }

    private fun exempt(context: Context, packageName: String) =
        packageName == context.packageName || TrustedBrowsers.isTrusted(context.packageManager, packageName)

    // null when the package is not installed, or not visible to us.
    @Suppress("DEPRECATION") // the flags overload that takes PackageInfoFlags is API 33; this app starts at 30
    private fun read(pm: PackageManager, packageName: String): Signers? {
        val info = try {
            pm.getPackageInfo(packageName, PackageManager.GET_SIGNING_CERTIFICATES)
        } catch (e: PackageManager.NameNotFoundException) {
            return null
        }
        val signing = info.signingInfo ?: return null
        val history = if (signing.hasMultipleSigners()) emptyList() else signing.signingCertificateHistory.orEmpty().map { it.toByteArray() }
        return signersOf(signing.apkContentsSigners.map { it.toByteArray() }, history)
    }

    private fun sha256(bytes: ByteArray) = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

    // A missing or unreadable file is an empty record (only this app writes it).
    private fun load(context: Context): Map<String, Set<String>> = try {
        val json = JSONObject(File(context.noBackupFilesDir, FILE).readText())
        json.keys().asSequence().associateWith { key -> json.getJSONArray(key).let { a -> (0 until a.length()).map { a.getString(it) }.toSet() } }
    } catch (e: Exception) {
        emptyMap()
    }

    private fun save(context: Context, records: Map<String, Set<String>>) {
        val json = JSONObject()
        for ((pkg, hashes) in records) json.put(pkg, JSONArray(hashes.toList()))
        val file = File(context.noBackupFilesDir, FILE)
        val temp = File(context.noBackupFilesDir, "$FILE.tmp")
        temp.writeText(json.toString())
        temp.renameTo(file)
    }
}
