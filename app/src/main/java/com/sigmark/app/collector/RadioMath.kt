package com.sigmark.app.collector

import java.util.Locale

internal object RadioMath {
    data class WifiChannel(val band: String, val channel: Int?)

    fun wifi(frequency: Int): WifiChannel? = when (frequency) {
        2484 -> WifiChannel("2.4 GHz", 14)
        in 2412..2472 -> WifiChannel("2.4 GHz", channel(frequency, 2407, 5))
        in 4910..4980 -> WifiChannel("4.9 GHz", channel(frequency, 4000, 5))
        in 5005..5895 -> WifiChannel("5 GHz", channel(frequency, 5000, 5))
        5935 -> WifiChannel("6 GHz", 2)
        in 5955..7115 -> WifiChannel("6 GHz", channel(frequency, 5950, 5))
        in 58320..69120 -> WifiChannel("60 GHz", channel(frequency, 56160, 2160))
        else -> null
    }

    private fun channel(frequency: Int, base: Int, spacing: Int): Int? =
        if ((frequency - base) % spacing == 0) (frequency - base) / spacing else null

    // 3GPP TS 38.104 §5.4.2.1: integer kHz avoids rounding at range boundaries.
    fun nrKhz(arfcn: Int): Int? = when (arfcn) {
        in 0..599999 -> arfcn * 5
        in 600000..2016666 -> 3_000_000 + (arfcn - 600000) * 15
        in 2016667..3279165 -> 24_250_080 + (arfcn - 2016667) * 60
        else -> null
    }

    private data class LteRange(val band: Int, val first: Int, val last: Int, val baseKhz: Int)
    // Common downlink EARFCN ranges, 3GPP TS 36.101 §5.7.3. Omitted ranges are not guessed.
    private val lte = listOf(
        LteRange(1, 0, 599, 2_110_000), LteRange(2, 600, 1199, 1_930_000), LteRange(3, 1200, 1949, 1_805_000),
        LteRange(4, 1950, 2399, 2_110_000), LteRange(5, 2400, 2649, 869_000), LteRange(7, 2750, 3449, 2_620_000),
        LteRange(8, 3450, 3799, 925_000), LteRange(12, 5010, 5179, 729_000), LteRange(13, 5180, 5279, 746_000),
        LteRange(20, 6150, 6449, 791_000), LteRange(25, 8040, 8689, 1_930_000), LteRange(26, 8690, 9039, 859_000),
        LteRange(28, 9210, 9659, 758_000), LteRange(38, 37750, 38249, 2_570_000), LteRange(39, 38250, 38649, 1_880_000),
        LteRange(40, 38650, 39649, 2_300_000), LteRange(41, 39650, 41589, 2_496_000),
        LteRange(66, 66436, 67335, 2_110_000), LteRange(71, 68586, 68935, 617_000),
    )

    fun lteBandForEarfcn(earfcn: Int): Int? = lte.firstOrNull { earfcn in it.first..it.last }?.band

    fun lteDownlinkKhz(earfcn: Int): Int? = lte.firstOrNull { earfcn in it.first..it.last }
        ?.let { it.baseKhz + (earfcn - it.first) * 100 }

    // Downlink band edges, not a carrier centre frequency. Selected common bands only.
    private val lteBandEdges = mapOf(
        1 to (2110 to 2170), 2 to (1930 to 1990), 3 to (1805 to 1880),
        4 to (2110 to 2155), 5 to (869 to 894), 7 to (2620 to 2690), 8 to (925 to 960), 20 to (791 to 821),
        12 to (729 to 746), 13 to (746 to 756), 25 to (1930 to 1995), 26 to (859 to 894),
        28 to (758 to 803), 38 to (2570 to 2620), 39 to (1880 to 1920),
        40 to (2300 to 2400), 41 to (2496 to 2690), 66 to (2110 to 2200), 71 to (617 to 652),
    )

    fun lteBandRanges(bands: List<Int>): String? = bands.distinct().mapNotNull { band ->
        lteBandEdges[band]?.let { (low, high) -> "B$band：$low–$high MHz" }
    }.takeIf { it.isNotEmpty() }?.joinToString(" / ")

    fun mhz(khz: Int): String = String.format(Locale.ROOT, "%.3f MHz", khz / 1000.0)
}
