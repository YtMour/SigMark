package com.sigmark.app

import com.sigmark.app.model.DeviceInfoItem
import com.sigmark.app.model.ReadReason
import com.sigmark.app.model.ValueStatus
import org.junit.Assert.*
import org.junit.Test

class CollectionAccessTest {
    private val denied = CollectionAccess(false, false, false, false)
    private fun row(key: String, reason: ReadReason, status: ValueStatus = ValueStatus.RESTRICTED) =
        DeviceInfoItem(key, key, null, "fixture", status, reason = reason)

    @Test fun perFieldActionWorksWhenSearchHidesOtherRows() {
        val need = ReadReason.PERMISSION_REQUIRED
        assertEquals(AccessAction.PHONE, collectionAction(29,"cellular", row("dataRat", need), denied))
        assertEquals(AccessAction.PHONE, collectionAction(28,"cellular", row("defaultDataSlot", need), denied))
        assertEquals(AccessAction.FINE, collectionAction(29,"cellular", row("cellLTEBandwidth", need), denied))
        val slot = row("slotService", need)
        assertEquals(AccessAction.PHONE, collectionAction(29,"cellular", slot, denied))
        assertEquals(AccessAction.FINE, collectionAction(29,"cellular", slot, denied.copy(phone = true, coarse = true)))
        assertEquals(AccessAction.LOCATION, collectionAction(29,"cellular", slot, denied.copy(phone = true, fine = true)))
    }

    @Test fun modernServiceStateUsesNoLocationAndDoesNotAskForFine() {
        val slot = row("slotService", ReadReason.PERMISSION_REQUIRED)
        assertEquals(AccessAction.PHONE, collectionAction(34,"cellular", slot, denied))
        assertEquals(AccessAction.RECHECK, collectionAction(34,"cellular", slot, denied.copy(phone = true)))
        assertNull(collectionAction(34,"cellular", row("dataRat",ReadReason.ACCESS_DENIED), denied))
    }

    @Test fun policyDenialAndMissingDataHaveNoRuntimeRequest() {
        assertNull(collectionAction(29,"system", row("selinux",ReadReason.ACCESS_DENIED), denied))
        assertNull(collectionAction(29,"cellular", row("slotService",ReadReason.ACCESS_DENIED), denied))
        assertNull(collectionAction(29,"cellular", row("cellLTEBandwidth",ReadReason.INTERFACE_UNSUPPORTED,ValueStatus.UNAVAILABLE), denied))
    }

    @Test fun requestAndSettingsPathsRespectPriorUserChoice() {
        assertEquals(PermissionRoute.REQUEST, permissionRoute(false,false,false,false))
        assertEquals(PermissionRoute.REQUEST, permissionRoute(false,true,true,false))
        assertEquals(PermissionRoute.SETTINGS, permissionRoute(false,true,false,false))
        assertEquals(PermissionRoute.SETTINGS, permissionRoute(false,true,true,true))
        assertEquals(PermissionRoute.RECHECK, permissionRoute(true,true,false,false))
    }
}
