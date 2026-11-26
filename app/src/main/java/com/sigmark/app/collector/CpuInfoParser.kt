package com.sigmark.app.collector

/** /proc/cpuinfo is vendor-specific. These are observed CPU fields, not a SoC model lookup. */
internal object CpuInfoParser {
    fun fields(text: String): Map<String, String> = buildMap {
        text.lineSequence().forEach { line ->
            val separator = line.indexOf(':')
            if (separator > 0) {
                val key = line.substring(0, separator).trim().lowercase()
                val value = line.substring(separator + 1).trim()
                if (key.isNotEmpty() && value.isNotEmpty() && key !in this) put(key, value)
            }
        }
    }

    fun description(fields: Map<String, String>): String? {
        for (key in listOf("hardware", "model name", "processor")) {
            fields[key]?.takeUnless { it.toIntOrNull() != null }?.let { return it }
        }
        val parts = listOfNotNull(
            fields["cpu implementer"]?.let { "implementer $it" },
            fields["cpu part"]?.let { "part $it" },
            fields["cpu architecture"]?.let { "architecture $it" },
        )
        return parts.takeIf { it.isNotEmpty() }?.joinToString(" · ")
    }

    fun features(fields: Map<String, String>): String? =
        fields["features"]?.split(Regex("\\s+"))?.filter { it.isNotBlank() }
            ?.distinct()?.takeIf { it.isNotEmpty() }?.joinToString(", ")

    // Every ARM CPU block carries its own implementer/part pair. The deduplicated
    // `fields` map keeps only the first block, so a device that mixes cores (big.LITTLE)
    // would look like a single core type. This reads every block and counts them.
    fun partSignature(text: String): String? {
        val counts = linkedMapOf<String, Int>()
        var implementer: String? = null
        var part: String? = null
        fun flush() {
            val current = part
            if (current != null) {
                val key = if (implementer != null) "$implementer:$current" else current
                counts[key] = (counts[key] ?: 0) + 1
            }
            implementer = null
            part = null
        }
        for (line in text.lineSequence()) {
            val separator = line.indexOf(':')
            if (separator <= 0) {
                if (line.isBlank()) flush()
                continue
            }
            val key = line.substring(0, separator).trim().lowercase()
            val value = line.substring(separator + 1).trim().lowercase()
            when (key) {
                "processor" -> { flush() }
                "cpu implementer" -> implementer = armCode(value)
                "cpu part" -> part = armCode(value)
            }
        }
        flush()
        if (counts.isEmpty() || counts.size > 12) return null
        return counts.entries.sortedBy { it.key }
            .joinToString(" / ") { (key, count) -> "$key×$count" }
    }

    // Only the 0x-prefixed hexadecimal form is a CPU identifier; anything else is a
    // vendor-specific line and must not be presented as a core type.
    private fun armCode(raw: String): String? = raw.takeIf { it.matches(Regex("0x[0-9a-f]{1,4}")) }
}
