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
}
