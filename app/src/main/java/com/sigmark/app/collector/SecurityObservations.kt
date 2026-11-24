package com.sigmark.app.collector

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.SecurityStateManager
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyInfo
import android.security.keystore.KeyProperties
import android.security.keystore.StrongBoxUnavailableException
import android.webkit.WebView
import com.sigmark.app.model.DeviceInfoItem
import com.sigmark.app.model.ReadReason
import java.security.KeyStore
import java.time.Instant
import java.util.UUID
import javax.crypto.KeyGenerator
import javax.crypto.SecretKeyFactory

private const val partitionsApi = "Build.getFingerprintedPartitions"
internal fun partitionField(key: String) = Regex("partition_[a-z0-9_]{1,32}").matches(key)
// Android 8/9 has no fingerprinted-partitions API; the same public read-only
// properties still carry the declarations. Only partitions with a value produce a
// row, in the fixed order used by the date list, so the key space stays stable.
internal fun propertyPartitionRows(
    read: (String) -> ReadResult<String>,
): List<Pair<String, ReadResult<String>>> =
    partitionBuildDateOrder.map { name -> name to read("ro.$name.build.fingerprint") }
        .filter { (_, reading) -> reading.value != null }
internal fun patchDate(raw: String?): String? {
    val value = raw?.trim()?.takeIf { it.matches(Regex("[0-9]{4}-[0-9]{2}-[0-9]{2}")) } ?: return null
    return runCatching { java.time.LocalDate.parse(value).toString() }.getOrNull()
}

internal object SecurityObservations {
    @Suppress("DEPRECATION")
    fun system(context: Context): List<DeviceInfoItem> = section("system", "系统") {
        // Android does not expose Build.VERSION.DEVICE_INITIAL_SDK_INT to third-party
        // apps; the public first_api_level property carries the same declaration.
        observation("initialSdk", "设备初始 API 级别",
            SafeReader.property(SafeReader.Property.FIRST_API_LEVEL).map { raw ->
                raw.trim().takeIf { it.matches(Regex("0|[1-9][0-9]?")) }?.toInt()?.takeIf { it in 1..99 }?.toString()
            }.let { reading ->
                reading.copy(detail = listOfNotNull(reading.detail,
                    "出厂时的 API 级别；低于当前 API 属于正常的系统升级，只作世代对照，不据此判定真伪。").joinToString(" "))
            })
        // Boot count is a system accounting value: it grows on every cold boot and
        // resets when data is wiped, so it tracks lifecycle rather than usage time.
        observation("bootCount", "开机次数", SafeReader.read("Settings.Global.BOOT_COUNT") {
            android.provider.Settings.Global.getInt(context.contentResolver,
                android.provider.Settings.Global.BOOT_COUNT, -1).takeIf { it in 0..1_000_000 }?.toString()
        }.let { reading ->
            reading.copy(detail = listOfNotNull(reading.detail,
                "系统设置项；每次冷启动递增，恢复出厂或清数据会重置。它不代表使用时长，也不推断刷机。").joinToString(" "))
        })
        // Media performance class is declared from API 31; 0 means the ROM declares none.
        observation("mediaPerformanceClass", "媒体性能等级", if (Build.VERSION.SDK_INT >= 31)
            SafeReader.read("Build.VERSION.MEDIA_PERFORMANCE_CLASS",
                "Android 媒体性能分级；0 表示 ROM 未声明。它不是跑分。") {
                Build.VERSION.MEDIA_PERFORMANCE_CLASS.takeIf { it in 0..99 }?.toString()
            }
        else SafeReader.missing("Build.VERSION.MEDIA_PERFORMANCE_CLASS", ReadReason.INTERFACE_UNSUPPORTED,
            "该字段需要 API 31。"))
        if (Build.VERSION.SDK_INT >= 29) {
            val parts = SafeReader.read(partitionsApi) { Build.getFingerprintedPartitions() }
            val listed = parts.value.orEmpty().filter { partitionField("partition_" + it.name) }.distinctBy { it.name }.sortedBy { it.name }
            observation("partitionCount", "公开的分区指纹数", parts.map { listed.size.toString() }
                .copy(detail = "仅列出此接口返回的分区；按名排序，最多记录前 24 个。没有单独指纹不表示分区不存在。"))
            listed.take(24).forEach { part ->
                value("partition_" + part.name, part.name + " 分区构建", partitionsApi,
                    "应用视角的分区构建指纹及 UTC 时间，不是分区内容哈希或签名验证。") {
                    com.sigmark.app.model.normalizeValue(part.fingerprint)?.let { fp ->
                        fp + (part.buildTimeMillis.takeIf { it > 0 }?.let { " · " + Instant.ofEpochMilli(it) } ?: "")
                    }
                }
            }
        } else {
            // Android 8/9 has no fingerprinted-partitions API. The same public
            // read-only properties still carry per-partition build fingerprints,
            // so the archived rows keep their key space and only the source differs.
            val propertySource = "getprop ro.<partition>.build.fingerprint"
            val rows = propertyPartitionRows { SafeReader.property(it) }
            observation("partitionCount", "公开的分区指纹数", if (rows.isEmpty())
                SafeReader.missing(propertySource, ReadReason.NOT_REPORTED,
                    "该系统版本没有分区接口，且当前 ROM 未提供分区构建指纹属性。")
            else SafeReader.read(propertySource,
                "API 29 以下通过只读属性读取分区构建指纹；属性缺失的分区不补行。") { rows.size.toString() })
            rows.forEach { (name, reading) ->
                observation("partition_$name", "$name 分区构建", reading.copy(detail = listOfNotNull(reading.detail,
                    "API 29 以下按只读属性读取；与应用视角的 Build 字段不互相覆盖。").joinToString(" ")))
            }
        }
        val provider = SafeReader.read("WebView.getCurrentWebViewPackage", "只查询当前提供程序，不启动网页。") { WebView.getCurrentWebViewPackage() }
        observation("webViewProvider", "WebView 提供程序", provider.map { it.packageName })
        observation("webViewVersion", "WebView 版本", provider.map { it.versionName })
        observation("webViewCode", "WebView 内部版本号", provider.map {
            (if (Build.VERSION.SDK_INT >= 28) it.longVersionCode else it.versionCode.toLong()).toString()
        })
        val securityState = if (Build.VERSION.SDK_INT >= 35) {
            val info = SafeReader.read("SecurityStateManager.getGlobalSecurityState") {
                context.getSystemService(SecurityStateManager::class.java)?.globalSecurityState
            }
            observation("systemSpl", "系统组件声明补丁", info.map { it.getString(SecurityStateManager.KEY_SYSTEM_SPL) })
            info.map { patchDate(it.getString(SecurityStateManager.KEY_VENDOR_SPL)) }
        } else null
        val vendorProperty = {
            val result = SafeReader.property(SafeReader.Property.VENDOR_PATCH)
            if (result.value != null) result.map(::patchDate)
                .explainMissing(ReadReason.INVALID_VALUE, "厂商属性没有返回有效补丁日期。")
            else result
        }
        val vendor = if (securityState == null) vendorProperty() else SafeReader.firstAvailable({ securityState }, vendorProperty)
        observation("vendorSpl", "厂商组件声明补丁", if (vendor.value != null)
            vendor.copy(detail = "当前 App 可见的厂商补丁日期（YYYY-MM-DD），不表示已核验补丁内容。") else vendor)
        val buildDates = partitionBuildDateOrder.mapNotNull { part ->
            SafeReader.property("ro.$part.build.date.utc").value
                ?.let { raw -> epochSecondsUtcDate(raw)?.let { date -> part to date } }
        }.toMap()
        observation("partitionBuildDates", "分区构建日期",
            SafeReader.read("getprop ro.<partition>.build.date.utc",
                "按固定顺序读取 system、vendor、product、odm、system_ext、bootimage 的 UTC 构建时间；" +
                    "属性缺失不代表分区不存在。") { partitionDatesText(buildDates) })
    }.items

    @Suppress("DEPRECATION")
    fun probeKey(context: Context): DeviceInfoItem {
        val source = if (Build.VERSION.SDK_INT >= 31) "AndroidKeyStore / KeyInfo.getSecurityLevel" else "AndroidKeyStore / KeyInfo.isInsideSecureHardware"
        var fallback = false
        val reading = SafeReader.read(source) {
            val alias = "sigmark-probe-" + UUID.randomUUID()
            val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
            fun generate(strong: Boolean): KeyInfo {
                val spec = KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setKeySize(128)
                if (Build.VERSION.SDK_INT >= 28 && strong) spec.setIsStrongBoxBacked(true)
                val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
                gen.init(spec.build())
                return SecretKeyFactory.getInstance("AES", "AndroidKeyStore").getKeySpec(gen.generateKey(), KeyInfo::class.java) as KeyInfo
            }
            try {
                val info = if (Build.VERSION.SDK_INT >= 28 && context.packageManager.hasSystemFeature(PackageManager.FEATURE_STRONGBOX_KEYSTORE))
                    try { generate(true) } catch (_: StrongBoxUnavailableException) { fallback = true; generate(false) }
                    else generate(false)
                if (Build.VERSION.SDK_INT >= 31) when (info.securityLevel) {
                    KeyProperties.SECURITY_LEVEL_SOFTWARE -> "Software"
                    KeyProperties.SECURITY_LEVEL_TRUSTED_ENVIRONMENT -> "TEE"
                    KeyProperties.SECURITY_LEVEL_STRONGBOX -> "StrongBox"
                    KeyProperties.SECURITY_LEVEL_UNKNOWN_SECURE -> "硬件保护（类型未细分）"
                    else -> null
                } else if (info.isInsideSecureHardware) "硬件保护（类型未细分）" else "Software"
            } finally { store.deleteEntry(alias) }
        }
        return reading.copy(detail = listOfNotNull(reading.detail, if (fallback) "StrongBox 暂不可用，已测试默认提供程序。" else null,
            "手动测试于 " + Instant.now() + "；仅针对临时密钥，不是远程硬件证明。").joinToString(" ")).item("keyProtection","临时密钥保护级别")
    }
}
