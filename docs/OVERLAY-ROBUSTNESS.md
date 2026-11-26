# 印迹：overlay 设备代号的多路径冗余抽取（设计规格）

> 状态：**已落地并随 1.21.2 / 50 收口**。正文保留设计时的原文，落地后的实测偏差就地标注在 §3.4、§5.2 与 T15。
> 观察机：`35241FDF6S1P3K`（Pixel 6 / `oriole`，属性层被 `com.ym.deviceprofile` 改写为 Xiaomi `corot` / `23078PND5G`）。
> 全文区分「实测」与「推测」：实测条目附命令与原始输出；推测条目显式标注。

---

## 0. 结论摘要

1. 现有通道 `environment.overlayDeviceCodename` 只认 AOSP 的 `framework-res__<product>_user__auto_generated_rro_<partition>.apk`。**本机实测命中**（`oriole`），通道有效。
2. 但该名字只是**一条**构建产物；同一镜像里还存在第二、第三条冗余证据：`/vendor/overlay`、`/product/overlay` 目录下的同源 RRO 文件名（本机实测可被应用 UID 读取），以及 `/data/resource-cache/*@idmap` 的转义文件名（本机实测存在于 `maps`）。
3. 因此设计三级冗余：`maps` 里的 framework RRO → `maps` 里其它 `<target>__<product>_user__auto_generated_rro` idmap → 四个分区 overlay 目录扫描。任一级命中即可给出代号；多级冲突时**以 maps 为准**并记录冲突。
4. 新字段 `environment.overlayEvidence` 承载「哪条路径命中了什么」，与现有 `overlayDeviceCodename` 并存；现有字段语义不变（旧报告已归档，不可重算）。
5. 字段集建议 **25**（24 已被并行通道 `cpu.cpuCapacity` + `memory.cmaTotal` 占用，见 §7.1）。

---

## 1. 实测依据

### 1.1 观测环境（实测）

```powershell
adb devices -l
# 35241FDF6S1P3K  device product:oriole model:Pixel_6 device:oriole transport_id:17
# 5371113b        offline transport_id:31

adb -s 35241FDF6S1P3K shell "getprop ro.product.device; getprop ro.product.model; getprop ro.build.version.sdk"
# oriole
# Pixel 6
# 34
```

进程存活方式（实测）：

```powershell
adb -s 35241FDF6S1P3K shell "monkey -p com.sigmark.app -c android.intent.category.LAUNCHER 1"
# Events injected: 1
Start-Sleep -Seconds 3
adb -s 35241FDF6S1P3K shell "pidof com.sigmark.app"
# 18672
```

### 1.2 命令与原始输出（实测）

**(a) `maps` 里的 `/data/resource-cache/*` 路径 —— 6 条，全部为 `@idmap` 转义形态**

```powershell
adb -s 35241FDF6S1P3K shell "run-as com.sigmark.app cat /proc/`$(pidof com.sigmark.app)/maps | grep -o '/data/resource-cache/[^ ]*' | sort -u"
```

```text
/data/resource-cache/data@resource-cache@com.android.systemui-accent-MYFK.frro@idmap
/data/resource-cache/data@resource-cache@com.android.systemui-dynamic-mb14.frro@idmap
/data/resource-cache/data@resource-cache@com.android.systemui-neutral-90PO.frro@idmap
/data/resource-cache/product@overlay@YmRecentsGs101Overlay@YmRecentsGs101Overlay.apk@idmap
/data/resource-cache/product@overlay@framework-res__oriole_user__auto_generated_rro_product.apk@idmap
/data/resource-cache/vendor@overlay@framework-res__oriole_user__auto_generated_rro_vendor.apk@idmap
```

**(b) `maps` 里的分区 overlay 直挂路径 —— 3 条**

```powershell
adb -s 35241FDF6S1P3K shell "run-as com.sigmark.app cat /proc/`$(pidof com.sigmark.app)/maps | grep -oE '/(vendor|product|system_ext|odm)/overlay/[^ ]*' | sort -u"
```

```text
/product/overlay/YmRecentsGs101Overlay/YmRecentsGs101Overlay.apk
/product/overlay/framework-res__oriole_user__auto_generated_rro_product.apk
/vendor/overlay/framework-res__oriole_user__auto_generated_rro_vendor.apk
```

**(c) 应用 UID 能否列目录 —— `/vendor/overlay`、`/product/overlay` 可读；`/data/resource-cache` 被拒**

```powershell
adb -s 35241FDF6S1P3K shell "run-as com.sigmark.app ls /vendor/overlay"
```

```text
BatteryStatsViewer__oriole_user__auto_generated_rro_vendor.apk
DeviceDiagnostics__oriole_user__auto_generated_rro_vendor.apk
EmergencyInfo__oriole_user__auto_generated_rro_vendor.apk
NfcNci__oriole_user__auto_generated_rro_vendor.apk
ONS__oriole_user__auto_generated_rro_vendor.apk
Settings__oriole_user__auto_generated_rro_vendor.apk
StorageManager__oriole_user__auto_generated_rro_vendor.apk
SystemUI__oriole_user__auto_generated_rro_vendor.apk
TeleService__oriole_user__auto_generated_rro_vendor.apk
Traceur__oriole_user__auto_generated_rro_vendor.apk
framework-res__oriole_user__auto_generated_rro_vendor.apk
```

```powershell
adb -s 35241FDF6S1P3K shell "run-as com.sigmark.app ls /product/overlay"
```

```text
CompanionDeviceManager__nosdcard__auto_generated_characteristics_rro.apk
ConnectivityOverlay.apk
DeviceAsWebcamOriole.apk
DisplayCutoutAvoidAppsInCutout
DisplayCutoutEmulationCorner
DisplayCutoutEmulationDouble
DisplayCutoutEmulationHole
DisplayCutoutEmulationTall
DisplayCutoutEmulationWaterfall
DisplayCutoutNoCutout
FontNotoSerifSource
NavigationBarMode3Button
NavigationBarModeGestural
NavigationBarModeGesturalExtraWideBack
NavigationBarModeGesturalNarrowBack
NavigationBarModeGesturalWideBack
NfcOverlayOriole.apk
NotesRoleEnabled
SettingsOverlayG9S9B.apk
SettingsOverlayGB7N6.apk
SettingsOverlayGR1YH.apk
TeleService__nosdcard__auto_generated_characteristics_rro.apk
TelephonyProvider__nosdcard__auto_generated_characteristics_rro.apk
TransparentNavigationBar
WifiOverlay
YmRecentsGs101Overlay
YmSetupWizardGs101Overlay
framework-res__nosdcard__auto_generated_characteristics_rro.apk
framework-res__oriole_user__auto_generated_rro_product.apk
```

```powershell
adb -s 35241FDF6S1P3K shell "run-as com.sigmark.app ls /odm/overlay /system_ext/overlay"
# lrw-r--r-- 1 root root 19 2008-12-31 18:00 /odm/overlay -> /vendor/odm/overlay
# ls: /system_ext/overlay: No such file or directory
adb -s 35241FDF6S1P3K shell "ls -la /vendor/odm/overlay"
# ls: /vendor/odm/overlay: No such file or directory   （软链悬空）

adb -s 35241FDF6S1P3K shell "run-as com.sigmark.app ls /data/resource-cache"
# ls: /data/resource-cache: Permission denied
```

**(d) 目录权限（实测，决定「应用能不能扫」）**

```powershell
adb -s 35241FDF6S1P3K shell "ls -ld /vendor/overlay /product/overlay /data/resource-cache"
# drwxrwx--x  2 system system 8192 2026-10-14 05:09 /data/resource-cache
# drwxr-xr-x 20 root   root   1296 2008-12-31 18:00 /product/overlay
# drwxr-xr-x  2 root   shell  4096 2008-12-31 18:00 /vendor/overlay
```

**(e) `dumpsys overlay` 全景（实测，仅 shell 可见，应用不可用）**

```powershell
adb -s 35241FDF6S1P3K shell "dumpsys overlay | grep -c mBaseCodePath"     # 41
adb -s 35241FDF6S1P3K shell "dumpsys overlay | grep -o 'mBaseCodePath..........: /[a-z_]*/overlay' | sort | uniq -c"
# 27 mBaseCodePath..........: /product/overlay
# 11 mBaseCodePath..........: /vendor/overlay
adb -s 35241FDF6S1P3K shell "dumpsys overlay | grep 'mBaseCodePath..........: /data/resource-cache'"
# mBaseCodePath..........: /data/resource-cache/com.android.systemui-neutral-90PO.frro
# mBaseCodePath..........: /data/resource-cache/com.android.systemui-accent-MYFK.frro
# mBaseCodePath..........: /data/resource-cache/com.android.systemui-dynamic-mb14.frro

adb -s 35241FDF6S1P3K shell "run-as com.sigmark.app dumpsys overlay"
# Can't find service: overlay
```

**(f) 属性层已被 per-UID 改写，`maps` 没有被改写（实测，本轮的关键前提）**

```powershell
adb -s 35241FDF6S1P3K shell "getprop ro.product.device"                       # oriole
adb -s 35241FDF6S1P3K shell "run-as com.sigmark.app getprop ro.product.device" # corot
adb -s 35241FDF6S1P3K shell "getprop ro.boot.hardware.sku"                    # GR1YH
adb -s 35241FDF6S1P3K shell "getprop ro.board.platform"                       # gs101
```

同一台机器，shell 视角是 `oriole`，应用 UID 视角是 `corot`；而应用进程 `maps` 里的 overlay 文件名仍是 `oriole`。**属性层可被逐 UID 改写，overlay 文件名不会。**

### 1.3 归档样本里读到的实际字段值（实测）

从应用私有库 `lan-samples.db` 只读导出后在本地解析（`adb exec-out ... cat` 到本机临时目录，未在设备上写任何文件）：

```text
sample b94b8dea-b930-4c62-919d-b5c7141b6c3c  fieldSetVersion 23
system.device                     = 'corot'        AVAILABLE | Build.DEVICE
system.propertyDevice             = 'corot'        AVAILABLE | getprop ro.product.device
system.model                      = '23078PND5G'   AVAILABLE | Build.MODEL
system.partition_vendor           = 'Xiaomi/corot_global/corot:14/UP1A.231005.007/OS1.0.9.0.UMLMIXM:user/release-keys · 2024-08-09T12:44:12Z'
environment.overlayDeviceCodename = 'oriole'       AVAILABLE | /proc/self/maps
```

即：本机上 `overlay_codename` 这一行应当判 **REVIEW**（`corot` ≠ `oriole`），现有通道正常工作。

### 1.4 本机被拒 / 不存在的通道（实测）

| 通道 | 结果 |
| --- | --- |
| `/data/resource-cache` 目录列举 | `Permission denied`（`drwxrwx--x system:system`，应用 UID 无 `r`） |
| `dumpsys overlay` | 应用内 `Can't find service: overlay` |
| `/system_ext/overlay` | `No such file or directory` |
| `/odm/overlay` | 悬空软链 → `/vendor/odm/overlay`（不存在） |
| `/system/overlay` | `No such file or directory` |

> 结论：**idmap 只能从 `maps` 里读，不能从目录列举**；分区 overlay 目录（vendor / product）可以列举。这是分级设计的硬约束。

### 1.5 实测边界（重要，防止把推测当事实）

- 本机是「属性被改写、镜像未改名」。**「第三方 ROM 改名导致通道 UNAVAILABLE」是推测场景，本机无法验证**（不能刷机、不能改 overlay 文件）。
- 因此 §2 中每条路径的「可靠性」栏都是基于实测格式 + AOSP 命名规则的推断，不是本机实测结论。
- 目录扫描在本机对应用 UID 成功，但**不同 ROM 可能收紧 `/vendor/overlay` 权限**；必须按「可能被拒」实现。

---

## 2. 候选抽取路径评估

| # | 路径 | 本机实测结果 | 命名格式 | 可靠性 | 误报风险 |
| --- | --- | --- | --- | --- | --- |
| A | `maps` 中 `framework-res__<product>_user__auto_generated_rro_<partition>.apk` | **命中** `oriole`（product + vendor 各一条） | `framework-res__<p>_user__auto_generated_rro_<part>.apk` | 高：构建产物，属性改写不影响 | 低；需排除 `nosdcard` |
| B | 其它 `/data/resource-cache/*@idmap` 转义名 | **存在 6 条**，其中 3 条是 `systemui-*.frro`（无关），2 条 framework-res，1 条 `YmRecentsGs101Overlay` | `<part>@overlay@<inner>@<inner>@idmap` 或 `data@resource-cache@<pkg>-<variant>-<tag>.frro@idmap` | 中高：只在**已加载该资源表的进程**里出现 | 中：`frro` 动态色、CamelCase 名会混入，必须按 `__<p>_user__` 锚定 |
| C | `/vendor/overlay/*.apk` 目录扫描 | **可读，11 个文件**，其中 11 个含 `__oriole_user__` | `<target>__<p>_user__auto_generated_rro_<part>.apk` | 高：同源 RRO，**且是 A 被改名后最可能残留的同族证据** | 低；`<target>` 段任意，只取 `__<p>_user__` |
| D | `/product/overlay/*.apk` 目录扫描 | **可读，29 项**；命中 `framework-res__oriole..._product.apk`，另有 `framework-res__nosdcard__...` | 同上 + `..._auto_generated_characteristics_rro.apk` | 中高 | **中高**：`nosdcard` 占位名；`DeviceAsWebcamOriole` / `NfcOverlayOriole` 是 CamelCase 后缀；`SettingsOverlay<SKU>` 是 SKU 不是代号 |
| E | `/odm/overlay`、`/system_ext/overlay` | **不存在 / 悬空软链** | 同 C | 低（本机无内容），但移植 ROM 上常见 | 低 |
| F | `maps` 中 `Ym*Overlay`（SoC 名） | **命中** `YmRecentsGs101Overlay`，`ro.board.platform=gs101` | `Ym<App><SoC>Overlay` | 中：SoC 型号是**另一条线索**，不是设备代号 | **高**：`Gs101` 是 SoC，不能当代号 |
| G | `<Target>Overlay<SKU>.apk` | **命中** `SettingsOverlayG9S9B/GB7N6/GR1YH`；`ro.boot.hardware.sku=GR1YH` | `<Target>Overlay<SKU>.apk` | 中：SKU 通道 | **高**：SKU ≠ 代号 |

逐条说明：

- **A（现有）**：`maps` 里 framework-res 的 idmap 在每个加载系统资源的进程里都存在，因此最稳定。缺点单一：ROM 一改名就整条失效。
- **B（其它 idmap）**：本机 SigMark 进程只有 framework-res 的 idmap 带代号，`idmap` 通道在本机**无独立命中**（这是预期，因为 per-target RRO 只在该目标应用的进程里被映射）。它的价值在别的进程/别的 ROM 上：例如 `/vendor/overlay/Settings__oriole_user__...` 若被加载，就会以 `vendor@overlay@Settings__oriole_user__auto_generated_rro_vendor.apk@idmap` 形式出现在那个进程的 `maps`。对印迹自身进程，它基本不会命中，但**实现成本极低**，且能覆盖「framework-res 被改名、per-target 未改名」的情形。
- **C/D（目录扫描）**：本机对应用 UID 完全可读（实测 `ls` 成功）。这是 A 失效后**最可靠的冗余**：AOSP 生成的 per-target RRO 与 framework RRO 同名规则，同一构建里一起生成；改机模块通常只替换 `framework-res__*` 那一个（因为它才是 framework 资源覆盖），其余 per-target 文件名往往保留。**这是本设计的主要兜底。**
- **F（SoC）**：`YmRecentsGs101Overlay` 证明 Google 侧还有一类以 SoC 命名的 overlay。它**不能**当设备代号（`gs101` 是 Tensor 平台，`oriole`/`raven` 都用它），只能作为「平台一致性」的旁证。
- **G（SKU）**：`SettingsOverlayGR1YH` 与 `ro.boot.hardware.sku=GR1YH` 一一对应（实测），说明这类后缀是 **SKU/型号**，`G9S9B`、`GB7N6` 是 Pixel 6 的其它 SKU。**绝不可当代号**，但可作为「型号声明」旁证。

---

## 3. 正则与优先级设计

### 3.1 黑名单（必须先判，命中即丢弃）

通用词与占位词，比较时**大小写不敏感**、`-`/`_` 归一后再比：

```text
framework  common  system  product  vendor  odm  system_ext  main  default  base
nosdcard   generic  unknown  google  android  aosp  user  eng  test  debug
overlay    rro  apk  idmap  resources  device  phone  build
mtk  qcom  gs101  gs201  exynos  tensor  kirin  sm8450  mt6985
```

> 注：`corot`（本机伪装目标）与 `oriole`（真机）都是**合法代号**，不得进黑名单。黑名单只收「结构词 / 占位词 / 平台名 / SKU」，不收任何真实设备代号。

- `nosdcard` 是**实测**出现的占位产品名（`framework-res__nosdcard__auto_generated_characteristics_rro.apk`），必须排除。
- `gs101` / `mt6985` 等来自 §2 F 与 `ro.board.platform`，属于平台名，不是代号。
- 黑名单同时用于 A/B/C/D 四类路径的捕获组过滤，**任一级命中黑名单都视为「无命中」**，不允许「降级使用」。

### 3.2 各级正则

统一约定：捕获组 1 为产品代号候选，长度 2–32，字符集 `[A-Za-z0-9_]`，捕获后 `lowercase(Locale.ROOT)`。

**A 级 —— framework RRO（`maps` 原文，含 `@idmap` 转义形态）**

```kotlin
// 匹配 framework-res__<p>_user__auto_generated_rro[_<partition>].apk
// 该子串同时出现在直挂路径与 @overlay@...@idmap 转义路径里，故一条正则覆盖两种形态。
private val frameworkRro = Regex(
    """framework-res__([A-Za-z0-9_]{2,32})_user__auto_generated_rro(?:_[a-z0-9]{1,16})?\.apk"""
)
```

**B 级 —— 其它 `@idmap` 转义名（`maps`）**

不做「一条巨正则」，先按路径段切分再判内层名，稳妥且可测：

```kotlin
private val idmapPath = Regex("""/data/resource-cache/([^/\s]+)@idmap""")
// 对每段 seg：inner = seg.split('@').dropLast(1).last()
// inner 去掉 ".apk" 后必须匹配：
private val perTargetRro = Regex(
    """^(?!framework-res__)([A-Za-z0-9_.]{1,64})__([A-Za-z0-9_]{2,32})_user__auto_generated_rro(?:_[a-z0-9]{1,16})?\.apk$"""
)
// 捕获组 2 为代号候选。组 1 只用于记录目标包名，不参与裁决。
```

- 必须容忍 `data@resource-cache@com.android.systemui-accent-MYFK.frro@idmap` 这种**非 `@overlay@`** 形态（实测存在）：`split('@').dropLast(1).last()` = `com.android.systemui-accent-MYFK.frro`，不匹配 `perTargetRro` → 丢弃。
- 去重：同一文件名可能在 `maps` 里出现多个映射段，按文件名去重后取第一个。

**C/D/E 级 —— 目录扫描**

```kotlin
private val dirRro = Regex(
    """^[A-Za-z0-9_.\-]{1,64}__([A-Za-z0-9_]{2,32})_user__auto_generated_(?:rro|characteristics_rro)(?:_[a-z0-9]{1,16})?\.apk$"""
)
```

- 目录顺序固定：`/vendor/overlay` → `/product/overlay` → `/system_ext/overlay` → `/odm/overlay`。
- 目录列举上限 64 项（实测 `/product/overlay` 29 项、`/vendor/overlay` 11 项，64 足够且防爆）。
- 文件名集合按字典序排序后再匹配，保证**同一设备多次采集结果稳定**（`File.list()` 顺序不保证）。

**F 级 —— SoC（只记旁证，永不进代号）**

```kotlin
private val socOverlay = Regex("""Ym[A-Za-z]{2,24}?([A-Z][a-z]?\d{3})Overlay""")
// 实测 YmRecentsGs101Overlay -> "Gs101" -> lowercase "gs101"
```

**G 级 —— SKU（只记旁证，永不进代号）**

```kotlin
private val skuOverlay = Regex("""^[A-Za-z]{3,24}Overlay([A-Z0-9]{4,10})\.apk$""")
// 实测 SettingsOverlayGR1YH.apk -> "GR1YH" -> lowercase "gr1yh"
```

**明确不做**：不抽取 `DeviceAsWebcamOriole.apk`、`NfcOverlayOriole.apk` 这类 CamelCase 后缀。理由：`SettingsOverlayGB7N6` 证明同类后缀可能是 SKU；没有稳定锚点，抽了就是猜。

### 3.3 抽取顺序与冲突裁决

```text
1) A 级：maps 中 framework RRO            ← 命中即裁决结果（优先级最高）
2) B 级：maps 中 per-target RRO idmap
3) C 级：/vendor/overlay 目录
4) D 级：/product/overlay 目录
5) E 级：/system_ext/overlay、/odm/overlay 目录
6) F/G 级：只写入证据串，不参与代号裁决
```

规则：

1. 逐级取值，**第一个通过黑名单的候选**即为 `codename`。
2. 后续各级若也取到候选且与 `codename` **归一化后不等**，不覆盖 `codename`，只追加一条冲突记录 `conflict=<级>:<值>!=<级>:<值>`。
3. 归一化：`lowercase` + 去首尾空白；`-` 与 `_` **不做互换**（`device_codename` 既有取值域是 `[a-z0-9_]`，互换会让 `foo-bar` 与 `foo_bar` 误判相同）。比较沿用现有 `identityComparableForm`（仅小写化）。
4. 全部级都无命中 → `codename = null`。
5. **不允许**用 F/G 的值填 `codename`，也不允许用「多数票」反推（两条弱证据不等于一条强证据）。

为什么 maps 优先：`maps` 反映的是**本进程实际加载的镜像资源**，不可被目录改名伪造；目录扫描是文件系统事实，但可被 Magisk 模块单独替换一个文件。冲突时以「实际加载」为准更接近「运行中的镜像」。

### 3.4 证据串格式

固定通道顺序，` / ` 分隔，`:` 连接通道名与值，**无命中的通道直接省略**：

```text
rro:<codename> / idmap:<codename> / vendor_dir:<codename> / product_dir:<codename>
  / system_ext_dir:<codename> / odm_dir:<codename> / sku:<sku> / soc:<soc>
  / conflict:<a>=<x>!=<b>=<y>
```

通道值三态：

| 写法 | 含义 |
| --- | --- |
| `<channel>:<value>` | 该通道命中（值已归一化） |
| `<channel>:unknown` | 通道可读但无匹配（例如目录存在、里面没有 `__<p>_user__` 文件） |
| `<channel>:denied` | 通道存在但读取被拒（errno 13） |

不存在（ENOENT）的通道**整个省略**，不写 `unknown`——避免把「这台机器没有该分区」说成「读了但没读到」。

本机真机验收串（字段集 25 已在 Pixel 6 实测，以此为准）：

```text
rro:oriole / vendor_dir:oriole / product_dir:oriole / sku:g9s9b,gb7n6,gr1yh / soc:gs101
```

（`idmap` 通道本机无独立命中，故省略；`system_ext_dir`、`odm_dir` 为 ENOENT，故省略。）

**与设计预测的偏差（已实测确认，属设计正确降级，不是 bug）。** 本节原先预测 `sku:gr1yh`，真机实际是 `sku:g9s9b,gb7n6,gr1yh`。原因是 `ro.boot.hardware.sku` **也**被改机层按 UID 改写：

| 观察者 | `ro.boot.hardware.sku` |
| --- | --- |
| `adb shell`（真机原值） | `GR1YH` |
| `run-as com.sigmark.app`（App 进程内） | `23078PND5G`（小米 SKU） |

App 侧声明 SKU 与三个 overlay 候选（`G9S9B`／`GB7N6`／`GR1YH`）**全都不匹配**，于是按设计退回「逗号并列全部候选」。因此：

- `sku:` 通道**只是旁证**，声明 SKU 被改写时退回并列形态，**不参与代号判定**（`codename` 仍由 `rro`／`vendor_dir`／`product_dir` 裁决）。
- 这条偏差本身是有价值的观察：**SKU 属性与 `device`／`model` 一样是 per-UID 改写的，只有 overlay 文件名是硬的。**

长度约束：整串 ≤ 200 字符（协议侧 `Value` 上限 512，留足余量）。

---

## 4. 数据结构建议

### 4.1 新增字段

| 键 | 组 | 标签 | 来源 | 值格式 | since |
| --- | --- | --- | --- | --- | --- |
| `environment.overlayEvidence` | environment | 系统 overlay 多路径证据 | `/proc/self/maps` + `/vendor|product|system_ext|odm/overlay` 目录名 | `channel:value` 列表，` / ` 分隔，≤200 字符 | 25 |

- `ValueKind = "enum_text"`，`Unit = "overlay_evidence"`，`Observer = "APP_PROC_MAPS+APP_DIR_LIST"`（与现有 `overlayDeviceCodename` 的 `APP_PROC_MAPS` 区分，表明多了一个观察面）。
- `Sensitivity = "operational_context"`（与 environment 组一致）。
- 状态语义见 §4.4。

### 4.2 与 `overlayDeviceCodename` 的关系

| 字段 | 角色 |
| --- | --- |
| `environment.overlayDeviceCodename` | **裁决结果**：一个代号，或 `null`。值域不变（`[a-z0-9_]{2,32}`，黑名单已排除）。 |
| `environment.overlayEvidence` | **证据明细**：每条路径命中了什么、哪条被拒、哪些互相冲突。 |

两者由**同一次** `maps` 读取 + 同一次目录扫描派生，禁止二次读 `/proc/self/maps`（该节点 2536 行，实测；重复读是纯浪费）。

### 4.3 为什么不直接改现有字段

1. **旧报告不可改写**：字段集 23 的报告已归档在 PostgreSQL（实测 `lan-samples.db` 里就有 fieldSet 23 的样本），`overlayDeviceCodename` 的值不可重算。若把它的抽取口径改宽，同一字段在旧报告里代表「AOSP 单路径」，在新报告里代表「多路径裁决」，语义漂移但字段名不变。
2. **`fieldSetVersion` 只标形状不标语义**：契约里 `fieldSetVersion` 决定「哪些键允许出现」，不记录「同一个键的算法变过」。语义变化必须靠**新键**承载，才能让下游按「有没有这个键」区分新旧口径。
3. **需要保留「被拒」与「冲突」这两个维度**：现有字段是单值，`null` 无法区分「没有 overlay」与「目录读不到」。把两者压进一个字段会让 `UNAVAILABLE` 与 `RESTRICTED` 的区分失真（违反 AGENTS.md 第 3 条「采集字段必须说明来源、单位与状态」）。
4. **后端第 4 条通道已在读 `overlayDeviceCodename`**（`hardware_facts.go:164`）：保持该字段「一个代号」的简单语义，后端不需要为新字段重写既有判定；新字段只用于**解释**冲突原因（可选增强）。

结论：**并存**。现有字段可以**在同一字段集里**把抽取范围从 A 级扩到 A→B→C→D→E（值域不变，旧值仍合法），但必须与 `overlayEvidence` 同版本发布，否则「为什么这次从 UNAVAILABLE 变成 AVAILABLE」无从解释。

### 4.4 状态语义

| 情形 | `overlayDeviceCodename` | `overlayEvidence` |
| --- | --- | --- |
| 任一级命中 | `AVAILABLE` + 代号 | `AVAILABLE` + 证据串 |
| 所有可读通道无命中 | `UNAVAILABLE / NOT_REPORTED` | `UNAVAILABLE / NOT_REPORTED` |
| `maps` 读取失败 | `RESTRICTED / ACCESS_DENIED` | `RESTRICTED / ACCESS_DENIED` |
| `maps` 可读但无命中，且 ≥1 个目录 `denied` | `UNAVAILABLE / NOT_REPORTED` | `RESTRICTED / ACCESS_DENIED`（证据不完整，不能断言「没有」） |

最后一行是本设计的关键：**「读不到」不等于「没有」**。`overlayEvidence` 在证据不完整时必须降级为 `RESTRICTED`，而 `overlayDeviceCodename` 保持既有语义（否则会改变字段集 23 的历史口径）。

---

## 5. 实现骨架（给下一个智能体）

### 5.1 Kotlin：`SecurityProbes.kt`

```kotlin
internal enum class OverlayDir(val path: String, val channel: String) {
    VENDOR("/vendor/overlay", "vendor_dir"),
    PRODUCT("/product/overlay", "product_dir"),
    SYSTEM_EXT("/system_ext/overlay", "system_ext_dir"),
    ODM("/odm/overlay", "odm_dir"),
}

// 三态：读到名字 / 不存在（ENOENT）/ 被拒（EACCES|EPERM）。
// 必须三态，否则 §3.4 里 "省略" 与 "denied" 无法区分。
internal sealed interface DirScan {
    data class Names(val names: List<String>) : DirScan
    data object Absent : DirScan
    data object Denied : DirScan
}

internal data class OverlayReading(
    val codename: String?,          // 裁决结果
    val evidence: String?,          // 证据串；null = 完全无证据
    val conflicts: List<String>,    // 形如 "rro:oriole!=vendor_dir:corot"
    val denied: List<String>,       // 形如 "vendor_dir"
    val available: Boolean,         // 是否至少一条通道命中
)

internal fun overlayReading(
    maps: String?,
    directories: Map<OverlayDir, DirScan> = emptyMap(),
): OverlayReading
```

- `overlayDeviceCodename(maps: String?)` **保留原签名**（现有单测在用），实现改为 `overlayReading(maps, emptyMap()).codename`。它只跑 A/B 两级，仅用于兼容旧调用与纯 `maps` 测试；`securityEnvironment` 里改用 `overlayReading(maps, dirs)` 的结果，因此**生产路径跑完整 A–E 五级**。`maps == null` 仍返回 `null`。
- 现有单测 `overlayCodenameComesFromTheBakedRroFileName` 的三条断言必须继续通过：Pixel 6 三条 idmap → `oriole`；`null` → `null`；`custom-rro.apk@idmap` → `null`。

### 5.2 Kotlin：`SafeReader` 新增目录列举

现有 `SafeReader` 只有 `read/property/node/statMode`，**没有目录列举**。新增 `listNames`。**最终实现（1.21.2）先 `Os.stat` 再列举**，因为设计稿最初只写「`File.list()` 返回 null 时用 `statMode` 区分」，实测发现这样仍会把「无权限」和「不存在」混成同一个 `UNAVAILABLE`：

```kotlin
fun listNames(path: String, maxEntries: Int = 64): ReadResult<List<String>> =
    bounded(path, fileTimeoutMs) {
        // 先 stat：ENOENT/ENOTDIR → NODE_MISSING；成功但不是目录 → NODE_MISSING；
        // stat 可见但 list() 仍返回 null → 目录存在、列举被拒 → RESTRICTED/ACCESS_DENIED errno=13
        ...
    }
```

要求：

- **必须**用 `Os.stat(path)` 先判三态，而不是只看 `File.list()` 是否为 null：
  - stat 抛 ENOENT/ENOTDIR → `UNAVAILABLE / NODE_MISSING`（errno 有值）
  - stat 成功但不是目录 → `UNAVAILABLE / NODE_MISSING`，detail「该路径存在但不是目录。」
  - stat 成功但 `list()` 返回 null → **`RESTRICTED / ACCESS_DENIED`，errno=13**，detail「目录存在（stat 可见）但列出条目被拒绝，不能据此断言其中没有文件。」
  - 正常 → `AVAILABLE`
- 结果**排序**后 `take(maxEntries)`，保证同一设备多次采集稳定。
- 走 `bounded(...)`，与其它节点一致的超时保护。

**为什么这条改法重要（1.21.2 实测教训）**：设计稿最初只要求 `statMode` 兜底，实际实现里两者都落到 `UNAVAILABLE / NOT_REPORTED`，**被拒的目录被报成「目录不存在」**——这正是伪装检测最不能犯的错（把「读不到」当成「没有」）。仪器测试暴露后修正：`/data/resource-cache` 从 `UNAVAILABLE/NOT_REPORTED` 变为 `RESTRICTED/ACCESS_DENIED errno=13`，`SecurityProbes.scanOverlayDir` 相应简化为只看 `RESTRICTED`。这条路径现由 `SafeReaderInstrumentedTest`（22 条断言）覆盖。

### 5.3 Kotlin：接线（`SectionBuilder.securityEnvironment`）

在现有 `overlayDeviceCodename` 观测**之后**插入一条，复用同一次 `maps`：

```kotlin
val overlay = overlayReading(maps.value, overlayDirScans())

private fun overlayDirScans(): Map<OverlayDir, DirScan> =
    OverlayDir.entries.associateWith { dir ->
        val reading = SafeReader.listNames(dir.path)
        when {
            reading.value != null -> DirScan.Names(reading.value)
            reading.status == ValueStatus.RESTRICTED -> DirScan.Denied
            else -> DirScan.Absent
        }
    }
```

```kotlin
// 观测必须复用同一个 overlay 结果，禁止二次读 maps 或二次扫目录
observation("overlayDeviceCodename", "系统 overlay 记录的产品代号", overlayCodenameReading(overlay))
observation("overlayEvidence", "系统 overlay 多路径证据", overlayEvidenceReading(overlay))
```

- 顺序：`overlayDeviceCodename` 在前，`overlayEvidence` 紧随其后（便于 UI 与 fixture 对齐）。
- 注释要写明：目录扫描是「AOSP 命名被改名时的冗余」，不是新的身份判定依据。
- 说明（note，≤280 字符）建议：`依次尝试 maps 中的 framework RRO、其它 RRO idmap、vendor/product/system_ext/odm overlay 目录；任一路径命中即给出代号，冲突时以 maps 为准。sku/soc 只作旁证，不参与代号。`

### 5.4 Go：白名单与词典

```go
// protocol.go versionedParameters 追加
{"environment", "overlayEvidence", 25},

// protocol.go Report.valid() maxFields 阶梯追加
if p.FieldSetVersion >= 25 {
    maxFields = 259 // 235 fixed keys and up to 24 dynamic partition rows.
}

// protocol.go validAcceptanceValue（如 environment 组需要格式校验）
case "environment.overlayEvidence":
    return overlayEvidenceValid(value) // 形如 (rro|idmap|vendor_dir|product_dir|system_ext_dir|odm_dir|sku|soc|conflict):<token>
```

```go
// field_dictionary.go
const latestFieldSet = 25
const dictionaryVersion = "sigmark-lan-fields/16"

case "environment.overlayEvidence":
    f.ValueKind, f.Unit, f.Observer = "enum_text", "overlay_evidence", "APP_PROC_MAPS+APP_DIR_LIST"

var fieldUnits = map[string]string{ /* ... */ "environment.overlayEvidence": "overlay_evidence" }
```

- 后端 `hardware_facts.go` 第 4 条通道**保持读 `overlayDeviceCodename`**（值域不变，逻辑不动）。可选增强：当 `overlayEvidence` 含 `conflict:` 时，在 `hardware_declaration_conflict` 的说明里追加「overlay 内部路径互相矛盾」，但**不改变判定状态**。

---

## 6. 测试用例清单（Kotlin 单测）

全部为纯函数测试，不依赖 Android 运行时；输入为 `maps` 字符串与 `Map<OverlayDir, DirScan>`（未列出的目录默认 `Absent`）。

| # | 场景 | 输入 | 期望 |
| --- | --- | --- | --- |
| T1 | 只有 vendor overlay 目录命中 | `maps = ""`；`VENDOR = ["Settings__corot_user__auto_generated_rro_vendor.apk"]`；其它目录 `Absent` | `codename == "corot"`；`evidence` 含 `vendor_dir:corot`；不含 `rro:` |
| T2 | 只有 idmap 命中（per-target） | `maps` 一条：`.../product@overlay@Settings__corot_user__auto_generated_rro_product.apk@idmap`；目录全 `Absent` | `codename == "corot"`；`evidence` 含 `idmap:corot` |
| T3 | 多路径冲突 | `maps` 含 `framework-res__oriole_user__auto_generated_rro_product.apk`；`VENDOR = ["Settings__corot_user__auto_generated_rro_vendor.apk"]` | `codename == "oriole"`（maps 优先）；`evidence` 含 `conflict:rro:oriole!=vendor_dir:corot` |
| T4 | 全部命中一致（仅三条代号路径） | `maps` 只放 §1.2(b) 的三行（含 `YmRecentsGs101Overlay` 时另计 T8）；`VENDOR` 只放 §1.2(c) 的 11 个文件；`PRODUCT` 只放 §1.2(c) 中 `framework-res__oriole_user__auto_generated_rro_product.apk` 一行 | `codename == "oriole"`；`evidence == "rro:oriole / vendor_dir:oriole / product_dir:oriole"`；无 `conflict:` |
| T5 | 通用词陷阱 | `maps` 含 `framework-res__nosdcard__auto_generated_characteristics_rro.apk`；`PRODUCT = Names(listOf("framework-res__nosdcard__auto_generated_characteristics_rro.apk", "SettingsOverlayGR1YH.apk", "DeviceAsWebcamOriole.apk"))` | `codename == null`；`evidence` 含 `product_dir:unknown`；`sku:gr1yh`；不含 `oriole` |
| T6 | 空 maps + 目录全 `Absent`（ENOENT） | `maps = null` 或 `""`；所有目录 `Absent` | `codename == null`；`evidence == null`；`available == false` |
| T7 | 空 maps + 目录被拒 | `maps = ""`；`VENDOR = DirScan.Denied` | `codename == null`；`evidence` 含 `vendor_dir:denied`；`denied` 非空 → 上层给 `RESTRICTED` |
| T8 | SoC 旁证 | `maps` 含 `/product/overlay/YmRecentsGs101Overlay/YmRecentsGs101Overlay.apk` | `codename == null`；`evidence` 含 `soc:gs101` |
| T9 | SKU 旁证 | `PRODUCT = ["SettingsOverlayGB7N6.apk"]` | `codename == null`；`evidence` 含 `sku:gb7n6` |
| T10 | 大小写归一 | `VENDOR = ["Settings__ORIOLE_user__auto_generated_rro_vendor.apk"]` | `codename == "oriole"`（捕获后小写化） |
| T11 | 长度边界 | `framework-res__a__user__auto_generated_rro_product.apk`（1 字符）、`framework-res__<33 字符>_user__...` | 均 `codename == null` |
| T12 | 重复映射段去重 | `maps` 里同一条 idmap 出现 3 次 | `codename` 唯一；`evidence` 中该通道只出现一次 |
| T13 | 动态色 frro 不得误抽 | `maps` 含 `data@resource-cache@com.android.systemui-accent-MYFK.frro@idmap` | `codename == null`；不含 `idmap:` |
| T14 | 现有单测不回归 | 原 `overlayCodenameComesFromTheBakedRroFileName` 三断言 | 全部通过（`overlayDeviceCodename` 签名与行为不变） |
| T15 | 本机整串验收 | `maps` + 两个目录的**完整实测内容**（§1.2 (a)(b)(c) 原样） | `codename == "oriole"`；`evidence == "rro:oriole / vendor_dir:oriole / product_dir:oriole / sku:g9s9b,gb7n6,gr1yh / soc:gs101"`（与 §3.4 逐字一致）。注意 `sku:` 段是三候选并列，不是单个 `gr1yh`——声明 SKU 在 App 进程内被改写为 `23078PND5G`，与三个候选都不匹配，故按设计退回并列形态 |

Go 侧测试（`protocol_test.go`）：

| # | 场景 | 期望 |
| --- | --- | --- |
| G1 | `fieldSet=24` 的报告带 `environment.overlayEvidence` | 拒绝（`since=25`） |
| G2 | `fieldSet=25` 的报告带该键，值 `rro:oriole / vendor_dir:oriole` | 接受 |
| G3 | 值含非法通道名 `foo:bar` | 拒绝 |
| G4 | `fieldSet=25` 的报告 259 个参数（235 + 24 分区） | 接受；260 个拒绝 |
| G5 | 词典接口 | `latestFieldSet=25`、`dictionaryVersion=sigmark-lan-fields/16`、新键出现且 `since=25` |

---

## 7. 契约锁步清单

### 7.1 字段集该升到 25（不是 24）

**实测当前工作区状态**：

```text
app/src/main/java/com/sigmark/app/lan/LanReport.kt:19      internal const val LanFieldSetVersion = 24
app/src/test/resources/lan-projection-v24.txt              234 行（含 environment.overlayDeviceCodename）
backend/cmd/sigmark/field_dictionary.go:8-9                latestFieldSet = 24, dictionaryVersion = "sigmark-lan-fields/15"
backend/cmd/sigmark/protocol.go:527-529                    if p.FieldSetVersion >= 24 { maxFields = 258 }
```

字段集 **24 已被 Lead 并行实现的 `cpu.cpuCapacity` + `memory.cmaTotal` 占用**（`LanFieldSetVersion`、`lan-projection-v24.txt`、`latestFieldSet`、`maxFields` 四处都已落盘）。因此：

**建议字段集 25**，理由三条：

1. **24 已发布形状**：`lan-projection-v24.txt` 已存在且为 234 键；把 overlay 通道塞进 24 会让 v24 fixture、`maxFields`、`dictionaryVersion` 同时承载两条互不相关的通道，回滚任一条都得动同一个数字。
2. **同版本号不能有两种形状**：已安装的 24 APK 可能已经产出 234 键报告；中途改 24 会出现「同为 v24、键数不同」的两份形状，历史比对与 fixture 断言直接失效。
3. **归因清晰**：字段集是「一次发布一个形状」的原子契约。25 只新增 1 个键（234 → 235），`maxFields` 258 → 259，`dictionaryVersion` `sigmark-lan-fields/15` → `/16`，改动面最小且可回滚。

### 7.2 逐文件改动（落地时按此顺序）

**A. Android 采集与投影**

| # | 路径 | 改动 |
| --- | --- | --- |
| 1 | `app/src/main/java/com/sigmark/app/collector/SecurityProbes.kt` | 新增 `OverlayDir`、`OverlayReading`、`overlayReading(...)`、黑名单、5 条正则；`overlayDeviceCodename` 改为委托；`securityEnvironment` 增加 `overlayEvidence` 观测 |
| 2 | `app/src/main/java/com/sigmark/app/collector/SafeReader.kt` | 新增 `listNames(path, maxEntries)`（bounded + 排序 + errno 区分） |
| 3 | `app/src/main/java/com/sigmark/app/lan/LanDetails.kt` | `processEvidenceFields["environment"]` 增加 `"overlayEvidence"` |
| 4 | `app/src/main/java/com/sigmark/app/lan/LanReport.kt` | `LanFieldSetVersion = 25` |
| 5 | `app/src/main/java/com/sigmark/app/security/DevicePosture.kt` | `overlay_codename` 行：冲突时优先引用 `overlayEvidence` 的 `conflict:` 明细；说明文字补「多路径」 |
| 6 | `app/src/test/resources/lan-projection-v25.txt` | **新增**，235 行；按 `LanReportTest.projectionMatchesSharedLanRegistry` 的断言要求「去重 + `sorted()` 字典序」（`environment.overlayEvidence` 天然排在 `environment.overlayDeviceCodename` 之后，因为 `D` < `E`） |

**B. Android 测试**

| # | 路径 | 改动 |
| --- | --- | --- |
| 7 | `app/src/test/java/com/sigmark/app/collector/SecurityProbesTest.kt` | 新增 §6 T1–T13；保留 T14 |
| 8 | `app/src/test/java/com/sigmark/app/lan/LanReportTest.kt` | `assertEquals(23, ...)` → `25`；新增 `overlayEvidence` 投影断言 |
| 9 | `app/src/test/java/com/sigmark/app/security/DevicePostureTest.kt` | 冲突场景下 `overlay_codename` 的文案/状态断言 |
| 10 | `app/src/androidTest/java/com/sigmark/app/CapabilitySmoke.kt` | 真机冒烟里断言 `overlayEvidence` 非空且含 `rro:`（本机应含 `rro:oriole`） |

**C. Go 后端**

| # | 路径 | 改动 |
| --- | --- | --- |
| 11 | `backend/cmd/sigmark/protocol.go` | `versionedParameters` 加 `{environment, overlayEvidence, 25}`；`maxFields` 加 `>= 25 → 259`；`validAcceptanceValue` 加格式校验 |
| 12 | `backend/cmd/sigmark/field_dictionary.go` | `latestFieldSet = 25`；`dictionaryVersion = "sigmark-lan-fields/16"`；`ValueKind/Unit/Observer`；`fieldUnits` |
| 13 | `backend/cmd/sigmark/hardware_facts.go` | **可不改**（第 4 通道继续读 `overlayDeviceCodename`）；若要解释冲突，只追加说明文本，不改状态 |
| 14 | `backend/cmd/sigmark/protocol_test.go` | §6 G1–G5 |
| 15 | `backend/cmd/sigmark/hardware_facts_test.go` | 若动了说明文本才需要补；否则不动 |
| 16 | `backend/cmd/sigmark/field_dictionary_contract_test.go` | **关键防漂移测试，必须同时满足**：它按 `latestFieldSet` 拼出 `app/src/test/resources/lan-projection-v{latestFieldSet}.txt` 并与 `dictionary()` 的键集合逐一比对（`slices.Equal`）。因此 `latestFieldSet = 25` 之前，`lan-projection-v25.txt` 必须先存在且**键集合完全一致**（235 行、排序、去重）。另要求每个条目 `Temporal` 非空——新键无需登记 `dossierFieldKind`，默认返回 `configuration`，已满足；若要按「快照」呈现再补登记。 |

**D. 文档（Lead 负责，本文件不改）**

| # | 路径 | 备注 |
| --- | --- | --- |
| 17 | `docs/DEVICE-DISGUISE-SURFACE.md` | 已含 `overlayDeviceCodename`（第 66、73 行），需补 `overlayEvidence` |
| 18 | `docs/FRAMEWORK-DIAGNOSTICS.md` | 同上（第 155、163 行） |
| 19 | `docs/DEVICE-VALIDATION.md` / `docs/HANDOFF.md` / `docs/ROADMAP.md` / `README.md` | Lead 正在改，**本轮不碰** |

**E. 验收（实现后）**

```powershell
./gradlew.bat :app:assembleDebug :app:testDebugUnitTest
cd backend; go test ./...
# 真机：重装后采集一次，确认
#   environment.overlayDeviceCodename = oriole
#   environment.overlayEvidence = rro:oriole / vendor_dir:oriole / product_dir:oriole / sku:g9s9b,gb7n6,gr1yh / soc:gs101
#   报告 fieldSetVersion = 25，参数 235 个静态键
```

---

## 8. 本轮明确不做

1. **不改任何代码**：`SecurityProbes.kt`、`SafeReader.kt`、`LanDetails.kt`、`LanReport.kt`、`DevicePosture.kt`、`protocol.go`、`field_dictionary.go`、`hardware_facts.go` 全部保持原样。
2. **不改任何 fixture**：`lan-projection-v23.txt`、`lan-projection-v24.txt` 不动，不创建 `v25`。
3. **不跑测试**：不执行 `./gradlew.bat`、不执行 `go test`、不 `am instrument`。
4. **不安装、不上传、不修改设备**：本轮只用只读 `adb shell`（`ls`/`cat`/`getprop`/`dumpsys`）与 `adb exec-out ... cat` 到本机临时目录。
5. **不 git commit / push / 清理仓库**。
6. **不碰**：`docs/DEVICE-DISGUISE-SURFACE.md`、`docs/HANDOFF.md`、`docs/ROADMAP.md`、`docs/FRAMEWORK-DIAGNOSTICS.md`、`docs/DEVICE-VALIDATION.md`、`README.md`。
7. 只写本文件：`docs/OVERLAY-ROBUSTNESS.md`。

---

## 9. 风险与遗留

| 风险 | 说明 | 缓解 |
| --- | --- | --- |
| 目录权限收紧 | 本机 `/vendor/overlay` 是 `0755 root:shell`，可读；移植 ROM 可能改成 `0700` | 按「可能被拒」实现，`denied` 进证据串，`overlayEvidence` 降级 `RESTRICTED` |
| 全量改名 ROM 仍读不到 | 若 ROM 把 `__<product>_user__auto_generated_rro` 整套改名，A/B/C/D 全落空 | 这是**设计上接受**的结果：安全但失去信号；不要用 F/G 硬凑代号 |
| 冲突时以 maps 为准可能选错 | 极端情况下 maps 是旧缓存、目录才是新镜像 | 冲突写进 `overlayEvidence`，由人工复核；不自动「多数票」 |
| 目录扫描性能 | 4 个目录、每目录 ≤64 项，实测 `/product/overlay` 29 项 | 排序 + 上限 + `bounded` 超时 |
| 与字段集 24 的合并冲突 | 24 已落盘，25 会改同一批文件（`LanReport.kt`、`field_dictionary.go`、`protocol.go`） | 等 Lead 的 24 合入后再开 25；本文件只给清单，不动手 |
| 无法本机验证「改名 ROM」 | 不能刷机、不能改 overlay 文件 | 已在 §1.5 标注为推测；落地后用合成 fixture 覆盖（T1/T2/T3） |

**未验证项（留给实现者）**：

- 真实改名 ROM 上的 A→B→C→D 逐级降级行为（本机无此环境）。
- `/system_ext/overlay`、`/odm/overlay` 有实际内容的设备上的表现（本机一为 ENOENT、一为悬空软链）。
- 目录列举在 SELinux 更严格的 ROM 上是否仍返回 EACCES（本机 `run-as` 成功）。
