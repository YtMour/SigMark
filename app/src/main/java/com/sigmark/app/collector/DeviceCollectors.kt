package com.sigmark.app.collector

import android.app.ActivityManager
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.hardware.Sensor
import android.hardware.SensorManager
import android.hardware.display.DisplayManager
import android.os.BatteryManager
import android.os.Build
import android.os.Environment
import android.os.StatFs
import android.os.SystemClock
import android.system.Os
import android.system.OsConstants
import com.sigmark.app.model.DeviceInfoItem
import com.sigmark.app.model.DeviceSection
import com.sigmark.app.model.DeviceSnapshot
import com.sigmark.app.model.ReadReason
import com.sigmark.app.model.ValueStatus
import com.sigmark.app.model.normalizeValue
import java.util.Locale

interface DeviceCollector {
    val key: String
    val title: String
    fun collect(context: Context): DeviceSection
}

private class SectionBuilder(private val key: String, private val title: String) {
    private val items = mutableListOf<DeviceInfoItem>()

    fun value(key: String, label: String, source: String, note: String? = null, block: () -> String?) {
        items += SafeReader.read(source, note) { normalizeValue(block()) }.item(key, label)
    }

    fun observation(key: String, label: String, result: ReadResult<String>) {
        items += result.item(key, label)
    }

    fun add(items: List<DeviceInfoItem>) { this.items += items }

    fun build() = DeviceSection(key, title, items.toList())
}

private fun section(key: String, title: String, block: SectionBuilder.() -> Unit): DeviceSection =
    SectionBuilder(key, title).apply(block).build()

private fun bytes(value: Long): String = String.format(Locale.US, "%.2f GiB", value / 1073741824.0)

private object SystemCollector : DeviceCollector {
    override val key = "system"
    override val title = "系统与固件"
    override fun collect(context: Context) = section(key, title) {
        value("release", "Android 版本", "Build.VERSION.RELEASE") { Build.VERSION.RELEASE }
        value("api", "API 级别", "Build.VERSION.SDK_INT") { Build.VERSION.SDK_INT.toString() }
        value("patch", "安全补丁", "Build.VERSION.SECURITY_PATCH") { Build.VERSION.SECURITY_PATCH }
        value("fingerprint", "构建指纹", "Build.FINGERPRINT", "应用进程视角；可能与 ADB 属性不同") { Build.FINGERPRINT }
        value("buildId", "构建 ID", "Build.ID") { Build.ID }
        value("display", "构建显示名", "Build.DISPLAY") { Build.DISPLAY }
        value("incremental", "增量构建号", "Build.VERSION.INCREMENTAL") { Build.VERSION.INCREMENTAL }
        value("type", "构建类型", "Build.TYPE") { Build.TYPE }
        value("tags", "构建标签", "Build.TAGS") { Build.TAGS }
        value("manufacturer", "制造商", "Build.MANUFACTURER") { Build.MANUFACTURER }
        value("brand", "品牌", "Build.BRAND") { Build.BRAND }
        value("model", "型号", "Build.MODEL", "应用进程视角") { Build.MODEL }
        value("device", "设备代号", "Build.DEVICE", "应用进程视角") { Build.DEVICE }
        value("product", "产品代号", "Build.PRODUCT") { Build.PRODUCT }
        value("bootloader", "Bootloader", "Build.BOOTLOADER") { Build.BOOTLOADER }
        value("uptime", "开机时长", "SystemClock.elapsedRealtime") {
            val minutes = SystemClock.elapsedRealtime() / 60_000
            "${minutes / 1440} 天 ${minutes % 1440 / 60} 小时 ${minutes % 60} 分钟"
        }
        add(SelinuxProbe.collect())
        val hints = listOf(SafeReader.Property.HYPEROS, SafeReader.Property.MIUI,
            SafeReader.Property.COLOR_OS, SafeReader.Property.ONE_UI)
        val hint = hints.asSequence().map(SafeReader::property).firstOrNull { it.value != null }
        observation("romHint", "ROM 版本线索",
            hint?.copy(detail = "厂商属性，仅反映当前应用读取结果。") ?: SafeReader.missing(
                hints.joinToString(" / ") { it.key }, ReadReason.NOT_REPORTED, "常见厂商属性未返回可用值。"))
    }
}

private object CpuCollector : DeviceCollector {
    override val key = "cpu"
    override val title = "内核与 CPU"
    override fun collect(context: Context) = section(key, title) {
        value("kernel", "内核版本", "System.getProperty(os.version)") { System.getProperty("os.version") }
        value("kernelFull", "内核编译信息", "Os.uname()", "通过 uname 获取；/proc/version 在部分设备上禁止读取") {
            val uts = Os.uname()
            "${uts.sysname} ${uts.release} ${uts.version} ${uts.machine}"
        }
        value("abis", "支持的 ABI", "Build.SUPPORTED_ABIS") { Build.SUPPORTED_ABIS.joinToString(", ") }
        value("hardware", "硬件代号", "Build.HARDWARE") { Build.HARDWARE }
        value("cores", "可用逻辑核心", "Runtime.availableProcessors") {
            Runtime.getRuntime().availableProcessors().toString()
        }
        value("pageSize", "内存页大小", "Os.sysconf(_SC_PAGESIZE)") {
            "${Os.sysconf(OsConstants._SC_PAGESIZE)} B"
        }
        val cpuFields = SafeReader.node(SafeReader.Node.CPU_INFO).map(CpuInfoParser::fields)
        observation("cpuInfo", "CPU 描述", cpuFields.map(CpuInfoParser::description))
        observation("features", "CPU 指令特性", cpuFields.map(CpuInfoParser::features))
        val frequency = SafeReader.node(SafeReader.Node.CPU0_MAX).map {
            it.trim().toLongOrNull()?.takeIf { khz -> khz > 0 }?.let { khz ->
                String.format(Locale.US, "%.0f MHz", khz / 1000.0)
            }
        }
        observation("cpu0MaxFrequency", "首核最高频率",
            if (frequency.value != null) frequency.copy(detail = "首核样本，不代表整颗处理器峰值。") else frequency)
    }
}

private object MemoryCollector : DeviceCollector {
    override val key = "memory"
    override val title = "内存与存储"
    override fun collect(context: Context) = section(key, title) {
        val info = ActivityManager.MemoryInfo()
        val memory = context.getSystemService(ActivityManager::class.java)
        memory?.getMemoryInfo(info)
        value("totalRam", "总运行内存", "ActivityManager.MemoryInfo.totalMem") {
            if (memory == null) null else bytes(info.totalMem)
        }
        value("availableRam", "可用运行内存", "ActivityManager.MemoryInfo.availMem") {
            if (memory == null) null else bytes(info.availMem)
        }
        value("lowMemory", "低内存状态", "ActivityManager.MemoryInfo.lowMemory") {
            if (memory == null) null else if (info.lowMemory) "是" else "否"
        }
        value("lowMemoryThreshold", "低内存阈值", "ActivityManager.MemoryInfo.threshold") {
            if (memory == null) null else bytes(info.threshold)
        }
        observation("swap", "Swap 总量", SafeReader.node(SafeReader.Node.MEM_INFO).map { text ->
            text.lineSequence().firstOrNull { it.startsWith("SwapTotal:") }?.substringAfter(':')?.trim()
        })
        value("internalTotal", "内部存储总量", "StatFs(dataDirectory)") {
            bytes(StatFs(Environment.getDataDirectory().path).totalBytes)
        }
        value("internalAvailable", "内部存储可用", "StatFs(dataDirectory)") {
            bytes(StatFs(Environment.getDataDirectory().path).availableBytes)
        }
        value("sharedState", "共享存储状态", "Environment.getExternalStorageState") {
            Environment.getExternalStorageState()
        }
    }
}

private object DisplayCollector : DeviceCollector {
    override val key = "display"
    override val title = "屏幕与显示"
    override fun collect(context: Context) = section(key, title) {
        val metrics = context.resources.displayMetrics
        val config = context.resources.configuration
        val display = context.getSystemService(DisplayManager::class.java)?.getDisplay(0)
        value("resolution", "当前显示模式分辨率", "Display.mode") {
            display?.mode?.let { "${it.physicalWidth} × ${it.physicalHeight}" }
        }
        value("densityDpi", "应用显示密度", "DisplayMetrics.densityDpi") { "${metrics.densityDpi} dpi" }
        value("density", "密度缩放", "DisplayMetrics.density") { "${metrics.density}×" }
        value("fontScale", "字体缩放", "Configuration.fontScale") { "${config.fontScale}×" }
        value("refresh", "当前刷新率", "Display.refreshRate") {
            display?.refreshRate?.let { String.format(Locale.US, "%.1f Hz", it) }
        }
        value("modes", "支持的显示模式", "Display.supportedModes") {
            display?.supportedModes?.map {
                String.format(Locale.US, "%d×%d @ %.1f Hz", it.physicalWidth, it.physicalHeight, it.refreshRate)
            }?.distinct()?.joinToString("；")
        }
        value("hdr", "HDR 能力", "Display.hdrCapabilities", "显示器公开的 HDR 类型，不等于当前内容正在以 HDR 播放。") {
            display?.hdrCapabilities?.supportedHdrTypes?.map {
                when (it) { 1 -> "Dolby Vision"; 2 -> "HDR10"; 3 -> "HLG"; 4 -> "HDR10+"; else -> "类型 $it" }
            }?.let { if (it.isEmpty()) "未声明支持" else it.distinct().joinToString(" / ") }
        }
        value("sizeEstimate", "屏幕尺寸（估算）", "Display.mode / DisplayMetrics.xdpi,ydpi", "由系统 DPI 标定推算，不是实测尺寸。") {
            val mode = display?.mode ?: return@value null
            val x = metrics.xdpi.takeIf { it.isFinite() && it in 30f..1500f } ?: return@value null
            val y = metrics.ydpi.takeIf { it.isFinite() && it in 30f..1500f } ?: return@value null
            String.format(Locale.ROOT, "%.1f 英寸", kotlin.math.hypot(mode.physicalWidth / x.toDouble(), mode.physicalHeight / y.toDouble()))
        }
    }
}

private object BatteryCollector : DeviceCollector {
    override val key = "battery"
    override val title = "电池"
    override fun collect(context: Context) = section(key, title) {
        val intent = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        fun extra(name: String) = intent?.getIntExtra(name, Int.MIN_VALUE)?.takeIf { it != Int.MIN_VALUE }
        value("level", "电量", "ACTION_BATTERY_CHANGED") {
            val level = extra(BatteryManager.EXTRA_LEVEL)
            val scale = extra(BatteryManager.EXTRA_SCALE)
            if (level == null || scale == null || scale <= 0 || level !in 0..scale) null else "${level.toLong() * 100 / scale}%"
        }
        value("status", "充电状态", "BatteryManager.EXTRA_STATUS") {
            when (extra(BatteryManager.EXTRA_STATUS)) {
                BatteryManager.BATTERY_STATUS_CHARGING -> "充电中"
                BatteryManager.BATTERY_STATUS_DISCHARGING -> "放电中"
                BatteryManager.BATTERY_STATUS_FULL -> "已充满"
                BatteryManager.BATTERY_STATUS_NOT_CHARGING -> "未充电"
                else -> null
            }
        }
        value("plugged", "电源类型", "BatteryManager.EXTRA_PLUGGED") {
            when (extra(BatteryManager.EXTRA_PLUGGED)) {
                BatteryManager.BATTERY_PLUGGED_AC -> "交流电"
                BatteryManager.BATTERY_PLUGGED_USB -> "USB"
                BatteryManager.BATTERY_PLUGGED_WIRELESS -> "无线充电"
                0 -> "未接电源"
                else -> null
            }
        }
        value("temperature", "电池温度", "BatteryManager.EXTRA_TEMPERATURE") {
            extra(BatteryManager.EXTRA_TEMPERATURE)?.let { String.format(Locale.US, "%.1f °C", it / 10.0) }
        }
        value("voltage", "电池电压", "BatteryManager.EXTRA_VOLTAGE") {
            extra(BatteryManager.EXTRA_VOLTAGE)?.let { "$it mV" }
        }
        value("health", "电池健康状态", "BatteryManager.EXTRA_HEALTH") {
            when (extra(BatteryManager.EXTRA_HEALTH)) {
                BatteryManager.BATTERY_HEALTH_GOOD -> "良好"
                BatteryManager.BATTERY_HEALTH_OVERHEAT -> "过热"
                BatteryManager.BATTERY_HEALTH_DEAD -> "失效"
                BatteryManager.BATTERY_HEALTH_OVER_VOLTAGE -> "过压"
                else -> null
            }
        }
        value("current", "充放电电流", "BatteryManager.BATTERY_PROPERTY_CURRENT_NOW",
            "Android API 以 µA 返回，显示为 mA； |电流| 超过 30 A 的异常样本不展示，不改写正负号。") {
            val manager = context.getSystemService(BatteryManager::class.java)
            manager?.getIntProperty(BatteryManager.BATTERY_PROPERTY_CURRENT_NOW)
                ?.takeIf { it in -30_000_000..30_000_000 }?.let {
                    String.format(Locale.US, "%.1f mA", it / 1000.0)
                }
        }
    }
}

private object SensorsCollector : DeviceCollector {
    override val key = "sensors"
    override val title = "传感器"
    override fun collect(context: Context) = section(key, title) {
        val sensors = context.getSystemService(SensorManager::class.java)?.getSensorList(Sensor.TYPE_ALL)
        value("count", "传感器数量", "SensorManager.getSensorList") { sensors?.size?.toString() }
        sensors?.forEachIndexed { index, sensor ->
            value("sensor_$index", sensor.name, "SensorManager", "类型 ${sensor.type} · 功耗 ${sensor.power} mA") {
                sensor.vendor
            }
        }
    }
}

class DeviceRepository(private val context: Context) {
    private val collectors: List<DeviceCollector> = listOf(
        SystemCollector, CpuCollector, MemoryCollector, DisplayCollector,
        BatteryCollector, SensorsCollector, NetworkCollector, CellularCollector,
    )

    suspend fun collect(refreshRadio: Boolean = false): DeviceSnapshot = DeviceSnapshot(System.currentTimeMillis(), collectors.map { collector ->
        try {
            if (collector === CellularCollector && refreshRadio)
                CellularCollector.collect(context, CellularCollector.requestUpdate(context))
            else collector.collect(context)
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            DeviceSection(collector.key, collector.title, listOf(DeviceInfoItem(
                "collectorError", "采集器状态", null, collector.javaClass.simpleName,
                if (e is SecurityException) ValueStatus.RESTRICTED else ValueStatus.ERROR,
                e.javaClass.simpleName,
            )))
        }
    })
}
