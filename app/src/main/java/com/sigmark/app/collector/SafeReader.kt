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
import java.io.File
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

internal fun <T> ReadResult<T>.explainMissing(reason: ReadReason, note: String): ReadResult<T> =
    if (this.reason == ReadReason.NOT_REPORTED) copy(reason = reason, detail = note) else this

// Append an explanation without touching the status, reason or errno.
internal fun <T> ReadResult<T>.withNote(note: String): ReadResult<T> =
    copy(detail = listOfNotNull(detail, note).joinToString(" "))

// Decode a readable value; leave an unset property as NOT_REPORTED and only a
// readable but unexpected value as INVALID_VALUE.
internal fun ReadResult<String>.decodeProperty(decode: (String) -> String?, invalidNote: String): ReadResult<String> {
    val raw = value ?: return this
    val decoded = decode(raw) ?: return SafeReader.missing(source, ReadReason.INVALID_VALUE, invalidNote)
    return copy(value = decoded)
}

internal object SafeReader {
    private const val fileTimeoutMs = 400L
    private const val propertyTimeoutMs = 350L
    internal const val propertySnapshotMaxBytes = 96 * 1024
    private const val propertySnapshotTimeoutMs = 800L
    // Fixed prefix plus a bounded core index; never taken from a caller-supplied path.
    private const val cpuCapacityBase = "/sys/devices/system/cpu"
    private val workers = ThreadPoolExecutor(2, 2, 20, TimeUnit.SECONDS, ArrayBlockingQueue(2)) { work ->
        Thread(work, "sigmark-reader").apply { isDaemon = true }
    }.apply { allowCoreThreadTimeOut(true) }

    // Fixed paths only. In particular, policy is checked by open/close, never read.
    enum class Node(val path: String, val maxBytes: Int = 0) {
        CPU_INFO("/proc/cpuinfo", 96 * 1024),
        MEM_INFO("/proc/meminfo", 16 * 1024),
        CPU0_MAX("/sys/devices/system/cpu/cpu0/cpufreq/cpuinfo_max_freq", 64),
        CPU_POLICY0_MAX("/sys/devices/system/cpu/cpufreq/policy0/cpuinfo_max_freq", 64),
        CPU_POSSIBLE("/sys/devices/system/cpu/possible", 128),
        CPU_ONLINE("/sys/devices/system/cpu/online", 128),
        BATTERY_TEMP("/sys/class/power_supply/battery/temp", 32),
        BATTERY_TEMP_BMS("/sys/class/power_supply/bms/temp", 32),
        SELINUX_ENFORCE("/sys/fs/selinux/enforce", 16),
        SELINUX_POLICY("/sys/fs/selinux/policy"),
        SELF_CONTEXT("/proc/self/attr/current", 256),
        PROCESS_MAPS("/proc/self/maps", 512 * 1024),
        PROCESS_STATUS("/proc/self/status", 16 * 1024),
        PROCESS_MOUNTINFO("/proc/self/mountinfo", 96 * 1024),
    }

    enum class Property(val key: String) {
        SELINUX_BOOT("ro.boot.selinux"), SELINUX_BUILD("ro.build.selinux"),
        FIRST_API_LEVEL("ro.product.first_api_level"),
        PRODUCT_MODEL("ro.product.model"), PRODUCT_DEVICE("ro.product.device"),
        VENDOR_PATCH("ro.vendor.build.security_patch"),
        HYPEROS("ro.mi.os.version.name"), MIUI("ro.miui.ui.version.name"),
        COLOR_OS("ro.build.version.opporom"), ONE_UI("ro.build.version.oneui"),
        COLOR_OS_ALT("ro.oplus.version.opporom"), VERIFIED_BOOT("ro.boot.verifiedbootstate"),
        VBMETA_STATE("ro.boot.vbmeta.device_state"), FLASH_LOCKED("ro.boot.flash.locked"),
        BOOTLOADER("ro.bootloader"), BASE_OS("ro.build.version.base_os"),
        VERITY_MODE("ro.boot.veritymode"), DEBUGGABLE("ro.debuggable"), CRYPTO_STATE("ro.crypto.state"),
    }

    // Lazy suppliers let a successful candidate skip the remaining reads.
    fun <T> firstAvailable(vararg candidates: () -> ReadResult<T>): ReadResult<T> {
        require(candidates.isNotEmpty())
        val failures = mutableListOf<ReadResult<T>>()
        for (candidate in candidates) {
            val result = candidate()
            if (result.value != null && result.status == ValueStatus.AVAILABLE) return result
            failures += result
        }
        val primary = failures.firstOrNull { it.status == ValueStatus.RESTRICTED }
            ?: failures.firstOrNull { it.status == ValueStatus.ERROR }
            ?: failures.firstOrNull { it.errno != null }
            ?: failures.first()
        if (failures.size == 1) return primary
        val others = failures.filter { it !== primary }.joinToString("；") {
            "${it.source}: ${it.reason?.name ?: it.status.name}${it.errno?.let { code -> " errno=$code" }.orEmpty()}"
        }
        return primary.copy(detail = listOfNotNull(primary.detail, "其他候选：$others").joinToString(" "))
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

    // cpu_capacity is one file per core, so it cannot be a single fixed Node path. The
    // loop is bounded to the first eight cores, which covers every shipping big.LITTLE
    // layout. A core that does not exist (ENOENT) is skipped; a core that exists but is
    // denied fails the whole signature, because a partial profile would look like a
    // different SoC instead of a visible gap.
    fun cpuCapacitySignature(maxCores: Int = 8): ReadResult<String> = bounded(
        "$cpuCapacityBase/cpu{N}/cpu_capacity", fileTimeoutMs) {
        read("$cpuCapacityBase/cpu{N}/cpu_capacity",
            "逐个读取 cpu0–cpu${maxCores - 1} 的 cpu_capacity，按首次出现顺序去重；缺少任一存在的核心即整项记受限。") {
            val seen = LinkedHashSet<Int>()
            for (index in 0 until maxCores) {
                val path = "$cpuCapacityBase/cpu$index/cpu_capacity"
                val fd = try { Os.open(path, openFlags(), 0) }
                catch (e: ErrnoException) {
                    if (e.errno == OsConstants.ENOENT) continue
                    throw e
                }
                val capacity = try {
                    val buffer = ByteArray(32)
                    val n = Os.read(fd, buffer, 0, buffer.size)
                    if (n <= 0) null else String(buffer, 0, n, Charsets.UTF_8).trim().toIntOrNull()
                } finally { Os.close(fd) }
                if (capacity != null && capacity > 0) seen += capacity
            }
            if (seen.isEmpty()) null else seen.joinToString("/")
        }
    }

    // A directory listing needs the same time bound as a file read: a stuck FUSE mount
    // or an oversized overlay directory must not stall the whole capture. Entries are
    // sorted so a report is reproducible, then truncated to a fixed ceiling.
    // java.io.File.list() answers null for both "missing" and "denied" without raising
    // an errno, so the stat call runs first. A directory that stats fine but lists null
    // is denied, not absent: reporting it as "nothing there" would be a false clean
    // result, which is exactly the mistake a disguise check must not make.
    fun listNames(path: String, maxEntries: Int = 64): ReadResult<List<String>> =
        bounded(path, fileTimeoutMs) {
            val stat = try {
                Os.stat(path)
            } catch (e: ErrnoException) {
                return@bounded errnoResult<List<String>>(path, e.errno, OsConstants.EACCES,
                    OsConstants.EPERM, OsConstants.ENOENT, OsConstants.ENOTDIR)
            }
            if (!OsConstants.S_ISDIR(stat.st_mode)) {
                return@bounded missing(path, ReadReason.NODE_MISSING, "该路径存在但不是目录。")
            }
            val names = File(path).list()
                ?: return@bounded ReadResult(null, ValueStatus.RESTRICTED, path,
                    "目录存在（stat 可见）但列出条目被拒绝，不能据此断言其中没有文件。",
                    ReadReason.ACCESS_DENIED, OsConstants.EACCES)
            read(path, "只列出目录条目名，不读取文件内容；按名称排序后截断到 $maxEntries 项。") {
                names.sorted().take(maxEntries)
            }
        }

    fun suFileHint(): ReadResult<String> = firstAvailable(
        { statSu("/system/bin/su") }, { statSu("/system/xbin/su") }, { statSu("/sbin/su") },
    ).let { reading ->
        reading.copy(detail = listOfNotNull(reading.detail,
            "只检查固定路径的元数据。可见条目和路径缺失都只作环境线索。").joinToString(" "))
    }

    private fun statSu(path: String): ReadResult<String> = bounded(path, fileTimeoutMs) {
        read(path) {
            Os.stat(path)
            "应用可见此路径"
        }
    }

    fun property(property: Property): ReadResult<String> = property(property.key)

    // Exact key entry point for keys outside the enum (for example partition build dates).
    fun property(key: String): ReadResult<String> {
        val source = "getprop $key"
        PropertySnapshot.record(key)?.let { cached -> return readPropertyValue(source) { cached } }
        // A complete dump already listed every property this app can read; retrying
        // the key one by one would spawn a process only to get the same empty answer.
        if (PropertySnapshot.authoritative()) return missing(source, ReadReason.NOT_REPORTED,
            "属性未设置或对当前应用不可见。")
        return bounded(source, propertyTimeoutMs + 50) {
            readPropertyValue(source) { singleProperty(key) }
        }
    }

    private fun singleProperty(key: String): String {
        val p = ProcessBuilder("/system/bin/getprop", key).redirectErrorStream(true).start()
        try {
            if (!p.waitFor(propertyTimeoutMs, TimeUnit.MILLISECONDS)) throw TimeoutException()
            check(p.exitValue() == 0)
            return p.inputStream.use {
                // Reject an oversized read rather than compare a truncated prefix,
                // including multi-byte model names when the snapshot path failed.
                val bytes = ByteArray(1025)
                var count = 0
                while (count < bytes.size) {
                    val read = it.read(bytes, count, bytes.size - count)
                    if (read <= 0) break
                    count += read
                }
                check(count < bytes.size)
                String(bytes, 0, count, Charsets.UTF_8).trim()
            }
        } finally { p.destroyForcibly() }
    }

    // One getprop call for the whole collection. Fixed byte and wait limits;
    // a failed snapshot only disables the shortcut.
    fun propertySnapshot(): ReadResult<String> {
        val source = "/system/bin/getprop"
        return bounded(source, propertySnapshotTimeoutMs) {
            read(source) {
                val p = ProcessBuilder("/system/bin/getprop").redirectErrorStream(true).start()
                try {
                    val out = ByteArrayOutputStream()
                    val buffer = ByteArray(8192)
                    val stream = p.inputStream
                    while (out.size() < propertySnapshotMaxBytes) {
                        val count = stream.read(buffer, 0, minOf(buffer.size, propertySnapshotMaxBytes - out.size()))
                        if (count <= 0) break
                        out.write(buffer, 0, count)
                    }
                    if (!p.waitFor(propertySnapshotTimeoutMs, TimeUnit.MILLISECONDS)) throw TimeoutException()
                    check(p.exitValue() == 0)
                    out.toString(Charsets.UTF_8.name())
                } finally { p.destroyForcibly() }
            }
        }
    }

    // stat only, without opening the node. Used to separate DAC from MAC denial.
    fun statMode(path: String): ReadResult<Int> = bounded(path, fileTimeoutMs) {
        read(path) { Os.stat(path).st_mode }
    }

    // O_CLOEXEC only exists from API 27; asking for it earlier fails the open itself.
    private fun openFlags(): Int {
        val base = OsConstants.O_RDONLY or OsConstants.O_NONBLOCK
        return if (Build.VERSION.SDK_INT >= 27) base or OsConstants.O_CLOEXEC else base
    }

    internal fun readPropertyValue(source: String, block: () -> String): ReadResult<String> =
        read(source, block = block).explainMissing(ReadReason.NOT_REPORTED, "属性未设置或对当前应用不可见。")
}
