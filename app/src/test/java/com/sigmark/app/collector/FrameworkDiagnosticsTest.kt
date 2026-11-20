package com.sigmark.app.collector

import com.sigmark.app.model.ReadReason
import com.sigmark.app.model.ValueStatus
import org.junit.Assert.*
import org.junit.Test

class FrameworkDiagnosticsTest {
    @org.junit.Test fun readableBootPropertyDoesNotCarryMissingNote() {
        val available = SafeReader.readPropertyValue("getprop fixture") { "green" }
        org.junit.Assert.assertEquals("green", available.value)
        org.junit.Assert.assertNull(available.detail)
        val empty = SafeReader.readPropertyValue("getprop fixture") { "" }
        org.junit.Assert.assertEquals(com.sigmark.app.model.ReadReason.NOT_REPORTED, empty.reason)
        org.junit.Assert.assertNotNull(empty.detail)
    }
    @Test fun estimatesEnergyFromIndependentReadings() {
        assertEquals(7.6, estimateEnergyWh(2_000_000, 3800)!!, 0.0001)
        assertNull(estimateEnergyWh(Int.MIN_VALUE, 3800))
        assertNull(estimateEnergyWh(2_000_000, 0))
    }
    @Test fun derivesBuildTypeWithoutTreatingTagsAsDebugFlag() {
        assertEquals("user / test-keys（标准量产构建类型）", buildVariantSummary("user", "test-keys"))
        assertEquals("userdebug / release-keys（标准调试构建类型）", buildVariantSummary("USERDEBUG", "release-keys"))
        assertEquals("eng（标准调试构建类型）", buildVariantSummary("eng", null))
        assertEquals("custom（自定义构建类型）", buildVariantSummary("custom", null))
        assertNull(buildVariantSummary("unknown", "test-keys"))
    }

    @Test fun distinguishesBatterySentinelAndInvalidValueFromZero() {
        val energy = 0L..Long.MAX_VALUE
        assertEquals(ReadReason.INTERFACE_UNSUPPORTED, batteryReadingReason(Long.MIN_VALUE, Long.MIN_VALUE, energy))
        assertEquals(ReadReason.INVALID_VALUE, batteryReadingReason(-1, Long.MIN_VALUE, energy))
        assertNull(batteryReadingReason(0, Long.MIN_VALUE, energy))
        val current = -30_000_000L..30_000_000L
        assertEquals(ReadReason.INTERFACE_UNSUPPORTED, batteryReadingReason(Int.MIN_VALUE.toLong(), Int.MIN_VALUE.toLong(), current))
        assertNull(batteryReadingReason(-1200, Int.MIN_VALUE.toLong(), current))
    }

    @Test fun qualifiedMissingPreservesRestrictionAndErrno() {
        val denied = SafeReader.errnoResult<String>("/selinux/enforce", 13, 13, 1, 2, 19)
        assertEquals(denied, denied.explainMissing(ReadReason.OPTIONAL_UNSET, "optional"))
        val missing = SafeReader.read<String>("Build.VERSION.BASE_OS") { null }
        assertEquals(ReadReason.OPTIONAL_UNSET, missing.explainMissing(ReadReason.OPTIONAL_UNSET, "optional").reason)
    }
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
