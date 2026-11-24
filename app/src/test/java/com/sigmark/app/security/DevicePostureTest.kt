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
    @Test fun selinuxInferenceIsObservedWithItsBasisNotSilent() {
        val k="system.selinux"
        assertEquals(Finding.OBSERVED,row(k to "Enforcing（强制模式）").getValue(k).state)
        val inferred=row(k to "Enforcing（强制模式，推断）").getValue(k)
        assertEquals(Finding.OBSERVED,inferred.state)
        assertTrue(inferred.message.contains("推断"))
        assertEquals(Finding.PRIORITY,row(k to "Permissive（宽容模式，推断）").getValue(k).state)
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
        val conflict=row("system.board" to "mt6985","system.boardPlatform" to "gs101").getValue("system.board")
        assertEquals(Finding.REVIEW,conflict.state)
        assertTrue(conflict.message.contains("mt6985"))
        assertTrue(conflict.message.contains("gs101"))
        val consistent=row("system.board" to "mt6985","system.boardPlatform" to "MT6985",
            "cpu.hardware" to "mtk","system.bootHardware" to "mtk",
            "system.sku" to "23078PND5G","system.hardwareSku" to "23078PND5G").getValue("system.board")
        assertEquals(Finding.OBSERVED,consistent.state)
        assertTrue(consistent.message.contains("3 对"))
        assertEquals(Finding.OBSERVED,row("cpu.hardware" to "mtk","system.bootHardware" to "mtk").getValue("system.board").state)
        assertEquals(Finding.UNKNOWN,row("system.board" to "mt6985").getValue("system.board").state)
        assertEquals(Finding.UNKNOWN,row("system.patch" to "2026-11-01").getValue("system.board").state)
    }
    @Test fun localAccessReviewIsNotALanField() {
        val fields=listOf("accessibility","admins","selfInstaller").map { DeviceInfoItem(it,it,"sensitive","test") }
        assertTrue(lanParameters(DeviceSnapshot(epoch,listOf(DeviceSection("environment","env",fields)))).isEmpty())
    }
}
