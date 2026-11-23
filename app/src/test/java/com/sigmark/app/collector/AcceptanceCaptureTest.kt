package com.sigmark.app.collector

import com.sigmark.app.CollectionAccess
import com.sigmark.app.lan.lanParameters
import com.sigmark.app.model.DeviceSection
import com.sigmark.app.model.DeviceSnapshot
import com.sigmark.app.model.ValueStatus
import org.junit.Assert.*
import org.junit.Test

class AcceptanceCaptureTest {
    private val snapshot = DeviceSnapshot(1, listOf(
        DeviceSection("environment","Env", collectionContext(CollectionAccess(false, false, true, null))),
        DeviceSection("media","Media", emptyList()),
    ))

    @Test fun preservesUnknownSwitchAndApproximateAuthorization() {
        val fields = lanParameters(snapshot).associateBy { it.key }
        assertEquals("approximate", fields.getValue("captureLocationAccess").value)
        assertEquals("not_granted", fields.getValue("capturePhoneAccess").value)
        assertEquals("UNAVAILABLE", fields.getValue("captureLocationSwitch").status)
        assertNull(fields.getValue("captureLocationSwitch").value)
    }

    @Test fun storesARealFailureWithoutConfusingItWithNotRun() {
        val network = acceptanceEvidence(snapshot, CapturePlan.NETWORK, null)
        assertFalse(lanParameters(network).any { it.key == "avcFirstFrame" })
        val decoded = DecodeResult(DecodeStage.CONFIGURE, 3, "codec.test", null, 34, "Test")
        val rom = acceptanceEvidence(snapshot, CapturePlan.ROM, decoded)
        val fields = lanParameters(rom).associateBy { it.key }
        assertEquals("fail", fields.getValue("avcFirstFrame").value)
        assertEquals(ValueStatus.AVAILABLE.name, fields.getValue("avcFirstFrame").status)
        assertEquals("configure", fields.getValue("avcStage").value)
        assertEquals("34 ms", fields.getValue("avcElapsed").value)
    }
}
