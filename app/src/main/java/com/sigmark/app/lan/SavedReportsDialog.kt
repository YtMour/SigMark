package com.sigmark.app.lan

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import java.text.DateFormat
import java.util.Date

@Composable
internal fun SavedReportsDialog(rows: List<SavedSample>, canUseCurrent: Boolean, busy: Boolean, error: String?, select: (String?)->Unit,
    remove: (String)->Unit, close: ()->Unit) {
    var removing by remember { mutableStateOf<SavedSample?>(null) }
    var history by remember { mutableStateOf(false) }
    val pending = rows.filterNot { it.sent }
    val sent = rows.filter { it.sent }
    fun title(row: SavedSample) = networkLabel(row.network) + " · " + DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.MEDIUM).format(Date(row.time))
    if (removing != null) {
        val row = requireNotNull(removing)
        AlertDialog(onDismissRequest = { removing = null }, title = { Text("删除本机副本？") },
            text = { Text(title(row) + if (row.sent) "。后台已收到的报告会保留。" else "。这份报告还未确认上传，删除后无法从手机恢复。") },
            confirmButton = { TextButton(onClick = { removing = null; remove(row.id) }) { Text("删除本机副本") } },
            dismissButton = { TextButton(onClick = { removing = null }) { Text("保留") } })
        return
    }
    AlertDialog(onDismissRequest = close, title = { Text("上传报告") }, text = {
        LazyColumn(Modifier.heightIn(max = 470.dp),verticalArrangement = Arrangement.spacedBy(8.dp)) {
            item { Text("选择要发送的报告。这里显示采集当时的网络，切换 Wi-Fi 不会改变报告。") }
            error?.let { item { Text(it, color=MaterialTheme.colorScheme.error) } }
            item { Text("待上传（" + pending.size + "）",style=MaterialTheme.typography.titleMedium) }
            if (pending.isEmpty()) item { Text(if (sent.isEmpty()) "还没有保存的报告。可使用首页已显示的结果，或返回点「整体获取」。" else "没有待上传的报告。要记录新的测试，请返回点「整体获取」。") }
            items(pending,key={it.id}) { row ->
                SavedRow(title(row), false, busy, { select(row.id) }, { removing = row })
            }
            if (canUseCurrent) item { OutlinedButton(onClick={ select(null) },enabled=!busy) { Text("使用首页这次结果") } }
            if (sent.isNotEmpty()) item { TextButton(onClick={ history = !history }) { Text((if(history) "收起已上传" else "查看已上传")+"（"+sent.size+"）") } }
            if (history) items(sent,key={it.id}) { row -> SavedRow(title(row),true,busy,{select(row.id)},{removing=row}) }
        }
    },confirmButton={ TextButton(onClick=close) { Text("关闭") } })
}

@Composable
private fun SavedRow(title: String, sent: Boolean, busy: Boolean, open: ()->Unit, remove: ()->Unit) {
    Column { HorizontalDivider(); Text(title,modifier=Modifier.padding(top=8.dp)); Row {
        TextButton(enabled=!busy,onClick=open) { Text(if(sent) "查看上传结果" else "选择这份报告") }
        TextButton(enabled=!busy,onClick=remove) { Text("删除副本") }
    } }
}
