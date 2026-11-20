# 架构与数据契约

SigMark 当前采用单模块 Kotlin / Compose 结构，目标是让每一项信息都可追溯，而不是只显示一个字符串。

## 数据流

`DeviceCollector` → `DeviceRepository` → `MainViewModel (StateFlow)` → Compose 页面 → 系统文档选择器导出 JSON。

- `collector/DeviceCollectors.kt`：各分类独立采集；字段级捕获异常，分类级兜底，避免单项失败导致整页空白。当前只在进入页面和手动刷新时采集，不做后台定时轮询。
- `collector/CpuInfoParser.kt`：将厂商格式差异较大的 `/proc/cpuinfo` 文本解析为可显示字段，不推断 SoC 商品名。
- `model/DeviceInfo.kt`：`DeviceInfoItem` 包含稳定 key、标签、值、来源、状态、说明。JSON 使用 `schemaVersion`，消费者应按 key 而非中文 label 解析。
- `MainViewModel.kt`：采集在 `Dispatchers.IO` 上执行，`StateFlow` 向 UI 暴露快照、刷新态和整体错误。
- `MainActivity.kt`：页面仅渲染快照；导出前显示敏感性提醒，写入用户选定的 URI。

## 状态语义

| 状态 | 语义 | 值 |
| --- | --- | --- |
| `AVAILABLE` | 成功取得可展示值 | 非空字符串 |
| `UNAVAILABLE` | 接口未返回有效值或 ROM 没有该字段 | `null` |
| `RESTRICTED` | 系统权限/策略拒绝读取 | `null` |
| `ERROR` | 其他读数异常 | `null` |

受限状态不等同于设备关闭某项能力。例如 `/sys/fs/selinux/enforce` 被拒绝，只能表示当前应用读取受限，不能据此推断 SELinux 模式。

## 扩展约定

新增字段时优先使用公开 Android API；再考虑常见可读节点。先保留原始来源与单位，再做显示格式化。动态值仅随手动刷新更新；若未来加入实时页，监听器应随页面可见性注册/注销。涉及 `Build.*` 的值注明“应用进程视角”，不当作物理硬件真值。新增数据导出字段应同步更新 `schemaVersion` 文档、单测和隐私提示。
