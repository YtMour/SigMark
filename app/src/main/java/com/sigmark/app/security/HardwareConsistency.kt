package com.sigmark.app.security

import java.util.Locale

internal enum class FactState { CONFLICT, CONFIRMED, UNKNOWN }

internal data class HardwareFact(
    val id: String, val label: String, val state: FactState, val message: String,
)

internal data class HardwareFacts(val facts: List<HardwareFact>) {
    val conflicts: List<HardwareFact> get() = facts.filter { it.state == FactState.CONFLICT }
    val confirmed: Int get() = facts.count { it.state == FactState.CONFIRMED }
}

// A small, explicit table. It only covers SoC identifiers this project has a written
// reference for; an unlisted SoC stays UNKNOWN instead of guessing. `cores` are the ARM
// CPU part numbers (MIDR) that the declared SoC family is built from, `gpu` is the
// driver string prefix expected from its GPU, `capacities` is the distinct cpu_capacity
// profile in core order, and `cmaMiB` is the kernel's reserved contiguous pool.
internal data class SocProfile(
    val label: String, val cores: Set<String>, val gpu: Set<String>,
    val capacities: String? = null, val cmaMiB: Int? = null,
)

internal val socProfiles: Map<String, SocProfile> = mapOf(
    // Pixel 6 / Pixel 6 Pro: Cortex-X1 + A76 + A55, Mali-G78. Measured on a Pixel 6:
    // cpu0-3 = 160, cpu4-5 = 498, cpu6-7 = 1024; CmaTotal 667648 kB = 652 MiB.
    "gs101" to SocProfile("Tensor G1", setOf("0xd44", "0xd0b", "0xd05"), setOf("mali-g78"),
        capacities = "160/498/1024", cmaMiB = 652),
    // Redmi K60 Ultra class: Cortex-X3 + A715 + A510, Immortalis-G715.
    "mt6985" to SocProfile("Dimensity 9200+", setOf("0xd4e", "0xd4d", "0xd46"), setOf("mali-g715", "immortalis-g715")),
    // Snapdragon 8 Gen 2: Cortex-X3 + A715 + A510, Adreno 740.
    "sm8550" to SocProfile("Snapdragon 8 Gen 2", setOf("0xd4e", "0xd4d", "0xd46"), setOf("adreno")),
    // Snapdragon 8 Gen 1: Cortex-X2 + A710 + A510, Adreno 730.
    "sm8450" to SocProfile("Snapdragon 8 Gen 1", setOf("0xd48", "0xd47", "0xd46"), setOf("adreno")),
    // Snapdragon 865: Cortex-A77 + A55, Adreno 650.
    "sm8250" to SocProfile("Snapdragon 865", setOf("0xd0d", "0xd05"), setOf("adreno")),
    // Snapdragon 845: Cortex-A75 + A55, Adreno 630. Measured on a Mi 8 running the stock
    // kernel 4.9, which exposes no cpu_capacity at all, so only the two channels that
    // device actually answers for are registered. CmaTotal is a device-tree value rather
    // than a SoC constant, so it is left unset instead of guessed.
    "sdm845" to SocProfile("Snapdragon 845", setOf("0x802", "0x803"), setOf("adreno")),
)

internal val socAliases: Map<String, String> = mapOf(
    "tensor" to "gs101", "tensor g1" to "gs101", "google tensor" to "gs101",
    "dimensity 9200+" to "mt6985", "dimensity 9200" to "mt6985",
    "snapdragon 8 gen 2" to "sm8550", "snapdragon 8 gen 1" to "sm8450", "snapdragon 865" to "sm8250",
)

// "0x41:0xd44×2 / 0x41:0xd0b×2 / 0x41:0xd05×4" -> {0xd44, 0xd0b, 0xd05}
internal fun measuredCoreParts(signature: String?): Set<String> =
    signature.orEmpty().split('/').mapNotNull { chunk ->
        val token = chunk.trim().substringBefore('×').substringAfterLast(':')
        token.takeIf { it.matches(Regex("0x[0-9a-f]{1,4}")) }
    }.toSet()

internal fun gibValue(raw: String?): Double? =
    Regex("^([0-9]+(?:\\.[0-9]+)?) GiB$").find(raw?.trim().orEmpty())
        ?.groupValues?.get(1)?.toDoubleOrNull()

internal fun declaredSocProfile(read: (String) -> String?): Pair<String, SocProfile>? {    val declared = listOf("system.socModel", "system.boardPlatform", "cpu.hardware", "system.board")
        .mapNotNull { key -> read(key)?.trim()?.lowercase(Locale.ROOT)?.takeIf { it.isNotEmpty() } }
    for (value in declared) {
        val id = when {
            value in socProfiles -> value
            value in socAliases -> socAliases.getValue(value)
            else -> null
        }
        if (id != null) return id to socProfiles.getValue(id)
    }
    return null
}

// The capacity profile and the reserved contiguous pool are both fixed by the SoC's own
// core and memory layout, so a match against a *different* registered SoC is a positive
// identification rather than an assumption about what the declared SoC should look like.
internal fun foreignProfileMatch(
    declaredId: String?, measured: String?, field: (SocProfile) -> String?,
): SocProfile? = socProfiles.entries.firstOrNull { (id, profile) ->
    id != declaredId && field(profile) != null && field(profile) == measured
}?.value

// Compares what the device claims with what independent channels report. Every row is a
// different pair of sources, so one rewritten value cannot satisfy all of them. A
// conflict is a reason to re-check the test conditions, never a verdict about the phone.
internal fun hardwareFacts(read: (String) -> String?): HardwareFacts {
    val facts = mutableListOf<HardwareFact>()

    val ramChannels = listOf(
        "框架" to gibValue(read("memory.totalRam")),
        "sysconf" to gibValue(read("memory.physicalRam")),
        "/proc/meminfo" to gibValue(read("memory.kernelMemTotal")),
    ).mapNotNull { (label, value) -> value?.takeIf { it > 0.5 }?.let { label to it } }
    facts += if (ramChannels.size < 2) HardwareFact("ram", "运行内存多通道", FactState.UNKNOWN,
        "只有一个内存口径可用，无法交叉核对。")
    else {
        val values = ramChannels.map { it.second }
        val spread = (values.max() - values.min()) / values.max()
        val listed = ramChannels.joinToString(" / ") { (label, value) -> "$label %.2f GiB".format(Locale.ROOT, value) }
        if (spread > 0.08) HardwareFact("ram", "运行内存多通道", FactState.CONFLICT,
            "$listed。同一台设备的框架、C 库与内核口径通常只差几个百分点。")
        else HardwareFact("ram", "运行内存多通道", FactState.CONFIRMED, "$listed，口径一致。")
    }

    val declared = declaredSocProfile(read)
    val parts = measuredCoreParts(read("cpu.cpuParts"))
    facts += when {
        declared == null -> HardwareFact("cores", "CPU 微架构与 SoC 声明", FactState.UNKNOWN,
            "声明里的 SoC 不在本项目已登记的对照表内，未比对微架构。")
        parts.isEmpty() -> HardwareFact("cores", "CPU 微架构与 SoC 声明", FactState.UNKNOWN,
            "没有读到 /proc/cpuinfo 的核心标识，未比对。")
        parts.any { it in declared.second.cores } -> HardwareFact("cores", "CPU 微架构与 SoC 声明", FactState.CONFIRMED,
            "实测核心标识与 ${declared.second.label} 家族有交集。")
        else -> HardwareFact("cores", "CPU 微架构与 SoC 声明", FactState.CONFLICT,
            "声明为 ${declared.second.label}（${declared.first}），实测核心标识为 ${parts.sorted().joinToString("、")}，" +
                "与该家族应有的核心类型均不同。")
    }

    val renderer = read("runtime.glesRenderer")?.trim()?.lowercase(Locale.ROOT)
    facts += when {
        declared == null -> HardwareFact("gpu", "GPU 驱动与 SoC 声明", FactState.UNKNOWN,
            "声明里的 SoC 不在对照表内，未比对 GPU。")
        renderer.isNullOrEmpty() -> HardwareFact("gpu", "GPU 驱动与 SoC 声明", FactState.UNKNOWN,
            "没有取得实测 GL 渲染器字符串，未比对。")
        declared.second.gpu.any { renderer.contains(it) } -> HardwareFact("gpu", "GPU 驱动与 SoC 声明", FactState.CONFIRMED,
            "实测渲染器与 ${declared.second.label} 声明的 GPU 家族一致。")
        else -> HardwareFact("gpu", "GPU 驱动与 SoC 声明", FactState.CONFLICT,
            "声明为 ${declared.second.label}（应为 ${declared.second.gpu.joinToString(" / ")}），实测渲染器为 ${renderer}。")
    }

    val capacity = read("cpu.cpuCapacity")?.trim()?.takeIf { it.isNotEmpty() }
    facts += when {
        capacity == null -> HardwareFact("capacity", "CPU 算力权重与 SoC 声明", FactState.UNKNOWN,
            "没有读到 cpu_capacity，未比对算力权重。")
        declared == null -> HardwareFact("capacity", "CPU 算力权重与 SoC 声明", FactState.UNKNOWN,
            "声明里的 SoC 不在对照表内，未比对算力权重。")
        declared.second.capacities == capacity -> HardwareFact("capacity", "CPU 算力权重与 SoC 声明", FactState.CONFIRMED,
            "实测算力权重 $capacity 与 ${declared.second.label} 的登记值一致。")
        else -> {
            val other = foreignProfileMatch(declared.first, capacity) { it.capacities }
            if (other != null) HardwareFact("capacity", "CPU 算力权重与 SoC 声明", FactState.CONFLICT,
                "声明为 ${declared.second.label}（${declared.first}），实测算力权重 $capacity 与 ${other.label} 的登记值一致。")
            else HardwareFact("capacity", "CPU 算力权重与 SoC 声明", FactState.UNKNOWN,
                "实测算力权重 $capacity 不在对照表内，未比对。")
        }
    }

    val cma = read("memory.cmaTotal")?.trim()?.let { Regex("^([0-9]+) MiB$").find(it)?.groupValues?.get(1)?.toIntOrNull() }
    val cmaText = cma?.let { "$it MiB" }
    facts += when {
        cma == null -> HardwareFact("cma", "连续内存池与 SoC 声明", FactState.UNKNOWN,
            "没有读到 CmaTotal，未比对预留连续内存。")
        declared == null -> HardwareFact("cma", "连续内存池与 SoC 声明", FactState.UNKNOWN,
            "声明里的 SoC 不在对照表内，未比对预留连续内存。")
        declared.second.cmaMiB == cma -> HardwareFact("cma", "连续内存池与 SoC 声明", FactState.CONFIRMED,
            "实测预留连续内存 $cmaText 与 ${declared.second.label} 的登记值一致。")
        else -> {
            val other = foreignProfileMatch(declared.first, cmaText) { it.cmaMiB?.let { size -> "$size MiB" } }
            if (other != null) HardwareFact("cma", "连续内存池与 SoC 声明", FactState.CONFLICT,
                "声明为 ${declared.second.label}（${declared.first}），实测预留连续内存 $cmaText 与 ${other.label} 的登记值一致。")
            else HardwareFact("cma", "连续内存池与 SoC 声明", FactState.UNKNOWN,
                "实测预留连续内存 $cmaText 不在对照表内，未比对。")
        }
    }

    return HardwareFacts(facts)
}
