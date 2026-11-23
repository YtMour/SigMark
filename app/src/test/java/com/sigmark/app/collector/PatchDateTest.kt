package com.sigmark.app.collector

import org.junit.Assert.*
import org.junit.Test

class PatchDateTest {
    @Test fun acceptsOnlyValidDates() {
        assertEquals("2020-12-01", patchDate(" 2020-12-01 "))
        assertEquals("2024-02-29", patchDate("2024-02-29"))
        assertNull(patchDate("2023-02-29"))
        assertNull(patchDate("2020-2-1"))
        assertNull(patchDate("unknown"))
    }
}
