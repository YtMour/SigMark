package com.sigmark.app.model

import com.sigmark.app.BuildConfig
import org.json.JSONArray
import org.json.JSONObject

enum class ValueStatus { AVAILABLE, UNAVAILABLE, RESTRICTED, ERROR }
enum class ReadReason {
    PERMISSION_REQUIRED, LOCATION_DISABLED, ACCESS_DENIED, NOT_REPORTED, NODE_MISSING, INVALID_VALUE, READ_FAILED,
    OPTIONAL_UNSET, INTERFACE_UNSUPPORTED, MODEM_NOT_REPORTED, NO_REGISTERED_LTE,
}

fun unavailableLabel(reason: ReadReason?): String = when (reason) {
    ReadReason.NODE_MISSING -> "节点未暴露"
    ReadReason.INVALID_VALUE -> "状态未确认"
    ReadReason.OPTIONAL_UNSET -> "可选字段未提供"
    ReadReason.INTERFACE_UNSUPPORTED -> "当前接口不提供"
    ReadReason.MODEM_NOT_REPORTED -> "调制解调器未上报"
    ReadReason.NO_REGISTERED_LTE -> "无已注册 LTE 小区"
    else -> "暂无数据"
}

data class DeviceInfoItem(
    val key: String,
    val label: String,
    val value: String?,
    val source: String,
    val status: ValueStatus = ValueStatus.AVAILABLE,
    val note: String? = null,
    val reason: ReadReason? = null,
    val errno: Int? = null,
)

data class DeviceSection(val key: String, val title: String, val items: List<DeviceInfoItem>)

data class DeviceSnapshot(val collectedAt: Long, val sections: List<DeviceSection>) {
    fun toJson(): String = JSONObject().apply {
        put("schemaVersion", 1)
        put("collectorVersion", BuildConfig.VERSION_NAME)
        put("app", "SigMark")
        put("collectedAtEpochMs", collectedAt)
        put("sections", JSONArray().also { sectionArray ->
            sections.forEach { section ->
                sectionArray.put(JSONObject().apply {
                    put("key", section.key)
                    put("title", section.title)
                    put("items", JSONArray().also { itemArray ->
                        section.items.forEach { item ->
                            itemArray.put(JSONObject().apply {
                                put("key", item.key)
                                put("label", item.label)
                                put("value", item.value ?: JSONObject.NULL)
                                put("source", item.source)
                                put("status", item.status.name)
                                put("note", item.note ?: JSONObject.NULL)
                                if (item.reason != null) put("reason", item.reason.name)
                                if (item.errno != null) put("errno", item.errno)
                            })
                        }
                    })
                })
            }
        })
    }.toString(2)
}

fun normalizeValue(value: String?): String? = value?.trim()?.takeIf {
    it.isNotEmpty() && !it.equals("unknown", ignoreCase = true) && it != "null"
}
