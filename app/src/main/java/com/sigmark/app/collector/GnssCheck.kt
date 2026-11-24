package com.sigmark.app.collector

import android.annotation.SuppressLint
import android.content.Context
import android.location.GnssMeasurementsEvent
import android.location.GnssStatus
import android.location.LocationListener
import android.location.LocationManager
import android.os.Handler
import android.os.Looper
import com.sigmark.app.CollectionAccess
import com.sigmark.app.model.DeviceInfoItem
import com.sigmark.app.model.DeviceSnapshot
import com.sigmark.app.model.ReadReason
import com.sigmark.app.model.ValueStatus
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull

internal const val gnssWaitMs = 20_000L
internal const val gnssYearLabel = "GNSS 硬件与软件型号年"
internal const val gnssYearSource = "LocationManager.getGnssYearOfHardware"
private const val statusSource = "LocationManager.registerGnssStatusCallback"
private const val measurementsSource = "LocationManager.registerGnssMeasurementsCallback"

internal enum class GnssYearQuality { BEFORE_2016, BELOW_MIN, FUTURE, REPORTED, CLOCK_UNKNOWN }
internal fun gnssYearQuality(raw: Int, sampleYear: Int?) = when {
    raw == 0 -> GnssYearQuality.BEFORE_2016
    raw < 2016 -> GnssYearQuality.BELOW_MIN
    sampleYear == null -> GnssYearQuality.CLOCK_UNKNOWN
    raw > sampleYear -> GnssYearQuality.FUTURE
    else -> GnssYearQuality.REPORTED
}

internal fun gnssYearDetail(raw: Int, sampleYear: Int?) = when(gnssYearQuality(raw, sampleYear)) {
    GnssYearQuality.BEFORE_2016 -> "接口返回 0：Android 定义为型号年早于 2016，没有具体年份；还应结合 GPS 提供器检查。"
    GnssYearQuality.BELOW_MIN -> "接口返回非零且小于 2016，偏离公开 API 语义；保留原始值供复核。"
    GnssYearQuality.FUTURE -> "读数晚于设备采样墙钟的 UTC 年份；请核对设备时间和系统报告。"
    GnssYearQuality.CLOCK_UNKNOWN -> "采样年份未知；未检查是否为未来值。"
    GnssYearQuality.REPORTED -> "这是 Android 报告的 GNSS 硬件与软件构建型号年，不是芯片生产年或整机上市年。"
}

internal enum class GnssPrerequisite(val code: String, val title: String) {
    READY("ready", "精确位置已授权，系统位置已开启"),
    PERMISSION("permission_required", "未授权精确位置"),
    LOCATION_OFF("location_disabled", "系统位置已关闭"),
    LOCATION_UNKNOWN("location_unknown", "系统位置状态未知"),
    NO_PROVIDER("provider_missing", "Android 未暴露 GPS 提供器"),
}
internal fun gnssPrerequisite(access: CollectionAccess, hasProvider: Boolean?) = when {
    !access.fine -> GnssPrerequisite.PERMISSION
    access.location == false -> GnssPrerequisite.LOCATION_OFF
    access.location == null || hasProvider == null -> GnssPrerequisite.LOCATION_UNKNOWN
    !hasProvider -> GnssPrerequisite.NO_PROVIDER
    else -> GnssPrerequisite.READY
}

internal data class GnssCheck(
    val start: ProbeTime, val end: ProbeTime, val prerequisite: GnssPrerequisite,
    val status: ReadResult<String>, val measurements: ReadResult<String>,
)

private fun blocked(source: String, condition: GnssPrerequisite): ReadResult<String> = when (condition) {
    GnssPrerequisite.PERMISSION, GnssPrerequisite.LOCATION_OFF ->
        ReadResult(null, ValueStatus.RESTRICTED, source, condition.title,
            if (condition == GnssPrerequisite.PERMISSION) ReadReason.PERMISSION_REQUIRED else ReadReason.LOCATION_DISABLED)
    else -> SafeReader.missing(source,
        if (condition == GnssPrerequisite.NO_PROVIDER) ReadReason.INTERFACE_UNSUPPORTED else ReadReason.NOT_REPORTED, condition.title)
}

internal class GnssCallbackEvidence {
    var hasStatus = false
        private set
    var hasMeasurements = false
        private set
    val complete get() = hasStatus && hasMeasurements
    fun satellites(nonEmpty: Boolean) { hasStatus = hasStatus || nonEmpty }
    fun measurements(nonEmpty: Boolean) { hasMeasurements = hasMeasurements || nonEmpty }
}

internal fun gpsProvider(manager: LocationManager?) = manager?.allProviders?.contains(LocationManager.GPS_PROVIDER)

// No location properties are read. The empty listener only requests foreground GPS
// activation on devices which do not otherwise start GNSS for callback registration.
@SuppressLint("MissingPermission")
internal suspend fun runGnssCheck(context: Context): GnssCheck = withContext(Dispatchers.Main.immediate) {
    val start = ProbeTime.now()
    val lm = context.getSystemService(LocationManager::class.java)
    val provider = SafeReader.read("LocationManager.getAllProviders") { gpsProvider(lm) }
    val condition = gnssPrerequisite(CollectionAccess.read(context), provider.value)
    fun result(status: ReadResult<String>, measurements: ReadResult<String>) =
        GnssCheck(start, ProbeTime.now(), condition, status, measurements)
    if (condition != GnssPrerequisite.READY || lm == null)
        return@withContext result(blocked(statusSource, condition), blocked(measurementsSource, condition))

    val evidence = GnssCallbackEvidence()
    val done = CompletableDeferred<Unit>()
    val handler = Handler(Looper.getMainLooper())
    val status = object : GnssStatus.Callback() {
        override fun onSatelliteStatusChanged(status: GnssStatus) {
            evidence.satellites(status.satelliteCount > 0)
            if (evidence.complete) done.complete(Unit)
        }
    }
    val measurements = object : GnssMeasurementsEvent.Callback() {
        override fun onGnssMeasurementsReceived(event: GnssMeasurementsEvent) {
            evidence.measurements(event.measurements.isNotEmpty())
            if (evidence.complete) done.complete(Unit)
        }
    }
    val activation = object : LocationListener {
        override fun onLocationChanged(location: android.location.Location) = Unit
        @Deprecated("Legacy listener method")
        override fun onStatusChanged(provider: String?, status: Int, extras: android.os.Bundle?) = Unit
        @Deprecated("Legacy listener method")
        override fun onProviderDisabled(provider: String) { done.complete(Unit) }
        override fun onProviderEnabled(provider: String) = Unit
    }
    fun channel(registration: ReadResult<Boolean>, observed: Boolean, gps: ReadResult<Boolean>): ReadResult<String> = when {
        observed -> ReadResult("observed", ValueStatus.AVAILABLE, registration.source, "在前台窗口内收到非空事件。")
        registration.value == false -> SafeReader.missing(registration.source, ReadReason.NOT_REPORTED, "Android 未接受回调注册；未取得实测证据。")
        registration.value == null -> registration.map { null }
        gps.value == null -> ReadResult(null, gps.status, registration.source, "启动 GPS 观察失败：${gps.detail.orEmpty()}", gps.reason)
        SafeReader.read("LocationManager.isProviderEnabled") { lm.isProviderEnabled(LocationManager.GPS_PROVIDER) }.value == false ->
            ReadResult(null, ValueStatus.RESTRICTED, registration.source, "观察期间 GPS 提供器被关闭。", ReadReason.LOCATION_DISABLED)
        else -> ReadResult("not_seen", ValueStatus.AVAILABLE, registration.source, "观察窗口内没有收到非空事件，不代表硬件故障或不支持。")
    }
    try {
        val a = SafeReader.read(statusSource) { lm.registerGnssStatusCallback(status, handler) }
        val b = SafeReader.read(measurementsSource) { lm.registerGnssMeasurementsCallback(measurements, handler) }
        val activated = if (a.value == true || b.value == true) SafeReader.read("LocationManager.requestLocationUpdates") {
            lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, 1000L, 0f, activation, handler.looper)
            true
        } else ReadResult(false, ValueStatus.AVAILABLE, "LocationManager.requestLocationUpdates")
        if (activated.value == true) withTimeoutOrNull(gnssWaitMs) { done.await() }
        result(channel(a, evidence.hasStatus, activated), channel(b, evidence.hasMeasurements, activated))
    } finally {
        runCatching { lm.removeUpdates(activation) }
        runCatching { lm.unregisterGnssStatusCallback(status) }
        runCatching { lm.unregisterGnssMeasurementsCallback(measurements) }
    }
}

internal val gnssCheckKeys = setOf("gnssCheckPrerequisite", "gnssCheckStatus", "gnssCheckMeasurements", "gnssCheckStartAt", "gnssCheckEndAt", "gnssCheckElapsed")
internal fun gnssEvidence(snapshot: DeviceSnapshot, check: GnssCheck): DeviceSnapshot {
    val elapsed = (check.end.mono - check.start.mono).coerceAtLeast(0)
    return withExperimentFields(snapshot, "system", listOf(
        DeviceInfoItem("gnssCheckPrerequisite", "GNSS 实测起点条件", check.prerequisite.code,
            "Context.checkSelfPermission / LocationManager", note = check.prerequisite.title),
        check.status.copy(errno = null).item("gnssCheckStatus", "GNSS 状态回调"),
        check.measurements.copy(errno = null).item("gnssCheckMeasurements", "GNSS 测量回调"),
        clockEvidence("gnssCheckStartAt", "GNSS 实测开始时间", check.start.wall),
        clockEvidence("gnssCheckEndAt", "GNSS 实测结束时间", check.end.wall),
        DeviceInfoItem("gnssCheckElapsed", "GNSS 观测用时", "$elapsed ms", "SystemClock.elapsedRealtime"),
    ))
}
