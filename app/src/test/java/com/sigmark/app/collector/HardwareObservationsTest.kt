package com.sigmark.app.collector

import com.sigmark.app.model.DeviceSection
import com.sigmark.app.model.DeviceSnapshot
import com.sigmark.app.model.ValueStatus
import org.junit.Assert.*
import org.junit.Test

class HardwareObservationsTest {
    @Test fun stableSummariesDoNotRecordRawReadings() {
        assertEquals("2/1/0/0/1", reportingModes(listOf(0, 1, 0, 17)))
        assertEquals("0/0/0/0/0", reportingModes(emptyList()))
        assertEquals("first / third", codeList("first" to true, "second" to false, "third" to true))
        assertEquals("none", codeList("first" to false))
    }

    @Test fun graphicsEvidenceKeepsCompletedFailureAndAbsentVersionApart() {
        assertEquals("3.2", parseGlesVersion("OpenGL ES 3.2 TEST_DRIVER_PRIVATE_VERSION"))
        assertNull(parseGlesVersion("Vendor arbitrary string"))
        val original = DeviceSnapshot(1L, listOf(DeviceSection("runtime", "runtime", emptyList())))
        val result = graphicsEvidence(original, GraphicsProbe("not_completed", "timeout")).sections.single().items
        assertEquals("not_completed", result[0].value)
        assertEquals(ValueStatus.UNAVAILABLE, result[1].status)
        assertEquals("timeout", result[2].value)
        assertTrue(original.sections.single().items.isEmpty())
    }
}
