# 传感器与相机指纹级比对：技术评估

更新于 **2026-11-25（Asia/Shanghai）**。本文只回答一个问题：**传感器／相机的「指纹级比对」（不是计数）能不能成为一条可靠的、只依赖普通应用权限的硬件通道？**

样本与观察者：Pixel 6（`oriole`，Tensor `gs101`），序列号 `35241FDF6S1P3K`，Android 14 / API 34，已刷入改机层，声明为 Xiaomi `23078PND5G` / `corot` / Dimensity 9200+ `mt6985`。所有读数来自**同一台设备**的两个观察者：App 进程（`com.sigmark.app` 采集器）与 `adb shell`。本文不改任何代码，只做评估。

---

## 一、结论

| 问题 | 结论 | 一句话理由 |
| --- | --- | --- |
| 传感器指纹能否作为硬件通道 | **能，但要降级为「ROM/机型级指纹 + 与声明冲突检测」，不做单元级指纹** | 本机 App 侧 37 项与 shell 的 37 个硬件传感器**逐项一致**，全部 `AVAILABLE`，且仍报 Pixel 6 原厂器件（STMicro / MEMSIC / AMS / InvenSense / Google 私有类型），与「mt6985」声明直接冲突 |
| 相机指纹能否作为硬件通道 | **不能，明确不做** | 实测证明 App 侧相机通道已被改机层**完整接管**：App 看到的两个摄像头逐字段命中注入的 `ym` camera provider（`ym/42`、`ym/43`），真机内部 provider（`internal/0`、`internal/1`）在 App 侧完全不可见 |
| 原「37 vs 50 数量不可比」的判断 | **推翻** | 50 是**数错了**：`dumpsys sensorservice` 里共 50 行 `0x…` 句柄，其中 45 行是传感器列表、5 行是顶部活动连接行；45 = 37 个硬件传感器 + 8 个 AOSP 运行时融合传感器。真正的硬件总数 shell 自己写着 `Total 37 h/w sensors`，与 App 的 37 相等 |
| 原「相机 2 vs 4 是权限/RESTRICTED 差异」的判断 | **推翻** | 4 个公开摄像头来自**两个 HAL provider**（`internal` 2 路 + `ym` 2 路）。App 只看到 2 路，而且看到的是 **`ym` 的 2 路**，不是真机的 2 路 |

---

## 二、观察者与实测环境

| 项 | 值 |
| --- | --- |
| 设备 | `adb devices` → `35241FDF6S1P3K  device product:oriole model:Pixel_6 device:oriole` |
| App 侧证据 | `output/device-evidence-20261125/sigmark-local-snapshot.json`（90 679 B）、`output/device-evidence-20261125-118/sigmark-local-snapshot.json`（88 962 B） |
| App 侧采集器 | `app/src/main/java/com/sigmark/app/collector/DeviceCollectors.kt`（`SensorsCollector`）、`app/src/main/java/com/sigmark/app/collector/FrameworkCollectors.kt`（`MediaCollector`）、`app/src/main/java/com/sigmark/app/collector/HardwareObservations.kt` |
| shell 侧对照 | `adb shell dumpsys sensorservice`、`adb shell dumpsys media.camera`（**只作对照，不进报告**） |
| 本次只读命令 | 未安装 APK、未 `am instrument`、未上传、未改手机 |

**口径约定**：下文所有「App 侧」数字来自导出的快照 JSON，代表普通应用权限下的真实可读值；所有「shell 侧」数字来自 `dumpsys`，**只是对照观察者**，不能写进报告，也不能用来补齐 App 读数。

---

## 三、传感器：把 37 / 45 / 50 三个数字拆开

### 3.1 实测命令

```powershell
adb -s 35241FDF6S1P3K shell "dumpsys sensorservice" | Select-Object -First 120
```

### 3.2 原始输出片段

服务头部（shell 侧自己给出的总数）：

```
Sensor Device:
Total 37 h/w sensors, 37 running 0 disabled clients:
0x00000001) active-count = 1; sampling_period(ms) = {1.0}, selected = 1.00 ms; batching_period(ms) = {0.0}, selected = 0.00 ms
0x01010001) active-count = 1; sampling_period(ms) = {200.0}, selected = 200.00 ms; batching_period(ms) = {2000.0}, selected = 2000.00 ms
0x0101000e) active-count = 1; sampling_period(ms) = {1.0}, selected = 1.00 ms; batching_period(ms) = {0.0}, selected = 0.00 ms
0x01010014) active-count = 1; sampling_period(ms) = {66.7}, selected = 66.67 ms; batching_period(ms) = {0.0}, selected = 0.00 ms
0x01010024) active-count = 3; sampling_period(ms) = {250.0, 250.0, 200.0}, selected = 200.00 ms; batching_period(ms) = {0.0, 0.0, 0.0}, selected = 0.00 ms
Sensor List:
```

列表里的两段（前 37 行是硬件，后 8 行是 AOSP 运行时融合传感器）：

```
0x00000001) Dynamic Sensor Manager    | Google          | ver: 1 | type: android.sensor.dynamic_sensor_meta(32) | perm: n/a | flags: 0x00000007
0x01010001) LSM6DSR Accelerometer     | STMicro         | ver: 1 | type: android.sensor.accelerometer(1) | perm: n/a | flags: 0x000009c0
0x01010002) MMC56X3X Magnetometer     | MEMSIC          | ver: 1 | type: android.sensor.magnetic_field(2) | perm: n/a | flags: 0x00000880
0x01010005) TMD3719 Ambient Light     | AMS             | ver: 1 | type: android.sensor.light(5) | perm: n/a | flags: 0x00000002
0x01010006) ICP10101 Pressure Sensor  | InvenSense      | ver: 1 | type: android.sensor.pressure(6) | perm: n/a | flags: 0x00000000
0x01010016) LSM6DSR Temperature       | STMicro         | ver: 1 | type: com.google.sensor.gyro_temperature(65538) | perm: n/a | flags: 0x00000000
0x01010024) Auto Brightness           | Google          | ver: 1 | type: com.google.sensor.auto_brightness(131088) | perm: n/a | flags: 0x00000002
0x5f636779) Corrected Gyroscope Sensor | AOSP            | ver: 1 | type: android.sensor.gyroscope(4) | perm: n/a | flags: 0x00000000
0x5f676172) Game Rotation Vector Sensor | AOSP            | ver: 3 | type: android.sensor.game_rotation_vector(15) | perm: n/a | flags: 0x00000000
0x5f676273) Gyroscope Bias (debug)    | AOSP            | ver: 1 | type: android.sensor.accelerometer(1) | perm: n/a | flags: 0x00000000
0x5f67656f) GeoMag Rotation Vector Sensor | AOSP            | ver: 3 | type: android.sensor.geomagnetic_rotation_vector(20) | perm: n/a | flags: 0x00000000
0x5f677276) Gravity Sensor            | AOSP            | ver: 3 | type: android.sensor.gravity(9) | perm: n/a | flags: 0x00000000
0x5f6c696e) Linear Acceleration Sensor | AOSP            | ver: 3 | type: android.sensor.linear_acceleration(10) | perm: n/a | flags: 0x00000000
0x5f726f76) Rotation Vector Sensor    | AOSP            | ver: 3 | type: android.sensor.rotation_vector(11) | perm: n/a | flags: 0x00000000
0x5f797072) Orientation Sensor        | AOSP            | ver: 1 | type: android.sensor.orientation(3) | perm: n/a | flags: 0x00000000
```

计数脚本实测（用来确认「50」是怎么来的）：

```powershell
$s = adb -s 35241FDF6S1P3K shell "dumpsys sensorservice"
$idx = ($s | Select-String -Pattern '^Sensor List:').LineNumber     # → 9
($s | Select-String -Pattern '^0x[0-9a-f]{8}\)').Count               # → 50
($s[($idx)..($s.Count-1)] | Select-String -Pattern '^0x[0-9a-f]{8}\)').Count   # → 45
($s[0..($idx-2)] | Select-String -Pattern '^0x[0-9a-f]{8}\)').Count            # → 5
```

### 3.3 拆解

| 数字 | 含义 | 是否可比 |
| --- | --- | --- |
| 50 | `dumpsys sensorservice` 全文里 `0x…` 句柄行总数 | **错的口径**：45（列表）+ 5（顶部活动连接行）相加，连接行不是传感器 |
| 45 | `Sensor List:` 段的条目数 | 混了 8 个 AOSP 运行时融合传感器 |
| 37 | 头部 `Total 37 h/w sensors`；也是 App 侧 `sensors.count` | **这才是同一口径** |

App 侧快照（`output/device-evidence-20261125-118/sigmark-local-snapshot.json`，`sensors` 组，共 42 个条目 = 5 个汇总项 + 37 个 `sensor_0`…`sensor_36`）：

```
count | AVAILABLE | 37
reportingModes | AVAILABLE | 18/10/5/4/0
fifoCount | AVAILABLE | 31
directChannelTypes | AVAILABLE | hardware_buffer
typeWakeupSummary | AVAILABLE | 1:1/0 · 2:1/0 · … · 35:1/0 · 其他 15 项
sensor_0 | AVAILABLE | Google · android.sensor.dynamic_sensor_meta (32) · 版本 1 // 量程 1.0 · 分辨率 1.0 · 功耗 0.001 mA · 最小延迟 1000 µs
sensor_1 | AVAILABLE | STMicro · android.sensor.accelerometer (1) · 版本 1 // 量程 156.9064 · 分辨率 0.0047856453 · 功耗 0.001 mA · 最小延迟 5000 µs
sensor_2 | AVAILABLE | MEMSIC · android.sensor.magnetic_field (2) · 版本 1 // 量程 3198.1567 · 分辨率 0.0976 · 功耗 0.001 mA · 最小延迟 10000 µs
sensor_5 | AVAILABLE | AMS · android.sensor.light (5) · 版本 1 // 量程 1000000.0 · 分辨率 0.01 · 功耗 0.001 mA · 最小延迟 0 µs
sensor_22 | AVAILABLE | STMicro · com.google.sensor.gyro_temperature (65538) · 版本 1 // 量程 85.0 · 分辨率 0.00390625 · 功耗 0.001 mA · 最小延迟 19231 µs
sensor_36 | AVAILABLE | Google · com.google.sensor.auto_brightness (131088) · 版本 1 // 量程 1000000.0 · 分辨率 0.001 · 功耗 0.001 mA · 最小延迟 0 µs
```

（`sensor_N` 的 `label` 就是 `Sensor.getName()`，例如 `LSM6DSR Accelerometer`、`TMD3719 Ambient Light`、`Dynamic Sensor Manager`。）

### 3.4 由此得到的三个硬事实

1. **App 的 37 就是 shell 的 37 个硬件传感器**，一项不少：App 侧 37 条的名称、vendor、type、版本、量程、分辨率、功耗、最小延迟与 shell `Sensor List` 前 37 行逐条对应（含 `0x00000001` 的 Dynamic Sensor Manager 和 `0x01010024` 的 Auto Brightness）。
2. **本机 `SensorManager` 没有做类型过滤**：App 拿到了 `com.google.sensor.*` 私有类型（65538 / 65539 / 65541 / 65545 / 65548 / 131073 / 131077 / 131083 / 131085 / 131087 / 131088）。因此「SensorManager 只给公开类型」这个说法在本机**不成立**；它按 AOSP 语义返回 `TYPE_ALL`，厂商私有类型照样下发。
3. **本机没有任何 `RESTRICTED` 传感器条目**：`sensors` 组 42 项全部 `AVAILABLE`。`Step Detector` / `Step Counter` 虽然带 `perm: android.permission.ACTIVITY_RECOGNITION`，但它们仍出现在列表里（该权限只影响**注册监听**，不影响枚举）。真正被系统挡住的项是 `environment.selinux` 之类，与传感器无关。

### 3.5 那 8 个 AOSP 传感器为什么 App 看不到（推测，非实测）

`0x5f…` 是 AOSP `SensorService` 自带的运行时融合传感器（句柄前缀是 ASCII 片段，如 `_cgys`、`_garv`），用于在厂商 HAL 不提供融合结果时兜底。本机厂商 HAL 已经自带同名融合传感器（`Gravity Sensor`、`Rotation Vector Sensor` 等，vendor = Google），于是这 8 个 AOSP 条目只存在于服务端列表，不下发给应用。

- **实测依据**：App 侧 37 条里没有任何 `vendor = AOSP` 的条目；shell 列表里 8 条 AOSP 条目与 Google 的同类传感器**类型号重复**（例如 type 4、9、10、11、15、20 各出现两次）。
- **未验证**：没有在 AOSP 源码层确认「不下发」的具体过滤条件；也没有第二台非 Pixel 机型验证该行为是否普遍。**结论不依赖这条机制**——无论原因是什么，App 侧 37 与 shell 侧硬件 37 相等这一点已经由两侧原始输出直接证实。

### 3.6 稳定性（实测，样本数 2）

两份不同批次导出的快照（`device-evidence-20261125` 与 `device-evidence-20261125-118`）逐键比对：

```
=== sensors : A items=42 B items=42 ===
same-keys-diff-count: 0
=== media : A items=10 B items=10 ===
same-keys-diff-count: 0
```

两次采集之间 `sensors` 与 `media` 两组**零差异**（同一天、同 ROM、未重启传感器服务）。这是「短时间内稳定」的证据，**不是**「跨 ROM 升级稳定」的证据。

---

## 四、相机：2 vs 4 是两个 HAL provider，不是权限过滤

### 4.1 实测命令

```powershell
adb -s 35241FDF6S1P3K shell "dumpsys media.camera" | Select-Object -First 120
adb -s 35241FDF6S1P3K shell "dumpsys media.camera" | Select-String -Pattern 'Camera [0-9]+|Device [0-9]+|facing|orientation'
```

### 4.2 原始输出片段

服务头部：

```
== Service global info: ==

Number of camera devices: 4
Number of normal camera devices: 4
Number of public camera devices visible to API1: 4
    Device 0 maps to "0"
    Device 1 maps to "1"
    Device 2 maps to "42"
    Device 3 maps to "43"
Active Camera Clients:
[]
Allowed user IDs: 0
```

provider 段（**关键**：这里有两个 provider）：

```
== Camera Provider HAL android.hardware.camera.provider.ICameraProvider/internal/0-0 (v2.0, remote) static info: 2 devices: ==
== Camera HAL device device@1.1/internal/0 (v1.3) static information: ==
== Camera HAL device device@1.1/internal/1 (v1.3) static information: ==
== Camera Provider HAL android.hardware.camera.provider.ICameraProvider/ym/0-1 (v2.0, remote) static info: 2 devices: ==
== Camera HAL device device@1.1/ym/42 (v1.2) static information: ==
== Camera HAL device device@1.1/ym/43 (v1.2) static information: ==
```

四个设备的 API1 信息：

```
### device@1.1/internal/0
     API1 info:
       Has a flash unit: true
       Facing: Back
       Orientation: 90
### device@1.1/internal/1
     API1 info:
       Has a flash unit: false
       Facing: Front
       Orientation: 270
### device@1.1/ym/42
     API1 info:
       Has a flash unit: false
       Facing: Front
       Orientation: 270
### device@1.1/ym/43
     API1 info:
       Has a flash unit: false
       Facing: Back
       Orientation: 90
```

事件日志里还有一条旁证（`ym` 命名空间确实被策略单独管着）：

```
11-18 23:04:15 : REJECT device 43 client for package com.ym.cam.probe (PID 20018), reason: (Status(-8, EX_SERVICE_SPECIFIC): '6: connectHelper:2842: Camera "43" disabled by policy')
```

### 4.3 四个设备的静态特征（`dumpsys` 原始值）

| 特征 | `internal/0` | `internal/1` | `ym/42` | `ym/43` |
| --- | --- | --- | --- | --- |
| `LENS_FACING` | BACK | FRONT | FRONT | BACK |
| 闪光灯（API1） | true | false | false | false |
| `SENSOR_ORIENTATION` | 90 | 270 | 270 | 90 |
| `INFO_SUPPORTED_HARDWARE_LEVEL` | **FULL** | **FULL** | **LIMITED** | **LIMITED** |
| `SENSOR_INFO_ACTIVE_ARRAY_SIZE` | 0 0 **4080 3072** | 0 0 **3280 2464** | 0 0 **4032 3024** | 0 0 **4096 3072** |
| `SENSOR_INFO_PIXEL_ARRAY_SIZE` | 4080 3072 | 3280 2464 | 4032 3024 | 4096 3072 |
| `SENSOR_INFO_PHYSICAL_SIZE` (mm) | 9.7920 × 7.3728 | 3.6736 × 2.7597 | 5.6000 × 4.2000 | 9.8000 × 7.4000 |
| `LENS_INFO_AVAILABLE_FOCAL_LENGTHS` (mm) | 6.81 | 2.51 | 2.90 | 7.01 |
| `LENS_INFO_AVAILABLE_APERTURES` | 1.85 | 2.00 | 2.00 | 1.90 |
| `JPEG_MAX_SIZE` (B) | 18 800 640 | 12 122 880 | 18 813 440 | 19 398 656 |
| `SENSOR_INFO_SENSITIVITY_RANGE` | 44–11377 | 40–5099 | 50–3200 | 50–25600 |
| `REQUEST_AVAILABLE_CAPABILITIES` | BACKWARD_COMPATIBLE, MANUAL_SENSOR, READ_SENSOR_SETTINGS, MANUAL_POST_PROCESSING, BURST_CAPTURE, STREAM_USE_CASE, RAW, CONSTRAINED_HIGH_SPEED_VIDEO, **LOGICAL_MULTI_CAMERA** | BACKWARD_COMPATIBLE … RAW（7 项） | BACKWARD_COMPATIBLE, **RAW** | BACKWARD_COMPATIBLE, **RAW** |
| 元数据条目数 | 115 | 105 | 98 | 98 |

`internal/0` 还带 `Physical camera 2`（4080×3072，f/1.85，6.81 mm）与 `Physical camera 3`（4032×3016，f/2.20，2.35 mm），即真机后置是**逻辑多摄**。

### 4.4 App 侧看到的是什么（决定性对照）

App 侧快照 `media` 组：

```
cameraCount | AVAILABLE | 2
camera_0 | AVAILABLE | 后置 · 无闪光灯 · JPEG 4096×3072 px
camera_1 | AVAILABLE | 前置 · 无闪光灯 · JPEG 4032×3024 px
cameraCapabilitySummary | AVAILABLE | 前置/LIMITED ×1 · 后置/LIMITED ×1
cameraModes | AVAILABLE | raw
```

逐项对表：

| App 侧读数 | `ym/42` | `ym/43` | `internal/0` | `internal/1` |
| --- | --- | --- | --- | --- |
| 后置、无闪光灯、4096×3072 | — | **完全一致**（BACK、flash=false、activeArray 4096×3072） | 后置但 flash=true、4080×3072 | — |
| 前置、无闪光灯、4032×3024 | **完全一致**（FRONT、flash=false、4032×3024） | — | — | 前置但 3280×2464 |
| 硬件等级 LIMITED | LIMITED | LIMITED | **FULL** | **FULL** |
| 高级能力仅 `raw` | BACKWARD_COMPATIBLE+RAW | BACKWARD_COMPATIBLE+RAW | 含 LOGICAL_MULTI_CAMERA 等 9 项 | 7 项 |

**结论（实测）**：App 侧的两个摄像头就是注入 provider 的 `ym/42` 与 `ym/43`，四类特征（朝向、闪光灯、硬件等级、像素阵列/JPEG 上限）逐项命中，没有一项落在真机的 `internal/*` 上。真机后置的闪光灯、FULL 等级、LOGICAL_MULTI_CAMERA、9.79×7.37 mm 物理尺寸在 App 侧**全部不可见**。

### 4.5 「4 个公开设备里 App 只看到 2 个」的机制（未定，不影响结论）

两种候选，只读 shell 无法区分：

- **(a) 进程内 hook**：改机层在 App 进程里改写了 `CameraManager.getCameraIdList()` / `getCameraCharacteristics()`（本仓库已在 `Os.uname()` 上记录过同类进程级改写，见 [伪装面与盲区](DEVICE-DISGUISE-SURFACE.md)），把真机两路换成 `ym` 两路。
- **(b) 服务端按权限下发**：CameraService 对缺少 `CAMERA` 权限的应用不下发 `internal` 两路。实测本机 App **没有申请 `CAMERA` 权限**（`dumpsys package com.sigmark.app` 的 granted 列表里没有 `android.permission.CAMERA`，`cmd appops get com.sigmark.app CAMERA` → `No operations. Default mode: allow`）。

无论 (a) 还是 (b)，**结论不变**：App 侧相机读数是伪装值，不能当硬件证据。补充一点实测事实——`getCameraCharacteristics()` 在本机**没有 CAMERA 权限也能读到完整静态特性**（否则 App 侧不会有 `camera_0`/`camera_1` 的读数），所以「要不要 CAMERA 权限」不是这条通道的技术门槛。

### 4.6 相机侧的新发现，需要修正已有记录

[伪装面与盲区](DEVICE-DISGUISE-SURFACE.md) 第 6 节写的是「改机层通常只改型号字符串，不改服务注册表」。本机实测**推翻了这个假设的一半**：改机层**注入了一个完整的 camera HAL provider**（`android.hardware.camera.provider.ICameraProvider/ym/0-1`，v2.0，含 `device@1.1/ym/42`、`device@1.1/ym/43`），并且 App 侧看到的就是它。也就是说：**相机这条路已经被接管，传感器这条路目前还没被接管**。两件事不能共用一句结论。

（本文只做记录，不改 `DEVICE-DISGUISE-SURFACE.md`。）

---

## 五、现有字段清单

### 5.1 传感器（`sensors` 组，来源 `SensorManager`，普通应用权限）

| 键 | 含义 | 来源 | 单位 | 状态 |
| --- | --- | --- | --- | --- |
| `sensors.count` | 传感器条目数 | `SensorManager.getSensorList(TYPE_ALL)` | 个 | AVAILABLE |
| `sensors.reportingModes` | 上报模式分布 | `Sensor.getReportingMode` | 个（连续/变化/一次性/特殊/其他） | AVAILABLE |
| `sensors.fifoCount` | 支持 FIFO 的条目数 | `Sensor.getFifoMaxEventCount > 0` | 个 | AVAILABLE |
| `sensors.directChannelTypes` | 直通通道类型 | `Sensor.isDirectChannelTypeSupported` | 枚举 | AVAILABLE |
| `sensors.typeWakeupSummary` | 类型:公开数/可唤醒数 | `Sensor.getType` / `isWakeUpSensor` | 个 | AVAILABLE |
| `sensors.sensor_N`（label=名称） | 单个传感器 | `Sensor.getName/getVendor/getStringType/getType/getVersion` | — | AVAILABLE |
| ↳ 值内「量程」 | 最大量程 | `Sensor.getMaximumRange` | 依类型（m/s²、µT、hPa、lux…） | AVAILABLE |
| ↳ 值内「分辨率」 | 分辨率 | `Sensor.getResolution` | 同上 | AVAILABLE |
| ↳ 值内「功耗」 | 功耗 | `Sensor.getPower` | mA | AVAILABLE |
| ↳ 值内「最小延迟」 | 采样能力 | `Sensor.getMinDelay` | µs（`0` 可能表示按变化触发，`-1` 表示一次性） | AVAILABLE |

本机 `sensors` 组 42 项**全部 `AVAILABLE`，无 `RESTRICTED`**。注意：名称在 `label` 字段里（`Sensor.getName()`），不在 `value` 里；LAN 投影只带 `count`、`typeWakeupSummary`、`reportingModes`、`fifoCount`、`directChannelTypes`（见 `app/src/main/java/com/sigmark/app/lan/LanDetails.kt`），**37 条名称目前只存在于本机快照，没有进 LAN/后台**。

### 5.2 相机（`media` 组，来源 `CameraManager` / Camera2，普通应用权限）

| 键 | 含义 | 来源 | 单位 | 状态 |
| --- | --- | --- | --- | --- |
| `media.cameraCount` | 应用可见摄像头数 | `CameraManager.getCameraIdList().size` | 个 | AVAILABLE（本机 = 2，为 `ym` 两路） |
| `media.camera_N`（label=「摄像头 N」） | 朝向 | `LENS_FACING` | 枚举 | AVAILABLE |
| ↳ 值内「闪光灯」 | 闪光灯 | `FLASH_INFO_AVAILABLE` | 布尔 | AVAILABLE |
| ↳ 值内「JPEG」 | 最大 JPEG 输出 | `SCALER_STREAM_CONFIGURATION_MAP.getOutputSizes(JPEG).max` | px | AVAILABLE |
| `media.cameraCapabilitySummary` | 朝向/等级分组 | `LENS_FACING` + `INFO_SUPPORTED_HARDWARE_LEVEL` | 计数 | AVAILABLE |
| `media.cameraModes` | 高级能力 | `REQUEST_AVAILABLE_CAPABILITIES` | 枚举 | AVAILABLE |

本机 `media` 组 10 项**全部 `AVAILABLE`，无 `RESTRICTED`**。已采集但**没有**落库的字段：`SENSOR_INFO_PHYSICAL_SIZE`、`LENS_INFO_AVAILABLE_FOCAL_LENGTHS`、`SENSOR_INFO_PIXEL_ARRAY_SIZE`、`INFO_DEVICE_ID`、`getPhysicalCameraIds()`、相机 ID 本身。**相机 ID 没记录**，导致报告无法自证「看到的是哪两路」——这是现有实现的取证缺口。

---

## 六、候选指纹评估

评分口径：「App 能否拿到」= 普通权限下能否读到；「稳定」= 同机型同 ROM 多次采集是否恒定；「可伪造」= 改机层改写的难度（Java 层 hook 最容易，HAL 层最贵）；「区分度」= 跨机型/跨 ROM 能否分开（**不指望区分同型号不同个体**）。

### 6.1 传感器

| 候选指纹 | App 能否拿到 | 稳定 | 可被改机层伪造 | 跨机型区分度 | 评价 |
| --- | --- | --- | --- | --- | --- |
| `name` 字符串集合的哈希（37 条） | 能（`Sensor.getName()`，已采集） | 高：同 ROM 恒定；ROM 升级可能变 | **容易**：Java 层 hook `SensorManager` 即可 | **高**：本机全是 Pixel 6 器件名（`LSM6DSR`、`MMC56X3X`、`TMD3719`、`ICP10101`、`VD6282`），换机型几乎必然全变 | **首选**。机型/ROM 级强指纹 |
| `vendor` 字符串集合 | 能（`Sensor.getVendor()`，已采集） | 高 | 容易 | 高（STMicro/MEMSIC/AMS/InvenSense/Google 组合） | 与 name 哈希高度相关，单独用冗余；建议并入同一个哈希 |
| `type` 分布（含私有类型） | 能（已采集） | 高 | 容易 | **很高**：`com.google.sensor.*`（65538/65541/65545/131073/131088）是 Pixel HAL 专有；MediaTek 机型不会有 | 强特征。与 `typeWakeupSummary` 部分重叠，需补私有类型明细 |
| `maxDelay` / `minDelay` 组合 | 能（`minDelay` 已采集；`maxDelay` **未采集**） | 中：`minDelay` 由 HAL 上报，本机出现 `-1`（一次性）与 `0`（按变化）两种语义，需按类型解释 | 容易 | 中：同一颗芯片跨机型相同 | 只做辅助，不做主键；`maxDelay` 要新增采集 |
| `resolution × maximumRange` 数值对 | 能（都已采集） | **高**（float 常量，本机 0 差异） | 容易 | **高**：`156.9064 / 0.0047856453`（LSM6DSR）、`3198.1567 / 0.0976`（MMC56X3X）这类数字是器件+驱动的组合指纹，跨机型极难撞 | **次选但很好**。浮点位模式稳定，适合做数值哈希 |
| `reportingModes` + `fifoCount` + `directChannelTypes` | 能（已采集） | 高 | 容易 | 中（18/10/5/4/0、31、`hardware_buffer` 这类组合偏粗） | 只作汇总，区分度不足以单独成键 |

**传感器结论**：指纹应做成**一个复合哈希**——`sorted( name | vendor | type | resolution | maximumRange )` 的 SHA-256，加上「私有类型集合」与「器件 vendor 集合」两个可读摘要。不做逐条字段比对，避免 ROM 升级时全表飘红。

### 6.2 相机

| 候选指纹 | App 能否拿到 | 稳定 | 可被改机层伪造 | 跨机型区分度 | 评价 |
| --- | --- | --- | --- | --- | --- |
| `SENSOR_INFO_PHYSICAL_SIZE` | 能（无需 CAMERA 权限，本机已证明特性可读） | 高 | **已被伪造**（本机读到的是 `ym/43` 的 9.8×7.4 mm） | 高（真机值 9.7920×7.3728） | 理论好用，**本机读到的是假值** |
| `LENS_INFO_AVAILABLE_FOCAL_LENGTHS` | 能 | 高 | 已被伪造（7.01 mm vs 真机 6.81 mm） | 高 | 同上 |
| `SENSOR_INFO_PIXEL_ARRAY_SIZE` | 能 | 高 | 已被伪造（4096×3072 vs 真机 4080×3072） | 高 | 同上 |
| `INFO_DEVICE_ID`（API 29+） | 能（`CameraCharacteristics.INFO_DEVICE_ID`），但**本机 `dumpsys` 的 98/105/115 条目里未见该键**，未实测 | 未知 | 已被伪造 | 未知 | 不评估 |
| `getPhysicalCameraIds()` | 需逻辑多摄 + 权限行为未实测；本机 App 侧两路都不带 `LOGICAL_MULTI_CAMERA` | 未知 | 已被伪造（`ym` 无物理子摄） | 高 | 不做 |
| 相机 ID 列表本身（`"0","1"` vs `"42","43"`） | 能（`getCameraIdList()`） | 高 | 可伪造 | 中（ID 编号是厂商习惯，非硬件） | **不作为指纹**：ID 是命名约定，不是硬件事实；但**应记录**，用于取证自证 |

**相机结论**：所有候选字段在本机读到的都是 `ym` provider 的伪造值。把伪造值当硬件通道，等于用改机层自己的答案去判改机层——**逻辑上自我指认，必须放弃**。

### 6.3 权限与可见性前提（逐条核对）

| 前提 | 实测/文档结论 |
| --- | --- |
| `CameraManager.getCameraIdList()` 是否需要 `CAMERA` 权限 | 本机 App **没有** `CAMERA` 权限，仍拿到 2 个 ID 和完整静态特性 → 静态特性读取**不需要** CAMERA 权限；打开相机才需要 |
| API 30+ 包可见性（`<queries>`）是否影响 | **不影响**：包可见性约束的是 `PackageManager` 查询其他应用，`SensorManager`/`CameraManager` 是系统服务，不在 `<queries>` 管辖范围 |
| `SensorManager` 是否有类型过滤 | 本机**没有**：37 项含 11 个私有类型，`TYPE_ALL` 全量下发 |
| 传感器是否需要运行时权限 | 枚举不需要；`Step Counter`/`Step Detector` 带 `ACTIVITY_RECOGNITION` 只影响 `registerListener`，枚举照常 |
| 物理相机 ID 是否对普通应用可见 | 未实测；AOSP 文档说明「部分或全部物理相机可能不单独暴露给应用，此时物理相机 ID 不会出现在列表中」([RequestAvailableCapabilities](https://learn.microsoft.com/en-my/dotnet/api/android.hardware.camera2.requestavailablecapabilities?view=net-android-35.0))。本机 App 侧两路均无 `LOGICAL_MULTI_CAMERA`，说明连逻辑多摄能力都被伪造掉了 |

---

## 七、结论、成本与将来条件

### 7.1 传感器：做成（限定范围）

**做什么**：在 `sensors` 组新增**一个**派生字段 `sensors.hardwareFingerprint`（SHA-256 前 16 位十六进制）+ 一个可读摘要 `sensors.deviceVendors`（去重排序的 vendor 列表）。不新增 37 条明细的比对逻辑，不做逐字段冲突判定。

**为什么值得做**：本机实测这条通道**尚未被改写**——37 项全部是 Pixel 6 原厂器件，而声明链说自己是 `mt6985`。这是继 `/proc/cpuinfo`、`/proc/meminfo`、`/proc/self/maps` overlay 之后的**第四条不依赖声明链的通道**，且证据强度不低于它们（一个 Xiaomi/MediaTek ROM 不可能报出 `com.google.sensor.camera_vsync` 与 `VD6282 Rear Light Sensor`）。

**必须写明的局限**（否则会过度宣称）：

1. **机型/ROM 级，不是个体级**：同型号同 ROM 的所有机器指纹相同，不能识别单台设备。
2. **可被 Java 层 hook 伪造**，成本远低于改 HAL。本机没被改，不代表以后不会被改；一旦被改，App 无法自证（没有特权对照）。
3. **基线库依赖**：没有基线时只能报「本机指纹 = X」，不能报「与声明冲突」。冲突判定必须由后台按基线做，不能在端上猜。
4. **ROM 升级会变**：sensor HAL 更新会改 `name`/`resolution`，指纹随之变化，不能当「设备变了」。

**成本估算**：

| 项 | 数量/说明 |
| --- | --- |
| 改动文件 | **7 个**：`collector/DeviceCollectors.kt`（新增派生字段）、`collector/HardwareObservations.kt`（如复用现有 observation 通道）、`lan/LanDetails.kt`（投影）、`backend/cmd/sigmark/field_dictionary.go`（字段字典）、`backend/cmd/sigmark/field_dictionary_contract_test.go`、`backend/cmd/sigmark/portable_fields_test.go`、`backend/cmd/sigmark/device_dossier.go`（档案行）；外加 app 侧单测 `app/src/test/java/com/sigmark/app/collector/HardwareObservationsTest.kt` |
| 跨机型基线样本 | **≥ 3 个机型家族 × 每族 ≥ 2 个不同 ROM 构建 = ≥ 6 次采集**（用来区分「机型恒定」与「构建相关」）。本机 Pixel 6 已有 2 次同日样本，可作 1 个族；仍需小米/联发科一台、另一家一台 |
| 判定上线门槛 | 基线里同机型不同构建的指纹**必须一致**才允许把差异当冲突；否则字段只能作「观察值」，不进 `hardware_declaration_conflict` |
| 工作量 | 采集+字典+投影+测试约 1 人日；基线采集与阈值标定约 1–2 人日（取决于机型可得性） |

### 7.2 相机：不做

**理由（按强度排序）**：

1. **本机已证明被完整接管**：App 侧 2 路逐字段命中注入的 `ym/42`、`ym/43`，真机 `internal/0`、`internal/1` 完全不可见。任何相机指纹在本机都会稳定地报出**伪装值**，且伪装值稳定、可重复——这会制造「看起来很可靠」的假通道，比没有更危险。
2. **与仓库原则直接冲突**：把改机层伪造的 `4096×3072 / LIMITED / 无闪光灯` 写进报告并标成硬件证据，等于用特权层之外的另一个被篡改层当真相。原则要求「不以特权读数冒充 App 读数」，同理也不能以**被改写的 App 读数**冒充硬件事实。
3. **取证缺口**：现有实现连相机 ID 都没记录，无法自证看到的是哪一路，无法做任何「真机 vs 注入」的区分。

**将来什么条件下值得重做**（三条同时满足才重启评估）：

1. `dumpsys media.camera` 里**只剩** `internal` provider（即改机层不再注入 `ym` 这类 provider），或注入 provider 的设备数不再与 App 侧可见数重合；
2. 在普通权限下能读到 `getPhysicalCameraIds()` 与 `SENSOR_INFO_PHYSICAL_SIZE`，且**与 shell 侧真机 provider 的值一致**（即证明 App 侧确实读到了真机）；
3. 有 ≥ 3 机型基线证明这些字段**同机型跨构建恒定、跨机型可区分**，且相机 ID 已被记录进报告（补上当前缺口）。

### 7.3 不要做的事

- **不要**把 shell 的 45 / 50 个传感器写进报告，也不要写「App 少报了 13 个」。正确表述是「App 侧 37 项 = shell 侧 37 个硬件传感器；shell 列表另有 8 个 AOSP 运行时融合条目不下发给应用」。
- **不要**把 shell 的 4 个摄像头写进报告，也不要写「App 少报了 2 个」。正确表述是「本机存在两个 camera HAL provider，App 侧看到的是注入的 `ym` 两路」。
- 若引用 shell 数字，必须标注观察者为 `adb shell dumpsys`，并声明它**不进报告、不参与判定**。

---

## 八、复现命令（全部只读）

```powershell
# 0. 确认设备与观察者
adb devices -l

# 1. 传感器：三个口径分别数
adb -s 35241FDF6S1P3K shell "dumpsys sensorservice" | Select-Object -First 120
$s = adb -s 35241FDF6S1P3K shell "dumpsys sensorservice"
$idx = ($s | Select-String -Pattern '^Sensor List:').LineNumber
($s | Select-String -Pattern '^0x[0-9a-f]{8}\)').Count                                  # 50（含连接行，错口径）
($s[($idx)..($s.Count-1)] | Select-String -Pattern '^0x[0-9a-f]{8}\)').Count           # 45（含 AOSP 运行时条目）
($s | Select-String -Pattern '^Total').Line                                            # 37 h/w（正确口径）

# 2. 相机：先看 provider 拓扑，再看每台设备的 API1/静态特征
adb -s 35241FDF6S1P3K shell "dumpsys media.camera" | Select-Object -First 20
adb -s 35241FDF6S1P3K shell "dumpsys media.camera" | Select-String -Pattern 'Camera Provider HAL|Camera HAL device|API1 info|Facing:|Has a flash unit|Orientation:'

# 3. App 侧对照（已导出的真机证据，不需要再跑手机）
Get-ChildItem D:\SigMark\output -Recurse -Filter "sigmark-*.json" | Select-Object FullName,Length
$b = Get-Content 'D:\SigMark\output\device-evidence-20261125-118\sigmark-local-snapshot.json' -Raw | ConvertFrom-Json
($b.sections | Where-Object key -eq 'sensors').items | ForEach-Object { "$($_.key) | $($_.status) | $($_.label) | $($_.value)" }
($b.sections | Where-Object key -eq 'media').items   | ForEach-Object { "$($_.key) | $($_.status) | $($_.value)" }

# 4. App 是否持有 CAMERA 权限（解释 2 vs 4 的候选机制）
adb -s 35241FDF6S1P3K shell "dumpsys package com.sigmark.app" | Select-String -Pattern 'CAMERA'
adb -s 35241FDF6S1P3K shell "cmd appops get com.sigmark.app CAMERA"
```

---

## 九、遗留与不确定

1. **8 个 AOSP 运行时融合传感器为何不下发给应用**：只有现象（App 侧 37 条无 AOSP 条目、shell 列表有 8 条且类型号与 Google 条目重复），没有 AOSP 源码级确认。不影响结论。
2. **App 侧相机 2 路对应哪两个 ID**：现有实现不记录相机 ID，快照里查不到。机制上「进程内 hook」与「服务端按权限过滤」都能解释 2 vs 4，只读 shell 无法区分。**建议**（不在本次范围）后续把 `cameraId` 记进 `media` 组，成本 1 个文件。
3. **跨 ROM 升级的稳定性未测**：本机只有同一天两次采集（零差异）。传感器指纹在 sensor HAL 更新后是否变化，需要一次 ROM 升级或另一台同型号机器来验证。
4. **跨机型区分度只有推理，没有基线**：`com.google.sensor.*`、`VD6282 Rear Light Sensor` 这类名字对 Pixel 6 高度特化，但「小米/联发科机型一定不报这些」目前是推理，未采样本。
5. **`INFO_DEVICE_ID` 未实测**：本机 `dumpsys` 的相机元数据（98–115 条）里没有该键的直观条目，未做进一步确认。
