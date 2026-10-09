package com.brewedops.kapevault

import android.system.ErrnoException
import android.system.Os
import android.system.OsConstants
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.nio.file.Files
import java.nio.file.StandardCopyOption

/**
 * Saves a file in the app's private files folder so a power cut leaves the old file or the new one,
 * never neither. @capacitor/filesystem cannot: its writeFile never syncs to flash, and its rename deletes
 * the target before renaming (ionfilesystem-android 1.1.0, IONFILELocalFilesHelper saveFile / renameFile),
 * so a battery pull could leave the vault empty or gone. Here the text is written to "<name>.tmp",
 * synced to flash, and moved over the target in one atomic rename; the folder is then synced so the
 * rename itself survives. Reads stay with @capacitor/filesystem.
 */
@CapacitorPlugin(name = "DurableFile")
class DurableFilePlugin : Plugin() {
    @PluginMethod
    fun replace(call: PluginCall) {
        val name = call.getString("name") ?: return call.reject("name is missing.")
        val text = call.getString("text") ?: return call.reject("text is missing.")
        val dir = context.filesDir
        if (!isPlainName(name)) return call.reject("Not a file in the app's folder.")
        try {
            replaceFile(dir, name, text)
            call.resolve()
        } catch (e: IOException) {
            call.reject("The file could not be saved.", e)
        }
    }

    companion object {
        // One file name, nothing else: no folder parts, no "..", no absolute path from the page.
        fun isPlainName(name: String) =
            name.isNotEmpty() && name != "." && name != ".." && name.none { it == '/' || it == '\\' || it == '\u0000' }

        fun replaceFile(dir: File, name: String, text: String) {
            val tmp = File(dir, "$name.tmp")
            val target = File(dir, name)
            FileOutputStream(tmp).use { out ->
                out.write(text.toByteArray(Charsets.UTF_8))
                out.fd.sync()
            }
            Files.move(tmp.toPath(), target.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
            syncFolder(dir)
        }

        // The rename lives in the folder's entry, not the file: sync that too. Best effort - the new file
        // is already whole on flash, so a filesystem that refuses to sync a folder costs only the last
        // rename on a power cut (the old file is then still there), never a damaged file.
        private fun syncFolder(dir: File) {
            try {
                val fd = Os.open(dir.path, OsConstants.O_RDONLY, 0)
                try {
                    Os.fsync(fd)
                } finally {
                    Os.close(fd)
                }
            } catch (_: ErrnoException) {
            }
        }
    }
}
