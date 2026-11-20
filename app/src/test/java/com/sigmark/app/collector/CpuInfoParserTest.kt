package com.sigmark.app.collector

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class CpuInfoParserTest {
    @Test fun parsesArmCpuWithoutHardwareName() {
        val fields = CpuInfoParser.fields("""
            processor : 0
            Features : fp asimd aes aes
            CPU implementer : 0x41
            CPU architecture : 8
            CPU part : 0xd05
        """.trimIndent())
        assertEquals("implementer 0x41 · part 0xd05 · architecture 8",
            CpuInfoParser.description(fields))
        assertEquals("fp, asimd, aes", CpuInfoParser.features(fields))
    }

    @Test fun prefersVendorHardwareName() {
        val fields = CpuInfoParser.fields("Hardware : Tensor\nCPU part : 0xd05")
        assertEquals("Tensor", CpuInfoParser.description(fields))
        assertNull(CpuInfoParser.features(fields))
    }
}
