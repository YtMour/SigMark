package com.sigmark.app.collector

import com.sigmark.app.model.ReadReason
import com.sigmark.app.model.ValueStatus
import org.junit.Assert.*
import org.junit.Test

class FrameworkDiagnosticsTest {
    @Test fun archiveDigestUsesCanonicalStableInputs() {
        val a = configurationDigest(listOf("Acme ", "Board"), listOf("arm64-v8a", "armeabi-v7a"))
        val b = configurationDigest(listOf("acme", " board"), listOf("armeabi-v7a", "arm64-v8a", "arm64-v8a"))
        assertEquals(a, b)
        assertTrue(a!!.matches(Regex("v1:[a-f0-9]{64}")))
        assertNotEquals(a, configurationDigest(listOf("Acme", "Board x"), listOf("arm64-v8a", "armeabi-v7a")))
        assertNotEquals(
            configurationDigest(listOf("a", "bc"), listOf("abi")),
            configurationDigest(listOf("ab", "c"), listOf("abi")),
        )
        assertNull(configurationDigest(listOf(null, "unknown"), listOf("arm64-v8a")))
        assertNull(configurationDigest(listOf("Acme"), emptyList()))
    }

    @Test fun estimateRejectsInvalidMemorySamples() {
        assertEquals("75.0%", usagePercent(400, 100))
        assertEquals("100.0%", usagePercent(400, 0))
        assertNull(usagePercent(0, 0))
        assertNull(usagePercent(400, 401))
        assertNull(usagePercent(400, -1))
    }

    @Test fun firstValidCandidateStopsFurtherReads() {
        val result = SafeReader.firstAvailable(
            { SafeReader.missing("missing", ReadReason.NODE_MISSING, "missing") },
            { SafeReader.read("alternate") { "readable" } },
            { fail("must not try a third candidate"); SafeReader.read("unexpected") { "unexpected" } },
        )
        assertEquals("alternate", result.source)
        assertEquals("readable", result.value)
    }

    @Test fun fallbackPreservesDenialAndRetainsOtherSources() {
        val result = SafeReader.firstAvailable(
            { SafeReader.errnoResult<String>("/path/a", 2, 13, 1, 2, 19) },
            { SafeReader.errnoResult("/path/b", 13, 13, 1, 2, 19) },
        )
        assertEquals(ValueStatus.RESTRICTED, result.status)
        assertEquals(13, result.errno)
        assertEquals("/path/b", result.source)
        assertTrue(result.detail!!.contains("/path/a: NODE_MISSING errno=2"))
        assertNull(result.value)
    }

    @Test fun extractsOnlyTheProcessDomain() {
        assertEquals("untrusted_app", SelinuxProbe.processDomain("u:r:untrusted_app:s0:c512,c768\u0000\n"))
        assertNull(SelinuxProbe.processDomain("untrusted_app"))
        assertNull(SelinuxProbe.processDomain("u:r:file/path:s0"))
        for (errno in listOf(2, 13)) {
            val probe = SelinuxProbe.modeResult(SafeReader.errnoResult("/selinux/enforce", errno, 13, 1, 2, 19))
            assertNull(probe.value)
            assertEquals(errno, probe.errno)
            assertTrue(probe.detail!!.contains("本机实时模式未确认"))
        }
    }
}
