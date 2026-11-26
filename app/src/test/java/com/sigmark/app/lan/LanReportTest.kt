package com.sigmark.app.lan

import com.sigmark.app.model.DeviceInfoItem
import com.sigmark.app.model.DeviceSection
import com.sigmark.app.model.DeviceSnapshot
import com.sigmark.app.model.ReadReason
import com.sigmark.app.model.ValueStatus
import org.junit.Assert.*
import org.junit.Test

class LanReportTest {
    @Test fun projectionMatchesSharedLanRegistry() {
        val filename = "/lan-projection-v${LanFieldSetVersion}.txt"
        val spec = requireNotNull(javaClass.getResourceAsStream(filename)) { "Missing shared LAN registry $filename" }
            .bufferedReader().use { it.readLines() }.filter(String::isNotBlank)
        assertEquals("Registry must be unique and sorted", spec.distinct().sorted(), spec)
        assertEquals(spec, lanProjectionKeys.sorted())
    }
    @Test fun v8ProjectsPublicCapabilitySummariesInTheirOwnGroups() {
        val keys = listOf("vulkanVersion","cameraCapabilitySummary","typeWakeupSummary","sensor_0","camera_0")
        val snapshot = DeviceSnapshot(1,listOf("runtime","media","sensors").map { group ->
            DeviceSection(group,group,keys.map { DeviceInfoItem(it,it,"value","test") })
        })
        assertEquals(setOf("runtime.vulkanVersion","media.cameraCapabilitySummary","sensors.typeWakeupSummary"),
            lanParameters(snapshot).map { it.group+"."+it.key }.toSet())
        val report = lanReport(snapshot,"0.20.0","")
        assertEquals(25, report.fieldSetVersion)
        assertEquals(7, report.copy(fieldSetVersion = 7).copy(feedback = "old draft").fieldSetVersion)
    }

    @Test fun appIdentityPropertiesKeepBothProvenanceAndRestrictedState() {
        val snapshot = DeviceSnapshot(1, listOf(DeviceSection("system", "系统", listOf(
            DeviceInfoItem("model", "型号", "Model A", "Build.MODEL"),
            DeviceInfoItem("propertyModel", "型号属性", "Model B", "getprop ro.product.model"),
            DeviceInfoItem("propertyDevice", "设备代号属性", null, "getprop ro.product.device",
                ValueStatus.RESTRICTED, reason = ReadReason.ACCESS_DENIED, errno = 13),
        ))))
        val rows = lanParameters(snapshot).associateBy { it.key }
        assertEquals("Model A", rows.getValue("model").value)
        assertEquals("Model B", rows.getValue("propertyModel").value)
        assertEquals("getprop ro.product.model", rows.getValue("propertyModel").source)
        assertNull(rows.getValue("propertyDevice").value)
        assertEquals("RESTRICTED", rows.getValue("propertyDevice").status)
        assertEquals(13, rows.getValue("propertyDevice").errno)
    }

    @Test fun headerUsesInstalledVariantVersion() {
        val snap = DeviceSnapshot(1,listOf(DeviceSection("app","app",listOf(DeviceInfoItem("version","版本","0.18.42 (42)","PackageManager")))))
        assertEquals("0.18.42",lanReport(snap,"0.18.0","").appVersion)
    }
    @Test fun v7OnlyProjectsSecurityEvidenceInItsOwnGroup() {
        val groups = mapOf("system" to listOf("partition_vendor","partition_../x","webViewProvider","vendorSpl"),
            "app" to listOf("package","channel","certSha256","keyProtection"),
            "environment" to listOf("keyProtection","privateKey","partition_vendor"))
        val snap = DeviceSnapshot(1,groups.map { (g,keys) -> DeviceSection(g,g,keys.map {
            DeviceInfoItem(it,it,"value","test")
        }) })
        assertEquals(setOf("system.partition_vendor","system.webViewProvider","system.vendorSpl","app.package",
            "app.channel","app.certSha256","environment.keyProtection"),lanParameters(snap).map { it.group+"."+it.key }.toSet())
    }
    @Test fun sharesProtectionFlagsButNotLocalIdentityEvidence() {
        val values = mapOf("keyguardSecure" to "是", "storageEncryption" to "已启用", "configurationDigest" to "private",
            "strongBiometrics" to "private", "virtualDeviceHints" to "private")
        val snapshot = DeviceSnapshot(0, listOf(DeviceSection("environment", "environment", values.map { (key,value) ->
            DeviceInfoItem(key,key,value,"public Android API")
        })))
        assertEquals(setOf("keyguardSecure","storageEncryption"),lanParameters(snapshot).map { it.key }.toSet())
        assertEquals(25,LanFieldSetVersion)
    }

    // Field set 25 projects the multi-path overlay evidence next to the single codename.
    @Test fun projectsOverlayEvidenceBesideTheOverlayCodename() {
        val snapshot = DeviceSnapshot(1800000000000, listOf(DeviceSection("environment", "环境", listOf(
            DeviceInfoItem("overlayDeviceCodename", "系统 overlay 记录的产品代号", "oriole", "/proc/self/maps"),
            DeviceInfoItem("overlayEvidence", "系统 overlay 多路径证据",
                "rro:oriole / vendor_dir:oriole / product_dir:oriole / sku:gr1yh / soc:gs101",
                "/proc/self/maps + /vendor|product|system_ext|odm/overlay"),
            DeviceInfoItem("overlayEvidenceCopy", "本地副本", "local", "test"),
        ))))
        val rows = lanParameters(snapshot).associateBy { it.key }
        assertEquals(setOf("overlayDeviceCodename", "overlayEvidence"), rows.keys)
        assertEquals("rro:oriole / vendor_dir:oriole / product_dir:oriole / sku:gr1yh / soc:gs101",
            rows.getValue("overlayEvidence").value)
        // A denied evidence trail keeps its RESTRICTED state on the wire.
        val restricted = lanParameters(DeviceSnapshot(0, listOf(DeviceSection("environment", "环境", listOf(
            DeviceInfoItem("overlayEvidence", "系统 overlay 多路径证据", null, "test",
                ValueStatus.RESTRICTED, reason = ReadReason.ACCESS_DENIED, errno = 13),
        ))))).single()
        assertNull(restricted.value)
        assertEquals("RESTRICTED", restricted.status)
        assertEquals(13, restricted.errno)
    }

    @Test fun onlyProjectsVersion11CompatibilityEvidenceInItsGroup() {
        val groups = mapOf("cpu" to listOf("processBitness", "kernelMachine", "externalInputTypes"),
            "system" to listOf("interfaceCapabilities", "processBitness"),
            "runtime" to listOf("externalInputTypes", "inputDeviceNames", "inputDeviceDescriptors"))
        val snapshot = DeviceSnapshot(1800000000000, groups.map { (group, keys) ->
            DeviceSection(group, group, keys.map { key ->
                if (key == "externalInputTypes") DeviceInfoItem(key, key, null, "test", ValueStatus.UNAVAILABLE,
                    reason = ReadReason.INTERFACE_UNSUPPORTED) else DeviceInfoItem(key, key, "64", "test")
            })
        })
        val rows = lanParameters(snapshot)
        assertEquals(setOf("cpu.processBitness", "cpu.kernelMachine", "system.interfaceCapabilities", "runtime.externalInputTypes"),
            rows.map { it.group + "." + it.key }.toSet())
        assertEquals("INTERFACE_UNSUPPORTED", rows.single { it.key == "externalInputTypes" }.reason)
    }
    @Test fun assetIdentityIsScopedToTheBackendAddressAndPort() {
        fun scope(origin: String) = assetIdentityScope(requireNotNull(lanEndpoint(origin)))
        assertEquals(scope("http://192.168.1.10:48272"),scope("http://192.168.1.10:48272/"))
        assertNotEquals(scope("http://192.168.1.10:48272"),scope("http://192.168.1.10:48273"))
        assertNotEquals(scope("http://192.168.1.10:48272"),scope("http://192.168.1.11:48272"))
    }

    @Test fun keepsPrivateDiagnosticsOffTheWire() {
        val keys = mapOf(
            "app" to listOf("permissions", "installedAt", "certificateChain", "visibleLauncherApps","partition_vendor"),
            "environment" to listOf("configurationDigest", "suFileHint", "strongBiometrics"),
            "system" to listOf("fingerprint", "buildHost", "buildUser"),
            "media" to listOf("camera_0"),
            "sensors" to listOf("sensor_0", "sampleValues"),
            "timeline" to listOf("events"),
            "cellular" to listOf("subscriptionId", "iccid", "phoneNumber"),
            "runtime" to listOf("locale", "timeZone", "featureList", "inputDeviceIds", "glDriverRaw"),
        )
        val snapshot = DeviceSnapshot(0, keys.map { (group, fields) ->
            DeviceSection(group, group, fields.map { DeviceInfoItem(it, it, "local", "test") })
        })
        assertTrue(lanParameters(snapshot).isEmpty())
    }

    @Test fun archivesMissingDiagnosticsAndCountsUnsharedFields() {
        val snapshot = DeviceSnapshot(1800000000000, listOf(
            DeviceSection("battery", "电池", listOf(
                DeviceInfoItem("energyCounter", "剩余能量", null, "BatteryManager",
                    ValueStatus.UNAVAILABLE, reason = ReadReason.NOT_REPORTED),
            )),
            DeviceSection("environment", "环境", listOf(
                DeviceInfoItem("selinuxDomain", "进程域", null, "/proc/self/attr/current",
                    ValueStatus.RESTRICTED, reason = ReadReason.ACCESS_DENIED, errno = 13),
                DeviceInfoItem("configurationDigest", "配置摘要", "local", "Build"),
            )),
        ))
        val rows = lanParameters(snapshot)
        assertEquals(listOf("energyCounter", "selinuxDomain"), rows.map { it.key })
        assertEquals(listOf("UNAVAILABLE", "RESTRICTED"), rows.map { it.status })
        assertTrue(rows.all { it.value == null })
        assertEquals(13, rows.last().errno)
        assertEquals(listOf(LanCoverage("battery", 0, 0, 1, 0), LanCoverage("environment", 1, 1, 0, 0)),
            lanCoverage(snapshot))
    }

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

    @Test fun projectionKeepsPublicHardwarePowerAndLinkReadings() {
        val fields = mapOf(
            "system" to mapOf("socModel" to "Sample SoC", "socManufacturer" to "Example",
                "declaredCapabilities" to "NFC 已声明"),
            "battery" to mapOf("powerSaver" to "关闭", "thermalStatus" to "正常"),
            "network" to mapOf("defaultRouteFamilies" to "IPv4 / IPv6", "privateDnsActive" to "已启用",
                "linkMtu" to "1500 字节", "visibleTransports" to "Wi-Fi / 蜂窝网络", "wifiRouteRole" to "默认网络"),
            "cellular" to mapOf("simState" to "卡槽 1：就绪", "dataState" to "已连接",
                "defaultDataSlot" to "卡槽 1", "slotService" to "卡槽 1：有服务")
        )
        val snapshot = DeviceSnapshot(1800000000000, fields.map { (group, values) ->
            DeviceSection(group, group, values.map { (key, value) ->
                DeviceInfoItem(key, key, value, "public Android API")
            })
        })
        assertEquals(fields, lanParameters(snapshot).groupBy { it.group }.mapValues { (_, values) ->
            values.associate { it.key to it.value }
        })
    }
}
