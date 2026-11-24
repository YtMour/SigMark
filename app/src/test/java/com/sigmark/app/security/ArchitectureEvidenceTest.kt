package com.sigmark.app.security

import com.sigmark.app.collector.kernelMachineName
import com.sigmark.app.model.DeviceInfoItem
import com.sigmark.app.model.ValueStatus
import org.junit.Assert.assertEquals
import org.junit.Test
import java.util.Locale

class ArchitectureEvidenceTest {
    @Test fun sharedScenarios() {
        requireNotNull(javaClass.getResourceAsStream("/runtime-architecture.tsv")).bufferedReader().useLines { rows ->
            rows.forEach {
                val (process, abis, machine, expected) = it.split('\t')
                fun absent(s: String) = s.takeUnless { it == "-" }
                assertEquals(it, expected, architectureEvidence(absent(process), absent(abis), absent(machine)).name.lowercase(Locale.ROOT))
            }
        }
    }

    @Test fun aRestrictedObservationDoesNotCreateAnArchitectureFinding() {
        val fields = listOf("64", "x86", "aarch64").mapIndexed { i, value ->
            val key = architectureKeys[i]
            key to DeviceInfoItem(key, key, value, "fixture", if (i == 0) ValueStatus.RESTRICTED else ValueStatus.AVAILABLE)
        }.toMap()
        assertEquals(Finding.UNKNOWN, devicePosture(fields, 0).first { it.id == "runtime_architecture" }.state)
        assertEquals("aarch64", kernelMachineName(" AARCH64 "))
        assertEquals(null, kernelMachineName("aarch64 / extra value"))
    }
}
