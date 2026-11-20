package com.sigmark.app

import android.content.Intent
import android.content.pm.PackageManager as PM
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.sigmark.app.collector.ReadResult
import com.sigmark.app.collector.SafeReader
import com.sigmark.app.collector.permissionRows
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.util.Locale

private data class VisibleApp(val packageName: String, val label: String)

@Composable
internal fun VisibleApps(onClose: () -> Unit) {
    val pm = LocalContext.current.packageManager
    var selected by remember { mutableStateOf<VisibleApp?>(null) }
    val visible by produceState<ReadResult<List<VisibleApp>>?>(null, pm) {
        value = withContext(Dispatchers.IO) {
            SafeReader.read("PackageManager.queryIntentActivities(MAIN / LAUNCHER)") {
                val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
                pm.queryIntentActivities(intent, 0).mapNotNull { result ->
                    val app = result.activityInfo?.applicationInfo ?: return@mapNotNull null
                    VisibleApp(app.packageName, pm.getApplicationLabel(app).toString())
                }.distinctBy { it.packageName }.sortedBy { it.label.lowercase(Locale.ROOT) }
            }
        }
    }
    val app = selected
    val permissions by produceState<ReadResult<List<String>>?>(null, pm, app) {
        value = null
        if (app != null) value = withContext(Dispatchers.IO) {
            SafeReader.read("PackageManager.getPackageInfo(GET_PERMISSIONS)") {
                @Suppress("DEPRECATION")
                val info = pm.getPackageInfo(app.packageName, PM.GET_PERMISSIONS)
                permissionRows(pm, info)
            }
        }
    }
    AlertDialog(
        onDismissRequest = onClose,
        title = { Text(app?.label ?: "可见应用") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (app == null) {
                    Text("仅列出当前 Android 资料中可启动且对印迹可见的应用。清单只在此处显示。")
                    val apps = visible?.value
                    when {
                        visible == null -> Text("正在查询…")
                        apps == null -> Text(visible?.detail ?: "当前没有清单。")
                        apps.isEmpty() -> Text("没有可见的桌面应用。")
                        else -> LazyColumn(Modifier.heightIn(max = 290.dp)) {
                            items(apps, key = { it.packageName }) { item ->
                                TextButton(onClick = { selected = item }) { Text(item.label) }
                            }
                        }
                    }
                } else {
                    Text(app.packageName)
                    Text("已声明权限及当前授权状态")
                    val rows = permissions?.value
                    when {
                        permissions == null -> Text("正在读取…")
                        rows == null -> Text(permissions?.detail ?: "系统未返回权限信息。")
                        rows.isEmpty() -> Text("无声明权限。")
                        else -> LazyColumn(Modifier.heightIn(max = 260.dp),
                            verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            items(rows) { Text(it) }
                        }
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = onClose) { Text("关闭") } },
        dismissButton = {
            if (app != null) TextButton(onClick = { selected = null }) { Text("返回应用列表") }
        },
    )
}
