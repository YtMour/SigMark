package com.sigmark.app.collector

import com.sigmark.app.model.DeviceInfoItem
import com.sigmark.app.model.ReadReason
import java.util.Locale

internal object SelinuxProbe {
    fun collect(): List<DeviceInfoItem> {
        val result = modeResult(SafeReader.node(SafeReader.Node.SELINUX_ENFORCE))
        val policy = SafeReader.node(SafeReader.Node.SELINUX_POLICY)
        return listOf(
            result.item("selinux", "SELinux 实时模式"),
            policy.copy(detail = listOfNotNull(policy.detail, "仅检查是否可打开，不代表实时模式。").joinToString(" "))
                .item("selinuxPolicy", "SELinux 策略节点"),
            property("selinuxBootHint", "SELinux 启动属性（参考）", SafeReader.Property.SELINUX_BOOT),
            property("selinuxBuildHint", "SELinux 构建属性（参考）", SafeReader.Property.SELINUX_BUILD),
        )
    }

    internal fun modeResult(mode: ReadResult<String>): ReadResult<String> {
        val decoded = mode.value?.let(::decodeMode)
        return when {
            decoded != null -> mode.copy(value = decoded.first, detail = decoded.second)
            mode.value != null -> SafeReader.missing(mode.source, ReadReason.INVALID_VALUE,
                "节点可读，但没有返回标准 0/1。实时模式未确认。")
            else -> mode.copy(detail = listOfNotNull(mode.detail,
                "本机实时模式未确认。常规量产设备通常为 Enforcing。").joinToString(" "))
        }
    }

    internal fun processDomain(raw: String): String? =
        raw.trim { it == '\u0000' || it.isWhitespace() }
            .split(':', limit = 4).takeIf { it.size == 4 }
            ?.get(2)?.takeIf { it.matches(Regex("[a-zA-Z0-9_]{1,80}")) }

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
