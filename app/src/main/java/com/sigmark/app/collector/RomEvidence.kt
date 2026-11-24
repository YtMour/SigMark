package com.sigmark.app.collector

// Versioned boundary for a future explicitly configured, signature-checked ROM
// service. It exchanges a fixed manifest of technical claims and no file paths.
internal fun interface RomEvidenceReader {
    fun readV1(): RomEvidenceEnvelope?
}

internal data class RomEvidenceEnvelope(val schemaVersion: Int, val sampledAtEpochMs: Long, val claims: List<RomClaim>)
internal data class RomClaim(val field: RomEvidenceField, val value: Long)

internal enum class RomEvidenceField(val key: String, val unit: String, val range: LongRange) {
    POSSIBLE_CPU_COUNT("possibleCpuCount","count",1L..4096L),
    ONLINE_CPU_COUNT("onlineCpuCount","count",1L..4096L),
    BATTERY_TEMPERATURE("batteryTemperature","0.1 °C",-500L..1200L),
}

internal sealed interface RomEvidenceResult {
    data object NotAvailable : RomEvidenceResult
    data object Invalid : RomEvidenceResult
    data class Observed(val sampledAtEpochMs: Long, val claims: List<RomClaim>) : RomEvidenceResult {
        val observer = "ROM_SERVICE"
        val assurance = "service_claim"
    }
}

internal fun readRomEvidence(reader: RomEvidenceReader): RomEvidenceResult {
    val packet = try { reader.readV1() } catch (e: java.util.concurrent.CancellationException) {
        throw e
    } catch (_: Exception) {
        return RomEvidenceResult.NotAvailable
    } ?: return RomEvidenceResult.NotAvailable
    if (packet.schemaVersion != 1 || packet.sampledAtEpochMs !in 946684800000L until 4102444800000L ||
        packet.claims.isEmpty() || packet.claims.size > RomEvidenceField.entries.size ||
        packet.claims.distinctBy { it.field }.size != packet.claims.size ||
        packet.claims.any { it.value !in it.field.range }) return RomEvidenceResult.Invalid
    return RomEvidenceResult.Observed(packet.sampledAtEpochMs,packet.claims.sortedBy { it.field.ordinal })
}
