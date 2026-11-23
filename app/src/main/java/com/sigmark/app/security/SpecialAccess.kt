package com.sigmark.app.security

import android.accessibilityservice.AccessibilityServiceInfo as ASI
import android.app.admin.DevicePolicyManager
import android.content.Context
import android.view.accessibility.AccessibilityManager
import com.sigmark.app.BuildConfig
import com.sigmark.app.collector.SafeReader
import com.sigmark.app.model.ValueStatus

internal data class AccessCounts(val enabled: Int, val readWindow: Int, val gestures: Int, val both: Int)
internal fun accessibilityCounts(flags: List<Int>): AccessCounts {
    fun reads(v: Int) = v and ASI.CAPABILITY_CAN_RETRIEVE_WINDOW_CONTENT != 0
    fun gestures(v: Int) = v and ASI.CAPABILITY_CAN_PERFORM_GESTURES != 0
    return AccessCounts(flags.size,flags.count(::reads),flags.count(::gestures),flags.count { reads(it) && gestures(it) })
}

internal fun specialAccess(context: Context): List<PostureRow> {
    fun <T> probe(id: String, label: String, source: String, read: () -> T?, explain: (T) -> Pair<Finding,String>): PostureRow {
        val result = SafeReader.read(source, block=read)
        val outcome = result.value?.let(explain) ?: (Finding.UNKNOWN to when(result.status) {
            ValueStatus.RESTRICTED -> "系统限制了此项读取。"
            ValueStatus.ERROR -> "这次检查没有完成。"
            else -> "当前环境没有返回此项信息。"
        })
        return PostureRow(id,label,outcome.first,outcome.second,source)
    }
    val accessibility = probe("accessibility","无障碍服务","AccessibilityManager.getEnabledAccessibilityServiceList / AccessibilityServiceInfo.capabilities",{
        context.getSystemService(AccessibilityManager::class.java)?.getEnabledAccessibilityServiceList(ASI.FEEDBACK_ALL_MASK)?.let { services -> accessibilityCounts(services.map { it.capabilities }) }
    }) { c ->
        if(c.enabled==0) Finding.OBSERVED to "当前用户的接口没有列出已启用服务。"
        else (if(c.readWindow>0 || c.gestures>0) Finding.REVIEW else Finding.OBSERVED) to
            "已启用 "+c.enabled+" 项；可读取窗口内容 "+c.readWindow+" 项，可执行手势 "+c.gestures+" 项，两者兼有 "+c.both+" 项。请在系统无障碍设置核对是否为你启用的工具；有能力不代表正在操作。"
    }
    val admins = probe("admins","设备管理授权","DevicePolicyManager.getActiveAdmins",{
        context.getSystemService(DevicePolicyManager::class.java)?.let { it.activeAdmins.orEmpty().size }
    }) { n -> if(n==0) Finding.OBSERVED to "当前用户的接口没有列出已激活的管理员。" else Finding.REVIEW to "当前用户有 $n 个已激活的管理员组件。在系统设置核对归属；工作资料或企业管理可能符合预期。" }
    val installer = if(BuildConfig.DEBUG) probe("selfInstaller","印迹的安装来源授权","PackageManager.canRequestPackageInstalls",{ context.packageManager.canRequestPackageInstalls() }) {
        if(it) Finding.REVIEW to "印迹可请求安装 APK，以便内网更新。这不表示已安装其他应用；不再需要时可在系统设置关闭。" else Finding.OBSERVED to "印迹未获准作为安装来源。这里只检查印迹自身。"
    } else PostureRow("selfInstaller","印迹的安装来源授权",Finding.OBSERVED,"此离线版本未声明请求安装 APK 的权限。","Release manifest")
    return listOf(accessibility,admins,installer)
}
