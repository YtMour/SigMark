package com.sigmark.app.collector

import com.sigmark.app.model.DeviceInfoItem
import com.sigmark.app.model.DeviceSnapshot
import com.sigmark.app.model.ValueStatus
import com.sigmark.app.lan.lanFieldValue
import java.security.MessageDigest

internal const val machineCodeVersion = "sigmark-config-code/2"
// Three independent components. "product" is the declared model family, "hardware"
// is the chipset-level claim, and "rom" is the installed build. A ROM rewrite of one
// family does not silently change the others; each component hashes its own inputs.
internal val machineCodeFields = linkedMapOf(
    "product" to listOf("system.brand", "system.model", "system.device", "cpu.abis"),
    "hardware" to listOf("cpu.hardware", "system.board", "cpu.coresConfigured", "system.initialSdk"),
    "rom" to listOf("system.type", "system.buildId", "system.incremental", "system.patch"),
)

internal fun codePrefix(domain: String): String = when (domain) {
    "product" -> "P2"
    "hardware" -> "H2"
    "rom" -> "R2"
    else -> "X2"
}

internal data class CodeInput(val key: String, val reading: DeviceInfoItem?) {
    val canonical: String? get() = lanFieldValue(reading?.takeIf { it.status == ValueStatus.AVAILABLE }?.value)
        ?.trim(' ', '\t', '\r', '\n')?.takeIf { it.isNotEmpty() }
}

internal data class CodePart(val domain: String, val code: String?, val inputs: List<CodeInput>) {
    val available: Int get() = inputs.count { it.canonical != null }
}

internal fun machineCode(snapshot: DeviceSnapshot): List<CodePart> {
    val readings = snapshot.sections.flatMap { section -> section.items.map { "${section.key}.${it.key}" to it } }.toMap()
    return machineCodeFields.map { (domain, keys) ->
        val inputs = keys.map { CodeInput(it, readings[it]) }
        val canonical = buildString {
            append(machineCodeVersion).append('/').append(domain).append('\n')
            for (input in inputs) {
                val (key, reading) = input.key to input.canonical
                append(key).append('=')
                if (reading == null) append("-")
                else append(reading.toByteArray(Charsets.UTF_8).size).append(':').append(reading)
                append('\n')
            }
        }
        val code = if (inputs.all { it.canonical != null }) {
            val digest = MessageDigest.getInstance("SHA-256").digest(canonical.toByteArray(Charsets.UTF_8))
            codePrefix(domain) + "-" + digest.take(16).joinToString("") { "%02x".format(it) }
        } else null
        CodePart(domain, code, inputs)
    }
}

internal fun codeChanges(before: CodePart, after: CodePart): List<Pair<String, String>> =
    before.inputs.zip(after.inputs).mapNotNull { (a, b) ->
        val from = a.canonical
        val to = b.canonical
        val change = when {
            from == to && (a.reading?.status != b.reading?.status || a.reading?.reason != b.reading?.reason) -> "状态或原因变化"
            from == to -> return@mapNotNull null
            from == null -> "取得读数"
            to == null -> "缺少读数"
            else -> "值变化"
        }
        b.key to change
    }
