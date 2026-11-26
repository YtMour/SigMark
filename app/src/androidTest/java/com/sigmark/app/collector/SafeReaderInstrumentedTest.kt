package com.sigmark.app.collector

import com.sigmark.app.model.ReadReason
import com.sigmark.app.model.ValueStatus
import java.io.File

/**
 * Instrumented coverage for the two SafeReader paths the JVM unit tests cannot reach.
 *
 * On the JVM stub android.system.Os.open throws RuntimeException("Stub!") on its first
 * line, which SafeReader.read() folds into ERROR/READ_FAILED, so neither the per-core
 * ENOENT skip nor a real directory listing is ever exercised there. Only a real device
 * runs the actual syscalls.
 *
 * Why this is not a JUnit4/@RunWith(AndroidJUnit4) class: this module has no
 * androidx.test or junit dependency on the androidTest classpath (both are
 * testImplementation-only, and app/build.gradle.kts is outside this task's write scope),
 * and the test APK's single instrumentation entry is the hand-written
 * com.sigmark.app.CapabilitySmoke (AGP's processDebugAndroidTestManifest rewrites the
 * instrumentation node from testInstrumentationRunner, so a second runner cannot be
 * registered from app/src/androidTest/AndroidManifest.xml). The probe is therefore a
 * plain class driven by CapabilitySmoke via `-e probe safereader`, and every assertion
 * is emitted through [emit] so `am instrument -w` prints one INSTRUMENTATION_STATUS
 * block per assertion.
 */
class SafeReaderInstrumentedTest(
    private val emit: (case: String, ok: Boolean, detail: String) -> Unit,
) {
    class Outcome(
        val passed: List<String>,
        val failed: List<String>,
        val observations: List<String>,
    ) {
        val ok: Boolean get() = failed.isEmpty()
    }

    private val passed = mutableListOf<String>()
    private val failed = mutableListOf<String>()
    private val observations = mutableListOf<String>()
    private var readableDirectory: String? = null

    fun runAll(): Outcome {
        try {
            cpuCapacityOnDevice()
            cpuCapacityDeduplicates()
            cpuCapacitySingleCore()
            cpuCapacityZeroCores()
            cpuCapacityMissingCoreSemantics()
            listNamesReadableDirectory()
            listNamesTruncates()
            listNamesMissingDirectory()
            listNamesDeniedDirectory()
        } catch (error: Throwable) {
            record("harness.noUncaughtException", false,
                "测试过程抛出异常：${error.javaClass.name}: ${error.message}")
        }
        return Outcome(passed.toList(), failed.toList(), observations.toList())
    }

    // ---------------------------------------------------------------- cpuCapacity

    // Readable on a real device: a non-null, non-empty, deduplicated, all-positive
    // signature. Deliberately no literal 160/498/1024 so another SoC does not fail.
    private fun cpuCapacityOnDevice() {
        val reading = SafeReader.cpuCapacitySignature()
        val value = reading.value
        record("cpuCapacity.statusMatchesValue",
            (reading.status == ValueStatus.AVAILABLE) == (value != null),
            describe("cpuCapacitySignature()", reading))
        record("cpuCapacity.availableOnDevice", value != null && value.isNotBlank(),
            "真机应读到非空 cpu_capacity 签名：${describe("cpuCapacitySignature()", reading)}")
        if (value == null) return
        val parts = segments(value)
        record("cpuCapacity.everySegmentIsPositiveInteger",
            parts.isNotEmpty() && parts.all { (it.toIntOrNull() ?: -1) > 0 },
            "value=$value segments=$parts")
    }

    private fun cpuCapacityDeduplicates() {
        val value = SafeReader.cpuCapacitySignature().value ?: return
        val parts = segments(value)
        record("cpuCapacity.noDuplicateSegments",
            parts.size == parts.toSet().size,
            "value=$value segments=$parts（LinkedHashSet 按首次出现顺序去重）")
    }

    private fun cpuCapacitySingleCore() {
        val full = SafeReader.cpuCapacitySignature()
        val single = SafeReader.cpuCapacitySignature(1)
        record("cpuCapacity.maxCoresOne.atMostOneSegment",
            single.value == null || segments(single.value).size <= 1,
            describe("cpuCapacitySignature(1)", single))
        // cpu0 is read first, so when both sides have a value the single-core result
        // must be exactly the first segment of the full signature.
        val fullFirst = full.value?.let { segments(it).firstOrNull() }
        val singleOnly = single.value?.let { segments(it).firstOrNull() }
        if (fullFirst != null && singleOnly != null) {
            record("cpuCapacity.maxCoresOne.matchesFirstFullSegment",
                singleOnly == fullFirst,
                "full=${full.value} single=${single.value}")
        } else {
            observations += "maxCores=1 一致性未断言：full=${full.value} single=${single.value}"
        }
    }

    private fun cpuCapacityZeroCores() {
        val reading = SafeReader.cpuCapacitySignature(0)
        record("cpuCapacity.maxCoresZeroReturnsNull",
            reading.value == null,
            describe("cpuCapacitySignature(0)", reading))
        record("cpuCapacity.maxCoresZeroIsUnavailable",
            reading.status == ValueStatus.UNAVAILABLE,
            describe("cpuCapacitySignature(0)", reading))
    }

    // cpuCapacitySignature() has a private fixed base path, so ENOENT cannot be injected.
    // What is checkable on a real device: which cores expose cpu_capacity at all, and
    // that the signature never claims more cores than actually exist.
    private fun cpuCapacityMissingCoreSemantics() {
        val present = (0 until 8).filter { File("/sys/devices/system/cpu/cpu$it/cpu_capacity").exists() }
        val absent = (0 until 8).filterNot { it in present }
        val reading = SafeReader.cpuCapacitySignature()
        val parts = reading.value?.let { segments(it) } ?: emptyList()
        record("cpuCapacity.segmentsNeverExceedPresentCores",
            parts.size <= present.size,
            "presentCores=$present absentCores=$absent value=${reading.value}")
        if (absent.isEmpty()) {
            observations += "ENOENT 跳过分支未被真实触发：本机 cpu0–cpu7 的 cpu_capacity 全部存在，" +
                "cpuCapacityBase 是私有常量无法注入不存在的路径；只验证了段数不超过存在的核心数。"
        } else {
            record("cpuCapacity.missingCoreStillProducesSignature",
                present.isEmpty() || reading.value != null,
                "presentCores=$present absentCores=$absent value=${reading.value} status=${reading.status}")
        }
    }

    // ------------------------------------------------------------------ listNames

    private fun listNamesReadableDirectory() {
        val candidates = listOf("/proc/self/task", "/sys/devices/system/cpu", "/proc/self/fd")
        val probed = candidates.map { path -> "$path=${File(path).list()?.size ?: "null"}" }
        val chosen = candidates.firstOrNull { File(it).list() != null }
        readableDirectory = chosen
        record("listNames.foundReadableDirectory", chosen != null,
            "探测：${probed.joinToString(", ")}")
        if (chosen == null) {
            observations += "本机没有找到应用可读的探测目录，listNames 正向分支未覆盖。"
            return
        }
        val reading = SafeReader.listNames(chosen)
        record("listNames.available", reading.status == ValueStatus.AVAILABLE,
            describe("listNames($chosen)", reading))
        record("listNames.valueNotEmpty",
            !reading.value.isNullOrEmpty(),
            "path=$chosen value=${reading.value}")
        val names = reading.value ?: return
        record("listNames.sortedAscending",
            names == names.sorted(),
            "path=$chosen size=${names.size} head=${names.take(5)}")
        record("listNames.withinDefaultCap",
            names.size <= 64,
            "path=$chosen size=${names.size}")
    }

    private fun listNamesTruncates() {
        val path = readableDirectory ?: return
        val full = SafeReader.listNames(path).value.orEmpty()
        val limited = SafeReader.listNames(path, 3)
        record("listNames.maxEntriesCapsSize",
            (limited.value?.size ?: 0) <= 3,
            describe("listNames($path, 3)", limited))
        record("listNames.maxEntriesKeepsFirstThree",
            limited.value == full.take(3),
            "path=$path fullHead=${full.take(3)} limited=${limited.value}")
    }

    private fun listNamesMissingDirectory() {
        val path = "/system/nonexistent-sigmark-probe"
        record("listNames.missingPathAbsentOnDevice", !File(path).exists(), "path=$path")
        val reading = SafeReader.listNames(path)
        record("listNames.missingIsUnavailable",
            reading.status == ValueStatus.UNAVAILABLE && reading.value == null,
            describe("listNames($path)", reading))
        // java.io.File.list() returns null instead of throwing ErrnoException, so the
        // read() block falls into missing() with the caller-supplied detail and never
        // reaches errnoResult(); the observed reason is NOT_REPORTED, not NODE_MISSING.
        // The stat call runs first, so a missing directory keeps its own reason instead of
        // being folded into "the app was not told anything".
        record("listNames.missingReasonIsNodeMissing",
            reading.reason == ReadReason.NODE_MISSING,
            "path=$path status=${reading.status} reason=${reading.reason} errno=${reading.errno} " +
                "detail=${reading.detail}")
    }

    private fun listNamesDeniedDirectory() {
        val candidates = listOf("/data/resource-cache", "/data/misc/keystore", "/data/tombstones", "/data/system")
        val probed = candidates.map { path ->
            val file = File(path)
            "$path[exists=${file.exists()}, list=${file.list()?.size ?: "null"}]"
        }
        val denied = candidates.firstOrNull { path ->
            val file = File(path)
            file.exists() && file.list() == null
        }
        record("listNames.foundDeniedDirectory", denied != null, "探测：${probed.joinToString(", ")}")
        if (denied == null) {
            observations += "本机未找到可复现的「存在但无权读」目录，EACCES 分支未覆盖。"
            return
        }
        val reading = SafeReader.listNames(denied)
        record("listNames.deniedIsRestricted",
            reading.status == ValueStatus.RESTRICTED && reading.value == null,
            describe("listNames($denied)", reading))
        // A directory that stats fine but lists null is denied, not absent. Reporting it
        // as "nothing there" would be a false clean result, which is the one mistake a
        // disguise check must not make, so the two outcomes are asserted apart.
        record("listNames.deniedIsAccessDenied",
            reading.reason == ReadReason.ACCESS_DENIED && reading.errno != null,
            "path=$denied status=${reading.status} reason=${reading.reason} errno=${reading.errno} " +
                "（stat 成功但 list() 返回 null → 判定为拒绝读取，而非目录不存在）")
    }

    // ------------------------------------------------------------------- helpers

    private fun segments(value: String): List<String> =
        value.split("/").map { it.trim() }.filter { it.isNotEmpty() }

    private fun describe(source: String, reading: ReadResult<*>): String =
        "$source → status=${reading.status} value=${reading.value} reason=${reading.reason} " +
            "errno=${reading.errno} source=${reading.source} detail=${reading.detail}"

    private fun record(case: String, ok: Boolean, detail: String) {
        if (ok) passed += case else failed += case
        emit(case, ok, detail)
    }
}
