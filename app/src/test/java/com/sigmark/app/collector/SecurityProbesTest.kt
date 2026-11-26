package com.sigmark.app.collector

import com.sigmark.app.model.ReadReason
import com.sigmark.app.model.ValueStatus
import org.junit.Assert.*
import org.junit.Test

class SecurityProbesTest {
    @Test fun mapsScanKeepsOrderAndOnlyCountsExecutableMemfd() {
        val maps = listOf(
            "7f0000000000-7f0000100000 r-xp 00000000 fd:00 1234 /data/app/com.example/lib/arm64/libfrida-gadget.so",
            "7f1000000000-7f1000100000 rw-p 00000000 00:00 0 /memfd:jit-cache (deleted)",
            "7f2000000000-7f2000100000 r-xp 00000000 00:00 0 /memfd:jit-zygote-cache",
            "7f3000000000-7f3000100000 r--p 00000000 00:00 0 /system/lib64/libzygisk.so",
            "7f4000000000-7f4000100000 r--p 00000a00 00:00 0 /data/app/x/lib/arm64/libxposed.so",
            "7f5000000000-7f5000100000 r-xp 00000000 00:00 0 /memfd:payload (deleted)",
        ).joinToString("\n")
        assertEquals("frida / gadget / xposed / zygisk / memfd_exec", hookSignals(maps))
        // Runtime-owned executable memfd regions are not injection evidence.
        assertEquals("none", hookSignals("7f2000000000-7f2000100000 r-xp 00000000 00:00 0 /memfd:dalvik-jit-code-cache"))
        assertEquals("none", hookSignals("7f2000000000-7f2000100000 rwxp 00000000 00:00 0 /memfd:gralloc (deleted)"))
        assertNull(hookSignals(null))
    }

    @Test fun mountInfoReportsOrderedRootAndOverlayHints() {
        val mountInfo = listOf(
            "36 35 0:20 / /system rw,seclabel,relatime - overlay overlay rw",
            "36 35 0:21 / /vendor ro,seclabel - overlay overlay ro",
            "36 35 0:22 / /data rw,seclabel - ext4 /dev/block/dm-0 rw",
            "36 35 0:23 / /sbin ro - tmpfs tmpfs rw",
            "36 35 0:24 / /debug_ramdisk ro - tmpfs tmpfs rw",
            "36 35 0:25 / /mnt/expand/.magisk ro - tmpfs tmpfs rw",
        ).joinToString("\n")
        assertEquals("overlay_system / overlay_vendor / tmpfs_sbin / magisk_path", rootMountHints(mountInfo))
        assertEquals("none", rootMountHints("36 35 0:1 / /data rw - ext4 /dev/x rw"))
        assertNull(rootMountHints(null))
    }

    @Test fun tracerPidAcceptsOnlyCompactDecimalInRange() {
        assertEquals("0", tracerPid("Name:\tcom.sigmark.app\nTracerPid:\t0\nUid:\t10234\t10234\n"))
        assertEquals("4242", tracerPid("TracerPid:\t4242"))
        assertEquals("7", tracerPid("TracerPid: 0007"))
        assertNull(tracerPid("TracerPid:\t-1"))
        assertNull(tracerPid("TracerPid:\t4194305"))
        assertNull(tracerPid("Name:\tcom.sigmark.app"))
        assertNull(tracerPid(null))
    }

    @Test fun visibleRootManagersKeepFixedOrder() {
        assertEquals("magisk / kernelsu",
            rootManagerCodes(listOf("me.weishu.kernelsu", "com.example.app", "com.topjohnwu.magisk")))
        assertEquals("supersu / superuser / kingroot",
            rootManagerCodes(listOf("com.kingroot.kinguser", "eu.chainfire.supersu", "com.koushikdutta.superuser")))
        assertEquals("none", rootManagerCodes(emptyList()))
    }

    @Test fun userProfileSeparatesOwnerManagedAndSecondary() {
        assertEquals("owner", userProfileCode(0, false))
        assertEquals("owner", userProfileCode(0, true))
        assertEquals("managed", userProfileCode(10, true))
        assertEquals("secondary", userProfileCode(10, false))
        assertEquals("secondary", userProfileCode(10, null))
    }

    @Test fun drmAndFlagLabelsAcceptOnlyContractValues() {
        assertEquals("L1", drmSecurityLevel("L1"))
        assertEquals("L3", drmSecurityLevel(" l3 "))
        assertEquals("L2", drmSecurityLevel("L2"))
        assertNull(drmSecurityLevel("L4"))
        assertNull(drmSecurityLevel(null))
        assertEquals("开启", flagLabel("1"))
        assertEquals("关闭", flagLabel(" 0\n"))
        assertNull(flagLabel("01"))
        assertNull(flagLabel(""))
        assertNull(flagLabel(null))
    }

    @Test fun propertySnapshotParsesBracketsAndSkipsMalformedLines() {
        val raw = """
            [ro.boot.veritymode]: [enforcing]
            [ro.debuggable]: [0]
            [ro.build.version.base_os]: []
            [persist.sys.weird]: [a]b]
            malformed line
            [ro.broken]
            [ro.bad.key!]: [x]
        """.trimIndent()
        val parsed = parsePropertySnapshot(raw)
        assertEquals("enforcing", parsed["ro.boot.veritymode"])
        assertEquals("0", parsed["ro.debuggable"])
        assertEquals("", parsed["ro.build.version.base_os"])
        assertEquals("a]b", parsed["persist.sys.weird"])
        assertFalse(parsed.containsKey("ro.broken"))
        assertEquals(4, parsed.size)
    }

    @Test fun partitionDatesUseUtcAndFixedOrder() {
        assertEquals("2024-01-05", epochSecondsUtcDate("1704412800"))
        assertNull(epochSecondsUtcDate("0"))
        assertNull(epochSecondsUtcDate("-5"))
        assertNull(epochSecondsUtcDate("not-a-number"))
        assertNull(epochSecondsUtcDate(null))
        val text = partitionDatesText(mapOf("vendor" to "2023-12-11", "system" to "2024-01-05",
            "bootimage" to "2024-01-03"))
        assertEquals("system 2024-01-05 · vendor 2023-12-11 · bootimage 2024-01-03", text)
        assertNull(partitionDatesText(emptyMap()))
    }

    @Test fun orderedObservationUsesContractOrderAndNone() {
        assertEquals("overlay_system / overlay_vendor",
            orderedObservation(rootMountOrder, setOf("overlay_vendor", "overlay_system")))
        assertEquals("frida / zygisk", orderedObservation(hookSignalOrder, setOf("zygisk", "frida")))
        assertEquals("none", orderedObservation(hookSignalOrder, emptySet()))
    }

    @Test fun propertyDecodingKeepsUnsetApartFromInvalid() {
        val unset = SafeReader.missing<String>("getprop fixture", ReadReason.NOT_REPORTED, "unset")
        assertSame(unset, unset.decodeProperty({ flagLabel(it) }, "invalid"))
        val invalid = SafeReader.read<String>("getprop fixture") { "maybe" }
            .decodeProperty({ flagLabel(it) }, "invalid")
        assertEquals(ReadReason.INVALID_VALUE, invalid.reason)
        assertEquals(ValueStatus.UNAVAILABLE, invalid.status)
        val valid = SafeReader.read<String>("getprop fixture") { "1" }.decodeProperty({ flagLabel(it) }, "invalid")
        assertEquals("开启", valid.value)
    }

    @Test fun overlayCodenameComesFromTheBakedRroFileName() {
        // Shape of a real Pixel 6 process map: the image's own product name survives
        // in the framework overlay even when the property layer reports another one.
        val maps = listOf(
            "7f0000000000-7f0000100000 r--p 00000000 fd:00 1234 /data/resource-cache/product@overlay@YmRecentsGs101Overlay@YmRecentsGs101Overlay.apk@idmap",
            "7f1000000000-7f1000100000 r--p 00000000 fd:00 1235 /data/resource-cache/product@overlay@framework-res__oriole_user__auto_generated_rro_product.apk@idmap",
            "7f2000000000-7f2000100000 r--p 00000000 fd:00 1236 /data/resource-cache/vendor@overlay@framework-res__oriole_user__auto_generated_rro_vendor.apk@idmap",
        ).joinToString("\n")
        assertEquals("oriole", overlayDeviceCodename(maps))
        assertNull(overlayDeviceCodename(null))
        // A renamed overlay that does not follow the AOSP pattern is not a reading.
        assertNull(overlayDeviceCodename("7f0-7f1 r--p 0 fd:00 1 /data/resource-cache/custom-rro.apk@idmap"))
    }

    // Field set 25: the same image usually carries the per-target RROs it was built
    // with, both as idmaps and as files under the partition overlay directories. These
    // cases are the fallbacks for a module that renames only the framework overlay.

    private fun mapsOf(vararg paths: String) = paths.mapIndexed { index, path ->
        "7f%02d00000000-7f%02d00100000 r--p 00000000 fd:00 %d %s".format(index, index, 1234 + index, path)
    }.joinToString("\n")

    @Test fun overlayReadingFallsBackToTheVendorOverlayDirectory() {
        val reading = overlayReading("", mapOf(OverlayDir.VENDOR to
            DirScan.Names(listOf("Settings__corot_user__auto_generated_rro_vendor.apk"))))
        assertEquals("corot", reading.codename)
        assertTrue(reading.evidence!!.contains("vendor_dir:corot"))
        // No framework RRO was mapped, so that channel has nothing to say.
        assertFalse(reading.evidence!!.contains("rro:"))
        assertTrue(reading.available)
    }

    @Test fun overlayReadingFallsBackToAnotherPerTargetIdmap() {
        val maps = mapsOf("/data/resource-cache/product@overlay@Settings__corot_user__auto_generated_rro_product.apk@idmap")
        val reading = overlayReading(maps)
        assertEquals("corot", reading.codename)
        assertTrue(reading.evidence!!.contains("idmap:corot"))
    }

    @Test fun overlayReadingKeepsMapsAsTheVerdictAndRecordsTheDisagreement() {
        val maps = mapsOf("/data/resource-cache/product@overlay@framework-res__oriole_user__auto_generated_rro_product.apk@idmap")
        val reading = overlayReading(maps, mapOf(OverlayDir.VENDOR to
            DirScan.Names(listOf("Settings__corot_user__auto_generated_rro_vendor.apk"))))
        // maps reflects what this process actually loaded, so it wins the verdict.
        assertEquals("oriole", reading.codename)
        assertTrue(reading.evidence!!.contains("conflict:rro:oriole!=vendor_dir:corot"))
        assertEquals(listOf("conflict:rro:oriole!=vendor_dir:corot"), reading.conflicts)
    }

    @Test fun overlayReadingAgreesAcrossEveryCodenamePath() {
        val maps = mapsOf(
            "/data/resource-cache/product@overlay@framework-res__oriole_user__auto_generated_rro_product.apk@idmap",
            "/data/resource-cache/vendor@overlay@framework-res__oriole_user__auto_generated_rro_vendor.apk@idmap",
        )
        val reading = overlayReading(maps, mapOf(
            OverlayDir.VENDOR to DirScan.Names(listOf(
                "BatteryStatsViewer__oriole_user__auto_generated_rro_vendor.apk",
                "framework-res__oriole_user__auto_generated_rro_vendor.apk",
                "Settings__oriole_user__auto_generated_rro_vendor.apk")),
            OverlayDir.PRODUCT to DirScan.Names(listOf(
                "framework-res__oriole_user__auto_generated_rro_product.apk")),
        ))
        assertEquals("oriole", reading.codename)
        assertEquals("rro:oriole / vendor_dir:oriole / product_dir:oriole", reading.evidence)
        assertTrue(reading.conflicts.isEmpty())
    }

    @Test fun overlayReadingRejectsPlaceholderAndStructuralWords() {
        // `nosdcard` is the placeholder product name AOSP ships on some images (real
        // device output has both the `_user__` and the `_characteristics_rro` shape);
        // `framework` and `common` are structural words a capture group could pick up.
        val maps = mapsOf("/data/resource-cache/product@overlay@framework-res__nosdcard__auto_generated_characteristics_rro.apk@idmap")
        val reading = overlayReading(maps, mapOf(
            OverlayDir.VENDOR to DirScan.Names(listOf(
                "Settings__nosdcard_user__auto_generated_rro_vendor.apk",
                "framework__framework_user__auto_generated_rro_vendor.apk",
                "Settings__common_user__auto_generated_rro_vendor.apk")),
            OverlayDir.PRODUCT to DirScan.Names(listOf(
                "framework-res__nosdcard__auto_generated_characteristics_rro.apk",
                "SettingsOverlayGR1YH.apk",
                "DeviceAsWebcamOriole.apk")),
        ))
        assertNull(reading.codename)
        assertFalse(reading.available)
        assertTrue(reading.evidence!!.contains("vendor_dir:unknown"))
        assertTrue(reading.evidence!!.contains("product_dir:unknown"))
        assertTrue(reading.evidence!!.contains("sku:gr1yh"))
        // The CamelCase overlay names are deliberately not mined for a codename.
        assertFalse(reading.evidence!!.contains("oriole"))
    }

    @Test fun overlayReadingIsEmptyWhenNothingIsReachable() {
        val reading = overlayReading(null)
        assertNull(reading.codename)
        assertNull(reading.evidence)
        assertFalse(reading.available)
        assertEquals(listOf("maps"), reading.denied)
        assertEquals(overlayReading(""), overlayReading(""))
    }

    @Test fun overlayReadingKeepsADeniedDirectoryVisible() {
        val reading = overlayReading("", mapOf(OverlayDir.VENDOR to DirScan.Denied))
        assertNull(reading.codename)
        assertTrue(reading.evidence!!.contains("vendor_dir:denied"))
        assertEquals(listOf("vendor_dir"), reading.denied)
        // A denied channel must not be reported as a clean "no overlay here".
        assertFalse(reading.available)
    }

    @Test fun overlayReadingRecordsSocAndSkuOnlyAsSideEvidence() {
        val soc = overlayReading(mapsOf("/product/overlay/YmRecentsGs101Overlay/YmRecentsGs101Overlay.apk"))
        assertNull(soc.codename)
        assertTrue(soc.evidence!!.contains("soc:gs101"))
        assertFalse(soc.evidence!!.contains("rro:"))

        val sku = overlayReading("", mapOf(OverlayDir.PRODUCT to
            DirScan.Names(listOf("SettingsOverlayGB7N6.apk"))))
        assertNull(sku.codename)
        assertTrue(sku.evidence!!.contains("sku:gb7n6"))
    }

    @Test fun overlayReadingNormalizesCaseAndDedupesRepeatedMappings() {
        val upper = overlayReading("", mapOf(OverlayDir.VENDOR to
            DirScan.Names(listOf("Settings__ORIOLE_user__auto_generated_rro_vendor.apk"))))
        assertEquals("oriole", upper.codename)

        val line = "/data/resource-cache/product@overlay@Settings__corot_user__auto_generated_rro_product.apk@idmap"
        val repeated = overlayReading(listOf(line, line, line).joinToString("\n"))
        assertEquals("corot", repeated.codename)
        assertEquals(1, Regex("idmap:").findAll(repeated.evidence!!).count())
    }

    @Test fun overlayReadingIgnoresNamesOutsideTheCodenameLengthRange() {
        assertNull(overlayReading("", mapOf(OverlayDir.PRODUCT to DirScan.Names(listOf(
            "framework-res__a__user__auto_generated_rro_product.apk")))).codename)
        assertNull(overlayReading("", mapOf(OverlayDir.PRODUCT to DirScan.Names(listOf(
            "framework-res__${"b".repeat(33)}_user__auto_generated_rro_product.apk")))).codename)
    }

    @Test fun overlayReadingDoesNotMineDynamicColourFrroNames() {
        // The three systemui *.frro idmaps are dynamic colour resources, not product
        // overlays; they must not be read as a codename.
        val reading = overlayReading(mapsOf(
            "/data/resource-cache/data@resource-cache@com.android.systemui-accent-MYFK.frro@idmap",
            "/data/resource-cache/data@resource-cache@com.android.systemui-neutral-90PO.frro@idmap",
        ))
        assertNull(reading.codename)
        assertNull(reading.evidence)
    }

    @Test fun overlayReadingReproducesThePixel6EvidenceString() {
        // Verbatim contents of a real Pixel 6 capture (§1.2 of docs/OVERLAY-ROBUSTNESS.md).
        val maps = mapsOf(
            "/data/resource-cache/data@resource-cache@com.android.systemui-accent-MYFK.frro@idmap",
            "/data/resource-cache/data@resource-cache@com.android.systemui-dynamic-mb14.frro@idmap",
            "/data/resource-cache/data@resource-cache@com.android.systemui-neutral-90PO.frro@idmap",
            "/data/resource-cache/product@overlay@YmRecentsGs101Overlay@YmRecentsGs101Overlay.apk@idmap",
            "/data/resource-cache/product@overlay@framework-res__oriole_user__auto_generated_rro_product.apk@idmap",
            "/data/resource-cache/vendor@overlay@framework-res__oriole_user__auto_generated_rro_vendor.apk@idmap",
            "/product/overlay/YmRecentsGs101Overlay/YmRecentsGs101Overlay.apk",
            "/product/overlay/framework-res__oriole_user__auto_generated_rro_product.apk",
            "/vendor/overlay/framework-res__oriole_user__auto_generated_rro_vendor.apk",
        )
        val vendor = listOf("BatteryStatsViewer", "DeviceDiagnostics", "EmergencyInfo", "NfcNci", "ONS",
            "Settings", "StorageManager", "SystemUI", "TeleService", "Traceur", "framework-res")
            .map { "${it}__oriole_user__auto_generated_rro_vendor.apk" }
        val product = listOf(
            "CompanionDeviceManager__nosdcard__auto_generated_characteristics_rro.apk",
            "ConnectivityOverlay.apk", "DeviceAsWebcamOriole.apk",
            "DisplayCutoutAvoidAppsInCutout", "DisplayCutoutEmulationCorner", "DisplayCutoutEmulationDouble",
            "DisplayCutoutEmulationHole", "DisplayCutoutEmulationTall", "DisplayCutoutEmulationWaterfall",
            "DisplayCutoutNoCutout", "FontNotoSerifSource", "NavigationBarMode3Button", "NavigationBarModeGestural",
            "NavigationBarModeGesturalExtraWideBack", "NavigationBarModeGesturalNarrowBack",
            "NavigationBarModeGesturalWideBack", "NfcOverlayOriole.apk", "NotesRoleEnabled",
            "SettingsOverlayG9S9B.apk", "SettingsOverlayGB7N6.apk", "SettingsOverlayGR1YH.apk",
            "TeleService__nosdcard__auto_generated_characteristics_rro.apk",
            "TelephonyProvider__nosdcard__auto_generated_characteristics_rro.apk",
            "TransparentNavigationBar", "WifiOverlay", "YmRecentsGs101Overlay", "YmSetupWizardGs101Overlay",
            "framework-res__nosdcard__auto_generated_characteristics_rro.apk",
            "framework-res__oriole_user__auto_generated_rro_product.apk",
        )
        val reading = overlayReading(maps, mapOf(
            OverlayDir.VENDOR to DirScan.Names(vendor),
            OverlayDir.PRODUCT to DirScan.Names(product),
        ), declaredSku = "GR1YH")
        assertEquals("oriole", reading.codename)
        assertEquals("rro:oriole / vendor_dir:oriole / product_dir:oriole / sku:gr1yh / soc:gs101",
            reading.evidence)
    }
}

class PropertyPartitionTest {
    @Test fun propertyPartitionsKeepFixedOrderAndSkipMissing() {
        val available = mapOf(
            "ro.vendor.build.fingerprint" to "Xiaomi/dipper/dipper:10/QA",
            "ro.system.build.fingerprint" to "Xiaomi/dipper/dipper:10/QA",
            "ro.bootimage.build.fingerprint" to "Xiaomi/dipper/dipper:10/QA",
        )
        val rows = propertyPartitionRows { key ->
            available[key]?.let { ReadResult(it, ValueStatus.AVAILABLE, "getprop $key") }
                ?: SafeReader.missing("getprop $key", ReadReason.NOT_REPORTED, "unset")
        }
        assertEquals(listOf("system", "vendor", "bootimage"), rows.map { it.first })
        assertTrue(rows.all { it.second.status == ValueStatus.AVAILABLE })
    }

    @Test fun restrictedPropertyPartitionIsNotProjectedAndDoesNotCount() {
        val rows = propertyPartitionRows { key ->
            if (key == "ro.product.build.fingerprint") ReadResult(null, ValueStatus.RESTRICTED,
                "getprop $key", "denied", ReadReason.ACCESS_DENIED, 13)
            else SafeReader.missing("getprop $key", ReadReason.NOT_REPORTED, "unset")
        }
        assertTrue(rows.isEmpty())
    }
}
