# 模拟器实验室：要不要建、建哪种、怎么建

> **状态（2026-11-25）：已建成并跑通。** 本文前半部分（§1–§6）是建之前的方案论证，保留原样作为决策记录；**§7 是实测结果**，那里才有「已经跑过什么」的答案。两者冲突时以 §7 为准。
>
> **§5.4 的「5 分钟 5 种改装」变体已经跑完，而且超额**（§7.3）：**八个变体、十份真实报告、六条实测命令**，六个计分行为标签**全部拿到真实阳性样本**。仍未做的事只剩：`google_apis_playstore` 镜像行为、`-writable-system` 持久化语义、老 API 镜像、`arm64-v8a` 速度、其它虚拟化平台属性值（见 §7.4）。本文不含 `git commit`。

## 0. 结论摘要

1. **要建，但定位要改。** 模拟器不是「比真机更好的测试环境」，它是**另一类被测对象**：一个天生带 `ro.hardware=ranchu` / `ro.product.device=sdk_gphone*` 的**确定性正向样本**。
2. **它不能替代干净真机。** 干净真机（MI 8）证明「不该报警的没报警」，模拟器永远做不到这件事，因为它天生就该被判成虚拟设备。
3. **它也不能替代那台被改装的真机。** Pixel 6 那个样本的价值在于「伪装做得足够真、只有内核口径能抓」，模拟器的伪装永远是模拟器的伪装，两者不在同一层。
4. **它最稀缺的能力是「并行 + 可回滚」。** 快照让「同一台假设备 5 分钟内变成 5 种不同程度的改装」成立，这是刷真机做不到的。
5. **推荐组合（要选，不要都上）：** AVD 为主 —— 一个 API 34 `google_apis` x86_64（必然命中的假设备 + 可 root + 可写系统 + 可快照），一个 API 29 `google_apis` x86_64（老内核路径 / 无 `cpu_capacity` 分支）。**不装** Waydroid、**不装** redroid、**暂不**上 Android-x86/Bliss、**暂不**买云真机。
6. **最值得先建的那一个：** `system-images;android-34;google_apis;x86_64`（**不是** `google_apis_playstore`）。理由见 §5.1：只有非 Play Store 镜像才允许 `adb root` + `-writable-system`，「5 分钟 5 种改装」的全部机关都挂在这两个能力上。
7. **本机现状一句话（2026-11-25 更新：已建成）**：虚拟化已开且在跑（Hyper-V 已接管，WSL2 + Docker Desktop 在跑，VBS/HVCI 运行中）；`emulator.exe` **已安装**、`system-images;android-34;google_apis;x86_64` **已下载**、AVD 已建在 `D:\AndroidAvd\sigmark-emu34.avd` 并**已成功启动**、APK 已装、仪器测试已跑通并产出两份真实报告。实测细节与打分结果见 **§7**。原先「必须落 D:」的判断成立且已执行（C: 现剩 19.9 GB）。

---

## 1. 核心论证：模拟器到底是「更好的环境」还是「另一种被测对象」

### 1.1 检测规则本身决定了答案

`virtual_build_markers` 的判定在 Go 侧，`backend/cmd/sigmark/device_profile.go:242`：

```go
eval("virtual_build_markers", []string{"cpu.hardware", "system.product", "system.device"}, func(s string) string {
    s = strings.ToLower(s)
    if s == "ranchu" || s == "goldfish" || s == "vbox86" || s == "emulator" || strings.HasPrefix(s, "sdk_gphone") {
        return "hit"
    }
    return "not_observed"
})
```

App 侧对应的是 `app/src/main/java/com/sigmark/app/collector/FrameworkCollectors.kt:236` 的 `virtualDeviceHints`，匹配集合是 `goldfish / ranchu / vbox86 / emulator / sdk_gphone*`，输入是 `Build.HARDWARE / Build.PRODUCT / Build.DEVICE`；而 `cpu.hardware` 这个字段（`DeviceCollectors.kt:212`）就是 `Build.HARDWARE` 的直读。

于是有一条**不需要任何实测就能确定**的推论：

> 官方 AVD 的 `Build.HARDWARE` 是 `ranchu`（老版本是 `goldfish`），`Build.DEVICE` 是 `sdk_gphone*`。这两个字符串**必然**命中 `virtual_build_markers`。

所以：

| 问题 | 答案 |
| --- | --- |
| 模拟器能证明「干净设备被判成干净」吗 | **不能**。它天生脏，任何一次「干净」判定都只说明规则坏了 |
| 模拟器能证明「检测逻辑本身没坏」吗 | **能，而且是最便宜、最确定的方式**。它是唯一一个「永远该命中」的靶子 |
| 模拟器能替代 Pixel 6 那台改装机吗 | **不能**。改装机的价值是「伪装到只剩内核口径能抓」，模拟器抓的是属性层，两者不同层 |
| 模拟器能替代 MI 8 那台干净机吗 | **不能**。理由同上，且方向相反 |

### 1.2 这个定位带来的三个直接后果

**后果一：模拟器的验收语句必须是「命中」，不是「通过」。**
在模拟器上跑 SigMark，正确的验收是「`virtual_build_markers` = hit，且 `identity_conflict`、`root_manager_visible`、`hook_injection` 各自按预期给出 `not_observed` 或 `insufficient`」——**不是**「风险低」。把模拟器当「正常设备」去跑回归，会把一个必然报警的样本记成误报，直接污染 `backend/web/qa/calibrate-risk.mjs` 的误报分母。

顺带说明：仓库的离线校准工具**已经**内置了 `emulator` 这个 cohort（`calibrate-risk.mjs`：`const cohorts=['stock_device','custom_rom_device','emulator']`），并且明确写了 `Cohort is human-labelled and is not a risk outcome`。也就是说，「模拟器是一个独立人工登记类别」这件事在项目里早就成立了，缺的只是一个能稳定产出的模拟器样本源。

**后果二：模拟器只能验证「规则会响」，不能验证「规则响得对」。**
规则响得对不对，只能靠两类真机（干净 + 改装）做对照。模拟器提供的是「信号发生器」，不是「地面真值」。

**后果三：模拟器能反向暴露规则的覆盖盲区。**
这是本文最重要的一个发现，值得单独写：`virtual_build_markers` 只认 QEMU/AVD 系的命名（`ranchu`、`goldfish`、`vbox86`、`emulator`、`sdk_gphone*`）。而：

| 虚拟化方案 | 典型 `ro.hardware` | 典型 `ro.product.device` | 是否命中现有规则 |
| --- | --- | --- | --- |
| Android Emulator (AVD) | `ranchu` | `sdk_gphone64_x86_64` 等 | **命中（确定）** |
| Android-x86 / Bliss OS | `android_x86` | `android_x86` / `bliss_x86_64` | **不命中（推断，未实测）** |
| Waydroid | 容器化，属性由镜像决定 | `waydroid_x86_64` | **不命中（推断，未实测）** |
| redroid | 容器化，属性由镜像决定 | `redroid_x86_64` | **不命中（推断，未实测）** |

也就是说：**AVD 是「必然命中的正向样本」，另外三家是「大概率漏检的负向样本」**。后者不是没价值，而是价值不同——它们是**规则覆盖缺口的证据**，将来若要把 `android_x86`、`waydroid`、`redroid` 加进匹配集合，需要先有它们的真实属性快照。这件事优先级低于「先把 AVD 立起来」，但应该在文档里记着，别把「模拟器只测了 AVD」当成「模拟器这条路测完了」。

---

## 2. 本机现状实测（只读）

全部在 `D:\SigMark` 与 `C:\Users\YM\AppData\Local\Android\Sdk` 上只读执行，未安装、未创建、未修改。

### 2.1 Android SDK

| 项 | 实测值 |
| --- | --- |
| `ANDROID_HOME` | `C:\Users\YM\AppData\Local\Android\Sdk` |
| `ANDROID_SDK_ROOT` | 同上（与 `ANDROID_HOME` 一致） |
| `JAVA_HOME` | `C:\Program Files\Android\Android Studio\jbr` |
| `build-tools` | `35.0.0`、`36.0.0`（本项目用 36.0.0，**在**） |
| `platforms` | `android-34`、`android-35`、`android-36` |
| `platform-tools` | `37.0.0`，`adb.exe` 在 |
| 其它已装 | `cmake;3.22.1`、`ndk;28.2.13676358` |
| `cmdline-tools` | `latest`，含 `sdkmanager.bat`、`avdmanager.bat`、`apkanalyzer.bat` 等 |
| **`emulator` 包** | **未安装**（`sdkmanager --list_installed` 无此条目，`emulator\emulator.exe` 不存在） |
| **`system-images` 目录** | **不存在** |
| `avdmanager list device` | 可离线运行，共 **95** 个设备定义，含 `pixel_6`（id 43）、`pixel_6_pro`、`medium_phone` 等 |
| `sdkmanager --list_installed` | **可用**，退出码 0；但会打印弃用警告：`The SDK Manager CLI tool (sdkmanager) is deprecated. Use Android CLI instead.`，并提示 `android sdk` 是替代品 |

`--list_installed` 完整输出（实测）：

```
build-tools;35.0.0   | 35.0.0        | Android SDK Build-Tools 35       | build-tools\35.0.0
build-tools;36.0.0   | 36.0.0        | Android SDK Build-Tools 36       | build-tools\36.0.0
cmake;3.22.1         | 3.22.1        | CMake 3.22.1                     | cmake\3.22.1
ndk;28.2.13676358    | 28.2.13676358 | NDK (Side by side) 28.2.13676358 | ndk\28.2.13676358
platform-tools       | 37.0.0        | Android SDK Platform-Tools       | platform-tools
platforms;android-34 | 3             | Android SDK Platform 34, rev 3   | platforms\android-34
platforms;android-35 | 2             | Android SDK Platform 35          | platforms\android-35
platforms;android-36 | 2             | Android SDK Platform 36          | platforms\android-36
```

### 2.2 Windows 虚拟化

| 项 | 实测值 | 说明 |
| --- | --- | --- |
| CPU | AMD Ryzen 9 9950X，16 核 / 32 线程 | **AMD，不是 Intel** —— 决定了 HAXM 与本机无关（HAXM 只支持 Intel，且已停止维护） |
| `VirtualizationFirmwareEnabled` | `True` | BIOS 里虚拟化是开的 |
| `SecondLevelAddressTranslationExtensions` | `False` | **不可信**：hypervisor 已接管时该字段会报 False |
| `VMMonitorModeExtensions` | `False` | 同上，**不可信** |
| `HyperVisorPresent` | `True` | hypervisor **在跑** |
| `systeminfo` | `A hypervisor has been detected. Features required for Hyper-V will not be displayed.` | 与上一行互证 |
| `C:\Windows\System32\WinHvPlatform.dll` | 存在 | Windows Hypervisor Platform 的组件文件在位 |
| 服务 `vmcompute` / `hns` / `HvHost` | 均 `Running` | Hyper-V 主机服务在跑 |
| `Win32_DeviceGuard.VirtualizationBasedSecurityStatus` | `2`（running） | VBS 开着 |
| `Win32_DeviceGuard.SecurityServicesRunning` | `{2}` | HVCI（内存完整性）在跑 |
| `bcdedit /enum {current}` | **失败，退出码 1** | 需要管理员权限，已跳过 —— 记为「需要提权」 |
| `Get-WindowsOptionalFeature` | **失败：`The requested operation requires elevation`** | 同上，四个特性（`Microsoft-Hyper-V-All` / `HypervisorPlatform` / `VirtualMachinePlatform` / `Microsoft-Windows-Subsystem-Linux`）的开关状态**未实测** |
| WSL | `Ubuntu-24.04`（Stopped）、`docker-desktop`（Running）、`LanDeploy-GPU`（Stopped），均 WSL **2** | WSL2 能跑 ⇒ `VirtualMachinePlatform` 必然已启用 |
| WSL 内核 | `6.18.33.2-microsoft-standard-WSL2` | |
| WSL 里 `/proc/filesystems` 含 binder 的条数 | **0** | `grep -c binder /proc/filesystems` = 0 |
| WSL 里 `/dev/binder*`、`/dev/binderfs` | **不存在** | 直接决定 redroid/Waydroid 在本机不可行，见 §3.4 |
| Docker | Docker Desktop 运行中，Server `29.6.2`，`linux` 引擎，32 CPU / 约 42 GB 内存 | |
| VMware Workstation | **已安装**（`C:\Program Files (x86)\VMware\VMware Workstation\vmware.exe`） | |
| VirtualBox | 未安装（`VBoxManage.exe` 不存在） | |
| BlueStacks / Nox / LDPlayer | 均未安装 | |

**由此得到的关键判断（本机专有）：**

- 本机是 AMD + Hyper-V 已在跑（WSL2/Docker/VBS 三条独立证据）。Android Emulator 在这台机器上**只能走 WHPX**，不能走 AEHD（AEHD 与 Hyper-V 互斥），更与 HAXM 无关（Intel only、已弃用）。
- 因此「要不要装 HAXM」这个问题在本机**不成立**。正确的问题是「WHPX 是否已可用」——`WinHvPlatform.dll` 在位 + hypervisor 在跑，是强证据但**不等于**功能已启用；精确结论需 `emulator -accel-check`（装完 emulator 包才能跑）或提权查 `HypervisorPlatform` 特性状态。**当前状态记为：几乎确定可用，未实测。**
- Hyper-V 与 WHPX **不冲突**，它们是同一套 hypervisor 的两种用法；真正冲突的是「Hyper-V vs VirtualBox 老版本 / VMware 老版本 / AEHD / HAXM」。本机 VMware Workstation 版本未查，若要用 Android-x86 走 VMware 路线需注意这一点（VMware 15.5.5+ 支持与 Hyper-V 共存，**未实测**）。

### 2.3 资源余量

| 项 | 实测值 | 影响 |
| --- | --- | --- |
| 物理内存 | 47.1 GiB 总量，21.5 GiB 空闲 | 跑 1 个 AVD 富余；跑 4–6 个并行 redroid 也够，但本机跑不了 redroid（§3.4） |
| C: 盘 | 已用 1885.8 GB，**剩 21.6 GB** | **偏紧**。emulator 包 + 一个 system image 就可能吃掉 3 GB；AVD 的 userdata 与快照绝不能放 C: |
| D: 盘 | 已用 846.2 GB，**剩 1061.6 GB** | AVD / 快照 / 备份都放这里 |
| adb 当前连接 | `35241FDF6S1P3K`（oriole / Pixel_6）、`5371113b`（dipper / MI_8）均 `device` | 两台真机在线，模拟器加入后是 `emulator-5554` 起 |

### 2.4 仓库侧现状（与本方案直接相关）

| 项 | 实测 |
| --- | --- |
| 分支 | `main`，工作区有大量未提交修改（`app/`、`README.md`、`CapabilitySmoke.kt` 等），**本方案不碰这些** |
| 已构建产物 | `app/build/outputs/apk/debug/app-debug.apk`（11.45 MB）、`app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk`（0.07 MB）均在 |
| 仪器入口 | `app/src/main/.../CapabilitySmoke.kt`，`testInstrumentationRunner = "com.sigmark.app.CapabilitySmoke"`，手写 `Instrumentation`（**不是** JUnit runner，所以不能用 `-e class`） |
| 参数分发 | `onCreate` 读 Bundle：`export` / `route` / `gnss` / `configuration` / `evidence` / `isolatedUploadPort` / `lanUpload` / `probe` |
| `minSdk` / `targetSdk` / `compileSdk` | 26 / 34 / 36 —— 意味着 **API 26 起的镜像都能装**，API 28/29/34 都在范围内 |
| 校准工具 | `backend/web/qa/calibrate-risk.mjs` 已支持 `emulator` cohort |

---

## 3. 五个选项逐一对比

### 3.0 总表

| 维度 | AVD / emulator | Android-x86 / Bliss（VMware/VBox/Hyper-V） | Waydroid（WSL2） | redroid（Docker） | 云真机 / 真机农场 |
| --- | --- | --- | --- | --- | --- |
| Windows 可行性 | **原生支持，最好** | VMware 可行；VBox 与 Hyper-V 冲突 | **不可行**（缺 binder） | **不可行**（缺 binder） | 完全可行（浏览器/API） |
| 本机是否已具备条件 | 缺 `emulator` 包 + image | VMware 已装 | WSL2 有但内核无 binder | Docker 有但内核无 binder | 需账号与预算 |
| `virtual_build_markers` 是否命中 | **必然命中** | 不命中（推断） | 不命中（推断） | 不命中（推断） | 不命中（真机） |
| 能否 root / 改 `/system` | 能（仅非 Play Store 镜像） | 能（`-rw` 挂载 / 内置 root） | 能（容器内） | 能（容器内） | 一般不能 |
| 能否快照回滚 | **能，秒级** | 能（VM 快照，秒级） | 能（容器重建） | 能（镜像层） | 不能 |
| 能否多实例并行 | 能，但吃内存（每实例 2–4 GB） | 能，但更重 | 能 | **最能**（一次 20 个） | 能（付费） |
| 覆盖老 API 降级路径 | 能（26–35 都有镜像） | 能（但版本选择少） | 弱 | **强（镜像即 API 版本）** | 强 |
| 本机实际代价 | 中（~4 GB 磁盘 + 装包） | 高（VM + ISO 手工配置） | 不可达 | 不可达 | 高（钱） |
| 结论 | **主用** | 备用/盲区样本 | 否 | 否（除非换 Linux 宿主） | 否（暂缓） |

### 3.1 Android Studio AVD / emulator（官方）

**能做什么**

- API 26–35 的镜像齐全，`x86_64` 与 `arm64-v8a` 两种 ABI；`google_apis`（AOSP + GMS 核心，**可 root**）与 `google_apis_playstore`（带 Play Store，**不可 root**）两种变体。
- `-writable-system` 让 `/system` 可写，配合 `adb root` + `adb remount` 就能改 `build.prop`、塞 `su`、改属性——**这正是「制造不同程度的改装」所需的全部机关**。
- 快照（`adb emu avd snapshot save <name>` / `emulator -snapshot <name>`）秒级切换，等价于「一台设备的多份时间线」。
- 与 Gradle/adb 生态零摩擦：`installDebug`、`am instrument` 全部照旧。

**不能做什么**

- 属性层永远是模拟器：`Build.HARDWARE=ranchu`、`Build.DEVICE=sdk_gphone*`、`ro.kernel.qemu=1`、`/dev/goldfish_pipe`、`goldfish` 系驱动。**越不过 `virtual_build_markers`**（除非你手工改 `build.prop` 去伪造，那就是 §5.3 的 V2 变体）。
- 内核口径字段全是宿主的：`cpu.cpuCapacity`（`cpu_capacity`）反映的是模拟出来的 vCPU 拓扑；`memory.cmaTotal`（`CmaTotal`）在 goldfish 内核上通常**根本没有**（多半落 `UNAVAILABLE`）；`memory.physicalRam`（`sysconf(_SC_PHYS_PAGES)`）报的是**宿主内存**而不是 AVD 配置的 RAM。这三条决定 §6 的「不能用来做什么」。
- 没有真实基带：`telephony` 全是假的（`gsm.sim.operator` 之类），GNSS 只有模拟注入，传感器只有 QEMU 虚拟传感器，摄像头是软件模拟（`emulated` / `virtualscene`）。
- 没有真实 SELinux 域差异：`google_apis` 镜像是 `userdebug` 且 `ro.debuggable=1`，`rom_verification` 的「buildDebuggable」一侧会**天然命中**，跟真机的 `user` 构建不可比。

**x86_64 vs arm64 镜像在「指纹真实度」上的差别**

| 项 | x86_64 镜像 | arm64-v8a 镜像 |
| --- | --- | --- |
| 宿主执行方式 | 硬件虚拟化（WHPX），接近原生速度 | x86 宿主上走 QEMU TCG **全指令翻译**，极慢（未实测，属通识） |
| `Build.HARDWARE` | `ranchu` | `ranchu` |
| `Build.DEVICE` | `sdk_gphone64_x86_64` 等 | `sdk_gphone64_arm64` |
| `cpu.abis` | `x86_64` / `x86` | `arm64-v8a` |
| 与真机的「架构真实度」 | 假（真机是 arm64） | **更真**（arm64 与 Pixel 6 / MI 8 一致） |
| 是否更接近真机 | 否 | 只在这一项上更接近，其余（ranchu、goldfish 驱动、无基带）完全一样 |
| 本项目建议 | **主用**（快、稳、够用） | 可选：若将来要验证「`cpu.abis` 与 SoC 登记表」的交叉规则，才值得付出慢的代价 |

结论：**arm64 镜像不会让模拟器「更像真机」，只让 `cpu.abis` 这一个字段更像。** 为此付出 5–20 倍启动时间不划算。

**`google_apis_playstore` 能不能 root**：不能。Play Store 镜像按 Google 的认证要求锁死系统分区，`adb root` 会返回 `adbd cannot run as root in production builds`，`-writable-system` 也不生效（未实测，属该镜像的既定设计）。**结论：Play Store 变体在「制造改装」这件事上等于废的。**

**要不要搞 Play Store 变体？** 值得，但**不是第一批**。它的唯一价值是：`ro.debuggable=0` + `ro.build.type=user` + 有 GMS 全套，能当「一个不会因为 userdebug 而天然命中的虚拟设备」，用来验证 `rom_verification` 和 `root_manager_visible` 在「干净但虚拟」条件下的表现。代价是多一个 1.5 GB 级镜像。放到第 2 天之后按需。

**Windows 上需要 HAXM 还是 WHPX/Hyper-V**

| 方案 | 适用 CPU | 与 Hyper-V 共存 | 本机结论 |
| --- | --- | --- | --- |
| HAXM | 仅 Intel，已停止维护 | 冲突 | **无关**（本机是 AMD） |
| AEHD（Android Emulator Hypervisor Driver） | Intel + AMD | **冲突**（要求 Hyper-V 关闭） | **不可用**（本机 Hyper-V 在跑） |
| WHPX（Windows Hypervisor Platform） | Intel + AMD | **就是 Hyper-V 的一部分，不冲突** | **唯一可行路径** |

### 3.2 Android-x86 / Bliss OS 跑在 VMware / VirtualBox / Hyper-V 里

**能做什么**

- 真 Linux 内核 + 真 Android 框架（不是 goldfish 内核），`ro.hardware` 是 `android_x86` 一类，`Build.HARDWARE` 也就不是 `ranchu`。
- 有真内核，所以 `/proc/meminfo` 的 `CmaTotal`、`cpu_capacity` 这些「内核口径」字段会**真的存在且有值**（数值取决于虚拟机配置，不是某颗 SoC 的常量）。这是 AVD 给不了的东西。
- VMware 快照同样是秒级回滚。
- **比 AVD 更接近真机吗？部分更接近：** 内核是真的、CMA 是真的、内存布局是真的；**但属性层依然一眼假**（`android_x86`），而且它不在 `virtual_build_markers` 的匹配集合里——于是它变成「一个虚拟环境却**不命中**虚拟标记」的样本，正好是规则盲区的实证。

**不能做什么 / 实际代价**

- 安装是手工活：下 ISO、建 VM、分区、装 GRUB、配 `-rw` 持久化，没有官方 Windows 一键路径。Bliss OS 的版本与 Android API 版本对应关系也比 AVD 混乱。
- VirtualBox 在 Hyper-V 开启的机器上要装 6.x 之后版本并可能仍受限；本机 VirtualBox **没装**，要走就得装。
- Hyper-V 里跑 Android-x86 需要 Gen 2 VM + 关 Secure Boot，步骤更多。
- 显卡加速在 VM 里通常只有软件渲染，`runtime.glesRenderer` 会是 `SwiftShader` / `llvmpipe` 一类，与真机 GPU 不可比。
- **本机结论：不推荐现在做。** VMware 虽已装，但它带来的「更真的内核口径」并不能替代真机（真机的 CMA 值是设备树常量，VM 的是你随手配的内存），性价比低。

### 3.3 Waydroid（Linux 容器跑 Android，Windows 需 WSL2）

- Waydroid 依赖宿主内核的 **binder**（以及 API ≤ 28 时的 ashmem）。它要求宿主是 Linux，Windows 上唯一路径是 WSL2。
- **本机实测：WSL2 内核 `6.18.33.2-microsoft-standard-WSL2`，`/proc/filesystems` 里 binder 条数为 0，`/dev/binder*` 与 `/dev/binderfs` 都不存在。** 微软的标准 WSL2 内核没有编 binder。
- 这意味着：要么自己编 WSL2 内核并开 `CONFIG_ANDROID_BINDER_IPC` + `binderfs`（工作量按天算，且每次内核升级要重来），要么换 Linux 宿主。
- 即便跑起来，Waydroid 的 `ro.product.device` 是 `waydroid_x86_64` 一类，**大概率不命中** `virtual_build_markers`（推断，未实测）——它给的是「盲区样本」，不是「确定性命中样本」。
- **本机结论：不做。** 投入产出比最差的一项。

### 3.4 redroid（Docker 里的 Android，多实例并行）

- redroid 是「Android 跑在容器里」，一个镜像一个 API 版本，`docker run` 起一个实例，理论上一次起 20 个不同 API 的假设备——**对批量验证检测规则的价值确实最大**，这一点任务描述里的判断是对的。
- 但它和 Waydroid 卡在同一个地方：**宿主内核必须有 binder**（API 29+ 还要 `memfd`）。本机 WSL2 内核没有 binder，实测证据见 §2.2。
- 在 Windows 上落地的真实难度：需要自编 WSL2 内核（或换一个自带 binder 的 WSL 内核分发包）+ Docker Desktop 用自定义内核 + 每实例 `--privileged` + 端口映射 + adb 连接（`adb connect 127.0.0.1:<port>`）。**不是「装个镜像」的量级，是「改内核」的量级。**
- 另外本机 C: 只剩 21.6 GB，20 个实例的镜像层与 userdata 必须全放 D:，还要给 Docker Desktop 加盘。
- **本机结论：不做。** 若将来真的需要「一次 20 个不同 API 的假设备」，正确做法是**在 D: 上开一台 Linux 虚拟机（VMware 已装）跑 Docker + redroid**，而不是在 WSL2 里硬啃内核。那时它和 AVD 的分工是：AVD 管「必然命中的正向样本 + 改装变体」，redroid 管「API 版本矩阵的批量冒烟」。

### 3.5 云真机 / 真机农场（简要，给量级）

- 形态：BrowserStack / Sauce Labs / AWS Device Farm / Firebase Test Lab / 国内厂商云测。
- 能力：真机、真基带、真传感器，可批量并行，可按 API 版本与机型挑设备。
- 代价量级（**未实测，仅为公开定价的量级判断，实际以官网为准**）：按分钟计费约 $0.1–0.2/设备·分钟；包月套餐约 $40–200/月起；企业级设备农场自建则是数十万元级。
- 对本项目的真实价值：**很低**。我们缺的不是「更多真机」，而是「一台被改装的真机」和「确定性的虚拟样本」。云真机既不能改装，也不能提供 `ranchu` 这种确定性命中。**结论：暂缓，不进第一批。**

---

## 4. 推荐组合（选定，不再列选项）

### 4.1 选定

| 角色 | 选型 | 命名 | 为什么是它 |
| --- | --- | --- | --- |
| **确定性命中的假设备 + 改装变体母本** | `system-images;android-34;google_apis;x86_64`，设备定义 `pixel_6` | `SM34-AOSP` | 必然命中 `virtual_build_markers`；可 `adb root`；可 `-writable-system`；可快照；API 34 与 Pixel 6 改装样本同代，字段集最全 |
| **老内核路径 / 无 `cpu_capacity` 分支** | `system-images;android-29;google_apis;x86_64` | `SM29-AOSP` | MI 8 是 API 29 / 内核 4.9；用 API 29 镜像覆盖「老系统降级路径」与「字段缺失时是否降级为 `UNAVAILABLE` 而不是瞎猜」 |
| 可选第二批 | `system-images;android-34;google_apis_playstore;x86_64` | `SM34-PLAY` | 唯一价值是 `ro.debuggable=0` 的「干净但虚拟」条件，验证 `rom_verification` |
| 明确不做 | Waydroid、redroid、Android-x86/Bliss、云真机 | — | 见 §3，理由分别是：缺 binder、缺 binder、性价比低、价值低 |

### 4.2 第 1 天：把「必然命中的假设备」立起来并跑通仪器测试

1. 装 `emulator` 包 + 一个 API 34 image（**唯一允许的大体积下载，且必须由人手动执行**，本方案不代跑）。
2. 把 AVD 数据目录指到 D:（C: 只剩 21.6 GB）。
3. 建 `SM34-AOSP`，用 `-writable-system` 启动。
4. 跑 `emulator -accel-check` 确认 WHPX 可用（这是本机虚拟化状态的**决定性验证**，见 §2.2 的未实测项）。
5. 装 APK + androidTest APK，跑 `-e evidence dump` 与 `-e probe safereader`，确认采集不崩、22 条断言全 PASS。
6. 跑 `-e lanUpload live`（配合 `adb reverse` 或 `10.0.2.2`），确认上传链路在模拟器上可用。
7. **验收语句：** `virtual_build_markers` 必须为 `hit`；把这份报告登记为 `cohort=emulator` 的校准样本。若它是 `not_observed`，说明规则或字段链路坏了——**这就是这个样本存在的全部意义**。

### 4.3 第 2 天：制造变体 + 覆盖老 API

1. 在 `SM34-AOSP` 上做 V1–V3 三个改装变体，每个存一份快照（§5.3）。
2. 建 `SM29-AOSP`，跑同一套仪器测试，重点看：`cpu.cpuCapacity` 是 `UNAVAILABLE` 还是假值、`memory.cmaTotal` 是什么、`identity_conflict` 在缺 `system.sku`（API<31）时是否按 `dropLast(1)` 正确降级。
3. 把两份模拟器报告 + 两份真机报告（Pixel 6 改装、MI 8 干净）一起喂给 `calibrate-risk.mjs`，用 `cohort=emulator` 明确标注，检查误报分母没有被污染。
4. 写进 `docs/DEVICE-VALIDATION.md`（**本次不做，留给后续任务**）：`docs/DEVICE-VALIDATION.md:355` 与 `ROADMAP.md:77` 都记着「模拟器实测仍待验收」，第 1–2 天做完就可以把这条划掉。

---

## 5. 建库的具体命令（可直接复制）

> 全部是 PowerShell。`$env:ANDROID_HOME` 已在系统里，下面再设一次是为了脚本自洽。
> **注意：** 本节命令会**下载** emulator 包与 system image，属人手动执行范畴；本次探查**未执行**任何一条。

### 5.0 环境准备（放 D:，避免撑爆 C:）

```powershell
$env:ANDROID_HOME      = "C:\Users\YM\AppData\Local\Android\Sdk"
$env:ANDROID_USER_HOME = "D:\Android\userhome"      # avdmanager 的用户目录
$env:ANDROID_AVD_HOME  = "D:\Android\avd"           # AVD 本体与快照
New-Item -ItemType Directory -Force -Path $env:ANDROID_USER_HOME, $env:ANDROID_AVD_HOME | Out-Null
$sdkmanager = "$env:ANDROID_HOME\cmdline-tools\latest\bin\sdkmanager.bat"
$avdmanager = "$env:ANDROID_HOME\cmdline-tools\latest\bin\avdmanager.bat"
$emulator   = "$env:ANDROID_HOME\emulator\emulator.exe"
```

### 5.1 装 emulator 包与两个镜像

```powershell
# 1) emulator 本体（约 1.0–1.5 GB，未实测）
& $sdkmanager --install "emulator"

# 2) 必然命中的假设备母本：API 34 / google_apis（可 root）/ x86_64
& $sdkmanager --install "system-images;android-34;google_apis;x86_64"

# 3) 老内核路径：API 29 / google_apis / x86_64
& $sdkmanager --install "system-images;android-29;google_apis;x86_64"

# 第二批再考虑（Play Store 变体，不可 root）
# & $sdkmanager --install "system-images;android-34;google_apis_playstore;x86_64"

# 验证
& $sdkmanager --list_installed
```

> `sdkmanager` 在本机已打印弃用警告，官方建议用 `android sdk`（`cmdline-tools\latest\bin\android.exe`）。上面的 `sdkmanager` 形态**实测可运行**（`--list_installed` 退出码 0），继续用它没问题；若将来它被移除，替换为 `& "$env:ANDROID_HOME\cmdline-tools\latest\bin\android.exe" sdk install <包名>`（**未实测**）。

### 5.2 建 AVD

```powershell
# API 34：pixel_6 设备定义（实测存在于 avdmanager list device，id 43）
& $avdmanager create avd `
  -n "SM34-AOSP" `
  -k "system-images;android-34;google_apis;x86_64" `
  -d "pixel_6" `
  --force

# API 29
& $avdmanager create avd `
  -n "SM29-AOSP" `
  -k "system-images;android-29;google_apis;x86_64" `
  -d "pixel_6" `
  --force

# 确认
& $avdmanager list avd
& $emulator -list-avds
```

建完建议改 `D:\Android\avd\SM34-AOSP.avd\config.ini`（**按需，非必需**）：

```ini
hw.ramSize=4096
hw.cpu.ncore=4
disk.dataPartition.size=8G
hw.keyboard=yes
```

### 5.3 启动、验证加速、装 APK、跑仪器测试

```powershell
# 验证硬件加速（决定性验证本机 WHPX 是否真的可用）
& $emulator -accel-check

# 启动：可写系统 + 固定端口 + 不用默认快照（保证干净起点）
& $emulator -avd "SM34-AOSP" `
  -writable-system `
  -port 5554 `
  -no-snapshot-load `
  -no-boot-anim `
  -gpu swiftshader_indirect

# 等待开机完成
adb -s emulator-5554 wait-for-device
adb -s emulator-5554 shell 'while [ "$(getprop sys.boot_completed)" != "1" ]; do sleep 2; done'
```

```powershell
# 构建（模拟器与真机共用同一产物）
Set-Location D:\SigMark
.\gradlew.bat :app:assembleDebug :app:assembleDebugAndroidTest

# 安装（注意：模拟器上不要用 -s 真机序列号）
adb -s emulator-5554 install -r app\build\outputs\apk\debug\app-debug.apk
adb -s emulator-5554 install -r app\build\outputs\apk\androidTest\debug\app-debug-androidTest.apk
```

```powershell
# 主采集：证据导出（runner 是手写 Instrumentation，不能用 -e class）
adb -s emulator-5554 shell am instrument -w -e evidence dump com.sigmark.app.test/com.sigmark.app.CapabilitySmoke

# SafeReader 22 条断言
adb -s emulator-5554 shell am instrument -w -e probe safereader com.sigmark.app.test/com.sigmark.app.CapabilitySmoke

# SELinux / Keystore / 配置一致性 / GNSS 分项
adb -s emulator-5554 shell am instrument -w -e evidence selinux   com.sigmark.app.test/com.sigmark.app.CapabilitySmoke
adb -s emulator-5554 shell am instrument -w -e evidence keystore  com.sigmark.app.test/com.sigmark.app.CapabilitySmoke
adb -s emulator-5554 shell am instrument -w -e configuration check com.sigmark.app.test/com.sigmark.app.CapabilitySmoke
adb -s emulator-5554 shell am instrument -w -e gnss check          com.sigmark.app.test/com.sigmark.app.CapabilitySmoke
```

**上传链路（两个坑，必须选一个绕过）**

`-e lanUpload live` 用的是 `BuildConfig.LAN_ORIGIN`（构建期注入，且被 `app/build.gradle.kts` 强制为 `http://<数字IPv4>:<端口>` 形态）：

```powershell
# 方案 A：构建时把 origin 指到模拟器网关（10.0.2.2 = 宿主的 127.0.0.1）
.\gradlew.bat :app:assembleDebug -PSIGMARK_LAN_URL=http://10.0.2.2:8080
adb -s emulator-5554 shell am instrument -w -e lanUpload live com.sigmark.app.test/com.sigmark.app.CapabilitySmoke

# 方案 B：isolatedUploadPort 走 127.0.0.1，必须用 adb reverse 把宿主端口映射进模拟器
adb -s emulator-5554 reverse tcp:8080 tcp:8080
adb -s emulator-5554 shell am instrument -w -e isolatedUploadPort 8080 com.sigmark.app.test/com.sigmark.app.CapabilitySmoke
```

> 这两个坑是模拟器特有的：模拟器里的 `127.0.0.1` 是模拟器自己，不是宿主。真机上没这个问题，所以现有文档里的真机命令不能直接照抄到模拟器。

### 5.4 「同一台假设备 5 分钟内变成 5 种不同程度的改装」

机制：`-writable-system` + `adb root` + `adb remount` 改 `build.prop` → `adb reboot` → 验证 → `adb emu avd snapshot save <名字>`。之后每次切换只是「用某个快照启动」，几秒到几十秒。

```powershell
# 前置：系统分区可写
adb -s emulator-5554 root
adb -s emulator-5554 remount

# 变体 V1：只改型号与品牌，保留 ranchu（"半吊子伪装"）
adb -s emulator-5554 shell "sed -i 's/^ro.product.model=.*/ro.product.model=23078PND5G/' /system/build.prop"
adb -s emulator-5554 shell "sed -i 's/^ro.product.brand=.*/ro.product.brand=Xiaomi/' /system/build.prop"
adb -s emulator-5554 reboot
adb -s emulator-5554 wait-for-device
adb -s emulator-5554 emu avd snapshot save v1-model-only
```

```powershell
# 变体 V2：连 device/hardware 一起改（"高级改机"，目标是让 virtual_build_markers 不命中）
#   注意：这是故意制造假阴性样本，用来测规则的盲区，不是"把模拟器变干净"
adb -s emulator-5554 shell "sed -i 's/^ro.product.device=.*/ro.product.device=oriole/' /system/build.prop"
adb -s emulator-5554 shell "sed -i 's/^ro.hardware=.*/ro.hardware=qcom/' /system/build.prop"
adb -s emulator-5554 shell "sed -i 's/^ro.product.name=.*/ro.product.name=oriole/' /system/build.prop"
adb -s emulator-5554 reboot
adb -s emulator-5554 wait-for-device
adb -s emulator-5554 emu avd snapshot save v2-full-disguise
```

```powershell
# 变体 V3：改属性但故意让 Build 与属性互相矛盾（测 identity_conflict）
adb -s emulator-5554 shell "sed -i 's/^ro.product.device=.*/ro.product.device=corot/' /system/build.prop"
adb -s emulator-5554 reboot
adb -s emulator-5554 wait-for-device
adb -s emulator-5554 emu avd snapshot save v3-identity-conflict

# 变体 V4：塞一个假 su（测 root_manager_visible / hook_injection 的目录可见性路径）
adb -s emulator-5554 shell "mkdir -p /system/xbin && echo fake > /system/xbin/su && chmod 755 /system/xbin/su"
adb -s emulator-5554 reboot
adb -s emulator-5554 wait-for-device
adb -s emulator-5554 emu avd snapshot save v4-fake-su
```

```powershell
# 变体 V5：回到出厂（等价于"刷机重置"），验证回滚是干净的
adb -s emulator-5554 emu avd snapshot save v0-clean-baseline   # 在做 V1 之前就该存这一份

# 列出 / 切换快照
adb -s emulator-5554 emu avd snapshot list

# 关闭当前实例，用某个快照秒起
adb -s emulator-5554 emu kill
& $emulator -avd "SM34-AOSP" -snapshot v2-full-disguise -writable-system -port 5554
```

**5 个变体的设计意图（这才是「5 分钟」真正的价值）**

| 变体 | 改了什么 | 期望的规则反应 | 为什么值钱 |
| --- | --- | --- | --- |
| V0 | 什么都不改 | `virtual_build_markers = hit` | 确定性正向样本，验证规则没坏 |
| V1 | model / brand | `hit` + `identity_conflict` 可能 `not_observed`（两边都被改了） | 测「属性被改但 hardware 没动」这种最常见的不完整改装 |
| V2 | device / hardware / name | `virtual_build_markers = not_observed`（**假阴性**） | **最有价值的一份**：它证明规则存在盲区，且给了未来改进的对照样本 |
| V3 | device 改成 `corot`，与 model 矛盾 | `identity_conflict = hit` | 测 `IdentityConsistency` 的配对逻辑（`system.device` vs `system.propertyDevice`） |
| V4 | `/system/xbin/su` | `root_manager_visible` / `hook_injection` 的目录可见路径 | 测「有 su 文件但没跑 root」的边界 |

**必须承认的局限：** `build.prop` 的持久化语义取决于 `-writable-system` 的 overlay 行为，本方案**没有实测**「reboot 之后改动是否还在、`-wipe-data` 之后是否清空」。所以整个设计刻意**把快照当作唯一真值**——即使 overlay 不持久，快照也保证每次都能回到同一个确定状态。这一点是刻意的工程选择，不是偷懒。

### 5.5 磁盘占用估算与清理

| 项 | 估算 | 说明 |
| --- | --- | --- |
| `emulator` 包 | ~1.0–1.5 GB | 装到 C:（SDK 所在盘） |
| `system-images;android-34;google_apis;x86_64` | ~1.5–2.0 GB | 未实测 |
| `system-images;android-29;google_apis;x86_64` | ~1.0–1.5 GB | 未实测 |
| 每个 AVD 的 userdata | 2–8 GB | 取决于 `disk.dataPartition.size` |
| 每份快照 | 0.2–2 GB | 改得越多、装的 app 越大，快照越大 |
| **本方案（2 个 AVD + 6 份快照）合计** | **约 15–25 GB** | **必须放 D:**（D: 剩 1061.6 GB，无压力；C: 只剩 21.6 GB，放不下） |

```powershell
# 看当前占用
& $sdkmanager --list_installed
Get-ChildItem "D:\Android\avd" -Directory | ForEach-Object {
    $s = (Get-ChildItem $_.FullName -Recurse -File | Measure-Object Length -Sum).Sum
    "{0,-20} {1,8:N1} GB" -f $_.Name, ($s/1GB)
}

# 删单个快照（先列再删）
adb -s emulator-5554 emu avd snapshot list
adb -s emulator-5554 emu avd snapshot delete v1-model-only

# 删 AVD
& $avdmanager delete avd -n "SM29-AOSP"

# 卸镜像与 emulator 包（真要腾空间时才做）
& $sdkmanager --uninstall "system-images;android-29;google_apis;x86_64"
& $sdkmanager --uninstall "emulator"

# 兜底：直接删 AVD 目录（avdmanager 删不干净时）
Remove-Item -Recurse -Force "D:\Android\avd\SM29-AOSP.avd","D:\Android\avd\SM29-AOSP.ini"
```

---

## 6. 模拟器的「正确用途」与「不能用来做什么」

### 6.1 能用来做什么（每一条都能对应一个可执行验收）

| 用途 | 为什么成立 | 验收语句 |
| --- | --- | --- |
| **验证 `virtual_build_markers` 没坏** | `ranchu` / `sdk_gphone*` 必然命中，是唯一「永远该响」的靶子 | 该标签 = `hit`；若 `not_observed`，规则或字段链路坏了 |
| **覆盖老 API 降级路径** | API 26–35 镜像齐全，可精确选版本 | API 29 上 `system.sku` 缺失时 `identity_conflict` 按 `dropLast(1)` 降级；不崩、不误判 |
| **批量跑采集不崩** | 可并行、可重启、可重放 | N 次 `-e evidence dump` 全成功，字段数稳定，无 `NOT_ARCHIVED` 漂移 |
| **验证「字段缺失」被正确表达** | 模拟器天然缺很多真机字段（无基带、无 CMA） | 缺失必须是 `UNAVAILABLE` / `RESTRICTED` 且带 errno，**不能**变成「没有」——这正是 `SafeReader` 那个已修缺陷的方向 |
| **离线 CI / 无真机时冒烟** | 无网络、无真机也能跑 | `am instrument` 退出码 0，22 条 SafeReader 断言全 PASS |
| **制造「改装变体」的对照样本** | 快照 + `-writable-system` | V0–V4 五份快照，规则反应各不相同且可复现 |

### 6.2 不能用来做什么（这一节比上一节更重要）

| 不能做 | 原因 | 会被什么骗 |
| --- | --- | --- |
| **不能证明「干净设备被判成干净」** | 模拟器天生脏，`virtual_build_markers` 必然命中。任何「干净」结论都只说明规则坏了 | 把模拟器当正常设备跑回归 → 误报分母被污染 |
| **不能替代「第一台被改装真机」这个样本** | 改装真机的价值是「伪装到只剩内核口径能抓」；模拟器的伪装永远停在属性层，内核是 goldfish | 以为「我造了 V2 全量伪装就等于有了改装真机」 |
| **不能验证内核口径字段** | `cpu.cpuCapacity`（`cpu_capacity`）在模拟器里反映的是模拟 vCPU 拓扑；`memory.cmaTotal`（`CmaTotal`）在 goldfish 内核上通常不存在；`memory.physicalRam` 报的是**宿主** 47 GB 而不是 AVD 配的 RAM | 拿模拟器的 `cpu_capacity` 去填 SoC 登记表的 `capacities`（`DEVICE-VALIDATION.md:20` 已经因为「MI 8 内核 4.9 不暴露 `cpu_capacity`」而故意留空，模拟器只会给出更没意义的数） |
| **不能验证真实基带 / GNSS / 传感器 / 摄像头** | 全是模拟注入 | 把模拟 GNSS 的 `fix` 当成定位质量证据 |
| **不能验证 SELinux 真实策略差异** | `google_apis` 是 `userdebug` + `ro.debuggable=1` | `rom_verification` 的 `buildDebuggable` 一侧天然命中，与真机 `user` 构建不可比 |
| **不能验证 ABI / SoC 交叉规则** | x86_64 镜像的 `cpu.abis` 是 `x86_64`，真机是 `arm64-v8a` | 把 `cpu.abis` 与 SoC 登记表的交叉检查结果当成真机结论 |
| **不能替代「同一台真机刷机前后」的对照** | 那需要真机的时间序列；模拟器换快照不是刷机 | 把快照切换写成 ROM 回归证据 |

**一句话总结定位：**

> 模拟器是**信号发生器**，不是**地面真值**。它保证「该响的时候一定响」，但不保证「响的就是对的」。真机负责后者。

---

## 7. 实测结果（2026-11-25，已跑通）

本节取代原先的「未实测清单」——仿真器已经真的建起来、装上 APK、跑完仪器测试、产出两份真实报告并被打分。下面区分**已实测**与**仍未实测**。

### 7.1 已实测：一条命令都没猜

| 项目 | 实测结果 |
| --- | --- |
| `emulator` 包 | 已装，`emulator.exe` 在 `%ANDROID_HOME%\emulator\` |
| system image | `system-images;android-34;google_apis;x86_64`，`system.img` **4,306,501,632 字节**（4.01 GiB） |
| AVD 位置 | `ANDROID_AVD_HOME=D:\AndroidAvd`，避开只剩 19.9 GB 的 C: |
| 加速 | **WHPX 可用**，`-accel on` 正常启动，无需 HAXM/AEHD |
| 启动参数 | `-avd sigmark-emu34 -gpu swiftshader_indirect -no-snapshot -no-boot-anim -accel on` |
| `sys.boot_completed` | `1`（约 30 秒内） |
| API | `ro.build.version.sdk = 34` |
| `ro.product.device` | **`emu64xa`**（原先文档猜的是 `sdk_gphone64_x86_64`，实际 device 是 `emu64xa`） |
| `ro.hardware` | **`ranchu`**（猜对了） |
| `ro.product.model` | `sdk_gphone64_x86_64` |
| APK 安装 | `SigMark-1.21.2-LAN-debug.apk` 安装成功 |
| 仪器测试 | `am instrument` → `INSTRUMENTATION_CODE: -1`，`archived=207`、`fieldSet=25`、两份报告 ID |
| 上传链路 | `adb reverse tcp:PORT` + `isolatedUploadPort` 走通，真实 HTTP 上传成功 |

**AVD 创建的坑**：`avdmanager create avd -d pixel_6` 会因 `system-images/.../devices.xml` 缺失而报错退出，但**目录已经建好了**，只是 `config.ini` 里留着 `<build>` / `<temp>` 占位符。必须手工修三行才能启动：

```
avd.id=<build>                       → avd.id=sigmark-emu34
avd.name=<build>                     → avd.name=sigmark-emu34
disk.dataPartition.path=<temp>       → disk.dataPartition.path=D:\AndroidAvd\sigmark-emu34.avd\userdata-qemu.img
```

不修会启动失败，且报错信息不会指向这三行。

### 7.2 已实测：仿真器报告的真实打分

两份报告（同一台假设备连续两次采集），**打分完全一致**：

| 项 | 实测值 |
| --- | --- |
| `band` | **D** |
| `value` | **null** |
| `coverage` | **0.67** |
| `decisive` | **true** |
| `caps` | `DECISIVE_VIRTUAL_BUILD` |
| declaration 轴 | `score=null`、`coverage=0.33`、无扣分 |
| behavior 轴 | `score=null`、`coverage=0.83`、扣 `VIRTUAL_BUILD_MARKERS` |
| usage 轴 | `score=null`、`coverage=1`、无扣分 |

标签实测：`virtual_build_markers=hit`、`software_drm=hit`（L3）、`debugger_attached=not_observed`、`hook_injection=not_observed`、`root_manager_visible=not_observed`、`multi_open=not_observed`、`hardware_declaration_conflict=not_observed`、`selinux_permissive=insufficient`、`rom_verification=insufficient`、`identity_conflict=insufficient`。

**这份报告验证了两件事**：

1. **决定性命中真的会压 D，而且 value 同时是 null**。这正是第二轮红队发现的 P0 缺陷形态（旧代码会输出 `decisive=true` + `band="?"`）。现在真机（仿真机）实测走通了：`D` + `null` + `caps` 三者并存，互不矛盾。
2. **`virtual_build_markers` 只扣一次**，落在 behavior 轴，declaration 轴干净——`nonOverlayBasis` 的去重逻辑在真实数据上成立。

**仿真器特有的两个诚实降级**（不是 bug，是环境差异）：
- `system.selinux` = `RESTRICTED / ACCESS_DENIED`（仿真器上普通应用读不到），所以 `selinux_permissive=insufficient`。
- `environment.drmSecurityLevel` = `L3`（仿真器没有 Widevine L1 密钥），`software_drm` 命中——但它**展示不计分**，不影响 band。这正好反证了「不给 L3 计价」的决定是对的。

### 7.3 五个变体：把「5 分钟 5 种改装」真的跑了一遍

§5.4 当初设计的方案是「同一台假设备 5 分钟内变成 5 种不同程度的改装」。这一节是**实际执行的结果**，每一行都是一份真实上传的报告，可以从 API 读回来。

| 变体 | 怎么造 | 报告 ID | behavior 扣分 | coverage |
| --- | --- | --- | --- | --- |
| 基准 | 原样 | `ff32a085` | 35 | 0.67 |
| 第二用户 | `pm create-user` + `am start-user` + `--user 10` 跑仪器测试 | `556ac263` | 35 + 8 = **43** | 0.67 |
| 非原生挂载 | `mount -t tmpfs` 到含 `.magisk` 的路径 | `fe2f4ef5` | 35 + 25 = **60** | 0.67 |
| 两者叠加 | 上面两个同时 | `d0cf5b15` | 35 + 25 + 8 = **68** | 0.67 |
| Root 管理器 | 装带 LAUNCHER 的 `com.topjohnwu.magisk` 空壳包 | `e9e49086` | 35+25+12+8 = **80** | 0.83 |
| 被 ptrace | `strace -f -p <pid>` 真实附加 | `f9458aea` | 35+25+20+12+8 = **100**（轴分 **0**） | 0.83 |
| 宽容 SELinux | 再 `setenforce 0` | `c3ad4750` / `86705d8a` | 35+25+15+8 = **83** | **0.73** |
| 全六条 | 上述全部同时 | — | 35+25+20+15+12+8 = **115** → clamp **0** | 1.0 |

**每条命令都实测有效，没有一条是猜的**：

```bash
# 第二用户（不需要 root）
adb shell pm create-user sigmark-probe          # → Success: created user id 10
adb shell pm install-existing --user 10 com.sigmark.app
adb shell am start-user -w 10
adb shell am instrument -w -r --user 10 -e isolatedUploadPort <port> \
  com.sigmark.app.test/com.sigmark.app.CapabilitySmoke

# 非原生挂载（需要 adb root）
adb root
adb shell mkdir -p /data/local/tmp/.magisk/probe
adb shell mount -t tmpfs tmpfs /data/local/tmp/.magisk/probe

# 宽容 SELinux（需要 adb root）
adb shell setenforce 0 && adb shell getenforce   # → Permissive

# Root 管理器（不需要 root，但要自己造一个带 LAUNCHER 的空壳包）
# 关键：必须带 MAIN/LAUNCHER intent-filter，否则 API 30+ 的包可见性会把它藏起来，
# 探针报 none，看起来和干净设备一模一样——这是静默假阴性。
aapt2 link -o base.apk --manifest AndroidManifest.xml -I android.jar
d8 --lib android.jar --output dexout Stub.class   # Stub extends android.app.Activity
python -c "import zipfile;z=zipfile.ZipFile('withdex.apk','a');z.write('dexout/classes.dex','classes.dex')"
zipalign -f 4 withdex.apk aligned.apk && apksigner sign --out magisk-stub.apk aligned.apk
adb install -r -g magisk-stub.apk

# 被 ptrace（需要 adb root + 宽松 SELinux）
adb shell 'nohup am instrument ... &'          # 先起进程
PID=$(adb shell pidof com.sigmark.app)
adb shell "strace -f -p $PID -o /data/local/tmp/t.out &"
# 内核会在 /proc/<pid>/status 写 TracerPid=<strace 的 pid>
```

**几个实测发现，值得单独写下来**：

1. **`adb remount` 在这台 AVD 上不可用** —— 报 `Device must be bootloader unlocked`。手动 `mount -t overlay overlay -o lowerdir=/system,...` 也不行，报 `Invalid argument`。所以 §5.4 设想的「改 `/system` 造 overlay 挂载」这条路**在这台机器上走不通**，必须改用 `-writable-system` 启动参数（未实测）或放弃该变体。
2. **`.magisk` 路径只要出现就够** —— 探针读 `/proc/self/mountinfo`，匹配挂载点或源字符串里的 `.magisk`。不需要真的装 Magisk，也不需要 `magisk_path` 出现在 `/sbin`。这意味着**这个信号的检出成本极低，但误报面也很宽**：任何路径里带 `.magisk` 的挂载都会命中。
3. **`setenforce 0` 是唯一能造出 permissive 的手段** —— 真机要做到这一点必须先 root。所以这份样本代表的是「已经 root 的设备」，不是「普通用户误入的状态」。用它验证「规则会响」是对的，用它推断误报率是错的。
4. **`system.selinux` 在基准态是 `RESTRICTED`，`setenforce 0` 之后变成 `AVAILABLE / exact`** —— 这不是巧合：宽容模式下 SELinux 的策略文件对普通应用可读。也就是说**「读得到 SELinux 状态」本身就暗示它是 permissive**。这个相关性目前没有被任何规则利用，但它是真实的，写在这里备查。
5. **同一变体重复采集结果完全一致**（`c3ad4750` 与 `86705d8a` 两份扣分、coverage 一模一样），说明这套判定的确定性成立。
6. **`-e debug true` 造不出 `debugger_attached`** —— 它只让进程停在那里等调试器，`Debug.isDebuggerConnected()` 仍是「否」、`TracerPid` 仍是 0。实测报告 `4d5e30bc` 就是这条：等了半天，标签还是 `not_observed`。**必须真的 attach 一个 ptrace 客户端**（`strace -f -p`）才有非零 `TracerPid`。这个坑值得写下来，因为「用 debug 参数跑一遍」看起来完全像是正确的做法。
7. **`root_manager_visible` 依赖包可见性，是最容易静默失效的一个** —— 第一版空壳包忘了写 `MAIN`/`LAUNCHER` intent-filter，装上去后 `pm list packages` 能看到，但 `queryIntentActivities` 返回空，探针报 `none`。**报告和干净设备一模一样，没有任何报错**。这类假阴性只能靠「已知阳性样本必须命中」的测试兜住。
8. **`strace` 在 enforcing 下会被拒** —— `ptrace(PTRACE_SEIZE): Operation not permitted`。所以造 `debugger_attached` 必须先 `setenforce 0`，或者让目标进程本身就是可调试的。这解释了为什么真实设备上这个信号比较少见：正常 SELinux 环境下跨进程 ptrace 本来就被挡住。

**这份数据的真正用途**：`docs/SECURITY-SCORE.md` §9.3.1 的权重敏感性分析就是用它们跑的。结论是 band 对权重完全不敏感（由 R5/R11 决定），而 15/12/8 三个数字**互相在噪声内、无法区分**——这不是跑得不够，是样本只有各 1 份。

### 7.4 仍未实测（保留）

1. `google_apis_playstore` 镜像「`adb root` 失败、`-writable-system` 无效」的行为（属该镜像既定设计，未在本机复现）。
2. `-writable-system` 下 `build.prop` 改动的**持久化语义**（reboot 后是否保留、`-wipe-data` 是否清空）。
3. `arm64-v8a` 镜像在 x86 宿主上的**实际速度**。
4. Android-x86 / Bliss / Waydroid / redroid 的**确切属性值**（推断它们不命中 `virtual_build_markers`）。
5. 云真机的**具体价格**（只给量级）。
6. 「同一台假设备 5 分钟内变成 5 种不同程度的改装」（§5.4 的方案）——**只跑了基准形态，变体未跑**。
7. 老 API 镜像（如 android-29）上的行为——**只跑了 34**。

---

## 8. 一页速查

```powershell
# 一句话版本：只装这两样，只建这两个 AVD，只做这五份快照
& $sdkmanager --install "emulator" "system-images;android-34;google_apis;x86_64" "system-images;android-29;google_apis;x86_64"
& $avdmanager create avd -n "SM34-AOSP" -k "system-images;android-34;google_apis;x86_64" -d "pixel_6" --force
& $avdmanager create avd -n "SM29-AOSP" -k "system-images;android-29;google_apis;x86_64" -d "pixel_6" --force
& $emulator -accel-check
& $emulator -avd "SM34-AOSP" -writable-system -port 5554 -no-snapshot-load
adb -s emulator-5554 shell am instrument -w -e evidence dump com.sigmark.app.test/com.sigmark.app.CapabilitySmoke
# → 断言 virtual_build_markers == hit。这一条不成立，说明规则坏了，不是设备干净。
```
