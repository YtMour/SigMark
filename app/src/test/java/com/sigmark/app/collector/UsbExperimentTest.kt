package com.sigmark.app.collector

import com.sigmark.app.model.DeviceSection
import com.sigmark.app.model.DeviceSnapshot
import com.sigmark.app.model.ValueStatus
import org.junit.Assert.*
import org.junit.Test

class UsbExperimentTest {
    @Test fun classifyOnlyObservableCountDifferences() {
        assertEquals("no_change",usbOutcome(0,0))
        assertEquals("increase",usbOutcome(0,1))
        assertEquals("decrease",usbOutcome(4,1))
        assertEquals("incomplete",usbOutcome(null,1))
    }

    @Test fun wallClockSkewDoesNotBecomeDurationAndExpiredResultsAreIncomplete() {
        val snapshot=DeviceSnapshot(0,listOf(DeviceSection("runtime","runtime",emptyList())))
        fun point(wall:Long,mono:Long,count:Int) = UsbPoint(ProbeTime(wall,mono),ReadResult(count,ValueStatus.AVAILABLE,"fixture"))
        val a=point(1700000004000,3000,0)
        val out=usbEvidence(snapshot,UsbCheck(a,point(1700000000000,3500,1))).sections.single().items.associateBy {it.key}
        assertEquals("500 ms",out.getValue("usbElapsed").value)
        assertEquals("increase",out.getValue("usbOutcome").value)
        assertEquals("1700000000000",out.getValue("usbEndAt").value)
        val old=usbEvidence(snapshot,UsbCheck(a,point(1700000240000,123001,1))).sections.single().items.associateBy {it.key}
        assertEquals("incomplete",old.getValue("usbOutcome").value)
        assertNull(old.getValue("usbElapsed").value)
    }
}
