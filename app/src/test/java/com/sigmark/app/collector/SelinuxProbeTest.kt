package com.sigmark.app.collector

import com.sigmark.app.model.ReadReason
import com.sigmark.app.model.ValueStatus
import org.junit.Assert.*
import org.junit.Test

class SelinuxProbeTest {
    @Test fun onlyDirectStandardValuesConfirmMode() {
        assertTrue(SelinuxProbe.decodeMode("1\n")!!.first.startsWith("Enforcing"))
        assertTrue(SelinuxProbe.decodeMode("0")!!.first.startsWith("Permissive"))
        for (value in listOf("", "disabled", "10", "1 0")) assertNull(SelinuxProbe.decodeMode(value))
    }

    @Test fun distinguishesDeniedMissingAndOtherErrors() {
        fun classify(errno: Int) = SafeReader.errnoResult<String>("/sys/fs/selinux/enforce", errno, 13, 1, 2, 19)
        assertEquals(ValueStatus.RESTRICTED, classify(13).status)
        assertTrue(classify(13).detail!!.contains("EACCES"))
        assertEquals(ReadReason.ACCESS_DENIED, classify(1).reason)
        assertEquals(ValueStatus.UNAVAILABLE, classify(2).status)
        assertEquals(ReadReason.NODE_MISSING, classify(2).reason)
        assertEquals(ValueStatus.UNAVAILABLE, classify(19).status)
        assertEquals(ValueStatus.ERROR, classify(5).status)
    }

    @Test fun metadataSurvivesFailedTransform() {
        val input = SafeReader.errnoResult<String>("/proc/cpuinfo", 13, 13, 1, 2, 19)
        val output = input.map { error("restricted input should not be parsed") }
        assertEquals(input.source, output.source)
        assertEquals(input.errno, output.errno)
        assertEquals(input.status, output.status)
        assertNull(SafeReader.read("test") { "unknown" }.value)
    }

    @Test fun infersModeOnlyWhenDacWouldAllowTheRead() {
        fun denied() = SafeReader.errnoResult<String>("/sys/fs/selinux/enforce", 13, 13, 1, 2, 19)
        val directoryAllowsOther = 0x1ED // 0755
        val fileAllowsOtherRead = 0x1A4 // 0644

        val inferred = selinuxVerdict(denied(), directoryAllowsOther, fileAllowsOtherRead)
        assertEquals("Enforcing（强制模式，推断）", inferred.mode.value)
        assertEquals(ValueStatus.AVAILABLE, inferred.mode.status)
        assertTrue(inferred.mode.detail!!.contains("只可能被 SELinux 策略拒绝"))
        assertEquals("inferred_mac", inferred.evidence.value)
        assertEquals("/sys/fs/selinux/enforce", inferred.evidence.source)

        for ((dirMode, fileMode) in listOf(0x1C0 to fileAllowsOtherRead, directoryAllowsOther to 0x180,
            null to fileAllowsOtherRead, directoryAllowsOther to null)) {
            assertFalse(dacAllowsOtherRead(dirMode, fileMode))
            val unconfirmed = selinuxVerdict(denied(), dirMode, fileMode)
            assertNull(unconfirmed.mode.value)
            assertEquals(ValueStatus.RESTRICTED, unconfirmed.mode.status)
            assertEquals(ReadReason.ACCESS_DENIED, unconfirmed.mode.reason)
            assertNull(unconfirmed.evidence.value)
            assertEquals(ValueStatus.UNAVAILABLE, unconfirmed.evidence.status)
            assertEquals(ReadReason.INVALID_VALUE, unconfirmed.evidence.reason)
        }
        assertTrue(dacAllowsOtherRead(directoryAllowsOther, fileAllowsOtherRead))

        val disabled = selinuxVerdict(
            SafeReader.errnoResult("/sys/fs/selinux/enforce", 2, 13, 1, 2, 19), null, null)
        assertEquals("未启用（推断）", disabled.mode.value)
        assertEquals("inferred_disabled", disabled.evidence.value)

        val enforcing = selinuxVerdict(SafeReader.read("fixture") { "1" }, null, null)
        assertEquals("Enforcing（强制模式）", enforcing.mode.value)
        assertEquals("exact", enforcing.evidence.value)
        assertFalse(enforcing.mode.value!!.contains("推断"))

        val permissive = selinuxVerdict(SafeReader.read("fixture") { "0" }, null, null)
        assertEquals("Permissive（宽容模式）", permissive.mode.value)
        assertEquals("exact", permissive.evidence.value)

        val unexpected = selinuxVerdict(
            SafeReader.errnoResult("/sys/fs/selinux/enforce", 5, 13, 1, 2, 19), null, null)
        assertEquals(ValueStatus.ERROR, unexpected.mode.status)
        assertEquals(ReadReason.INVALID_VALUE, unexpected.evidence.reason)
        assertNull(unexpected.evidence.value)
    }
}
