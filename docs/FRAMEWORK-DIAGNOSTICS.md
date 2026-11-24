# 0.8 普通应用诊断

0.12 电量属性可回退到 Android 电量广播。能量计缺项时，有有效电荷及采样电压的设备另外显示本机能量粗估（Wh），不替代原始读数，不上传此推算值。

## 0.11 缺项说明

- `environment.systemDebuggable` 从公开的 `Build.TYPE / Build.TAGS` 读取应用视角下的 ROM 构建线索。只把 `userdebug` 与 `eng` 标为标准调试构建，`user` 标为标准量产构建，其他类型按原值展示。签名标签并非调试标志，此项与 `ro.debuggable`、ADB 开关、应用调试标志及调试器连接状态是不同观测。
- `system.baseOs`、空 Bootloader 版本及两个 SELinux 参考属性，按 OEM 可选项说明；启动参考属性和历史构建属性均不等于 SELinux 实时模式。
- 能量属性收到 `Long.MIN_VALUE`、平均电流收到 `Int.MIN_VALUE` 时，分别记为当前接口未提供该属性。电荷量、剩余能量、平均电流与瞬时电流是四个独立量，单位分别为 mAh、Wh、mA、mA。
- LTE 带宽区分 API 不支持、运行时授权、位置开关、无已注册 LTE 小区和系统未给出有效带宽。取得样本时以 kHz 显示；哨兵值保留 null，不从其他频点字段推测。SELinux 受限仍保留 errno；权限位或访问失败不是实时模式测量。

| 分类 | 主要字段与来源 |
| --- | --- |
| 系统与固件 | `Build` 提供主板代号、构建主机和用户、构建时间及 SKU（API 31+）。构建时间使用 UTC。 |
| 系统能力与运行时 | `PackageManager` 提供声明的特性与共享库，`Locale` / `ZoneId` 提供语言和当前 UTC 偏移，`Runtime` 提供进程堆的 MiB 数值。待机分组和后台活动限制读当前 App（API 28+）。 |
| 内核、内存与存储 | 支持的 32/64 位 ABI、进程架构和页大小。内存占用率从总量与系统估计的可用量计算。存储卷显示主副卷、挂载、模拟与可移除属性。系统路径及应用缓存路径统计各自所在文件系统容量，两者可与其他路径共享文件系统。 |
| 显示 | `DisplayManager` 提供应用可见显示和显示模式。Compose 窗口提供当前应用窗口尺寸、系统栏及挖孔边距，单位 px。广色域及 HDR 为系统公布的能力。 |
| 电池 | `BatteryManager` 提供电量百分比、剩余电荷 mAh、剩余能量 Wh、平均电流 mA。容量及电流看硬件实际回报，缺失留空。 |
| 传感器 | 静态清单包括名称、厂商、类型、版本、量程、分辨率、功耗 mA 和最小延迟 µs。实时面板每次订阅一个传感器，关闭面板或离开前台即注销。原始分量的单位随类型变化。 |
| 相机、音频与外设 | `CameraManager` 提供应用可见摄像头、方向、闪光灯和最大公开 JPEG 输出。音频与蓝牙信息取自框架能力，媒体编码与解码列表取自系统声明的常规编解码器。 |
| 应用与权限 | 本应用包、版本、UTC 安装和更新时间、安装器、当前签名证书 SHA-256、已声明权限的授权状态。可见应用面板按 Android 包可见性读取当前资料中的桌面应用，可选一项查看权限。报告仅保存该类应用的去重计数和印迹自身的元数据。 |
| 安全与环境线索 | 进程 SELinux 域、构建和调试标记、常见模拟器名称、启动只读属性、固定目录中可见的 `su` 元数据、锁屏凭证、加密和强生物识别可用性（API 30+）。多个线索并列保留，供 ROM 排查。 |

## 候选来源与 SELinux

采集从首个有效的候选读取值，报告保存实际成功来源。在所有候选都缺失时保留缺失状态。存在拒绝或读取错误时保留对应状态、来源、errno 及其他候选结果。CPU 最高频率尝试 cpu0 与 policy0 的硬件上限。ROM 版本按 HyperOS、MIUI、ColorOS 和 One UI 的固定属性尝试。

`enforce` 节点的 0 或 1 是直接读数。`open` 返回 EACCES 时，先用 `Os.stat` 检查 selinuxfs 目录与 `enforce` 的 DAC 位：只有节点存在且 DAC 允许其他用户读取，才把结果标为 `Enforcing（强制模式，推断）`，并在 `system.selinuxEvidence` 记 `inferred_mac`，说明里写明依据与「不是直接读数」。selinuxfs 未挂载（ENOENT）时标 `未启用（推断）`。stat 自身失败、DAC 本就不允许其他用户读、或其他 errno 时仍保留 `RESTRICTED / ACCESS_DENIED`，不做推断。极少数 ROM 只把 `untrusted_app` 域设为 permissive，这种情形下推断可能不成立，可与已连接设备的 ADB `getenforce` 并列保留。策略节点需要 `security:read_policy`，普通应用没有可用路径。应用采集全程使用自身上下文。

子进程 `getprop` 只用于读取固定的只读属性：每份快照执行一次并解析成内存中的属性表，单项属性缺失时回退单键读取。属性值仍受 ROM 与属性上下文限制，读不到就是 `UNAVAILABLE / NOT_REPORTED`，不推断。

## 本地配置摘要和数据范围

`environment.configurationDigest` 使用品牌、型号、设备和产品代号、主板、硬件代号与 ABI。字段使用固定序、长度前缀和规范化文本，ABI 去重后排序，再计算 SHA-256。输出带 `v1:` 前缀。同配置可得到同一摘要，ROM 改写字段可改变摘要。适用于本地配置对照。

可见应用的清单及第三方权限详情与实时传感器数值只在各自面板短暂显示。0.8 起的快照字段随用户确认导出的本地 JSON 保存。0.10 扩展部分诊断字段的 LAN 白名单，并提供全快照的分类计数。上传以用户确认的参数预览为准。配置摘要、安装来源、权限详情和区域信息仅本机保留。

## 字段集 11：运行架构与设备接口

以下为 SigMark 自己使用 Android 公开 API 的 App 视角读数。对已连接 Pixel 6 上安装的 Hunter 6.72 只做了 APK 静态检查；在清单和 DEX 看到输入、GNSS、传感器和系统架构相关覆盖线索，未将其当作已证实的调用路径或采用其私有规则。

| 字段 | 来源 | 值与边界 |
| --- | --- | --- |
| `cpu.processBitness` | `Process.is64Bit()` | 32 或 64 bit；当前进程，不代表物理芯片 |
| `cpu.kernelMachine` | `Os.uname().machine` | 应用进程看到的架构字符串，和内核编译信息共用同一次读取 |
| `system.interfaceCapabilities` | `PackageManager.hasSystemFeature` | NFC、GNSS（GPS）、USB 主机、USB 配件的声明代码；`none` 表示四类均未声明 |
| `runtime.externalInputTypes` | `InputDevice` 公开 API，API 29+ | 当前可见的外接字母键盘、指针、游戏控制器类别。无类别时为 `none`；API 不适用时留空并保留原因 |

## 字段集 12：扩展硬件采集与图形实测

| 字段 | 来源 / 单位 | 执行条件 |
| --- | --- | --- |
| `system.gnssHardwareYear`、`system.gnssCapabilities` | `LocationManager`；参考年份、能力代码 | API 28+ 和 API 31+；年份未上报与系统版本不支持分别归档 |
| `runtime.declaredInput` | `PackageManager.hasSystemFeature`；触屏、多点触控、手柄代码 | 标准采样；是声明而非实时输入 |
| `sensors.reportingModes`、`sensors.fifoCount`、`sensors.directChannelTypes` | `SensorManager` / `Sensor`；五类上报条目数、FIFO 传感器数量、通道代码 | 标准采样；不订阅事件或创建通道 |
| `media.cameraModes` | Camera2 可读摄像头的 RAW、深度、逻辑多摄、慢动作能力代码 | 标准采样；不打开镜头 |
| `runtime.glesProbeResult`、`runtime.glesProbeVersion`、`runtime.glesProbeStage` | EGL/GLES 1×1 测试色回读；结果代码、上下文版本、阶段代码 | 仅 ROM 验收；独立线程，最多等待 1.8 秒，超时不等于驱动已经退出 |

图形实测通过只表明这一离屏路径工作，不用于把设备判定为实体、原厂或安全。App 和报告详情分别从当前快照、归档明细计算扩展字段的记录数及有值数。

## 字段集 17：进程内安全线索与读取回退

这些字段都只观察**印迹自己的进程**和系统公开声明，不读其他进程、不列其他应用清单、不需要 root / ADB / Shizuku。

| 字段 | 来源 | 值与边界 |
| --- | --- | --- |
| `environment.hookSignals` | `/proc/self/maps` 的文件路径段 | 有序代码 `frida / gadget / xposed / substrate / riru / zygisk / lspatch / memfd_exec`，无命中为 `none`。`memfd_exec` 排除 ART/JIT、图形栈等运行时创建的 memfd 名称（真机上这条误报过，见[设备验证记录](DEVICE-VALIDATION.md)）。只代表本进程映射，不等于设备被注入 |
| `environment.tracerPid` | `/proc/self/status` 的 `TracerPid` | `0` 表示内核未记录跟踪方。调试器、性能分析器都可能产生非零值；零值也不排除用户态注入 |
| `environment.rootMountHints` | `/proc/self/mountinfo` | 有序代码 `overlay_system / overlay_vendor / overlay_product / tmpfs_sbin / magisk_path`，无命中为 `none`。自定义 ROM 也可能出现 overlay，这不是 Root 结论 |
| `environment.rootManagerVisible` | `PackageManager.queryIntentActivities(MAIN/LAUNCHER)` | 固定包名列表命中的有序代码 `magisk / kernelsu / supersu / superuser / kingroot`，无命中为 `none`。受 Android 11+ 包可见性限制，`none` 不等于未安装 |
| `environment.userProfile` | `Process.myUid` / `ApplicationInfo.dataDir` | `owner`（用户 0）、`secondary`（其他用户，双开/分身/多用户）、`managed`（工作资料）。三者都不是恶意结论 |
| `environment.drmSecurityLevel` | `MediaDrm`（Widevine）`securityLevel` | `L1` / `L2` / `L3`；`L3` 只表示软件级密钥保护。DRM 打不开时记 `UNAVAILABLE / NOT_REPORTED` |
| `environment.verityMode` | `getprop ro.boot.veritymode` | 小写标记，如 `enforcing` / `disabled` / `logging` |
| `environment.buildDebuggable` | `getprop ro.debuggable` | `开启` / `关闭`；这是 ROM 自述，不等于当前 APK 可调试 |
| `system.partitionBuildDates` | `getprop ro.<partition>.build.date.utc` | 分区固定顺序 `system, vendor, product, odm, system_ext, bootimage`，UTC 日期。属性缺失的分区不补行 |
| `system.selinuxEvidence` | `/sys/fs/selinux/enforce` | `exact`（直接读到）、`inferred_mac`（DAC 允许读但被策略拒绝）、`inferred_disabled`（selinuxfs 未挂载） |
| `cpu.coresConfigured` | `Os.sysconf(_SC_NPROCESSORS_CONF)` | 内核配置的逻辑 CPU 数，可与 `cpu.sysCpuOnline` 及 `Runtime.availableProcessors` 并列对照 |
| `environment.androidIdSha256` | `Settings.Secure.ANDROID_ID` 的 SHA-256 | **仅本机**，不进入上传投影；保存摘要而非原值，用于同机多次采样比对 |

读取回退：`battery.sysBatteryTemp` 依次尝试 `battery/temp` 与 `bms/temp`；`system.bootloader`、`system.baseOs` 在 `Build` 为空时回退对应只读属性；`environment.storageEncryption` 在 `DevicePolicyManager` 无返回值时回退 `ro.crypto.state` 并标注来源。回退只改「能不能读到」，不改单位与状态语义。

`unavailableLabel` 现在把 `NOT_REPORTED` 显示为「系统未上报」，与「节点未暴露」「接口不提供」等具体原因分开；没有原因的 `UNAVAILABLE` 才显示「暂无数据」。

## 字段集 18：设备世代与分区分支

| 字段 | 来源 | 值与边界 |
| --- | --- | --- |
| `system.initialSdk` | `getprop ro.product.first_api_level`（Android 未向第三方公开 `DEVICE_INITIAL_SDK_INT`） | 出厂时的 API 级别（1–99）。低于当前 API 属正常的系统升级；只作世代对照，不据此判定真伪。真机上同一属性在 App 与 shell 两个上下文读到过不同值（33 / 31），说明它同样受身份改写影响。 |

分区分支：API 29 起仍用 `Build.getFingerprintedPartitions()`；Android 8/9 没有该接口，改为读取 `ro.<partition>.build.fingerprint` 只读属性，键空间不变（`system.partition_<name>`），来源段写实际属性路径，属性缺失的分区不补行。两种来源不互相覆盖，`partitionCount` 按实际得到的分区数记录。本轮两台测试机分别是 API 34 与 API 29，均走接口分支；属性回退分支只有静态核对，尚无 Android 8/9 真机样本。

## 字段集 19：身份字段与内部一致性

| 字段 | 来源 | 值与边界 |
| --- | --- | --- |
| `system.boardPlatform` | `getprop ro.board.platform` | 平台代号声明（如 `mt6985`、`sdm845`、`gs101`）。与 `Build.BOARD` 是两条独立来源 |
| `system.bootHardware` | `getprop ro.boot.hardware` | 启动硬件声明（如 `mtk`、`qcom`、`oriole`）。与 `Build.HARDWARE` 独立 |
| `system.hardwareSku` | `getprop ro.boot.hardware.sku` | 启动硬件 SKU（如 `GR1YH`、`23078PND5G`）。与 `Build.SKU`（API 31+）独立 |

三对对照：`system.board` ↔ `system.boardPlatform`、`cpu.hardware` ↔ `system.bootHardware`、`system.sku` ↔ `system.hardwareSku`。任一对两侧都有值且不同（忽略大小写）→「请核对」；至少一对可比且全部一致 →「已观察」；没有可比对 →「未确认」。它只说明**同一观察者内部**是否自洽，不判定真伪；跨观察者的差异由「证据来源对照」并列。

真机出现过 App 与 shell 两套自洽身份（App `23078PND5G / corot / mt6985`，shell `Pixel 6 / oriole / gs101`）。App 内部三对是一致的，所以本条不会报冲突——这正是设计意图：内部一致不等于物理真相，跨观察者差异必须另列。

## 字段集 20：开机次数与媒体性能等级

| 字段 | 来源 | 值与边界 |
| --- | --- | --- |
| `system.bootCount` | `Settings.Global.BOOT_COUNT` | 系统记账的冷启动次数（0–1,000,000）。每次冷启动递增，恢复出厂或清数据会重置；它不代表使用时长，也不单独推断刷机。真机 86 / 56，与 shell `settings get global boot_count` 一致 |
| `system.mediaPerformanceClass` | `Build.VERSION.MEDIA_PERFORMANCE_CLASS`（API 31+） | Android 媒体性能分级；`0` 表示 ROM 未声明。不是跑分。API 29 设备记 `INTERFACE_UNSUPPORTED` |

两者都只作世代/生命周期对照，不进入机器码，也不单独判定真伪。
