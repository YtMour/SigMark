package com.sigmark.app

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.sigmark.app.collector.DecodeResult
import com.sigmark.app.collector.DecodeStage
import com.sigmark.app.collector.mediaFixture
import com.sigmark.app.collector.probeMediaDecode
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
internal fun MediaProbePanel(close: () -> Unit) {
    val context = LocalContext.current.applicationContext
    val scope = rememberCoroutineScope()
    var result by remember { mutableStateOf<DecodeResult?>(null) }
    var running by remember { mutableStateOf(false) }
    AlertDialog(onDismissRequest = close, title = { Text("视频解码实测") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(7.dp)) {
                Text("用内置 H.264 样片（320 × 180，15 帧）测试默认解码器能否输出首帧。无需读取个人文件，结果不上传。")
                Text("样片：$mediaFixture", style = MaterialTheme.typography.bodySmall)
                if (running) Text("正在运行本机测试…")
                result?.let {
                    Text(if (it.stage == DecodeStage.DONE) "通过 · 首帧已输出" else "未通过 · ${it.stage.title}",
                        style = MaterialTheme.typography.titleSmall)
                    Text("系统声明的 AVC 解码器：${it.declaredDecoders ?: "未取得"}")
                    it.codec?.let { name -> Text("本次解码器：$name") }
                    it.hardware?.let { hardware -> Text(if (hardware) "框架标记为硬件加速" else "框架未标记为硬件加速") }
                    it.elapsedMs?.let { ms -> Text("本次耗时：$ms ms（含打开样片和初始化）") }
                    it.detail?.let { detail -> Text("诊断：$detail") }
                    Text("仅验证此样片的首帧，不代表所有视频都能播放。")
                }
            }
        },
        confirmButton = { TextButton(enabled = !running, onClick = {
            result = null
            running = true
            scope.launch {
                try { result = withContext(Dispatchers.IO) { probeMediaDecode(context) } }
                finally { running = false }
            }
        }) { Text("运行解码测试") } },
        dismissButton = { TextButton(onClick = close) { Text("关闭") } },
    )
}
