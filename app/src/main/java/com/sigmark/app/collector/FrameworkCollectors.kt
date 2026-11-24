package com.sigmark.app.collector

import android.app.KeyguardManager
import android.app.admin.DevicePolicyManager
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageInfo
import android.content.pm.PackageManager as PM
import android.content.res.Resources
import android.graphics.ImageFormat
import android.hardware.biometrics.BiometricManager
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.media.AudioManager
import android.media.MediaCodecList
import android.os.Build
import android.os.Debug
import android.provider.Settings
import com.sigmark.app.model.normalizeValue
import com.sigmark.app.model.ReadReason
import com.sigmark.app.model.ValueStatus
import java.security.MessageDigest
import java.time.Instant
import java.time.ZoneId
import java.util.Locale

internal fun yesNo(value: Boolean) = if (value) "是" else "否"

internal fun buildVariantSummary(type: String?, tags: String?): String? {
    val variant = normalizeValue(type)?.lowercase(Locale.ROOT) ?: return null
    val label = when (variant) {
        "userdebug", "eng" -> "标准调试构建类型"
        "user" -> "标准量产构建类型"
        else -> "自定义构建类型"
    }
    return listOfNotNull(variant, normalizeValue(tags)).joinToString(" / ") + "（$label）"
}

internal fun usagePercent(total: Long, available: Long): String? =
    if (total > 0 && available in 0..total) String.format(Locale.ROOT, "%.1f%%", (total - available) * 100.0 / total)
    else null

internal fun ByteArray.sha256Hex(): String = MessageDigest.getInstance("SHA-256").digest(this)
    .joinToString("") { "%02x".format(Locale.ROOT, it.toInt() and 0xff) }

// Versioned, low-entropy configuration digest. Keep mutable state and identifiers out.
internal fun configurationDigest(fields: List<String?>, abis: List<String>): String? {
    val values = fields.map { normalizeValue(it)?.lowercase(Locale.ROOT).orEmpty() }
    val architectures = abis.mapNotNull { normalizeValue(it)?.lowercase(Locale.ROOT) }.distinct().sorted()
    if (values.none { it.isNotEmpty() } || architectures.isEmpty()) return null
    val canonical = (values + architectures).joinToString(separator = "") { "${it.length}:$it" }
    return "v1:" + canonical.toByteArray(Charsets.UTF_8).sha256Hex()
}

internal object RuntimeCollector : DeviceCollector {
    override val key = "runtime"
    override val title = "系统能力与运行时"
    override fun collect(context: Context) = section(key, title) {
        val pm = context.packageManager
        val features = SafeReader.read("PackageManager.systemAvailableFeatures") { pm.systemAvailableFeatures }
        observation("featureCount", "系统特性数量", features.map { list -> list.count { it.name != null }.toString() })
        observation("featureList", "系统特性列表", features.map { list ->
            list.filter { it.name != null }.sortedBy { it.name }.joinToString("\n") {
                if (it.version > 0) "${it.name} · v${it.version}" else it.name
            }.ifEmpty { "无声明" }
        })
        observation("openGlEs", "声明的 OpenGL ES 版本", features.map { list ->
            list.firstOrNull { it.name == null && it.reqGlEsVersion > 0 }?.glEsVersion
        })
        observation("externalInputTypes", "外接输入设备类型", externalInputTypes())
        value("declaredInput", "系统声明的输入能力", "PackageManager.hasSystemFeature",
            "触屏、多点触控及手柄声明，和当前连接的外设不是一回事。") { declaredInput(pm) }
        observation("vulkanVersion", "声明的 Vulkan 版本", features.map { list ->
            list.firstOrNull { it.name == PM.FEATURE_VULKAN_HARDWARE_VERSION }?.let { vulkanVersion(it.version) }
        }.let { it.copy(detail = it.detail ?: "系统公开的规范版本，未运行图形驱动探针。") })
        value("sharedLibraries", "系统共享库", "PackageManager.systemSharedLibraryNames",
            "系统向应用公开的共享库名称。") {
            pm.systemSharedLibraryNames?.distinct()?.sorted()?.joinToString("\n")?.ifEmpty { "无公开共享库" }
        }
        value("locale", "应用当前区域", "Locale.getDefault") { Locale.getDefault().toLanguageTag() }
        value("systemLocales", "系统首选语言", "Resources.getSystem().configuration.locales") {
            Resources.getSystem().configuration.locales.toLanguageTags()
        }
        value("timeZone", "时区与当前偏移", "ZoneId.systemDefault", "UTC 偏移按采集时刻计算，随夏令时变化。") {
            val zone = ZoneId.systemDefault()
            "${zone.id} · UTC${zone.rules.getOffset(Instant.now()).id.replace("Z", "+00:00")}"
        }
        value("virtualMachine", "虚拟机名称与版本", "System.getProperty(java.vm.name / java.vm.version)") {
            listOfNotNull(System.getProperty("java.vm.name"), System.getProperty("java.vm.version")).joinToString(" · ")
        }
        val vm = Runtime.getRuntime()
        value("heapMax", "应用堆上限", "Runtime.maxMemory") { mib(vm.maxMemory()) }
        value("heapAllocated", "应用堆已分配", "Runtime.totalMemory") { mib(vm.totalMemory()) }
        value("heapFree", "已分配堆内空闲", "Runtime.freeMemory") { mib(vm.freeMemory()) }
        if (Build.VERSION.SDK_INT >= 28) value("standbyBucket", "应用待机分组", "UsageStatsManager.appStandbyBucket",
            "当前应用的分组，无需查询其他应用的使用记录。") {
            context.getSystemService(UsageStatsManager::class.java)?.appStandbyBucket?.let {
                when (it) {
                    5 -> "豁免"; 10 -> "活跃"; 20 -> "工作集"; 30 -> "常用"; 40 -> "很少使用"
                    45 -> "受限"; 50 -> "从未使用"; else -> "系统分组 $it"
                }
            }
        }
        if (Build.VERSION.SDK_INT >= 28) value("backgroundRestricted", "应用后台活动受限",
            "ActivityManager.isBackgroundRestricted") {
            context.getSystemService(android.app.ActivityManager::class.java)?.isBackgroundRestricted?.let(::yesNo)
        }
    }
}

private fun mib(value: Long) = String.format(Locale.ROOT, "%.1f MiB", value / 1048576.0)

internal object MediaCollector : DeviceCollector {
    override val key = "media"
    override val title = "相机、音频与外设"
    override fun collect(context: Context) = section(key, title) {
        val pm = context.packageManager
        val cameras = context.getSystemService(CameraManager::class.java)
        val ids = SafeReader.read("CameraManager.cameraIdList") { cameras?.cameraIdList }
        observation("cameraCount", "应用可见摄像头数", ids.map { it.size.toString() }.let {
            it.copy(detail = it.detail ?: "数量按 Android 暴露的逻辑摄像头统计。")
        })
        val characteristics = ids.value?.map { id ->
            SafeReader.read("CameraManager.getCameraCharacteristics") { cameras?.getCameraCharacteristics(id) }
        }
        characteristics?.forEachIndexed { index, reading ->
            observation("camera_$index", "摄像头 ${index + 1}", reading.map { info ->
                val flash = info[CameraCharacteristics.FLASH_INFO_AVAILABLE]?.let {
                    if (it) "有闪光灯" else "无闪光灯"
                }
                val size = info[CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP]
                    ?.getOutputSizes(ImageFormat.JPEG)?.maxByOrNull { it.width.toLong() * it.height }
                    ?.let { "JPEG ${it.width}×${it.height} px" }
                listOfNotNull(cameraFacing(info), flash, size).joinToString(" · ")
            }.let { it.copy(detail = it.detail ?: "只读取静态特性，分辨率为公开 JPEG 输出上限。") })
        }
        val cameraSummary: ReadResult<String> = when {
            characteristics == null -> ids.map { null }
            characteristics.isNotEmpty() && characteristics.none { it.value != null } ->
                (characteristics.firstOrNull { it.status == ValueStatus.RESTRICTED } ?: characteristics.first()).map { null }
            else -> SafeReader.read("CameraManager.getCameraCharacteristics / Camera2",
                "按镜头朝向与硬件等级分组，单位为应用可见逻辑摄像头数。") {
                cameraCapabilitySummary(characteristics.map { reading ->
                    reading.value?.let { cameraFacing(it) to cameraLevel(it) }
                })
            }
        }
        observation("cameraCapabilitySummary", "Camera2 镜头能力", cameraSummary)
        val cameraModes: ReadResult<String> = when {
            characteristics == null -> ids.map { null }
            characteristics.isNotEmpty() && characteristics.none { it.value != null } ->
                (characteristics.firstOrNull { it.status == ValueStatus.RESTRICTED } ?: characteristics.first()).map { null }
            else -> SafeReader.read("CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES",
                "汇总应用已读到的摄像头声明，不拍照；无权限的摄像头能力未计入。") {
                val readers = characteristics.mapNotNull { it.value }
                val readable = readers.mapNotNull { it[CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES] }
                if (readers.isNotEmpty() && readable.isEmpty()) null else {
                    val reported = readable.flatMap { it.toList() }.toSet()
                    codeList("raw" to (CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES_RAW in reported),
                        "depth" to (CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES_DEPTH_OUTPUT in reported),
                        "logical_multi_camera" to (CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES_LOGICAL_MULTI_CAMERA in reported),
                        "high_speed_video" to (CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES_CONSTRAINED_HIGH_SPEED_VIDEO in reported))
                }
            }
        }
        observation("cameraModes", "Camera2 高级能力", cameraModes)
        value("bluetoothCapabilities", "蓝牙能力", "PackageManager.hasSystemFeature") {
            "经典蓝牙 ${yesNo(pm.hasSystemFeature(PM.FEATURE_BLUETOOTH))} · BLE ${yesNo(pm.hasSystemFeature(PM.FEATURE_BLUETOOTH_LE))}"
        }
        value("audioCapabilities", "音频能力", "PackageManager.hasSystemFeature") {
            "低延迟 ${yesNo(pm.hasSystemFeature(PM.FEATURE_AUDIO_LOW_LATENCY))} · 专业音频 ${yesNo(pm.hasSystemFeature(PM.FEATURE_AUDIO_PRO))}"
        }
        val audio = context.getSystemService(AudioManager::class.java)
        value("audioSampleRate", "输出采样率", "AudioManager.PROPERTY_OUTPUT_SAMPLE_RATE") {
            audio?.getProperty(AudioManager.PROPERTY_OUTPUT_SAMPLE_RATE)?.toIntOrNull()?.takeIf { it > 0 }?.let { "$it Hz" }
        }
        value("audioBuffer", "输出缓冲帧数", "AudioManager.PROPERTY_OUTPUT_FRAMES_PER_BUFFER") {
            audio?.getProperty(AudioManager.PROPERTY_OUTPUT_FRAMES_PER_BUFFER)?.toIntOrNull()?.takeIf { it > 0 }?.let { "$it 帧" }
        }
        value("codecs", "常见媒体编解码", "MediaCodecList(REGULAR_CODECS)",
            "仅表示框架声明的常规编解码器。容器、分辨率、DRM 和实际播放另行验证。") {
            val codecs = MediaCodecList(MediaCodecList.REGULAR_CODECS).codecInfos
            val encoders = codecs.filter { it.isEncoder }.flatMap { it.supportedTypes.asList() }.toSet()
            val decoders = codecs.filterNot { it.isEncoder }.flatMap { it.supportedTypes.asList() }.toSet()
            listOf("H.264" to "video/avc", "HEVC" to "video/hevc", "AV1" to "video/av01",
                "VP9" to "video/x-vnd.on2.vp9", "AAC" to "audio/mp4a-latm", "FLAC" to "audio/flac", "Opus" to "audio/opus")
                .joinToString("\n") { (label, mime) -> "$label · 解码 ${yesNo(mime in decoders)} · 编码 ${yesNo(mime in encoders)}" }
        }
    }
}

private fun cameraFacing(info: CameraCharacteristics) = when (info[CameraCharacteristics.LENS_FACING]) {
    CameraCharacteristics.LENS_FACING_FRONT -> "前置"
    CameraCharacteristics.LENS_FACING_BACK -> "后置"
    CameraCharacteristics.LENS_FACING_EXTERNAL -> "外接"
    else -> "方向未回报"
}

private fun cameraLevel(info: CameraCharacteristics) = when (info[CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL]) {
    CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL_LEGACY -> "LEGACY"
    CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL_LIMITED -> "LIMITED"
    CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL_FULL -> "FULL"
    CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL_3 -> "LEVEL_3"
    CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL_EXTERNAL -> "EXTERNAL"
    else -> "等级未回报"
}

internal object EnvironmentCollector : DeviceCollector {
    override val key = "environment"
    override val title = "安全与环境线索"
    override fun collect(context: Context) = section(key, title) {
        val domain = SafeReader.node(SafeReader.Node.SELF_CONTEXT).map(SelinuxProbe::processDomain)
        observation("selinuxDomain", "SELinux 应用进程域", domain.let {
            it.copy(detail = listOfNotNull(it.detail, "仅提取类型字段。全局模式需由 enforce 节点确认。").joinToString(" "))
        })
        value("configurationDigest", "本地设备配置摘要", "Build.BRAND / MODEL / DEVICE / PRODUCT / BOARD / HARDWARE / SUPPORTED_ABIS",
            "同配置可能有相同摘要。ROM 改写字段可改变摘要。用于本地对照，随本地 JSON 导出。") {
            configurationDigest(listOf(Build.BRAND, Build.MODEL, Build.DEVICE, Build.PRODUCT, Build.BOARD, Build.HARDWARE),
                Build.SUPPORTED_ABIS.toList())
        }
        value("buildSignals", "ROM 构建线索", "Build.TYPE / Build.TAGS", "构建类型和密钥标签只能说明 ROM 构建线索。") {
            listOfNotNull(normalizeValue(Build.TYPE), normalizeValue(Build.TAGS)).joinToString(" · ")
        }
        value("virtualDeviceHints", "虚拟设备标记", "Build.HARDWARE / PRODUCT / DEVICE",
            "仅匹配常见模拟器标记。自定义 ROM 可使用相同名称，结果仅供排查。") {
            val candidates = listOf("HARDWARE" to Build.HARDWARE, "PRODUCT" to Build.PRODUCT, "DEVICE" to Build.DEVICE)
                .mapNotNull { (key, field) -> normalizeValue(field)?.let { key to it } }
            if (candidates.isEmpty()) return@value null
            val matches = candidates.filter { (_, field) ->
                val value = field.lowercase(Locale.ROOT)
                value in setOf("goldfish", "ranchu", "vbox86", "emulator") || value.startsWith("sdk_gphone")
            }
            matches.joinToString(" · ") { (key, field) -> "$key=$field" }.ifEmpty { "未见常见标记" }
        }
        value("systemDebuggable", "系统调试构建线索", "Build.TYPE / Build.TAGS",
            "应用视角的公开构建信息，仅用于识别构建类型；不代表 ro.debuggable、USB 调试或当前 APK 的调试状态。") {
            buildVariantSummary(Build.TYPE, Build.TAGS)
        }
        val bootHint = "启动属性可作为刷机或调试线索。属性缺失和系统改写均可能发生。"
        listOf(
            Triple("verifiedBoot", "Verified Boot 颜色线索", SafeReader.Property.VERIFIED_BOOT),
            Triple("vbmetaState", "VBMeta 设备状态线索", SafeReader.Property.VBMETA_STATE),
            Triple("flashLock", "Bootloader 锁定线索", SafeReader.Property.FLASH_LOCKED),
        ).forEach { (key, label, property) ->
            observation(key, label, SafeReader.property(property)
                .explainMissing(ReadReason.OPTIONAL_UNSET, "该启动属性未向当前应用提供。")
                .let { it.copy(detail = listOfNotNull(it.detail, bootHint).joinToString(" ")) })
        }
        observation("suFileHint", "可见的 su 路径", SafeReader.suFileHint())
        value("adbSetting", "USB 调试公开设置值", "Settings.Global.ADB_ENABLED", "Android 可能向普通应用固定返回关闭。") {
            settingFlag(context, Settings.Global.ADB_ENABLED)
        }
        value("developerSetting", "开发者选项公开设置值", "Settings.Global.DEVELOPMENT_SETTINGS_ENABLED",
            "系统可能过滤普通应用的读数。") {
            settingFlag(context, Settings.Global.DEVELOPMENT_SETTINGS_ENABLED)
        }
        value("keyguardSecure", "已配置锁屏凭证", "KeyguardManager.isDeviceSecure") {
            context.getSystemService(KeyguardManager::class.java)?.isDeviceSecure?.let(::yesNo)
        }
        val policyEncryption = SafeReader.read("DevicePolicyManager.getStorageEncryptionStatus") {
            when (context.getSystemService(DevicePolicyManager::class.java)?.storageEncryptionStatus) {
                DevicePolicyManager.ENCRYPTION_STATUS_UNSUPPORTED -> "系统报告不支持"
                DevicePolicyManager.ENCRYPTION_STATUS_INACTIVE -> "系统报告未启用"
                DevicePolicyManager.ENCRYPTION_STATUS_ACTIVATING -> "启用中"
                DevicePolicyManager.ENCRYPTION_STATUS_ACTIVE -> "已启用"
                DevicePolicyManager.ENCRYPTION_STATUS_ACTIVE_DEFAULT_KEY -> "已启用（默认密钥）"
                DevicePolicyManager.ENCRYPTION_STATUS_ACTIVE_PER_USER -> "已启用（按用户加密）"
                else -> null
            }
        }
        val cryptoState = {
            val reading = SafeReader.property(SafeReader.Property.CRYPTO_STATE)
            when (val mark = reading.value?.trim()?.lowercase(Locale.ROOT)) {
                "encrypted" -> reading.copy(value = "已启用（系统属性声明）",
                    detail = "DevicePolicyManager 未返回状态，回退读取 ro.crypto.state=encrypted；这是系统属性声明，不是系统接口读数。")
                "unencrypted" -> reading.copy(value = "系统报告未启用",
                    detail = "DevicePolicyManager 未返回状态，回退读取 ro.crypto.state=unencrypted；这是系统属性声明。")
                null -> reading
                else -> SafeReader.missing(reading.source, ReadReason.INVALID_VALUE, "ro.crypto.state 不是已知标记：${mark.take(24)}。")
            }
        }
        observation("storageEncryption", "存储加密状态",
            SafeReader.firstAvailable({ policyEncryption }, cryptoState))
        if (Build.VERSION.SDK_INT >= 30) value("strongBiometrics", "强生物识别可用性",
            "BiometricManager.canAuthenticate(BIOMETRIC_STRONG)") {
            when (val result = context.getSystemService(BiometricManager::class.java)
                ?.canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG)) {
                null -> null
                BiometricManager.BIOMETRIC_SUCCESS -> "已录入且可用"
                BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED -> "未录入"
                BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE -> "未公开可用的强生物识别硬件"
                BiometricManager.BIOMETRIC_ERROR_HW_UNAVAILABLE -> "硬件暂不可用"
                BiometricManager.BIOMETRIC_ERROR_SECURITY_UPDATE_REQUIRED -> "需要安全更新"
                else -> "系统返回状态 $result"
            }
        }
        securityEnvironment(context)
    }

    private fun settingFlag(context: Context, setting: String): String? =
        when (Settings.Global.getInt(context.contentResolver, setting, -1)) {
            0 -> "关闭"; 1 -> "开启"; else -> null
        }
}

@Suppress("DEPRECATION") // Legacy package/signature API branches for Android 8.
internal object AppCollector : DeviceCollector {
    override val key = "app"
    override val title = "应用与权限"
    override fun collect(context: Context) = section(key, title) {
        val pm = context.packageManager
        val name = context.packageName
        val app = SafeReader.read("PackageManager.getPackageInfo(GET_PERMISSIONS)") {
            pm.getPackageInfo(name, PM.GET_PERMISSIONS)
        }
        value("package", "应用包名", "Context.packageName") { name }
        value("channel", "采集器渠道", "BuildConfig.BUILD_TYPE") {
            if (com.sigmark.app.BuildConfig.BUILD_TYPE == "debug") "lan-debug" else "release"
        }
        value("visibleLauncherApps", "可见的桌面应用数", "PackageManager.queryIntentActivities(MAIN / LAUNCHER)",
            "按当前资料和包可见性去重计数，不是全设备安装总量。不保留其他应用名称或包名。") {
            pm.queryIntentActivities(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER), 0)
                .mapNotNull { it.activityInfo?.packageName }.toSet().size.toString()
        }
        observation("version", "应用版本", app.map {
            val code = if (Build.VERSION.SDK_INT >= 28) it.longVersionCode else it.versionCode.toLong()
            "${it.versionName} ($code)"
        })
        observation("installedAt", "首次安装时间", app.map { Instant.ofEpochMilli(it.firstInstallTime).toString() })
        observation("updatedAt", "最近更新时间", app.map { Instant.ofEpochMilli(it.lastUpdateTime).toString() })
        value("installer", "安装来源", "PackageManager.getInstallSourceInfo / getInstallerPackageName",
            "供本地核对，侧载或安装器不可见时可能留空。") {
            if (Build.VERSION.SDK_INT >= 30) pm.getInstallSourceInfo(name).installingPackageName
            else pm.getInstallerPackageName(name)
        }
        value("certSha256", "当前签名证书 SHA-256", "PackageManager.SigningInfo",
            "显示当前 APK 的证书摘要，可与预期签名对照。") {
            val signatures = if (Build.VERSION.SDK_INT >= 28)
                pm.getPackageInfo(name, PM.GET_SIGNING_CERTIFICATES).signingInfo?.apkContentsSigners
            else pm.getPackageInfo(name, PM.GET_SIGNATURES).signatures
            signatures?.joinToString("\n") { it.toByteArray().sha256Hex() }
        }
        value("appDebuggable", "当前 APK 可调试", "ApplicationInfo.FLAG_DEBUGGABLE") {
            yesNo(context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0)
        }
        value("debuggerConnected", "当前进程已连接调试器", "Debug.isDebuggerConnected") {
            yesNo(Debug.isDebuggerConnected())
        }
        observation("permissions", "已声明权限及授权状态", app.map { info ->
            permissionRows(pm, info).joinToString("\n").ifEmpty { "无声明权限" }
        })
    }
}

internal fun permissionRows(pm: PM, info: PackageInfo): List<String> =
    info.requestedPermissions.orEmpty().distinct().sorted().map {
        "$it · ${if (pm.checkPermission(it, info.packageName) == PM.PERMISSION_GRANTED) "已授予" else "未授予"}"
    }
