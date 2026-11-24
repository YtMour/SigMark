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
