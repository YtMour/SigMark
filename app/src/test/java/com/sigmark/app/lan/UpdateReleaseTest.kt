package com.sigmark.app.lan

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class UpdateReleaseTest {
    @Test fun updateDecisionUsesActualInstalledCode() {
        val published=UpdateRelease("1.4.1",31,4096,"a".repeat(64))
        org.junit.Assert.assertEquals(UpdateAvailability.AVAILABLE,updateAvailability(InstalledUpdateVersion("7.0.0",30),published))
        org.junit.Assert.assertEquals(UpdateAvailability.CURRENT,updateAvailability(InstalledUpdateVersion("1.4.1",31),published))
        org.junit.Assert.assertEquals(UpdateAvailability.AHEAD,updateAvailability(InstalledUpdateVersion("0.9.0",32),published))
        org.junit.Assert.assertFalse(published.copy(name="...").isValid())
        org.junit.Assert.assertFalse(published.copy(code=2_100_000_001L).isValid())
    }
    @Test fun verifiesKnownCertificatesAndDefersMissingRomData() {
        org.junit.Assert.assertEquals(UpdateSigners.MATCH, compareUpdateSigners(setOf("A"), setOf("A")))
        org.junit.Assert.assertEquals(UpdateSigners.MISMATCH, compareUpdateSigners(setOf("A"), setOf("B")))
        org.junit.Assert.assertEquals(UpdateSigners.SYSTEM_CHECK, compareUpdateSigners(setOf("A"), emptySet()))
    }
    @Test fun validatesUntrustedReleaseMetadata() {
        val valid = UpdateRelease("0.9.0", 9, 4096, "a".repeat(64))
        assertTrue(valid.isValid())
        assertFalse(valid.copy(code = 0).isValid())
        assertFalse(valid.copy(size = MaxUpdateBytes + 1).isValid())
        assertFalse(valid.copy(size = 0).isValid())
        assertFalse(valid.copy(sha256 = "missing").isValid())
        assertFalse(valid.copy(name = "x".repeat(32)).isValid())
    }
}
