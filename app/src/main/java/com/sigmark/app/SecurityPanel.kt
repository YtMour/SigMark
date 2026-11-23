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
import com.sigmark.app.security.*
import androidx.compose.ui.platform.LocalContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
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
    val posture = remember(snapshot) { devicePosture(fields,snapshot.collectedAt) }
    val app = LocalContext.current.applicationContext
    val scope = rememberCoroutineScope()
    var permissions by remember { mutableStateOf<List<PostureRow>?>(null) }
    var checkedAt by remember { mutableStateOf<Long?>(null) }
    var scanning by remember { mutableStateOf(false) }
    var showChecks by remember { mutableStateOf(false) }
    val keyProbe = fields["environment.keyProtection"]
    AlertDialog(onDismissRequest = close, title = { Text("指纹安全") },
        text = {
            LazyColumn(Modifier.heightIn(max = 500.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                item {
                    Text("本机安全检查", style = MaterialTheme.typography.titleMedium)
                    Text("设备真实性：未独立验证。真实手机也可以刷入自定义 ROM；型号、配置指纹和密钥自测都不是原厂系统证明。")
                    Text("系统保护 · 优先处理 " + posture.count { it.state == Finding.PRIORITY } + " 项，待核对 " + posture.count { it.state == Finding.REVIEW } + " 项，未确认 " + posture.count { it.state == Finding.UNKNOWN } + " 项。")
                    Text("采样：" + DateFormat.getDateTimeInstance().format(Date(snapshot.collectedAt)),style=MaterialTheme.typography.bodySmall)
                }
                items(posture.filter { it.state == Finding.PRIORITY },key = { "urgent:" + it.id }) { PostureEvidence(it) }
                item { TextButton(onClick = { showChecks = !showChecks }) { Text(if (showChecks) "收起其他系统检查" else "查看其他系统检查") } }
                if (showChecks) items(posture.filter { it.state != Finding.PRIORITY },key = { "check:" + it.id }) { PostureEvidence(it) }
                item {
                    HorizontalDivider()
                    Text("特殊授权",style=MaterialTheme.typography.titleMedium)
                    Text("只在本机查看无障碍能力、设备管理员数量和印迹的安装授权。不读取屏幕、不记录应用名单，也不上传结果。")
                    TextButton(enabled=!scanning,onClick={
                        scanning=true
                        scope.launch {
                            try { permissions = withContext(Dispatchers.IO) { specialAccess(app) }; checkedAt=System.currentTimeMillis() }
                            finally { scanning=false }
                        }
                    }) { Text(if (scanning) "正在检查…" else if (permissions==null) "检查特殊授权" else "重新检查特殊授权") }
                    checkedAt?.let { Text("本机检查：" + DateFormat.getTimeInstance().format(Date(it)),style=MaterialTheme.typography.bodySmall) }
                }
                items(permissions.orEmpty(),key={ "access:" + it.id }) { PostureEvidence(it) }
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

@Composable
private fun PostureEvidence(row: PostureRow) {
    Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
        Text(row.name + " · " + row.state.label,style=MaterialTheme.typography.titleSmall)
        Text(row.message)
        Text("依据：" + row.source,style=MaterialTheme.typography.bodySmall)
    }
}
