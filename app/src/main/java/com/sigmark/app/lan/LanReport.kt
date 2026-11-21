package com.sigmark.app.lan

import com.sigmark.app.model.DeviceSnapshot
import com.sigmark.app.model.ValueStatus
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.Proxy
import java.net.URI
import java.util.UUID

internal val reportFields = linkedMapOf(
    "system.selinux" to "SELinux 模式", "cpu.kernelFull" to "内核编译信息",
    "network.wifiFrequency" to "Wi-Fi 频率", "network.internetValidation" to "互联网验证",
    "cellular.dataRat" to "蜂窝制式", "cellular.cellDiagnostics" to "小区无线参数",
)

internal data class LanMetric(val key: String, val status: String, val reason: String?)
internal const val LanFieldSetVersion = 7

internal data class LanReport(
    val model: String, val androidApi: Int, val network: String, val wifiBand: String, val radio: String,
    val capturedAt: Long, val appVersion: String, val metrics: List<LanMetric>, val feedback: String,
    val parameters: List<LanParameter>,
    val coverage: List<LanCoverage>,
    val requestId: String = UUID.randomUUID().toString(),
) {
    fun json(): ByteArray = JSONObject().apply {
        put("schemaVersion", 4); put("requestId", requestId); put("capturedAtEpochMs", capturedAt)
        put("collectorVersion", appVersion); put("fieldSetVersion", LanFieldSetVersion)
        put("model", model); put("androidApi", androidApi); put("appVersion", appVersion)
        put("network", network); put("wifiBand", wifiBand); put("radio", radio)
        if (feedback.isNotEmpty()) put("feedback", feedback)
        put("metrics", JSONArray().apply {
            metrics.forEach { add -> put(JSONObject().apply {
                put("key", add.key); put("status", add.status)
                if (add.reason != null) put("reason", add.reason)
            }) }
        })
        put("parameters", JSONArray().apply {
            parameters.forEach { field -> put(JSONObject().apply {
                put("group", field.group); put("key", field.key); put("label", field.label)
                put("value", field.value ?: JSONObject.NULL); put("source", field.source); put("status", field.status)
                field.reason?.let { put("reason", it) }; field.errno?.let { put("errno", it) }
                field.note?.let { put("note", it) }
            }) }
        })
        put("coverage", JSONArray().apply {
            coverage.forEach { row -> put(JSONObject().apply {
                put("group", row.group); put("available", row.available); put("restricted", row.restricted)
                put("unavailable", row.unavailable); put("errors", row.errors)
            }) }
        })
    }.toString().toByteArray(Charsets.UTF_8)
}

internal fun lanReport(snapshot: DeviceSnapshot, appVersion: String, feedback: String): LanReport {
    val fields = snapshot.sections.flatMap { section -> section.items.map { "${section.key}.${it.key}" to it } }.toMap()
    fun get(key: String) = fields[key]?.takeIf { it.status == ValueStatus.AVAILABLE }?.value.orEmpty()
    val model = get("system.model").trim().takeIf { it.matches(Regex("[\\p{L}\\p{N} ._+()\\-]{1,40}")) } ?: "unknown"
    val transports = get("network.transport").split(" + ")
    val network = when {
        "VPN" in transports -> "vpn"
        "Wi-Fi" in transports -> "wifi"
        "蜂窝网络" in transports -> "cellular"
        "以太网" in transports -> "ethernet"
        "无默认网络" in transports -> "none"
        transports.all { it.isEmpty() } -> "unknown"
        else -> "other"
    }
    val band = get("network.wifiBandChannel").substringBefore(" GHz").takeIf { it in setOf("2.4", "4.9", "5", "6", "60") } ?: "unknown"
    val radio = when (get("cellular.dataRat").substringBefore(' ')) {
        "LTE" -> "lte"; "NR" -> "nr"; "IWLAN" -> "iwlan"; "" -> "unknown"; else -> "other"
    }
    val metrics = reportFields.keys.mapNotNull { key -> fields[key]?.let { LanMetric(key,it.status.name,it.reason?.name) } }
    // Variant output overrides can differ from the source build's default version.
    val installedVersion = Regex("""([0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}) \([1-9][0-9]*\)""")
        .matchEntire(get("app.version"))?.groupValues?.get(1) ?: appVersion
    return LanReport(model, get("system.api").toIntOrNull()?.takeIf { it in 1..999 } ?: 0,
        network, band, radio, snapshot.collectedAt, installedVersion, metrics, feedback, lanParameters(snapshot), lanCoverage(snapshot))
}

// Numeric IPv4 only: keeps test reports on the configured local endpoint.
internal fun lanEndpoint(raw: String): URI? {
    val input = raw.trim()
    if (input.length > 64) return null
    val uri = try { URI(input) } catch (_: Exception) { return null }
    if (uri.scheme != "http" || uri.userInfo != null || uri.rawQuery != null || uri.rawFragment != null ||
        uri.port !in 1..65535 || uri.rawPath !in setOf("", "/")) return null
    val host = uri.host ?: return null
    val octets = host.split('.').map { part -> part.toIntOrNull()?.takeIf { it in 0..255 && it.toString() == part } ?: return null }
    if (octets.size != 4) return null
    val local = host == "127.0.0.1" || octets[0] == 10 ||
        (octets[0] == 172 && octets[1] in 16..31) || (octets[0] == 192 && octets[1] == 168)
    if (!local) return null
    return URI("http", null, host, uri.port, "/api/v1/reports", null, null)
}

internal fun validFeedback(text: String): Boolean = text.codePointCount(0,text.length) <= 300 &&
    text.none { Character.isISOControl(it) }

internal fun sendLanReport(endpoint: URI, payload: ByteArray, assetKey: String? = null): UploadReceipt {
    check(lanEndpoint("http://${endpoint.host}:${endpoint.port}") == endpoint)
    val http = endpoint.toURL().openConnection(Proxy.NO_PROXY) as HttpURLConnection
    return try {
        http.connectTimeout = 6_000; http.readTimeout = 8_000
        http.requestMethod = "POST"
        http.instanceFollowRedirects = false
        http.doOutput = true
        http.setRequestProperty("Content-Type", "application/json")
        http.setRequestProperty("X-SigMark-Client", "android-lan")
        assetKey?.let { http.setRequestProperty("X-SigMark-Asset-Key", it) }
        http.setFixedLengthStreamingMode(payload.size)
        http.outputStream.use { it.write(payload) }
        when (http.responseCode) {
            201 -> http.inputStream.use { input ->
                val bytes = ByteArray(1024)
                var count = 0
                while (count < bytes.size) {
                    val n = input.read(bytes, count, bytes.size - count)
                    if (n < 0) break
                    count += n
                }
                val reply = JSONObject(String(bytes, 0, count, Charsets.UTF_8))
                val id = reply.optString("reportId")
                require(runCatching { UUID.fromString(id).toString() == id }.getOrDefault(false))
                UploadReceipt(id, reply.opt("assetLinked") as? Boolean)
            }
            403 -> throw LanFailure("后台未接受当前客户端，请确认手机和管理台版本匹配。")
            400 -> throw LanFailure("报告未通过校验。请检查设备时间，刷新采集后重试。")
            413 -> throw LanFailure("报告超过后台接收上限。")
            409 -> throw LanFailure("提交编号已对应另一份内容，未覆盖旧报告。如需产生新报告，请重新采样。")
            429 -> throw LanFailure("提交过快，请稍候再试。")
            503 -> {
                val message = http.errorStream?.bufferedReader()?.use {
                    val text = CharArray(512)
                    val count = it.read(text)
                    if (count > 0) String(text, 0, count) else ""
                }
                if (message?.contains("\"uploads_paused\"") == true) throw LanFailure("管理员已暂停接收报告。可先保存本地 JSON。")
                throw LanFailure("后台暂时无法接收报告，请稍后重试。")
            }
            else -> throw LanFailure("服务端暂未接收报告（HTTP ${http.responseCode}）。")
        }
    } finally { http.disconnect() }
}

internal class LanFailure(message: String) : Exception(message)
