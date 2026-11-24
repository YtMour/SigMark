package com.sigmark.app.collector

import android.app.ActivityManager
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.hardware.Sensor
import android.hardware.SensorManager
import android.hardware.display.DisplayManager
import android.os.BatteryManager
import android.os.Build
import android.os.Environment
import android.os.PowerManager
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

internal class SectionBuilder(private val key: String, private val title: String) {
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

internal fun section(key: String, title: String, block: SectionBuilder.() -> Unit): DeviceSection =
    SectionBuilder(key, title).apply(block).build()

internal fun bytes(value: Long): String = String.format(Locale.US, "%.2f GiB", value / 1073741824.0)

internal fun batteryReadingReason(value: Long, sentinel: Long, range: LongRange): ReadReason? = when {
    value == sentinel -> ReadReason.INTERFACE_UNSUPPORTED
    value !in range -> ReadReason.INVALID_VALUE
    else -> null
}

internal fun estimateEnergyWh(chargeMicroAh: Int?, voltageMv: Int?): Double? {
    if (chargeMicroAh == null || chargeMicroAh !in 1..30_000_000 || voltageMv == null || voltageMv !in 1000..15000) return null
    return chargeMicroAh / 1e6 * (voltageMv / 1000.0)
}

private fun batteryReading(source: String, raw: ReadResult<Long>, sentinel: Long, range: LongRange,
    unsupported: String, format: (Long) -> String): ReadResult<String> {
    val reason = raw.value?.let { batteryReadingReason(it, sentinel, range) }
    return when (reason) {
        ReadReason.INTERFACE_UNSUPPORTED -> SafeReader.missing(source, reason, unsupported)
        ReadReason.INVALID_VALUE -> SafeReader.missing(source, reason, "接口返回的数值不在有效范围内。")
        else -> raw.map(format)
    }
}

private object SystemCollector : DeviceCollector {
    override val key = "system"
    override val title = "系统与固件"
    override fun collect(context: Context) = section(key, title) {
        value("release", "Android 版本", "Build.VERSION.RELEASE") { Build.VERSION.RELEASE }
        value("api", "API 级别", "Build.VERSION.SDK_INT") { Build.VERSION.SDK_INT.toString() }
        value("patch", "安全补丁", "Build.VERSION.SECURITY_PATCH") { Build.VERSION.SECURITY_PATCH }
        add(SecurityObservations.system(context))
        if (Build.VERSION.SDK_INT >= 31) {
            value("socModel", "SoC 型号", "Build.SOC_MODEL") { Build.SOC_MODEL }
            value("socManufacturer", "SoC 厂商", "Build.SOC_MANUFACTURER") { Build.SOC_MANUFACTURER }
        }
        value("declaredCapabilities", "系统声明能力", "PackageManager.hasSystemFeature", "ROM 声明，实际功能仍需真机验证。") {
            val pm = context.packageManager
            listOf(
                PackageManager.FEATURE_NFC to "NFC",
                PackageManager.FEATURE_BLUETOOTH_LE to "BLE",
                PackageManager.FEATURE_WIFI_RTT to "Wi-Fi RTT",
                PackageManager.FEATURE_SENSOR_GYROSCOPE to "陀螺仪",
                PackageManager.FEATURE_USB_HOST to "USB Host",
            ).joinToString(" / ") { (feature, name) -> "$name ${if (pm.hasSystemFeature(feature)) "已声明" else "未声明"}" }
        }
        value("interfaceCapabilities", "设备接口声明", "PackageManager.hasSystemFeature",
            "NFC、GNSS（GPS）、USB 主机及配件模式的声明；none 表示这四项均未声明。未探测设备标识或接口是否可用。") {
            val pm = context.packageManager
            listOf(
                PackageManager.FEATURE_NFC to "nfc",
                PackageManager.FEATURE_LOCATION_GPS to "gnss",
                PackageManager.FEATURE_USB_HOST to "usb_host",
                PackageManager.FEATURE_USB_ACCESSORY to "usb_accessory",
            ).filter { (feature, _) -> pm.hasSystemFeature(feature) }.joinToString(" / ") { it.second }.ifEmpty { "none" }
        }
        gnssObservations(context)
        value("fingerprint", "构建指纹", "Build.FINGERPRINT", "应用进程视角；可能与 ADB 属性不同") { Build.FINGERPRINT }
        value("buildId", "构建 ID", "Build.ID") { Build.ID }
        value("display", "构建显示名", "Build.DISPLAY") { Build.DISPLAY }
        value("incremental", "增量构建号", "Build.VERSION.INCREMENTAL") { Build.VERSION.INCREMENTAL }
        value("buildTime", "构建时间", "Build.TIME", "UTC；应用进程视角。") {
            Build.TIME.takeIf { it > 0 }?.let { java.time.Instant.ofEpochMilli(it).toString() }
        }
        value("buildUser", "构建用户", "Build.USER") { Build.USER }
        value("buildHost", "构建主机", "Build.HOST") { Build.HOST }
        value("board", "主板代号", "Build.BOARD") { Build.BOARD }
        // Independent read-only declarations. They are compared with the Build values
        // above: a ROM that rewrites properties per context can make them disagree.
        fun declaredProperty(itemKey: String, property: String, label: String, pattern: Regex, lowercase: Boolean, note: String) {
            observation(itemKey, label, SafeReader.property(property).map { raw ->
                val text = raw.trim()
                val normalized = if (lowercase) text.lowercase(Locale.ROOT) else text
                normalized.takeIf { pattern.matches(it) }
            }.let { reading ->
                reading.copy(detail = listOfNotNull(reading.detail, note).joinToString(" "))
            })
        }
        declaredProperty("boardPlatform", "ro.board.platform", "平台代号声明", Regex("[a-z0-9_.-]{1,32}"), true,
            "只读属性，与 Build.BOARD 是两条独立来源；不一致时先核对 ROM 是否改写属性，不据此判定真伪。")
        declaredProperty("bootHardware", "ro.boot.hardware", "启动硬件声明", Regex("[a-z0-9_.-]{1,32}"), true,
            "只读属性，与 Build.HARDWARE 是两条独立来源；不一致时先核对 ROM 是否改写属性。")
        declaredProperty("hardwareSku", "ro.boot.hardware.sku", "启动硬件 SKU", Regex("[A-Za-z0-9._-]{1,32}"), false,
            "只读属性，与 Build.SKU（API 31+）是两条独立来源。")
        if (Build.VERSION.SDK_INT >= 31) value("sku", "硬件 SKU", "Build.SKU") { Build.SKU }
        observation("baseOs", "基础系统版本", SafeReader.firstAvailable(
            { SafeReader.read("Build.VERSION.BASE_OS", "OEM 可选字段。") { normalizeValue(Build.VERSION.BASE_OS) } },
            { SafeReader.property(SafeReader.Property.BASE_OS) },
        ).let { reading ->
            val source = "Build.VERSION.BASE_OS / getprop ro.build.version.base_os"
            val qualified = reading.copy(source = source).explainMissing(ReadReason.OPTIONAL_UNSET,
                "OEM 可选字段，当前 ROM 未提供。Android 版本见上方独立字段。")
            if (reading.value != null) qualified.copy(detail = "优先 Build.VERSION.BASE_OS，为空时回退 getprop ro.build.version.base_os。")
            else qualified
        })
        value("type", "构建类型", "Build.TYPE") { Build.TYPE }
        value("tags", "构建标签", "Build.TAGS") { Build.TAGS }
        value("manufacturer", "制造商", "Build.MANUFACTURER") { Build.MANUFACTURER }
        value("brand", "品牌", "Build.BRAND") { Build.BRAND }
        value("model", "型号", "Build.MODEL", "应用进程视角") { Build.MODEL }
        value("device", "设备代号", "Build.DEVICE", "应用进程视角") { Build.DEVICE }
        value("product", "产品代号", "Build.PRODUCT") { Build.PRODUCT }
        observation("bootloader", "Bootloader", SafeReader.firstAvailable(
            { SafeReader.read("Build.BOOTLOADER") { normalizeValue(Build.BOOTLOADER) } },
            { SafeReader.property(SafeReader.Property.BOOTLOADER) },
        ).let { reading ->
            val source = "Build.BOOTLOADER / getprop ro.bootloader"
            val qualified = reading.copy(source = source).explainMissing(ReadReason.OPTIONAL_UNSET,
                "当前 ROM 未向应用提供 Bootloader 版本。")
            if (reading.value != null) qualified.copy(detail = "优先 Build.BOOTLOADER，为空时回退 getprop ro.bootloader。")
            else qualified
        })
        value("uptime", "开机时长", "SystemClock.elapsedRealtime") {
            val minutes = SystemClock.elapsedRealtime() / 60_000
            "${minutes / 1440} 天 ${minutes % 1440 / 60} 小时 ${minutes % 60} 分钟"
        }
        add(SelinuxProbe.collect())
        val hint = SafeReader.firstAvailable(*listOf(SafeReader.Property.HYPEROS, SafeReader.Property.MIUI,
            SafeReader.Property.COLOR_OS, SafeReader.Property.COLOR_OS_ALT, SafeReader.Property.ONE_UI)
            .map { property -> { SafeReader.property(property) } }.toTypedArray())
        observation("romHint", "ROM 版本线索", if (hint.value != null)
            hint.copy(detail = "厂商属性，仅反映当前应用读取结果。") else hint)
    }
}

private object CpuCollector : DeviceCollector {
    override val key = "cpu"
    override val title = "内核与 CPU"
    override fun collect(context: Context) = section(key, title) {
        value("kernel", "内核版本", "System.getProperty(os.version)") { System.getProperty("os.version") }
        val uname = SafeReader.read("Os.uname()") { Os.uname() }
        observation("kernelFull", "内核编译信息", uname.map { "${it.sysname} ${it.release} ${it.version} ${it.machine}" }.let {
            if (it.value != null) it.copy(detail = "通过 uname 获取；/proc/version 在部分设备上禁止读取。") else it
        })
        observation("kernelMachine", "内核报告的架构", uname.map { kernelMachineName(it.machine) }.let {
            if (it.value != null) it.copy(detail = "应用进程看到的 uname 架构，不是物理芯片证明。") else it
        })
        value("abis", "支持的 ABI", "Build.SUPPORTED_ABIS") { Build.SUPPORTED_ABIS.joinToString(", ") }
        value("arch", "进程架构", "System.getProperty(os.arch)") { System.getProperty("os.arch") }
        value("processBitness", "印迹进程位宽", "android.os.Process.is64Bit()",
            "单位 bit。64 位系统运行 32 位进程属于正常兼容模式。") {
            if (android.os.Process.is64Bit()) "64" else "32"
        }
        value("abi32", "支持的 32 位 ABI", "Build.SUPPORTED_32_BIT_ABIS") {
            Build.SUPPORTED_32_BIT_ABIS.joinToString(", ").ifEmpty { "未声明" }
        }
        value("abi64", "支持的 64 位 ABI", "Build.SUPPORTED_64_BIT_ABIS") {
            Build.SUPPORTED_64_BIT_ABIS.joinToString(", ").ifEmpty { "未声明" }
        }
        value("hardware", "硬件代号", "Build.HARDWARE") { Build.HARDWARE }
        value("cores", "可用逻辑核心", "Runtime.availableProcessors") {
            Runtime.getRuntime().availableProcessors().toString()
        }
        value("coresConfigured", "内核配置的逻辑 CPU 数", "Os.sysconf(_SC_NPROCESSORS_CONF)",
            "内核配置的逻辑 CPU 数，可能大于当前在线数或本进程可用数。") {
            Os.sysconf(OsConstants._SC_NPROCESSORS_CONF).takeIf { it in 1L..1024L }?.toString()
        }
        value("pageSize", "内存页大小", "Os.sysconf(_SC_PAGESIZE)") {
            Os.sysconf(OsConstants._SC_PAGESIZE).takeIf { it > 0 }?.let { "$it B" }
        }
        val cpuFields = SafeReader.node(SafeReader.Node.CPU_INFO).map(CpuInfoParser::fields)
        observation("cpuInfo", "CPU 描述", cpuFields.map(CpuInfoParser::description))
        observation("features", "CPU 指令特性", cpuFields.map(CpuInfoParser::features))
        fun maxFrequency(path: SafeReader.Node) = SafeReader.node(path).map {
            it.trim().toLongOrNull()?.takeIf { khz -> khz > 0 }?.let { khz ->
                String.format(Locale.US, "%.0f MHz", khz / 1000.0)
            }
        }
        val frequency = SafeReader.firstAvailable({ maxFrequency(SafeReader.Node.CPU0_MAX) },
            { maxFrequency(SafeReader.Node.CPU_POLICY0_MAX) })
        observation("cpu0MaxFrequency", "CPU 0 / policy0 最高频率",
            if (frequency.value != null) frequency.copy(detail = "CPU 0 或 policy0 的样本，不代表整颗处理器峰值。") else frequency)
        sysfsObservations(key, Build.VERSION.SDK_INT)
    }
}

private object MemoryCollector : DeviceCollector {
    override val key = "memory"
    override val title = "内存与存储"
    override fun collect(context: Context) = section(key, title) {
        val memory = SafeReader.read("ActivityManager.MemoryInfo") {
            context.getSystemService(ActivityManager::class.java)?.let { ActivityManager.MemoryInfo().also(it::getMemoryInfo) }
        }
        observation("totalRam", "总运行内存", memory.map { bytes(it.totalMem) }.copy(source = "ActivityManager.MemoryInfo.totalMem"))
        observation("availableRam", "可用运行内存", memory.map { bytes(it.availMem) }.copy(source = "ActivityManager.MemoryInfo.availMem"))
        observation("lowMemory", "低内存状态", memory.map { if (it.lowMemory) "是" else "否" }.copy(source = "ActivityManager.MemoryInfo.lowMemory"))
        observation("lowMemoryThreshold", "低内存阈值", memory.map { bytes(it.threshold) }.copy(source = "ActivityManager.MemoryInfo.threshold"))
        observation("ramUseEstimate", "内存占用率（估算）", memory.map { usagePercent(it.totalMem, it.availMem) }
            .let { it.copy(detail = it.detail ?: "(总量 − 可用量) / 总量；包含系统对可回收内存的估计。") })
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
        value("volumeSummary", "可见存储卷", "StorageManager.storageVolumes", "仅显示卷属性，不含 UUID、路径或标签。") {
            context.getSystemService(android.os.storage.StorageManager::class.java)?.storageVolumes?.let { volumes ->
                if (volumes.isEmpty()) "无可见卷" else volumes.joinToString("\n") { volume ->
                    "${if (volume.isPrimary) "主卷" else "副卷"} · ${volume.state} · " +
                        "${if (volume.isEmulated) "模拟存储" else "非模拟"} · ${if (volume.isRemovable) "可移除" else "不可移除"}"
                }
            }
        }
        value("systemSpace", "系统路径空间", "StatFs(rootDirectory)", "仅表示该路径所见文件系统。") {
            StatFs(Environment.getRootDirectory().path).let { "${bytes(it.availableBytes)} 可用 / ${bytes(it.totalBytes)} 总量" }
        }
        value("appCacheSpace", "应用缓存路径空间", "StatFs(Context.cacheDir)", "是所在文件系统空间，不是 App 缓存配额；可能与数据区相同。") {
            StatFs(context.cacheDir.path).let { "${bytes(it.availableBytes)} 可用 / ${bytes(it.totalBytes)} 总量" }
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
        value("wideGamut", "广色域", "Display.isWideColorGamut") { display?.isWideColorGamut?.let { yesNo(it) } }
        value("visibleDisplays", "可见显示器", "DisplayManager.getDisplays", "仅应用可见的显示，不等于物理屏幕数量。") {
            context.getSystemService(DisplayManager::class.java)?.displays?.let { displays ->
                if (displays.isEmpty()) "无可见显示" else displays.joinToString("\n") {
                    val mode = it.mode
                    "${if (it.displayId == 0) "默认显示" else "附加显示"} · ${mode.physicalWidth}×${mode.physicalHeight} · ${mode.refreshRate} Hz"
                }
            }
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
        value("present", "电池存在状态", "BatteryManager.EXTRA_PRESENT", "仅使用广播明确返回的值，字段缺失不代表无电池。") {
            intent?.takeIf { it.hasExtra(BatteryManager.EXTRA_PRESENT) }
                ?.let { if (it.getBooleanExtra(BatteryManager.EXTRA_PRESENT, false)) "yes" else "no" }
        }
        val cycleSource = "BatteryManager.EXTRA_CYCLE_COUNT"
        val cycle = if (Build.VERSION.SDK_INT >= 34) SafeReader.read(cycleSource, "Android 上报的充放电循环次数，不是插拔或充电会话次数。") {
            val raw = extra(BatteryManager.EXTRA_CYCLE_COUNT)
            raw?.takeIf { it in 0..99_999 }?.toString()
        }.explainMissing(ReadReason.NOT_REPORTED, "广播未提供有效循环次数。")
        else SafeReader.missing(cycleSource, ReadReason.INTERFACE_UNSUPPORTED, "公开循环次数字段需要 API 34。")
        observation("cycleCount", "电池循环次数", cycle)
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
        val publicTemperature = extra(BatteryManager.EXTRA_TEMPERATURE)
        SysfsField.entries.filter { it.group == key }.forEach { field ->
            val reading = readSysfs(field, Build.VERSION.SDK_INT)
            observation(field.key, field.label, if (reading.value == null && field == SysfsField.BATTERY_TEMP)
                reading.withNote("依次尝试 /sys/class/power_supply/battery/temp 与 /sys/class/power_supply/bms/temp，均未取得驱动温度。" +
                    "公开温度 battery.temperature ${if (publicTemperature != null) "已取得，可作对照。" else "也未取得。"}")
            else reading)
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
        val manager = context.getSystemService(BatteryManager::class.java)
        val capacity = SafeReader.firstAvailable(
            { SafeReader.read("BatteryManager.BATTERY_PROPERTY_CAPACITY") {
                manager?.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)?.takeIf { it in 0..100 }?.let { "$it%" }
            } },
            { SafeReader.read("ACTION_BATTERY_CHANGED.level / scale", "电量属性未提供时使用系统电量广播。") {
                val level = extra(BatteryManager.EXTRA_LEVEL)
                val scale = extra(BatteryManager.EXTRA_SCALE)
                if (scale != null && scale > 0 && level != null && level in 0..scale) "${level.toLong() * 100 / scale}%" else null
            } },
        )
        observation("capacityPercent", "系统电量百分比", capacity)
        val charge = SafeReader.read("BatteryManager.BATTERY_PROPERTY_CHARGE_COUNTER", "µAh 换算为 mAh；不是设计容量。") {
            manager?.getIntProperty(BatteryManager.BATTERY_PROPERTY_CHARGE_COUNTER)?.takeIf { it >= 0 }
        }
        observation("chargeCounter", "剩余电荷", charge.map { String.format(Locale.ROOT, "%.1f mAh", it / 1000.0) })
        val energy = "BatteryManager.BATTERY_PROPERTY_ENERGY_COUNTER"
        observation("energyCounter", "剩余能量", batteryReading(energy,
            SafeReader.read(energy, "nWh 换算为 Wh。") { manager?.getLongProperty(BatteryManager.BATTERY_PROPERTY_ENERGY_COUNTER) },
            Long.MIN_VALUE, 0L..Long.MAX_VALUE, "能量接口返回不支持哨兵值。剩余电荷 mAh 是独立参数，不是能量 Wh。"
        ) { String.format(Locale.ROOT, "%.2f Wh", it / 1e9) })
        estimateEnergyWh(charge.value, extra(BatteryManager.EXTRA_VOLTAGE))?.let { wh ->
            value("energyEstimate", "剩余能量粗估（本机）", "CHARGE_COUNTER × ACTION_BATTERY_CHANGED.voltage",
                "剩余电荷乘采样电压，仅供参考；电压会变化，结果不等同于能量计，也不上传。") {
                String.format(Locale.ROOT, "约 %.2f Wh", wh)
            }
        }
        val average = "BatteryManager.BATTERY_PROPERTY_CURRENT_AVERAGE"
        observation("currentAverage", "平均充放电电流", batteryReading(average,
            SafeReader.read(average, "µA 换算为 mA，保留正负号。") { manager?.getIntProperty(BatteryManager.BATTERY_PROPERTY_CURRENT_AVERAGE)?.toLong() },
            Int.MIN_VALUE.toLong(), -30_000_000L..30_000_000L, "系统未提供平均电流属性；可查看独立的瞬时电流读数。"
        ) { String.format(Locale.ROOT, "%.1f mA", it / 1000.0) })
        value("current", "充放电电流", "BatteryManager.BATTERY_PROPERTY_CURRENT_NOW",
            "Android API 以 µA 返回，显示为 mA； |电流| 超过 30 A 的异常样本不展示，不改写正负号。") {
            manager?.getIntProperty(BatteryManager.BATTERY_PROPERTY_CURRENT_NOW)
                ?.takeIf { it in -30_000_000..30_000_000 }?.let {
                    String.format(Locale.US, "%.1f mA", it / 1000.0)
                }
        }
        value("powerSaver", "省电模式", "PowerManager.isPowerSaveMode") {
            context.getSystemService(PowerManager::class.java)?.isPowerSaveMode?.let { if (it) "开启" else "关闭" }
        }
        if (Build.VERSION.SDK_INT >= 29) value("thermalStatus", "系统热状态", "PowerManager.currentThermalStatus",
            "系统热管理分级，不代表 CPU 温度。") {
            context.getSystemService(PowerManager::class.java)?.currentThermalStatus?.let { state ->
                listOf("正常", "轻度", "中度", "严重", "临界", "紧急", "关机保护").getOrNull(state)
            }
        }
    }
}

private object SensorsCollector : DeviceCollector {
    override val key = "sensors"
    override val title = "传感器"
    override fun collect(context: Context) = section(key, title) {
        val list = SafeReader.read("SensorManager.getSensorList") { context.getSystemService(SensorManager::class.java)?.getSensorList(Sensor.TYPE_ALL) }
        val sensors = list.value
        observation("count", "传感器数量", list.map { it.size.toString() })
        sensorObservations(list)
        value("typeWakeupSummary", "传感器类型与唤醒能力", "SensorManager.getSensorList / Sensor.isWakeUpSensor",
            "格式为 Android 类型编号:公开条目数/可唤醒条目数，最多列出 24 类。") {
            sensors?.map { it.type to it.isWakeUpSensor }?.let(::sensorTypeWakeupSummary)
        }
        sensors?.forEachIndexed { index, sensor ->
            value("sensor_$index", sensor.name, "SensorManager.getSensorList(TYPE_ALL)",
                "最小延迟为采样能力；0 µs 可能表示按变化触发。量程和分辨率单位依传感器类型。") {
                "${sensor.vendor} · ${sensor.stringType} (${sensor.type}) · 版本 ${sensor.version}\n" +
                    "量程 ${sensor.maximumRange} · 分辨率 ${sensor.resolution} · 功耗 ${sensor.power} mA · 最小延迟 ${sensor.minDelay} µs"
            }
        }
    }
}

class DeviceRepository(private val context: Context) {
    private val collectors: List<DeviceCollector> = listOf(
        SystemCollector, CpuCollector, MemoryCollector, DisplayCollector,
        BatteryCollector, SensorsCollector, NetworkCollector, CellularCollector,
        RuntimeCollector, MediaCollector, EnvironmentCollector, AppCollector,
    )

    suspend fun collect(refreshRadio: Boolean = false): DeviceSnapshot {
        // One getprop call per collection; individual reads fall back to their key.
        PropertySnapshot.refresh()
        val capturedAt = System.currentTimeMillis()
        val access = collectionContext(com.sigmark.app.CollectionAccess.read(context))
        return DeviceSnapshot(capturedAt, collectors.map { collector ->
        try {
            if (collector === CellularCollector && refreshRadio)
                CellularCollector.collect(context, CellularCollector.requestUpdate(context))
            else collector.collect(context).let { section ->
                if (section.key == "environment") section.copy(items = section.items + access) else section
            }
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
}
