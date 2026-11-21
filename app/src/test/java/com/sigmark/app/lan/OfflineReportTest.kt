package com.sigmark.app.lan

import com.sigmark.app.collector.canReadDataRat
import com.sigmark.app.keyProtectionExplanation
import com.sigmark.app.model.*
import org.junit.Assert.*
import org.junit.Test

class OfflineReportTest {
    @Test fun switchingNetworksCreatesSeparateCapturedReports() {
        fun capture(t: Long, name: String) = lanReport(DeviceSnapshot(t,listOf(DeviceSection("network","网络",listOf(DeviceInfoItem("transport","网络",name,"test"))))),"0.18.2", "")
        val first = SampleUpload(capture(1,"蜂窝网络"),false)
        val later = capture(2,"Wi-Fi")
        assertEquals("移动网络",networkLabel(first.begin()!!.report.network))
        assertEquals(1L,first.report.capturedAt)
        assertEquals("Wi-Fi",networkLabel(later.network))
        assertNotEquals(first.report.requestId,later.requestId)
    }
    @Test fun phonePermissionMattersOnOlderSupportedAndroid() {
        assertFalse(canReadDataRat(29,false)); assertTrue(canReadDataRat(29,true)); assertTrue(canReadDataRat(33,false))
    }
    @Test fun keyExplanationNeverConfusesMissingEvidenceWithHardwareProtection() {
        assertTrue(keyProtectionExplanation(null).contains("尚未确认")); assertTrue(keyProtectionExplanation("future").contains("尚未确认"))
        assertTrue(keyProtectionExplanation("TEE").contains("这把测试密钥")); assertTrue(keyProtectionExplanation("Software").contains("软件保护"))
    }
}
