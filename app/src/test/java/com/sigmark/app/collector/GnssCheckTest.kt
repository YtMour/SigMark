package com.sigmark.app.collector

import com.sigmark.app.CollectionAccess
import com.sigmark.app.lan.lanParameters
import com.sigmark.app.model.DeviceInfoItem
import com.sigmark.app.model.DeviceSection
import com.sigmark.app.model.DeviceSnapshot
import com.sigmark.app.model.ReadReason
import com.sigmark.app.model.ValueStatus
import org.junit.Assert.*
import org.junit.Test

class GnssCheckTest {
    @Test fun yearSentinelAndOddValuesAreSemanticNotMissing() {
        assertEquals(GnssYearQuality.BEFORE_2016, gnssYearQuality(0,2026))
        assertEquals(GnssYearQuality.REPORTED, gnssYearQuality(2016,2026))
        assertEquals(GnssYearQuality.BELOW_MIN, gnssYearQuality(2015,2026))
        assertEquals(GnssYearQuality.BELOW_MIN, gnssYearQuality(-1,2026))
        assertEquals(GnssYearQuality.FUTURE, gnssYearQuality(2027,2026))
        assertEquals(GnssYearQuality.REPORTED, gnssYearQuality(2026,2026))
        assertEquals(GnssYearQuality.CLOCK_UNKNOWN, gnssYearQuality(2016,null))
    }

    @Test fun prerequisitesSeparatePermissionLocationAndProvider() {
        val fine = CollectionAccess(false,true,true,true)
        assertEquals(GnssPrerequisite.READY,gnssPrerequisite(fine,true))
        assertEquals(GnssPrerequisite.PERMISSION,gnssPrerequisite(fine.copy(fine=false),true))
        assertEquals(GnssPrerequisite.LOCATION_OFF,gnssPrerequisite(fine.copy(location=false),true))
        assertEquals(GnssPrerequisite.LOCATION_UNKNOWN,gnssPrerequisite(fine,null))
        assertEquals(GnssPrerequisite.NO_PROVIDER,gnssPrerequisite(fine,false))
    }

    @Test fun onlyNonEmptyEventsAreFunctionalEvidence() {
        val evidence=GnssCallbackEvidence()
        evidence.satellites(false)
        evidence.measurements(false)
        assertFalse(evidence.hasStatus)
        assertFalse(evidence.hasMeasurements)
        evidence.measurements(true)
        assertFalse(evidence.complete)
        evidence.satellites(true)
        evidence.measurements(false)
        assertTrue(evidence.complete)
    }

    @Test fun frozenReportKeepsZeroAndBlockedSourceButNotPrivateModelOrRawEvents() {
        val stamp=1700000000000L
        val snap=DeviceSnapshot(stamp,listOf(DeviceSection("system","系统",listOf(
            DeviceInfoItem("gnssHardwareYear",gnssYearLabel,"0",gnssYearSource),
            DeviceInfoItem("gnssHardwareModel","name","private OEM name","LocationManager"),
            DeviceInfoItem("gnssRawMeasurement","raw","private event","callback"),
        ))))
        val check=GnssCheck(ProbeTime(stamp,1),ProbeTime(stamp+5,6),GnssPrerequisite.PERMISSION,
            ReadResult(null,ValueStatus.RESTRICTED,"status callback",reason=ReadReason.PERMISSION_REQUIRED),
            ReadResult(null,ValueStatus.RESTRICTED,"measurements callback",reason=ReadReason.PERMISSION_REQUIRED))
        val rows=lanParameters(gnssEvidence(snap,check)).associateBy { it.key }
        assertEquals(gnssCheckKeys+"gnssHardwareYear",rows.keys)
        assertEquals("0",rows.getValue("gnssHardwareYear").value)
        assertEquals("5 ms",rows.getValue("gnssCheckElapsed").value)
        assertEquals("PERMISSION_REQUIRED",rows.getValue("gnssCheckStatus").reason)
        assertEquals("measurements callback",rows.getValue("gnssCheckMeasurements").source)
    }
}
