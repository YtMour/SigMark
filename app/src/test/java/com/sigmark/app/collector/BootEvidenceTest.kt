package com.sigmark.app.collector

import org.junit.Assert.assertEquals
import org.junit.Test

class BootEvidenceTest {
    @Test fun sharedBootScenarios() {
        requireNotNull(javaClass.getResourceAsStream("/security-boot.tsv")).bufferedReader().useLines { rows ->
            rows.forEach {
                val (a,b,c,expected) = it.split('\t')
                assertEquals(it, expected, bootEvidence(a.takeUnless { a=="-" }, b.takeUnless { b=="-" }, c.takeUnless { c=="-" }))
            }
        }
    }
}
