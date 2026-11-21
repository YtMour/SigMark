package com.sigmark.app.lan

import com.sigmark.app.model.DeviceSnapshot
import org.junit.Assert.*
import org.junit.Test

class SampleUploadTest {
    private fun fresh(time: Long = 1) = SampleUpload(lanReport(DeviceSnapshot(time, emptyList()), "0.18.1", ""), false)

    @Test fun retryFreezesTheOriginalBodyAndAssociation() {
        val ready = fresh().edit(feedback = "  fixture  ", linked = true)
        val sending = requireNotNull(ready.begin())
        assertNull(sending.begin())
        val failed = sending.copy(sending = false, error = "no reply")
        assertEquals(failed, failed.edit(feedback = "different", linked = false))
        val retry = requireNotNull(failed.begin())
        assertEquals(sending, retry)
        assertEquals("fixture", retry.report.feedback)
        assertEquals(ready.report.requestId, retry.report.requestId)
    }

    @Test fun receiptCannotBeResentAndNewCollectionHasNewIdentity() {
        val sent = requireNotNull(fresh().begin()).copy(sending = false, receipt = UploadReceipt("stored", false))
        assertNull(sent.begin())
        assertEquals(sent, sent.edit(linked = true))
        assertNotEquals(sent.report.requestId, fresh(2).report.requestId)
    }
}
