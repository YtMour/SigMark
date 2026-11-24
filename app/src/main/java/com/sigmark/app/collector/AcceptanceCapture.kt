package com.sigmark.app.collector

import com.sigmark.app.CollectionAccess
import com.sigmark.app.model.DeviceInfoItem
import com.sigmark.app.model.DeviceSnapshot
import com.sigmark.app.model.ValueStatus
import com.sigmark.app.model.ReadReason

internal enum class CapturePlan(val code: String, val title: String, val description: String) {
    FULL("full", "整体获取", "采集设备参数，并运行密钥保护、AVC 首帧和 GLES 离屏回读自测。"),
    STANDARD("standard", "标准采集", "采集设备参数和临时密钥保护结果，不运行视频实测。"),
    ROM("rom", "ROM 验收", "采集设备参数、密钥保护、H.264 首帧及 GLES 离屏回读实测。"),
    NETWORK("network", "网络复测", "保存一次当前链路的采样及采集时授权状态；不会自动切换网络。"),
    USB("usb", "USB 插拔实验", "手动记录插拔前后两次 USB 主机可见设备数量。"),
    GNSS("gnss", "GNSS 读数核对", "核对系统型号年并主动观察 GNSS 回调。不保存坐标或原始测量。");

    val runsLocalExperiments: Boolean get() = this == FULL || this == ROM
    val runsKeyCheck: Boolean get() = runsLocalExperiments || this == STANDARD
}

internal fun collectionContext(access: CollectionAccess): List<DeviceInfoItem> {
    val source = "Context.checkSelfPermission"
    val note = "采集开始时的快照，不反映此后的授权变化。"
    return listOf(
        DeviceInfoItem("capturePhoneAccess", "采集时电话状态权限", if (access.phone) "granted" else "not_granted", source, note = note),
        DeviceInfoItem("captureLocationAccess", "采集时位置权限",
            when { access.fine -> "precise"; access.coarse -> "approximate"; else -> "not_granted" }, source, note = note),
        DeviceInfoItem("captureLocationSwitch", "采集时系统位置开关",
            access.location?.let { if (it) "enabled" else "disabled" }, "LocationManagerCompat.isLocationEnabled",
            if (access.location == null) ValueStatus.UNAVAILABLE else ValueStatus.AVAILABLE,
            note = note, reason = if (access.location == null) ReadReason.NOT_REPORTED else null),
    )
}

internal fun acceptanceEvidence(snapshot: DeviceSnapshot, plan: CapturePlan, decode: DecodeResult?): DeviceSnapshot {
    val observation = DeviceInfoItem("capturePlan", "采样方案", plan.code, "SigMark selected capture plan")
    val media = if (decode == null) emptyList() else decodeEvidence(decode)
    return snapshot.copy(sections = snapshot.sections.map { section ->
        val extra = when (section.key) { "environment" -> listOf(observation); "media" -> media; else -> emptyList() }
        if (extra.isEmpty()) section else section.copy(items = section.items.filterNot { row -> extra.any { it.key == row.key } } + extra)
    })
}

internal fun decodeEvidence(result: DecodeResult): List<DeviceInfoItem> {
    val source = "MediaExtractor / MediaCodec"
    fun field(key: String, label: String, value: String?, note: String? = null) =
        DeviceInfoItem(key, label, value, source, if(value != null) ValueStatus.AVAILABLE else ValueStatus.UNAVAILABLE,
            note, if(value == null) ReadReason.NOT_REPORTED else null)
    return listOf(
        field("avcFixture", "解码测试样片", mediaFixture, "内置 AVC Baseline，320×180，15 fps，无音轨。"),
        field("avcFirstFrame", "AVC 首帧结果", if (result.stage == DecodeStage.DONE) "pass" else "fail",
            "只验证默认解码器对内置样片的首帧输出。"),
        field("avcStage", "AVC 实测阶段", result.stage.name.lowercase(java.util.Locale.ROOT), result.detail),
        field("avcDecoder", "实测使用的解码器", result.codec?.takeIf { it.matches(Regex("[a-zA-Z0-9._+\\-]{1,128}")) }),
        field("avcElapsed", "AVC 实测耗时", result.elapsedMs?.takeIf { it in 0..999_999_999 }?.let { "$it ms" },
            "包含打开样片、初始化与等待输出。不是性能基准。"),
    )
}
