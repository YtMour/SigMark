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
    val architecture = when (architectureEvidence(value(architectureKeys[0]), value(architectureKeys[1]), value(architectureKeys[2]))) {
        ArchitectureState.CONFLICT -> Finding.REVIEW to "64 位进程与至少一项 32 位声明有冲突。先复采并比对同机 ROM；这不是虚拟设备判定。"
        ArchitectureState.COMPATIBLE -> Finding.OBSERVED to "进程位宽、公开 ABI 与内核架构读数兼容；不证明设备为实体手机。"
        ArchitectureState.INSUFFICIENT -> Finding.UNKNOWN to "归档缺少足够的可比较读数，或读数不在已知 ABI 范围。"
    }
    val selMode = value(sel)
    val selinuxRow = when {
        selMode == null -> row(sel, "SELinux", Finding.UNKNOWN, "未取得实时模式；普通应用读节点受限很常见，不按关闭处理。")
        selMode.startsWith("Permissive") -> row(sel, "SELinux", Finding.PRIORITY,
            if (selMode.contains("推断")) "推断为宽容模式：策略违规只记录不拦截。依据是节点被拒读但文件权限允许读取；请核对 ROM。"
            else "直接读到宽容模式：策略违规会记录但不强制拦截。若非预期测试系统，先检查 ROM。")
        selMode.startsWith("Enforcing") -> row(sel, "SELinux", Finding.OBSERVED,
            if (selMode.contains("推断")) "推断为强制模式：节点被策略拒绝读取，而文件权限允许读取；permissive 下本应可读。这不是直接读数。"
            else "直接读到强制模式。此项不证明其他保护均生效。")
        selMode.startsWith("未启用") -> row(sel, "SELinux", Finding.REVIEW,
            "推断 SELinux 未启用：selinuxfs 未挂载或 enforce 节点不存在。若非定制试验系统，先核对 ROM 与内核配置。")
        else -> row(sel, "SELinux", Finding.UNKNOWN, "节点内容不是标准 0/1，实时模式未确认。")
    }
    val hookKeys = listOf("environment.hookSignals", "environment.rootMountHints", "environment.rootManagerVisible")
    val hookHits = hookKeys.mapNotNull { key -> value(key)?.takeIf { it.isNotEmpty() && it != "none" } }
    val hookRow = when {
        hookHits.isNotEmpty() -> row(hookKeys[0], "注入与 Hook 线索", Finding.REVIEW,
            "观察到 ${hookHits.joinToString(" / ")}。只代表本进程映射、系统分区挂载或可见应用；自定义 ROM 与调试工具也可能命中，先核对测试条件。")
        hookKeys.all { value(it) != null } -> row(hookKeys[0], "注入与 Hook 线索", Finding.OBSERVED,
            "本进程映射、系统分区挂载和可见应用均未出现已知线索；受包可见性限制，未见不等于不存在。")
        else -> row(hookKeys[0], "注入与 Hook 线索", Finding.UNKNOWN, "缺少本进程映射、挂载或可见应用读数。")
    }
    val tracer = value("environment.tracerPid")
    val tracerRow = when {
        tracer == null -> row("environment.tracerPid", "内核跟踪", Finding.UNKNOWN, "未取得 TracerPid。")
        tracer == "0" -> row("environment.tracerPid", "内核跟踪", Finding.OBSERVED,
            "内核未记录跟踪方。调试器与 Profiler 都可能出现非零值，零值也不排除用户态注入。")
        else -> row("environment.tracerPid", "内核跟踪", Finding.REVIEW, "内核记录了跟踪进程 PID $tracer。若是调试或性能分析，请核对测试条件。")
    }
    val profileRow = when (val user = value("environment.userProfile")) {
        "owner" -> row("environment.userProfile", "运行用户环境", Finding.OBSERVED, "当前应用运行在用户 0（主用户）。")
        "secondary" -> row("environment.userProfile", "运行用户环境", Finding.REVIEW,
            "当前应用运行在其他用户空间（双开、分身或多用户），数据目录与主用户不同。核对是否为预期测试环境。")
        "managed" -> row("environment.userProfile", "运行用户环境", Finding.REVIEW, "当前应用运行在工作资料中。核对是否为预期测试环境。")
        else -> row("environment.userProfile", "运行用户环境", Finding.UNKNOWN, "未取得应用运行的用户环境。")
    }
    val verity = value("environment.verityMode")
    val debuggable = value("environment.buildDebuggable")
    val romFacts = listOfNotNull(verity?.let { "dm-verity 声明为 $it" }, debuggable?.let { "系统可调试声明：$it" }).joinToString("；")
    val romRow = when {
        verity in setOf("disabled", "logging") || debuggable == "开启" -> row("environment.verityMode", "ROM 验证启动", Finding.REVIEW,
            "$romFacts。这是系统自述，需结合 ROM 来源核对。")
        romFacts.isNotEmpty() -> row("environment.verityMode", "ROM 验证启动", Finding.OBSERVED, "$romFacts。")
        else -> row("environment.verityMode", "ROM 验证启动", Finding.UNKNOWN, "未取得 dm-verity 或系统可调试声明。")
    }
    val identityPairs = listOf(
        Triple("system.board", "system.boardPlatform", "主板 Build.BOARD / ro.board.platform"),
        Triple("cpu.hardware", "system.bootHardware", "硬件 Build.HARDWARE / ro.boot.hardware"),
        Triple("system.sku", "system.hardwareSku", "SKU Build.SKU / ro.boot.hardware.sku"),
    )
    val identityComparable = identityPairs.mapNotNull { (left, right, label) ->
        val declared = value(left)
        val property = value(right)
        if (declared != null && property != null) Triple(label, declared, property) else null
    }
    val identityConflicts = identityComparable.filter { (_, declared, property) ->
        !declared.equals(property, ignoreCase = true)
    }
    val identityRow = when {
        identityConflicts.isNotEmpty() -> row("system.board", "设备身份字段", Finding.REVIEW,
            "同一观察者内部两组声明不一致：" + identityConflicts.joinToString("；") { (label, declared, property) ->
                "$label（$declared / $property）"
            } + "。先核对 ROM 属性改写，不据此判定真伪。")
        identityComparable.isNotEmpty() -> row("system.board", "设备身份字段", Finding.OBSERVED,
            "已比较 ${identityComparable.size} 对身份声明，读数一致；一致只说明当前观察者内部自洽，不代表原厂。")
        else -> row("system.board", "设备身份字段", Finding.UNKNOWN, "缺少可比的 Build 与属性身份读数。")
    }
    return listOf(
        PostureRow("boot", "启动完整性", boot.first, boot.second, "ro.boot.verifiedbootstate / vbmeta.device_state / flash.locked"),
        selinuxRow,
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
        },
        PostureRow("runtime_architecture", "运行架构一致性", architecture.first, architecture.second,
            "Process.is64Bit / Build.SUPPORTED_ABIS / Os.uname"),
        romRow, hookRow, tracerRow, profileRow, identityRow,
    ).sortedBy { it.state.ordinal }
}
