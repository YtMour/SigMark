package com.sigmark.app.lan

import android.content.Context
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.*
import com.sigmark.app.BuildConfig
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.Proxy
import java.net.URI
import java.security.MessageDigest

internal const val MaxUpdateBytes = 128L * 1024 * 1024

internal data class UpdateRelease(val name: String, val code: Long, val size: Long, val sha256: String) {
    fun isValid() = name.matches(Regex("[0-9.]{1,32}")) && code > 0 &&
        size in 1..MaxUpdateBytes && sha256.matches(Regex("[a-f0-9]{64}"))
}

private suspend fun <T> get(origin: URI, path: String, read: suspend (java.io.InputStream) -> T): T {
    val connection = origin.resolve(path).toURL().openConnection(Proxy.NO_PROXY) as HttpURLConnection
    try {
        connection.instanceFollowRedirects = false
        connection.connectTimeout = 6000
        connection.readTimeout = 10000
        if (connection.responseCode == 409) throw LanFailure("下载期间发布版本已切换。请关闭窗口，再检查更新。")
        if (connection.responseCode != 200) throw LanFailure("发布服务返回 HTTP ${connection.responseCode}。")
        return connection.inputStream.use { read(it) }
    } finally {
        connection.disconnect()
    }
}

private suspend fun checkRelease(origin: URI): UpdateRelease = get(origin, "/api/downloads/current") { input ->
    val bytes = input.readNBytesCompat(4097)
    if (bytes.size > 4096) throw LanFailure("发布信息超过大小限制。")
    val json = JSONObject(bytes.toString(Charsets.UTF_8))
    val release = UpdateRelease(json.getString("version"), json.optLong("versionCode"), json.getLong("size"), json.getString("sha256"))
    if (!release.isValid()) throw LanFailure("发布信息缺少有效版本号或校验值。")
    release
}

private fun java.io.InputStream.readNBytesCompat(max: Int): ByteArray {
    val bytes = ByteArray(max)
    var offset = 0
    while (offset < max) {
        val n = read(bytes, offset, max - offset)
        if (n <= 0) break
        offset += n
    }
    return bytes.copyOf(offset)
}

internal enum class UpdateSigners { MATCH, MISMATCH, SYSTEM_CHECK }

internal fun compareUpdateSigners(installed: Set<String>, archive: Set<String>): UpdateSigners = when {
    installed.isEmpty() || archive.isEmpty() -> UpdateSigners.SYSTEM_CHECK
    installed == archive -> UpdateSigners.MATCH
    else -> UpdateSigners.MISMATCH
}

private data class DownloadedUpdate(val file: File, val signerCheck: UpdateSigners)

@Suppress("DEPRECATION")
private fun verifyArchive(context: Context, file: File, release: UpdateRelease): UpdateSigners {
    val pm = context.packageManager
    val installed = pm.getPackageInfo(context.packageName, 0)
    val candidate = pm.getPackageArchiveInfo(file.path, 0) ?: throw LanFailure("Android 未能解析下载的 APK。")
    fun code(info: PackageInfo) = if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else info.versionCode.toLong()
    if (candidate.packageName != installed.packageName) throw LanFailure("APK 包名与当前安装不同。请从印迹下载页获取对应的安装包。")
    if (code(candidate) != release.code || candidate.versionName != release.name) throw LanFailure("APK 内的版本与发布记录不一致，请联系管理员重新发布。")
    if (code(candidate) <= code(installed)) throw LanFailure("APK 版本号未高于当前安装版本。")
    fun signers(read: (Int) -> PackageInfo?): Set<String> {
        val modern = if (Build.VERSION.SDK_INT >= 28) runCatching {
            read(PackageManager.GET_SIGNING_CERTIFICATES)?.signingInfo?.apkContentsSigners?.map { it.toCharsString() }?.toSet()
        }.getOrNull().orEmpty() else emptySet()
        if (modern.isNotEmpty()) return modern
        return runCatching { read(PackageManager.GET_SIGNATURES)?.signatures?.map { it.toCharsString() }?.toSet() }
            .getOrNull().orEmpty()
    }
    val verdict = compareUpdateSigners(signers { pm.getPackageInfo(context.packageName, it) },
        signers { pm.getPackageArchiveInfo(file.path, it) })
    if (verdict == UpdateSigners.MISMATCH) throw LanFailure("APK 签名与当前安装不同。请管理员使用原签名发布；换签前先导出本地报告。")
    return verdict
}

private suspend fun download(context: Context, origin: URI, release: UpdateRelease, progress: (Int) -> Unit): DownloadedUpdate {
    val directory = File(context.cacheDir, "updates").apply { mkdirs() }
    val pending = File.createTempFile("update-", ".apk", directory)
    var complete = false
    try {
        val digest = MessageDigest.getInstance("SHA-256")
        get(origin, "/downloads/sigmark.apk?sha256=${release.sha256}") { input ->
            pending.outputStream().use { output ->
                val buffer = ByteArray(64 * 1024)
                var bytes = 0L
                var percent = -1
                while (true) {
                    currentCoroutineContext().ensureActive()
                    val count = input.read(buffer)
                    if (count < 0) break
                    bytes += count
                    if (bytes > release.size) throw LanFailure("APK 大小与发布信息不一致，请重新检查。")
                    output.write(buffer, 0, count)
                    digest.update(buffer, 0, count)
                    val next = (100 * bytes / release.size).toInt()
                    if (next != percent) {
                        percent = next
                        progress(percent)
                    }
                }
                val hash = digest.digest().joinToString("") { "%02x".format(it.toInt() and 0xff) }
                if (bytes != release.size || hash != release.sha256) throw LanFailure("APK 校验失败，请重新检查发布版本。")
            }
        }
        val signerCheck = verifyArchive(context, pending, release)
        complete = true
        return DownloadedUpdate(pending, signerCheck)
    } finally {
        if (!complete) pending.delete()
    }
}

@Composable
internal fun AppUpdate(context: Context, onClose: () -> Unit) {
    val origin = remember { lanEndpoint(BuildConfig.LAN_ORIGIN) }
    var release by remember { mutableStateOf<UpdateRelease?>(null) }
    var apk by remember { mutableStateOf<DownloadedUpdate?>(null) }
    var message by remember { mutableStateOf("正在查询发布版本…") }
    var busy by remember { mutableStateOf(true) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(origin) {
        try {
            val latest = withContext(Dispatchers.IO) { checkRelease(origin ?: throw LanFailure("此安装包未设置内网地址。")) }
            if (latest.code > BuildConfig.VERSION_CODE) {
                release = latest
                message = "当前 ${BuildConfig.VERSION_NAME}，可更新至 ${latest.name}。"
            } else message = "当前版本已是最新发布版或更新的版本。"
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            message = (error as? LanFailure)?.message ?: "检查失败，请确认手机与发布服务在同一局域网。"
        } finally {
            busy = false
        }
    }

    fun openInstaller(file: File) {
        try {
            if (!context.packageManager.canRequestPackageInstalls()) {
                context.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    android.net.Uri.parse("package:${context.packageName}")))
                message = "请允许印迹安装此来源的应用。返回后点「安装更新」。"
                return
            }
            val uri = FileProvider.getUriForFile(context, "${context.packageName}.updates", file)
            context.startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))
            message = "请在 Android 安装界面确认更新。"
        } catch (_: Exception) {
            message = "系统安装界面未打开。请检查安装来源设置。"
        }
    }

    AlertDialog(
        onDismissRequest = { if (!busy) onClose() },
        title = { Text("检查更新") },
        text = { Text(message) },
        confirmButton = {
            val next = release
            if (next != null && !busy && origin != null) TextButton(onClick = {
                val ready = apk
                if (ready != null) {
                    openInstaller(ready.file)
                } else {
                    busy = true
                    scope.launch {
                        try {
                            message = "正在下载更新…"
                            apk = withContext(Dispatchers.IO) {
                                File(context.cacheDir, "updates").listFiles()?.filter {
                                    System.currentTimeMillis() - it.lastModified() > 86_400_000
                                }?.forEach { it.delete() }
                                download(context, origin, next) { percent -> message = "正在下载更新 $percent%" }
                            }
                            message = if (apk?.signerCheck == UpdateSigners.MATCH) "已核对 APK 校验值和签名。"
                            else "已核对 APK 内容和版本。当前 ROM 未提供 APK 证书给应用，签名交由 Android 安装器核验。"
                        } catch (error: CancellationException) {
                            throw error
                        } catch (error: Exception) {
                            message = (error as? LanFailure)?.message ?: "更新下载失败，请重试。"
                        } finally {
                            busy = false
                        }
                    }
                }
            }) { Text(if (apk == null) "下载更新" else "安装更新") }
        },
        dismissButton = { TextButton(onClick = onClose) { Text(if (busy) "取消" else "关闭") } },
    )
}
