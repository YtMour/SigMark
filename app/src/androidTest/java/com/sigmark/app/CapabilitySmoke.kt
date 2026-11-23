package com.sigmark.app

import android.app.Activity
import android.app.Instrumentation
import android.os.Bundle
import com.sigmark.app.collector.DeviceRepository
import com.sigmark.app.collector.DecodeStage
import com.sigmark.app.collector.CapturePlan
import com.sigmark.app.collector.acceptanceEvidence
import com.sigmark.app.collector.RouteCheck
import com.sigmark.app.collector.readRoutePoint
import com.sigmark.app.collector.routeEvidence
import com.sigmark.app.collector.probeMediaDecode
import com.sigmark.app.lan.LanReport
import com.sigmark.app.lan.ReportShelf
import com.sigmark.app.lan.SampleUpload
import com.sigmark.app.lan.lanReport
import com.sigmark.app.model.ValueStatus
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import java.util.UUID

class CapabilitySmoke : Instrumentation() {
    override fun onCreate(arguments: Bundle?) {
        super.onCreate(arguments)
        start()
    }

    override fun onStart() {
        val result = Bundle()
        val code = try {
            val snapshot = runBlocking { DeviceRepository(targetContext).collect() }
            val keys = setOf("runtime.vulkanVersion", "media.cameraCapabilitySummary", "sensors.typeWakeupSummary")
            val decode = runBlocking { probeMediaDecode(targetContext) }
            val report = lanReport(acceptanceEvidence(snapshot, CapturePlan.ROM, decode), BuildConfig.VERSION_NAME, "")
            val fields = report.parameters.associateBy { "${it.group}.${it.key}" }
            check(keys.all(fields::containsKey)) { "Capability summaries missing from LAN projection" }
            val body = JSONObject(report.json().toString(Charsets.UTF_8))
            check(body.getInt("fieldSetVersion") == 10)
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
                check(current.fieldSetVersion == 10 && current.parameters.any { it.key == "avcFirstFrame" && it.value == "pass" })
            }
        } finally {
            targetContext.deleteDatabase(database)
        }
    }
}
