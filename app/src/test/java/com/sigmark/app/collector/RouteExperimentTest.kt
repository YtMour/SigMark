package com.sigmark.app.collector

import com.sigmark.app.lan.lanParameters
import com.sigmark.app.model.DeviceSection
import com.sigmark.app.model.DeviceSnapshot
import org.junit.Assert.*
import org.junit.Test

class RouteExperimentTest {
    private val sample = DeviceSnapshot(100, listOf(DeviceSection("network", "Network", emptyList())))
    @Test fun routePointsPreserveUnknownAndUseMilliseconds() {
        val check = RouteCheck(RoutePoint(10,"wifi",true),RoutePoint(1210,"cellular",null))
        val fields = lanParameters(routeEvidence(sample,check)).associateBy { it.key }
        assertEquals("wifi",fields.getValue("checkStartTransport").value)
        assertEquals("cellular",fields.getValue("checkEndTransport").value)
        assertEquals("yes",fields.getValue("checkStartValidated").value)
        assertEquals("UNAVAILABLE",fields.getValue("checkEndValidated").status)
        assertEquals("1200 ms",fields.getValue("checkElapsed").value)
    }

    @Test fun reversedOrExpiredPointHasNoInterval() {
        for (elapsed in listOf(-1L,600_001L)) {
            val check = RouteCheck(RoutePoint(10,"wifi",true),RoutePoint(10+elapsed,null,null))
            val fields = lanParameters(routeEvidence(sample,check)).associateBy { it.key }
            assertNull(fields.getValue("checkElapsed").value)
        }
    }
}
