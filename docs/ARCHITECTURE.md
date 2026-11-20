# 架构与数据契约

SigMark 当前采用单模块 Kotlin / Compose 结构，目标是让每一项信息都可追溯，而不是只显示一个字符串。

## 数据流

`DeviceCollector` → `DeviceRepository` → `MainViewModel (StateFlow)` → Compose 页面 → 系统文档选择器导出 JSON。

Debug 内网试验分支：冻结当前本地快照 → `lan/LanReport.kt` 按白名单投影 → 用户确认上传 → 内置局域网地址的 Go API → PostgreSQL。浏览器用管理会话读取，同源脚本联调也可使用独立 Bearer 令牌。上传与完整 JSON 导出各自走独立流程。详细契约和运行说明见 [内网试验手册](LAN-PILOT.md)。

- `collector/DeviceCollectors.kt`：各分类独立采集；字段级捕获异常，分类级兜底，避免单项失败导致整页空白。当前只在进入页面和手动刷新时采集，不做后台定时轮询。
- `collector/SafeReader.kt`：`ReadResult<T>` 统一返回值、来源、状态、原因、详情及可选 errno。只读固定节点设字节上限与等待上限，使用有限线程池；固定属性查询仅通过应用自身身份调用 `getprop`，带进程超时。若驱动忽略非阻塞，超时停止等待不等于保证内核调用立刻结束；线程和队列上限限制影响范围。
- `collector/CpuInfoParser.kt`：将厂商格式差异较大的 `/proc/cpuinfo` 文本解析为可显示字段，不推断 SoC 商品名。
- `collector/NetworkCollectors.kt`：默认网络、Wi-Fi 链路和移动网络分开展示；`RadioMath.kt` 负责可单测的频率/信道换算。手动刷新且已授权时尝试一次公开小区更新，最多等待 2.5 秒再回退到缓存。
- `model/DeviceInfo.kt`：`DeviceInfoItem` 包含稳定 key、标签、值、来源、状态、说明。JSON 使用 `schemaVersion`，消费者应按 key 而非中文 label 解析。
- `MainViewModel.kt`：采集在 `Dispatchers.IO` 上执行，`StateFlow` 向 UI 暴露快照、刷新态和整体错误。
- `MainActivity.kt` 渲染快照，从 Compose 窗口状态补充尺寸及边距，在导出预览中提示内容，并写入用户选定的 URI。
- `collector/FrameworkCollectors.kt` 提供运行时、媒体、环境和应用字段。`SensorMonitor.kt` 随面板和前台生命周期管理订阅。`VisibleApps.kt` 按需查询当前可见且有桌面入口的应用和所选应用的权限。

## UI 测试动线

首屏固定顶部品牌、刷新和导出；下方依次是当前设备摘要、搜索、待确认筛选和分类。分类卡默认展示前 5 项及所有异常项，点“展开其余”查看全部，避免重要问题被折叠。字段点按展开来源说明，长按复制数值。异常筛选自动回到“全部”分类，空结果提供一键重置。视觉采用深海墨色背景、薄荷绿主色和琥珀色异常提示；应用图标素材位于 `output/imagegen/`。

## 状态语义

| 状态 | 语义 | 值 |
| --- | --- | --- |
| `AVAILABLE` | 成功取得可展示值 | 非空字符串 |
| `UNAVAILABLE` | 接口未返回有效值或 ROM 没有该字段 | `null` |
| `RESTRICTED` | 系统权限/策略拒绝读取 | `null` |
| `ERROR` | 其他读数异常 | `null` |

受限状态不等同于设备关闭某项能力。例如 `/sys/fs/selinux/enforce` 被拒绝，只能表示当前应用读取受限，不能据此推断 SELinux 模式。

本地 JSON `schemaVersion: 1` 向后兼容，增加可选数值 `errno`，`reason` 新增 `NODE_MISSING`、`INVALID_VALUE`。不存在时仅按 `status` 判断；不要从中文说明推断原因码。本地快照与 LAN API 独立版本化。

### LAN v4 · 开发与自动化入口

- Android 上传投影：`lan/LanDetails.kt`；服务端独立白名单和类型校验：`backend/cmd/sigmark/protocol.go`。新增上传字段时同步更新两端、用户预览、隐私文档和测试。
- 稳定字段标识为 `group + key`；标签仅供显示。记录有 `value`、`status`、`source`，可带 `reason`、`errno`、`note`。非可用值固定为 JSON null。`/api/admin/reports/{id}` 返回原始结构化报告，不通过抓网页获取。
- v3 在报告正文新增 `coverage`。每个 `group` 有 `available`、`restricted`、`unavailable`、`errors` 四项快照计数。每组各状态的计数覆盖对应归档行。自动化分析应使用 `parameters` 读明细，使用 `coverage` 对照快照口径。历史 v1/v2 缺少此元数据。
- v4 新增 `collectorVersion`（采集实现版本）和 `fieldSetVersion`（归档字段语义版本）。状态保留已有四类；`OPTIONAL_UNSET`、`INTERFACE_UNSUPPORTED`、`MODEM_NOT_REPORTED`、`NO_REGISTERED_LTE` 在 `UNAVAILABLE` 下细分原因。历史报告缺行只在对比视图标作「报告未记录」，不改写为采集状态或设备不支持。
- 0.12 的 v4 使用字段集 3，新增可选 `cellular.carrierBandwidths`。v4 字段集 2 仍可接收。电池能量粗估留在本地，不进入上传白名单。
- 0.13 的字段集 4 新增 `cellular.simState`、`network.visibleTransports` 和 `network.wifiRouteRole`。字段集 2/3 继续兼容。默认路由仍是原来的 `network.transport`；其他网络信号分别对照。
- 前端归档查看在 `main.tsx`，批量资产管理在 `assets.tsx`，共享报告类型、标签和导出在 `reports.ts`。资产页用 `/api/admin/report-count` 获取过滤后的两种资产数量，不扫描参数状态摘要。
- 列表/详情分离，游标由接收时间和 UUID 组成；分析脚本保持相同 `q` 和 `batch`、使用 `nextCursor` 翻页并按 `id` 去重。PostgreSQL 默认不自动清理。旧报告没有的值不反推，不应把旧版缺字段当作设备异常。界面比较逻辑见 `backend/web/src/compare.ts`。
- `backend/web/src/main.tsx` 根据 URL 片段选择工作区页面。会话和接收设置在 `backend/cmd/sigmark/admin.go`。构建中心由 Go API 写入文件队列，主机上的 `backend/scripts/build_worker.py` 从已登记的 Git SHA 构建并验证 APK。公开下载只读取当前发布记录，构建完成后由管理端独立发布。

### 普通设备兼容策略

- 公开 API 优先：Build、ActivityManager、StatFs、Display、BatteryManager、SensorManager、ConnectivityManager。CPU 文本、首核频率、Swap、SELinux 与厂商属性是可选补充，不阻断其他参数。
- EACCES/EPERM 标记 `RESTRICTED`；ENOENT/ENODEV 映射 `UNAVAILABLE / NODE_MISSING`。`UNAVAILABLE` 是兼容旧版 JSON 的“暂无数据/不支持”状态，不另造 `UNSUPPORTED` 枚举。属性无返回值为 `NOT_REPORTED`；真正的失败或超时标记 `ERROR`。不根据缺失或受限推断风险。
- ROM 版本线索依次尝试 HyperOS、MIUI、ColorOS、One UI 的常见公开可读属性。HDR 是显示器声明的能力；尺寸来自系统 DPI 推算。电流按 BatteryManager 的 µA 转 mA，保留正负号，排除无效或明显异常的样本。
- 设备配置摘要只使用版本化的 Build 和 ABI 输入。环境线索记录各自状态和来源。实现和兼容范围见 [采集字段说明](FRAMEWORK-DIAGNOSTICS.md)。

## 扩展约定

新增字段时优先使用公开 Android API；再考虑常见可读节点。先保留原始来源与单位，再做显示格式化。动态值仅随手动刷新更新；若未来加入实时页，监听器应随页面可见性注册/注销。涉及 `Build.*` 的值注明“应用进程视角”，不当作物理硬件真值。新增数据导出字段应同步更新 `schemaVersion` 文档、单测和隐私提示。
