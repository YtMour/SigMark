package com.sigmark.app.security

import com.sigmark.app.model.DeviceInfoItem
import com.sigmark.app.model.ValueStatus
import com.sigmark.app.lan.lanParameters
import com.sigmark.app.model.DeviceSnapshot
import com.sigmark.app.model.DeviceSection
import org.junit.Assert.*
import org.junit.Test
import java.time.Instant
import java.time.LocalDate

class DevicePostureTest {
    private val epoch = Instant.parse("2026-11-23T00:00:00Z").toEpochMilli()
    private fun row(vararg kv: Pair<String,String>)=devicePosture(kv.associate { (k,v)-> k to DeviceInfoItem(k,k,v,"test") },epoch).associateBy { it.id }
    @Test fun noReadingsDoNotProduceAVerdict() {
        assertTrue(devicePosture(emptyMap(),epoch).all { it.state==Finding.UNKNOWN })
        val k="system.selinux";val v=DeviceInfoItem(k,k,"Permissive（宽容模式）","/sys/fs/selinux/enforce",ValueStatus.RESTRICTED)
        assertEquals(Finding.UNKNOWN,devicePosture(mapOf(k to v),epoch).first { it.id==k }.state)
    }
    @Test fun completedSnapshotReportsLocalFindingsWithoutExternalEvidence() {
        val snapshot = DeviceSnapshot(epoch, listOf(
            DeviceSection("environment", "安全", listOf(
                DeviceInfoItem("keyguardSecure", "锁屏凭证", "否", "KeyguardManager"),
            )),
            DeviceSection("system", "系统", listOf(
                DeviceInfoItem("selinux", "SELinux", null, "sysfs", ValueStatus.RESTRICTED),
            )),
        ))
        val checks = devicePosture(snapshot).associateBy { it.id }
        assertEquals(Finding.PRIORITY, checks.getValue("environment.keyguardSecure").state)
        assertEquals(Finding.UNKNOWN, checks.getValue("system.selinux").state)
    }
    @Test fun keyProbeFailureIsReviewableAndOptionalWhenAbsent() {
        val probe = DeviceInfoItem("keyProtection", "密钥自测", null, "AndroidKeyStore", ValueStatus.ERROR)
        val checks = devicePosture(mapOf("environment.keyProtection" to probe), epoch)
        assertEquals(Finding.REVIEW, checks.single { it.id == "environment.keyProtection" }.state)
        assertTrue(devicePosture(emptyMap(), epoch).none { it.id == "environment.keyProtection" })
    }
    @Test fun redAndPermissiveAreActionableButCustomOrUnlockedIsNotFake() {
        val c="environment.verifiedBoot"
        assertEquals(Finding.PRIORITY,row(c to "red").getValue("boot").state)
        for(v in listOf("yellow","orange")) assertEquals(Finding.REVIEW,row(c to v).getValue("boot").state)
        assertEquals(Finding.REVIEW,row(c to "green","environment.flashLock" to "0").getValue("boot").state)
        assertEquals(Finding.OBSERVED,row(c to "green","environment.flashLock" to "1").getValue("boot").state)
        for ((k,v) in listOf("system.selinux" to "Permissive（宽容模式）","environment.keyguardSecure" to "否","environment.storageEncryption" to "系统报告未启用")) assertEquals(Finding.PRIORITY,row(k to v).getValue(k).state)
    }
    @Test fun patchUsesCaptureTimeAndInclusiveThreshold() {
        val k="system.patch";val date=LocalDate.parse("2026-11-23")
        for((age,result) in listOf(-1L to Finding.UNKNOWN,180L to Finding.OBSERVED,181L to Finding.REVIEW)) assertEquals(result,row(k to date.minusDays(age).toString()).getValue(k).state)
        assertEquals(Finding.UNKNOWN,row(k to "2026-02-30").getValue(k).state)
    }
    @Test fun servicesWithBothCapabilitiesAreNotDerivedFromIndependentCounts() {
        val r=android.accessibilityservice.AccessibilityServiceInfo.CAPABILITY_CAN_RETRIEVE_WINDOW_CONTENT
        val g=android.accessibilityservice.AccessibilityServiceInfo.CAPABILITY_CAN_PERFORM_GESTURES
        assertEquals(AccessCounts(2,1,1,0),accessibilityCounts(listOf(r,g)))
        assertEquals(AccessCounts(2,1,1,1),accessibilityCounts(listOf(r or g,0)))
        assertEquals(AccessCounts(0,0,0,0),accessibilityCounts(emptyList()))
    }
    @Test fun selinuxInferenceLeavesTheModeUnconfirmed() {
        val k="system.selinux"
        assertEquals(Finding.OBSERVED,row(k to "Enforcing（强制模式）").getValue(k).state)
        val inferred=row(k to "Enforcing（强制模式，推断）").getValue(k)
        assertEquals(Finding.UNKNOWN,inferred.state)
        assertTrue(inferred.message.contains("实时模式未确认"))
        assertEquals(Finding.UNKNOWN,row(k to "Permissive（宽容模式，推断）").getValue(k).state)
        assertEquals(Finding.UNKNOWN,row(k to "Enforcing", "system.selinuxEvidence" to "inferred_mac").getValue(k).state)
        assertEquals(Finding.UNKNOWN,row(k to "不认识的读数").getValue(k).state)
    }
    @Test fun injectionRuntimeSignalsAreReviewNotProof() {
        assertEquals(Finding.REVIEW,row("environment.hookSignals" to "frida").getValue("environment.hookSignals").state)
        assertEquals(Finding.OBSERVED,row("environment.hookSignals" to "none","environment.rootMountHints" to "none",
            "environment.rootManagerVisible" to "none").getValue("environment.hookSignals").state)
        assertEquals(Finding.UNKNOWN,row("environment.hookSignals" to "none").getValue("environment.hookSignals").state)
        assertEquals(Finding.REVIEW,row("environment.tracerPid" to "1234").getValue("environment.tracerPid").state)
        assertEquals(Finding.OBSERVED,row("environment.tracerPid" to "0").getValue("environment.tracerPid").state)
        assertEquals(Finding.OBSERVED,row("environment.userProfile" to "owner").getValue("environment.userProfile").state)
        for(v in listOf("secondary","managed")) assertEquals(Finding.REVIEW,row("environment.userProfile" to v).getValue("environment.userProfile").state)
        assertEquals(Finding.REVIEW,row("environment.verityMode" to "disabled").getValue("environment.verityMode").state)
        assertEquals(Finding.REVIEW,row("environment.buildDebuggable" to "开启").getValue("environment.verityMode").state)
        assertEquals(Finding.OBSERVED,row("environment.verityMode" to "enforcing").getValue("environment.verityMode").state)
        assertEquals(Finding.UNKNOWN,row("system.patch" to "2026-11-01").getValue("environment.verityMode").state)
    }
    @Test fun identityDeclarationsAreComparedInsideOneObserver() {
        val conflict=row("system.model" to "Model A","system.propertyModel" to "Model B").getValue("app_identity")
        assertEquals(Finding.REVIEW,conflict.state)
        assertTrue(conflict.message.contains("型号"))
        assertFalse(conflict.message.contains("Model B"))
        val consistent=row("system.model" to " 手机 A ","system.propertyModel" to "手机 a",
            "system.device" to "device","system.propertyDevice" to "DEVICE",
            "system.sku" to "sku","system.hardwareSku" to "sku").getValue("app_identity")
        assertEquals(Finding.OBSERVED,consistent.state)
        assertTrue(consistent.message.contains("3 对"))
        for (fields in listOf(
            arrayOf("system.board" to "board","system.boardPlatform" to "platform",
                "cpu.hardware" to "hw","system.bootHardware" to "boot-hw"),
            arrayOf("system.sku" to "sku","system.hardwareSku" to "SKU"),
            arrayOf("system.model" to "model","system.propertyModel" to " UnKnOwN "),
        )) assertEquals(Finding.UNKNOWN,row(*fields).getValue("app_identity").state)
        val blocked = DeviceInfoItem("propertyModel","model","Other","getprop",ValueStatus.RESTRICTED)
        val model = DeviceInfoItem("model","model","Model","Build.MODEL")
        val posture = devicePosture(mapOf("system.model" to model, "system.propertyModel" to blocked), epoch)
        assertEquals(Finding.UNKNOWN, posture.single { it.id == "app_identity" }.state)
        val older = row("system.api" to "29", "system.model" to "Example", "system.propertyModel" to "example",
            "system.device" to "d", "system.propertyDevice" to "d").getValue("app_identity")
        assertEquals(Finding.OBSERVED, older.state)
        assertTrue(older.message.contains("2 对"))
    }
    @Test fun measuredHardwareIsComparedAcrossIndependentChannels() {
        val conflicting = row("system.socModel" to "Dimensity 9200+", "system.boardPlatform" to "mt6985",
            "memory.totalRam" to "12.00 GiB", "memory.physicalRam" to "7.43 GiB",
            "cpu.cpuParts" to "0x41:0xd05×4 / 0x41:0xd0b×2 / 0x41:0xd44×2",
            "runtime.glesRenderer" to "Mali-G78").getValue("hardware_facts")
        assertEquals(Finding.REVIEW, conflicting.state)
        assertTrue(conflicting.message.contains("运行内存") || conflicting.message.contains("GiB"))
        val consistent = row("system.socModel" to "Tensor", "system.boardPlatform" to "gs101",
            "memory.totalRam" to "7.44 GiB", "memory.physicalRam" to "7.43 GiB",
            "cpu.cpuParts" to "0x41:0xd05×4 / 0x41:0xd0b×2 / 0x41:0xd44×2",
            "runtime.glesRenderer" to "Mali-G78").getValue("hardware_facts")
        assertEquals(Finding.OBSERVED, consistent.state)
        assertEquals(Finding.UNKNOWN, row("system.socModel" to "Tensor").getValue("hardware_facts").state)
    }

    @Test fun overlayCodenameIsComparedWithTheDeclaredDevice() {
        // The overlay file name is a build artifact; a rewritten codename property
        // does not reach it, so disagreement is worth a look and agreement is not proof.
        val conflict = row("system.device" to "corot", "environment.overlayDeviceCodename" to "oriole")
            .getValue("overlay_codename")
        assertEquals(Finding.REVIEW, conflict.state)
        assertTrue(conflict.message.contains("corot") && conflict.message.contains("oriole"))
        assertEquals(Finding.OBSERVED,
            row("system.device" to "oriole", "environment.overlayDeviceCodename" to "oriole")
                .getValue("overlay_codename").state)
        assertEquals(Finding.UNKNOWN, row("system.device" to "oriole").getValue("overlay_codename").state)
    }

    @Test fun localAccessReviewIsNotALanField() {        val fields=listOf("accessibility","admins","selfInstaller").map { DeviceInfoItem(it,it,"sensitive","test") }
        assertTrue(lanParameters(DeviceSnapshot(epoch,listOf(DeviceSection("environment","env",fields)))).isEmpty())
    }
}
