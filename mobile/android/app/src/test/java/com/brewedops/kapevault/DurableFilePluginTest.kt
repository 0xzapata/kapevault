package com.brewedops.kapevault

import com.brewedops.kapevault.DurableFilePlugin.Companion.isPlainName
import com.brewedops.kapevault.DurableFilePlugin.Companion.replaceFile
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class DurableFilePluginTest {
    @get:Rule
    val folder = TemporaryFolder()

    @Test
    fun `a plain file name is accepted`() {
        assertTrue(isPlainName("vault.kapevault"))
        assertTrue(isPlainName("settings.json"))
    }

    @Test
    fun `anything that is not one file name is refused`() {
        for (name in listOf("", ".", "..", "a/b", "a\\b", "a\u0000b", "../x", "/abs", "..\\x")) {
            assertFalse("accepted ${name.replace("\u0000", "NUL")}", isPlainName(name))
        }
    }

    @Test
    fun `replaceFile writes the text and leaves no temp file`() {
        replaceFile(folder.root, "vault.kapevault", "héllo")
        assertEquals("héllo", File(folder.root, "vault.kapevault").readText())
        assertEquals(listOf("vault.kapevault"), folder.root.list()!!.toList())
    }

    @Test
    fun `replaceFile replaces an existing file`() {
        File(folder.root, "vault.kapevault").writeText("old")
        replaceFile(folder.root, "vault.kapevault", "new")
        assertEquals("new", File(folder.root, "vault.kapevault").readText())
    }

    @Test
    fun `a temp file left by a crash is overwritten, not appended to`() {
        File(folder.root, "vault.kapevault.tmp").writeText("half-written garbage that is longer than the new text")
        replaceFile(folder.root, "vault.kapevault", "new")
        assertEquals("new", File(folder.root, "vault.kapevault").readText())
        assertFalse(File(folder.root, "vault.kapevault.tmp").exists())
    }
}
