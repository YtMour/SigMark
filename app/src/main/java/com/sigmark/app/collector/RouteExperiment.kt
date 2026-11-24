package com.sigmark.app.collector

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.SystemClock
import com.sigmark.app.model.DeviceInfoItem
import com.sigmark.app.model.DeviceSnapshot
import com.sigmark.app.model.ReadReason
import com.sigmark.app.model.ValueStatus

internal data class RoutePoint(val timeMs: Long, val transport: String?, val validated: Boolean?, val wallTimeMs: Long? = null)

internal fun readRoutePoint(context: Context): RoutePoint {
    val at = SystemClock.elapsedRealtime()
    val wall = System.currentTimeMillis()
    return runCatching {
        val manager = context.getSystemService(ConnectivityManager::class.java)
            ?: return@runCatching RoutePoint(at, null, null, wall)
        val active = manager.activeNetwork ?: return@runCatching RoutePoint(at, "none", null, wall)
        val caps = manager.getNetworkCapabilities(active) ?: return@runCatching RoutePoint(at, null, null, wall)
        val transport = when {
            caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN) -> "vpn"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "cellular"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "ethernet"
            else -> "other"
        }
        RoutePoint(at, transport, caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED), wall)
    }.getOrElse { RoutePoint(at, null, null, wall) }
}

internal data class RouteCheck(val start: RoutePoint, val end: RoutePoint)
internal fun routeEvidence(snapshot: DeviceSnapshot, check: RouteCheck): DeviceSnapshot {
    val source = "ConnectivityManager.activeNetwork / NetworkCapabilities"
    fun item(key: String, label: String, value: String?, from: String = source, note: String? = null) =
        DeviceInfoItem(key, label, value, from, if (value == null) ValueStatus.UNAVAILABLE else ValueStatus.AVAILABLE,
            note = note, reason = if (value == null) ReadReason.NOT_REPORTED else null)
    val extra = listOf(
        item("checkStartTransport", "实验起点默认链路", check.start.transport),
        item("checkEndTransport", "实验终点默认链路", check.end.transport),
        item("checkStartValidated", "实验起点联网验证", check.start.validated?.let { if (it) "yes" else "no" }),
        item("checkEndValidated", "实验终点联网验证", check.end.validated?.let { if (it) "yes" else "no" }),
        item("checkElapsed", "两次观测间隔", (check.end.timeMs-check.start.timeMs).takeIf { it in 0..600_000 }?.let { "$it ms" },
            "SystemClock.elapsedRealtime", "两次手动观测的间隔，不是断网时长。"),
        clockEvidence("checkStartAt", "网络实验起点时间", check.start.wallTimeMs),
        clockEvidence("checkEndAt", "网络实验终点时间", check.end.wallTimeMs),
    )
    return snapshot.copy(sections = snapshot.sections.map {
        if(it.key=="network") it.copy(items=it.items.filterNot { p->extra.any { e->e.key==p.key } }+extra) else it
    })
}
