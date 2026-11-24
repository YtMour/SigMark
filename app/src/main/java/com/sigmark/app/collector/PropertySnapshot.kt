package com.sigmark.app.collector

// One getprop call per collection. The parsed map is read-only; when the dump is
// complete an absent key means the property is not visible to this app, so no
// per-key getprop is spawned. A truncated or failed dump falls back to single
// keys, where a read can still succeed beyond the byte limit.
internal object PropertySnapshot {
    @Volatile private var entries: Map<String, String> = emptyMap()
    @Volatile private var complete: Boolean = false

    fun refresh() {
        val reading = SafeReader.propertySnapshot()
        val raw = reading.value
        entries = raw?.let(::parsePropertySnapshot).orEmpty()
        complete = raw != null && raw.toByteArray(Charsets.UTF_8).size < SafeReader.propertySnapshotMaxBytes
    }

    fun record(key: String): String? = entries[key]

    // True only when the dump finished inside its byte limit. Callers may then
    // treat an absent key as "not reported" instead of retrying it one by one.
    fun authoritative(): Boolean = complete
}

private val propertyKeyPattern = Regex("[A-Za-z0-9_.\\-]{1,128}")

internal fun parsePropertySnapshot(raw: String): Map<String, String> {
    val parsed = LinkedHashMap<String, String>()
    for (line in raw.lineSequence()) {
        val text = line.trim()
        if (!text.startsWith("[")) continue
        val separator = text.indexOf("]: [")
        if (separator <= 1) continue
        val key = text.substring(1, separator)
        if (!propertyKeyPattern.matches(key)) continue
        val tail = text.substring(separator + 4)
        if (!tail.endsWith("]")) continue
        parsed[key] = tail.dropLast(1)
    }
    return parsed.toMap()
}
