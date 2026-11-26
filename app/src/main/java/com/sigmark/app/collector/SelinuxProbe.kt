package com.sigmark.app.collector

import com.sigmark.app.model.DeviceInfoItem
import com.sigmark.app.model.ReadReason
import com.sigmark.app.model.ValueStatus
import java.util.Locale

// Linux mode bits used for the DAC check. The values are fixed by the ABI and
// are declared here so JVM unit tests never depend on the Android stubs.
private const val otherExecute = 0x001 // S_IXOTH
private const val otherRead = 0x004    // S_IROTH
private const val eaccesErrno = 13
private const val enoentErrno = 2
private const val directoryPath = "/sys/fs/selinux"
private const val enforcePath = "/sys/fs/selinux/enforce"

// Read result plus the evidence code written to system.selinuxEvidence.
internal data class SelinuxVerdict(val mode: ReadResult<String>, val evidence: ReadResult<String>)

internal object SelinuxProbe {
    fun collect(): List<DeviceInfoItem> {
        val verdict = probe()
        val policy = SafeReader.node(SafeReader.Node.SELINUX_POLICY)
        return listOf(
            verdict.mode.item("selinux", "SELinux 实时模式"),
            verdict.evidence.item("selinuxEvidence", "SELinux 读取依据"),
            policy.copy(detail = listOfNotNull(policy.detail,
                "仅探测节点可打开性。读取二进制策略内容还需要独立的 security:read_policy 授权。",
                "普通应用通常受系统策略限制。打开检查与读取策略正文使用不同权限。")
                .joinToString(" ")).item("selinuxPolicy", "SELinux 策略节点"),
            property("selinuxBootHint", "SELinux 启动属性（参考）", SafeReader.Property.SELINUX_BOOT),
            property("selinuxBuildHint", "SELinux 构建属性（参考）", SafeReader.Property.SELINUX_BUILD),
        )
    }

    internal fun probe(): SelinuxVerdict {
        val enforce = SafeReader.node(SafeReader.Node.SELINUX_ENFORCE)
        if (enforce.value != null) return selinuxVerdict(enforce, null, null)
        // DAC mode bits provide context for EACCES, but cannot establish its cause.
        if (enforce.errno == eaccesErrno) {
            val directory = SafeReader.statMode(directoryPath).value
            val file = SafeReader.statMode(enforcePath).value
            return selinuxVerdict(enforce, directory, file)
        }
        return selinuxVerdict(enforce, null, null)
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

// These two mode bits are partial DAC evidence. Other ancestors and access
// controls may also influence the open, so this cannot verify enforcement.
internal fun dacAllowsOtherRead(directoryMode: Int?, fileMode: Int?): Boolean =
    directoryMode != null && fileMode != null &&
        (directoryMode and otherExecute) != 0 && (fileMode and otherRead) != 0

internal fun selinuxVerdict(open: ReadResult<String>, directoryMode: Int?, fileMode: Int?): SelinuxVerdict {
    val raw = open.value?.trim()
    if (raw != null) {
        val decoded = SelinuxProbe.decodeMode(raw)
        if (decoded != null) return SelinuxVerdict(
            open.copy(value = decoded.first, detail = decoded.second),
            evidence("exact", "已直接读取 enforce 节点，值为 $raw；这是直接读数。"),
        )
        return SelinuxVerdict(
            SafeReader.missing(open.source, ReadReason.INVALID_VALUE,
                "节点可读，但没有返回标准 0/1。实时模式未确认。"),
            unconfirmedEvidence("节点内容不是标准 0/1，无法确认读取依据。"),
        )
    }
    if (open.errno == eaccesErrno) {
        if (dacAllowsOtherRead(directoryMode, fileMode)) return SelinuxVerdict(
            open.withNote("系统拒绝读取，实时模式未确认。"),
            evidence("inferred_mac", "目录与节点的权限位允许其他用户搜索和读取。系统策略是可能原因之一。"),
        )
        return SelinuxVerdict(
            open.copy(detail = listOfNotNull(open.detail,
                "DAC 未证明 other 可读，无法把 EACCES 归因于 SELinux 策略。本机实时模式未确认。").joinToString(" ")),
            unconfirmedEvidence("DAC 本身不允许读取或无法取得元数据，不能断定是 SELinux 策略拒绝。"),
        )
    }
    if (open.errno == enoentErrno) return SelinuxVerdict(
        open.withNote("当前应用未看到 enforce 节点，实时模式未确认。"),
        SafeReader.missing(open.source, ReadReason.NODE_MISSING, "未看到 enforce 节点。"),
    )
    return SelinuxVerdict(
        open.copy(detail = listOfNotNull(open.detail,
            "本机实时模式未确认。").joinToString(" ")),
        unconfirmedEvidence("本次没有取得直接读数。"),
    )
}

private fun evidence(code: String, detail: String): ReadResult<String> =
    ReadResult(code, ValueStatus.AVAILABLE, enforcePath, detail)

private fun unconfirmedEvidence(detail: String): ReadResult<String> =
    SafeReader.missing(enforcePath, ReadReason.INVALID_VALUE, detail)
