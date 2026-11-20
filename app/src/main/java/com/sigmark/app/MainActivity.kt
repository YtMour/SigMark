package com.sigmark.app

import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.sigmark.app.model.DeviceInfoItem
import com.sigmark.app.model.DeviceSection
import com.sigmark.app.model.DeviceSnapshot
import com.sigmark.app.model.ValueStatus
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

private val Ink = Color(0xFF09131B)
private val CardColor = Color(0xFF13242C)
private val Teal = Color(0xFF78E6D2)
private val Muted = Color(0xFFA6B6BB)
private val Stroke = Color(0xFF2B4148)

class MainActivity : ComponentActivity() {
    private val viewModel: MainViewModel by viewModels()
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
                SigMarkScreen(state, onRefresh = viewModel::refresh, onExport = { snapshot ->
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
    onExport: (DeviceSnapshot) -> Unit,
) {
    var query by rememberSaveable { mutableStateOf("") }
    var selected by rememberSaveable { mutableStateOf("all") }
    var issuesOnly by rememberSaveable { mutableStateOf(false) }
    var showExportConfirmation by rememberSaveable { mutableStateOf(false) }
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

    Scaffold(containerColor = Ink) { padding ->
        LazyColumn(
            state = listState,
            modifier = Modifier.fillMaxSize().padding(padding),
            contentPadding = PaddingValues(bottom = 32.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            item {
                Column(modifier = Modifier.padding(start = 20.dp, end = 20.dp, top = 26.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(
                            modifier = Modifier.size(40.dp).background(Teal, RoundedCornerShape(12.dp)),
                            contentAlignment = Alignment.Center,
                        ) { Text("印", color = Ink, fontWeight = FontWeight.Black, fontSize = 22.sp) }
                        Spacer(Modifier.width(12.dp))
                        Column {
                            Text("印迹", fontSize = 22.sp, fontWeight = FontWeight.Bold)
                            Text("SIGMARK · DEVICE SNAPSHOT", fontSize = 10.sp, color = Muted,
                                letterSpacing = 1.5.sp)
                        }
                    }
                    Spacer(Modifier.height(22.dp))
                    OverviewCard(snapshot)
                    Spacer(Modifier.height(16.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Button(
                            onClick = onRefresh,
                            enabled = !state.refreshing,
                            modifier = Modifier.weight(1f),
                            shape = RoundedCornerShape(12.dp),
                        ) {
                            if (state.refreshing) {
                                CircularProgressIndicator(Modifier.size(17.dp), strokeWidth = 2.dp)
                                Spacer(Modifier.width(8.dp))
                            }
                            Text(if (state.refreshing) "采集中" else "刷新采集")
                        }
                        OutlinedButton(
                            onClick = { if (snapshot != null) showExportConfirmation = true },
                            enabled = snapshot != null,
                            modifier = Modifier.weight(1f),
                            shape = RoundedCornerShape(12.dp),
                            border = BorderStroke(1.dp, Stroke),
                        ) { Text("导出 JSON", color = Teal) }
                    }
                    if (state.error != null) {
                        Spacer(Modifier.height(12.dp))
                        Text(state.error, color = Color(0xFFFFB4A9))
                    }
                    Spacer(Modifier.height(22.dp))
                    Text("设备详情", fontSize = 19.sp, fontWeight = FontWeight.Bold)
                    Spacer(Modifier.height(12.dp))
                    SearchBox(query, onChange = { query = it })
                    if (snapshot != null && issueCount > 0) {
                        Spacer(Modifier.height(8.dp))
                        TextButton(onClick = { issuesOnly = !issuesOnly }) {
                            Text(if (issuesOnly) "查看全部采集项" else "查看 $issueCount 项受限 / 待确认",
                                color = Teal, fontSize = 13.sp)
                        }
                    }
                }
            }
            item {
                androidx.compose.foundation.lazy.LazyRow(
                    contentPadding = PaddingValues(horizontal = 20.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    item { CategoryChip("all", "全部", selected, onSelect = { selected = it }) }
                    snapshot?.sections?.forEach { section ->
                        item { CategoryChip(section.key, section.title, selected,
                            onSelect = { selected = it }) }
                    }
                }
            }
            if (snapshot == null && state.refreshing) {
                item {
                    Box(Modifier.fillMaxWidth().padding(42.dp), contentAlignment = Alignment.Center) {
                        CircularProgressIndicator(color = Teal)
                    }
                }
            } else if (sections.isEmpty()) {
                item {
                    Text("没有匹配的采集项；可清除搜索或切换分类", color = Muted,
                        modifier = Modifier.padding(horizontal = 20.dp, vertical = 32.dp))
                }
            } else {
                items(sections, key = { it.key }) { section ->
                    SectionCard(section, Modifier.padding(horizontal = 20.dp))
                }
            }
            item {
                Text("本机采集 · 无后台上传 · 部分字段受 Android 权限与厂商实现限制",
                    color = Muted, fontSize = 11.sp,
                    modifier = Modifier.padding(horizontal = 24.dp, vertical = 8.dp))
            }
        }
    }
    if (showExportConfirmation && snapshot != null) {
        AlertDialog(
            onDismissRequest = { showExportConfirmation = false },
            title = { Text("导出设备报告") },
            text = { Text("报告包含构建指纹、设备型号等信息。保存后请检查内容，再决定是否分享。") },
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
}

@Composable
private fun OverviewCard(snapshot: DeviceSnapshot?) {
    val model = snapshot?.sections?.firstOrNull { it.key == "system" }?.items
        ?.firstOrNull { it.key == "model" }?.value ?: "正在识别设备"
    val release = snapshot?.sections?.firstOrNull { it.key == "system" }?.items
        ?.firstOrNull { it.key == "release" }?.value
    val items = snapshot?.sections?.sumOf { it.items.size } ?: 0
    val available = snapshot?.sections?.sumOf { section ->
        section.items.count { it.status == ValueStatus.AVAILABLE }
    } ?: 0
    Card(
        shape = RoundedCornerShape(22.dp),
        colors = CardDefaults.cardColors(containerColor = CardColor),
        border = BorderStroke(1.dp, Stroke),
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().background(
                Brush.linearGradient(listOf(Color(0xFF18393E), CardColor, CardColor))
            ).padding(22.dp),
        ) {
            Text("当前设备", color = Teal, fontSize = 12.sp, letterSpacing = 1.sp)
            Spacer(Modifier.height(10.dp))
            Text(model, color = Color.White, fontSize = 27.sp, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(4.dp))
            Text(if (release == null) "等待首次采集" else "Android $release  ·  本机快照",
                color = Muted, fontSize = 13.sp)
            Spacer(Modifier.height(20.dp))
            HorizontalDivider(color = Stroke)
            Spacer(Modifier.height(14.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(24.dp)) {
                OverviewStat("$items", "采集项")
                OverviewStat("$available", "已获取")
                OverviewStat("${snapshot?.sections?.size ?: 0}", "分类")
            }
            if (snapshot != null) {
                Spacer(Modifier.height(14.dp))
                Text("采集于 ${SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.getDefault()).format(Date(snapshot.collectedAt))}",
                    color = Muted, fontSize = 11.sp)
            }
        }
    }
}

@Composable
private fun OverviewStat(value: String, label: String) {
    Column {
        Text(value, color = Color.White, fontSize = 20.sp, fontWeight = FontWeight.Bold)
        Text(label, color = Muted, fontSize = 11.sp)
    }
}

@Composable
private fun SearchBox(value: String, onChange: (String) -> Unit) {
    Surface(color = CardColor, shape = RoundedCornerShape(12.dp), border = BorderStroke(1.dp, Stroke)) {
        Row(Modifier.fillMaxWidth().height(48.dp).padding(horizontal = 14.dp),
            verticalAlignment = Alignment.CenterVertically) {
            Text("⌕", color = Teal, fontSize = 24.sp)
            Spacer(Modifier.width(10.dp))
            Box(Modifier.weight(1f)) {
                if (value.isEmpty()) Text("搜索名称、数值或来源", color = Muted, fontSize = 14.sp)
                BasicTextField(value, onValueChange = onChange, singleLine = true,
                    textStyle = androidx.compose.ui.text.TextStyle(color = Color.White, fontSize = 14.sp),
                    modifier = Modifier.fillMaxWidth())
            }
            if (value.isNotEmpty()) TextButton(onClick = { onChange("") }) { Text("清除") }
        }
    }
}

@Composable
private fun CategoryChip(key: String, title: String, selected: String, onSelect: (String) -> Unit) {
    val isSelected = key == selected
    Surface(
        onClick = { onSelect(key) },
        shape = RoundedCornerShape(12.dp),
        color = if (isSelected) Teal else CardColor,
        border = BorderStroke(1.dp, if (isSelected) Teal else Stroke),
    ) {
        Text(title, color = if (isSelected) Ink else Muted,
            fontSize = 13.sp, fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal,
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 9.dp))
    }
}

@Composable
private fun SectionCard(section: DeviceSection, modifier: Modifier = Modifier) {
    Card(modifier = modifier.fillMaxWidth(), shape = RoundedCornerShape(18.dp),
        colors = CardDefaults.cardColors(containerColor = CardColor), border = BorderStroke(1.dp, Stroke)) {
        Column(Modifier.padding(18.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(8.dp).background(Teal, CircleShape))
                Spacer(Modifier.width(9.dp))
                Text(section.title, fontWeight = FontWeight.Bold, fontSize = 16.sp,
                    modifier = Modifier.weight(1f))
                Text("${section.items.size} 项", color = Muted, fontSize = 12.sp)
            }
            Spacer(Modifier.height(12.dp))
            section.items.forEachIndexed { index, item ->
                if (index > 0) HorizontalDivider(color = Stroke)
                InfoRow(item)
            }
        }
    }
}

@Composable
private fun InfoRow(item: DeviceInfoItem) {
    var expanded by rememberSaveable(item.key) { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth().clickable { expanded = !expanded }.padding(vertical = 11.dp)) {
        Row(verticalAlignment = Alignment.Top) {
            Text(item.label, color = Muted, fontSize = 13.sp, modifier = Modifier.weight(0.42f))
            Spacer(Modifier.width(12.dp))
            val value = when (item.status) {
                ValueStatus.AVAILABLE -> item.value.orEmpty()
                ValueStatus.UNAVAILABLE -> "不可用"
                ValueStatus.RESTRICTED -> "受限"
                ValueStatus.ERROR -> "读取错误"
            }
            Text(value, color = if (item.status == ValueStatus.AVAILABLE) Color.White else Color(0xFFFFC58A),
                fontSize = 13.sp, fontWeight = FontWeight.Medium,
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
