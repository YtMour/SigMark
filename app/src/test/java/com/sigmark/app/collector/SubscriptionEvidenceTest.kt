package com.sigmark.app.collector

import org.junit.Assert.*
import org.junit.Test

class SubscriptionEvidenceTest {
    @Test fun bandwidthListPreservesCarriersAndRejectsSentinels() {
        assertNull(formatCarrierBandwidths(null))
        assertNull(formatCarrierBandwidths(intArrayOf(0, -1, Int.MAX_VALUE)))
        assertEquals("10000 kHz / 20000 kHz / 10000 kHz",
            formatCarrierBandwidths(intArrayOf(10000, 20000, Int.MAX_VALUE, 10000)))
        assertEquals(16, formatCarrierBandwidths(IntArray(30) { 20000 })!!.split(" / ").size)
    }
}
