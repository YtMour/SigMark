package com.sigmark.app

import android.os.SystemClock
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.listSaver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.sigmark.app.collector.ProbeTime
import com.sigmark.app.collector.ReadResult
import com.sigmark.app.collector.UsbCheck
import com.sigmark.app.collector.UsbPoint
import com.sigmark.app.collector.observeUsb
import com.sigmark.app.collector.usbWaitLimit
import com.sigmark.app.model.ReadReason
import com.sigmark.app.model.ValueStatus
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private val usbPointSaver = listSaver<UsbPoint?, Any>(
    save = { p -> p?.let { listOf(it.time.wall,it.time.mono,it.reading.value ?: -1,it.reading.status.name,it.reading.reason?.name.orEmpty()) }.orEmpty() },
    restore = { a -> if (a.size != 5) null else UsbPoint(ProbeTime(a[0] as Long,a[1] as Long),
        ReadResult((a[2] as Int).takeIf { it>=0 },ValueStatus.valueOf(a[3] as String),"UsbManager.getDeviceList().size",
            reason=(a[4] as String).takeIf(String::isNotEmpty)?.let(ReadReason::valueOf))) },
)

@Composable internal fun UsbExperimentPanel(busy:Boolean, onSave:(UsbCheck)->Unit, onClose:()->Unit) {
    val context = LocalContext.current.applicationContext
    val scope = rememberCoroutineScope()
    var start by rememberSaveable(stateSaver=usbPointSaver) { mutableStateOf<UsbPoint?>(null) }
    var reading by remember { mutableStateOf(false) }
    var notice by remember { mutableStateOf("") }
    AlertDialog(onDismissRequest=onClose, title={Text("USB 插拔实验")}, text={
        Column(verticalArrangement=Arrangement.spacedBy(8.dp)) {
            Text("准备支持 USB Host 的手机、OTG 转接器或外设。记录起点后，手动插入或拔出一个外设，两分钟内记录终点。")
            Text("只比较可见数量；不会请求访问、读取名称、唯一标识或外设内容。实验保存一份本机报告，不会自动上传。")
            start?.let { Text("起点可见设备数：${it.reading.value ?: "未取得"}") }
            if(notice.isNotEmpty()) Text(notice)
        }
    }, confirmButton={TextButton(enabled=!busy&&!reading,onClick={
        val first=start
        if(first!=null&&SystemClock.elapsedRealtime()-first.time.mono !in 0..usbWaitLimit){
            start=null;notice="已超过两分钟，请重新记录起点。"
        }else{
            reading=true
            scope.launch {
                try {
                    val point=withContext(Dispatchers.IO){observeUsb(context)}
                    if(first==null){start=point;notice=""}
                    else if(point.time.mono-first.time.mono in 0..usbWaitLimit)onSave(UsbCheck(first,point))
                    else {start=null;notice="已超过两分钟，请重新记录起点。"}
                }finally{reading=false}
            }
        }
    }){Text(if(reading)"正在观察…" else if(start==null)"记录 USB 起点" else "保存 USB 实验")}},
        dismissButton={TextButton(onClick=onClose){Text("取消")}})
}
