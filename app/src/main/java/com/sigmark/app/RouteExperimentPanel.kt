package com.sigmark.app

import android.os.SystemClock
import android.provider.Settings
import android.content.Intent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.listSaver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.sigmark.app.collector.RouteCheck
import com.sigmark.app.collector.RoutePoint
import com.sigmark.app.collector.readRoutePoint
import com.sigmark.app.lan.networkLabel

private val pointSaver = listSaver<RoutePoint?, Any>(
    save = { point -> if (point == null) emptyList() else
        listOf(point.timeMs, point.transport.orEmpty(), when (point.validated) { true -> 1; false -> 0; null -> -1 }, point.wallTimeMs ?: 0L) },
    restore = { values -> if (values.isEmpty()) null else RoutePoint(values[0] as Long,
        (values[1] as String).ifEmpty { null }, (values[2] as Int).takeIf { it >= 0 }?.let { it == 1 },
        (values.getOrNull(3) as? Long)?.takeIf { it > 0 }) },
)

@Composable
internal fun RouteExperimentPanel(busy: Boolean, onSave: (RouteCheck)->Unit, onClose: ()->Unit) {
    val context = LocalContext.current
    var start by rememberSaveable(stateSaver = pointSaver) { mutableStateOf<RoutePoint?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    AlertDialog(onDismissRequest = onClose, title = { Text("网络切换实验") }, text = {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("记录起点 → 在系统设置切换 Wi-Fi 或移动数据 → 返回记录终点。仅保留链路类型与系统联网验证，不读取地址，不发起测速。")
            start?.let { point ->
                Text("起点：${networkLabel(point.transport ?: "unknown")} · ${when(point.validated){true->"已验证联网";false->"未验证联网";null->"验证状态未知"}}")
                TextButton(onClick = {
                    try { context.startActivity(Intent(Settings.ACTION_WIRELESS_SETTINGS)) }
                    catch (_: Exception) { error = "可用系统快捷设置手动切换，再返回印迹。" }
                }) { Text("打开系统网络设置") }
            }
            error?.let { Text(it) }
            Text("终点保存一份新报告，不发送；记录的是两次观察，不测断网时间。")
        }
    }, confirmButton = { TextButton(enabled = !busy, onClick = {
        val first = start
        if (first == null) { start = readRoutePoint(context); error = null }
        else if (SystemClock.elapsedRealtime()-first.timeMs !in 0..600_000) {
            start = null
            error = "起点已超过 10 分钟，请重新记录。"
        } else onSave(RouteCheck(first,readRoutePoint(context)))
    }) { Text(if(start==null)"记录起点" else "记录终点并保存") } },
        dismissButton = { TextButton(onClick = onClose) { Text("取消") } })
}
