# 架构与数据契约

SigMark 当前采用单模块 Kotlin / Compose 结构，目标是让每一项信息都可追溯，而不是只显示一个字符串。

## 数据流

`DeviceCollector` → `DeviceRepository` → `MainViewModel (StateFlow)` → Compose 页面 → 系统文档选择器导出 JSON。

Debug 内网试验分支：冻结当前本地快照 → `lan/LanReport.kt` 按白名单投影 → 用户确认上传 → 内置局域网地址的 Go API → PostgreSQL。管理台同源，通过独立 Bearer 令牌读取；App 不携带管理员令牌。与完整 JSON 导出独立；详细契约和运行说明见 [内网试验手册](LAN-PILOT.md)。

- `collector/DeviceCollectors.kt`：各分类独立采集；字段级捕获异常，分类级兜底，避免单项失败导致整页空白。当前只在进入页面和手动刷新时采集，不做后台定时轮询。
- `collector/CpuInfoParser.kt`：将厂商格式差异较大的 `/proc/cpuinfo` 文本解析为可显示字段，不推断 SoC 商品名。
- `collector/NetworkCollectors.kt`：默认网络、Wi-Fi 链路和移动网络分开展示；`RadioMath.kt` 负责可单测的频率/信道换算。手动刷新且已授权时尝试一次公开小区更新，最多等待 2.5 秒再回退到缓存。
- `model/DeviceInfo.kt`：`DeviceInfoItem` 包含稳定 key、标签、值、来源、状态、说明。JSON 使用 `schemaVersion`，消费者应按 key 而非中文 label 解析。
- `MainViewModel.kt`：采集在 `Dispatchers.IO` 上执行，`StateFlow` 向 UI 暴露快照、刷新态和整体错误。
- `MainActivity.kt`：页面仅渲染快照；导出前显示敏感性提醒，写入用户选定的 URI。

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

JSON `schemaVersion: 1` 的字段结构兼容旧报告。消费者允许新增分类/字段，并应忽略未知属性；字段的可选 `reason` 可返回 `PERMISSION_REQUIRED`、`LOCATION_DISABLED`、`ACCESS_DENIED`、`NOT_REPORTED`、`READ_FAILED`；不存在时仅按 `status` 判断，不从中文说明推断原因码。

## 扩展约定

新增字段时优先使用公开 Android API；再考虑常见可读节点。先保留原始来源与单位，再做显示格式化。动态值仅随手动刷新更新；若未来加入实时页，监听器应随页面可见性注册/注销。涉及 `Build.*` 的值注明“应用进程视角”，不当作物理硬件真值。新增数据导出字段应同步更新 `schemaVersion` 文档、单测和隐私提示。
