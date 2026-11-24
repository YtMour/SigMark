package com.sigmark.app.collector

import android.content.Context
import android.content.Intent
import android.media.MediaDrm
import android.os.UserManager
import android.provider.Settings
import java.util.Locale
import java.util.UUID

private val whitespace = Regex("\\s+")
private val verityModePattern = Regex("[a-z0-9_.-]{1,32}")
private val widevineUuid = UUID.fromString("edef8ba9-79d6-4ace-a3c8-27dcd51d21ed")
private const val userRange = 100_000
// MediaDrm's securityLevel property is a public plugin property, not an SDK constant.
private const val securityLevelProperty = "securityLevel"

internal val hookSignalOrder = listOf("frida", "gadget", "xposed", "substrate", "riru", "zygisk", "lspatch", "memfd_exec")
internal val rootMountOrder = listOf("overlay_system", "overlay_vendor", "overlay_product", "tmpfs_sbin", "magisk_path")
internal val rootManagerOrder = listOf("magisk", "kernelsu", "supersu", "superuser", "kingroot")
internal val rootManagerPackages = mapOf(
    "magisk" to "com.topjohnwu.magisk",
    "kernelsu" to "me.weishu.kernelsu",
    "supersu" to "eu.chainfire.supersu",
    "superuser" to "com.koushikdutta.superuser",
    "kingroot" to "com.kingroot.kinguser",
)

internal val partitionBuildDateOrder = listOf("system", "vendor", "product", "odm", "system_ext", "bootimage")

internal fun orderedObservation(order: List<String>, hits: Set<String>): String =
    order.filter { it in hits }.joinToString(" / ").ifEmpty { "none" }

// ART and the graphics stack create executable memfd regions in every app
// (jit-cache, dalvik-jit-code-cache, gralloc buffers). Those names carry no
// injection meaning, so only unrecognized executable memfd names are reported.
private val runtimeMemfdName = Regex("jit|dalvik|vdex|oat|gralloc|hwui|ion|adf")

internal fun hookSignals(maps: String?): String? {
    if (maps == null) return null
    val hits = mutableSetOf<String>()
    for (line in maps.lineSequence()) {
        val fields = line.trim().split(whitespace, limit = 6)
        if (fields.size < 5) continue
        val permissions = fields[1]
        val path = fields.getOrNull(5)?.lowercase(Locale.ROOT) ?: continue
        if (path.isEmpty()) continue
        for (code in hookSignalOrder) {
            if (code == "memfd_exec") {
                val marker = path.indexOf("memfd:")
                if (!permissions.contains('x') || marker < 0) continue
                val name = path.substring(marker + 6).substringBefore(' ').removeSuffix("(deleted)").trim()
                if (name.isNotEmpty() && !runtimeMemfdName.containsMatchIn(name)) hits += code
            } else if (path.contains(code)) hits += code
        }
    }
    return orderedObservation(hookSignalOrder, hits)
}

internal fun rootMountCodes(mountInfo: String?): Set<String>? {
    if (mountInfo == null) return null
    val hits = mutableSetOf<String>()
    for (line in mountInfo.lineSequence()) {
        val fields = line.trim().split(whitespace)
        if (fields.size < 7) continue
        val mountPoint = fields[4].lowercase(Locale.ROOT)
        val separator = fields.indexOf("-")
        if (separator < 5 || separator + 2 >= fields.size) continue
        val fileSystem = fields[separator + 1]
        val source = fields[separator + 2].lowercase(Locale.ROOT)
        if (fileSystem == "overlay") {
            if (mountPoint == "/system" || mountPoint.startsWith("/system/")) hits += "overlay_system"
            if (mountPoint == "/vendor" || mountPoint.startsWith("/vendor/")) hits += "overlay_vendor"
            if (mountPoint == "/product" || mountPoint.startsWith("/product/")) hits += "overlay_product"
        }
        if (fileSystem == "tmpfs" && isSbinMount(mountPoint)) hits += "tmpfs_sbin"
        if (mountPoint.contains(".magisk") || source.contains(".magisk")) hits += "magisk_path"
    }
    return hits
}

private fun isSbinMount(mountPoint: String) =
    mountPoint == "/sbin" || mountPoint.startsWith("/sbin/") ||
        mountPoint == "/debug_ramdisk" || mountPoint.startsWith("/debug_ramdisk/")

internal fun rootMountHints(mountInfo: String?): String? =
    rootMountCodes(mountInfo)?.let { orderedObservation(rootMountOrder, it) }

internal fun tracerPid(status: String?): String? =
    status?.lineSequence()?.firstOrNull { it.startsWith("TracerPid:") }
        ?.substringAfter(':')?.trim()?.toIntOrNull()
        ?.takeIf { it in 0..4_194_304 }?.toString()

internal fun rootManagerCodes(packages: Collection<String>): String {
    val visible = packages.toSet()
    val hits = rootManagerOrder.filter { code -> rootManagerPackages[code] in visible }.toSet()
    return orderedObservation(rootManagerOrder, hits)
}

internal fun userProfileCode(userId: Int, managedProfile: Boolean?): String = when {
    userId == 0 -> "owner"
    managedProfile == true -> "managed"
    else -> "secondary"
}

internal fun drmSecurityLevel(raw: String?): String? =
    raw?.trim()?.uppercase(Locale.ROOT)?.takeIf { it in setOf("L1", "L2", "L3") }

internal fun flagLabel(raw: String?): String? = when (raw?.trim()) {
    "1" -> "开启"
    "0" -> "关闭"
    else -> null
}

internal fun epochSecondsUtcDate(raw: String?): String? {
    val seconds = raw?.trim()?.toLongOrNull() ?: return null
    if (seconds <= 0 || seconds > 4_102_444_800L) return null
    return java.time.Instant.ofEpochSecond(seconds).atOffset(java.time.ZoneOffset.UTC).toLocalDate().toString()
}

internal fun partitionDatesText(dates: Map<String, String>): String? =
    partitionBuildDateOrder.mapNotNull { part -> dates[part]?.let { "$part $it" } }
        .joinToString(" · ").ifEmpty { null }

// Field set 17 additions. Every item is an observation of this app process and
// carries its own status; one failed read never removes the others.
internal fun SectionBuilder.securityEnvironment(context: Context) {
    observation("hookSignals", "Hook / 注入映射线索",
        SafeReader.node(SafeReader.Node.PROCESS_MAPS).map(::hookSignals)
            .withNote("只扫描本应用进程 /proc/self/maps 的路径段，并排除 ART/JIT、图形栈等运行时创建的 memfd；" +
                "只代表本进程映射，不等于设备被注入。"))
    observation("tracerPid", "内核跟踪进程 PID",
        SafeReader.node(SafeReader.Node.PROCESS_STATUS).map(::tracerPid)
            .withNote("0 表示无跟踪方；非零表示内核记录了跟踪进程（调试器、Profiler 或注入框架都可能）。这是内核记录，不是攻击结论。"))
    observation("rootMountHints", "系统分区挂载线索",
        SafeReader.node(SafeReader.Node.PROCESS_MOUNTINFO).map(::rootMountHints)
            .withNote("只识别 overlay 挂载到系统分区、/sbin 或 /debug_ramdisk 的 tmpfs、路径含 .magisk 的挂载；自定义 ROM 也可能出现 overlay。"))
    observation("rootManagerVisible", "可见的 Root 管理应用",
        SafeReader.read("PackageManager.queryIntentActivities(MAIN / LAUNCHER)",
            "只比对固定包名列表；受包可见性限制，none 不等于未安装。") {
            rootManagerCodes(context.packageManager.queryIntentActivities(
                Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER), 0)
                .mapNotNull { it.activityInfo?.packageName })
        })
    val uid = android.os.Process.myUid()
    // UserHandle.PER_USER_RANGE is not part of the public SDK; 100000 is its fixed AOSP value.
    val userId = uid / userRange
    val managed = runCatching {
        // isManagedProfile() is API 30+; older releases report the work profile as another user.
        if (userId == 0 || android.os.Build.VERSION.SDK_INT < 30) null
        else context.getSystemService(UserManager::class.java)?.isManagedProfile
    }.getOrNull()
    val dataDirPrefix = context.applicationInfo.dataDir.trimEnd('/').split('/').take(4).joinToString("/")
    observation("userProfile", "应用运行用户环境",
        SafeReader.read("Process.myUid / ApplicationInfo.dataDir",
            "uid=$uid · 数据目录前缀 $dataDirPrefix。owner = 用户 0；secondary = 双开、分身或多用户；managed = 工作资料。三者都不是恶意结论。") {
            userProfileCode(userId, managed)
        })
    var drmVendor: String? = null
    var drmVersion: String? = null
    val drm = SafeReader.read("MediaDrm(Widevine).getProperty(SECURITY_LEVEL)",
        "系统 DRM 声明，不是硬件证明。") {
        val mediaDrm = runCatching { MediaDrm(widevineUuid) }.getOrNull() ?: return@read null
        try {
            drmVendor = runCatching { mediaDrm.getPropertyString(MediaDrm.PROPERTY_VENDOR) }.getOrNull()
            drmVersion = runCatching { mediaDrm.getPropertyString(MediaDrm.PROPERTY_VERSION) }.getOrNull()
            drmSecurityLevel(runCatching { mediaDrm.getPropertyString(securityLevelProperty) }.getOrNull())
        } finally { runCatching { mediaDrm.release() } }
    }
    val vendorText = drmVendor?.takeIf { it.isNotBlank() }
    val versionText = drmVersion?.takeIf { it.isNotBlank() }
    val drmDetails = listOfNotNull(
        when {
            drm.value != null -> "Widevine vendor=${vendorText ?: "未报告"} · version=${versionText ?: "未报告"}。"
            vendorText != null -> "Widevine vendor=$vendorText · version=${versionText ?: "未报告"}；未取得 L1/L2/L3 等级。"
            else -> "未能打开 Widevine DRM 或系统未声明 L1/L2/L3。"
        },
        "系统 DRM 声明，不是硬件证明；L3 只表示软件级密钥保护，不等于模拟器。",
    )
    observation("drmSecurityLevel", "系统 DRM 密钥保护级别", drm.copy(detail = drmDetails.joinToString(" ")))
    observation("verityMode", "dm-verity 启动模式",
        SafeReader.property(SafeReader.Property.VERITY_MODE)
            .decodeProperty({ it.trim().lowercase(Locale.ROOT).takeIf { value -> verityModePattern.matches(value) } },
                "启动属性存在但不是合法的小写标记。")
            .withNote("来自一次属性快照；未设置时为系统未上报，不能写成已关闭。"))
    observation("buildDebuggable", "系统可调试构建声明",
        SafeReader.property(SafeReader.Property.DEBUGGABLE)
            .decodeProperty({ flagLabel(it) }, "属性值不是 0/1。")
            .withNote("来自 ro.debuggable 属性快照；与当前 APK 的可调试标志不是同一件事。"))
    value("androidIdSha256", "ANDROID_ID 摘要（仅本机）", "Settings.Secure.ANDROID_ID / SHA-256",
        "保存摘要而非原值；不上传；用于同机多次采样比对。") {
        Settings.Secure.getString(context.contentResolver, Settings.Secure.ANDROID_ID)
            ?.takeIf { it.isNotBlank() }?.toByteArray(Charsets.UTF_8)?.sha256Hex()?.let { "sha256:$it" }
    }
}
