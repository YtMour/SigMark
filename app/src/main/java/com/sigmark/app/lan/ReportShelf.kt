package com.sigmark.app.lan

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import org.json.JSONObject

internal data class SavedSample(val id: String, val time: Long, val network: String, val sent: Boolean)

internal fun networkLabel(value: String) = when (value) {
    "wifi" -> "Wi-Fi"
    "cellular" -> "移动网络"
    "ethernet" -> "有线网络"
    "vpn" -> "VPN"
    "none" -> "无默认网络"
    else -> "网络未确认"
}

// Keep only the projected LAN payload. Each destination owns a separate set of drafts.
internal class ReportShelf(context: Context, private val origin: String) :
    SQLiteOpenHelper(context, "lan-samples.db", null, 1) {
    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("""CREATE TABLE samples (
            id TEXT PRIMARY KEY, origin TEXT NOT NULL, captured INTEGER NOT NULL, network TEXT NOT NULL,
            body TEXT NOT NULL, associated INTEGER NOT NULL, attempted INTEGER NOT NULL DEFAULT 0,
            receipt TEXT, linked INTEGER, draft_note TEXT)""")
        db.execSQL("CREATE INDEX by_destination ON samples(origin,captured DESC)")
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) = error("Unknown shelf version")

    fun list(): List<SavedSample> = readableDatabase.rawQuery(
        "SELECT id,captured,network,receipt FROM samples WHERE origin=? ORDER BY captured DESC,rowid DESC",
        arrayOf(origin)
    ).use { rows -> buildList {
        while (rows.moveToNext()) add(SavedSample(rows.getString(0),rows.getLong(1),rows.getString(2),!rows.isNull(3)))
    } }

    fun add(draft: SampleUpload) {
        val report = draft.report
        writableDatabase.insertOrThrow("samples", null, ContentValues().apply {
            put("id",report.requestId); put("origin",origin); put("captured",report.capturedAt)
            put("network",report.network); put("body",report.json().toString(Charsets.UTF_8))
            put("associated",draft.associate)
        })
    }

    fun get(id: String): SampleUpload = readableDatabase.rawQuery(
        "SELECT body,associated,attempted,receipt,linked,draft_note FROM samples WHERE id=? AND origin=?", arrayOf(id,origin)
    ).use { row ->
        require(row.moveToFirst())
        val value = JSONObject(row.getString(0))
        val report = restoreReport(value)
        SampleUpload(if (!row.isNull(5) && row.getInt(2)==0) report.copy(feedback=row.getString(5)) else report, row.getInt(1)!=0, attempted=row.getInt(2)!=0,
            receipt=if (row.isNull(3)) null else UploadReceipt(row.getString(3), if (row.isNull(4)) null else row.getInt(4)!=0))
    }

    fun edit(draft: SampleUpload) {
        writableDatabase.update("samples", ContentValues().apply {
            put("draft_note", draft.report.feedback); put("associated", draft.associate)
        }, "id=? AND origin=? AND attempted=0", arrayOf(draft.report.requestId,origin))
    }

    // Freeze exact wire bytes, request ID and consent durably before opening the socket.
    fun freeze(attempt: SampleUpload): ByteArray {
        val id = attempt.report.requestId
        val db = writableDatabase
        db.beginTransaction()
        try {
            val bytes = db.rawQuery("SELECT body,attempted,receipt FROM samples WHERE id=? AND origin=?", arrayOf(id,origin)).use { row ->
                check(row.moveToFirst() && row.isNull(2))
                if (row.getInt(1)!=0) row.getString(0).toByteArray(Charsets.UTF_8) else {
                    val body = JSONObject(row.getString(0)).apply {
                        if (attempt.report.feedback.isEmpty()) remove("feedback") else put("feedback",attempt.report.feedback)
                    }.toString()
                    check(db.update("samples",ContentValues().apply {
                        put("body",body); put("associated",attempt.associate); put("attempted",1); putNull("draft_note")
                    },"id=? AND origin=?",arrayOf(id,origin))==1)
                    body.toByteArray(Charsets.UTF_8)
                }
            }
            db.setTransactionSuccessful()
            return bytes
        } finally { db.endTransaction() }
    }

    fun finish(id: String, receipt: UploadReceipt) {
        check(writableDatabase.update("samples",ContentValues().apply {
            put("receipt",receipt.id); put("linked",receipt.assetLinked)
        },"id=? AND origin=?",arrayOf(id,origin))==1)
    }

    fun remove(id: String) {
        writableDatabase.delete("samples","id=? AND origin=?",arrayOf(id,origin))
    }
}

private fun restoreReport(data: JSONObject): LanReport {
    require(data.getInt("schemaVersion")==4)
    fun JSONObject.optional(key: String): String? = if(isNull(key)) null else getString(key)
    fun <T> rows(key: String, decode: (JSONObject)->T): List<T> {
        val array=data.getJSONArray(key)
        return List(array.length()) { decode(array.getJSONObject(it)) }
    }
    return LanReport(data.getString("model"), data.getInt("androidApi"), data.getString("network"),
        data.getString("wifiBand"), data.getString("radio"), data.getLong("capturedAtEpochMs"), data.getString("appVersion"),
        rows("metrics") { LanMetric(it.getString("key"),it.getString("status"),it.optional("reason")) }, data.optString("feedback"),
        rows("parameters") { LanParameter(it.getString("group"),it.getString("key"),it.getString("label"),it.optional("value"),
            it.getString("source"),it.getString("status"),it.optional("reason"),if(it.isNull("errno")) null else it.getInt("errno"),it.optional("note")) },
        rows("coverage") { LanCoverage(it.getString("group"),it.getInt("available"),it.getInt("restricted"),it.getInt("unavailable"),it.getInt("errors")) },
        data.getString("requestId"))
}
