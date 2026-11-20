package com.sigmark.app.lan

import android.content.Context
import java.net.URI
import java.util.UUID

// App-private preferences; the app explicitly disables Android Backup.
internal fun assetIdentityScope(endpoint: URI) = "${endpoint.host}:${endpoint.port}"

internal object AssetIdentity {
    private fun prefs(context: Context) = context.getSharedPreferences("sigmark-lan-asset", Context.MODE_PRIVATE)

    fun optedIn(context: Context, target: URI) = prefs(context).getBoolean("opt:${assetIdentityScope(target)}", false)

    fun saveChoice(context: Context, target: URI, optedIn: Boolean) {
        prefs(context).edit().putBoolean("opt:${assetIdentityScope(target)}", optedIn).apply()
    }

    @Synchronized
    fun key(context: Context, target: URI): String {
        val prefs = prefs(context)
        val slot = "key:${assetIdentityScope(target)}"
        prefs.getString(slot, null)?.takeIf { raw ->
            runCatching { UUID.fromString(raw).let { it.version() == 4 && it.toString() == raw } }.getOrDefault(false)
        }?.let { return it }
        val next = UUID.randomUUID().toString()
        check(prefs.edit().putString(slot, next).commit())
        return next
    }
}
