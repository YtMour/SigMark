package com.sigmark.app.lan

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class UpdateReleaseTest {
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
