package com.sigmark.app.collector

import com.sigmark.app.model.ReadReason
import com.sigmark.app.model.ValueStatus

internal fun cpuSet(raw: String): Set<Int>? {
    val result = mutableSetOf<Int>()
    for (part in raw.trim().split(',')) {
        val ends = part.split('-')
        if (ends.size > 2 || ends.any { !it.matches(Regex("0|[1-9][0-9]{0,3}")) }) return null
        val first = ends.first().toInt()
        val last = ends.last().toInt()
        if (first > last || last > 4095) return null
        for (cpu in first..last) if (!result.add(cpu)) return null
    }
    return result
}

internal fun sysBatteryTenths(raw: String): Int? =
    raw.trim().takeIf { it.matches(Regex("0|-?[1-9][0-9]{0,3}")) }?.toInt()?.takeIf { it in -500..1200 }

internal enum class SysfsField(
    val group: String, val key: String, val label: String, val node: SafeReader.Node,
    val unit: String, val minApi: Int, val sensitivity: String, val check: (String) -> Boolean,
    // Second fixed candidate, tried only when the primary node is not readable.
    val fallback: SafeReader.Node? = null,
) {
    CPU_POSSIBLE("cpu", "sysCpuPossible", "内核可支持的逻辑 CPU 编号", SafeReader.Node.CPU_POSSIBLE,
        "Linux CPU list", 26, "technical", { cpuSet(it) != null }),
    CPU_ONLINE("cpu", "sysCpuOnline", "采样时在线的逻辑 CPU 编号", SafeReader.Node.CPU_ONLINE,
        "Linux CPU list", 26, "technical", { cpuSet(it) != null }),
    BATTERY_TEMP("battery", "sysBatteryTemp", "电池驱动温度原值", SafeReader.Node.BATTERY_TEMP,
        "0.1 °C", 26, "technical", { sysBatteryTenths(it) != null }, SafeReader.Node.BATTERY_TEMP_BMS),
}

internal fun readSysfs(field: SysfsField, api: Int, read: (SafeReader.Node) -> ReadResult<String> = SafeReader::node): ReadResult<String> {
    if (api < field.minApi) return SafeReader.missing(field.node.path, ReadReason.INTERFACE_UNSUPPORTED, "需要 API ${field.minApi}。")
    val nodes = listOfNotNull(field.node, field.fallback)
    val failures = mutableListOf<ReadResult<String>>()
    for (node in nodes) {
        val reading = read(node)
        val raw = reading.value?.trim()
        if (raw == null) {
            failures += reading
            continue
        }
        // A full buffer can be a prefix of a larger kernel value. Do not validate it as a complete reading.
        val complete = reading.value.toByteArray(Charsets.UTF_8).size < node.maxBytes
        if (complete && field.check(raw)) return reading.copy(value = raw,
            detail = "普通 App 进程直接读取。节点格式检查通过，单位／格式：${field.unit}。" +
                if (nodes.size > 1) "命中路径：${node.path}。" else "")
        val numericText = raw.takeIf { it.length <= 128 && it.matches(Regex("[0-9,\\-]+")) }
        return SafeReader.missing(node.path, ReadReason.INVALID_VALUE,
            if (!complete) "读数达到字节上限，内容可能不完整。" else
                "节点读数未通过格式或范围检查。" + (numericText?.let { "原始数值：$it。" } ?: ""))
    }
    val primary = failures.firstOrNull { it.status == ValueStatus.RESTRICTED }
        ?: failures.firstOrNull { it.status == ValueStatus.ERROR }
        ?: failures.firstOrNull { it.errno != null }
        ?: failures.first()
    if (failures.size == 1) return primary
    val others = failures.filter { it !== primary }.joinToString("；") {
        "${it.source}: ${it.reason?.name ?: it.status.name}${it.errno?.let { code -> " errno=$code" }.orEmpty()}"
    }
    return primary.copy(detail = listOfNotNull(primary.detail, "其他候选：$others").joinToString(" "))
}

internal fun SectionBuilder.sysfsObservations(group: String, api: Int) {
    SysfsField.entries.filter { it.group == group }.forEach { observation(it.key,it.label,readSysfs(it,api)) }
}
