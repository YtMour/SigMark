package com.sigmark.app

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.sigmark.app.model.DeviceSnapshot
import com.sigmark.app.model.ValueStatus
import com.sigmark.app.model.unavailableLabel
import java.text.DateFormat
import java.util.Date

private val securityGroups = listOf(
    "启动与系统保护" to listOf("environment.verifiedBoot","environment.vbmetaState","environment.flashLock","system.selinux",
        "system.patch","environment.keyguardSecure","environment.storageEncryption"),
    "构建与运行时" to listOf("environment.buildSignals","environment.virtualDeviceHints","app.appDebuggable","app.debuggerConnected"),
    "仅本机对照" to listOf("environment.configurationDigest","environment.strongBiometrics","app.certSha256"),
)

@Composable
internal fun SecurityPanel(snapshot: DeviceSnapshot, close: () -> Unit) {
    val fields = snapshot.sections.flatMap { section -> section.items.map { "${section.key}.${it.key}" to it } }.toMap()
    AlertDialog(onDismissRequest = close, title = { Text("指纹安全") },
        text = {
            LazyColumn(Modifier.heightIn(max = 500.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                item {
                    Text("设备真实性：未认证", style = MaterialTheme.typography.titleMedium)
                    Text("仅用普通应用可见证据，不读取生物指纹。构建配置、受限字段或本地摘要都不是硬件凭证。")
                    Text("采样：${DateFormat.getDateTimeInstance().format(Date(snapshot.collectedAt))}")
                }
                securityGroups.forEach { (title, keys) ->
                    item { HorizontalDivider(); Text(title, style = MaterialTheme.typography.titleSmall) }
                    items(keys, key = { it }) { key ->
                        val field = fields[key]
                        Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                            Text(field?.label ?: key)
                            Text(when(field?.status) {
                                ValueStatus.AVAILABLE -> field.value ?: "未确认"
                                ValueStatus.RESTRICTED -> "受限 · 未确认"
                                ValueStatus.ERROR -> "读取异常"
                                ValueStatus.UNAVAILABLE -> unavailableLabel(field.reason)
                                null -> "当前快照未记录"
                            })
                            if(field!=null) {
                                Text("来源：${field.source}${field.errno?.let { " · errno=$it" }.orEmpty()}",
                                    style = MaterialTheme.typography.bodySmall)
                                field.note?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
                            }
                        }
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = close) { Text("关闭") } },
    )
}
