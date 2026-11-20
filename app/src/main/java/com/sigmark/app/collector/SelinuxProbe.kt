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
            policy.copy(detail = listOfNotNull(policy.detail, "仅探测节点可打开性。读取二进制策略内容还需要独立的 security:read_policy 授权。").joinToString(" "))
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
        val explanation = if (prop == SafeReader.Property.SELINUX_BOOT)
            "启动参考属性，量产 ROM 可留空。不代表实时模式。"
        else "历史构建属性，现代 ROM 可省略。不代表实时模式。"
        val qualified = parsed.explainMissing(
            if (reading.value == null) ReadReason.OPTIONAL_UNSET else ReadReason.INVALID_VALUE,
            if (reading.value == null) "当前应用未得到该属性值。" else "属性值不是已知标记。")
        return qualified.copy(detail = listOfNotNull(
            qualified.detail, explanation
        ).joinToString(" ")).item(key, label)
    }

    internal fun decodeMode(raw: String): Pair<String, String>? = when (raw.trim()) {
        "1" -> "Enforcing（强制模式）" to "已直接读取节点值 1。"
        "0" -> "Permissive（宽容模式）" to "已直接读取节点值 0；这不是 SELinux 已关闭。"
        else -> null
    }
}
