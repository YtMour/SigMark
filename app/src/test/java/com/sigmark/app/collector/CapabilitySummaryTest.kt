package com.sigmark.app.collector

import org.junit.Assert.*
import org.junit.Test

class CapabilitySummaryTest {
    @Test fun decodesDeclaredVulkanVersion() {
        assertEquals("1.1.0", vulkanVersion(4198400))
        assertEquals("1.3.275", vulkanVersion((1 shl 22) or (3 shl 12) or 275))
        assertNull(vulkanVersion(0))
    }

    @Test fun preservesIncompleteCameraReadsAndProducesStableGroups() {
        val rows = listOf("前置" to "LIMITED", "后置" to "FULL", "后置" to "FULL", null)
        val summary = requireNotNull(cameraCapabilitySummary(rows))
        assertEquals(summary, cameraCapabilitySummary(rows.reversed()))
        assertTrue(summary.contains("后置/FULL ×2"))
        assertTrue(summary.contains("未读到 1 项"))
        assertNull(cameraCapabilitySummary(listOf(null)))
        assertEquals("无公开摄像头", cameraCapabilitySummary(emptyList()))
    }

    @Test fun aggregatesSensorTypesWithoutVendorIds() {
        assertEquals("1:2/1 · 4:1/0 · 其他 1 项",
            sensorTypeWakeupSummary(listOf(4 to false,1 to true,1 to false,65001 to true)))
        assertTrue(sensorTypeWakeupSummary((1..25).map { it to false }).contains("另有 1 类"))
    }
}
