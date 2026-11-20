package com.sigmark.app.collector

import android.os.Build
import android.os.SystemClock
import android.system.ErrnoException
import android.system.Os
import android.system.OsConstants
import android.system.StructPollfd
import com.sigmark.app.model.DeviceInfoItem
import com.sigmark.app.model.ReadReason
import com.sigmark.app.model.ValueStatus
import com.sigmark.app.model.normalizeValue
import java.io.ByteArrayOutputStream
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.Callable
import java.util.concurrent.ExecutionException
import java.util.concurrent.FutureTask
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException
import kotlinx.coroutines.CancellationException

internal data class ReadResult<T>(
    val value: T?, val status: ValueStatus, val source: String,
    val detail: String? = null, val reason: ReadReason? = null, val errno: Int? = null,
) {
    fun <R> map(transform: (T) -> R?): ReadResult<R> =
        if (value == null) ReadResult(null, status, source, detail, reason, errno)
        else SafeReader.read(source, detail) { transform(value) }
}

internal fun ReadResult<String>.item(key: String, label: String) =
    DeviceInfoItem(key, label, value, source, status, detail, reason, errno)

internal object SafeReader {
    private const val fileTimeoutMs = 400L
    private const val propertyTimeoutMs = 350L
    private val workers = ThreadPoolExecutor(2, 2, 20, TimeUnit.SECONDS, ArrayBlockingQueue(2)) { work ->
        Thread(work, "sigmark-reader").apply { isDaemon = true }
    }.apply { allowCoreThreadTimeOut(true) }

    // Fixed paths only. In particular, policy is checked by open/close, never read.
    enum class Node(val path: String, val maxBytes: Int = 0) {
        CPU_INFO("/proc/cpuinfo", 96 * 1024),
        MEM_INFO("/proc/meminfo", 16 * 1024),
        CPU0_MAX("/sys/devices/system/cpu/cpu0/cpufreq/cpuinfo_max_freq", 64),
        SELINUX_ENFORCE("/sys/fs/selinux/enforce", 16),
        SELINUX_POLICY("/sys/fs/selinux/policy"),
    }

    enum class Property(val key: String) {
        SELINUX_BOOT("ro.boot.selinux"), SELINUX_BUILD("ro.build.selinux"),
        HYPEROS("ro.mi.os.version.name"), MIUI("ro.miui.ui.version.name"),
        COLOR_OS("ro.build.version.opporom"), ONE_UI("ro.build.version.oneui"),
    }

    fun <T> read(source: String, detail: String? = null, block: () -> T?): ReadResult<T> = try {
        val raw = block()
        val available = raw != null && (raw !is String || normalizeValue(raw) != null)
        if (available) ReadResult(raw, ValueStatus.AVAILABLE, source, detail)
        else missing(source, ReadReason.NOT_REPORTED, detail ?: "系统没有提供可用数据。")
    } catch (e: CancellationException) {
        throw e
    } catch (e: ErrnoException) {
        errnoResult(source, e.errno, OsConstants.EACCES, OsConstants.EPERM, OsConstants.ENOENT, OsConstants.ENODEV)
    } catch (_: SecurityException) {
        ReadResult(null, ValueStatus.RESTRICTED, source, "Android 拒绝普通应用读取。", ReadReason.ACCESS_DENIED)
    } catch (_: UnsupportedOperationException) {
        missing(source, ReadReason.NOT_REPORTED, "设备未实现该读取接口。")
    } catch (e: Exception) {
        if (e is InterruptedException) Thread.currentThread().interrupt()
        failed(source, "读取异常：${e.javaClass.simpleName}。")
    }

    fun <T> missing(source: String, reason: ReadReason, detail: String) =
        ReadResult<T>(null, ValueStatus.UNAVAILABLE, source, detail, reason)

    internal fun <T> errnoResult(source: String, errno: Int, denied: Int, forbidden: Int, missing: Int, noDevice: Int): ReadResult<T> {
        val symbol = when (errno) {
            denied -> "EACCES"; forbidden -> "EPERM"; missing -> "ENOENT"; noDevice -> "ENODEV"; else -> "系统调用错误"
        }
        val prefix = "$symbol / errno=$errno"
        return when (errno) {
            denied, forbidden -> ReadResult(null, ValueStatus.RESTRICTED, source,
                "$prefix · Android 文件权限或系统策略拒绝普通应用访问。", ReadReason.ACCESS_DENIED, errno)
            missing, noDevice -> ReadResult(null, ValueStatus.UNAVAILABLE, source,
                "$prefix · 当前设备未暴露该节点或节点所需设备不可用。", ReadReason.NODE_MISSING, errno)
            else -> ReadResult(null, ValueStatus.ERROR, source,
                "$prefix · 读取未完成。", ReadReason.READ_FAILED, errno)
        }
    }

    private fun <T> failed(source: String, detail: String) =
        ReadResult<T>(null, ValueStatus.ERROR, source, detail, ReadReason.READ_FAILED)

    private fun <T> bounded(source: String, timeoutMs: Long, read: () -> ReadResult<T>): ReadResult<T> {
        val task = FutureTask(Callable(read))
        try { workers.execute(task) }
        catch (_: RejectedExecutionException) { return failed(source, "底层读取暂忙，已跳过此项。") }
        return try { task.get(timeoutMs, TimeUnit.MILLISECONDS) }
        catch (_: TimeoutException) { failed(source, "读取超过 ${timeoutMs} ms，已停止等待。") }
        catch (e: ExecutionException) {
            val cause = e.cause
            if (cause is CancellationException) throw cause
            if (cause is Error) throw cause
            failed(source, "读取任务异常：${cause?.javaClass?.simpleName ?: "unknown"}。")
        }
        catch (_: InterruptedException) {
            Thread.currentThread().interrupt()
            failed(source, "读取被中断。")
        } finally {
            if (!task.isDone) task.cancel(true)
            workers.remove(task)
        }
    }

    fun node(node: Node): ReadResult<String> = bounded(node.path, fileTimeoutMs) {
        read(node.path) {
            val deadline = SystemClock.elapsedRealtime() + fileTimeoutMs
            val base = OsConstants.O_RDONLY or OsConstants.O_NONBLOCK
            val flags = if (Build.VERSION.SDK_INT >= 27) base or OsConstants.O_CLOEXEC else base
            val fd = Os.open(node.path, flags, 0)
            try {
                if (node.maxBytes == 0) "可打开（未读取内容）"
                else {
                    val pollFd = StructPollfd().apply { this.fd = fd; events = OsConstants.POLLIN.toShort() }
                    val buffer = ByteArray(4096)
                    val out = ByteArrayOutputStream()
                    while (out.size() < node.maxBytes) {
                        val remaining = deadline - SystemClock.elapsedRealtime()
                        if (remaining <= 0 || Thread.currentThread().isInterrupted ||
                            Os.poll(arrayOf(pollFd), remaining.toInt()) == 0) throw TimeoutException()
                        val n = Os.read(fd, buffer, 0, minOf(buffer.size, node.maxBytes - out.size()))
                        if (n <= 0) break
                        out.write(buffer, 0, n)
                    }
                    out.toString(Charsets.UTF_8.name())
                }
            } finally { Os.close(fd) }
        }
    }

    fun property(property: Property): ReadResult<String> {
        val source = "getprop ${property.key}"
        return bounded(source, propertyTimeoutMs + 50) {
            read(source, "属性未设置或对当前应用不可见。") {
                val p = ProcessBuilder("/system/bin/getprop", property.key).redirectErrorStream(true).start()
                try {
                    if (!p.waitFor(propertyTimeoutMs, TimeUnit.MILLISECONDS)) throw TimeoutException()
                    check(p.exitValue() == 0)
                    p.inputStream.use {
                        val bytes = ByteArray(128)
                        val count = it.read(bytes)
                        String(bytes, 0, count.coerceAtLeast(0), Charsets.UTF_8).trim()
                    }
                } finally { p.destroyForcibly() }
            }
        }
    }
}
