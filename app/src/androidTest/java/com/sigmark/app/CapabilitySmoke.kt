package com.sigmark.app

import android.app.Activity
import android.app.Instrumentation
import android.os.Bundle
import android.os.SystemClock
import com.sigmark.app.collector.DeviceRepository
import com.sigmark.app.collector.DecodeStage
import com.sigmark.app.collector.CapturePlan
import com.sigmark.app.collector.acceptanceEvidence
import com.sigmark.app.collector.RouteCheck
import com.sigmark.app.collector.RoutePoint
import com.sigmark.app.collector.readRoutePoint
import com.sigmark.app.collector.routeEvidence
import com.sigmark.app.collector.probeMediaDecode
import com.sigmark.app.collector.coreHardwareKeys
import com.sigmark.app.collector.graphicsEvidence
import com.sigmark.app.collector.observeUsb
import com.sigmark.app.collector.UsbCheck
import com.sigmark.app.collector.usbEvidence
import com.sigmark.app.collector.clockEvidence
import com.sigmark.app.collector.withExperimentFields
import com.sigmark.app.collector.gnssEvidence
import com.sigmark.app.collector.gnssCheckKeys
import com.sigmark.app.collector.runGnssCheck
import com.sigmark.app.collector.machineCode
import com.sigmark.app.collector.SysfsField
import com.sigmark.app.collector.graphicsHardwareKeys
import com.sigmark.app.collector.probeGraphics
import com.sigmark.app.lan.LanReport
import com.sigmark.app.lan.ReportShelf
import com.sigmark.app.lan.SampleUpload
import com.sigmark.app.lan.lanReport
import com.sigmark.app.lan.lanEndpoint
import com.sigmark.app.lan.sendLanReport
import com.sigmark.app.model.ValueStatus
import com.sigmark.app.security.devicePosture
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import java.util.UUID

class CapabilitySmoke : Instrumentation() {
    private var export = false
    private var routeSmoke = false
    private var gnssSmoke = false
    private var configurationSmoke = false
    private var evidenceDump = false
    private var isolatedPort: Int? = null
    // Field-set-17 keys that must reach the LAN projection on every device.
    private val processEvidenceKeys = setOf(
        "environment.hookSignals", "environment.tracerPid", "environment.rootMountHints",
        "environment.rootManagerVisible", "environment.userProfile", "environment.drmSecurityLevel",
        "environment.verityMode", "environment.buildDebuggable",
        "system.partitionBuildDates", "system.selinuxEvidence", "cpu.coresConfigured",
    )
    override fun onCreate(arguments: Bundle?) {
        super.onCreate(arguments)
        export = arguments?.getString("export") == "fixture"
        routeSmoke = arguments?.getString("route") == "wifi-cellular"
        gnssSmoke = arguments?.getString("gnss") == "check"
        configurationSmoke = arguments?.getString("configuration") == "check"
        evidenceDump = arguments?.getString("evidence") == "dump"
        isolatedPort = arguments?.getString("isolatedUploadPort")?.toIntOrNull()?.takeIf { it in 1024..65535 }
        start()
    }

    override fun onStart() {
        isolatedPort?.let { runIsolatedUpload(it); return }
        if (evidenceDump) { runEvidenceDump(); return }
        if (gnssSmoke) { runGnssSmoke(); return }
        if (configurationSmoke) { runConfigurationSmoke(); return }
        if (routeSmoke) {
            runRouteSmoke()
            return
        }
        val result = Bundle()
        val code = try {
            val snapshot = runBlocking { DeviceRepository(targetContext).collect() }
            val observationKeys = setOf("cpu.processBitness","cpu.kernelMachine","system.interfaceCapabilities","runtime.externalInputTypes")
            val keys = setOf("runtime.vulkanVersion", "media.cameraCapabilitySummary", "sensors.typeWakeupSummary") +
                observationKeys + coreHardwareKeys + graphicsHardwareKeys + processEvidenceKeys
            val avcStart=System.currentTimeMillis()
            val decode = runBlocking { probeMediaDecode(targetContext) }
            val avcEnd=System.currentTimeMillis()
            val glesStart=System.currentTimeMillis()
            val graphics=probeGraphics()
            val glesEnd=System.currentTimeMillis()
            val rom = withExperimentFields(withExperimentFields(
                graphicsEvidence(acceptanceEvidence(snapshot, CapturePlan.ROM, decode), graphics),
                "media",listOf(clockEvidence("avcStartAt","AVC start",avcStart),clockEvidence("avcEndAt","AVC end",avcEnd))),
                "runtime",listOf(clockEvidence("glesStartAt","GLES start",glesStart),clockEvidence("glesEndAt","GLES end",glesEnd)))
            val report = lanReport(rom, BuildConfig.VERSION_NAME, "")
            val fields = report.parameters.associateBy { "${it.group}.${it.key}" }
            check(keys.all(fields::containsKey)) { "Capability summaries missing from LAN projection" }
            val body = JSONObject(report.json().toString(Charsets.UTF_8))
            check(body.getInt("fieldSetVersion") == 20)
            check(fields.getValue("runtime.glesProbeResult").value == "pass") {
                "Fixed EGL readback did not pass: ${fields["runtime.glesProbeStage"]?.value}"
            }
            check(fields.getValue("runtime.glesProbeStage").value == "done")
            check(fields.getValue("cpu.processBitness").value == if (android.os.Process.is64Bit()) "64" else "32")
            check(!fields.containsKey("runtime.inputDeviceNames"))
            val posture = devicePosture(snapshot.sections.flatMap { s -> s.items.map { "${s.key}.${it.key}" to it } }.toMap(), snapshot.collectedAt)
            result.putString("runtimeArchitecture", posture.single { it.id == "runtime_architecture" }.state.name)
            check(fields.getValue("environment.capturePlan").value == "rom")
            check(fields.getValue("media.avcFirstFrame").value == "pass")
            check(fields.getValue("media.avcFixture").value == "sigmark-avc/1")
            val start = readRoutePoint(targetContext)
            val end = readRoutePoint(targetContext)
            val network = lanReport(routeEvidence(acceptanceEvidence(snapshot, CapturePlan.NETWORK, null), RouteCheck(start,end)), BuildConfig.VERSION_NAME, "")
            val networkFields = network.parameters.associateBy { "${it.group}.${it.key}" }
            check(networkFields.containsKey("network.checkStartTransport") && networkFields.containsKey("network.checkEndTransport"))
            check(networkFields.getValue("network.checkElapsed").value?.endsWith(" ms") == true)
            check(network.parameters.none { it.key == "avcFirstFrame" })
            check(network.parameters.none { it.key.startsWith("glesProbe") })
            val standard = lanReport(acceptanceEvidence(snapshot, CapturePlan.STANDARD, null), BuildConfig.VERSION_NAME, "")
            check(coreHardwareKeys.all { key -> standard.parameters.any { "${it.group}.${it.key}" == key } })
            check(standard.parameters.none { it.key.startsWith("glesProbe") })
            check(standard.parameters.none { it.key.startsWith("usb") || it.key.endsWith("StartAt") })
            val usb=lanReport(usbEvidence(acceptanceEvidence(snapshot,CapturePlan.USB,null),
                UsbCheck(observeUsb(targetContext),observeUsb(targetContext))),BuildConfig.VERSION_NAME,"")
            val usbFields=usb.parameters.filter { it.group=="runtime" && it.key.startsWith("usb") }
            check(usbFields.size==6 && usbFields.any{it.key=="usbOutcome" && it.value in listOf("no_change","incomplete")})
            result.putString("usbObservation",usbFields.joinToString { "${it.key}=${it.value?:it.status}" })
            if (export) {
                targetContext.cacheDir.resolve("sigmark-rom-fixture.json").writeBytes(report.json())
                targetContext.cacheDir.resolve("sigmark-usb-fixture.json").writeBytes(usb.json())
            }
            result.putString("routeExperiment", "${start.transport} → ${end.transport}, ${networkFields.getValue("network.checkElapsed").value}")
            for (key in keys + "system.selinux") {
                val field = fields.getValue(key)
                check((field.status == ValueStatus.AVAILABLE.name) == (field.value != null))
                result.putString(key, listOfNotNull(field.status, field.value, field.errno?.let { "errno=$it" }).joinToString(" · "))
            }
            checkShelf(report, keys)
            val access = CollectionAccess.read(targetContext)
            val cellular = snapshot.sections.firstOrNull { it.key == "cellular" }?.items.orEmpty()
            val actions = cellular.mapNotNull { item ->
                collectionAction(android.os.Build.VERSION.SDK_INT,"cellular",item,access)?.let { item.key + "=" + it.name }
            }
            check(collectionAction(android.os.Build.VERSION.SDK_INT, "system",
                snapshot.sections.first { it.key == "system" }.items.first { it.key == "selinux" }, access) == null)
            if (!access.phone && cellular.any { it.key == "slotService" && it.reason == com.sigmark.app.model.ReadReason.PERMISSION_REQUIRED })
                check("slotService=PHONE" in actions)
            result.putString("permissionActions", actions.joinToString(", ").ifEmpty { "none" })
            result.putString("permissionState", access.toString())
            for (key in setOf("system.vendorSpl", "cellular.slotService", "cellular.cellDiagnostics", "cellular.cellLTEBandwidth")) {
                fields[key]?.let { field ->
                    result.putString(key, listOfNotNull(field.status,field.reason,field.value,field.source).joinToString(" · "))
                }
            }
            result.putString("mediaDecode", decode.toString())
            check(decode.stage == DecodeStage.DONE) { "Fixed AVC sample did not decode" }
            result.putString("shelf", "v7 draft metadata and retry bytes preserved")
            result.putString("stream", "Capability collector and LAN projection passed on ${report.model}")
            Activity.RESULT_OK
        } catch (error: Exception) {
            result.putString("stream", error.stackTraceToString())
            Activity.RESULT_CANCELED
        }
        finish(code, result)
    }

    // On-device evidence dump for a real handset. Writes the full local snapshot and
    // the LAN projection into the app-specific external directory so they can be
    // pulled with adb without reading any user data.
    private fun runEvidenceDump() {
        val result = Bundle()
        val code = try {
            val snapshot = runBlocking { DeviceRepository(targetContext).collect() }
            val wire = lanReport(acceptanceEvidence(snapshot, CapturePlan.STANDARD, null), BuildConfig.VERSION_NAME, "")
            val dir = targetContext.getExternalFilesDir(null)
            checkNotNull(dir) { "No app-specific external directory" }
            dir.mkdirs()
            val localFile = dir.resolve("sigmark-local-snapshot.json")
            localFile.writeBytes(snapshot.toJson().toByteArray(Charsets.UTF_8))
            val wireFile = dir.resolve("sigmark-lan-report.json")
            wireFile.writeBytes(wire.json())
            val fields = snapshot.sections.flatMap { section ->
                section.items.map { "${section.key}.${it.key}" to it }
            }.toMap()
            val watched = listOf(
                "system.selinux", "system.selinuxEvidence", "system.selinuxPolicy", "system.bootloader", "system.baseOs",
                "environment.hookSignals", "environment.tracerPid", "environment.rootMountHints",
                "environment.rootManagerVisible", "environment.userProfile", "environment.drmSecurityLevel",
                "environment.verityMode", "environment.buildDebuggable", "environment.storageEncryption",
                "battery.sysBatteryTemp", "battery.temperature", "system.partitionBuildDates", "system.partitionCount", "system.initialSdk",
                "system.bootCount", "system.mediaPerformanceClass",
                "cpu.coresConfigured", "environment.androidIdSha256", "environment.selinuxDomain",
            )
            for (key in watched) {
                val field = fields[key] ?: continue
                result.putString(key, listOfNotNull(field.status.name, field.reason?.name, field.value,
                    field.errno?.let { "errno=$it" }, field.source).joinToString(" · "))
            }
            val counts = snapshot.sections.flatMap { it.items }.groupingBy { it.status }.eachCount()
            result.putString("counts", counts.entries.joinToString(", ") { "${it.key}=${it.value}" })
            result.putString("snapshotFields", snapshot.sections.sumOf { it.items.size }.toString())
            result.putString("archivedFields", wire.parameters.size.toString())
            result.putString("fieldSet", wire.fieldSetVersion.toString())
            result.putString("device", "${android.os.Build.MANUFACTURER} ${android.os.Build.MODEL} / API ${android.os.Build.VERSION.SDK_INT}")
            result.putString("files", "${localFile.absolutePath} ${wireFile.absolutePath}")
            result.putString("stream", "Evidence dump written for ${android.os.Build.MODEL}")
            Activity.RESULT_OK
        } catch (error: Exception) {
            result.putString("stream", error.stackTraceToString())
            Activity.RESULT_CANCELED
        }
        finish(code, result)
    }

    private fun runConfigurationSmoke() {
        val result = Bundle()
        val code = try {
            val first = runBlocking { DeviceRepository(targetContext).collect() }
            val second = runBlocking { DeviceRepository(targetContext).collect() }
            val parts = machineCode(first)
            check(parts.map { it.code } == machineCode(second).map { it.code })
            val wire = lanReport(acceptanceEvidence(second,CapturePlan.STANDARD,null),BuildConfig.VERSION_NAME,"")
            check(wire.fieldSetVersion == 20)
            for (spec in SysfsField.entries) {
                val field=wire.parameters.single { it.group==spec.group && it.key==spec.key }
                check(field.source==spec.node.path)
                check((field.status=="AVAILABLE")== (field.value!=null))
                result.putString(spec.key,listOfNotNull(field.status,field.value,field.reason,field.errno?.toString(),field.source).joinToString(" | "))
            }
            for (part in parts) result.putString(part.domain,part.code ?: "incomplete ${part.available}/${part.inputs.size}")
            result.putString("stream","Repeated App configuration and fixed sysfs projection passed")
            Activity.RESULT_OK
        } catch(e: Exception) {
            result.putString("stream",e.stackTraceToString())
            Activity.RESULT_CANCELED
        }
        finish(code,result)
    }

    private fun runGnssSmoke() {
        val result = Bundle()
        var activity: Activity? = null
        val code = try {
            activity = startActivitySync(android.content.Intent(targetContext, MainActivity::class.java)
                .addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK))
            waitForIdleSync()
            val check = runBlocking { runGnssCheck(targetContext) }
            val snapshot = runBlocking { DeviceRepository(targetContext).collect() }
            val frozen = gnssEvidence(acceptanceEvidence(snapshot, CapturePlan.GNSS, null), check)
            val report = lanReport(frozen,BuildConfig.VERSION_NAME,"")
            val fields = report.parameters.filter { it.group == "system" }.associateBy { it.key }
            check(report.fieldSetVersion == 20 && gnssCheckKeys.all { it in fields })
            check("gnssHardwareModel" !in fields)
            check(fields["gnssCheckPrerequisite"]?.value == check.prerequisite.code)
            check((check.end.mono-check.start.mono) in 0..30_000)
            if (!CollectionAccess.read(targetContext).fine) {
                check(check.status.reason == com.sigmark.app.model.ReadReason.PERMISSION_REQUIRED)
                check(check.measurements.status == ValueStatus.RESTRICTED)
            }
            for (key in gnssCheckKeys+setOf("gnssHardwareYear","gnssCapabilities","gnssProvider","gnssAntennaSupport","gnssModelReported")) {
                val field = fields.getValue(key)
                result.putString(key,listOfNotNull(field.status,field.value,field.reason,field.source).joinToString(" · "))
            }
            result.putString("stream","GNSS App observation and private/archived projection tested")
            Activity.RESULT_OK
        } catch (e: Exception) {
            result.putString("stream", e.stackTraceToString())
            Activity.RESULT_CANCELED
        } finally { activity?.finish() }
        finish(code,result)
    }

    private fun runIsolatedUpload(port: Int) {
        val result=Bundle()
        val database="sigmark-upload-smoke-${UUID.randomUUID()}.db"
        val origin="http://127.0.0.1:$port"
        val code=try {
            val endpoint=checkNotNull(lanEndpoint(origin))
            fun captureReport() = runBlocking {
                lanReport(acceptanceEvidence(DeviceRepository(targetContext).collect(), CapturePlan.STANDARD, null),
                    BuildConfig.VERSION_NAME, "")
            }
            val report=captureReport()
            val installKey=UUID.randomUUID().toString()
            val first=ReportShelf(targetContext,origin,database).use { shelf ->
                shelf.add(SampleUpload(report,associate=true))
                sendLanReport(endpoint,shelf.freeze(shelf.get(report.requestId)),installKey)
            }
            // Reopen without saving the first receipt (e.g. app killed after
            // server acceptance). The stored request goes through the real client again.
            ReportShelf(targetContext,origin,database).use { shelf ->
                val resumed=shelf.get(report.requestId)
                check(resumed.attempted && resumed.receipt==null)
                val retry=sendLanReport(endpoint,shelf.freeze(resumed),installKey)
                check(retry==first && retry.assetLinked==true)
                shelf.finish(report.requestId,retry)
                check(shelf.get(report.requestId).receipt==retry)
                val sibling=captureReport()
                check(sibling.requestId != report.requestId && sibling.capturedAt > report.capturedAt)
                shelf.add(SampleUpload(sibling,associate=true))
                val next=sendLanReport(endpoint,shelf.freeze(shelf.get(sibling.requestId)),installKey)
                check(next.id!=first.id && next.assetLinked==true)
                shelf.finish(sibling.requestId,next)
                check(shelf.list().size==2 && shelf.list().all { it.sent })
                result.putString("reportIds","${first.id},${next.id}")
            }
            result.putInt("fieldSet",report.fieldSetVersion)
            result.putInt("archived",report.parameters.size)
            result.putString("stream","Actual Android HTTP upload, retry, distinct next sample and receipts passed")
            Activity.RESULT_OK
        } catch(error:Exception) {
            result.putString("stream",error.stackTraceToString())
            Activity.RESULT_CANCELED
        } finally {targetContext.deleteDatabase(database)}
        finish(code,result)
    }

    private fun runRouteSmoke() {
        val result = Bundle()
        val marker = targetContext.cacheDir.resolve("sigmark-route-smoke-ready")
        val output = targetContext.cacheDir.resolve("sigmark-route-smoke.json")
        val code = try {
            val first = readRoutePoint(targetContext)
            check(first.transport == "wifi") { "Expected Wi-Fi start, observed ${first.transport}" }
            marker.writeText("wifi")
            val deadline = SystemClock.elapsedRealtime() + 28_000
            var last = first
            while (SystemClock.elapsedRealtime() < deadline) {
                last = readRoutePoint(targetContext)
                if (last.transport == "cellular" && last.validated == true) break
                SystemClock.sleep(400)
            }
            check(last.transport == "cellular") { "No stable cellular endpoint; last=${last.transport}" }
            val snapshot = runBlocking { DeviceRepository(targetContext).collect() }
            val report = lanReport(routeEvidence(acceptanceEvidence(snapshot, CapturePlan.NETWORK, null), RouteCheck(first, last)),
                BuildConfig.VERSION_NAME, "")
            output.writeBytes(report.json())
            result.putString("stream", "Device route observed: ${first.transport} -> ${last.transport}, validated=${last.validated}")
            Activity.RESULT_OK
        } catch (error: Exception) {
            result.putString("stream", error.message ?: "Route smoke failed")
            Activity.RESULT_CANCELED
        } finally {
            marker.delete()
        }
        finish(code, result)
    }

    private fun checkShelf(report: LanReport, newKeys: Set<String>) {
        val database = "sigmark-smoke-${UUID.randomUUID()}.db"
        val origin = "smoke-fixture"
        try {
            val old = report.copy(
                requestId = UUID.randomUUID().toString(),
                appVersion = "0.18.2",
                fieldSetVersion = 7,
                parameters = report.parameters.filterNot {
                    "${it.group}.${it.key}" in newKeys || it.key.startsWith("avc") || it.key.startsWith("capture")
                },
            )
            ReportShelf(targetContext, origin, database).use { shelf ->
                shelf.add(SampleUpload(old, associate = true))
                shelf.add(SampleUpload(report, associate = false))
                val restored = shelf.get(old.requestId)
                check(restored.report.fieldSetVersion == 7 && restored.report.appVersion == "0.18.2")
                shelf.edit(restored.copy(report = restored.report.copy(feedback = "fixture")))
                val edited = shelf.get(old.requestId)
                val first = shelf.freeze(edited)
                val wire = JSONObject(first.toString(Charsets.UTF_8))
                check(wire.getInt("fieldSetVersion") == 7 && wire.getString("feedback") == "fixture")
                check(wire.getString("requestId") == old.requestId)
                val retry = shelf.get(old.requestId)
                check(retry.attempted && retry.associate)
                check(shelf.freeze(retry).contentEquals(first))
                val current = shelf.get(report.requestId).report
                check(current.fieldSetVersion == 20 && current.parameters.any { it.key == "avcFirstFrame" && it.value == "pass" })
            }
        } finally {
            targetContext.deleteDatabase(database)
        }
    }
}
