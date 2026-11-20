package com.sigmark.app.lan

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class UpdateReleaseTest {
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
