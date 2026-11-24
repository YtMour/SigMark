package com.sigmark.app.collector

import android.os.Build
import android.view.InputDevice
import com.sigmark.app.model.ReadReason
import com.sigmark.app.model.normalizeValue
import java.util.Locale

private val machineName = Regex("[a-z0-9_+-]{1,32}")
internal fun kernelMachineName(raw: String?): String? =
    normalizeValue(raw)?.lowercase(Locale.ROOT)?.takeIf(machineName::matches)

@Suppress("DEPRECATION") // Static InputDevice queries use the calling process's input view; no extra permissions.
internal fun externalInputTypes(): ReadResult<String> {
    val source = "InputDevice.getDeviceIds / isExternal / supportsSource"
    if (Build.VERSION.SDK_INT < 29) {
        return SafeReader.missing(source, ReadReason.INTERFACE_UNSUPPORTED,
            "判定外接输入设备的公开接口从 API 29 开始提供。")
    }
    return SafeReader.read(source,
        "仅记录可见外设类别，不保存名称、标识或输入内容；none 表示未观察到以下类别。") {
        val types = mutableSetOf<String>()
        for (id in InputDevice.getDeviceIds()) {
            val d = InputDevice.getDevice(id) ?: continue // May have disconnected during sampling.
            if (!d.isExternal || d.isVirtual) continue
            if (d.keyboardType == InputDevice.KEYBOARD_TYPE_ALPHABETIC && d.supportsSource(InputDevice.SOURCE_KEYBOARD)) types += "keyboard"
            if (d.supportsSource(InputDevice.SOURCE_MOUSE) || d.supportsSource(InputDevice.SOURCE_TOUCHPAD)) types += "pointer"
            if (d.supportsSource(InputDevice.SOURCE_GAMEPAD) || d.supportsSource(InputDevice.SOURCE_JOYSTICK)) types += "gamepad"
        }
        listOf("keyboard", "pointer", "gamepad").filter(types::contains).joinToString(" / ").ifEmpty { "none" }
    }
}
