package com.sigmark.app

import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities as Caps
import android.net.wifi.WifiInfo
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.LifecycleStartEffect
import org.json.JSONArray
import org.json.JSONObject

private data class LinkState(val transport: String, val validated: Boolean?, val wifiDbm: Int?)
private data class LinkEvent(val elapsedMs: Long, val state: LinkState)
private const val TimelineDurationMs = 60_000L
private const val TimelineLimit = 120

private fun observe(caps: Caps?): LinkState {
    if (caps == null) return LinkState("未见默认网络", null, null)
    val names = buildList {
        if (caps.hasTransport(Caps.TRANSPORT_WIFI)) add("Wi-Fi")
        if (caps.hasTransport(Caps.TRANSPORT_CELLULAR)) add("蜂窝网络")
        if (caps.hasTransport(Caps.TRANSPORT_VPN)) add("VPN")
        if (caps.hasTransport(Caps.TRANSPORT_ETHERNET)) add("以太网")
    }
    val signal = if (Build.VERSION.SDK_INT >= 31 && caps.hasTransport(Caps.TRANSPORT_WIFI))
        (caps.transportInfo as? WifiInfo)?.rssi?.takeIf { it in -126..0 } else null
    return LinkState(names.joinToString(" / ").ifEmpty { "其他网络" }, caps.hasCapability(Caps.NET_CAPABILITY_VALIDATED), signal)
}

@Composable
internal fun NetworkTimeline(onExport: (String) -> Unit, onClose: () -> Unit) {
    val context = LocalContext.current
    val manager = remember(context) { context.getSystemService(ConnectivityManager::class.java) }
    val events = remember { mutableStateListOf<LinkEvent>() }
    var recording by remember { mutableStateOf(false) }
    var notice by remember { mutableStateOf("点击开始后，在系统快捷设置切换 Wi-Fi 或移动数据。") }
    if (recording && manager != null) {
        LifecycleStartEffect(manager) {
            val handler = Handler(Looper.getMainLooper())
            val start = SystemClock.elapsedRealtime()
            var listening = true
            var current: Network? = null
            fun add(state: LinkState) {
                if (!listening || events.lastOrNull()?.state == state || events.size >= TimelineLimit) return
                events += LinkEvent(SystemClock.elapsedRealtime() - start, state)
                if (events.size >= TimelineLimit) {
                    notice = "已达到记录上限。"
                    recording = false
                }
            }
            val lost = Runnable { if (current == null) add(observe(null)) }
            val callback = object : ConnectivityManager.NetworkCallback() {
                override fun onAvailable(network: Network) {
                    handler.removeCallbacks(lost)
                    current = network
                }
                override fun onCapabilitiesChanged(network: Network, networkCapabilities: Caps) {
                    if (current == network) add(observe(networkCapabilities))
                }
                override fun onLost(network: Network) {
                    if (current == network) {
                        current = null
                        handler.postDelayed(lost, 300)
                    }
                }
            }
            val finish = Runnable { notice = "已完成 60 秒记录。"; recording = false }
            val registered = try {
                current = manager.activeNetwork
                add(observe(current?.let(manager::getNetworkCapabilities)))
                manager.registerDefaultNetworkCallback(callback, handler)
                true
            } catch (_: Exception) {
                notice = "系统未能启动默认网络监听。"
                recording = false
                false
            }
            if (registered) handler.postDelayed(finish, TimelineDurationMs)
            onStopOrDispose {
                listening = false
                handler.removeCallbacks(lost)
                handler.removeCallbacks(finish)
                if (registered) runCatching { manager.unregisterNetworkCallback(callback) }
                if (recording) { recording = false; notice = "已停止前台记录。" }
            }
        }
    }
    AlertDialog(onDismissRequest = onClose, title = { Text("链路切换记录") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("仅在前台记录默认链路、系统联网验证与可见 Wi-Fi 信号，最多 60 秒。只供本地查看或导出。")
                Text(if (recording) "正在记录 · ${events.size} 条" else notice)
                if (events.isNotEmpty()) LazyColumn(Modifier.heightIn(max = 240.dp)) {
                    items(events) { event ->
                        val verified = when (event.state.validated) { true -> "已验证联网"; false -> "未验证联网"; null -> "验证状态未知" }
                        Text("+${event.elapsedMs} ms · ${event.state.transport} · $verified" +
                            (event.state.wifiDbm?.let { " · $it dBm" } ?: ""), modifier = Modifier.padding(vertical = 4.dp))
                    }
                }
                if (!recording && events.isNotEmpty()) TextButton(onClick = {
                    onExport(JSONObject().apply {
                        put("schemaVersion", 1)
                        put("source", "ConnectivityManager.NetworkCallback")
                        put("events", JSONArray().apply { events.forEach { event ->
                            put(JSONObject().apply {
                                put("elapsedMs", event.elapsedMs)
                                put("transport", event.state.transport)
                                put("validated", event.state.validated ?: JSONObject.NULL)
                                put("wifiRssiDbm", event.state.wifiDbm ?: JSONObject.NULL)
                            })
                        } })
                    }.toString(2))
                }) { Text("导出时间线 JSON") }
            }
        },
        confirmButton = { TextButton(enabled = manager != null, onClick = {
            if (recording) { recording = false; notice = "已停止记录。" }
            else { events.clear(); recording = true }
        }) { Text(if (recording) "停止记录" else "开始 60 秒记录") } },
        dismissButton = { TextButton(onClick = onClose) { Text("关闭") } },
    )
}
