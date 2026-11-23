package com.sigmark.app.collector

internal fun vulkanVersion(version: Int): String? {
    if (version <= 0) return null
    val major = (version ushr 22) and 0x7f
    val minor = (version ushr 12) and 0x3ff
    val patch = version and 0xfff
    return "$major.$minor.$patch"
}

internal fun cameraCapabilitySummary(readings: List<Pair<String, String>?>): String? {
    if (readings.isEmpty()) return "无公开摄像头"
    val known = readings.filterNotNull().groupingBy { it }.eachCount()
    if (known.isEmpty()) return null
    val entries = known.toList().sortedWith(compareBy({ it.first.first }, { it.first.second }))
        .map { (spec, count) -> "${spec.first}/${spec.second} ×$count" }
    val missing = readings.count { it == null }
    return (entries + listOfNotNull("未读到 $missing 项".takeIf { missing > 0 })).joinToString(" · ")
}

internal fun sensorTypeWakeupSummary(readings: List<Pair<Int, Boolean>>): String {
    if (readings.isEmpty()) return "无公开传感器"
    val standard = readings.filter { it.first in 1..255 }
    val groups = standard.groupBy({ it.first }, { it.second }).toSortedMap()
    val entries = groups.entries.take(24).map { (type, values) -> "$type:${values.size}/${values.count { it }}" }
    val vendor = readings.size - standard.size
    return (entries + listOfNotNull(
        "另有 ${groups.size - 24} 类".takeIf { groups.size > 24 }, "其他 $vendor 项".takeIf { vendor > 0 },
    )).joinToString(" · ")
}
