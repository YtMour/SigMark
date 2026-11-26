package com.sigmark.app.collector

import android.content.Context
import android.content.pm.PackageManager
import android.hardware.Sensor
import android.hardware.SensorDirectChannel
import android.location.LocationManager
import android.os.Build
import com.sigmark.app.model.ReadReason

internal fun codeList(vararg values: Pair<String, Boolean>) =
    values.filter { it.second }.joinToString(" / ") { it.first }.ifEmpty { "none" }

internal fun SectionBuilder.gnssObservations(context: Context) {
    val capsSource = "LocationManager.getGnssCapabilities"
    val manager = context.getSystemService(LocationManager::class.java)
    val year = if (Build.VERSION.SDK_INT < 28) SafeReader.missing(gnssYearSource, ReadReason.INTERFACE_UNSUPPORTED, "需要 API 28。")
        else SafeReader.read(gnssYearSource) { manager?.gnssYearOfHardware }
    val clockYear = java.time.Year.now(java.time.ZoneOffset.UTC).value.takeIf { it in 2000..2099 }
    observation("gnssHardwareYear", gnssYearLabel, year.map { it.toString() }.let {
        val raw = year.value
        if (raw == null) it else it.copy(detail = gnssYearDetail(raw, clockYear))
    })
    observation("gnssProvider", "Android 暴露 GPS 提供器",
        SafeReader.read("LocationManager.getAllProviders", "仅检查 provider 名称列表是否包含 GPS，不等于已搜星。") {
            gpsProvider(manager)?.let { if (it) "yes" else "no" }
        })
    val modelSource = "LocationManager.getGnssHardwareModelName"
    val model = if (Build.VERSION.SDK_INT < 28) SafeReader.missing(modelSource, ReadReason.INTERFACE_UNSUPPORTED, "需要 API 28。")
        else SafeReader.read(modelSource, "厂商返回的原始名称仅保留在本机，不用于验证型号年。") { manager?.gnssHardwareModelName }
    observation("gnssHardwareModel", "GNSS 构建型号名称（仅本机）", model)
    observation("gnssModelReported", "系统是否返回 GNSS 型号名称",
        model.map { "yes" }.let { if (it.value == null) it else it.copy(detail = "仅归档名称是否存在；不上传名称本身。") })
    val antennaSource = if (Build.VERSION.SDK_INT == 30) "$capsSource().hasGnssAntennaInfo" else "$capsSource().hasAntennaInfo"
    observation("gnssAntennaSupport", "声明支持 GNSS 天线信息",
        if (Build.VERSION.SDK_INT < 30) SafeReader.missing(antennaSource, ReadReason.INTERFACE_UNSUPPORTED, "需要 API 30。")
        else SafeReader.read(antennaSource, "仅能力声明，不读取天线信息。") {
            val capabilities = manager?.gnssCapabilities ?: return@read null
            // Android 11's public SDK exposed only this capability. Its method
            // name changed in Android 12, so the current SDK no longer links it.
            val hasAntenna = if (Build.VERSION.SDK_INT >= 31) capabilities.hasAntennaInfo()
                else capabilities.javaClass.getMethod("hasGnssAntennaInfo").invoke(capabilities) as Boolean
            if (hasAntenna) "yes" else "no"
        })
    observation("gnssCapabilities", "GNSS 高级能力",
        if (Build.VERSION.SDK_INT < 31) SafeReader.missing(capsSource, ReadReason.INTERFACE_UNSUPPORTED, "原始测量与导航消息的公开能力查询需要 API 31；Android 11 的天线声明另列。")
        else SafeReader.read(capsSource, "仅查询 Android 公布的原始测量、导航消息及天线信息能力；不访问坐标或卫星观测数据。") {
            val location = context.getSystemService(LocationManager::class.java) ?: return@read null
            val capabilities = location.gnssCapabilities
            codeList("measurements" to capabilities.hasMeasurements(), "navigation_message" to capabilities.hasNavigationMessages(),
                "antenna_info" to capabilities.hasAntennaInfo())
        })
}

internal fun declaredInput(pm: PackageManager): String =
    codeList("touchscreen" to pm.hasSystemFeature(PackageManager.FEATURE_TOUCHSCREEN),
        "multitouch" to pm.hasSystemFeature(PackageManager.FEATURE_TOUCHSCREEN_MULTITOUCH),
        "multitouch_distinct" to pm.hasSystemFeature(PackageManager.FEATURE_TOUCHSCREEN_MULTITOUCH_DISTINCT),
        "jazzhand" to pm.hasSystemFeature(PackageManager.FEATURE_TOUCHSCREEN_MULTITOUCH_JAZZHAND),
        "gamepad" to pm.hasSystemFeature(PackageManager.FEATURE_GAMEPAD))

internal fun reportingModes(modes: List<Int>): String {
    val counts = modes.groupingBy { it }.eachCount()
    val known = (0..3).map { counts[it] ?: 0 }
    return (known + (modes.size - known.sum())).joinToString("/")
}

internal fun SectionBuilder.sensorObservations(reading: ReadResult<List<Sensor>>) {
    observation("reportingModes", "传感器上报模式分布", reading.map { reportingModes(it.map(Sensor::getReportingMode)) }
        .let { if (it.value != null) it.copy(detail = "连续 / 变化触发 / 一次性 / 特殊触发 / 其他，单位为公开传感器条目数。") else it })
    observation("fifoCount", "支持 FIFO 批处理的传感器数", reading.map { rows -> rows.count { it.fifoMaxEventCount > 0 }.toString() }
        .let { if (it.value != null) it.copy(detail = "按 Sensor.getFifoMaxEventCount 大于 0 计数；未发起传感器采样。") else it })
    observation("directChannelTypes", "传感器直通通道类型", reading.map { rows ->
        codeList("memory_file" to rows.any { it.isDirectChannelTypeSupported(SensorDirectChannel.TYPE_MEMORY_FILE) },
            "hardware_buffer" to rows.any { it.isDirectChannelTypeSupported(SensorDirectChannel.TYPE_HARDWARE_BUFFER) })
    }.let { if (it.value != null) it.copy(detail = "至少一个公开传感器声明的能力；不创建直通通道。") else it })
}

internal val coreHardwareKeys = setOf(
    "system.gnssHardwareYear", "system.gnssCapabilities", "runtime.declaredInput",
    "sensors.reportingModes", "sensors.fifoCount", "sensors.directChannelTypes", "media.cameraModes",
)
internal val graphicsHardwareKeys = setOf("runtime.glesProbeResult", "runtime.glesProbeVersion", "runtime.glesProbeStage")
// Field set 22: the readings that do not come from the device's own declarations.
// Field set 24 adds the kernel's capacity profile and reserved contiguous pool.
internal val measuredHardwareKeys = setOf(
    "cpu.cpuParts", "memory.physicalRam", "memory.kernelMemTotal",
    "runtime.glesRenderer", "runtime.glesVendor",
    "cpu.cpuCapacity", "memory.cmaTotal",
)
internal val expandedHardwareKeys = coreHardwareKeys + graphicsHardwareKeys + measuredHardwareKeys +
    setOf("cpu.processBitness", "cpu.kernelMachine", "system.interfaceCapabilities", "runtime.externalInputTypes",
        "system.gnssProvider", "system.gnssHardwareModel", "system.gnssModelReported", "system.gnssAntennaSupport") +
    gnssCheckKeys.map { "system.$it" }
