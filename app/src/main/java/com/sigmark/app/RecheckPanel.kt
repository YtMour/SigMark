package com.sigmark.app

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.sigmark.app.model.DeviceSnapshot
import com.sigmark.app.model.ValueStatus
import java.text.DateFormat
import java.util.Date

@Composable
internal fun RecheckPanel(snapshot: DeviceSnapshot, access: CollectionAccess, feedback: String?,
    refreshing: Boolean, refresh: () -> Unit,
    close: () -> Unit, requestCell: () -> Unit, requestPhone: () -> Unit,
    appSettings: () -> Unit, locationSettings: () -> Unit) {
    val sections = snapshot.sections.associate { it.key to it.items.associateBy { item -> item.key } }
    fun value(group: String, key: String) = sections[group]?.get(key)?.takeIf { it.status == ValueStatus.AVAILABLE }?.value
    val hasMobile = value("cellular", "support")?.let { it == "是" || it == "支持" } ?: (sections["cellular"]?.containsKey("simState") == true)
    AlertDialog(onDismissRequest = close, title = { Text("权限与复测") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                feedback?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }
                Text("授权是可选的，仅影响对应的蜂窝参数。返回后更新本机读数，已有报告不变。")
                Text("采样时默认网络：${value("network", "transport") ?: "未确认"}", style = MaterialTheme.typography.titleSmall)
                Text("采样时间：${DateFormat.getDateTimeInstance().format(Date(snapshot.collectedAt))}")
                if (hasMobile) {
                    Text("采样时默认数据卡槽：${value("cellular", "defaultDataSlot") ?: "未确认"}")
                    Text("当前授权（即时）", style = MaterialTheme.typography.titleSmall)
                    Text("位置权限：${when { access.fine -> "精确"; access.coarse -> "仅大致"; else -> "未授权" }}")
                    Text("系统位置：${when(access.location){true->"开启";false->"关闭";null->"未确认"}}")
                    Text("电话状态：${if (access.phone) "已授权" else "未授权"}")
                    if (!access.phone) TextButton(onClick = requestPhone) { Text(AccessAction.PHONE.title) }
                    if (!access.fine) TextButton(onClick = requestCell) { Text(AccessAction.FINE.title) }
                    if (access.location == false) TextButton(onClick = locationSettings) { Text(AccessAction.LOCATION.title) }
                    TextButton(onClick = appSettings) { Text("打开应用权限设置") }
                }
                Text("SELinux 等系统拒读项不受这些权限影响。实验室可用后台的「证据来源对照」另查 ADB 读数。")
            }
        },
        confirmButton = { TextButton(onClick = refresh, enabled = !refreshing) { Text(if (refreshing) "采集中…" else "重新采集并保存") } },
        dismissButton = { TextButton(onClick = close) { Text("关闭") } },
    )
}
