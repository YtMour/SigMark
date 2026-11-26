package com.sigmark.app.collector

import android.opengl.EGL14
import android.opengl.EGLConfig
import android.opengl.GLES20
import android.os.SystemClock
import com.sigmark.app.model.DeviceInfoItem
import com.sigmark.app.model.DeviceSnapshot
import com.sigmark.app.model.ReadReason
import com.sigmark.app.model.ValueStatus
import java.nio.ByteBuffer
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.SynchronousQueue
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException

internal data class GraphicsProbe(
    val outcome: String, val stage: String, val version: String? = null,
    val renderer: String? = null, val vendor: String? = null,
)

// Keep a blocked vendor driver off the UI thread, and don't accumulate jobs.
private val probeWorker = ThreadPoolExecutor(1, 1, 15, TimeUnit.SECONDS, SynchronousQueue()) {
    Thread(it, "sigmark-egl-probe").apply { isDaemon = true }
}.apply { allowCoreThreadTimeOut(true) }

// The regular collection and the ROM experiment both need a GL reading. A very short
// cache keeps one capture from initialising EGL twice, and never reuses an old sample.
private const val probeCacheMs = 4_000L
private var cachedProbe: Pair<Long, GraphicsProbe>? = null

internal fun probeGraphics(): GraphicsProbe {
    val now = SystemClock.elapsedRealtime()
    cachedProbe?.let { (at, probe) -> if (now - at in 0..probeCacheMs) return probe }
    val task = try { probeWorker.submit<GraphicsProbe> { readback() } }
    catch (_: RejectedExecutionException) { return GraphicsProbe("not_completed", "busy") }
    val probe = try { task.get(1_800, TimeUnit.MILLISECONDS) }
    catch (_: TimeoutException) { task.cancel(true); GraphicsProbe("not_completed", "timeout") }
    catch (_: InterruptedException) { task.cancel(true); Thread.currentThread().interrupt(); GraphicsProbe("not_completed", "interrupted") }
    catch (_: Exception) { GraphicsProbe("not_completed", "driver_error") }
    if (probe.renderer != null || probe.version != null) cachedProbe = SystemClock.elapsedRealtime() to probe
    return probe
}

// A driver string is vendor text, not a device identifier. Keep it short and printable.
internal fun graphicsDriverString(raw: String?): String? = raw?.trim()
    ?.takeIf { it.isNotEmpty() && it.length <= 96 && it.none(Character::isISOControl) }

internal fun parseGlesVersion(value: String?): String? =
    value?.let { Regex("^OpenGL ES ([1-9]\\.[0-9])(?:\\s|$)").find(it)?.groupValues?.get(1) }

private fun readback(): GraphicsProbe {
    val egl = EGL14.eglGetDisplay(EGL14.EGL_DEFAULT_DISPLAY)
    if (egl == EGL14.EGL_NO_DISPLAY || !EGL14.eglInitialize(egl, IntArray(2), 0, IntArray(2), 0))
        return GraphicsProbe("fail", "display")
    var surface = EGL14.EGL_NO_SURFACE
    var context = EGL14.EGL_NO_CONTEXT
    try {
        val options = intArrayOf(EGL14.EGL_SURFACE_TYPE, EGL14.EGL_PBUFFER_BIT, EGL14.EGL_RENDERABLE_TYPE, EGL14.EGL_OPENGL_ES2_BIT,
            EGL14.EGL_RED_SIZE, 8, EGL14.EGL_GREEN_SIZE, 8, EGL14.EGL_BLUE_SIZE, 8, EGL14.EGL_NONE)
        val configs = arrayOfNulls<EGLConfig>(1)
        val count = IntArray(1)
        if (!EGL14.eglChooseConfig(egl, options, 0, configs, 0, configs.size, count, 0) || count[0] == 0)
            return GraphicsProbe("fail", "config")
        val config = configs[0] ?: return GraphicsProbe("fail", "config")
        surface = EGL14.eglCreatePbufferSurface(egl, config, intArrayOf(EGL14.EGL_WIDTH, 1, EGL14.EGL_HEIGHT, 1, EGL14.EGL_NONE), 0)
        if (surface == EGL14.EGL_NO_SURFACE) return GraphicsProbe("fail", "surface")
        context = EGL14.eglCreateContext(egl, config, EGL14.EGL_NO_CONTEXT,
            intArrayOf(EGL14.EGL_CONTEXT_CLIENT_VERSION, 2, EGL14.EGL_NONE), 0)
        if (context == EGL14.EGL_NO_CONTEXT || !EGL14.eglMakeCurrent(egl, surface, surface, context)) return GraphicsProbe("fail", "context")
        val version = parseGlesVersion(GLES20.glGetString(GLES20.GL_VERSION))
        val renderer = graphicsDriverString(GLES20.glGetString(GLES20.GL_RENDERER))
        val vendor = graphicsDriverString(GLES20.glGetString(GLES20.GL_VENDOR))
        GLES20.glClearColor(0f, 1f, 0f, 1f)
        GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT)
        val pixel = ByteBuffer.allocateDirect(4)
        GLES20.glReadPixels(0, 0, 1, 1, GLES20.GL_RGBA, GLES20.GL_UNSIGNED_BYTE, pixel)
        val correct = GLES20.glGetError() == GLES20.GL_NO_ERROR &&
            pixel.get(0).toInt() == 0 && (pixel.get(1).toInt() and 0xff) == 255 && pixel.get(2).toInt() == 0
        return if (correct) GraphicsProbe("pass", "done", version, renderer, vendor)
        else GraphicsProbe("fail", "readback", version, renderer, vendor)
    } finally {
        EGL14.eglMakeCurrent(egl, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_CONTEXT)
        if (context != EGL14.EGL_NO_CONTEXT) EGL14.eglDestroyContext(egl, context)
        if (surface != EGL14.EGL_NO_SURFACE) EGL14.eglDestroySurface(egl, surface)
        // The default EGLDisplay can be shared with the app renderer. Destroy
        // only our own resources, not the display used by other threads.
        EGL14.eglReleaseThread()
    }
}

internal fun graphicsEvidence(snapshot: DeviceSnapshot, probe: GraphicsProbe): DeviceSnapshot {
    val source = "EGL14 / GLES20.glClear + glReadPixels"
    val rows = listOf(
        DeviceInfoItem("glesProbeResult", "图形回读实测结果", probe.outcome, source,
            note = "仅验证 1×1 离屏表面能绘制并回读测试色；不是 GPU 性能或硬件真伪证明。"),
        DeviceInfoItem("glesProbeVersion", "实测上下文 GLES 版本", probe.version, "GLES20.glGetString(GL_VERSION)",
            status = if (probe.version == null) ValueStatus.UNAVAILABLE else ValueStatus.AVAILABLE,
            reason = if (probe.version == null) ReadReason.NOT_REPORTED else null,
            note = "离屏测试上下文报告的版本，不等于设备支持上限。"),
        DeviceInfoItem("glesProbeStage", "图形实测阶段", probe.stage, source,
            note = if (probe.stage == "timeout") "已停止等待驱动；若驱动仍占用工作线程，下次验收可能暂时跳过。" else null),
    )
    return snapshot.copy(sections = snapshot.sections.map { s ->
        if (s.key == "runtime") s.copy(items = s.items.filterNot { row -> rows.any { it.key == row.key } } + rows)
        else s
    })
}
