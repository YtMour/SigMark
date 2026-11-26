package com.sigmark.app.security

internal val identityPairs = listOf(
    Triple("system.model", "system.propertyModel", "型号"),
    Triple("system.device", "system.propertyDevice", "设备代号"),
    Triple("system.sku", "system.hardwareSku", "硬件 SKU"),
)

internal fun identityComparableForm(value: String): String =
    buildString(value.length) { value.forEach { append(if (it in 'A'..'Z') it.lowercaseChar() else it) } }

private val identityPlaceholders = setOf("", "unknown", "null", "none", "n/a", "-")
internal fun usableIdentity(raw: String?): String? = raw?.trim()?.takeIf {
    identityComparableForm(it) !in identityPlaceholders
}

internal data class IdentityConsistency(val compared: Int, val total: Int, val differences: List<String>) {
    val complete get() = compared == total
}

internal fun identityConsistency(read: (String) -> String?): IdentityConsistency {
    val api = read("system.api")?.trim()?.takeIf { it.matches(Regex("[1-9][0-9]?")) }?.toInt()
    // Build.SKU was added in API 31. A positive pair is still compared if both
    // readings exist, even when the API declaration is older.
    val applicable = if (api != null && api < 31 && usableIdentity(read("system.sku")) == null)
        identityPairs.dropLast(1) else identityPairs
    var compared = 0
    val differences = mutableListOf<String>()
    for ((leftKey, rightKey, label) in applicable) {
        val left = usableIdentity(read(leftKey)) ?: continue
        val right = usableIdentity(read(rightKey)) ?: continue
        compared++
        if (identityComparableForm(left) != identityComparableForm(right)) differences += label
    }
    return IdentityConsistency(compared, applicable.size, differences)
}
