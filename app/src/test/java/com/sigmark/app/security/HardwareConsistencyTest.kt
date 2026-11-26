package com.sigmark.app.security

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class HardwareConsistencyTest {
    private fun facts(values: Map<String, String>): HardwareFacts = hardwareFacts { values[it] }

    @Test fun matchingChannelsAreConfirmedNotProofOfOrigin() {
        val result = facts(mapOf(
            "memory.totalRam" to "7.44 GiB", "memory.physicalRam" to "7.43 GiB",
            "system.socModel" to "Tensor", "system.boardPlatform" to "gs101",
            "cpu.cpuParts" to "0x41:0xd05×4 / 0x41:0xd0b×2 / 0x41:0xd44×2",
            "runtime.glesRenderer" to "Mali-G78",
        ))
        assertTrue(result.conflicts.isEmpty())
        assertEquals(3, result.confirmed)
    }

    @Test fun rewrittenIdentityLeavesThreeIndependentConflicts() {
        // Shape of the observed Pixel 6 test unit: the app process is told it is a
        // Dimensity 9200+ phone with 12 GiB, while the kernel and the driver still answer
        // for the original hardware.
        val result = facts(mapOf(
            "memory.totalRam" to "12.00 GiB", "memory.physicalRam" to "7.43 GiB",
            "system.socModel" to "Dimensity 9200+", "system.boardPlatform" to "mt6985",
            "cpu.cpuParts" to "0x41:0xd05×4 / 0x41:0xd0b×2 / 0x41:0xd44×2",
            "runtime.glesRenderer" to "Mali-G78",
        ))
        assertEquals(listOf("ram", "cores", "gpu"), result.conflicts.map { it.id })
        assertTrue(result.conflicts.first { it.id == "ram" }.message.contains("12.00"))
        assertTrue(result.conflicts.first { it.id == "gpu" }.message.contains("mali-g715"))
    }

    @Test fun gpuAliasConfirmsTheDeclaredFamily() {
        // ARM markets the same core as both "Mali-G715" and "Immortalis-G715"; a driver
        // string must not be reported as a conflict just because of the alias.
        val result = facts(mapOf(
            "system.socModel" to "Dimensity 9200+", "system.boardPlatform" to "mt6985",
            "cpu.cpuParts" to "0x41:0xd46×4 / 0x41:0xd4d×3 / 0x41:0xd4e×1",
            "runtime.glesRenderer" to "Immortalis-G715",
        ))
        assertEquals(FactState.CONFIRMED, result.facts.single { it.id == "gpu" }.state)
    }

    @Test fun unlistedSocStaysUnknownInsteadOfGuessing() {
        val result = facts(mapOf(
            "memory.totalRam" to "5.51 GiB", "memory.physicalRam" to "5.50 GiB",
            "system.socModel" to "Exynos 2200",
            "cpu.cpuParts" to "0x41:0xd46×4 / 0x41:0xd48×3",
            "runtime.glesRenderer" to "Xclipse 920",
        ))
        assertEquals(1, result.confirmed)
        // gpu, capacity and cma are all unknown for an unregistered SoC; no guess.
        assertEquals(listOf(FactState.UNKNOWN, FactState.UNKNOWN, FactState.UNKNOWN, FactState.UNKNOWN),
            result.facts.filter { it.id != "ram" }.map { it.state })
    }

    @Test fun missingChannelsAreUnknownNotConflicts() {
        val result = facts(mapOf("system.socModel" to "Tensor"))
        assertTrue(result.conflicts.isEmpty())
        assertEquals(0, result.confirmed)
        assertEquals(listOf(FactState.UNKNOWN, FactState.UNKNOWN, FactState.UNKNOWN, FactState.UNKNOWN,
            FactState.UNKNOWN), result.facts.map { it.state })
    }

    // Field set 24: the capacity profile and the reserved contiguous pool are matched
    // against the registered table, so the same measured value has to be read differently
    // depending on which SoC the device claims to be.
    @Test fun foreignProfileMatchFindsTheRegisteredSocWhoseValueWasMeasured() {
        // A phone claiming to be a Dimensity 9200+ while the kernel reports the Pixel 6
        // capacity profile is a positive identification of gs101, not a guess.
        assertEquals("Tensor G1",
            foreignProfileMatch("mt6985", "160/498/1024") { it.capacities }?.label)
        // The same value measured on the SoC that declares it is not foreign at all.
        assertNull(foreignProfileMatch("gs101", "160/498/1024") { it.capacities })
        // Not in the table, absent and empty all stay unmatched rather than falling back
        // to "the first registered profile".
        assertNull(foreignProfileMatch("mt6985", "200/400") { it.capacities })
        assertNull(foreignProfileMatch("mt6985", null) { it.capacities })
        assertNull(foreignProfileMatch("mt6985", "") { it.capacities })
    }

    @Test fun foreignProfileMatchHonoursTheSelectedField() {
        // The cma field is only registered for gs101, so an unregistered capacity string
        // must not match through the other field's comparison.
        assertNull(foreignProfileMatch("mt6985", "160/498/1024") { it.cmaMiB?.let { size -> "$size MiB" } })
        assertEquals("Tensor G1",
            foreignProfileMatch("mt6985", "652 MiB") { it.cmaMiB?.let { size -> "$size MiB" } }?.label)
        assertNull(foreignProfileMatch("gs101", "652 MiB") { it.cmaMiB?.let { size -> "$size MiB" } })
    }

    @Test fun capacityConflictsWhenItMatchesAnotherRegisteredSoc() {
        val fact = facts(mapOf(
            "system.socModel" to "Dimensity 9200+", "system.boardPlatform" to "mt6985",
            "cpu.cpuCapacity" to "160/498/1024",
        )).facts.single { it.id == "capacity" }
        assertEquals(FactState.CONFLICT, fact.state)
        assertEquals("CPU 算力权重与 SoC 声明", fact.label)
        assertTrue(fact.message.contains("160/498/1024"))
        assertTrue(fact.message.contains("Tensor G1"))
    }

    @Test fun capacityConfirmsTheDeclaredSocOwnRegisteredValue() {
        val fact = facts(mapOf(
            "system.boardPlatform" to "gs101", "cpu.cpuCapacity" to "160/498/1024",
        )).facts.single { it.id == "capacity" }
        assertEquals(FactState.CONFIRMED, fact.state)
        assertTrue(fact.message.contains("Tensor G1"))
    }

    @Test fun capacityStaysUnknownWhenTheMeasurementIsNotInTheTable() {
        val fact = facts(mapOf(
            "system.boardPlatform" to "mt6985", "cpu.cpuCapacity" to "200/400",
        )).facts.single { it.id == "capacity" }
        assertEquals(FactState.UNKNOWN, fact.state)
        assertTrue(fact.message.contains("不在对照表内"))
    }

    @Test fun capacityIsUnknownWhenTheKernelReadingIsMissingOrBlank() {
        val missing = facts(mapOf("system.boardPlatform" to "gs101")).facts.single { it.id == "capacity" }
        assertEquals(FactState.UNKNOWN, missing.state)
        assertTrue(missing.message.contains("没有读到 cpu_capacity"))
        // A whitespace-only reading is a missing reading, not a conflict with gs101.
        val blank = facts(mapOf("system.boardPlatform" to "gs101", "cpu.cpuCapacity" to "   "))
            .facts.single { it.id == "capacity" }
        assertEquals(FactState.UNKNOWN, blank.state)
    }

    @Test fun cmaConflictsWhenItMatchesAnotherRegisteredSoc() {
        val fact = facts(mapOf(
            "system.socModel" to "Dimensity 9200+", "system.boardPlatform" to "mt6985",
            "memory.cmaTotal" to "652 MiB",
        )).facts.single { it.id == "cma" }
        assertEquals(FactState.CONFLICT, fact.state)
        assertEquals("连续内存池与 SoC 声明", fact.label)
        assertTrue(fact.message.contains("652 MiB"))
        assertTrue(fact.message.contains("Tensor G1"))
    }

    @Test fun cmaConfirmsTheDeclaredSocOwnRegisteredValue() {
        val fact = facts(mapOf(
            "system.boardPlatform" to "gs101", "memory.cmaTotal" to "652 MiB",
        )).facts.single { it.id == "cma" }
        assertEquals(FactState.CONFIRMED, fact.state)
        assertTrue(fact.message.contains("Tensor G1"))
    }

    @Test fun cmaStaysUnknownWhenTheMeasurementIsNotInTheTable() {
        val fact = facts(mapOf(
            "system.boardPlatform" to "mt6985", "memory.cmaTotal" to "1024 MiB",
        )).facts.single { it.id == "cma" }
        assertEquals(FactState.UNKNOWN, fact.state)
        assertTrue(fact.message.contains("不在对照表内"))
    }

    @Test fun cmaIsUnknownWhenTheReadingIsMissingOrNotInMiB() {
        val missing = facts(mapOf("system.boardPlatform" to "gs101")).facts.single { it.id == "cma" }
        assertEquals(FactState.UNKNOWN, missing.state)
        assertTrue(missing.message.contains("没有读到 CmaTotal"))
        // The collector already normalises to "N MiB"; anything else is unparsed and must
        // not be compared against a registered size.
        val unparsed = facts(mapOf("system.boardPlatform" to "mt6985", "memory.cmaTotal" to "667648 kB"))
            .facts.single { it.id == "cma" }
        assertEquals(FactState.UNKNOWN, unparsed.state)
    }

    @Test fun parsesCorePartsAndMemoryText() {
        assertEquals(setOf("0xd05", "0xd0b", "0xd44"),
            measuredCoreParts("0x41:0xd05×4 / 0x41:0xd0b×2 / 0x41:0xd44×2"))
        assertEquals(setOf("0xd05"), measuredCoreParts("0xd05×4"))
        assertTrue(measuredCoreParts(null).isEmpty())
        assertEquals(7.43, gibValue("7.43 GiB")!!, 0.001)
        assertEquals(null, gibValue("7798708 kB"))
    }
}
