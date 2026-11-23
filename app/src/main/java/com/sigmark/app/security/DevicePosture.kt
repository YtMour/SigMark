package com.sigmark.app.security

import com.sigmark.app.collector.bootEvidence
import com.sigmark.app.model.DeviceInfoItem
import com.sigmark.app.model.ValueStatus
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import java.time.temporal.ChronoUnit

internal enum class Finding(val label: String) { PRIORITY("优先处理"), REVIEW("请核对"), OBSERVED("已观察"), UNKNOWN("未确认") }
internal data class PostureRow(val id: String, val name: String, val state: Finding, val message: String, val source: String)

internal fun devicePosture(fields: Map<String, DeviceInfoItem>, capturedAt: Long): List<PostureRow> {
    fun value(k: String) = fields[k]?.takeIf { it.status == ValueStatus.AVAILABLE }?.value
    fun row(k: String, label: String, state: Finding, message: String) = PostureRow(k,label,state,message,fields[k]?.source ?: k)
    val boot = when (bootEvidence(value("environment.verifiedBoot"), value("environment.vbmetaState"), value("environment.flashLock"))) {
        "red" -> Finding.PRIORITY to "系统报告启动验证失败。先核对 ROM 来源和预期启动状态，再在这台手机上处理敏感数据。"
        "conflict" -> Finding.REVIEW to "系统给出的启动与锁定信息矛盾。先与同机基线对照；这些读数不是独立证明。"
        "unlocked" -> Finding.REVIEW to "观察到解锁线索。若是刷机测试，请核对实验预期；解锁不等于假机。"
        "custom" -> Finding.REVIEW to "系统报告自定义信任根。请用实验室登记的 ROM 签名核对来源。"
        "locked" -> Finding.OBSERVED to "系统报告已锁定，启动颜色一致。这是本机声明，未验证原厂镜像。"
        else -> Finding.UNKNOWN to "缺少一致的启动与锁定读数。"
    }
    val sel = "system.selinux"
    val lock = "environment.keyguardSecure"
    val enc = "environment.storageEncryption"
    val patch = "system.patch"
    val day = runCatching { LocalDate.parse(value(patch)) }.getOrNull()
    val age = if (day!=null && capturedAt>0) ChronoUnit.DAYS.between(day, Instant.ofEpochMilli(capturedAt).atZone(ZoneOffset.UTC).toLocalDate()) else null
    return listOf(
        PostureRow("boot", "启动完整性", boot.first, boot.second, "ro.boot.verifiedbootstate / vbmeta.device_state / flash.locked"),
        when (value(sel)) {
            "Permissive（宽容模式）" -> row(sel,"SELinux",Finding.PRIORITY,"直接读到宽容模式：策略违规会记录但不强制拦截。若非预期测试系统，先检查 ROM。")
            "Enforcing（强制模式）" -> row(sel,"SELinux",Finding.OBSERVED,"直接读到强制模式。此项不证明其他保护均生效。")
            else -> row(sel,"SELinux",Finding.UNKNOWN,"未取得实时模式；普通应用读节点受限很常见，不按关闭处理。")
        },
        when(value(lock)) {
            "否" -> row(lock,"锁屏凭证",Finding.PRIORITY,"当前用户未设置安全锁屏。日常用机请设置 PIN、图案或密码。")
            "是" -> row(lock,"锁屏凭证",Finding.OBSERVED,"系统报告当前用户已设置安全锁屏。")
            else -> row(lock,"锁屏凭证",Finding.UNKNOWN,"没有有效的锁屏凭证读数。")
        },
        when(val v = value(enc)) {
            "系统报告未启用" -> row(enc,"存储加密",Finding.PRIORITY,"系统报告存储加密未启用。存放个人数据前请复核安全设置。")
            "启用中","系统报告不支持" -> row(enc,"存储加密",Finding.REVIEW,"$v；尚未观察到加密已启用。")
            else -> if(v?.startsWith("已启用")==true) row(enc,"存储加密",Finding.OBSERVED,v) else row(enc,"存储加密",Finding.UNKNOWN,"系统未给出可确认的加密状态。")
        },
        when {
            age==null || age<0 -> row(patch,"系统补丁",Finding.UNKNOWN,"补丁日期缺失、无效或晚于采样日；先核对设备日期。")
            age>180 -> row(patch,"系统补丁",Finding.REVIEW,"系统声明补丁距采样日 $age 天。建议查厂商更新；180 天是实验提醒线，不是漏洞判定。")
            else -> row(patch,"系统补丁",Finding.OBSERVED,"系统声明补丁距采样日 $age 天；未核验补丁内容。")
        }
    ).sortedBy { it.state.ordinal }
}
