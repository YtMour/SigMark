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
import androidx.compose.runtime.*
import com.sigmark.app.collector.bootEvidence
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
    "组件与采集器" to listOf("system.webViewProvider","system.webViewVersion","system.webViewCode","system.systemSpl","system.vendorSpl","app.package","app.channel","app.version","app.certSha256"),
    "仅本机对照" to listOf("environment.configurationDigest","environment.strongBiometrics"),
)

@Composable
internal fun SecurityPanel(snapshot: DeviceSnapshot, testing: Boolean, refreshing: Boolean, testKey: () -> Unit, close: () -> Unit) {
    val fields = snapshot.sections.flatMap { section -> section.items.map { "${section.key}.${it.key}" to it } }.toMap()
    var open by remember { mutableStateOf<String?>(null) }
    fun boot(key: String) = fields["environment.$key"]?.takeIf { it.status == ValueStatus.AVAILABLE }?.value
    val interpretation = when (bootEvidence(boot("verifiedBoot"),boot("vbmetaState"),boot("flashLock"))) {
        "red" -> "启动检查：系统报告启动验证异常，请核对所装系统。"
        "conflict" -> "启动检查：系统给出的锁定信息不一致，建议和刷机前的报告对照。"
        "unlocked" -> "启动检查：系统显示已解锁。如果你主动刷了 ROM，这可能符合预期。"
        "custom" -> "启动检查：系统使用了自定义信任根，请核对是不是你安装的 ROM。"
        "locked" -> "启动检查：系统报告已锁定，启动状态与此一致。"
        else -> "启动检查：现有信息不足，还没有结论。"
    }
    val keyProbe = fields["environment.keyProtection"]
    AlertDialog(onDismissRequest = close, title = { Text("指纹安全") },
        text = {
            LazyColumn(Modifier.heightIn(max = 500.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                item {
                    Text("本机安全检查", style = MaterialTheme.typography.titleMedium)
                    Text("这里的“指纹”是设备配置特征，不读取手指指纹。")
                    Text(interpretation)
                    if (fields["environment.keyguardSecure"]?.value == "否" || fields["environment.storageEncryption"]?.value == "系统报告未启用")
                        Text("需复核 · 系统报告锁屏凭证未设置或存储加密未启用；请核对实验设置。")
                    if (fields["system.selinux"]?.status != ValueStatus.AVAILABLE)
                        Text("系统没有公开所有保护状态；缺少读数不等于保护已关闭。")
                    Text("独立验证：未进行。本机结果不是整机真伪证明。")
                    Text("采样：${DateFormat.getDateTimeInstance().format(Date(snapshot.collectedAt))}")
                }
                item {
                    Text("密钥保护：" + keyProtectionExplanation(keyProbe?.value), style = MaterialTheme.typography.titleSmall)
                    if (keyProbe != null && keyProbe.value == null) Text(keyProbe.note ?: "本次未取得读数。")
                    TextButton(enabled = !refreshing && !testing, onClick = testKey) {
                        Text(if (testing) "正在测试…" else if (keyProbe == null) "测试密钥保护" else "重新测试密钥保护")
                    }
                }
                val partitions = listOf("system.partitionCount") + fields.keys.filter { it.startsWith("system.partition_") }.sorted()
                (listOf("密钥自测" to listOf("environment.keyProtection"), "分区构建" to partitions) + securityGroups).forEach { (title, keys) ->
                    item { HorizontalDivider(); TextButton(onClick = { open = if (open == title) null else title }) {
                        Text((if (open == title) "收起" else "查看") + title + "依据")
                    } }
                    if (open == title) items(keys, key = { it }) { key ->
                        val field = fields[key]
                        Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                            Text(field?.label ?: key)
                            Text(when(field?.status) {
                                ValueStatus.AVAILABLE -> field.value ?: "未确认"
                                ValueStatus.RESTRICTED -> "受限 · 未确认"
                                ValueStatus.ERROR -> "读取异常"
                                ValueStatus.UNAVAILABLE -> unavailableLabel(field.reason)
                                null -> if (key in listOf("system.systemSpl","system.vendorSpl") && android.os.Build.VERSION.SDK_INT < 35)
                                    "此组件补丁接口从 API 35 开始提供" else "当前快照未记录"
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

internal fun keyProtectionExplanation(value: String?) = when (value) {
    "TEE" -> "系统报告，这把测试密钥在处理器的隔离环境中受到保护（TEE）。"
    "StrongBox" -> "系统报告，这把测试密钥由独立安全硬件保护（StrongBox）。"
    "硬件保护（类型未细分）" -> "系统报告使用硬件保护，未区分硬件类型。"
    "Software" -> "系统报告，这把测试密钥由软件保护。"
    else -> "尚未确认。可在本机运行测试，无需上传。"
}
