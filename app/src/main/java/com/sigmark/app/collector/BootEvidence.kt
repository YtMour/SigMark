package com.sigmark.app.collector

internal fun bootEvidence(color: String?, vbmeta: String?, flash: String?): String {
    val boot = color?.trim()?.lowercase()
    val locked = vbmeta?.trim()?.lowercase() == "locked" || flash?.trim() == "1"
    val unlocked = vbmeta?.trim()?.lowercase() == "unlocked" || flash?.trim() == "0"
    return when {
        boot == "red" -> "red"
        locked && unlocked || boot in setOf("green","yellow") && unlocked || boot == "orange" && locked -> "conflict"
        boot == "orange" || unlocked -> "unlocked"
        boot == "yellow" -> "custom"
        boot == "green" && locked -> "locked"
        else -> "unknown"
    }
}
