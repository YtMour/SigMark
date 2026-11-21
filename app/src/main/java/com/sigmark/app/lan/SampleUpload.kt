package com.sigmark.app.lan

// One frozen projection per sampling revision, owned by the ViewModel, not by the dialog.
internal data class UploadReceipt(val id: String, val assetLinked: Boolean?)

internal data class SampleUpload(
    val report: LanReport,
    val associate: Boolean,
    val attempted: Boolean = false,
    val sending: Boolean = false,
    val receipt: UploadReceipt? = null,
    val error: String = "",
) {
    fun edit(feedback: String = report.feedback, linked: Boolean = associate): SampleUpload =
        if (attempted || !validFeedback(feedback)) this else copy(report = report.copy(feedback = feedback), associate = linked)

    fun begin(): SampleUpload? = if (sending || receipt != null) null else
        copy(report = report.copy(feedback = report.feedback.trim()), attempted = true, sending = true, error = "")
}
