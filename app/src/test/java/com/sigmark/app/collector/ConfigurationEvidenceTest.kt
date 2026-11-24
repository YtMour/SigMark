package com.sigmark.app.collector

import com.sigmark.app.lan.lanParameters
import com.sigmark.app.model.DeviceInfoItem
import com.sigmark.app.model.DeviceSection
import com.sigmark.app.model.DeviceSnapshot
import com.sigmark.app.model.ReadReason
import com.sigmark.app.model.ValueStatus
import org.junit.Assert.*
import org.junit.Test

class ConfigurationEvidenceTest {
    private fun snapshot(at: Long, incremental: String = "1", denied: Boolean = false): DeviceSnapshot {
        val fields = mapOf("system" to mapOf("brand" to "厂牌", "model" to "Bench 1", "device" to "bench",
            "type" to "user", "buildId" to "QA1A", "incremental" to incremental, "patch" to "2026-11-01",
            "board" to "benchboard", "initialSdk" to "31"),
            "cpu" to mapOf("abis" to "arm64-v8a, armeabi-v7a", "hardware" to "bench", "coresConfigured" to "8"))
        return DeviceSnapshot(at,fields.map { (group,rows) -> DeviceSection(group,group,rows.map { (key,value) ->
            if (denied && key == "incremental") DeviceInfoItem(key,key,null,"Build.VERSION.INCREMENTAL",
                ValueStatus.RESTRICTED,reason=ReadReason.ACCESS_DENIED)
            else DeviceInfoItem(key,key,value,"Build")
        }) })
    }

    @Test fun repeatReinstallAndTwoSameConfigurationsShareCode() {
        val first = machineCode(snapshot(1))
        val second = machineCode(snapshot(2))
        assertEquals(listOf("P2-0298a3fdcf04149ce27436cc7d0d5509","H2-0df61682ea44367fd0ebb157b98c300f",
            "R2-abf4c36833e6a89dec9715fe56da99e7"),first.map { it.code })
        assertEquals(first,second)
        val additionally = snapshot(3).let {
            it.copy(sections=it.sections+DeviceSection("environment","test",listOf(DeviceInfoItem("configurationDigest","test","different","test"))))
        }
        assertEquals(first,machineCode(additionally))
        assertFalse(lanParameters(additionally).any { it.key == "configurationDigest" })
    }

    @Test fun romChangeAndRestrictedFieldsDoNotAffectProductCode() {
        val base = machineCode(snapshot(1))
        val changed = machineCode(snapshot(2,incremental="2"))
        val restricted = machineCode(snapshot(3,denied=true))
        assertEquals(base.first().code,changed.first().code)
        assertNotEquals(base.last().code,changed.last().code)
        assertEquals(base[1].code,changed[1].code)
        assertEquals(listOf("system.incremental" to "值变化"),codeChanges(base.last(),changed.last()))
        assertNull(restricted.last().code)
        assertEquals(3,restricted.last().available)
        assertEquals(listOf("system.incremental" to "缺少读数"),codeChanges(base.last(),restricted.last()))
    }

    @Test fun hardwareComponentFollowsTheChipInputsOnly() {
        val base = machineCode(snapshot(1))
        fun replaced(key: String, value: String): DeviceSnapshot {
            val snap = snapshot(2)
            return snap.copy(sections = snap.sections.map { section ->
                section.copy(items = section.items.map { if (it.key == key) it.copy(value = value) else it })
            })
        }
        val board = machineCode(replaced("board", "otherboard"))
        assertEquals(base[0].code, board[0].code)
        assertEquals(base[2].code, board[2].code)
        assertNotEquals(base[1].code, board[1].code)
        val missing = machineCode(snapshot(3).let { snap ->
            snap.copy(sections = snap.sections.map { section ->
                section.copy(items = section.items.filterNot { it.key == "initialSdk" })
            })
        })
        assertNull(missing[1].code)
        assertEquals(3, missing[1].available)
        assertEquals(base[0].code, missing[0].code)
        assertEquals(base[2].code, missing[2].code)
    }

    @Test fun sysfsReadsKeepRawValuesAndDifferentiateErrors() {
        val cpu=SysfsField.CPU_ONLINE
        fun result(raw:String) = readSysfs(cpu,34) { ReadResult(raw,ValueStatus.AVAILABLE,it.path) }
        assertEquals("0-3,5",result("0-3,5\n").value)
        assertEquals(setOf(0,1,2,3,5),cpuSet("0-3,5"))
        for (raw in listOf("0-3,3","4-1","4096","0\n3","0,".repeat(64))) {
            assertEquals(ReadReason.INVALID_VALUE,result(raw).reason)
        }
        assertEquals(315,sysBatteryTenths("315\n"))
        assertNull(sysBatteryTenths("31500"))
        for (status in listOf(ValueStatus.UNAVAILABLE,ValueStatus.RESTRICTED,ValueStatus.ERROR)) {
            val reading=ReadResult<String>(null,status,cpu.node.path,errno=if(status==ValueStatus.RESTRICTED) 13 else null)
            assertEquals(reading,readSysfs(cpu,34){reading})
        }
        assertEquals(ReadReason.INTERFACE_UNSUPPORTED,readSysfs(cpu,25){error("must not read")}.reason)
    }

    @Test fun romAdapterLabelsClaimsAndRejectsUnknownOrDuplicateEnvelope() {
        val claim=RomClaim(RomEvidenceField.ONLINE_CPU_COUNT,8)
        val fixture=RomEvidenceEnvelope(1,1700000000000,listOf(claim))
        val accepted=readRomEvidence { fixture } as RomEvidenceResult.Observed
        assertEquals("ROM_SERVICE",accepted.observer)
        assertEquals("service_claim",accepted.assurance)
        assertEquals(RomEvidenceResult.NotAvailable,readRomEvidence { null })
        assertEquals(RomEvidenceResult.Invalid,readRomEvidence { fixture.copy(schemaVersion=2) })
        assertEquals(RomEvidenceResult.Invalid,readRomEvidence { fixture.copy(claims=listOf(claim,claim)) })
        assertEquals(RomEvidenceResult.Invalid,readRomEvidence { fixture.copy(claims=listOf(claim.copy(value=0))) })
    }
}
