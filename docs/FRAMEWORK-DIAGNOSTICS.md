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

`enforce` 节点的 0 或 1 才是实时模式的直接读数。当前 App 遇到 EACCES 保留 `RESTRICTED / ACCESS_DENIED`；`Os.stat` 的 DAC 位只解释拒读背景，`inferred_mac` 不是模式判定。ENOENT 保留节点缺失，不推断 SELinux 已关闭。旧报告若曾保存推断文字，原文保持，分析按未确认处理。普通应用探测策略节点可打开性，不读取策略正文，也不依赖外部读数补值。

App 使用自身权限运行 `getprop`，每份快照解析一次有界的属性输出，只消费代码登记的键；属性表截断或失败且找不到该键时才限时回退单项查询。属性在完整输出中未出现时记 `UNAVAILABLE / NOT_REPORTED`，明确拒读或其他读取失败保留对应状态，不推断。

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
| `system.selinuxEvidence` | `/sys/fs/selinux/enforce` | `exact`（直接读到）、`inferred_mac`（拒读时的权限背景）、历史 `inferred_disabled`（旧采集器推断）。仅 `exact` 是直接模式依据 |
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
| `system.boardPlatform` | `getprop ro.board.platform` | 平台代号声明；与主板代号含义不同 |
| `system.bootHardware` | `getprop ro.boot.hardware` | 启动硬件声明；与 `Build.HARDWARE` 含义不同 |
| `system.hardwareSku` | `getprop ro.boot.hardware.sku` | 启动硬件 SKU，可与 `Build.SKU`（API 31+）核对同义读数，可能共享同一数据源 |

上述字段仍可用于同机、同字段的前后对照。历史版本曾把主板／平台、硬件／启动硬件当成冲突配对；当前规则已修正，见下文。跨观察者的历史差异另行存档，不进入 App 核对。

## 字段集 20：开机次数与媒体性能等级

| 字段 | 来源 | 值与边界 |
| --- | --- | --- |
| `system.bootCount` | `Settings.Global.BOOT_COUNT` | 系统记账的冷启动次数（0–1,000,000）。每次冷启动递增，恢复出厂或清数据会重置；它不代表使用时长，也不单独推断刷机。真机 86 / 56，与 shell `settings get global boot_count` 一致 |
| `system.mediaPerformanceClass` | `Build.VERSION.MEDIA_PERFORMANCE_CLASS`（API 31+） | Android 媒体性能分级；`0` 表示 ROM 未声明。不是跑分。API 29 设备记 `INTERFACE_UNSUPPORTED` |

两者都只作世代/生命周期对照，不进入机器码，也不单独判定真伪。

## 字段集 21：App 同义身份读数

| 字段 | 来源 | 值与边界 |
| --- | --- | --- |
| `system.propertyModel` | `getprop ro.product.model`（普通 App 权限） | 1–91 字符的声明文本（字母、数字、空格及有限标点），与 `system.model` 并列，不覆盖 |
| `system.propertyDevice` | `getprop ro.product.device`（普通 App 权限） | 1–64 字符的代号（ASCII 字母、数字、下划线、点或短横线），与 `system.device` 并列，不覆盖 |

两项无物理单位、不是唯一标识；仅随用户确认的白名单报告上传。值缺失、不可读与无效不补原值。后台不在旧报告中补造字段。核对口径和证据边界见 [App 身份声明核对](SECURITY-EVIDENCE.md#app-身份声明核对)。

## 字段集 22：第二观察通道（实测硬件）

字段集 21 及以前，身份核对全部建立在"同一声明被两个接口重复读出"上，例如 `Build.MODEL` 与 `ro.product.model`。实测显示改写层可以同时覆盖这两处，因此这类一致只能证明"改写是完整的"，不能证明硬件。字段集 22 补三个不走声明链的通道。

| 字段 | 来源 | 单位／格式 | 为什么它能独立 |
| --- | --- | --- | --- |
| `cpu.cpuParts` | 普通 App 读取 `/proc/cpuinfo` 全部分块 | `implementer:part×核心数`，最多 12 组 | 逐块统计 ARM MIDR，暴露 big.LITTLE 的真实核心组合；旧的 `cpu.cpuInfo` 只保留第一个分块，看不出微架构世代 |
| `memory.physicalRam` | `Os.sysconf(_SC_PHYS_PAGES) × _SC_PAGESIZE` | GiB（两位小数） | C 库路径，与 `ActivityManager.MemoryInfo` 不是同一处赋值 |
| `memory.kernelMemTotal` | `/proc/meminfo` 的 `MemTotal` | GiB（两位小数，1 GiB = 1048576 KiB） | 内核导出的节点，不经过框架或 C 库的机型描述 |
| `runtime.glesRenderer` | `EGL14` + `GLES20.glGetString(GL_RENDERER)` | 文本，≤96 字符 | GPU 驱动自报，与 `Build.SOC_MODEL` 无关 |
| `runtime.glesVendor` | 同上，`GL_VENDOR` | 文本，≤96 字符 | 驱动厂商字符串 |

**比对规则（`hardware_facts`）。** 三行结论，各自独立：

1. 内存多通道：`memory.totalRam`、`memory.physicalRam`、`memory.kernelMemTotal` 中任意两个以上有效值，最大与最小相差超过 8% 记 `REVIEW`，否则 `OBSERVED`。少于两个有效值记 `UNKNOWN`，不猜。
2. CPU 微架构：把声明侧（`system.socModel` / `system.boardPlatform` / `cpu.hardware` / `system.board`）映射到登记表里的 SoC，再看实测核心标识与该家族应有的核心类型是否有交集。
3. GPU 驱动：同一映射下，渲染器字符串是否包含该家族的 GPU 名（含 `Mali-G715` / `Immortalis-G715` 这类同核别名）。

登记表只覆盖本项目有书面依据的型号（`gs101`、`mt6985`、`sm8550`、`sm8450`、`sm8250`、`sdm845`）。未登记的 SoC 一律 `UNKNOWN`，不用"看起来像"去猜。任一行冲突都只提示核对测试条件，不判定设备真伪，也不进入机器码。

**`sdm845` 的登记口径（1.21.2 新增）。** label `Snapdragon 845`、cores `0x802`／`0x803`（实测 `cpu.cpuParts = 0x51:0x802×4 / 0x51:0x803×4`）、gpu `adreno`（实测 `runtime.glesRenderer = Adreno (TM) 630`）、alias `snapdragon 845`，通过 `ro.board.platform` 解析（API 29 没有 `ro.soc.model`）。**capacities 与 cmaMiB 故意留空**：内核 4.9 根本不暴露 `cpu_capacity`；`CmaTotal` 是设备树值不是 SoC 常量（MI 8 是 200 MiB，但同 SoC 的其他机型可能不同），所以不猜。新增登记会改变该家族设备的判定结果，画像规则因此 `sigmark-profile/7` → **`/8`**；证据行仍 10 条、标签仍 10 个。

**真机观察（Pixel 6，被改写为 Xiaomi 23078PND5G / Dimensity 9200+）。** 声明链与 GPU 字符串自洽：`Build.SOC_MODEL=Dimensity 9200+`、`ro.board.platform=mt6985`、`GL_RENDERER=Immortalis-G715`，三项互相印证。但两个内核通道不一致：

- `ActivityManager` 与 `sysconf` 都报 12.00 GiB，`/proc/meminfo` 报 7.44 GiB。
- `/proc/cpuinfo` 的核心是 `0xd05`、`0xd0b`、`0xd44`（Cortex-A55 / A76 / X1，即 Tensor G1），与 `mt6985` 应有的 `0xd46`、`0xd4d`、`0xd4e` 无交集。

结论记 `REVIEW`，两行冲突。这说明改写层覆盖了框架、C 库与 GPU 驱动，但没有覆盖 `/proc`。反过来说，如果只做字段集 21 的同义核对，这份样本会显示"3 对一致"。

## 字段集 23：镜像构建产物代号

字段集 22 的三条通道都还是"设备上的读数"，字段集 23 换一类证据：**镜像构建时写进文件名的东西**。

AOSP 按构建产品名生成 framework RRO，文件名形如 `framework-res__<product>_user__auto_generated_rro_<partition>.apk`。这些 idmap 被每个加载资源的进程映射，普通 App 通过 `/proc/self/maps` 就能看到。改机层改属性、改 `Build`、hook `uname`／`sysconf`，但不会重建这些文件——重建就等于重做一个 ROM。

| 字段 | 来源 | 单位／格式 | 为什么它能独立 |
| --- | --- | --- | --- |
| `environment.overlayDeviceCodename` | `/proc/self/maps` 里 framework RRO 文件名 | `device_codename`，小写代号 | 构建产物，不是属性；不受进程级改写影响 |

**比对规则（`overlay_codename`）。** 与 `system.device` 逐字比较（忽略大小写与连字符）：

- 两侧都读到且相同 → `OBSERVED`。
- 两侧都读到但不同 → `REVIEW`，提示"先核对改机、移植 ROM 或虚拟化环境"。
- 任一侧缺失 → `UNKNOWN`，不猜。

后台 `sigmark-profile/6` 把它作为 `hardware_declaration_conflict` 的第四条独立通道：`system.device` 与 `environment.overlayDeviceCodename` 不一致即记 `hit`，与内存离散度、核心集合、GPU 家族并列。证据行共 8 条，全部是真实归档读数，没有占位符。现行画像规则已升到 `sigmark-profile/7`，通道增至六条、证据行 10 条，见下节。

**真机观察（同一台 Pixel 6）。** `Build.DEVICE` 报 `corot`，`/proc/self/maps` 里的 overlay 却是 `framework-res__oriole_user__auto_generated_rro_{product,vendor}.apk`，读出 `oriole`。属性链与构建产物第一次给出互相矛盾的代号。

**边界。** 它证明的是"镜像构建产品名"，不是"物理机器型号"：移植 ROM 可以让真 Xiaomi 机器跑 `oriole` 镜像，也可能有 ROM 把 overlay 改名导致读不到。所以措辞停在"核对测试条件"，且缺失一律记 `UNAVAILABLE`，不当作干净。

## 字段集 24：内核算力权重与预留连续内存

字段集 22/23 读的是 `/proc` 与构建产物，字段集 24 再往下走一层：**内核按本机真实核心与内存布局写下的数字**。改机层能改属性、改 `Build`、hook `sysconf`，但它不改内核启动时算出来的算力权重，也不改启动时预留的连续内存池。

| 字段 | 来源 | 单位／格式 | 为什么它能独立 |
| --- | --- | --- | --- |
| `cpu.cpuCapacity` | `/sys/devices/system/cpu/cpu{N}/cpu_capacity` | `capacity_profile`，形如 `160/498/1024`，按核心顺序去重 | 内核调度器按实际核心类型（而非声明型号）写入的算力权重；big.LITTLE 的簇结构直接体现在比值上 |
| `memory.cmaTotal` | `/proc/meminfo` 的 `CmaTotal` | MiB（`652 MiB`） | 内核启动参数里预留的连续内存池，由板级配置决定；与 `totalMem`／`MemTotal` 不是同一处赋值 |

**比对规则（`hardware_facts`，新增两条通道）。** 与字段集 22 的"落不落在声明家族内"不同，这两条用**登记表反查**，判定分三种：

1. 实测值与**声明 SoC 自己**的登记值相同 → 一致（`OBSERVED`）。
2. 实测值与**另一个已登记 SoC** 的登记值相同 → 冲突（`REVIEW`，后台 `hardware_declaration_conflict` 记 `hit`）。这是正向识别，不是"看起来不像"。
3. 声明 SoC 未登记，或实测值不在登记表内 → 未确认（`UNKNOWN`），不猜，不按最接近的一项套用。

登记表目前**只有 `gs101` 填了这两项**（`160/498/1024`、`652 MiB`）；`sdm845` 是**故意留空**（内核 4.9 不暴露 `cpu_capacity`，`CmaTotal` 是设备树值），其余 SoC 留待补。因此现阶段的冲突结论只在"声明为 A、实测恰好等于 `gs101` 的登记值"这一种情形下成立。

后台 `sigmark-profile/7` 把这两条作为 `hardware_declaration_conflict` 的第五、第六条独立通道（前四条：内存离散度、核心集合、GPU 家族、overlay 代号），证据行因此从 8 条扩到 **10 条**（新增 `cpu.cpuCapacity`、`memory.cmaTotal`）。手机侧 `DevicePosture` 的 `hardware_facts` 行同口径，`measuredHardwareKeys` 增加这两个键，行内容相应变长。**1.21.2 起规则版本是 `sigmark-profile/8`**（因新增 `sdm845` 登记），通道与证据行数不变。

**真机观察 A（Pixel 6，被改写为 Xiaomi 23078PND5G / Dimensity 9200+）。** 同一台机器上读出 `cpu0–3 = 160`、`cpu4–5 = 498`、`cpu6–7 = 1024`，按核心顺序去重为 `160/498/1024`；`/proc/meminfo` 的 `CmaTotal = 667648 kB = 652 MiB`。两组值都命中 `gs101` 的登记值，而声明侧是 `mt6985`，因此两条通道都判冲突——与字段集 22 的 MIDR／内存口径指向同一个结论，但走的是不同的内核写入点。

手机侧同一份样本判 `REVIEW`，两条冲突文案为：

- 「声明为 Dimensity 9200+（mt6985），实测算力权重 160/498/1024 与 Tensor G1 的登记值一致。」
- 「声明为 Dimensity 9200+（mt6985），实测预留连续内存 652 MiB 与 Tensor G1 的登记值一致。」

后台对同一份归档复算 `ruleVersion=sigmark-profile/7`，10 条证据全部 `AVAILABLE`，无占位符。

**真机观察 B（Xiaomi MI 8 / `dipper`，未改装，API 29，内核 4.9.186）——旧内核的诚实降级。** 这台机器上 `cpu.cpuCapacity = UNAVAILABLE`（内核 4.9 不暴露 `cpu_capacity`，记 `UNAVAILABLE/NOT_REPORTED`，**不是 0，不是猜**），`memory.cmaTotal = 200 MiB`，`cpu.cpuParts = 0x51:0x802×4 / 0x51:0x803×4`，`runtime.glesRenderer = Adreno (TM) 630`，`system.socModel = NOT_ARCHIVED`（API 29 无 `ro.soc.model`，靠 `ro.board.platform` 解析）。后台判 `hardware_declaration_conflict = not_observed`（一致，不是 hit），`ruleVersion=sigmark-profile/8`。这条样本证明：**读不到时字段诚实降级，不会崩、不会编**。

**边界。** ① 两者都是**机型级**读数，不是单元级：同 SoC 的不同内存配置可能给出相同 `CmaTotal`，所以它只回答"与哪个登记 profile 相符"，不回答"是哪一台设备"。② `cpu_capacity` 的取值依赖内核调度器实现，老内核或厂商改过的调度器可能不写、写 1024 或写不同的权重序列；读不到记 `UNAVAILABLE`，不当作干净。③ 登记表只收有书面依据的型号，未登记一律未确认。④ 与其余通道一样，任一行冲突只提示"核对测试条件"，不判定设备真伪，也不进入机器码。

## 字段集 25：overlay 多路径证据串

字段集 23 的 `environment.overlayDeviceCodename` 只认 AOSP 的 `framework-res__<product>_user__auto_generated_rro_<partition>.apk` 一条路径。字段集 25 不再只留一个代号，而是把**哪条路径命中了什么**整串记下来，形如 `environment.overlayEvidence`。

| 字段 | 来源 | 单位／格式 | 为什么它能独立 |
| --- | --- | --- | --- |
| `environment.overlayEvidence` | `/proc/self/maps` + `/vendor`、`/product`、`/system_ext`、`/odm` 的 `overlay` 目录 | 通道串，` / ` 分隔、`:` 连接，值域 `^[a-z0-9_,]+$`，整串 ≤200 字符 | 全部是**构建产物文件名**，不是属性；改机层改属性不会重建这些文件。多路径并列让"读到"与"读不到"可区分 |

**通道与三态。** 通道顺序固定：`rro:` / `idmap:` / `vendor_dir:` / `product_dir:` / `system_ext_dir:` / `odm_dir:` / `sku:` / `soc:` / `conflict:`。每个通道三态：`<channel>:<value>` 命中、`<channel>:unknown` 可读但无匹配、`<channel>:denied` 读取被拒（errno 13）。不存在（ENOENT）的通道**整个省略**，不写 `unknown`——避免把"这台机器没有该分区"说成"读了但没读到"。

**比对规则。** 抽取三级冗余：本进程 `maps` 里的 framework RRO → `maps` 里其它 `<target>__<product>_user__auto_generated_rro` 的 idmap 转义名 → 四个分区 overlay 目录扫描。任一级命中即可给出代号；多级冲突时**以 `maps` 为准**（它反映本进程实际加载的镜像资源），并把冲突写进 `conflict:<a>=<x>!=<b>=<y>` 段，不做"多数票"。`sku:` 与 `soc:` 只是**旁证**，不参与代号判定。`overlay_codename` 行的判定口径不变（`system.device` 与 `overlayDeviceCodename` 比较）。画像规则在字段集 25 落地时仍是 `sigmark-profile/7`，**1.21.2 因新增 `sdm845` 登记升到 `/8`**（与本字段无关，是登记表变化）。

**真机观察 A（Pixel 6，被改写为 Xiaomi 23078PND5G）。** 实测读数：

- `environment.overlayEvidence = AVAILABLE · rro:oriole / vendor_dir:oriole / product_dir:oriole / sku:g9s9b,gb7n6,gr1yh / soc:gs101 · /proc/self/maps + /vendor|product|system_ext|odm/overlay`
- `environment.overlayDeviceCodename = AVAILABLE · oriole · /proc/self/maps`（旧字段保留不变）
- `overlay_codename` 行判 `REVIEW`：属性报 `corot`，镜像 overlay 报 `oriole`。

`idmap` 通道本机无独立命中故省略；`system_ext_dir`、`odm_dir` 为 ENOENT 故省略。

**真机观察 B（Xiaomi MI 8 / `dipper`，未改装，API 29）——非 AOSP ROM 的诚实降级。** `/vendor/overlay`、`/product/overlay` 存在但是 MIUI 命名（`CarrierConfigResCommon.apk`、`AccentColorBlack` 等），没有 `__device_user__auto_generated_rro` 模式，因此 `environment.overlayEvidence = UNAVAILABLE`、`environment.overlayDeviceCodename = UNAVAILABLE`。**记 `UNAVAILABLE`，不是"干净"**——没有信号和信号正常必须分开。

**`sku:` 段为什么是三个候选并列。** 设计预测 `sku:gr1yh`，实测是 `sku:g9s9b,gb7n6,gr1yh`。原因：改装层的按 UID 改写也覆盖了 `ro.boot.hardware.sku`——`adb shell` 读到 `GR1YH`（真机原值），`run-as com.sigmark.app` 读到 `23078PND5G`（小米 SKU）。App 侧声明 SKU 与三个候选全不匹配，按设计退回「逗号并列全部候选」。**这是设计正确降级，不是 bug。** 1.21.2 用未改装的 MI 8 把结论收窄了：那台机器上 `ro.boot.hardware.sku` **根本不存在**（shell 与 `run-as` 都读空），`model`／`device` 两 UID 一致——**per-UID 改写是改机层行为，不是 Android 行为**；只有 overlay 文件名是硬的。

**边界。** ① 它证明的是"镜像构建产品名"，不是"物理机器型号"：移植 ROM 可以让真 Xiaomi 机器跑 `oriole` 镜像。② 若 ROM 把 `__<product>_user__auto_generated_rro` 整套改名，多路径会全部落空——这是设计上接受的结果（安全但失去信号），不要用其它通道硬凑代号；缺失一律记 `UNAVAILABLE`，不当作干净。③ 目录列举走 `SafeReader.listNames`（`bounded` 包裹，400 ms 超时、最多 64 项、按名称排序后截断），并先 `Os.stat` 判别三态——被拒目录记 `RESTRICTED/ACCESS_DENIED errno=13`，不会像 1.21.0 之前那样被误报成「目录不存在」。这条路径已由 `SafeReaderInstrumentedTest`（22 条断言）覆盖。④ 与其余通道一样，冲突只提示"核对测试条件"，不判定设备真伪。

设计与多路径抽取的完整推导见 [overlay 代号多路径冗余抽取](OVERLAY-ROBUSTNESS.md)。

完整的伪装可覆盖面与盲区清单见 [机型伪装可覆盖面与盲区](DEVICE-DISGUISE-SURFACE.md)。