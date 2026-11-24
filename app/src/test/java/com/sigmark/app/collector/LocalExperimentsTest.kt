package com.sigmark.app.collector

import com.sigmark.app.model.DeviceSection
import com.sigmark.app.model.DeviceSnapshot
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LocalExperimentsTest {
    private val snapshot = DeviceSnapshot(1_790_000_000_000, listOf(
        DeviceSection("environment", "Environment", emptyList()),
        DeviceSection("media", "Media", emptyList()),
        DeviceSection("runtime", "Runtime", emptyList()),
    ))

    private fun DeviceSnapshot.value(group: String, key: String) =
        sections.single { it.key == group }.items.firstOrNull { it.key == key }?.value

    @Test fun wholeCaptureRunsBothExperimentsAndRecordsTime() = runBlocking {
        var now = 1_790_000_000_000L
        val result = captureLocalExperiments(snapshot, CapturePlan.FULL,
            decode = { DecodeResult(DecodeStage.DONE, 1, "fixture", false, 20, null) },
            graphics = { GraphicsProbe("pass", "done", "3.2") },
            clock = { now++ },
        )
        assertEquals("full", result.value("environment", "capturePlan"))
        assertEquals("pass", result.value("media", "avcFirstFrame"))
        assertEquals("1790000000000", result.value("media", "avcStartAt"))
        assertEquals("pass", result.value("runtime", "glesProbeResult"))
        assertEquals("1790000000003", result.value("runtime", "glesEndAt"))
    }

    @Test fun oneFailedExperimentStillRecordsTheOther() = runBlocking {
        val result = captureLocalExperiments(snapshot, CapturePlan.ROM,
            decode = { error("fixture") }, graphics = { GraphicsProbe("pass", "done") })
        assertEquals("rom", result.value("environment", "capturePlan"))
        assertEquals("fail", result.value("media", "avcFirstFrame"))
        assertEquals("pass", result.value("runtime", "glesProbeResult"))
    }

    @Test fun otherPlansDoNotRunLocalExperiments() = runBlocking {
        var ran = false
        val result = captureLocalExperiments(snapshot, CapturePlan.NETWORK,
            decode = { ran = true; error("unexpected") }, graphics = { ran = true; error("unexpected") })
        assertTrue(!ran)
        assertNull(result.value("media", "avcFirstFrame"))
        assertNull(result.value("runtime", "glesProbeResult"))
    }

    @Test fun cancellationStopsTheNextExperiment() = runBlocking {
        val result = runCatching {
            captureLocalExperiments(snapshot, CapturePlan.FULL,
                decode = { throw CancellationException("fixture") }, graphics = { error("unexpected") })
        }
        assertTrue(result.exceptionOrNull() is CancellationException)
    }
}
