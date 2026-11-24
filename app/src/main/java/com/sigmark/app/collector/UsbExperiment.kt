package com.sigmark.app.collector

import android.content.Context
import android.content.pm.PackageManager
import android.hardware.usb.UsbManager
import android.os.SystemClock
import com.sigmark.app.model.DeviceInfoItem
import com.sigmark.app.model.DeviceSnapshot
import com.sigmark.app.model.ReadReason
import com.sigmark.app.model.ValueStatus

internal const val usbWaitLimit = 120_000L
internal data class ProbeTime(val wall: Long, val mono: Long) {
    companion object {
        fun now() = ProbeTime(System.currentTimeMillis(), SystemClock.elapsedRealtime())
    }
}
internal data class UsbPoint(val time: ProbeTime, val reading: ReadResult<Int>)
internal data class UsbCheck(val start: UsbPoint, val end: UsbPoint)

private const val usbSource = "UsbManager.getDeviceList().size"

internal fun observeUsb(context: Context): UsbPoint {
    val time = ProbeTime.now()
    val result = SafeReader.read(usbSource) {
        if (!context.packageManager.hasSystemFeature(PackageManager.FEATURE_USB_HOST)) return@read null
        context.getSystemService(UsbManager::class.java)?.deviceList?.size?.takeIf { it in 0..1024 }
    }
    return UsbPoint(time, result.explainMissing(ReadReason.INTERFACE_UNSUPPORTED, "本次未观察到可用的 Android USB Host 枚举接口。"))
}

internal fun usbOutcome(start: Int?, end: Int?) = when {
    start == null || end == null -> "incomplete"
    end > start -> "increase"
    end < start -> "decrease"
    else -> "no_change"
}

internal fun clockEvidence(key: String, label: String, value: Long?) = DeviceInfoItem(key, label,
    value?.takeIf { it in 946684800000L until 4102444800000L }?.toString(), "System.currentTimeMillis",
    status = if (value != null && value in 946684800000L until 4102444800000L) ValueStatus.AVAILABLE else ValueStatus.UNAVAILABLE,
    reason = if (value != null && value in 946684800000L until 4102444800000L) null else ReadReason.NOT_REPORTED,
    note = "设备墙钟毫秒，仅供复核。观察间隔以单调时钟为准。")

internal fun withExperimentFields(snapshot: DeviceSnapshot, group: String, fields: List<DeviceInfoItem>): DeviceSnapshot =
    snapshot.copy(sections = snapshot.sections.map { section ->
        if (section.key != group) section else section.copy(items = section.items.filterNot { p -> fields.any { it.key == p.key } } + fields)
    })

internal fun usbEvidence(snapshot: DeviceSnapshot, check: UsbCheck): DeviceSnapshot {
    val duration = (check.end.time.mono - check.start.time.mono).takeIf { it in 0..usbWaitLimit }
    fun count(point: UsbPoint, key: String, label: String) =
        point.reading.map { it.toString() }.copy(errno=null).item(key, label)
    return withExperimentFields(snapshot, "runtime", listOf(
        count(check.start, "usbStartCount", "USB 起点可见设备数"),
        count(check.end, "usbEndCount", "USB 终点可见设备数"),
        DeviceInfoItem("usbOutcome", "USB 主机枚举结果",
            if (duration == null) "incomplete" else usbOutcome(check.start.reading.value,check.end.reading.value), usbSource,
            note = "只比较 Android 向当前 App 返回的设备数量；不打开外设、不记录名称或硬件标识。"),
        DeviceInfoItem("usbElapsed", "USB 两次观测间隔", duration?.let { "$it ms" }, "SystemClock.elapsedRealtime",
            if(duration==null) ValueStatus.UNAVAILABLE else ValueStatus.AVAILABLE, reason = if(duration==null) ReadReason.INVALID_VALUE else null),
        clockEvidence("usbStartAt","USB 实验起点时间",check.start.time.wall),
        clockEvidence("usbEndAt","USB 实验终点时间",check.end.time.wall),
    ))
}
