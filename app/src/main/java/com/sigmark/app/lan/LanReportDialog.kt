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
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.sigmark.app.BuildConfig
import com.sigmark.app.model.DeviceSnapshot
import com.sigmark.app.model.ReadReason
import com.sigmark.app.model.unavailableLabel
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
internal fun LanReportDialog(snapshot: DeviceSnapshot, onClose: () -> Unit) {
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val destination = remember { lanEndpoint(BuildConfig.LAN_ORIGIN) }
    var linkAsset by remember(destination) { mutableStateOf(destination?.let { AssetIdentity.optedIn(context, it) } ?: false) }
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
                        val total = data.coverage.sumOf { it.total }
                        val issues = data.coverage.sumOf { it.restricted + it.unavailable + it.errors }
                        Text("手机快照 $total 项 · 归档明细 ${data.parameters.size} 项 · 仅本机 ${total - data.parameters.size} 项")
                        Text("手机快照待确认 $issues 项。后台长期保存下列明细及每个分类的状态计数。")
                        Text("可用的默认数据卡槽及各槽服务状态仅以逻辑卡槽和状态归档；链路切换记录仅在本机。")
                        Text("安全分析包括是否设置锁屏凭证与存储加密状态，不上传密码、生物识别、设备摘要或签名证书。")
                        Text("设备配置摘要、构建指纹、应用安装及权限信息、运营商和精确小区频点仅供本机使用。")
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Checkbox(checked = linkAsset, enabled = pending == null, onCheckedChange = {
                                linkAsset = it
                                AssetIdentity.saveChoice(context, destination, it)
                            })
                            Text("关联到同一设备资产")
                        }
                        Text("勾选后，发送此安装对当前后台专用的随机标记，方便多次采样归到同一部手机。不是硬件编号；重装、清除数据或刷机会产生新标记。取消勾选只影响之后的上传。")
                        TextButton(onClick = { details = !details }) { Text(if (details) "收起参数" else "查看上传参数") }
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
                        try { receipt = withContext(Dispatchers.IO) {
                            sendLanReport(destination, data, if (linkAsset) AssetIdentity.key(context, destination) else null)
                        } }
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
