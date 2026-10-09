package com.brewedops.kapevault

import com.brewedops.kapevault.AppSigners.Signers
import com.brewedops.kapevault.AppSigners.Trust
import com.brewedops.kapevault.AppSigners.judge
import com.brewedops.kapevault.AppSigners.signersOf
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

// AppSigners decides whether an app that asks for logins is still the app KAPEVault first filled. Its
// decision is judge(); the PackageManager reads around it need a phone and are proven on the emulator.
class AppSignersTest {
    private val old = setOf("aa")
    private val new = setOf("bb")

    @Test
    fun `a package never filled before is NEW and has nothing to record yet`() {
        val verdict = judge(recorded = null, now = Signers(old, emptySet()))
        assertEquals(Trust.NEW, verdict.trust)
        assertNull(verdict.moveRecordTo)
    }

    @Test
    fun `the same signers are SAME`() {
        val verdict = judge(recorded = old, now = Signers(old, emptySet()))
        assertEquals(Trust.SAME, verdict.trust)
        assertNull(verdict.moveRecordTo)
    }

    @Test
    fun `changed signers with no lineage are CHANGED`() {
        val verdict = judge(recorded = old, now = Signers(new, emptySet()))
        assertEquals(Trust.CHANGED, verdict.trust)
        assertNull(verdict.moveRecordTo)
    }

    @Test
    fun `a lineage that still holds the recorded certificate is a rotation, and the record moves on`() {
        val verdict = judge(recorded = old, now = Signers(new, history = old + new))
        assertEquals(Trust.SAME, verdict.trust)
        assertEquals(new, verdict.moveRecordTo)
    }

    @Test
    fun `a lineage must hold every recorded certificate, not just one`() {
        val verdict = judge(recorded = setOf("aa", "cc"), now = Signers(new, history = setOf("aa", "bb")))
        assertEquals(Trust.CHANGED, verdict.trust)
        assertNull(verdict.moveRecordTo)
    }

    @Test
    fun `a lineage of other certificates does not vouch for the app`() {
        val verdict = judge(recorded = old, now = Signers(new, history = setOf("dd", "bb")))
        assertEquals(Trust.CHANGED, verdict.trust)
    }

    @Test
    fun `several signers carry no lineage, so only the same set passes`() {
        val recorded = setOf("aa", "bb")
        assertEquals(Trust.SAME, judge(recorded, Signers(setOf("aa", "bb"), emptySet())).trust)
        assertEquals(Trust.CHANGED, judge(recorded, Signers(setOf("aa", "cc"), emptySet())).trust)
        assertEquals(Trust.CHANGED, judge(old, Signers(setOf("aa", "bb"), emptySet())).trust)
    }

    @Test
    fun `an empty recorded set is no record at all, so it refuses instead of vouching for any rotated app`() {
        // Only a hand-edited file in noBackupFilesDir holds [] (remember() never saves one). An empty set is
        // a subset of every lineage, so without this guard any app that rotated its key would pass.
        val verdict = judge(recorded = emptySet(), now = Signers(new, history = old + new))
        assertEquals(Trust.CHANGED, verdict.trust)
        assertNull(verdict.moveRecordTo)
    }

    @Test
    fun `a recorded package whose signers cannot be read is CHANGED`() {
        val verdict = judge(recorded = old, now = null)
        assertEquals(Trust.CHANGED, verdict.trust)
        assertNull(verdict.moveRecordTo)
    }

    @Test
    fun `an unrecorded package whose signers cannot be read is still NEW`() {
        assertEquals(Trust.NEW, judge(recorded = null, now = null).trust)
    }

    @Test
    fun `a package that reports no signing certificate has no signers`() {
        assertNull(signersOf(current = emptyList(), history = listOf(byteArrayOf(1))))
    }

    @Test
    fun `signers are the SHA-256 of each certificate, as lower-case hex`() {
        val signers = signersOf(current = listOf("abc".toByteArray()), history = listOf("abc".toByteArray(), "".toByteArray()))!!
        val abc = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        val empty = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        assertEquals(setOf(abc), signers.current)
        assertEquals(setOf(abc, empty), signers.history)
    }
}
