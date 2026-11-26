# 跨设备指纹对照矩阵

本文回答一个问题：**现有采集字段里，哪些能把「真机 / 模拟器」分开，哪些会撞车。**

只写从**已归档报告**里读出来的值，不写推测。每个值都能按文末的复现步骤重新取到。

最后更新：2026-11-26。

---

## 0. 数据来源与方法

### 0.1 三份主报告

| 简称 | 报告 ID | 设备 | fieldSet | 采集时间（UTC） | appVersion |
| --- | --- | --- | --- | --- | --- |
| **LD** | `6642e350-389d-4d5d-8371-663bb5eb9e54` | 雷电 LDPlayer 9 | 25 | 2026-11-26T07:30:43Z | 1.21.2 |
| **PX** | `867ad26e-6f0d-44aa-ac0e-2ede0a4e188a` | Pixel 6（伪装成小米） | 25 | 2026-11-26T07:00:29Z | 1.21.2 |
| **MI** | `77e577c1-c84b-4c5e-bb53-a9fe882be7bf` | 小米 MI 8 | 25 | 2025-11-25T12:44:55Z | 1.21.2 |

选这三份的理由：**fieldSetVersion 都是 25**，字段集完全一致，逐字段比对才有意义。库里共 26 份报告，fieldSet 从 16 到 25 不等，跨 fieldSet 比对会把「字段没采」误读成「值不同」。

### 0.2 取值规则

| 记号 | 含义 |
| --- | --- |
| 具体值 | 报告里 `status=AVAILABLE`，值原样抄录 |
| `[UNAVAILABLE]` | **字段在报告里存在**，但该设备取不到 |
| `[RESTRICTED]` | **字段在报告里存在**，系统拒绝普通应用读取 |
| `[NOFIELD]` | **字段根本不在该设备的报告里**（该 fieldSet 未投影此 key） |

最后两种的区别是本文件的一条硬纪律：**「字段没有」和「字段有但值为空」是两件事**。前者说明采集/投影链路上没有它，后者说明链路上有它、只是这台设备答不出。

### 0.3 字段总数

三份报告合并去重后共 **216 个 `group.key`**：

| 设备 | 参数条数 | `[NOFIELD]` | 非 `AVAILABLE` |
| --- | --- | --- | --- |
| LD | 209 | 7 | 24（全为 `UNAVAILABLE`） |
| PX | 214 | 2 | 11（8 `UNAVAILABLE` + 3 `RESTRICTED`） |
| MI | 204 | 12 | 23（21 `UNAVAILABLE` + 2 `RESTRICTED`） |

`[NOFIELD]` 的差异来自 `partition_*` 与 Wi-Fi 明细两组，见 §7.2。

---

## 1. 三台设备总览

| 项 | LD（雷电） | PX（Pixel 6） | MI（MI 8） |
| --- | --- | --- | --- |
| 性质 | **模拟器**（LDPlayer 9） | **真机**（硬件为 Pixel 6，系统层伪装成小米） | **真机**（原生小米） |
| `system.model` | `RMX5010` | `23078PND5G` | `MI 8` |
| `system.device` | `unicorn` | `corot` | `dipper` |
| `system.product` | `RMX5010` | `corot_global` | `dipper` |
| `system.manufacturer` / `brand` | `realme` / `realme` | `Xiaomi` / `Xiaomi` | `Xiaomi` / `Xiaomi` |
| `system.release` / `api` | 14 / 34 | 14 / 34 | 10 / 29 |
| `system.initialSdk` | 28 | 33 | 27 |
| `system.boardPlatform` | `aosp-user` | `mt6985` | `sdm845` |
| `system.board` | `RMX5010` | `mt6985` | `sdm845` |
| `system.bootHardware` | `qcom` | `mtk` | `qcom` |
| `system.socModel` | `[UNAVAILABLE]` | `Dimensity 9200+` | `[NOFIELD]` |
| `system.socManufacturer` | `AOSP` | `MediaTek` | `[NOFIELD]` |
| `cpu.hardware` | `qcom` | `mtk` | `qcom` |
| `cpu.cpuInfo` | `AMD Ryzen 9 9950X 16-Core Processor` | `implementer 0x41 · part 0xd05 · architecture 8` | `Qualcomm Technologies, Inc SDM845` |
| `cpu.cpuParts` | `[UNAVAILABLE]` | `0x41:0xd05×4 / 0x41:0xd0b×2 / 0x41:0xd44×2` | `0x51:0x802×4 / 0x51:0x803×4` |
| `runtime.glesRenderer` | `Adreno (TM) 750` | `Immortalis-G715` | `Adreno (TM) 630` |
| 打分结果 | `band=D` / `decisive` / 0 分可判轴加权 | `band=D` / `decisive` / 82 | `band=A` / 100 |

数据来自报告 `6642e350` / `867ad26e` / `77e577c1`。

### 1.1 一条必须先说清的事实：PX 的 `boardPlatform` 不是 `gs101`

任务简报里把 Pixel 6 的 `boardPlatform` 写成 `gs101`。**报告里的实际值是 `mt6985`**，而且库里三份 Pixel 6 报告（`867ad26e` / `2d1eccd0` / `745264e0`）完全一致，都是 `mt6985`。

`gs101` 是**这台机器的真实 SoC**，但不是它**上报的属性**。真实身份是从下面三处反推出来的，三处互相印证：

| 证据 | 值 | 指向 |
| --- | --- | --- |
| `cpu.cpuCapacity` | `160/498/1024` | `gs101` 画像值（`hardware_facts.go:29`） |
| `memory.cmaTotal` | `652 MiB` | `gs101` 画像值（同上） |
| `environment.overlayEvidence` | `… / soc:gs101` | RRO 覆盖层自报 |

也就是说：**这台 Pixel 6 的属性层被改写成了 Redmi（`mt6985` = Dimensity 9200+），而硬件层（CPU 容量表、CMA 总量）和覆盖层（`oriole` / `gs101`）没被一起改。** 这正好是「伪装只改了一半」的现场样本。

---

## 2. 字段级对照矩阵（67 个字段）

判定口径：

| 标记 | 含义 |
| --- | --- |
| **撞车** | 三台值相同，且都是真实值 → **对区分毫无价值** |
| 同为缺失 | 三台都取不到（不是撞车，是都没数据） |
| 真机同为缺失 | 两台真机都取不到，模拟器有值 |
| **模拟器独异** | 两台真机相同、模拟器不同 → **有区分度** |
| 模拟器撞真机 | 模拟器与其中一台真机相同 → **单独用会误判** |
| 三台全异 | 三台互不相同 → 需结合其它字段才可判 |

### 2.1 身份类（20）

| 字段 | LD（模拟器） | PX（Pixel 6） | MI（MI 8） | 判定 |
| --- | --- | --- | --- | --- |
| `system.model` | RMX5010 | 23078PND5G | MI 8 | 三台全异 |
| `system.device` | unicorn | corot | dipper | 三台全异 |
| `system.product` | RMX5010 | corot_global | dipper | 三台全异 |
| `system.manufacturer` | realme | Xiaomi | Xiaomi | **模拟器独异** |
| `system.brand` | realme | Xiaomi | Xiaomi | **模拟器独异** |
| `system.boardPlatform` | aosp-user | mt6985 | sdm845 | 三台全异 |
| `system.board` | RMX5010 | mt6985 | sdm845 | 三台全异 |
| `system.bootHardware` | qcom | mtk | qcom | 模拟器撞真机 |
| `system.hardwareSku` | `[UNAVAILABLE]` | 23078PND5G | `[UNAVAILABLE]` | 模拟器撞真机 |
| `system.sku` | `[UNAVAILABLE]` | 23078PND5G | `[NOFIELD]` | 三台全异 |
| `system.initialSdk` | 28 | 33 | 27 | 三台全异 |
| `system.socModel` | `[UNAVAILABLE]` | Dimensity 9200+ | `[NOFIELD]` | 三台全异 |
| `system.socManufacturer` | AOSP | MediaTek | `[NOFIELD]` | 三台全异 |
| `system.buildId` | UQ1A.240205.06151050 | UP1A.231005.007 | QKQ1.190828.002 | 三台全异 |
| `system.display` | UQ1A.240205.06151050 release-keys | UP1A.231005.007.OS1.0.9.0.UMLMIXM | QKQ1.190828.002 test-keys | 三台全异 |
| `system.incremental` | lee.20260615.105024 | OS1.0.9.0.UMLMIXM | V12.5.2.0.QEACNXM | 三台全异 |
| `system.romHint` | `[UNAVAILABLE]` | V816 | V125 | 三台全异 |
| `system.patch` | 2024-02-05 | 2026-07-05 | 2020-12-01 | 三台全异 |
| `system.mediaPerformanceClass` | 0 | 31 | `[UNAVAILABLE]` | 三台全异 |
| `system.bootloader` | `[UNAVAILABLE]` | corot-1.0.9 | `[UNAVAILABLE]` | 模拟器撞真机 |

数据来自报告 `6642e350` / `867ad26e` / `77e577c1`。

**`system.display` 在 MI 8 上自相矛盾**：值里带 `test-keys`，而同一份报告的 `system.tags=release-keys`、`system.partition_system` 里的 fingerprint 写的是 `user/release-keys`。这是**真机自己的不一致**（`Build.DISPLAY` 由厂商拼串，MIUI 在这里拼了 `test-keys`），不是伪造证据。**任何把 `system.display` 当构建类型判据的规则都会在 MI 8 上误报。**

### 2.2 分区类（2）

| 字段 | LD（模拟器） | PX（Pixel 6） | MI（MI 8） | 判定 |
| --- | --- | --- | --- | --- |
| `system.partitionCount` | 5 | 5 | 4 | 模拟器撞真机 |
| `system.partitionBuildDates` | system 2026-06-15 · vendor 2026-06-15 · odm 2026-06-15 · system_ext 2026-06-15 · bootimage 2026-06-15 | system 2024-08-09 · vendor 2024-08-09 · product 2024-08-09 · odm 2024-08-09 · system_ext 2024-08-09 | system 2021-10-28 · vendor 2021-10-28 · odm 2021-10-28 · bootimage 2021-10-28 | 三台全异 |

数据来自报告 `6642e350` / `867ad26e` / `77e577c1`。

### 2.3 CPU 类（12）

| 字段 | LD（模拟器） | PX（Pixel 6） | MI（MI 8） | 判定 |
| --- | --- | --- | --- | --- |
| `cpu.hardware` | qcom | mtk | qcom | 模拟器撞真机 |
| `cpu.cpuInfo` | AMD Ryzen 9 9950X 16-Core Processor | implementer 0x41 · part 0xd05 · architecture 8 | Qualcomm Technologies, Inc SDM845 | 三台全异 |
| `cpu.cpuParts` | `[UNAVAILABLE]` | 0x41:0xd05×4 / 0x41:0xd0b×2 / 0x41:0xd44×2 | 0x51:0x802×4 / 0x51:0x803×4 | 三台全异 |
| `cpu.coresConfigured` | 2 | 8 | 8 | **模拟器独异** |
| `cpu.arch` | x86_64 | aarch64 | aarch64 | **模拟器独异** |
| `cpu.kernelMachine` | x86_64 | aarch64 | aarch64 | **模拟器独异** |
| `cpu.abi64` | x86_64, arm64-v8a | arm64-v8a | arm64-v8a | **模拟器独异** |
| `cpu.cpuCapacity` | `[UNAVAILABLE]` | 160/498/1024 | `[UNAVAILABLE]` | 模拟器撞真机 |
| `cpu.cpu0MaxFrequency` | 2866 MHz | 1803 MHz | 1766 MHz | 三台全异 |
| `cpu.kernel` | 5.15.178+ | 5.15.123-android13-8-g51b93e9fd2a1-ab12020112 | 4.9.186-perf-g10af704 | 三台全异 |
| `cpu.processBitness` | 64 | 64 | 64 | **撞车** |
| `cpu.features` | `[UNAVAILABLE]` | fp, asimd, evtstrm, aes, pmull, sha1, sha2, crc32, atomics, fphp, asimdhp, cpuid, asimdrdm, lrcpc, dcpop, asimddp | fp, asimd, evtstrm, aes, pmull, sha1, sha2, crc32, atomics, fphp, asimdhp | 三台全异 |

数据来自报告 `6642e350` / `867ad26e` / `77e577c1`。

### 2.4 内存类（4）

| 字段 | LD（模拟器） | PX（Pixel 6） | MI（MI 8） | 判定 |
| --- | --- | --- | --- | --- |
| `memory.kernelMemTotal` | 1.94 GiB | 7.44 GiB | 5.50 GiB | 三台全异 |
| `memory.totalRam` | 1.94 GiB | 12.00 GiB | 5.50 GiB | 三台全异 |
| `memory.cmaTotal` | `[UNAVAILABLE]` | 652 MiB | 200 MiB | 三台全异 |
| `memory.lowMemoryThreshold` | 0.21 GiB | 0.34 GiB | 0.21 GiB | 模拟器撞真机 |

数据来自报告 `6642e350` / `867ad26e` / `77e577c1`。

### 2.5 安全 / 启动类（10）

| 字段 | LD（模拟器） | PX（Pixel 6） | MI（MI 8） | 判定 |
| --- | --- | --- | --- | --- |
| `system.selinux` | Permissive（宽容模式） | `[RESTRICTED]` | `[RESTRICTED]` | 真机同为缺失 |
| `system.selinuxEvidence` | exact | inferred_mac | inferred_mac | **模拟器独异** |
| `system.selinuxPolicy` | 可打开（未读取内容） | `[RESTRICTED]` | `[RESTRICTED]` | 真机同为缺失 |
| `system.bootCount` | 2 | 86 | 56 | 三台全异 |
| `environment.verityMode` | `[UNAVAILABLE]` | enforcing | enforcing | **模拟器独异** |
| `environment.verifiedBoot` | `[UNAVAILABLE]` | green | green | **模拟器独异** |
| `environment.vbmetaState` | `[UNAVAILABLE]` | locked | `[UNAVAILABLE]` | 模拟器撞真机 |
| `environment.buildDebuggable` | 开启 | `[UNAVAILABLE]` | 关闭 | 三台全异 |
| `environment.storageEncryption` | 系统报告不支持 | 已启用（按用户加密） | 已启用（按用户加密） | **模拟器独异** |
| `environment.flashLock` | `[UNAVAILABLE]` | 1 | 1 | **模拟器独异** |

数据来自报告 `6642e350` / `867ad26e` / `77e577c1`。

**这一组是本文件最值得注意的一组**：`system.selinux` 在模拟器上是 `Permissive`、在两台真机上都是 `RESTRICTED`。也就是说这条规则在真机上**从来不触发**（因为读不到），只在模拟器上触发——**它的区分力来自「模拟器读得到、真机读不到」这个不对称，而不是来自值本身**。详见 §6.3。

### 2.6 运行时 / 显示类（11）

| 字段 | LD（模拟器） | PX（Pixel 6） | MI（MI 8） | 判定 |
| --- | --- | --- | --- | --- |
| `runtime.glesRenderer` | Adreno (TM) 750 | Immortalis-G715 | Adreno (TM) 630 | 三台全异 |
| `runtime.glesVendor` | Qualcomm | ARM | Qualcomm | 模拟器撞真机 |
| `runtime.openGlEs` | 3.1 | 3.2 | 3.2 | **模拟器独异** |
| `runtime.vulkanVersion` | 1.3.0 | 1.3.0 | 1.1.0 | 模拟器撞真机 |
| `runtime.heapMax` | 192.0 MiB | 256.0 MiB | 256.0 MiB | **模拟器独异** |
| `runtime.externalInputTypes` | pointer | none | none | **模拟器独异** |
| `display.resolution` | 720 × 1280 | 1220 × 2712 | 1080 × 2248 | 三台全异 |
| `display.refresh` | 60.0 Hz | 144.0 Hz | 60.0 Hz | 模拟器撞真机 |
| `display.densityDpi` | 320 dpi | 420 dpi | 440 dpi | 三台全异 |
| `display.sizeEstimate` | 4.6 英寸 | 6.7 英寸 | 6.2 英寸 | 三台全异 |
| `display.hdr` | 未声明支持 | HDR10 / HLG / HDR10+ | HDR10 / HLG | 三台全异 |

数据来自报告 `6642e350` / `867ad26e` / `77e577c1`。

### 2.7 环境 / 网络类（8）

| 字段 | LD（模拟器） | PX（Pixel 6） | MI（MI 8） | 判定 |
| --- | --- | --- | --- | --- |
| `environment.overlayDeviceCodename` | `[UNAVAILABLE]` | oriole | `[UNAVAILABLE]` | 模拟器撞真机 |
| `environment.overlayEvidence` | `[UNAVAILABLE]` | rro:oriole / vendor_dir:oriole / product_dir:oriole / sku:g9s9b,gb7n6,gr1yh / soc:gs101 | `[UNAVAILABLE]` | 模拟器撞真机 |
| `environment.drmSecurityLevel` | L3 | L1 | L3 | 模拟器撞真机 |
| `environment.buildSignals` | user · release-keys | user · release-keys | user · release-keys | **撞车** |
| `system.uptime` | 0 天 0 小时 39 分钟 | 7 天 17 小时 13 分钟 | 13 天 3 小时 35 分钟 | 三台全异 |
| `system.gnssModelReported` | `[UNAVAILABLE]` | yes | yes | **模拟器独异** |
| `system.webViewVersion` | 146.0.7680.119 | 119.0.6045.141 | 83.0.4103.101 | 三台全异 |
| `network.bandwidthEstimate` | 下行 1048576 kbps / 上行 1048576 kbps | 下行 29901 kbps / 上行 23690 kbps | 下行 1048576 kbps / 上行 1048576 kbps | 模拟器撞真机 |

数据来自报告 `6642e350` / `867ad26e` / `77e577c1`。

> 注：`network.bandwidthEstimate` 在 LD 与 MI 8 上**完全一致**（下行、上行都是 `1048576 kbps`），只有 PX 不同。`1048576` = `2^20`，是 Android 在**无法测量带宽时**返回的占位值——所以这个字段实际是「LD 和 MI 8 都测不出来」，不是「两者带宽相同」。**它区分的是「测量成功与否」，不是设备。**

### 2.8 本节小结

| 判定 | 字段数 |
| --- | --- |
| **撞车**（三台真实值相同） | 2 |
| 同为缺失 / 真机同为缺失 | 2 |
| **模拟器独异**（两台真机相同、模拟器不同） | 15 |
| 模拟器撞真机（模拟器与一台真机相同） | 15 |
| 三台全异 | 33 |
| **合计** | **67** |

---

## 3. 撞车字段清单（59 个三台同值）

全库 216 个字段里，**59 个在三台设备上完全同值**。其中：

- **55 个是真实值撞车** —— 对区分设备**零价值**；
- **4 个是三台同时取不到** —— 不是撞车，是都没数据（`battery.energyCounter`、`cellular.cellLTEBandwidth`、`system.baseOs`、`system.selinuxBuildHint`）。

### 3.1 55 个真实值撞车字段

| 分组 | 字段 = 三台共同值 | 为什么必然撞车 |
| --- | --- | --- |
| **App 自身**（6） | `app.package=com.sigmark.app`、`app.version=1.21.2 (50)`、`app.certSha256=e424900e…3904`、`app.channel=lan-debug`、`app.appDebuggable=是`、`app.debuggerConnected=否` | 这是**采集器自己的属性**，与被测设备无关。三份报告都出自同一个 APK |
| **采集环境**（10） | `environment.capturePlan=full`、`captureLocationAccess=precise`、`captureLocationSwitch=enabled`、`capturePhoneAccess=granted`、`userProfile=owner`、`keyguardSecure=否`、`hookSignals=none`、`rootManagerVisible=none`、`rootMountHints=none`、`tracerPid=0` | 反映的是**采集时的授权与运行环境**，三次采集用的是同一套流程 |
| **构建类型**（3） | `system.type=user`、`system.tags=release-keys`、`environment.buildSignals=user · release-keys` | 三者同源（`Build.TYPE` / `Build.TAGS`）。**LD 是模拟器也报 `release-keys`** —— 因为它是官方 AOSP 镜像，本来就不是 `test-keys` |
| **SELinux 上下文**（1） | `environment.selinuxDomain=untrusted_app` | 所有第三方应用都在这个域下运行，与设备无关 |
| **CPU 常量**（1） | `cpu.pageSize=4096 B` | 页大小在三种架构上都是 4 KiB |
| **媒体能力**（7） | `media.audioCapabilities=低延迟 是 · 专业音频 是`、`audioSampleRate=48000 Hz`、`bluetoothCapabilities=经典蓝牙 是 · BLE 是`、`cameraCount=2`、`avcFixture=sigmark-avc/1`、`avcStage=done`、`avcFirstFrame=pass` | 前四项是 Android 平台基线能力；后三项是**我们自己定义的自检固定值**，必然是常量 |
| **内存 / 存储**（3） | `memory.lowMemory=否`、`memory.sharedState=mounted`、`memory.volumeSummary=主卷 · mounted · 模拟存储 · 不可移除` | 采集时三台都不紧张、主卷都挂载正常 |
| **网络基线**（8） | `network.transport=Wi-Fi`、`defaultRouteFamilies=IPv4`、`internetValidation=系统已验证`、`captivePortal=系统未标记登录门户`、`linkMtu=1500 字节`、`metered=不计量`、`privateDnsActive=未启用`、`wifiRouteRole=默认网络` | 都是「Wi-Fi 正常联网」的默认形态 |
| **蜂窝基线**（4） | `cellular.cellDiagnostics=LTE`、`dataState=未连接`、`defaultDataSlot=卡槽 1`、`roaming=未漫游` | 采集时都没走蜂窝数据 |
| **运行时**（5） | `runtime.virtualMachine=Dalvik · 2.1.0`、`glesProbeResult=pass`、`glesProbeStage=done`、`backgroundRestricted=否`、`declaredInput=touchscreen / multitouch / multitouch_distinct / jazzhand` | ART 版本号是 Android 14 的常量；其余是自检固定结果 |
| **电池状态**（3） | `battery.powerSaver=关闭`、`present=yes`、`thermalStatus=正常` | 采集时三台都没开省电、都正常 |
| **其它**（4） | `system.gnssProvider=yes`、`system.interfaceCapabilities=nfc / gnss / usb_host / usb_accessory`、`environment.systemDebuggable=user / release-keys（标准量产构建类型）`、`cpu.processBitness=64` | 都是平台/构建层面的常量 |

### 3.2 4 个「三台同时取不到」的字段

`battery.energyCounter`、`cellular.cellLTEBandwidth`、`system.baseOs`、`system.selinuxBuildHint` —— 三台全是 `[UNAVAILABLE]`。

**这四个不是撞车，是全军覆没。** 它们要么是 API 级别不支持（`system.baseOs` 需要 API 30+ 且部分厂商不实现），要么是硬件不支持（`energyCounter` 需要电池计量芯片）。**任何读这四个字段的规则在三台设备上都拿不到输入**，应该直接从判据里剔除或降级为「可选证据」。

### 3.3 撞车的两类原因（重要区别）

| 类型 | 例子 | 含义 |
| --- | --- | --- |
| **与被测设备无关** | `app.*`、`environment.capture*`、`media.avc*` | 这些字段测的是**采集器自己**，永远不可能区分设备。放进判据是纯噪声 |
| **平台常量** | `cpu.pageSize`、`system.type`、`system.tags`、`environment.selinuxDomain` | 测的是 Android 平台，不是设备。**在真机之间也撞**，区分力为零 |

**关键推论**：`system.tags=release-keys` 三台相同，说明**「构建标签」这条判据在雷神上完全无效**——雷神用的就是官方 `release-keys` 镜像。这和 `VIRTUALIZATION-MATRIX.md` §3.1 的实测吻合：`ro.build.tags` 可被改写，但**雷神根本不需要改**，因为它本来就是 `release-keys`。

---

## 4. 高区分度字段（34 个）

### 4.1 第一梯队：一票能区分（2 个）

| 字段 | 模拟器 | 真机 | 为什么一票就够 |
| --- | --- | --- | --- |
| `cpu.cpuInfo` | `AMD Ryzen 9 9950X 16-Core Processor` | `implementer 0x41 · part 0xd05…` / `Qualcomm Technologies, Inc SDM845` | 来源是 `/proc/cpuinfo` 内核视图。两台真机报的是 **ARM implementer 编码**或 **SoC 厂商名**，模拟器直接暴露了**宿主机的桌面 CPU 型号** |
| `system.boardPlatform` | `aosp-user` | `mt6985` / `sdm845` | 真机这里必然是 **SoC 代号**（`mt6985`=Dimensity 9200+、`sdm845`=Snapdragon 845）。`aosp-user` 是 AOSP 构建串，零售机不会这么写 |

这两个正是 `STRUCTURAL_VIRTUAL_EVIDENCE`（35 分，决定性）的两条通道。**它们的强度不对称**：`cpu.cpuInfo` 是硬通道（`/proc` 不可写），`system.boardPlatform` 是软通道（`ro.board.platform`，一条 `setprop` 即失效）。详见 `VIRTUALIZATION-MATRIX.md` §四。

### 4.2 第二梯队：两台真机共识 vs 模拟器（32 个）

这 32 个字段的共同形态是：**两台真机取值相同（或都取不到），模拟器不同。** 它们是「真机共识」型判据的原料。

| # | 字段 | 模拟器 | 两台真机（共识） | 类型 |
| --- | --- | --- | --- | --- |
| 1 | `cpu.arch` | `x86_64` | `aarch64` | 架构 |
| 2 | `cpu.kernelMachine` | `x86_64` | `aarch64` | 架构 |
| 3 | `cpu.abi64` | `x86_64, arm64-v8a` | `arm64-v8a` | ABI |
| 4 | `cpu.abis` | `x86_64, arm64-v8a, x86, armeabi-v7a, armeabi` | `arm64-v8a, armeabi-v7a, armeabi` | ABI |
| 5 | `cpu.abi32` | `x86, armeabi-v7a, armeabi` | `armeabi-v7a, armeabi` | ABI |
| 6 | `cpu.cores` | 2 | 8 | 核数 |
| 7 | `cpu.coresConfigured` | 2 | 8 | 核数 |
| 8 | `cpu.sysCpuOnline` | `0-1` | `0-7` | 核数 |
| 9 | `cpu.sysCpuPossible` | `0-1` | `0-7` | 核数 |
| 10 | `system.manufacturer` | `realme` | `Xiaomi` | 身份 |
| 11 | `system.brand` | `realme` | `Xiaomi` | 身份 |
| 12 | `environment.verityMode` | `[UNAVAILABLE]` | `enforcing` | 启动完整性 |
| 13 | `environment.verifiedBoot` | `[UNAVAILABLE]` | `green` | 启动完整性 |
| 14 | `environment.flashLock` | `[UNAVAILABLE]` | `1` | 启动完整性 |
| 15 | `environment.storageEncryption` | 系统报告不支持 | 已启用（按用户加密） | 存储加密 |
| 16 | `system.selinuxEvidence` | `exact` | `inferred_mac` | SELinux |
| 17 | `system.selinuxBootHint` | `permissive` | `[UNAVAILABLE]` | SELinux |
| 18 | `system.gnssModelReported` | `[UNAVAILABLE]` | `yes` | 定位 |
| 19 | `runtime.openGlEs` | `3.1` | `3.2` | GPU |
| 20 | `runtime.glesProbeVersion` | `3.1` | `3.2` | GPU |
| 21 | `runtime.heapMax` | `192.0 MiB` | `256.0 MiB` | 运行时 |
| 22 | `runtime.externalInputTypes` | `pointer` | `none` | 输入设备 |
| 23 | `sensors.directChannelTypes` | `none` | `hardware_buffer` | 传感器 |
| 24 | `display.wideGamut` | 否 | 是 | 显示 |
| 25 | `battery.sysBatteryTemp` | `[UNAVAILABLE]` | `[RESTRICTED]` | 电池 |
| 26 | `cellular.carrierBandwidths` | `20000 kHz` | `[UNAVAILABLE]` | 蜂窝 |
| 27 | `cellular.cellLTEBands` | `B1` | `B3` | 蜂窝 |
| 28 | `cellular.cellLTEBandRange` | `B1：2110–2170 MHz` | `B3：1805–1880 MHz` | 蜂窝 |
| 29 | `cellular.modemSignalLevel` | `4 / 4` | `3 / 4` | 蜂窝 |
| 30 | `network.wifiDetails` | `[UNAVAILABLE]` | `[]` | Wi-Fi |
| 31 | `system.selinux` | `Permissive（宽容模式）` | `[RESTRICTED]` | SELinux |
| 32 | `system.selinuxPolicy` | 可打开（未读取内容） | `[RESTRICTED]` | SELinux |

数据来自报告 `6642e350` / `867ad26e` / `77e577c1`。

### 4.3 本梯队里最可靠的三组

**第一组：CPU 架构族（#1–#9，9 个字段）**

`cpu.arch` / `cpu.kernelMachine` 是 `x86_64` vs `aarch64`，这是**最硬的区分**：模拟器跑在 x86 宿主上，真机是 ARM。要伪造它，得让 `uname -m` 和 `ro.product.cpu.abi` 一起撒谎，成本远高于改一个属性。

`cpu.cores` / `coresConfigured` / `sysCpuOnline` / `sysCpuPossible` 四者一致指向 2 vs 8。**注意这是「配置」不是「物理」**——模拟器只分配了 2 核，不等于宿主机只有 2 核。所以它能区分「当前这台实例的规格」，不能证明「是不是模拟器」。

**第二组：启动完整性（#12–#15，4 个字段）**

`environment.verityMode` / `verifiedBoot` / `flashLock` 在模拟器上全是 `[UNAVAILABLE]`，两台真机都有确定值。**这组的方向值得注意：不是「模拟器报了可疑值」，而是「模拟器根本答不出」。** 所以它们的判据形态应该是「真机必答、模拟器答不出」，而不是「值等于某个黑名单」。

`environment.storageEncryption` 是唯一一个模拟器**主动报出**「系统报告不支持」的——这比 `[UNAVAILABLE]` 更强，因为它说明设备**回答了，答案是没有**。

**第三组：SELinux 不对称（#16、#17、#31、#32，4 个字段）**

两台真机 `system.selinux` 都是 `RESTRICTED`（系统拒绝读），模拟器是 `Permissive`。**这不是「模拟器更宽松」的证据，是「模拟器允许普通应用读到这个值」的证据。** 真实的 Android 14 真机上 `/sys/fs/selinux/enforce` 对普通应用不可读，而 LDPlayer 的镜像放开了。

`system.selinuxEvidence` 的三态（`exact` / `inferred_mac`）正是这个差异的显式化：模拟器能读到精确值，真机只能从 MAC 推断。

### 4.4 不能单独用的「模拟器撞真机」15 个

| 字段 | 模拟器 | 撞的是哪台 | 后果 |
| --- | --- | --- | --- |
| `system.bootHardware` | `qcom` | MI 8 | 用「qcom=真机」会放过模拟器 |
| `cpu.hardware` | `qcom` | MI 8 | 同上，且这正是 F17 的绕过点 |
| `system.hardwareSku` | `[UNAVAILABLE]` | MI 8 | 两台都取不到，无信息 |
| `system.bootloader` | `[UNAVAILABLE]` | MI 8 | 同上 |
| `system.partitionCount` | 5 | PX | 5 是常见值，不具区分力 |
| `cpu.cpuCapacity` | `[UNAVAILABLE]` | MI 8 | 两台都缺 |
| `memory.lowMemoryThreshold` | 0.21 GiB | MI 8 | 内存比例算出，非设备指纹 |
| `runtime.glesVendor` | `Qualcomm` | MI 8 | 用「vendor≠Qualcomm」会漏掉 LD |
| `runtime.vulkanVersion` | 1.3.0 | PX | Android 14 通用版本号 |
| `display.refresh` | 60.0 Hz | MI 8 | 60 Hz 是绝大多数设备的默认 |
| `environment.vbmetaState` | `[UNAVAILABLE]` | MI 8 | 两台都缺 |
| `environment.overlayDeviceCodename` | `[UNAVAILABLE]` | MI 8 | 只有 PX 有值，MI 8 也没有 |
| `environment.overlayEvidence` | `[UNAVAILABLE]` | MI 8 | 同上 |
| `environment.drmSecurityLevel` | L3 | MI 8 | L3 是老设备常见等级 |
| `network.bandwidthEstimate` | 下行/上行均 1048576 kbps | MI 8（完全相同） | 完整撞车；`2^20` 是「测不出」占位值 |

数据来自报告 `6642e350` / `867ad26e` / `77e577c1`。

**这 15 个字段的共同教训**：`cpu.hardware=qcom` 在模拟器上成立、在 MI 8 上也成立。**「qcom」既不是真机信号也不是模拟器信号**——它只是模拟器厂商顺手抄的值。这正是 F17 记录的那条绕过路径。

---

## 5. 两台真机之间的差异（Pixel 6 vs MI 8）

### 5.1 差异概览

两台真机在 216 个字段里有 **125 个不同**、**32 个相同**（另有 59 个三台全同）。差异面远大于共识面，说明**「真机」不是一个同质类别**。

### 5.2 身份与硬件差异

| 字段 | PX（Pixel 6） | MI（MI 8） | 说明 |
| --- | --- | --- | --- |
| `system.device` | corot | dipper | 代号 |
| `system.boardPlatform` | mt6985 | sdm845 | SoC 代号 |
| `system.socModel` | Dimensity 9200+ | `[NOFIELD]` | MI 8 的 fieldSet 没有这个 key |
| `system.socManufacturer` | MediaTek | `[NOFIELD]` | 同上 |
| `cpu.cpuInfo` | implementer 0x41 · part 0xd05… | Qualcomm Technologies, Inc SDM845 | **格式完全不同** |
| `cpu.cpuParts` | 0x41:0xd05×4 / 0x41:0xd0b×2 / 0x41:0xd44×2 | 0x51:0x802×4 / 0x51:0x803×4 | implementer 不同（0x41=ARM 自研、0x51=Qualcomm） |
| `memory.cmaTotal` | 652 MiB | 200 MiB | 设备树值，非 SoC 常量 |
| `cpu.cpuCapacity` | 160/498/1024 | `[UNAVAILABLE]` | MI 8 内核 4.9 不暴露 `cpu_capacity` |
| `system.release` / `api` | 14 / 34 | 10 / 29 | 差 4 个大版本 |

数据来自报告 `867ad26e` / `77e577c1`。

### 5.3 一个必须记住的差异：`cpu.cpuInfo` 的两种格式

| 设备 | 值 | 格式 |
| --- | --- | --- |
| Pixel 6 | `implementer 0x41 · part 0xd05 · architecture 8` | **ARM implementer 编码** |
| MI 8 | `Qualcomm Technologies, Inc SDM845` | **厂商名 + 型号** |
| 雷电 | `AMD Ryzen 9 9950X 16-Core Processor` | **桌面 CPU 商品名** |

**两台真机的格式就不一样。** 任何「匹配 cpuInfo 文本」的规则都必须同时容纳前两种，只认一种就会误伤另一台。这正是 `cpuInfoContradictsHandset` 里那条「`implementer 0x` 直接返回 false」防误伤设计的必要性来源——Pixel 6 就长这样。

### 5.4 会让规则误判的两处

**① `system.display` 在 MI 8 上自相矛盾**

| 字段 | MI 8 的值 |
| --- | --- |
| `system.display` | `QKQ1.190828.002 test-keys` |
| `system.tags` | `release-keys` |
| `system.type` | `user` |
| `system.partition_system` | `…:user/release-keys · 2021-10-28T07:01:40Z` |

三个字段说 `release-keys`，只有 `Build.DISPLAY` 拼出来的字符串带 `test-keys`。**这是 MIUI 的拼串习惯，不是伪造。** 任何把 `system.display` 当构建类型判据的规则都会在 MI 8 上误报。

**② Pixel 6 被打成 `band=D`，但它是一台真机**

| 项 | 值 |
| --- | --- |
| 分数 / 等级 | 82 / `D` / `decisive=true` |
| `FOREIGN_PROFILE`（30 分） | `实测 cpu.cpuCapacity=160/498/1024；memory.cmaTotal=652 MiB 与另一颗已登记 SoC 的画像值一致` |
| `OVERLAY_CODENAME_MISMATCH`（15 分） | `system.device=corot 与 environment.overlayDeviceCodename=oriole 不一致` |

这两条**不是误报，是命中了真实存在的伪装**：这台机器的硬件是 `gs101`（Tensor G1 / Pixel 6），属性层被改写成了 `mt6985`（Dimensity 9200+ / Redmi）。规则抓到的是「声明与硬件不符」，而**这个不符是真实的**。

但它带来一个必须写清的后果：**`band=D` 在这台机器上同时意味着「它确实被改过」和「它的硬件是真的」**。单看分数无法区分「真机刷了伪装层」和「模拟器伪装成真机」——两者的分数形态可能一样。区分它们要靠 §6.2 里的硬通道。

### 5.5 两台真机的共识（32 个）

见 §4.2 表格。这 32 个字段是「真机共识」型判据的全部原料，其中 **CPU 架构族（9 个）与启动完整性（4 个）** 最可靠。

---

## 6. 结论与建议

### 6.1 建议纳入判据的字段

| 优先级 | 字段 | 建议判据形态 | 理由 |
| --- | --- | --- | --- |
| **P0** | `cpu.cpuInfo` | 已实现：桌面 CPU 族名 + `implementer 0x` 早退 | 唯一硬通道 |
| **P0** | `system.boardPlatform` | 已实现：通用平台串匹配 | 软通道，但便宜 |
| **P1** | `cpu.arch` / `cpu.kernelMachine` | **`x86_64` + 宣称 arm64 设备 = 矛盾** | 9 个架构族字段里最硬的两个；伪造需同时骗过 `uname -m` 与 ABI |
| **P1** | `environment.storageEncryption` | 「系统报告不支持」+ 宣称现代零售机 = 矛盾 | 模拟器**主动回答**「不支持」，比 `UNAVAILABLE` 更强 |
| **P1** | `environment.verityMode` / `verifiedBoot` | **真机必答、模拟器答不出**（缺失型判据，不是黑名单型） | 方向与常规判据相反，需单独实现 |
| **P2** | `system.selinuxEvidence` | `exact` 且宣称零售机 = 可疑 | 真机只能 `inferred_mac` |
| **P2** | `cpu.cores` vs `memory.totalRam` | 比例异常（2 核配 12 GiB 等） | 只作辅助，单用会误伤低端真机 |
| **P2** | `environment.overlayDeviceCodename` | 与 `system.device` 不一致 = 矛盾（已实现） | PX 上已生效；但只有一台真机有值，样本不足 |
| **P3** | `system.socManufacturer` | `AOSP` + 宣称零售机 = 矛盾 | **目前零规则读它**，是现成可用的空通道（见 `SECURITY-SCORE.md` §13.1 第 6 项） |

### 6.2 建议从判据里剔除的字段

| 字段 | 原因 |
| --- | --- |
| `app.*`（6 个） | 测的是采集器自己，与被测设备无关 |
| `environment.capture*`（4 个） | 测的是采集时的授权状态 |
| `media.avcFixture` / `avcStage` / `avcFirstFrame` | 我们自己定义的自检固定值，必然常量 |
| `cpu.pageSize` | 三架构都是 4096 B |
| `system.type` / `system.tags` / `environment.buildSignals` | 平台常量；**且雷神用的就是官方 `release-keys` 镜像，本来就不需要改** |
| `environment.selinuxDomain` | 所有第三方应用都是 `untrusted_app` |
| `cpu.hardware` / `system.bootHardware` / `runtime.glesVendor` | **模拟器撞真机**（都撞 MI 8）。用它们判「真机」会放过 LD，这正是 F17 的绕过点 |
| `battery.energyCounter` / `cellular.cellLTEBandwidth` / `system.baseOs` / `system.selinuxBuildHint` | 三台全 `[UNAVAILABLE]`，**全军覆没**，读它们等于读空气 |

### 6.3 三条方法论

**① 「撞车」分两种，必须分开处理**

与被测设备无关的（`app.*`、`capture*`）**根本不该进判据**；平台常量的（`system.tags`、`cpu.pageSize`）可以进，但要明白它区分的是「Android 版本」不是「设备真伪」。

**② 「真机读不到」本身就是一条判据，但它很脆**

`system.selinux` 在模拟器上可读、在两台真机上都是 `RESTRICTED`。用它当判据等于把「模拟器镜像放宽了 SELinux 读权限」当成「这是模拟器」——**方向是对的，但理由是脆的**：只要模拟器厂商收紧权限，这条判据立刻失效，而真机永远不可能「变得可读」。

**③ 区分「真机刷伪装」与「模拟器伪装真机」需要硬通道**

PX 拿到 `band=D`，LD 也拿到 `band=D`，两者分数形态接近。但 PX 的 `cpu.cpuInfo` 是 ARM implementer 编码、LD 的是 AMD 桌面 CPU。**只有硬通道能把两者分开。** 这就是为什么 `cpu.cpuInfo` 那条通道值得优先维护。

### 6.4 一个必须记下的采集缺口

**三份报告里都没有 `system.fingerprint` 字段。** 216 个 `group.key` 里 `fingerprint` 零命中。

但 `system.partition_system` 等分区字段里**含有完整的 fingerprint 字符串**：

```
LD: Xiaomi/unicorn/unicorn:14/UQ1A.240205.06151050/lee06151046:user/release-keys · 2026-06-15T02:46:59Z
PX: Xiaomi/corot_global/corot:14/UP1A.231005.007/OS1.0.9.0.UMLMIXM:user/release-keys · 2024-08-09T12:44:12Z
MI: Xiaomi/dipper/dipper:10/QKQ1.190828.002/V12.5.2.0.QEACNXM:user/release-keys · 2021-10-28T07:01:40Z
```

**这印证了 `SECURITY-SCORE.md` §13.1 第 1b 项**：`Build.FINGERPRINT` 在 Android 采集侧有（`DeviceCollectors.kt:108`），但投影（`LanDetails.kt`）和 Go 白名单（`protocol.go`）都没有它，所以归档报告里查不到。**目前只能从 `partition_*` 间接拿到 fingerprint，而分区字段本身不是为这个用途设计的。**

注意 LD 的 fingerprint 是 `Xiaomi/unicorn/unicorn` —— 它宣称 `realme RMX5010`，但分区里写的是小米 12 的代号。**这处矛盾在报告里是可见的，只是没有专门字段去读它。**

---

## 7. 附录

### 7.1 未取到的字段（如实记录）

本文件需要的全部数据都从上面三份报告取到，**没有一项取不到**。但有一个方法上的限制：

- 报告详情接口 `GET /api/admin/reports/{id}` 返回 `report.parameters`（数组），**不含 `system.fingerprint`**。这不是接口问题，是报告里本来就没有这个 key（见 §6.4）。
- `device-profile` 接口只返回 `labels` 与 `score`，**不返回参数值**，所以 §2 的所有值都来自报告详情接口。

### 7.2 `[NOFIELD]` 的分布

| 设备 | `[NOFIELD]` 字段 |
| --- | --- |
| LD（7） | `network.wifiBandChannel`、`wifiFrequency`、`wifiLinkSpeed`、`wifiRssi`、`wifiSecurity`、`wifiStandard`、`system.partition_product` |
| PX（2） | `network.wifiDetails`、`system.partition_bootimage` |
| MI（12） | `display.cutoutInsets`、`display.systemBarInsets`、`display.windowSize`、`environment.keyProtection`、`network.wifiDetails`、`wifiSecurity`、`wifiStandard`、`system.partition_product`、`partition_system_ext`、`system.sku`、`system.socManufacturer`、`system.socModel` |

**注意 `system.socModel` / `system.socManufacturer` 在 MI 8 上是 `[NOFIELD]`（字段不存在），在 LD 上是 `[UNAVAILABLE]`（字段存在但取不到）。** 这两种情况必须分开读：前者说明 fieldSet 25 在这台设备上没有投影这两个 key（旧 API 兼容路径），后者说明投影了但设备答不出。

### 7.3 复现步骤

```powershell
$h = @{ Authorization = "Bearer YM" }
$base = "http://192.168.1.114:48272"

# 列表（分页用 nextCursor，单次 limit 最大 50）
$r = Invoke-RestMethod -Uri "$base/api/admin/reports?limit=50" -Headers $h

# 取一份报告的完整参数（parameters 是数组，不是 map）
$d = Invoke-RestMethod -Uri "$base/api/admin/reports/6642e350-389d-4d5d-8371-663bb5eb9e54" -Headers $h
$d.report.parameters | Where-Object { $_.group -eq 'system' -and $_.key -eq 'boardPlatform' }

# 取打分（只有 labels + score，没有参数值）
$p = Invoke-RestMethod -Uri "$base/api/admin/reports/6642e350-389d-4d5d-8371-663bb5eb9e54/device-profile" -Headers $h
$p.score.axes | ForEach-Object { $_.deductions }
```

连续请求之间建议 `Start-Sleep -Milliseconds 350`。

### 7.4 本文件的边界

- **只做字段对照，不做判决。** 哪些字段该进判据是 §6 的建议，采纳与否由打分体系决定。
- **样本只有三台。** 「两台真机共识」不等于「所有真机共识」——`sdm845` 和 `gs101` 之外的 SoC 未覆盖，`hardware_facts.go` 的注册表也只有 6 条。
- **`[UNAVAILABLE]` 不等于「设备没有这个能力」。** 它可能是 API 级别不够、厂商不实现、或权限不足。本文件只记录「取不到」，不推断原因。
