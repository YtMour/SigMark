# 机型伪装的可覆盖面与盲区 · Pixel 6 → Xiaomi 23078PND5G 实测

更新于 **2026-11-25（Asia/Shanghai）**。本文是**独立专题记录**，只回答一个问题：当设备被改机层伪装成另一台机器时，普通应用（本 App）**还能看见哪些没被改写的东西**，以及这些读数各自能证明什么。

被测样本：Pixel 6（`oriole`，Tensor `gs101`）刷入改机层，伪装为 Xiaomi 23078PND5G（`corot`，Dimensity 9200+ `mt6985`）。真机序列号 `35241FDF6S1P3K`，Android 14 / API 34。本文的对照数据全部来自**同一台设备**的两种观察者，不是两台机器。

> 边界：本文不判定设备真伪，也不判定改机工具是否恶意。改机、移植 ROM、虚拟化、实验机型都会产生同样的现象。所有差异只提示"先核对测试条件"。

## 一、先分清三种观察者

| 观察者 | 取得方式 | 能否作为"App 可获得"的证据 |
| --- | --- | --- |
| **APP_PUBLIC** | 本 App 普通权限 API、`/proc/self/*`、`/proc/*` 公开节点 | 是，进入报告与字段集 |
| **APP_SYSFS** | 本 App 直读 `/sys/...`（部分节点普通应用可读） | 是，但需逐节点记录 errno |
| **SHELL_REFERENCE** | `adb shell`（`shell` uid）或 `run-as` | **否**，只作对照，永不写成 App 读数 |

同一台设备，`shell` 与 `run-as` 看到的 `uname -r` 完全一致（`5.10.198-android13-4-ga2085c97912a`），但 App 进程内 `Os.uname()` 报告 `5.15.123-android13-8-g51b93e9fd2a1-ab12020112`。这说明改写发生在**进程级**（App 进程内被 hook 或注入），而不是整机内核被换掉。任何"用 shell 补齐 App 读数"的做法都会把改写抹掉，必须禁止。

## 二、已被改写覆盖的表面（改机层生效区）

以下读数在 App 视角下**全部指向 Xiaomi 23078PND5G**，且互相自洽，无法单独证伪：

| 通道 | App 可见值 | 真实值（shell 对照） |
| --- | --- | --- |
| `Build.MODEL` / `ro.product.model` | `23078PND5G` | `Pixel 6` |
| `Build.DEVICE` / `ro.product.device` | `corot` | `oriole` |
| `Build.BRAND` / `MANUFACTURER` | `Xiaomi` / `Xiaomi` | `google` / `google` |
| `Build.FINGERPRINT` | `Xiaomi/corot_global/corot:14/UP1A.231005.007/OS1.0.9.0.UMLMIXM:user/release-keys` | `google/oriole/oriole:14/AP2A.240905.003/12366759:user/release-keys` |
| `Build.BOOTLOADER` | `corot-1.0.9` | `slider-14.5-12088207` |
| `Build.SOC_MODEL` | `Dimensity 9200+` | `Tensor` |
| `Build.BOARD` 平台 / `ro.board.platform` | `mt6985` | `gs101` |
| `ro.boot.hardware` | `mtk` | `oriole` |
| `Build.SKU` / `ro.boot.hardware.sku` | `23078PND5G` | `GR1YH` |
| `ro.product.first_api_level` | `33` | `31` |
| `Build.VERSION.MEDIA_PERFORMANCE_CLASS` | `31` | 未上报 |
| `ro.system.build.date.utc`（及 vendor/product/odm/system_ext） | `1723207452` → `2024-08-09` | `1783468800` → `2026-07-05` |
| `Os.uname()` release | `5.15.123-android13-8-…` | `5.10.198-android13-4-…` |
| `ActivityManager.MemoryInfo.totalMem` | `12.00 GiB` | `7.44 GiB` |
| `Os.sysconf(_SC_PHYS_PAGES)` | `12.00 GiB` | `7.44 GiB` |
| `EGL14.glGetString(GL_RENDERER)` / `GL_VENDOR` | `Immortalis-G715` / `ARM` | `Mali-G78` / `ARM` |
| `DisplayManager` 当前模式 | `1220×2712 @ 144 Hz` | `wm size` = `1080×2400`，刷新率 60/90 Hz |
| `dumpsys` 面板信息 | `Common Panel` / `GGL` | 同（未被改写） |

注意 `ro.debuggable`：App 侧读不到（`UNAVAILABLE · NOT_REPORTED`），shell 侧为 `0`。**属性被"抹掉"和属性被"改成别的值"是两件事**，报告必须分开记录，否则会被误读成"未 root"。

## 三、未被覆盖的表面（盲区清单）

这一节是本文的主体。每条都给出：App 能否读到、读到什么、为什么改写没盖住、现在怎么用。

### 1. `/proc/cpuinfo` 的 MIDR —— 已接入（字段集 22）

- **App 可见**：`cpu.cpuParts = AVAILABLE · 0x41:0xd05×4 / 0x41:0xd0b×2 / 0x41:0xd44×2 · /proc/cpuinfo`
- **为什么没被盖住**：MIDR 由内核按实际 CPU 核填入，改机层改的是属性字符串与 `Build`，不动内核维护的每核寄存器值；`/proc/cpuinfo` 对普通应用可读。
- **判读**：`0xd05/0xd0b/0xd44` 是 ARM Cortex-A55/A76/X1 系列标识，落在 Tensor G1（`gs101`）的核心集合内；声明的 Dimensity 9200+（`mt6985`）核心集合为 `0xd46/0xd4d/0xd4e`，两者无交集。
- **局限**：`/proc/cpuinfo` 在本机**没有** `Hardware` / `Revision` 行，不能靠这两行反查整机型号；只能做"核心集合是否落在声明 SoC 的家族内"。

### 2. `/proc/meminfo` 的 `MemTotal` —— 已接入（字段集 22）

- **App 可见**：`memory.kernelMemTotal = AVAILABLE · 7.44 GiB · /proc/meminfo`
- **为什么没被盖住**：改机层把 `totalMem`（框架）和 `sysconf`（C 库）都改成 `12.00 GiB`，但内核 `/proc/meminfo` 仍报 `7798708 kB = 7.44 GiB`。
- **判读**：三条内存口径（框架 / C 库 / 内核）在同一台机器上通常只差几个百分点（预留内存）；`12.00 / 12.00 / 7.44` 的离散度远超阈值，属声明冲突。
- **局限**：`/proc/meminfo` 只有总量，不含实际可用容量；不能据此判断是 8 GiB 还是 12 GiB 物理颗粒，只能说"与声明不符"。

### 3. `/proc/self/maps` 里的 overlay 文件名 —— 已接入（字段集 23 / 25）

- **App 可见**：`environment.overlayDeviceCodename = AVAILABLE · oriole · /proc/self/maps`
- **字段集 25 扩成多路径证据串**：`environment.overlayEvidence = AVAILABLE · rro:oriole / vendor_dir:oriole / product_dir:oriole / sku:g9s9b,gb7n6,gr1yh / soc:gs101 · /proc/self/maps + /vendor|product|system_ext|odm/overlay`。不再只留一个代号，而是记下「哪条路径命中了什么」：`maps` 的 framework RRO → `maps` 的 idmap 转义名 → 四个分区 overlay 目录扫描；多级冲突以 `maps` 为准并写 `conflict:` 段。详见 [overlay 代号多路径冗余抽取](OVERLAY-ROBUSTNESS.md)。
- **为什么没被盖住**：AOSP 按**镜像构建时的产品名**生成 framework RRO 文件名，形如
  `framework-res__<product>_user__auto_generated_rro_<partition>.apk`，其 idmap 被每个加载资源的进程映射。改机层改的是属性与 `Build`，不会重建这些文件。本机实测映射到：
  - `/data/resource-cache/product@overlay@framework-res__oriole_user__auto_generated_rro_product.apk@idmap`
  - `/data/resource-cache/vendor@overlay@framework-res__oriole_user__auto_generated_rro_vendor.apk@idmap`
- **判读**：属性报 `corot`，overlay 报 `oriole` → 镜像不是 Xiaomi 的。这是**当前唯一一条不依赖硬件、也不依赖属性链**的代号证据。
- **`sku:` 只是旁证，实测已确认不能参与判定**：**被改装的** Pixel 6 上 `ro.boot.hardware.sku` 和 `device`／`model` 一样按 UID 改写——`adb shell` 读 `GR1YH`（真机原值），`run-as com.sigmark.app` 读 `23078PND5G`（小米 SKU）。App 侧声明 SKU 与三个 overlay 候选（`G9S9B`／`GB7N6`／`GR1YH`）全不匹配，证据串按设计退回 `sku:g9s9b,gb7n6,gr1yh` 并列形态。**但这不是 Android 行为**：1.21.2 用未改装的 MI 8（API 29）反证——那台机器上 `ro.boot.hardware.sku` **根本不存在**（shell 与 `run-as` 都读空），`ro.product.model`／`ro.product.device` 两个 UID 读到完全相同的值。正确表述是「**被改装的设备上，属性按 UID 改写；未改装设备上两个 UID 一致**」。**这条偏差本身是结论**：声明值必须先问「在哪个 UID 下读到」，只有 overlay 文件名是硬的。
- **局限**：① 部分 ROM 会把 overlay 改名或改用非 AOSP 命名，此时多路径全部落空，只能记 `UNAVAILABLE`，不能当"干净"；② 它证明的是"镜像构建产品名"，不是"物理机器型号"——移植 ROM 可以让真 Xiaomi 机器跑 `oriole` 镜像；③ 只读本进程映射与四个 overlay 目录，不遍历其他进程。
- **配套规则**：`DevicePosture` 新增 `overlay_codename` 行；后台 `hardware_declaration_conflict` 把 `system.device` 与 `environment.overlayDeviceCodename` 作为第四条独立通道（其余三条为内存离散度、核心集合、GPU 家族）。现行画像规则为 **`sigmark-profile/8`**（1.21.2 因新增 `sdm845` 登记升版；证据行仍 10 条、标签仍 10 个），共六条通道（再加字段集 24 的 `cpu.cpuCapacity`、`memory.cmaTotal`）。字段集 25 只加了 `overlayEvidence` 这一条证据字段，**没有改判定规则**。

### 4. `/proc/version`、`/proc/uptime`、`/proc/stat` —— 普通应用被拒

- **App 可见**：`RESTRICTED · ACCESS_DENIED · errno=13`
- **实测**：`run-as com.sigmark.app cat /proc/version` → `Permission denied`；`/proc/uptime`、`/proc/stat` 同。
- **含义**：Android 10+ 的 `proc` 挂载已隐藏这些节点。**所以"内核版本不一致"这条线只能靠 `Os.uname()`（会被改写），App 侧拿不到可信的内核版本。** 报告里这类节点必须记 `RESTRICTED` 并注明观察者，不能因为 shell 能读就把 shell 的值写成 App 值。

### 5. `/sys/.../cpufreq` 频率表 —— 部分可读，未接入

- **shell 对照**：`cpuinfo_max_freq` 三簇为 `1803000 / 2253000 / 2802000`，是 Tensor G1 的典型三簇配置，与 `mt6985` 的簇结构不同。
- **App 可见**：部分 `scaling_max_freq` 节点可读（`cpu0MaxFrequency = 1803 MHz` 已进入报告，与 shell 一致），但多数 `cpuinfo_*` 节点受 SELinux 限制。
- **为什么没被盖住**：改机层改 `sysconf` 的核数与频率口径，不改 sysfs 实际文件。
- **待办**：把三簇频率集合作为下一条独立通道接入（需要先确认 API 26–30 与不同厂商的可读性，避免把 `RESTRICTED` 当异常）。

### 6. SensorService / CameraService 枚举 —— 传感器可做指纹，相机通道已被接管

> 本节经复测后**推翻初版结论**，完整评估见 [传感器与相机指纹级比对](SENSOR-CAMERA-FINGERPRINT.md)。初版写的是「App 侧 37 个 vs shell 侧 50 个，数量本身不可比」和「改机层通常只改型号字符串，不改服务注册表」——前一句是**数错了**，后一句**只在传感器侧成立**。

- **App 可见**：`sensors` 组 37 项（`SensorManager`），`media` 组相机 2 个（`CameraManager`）。
- **shell 侧的真实结构（更正）**：`dumpsys sensorservice` 输出里共有 50 行 `0x…` 句柄，但其中 **5 行是顶部的活动连接行**（active connections），**只有 45 行是 Sensor List 条目**。这 45 条再拆：**37 个硬件传感器 + 8 个 AOSP 运行时融合传感器**（句柄 `0x5f` 前缀、`vendor=AOSP`、类型号与 Google 自带条目重复），后者由 SensorService 运行时合成，本就不下发给应用。shell 自己也写着 `Total 37 h/w sensors`。
- **因此两侧完全可比**：App 的 37 与 shell 的 `Total 37 h/w sensors` **逐项同名、同 vendor**，不存在「少报了 13 个」。初版把它归因为 `RESTRICTED`／类型过滤／HAL 私有传感器，是数错了行数。
- **传感器侧：改机层没有动服务注册表。** 这 37 项在改机后仍全部报 Pixel 6 原厂器件——STMicro LSM6DSR、MEMSIC MMC56X3X、AMS TMD3719、InvenSense ICP10101、VD6282，11 个私有类型无一指向 Xiaomi／`mt6985`。所以「只改型号字符串、不改服务注册表」在传感器侧成立，它可以作为一条 `type + name + vendor` 的指纹通道。
- **相机侧：已被推翻。** 改机层注入了**整个假的 camera HAL provider**——`ICameraProvider/ym/0-1`，其设备为 `ym/42`、`ym/43`。App 侧通过 `CameraManager` 只看到这 2 路伪造相机，真机的 `internal/0`、`internal/1` **完全不可见**。
- **为什么相机指纹不能做**：不是权限不足、也不是数量不可比，而是**通道已被接管**——App 拿到的枚举答案本身就是伪装层给的，拿它当指纹等于用伪装层的答案审伪装层，结论必然「自洽」，没有证据价值。所以相机明确不做，不是「暂时不做」。
- **将来什么条件下值得重做**：① 传感器——值得做，前提是先有一份跨厂商基线（至少一台非 Pixel、一台 API 26–30），否则会把 HAL 私有传感器当差异；比对用 `type + name + vendor`，不用计数。② 相机——只有在找到**绕开 HAL provider 枚举**的独立观察点时（例如系统相机服务侧的 provider 列表，或某类 ROM 上 `CameraManager` 直连真实 provider 的路径）才重做；单纯增加相机字段没有意义。若某台样本上改机层只改属性、不注入 provider，相机枚举会恢复可信，但这需要另一台机器证明，当前样本不支持。
- **复现方式**：App 侧读 `SensorManager.getSensorList(TYPE_ALL)` 与 `CameraManager.getCameraIdList()`；shell 对照用 `dumpsys sensorservice`（先数 `Total N h/w sensors`，不要数 `0x…` 行数）与 `dumpsys media.camera`（看 provider 列表）。两侧必须分开记录观察者，不得互相填充。

### 7. `/data/resource-cache` 目录本身 —— 不可列

- `run-as com.sigmark.app ls /data/resource-cache` → `Permission denied`。App 只能通过**已映射文件**看到 overlay 名，不能主动枚举目录。这决定了第 3 条只能"顺带观察"，不能"主动扫描"。

### 8. `dumpsys` 面板与密度 —— 与 App 一致，无法用来自证

`dumpsys display` 的 `deviceProductInfo name=Common Panel manufacturerPnpId=GGL`、`409.432 x 411.891 dpi` 与 App 侧密度 420 一致。这是本机真实信息，但它**没被改写**也**不能证明机器型号**，只说明显示层没被改。

## 四、现在能下的结论

1. **声明链（`Build` / `getprop`）在 App 进程内被整体覆盖，同义核对只能证明"改写自洽"**，不能证明硬件。字段集 25 的实测又补了一条：**被改装的设备上**连 `ro.boot.hardware.sku` 都按 UID 分裂（shell `GR1YH`、`run-as` `23078PND5G`），所以任何"声明值"在当证据前都要先问它在哪个 UID 下读到。1.21.2 用未改装的 MI 8 补齐了另一半：那台机器两个 UID 读到完全相同的值，且该属性根本不存在——**per-UID 改写是改机层行为，不是 Android 行为**。
2. **五条不依赖声明的通道已经可用**：`/proc/cpuinfo` 核心标识、`/proc/meminfo` 内存总量、`/proc/self/maps` 的 overlay 产品名、`/sys/.../cpu{N}/cpu_capacity` 算力权重序列、`/proc/meminfo` 的 `CmaTotal` 预留连续内存池。后两条是字段集 24 的内核写入值，本机都命中 `gs101` 的登记值而与声明 `mt6985` 冲突。任一与声明冲突即判 `hardware_declaration_conflict`（现行 `sigmark-profile/8`，证据行 10 条），措辞是"请核对测试条件"，不是"设备是假的"。
3. **内核版本这条线在 App 侧基本不可用**：`/proc/version` 拒读，`Os.uname()` 被改写。想恢复它只能靠特权观察者，那就违反"不以特权读数冒充 App 读数"的约定，因此**明确放弃**，并在文档里写明放弃理由。
4. **传感器可以做指纹，相机不能**：传感器侧 App 的 37 项与 shell 的 `Total 37 h/w sensors` 逐项同名同 vendor，全是 Pixel 6 原厂器件，可作 `type + name` 通道；相机侧改机层注入了整个假 HAL provider（`ICameraProvider/ym/0-1`），App 只看到伪造的 2 路，真机 provider 不可见，**通道不可信，明确不做**。详见 [传感器与相机指纹级比对](SENSOR-CAMERA-FINGERPRINT.md)。

## 五、复现命令

```powershell
# 1. App 侧读数（本机采集 + 证据导出，不上传）
adb -s 35241FDF6S1P3K shell am instrument -w -r -e evidence dump `
  com.sigmark.app.test/com.sigmark.app.CapabilitySmoke

# 2. 同一台机器的 shell 对照（只作参考，不进报告）
adb -s 35241FDF6S1P3K shell "uname -r; getprop ro.product.device; getprop ro.soc.model"
adb -s 35241FDF6S1P3K shell "grep MemTotal /proc/meminfo; grep 'CPU part' /proc/cpuinfo | sort -u"

# 3. 逐 uid 对照：属性与 /proc 的可读性差异
adb -s 35241FDF6S1P3K shell "run-as com.sigmark.app uname -r; run-as com.sigmark.app cat /proc/version"

# 4. overlay 产品名（进程必须存活）
adb -s 35241FDF6S1P3K shell "monkey -p com.sigmark.app -c android.intent.category.LAUNCHER 1"
adb -s 35241FDF6S1P3K shell "run-as com.sigmark.app cat /proc/$(pidof com.sigmark.app)/maps | grep -o 'framework-res__[a-z0-9_]*_user'"
```

## 六、后续优化路线（按性价比排序）

| 优先级 | 事项 | 前置条件 |
| --- | --- | --- |
| P1 | 把三簇 `cpuinfo_max_freq` 集合接入为下一条通道 | 先在 API 26–30 与一台非 Tensor 设备上确认可读性，`RESTRICTED` 必须能区分 |
| P1 | 传感器改为 `type+name+vendor` 指纹比对（**不做相机**：通道已被假 HAL provider 接管） | 需要一份跨厂商基线，否则会把 HAL 私有传感器当差异 |
| P2 | overlay 代号支持非 AOSP 命名（`*_rro_*`、自定义 overlay） | 需要至少两种第三方 ROM 样本，否则宁可记 `UNAVAILABLE` |
| P2 | `/proc/self/attr/current`、`/proc/self/status` 的观察者标注统一 | 现有实现已在用，缺的是报告里"观察者"字段的一致呈现 |
| P3 | 放弃内核版本通道，改为在报告中显式说明"App 侧不可得" | 无需前置，属于文档与措辞 |

## 七、与其他文档的关系

- 采集边界与字段语义：[SECURITY-EVIDENCE.md](SECURITY-EVIDENCE.md)
- 判定规则与复测口径：[REGRESSION-WORKFLOW.md](REGRESSION-WORKFLOW.md)、[FRAMEWORK-DIAGNOSTICS.md](FRAMEWORK-DIAGNOSTICS.md)
- 真机验证记录：[DEVICE-VALIDATION.md](DEVICE-VALIDATION.md)
- 路线图：[ROADMAP.md](ROADMAP.md)

本文只记录**观察结果与边界**，不构成对任何设备的真伪判定。
