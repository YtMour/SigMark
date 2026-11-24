# 字段集 17 与安全比对规则（设计契约）

本文件固定字段集 17 的键、标签、值格式与校验规则，供 Android 采集、LAN 投影、Go 白名单和前端比对共同引用。它记录的是**已实现**的契约；实现版本、单元测试与真机待验证项见 [设备验证记录](DEVICE-VALIDATION.md)。

## 0. 目标

1. 把当前固定出现在报告里的 `RESTRICTED / ACCESS_DENIED` 与 `UNAVAILABLE / 暂无数据` 分成三类处理：
   - **可推断**：SELinux 实时模式（节点 EACCES 但 DAC 允许读 → 只可能被 MAC 拒绝）。
   - **有回退**：属性有多条公开读取路径（`Build.*` → `getprop ro.*`）、sysfs 有多候选节点（电池温度）。
   - **确实不可得**：保持原状态，只把说明写准（SELinux policy、能量计、调制解调器带宽）。
2. 增加一组公开 API / 固定节点可得的安全与环境线索，用于 Hook、注入、Root、分身、DRM 与 ROM 一致性比对。全部为**本应用进程自身**的观察，不读其他进程、不要求 root/ADB/Shizuku。
3. 优化指纹安全比对：按稳定度分组、区分「受限」「未归档」「变化」，并让 SELinux 的「直接读取／推断」不再被误判成变化。

## 1. 不改的边界

- 不新增运行时权限，不调用 `su`，不通过 ADB/Shizuku 取值。普通 App 被系统拒绝的读数仍记 `RESTRICTED`。
- 不把推断写成直接读数：推断值必须在值串里带「推断」，并在 `system.selinuxEvidence` 和说明里写明依据。
- 不上传新的个人标识：`Settings.Secure.ANDROID_ID` 的摘要只留在本机 JSON，不进入 LAN 投影。
- 既有键的含义、单位和状态语义不变；新增字段缺数据时用 `UNAVAILABLE` 或 `RESTRICTED` 加原因，不补造值。

## 2. 状态与原因沿用

`AVAILABLE / UNAVAILABLE / RESTRICTED / ERROR` 与既有原因码不变。本轮不新增原因码。

## 3. 已有字段的读取改进（不新增键）

| 键 | 改动 |
| --- | --- |
| `system.selinux` | 直接读到时值仍为 `Enforcing（强制模式）`／`Permissive（宽容模式）`。`open` 返回 EACCES 且 `stat` 证明 DAC 允许 other 读时，值为 `Enforcing（强制模式，推断）`；`/sys/fs/selinux` 不存在（ENOENT）时为 `未启用（推断）`。说明写清依据与「不是直接读数」。其他 errno 保持 `RESTRICTED / ACCESS_DENIED`。 |
| `system.selinuxPolicy` | 说明补充：AOSP 对普通应用固定拒绝 `selinuxfs` 打开，策略内容读取还需 `security:read_policy`；印迹内没有可授予的权限。状态不变。 |
| `system.bootloader` | 先读 `Build.BOOTLOADER`，为空时回退 `getprop ro.bootloader`；来源写两段。 |
| `system.baseOs` | 先读 `Build.VERSION.BASE_OS`，为空时回退 `getprop ro.build.version.base_os`。仍无值时保持 `UNAVAILABLE / OPTIONAL_UNSET`。 |
| `battery.sysBatteryTemp` | 依次尝试 `/sys/class/power_supply/battery/temp`、`/sys/class/power_supply/bms/temp`；来源为实际命中的路径。全部被拒时保持 `RESTRICTED`，说明补充公开温度（`battery.temperature`）是否已取得。 |
| `environment.storageEncryption` | `DevicePolicyManager` 无返回值时回退 `getprop ro.crypto.state`；此时值为 `已启用（系统属性声明）` 或 `系统报告未启用`，说明写清来源。 |
| `environment.verifiedBoot` 等启动属性 | 改为从一次属性快照读取；值格式不变。 |

## 4. 新增字段（字段集 17）

值格式中的「有序代码」表示：固定集合、固定顺序，用 ` / ` 连接；无命中时为 `none`。HTTP 白名单只校验文本长度与下列规则。

| 键 | 标签 | 来源 | AVAILABLE 值格式 | Go 校验 |
| --- | --- | --- | --- | --- |
| `environment.hookSignals` | Hook / 注入映射线索 | `/proc/self/maps` | `none` 或有序代码 `frida / gadget / xposed / substrate / riru / zygisk / lspatch / memfd_exec` | `orderedObservation`（顺序同上） |
| `environment.tracerPid` | 内核跟踪进程 PID | `/proc/self/status (TracerPid)` | `0` 或 1–4194304 的十进制，无前导零 | `compactIntRange(0, 4194304)` |
| `environment.rootMountHints` | 系统分区挂载线索 | `/proc/self/mountinfo` | `none` 或有序代码 `overlay_system / overlay_vendor / overlay_product / tmpfs_sbin / magisk_path` | `orderedObservation` |
| `environment.rootManagerVisible` | 可见的 Root 管理应用 | `PackageManager.queryIntentActivities(MAIN/LAUNCHER)` | `none` 或有序代码 `magisk / kernelsu / supersu / superuser / kingroot` | `orderedObservation` |
| `environment.userProfile` | 应用运行用户环境 | `Process.myUid / ApplicationInfo.dataDir` | `owner` / `secondary` / `managed` | `oneOf` |
| `environment.drmSecurityLevel` | 系统 DRM 密钥保护级别 | `MediaDrm(Widevine).securityLevel` | `L1` / `L2` / `L3` | `oneOf` |
| `environment.verityMode` | dm-verity 启动模式 | `getprop ro.boot.veritymode` | 小写标记，如 `enforcing` / `disabled` / `logging` | 正则 `^[a-z0-9_.-]{1,32}$` |
| `environment.buildDebuggable` | 系统可调试构建声明 | `getprop ro.debuggable` | `开启` / `关闭` | `oneOf` |
| `system.partitionBuildDates` | 分区构建日期 | `getprop ro.<partition>.build.date.utc` | `system 2024-01-05 · vendor 2023-12-11`，部分固定顺序 `system,vendor,product,odm,system_ext,bootimage` | `partitionDatesText` |
| `system.selinuxEvidence` | SELinux 读取依据 | `/sys/fs/selinux/enforce` | `exact` / `inferred_mac` / `inferred_disabled` | `oneOf` |
| `cpu.coresConfigured` | 内核配置的逻辑 CPU 数 | `Os.sysconf(_SC_NPROCESSORS_CONF)` | `1`–`1024` 十进制 | `compactIntRange(1, 1024)` |

### 4.1 采集口径

- `hookSignals`：只扫描本进程 `/proc/self/maps` 的文件路径段；`memfd_exec` 仅在同一行权限含 `x`、且 memfd 名称不属于运行时创建（jit、dalvik、vdex、oat、gralloc、hwui、ion、adf）时计入。真机首轮曾因 ART 的 JIT memfd 误报，排除后两台均为 `none`。说明必须写明「只代表本进程映射，不等于设备被注入」。
- `tracerPid`：`0` 表示无跟踪方；非零表示内核记录了跟踪进程（调试器、Profiler 或注入框架都可能）。它比 `Debug.isDebuggerConnected()` 更强，但仍不是攻击结论。
- `rootMountHints`：只识别 overlay 挂载到系统分区、`/sbin` 或 `/debug_ramdisk` 的 tmpfs、路径含 `.magisk` 的挂载。说明写明「自定义 ROM 也可能出现 overlay」。
- `rootManagerVisible`：只匹配固定包名列表，且依赖 Android 11+ 的包可见性，`none` **不等于**未安装。
- `userProfile`：`owner` = 用户 0；`secondary` = 其他用户 ID（双开/分身/多用户）；`managed` = 工作资料。三者都不是恶意结论。
- `drmSecurityLevel`：只读系统 DRM 插件声明的等级；`L3` 只表示软件级密钥保护，不等于模拟器。`MediaDrm` 打不开时记 `UNAVAILABLE / NOT_REPORTED`。
- `verityMode` / `buildDebuggable`：来自属性快照，属性未设置时为 `UNAVAILABLE / NOT_REPORTED`，不能写成「已关闭」。
- `partitionBuildDates`：属性缺失的分区不补行；全部缺失时 `UNAVAILABLE / NOT_REPORTED`。说明写明「属性缺失不代表分区不存在」。

### 4.2 本机专用字段（不进入 LAN 投影）

| 键 | 标签 | 值 |
| --- | --- | --- |
| `environment.androidIdSha256` | ANDROID_ID 摘要（仅本机） | `sha256` 后 64 位小写十六进制，或 `UNAVAILABLE / NOT_REPORTED` |

说明必须写明「保存摘要而非原值；不上传；用于同机多次采样比对」。

## 5. LAN 契约变更

- `LanFieldSetVersion = 17`；`latestFieldSet = 17`；`dictionaryVersion = sigmark-lan-fields/7`。
- 每份报告静态键上限：`fieldSet >= 17` 时 `maxFields = 242`（218 静态键 + 最多 24 个分区行）。
- 新增键全部写入 `app/src/test/resources/lan-projection-v17.txt`（排序、去重），由 Go 契约测试逐键比对。
- `battery.sysBatteryTemp` 的来源允许 `/sys/class/power_supply/battery/temp` 或 `/sys/class/power_supply/bms/temp`；字段词典与档案仍展示主路径。

## 6. 安全比对规则（`rom-evidence/3`）

### 6.1 检查项

| id | 标题 | 依据字段 | 状态判定 |
| --- | --- | --- | --- |
| `boot` | 启动链与锁定状态 | `environment.verifiedBoot` / `vbmetaState` / `flashLock` | 沿用 `bootEvidence` |
| `selinux` | SELinux 实时模式 | `system.selinux`、`system.selinuxEvidence`、`environment.selinuxDomain` | 前缀匹配 `Enforcing` / `Permissive`；值为推断时结论写「推断」 |
| `patch` | 安全补丁时效 | `system.patch` | 沿用 |
| `protection` | 锁屏与存储保护 | `keyguardSecure` / `storageEncryption` | 沿用 |
| `debug` | 构建与运行时 | `system.type`、`buildSignals`、`appDebuggable`、`debuggerConnected` | 沿用 |
| `identity` | 配置声明一致性 | `model` / `api` / `brand` / `device` | 沿用 |
| `hook` | 注入与 Hook 线索 | `hookSignals`、`rootMountHints`、`rootManagerVisible` | 任一非 `none` → `review`；全部为 `none` 且都有归档 → `observed`；否则 `unknown` |
| `trace` | 调试与跟踪 | `app.debuggerConnected`、`environment.tracerPid` | 调试器连接或 TracerPid>0 → `review`；两者都为否/0 → `observed`；否则 `unknown` |
| `profile` | 运行用户环境 | `environment.userProfile` | `owner` → `observed`；`secondary`/`managed` → `review`（写成「多用户或分身环境，需核对测试条件」） |
| `drm` | DRM 密钥保护 | `environment.drmSecurityLevel` | `L1` → `observed`；`L2`/`L3` → `context`；缺失 → `unknown` |
| `rom` | ROM 验证与构建声明 | `verityMode`、`buildDebuggable`、`partitionBuildDates`、`bootloader`、`baseOs` | `disabled`/`logging` 或可调试声明 → `review`；有归档 → `context`；否则 `unknown` |

### 6.2 对照结论

`compareSecurity` 的行增加 `category`（`boot` / `rom` / `runtime` / `protection` / `identity`）与扩展结论：

| 结论 | 条件 | 文案 |
| --- | --- | --- |
| `not_archived` | 一侧没有该键 | 一侧报告未归档该字段（旧字段集） |
| `restricted` | 任一侧 `status = RESTRICTED` | 一侧被系统拒绝读取，不判定变化 |
| `insufficient` | 其他非 `AVAILABLE` | 至少一侧无有效读数 |
| `unchanged` / `changed` / `review` / `expected` | 沿用 | 沿用 |

- SELinux 对照使用模式归一：`Enforcing` 与 `Enforcing（推断）` 模式相同，结论为 `context`，文案「模式一致，读取依据由推断变为直接读取（或相反）」。
- 新增对照字段：`hookSignals`、`tracerPid`、`rootMountHints`、`rootManagerVisible`、`userProfile`、`drmSecurityLevel`、`verityMode`、`buildDebuggable`、`partitionBuildDates`、`coresConfigured`、`selinuxEvidence`。
- 新增导出 `compareSummary(rows)`：返回 `{total, unchanged, changed, restricted, notArchived, insufficient, byCategory}`，供页面顶部汇总。

### 6.3 设备风险画像（Go）

- `profileVersion = sigmark-profile/2`。标签新增：`hook_injection`、`root_manager_visible`、`multi_open`、`rom_verification`、`software_drm`；`debugger_attached` 增加 `environment.tracerPid` 依据；`selinux_permissive` 改为前缀匹配。
- 每个标签新增 `historyRestricted`：历史样本中该标签任一依据字段为 `RESTRICTED` 的条数。受限不是命中，不进入 `historyHits`。

## 7. 验收

- `./gradlew.bat :app:assembleDebug :app:testDebugUnitTest`
- `cd backend && go build ./... && go test ./...`
- `cd backend/web && npm test && npm run build`
- 版本号升到 1.8.0 / versionCode 35。
