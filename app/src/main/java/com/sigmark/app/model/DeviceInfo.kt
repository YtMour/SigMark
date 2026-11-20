package com.sigmark.app.model

import org.json.JSONArray
import org.json.JSONObject

enum class ValueStatus { AVAILABLE, UNAVAILABLE, RESTRICTED, ERROR }
enum class ReadReason { PERMISSION_REQUIRED, LOCATION_DISABLED, ACCESS_DENIED, NOT_REPORTED, READ_FAILED }

data class DeviceInfoItem(
    val key: String,
    val label: String,
    val value: String?,
    val source: String,
    val status: ValueStatus = ValueStatus.AVAILABLE,
    val note: String? = null,
    val reason: ReadReason? = null,
)

data class DeviceSection(val key: String, val title: String, val items: List<DeviceInfoItem>)

data class DeviceSnapshot(val collectedAt: Long, val sections: List<DeviceSection>) {
    fun toJson(): String = JSONObject().apply {
        put("schemaVersion", 1)
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
