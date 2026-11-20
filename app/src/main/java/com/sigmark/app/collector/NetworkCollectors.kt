package com.sigmark.app.collector

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.location.LocationManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities as Caps
import android.net.wifi.ScanResult
import android.net.wifi.WifiInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.os.SystemClock
import android.provider.Settings
import android.telephony.CellInfo
import android.telephony.CellInfoGsm
import android.telephony.CellInfoLte
import android.telephony.CellInfoNr
import android.telephony.CellInfoTdscdma
import android.telephony.CellInfoWcdma
import android.telephony.CellSignalStrengthLte
import android.telephony.CellSignalStrengthNr
import android.telephony.SubscriptionManager
import android.telephony.TelephonyManager as Phone
import com.sigmark.app.model.DeviceInfoItem
import com.sigmark.app.model.DeviceSection
import com.sigmark.app.model.ReadReason
import com.sigmark.app.model.ValueStatus
import com.sigmark.app.model.normalizeValue
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.coroutines.resume

private class NetworkFields {
    val items = mutableListOf<DeviceInfoItem>()

    fun read(key: String, label: String, source: String, note: String? = null, value: () -> String?) {
        val result = SafeReader.read(source, note) { normalizeValue(value()) }
        items += (if (result.reason == ReadReason.NOT_REPORTED && note != null && result.detail == note)
            result.copy(detail = "系统未返回有效值。 $note") else result).item(key, label)
    }

    fun missing(key: String, label: String, source: String, reason: ReadReason, note: String) {
        val status = when (reason) {
            ReadReason.PERMISSION_REQUIRED, ReadReason.LOCATION_DISABLED, ReadReason.ACCESS_DENIED -> ValueStatus.RESTRICTED
            ReadReason.NOT_REPORTED, ReadReason.NODE_MISSING, ReadReason.INVALID_VALUE -> ValueStatus.UNAVAILABLE
            ReadReason.READ_FAILED -> ValueStatus.ERROR
        }
        items += DeviceInfoItem(key, label, null, source, status, note, reason)
    }
}

internal object NetworkCollector : DeviceCollector {
    override val key = "network"
    override val title = "网络与 Wi-Fi"

    override fun collect(context: Context): DeviceSection {
        val fields = NetworkFields()
        val cm = context.getSystemService(ConnectivityManager::class.java)
        val active = cm?.activeNetwork
        val caps = active?.let { cm.getNetworkCapabilities(it) }
        val source = "ConnectivityManager.NetworkCapabilities"
        fields.read("transport", "当前默认网络", source, "默认路由可能是 VPN，不等于蜂窝注册状态。") {
            when {
                cm == null -> null
                active == null -> "无默认网络"
                caps == null -> null
                else -> buildList {
                    if (caps.hasTransport(Caps.TRANSPORT_WIFI)) add("Wi-Fi")
                    if (caps.hasTransport(Caps.TRANSPORT_CELLULAR)) add("蜂窝网络")
                    if (caps.hasTransport(Caps.TRANSPORT_ETHERNET)) add("以太网")
                    if (caps.hasTransport(Caps.TRANSPORT_VPN)) add("VPN")
                    if (caps.hasTransport(Caps.TRANSPORT_BLUETOOTH)) add("蓝牙")
                }.ifEmpty { listOf("其他网络") }.joinToString(" + ")
            }
        }
        if (caps != null) with(fields) {
            read("internetValidation", "互联网验证", "$source.VALIDATED", "Android 的验证结果；SigMark 不主动发起连接。") {
                if (caps.hasCapability(Caps.NET_CAPABILITY_VALIDATED)) "系统已验证" else "系统未验证"
            }
            read("metered", "计费属性", "$source.NOT_METERED") {
                if (caps.hasCapability(Caps.NET_CAPABILITY_NOT_METERED)) "不计量" else "按计量网络处理"
            }
            if (caps.hasTransport(Caps.TRANSPORT_WIFI)) addWifi(context, caps)
            read("captivePortal", "登录门户", "$source.CAPTIVE_PORTAL") {
                if (caps.hasCapability(Caps.NET_CAPABILITY_CAPTIVE_PORTAL)) "系统检测到登录门户" else "系统未标记登录门户"
            }
            read("bandwidthEstimate", "系统带宽估算", "$source.linkDownstream/UpstreamBandwidthKbps", "不是测速结果。") {
                listOfNotNull(caps.linkDownstreamBandwidthKbps.takeIf { it > 0 }?.let { "下行 $it kbps" },
                    caps.linkUpstreamBandwidthKbps.takeIf { it > 0 }?.let { "上行 $it kbps" })
                    .takeIf { it.isNotEmpty() }?.joinToString(" / ")
            }
        }
        if (active != null) with(fields) {
            val link = SafeReader.read("ConnectivityManager.getLinkProperties") { cm.getLinkProperties(active) }
            val properties = link.value
            if (properties == null) {
                items += DeviceInfoItem("linkDetails", "默认网络链路属性", null,
                    link.source, link.status, link.detail, link.reason, link.errno)
            } else {
                read("defaultRouteFamilies", "默认路由地址族", "LinkProperties.routes",
                    "仅显示默认网络公布的 IPv4 / IPv6 路由类型，不记录 IP 或网关。") {
                    val defaults = properties.routes.filter { it.isDefaultRoute }
                    buildList {
                        if (defaults.any { it.destination.address is java.net.Inet4Address }) add("IPv4")
                        if (defaults.any { it.destination.address is java.net.Inet6Address }) add("IPv6")
                    }.joinToString(" / ").ifEmpty { null }
                }
                if (Build.VERSION.SDK_INT >= 28) read(
                    "privateDnsActive", "专用 DNS 状态", "LinkProperties.isPrivateDnsActive",
                    "当前默认网络的系统状态，不记录 DNS 服务器地址或主机名。"
                ) { if (properties.isPrivateDnsActive) "已启用" else "未启用" }
                if (Build.VERSION.SDK_INT >= 29) read("linkMtu", "链路 MTU", "LinkProperties.mtu",
                    "单位为字节。系统未报告显式值时留空，不推定为 1500。") {
                    properties.mtu.takeIf { it > 0 }?.let { "$it 字节" }
                }
            }
        }
        return DeviceSection(key, title, fields.items)
    }

    @Suppress("DEPRECATION")
    private fun NetworkFields.addWifi(context: Context, caps: Caps) {
        val source = if (Build.VERSION.SDK_INT >= 31) "NetworkCapabilities.transportInfo → WifiInfo"
            else "WifiManager.connectionInfo → WifiInfo"
        val wifi: WifiInfo? = try {
            if (Build.VERSION.SDK_INT >= 31) caps.transportInfo as? WifiInfo
            else context.getSystemService(WifiManager::class.java)?.connectionInfo
        } catch (_: SecurityException) {
            missing("wifiDetails", "Wi-Fi 链路详情", source, ReadReason.ACCESS_DENIED, "系统拒绝读取 Wi-Fi 链路属性。")
            return
        }
        if (wifi == null) {
            missing("wifiDetails", "Wi-Fi 链路详情", source, ReadReason.NOT_REPORTED, "系统未公开该默认网络的 Wi-Fi 属性；VPN 下尤其可能如此。")
            return
        }
        read("wifiFrequency", "Wi-Fi 主链路频率", "$source.frequency", "多链路连接仅展示系统在当前快照返回的链路。") {
            wifi.frequency.takeIf { it > 0 }?.let { "$it MHz" }
        }
        read("wifiBandChannel", "Wi-Fi 频段 / 信道", "$source.frequency", "由频率换算，表示主信道，不是信道宽度。") {
            RadioMath.wifi(wifi.frequency)?.let { result ->
                result.channel?.let { "${result.band} / 信道 $it" } ?: result.band
            }
        }
        read("wifiRssi", "Wi-Fi 信号 RSSI", "$source.rssi") {
            wifi.rssi.takeIf { it in -126..0 }?.let { "$it dBm" }
        }
        read("wifiLinkSpeed", "Wi-Fi 协商速率", "$source.linkSpeed", "链路协商值，不代表互联网吞吐量。") {
            val rates = if (Build.VERSION.SDK_INT >= 29) listOfNotNull(
                wifi.rxLinkSpeedMbps.takeIf { it > 0 }?.let { "接收 $it Mbps" },
                wifi.txLinkSpeedMbps.takeIf { it > 0 }?.let { "发送 $it Mbps" },
            ) else emptyList()
            rates.takeIf { it.isNotEmpty() }?.joinToString(" / ")
                ?: wifi.linkSpeed.takeIf { it > 0 }?.let { "$it Mbps" }
        }
        if (Build.VERSION.SDK_INT >= 30) read("wifiStandard", "Wi-Fi 标准", "$source.wifiStandard") {
            when (wifi.wifiStandard) {
                ScanResult.WIFI_STANDARD_LEGACY -> "802.11a/b/g"
                ScanResult.WIFI_STANDARD_11N -> "Wi-Fi 4 (802.11n)"
                ScanResult.WIFI_STANDARD_11AC -> "Wi-Fi 5 (802.11ac)"
                ScanResult.WIFI_STANDARD_11AX -> when (RadioMath.wifi(wifi.frequency)?.band) {
                    "6 GHz" -> "Wi-Fi 6E (802.11ax)"
                    "2.4 GHz", "5 GHz" -> "Wi-Fi 6 (802.11ax)"
                    else -> "802.11ax"
                }
                ScanResult.WIFI_STANDARD_11AD -> "802.11ad"
                ScanResult.WIFI_STANDARD_11BE -> "Wi-Fi 7 (802.11be)"
                else -> null
            }
        }
        if (Build.VERSION.SDK_INT >= 31) read("wifiSecurity", "Wi-Fi 安全类型", "$source.currentSecurityType") {
            when (wifi.currentSecurityType) {
                WifiInfo.SECURITY_TYPE_OPEN -> "开放网络"
                WifiInfo.SECURITY_TYPE_WEP -> "WEP"
                WifiInfo.SECURITY_TYPE_PSK -> "WPA/WPA2-PSK"
                WifiInfo.SECURITY_TYPE_EAP -> "企业级 EAP"
                WifiInfo.SECURITY_TYPE_SAE -> "WPA3-SAE"
                WifiInfo.SECURITY_TYPE_OWE -> "OWE"
                WifiInfo.SECURITY_TYPE_EAP_WPA3_ENTERPRISE -> "WPA3-Enterprise"
                WifiInfo.SECURITY_TYPE_EAP_WPA3_ENTERPRISE_192_BIT -> "WPA3-Enterprise 192-bit"
                WifiInfo.SECURITY_TYPE_UNKNOWN -> null
                else -> "其他（Android 类型 ${wifi.currentSecurityType}）"
            }
        }
    }
}

internal object CellularCollector : DeviceCollector {
    override val key = "cellular"
    override val title = "移动网络"

    override fun collect(context: Context): DeviceSection = collect(context, null)

    internal data class Update(val cells: List<CellInfo>?, val note: String)

    private fun hasFine(context: Context) =
        context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED

    private fun locationEnabled(context: Context) = if (Build.VERSION.SDK_INT >= 28) {
        context.getSystemService(LocationManager::class.java)?.isLocationEnabled == true
    } else {
        @Suppress("DEPRECATION")
        Settings.Secure.getInt(context.contentResolver, Settings.Secure.LOCATION_MODE, 0) != 0
    }

    @SuppressLint("MissingPermission")
    suspend fun requestUpdate(context: Context): Update? {
        if (!hasFine(context) || !locationEnabled(context)) return null
        if (Build.VERSION.SDK_INT < 29) return Update(null, "当前系统版本仅支持读取缓存。")
        val phone = context.getSystemService(Phone::class.java) ?: return null
        return withTimeoutOrNull(2_500) {
            suspendCancellableCoroutine { continuation ->
                val completed = AtomicBoolean()
                fun finish(update: Update) {
                    if (completed.compareAndSet(false, true)) continuation.resume(update)
                }
                val callback = object : Phone.CellInfoCallback() {
                    override fun onCellInfo(info: List<CellInfo>) {
                        finish(if (info.any { it.isRegistered })
                            Update(info, "已收到系统刷新回调；仍可能是缓存。")
                        else Update(null, "刷新未返回已注册小区，已回退读取系统缓存。"))
                    }
                    override fun onError(errorCode: Int, detail: Throwable?) {
                        finish(Update(null, "系统未完成刷新（代码 $errorCode），已回退读取缓存。"))
                    }
                }
                try { phone.requestCellInfoUpdate({ it.run() }, callback) }
                catch (_: RuntimeException) {
                    finish(Update(null, "系统未接受刷新请求，已回退读取缓存。"))
                }
            }
        } ?: Update(null, "等待系统刷新超时，已回退读取缓存。")
    }

    @SuppressLint("MissingPermission") // READ_BASIC_PHONE_STATE is a normal install-time permission on API 33+.
    fun collect(context: Context, update: Update?): DeviceSection {
        val fields = NetworkFields()
        val phone = context.getSystemService(Phone::class.java)
        if (phone == null || !context.packageManager.hasSystemFeature(PackageManager.FEATURE_TELEPHONY)) {
            fields.read("support", "蜂窝能力", "PackageManager.FEATURE_TELEPHONY") { "设备未声明蜂窝能力" }
            return DeviceSection(key, title, fields.items)
        }
        val subId = SubscriptionManager.getDefaultDataSubscriptionId()
        // Never fall back to another SIM's carrier and label it as the default data subscription.
        if (subId < 0 || subId == Int.MAX_VALUE) {
            fields.read("subscription", "数据订阅", "SubscriptionManager.getDefaultDataSubscriptionId()") { "未设置默认数据订阅" }
        } else {
            val data = phone.createForSubscriptionId(subId)
            with(fields) {
                read("operator", "当前注册运营商", "TelephonyManager.networkOperatorName", "默认数据订阅；漫游时可能和 SIM 运营商不同。") { data.networkOperatorName }
                read("plmn", "运营商代码 MCC/MNC", "TelephonyManager.networkOperator") { data.networkOperator.takeIf { it.matches(Regex("[0-9]{5,6}")) } }
                read("simOperator", "SIM 运营商", "TelephonyManager.simOperatorName", "由默认数据订阅的 SIM 上报。") { data.simOperatorName }
                read("dataState", "蜂窝数据状态", "TelephonyManager.dataState", "即使蜂窝已注册，默认上网也可能走 Wi-Fi。") {
                    when (data.dataState) {
                        Phone.DATA_DISCONNECTED -> "未连接"
                        Phone.DATA_CONNECTING -> "连接中"
                        Phone.DATA_CONNECTED -> "已连接"
                        Phone.DATA_SUSPENDED -> "已挂起"
                        Phone.DATA_DISCONNECTING -> "断开中"
                        Phone.DATA_HANDOVER_IN_PROGRESS -> "切换中"
                        else -> null
                    }
                }
                read("mobileDataToggle", "移动数据开关", "TelephonyManager.isDataEnabled", "此开关与当前是否通过蜂窝上网是两回事。") {
                    if (data.isDataEnabled) "开启" else "关闭"
                }
                read("roaming", "漫游状态", "TelephonyManager.isNetworkRoaming") {
                    if (data.networkOperator.isNullOrBlank()) null else if (data.isNetworkRoaming) "漫游中" else "未漫游"
                }
                if (Build.VERSION.SDK_INT >= 33) read("dataRat", "蜂窝数据制式", "TelephonyManager.dataNetworkType", "调制解调器的数据制式；不等于状态栏 5G 图标或 NSA 判断。") { radioType(data.dataNetworkType) }
                if (Build.VERSION.SDK_INT >= 28) read("modemSignalLevel", "调制解调器信号等级", "TelephonyManager.signalStrength.level", "系统综合等级，不是 dBm。") { data.signalStrength?.level?.takeIf { it in 0..4 }?.let { "$it / 4" } }
            }
        }
        addRegisteredCells(context, phone, fields, update)
        return DeviceSection(key, title, fields.items)
    }

    @SuppressLint("MissingPermission") // Checked before accessing getAllCellInfo().
    private fun addRegisteredCells(context: Context, phone: Phone, fields: NetworkFields, update: Update?) {
        val source = if (update?.cells != null) "TelephonyManager.requestCellInfoUpdate" else "TelephonyManager.allCellInfo"
        val label = "小区无线参数"
        if (!hasFine(context)) {
            fields.missing("cellDiagnostics", label, source, ReadReason.PERMISSION_REQUIRED,
                "查看频段、信道号和小区信号需授予精确位置权限，可在本页授权。")
            return
        }
        if (!locationEnabled(context)) {
            fields.missing("cellDiagnostics", label, source, ReadReason.LOCATION_DISABLED,
                "Android 仅在系统位置开关开启时提供该数据。开启后手动刷新。")
            return
        }
        val registered = try {
            (update?.cells ?: phone.allCellInfo.orEmpty()).filter { it.isRegistered }
        } catch (_: SecurityException) {
            fields.missing("cellDiagnostics", label, source, ReadReason.ACCESS_DENIED, "权限已授予，系统仍拒绝该接口。")
            return
        } catch (_: UnsupportedOperationException) {
            fields.missing("cellDiagnostics", label, source, ReadReason.NOT_REPORTED, "设备未实现小区接口。")
            return
        } catch (e: Exception) {
            fields.missing("cellDiagnostics", label, source, ReadReason.READ_FAILED, "读取异常：${e.javaClass.simpleName}")
            return
        }
        if (registered.isEmpty()) {
            fields.missing("cellDiagnostics", label, source, ReadReason.NOT_REPORTED,
                listOfNotNull(update?.note, "系统缓存没有已注册小区；可能无服务或 ROM 未上报。").joinToString(" "))
            return
        }
        // Group by radio technology and keep the newest sample per technology. No subscription or location IDs.
        val samples = registered.groupBy(::cellTechnology).mapValues { (_, cells) -> cells.maxBy(::timestampMs) }
        fields.read("cellDiagnostics", label, source,
            listOfNotNull(update?.note, "设备范围小区数据；每制式显示最新一条，不归属到某张 SIM；NSA 辅小区可能缺失。").joinToString(" ")) {
            samples.keys.joinToString(" / ")
        }
        samples.forEach { (tech, cell) ->
            val prefix = "cell$tech"
            val age = timestampMs(cell).takeIf { it in 1..SystemClock.elapsedRealtime() }
                ?.let { (SystemClock.elapsedRealtime() - it) / 1000 }
            val note = age?.let { "采样距本次读取约 ${it} 秒。" } ?: "系统采样时间未知。"
            when {
                cell is CellInfoLte -> with(fields) {
                    val id = cell.cellIdentity
                    val signal = cell.cellSignalStrength
                    if (Build.VERSION.SDK_INT >= 30) {
                        read("${prefix}Bands", "$tech 频段", "$source.CellIdentityLte.bands", note) { bands(id.bands, "B") }
                        RadioMath.lteBandRanges(id.bands.toList())?.let { range ->
                            read("${prefix}BandRange", "$tech 频段下行范围", "CellIdentityLte.bands → 3GPP TS 36.101",
                                "频段标准范围，不是当前连接的中心频率。") { range }
                        }
                    }
                    read("${prefix}Channel", "$tech 信道号 EARFCN", "$source.CellIdentityLte.earfcn", note) { id.earfcn.validChannel()?.toString() }
                    read("${prefix}Frequency", "$tech 下行参考频率", "EARFCN → 3GPP TS 36.101",
                        if (id.earfcn.validChannel() == null) "缺少系统上报的 EARFCN；频段范围不等于中心频率。"
                        else "仅转换内置常见频段。") { RadioMath.lteDownlinkKhz(id.earfcn)?.let(RadioMath::mhz) }
                    if (Build.VERSION.SDK_INT >= 28) read("${prefix}Bandwidth", "$tech 信道带宽", "$source.CellIdentityLte.bandwidth", note) { id.bandwidth.validChannel()?.takeIf { it > 0 }?.let { "$it kHz" } }
                    read("${prefix}Signal", "$tech 无线信号", "$source.CellSignalStrengthLte", note) { lteSignal(signal) }
                }
                Build.VERSION.SDK_INT >= 29 && cell is CellInfoNr -> with(fields) {
                    val id = cell.cellIdentity as android.telephony.CellIdentityNr
                    if (Build.VERSION.SDK_INT >= 30) read("${prefix}Bands", "$tech 频段", "$source.CellIdentityNr.bands", note) { bands(id.bands, "n") }
                    read("${prefix}Channel", "$tech 信道号 NR-ARFCN", "$source.CellIdentityNr.nrarfcn", note) { id.nrarfcn.validChannel()?.toString() }
                    read("${prefix}Frequency", "$tech 全局栅格参考频率", "NR-ARFCN → 3GPP TS 38.104", "$note；不是实测频谱，也不推断带宽。") { RadioMath.nrKhz(id.nrarfcn)?.let(RadioMath::mhz) }
                    read("${prefix}Signal", "$tech 无线信号", "$source.CellSignalStrengthNr", note) {
                        (cell.cellSignalStrength as? CellSignalStrengthNr)?.let {
                            metrics("SS-RSRP" to unit(it.ssRsrp, "dBm"), "SS-RSRQ" to unit(it.ssRsrq, "dB"), "SS-SINR" to unit(it.ssSinr, "dB"))
                        }
                    }
                }
                else -> with(fields) {
                    val arfcn = when {
                        cell is CellInfoGsm -> cell.cellIdentity.arfcn
                        cell is CellInfoWcdma -> cell.cellIdentity.uarfcn
                        Build.VERSION.SDK_INT >= 29 && cell is CellInfoTdscdma -> cell.cellIdentity.uarfcn
                        else -> null
                    }
                    arfcn?.validChannel()?.let { read("${prefix}Channel", "$tech 信道号", "$source.cellIdentity", note) { it.toString() } }
                    if (Build.VERSION.SDK_INT >= 30) read("${prefix}Signal", "$tech 无线信号", "$source.cellSignalStrength", note) {
                        unit(cell.cellSignalStrength.dbm, "dBm")
                    }
                }
            }
        }
    }
}

@Suppress("DEPRECATION") // Recognize older CDMA reports without assuming modern support.
private fun cellTechnology(cell: CellInfo): String = when {
    cell is CellInfoLte -> "LTE"
    Build.VERSION.SDK_INT >= 29 && cell is CellInfoNr -> "NR"
    cell is CellInfoGsm -> "GSM"
    cell is CellInfoWcdma -> "WCDMA"
    Build.VERSION.SDK_INT >= 29 && cell is CellInfoTdscdma -> "TD-SCDMA"
    cell is android.telephony.CellInfoCdma -> "CDMA"
    else -> "其他"
}

@Suppress("DEPRECATION")
private fun timestampMs(cell: CellInfo): Long = if (Build.VERSION.SDK_INT >= 30) cell.timestampMillis else cell.timeStamp / 1_000_000
private fun bands(bands: IntArray, prefix: String): String? = bands.filter { it > 0 && it != Int.MAX_VALUE }
    .distinct().takeIf { it.isNotEmpty() }?.joinToString(" / ") { "$prefix$it" }
// CellInfo.UNAVAILABLE was named in the public SDK in API 29; older identities use the same sentinel.
private fun Int.validChannel(): Int? = takeIf { it >= 0 && it != Int.MAX_VALUE }
private fun unit(value: Int, name: String): String? = value.takeUnless { it == Int.MAX_VALUE || it == Int.MIN_VALUE }?.let { "$it $name" }
private fun metrics(vararg entries: Pair<String, String?>): String? = entries.mapNotNull { (name, value) -> value?.let { "$name $it" } }
    .takeIf { it.isNotEmpty() }?.joinToString(" / ")
private fun lteSignal(signal: CellSignalStrengthLte): String? = metrics(
    "RSRP" to unit(signal.rsrp, "dBm"), "RSRQ" to unit(signal.rsrq, "dB"), "RSSNR" to unit(signal.rssnr, "dB"),
)

@Suppress("DEPRECATION") // Recognize reports from legacy modems.
private fun radioType(type: Int): String? = when (type) {
    Phone.NETWORK_TYPE_NR -> "NR (5G)"
    Phone.NETWORK_TYPE_LTE -> "LTE (4G)"
    Phone.NETWORK_TYPE_IWLAN -> "IWLAN"
    Phone.NETWORK_TYPE_HSPAP -> "HSPA+"
    Phone.NETWORK_TYPE_HSPA, Phone.NETWORK_TYPE_HSDPA, Phone.NETWORK_TYPE_HSUPA -> "HSPA"
    Phone.NETWORK_TYPE_UMTS -> "UMTS (3G)"
    Phone.NETWORK_TYPE_TD_SCDMA -> "TD-SCDMA (3G)"
    Phone.NETWORK_TYPE_EDGE -> "EDGE"
    Phone.NETWORK_TYPE_GPRS -> "GPRS"
    Phone.NETWORK_TYPE_GSM -> "GSM"
    Phone.NETWORK_TYPE_CDMA, Phone.NETWORK_TYPE_1xRTT -> "CDMA"
    Phone.NETWORK_TYPE_EVDO_0, Phone.NETWORK_TYPE_EVDO_A, Phone.NETWORK_TYPE_EVDO_B, Phone.NETWORK_TYPE_EHRPD -> "EV-DO/eHRPD"
    Phone.NETWORK_TYPE_UNKNOWN -> null
    else -> "Android 制式 $type"
}
