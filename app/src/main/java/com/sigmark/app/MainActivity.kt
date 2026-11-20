package com.sigmark.app

import android.Manifest
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.content.ClipData
import android.content.ClipboardManager
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
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
import com.sigmark.app.model.ValueStatus
import com.sigmark.app.lan.LanReportDialog
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
    private val cellPermission = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        viewModel.refresh()
    }
    private val diagnosticSettings = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) {
        viewModel.refresh()
    }
    private var pendingExport: DeviceSnapshot? = null
    private val createDocument = registerForActivityResult(
        ActivityResultContracts.CreateDocument("application/json")
    ) { uri ->
        val snapshot = pendingExport
        pendingExport = null
        if (uri != null && snapshot != null) {
            try {
                contentResolver.openOutputStream(uri)?.use { stream ->
                    stream.write(snapshot.toJson().toByteArray(Charsets.UTF_8))
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
                SigMarkScreen(state, onRefresh = { viewModel.refresh(refreshRadio = true) }, onCellPermission = {
                    cellPermission.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION))
                }, onAppSettings = {
                    diagnosticSettings.launch(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", packageName, null)))
                }, onLocationSettings = {
                    diagnosticSettings.launch(Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS))
                }, onExport = { snapshot ->
                    pendingExport = snapshot
                    createDocument.launch("SigMark-${SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US).format(Date(snapshot.collectedAt))}.json")
                })
            }
        }
    }
}

@Composable
private fun SigMarkScreen(
    state: MainUiState,
    onRefresh: () -> Unit,
    onCellPermission: () -> Unit,
    onAppSettings: () -> Unit,
    onLocationSettings: () -> Unit,
    onExport: (DeviceSnapshot) -> Unit,
) {
    var query by rememberSaveable { mutableStateOf("") }
    var selected by rememberSaveable { mutableStateOf("all") }
    var issuesOnly by rememberSaveable { mutableStateOf(false) }
    var showExportConfirmation by rememberSaveable { mutableStateOf(false) }
    var showCellExplanation by rememberSaveable { mutableStateOf(false) }
    var lanSnapshot by remember { mutableStateOf<DeviceSnapshot?>(null) }
    val snapshot = state.snapshot
    val issueCount = snapshot?.sections?.sumOf { section ->
        section.items.count { it.status != ValueStatus.AVAILABLE }
    } ?: 0
    val sections = remember(snapshot, query, selected, issuesOnly) {
        snapshot?.sections?.filter { selected == "all" || it.key == selected }
            ?.mapNotNull { section ->
                val matches = section.items.filter { item ->
                    (!issuesOnly || item.status != ValueStatus.AVAILABLE) &&
                    (query.isBlank() || listOf(section.title, item.label, item.value.orEmpty(),
                        item.source, item.note.orEmpty(), item.status.name)
                        .any { it.contains(query.trim(), ignoreCase = true) }
                    )
                }
                if (matches.isEmpty()) null else section.copy(items = matches)
            }.orEmpty()
    }
    val listState = rememberLazyListState()
    val permissionMissing = snapshot?.sections?.any { it.key == "cellular" && it.items.any { row -> row.key == "cellDiagnostics" && row.reason == ReadReason.PERMISSION_REQUIRED } } == true

    Scaffold(containerColor = Ink, topBar = { AppHeader(snapshot, state.refreshing, onRefresh, onExportRequest = { showExportConfirmation = true }) }) { padding ->
        LazyColumn(
            state = listState,
            modifier = Modifier.fillMaxSize().padding(padding),
            contentPadding = PaddingValues(bottom = 28.dp),
            verticalArrangement = Arrangement.spacedBy(11.dp),
        ) {
            item {
                Column(Modifier.padding(horizontal = 16.dp)) {
                    OverviewCard(snapshot)
                    if (permissionMissing || BuildConfig.DEBUG) {
                        Surface(color = CardColor, shape = RoundedCornerShape(12.dp), modifier = Modifier.padding(top = 9.dp)) {
                            Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp)) {
                                if (permissionMissing) TextButton(onClick = { showCellExplanation = true }) { Text("授权查看小区无线参数") }
                                if (BuildConfig.DEBUG) Button(enabled = snapshot != null, onClick = { lanSnapshot = snapshot },
                                    modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp)) { Text("上传报告") }
                            }
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
                                Text(if (issuesOnly) "仅看异常 · $issueCount" else "待确认 · $issueCount",
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
                        Text("可清除搜索、关闭异常筛选或切换分类", color = Muted, fontSize = 12.sp)
                        TextButton(onClick = { query = ""; issuesOnly = false; selected = "all" }) {
                            Text("重置筛选", color = Teal)
                        }
                    }
                }
            } else {
                items(sections, key = { it.key }) { section ->
                    SectionCard(section, Modifier.padding(horizontal = 16.dp),
                        showAll = query.isNotBlank() || selected != "all" || issuesOnly,
                        onCellPermission = { showCellExplanation = true }, onLocationSettings = onLocationSettings)
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
            text = { Text("报告包含构建指纹、设备型号、运营商及可用的无线参数。小区频点等数据可能反映所处区域，请检查后再分享。") },
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
            TextButton(onClick = { showCellExplanation = false; onAppSettings() }) { Text("打开应用权限设置") }
        } },
        confirmButton = { TextButton(onClick = { showCellExplanation = false; onCellPermission() }) { Text("请求授权") } },
        dismissButton = { TextButton(onClick = { showCellExplanation = false }) { Text("暂不授权") } },
    )
    lanSnapshot?.let { frozen -> LanReportDialog(frozen) { lanSnapshot = null } }
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
    onCellPermission: () -> Unit, onLocationSettings: () -> Unit) {
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
                InfoRow(item)
                if (section.key == "cellular" && item.key == "cellDiagnostics") {
                    when (item.reason) {
                        ReadReason.PERMISSION_REQUIRED -> TextButton(onClick = onCellPermission,
                            modifier = Modifier.padding(horizontal = 5.dp)) { Text("授权查看小区参数") }
                        ReadReason.LOCATION_DISABLED -> TextButton(onClick = onLocationSettings,
                            modifier = Modifier.padding(horizontal = 5.dp)) { Text("打开系统位置设置") }
                        else -> Unit
                    }
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
private fun InfoRow(item: DeviceInfoItem) {
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
                ValueStatus.UNAVAILABLE -> "暂无数据"
                ValueStatus.RESTRICTED -> "访问受限"
                ValueStatus.ERROR -> "读取异常"
            }
            Text(value, color = if (item.status == ValueStatus.AVAILABLE) Color.White else Color(0xFFFFC58A),
                fontSize = 12.sp, lineHeight = 17.sp, fontWeight = FontWeight.Medium,
                modifier = Modifier.weight(0.58f))
        }
        if (item.status != ValueStatus.AVAILABLE || expanded) {
            Text(buildString {
                append("来源：${item.source}")
                if (item.note != null) append(" · ${item.note}")
            }, color = if (item.status == ValueStatus.AVAILABLE) Muted else Color(0xFFFFC58A),
                fontSize = 11.sp, lineHeight = 15.sp,
                modifier = Modifier.padding(top = 5.dp))
        }
    }
}
