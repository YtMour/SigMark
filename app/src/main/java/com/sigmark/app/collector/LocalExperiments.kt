package com.sigmark.app.collector

import com.sigmark.app.model.DeviceSnapshot
import kotlinx.coroutines.CancellationException

internal suspend fun captureLocalExperiments(
    snapshot: DeviceSnapshot,
    plan: CapturePlan,
    decode: suspend () -> DecodeResult,
    graphics: suspend () -> GraphicsProbe,
    clock: () -> Long = System::currentTimeMillis,
): DeviceSnapshot {
    if (!plan.runsLocalExperiments) return acceptanceEvidence(snapshot, plan, null)

    val avcStart = clock()
    val video = try {
        decode()
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        DecodeResult(DecodeStage.SOURCE, null, null, null, null, "首帧测试初始化异常：${e.javaClass.simpleName}")
    }
    val avcEnd = clock()
    val media = withExperimentFields(acceptanceEvidence(snapshot, plan, video), "media", listOf(
        clockEvidence("avcStartAt", "AVC 实验起点时间", avcStart),
        clockEvidence("avcEndAt", "AVC 实验结束时间", avcEnd),
    ))
    val glesStart = clock()
    val graphic = try {
        graphics()
    } catch (e: CancellationException) {
        throw e
    } catch (_: Exception) {
        GraphicsProbe("not_completed", "driver_error")
    }
    return withExperimentFields(graphicsEvidence(media, graphic), "runtime", listOf(
        clockEvidence("glesStartAt", "GLES 实验起点时间", glesStart),
        clockEvidence("glesEndAt", "GLES 实验结束时间", clock()),
    ))
}
