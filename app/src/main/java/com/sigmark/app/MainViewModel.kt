package com.sigmark.app

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.sigmark.app.collector.DeviceRepository
import com.sigmark.app.collector.SecurityObservations
import com.sigmark.app.collector.CapturePlan
import com.sigmark.app.collector.captureLocalExperiments
import com.sigmark.app.collector.probeGraphics
import com.sigmark.app.collector.probeMediaDecode
import com.sigmark.app.collector.RouteCheck
import com.sigmark.app.collector.routeEvidence
import com.sigmark.app.collector.UsbCheck
import com.sigmark.app.collector.GnssCheck
import com.sigmark.app.collector.gnssEvidence
import com.sigmark.app.collector.usbEvidence
import com.sigmark.app.model.DeviceSnapshot
import com.sigmark.app.model.DeviceInfoItem
import com.sigmark.app.model.ValueStatus
import com.sigmark.app.model.ReadReason
import com.sigmark.app.lan.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

data class MainUiState(
    val snapshot: DeviceSnapshot? = null,
    val refreshing: Boolean = false,
    val testingKey: Boolean = false,
    val error: String? = null,
    val fullStage: Int = 0,
    val saving: Boolean = false,
    val captureSecurityReady: Boolean = false,
)

class MainViewModel(application: Application) : AndroidViewModel(application) {
    private val repository = DeviceRepository(application.applicationContext)
    private val mutableState = MutableStateFlow(MainUiState())
    val state = mutableState.asStateFlow()
    private val endpoint = lanEndpoint(BuildConfig.LAN_ORIGIN)
    private val mutableUpload = MutableStateFlow<SampleUpload?>(null)
    internal val upload = mutableUpload.asStateFlow()
    private val shelf = endpoint?.let { ReportShelf(application, it.toString()) }
    private val mutableSaved = MutableStateFlow<List<SavedSample>>(emptyList())
    internal val saved = mutableSaved.asStateFlow()
    private var currentId: String? = null
    private val shelfIO = Dispatchers.IO.limitedParallelism(1)
    private var accessRefresh: kotlinx.coroutines.Job? = null

    private fun busy() = mutableState.value.let { it.refreshing || it.testingKey || it.saving } || mutableUpload.value?.sending == true

    fun refreshForAccessChange() {
        accessRefresh?.cancel()
        accessRefresh = viewModelScope.launch {
            // Settings may return while an earlier capture is still completing.
            while (busy()) kotlinx.coroutines.delay(100)
            refresh()
        }
    }

    init {
        viewModelScope.launch {
            refresh()
            try { reloadShelf() } catch (e: Exception) {
                if (e is CancellationException) throw e
                mutableState.value = mutableState.value.copy(error = "本机报告暂时打不开，请重新打开应用。")
            }
        }
    }

    private suspend fun reloadShelf() {
        mutableSaved.value = withContext(shelfIO) { shelf?.list().orEmpty() }
    }

    private suspend fun saveSample(snapshot: DeviceSnapshot): String? {
        val store = shelf ?: return null
        val id = withContext(Dispatchers.IO) {
            val report = lanReport(snapshot, BuildConfig.VERSION_NAME, "")
            store.add(SampleUpload(report, AssetIdentity.optedIn(getApplication(), requireNotNull(endpoint))))
            report.requestId
        }
        currentId = id
        reloadShelf()
        return id
    }

    fun refresh(refreshRadio: Boolean = false, decorate: (DeviceSnapshot) -> DeviceSnapshot = { it }) {
        if (busy()) return
        viewModelScope.launch {
            mutableState.value = mutableState.value.copy(refreshing = true, error = null)
            try {
                val snapshot = withContext(Dispatchers.IO) { repository.collect(refreshRadio) }
                val complete = decorate(snapshot)
                if (refreshRadio) saveSample(complete) else currentId = null
                mutableState.value = MainUiState(snapshot = complete)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                mutableState.value = mutableState.value.copy(refreshing = false,
                    error = "采集失败：${e.javaClass.simpleName}")
            }
        }
    }

    fun testKey(decorate: (DeviceSnapshot) -> DeviceSnapshot) {
        val state = mutableState.value
        val captured = state.snapshot ?: return
        if (busy()) return
        mutableState.value = state.copy(testingKey = true)
        viewModelScope.launch {
            try {
                val next = decorate(withKey(captured))
                saveSample(next)
                mutableState.value = state.copy(snapshot = next, error = null)
            } catch (e: CancellationException) { throw e }
            catch (e: Exception) { mutableState.value = state.copy(error = "本次安全自测未保存，请重试。") }
            finally { mutableState.value = mutableState.value.copy(testingKey = false) }
        }
    }

    private suspend fun withKey(snapshot: DeviceSnapshot): DeviceSnapshot {
        val item = withContext(Dispatchers.IO) {
            try { SecurityObservations.probeKey(getApplication()) }
            catch (e: CancellationException) { throw e }
            catch (e: Exception) { DeviceInfoItem("keyProtection", "临时密钥保护级别", null, "AndroidKeyStore / KeyInfo",
                ValueStatus.ERROR, "自测未完成：" + e.javaClass.simpleName, ReadReason.READ_FAILED) }
        }
        return snapshot.copy(sections = snapshot.sections.map {
            if (it.key == "environment") it.copy(items = it.items.filterNot { p -> p.key == item.key } + item) else it
        })
    }

    internal fun collectAll(decorate: (DeviceSnapshot) -> DeviceSnapshot, plan: CapturePlan = CapturePlan.FULL, route: RouteCheck? = null, usb: UsbCheck? = null, gnss: GnssCheck? = null) {
        if (plan == CapturePlan.GNSS && gnss == null) return
        if (busy()) return
        mutableState.value = mutableState.value.copy(refreshing = true, fullStage = 1, error = null)
        viewModelScope.launch {
            try {
                val fresh = withContext(Dispatchers.IO) { repository.collect(refreshRadio = true) }
                val tested = if (plan.runsKeyCheck) {
                    mutableState.value = mutableState.value.copy(fullStage = 2)
                    withKey(fresh)
                } else fresh
                val result = captureLocalExperiments(tested, plan,
                    decode = {
                        mutableState.value = mutableState.value.copy(fullStage = 3)
                        withContext(Dispatchers.IO) { probeMediaDecode(getApplication()) }
                    },
                    graphics = {
                        mutableState.value = mutableState.value.copy(fullStage = 4)
                        withContext(Dispatchers.IO) { probeGraphics() }
                    })
                val complete = decorate(when {
                    gnss != null -> gnssEvidence(result,gnss)
                    usb != null -> usbEvidence(result,usb)
                    route != null -> routeEvidence(result,route)
                    else -> result
                })
                mutableState.value = mutableState.value.copy(fullStage = 5)
                val saveError = try {
                    saveSample(complete)
                    null
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    if (plan != CapturePlan.FULL) throw e
                    currentId = null
                    "安全检查已完成，本机报告保存失败。可在首页导出当前采样。"
                }
                mutableState.value = MainUiState(snapshot = complete, error = saveError,
                    captureSecurityReady = plan == CapturePlan.FULL)
            } catch (e: CancellationException) { throw e }
            catch (e: Exception) { mutableState.value = mutableState.value.copy(refreshing = false, fullStage = 0,
                error = "本次整体获取未完成，未上传：" + e.javaClass.simpleName) }
        }
    }

    // A passive launch/permission refresh updates the inspector only. The first manual
    // upload may adopt that snapshot when the shelf is empty.
    internal fun selectReport(id: String?, snapshot: DeviceSnapshot?) {
        if (busy()) return
        mutableUpload.value = null
        mutableState.value = mutableState.value.copy(saving = true, error = null)
        viewModelScope.launch {
            try {
                val selected = id ?: currentId ?: snapshot?.let { saveSample(it) } ?: return@launch
                mutableUpload.value = withContext(shelfIO) { shelf?.get(selected) }
            } catch (e: CancellationException) { throw e }
            catch (e: Exception) { mutableState.value = mutableState.value.copy(error = "读取本机报告失败，请重试。") }
            finally { mutableState.value = mutableState.value.copy(saving = false) }
        }
    }

    internal fun removeReport(id: String) {
        if (busy()) return
        mutableState.value = mutableState.value.copy(saving = true)
        viewModelScope.launch {
            try {
                withContext(shelfIO) { shelf?.remove(id) }
                if (id == currentId) currentId = null
                if (id == mutableUpload.value?.report?.requestId) mutableUpload.value = null
                reloadShelf()
            } catch (e: CancellationException) { throw e }
            catch (e: Exception) { mutableState.value = mutableState.value.copy(error = "删除本机报告失败，请重试。") }
            finally { mutableState.value = mutableState.value.copy(saving = false) }
        }
    }

    internal fun setFeedback(text: String) { mutableUpload.value?.edit(feedback = text)?.let(::editDraft) }
    private fun editDraft(draft: SampleUpload) {
        if (draft.attempted || draft == mutableUpload.value) return
        mutableUpload.value = draft
        viewModelScope.launch {
            try { withContext(shelfIO) { shelf?.edit(draft) } }
            catch (e: CancellationException) { throw e }
            catch (e: Exception) { mutableState.value = mutableState.value.copy(error = "本次备注或关联选择未保存，请重试。") }
        }
    }
    internal fun setAssociation(link: Boolean) {
        val target = endpoint ?: return
        val draft = mutableUpload.value ?: return
        if (draft.attempted) return
        editDraft(draft.edit(linked = link))
        AssetIdentity.saveChoice(getApplication(),target,link)
    }
    internal fun submitUpload() {
        val target = endpoint ?: return
        val store = shelf ?: return
        val attempt = mutableUpload.value?.begin() ?: return
        mutableUpload.value = attempt
        viewModelScope.launch {
            try {
                val bytes = withContext(shelfIO) { store.freeze(attempt) }
                val receipt = withContext(Dispatchers.IO) {
                    val received = sendLanReport(target, bytes, if (attempt.associate) AssetIdentity.key(getApplication(),target) else null)
                    store.finish(attempt.report.requestId, received)
                    received
                }
                mutableUpload.value = attempt.copy(sending = false, receipt = receipt)
                mutableSaved.value = mutableSaved.value.map { if (it.id == attempt.report.requestId) it.copy(sent = true) else it }
            } catch (e: CancellationException) { throw e }
            catch (e: Exception) { mutableUpload.value = attempt.copy(sending = false, error =
                if (e is LanFailure) e.message.orEmpty() else "报告已保存在手机。请连接后台所在的 Wi-Fi，再上传这份报告。") }
        }
    }
}
