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
                        if (data.fieldSetVersion >= 11) Text("包含 App 进程位宽、可见内核架构、接口声明和外接输入类别；不发送外设名称、标识或输入内容。")
                        if (data.fieldSetVersion >= 12) {
                            val expanded = data.parameters.count { "${it.group}.${it.key}" in com.sigmark.app.collector.expandedHardwareKeys }
                            Text("扩展采集已记录 $expanded 项：GNSS 硬件能力、输入和 Camera2 声明、传感器汇总；ROM 验收另含图形实测。无坐标、图像或原始传感器样本。")
                        }
                        if (data.parameters.any { it.group == "network" && it.key == "checkStartTransport" })
                            Text("此报告另含切换实验的起点、终点默认网络、验证结果和观测间隔。不含 IP、SSID 或位置。")
                        if (data.fieldSetVersion >= 13) Text("主动实验可含墙钟起止时间。USB 实验只含数量、观测间隔和结果，不含外设名称、标识或内容。")
                        if (data.fieldSetVersion >= 14) Text("GNSS 归档包含系统型号年、接口声明；主动实测仅包含回调有无、授权条件与时间。不上传型号名称、坐标、卫星标识或原始测量。")
                        if (data.fieldSetVersion >= 15) Text("归档可含三个固定只读节点的技术读数或拒绝原因。机器码不在上传正文中；后台可按已归档的商品和 ROM 字段计算同版配置码。")
                        if (data.fieldSetVersion >= 16) Text("可包含电池存在状态、循环次数、默认数据订阅的服务状态与载波带宽状态。不包含 SIM 编号、小区标识或位置。")
                        if (data.fieldSetVersion >= 17) Text("可包含本进程映射的 Hook/注入线索、内核 TracerPid、系统分区挂载线索、可见的 Root 管理应用、运行用户环境、DRM 保护级别、dm-verity 与可调试声明、分区构建日期和 SELinux 读取依据。均为本应用自身的状态观察，不含其他进程、应用清单或 ANDROID_ID。")
                        if (data.fieldSetVersion >= 18) Text("可包含设备初始 API 级别；Android 8/9 的分区构建指纹来自只读属性。")
                        if (data.fieldSetVersion >= 19) Text("可包含平台代号、启动硬件与硬件 SKU 三项只读声明；它们与 Build 字段分列上传，用于发现同一设备内部的声明不一致。")
                        if (data.fieldSetVersion >= 20) Text("可包含系统开机次数与媒体性能等级声明；开机次数会随冷启动递增并在清数据后重置。")
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
