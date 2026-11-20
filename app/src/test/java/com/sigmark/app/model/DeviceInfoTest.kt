package com.sigmark.app.model

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class DeviceInfoTest {
    @Test fun normalizationTrimsValues() {
        assertEquals("Pixel 6", normalizeValue("  Pixel 6  "))
    }

    @Test fun normalizationTreatsPlaceholdersAsUnavailable() {
        assertNull(normalizeValue(""))
        assertNull(normalizeValue(" unknown "))
        assertNull(normalizeValue("null"))
    }
}
