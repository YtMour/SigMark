package com.sigmark.app

import android.Manifest
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.content.ClipData
import android.content.ClipboardManager
import android.content.ActivityNotFoundException
import android.os.Build
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.displayCutout
import androidx.compose.foundation.layout.systemBars
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.Button
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.ui.res.painterResource
import androidx.compose.foundation.Image
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.sigmark.app.model.DeviceInfoItem
import com.sigmark.app.model.DeviceSection
import com.sigmark.app.model.DeviceSnapshot
import com.sigmark.app.model.ReadReason
import com.sigmark.app.model.unavailableLabel
import com.sigmark.app.model.ValueStatus
import com.sigmark.app.collector.CapturePlan
import com.sigmark.app.collector.RouteCheck
import com.sigmark.app.lan.SavedSample
import com.sigmark.app.lan.SavedReportsDialog
import com.sigmark.app.lan.networkLabel
import com.sigmark.app.lan.SampleUpload
import com.sigmark.app.lan.LanReportDialog
import com.sigmark.app.lan.AppUpdate
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

private val Ink = Color(0xFF09151B)
private val CardColor = Color(0xFF11232B)
private val PanelRaised = Color(0xFF172D35)
private val Teal = Color(0xFF7CE7D2)
private val Muted = Color(0xFFACBEC2)
private val Stroke = Color(0xFF294149)

class MainActivity : ComponentActivity() {
    private val viewModel: MainViewModel by viewModels()
    private var access by mutableStateOf(CollectionAccess(false, false, false, null))
    private var permissionFeedback by mutableStateOf<String?>(null)
    private val permissionHistory by lazy { getSharedPreferences("network-permission-rationales", MODE_PRIVATE) }

    private val cellPermission = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        onAccessResult(Manifest.permission.ACCESS_FINE_LOCATION)
    }
    private val diagnosticSettings = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) {
        access = CollectionAccess.read(this)
        permissionFeedback = null
        viewModel.refreshForAccessChange()
    }
    private val phonePermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) {
        onAccessResult(Manifest.permission.READ_PHONE_STATE)
    }

    override fun onResume() {
        super.onResume()
        val current = CollectionAccess.read(this)
        if (access != current) {
            access = current
            viewModel.refreshForAccessChange()
        }
    }

    private fun onAccessResult(permission: String) {
        access = CollectionAccess.read(this)
        if (shouldShowRequestPermissionRationale(permission))
            permissionHistory.edit().putBoolean(permission, true).apply()
        permissionFeedback = when (permission) {
            Manifest.permission.ACCESS_FINE_LOCATION -> when {
                access.fine -> if (access.location == false) "精确位置已授权；小区参数还需要开启系统位置。" else "精确位置已授权，正在更新采集列表。"
                access.coarse -> "当前只允许大致位置。查看小区频段需要精确位置，可在应用权限设置中调整。"
                else -> "精确位置未授权，基础采集仍可使用。"
            }
            else -> if (access.phone) "电话状态已授权，正在更新采集列表。" else "电话状态未授权，基础采集仍可使用。"
        }
        viewModel.refreshForAccessChange()
    }

    private fun openDiagnosticSettings(intent: Intent) {
        try { diagnosticSettings.launch(intent) }
        catch (_: ActivityNotFoundException) {
            permissionFeedback = "当前系统未提供此设置入口，请从系统设置手动打开。"
        } catch (_: SecurityException) {
            permissionFeedback = "当前系统拒绝打开此页面，请从系统设置手动进入。"
        }
    }

    private fun openAppSettings() = openDiagnosticSettings(
        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", packageName, null)))

    private fun requestNetworkPermission(permission: String) {
        access = CollectionAccess.read(this)
        val route = permissionRoute(
            granted = checkSelfPermission(permission) == android.content.pm.PackageManager.PERMISSION_GRANTED,
            wasDenied = permissionHistory.getBoolean(permission, false),
            rationale = shouldShowRequestPermissionRationale(permission),
            approximateOnly = permission == Manifest.permission.ACCESS_FINE_LOCATION && !access.fine && access.coarse,
        )
        when (route) {
            PermissionRoute.RECHECK -> viewModel.refreshForAccessChange()
            PermissionRoute.SETTINGS -> openAppSettings()
            PermissionRoute.REQUEST -> {
                if (permission == Manifest.permission.ACCESS_FINE_LOCATION)
                    cellPermission.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION))
                else phonePermission.launch(Manifest.permission.READ_PHONE_STATE)
            }
        }
    }
    private var pendingExport: String? = null
    private val createDocument = registerForActivityResult(
        ActivityResultContracts.CreateDocument("application/json")
    ) { uri ->
        val json = pendingExport
        pendingExport = null
        if (uri != null && json != null) {
            try {
                contentResolver.openOutputStream(uri)?.use { stream ->
                    stream.write(json.toByteArray(Charsets.UTF_8))
                } ?: error("打开文件失败")
                Toast.makeText(this, "JSON 报告已保存", Toast.LENGTH_SHORT).show()
            } catch (e: Exception) {
                Toast.makeText(this, "导出失败：${e.javaClass.simpleName}", Toast.LENGTH_LONG).show()
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        @Suppress("DEPRECATION")
        window.statusBarColor = Ink.toArgb()
        @Suppress("DEPRECATION")
        window.navigationBarColor = Ink.toArgb()
        @Suppress("DEPRECATION")
        window.decorView.systemUiVisibility = 0
        setContent {
            MaterialTheme(colorScheme = darkColorScheme(
                primary = Teal, onPrimary = Ink, background = Ink,
                surface = CardColor, onSurface = Color.White,
            )) {
                val state by viewModel.state.collectAsStateWithLifecycle()
                val upload by viewModel.upload.collectAsStateWithLifecycle()
                val saved by viewModel.saved.collectAsStateWithLifecycle()
                val decorate = windowDecorator()
                val screenState = remember(state, decorate) { state.copy(snapshot = state.snapshot?.let(decorate)) }
                SigMarkScreen(screenState, upload, saved, { viewModel.collectAll(decorate, it) }, viewModel::selectReport, viewModel::removeReport, viewModel::setAssociation,
                    viewModel::setFeedback, viewModel::submitUpload, onTestKey = { viewModel.testKey(decorate) }, onRefresh = { viewModel.refresh(refreshRadio = true, decorate = decorate) },
                    onRoute = { viewModel.collectAll(decorate, CapturePlan.NETWORK, it) },
                    onUsb = { viewModel.collectAll(decorate, CapturePlan.USB, usb=it) },
                    onGnss = { viewModel.collectAll(decorate, CapturePlan.GNSS, gnss=it) },
                    access = access, permissionFeedback = permissionFeedback, onCellPermission = {
                    requestNetworkPermission(Manifest.permission.ACCESS_FINE_LOCATION)
                }, onAppSettings = ::openAppSettings, onLocationSettings = {
                    openDiagnosticSettings(Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS))
                }, onPhonePermission = {
                    requestNetworkPermission(Manifest.permission.READ_PHONE_STATE)
                }, onTimelineExport = { json ->
                    pendingExport = json
                    createDocument.launch("SigMark-network-${System.currentTimeMillis()}.json")
                }, onExport = { snapshot ->
                    pendingExport = snapshot.toJson()
                    createDocument.launch("SigMark-${SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US).format(Date(snapshot.collectedAt))}.json")
                })
            }
        }
    }
}

@Composable
private fun SigMarkScreen(
    state: MainUiState, upload: SampleUpload?, saved: List<SavedSample>, onCollectAll: (CapturePlan) -> Unit,
    onOpenUpload: (String?, DeviceSnapshot?) -> Unit, onRemove: (String) -> Unit,
    onAssociate: (Boolean) -> Unit, onFeedback: (String) -> Unit, onSubmit: () -> Unit,
    onTestKey: () -> Unit,
    onRefresh: () -> Unit,
    onRoute: (RouteCheck) -> Unit,
    onUsb: (com.sigmark.app.collector.UsbCheck) -> Unit,
    onGnss: (com.sigmark.app.collector.GnssCheck) -> Unit,
    access: CollectionAccess,
    permissionFeedback: String?,
    onCellPermission: () -> Unit,
    onAppSettings: () -> Unit,
    onLocationSettings: () -> Unit,
    onPhonePermission: () -> Unit,
    onTimelineExport: (String) -> Unit,
    onExport: (DeviceSnapshot) -> Unit,
) {
    var query by rememberSaveable { mutableStateOf("") }
    var selected by rememberSaveable { mutableStateOf("all") }
    var issuesOnly by rememberSaveable { mutableStateOf(false) }
    var hardwareOnly by rememberSaveable { mutableStateOf(false) }
    var showExportConfirmation by rememberSaveable { mutableStateOf(false) }
    var showCellExplanation by rememberSaveable { mutableStateOf(false) }
    var showSensors by rememberSaveable { mutableStateOf(false) }
    var showVisibleApps by rememberSaveable { mutableStateOf(false) }
    var showUpdate by remember { mutableStateOf(false) }
    var showTimeline by remember { mutableStateOf(false) }
    var showMediaProbe by rememberSaveable { mutableStateOf(false) }
    var showPlans by rememberSaveable { mutableStateOf(false) }
    var showRouteExperiment by rememberSaveable { mutableStateOf(false) }
    var showUsbExperiment by rememberSaveable { mutableStateOf(false) }
    var showGnssCheck by rememberSaveable { mutableStateOf(false) }
    var showConfigurationEvidence by rememberSaveable { mutableStateOf(false) }
    var showSecurity by rememberSaveable { mutableStateOf(false) }
    var showRecheck by rememberSaveable { mutableStateOf(false) }
    var showTools by remember { mutableStateOf(false) }
    var showPhoneExplanation by rememberSaveable { mutableStateOf(false) }
    val context = LocalContext.current
    var showUpload by rememberSaveable { mutableStateOf(false) }
    var showShelf by rememberSaveable { mutableStateOf(false) }
    val snapshot = state.snapshot
    val busy = state.refreshing || state.testingKey || state.saving || upload?.sending == true
    val lanEnabled = BuildConfig.DEBUG && BuildConfig.LAN_ORIGIN.isNotEmpty()
    val issueCount = snapshot?.sections?.sumOf { section ->
        section.items.count { it.status != ValueStatus.AVAILABLE }
    } ?: 0
    val hardware = remember(snapshot) {
        snapshot?.sections.orEmpty().flatMap { section -> section.items.filter {
            "${section.key}.${it.key}" in com.sigmark.app.collector.expandedHardwareKeys
        } }
    }
    val sections = remember(snapshot, query, selected, issuesOnly, hardwareOnly) {
        snapshot?.sections?.filter { selected == "all" || it.key == selected }
                    ?.mapNotNull { section ->
                val matches = section.items.filter { item ->
                    (!hardwareOnly || "${section.key}.${item.key}" in com.sigmark.app.collector.expandedHardwareKeys) &&
                    (!issuesOnly || item.status != ValueStatus.AVAILABLE) &&
                    (query.isBlank() || listOf(section.title, item.label, item.value.orEmpty(),
                        item.source, item.note.orEmpty(), item.status.name, item.key)
                        .any { it.contains(query.trim(), ignoreCase = true) }
                    )
                }
                if (matches.isEmpty()) null else section.copy(items = matches)
            }.orEmpty()
    }
    val listState = rememberLazyListState()
    val accessActions = snapshot?.sections.orEmpty().flatMap { section ->
        section.items.mapNotNull { collectionAction(Build.VERSION.SDK_INT, section.key, it, access) }
    }.toSet()
    val openAccessAction: (AccessAction) -> Unit = {
        when (it) {
            AccessAction.PHONE -> showPhoneExplanation = true
            AccessAction.FINE -> showCellExplanation = true
            AccessAction.LOCATION -> onLocationSettings()
            AccessAction.RECHECK -> showRecheck = true
        }
    }

    Scaffold(containerColor = Ink, topBar = { AppHeader(snapshot, busy, onRefresh, onExportRequest = { showExportConfirmation = true }) }) { padding ->
        LazyColumn(
            state = listState,
            modifier = Modifier.fillMaxSize().padding(padding),
            contentPadding = PaddingValues(bottom = 28.dp),
            verticalArrangement = Arrangement.spacedBy(11.dp),
        ) {
            item {
                Column(Modifier.padding(horizontal = 16.dp)) {
                    OverviewCard(snapshot)
                    if (snapshot == null && saved.isNotEmpty()) OutlinedButton(onClick = { showShelf = true }) { Text("上传报告") }
                    if (snapshot != null) {
                        Row(Modifier.fillMaxWidth().padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Button(enabled = !busy, onClick = { onCollectAll(CapturePlan.STANDARD) }, modifier = Modifier.weight(1f)) { Text("整体获取") }
                            if (lanEnabled) OutlinedButton(enabled = !busy, onClick = { showShelf = true }, modifier = Modifier.weight(1f)) {
                                Text("上传报告")
                            }
                        }
                        Text(when (state.fullStage) {
                            1 -> "正在采集设备参数"
                            2 -> "正在进行密钥保护自测"
                            3 -> "正在验证固定样片首帧"
                            4 -> "正在进行图形离屏回读实测"
                            else -> if (!lanEnabled) "采集设备与安全信息，结果只在本机查看。"
                                else saved.firstOrNull()?.let { "最近保存：" + networkLabel(it.network) + " · " +
                                    java.text.DateFormat.getTimeInstance().format(Date(it.time)) + "　待上传 " + saved.count { row -> !row.sent } + " 份" }
                                    ?: "先采集，再上传。换回 Wi-Fi 后也能上传之前的报告。"
                        }, color = Muted, fontSize = 12.sp)
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            OutlinedButton(enabled = !busy, onClick = { onCollectAll(CapturePlan.ROM) }, modifier = Modifier.weight(1f)) { Text("ROM 验收") }
                            OutlinedButton(enabled = !busy, onClick = { showRouteExperiment = true }, modifier = Modifier.weight(1f)) { Text("网络切换实验") }
                        }
                        if (hardware.isNotEmpty()) {
                            OutlinedButton(onClick = { hardwareOnly = !hardwareOnly; query = ""; issuesOnly = false; selected = "all" },
                                modifier = Modifier.fillMaxWidth()) {
                                Text(if (hardwareOnly) "返回全部采集项" else "查看扩展采集 · ${hardware.size} 项")
                            }
                            Text("扩展采集：${hardware.count { it.status == ValueStatus.AVAILABLE }} 项有值 / ${hardware.size} 项已记录；图形实测随 ROM 验收保存。",
                                color = Muted, fontSize = 12.sp)
                        }
                        TextButton(enabled = !busy, onClick = { showPlans = true }) { Text("选择验收方案") }
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                            TextButton(enabled = !busy, onClick = { showRecheck = true }, modifier = Modifier.weight(1f)) { Text("权限与复测") }
                            TextButton(onClick = { showSecurity = true }, modifier = Modifier.weight(1f)) { Text("指纹安全") }
                            Box(Modifier.weight(1f), contentAlignment = Alignment.Center) {
                                TextButton(onClick = { showTools = true }) { Text("更多工具") }
                                DropdownMenu(expanded = showTools, onDismissRequest = { showTools = false }) {
                                    DropdownMenuItem(text = { Text("链路记录") }, onClick = { showTools = false; showTimeline = true })
                                    if (lanEnabled) DropdownMenuItem(text = { Text("检查更新") }, onClick = { showTools = false; showUpdate = true })
                                    DropdownMenuItem(text = { Text("实时传感器") }, onClick = { showTools = false; showSensors = true })
                                    DropdownMenuItem(text = { Text("可见应用") }, onClick = { showTools = false; showVisibleApps = true })
                                    DropdownMenuItem(text = { Text("视频解码实测") }, onClick = { showTools = false; showMediaProbe = true })
                                    DropdownMenuItem(text = { Text("USB 插拔实验") }, onClick = { showTools = false; showUsbExperiment = true })
                                    DropdownMenuItem(text = { Text("GNSS 读数核对") }, onClick = { showTools = false; showGnssCheck = true })
                                    DropdownMenuItem(text = { Text("机器码与节点证据") }, onClick = { showTools = false; showConfigurationEvidence = true })
                                }
                            }
                        }
                    }
                    if (accessActions.any { it != AccessAction.RECHECK }) {
                        OutlinedButton(enabled = !busy, onClick = { showRecheck = true }, modifier = Modifier.fillMaxWidth()) {
                            Text("处理采集所需权限")
                        }
                    }
                    Spacer(Modifier.height(12.dp))
                    SearchBox(query, onChange = { query = it })
                    Spacer(Modifier.height(10.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("采集目录", color = Color.White, fontSize = 16.sp,
                            fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                        if (issueCount > 0) {
                            Surface(onClick = { issuesOnly = !issuesOnly; selected = "all" },
                                color = if (issuesOnly) Color(0xFFF4C589) else CardColor,
                                shape = RoundedCornerShape(9.dp),
                                border = BorderStroke(1.dp, if (issuesOnly) Color(0xFFF4C589) else Stroke)) {
                                Text(if (issuesOnly) "仅看待确认 · $issueCount" else "待确认 · $issueCount",
                                    color = if (issuesOnly) Ink else Color(0xFFF4C589),
                                    fontSize = 12.sp, modifier = Modifier.padding(horizontal = 11.dp, vertical = 8.dp))
                            }
                        }
                    }
                }
            }
            item {
                androidx.compose.foundation.lazy.LazyRow(
                    contentPadding = PaddingValues(horizontal = 16.dp),
                    horizontalArrangement = Arrangement.spacedBy(7.dp),
                ) {
                    item { CategoryChip("all", "全部", selected, onSelect = { selected = it }) }
                    snapshot?.sections?.sortedBy {
                        when (it.key) { "network" -> 0; "cellular" -> 1; else -> 2 }
                    }?.forEach { section ->
                        item { CategoryChip(section.key, section.title, selected,
                            onSelect = { selected = it }) }
                    }
                }
            }
            state.error?.let { error ->
                item { Text(error, color = Color(0xFFF4C589), modifier = Modifier.padding(horizontal = 16.dp)) }
            }
            if (snapshot == null && state.refreshing) {
                item {
                    Box(Modifier.fillMaxWidth().padding(42.dp), contentAlignment = Alignment.Center) {
                        CircularProgressIndicator(color = Teal)
                    }
                }
            } else if (sections.isEmpty()) {
                item {
                    Column(Modifier.padding(horizontal = 20.dp, vertical = 24.dp)) {
                        Text("没有匹配的采集项", color = Color.White, fontSize = 15.sp)
                        Spacer(Modifier.height(5.dp))
                        Text("可清除搜索、关闭待确认筛选或切换分类", color = Muted, fontSize = 12.sp)
                        TextButton(onClick = { query = ""; issuesOnly = false; hardwareOnly = false; selected = "all" }) {
                            Text("重置筛选", color = Teal)
                        }
                    }
                }
            } else {
                items(sections, key = { it.key }) { section ->
                    SectionCard(section, Modifier.padding(horizontal = 16.dp),
                        showAll = query.isNotBlank() || selected != "all" || issuesOnly || hardwareOnly,
                        access = access, busy = busy, onAccessAction = openAccessAction,
                        onGnssCheck = { showGnssCheck = true })
                }
            }
            item {
                Text("仅本机采集  /  点按字段查看来源，长按复制数值  /  无后台上传",
                    color = Muted, fontSize = 11.sp, lineHeight = 16.sp,
                    modifier = Modifier.padding(horizontal = 18.dp, vertical = 8.dp))
            }
        }
    }
    if (showExportConfirmation && snapshot != null) {
        AlertDialog(
            onDismissRequest = { showExportConfirmation = false },
            title = { Text("导出设备报告") },
            text = { Text("本地 JSON 含构建指纹、设备配置摘要、时区与语言、应用安装和签名信息、运营商及可用无线参数。请检查后再分享。实时传感器读数不写入报告。") },
            confirmButton = {
                TextButton(onClick = {
                    showExportConfirmation = false
                    onExport(snapshot)
                }) { Text("选择保存位置") }
            },
            dismissButton = {
                TextButton(onClick = { showExportConfirmation = false }) { Text("取消") }
            },
        )
    }
    if (showCellExplanation) AlertDialog(
        onDismissRequest = { showCellExplanation = false },
        title = { Text("查看小区无线参数") },
        text = { Column {
            Text("Android 将小区频段、信道号和信号视为位置相关信息，因此需要精确位置权限。印迹只读取系统的无线缓存，不读坐标、小区 ID 或邻区列表；授权本身不会上传。选择「暂不授权」仍可查看运营商及 Wi-Fi。")
            TextButton(onClick = { showCellExplanation = false; showRecheck = true; onAppSettings() }) { Text("打开应用权限设置") }
        } },
        confirmButton = { TextButton(onClick = { showCellExplanation = false; showRecheck = true; onCellPermission() }) { Text("继续授权精确位置") } },
        dismissButton = { TextButton(onClick = { showCellExplanation = false }) { Text("暂不授权") } },
    )
    if (showShelf && (!showUpload || (upload == null && !state.saving))) SavedReportsDialog(saved,
        snapshot != null && saved.none { it.time == snapshot.collectedAt }, busy, state.error, { id ->
        onOpenUpload(id, snapshot); showUpload = true
    }, onRemove) { showShelf = false; showUpload = false }
    if (showShelf && showUpload && upload != null) LanReportDialog(upload, onAssociate, onFeedback, onSubmit) { showUpload = false }
    if (showSensors) SensorMonitor { showSensors = false }
    if (showTimeline) NetworkTimeline(onTimelineExport) { showTimeline = false }
    if (showRecheck && !showCellExplanation && !showPhoneExplanation && snapshot != null)
        RecheckPanel(snapshot, access, permissionFeedback, state.refreshing, onRefresh,
        close = { showRecheck = false },
        requestCell = { showCellExplanation = true }, requestPhone = { showPhoneExplanation = true },
        appSettings = onAppSettings, locationSettings = onLocationSettings)
    if (showSecurity && snapshot != null) SecurityPanel(snapshot, state.testingKey, state.refreshing, onTestKey) { showSecurity = false }
    if (showPhoneExplanation) AlertDialog(
        onDismissRequest = { showPhoneExplanation = false },
        title = { Text("授权电话状态") },
        text = { Column {
            Text("用于读取该 Android 版本可提供的蜂窝数据制式、逻辑卡槽和服务状态。不读取号码或 SIM 标识。小区频段的精确位置权限可单独选择。授权不会上传报告。")
            TextButton(onClick = { showPhoneExplanation = false; showRecheck = true; onAppSettings() }) { Text("打开应用权限设置") }
        } },
        confirmButton = { TextButton(onClick = { showPhoneExplanation = false; showRecheck = true; onPhonePermission() }) { Text("继续授权电话状态") } },
        dismissButton = { TextButton(onClick = { showPhoneExplanation = false }) { Text("暂不授权") } },
    )
    if (showVisibleApps) VisibleApps { showVisibleApps = false }
    if (showMediaProbe) MediaProbePanel { showMediaProbe = false }
    if (showRouteExperiment) RouteExperimentPanel(busy = busy, onSave = { showRouteExperiment = false; onRoute(it) },
        onClose = { showRouteExperiment = false })
    if (showUsbExperiment) UsbExperimentPanel(busy, onSave={showUsbExperiment=false;onUsb(it)},onClose={showUsbExperiment=false})
    if (showGnssCheck) GnssCheckPanel(snapshot?.sections?.firstOrNull { it.key == "system" }?.items.orEmpty(),
        access, busy, lanEnabled, onCellPermission, onLocationSettings,
        onSave={showGnssCheck=false;onGnss(it)},onClose={showGnssCheck=false})
    if (showConfigurationEvidence) ConfigurationEvidencePanel(snapshot,busy,state.error,lanEnabled,onRefresh) { showConfigurationEvidence=false }
    if (showPlans) AlertDialog(
        onDismissRequest = { showPlans = false },
        title = { Text("选择验收方案") },
        text = { Column(Modifier.verticalScroll(rememberScrollState())) {
            Text("每次运行保存独立采样。选「上传报告」并确认后才发送。")
            CapturePlan.entries.forEach { plan ->
                TextButton(enabled = !busy, onClick = {
                    showPlans=false
                    when(plan) {
                        CapturePlan.USB -> showUsbExperiment=true
                        CapturePlan.GNSS -> showGnssCheck=true
                        CapturePlan.NETWORK -> showRouteExperiment=true
                        else -> onCollectAll(plan)
                    }
                }) { Text(plan.title) }
                Text(plan.description, style = MaterialTheme.typography.bodySmall)
            }
        } },
        confirmButton = { TextButton(onClick = { showPlans = false }) { Text("关闭") } },
    )
    if (showUpdate) AppUpdate(context) { showUpdate = false }
}

@Composable
private fun windowDecorator(): (DeviceSnapshot) -> DeviceSnapshot {
    val size = LocalWindowInfo.current.containerSize
    val density = LocalDensity.current
    val direction = LocalLayoutDirection.current
    fun margins(insets: WindowInsets): String =
        "左 ${insets.getLeft(density, direction)} · 上 ${insets.getTop(density)} · " +
            "右 ${insets.getRight(density, direction)} · 下 ${insets.getBottom(density)} px"
    val bars = margins(WindowInsets.systemBars)
    val cutout = margins(WindowInsets.displayCutout)
    return remember(size, bars, cutout) { { snapshot: DeviceSnapshot ->
        snapshot.copy(sections = snapshot.sections.map { section ->
            if (section.key != "display" || size.width <= 0 || size.height <= 0) section else section.copy(items =
                section.items.filterNot { it.key in setOf("windowSize", "systemBarInsets", "cutoutInsets") } + listOf(
                    DeviceInfoItem("windowSize", "当前应用窗口尺寸", "${size.width} × ${size.height} px",
                        "Compose LocalWindowInfo.containerSize", note = "由当前页面布局提供。物理分辨率见显示模式字段。"),
                    DeviceInfoItem("systemBarInsets", "系统栏边距", bars, "WindowInsets.systemBars"),
                    DeviceInfoItem("cutoutInsets", "刘海 / 挖孔安全边距", cutout, "WindowInsets.displayCutout",
                        note = "0 表示窗口当前未收到该方向的边距，不代表硬件一定没有挖孔。"),
                ))
        })
    } }
}

@Composable
private fun AppHeader(snapshot: DeviceSnapshot?, refreshing: Boolean, onRefresh: () -> Unit,
    onExportRequest: () -> Unit) {
    Surface(color = Ink) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically) {
            Image(painter = painterResource(R.mipmap.ic_launcher), contentDescription = "SigMark 图标",
                modifier = Modifier.size(39.dp))
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text("印迹  SigMark", color = Color.White, fontSize = 16.sp,
                    fontWeight = FontWeight.Bold, lineHeight = 19.sp)
                Text("DEVICE INSPECTOR", color = Muted, fontSize = 9.sp,
                    fontFamily = FontFamily.Monospace, letterSpacing = 1.sp)
            }
            OutlinedButton(onClick = onRefresh, enabled = !refreshing,
                modifier = Modifier.height(39.dp),
                contentPadding = PaddingValues(horizontal = 12.dp),
                shape = RoundedCornerShape(10.dp), border = BorderStroke(1.dp, Stroke)) {
                Text(if (refreshing) "采集中" else "刷新", fontSize = 12.sp)
            }
            Spacer(Modifier.width(7.dp))
            Button(onClick = onExportRequest, enabled = snapshot != null,
                modifier = Modifier.height(39.dp),
                contentPadding = PaddingValues(horizontal = 12.dp),
                shape = RoundedCornerShape(10.dp)) { Text("导出", fontSize = 12.sp) }
        }
    }
}

@Composable
private fun OverviewCard(snapshot: DeviceSnapshot?) {
    val system = snapshot?.sections?.firstOrNull { it.key == "system" }
    val model = system?.items?.firstOrNull { it.key == "model" }?.value ?: "等待采集"
    val release = system?.items?.firstOrNull { it.key == "release" }?.value ?: "—"
    val total = snapshot?.sections?.sumOf { it.items.size } ?: 0
    val available = snapshot?.sections?.sumOf { section ->
        section.items.count { it.status == ValueStatus.AVAILABLE }
    } ?: 0
    val issues = total - available
    Card(shape = RoundedCornerShape(17.dp),
        colors = CardDefaults.cardColors(containerColor = CardColor),
        border = BorderStroke(1.dp, Stroke)) {
        Column(Modifier.fillMaxWidth().padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("当前设备 · 应用视角", color = Teal, fontSize = 11.sp,
                    fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                Text("LOCAL SNAPSHOT", color = Muted, fontSize = 9.sp,
                    fontFamily = FontFamily.Monospace)
            }
            Spacer(Modifier.height(7.dp))
            Text(model, color = Color.White, fontSize = 25.sp, fontWeight = FontWeight.Bold,
                maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text("Android $release  ·  ${snapshot?.sections?.size ?: 0} 分类  ·  $total 项",
                color = Muted, fontSize = 12.sp)
            Spacer(Modifier.height(10.dp))
            HorizontalDivider(color = Stroke)
            Spacer(Modifier.height(10.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(6.dp).background(Teal, CircleShape))
                Spacer(Modifier.width(6.dp))
                Text("$available 已获取", color = Color.White, fontSize = 12.sp)
                Spacer(Modifier.width(16.dp))
                Box(Modifier.size(6.dp).background(Color(0xFFF4C589), CircleShape))
                Spacer(Modifier.width(6.dp))
                Text("$issues 待确认", color = Color(0xFFF4C589), fontSize = 12.sp)
                Spacer(Modifier.weight(1f))
                Text(snapshot?.let { SimpleDateFormat("HH:mm:ss", Locale.getDefault()).format(Date(it.collectedAt)) } ?: "—",
                    color = Muted, fontSize = 10.sp, fontFamily = FontFamily.Monospace)
            }
        }
    }
}
@Composable
private fun SearchBox(value: String, onChange: (String) -> Unit) {
    Surface(color = CardColor, shape = RoundedCornerShape(12.dp), border = BorderStroke(1.dp, Stroke)) {
        Row(Modifier.fillMaxWidth().height(45.dp).padding(horizontal = 13.dp),
            verticalAlignment = Alignment.CenterVertically) {
            Text("⌕", color = Teal, fontSize = 22.sp)
            Spacer(Modifier.width(8.dp))
            Box(Modifier.weight(1f)) {
                if (value.isEmpty()) Text("搜索字段 / 数值 / 来源", color = Muted, fontSize = 12.sp)
                BasicTextField(value, onValueChange = onChange, singleLine = true,
                    textStyle = androidx.compose.ui.text.TextStyle(color = Color.White, fontSize = 12.sp),
                    modifier = Modifier.fillMaxWidth())
            }
            if (value.isNotEmpty()) Text("清除", color = Teal, fontSize = 12.sp,
                modifier = Modifier.clickable { onChange("") }.padding(5.dp))
        }
    }
}

@Composable
private fun CategoryChip(key: String, title: String, selected: String, onSelect: (String) -> Unit) {
    val isSelected = key == selected
    Surface(
        onClick = { onSelect(key) },
        shape = RoundedCornerShape(10.dp),
        color = if (isSelected) Teal else CardColor,
        border = BorderStroke(1.dp, if (isSelected) Teal else Stroke),
    ) {
        Text(title, color = if (isSelected) Ink else Muted,
            fontSize = 12.sp, fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal,
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp))
    }
}

@Composable
private fun SectionCard(section: DeviceSection, modifier: Modifier = Modifier, showAll: Boolean,
    access: CollectionAccess, busy: Boolean, onAccessAction: (AccessAction) -> Unit, onGnssCheck: () -> Unit) {
    var expanded by rememberSaveable(section.key) { mutableStateOf(false) }
    val visibleItems = if (showAll || expanded || section.items.size <= 5) section.items else
        (section.items.take(5) + section.items.filter { it.status != ValueStatus.AVAILABLE })
            .distinctBy { it.key }
    Card(modifier = modifier.fillMaxWidth(), shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = CardColor), border = BorderStroke(1.dp, Stroke)) {
        Column {
            Row(Modifier.fillMaxWidth().background(PanelRaised).padding(horizontal = 14.dp, vertical = 11.dp),
                verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(width = 3.dp, height = 18.dp)
                    .background(Teal, RoundedCornerShape(3.dp)))
                Spacer(Modifier.width(9.dp))
                Text(section.title, fontWeight = FontWeight.SemiBold, fontSize = 14.sp,
                    modifier = Modifier.weight(1f))
                Text("${section.items.size} 项", color = Muted, fontSize = 11.sp)
            }
            visibleItems.forEachIndexed { index, item ->
                if (index > 0) HorizontalDivider(color = Stroke,
                    modifier = Modifier.padding(horizontal = 14.dp))
                InfoRow(item, onGnssCheck.takeIf { section.key == "system" && item.key == "gnssHardwareYear" && !busy })
                collectionAction(Build.VERSION.SDK_INT, section.key, item, access)?.let { action ->
                    TextButton(enabled = !busy, onClick = { onAccessAction(action) },
                        modifier = Modifier.padding(horizontal = 5.dp)) { Text(action.title) }
                }
            }
            if (!showAll && (section.items.size > visibleItems.size || expanded)) {
                HorizontalDivider(color = Stroke, modifier = Modifier.padding(horizontal = 14.dp))
                TextButton(onClick = { expanded = !expanded },
                    modifier = Modifier.fillMaxWidth()) {
                    Text(if (expanded) "收起" else "展开其余 ${section.items.size - visibleItems.size} 项",
                        color = Teal, fontSize = 12.sp)
                }
            }
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun InfoRow(item: DeviceInfoItem, onReview: (() -> Unit)? = null) {
    var expanded by rememberSaveable(item.key) { mutableStateOf(false) }
    val context = LocalContext.current
    val clipboard = context.getSystemService(ClipboardManager::class.java)
    Column(Modifier.fillMaxWidth().combinedClickable(
        onClick = { expanded = !expanded },
        onLongClick = {
            item.value?.let {
                clipboard?.setPrimaryClip(ClipData.newPlainText(item.label, it))
                Toast.makeText(context, "已复制 ${item.label}", Toast.LENGTH_SHORT).show()
            }
        },
    ).padding(horizontal = 14.dp, vertical = 10.dp)) {
        Row(verticalAlignment = Alignment.Top) {
            Text(item.label, color = Muted, fontSize = 12.sp, lineHeight = 17.sp,
                modifier = Modifier.weight(0.42f))
            Spacer(Modifier.width(10.dp))
            val value = when (item.status) {
                ValueStatus.AVAILABLE -> item.value.orEmpty()
                ValueStatus.UNAVAILABLE -> unavailableLabel(item.reason)
                ValueStatus.RESTRICTED -> restrictionLabel(item)
                ValueStatus.ERROR -> "读取异常"
            }
            Text(value, color = when (item.status) {
                ValueStatus.AVAILABLE -> Color.White
                ValueStatus.ERROR -> Color(0xFFFFC58A)
                else -> Muted
            },
                fontSize = 12.sp, lineHeight = 17.sp, fontWeight = FontWeight.Medium,
                maxLines = if (expanded) Int.MAX_VALUE else 4, overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(0.58f))
        }
        if (item.status != ValueStatus.AVAILABLE || expanded) {
            Text(buildString {
                append("来源：${item.source}")
                if (item.note != null) append(" · ${item.note}")
                if (item.reason == ReadReason.ACCESS_DENIED) append(" · 此项没有可在印迹内授予的权限。")
            }, color = Muted,
                fontSize = 11.sp, lineHeight = 15.sp,
                modifier = Modifier.padding(top = 5.dp))
        }
        if (expanded && onReview != null) TextButton(onClick = onReview) { Text("核对 GNSS 读数") }
    }
}
