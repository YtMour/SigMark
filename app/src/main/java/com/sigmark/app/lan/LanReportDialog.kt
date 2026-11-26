package com.sigmark.app.lan

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.selection.toggleable
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import com.sigmark.app.BuildConfig
import com.sigmark.app.model.ReadReason
import com.sigmark.app.model.unavailableLabel
import java.text.DateFormat
import java.util.Date

@Composable
internal fun LanReportDialog(upload: SampleUpload, onAssociate: (Boolean) -> Unit, onFeedback: (String) -> Unit,
    onSubmit: () -> Unit, onClose: () -> Unit) {
    val data = upload.report
    val receipt = upload.receipt
    val sending = upload.sending
    var details by rememberSaveable(data.requestId) { mutableStateOf(false) }
    var options by rememberSaveable(data.requestId) { mutableStateOf(data.feedback.isNotEmpty()) }
    var receiptDetails by rememberSaveable(data.requestId) { mutableStateOf(false) }
    val capturedAt = DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.MEDIUM).format(Date(data.capturedAt))

    AlertDialog(
        onDismissRequest = { if (!sending) onClose() },
        title = { Text(if (receipt != null) "报告已上传" else "上传报告") },
        text = {
            LazyColumn(Modifier.heightIn(max = 440.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                item { Text("$capturedAt · ${networkLabel(data.network)}", style = MaterialTheme.typography.titleSmall) }
                if (receipt != null) {
                    item {
                        Text(when (receipt.assetLinked) {
                            true -> "已关联设备档案"
                            false -> "独立报告"
                            null -> "归组状态待确认"
                        })
                    }
                    item {
                        TextButton(onClick = { receiptDetails = !receiptDetails }) { Text(if (receiptDetails) "收起回执" else "查看回执") }
                    }
                    if (receiptDetails) item { Text(receipt.id, style = MaterialTheme.typography.bodySmall) }
                } else {
                    item { Text("发送到 ${BuildConfig.LAN_ORIGIN}", style = MaterialTheme.typography.bodyMedium) }
                    item { Text("内网传输未加密 · ${data.parameters.size} 项设备与检查数据", style = MaterialTheme.typography.bodySmall) }
                    item {
                        Row(
                            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)
                                .toggleable(value = upload.associate, enabled = !upload.attempted,
                                    role = Role.Checkbox, onValueChange = onAssociate),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(10.dp),
                        ) {
                            Checkbox(checked = upload.associate, onCheckedChange = null, enabled = !upload.attempted)
                            Text("关联到同一设备档案")
                        }
                    }
                    if (upload.error.isNotEmpty()) item { Text(upload.error, color = MaterialTheme.colorScheme.error) }
                    item {
                        TextButton(onClick = { options = !options }) { Text(if (options) "收起上传选项" else "上传选项与隐私") }
                    }
                    if (options) {
                        item {
                            Text("关联使用随机安装标记。上传范围以本次参数为准，请在备注中避免个人信息。",
                                style = MaterialTheme.typography.bodySmall)
                        }
                        item {
                            OutlinedTextField(data.feedback, onFeedback, Modifier.fillMaxWidth(),
                                label = { Text("备注（可选）") }, singleLine = true, enabled = !upload.attempted)
                        }
                    }
                    item {
                        TextButton(onClick = { details = !details }) { Text(if (details) "收起参数" else "查看上传参数") }
                    }
                    // Render only the saved wire projection. Full local-only fields never enter this preview.
                    if (details) items(data.parameters) { field ->
                        val status = when (field.status) {
                            "RESTRICTED" -> "受限"
                            "UNAVAILABLE" -> unavailableLabel(ReadReason.entries.firstOrNull { it.name == field.reason })
                            "ERROR" -> "读取异常"
                            else -> "可用"
                        }
                        Text("${field.label} · $status${field.value?.let { " · $it" }.orEmpty()}\n来源：${field.source}" +
                            "${field.errno?.let { " · errno=$it" }.orEmpty()}${field.note?.let { "\n$it" }.orEmpty()}",
                            style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
        },
        confirmButton = {
            if (receipt != null) TextButton(onClick = onClose) { Text("完成") }
            else TextButton(enabled = !sending, onClick = onSubmit) {
                Text(if (sending) "上传中…" else if (upload.attempted) "重试本次提交" else "确认上传")
            }
        },
        dismissButton = {
            if (receipt == null) TextButton(enabled = !sending, onClick = onClose) { Text("稍后上传") }
        },
    )
}
