package com.sigmark.app.security

import com.sigmark.app.BuildConfig
import com.sigmark.app.model.DeviceInfoItem
import com.sigmark.app.model.DeviceSnapshot
import com.sigmark.app.model.ValueStatus
import org.json.JSONObject

internal val appIdentityFields = linkedMapOf(
    "model" to "型号",
    "device" to "设备代号",
    "initialSdk" to "设备初始 API 级别",
    "boardPlatform" to "平台代号声明",
    "bootHardware" to "启动硬件声明",
    "hardwareSku" to "启动硬件 SKU",
)

internal fun appIdentityRows(snapshot: DeviceSnapshot): Map<String, DeviceInfoItem?> {
    val system = snapshot.sections.firstOrNull { it.key == "system" }?.items.orEmpty().associateBy { it.key }
    return appIdentityFields.keys.associateWith(system::get)
}

internal fun appIdentityJson(snapshot: DeviceSnapshot): String = JSONObject().apply {
    put("schema", "sigmark-app-identity/1")
    put("observer", "APP")
    put("capturedAtEpochMs", snapshot.collectedAt)
    put("collectorVersion", BuildConfig.VERSION_NAME)
    put("readings", JSONObject().apply {
        for ((key, item) in appIdentityRows(snapshot)) {
            put("system.$key", JSONObject().apply {
                put("status", item?.status?.name ?: "NOT_ARCHIVED")
                put("value", item?.value?.takeIf { item.status == ValueStatus.AVAILABLE } ?: JSONObject.NULL)
                put("source", item?.source ?: JSONObject.NULL)
                item?.reason?.let { put("reason", it.name) }
                item?.errno?.let { put("errno", it) }
            })
        }
    })
}.toString(2)
