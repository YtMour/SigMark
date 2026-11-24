package com.sigmark.app

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.sigmark.app.collector.CodePart
import com.sigmark.app.collector.SysfsField
import com.sigmark.app.collector.codeChanges
import com.sigmark.app.collector.cpuSet
import com.sigmark.app.collector.machineCode
import com.sigmark.app.collector.machineCodeVersion
import com.sigmark.app.model.DeviceInfoItem
import com.sigmark.app.model.DeviceSnapshot
import kotlin.math.abs

@Composable internal fun ConfigurationEvidencePanel(
    snapshot: DeviceSnapshot?, busy: Boolean, error: String?, lanEnabled: Boolean,
    onRefresh: () -> Unit, onClose: () -> Unit,
) {
    var generatedAt by remember { mutableStateOf<Long?>(null) }
    var baseline by remember { mutableStateOf<List<CodePart>?>(null) }
    var waitingFor by remember { mutableStateOf<Long?>(null) }
    val capturedAt = snapshot?.collectedAt
    val parts = remember(snapshot, generatedAt) { snapshot?.takeIf { it.collectedAt == generatedAt }?.let(::machineCode) }
    LaunchedEffect(capturedAt, busy, error) {
        if (!busy && waitingFor != null) {
            if (capturedAt != null && capturedAt != waitingFor) generatedAt = capturedAt
            waitingFor = null
        }
    }
    fun field(group: String, key: String) = snapshot?.sections?.firstOrNull { it.key == group }?.items?.firstOrNull { it.key == key }
    fun evidence(item: DeviceInfoItem?) = item?.let {
        listOfNotNull(it.value, it.status.name, it.reason?.name, it.errno?.let { code -> "errno=$code" }, it.source, it.note).joinToString(" · ")
    } ?: "本次未记录"
    AlertDialog(onDismissRequest = onClose, title = { Text("机器码与节点证据") }, text = {
        Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("仓库归组由用户选择，通过随机安装标记关联。本机旧配置摘要继续在「指纹安全」查看。下面的机器码分商品、硬件与 ROM 三个分量，各自独立；相同配置可以同码，重装且配置相同时可复现。")
            capturedAt?.let { Text("采样时间 ${java.text.DateFormat.getDateTimeInstance().format(java.util.Date(it))}") }
            TextButton(enabled = capturedAt != null && !busy && parts == null, onClick = { generatedAt = capturedAt }) { Text("生成设备配置机器码") }
            parts?.forEach { part ->
                Text(partName(part.domain) + " · ${part.available}/${part.inputs.size} · $machineCodeVersion")
                Text(part.code ?: "输入缺失，未生成此分量")
                part.inputs.forEach { Text("${it.key}\n${evidence(it.reading)}") }
                baseline?.firstOrNull { it.domain == part.domain }?.let { before ->
                    val changes = codeChanges(before,part)
                    Text(if (changes.isEmpty()) "本次复测未观察到输入变化" else
                        changes.joinToString("；") { "${it.first} ${it.second}" })
                }
            }
            HorizontalDivider()
            Text("固定 /sys 只读节点 · 普通 App 视角")
            SysfsField.entries.forEach { spec ->
                Text("${spec.label}（${spec.unit}）\n${evidence(field(spec.group,spec.key))}")
            }
            val possible = field("cpu","sysCpuPossible")?.value?.let(::cpuSet)
            val online = field("cpu","sysCpuOnline")?.value?.let(::cpuSet)
            val cores = field("cpu","cores")
            if (possible != null && online != null) Text(if (possible.containsAll(online)) "在线编号是可能编号的子集。"
                else "在线编号超出可能清单，建议再采。")
            Text("公开 API 可用核心数：${evidence(cores)}。内核在线总数与进程可用数口径不同。")
            val api = field("battery","temperature")
            val apiTemp = api?.value?.removeSuffix(" °C")?.toDoubleOrNull()
            val driver = field("battery","sysBatteryTemp")?.value?.let { it.toIntOrNull()?.div(10.0) }
            Text("公开 API 电池温度：${evidence(api)}")
            if (apiTemp != null && driver != null) Text(if (abs(apiTemp-driver) <= 2) "两路温度在 2 °C 内。"
                else "两路温度相差超过 2 °C。请复查供应商标度及采样时点。")
            Text("电池两路可能来自同一驱动，且读取时点不同。${if (lanEnabled) "复测保存一份本机报告，可手动上传。" else "可从首页导出本地报告。"}")
            if (waitingFor != null) Text("正在重新采集…")
            error?.let { Text(it) }
        }
    }, confirmButton = {
        TextButton(enabled = !busy && capturedAt != null && waitingFor == null, onClick = {
            baseline = snapshot?.let(::machineCode)
            waitingFor = capturedAt
            onRefresh()
        }) { Text("重新采集并核对") }
    }, dismissButton = { TextButton(onClick = onClose) { Text("关闭") } })
}

internal fun partName(domain: String): String = when (domain) {
    "product" -> "商品配置"
    "hardware" -> "硬件配置"
    "rom" -> "ROM 配置"
    else -> domain
}
