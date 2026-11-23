package com.sigmark.app.lan

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.unit.dp
import com.sigmark.app.BuildConfig
import com.sigmark.app.model.ReadReason
import com.sigmark.app.model.unavailableLabel

@Composable
internal fun LanReportDialog(upload: SampleUpload, onAssociate: (Boolean) -> Unit, onFeedback: (String) -> Unit,
    onSubmit: () -> Unit, onClose: () -> Unit) {
    val data = upload.report
    val receipt = upload.receipt
    val sending = upload.sending
    var details by remember { mutableStateOf(false) }
    AlertDialog(
        onDismissRequest = { if (!sending) onClose() },
        title = { Text(if (receipt != null) "报告已上传" else "上传报告") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                when {
                    receipt != null -> {
                        Text("本次采样已入库，不会再次提交。")
                        Text(when (receipt.assetLinked) {
                            true -> "服务器已确认：已归入设备资产。不同时间的采样分别保留。"
                            false -> "服务器已确认：此报告未归组。"
                            null -> "此版本后台未返回归组状态，请在资产管理查看。"
                        })
                        Text("服务端报告编号：" + receipt.id)
                    }
                    else -> {
                        Text("采集时：" + networkLabel(data.network) + " · " + java.text.DateFormat.getDateTimeInstance().format(java.util.Date(data.capturedAt)), style = MaterialTheme.typography.titleMedium)
                        Text("只发送这份已保存的报告，不会重新检测。")
                        Text("发送到：" + BuildConfig.LAN_ORIGIN + "（内网，传输未加密）")
                        Text("包含设备型号、系统、网络及安全检查结果，共 " + data.parameters.size + " 项明细。不发送密钥、应用清单或手机号码。")
                        if (data.fieldSetVersion >= 9) Text("含采集时的授权状态；仅在运行 ROM 验收后包含样片结果、解码器名称和耗时，不发送视频或位置。")
                        if (data.parameters.any { it.group == "network" && it.key == "checkStartTransport" })
                            Text("此报告另含切换实验的起点、终点默认网络、验证结果和观测间隔。不含 IP、SSID 或位置。")
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Checkbox(checked = upload.associate, enabled = !upload.attempted, onCheckedChange = onAssociate)
                            Text("关联到同一设备资产")
                        }
                        Text("勾选后，用本机为此后台生成的随机编号归组。多次测试仍分别保留；重装或清除数据后编号会变。")
                        TextButton(onClick = { details = !details }) { Text(if (details) "收起参数" else "查看上传参数") }
                        if (details) Text("应用 " + data.appVersion + " · 字段集 " + data.fieldSetVersion + " · " + data.model + "。可包含分区、签名及相机、图形和传感器静态能力；运营商、精确频点和设备配置摘要仅留本机。")
                        if (details) data.parameters.forEach { field ->
                            val status = when (field.status) {
                                "RESTRICTED" -> "受限"
                                "UNAVAILABLE" -> unavailableLabel(field.reason?.let { ReadReason.valueOf(it) })
                                "ERROR" -> "读取异常"
                                else -> "可用"
                            }
                            Text("${field.label} · $status${field.value?.let { " · $it" }.orEmpty()}\n来源：${field.source}" +
                                "${field.errno?.let { " · errno=$it" }.orEmpty()}${field.note?.let { "\n$it" }.orEmpty()}")
                        }
                        OutlinedTextField(data.feedback, onFeedback, Modifier.fillMaxWidth(),
                            label = { Text("备注（可选，请勿填写个人信息）") }, singleLine = true, enabled = !upload.attempted)
                    }
                }
                if (upload.error.isNotEmpty()) Text(upload.error, color = MaterialTheme.colorScheme.error)
            }
        },
        confirmButton = {
            when {
                receipt != null -> TextButton(onClick = onClose) { Text("完成") }
                else -> TextButton(enabled = !sending, onClick = onSubmit) {
                    Text(if (sending) "上传中…" else if (upload.attempted) "重试本次提交" else "确认上传")
                }
            }
        },
        dismissButton = {
            if (receipt == null) TextButton(enabled = !sending, onClick = onClose) { Text("稍后上传") }
        },
    )
}
