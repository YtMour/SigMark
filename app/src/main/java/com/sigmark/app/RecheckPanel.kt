package com.sigmark.app

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.location.LocationManager
import android.os.Build
import android.provider.Settings
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.sigmark.app.model.DeviceSnapshot
import com.sigmark.app.model.ValueStatus
import java.text.DateFormat
import java.util.Date

@Composable
internal fun RecheckPanel(snapshot: DeviceSnapshot, refreshing: Boolean, refresh: () -> Unit,
    close: () -> Unit, requestCell: () -> Unit, requestPhone: () -> Unit,
    appSettings: () -> Unit, locationSettings: () -> Unit) {
    val context = LocalContext.current
    val fine = context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
    val phone = context.checkSelfPermission(Manifest.permission.READ_PHONE_STATE) == PackageManager.PERMISSION_GRANTED
    val location = locationSwitch(context)
    val sections = snapshot.sections.associate { it.key to it.items.associateBy { item -> item.key } }
    fun value(group: String, key: String) = sections[group]?.get(key)?.takeIf { it.status == ValueStatus.AVAILABLE }?.value
    val hasMobile = value("cellular", "support")?.let { it == "是" || it == "支持" } ?: (sections["cellular"]?.containsKey("simState") == true)
    AlertDialog(onDismissRequest = close, title = { Text("复测准备") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("对比前，先核对两次是否处于相同网络和授权条件。这个面板不会上传数据。")
                Text("采样时默认网络：${value("network", "transport") ?: "未确认"}", style = MaterialTheme.typography.titleSmall)
                Text("采样时间：${DateFormat.getDateTimeInstance().format(Date(snapshot.collectedAt))}")
                if (hasMobile) {
                    Text("采样时默认数据卡槽：${value("cellular", "defaultDataSlot") ?: "未确认"}")
                    Text("当前授权（即时）", style = MaterialTheme.typography.titleSmall)
                    Text("精确位置：${if (fine) "已授权" else "未授权"} · 系统位置：${when(location){true->"开启";false->"关闭";null->"未确认"}}")
                    Text("电话状态：${if (phone) "已授权" else "未授权"}")
                    if (!fine) TextButton(onClick = requestCell) { Text("授权查看小区无线参数") }
                    if (location == false) TextButton(onClick = locationSettings) { Text("打开系统位置设置") }
                    if (!phone && Build.VERSION.SDK_INT >= 28) TextButton(onClick = requestPhone) { Text("授权查看各卡状态") }
                    if (!fine || !phone) TextButton(onClick = appSettings) { Text("打开应用权限设置") }
                }
                Text("切换网络或修改授权后重新采集。对照时不要用当前授权去推测历史报告。")
            }
        },
        confirmButton = { TextButton(onClick = refresh, enabled = !refreshing) { Text(if (refreshing) "采集中…" else "重新采集") } },
        dismissButton = { TextButton(onClick = close) { Text("关闭") } },
    )
}

private fun locationSwitch(context: Context): Boolean? = runCatching {
    if (Build.VERSION.SDK_INT >= 28) context.getSystemService(LocationManager::class.java)?.isLocationEnabled
    else Settings.Secure.getInt(context.contentResolver, Settings.Secure.LOCATION_MODE, -1)
        .takeIf { it >= 0 }?.let { it != Settings.Secure.LOCATION_MODE_OFF }
}.getOrNull()
