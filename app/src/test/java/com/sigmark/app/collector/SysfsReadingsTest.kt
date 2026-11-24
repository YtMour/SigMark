package com.sigmark.app.collector

import com.sigmark.app.model.ReadReason
import com.sigmark.app.model.ValueStatus
import org.junit.Assert.*
import org.junit.Test

class SysfsReadingsTest {
    @Test fun batteryTemperatureFallsBackToBmsWhenPrimaryIsDenied() {
        val field = SysfsField.BATTERY_TEMP
        var reads = 0
        val result = readSysfs(field, 34) { node ->
            reads++
            if (node == field.node) ReadResult(null, ValueStatus.RESTRICTED, node.path, errno = 13)
            else ReadResult("315\n", ValueStatus.AVAILABLE, node.path)
        }
        assertEquals(2, reads)
        assertEquals("315", result.value)
        assertEquals(field.fallback!!.path, result.source)
        assertTrue(result.detail!!.contains(field.fallback!!.path))
    }

    @Test fun batteryTemperatureKeepsPrimaryDenialWhenBothCandidatesFail() {
        val field = SysfsField.BATTERY_TEMP
        val result = readSysfs(field, 34) { node ->
            ReadResult(null, ValueStatus.RESTRICTED, node.path, reason = ReadReason.ACCESS_DENIED, errno = 13)
        }
        assertEquals(ValueStatus.RESTRICTED, result.status)
        assertEquals(ReadReason.ACCESS_DENIED, result.reason)
        assertEquals(field.node.path, result.source)
        assertTrue(result.detail!!.contains(field.fallback!!.path))
        assertEquals(ReadReason.INTERFACE_UNSUPPORTED, readSysfs(field, 25) { error("must not read") }.reason)
    }
}
