package com.sigmark.app

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import androidx.core.location.LocationManagerCompat
import android.location.LocationManager
import com.sigmark.app.model.DeviceInfoItem
import com.sigmark.app.model.ReadReason
import com.sigmark.app.model.ValueStatus

internal data class CollectionAccess(
    val phone: Boolean,
    val fine: Boolean,
    val coarse: Boolean,
    val location: Boolean?,
) {
    companion object {
        fun read(context: Context): CollectionAccess {
            fun has(p: String) = context.checkSelfPermission(p) == PackageManager.PERMISSION_GRANTED
            return CollectionAccess(has(Manifest.permission.READ_PHONE_STATE),
                has(Manifest.permission.ACCESS_FINE_LOCATION), has(Manifest.permission.ACCESS_COARSE_LOCATION),
                runCatching { context.getSystemService(LocationManager::class.java)?.let(LocationManagerCompat::isLocationEnabled) }.getOrNull())
        }
    }
}

internal enum class AccessAction(val title: String) {
    PHONE("授权电话状态"), FINE("授权精确位置"), LOCATION("打开系统位置"),
    RECHECK("查看当前授权"),
}

internal enum class PermissionRoute { REQUEST, SETTINGS, RECHECK }

internal fun permissionRoute(granted: Boolean, wasDenied: Boolean, rationale: Boolean, approximateOnly: Boolean) = when {
    granted -> PermissionRoute.RECHECK
    approximateOnly || (wasDenied && !rationale) -> PermissionRoute.SETTINGS
    else -> PermissionRoute.REQUEST
}

internal data class NetworkAccessNeeds(val phone: Boolean, val fine: Boolean) {
    fun next(access: CollectionAccess): AccessAction = when {
        phone && !access.phone -> AccessAction.PHONE
        fine && !access.fine -> AccessAction.FINE
        fine && access.location == false -> AccessAction.LOCATION
        else -> AccessAction.RECHECK
    }
}

// This map describes the requirements of known collectors, not a guess from a denied system call.
internal fun networkAccessNeeds(api: Int, group: String, key: String): NetworkAccessNeeds? {
    if (group != "cellular") return null
    return when (key) {
        "dataRat" -> if (api < 33) NetworkAccessNeeds(phone = true, fine = false) else null
        "defaultDataSlot" -> if (api < 29) NetworkAccessNeeds(phone = true, fine = false) else null
        "slotService" -> if (api >= 28) NetworkAccessNeeds(phone = true, fine = api < 33) else null
        "cellDiagnostics", "cellLTEBandwidth" -> NetworkAccessNeeds(phone = false, fine = true)
        else -> null
    }
}

internal fun collectionAction(api: Int, group: String, item: DeviceInfoItem, access: CollectionAccess): AccessAction? {
    if (item.status != ValueStatus.RESTRICTED ||
        item.reason !in setOf(ReadReason.PERMISSION_REQUIRED, ReadReason.LOCATION_DISABLED)) return null
    return networkAccessNeeds(api, group, item.key)?.next(access)
}

internal fun restrictionLabel(item: DeviceInfoItem): String = when (item.reason) {
    ReadReason.PERMISSION_REQUIRED -> "需用户授权"
    ReadReason.LOCATION_DISABLED -> "系统位置已关闭"
    ReadReason.ACCESS_DENIED -> if (item.key == "selinux") "系统拒读 · 模式未确认" else "系统拒绝读取"
    else -> "访问受限"
}
