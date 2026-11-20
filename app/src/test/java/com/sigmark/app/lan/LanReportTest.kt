package com.sigmark.app.lan

import com.sigmark.app.model.DeviceInfoItem
import com.sigmark.app.model.DeviceSection
import com.sigmark.app.model.DeviceSnapshot
import com.sigmark.app.model.ReadReason
import com.sigmark.app.model.ValueStatus
import org.junit.Assert.*
import org.junit.Test

class LanReportTest {
    @Test fun endpointRequiresPrivateNumericHostAndPort() {
        assertEquals("http://192.168.1.10:48271/api/v1/reports", lanEndpoint("http://192.168.1.10:48271/").toString())
        assertNotNull(lanEndpoint("http://127.0.0.1:48271"))
        for (bad in listOf("http://example.com:48271", "http://8.8.8.8:123", "http://0177.0.0.1:123",
            "http://192.168.1.1", "http://x@192.168.1.1:123", "http://192.168.1.1:123/other",
            "http://192.168.1.1:123?redirect=1", "https://192.168.1.1:123", "http://172.32.0.1:123")) assertNull(bad,lanEndpoint(bad))
    }

    @Test fun projectionDropsRawAndLocationRelatedValues() {
        fun field(key: String, value: String) = DeviceInfoItem(key,key,value,"sample")
        val snapshot = DeviceSnapshot(1800000000000, listOf(
            DeviceSection("system","system",listOf(field("model","Synthetic"),field("api","34"),field("fingerprint","raw-id"))),
            DeviceSection("network","net",listOf(field("transport","Wi-Fi + VPN"),field("wifiBandChannel","5 GHz / 信道 149"),field("wifiFrequency","5745 MHz"))),
            DeviceSection("cellular","mobile",listOf(field("operator","private-operator"),field("dataRat","LTE (4G)"),
                DeviceInfoItem("cellDiagnostics","radio",null,"app",ValueStatus.RESTRICTED,"localized info",ReadReason.PERMISSION_REQUIRED))),
        ))
        val report = lanReport(snapshot,"0.3.0", "")
        assertEquals("vpn",report.network)
        assertEquals("5",report.wifiBand)
        assertEquals("lte",report.radio)
        assertEquals(setOf("network.wifiFrequency","cellular.dataRat","cellular.cellDiagnostics"),report.metrics.map { it.key }.toSet())
        assertEquals("5745 MHz", report.parameters.single { it.key == "wifiFrequency" }.value)
        for (private in listOf("raw-id","private-operator")) assertFalse(report.toString().contains(private))
        assertTrue(validFeedback("a".repeat(300)))
        assertFalse(validFeedback("a".repeat(301)))
        assertFalse(validFeedback("\n"))
    }

    @Test fun detailedProjectionKeepsErrnoButExcludesExactCellChannels() {
        val snapshot = DeviceSnapshot(1800000000000, listOf(
            DeviceSection("system","system", listOf(DeviceInfoItem("selinux","SELinux",null,"/sys/fs/selinux/enforce",
                ValueStatus.RESTRICTED,"EACCES",ReadReason.ACCESS_DENIED,13))),
            DeviceSection("cellular","mobile", listOf(
                DeviceInfoItem("cellLTESignal","信号","RSRP -95 dBm","test"),
                DeviceInfoItem("cellLTEChannel","信道号","39001","test"),
                DeviceInfoItem("cellLTEFrequency","精确下行","1805.123 MHz","test"),
            )),
        ))
        val projected = lanParameters(snapshot)
        assertEquals(2, projected.size)
        assertEquals(13, projected.single { it.key == "selinux" }.errno)
        assertNull(projected.single { it.key == "selinux" }.value)
        assertEquals("RSRP -95 dBm", projected.single { it.key == "cellLTESignal" }.value)
    }
}
