package com.sigmark.app.lan

import com.sigmark.app.model.DeviceSnapshot
import com.sigmark.app.model.ValueStatus

internal data class LanParameter(
    val group: String, val key: String, val label: String, val value: String?, val source: String,
    val status: String, val reason: String?, val errno: Int?, val note: String?,
)

// Only the named fields are serialized, never raw DeviceSnapshot JSON.
private val legacyFields = mapOf(
    "system" to setOf("release","api","patch","type","manufacturer","brand","model","buildId","romHint","uptime","selinux","selinuxPolicy","selinuxBootHint","selinuxBuildHint","socModel","socManufacturer","declaredCapabilities"),
    "cpu" to setOf("kernel","kernelFull","abis","hardware","cores","pageSize","cpuInfo","features","cpu0MaxFrequency"),
    "memory" to setOf("totalRam","availableRam","lowMemory","lowMemoryThreshold","swap","internalTotal","internalAvailable","sharedState"),
    "display" to setOf("resolution","densityDpi","density","fontScale","refresh","modes","hdr","sizeEstimate"),
    "battery" to setOf("level","status","plugged","temperature","voltage","health","current","powerSaver","thermalStatus"),
    "sensors" to setOf("count"),
    "network" to setOf("transport","internetValidation","metered","captivePortal","bandwidthEstimate","wifiDetails","wifiFrequency","wifiBandChannel","wifiRssi","wifiLinkSpeed","wifiStandard","wifiSecurity","linkDetails","defaultRouteFamilies","privateDnsActive","linkMtu"),
    "cellular" to setOf("support","subscription","dataState","mobileDataToggle","roaming","dataRat","modemSignalLevel","cellDiagnostics",
        "cellLTEBands","cellLTEBandRange","cellLTEBandwidth","cellLTESignal","cellNRBands","cellNRSignal"),
)

private val diagnosticFields = mapOf(
    "cellular" to setOf("carrierBandwidths", "simState"),
    "network" to setOf("visibleTransports", "wifiRouteRole"),
    "system" to setOf("display", "incremental", "buildTime", "board", "sku", "baseOs", "tags", "device", "product", "bootloader"),
    "cpu" to setOf("arch", "abi32", "abi64"),
    "memory" to setOf("ramUseEstimate", "volumeSummary", "systemSpace", "appCacheSpace"),
    "display" to setOf("wideGamut", "visibleDisplays", "windowSize", "systemBarInsets", "cutoutInsets"),
    "battery" to setOf("capacityPercent", "chargeCounter", "energyCounter", "currentAverage"),
    "runtime" to setOf("featureCount", "openGlEs", "virtualMachine", "heapMax", "heapAllocated", "heapFree", "standbyBucket", "backgroundRestricted"),
    "media" to setOf("cameraCount", "bluetoothCapabilities", "audioCapabilities", "audioSampleRate", "audioBuffer", "codecs"),
    "environment" to setOf("selinuxDomain", "buildSignals", "systemDebuggable", "verifiedBoot", "vbmetaState", "flashLock"),
    "app" to setOf("version", "appDebuggable", "debuggerConnected"),
)

internal data class LanCoverage(
    val group: String,
    val available: Int,
    val restricted: Int,
    val unavailable: Int,
    val errors: Int,
) {
    val total: Int get() = available + restricted + unavailable + errors
}

internal fun lanCoverage(snapshot: DeviceSnapshot): List<LanCoverage> =
    snapshot.sections.groupBy { it.key }.map { (group, sections) ->
        val counts = sections.flatMap { it.items }.distinctBy { it.key }.groupingBy { it.status }.eachCount()
        LanCoverage(group, counts[ValueStatus.AVAILABLE] ?: 0, counts[ValueStatus.RESTRICTED] ?: 0,
            counts[ValueStatus.UNAVAILABLE] ?: 0, counts[ValueStatus.ERROR] ?: 0)
    }.filter { it.total > 0 }

internal fun lanParameters(snapshot: DeviceSnapshot): List<LanParameter> =
    snapshot.sections.flatMap { section ->
        val fields = legacyFields[section.key].orEmpty() + diagnosticFields[section.key].orEmpty()
        section.items.filter { it.key in fields }.mapNotNull { item ->
            val value = clean(item.value, 512)
            if (item.status == ValueStatus.AVAILABLE && value == null) return@mapNotNull null
            LanParameter(section.key, item.key, clean(item.label, 64) ?: item.key,
                value.takeIf { item.status == ValueStatus.AVAILABLE },
                clean(item.source, 160) ?: "Android", item.status.name, item.reason?.name,
                item.errno, clean(item.note, 280))
        }
    }.distinctBy { it.group to it.key }

private fun clean(value: String?, max: Int): String? = value?.replace(Regex("[\\p{Cc}]+"), " ")
    ?.trim()?.takeIf { it.isNotEmpty() }?.let { it.substring(0, it.offsetByCodePoints(0, minOf(max, it.codePointCount(0,it.length)))) }
