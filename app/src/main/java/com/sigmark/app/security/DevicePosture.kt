package com.sigmark.app.security

import com.sigmark.app.collector.bootEvidence
import com.sigmark.app.model.DeviceInfoItem
import com.sigmark.app.model.DeviceSnapshot
import com.sigmark.app.model.ValueStatus
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import java.time.temporal.ChronoUnit

internal enum class Finding(val label: String) { PRIORITY("优先处理"), REVIEW("请核对"), OBSERVED("已观察"), UNKNOWN("未确认") }
internal data class PostureRow(val id: String, val name: String, val state: Finding, val message: String, val source: String)

internal fun devicePosture(snapshot: DeviceSnapshot): List<PostureRow> =
    devicePosture(snapshot.sections.flatMap { section ->
        section.items.map { item -> "${section.key}.${item.key}" to item }
    }.toMap(), snapshot.collectedAt)

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
    val selBasis = value("system.selinuxEvidence")
    val selinuxRow = when {
        selMode == null || selMode.contains("推断") || selBasis in setOf("inferred_mac", "inferred_disabled") ->
            row(sel, "SELinux", Finding.UNKNOWN, "本机读数不足，实时模式未确认。")
        selMode.startsWith("Permissive") -> row(sel, "SELinux", Finding.PRIORITY,
            "本次读到宽容模式。若非预期测试系统，请核对 ROM。")
        selMode.startsWith("Enforcing") -> row(sel, "SELinux", Finding.OBSERVED,
            "本次读到强制模式。")
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
    val identity = identityConsistency(::value)
    val identityState = when {
        identity.differences.isNotEmpty() -> Finding.REVIEW
        identity.complete -> Finding.OBSERVED
        else -> Finding.UNKNOWN
    }
    val identityRow = PostureRow("app_identity", "App 身份声明核对", identityState, when (identityState) {
        Finding.REVIEW -> "${identity.differences.joinToString("、")}读数不一致。建议重新采集核对。"
        Finding.OBSERVED -> "已比较的 ${identity.compared} 对读数一致。"
        else -> "可比较 ${identity.compared} / ${identity.total} 对；未取得完整读数。"
    }, "本次 App 的 Build 读数与同义只读属性；不是独立身份验证。")
    // The overlay product name is baked into the image at build time; the codename
    // property can be rewritten per app, so the two disagreeing is the interesting case.
    val declaredDevice = value("system.device")
    val overlayDevice = value("environment.overlayDeviceCodename")
    // Field set 25. The multi-path evidence string records whether the channels that did
    // answer disagree with each other. That is a stronger signal than a single codename,
    // so it is surfaced before the declared-versus-overlay comparison.
    val overlayConflicts = value("environment.overlayEvidence")
        ?.split(" / ")?.filter { it.startsWith("conflict:") }.orEmpty()
    val overlayRow = when {
        overlayConflicts.isNotEmpty() -> PostureRow("overlay_codename", "镜像 overlay 代号核对",
            Finding.REVIEW,
            "镜像内多条 overlay 路径给出的代号不一致：${overlayConflicts.joinToString("；")}。" +
                "同一个镜像的构建产物通常一致，先核对改机、移植 ROM 或虚拟化环境。",
            "environment.overlayEvidence")
        declaredDevice == null || overlayDevice == null -> PostureRow("overlay_codename", "镜像 overlay 代号核对",
            Finding.UNKNOWN, "缺少 system.device 或 overlay 代号读数，未比对。",
            "environment.overlayDeviceCodename / system.device")
        identityComparableForm(declaredDevice.trim()) == identityComparableForm(overlayDevice.trim()) ->
            PostureRow("overlay_codename", "镜像 overlay 代号核对", Finding.OBSERVED,
                "设备代号与镜像 overlay 记录一致（${overlayDevice.trim()}）。",
                "environment.overlayDeviceCodename / system.device")
        else -> PostureRow("overlay_codename", "镜像 overlay 代号核对", Finding.REVIEW,
            "属性报告的设备代号为 ${declaredDevice.trim()}，镜像 overlay 记录的却是 ${overlayDevice.trim()}。" +
                "overlay 文件名来自构建镜像，通常不受改机工具影响；先核对改机、移植 ROM 或虚拟化环境。",
            "environment.overlayDeviceCodename / system.device")
    }
    val hardware = hardwareFacts(::value)
    val hardwareRow = when {
        hardware.conflicts.isNotEmpty() -> PostureRow("hardware_facts", "实测硬件与声明", Finding.REVIEW,
            hardware.conflicts.joinToString("；") { it.message } + " 若是刷机、虚拟化或实验用机型改写，请核对测试条件。",
            "cpu.cpuParts / memory.physicalRam / runtime.glesRenderer / cpu.cpuCapacity / memory.cmaTotal")
        hardware.confirmed > 0 -> PostureRow("hardware_facts", "实测硬件与声明", Finding.OBSERVED,
            "已核对 ${hardware.confirmed} 项独立通道读数，未发现与声明冲突。这不等于原厂证明。",
            "cpu.cpuParts / memory.physicalRam / runtime.glesRenderer / cpu.cpuCapacity / memory.cmaTotal")
        else -> PostureRow("hardware_facts", "实测硬件与声明", Finding.UNKNOWN,
            "缺少可比对的实测读数或 SoC 不在对照表内。", "cpu.cpuParts / memory.physicalRam / runtime.glesRenderer / cpu.cpuCapacity / memory.cmaTotal")
    }
    val keyProbe = fields["environment.keyProtection"]
    val keyIssue = if (keyProbe?.status == ValueStatus.ERROR) {
        row("environment.keyProtection", "密钥自测", Finding.REVIEW, "临时密钥自测未完成，建议重试。")
    } else null
    return (listOf(
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
        romRow, hookRow, tracerRow, profileRow, identityRow, hardwareRow, overlayRow,
    ) + listOfNotNull(keyIssue)).sortedBy { it.state.ordinal }
}
