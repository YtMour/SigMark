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
}
