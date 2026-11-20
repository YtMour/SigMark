package com.sigmark.app

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.sigmark.app.collector.DeviceRepository
import com.sigmark.app.model.DeviceSnapshot
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

data class MainUiState(
    val snapshot: DeviceSnapshot? = null,
    val refreshing: Boolean = false,
    val error: String? = null,
)

class MainViewModel(application: Application) : AndroidViewModel(application) {
    private val repository = DeviceRepository(application.applicationContext)
    private val mutableState = MutableStateFlow(MainUiState())
    val state = mutableState.asStateFlow()

    init { refresh() }

    fun refresh() {
        if (mutableState.value.refreshing) return
        viewModelScope.launch {
            mutableState.value = mutableState.value.copy(refreshing = true, error = null)
            try {
                val snapshot = withContext(Dispatchers.IO) { repository.collect() }
                mutableState.value = MainUiState(snapshot = snapshot)
            } catch (e: Exception) {
                mutableState.value = mutableState.value.copy(refreshing = false,
                    error = "采集失败：${e.javaClass.simpleName}")
            }
        }
    }
}
