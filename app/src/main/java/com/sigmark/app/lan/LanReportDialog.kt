package com.sigmark.app.lan

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.sigmark.app.BuildConfig
import com.sigmark.app.model.DeviceSnapshot
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
internal fun LanReportDialog(snapshot: DeviceSnapshot, onClose: () -> Unit) {
    val scope = rememberCoroutineScope()
    val destination = remember { lanEndpoint(BuildConfig.LAN_ORIGIN) }
    var feedback by remember { mutableStateOf("") }
    var pending by remember { mutableStateOf<LanReport?>(null) }
    val preview = remember(snapshot, feedback) { lanReport(snapshot, BuildConfig.VERSION_NAME, feedback.trim()) }
    var sending by remember { mutableStateOf(false) }
    var receipt by remember { mutableStateOf("") }
    var error by remember { mutableStateOf("") }
    var details by remember { mutableStateOf(false) }
    AlertDialog(
        onDismissRequest = { if (!sending) onClose() },
        title = { Text(if (receipt.isNotEmpty()) "报告已上传" else "上传报告") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                when {
                    receipt.isNotEmpty() -> Text("服务端报告编号：$receipt")
                    destination == null -> Text("这个安装包未配置内网后台。请安装已配置的测试版，或使用本地导出。")
                    else -> {
                        val data = pending ?: preview
                        Text("目标后台：${BuildConfig.LAN_ORIGIN}。同一局域网可用，HTTP 传输未加密。")
                        Text("应用观察型号：${data.model} · API ${data.androidApi} · App ${data.appVersion}")
                        Text("默认网络：${data.network}；Wi-Fi 频段：${data.wifiBand}；蜂窝制式：${data.radio}")
                        Text("采样时间：${java.text.DateFormat.getDateTimeInstance().format(java.util.Date(data.capturedAt))}")
                        Text("随报告保存 ${data.parameters.size} 项参数及来源，包括 ROM/构建版本、Wi-Fi 信号、内存和电池读数。后台默认长期保存；不发送构建指纹、运营商、精确小区频点或位置。")
                        TextButton(onClick = { details = !details }) { Text(if (details) "收起参数" else "查看上传参数") }
                        if (details) data.parameters.forEach { field ->
                            Text("${field.label}：${field.value ?: field.status}\n来源：${field.source}${field.note?.let { "\n$it" }.orEmpty()}")
                        }
                        OutlinedTextField(feedback, { if (validFeedback(it)) feedback = it }, Modifier.fillMaxWidth(),
                            label = { Text("反馈（可选，勿填写个人信息）") }, singleLine = true, enabled = pending == null)
                    }
                }
                if (error.isNotEmpty()) Text(error, color = MaterialTheme.colorScheme.error)
            }
        },
        confirmButton = {
            when {
                receipt.isNotEmpty() -> TextButton(onClick = onClose) { Text("完成") }
                destination != null -> TextButton(enabled = !sending, onClick = {
                    val data = pending ?: preview
                    pending = data
                    sending = true; error = ""
                    scope.launch {
                        try { receipt = withContext(Dispatchers.IO) { sendLanReport(destination, data) } }
                        catch (e: CancellationException) { throw e }
                        catch (e: LanFailure) { error = e.message.orEmpty() }
                        catch (_: Exception) { error = "连接失败或未收到回执。请确认手机和后台在同一局域网；重试会沿用当前提交编号。" }
                        finally { sending = false }
                    }
                }) { Text(if (sending) "上传中…" else "确认上传") }
            }
        },
        dismissButton = {
            if (receipt.isEmpty()) TextButton(enabled = !sending, onClick = onClose) { Text("取消") }
        },
    )
}
