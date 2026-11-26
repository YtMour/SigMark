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

    @Test fun countsEveryProcessorBlockForThePartSignature() {
        val text = """
            processor   : 0
            CPU implementer : 0x41
            CPU part    : 0xd05

            processor   : 4
            CPU implementer : 0x41
            CPU part    : 0xd0b

            processor   : 6
            CPU implementer : 0x41
            CPU part    : 0xd44
        """.trimIndent()
        // The deduplicated map still keeps only the first block, so the signature is the
        // only reading that shows a mixed cluster.
        assertEquals("0xd05", CpuInfoParser.fields(text)["cpu part"])
        assertEquals("0x41:0xd05×1 / 0x41:0xd0b×1 / 0x41:0xd44×1", CpuInfoParser.partSignature(text))
    }

    @Test fun partSignatureAggregatesRepeatedCoresAndSkipsUnknownLines() {
        val text = (0..7).joinToString("\n") { core ->
            val part = when (core) { 0 -> "0xd44"; 1, 2 -> "0xd0b"; else -> "0xd05" }
            "processor : $core\nCPU implementer : 0x41\nCPU part : $part\nCPU revision : 0"
        }
        assertEquals("0x41:0xd05×5 / 0x41:0xd0b×2 / 0x41:0xd44×1", CpuInfoParser.partSignature(text))
        assertNull(CpuInfoParser.partSignature("Hardware : Tensor\nBogoMIPS : 38.40"))
        assertNull(CpuInfoParser.partSignature("CPU part : not-a-code"))
    }
}

