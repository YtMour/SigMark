package com.sigmark.app.collector

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class RadioMathTest {
    @Test fun bandEdgesAreNotCarrierCentres() {
        assertEquals("B3：1805–1880 MHz / B41：2496–2690 MHz",
            RadioMath.lteBandRanges(listOf(3, 3, 41, 999)))
        assertNull(RadioMath.lteBandRanges(listOf(0, 999)))
    }

    @Test fun wifiHandlesSpecialAndCommonChannels() {
        assertEquals(RadioMath.WifiChannel("2.4 GHz", 1), RadioMath.wifi(2412))
        assertEquals(RadioMath.WifiChannel("2.4 GHz", 14), RadioMath.wifi(2484))
        assertEquals(RadioMath.WifiChannel("5 GHz", 149), RadioMath.wifi(5745))
        assertEquals(RadioMath.WifiChannel("6 GHz", 2), RadioMath.wifi(5935))
        assertEquals(RadioMath.WifiChannel("6 GHz", 233), RadioMath.wifi(7115))
        assertEquals(RadioMath.WifiChannel("60 GHz", 1), RadioMath.wifi(58320))
        assertEquals(RadioMath.WifiChannel("5 GHz", null), RadioMath.wifi(5746))
        assertNull(RadioMath.wifi(0))
    }

    @Test fun lteUsesDownlinkRasterAndAvoidsUnknownBands() {
        assertEquals(3, RadioMath.lteBandForEarfcn(1625))
        assertEquals(39, RadioMath.lteBandForEarfcn(38250))
        assertNull(RadioMath.lteBandForEarfcn(5000))
        assertEquals(2110000, RadioMath.lteDownlinkKhz(0))
        assertEquals(1847500, RadioMath.lteDownlinkKhz(1625))
        assertEquals(2593000, RadioMath.lteDownlinkKhz(40620))
        assertNull(RadioMath.lteDownlinkKhz(5000))
        assertNull(RadioMath.lteDownlinkKhz(Int.MAX_VALUE))
    }

    @Test fun nrRespectsAllRasterBoundaries() {
        assertEquals(2999995, RadioMath.nrKhz(599999))
        assertEquals(3000000, RadioMath.nrKhz(600000))
        assertEquals(3300000, RadioMath.nrKhz(620000))
        assertEquals(24249990, RadioMath.nrKhz(2016666))
        assertEquals(24250080, RadioMath.nrKhz(2016667))
        assertEquals(99999960, RadioMath.nrKhz(3279165))
        assertNull(RadioMath.nrKhz(3279166))
        assertEquals("3300.000 MHz", RadioMath.mhz(3300000))
    }
}
