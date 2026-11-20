package com.sigmark.app.collector

import com.sigmark.app.model.DeviceInfoItem
import com.sigmark.app.model.ReadReason
import java.util.Locale

internal object SelinuxProbe {
    fun collect(): List<DeviceInfoItem> {
        val mode = SafeReader.node(SafeReader.Node.SELINUX_ENFORCE)
        val decoded = mode.value?.let(::decodeMode)
        val result = when {
            decoded != null -> mode.copy(value = decoded.first, detail = decoded.second)
            mode.value != null -> SafeReader.missing(mode.source, ReadReason.INVALID_VALUE,
                "节点可读，但没有返回标准 0/1；实时模式未确认。")
            else -> mode.copy(detail = "${mode.detail} 此结果不代表 SELinux 已关闭或处于某一模式。")
        }
        val policy = SafeReader.node(SafeReader.Node.SELINUX_POLICY)
        return listOf(
            result.item("selinux", "SELinux 实时模式"),
            policy.copy(detail = listOfNotNull(policy.detail, "仅检查是否可打开，不代表实时模式。").joinToString(" "))
                .item("selinuxPolicy", "SELinux 策略节点"),
            property("selinuxBootHint", "SELinux 启动属性（参考）", SafeReader.Property.SELINUX_BOOT),
            property("selinuxBuildHint", "SELinux 构建属性（参考）", SafeReader.Property.SELINUX_BUILD),
        )
    }

    private fun property(key: String, label: String, prop: SafeReader.Property): DeviceInfoItem {
        val reading = SafeReader.property(prop)
        val parsed = reading.map { it.lowercase(Locale.ROOT).takeIf { value -> value in setOf("enforcing", "permissive", "disabled", "enabled", "0", "1") } }
        return parsed.copy(detail = listOfNotNull(
            if (parsed.value != null) null else parsed.detail, "仅为启动或构建属性，不代表实时模式。"
        ).joinToString(" ")).item(key, label)
    }

    internal fun decodeMode(raw: String): Pair<String, String>? = when (raw.trim()) {
        "1" -> "Enforcing（强制模式）" to "已直接读取节点值 1。"
        "0" -> "Permissive（宽容模式）" to "已直接读取节点值 0；这不是 SELinux 已关闭。"
        else -> null
    }
}
