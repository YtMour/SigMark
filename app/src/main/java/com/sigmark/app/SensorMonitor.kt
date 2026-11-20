package com.sigmark.app

import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.SystemClock
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.LifecycleResumeEffect
import com.sigmark.app.collector.SafeReader
import java.util.Locale

@Composable
internal fun SensorMonitor(onClose: () -> Unit) {
    val context = LocalContext.current
    val manager = remember(context) { context.getSystemService(SensorManager::class.java) }
    val list = remember(manager) { SafeReader.read("SensorManager.getSensorList") { manager?.getSensorList(Sensor.TYPE_ALL) } }
    val sensors = list.value.orEmpty()
    var selected by remember { mutableIntStateOf(-1) }
    val sensor = sensors.getOrNull(selected)
    var reading by remember(sensor) { mutableStateOf<String?>(null) }
    var status by remember(sensor) { mutableStateOf("等待系统回报；按变化触发的传感器可能暂时无事件。") }
    if (sensor != null && manager != null) {
        LifecycleResumeEffect(sensor) {
            var last = -250L
            var active = true
            val listener = object : SensorEventListener {
                override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit
                override fun onSensorChanged(event: SensorEvent) {
                    val now = SystemClock.elapsedRealtime()
                    if (!active || now - last < 250) return
                    last = now
                    // Some vendor sensors publish opaque arrays. Display a bounded prefix without inferring units.
                    reading = event.values.take(8).mapIndexed { i, value ->
                        "v[$i] " + if (value.isFinite()) String.format(Locale.ROOT, "%.3f", value) else "—"
                    }.joinToString("   ")
                    status = sensorUnits(sensor.type)
                }
            }
            val registration = SafeReader.read("SensorManager.registerListener") {
                manager.registerListener(listener, sensor, SensorManager.SENSOR_DELAY_NORMAL)
            }
            status = when (registration.value) {
                true -> "等待系统回报；按变化触发的传感器可能暂时无事件。"
                false -> "系统未开启此传感器订阅；可能需要独立权限或当前硬件未提供。"
                null -> registration.detail ?: "订阅未建立。"
            }
            onPauseOrDispose {
                active = false
                if (registration.value == true) manager.unregisterListener(listener)
                reading = null
            }
        }
    }
    AlertDialog(
        onDismissRequest = onClose,
        title = { Text("实时传感器") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("一次监听一个传感器。仅在此面板处于前台时读取，不保存或上传。")
                when {
                    sensor != null -> {
                        Text(sensor.name)
                        Text(reading ?: "—")
                        Text(status)
                        TextButton(onClick = { selected = -1 }) { Text("更换传感器") }
                    }
                    sensors.isEmpty() -> Text(list.detail ?: "系统未返回传感器。")
                    else -> LazyColumn(Modifier.heightIn(max = 290.dp)) {
                        itemsIndexed(sensors, key = { index, _ -> index }) { index, item ->
                            TextButton(onClick = { selected = index }) { Text(item.name) }
                        }
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = onClose) { Text("关闭") } },
    )
}

private fun sensorUnits(type: Int): String = when (type) {
    Sensor.TYPE_ACCELEROMETER, Sensor.TYPE_GRAVITY, Sensor.TYPE_LINEAR_ACCELERATION -> "XYZ：m/s²"
    Sensor.TYPE_GYROSCOPE -> "XYZ：rad/s"
    Sensor.TYPE_MAGNETIC_FIELD -> "XYZ：µT"
    Sensor.TYPE_LIGHT -> "照度：lx"
    Sensor.TYPE_PRESSURE -> "气压：hPa"
    Sensor.TYPE_PROXIMITY -> "距离：cm"
    Sensor.TYPE_AMBIENT_TEMPERATURE -> "温度：°C"
    Sensor.TYPE_RELATIVE_HUMIDITY -> "相对湿度：%"
    else -> "系统原始读数（最多显示 8 个分量）；单位由传感器类型定义。"
}
