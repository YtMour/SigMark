package com.sigmark.app.collector

import android.content.Context
import android.content.Intent
import android.media.MediaDrm
import android.os.UserManager
import android.provider.Settings
import com.sigmark.app.model.ReadReason
import com.sigmark.app.model.ValueStatus
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

// AOSP names the framework runtime-resource-overlay after the product the image was
// built for: framework-res__<product>_user__auto_generated_rro_<partition>.apk. Its
// idmap stays mapped in every process that loads resources, so the product name of
// the installed image is visible in /proc/self/maps even when the property layer
// reports a different codename.
//
// Field set 25. One baked file name is a single build artifact; the same image also
// carries the per-target RROs it was built with, both as idmaps in `maps` and as
// files under the partition overlay directories. Reading several of them makes the
// channel survive a module that replaces only the framework overlay, and keeps the
// disagreement visible instead of silently picking one. None of these paths can name
// the SoC or the SKU: those only ever appear as side evidence.
private val frameworkRro = Regex(
    """framework-res__([A-Za-z0-9_]{2,32})_user__auto_generated_rro(?:_[a-z0-9]{1,16})?\.apk"""
)
private val idmapPath = Regex("""/data/resource-cache/([^/\s]+)@idmap""")
// Group 1 is the target package, kept only for context; group 2 is the candidate.
private val perTargetRro = Regex(
    """^(?!framework-res__)([A-Za-z0-9_.]{1,64})__([A-Za-z0-9_]{2,32})_user__auto_generated_rro(?:_[a-z0-9]{1,16})?\.apk$"""
)
private val dirRro = Regex(
    """^[A-Za-z0-9_.\-]{1,64}__([A-Za-z0-9_]{2,32})_user__auto_generated_(?:rro|characteristics_rro)(?:_[a-z0-9]{1,16})?\.apk$"""
)
// YmRecentsGs101Overlay -> Gs101. The platform name, never a device codename.
private val socOverlay = Regex("""Ym[A-Za-z]{2,24}?([A-Z][a-z]?\d{3})Overlay""")
// SettingsOverlayGR1YH.apk -> GR1YH. A SKU, never a device codename.
private val skuOverlay = Regex("""^[A-Za-z]{3,24}Overlay([A-Z0-9]{4,10})\.apk$""")

// Structural words, placeholders, platform names and SKU-shaped words that a capture
// group could otherwise turn into a codename. `corot` and `oriole` are real codenames
// and must never be listed here.
private val overlayCodenameBlocklist = setOf(
    "framework", "common", "system", "product", "vendor", "odm", "system_ext", "main", "default", "base",
    "nosdcard", "generic", "unknown", "google", "android", "aosp", "user", "eng", "test", "debug",
    "overlay", "rro", "apk", "idmap", "resources", "device", "phone", "build",
    "mtk", "qcom", "gs101", "gs201", "exynos", "tensor", "kirin", "sm8450", "mt6985",
)

internal enum class OverlayDir(val path: String, val channel: String) {
    VENDOR("/vendor/overlay", "vendor_dir"),
    PRODUCT("/product/overlay", "product_dir"),
    SYSTEM_EXT("/system_ext/overlay", "system_ext_dir"),
    ODM("/odm/overlay", "odm_dir"),
}

// Three states, not two: "the directory is not on this image" and "the app may not
// list it" mean different things to the report and must not collapse into "no match".
internal sealed interface DirScan {
    data class Names(val names: List<String>) : DirScan
    data object Absent : DirScan
    data object Denied : DirScan
}

internal data class OverlayReading(
    val codename: String?,
    val evidence: String?,
    val conflicts: List<String>,
    val denied: List<String>,
    val available: Boolean,
)

private const val overlayEvidenceMaxChars = 200
private const val overlayDirMaxEntries = 64

// The capture groups are deliberately loose so one pattern covers every AOSP name
// shape, which lets a one-character product name absorb the separator and capture
// `a_` from `framework-res__a__user__...`. The length and character rules from the
// spec are therefore enforced here, once, rather than repeated in five patterns:
// 2-32 characters, alphanumeric at both ends.
private val overlayCodenameShape = Regex("^[a-z0-9][a-z0-9_]{0,30}[a-z0-9]$")

// Case-insensitive with `-` folded to `_` for the blocklist comparison only.
private fun overlayCodenameCandidate(raw: String?): String? {
    val value = raw?.trim()?.lowercase(Locale.ROOT) ?: return null
    if (!overlayCodenameShape.matches(value)) return null
    return value.takeIf { it.replace('-', '_') !in overlayCodenameBlocklist }
}

private fun firstOverlayCodename(candidates: Iterable<String?>): String? =
    candidates.mapNotNull(::overlayCodenameCandidate).firstOrNull()

internal fun overlayReading(
    maps: String?,
    directories: Map<OverlayDir, DirScan> = emptyMap(),
    declaredSku: String? = null,
): OverlayReading {
    val denied = mutableListOf<String>()
    val text = maps.orEmpty()
    // A null reading means the node could not be read at all, which is evidence of a
    // gap rather than evidence of absence.
    if (maps == null) denied += "maps"

    // A: the framework RRO, in both its direct and its @idmap escaped form.
    val rro = firstOverlayCodename(frameworkRro.findAll(text).map { it.groupValues[1] }.toList())
    // B: any other per-target RRO idmap that happens to be loaded in this process.
    val idmap = firstOverlayCodename(
        idmapPath.findAll(text).map { it.groupValues[1].substringAfterLast('@') }
            .mapNotNull { perTargetRro.find(it)?.groupValues?.get(2) }.toList(),
    )

    val dirValues = mutableMapOf<OverlayDir, String?>()
    for (dir in OverlayDir.entries) {
        when (val scan = directories[dir] ?: DirScan.Absent) {
            is DirScan.Names -> dirValues[dir] = firstOverlayCodename(
                scan.names.sorted().map { dirRro.find(it)?.groupValues?.get(1) },
            )
            DirScan.Denied -> denied += dir.channel
            DirScan.Absent -> Unit
        }
    }

    // Fixed channel order; the first hit is the verdict, a later disagreement is only
    // recorded. maps wins because it shows what this process actually loaded, while a
    // directory entry can be swapped on its own.
    val channels = listOf("rro" to rro, "idmap" to idmap) +
        OverlayDir.entries.map { it.channel to dirValues[it] }
    val codename = channels.firstOrNull { it.second != null }?.let { (channel, value) -> channel to value!! }

    val conflicts = if (codename == null) emptyList() else channels
        .filter { (channel, value) -> value != null && channel != codename.first && value != codename.second }
        .map { (channel, value) -> "conflict:${codename.first}:${codename.second}!=${channel}:$value" }

    // SoC and SKU names are read from every visible name, but only as side evidence.
    val names = (listOf(text) + dirValues.keys.mapNotNull { dir ->
        (directories[dir] as? DirScan.Names)?.names?.joinToString(" ")
    }).joinToString(" ").split(Regex("[\\s/]+")).filter { it.isNotEmpty() }
    val skuCandidates = names.mapNotNull { skuOverlay.find(it)?.groupValues?.get(1)?.lowercase(Locale.ROOT) }.distinct()
    val socCandidates = names.mapNotNull { socOverlay.find(it)?.groupValues?.get(1)?.lowercase(Locale.ROOT) }.distinct()
    val declared = declaredSku?.trim()?.lowercase(Locale.ROOT)?.takeIf { it.isNotEmpty() }
    // A device carries one SKU overlay per hardware variant it was built for, so a
    // single value needs a tie-break: the declared SKU when it is one of the measured
    // candidates, otherwise every candidate stays listed rather than one being picked.
    val sku = when {
        skuCandidates.isEmpty() -> null
        declared != null && declared in skuCandidates -> declared
        skuCandidates.size == 1 -> skuCandidates.single()
        else -> skuCandidates.sorted().joinToString(",")
    }
    val soc = socCandidates.sorted().joinToString(",").ifEmpty { null }

    val parts = mutableListOf<String>()
    if (rro != null) parts += "rro:$rro"
    if (idmap != null) parts += "idmap:$idmap"
    for (dir in OverlayDir.entries) {
        when {
            dirValues.containsKey(dir) -> parts += "${dir.channel}:${dirValues[dir] ?: "unknown"}"
            dir.channel in denied -> parts += "${dir.channel}:denied"
        }
    }
    if (sku != null) parts += "sku:$sku"
    if (soc != null) parts += "soc:$soc"
    parts += conflicts

    return OverlayReading(
        codename = codename?.second,
        evidence = parts.joinToString(" / ").take(overlayEvidenceMaxChars).ifEmpty { null },
        conflicts = conflicts,
        denied = denied,
        available = codename != null,
    )
}

// Kept for the callers that only have `maps`. It runs levels A and B, which is exactly
// the old single-pattern behaviour plus the blocklist; the capture path uses the full
// five-level reading below.
internal fun overlayDeviceCodename(maps: String?): String? =
    if (maps == null) null else overlayReading(maps).codename

// SafeReader.listNames stats the path first, so a denied directory comes back RESTRICTED
// while a missing one comes back UNAVAILABLE. Keeping the two apart matters: "cannot
// read" must not be reported as "nothing there".
private fun scanOverlayDir(dir: OverlayDir): DirScan {
    val listing = SafeReader.listNames(dir.path, overlayDirMaxEntries)
    if (listing.value != null) return DirScan.Names(listing.value)
    return if (listing.status == ValueStatus.RESTRICTED) DirScan.Denied else DirScan.Absent
}

private fun overlayDirScans(): Map<OverlayDir, DirScan> =
    OverlayDir.entries.associateWith(::scanOverlayDir)

private const val overlayEvidenceSource = "/proc/self/maps + /vendor|product|system_ext|odm/overlay"

private fun overlayCodenameReading(maps: ReadResult<String>, overlay: OverlayReading): ReadResult<String> = when {
    overlay.codename == null -> if (maps.value == null) maps else ReadResult(null, ValueStatus.UNAVAILABLE,
        maps.source, "maps 与四个 overlay 目录里都没有 AOSP 命名的 RRO 产品名。", ReadReason.NOT_REPORTED)
    maps.value == null -> ReadResult(overlay.codename, ValueStatus.AVAILABLE, overlayEvidenceSource)
    else -> maps.copy(value = overlay.codename)
}

private fun overlayEvidenceReading(overlay: OverlayReading): ReadResult<String> = when {
    overlay.available -> ReadResult(overlay.evidence, ValueStatus.AVAILABLE, overlayEvidenceSource)
    // "Could not read" is not "not there": an incomplete evidence trail must not be
    // reported as a clean image.
    overlay.denied.isNotEmpty() -> ReadResult(null, ValueStatus.RESTRICTED, overlayEvidenceSource,
        "部分通道被拒绝读取（${overlay.denied.joinToString("、")}），证据不完整，不能据此断言没有 overlay 记录。",
        ReadReason.ACCESS_DENIED)
    else -> ReadResult(null, ValueStatus.UNAVAILABLE, overlayEvidenceSource,
        "maps 与四个 overlay 目录都没有 AOSP 命名的 RRO 记录。", ReadReason.NOT_REPORTED)
}

// Field set 17 additions. Every item is an observation of this app process and
// carries its own status; one failed read never removes the others.
internal fun SectionBuilder.securityEnvironment(context: Context) {
    // One read of this process's maps serves both the injection scan and the overlay
    // product name; the node is large and must not be read twice per capture.
    val maps = SafeReader.node(SafeReader.Node.PROCESS_MAPS)
    observation("hookSignals", "Hook / 注入映射线索",
        maps.map(::hookSignals)
            .withNote("只扫描本应用进程 /proc/self/maps 的路径段，并排除 ART/JIT、图形栈等运行时创建的 memfd；" +
                "只代表本进程映射，不等于设备被注入。"))
    // Field set 23: the image's own build artifact, independent of every property.
    // Field set 25: the same reading also reports which of several redundant paths
    // answered. Both observations reuse this one maps read and this one directory
    // scan; the node is large and must never be read twice per capture.
    val overlay = overlayReading(maps.value, overlayDirScans(),
        SafeReader.property("ro.boot.hardware.sku").value)
    observation("overlayDeviceCodename", "系统 overlay 记录的产品代号",
        overlayCodenameReading(maps, overlay)
            .withNote("取自已映射的 framework RRO overlay 文件名（AOSP 按镜像构建的产品名生成），是构建产物而不是属性声明。" +
                "与 system.device 不一致时先核对改机工具、移植 ROM 或虚拟化环境；它同样不能单独证明硬件。"))
    // The directory scan is redundancy for the case where a module renames the
    // framework overlay only; it is not a new identity verdict.
    observation("overlayEvidence", "系统 overlay 多路径证据",
        overlayEvidenceReading(overlay)
            .withNote("依次尝试 maps 中的 framework RRO、其它 RRO idmap、vendor/product/system_ext/odm overlay 目录；" +
                "任一路径命中即给出代号，冲突时以 maps 为准。sku/soc 只作旁证，不参与代号。"))
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
