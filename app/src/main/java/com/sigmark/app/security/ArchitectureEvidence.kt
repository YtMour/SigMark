package com.sigmark.app.security

import java.util.Locale

internal enum class ArchitectureState { CONFLICT, COMPATIBLE, INSUFFICIENT }

internal val architectureKeys = listOf("cpu.processBitness", "cpu.abis", "cpu.kernelMachine")

internal fun architectureEvidence(process: String?, abis: String?, machine: String?): ArchitectureState {
    val bits = when (process?.trim()) { "32" -> 32; "64" -> 64; else -> return ArchitectureState.INSUFFICIENT }
    val widths = abis?.split(',')?.map { abi ->
        when (abi.trim().lowercase(Locale.ROOT)) {
            "armeabi", "armeabi-v7a", "x86", "mips", "riscv32" -> 32
            "arm64-v8a", "x86_64", "mips64", "riscv64" -> 64
            else -> null
        }
    }.orEmpty()
    val kernel = when (machine?.trim()?.lowercase(Locale.ROOT)) {
        "armv7l", "armv8l", "i386", "i486", "i586", "i686", "mips", "riscv32" -> 32
        "aarch64", "arm64", "x86_64", "mips64", "riscv64" -> 64
        else -> null
    }
    // Native bridge may translate instruction sets and 64-bit kernels can run
    // 32-bit processes. 32-bit with only 64-bit declared ABIs is left uncertain.
    if (bits == 64 && (kernel == 32 || (widths.isNotEmpty() && widths.all { it == 32 })))
        return ArchitectureState.CONFLICT
    return if (kernel != null && widths.contains(bits)) ArchitectureState.COMPATIBLE else ArchitectureState.INSUFFICIENT
}
