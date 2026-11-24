package com.sigmark.app

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.sigmark.app.collector.GnssCheck
import com.sigmark.app.collector.ReadResult
import com.sigmark.app.collector.runGnssCheck
import com.sigmark.app.model.DeviceInfoItem
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

@Composable internal fun GnssCheckPanel(
    fields: List<DeviceInfoItem>, access: CollectionAccess, busy: Boolean, lanEnabled: Boolean,
    requestLocation: () -> Unit, locationSettings: () -> Unit,
    onSave: (GnssCheck) -> Unit, onClose: () -> Unit,
) {
    val context = LocalContext.current.applicationContext
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val scope = rememberCoroutineScope()
    var job by remember { mutableStateOf<Job?>(null) }
    var result by remember { mutableStateOf<GnssCheck?>(null) }
    var message by remember { mutableStateOf<String?>(null) }
    DisposableEffect(lifecycle) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_STOP && job != null) {
                job?.cancel()
                message = "离开前台，观测已停止。回到页面后可重测。"
            }
        }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer); job?.cancel() }
    }
    fun summary(value: ReadResult<String>) = when(value.value) {
        "observed" -> "已观察到非空事件"
        "not_seen" -> "本次窗口未观察到"
        else -> value.detail ?: "未取得读数"
    }
    fun run() {
        if (job != null || !lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) return
        message = null
        result = null
        val started = scope.launch(start = kotlinx.coroutines.CoroutineStart.LAZY) {
            try { result = runGnssCheck(context) }
            catch (e: CancellationException) { throw e }
            catch (e: Exception) { message = "实测未完成：${e.javaClass.simpleName}。未保存报告。" }
            finally { job = null }
        }
        job = started
        started.start()
    }
    AlertDialog(onDismissRequest=onClose, title={Text("GNSS 读数核对")}, text={
        Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement=Arrangement.spacedBy(8.dp)) {
            fields.firstOrNull { it.key == "gnssHardwareYear" }?.let { Text("系统型号年原值：${it.value ?: "未取得"}。 ${it.note.orEmpty()}") }
            fields.firstOrNull { it.key == "gnssHardwareModel" && it.value != null }?.let { Text("本机型号名称：${it.value}") }
            Text("实测最多观察约 20 秒。建议在开阔处保持此页前台。仅保存有没有非空 GNSS 状态和测量回调，不保留坐标、卫星标识、原始测量或轨迹。")
            Text("系统声明与回调可能来自同一服务。看到回调只说明本次观测链路工作，不验证型号年，也不是整机认证。")
            if(job != null) Text("正在等待 GNSS 事件…")
            message?.let { Text(it) }
            result?.let {
                Text("起点：${it.prerequisite.title}")
                Text("状态：${summary(it.status)}")
                Text("测量：${summary(it.measurements)}")
                Text(if (lanEnabled) "可保存为一份新报告；需要时通过「上传报告」手动归档。"
                    else "可返回采集页查看本次结果，并按需导出本地 JSON。")
                TextButton(enabled=!busy, onClick={run()}) { Text("重新实测") }
            }
        }
    }, confirmButton={
        TextButton(enabled=!busy&&job==null,onClick={
            val recorded = result
            when {
                recorded != null -> onSave(recorded)
                !access.fine -> requestLocation()
                access.location == false -> locationSettings()
                else -> run()
            }
        }) { Text(when {
            result != null -> if(lanEnabled) "保存本机报告" else "查看采集结果"
            !access.fine -> "授权精确位置"
            access.location == false -> "打开系统位置"
            else -> "开始前台实测"
        }) }
    }, dismissButton={TextButton(onClick=onClose){Text(if(job!=null) "停止并关闭" else "关闭")}})
}
