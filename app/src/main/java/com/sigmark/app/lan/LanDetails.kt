package com.sigmark.app.lan

import com.sigmark.app.model.DeviceSnapshot
import com.sigmark.app.model.ValueStatus
import com.sigmark.app.collector.partitionField

internal data class LanParameter(
    val group: String, val key: String, val label: String, val value: String?, val source: String,
    val status: String, val reason: String?, val errno: Int?, val note: String?,
)

// Only the named fields are serialized, never raw DeviceSnapshot JSON.
private val legacyFields = mapOf(
    "system" to setOf("release","api","patch","type","manufacturer","brand","model","buildId","romHint","uptime","selinux","selinuxPolicy","selinuxBootHint","selinuxBuildHint","socModel","socManufacturer","declaredCapabilities","bootQemu"),
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
    "cellular" to setOf("carrierBandwidths", "simState", "defaultDataSlot", "slotService"),
    "network" to setOf("visibleTransports", "wifiRouteRole"),
    "system" to setOf("display", "incremental", "buildTime", "board", "sku", "baseOs", "tags", "device", "product", "bootloader",
        "partitionCount","webViewProvider","webViewVersion","webViewCode","systemSpl","vendorSpl","initialSdk",
        "boardPlatform","bootHardware","hardwareSku","bootCount","mediaPerformanceClass","propertyModel","propertyDevice","bootQemu"),
    "cpu" to setOf("arch", "abi32", "abi64", "cpuParts", "cpuCapacity"),
    "memory" to setOf("ramUseEstimate", "volumeSummary", "systemSpace", "appCacheSpace", "physicalRam", "kernelMemTotal",
        "cmaTotal"),
    "display" to setOf("wideGamut", "visibleDisplays", "windowSize", "systemBarInsets", "cutoutInsets"),
    "battery" to setOf("capacityPercent", "chargeCounter", "energyCounter", "currentAverage"),
    "runtime" to setOf("featureCount", "openGlEs", "virtualMachine", "heapMax", "heapAllocated", "heapFree", "standbyBucket", "backgroundRestricted", "glesRenderer", "glesVendor"),
    "media" to setOf("cameraCount", "bluetoothCapabilities", "audioCapabilities", "audioSampleRate", "audioBuffer", "codecs"),
    "environment" to setOf("selinuxDomain", "buildSignals", "systemDebuggable", "verifiedBoot", "vbmetaState", "flashLock",
        "keyguardSecure", "storageEncryption", "keyProtection"),
    "app" to setOf("version", "appDebuggable", "debuggerConnected","package","certSha256","channel"),
)

private val capabilityFields = mapOf(
    "runtime" to setOf("vulkanVersion"),
    "media" to setOf("cameraCapabilitySummary"),
    "sensors" to setOf("typeWakeupSummary"),
)

private val acceptanceFields = mapOf(
    "network" to setOf("checkStartTransport","checkEndTransport","checkStartValidated","checkEndValidated","checkElapsed"),
    "environment" to setOf("capturePlan","capturePhoneAccess","captureLocationAccess","captureLocationSwitch"),
    "media" to setOf("avcFixture","avcFirstFrame","avcStage","avcDecoder","avcElapsed"),
)

private val observationFields = mapOf(
    "cpu" to setOf("processBitness","kernelMachine"),
    "system" to setOf("interfaceCapabilities"),
    "runtime" to setOf("externalInputTypes"),
)
private val extendedHardwareFields = mapOf(
    "system" to setOf("gnssHardwareYear", "gnssCapabilities"),
    "runtime" to setOf("declaredInput", "glesProbeResult", "glesProbeVersion", "glesProbeStage"),
    "sensors" to setOf("reportingModes", "fifoCount", "directChannelTypes"),
    "media" to setOf("cameraModes"),
)
private val timedExperimentFields = mapOf(
    "network" to setOf("checkStartAt","checkEndAt"),
    "media" to setOf("avcStartAt","avcEndAt"),
    "runtime" to setOf("glesStartAt","glesEndAt","usbStartAt","usbEndAt","usbStartCount","usbEndCount","usbOutcome","usbElapsed"),
)
// Field set 17: this process's own hook, trace, root, profile, DRM and ROM evidence.
// Field set 25 adds the multi-path overlay evidence behind overlayDeviceCodename.
// environment.androidIdSha256 stays local and is never projected.
private val processEvidenceFields = mapOf(
    "environment" to setOf("hookSignals","tracerPid","rootMountHints","rootManagerVisible","userProfile",
        "overlayDeviceCodename","overlayEvidence",
        "drmSecurityLevel","verityMode","buildDebuggable"),
    "system" to setOf("partitionBuildDates","selinuxEvidence"),
    "cpu" to setOf("coresConfigured"),
)

private val projectionFields = listOf(legacyFields, diagnosticFields, capabilityFields, acceptanceFields,
    observationFields, extendedHardwareFields, timedExperimentFields, processEvidenceFields,
    mapOf("system" to (setOf("gnssProvider","gnssAntennaSupport","gnssModelReported") + com.sigmark.app.collector.gnssCheckKeys)),
    com.sigmark.app.collector.SysfsField.entries.groupBy({ it.group }, { it.key }).mapValues { it.value.toSet() },
    mapOf("battery" to setOf("present","cycleCount"), "cellular" to setOf("dataSubscriptionService")))
    .flatMap { it.entries }.groupBy({ it.key }, { it.value }).mapValues { (_, values) -> values.flatten().toSet() }

internal val lanProjectionKeys: Set<String>
    get() = projectionFields.flatMap { (group, fields) -> fields.map { "$group.$it" } }.toSet()

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
        val fields = projectionFields[section.key].orEmpty()
        section.items.filter { it.key in fields || (section.key == "system" && partitionField(it.key)) }.mapNotNull { item ->
            val value = lanFieldValue(item.value)
            if (item.status == ValueStatus.AVAILABLE && value == null) return@mapNotNull null
            LanParameter(section.key, item.key, clean(item.label, 64) ?: item.key,
                value.takeIf { item.status == ValueStatus.AVAILABLE },
                clean(item.source, 160) ?: "Android", item.status.name, item.reason?.name,
                item.errno, clean(item.note, 280))
        }
    }.distinctBy { it.group to it.key }

internal fun lanFieldValue(value: String?): String? = clean(value, 512)

private fun clean(value: String?, max: Int): String? = value?.replace(Regex("[\\p{Cc}]+"), " ")
    ?.trim()?.takeIf { it.isNotEmpty() }?.let { it.substring(0, it.offsetByCodePoints(0, minOf(max, it.codePointCount(0,it.length)))) }
