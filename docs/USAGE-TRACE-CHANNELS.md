# 使用真实性（usage）轴的采集通道设计

面向「设备安全打分」体系的第三轴：`usage` 使用真实性 25 分。本文只做设计输入，不改代码。
当前基线：分支 `main`，字段集 25（`latestFieldSet = 25`、`dictionaryVersion = "sigmark-lan-fields/16"`、
`LanFieldSetVersion = 25`、`maxFields = 259` = 235 个静态键 + 最多 24 条动态分区行）。

采集边界不变：**只用普通应用权限**。凡是需要 ADB shell、root、`su`、特权 SELinux 域才能读到的值，
一律不作为 App 可获得的值写进报告，也不在本设计里当成可用通道。四态（`AVAILABLE` / `UNAVAILABLE` /
`RESTRICTED` / `ERROR`）语义沿用 [架构与数据契约](ARCHITECTURE.md)。

---

## 0. 第一原则：「痕迹少」不等于「设备假」

usage 轴最容易犯的错误，是把「使用痕迹的数量」直接当成分数。这条路站不住，必须先排除。

**不能用数量评分的理由（三条，彼此独立）**

1. **合法的新设备就是没有痕迹。** 刚开箱、刚恢复出厂、刚刷完官方包的机器，`bootCount` 小、
   媒体库为空、没有第三方应用，但它是一台完全真实的设备。
2. **合法的「非日常使用」设备也没有痕迹。** 展柜机、产线测试机、企业统配机、评测样机、
   备用机、只跑单一业务的定制机，使用痕迹天然极少，且它们恰恰是 SigMark 最常被拿来测试的机器。
3. **数量信号没有可比较的基线。** 「照片只有 5 张」在不同人群里的正常区间相差几个数量级，
   没有同一台设备的纵向基线就无法判断异常。数量型指标只会把 usage 轴变成一个噪声源。

**唯一站得住的用法是矛盾检测（contradiction detection）**

usage 轴的判据不是「痕迹够不够多」，而是「这台设备自述的历史，和它能拿出的证据是否自相矛盾」。
两个读数各自都可能正常，但它们**不可能同时为真**时，才构成扣分项。

| 站得住 | 站不住 |
| --- | --- |
| 分区构建于 2021-10-28，但声明的补丁日期是 2026-08-01 → 补丁晚于包含它的镜像构建，物理上不可能 | 照片只有 5 张 → 扣分（可能只是新手机） |
| 声明 `first_api_level = 34`（Android 14 首发），但 system 分区构建于 2021 年 → 不可能 | 已装应用只有 12 个 → 扣分（可能只是极简用户） |
| 首次开机时间早于 system 镜像构建时间 → 不可能 | `bootCount = 2` → 扣分（可能只是刚恢复出厂） |
| 电池循环 800 次，但所有分区构建日期都在 90 天内，且 `bootCount = 3` → 硬件被长期使用过，镜像却是全新的 | 时区是 UTC → 扣分（可能是出差或出厂默认） |

**由此得到 usage 轴的四条硬规则**

- **R1 只做矛盾，不做计数。** 任何单一信号的「低值」不产生扣分，只有成对（或成组）读数互相冲突才产生扣分。
- **R2 矛盾要分级。** 物理上不可能的（时间倒序类）为 `PRIORITY`；统计上罕见的（重刷、重置类）为 `REVIEW`；
  证据不足或口径不可信的为 `UNKNOWN`，不扣分。分级沿用
  [DevicePosture.kt](../app/src/main/java/com/sigmark/app/security/DevicePosture.kt) 的 `Finding` 枚举。
- **R3 单轴扣分上限 12 分。** usage 轴满分 25，**所有规则合计最多扣 12 分**（下限 13）。
  这与现有实现里的 `usageFreshBootPoints = 12`（`backend/cmd/sigmark/score.go:89`）是同一个数：
  现有唯一一条规则一次就吃满上限。新增规则后应改为「取最高分的那一条，不叠加」，
  而不是让多条规则各自累加到 25——这一轴天生依赖弱通道与声明值，误报代价高于漏报代价。
- **R4 覆盖度要诚实。** 现有实现用 `decided / total` 记录本轴有多少证据真的读到了
  （`finalizeScoreAxis`，`score.go:635`），读不到时进 `undetermined` 并写明原因，
  缺证据**不**等于满分、也**不**等于扣分。新增规则必须把参与键登记进 `total`，
  否则覆盖率会虚高。

> 一句话：usage 轴不是「这台机器用过吗」，而是「这台机器说的历史和它拿得出的历史对得上吗」。

### 0.1 与现有实现的关系（先读这段再看后面）

usage 轴**已经有一版实现**，只是只有一条规则：

| 位置 | 内容 |
| --- | --- |
| `backend/cmd/sigmark/score.go:63-65` | 三轴权重 `declaration 40` / `behavior 35` / `usage 25` |
| `score.go:89` | `usageFreshBootPoints = 12` |
| `score.go:94` / `:96` | `usageAgedRomYear = 2021` / `usageFreshBootCeiling = 2` |
| `score.go:579-637` `usageAxis()` | 唯一规则 `FRESH_BOOT_ON_AGED_ROM`：`bootCount ≤ 2` 且分区最早构建年份 `≤ 2021` → 扣 12 分 |
| `score.go:602-618` | 覆盖度只登记 `system.bootCount` 与 `system.partitionBuildDates` 两个键 |

也就是说：本文档 C 部分的 10 条判定式里，第 1 条**已在线上**，其余 9 条是新增。
这条现有规则本身符合 R1（是矛盾不是计数），但它的误报风险被低估了——它把
「恢复出厂 / 刷机测试 / 展柜机 / `BOOT_COUNT` 未被 ROM 维护」四种合法情形都判成扣分，
且**没有用 `system.uptime` 做佐证**。本文档 3.2 给它的修正版加入了 `uptime < 3 天`
的限定并降级为 `REVIEW`，建议随字段集 26 一并调整。

---

## 1. 现有已采集的 usage 相关字段（A · 读代码确认）

以下全部来自本次逐文件核对，不是推测。`since` 为字段集版本，`状态` 为该字段在报告里的典型读取状态。

| 字段 key | 来源（代码实际读法） | 单位 / 口径 | 当前状态 | 备注 |
| --- | --- | --- | --- | --- |
| `system.bootCount` | `Settings.Global.getInt(BOOT_COUNT, -1)`，取值域 `0..1_000_000`（`SecurityObservations.kt:52`） | 次（`boot_count`） | 已采集，since 20 | 注释明确：每次冷启动递增，恢复出厂或清数据会重置；**不代表使用时长**，也不推断刷机 |
| `system.partitionBuildDates` | 依次 `getprop ro.{system,vendor,product,odm,system_ext,bootimage}.build.date.utc`，秒级时间戳转 UTC 日期（`SecurityObservations.kt:118-125`） | `partition_date_list`，格式 `system 2021-10-28 · vendor 2021-10-12 …` | 已采集，since 17 | 固定分区顺序，缺失不补行；属性缺失不代表分区不存在 |
| `system.partitionCount` | API ≥ 29 用 `Build.getFingerprintedPartitions()`；API < 29 回退同名 `ro.<part>.build.fingerprint` 属性（`SecurityObservations.kt:67-95`） | 个（分区数） | 已采集，since 7 | 最多记录前 24 个；`partition_<name>` 动态行另有 24 条上限 |
| `system.partition_<name>` | 同上，动态行，值 = 指纹 + UTC 构建时刻 | 文本 | 已采集，since 7 | 键名限 `[a-z0-9_]{1,32}` |
| `system.initialSdk` | `getprop ro.product.first_api_level`，取值域 `1..99`（`SecurityObservations.kt:43-49`） | `api_level` | 已采集，since 18 | 注释明确：低于当前 API 属正常升级，**只作世代对照，不据此判定真伪** |
| `system.buildTime` | `Build.TIME`（毫秒时间戳） | 时间戳 | 已采集（诊断组） | 即 system 镜像声明的构建时刻 |
| `system.uptime` | `SystemClock.elapsedRealtime()`，格式化为「N 天 N 小时 N 分钟」（`DeviceCollectors.kt:170-173`） | 分钟/天 | 已采集（legacy 组） | 含深度睡眠的本次开机时长；**没有**与 `bootCount` 做任何组合 |
| `system.patch` | `Build.VERSION.SECURITY_PATCH` | `YYYY-MM-DD` | 已采集（legacy 组） | 系统声明的补丁级别 |
| `system.vendorSpl` / `system.systemSpl` | `SecurityStateManager.getGlobalSecurityState`（API 35+），回退 `ro.vendor.build.security_patch` | `YYYY-MM-DD` | 已采集，since 7 | 厂商/系统组件声明补丁 |
| `battery.cycleCount` | `BatteryManager.EXTRA_CYCLE_COUNT`，**仅 API ≥ 34**，取值域 `0..99_999`（`DeviceCollectors.kt:389-395`） | 次（`cycles`） | 已采集，since 16 | API < 34 记 `UNAVAILABLE / INTERFACE_UNSUPPORTED`。是**充放电循环**，不是插拔次数 |
| `battery.chargeCounter` / `battery.energyCounter` | `BATTERY_PROPERTY_CHARGE_COUNTER` / `_ENERGY_COUNTER` | mAh / Wh | 已采集，since 16 | **瞬时剩余量，不是累计吞吐**；不能当使用量 |
| `environment.userProfile` | `Process.myUid() / 100000` + `UserManager.isManagedProfile`（API 30+）（`SecurityProbes.kt:366-379`） | `owner` / `secondary` / `managed` | 已采集，since 17 | 判双开/分身/工作资料；不是恶意结论 |
| `environment.androidIdSha256` | `Settings.Secure.ANDROID_ID` 的 SHA-256 摘要 | `sha256:<hex>` | **仅本机，永不投影** | `LanDetails.kt:73` 注释：`androidIdSha256 stays local and is never projected` |
| `environment.storageEncryption` | `DevicePolicyManager.storageEncryptionStatus` | 枚举文本 | 已采集，since 6 | 与 usage 弱相关（见 C7） |
| `environment.keyguardSecure` | `KeyguardManager.isDeviceSecure()` | 是/否 | 已采集，since 6 | 「用户设置过锁屏」是**弱**使用痕迹 |
| `display.fontScale` | `Configuration.fontScale` | 倍 | 已采集（legacy） | 唯一已归档的个性化项 |
| `memory.internalTotal` / `memory.internalAvailable` | `StatFs(Environment.getDataDirectory())` 的 total / available（`DeviceCollectors.kt:309-314`） | 字节（显示为 GiB） | 已采集（legacy） | **是文件系统口径，含系统镜像与所有应用数据**，不能直接当「用户数据量」 |
| `system.tags` | `Build.TAGS` | 文本 | 已采集（诊断组） | `release-keys` 与 SELinux 组合见 C5 |

**明确「现在没有」的（逐条核对过，不要当成已有）**

| 想找的 | 结论 |
| --- | --- |
| 设备首次设置时间 | **没有**。`ro.runtime.firstboot`、`Settings.Secure.USER_SETUP_COMPLETE` 均未采集 |
| 累计开机时长 / 历史总开机时间 | **没有**。只有本次 `elapsedRealtime`，且没有乘以 `bootCount` |
| 屏幕使用时间 / 亮屏时长 | **没有**，普通应用也拿不到（见 B5） |
| 媒体库数量与最早一条日期 | **没有**，且 App 当前**没有任何存储/媒体权限**（`AndroidManifest.xml` 只有网络、电话状态、位置、生物识别四类） |
| 已安装应用总数 | **没有**。只有 `environment.rootManagerVisible` 用固定包名表比对 `queryIntentActivities(MAIN/LAUNCHER)` |
| 电池设计容量 / 满充容量（老化） | **没有**。`SysfsField` 目前只有 `cpu.sysCpuPossible`、`cpu.sysCpuOnline`、`battery.sysBatteryTemp` 三项 |
| 已配对蓝牙 / 已保存 Wi-Fi | **没有** |
| 输入法列表 / 默认输入法 | **没有** |
| 时区 / 语言 / 亮度 / 无障碍 | **没有**（只有 `fontScale`） |

---

## 2. 普通应用权限下还能读到什么（B · 逐条可行性与代价）

判定口径：**API 区间** / **需要什么权限** / **能不能读到** / **读到的代价（隐私足迹）** / **能与什么构成矛盾**。
凡本仓库代码里没有实测证据的，标「未实测，需真机验证」。

### 2.1 应用生态：`getInstalledApplications()` / `getInstalledPackages()`

- **API 区间**：全版本可调用；但 **API 30（Android 11）起受包可见性（package visibility）过滤**。
- **需要什么权限**：不需要运行时权限。API 30+ 的可见性由 `AndroidManifest.xml` 的 `<queries>` 决定；
  `QUERY_ALL_PACKAGES` 是「所有应用可见」的特殊声明，属于 Google Play 限制的敏感权限。
- **能不能读到**：**能读到，但口径是「对我可见的包」，不是「已安装的包」。**
  本仓库现有 `<queries>` 只声明了 `MAIN` + `LAUNCHER` 一个 intent（见 `AndroidManifest.xml`），
  因此 `queryIntentActivities(MAIN/LAUNCHER)` 返回的是**带启动器入口的应用集合**——
  这恰好接近「用户能点开的应用」，是本项目零新增权限就能拿到的口径。
  `getInstalledApplications()` 在同一可见性规则下只会返回这个集合的超集（加上通过其他 `<queries>` 交互过的包）。
- **口径失真后还有意义吗**：**有，但只能单向使用。**
  它是**下界**：`count ≤ 真实已安装数`。所以只能用于「这么老的镜像，可见启动器应用却只有 3 个」
  这种**下界也低得异常**的方向，不能用于「应用很多所以真实」。
  另外它天然排除：无启动器图标的系统组件、被禁用的应用、工作资料内的应用、被 launcher 隐藏的应用。
  当前 App 自己 + `Settings` + 桌面启动器几乎必然可见，所以**理论最小值不是 0 而是约 3–5**，
  判定阈值必须按「≤ 5」而不是「= 0」写，否则永远不触发。
- **代价**：**极低**。只取计数，不取包名、不取权限、不上传任何应用标识；这是本项目最隐私友好的生态信号。
- **能与什么构成矛盾**：分区构建日期 / `initialSdk` / 首次开机时间（见 C2）。
- **建议**：采**计数**（`system.launcherAppCount`），不采包名列表，不申请 `QUERY_ALL_PACKAGES`。

### 2.2 媒体：`MediaStore` 的图片/视频/音频数量与最早一条日期

- **API 区间**：`MediaStore` 全版本可用；分区存储（scoped storage）自 **API 29** 起强制。
- **需要什么权限**：**API 33+** `READ_MEDIA_IMAGES` / `READ_MEDIA_VIDEO` / `READ_MEDIA_AUDIO`；
  **API ≤ 32** `READ_EXTERNAL_STORAGE`。本仓库 `AndroidManifest.xml` **当前一个都没有声明**。
- **能不能读到**：**没有权限时能调用，但只看得到「本应用自己创建的」媒体条目**——对一个刚装上、
  从不拍照的检测工具来说，结果**恒为 0**。
- **这是本设计里最危险的一个陷阱**：如果按现状直接查 `MediaStore` 并把它当「用户媒体数」，
  会得到一个**恒为零的假干净读数**，然后被 C2 规则当成「无用户痕迹」的证据。
  这正好违反 `SafeReader.listNames()` 注释里写下的原则：**「把拒绝读成『这里没有』正是伪装检测最不能犯的错」**。
  因此**要么加权限，要么不采，绝不能在无权限时采**。
- **代价**：**高**。`READ_MEDIA_IMAGES` 是全库媒体读权限，隐私足迹远大于本工具其他所有字段之和；
  而且「最早一条照片日期」本身就是强个人时间线信息。
- **能与什么构成矛盾**：分区构建日期（老镜像 + 零媒体）；但见上，无权限版本无效。
- **建议**：**不采**（理由见 D2）。若将来做「用户主动授权的媒体画像」独立实验页，必须是显式授权 + 仅本机 + 不上传。

### 2.3 通信录 / 通话记录 / 短信

- **API 区间**：全版本；`READ_CALL_LOG`、`READ_SMS` 自 Android 10 起与「默认电话/短信应用」角色强绑定。
- **需要什么权限**：`READ_CONTACTS` / `READ_CALL_LOG` / `READ_SMS`，三者都是运行时权限；
  后两者在 Google Play 属硬限制权限，且非默认应用时系统会直接拒绝或返回空。
- **能不能读到**：技术上 `READ_CONTACTS` 授权后可读；`READ_CALL_LOG` / `READ_SMS` 在非默认应用角色下
  **很可能记 `RESTRICTED` 或返回空**（未实测，需真机验证）。
- **代价**：**极高**。这三项是本仓库目前刻意完全没碰的个人数据类别，与「本地采集、无后台上传、
  普通权限优先」的定位直接冲突。为了一个弱 usage 信号引入通信录读权限，性价比是负的。
- **能与什么构成矛盾**：几乎没有独占价值——`READ_CONTACTS` 非空只能说明「有联系人」，
  而联系人可以从云端秒同步，矛盾强度低于分区日期类信号。
- **建议**：**不采**。这是本文档里最明确的一条否决。

### 2.4 电池：循环次数与老化

- **API 区间**：`BatteryManager.EXTRA_CYCLE_COUNT` 为 **API 34** 新增（见
  [BatteryManager.ExtraCycleCount](https://learn.microsoft.com/zh-hk/dotnet/api/android.os.batterymanager.extracyclecount?view=net-android-34.0)）。
  **本仓库已经采了**（`battery.cycleCount`，since 16）。
- **API 34 之前有没有替代**：公开 API **没有**等价物。`BATTERY_PROPERTY_CHARGE_COUNTER` /
  `_ENERGY_COUNTER` 是**瞬时剩余量**，不是累计吞吐，不能当循环数用。
  可选替代是 sysfs 节点：`/sys/class/power_supply/battery/cycle_count`（部分机型存在且 0444 可读），
  以及更有价值的 **`charge_full` / `charge_full_design`**（满充容量与设计容量，可算电池健康度）。
  这两类节点在 App 域能否读到**取决于 SELinux 策略**，**未实测，需真机验证**；
  可参考本仓库 `battery.sysBatteryTemp` 的既有结论——同样的 `/sys/class/power_supply/battery/` 目录，
  `temp` 在部分机型可读、部分记 `RESTRICTED`（`SysfsReadings.kt:32-33`、`DeviceCollectors.kt:425-428`）。
- **代价**：**低**。循环数/容量比是机型级硬件读数，不含用户行为细节。
- **能与什么构成矛盾**：分区构建日期（C7）。**这是 usage 轴上唯一的硬件级、刷机不重置的计数器**，
  价值最高，见 D1。
- **建议**：采。API 34+ 沿用现有 `battery.cycleCount`；另加 sysfs 满充/设计容量两个字段（未实测可读性，
  失败必须是 `RESTRICTED`/`UNAVAILABLE`，**绝不能填 0**）。

### 2.5 系统使用统计：`UsageStatsManager`

- **API 区间**：`UsageStatsManager` 自 API 21；`queryEvents` / `queryUsageStats` 全版本。
- **需要什么权限**：`android.permission.PACKAGE_USAGE_STATS`，这是 **`signature|privileged|appop` 级别的特殊权限**，
  **不能通过运行时授权弹窗获得**；用户必须去「设置 → 特殊应用权限 → 使用情况访问」手动开启，
  应用只能通过 `Settings.ACTION_USAGE_ACCESS_SETTINGS` 引导。是否已授权要用 `AppOpsManager` 查询。
- **能不能读到**：**普通应用默认拿不到**。这与「只用普通应用权限」的定位不符——它要求用户跳出应用去系统设置里
  单独打开一个跨应用行为统计开关，隐私含义比运行时权限重得多。
- **代价**：**极高**。它给的是**逐应用的前台时长与启动时间线**，是本文档讨论的所有通道里隐私足迹最大的一项，
  远超媒体库。
- **能与什么构成矛盾**：理论上能给出最强的「真实使用」证据（真实用户每天有前台时长），
  但代价与项目定位冲突。
- **建议**：**不采**，且**不要**为了 usage 轴去引导用户开启使用情况访问。

### 2.6 账户：`AccountManager.getAccounts()`

- **API 区间**：全版本可调用；**账户可见性自 API 26（Android 8.0）起按 authenticator 声明收窄**。
- **需要什么权限**：`GET_ACCOUNTS`（API 26+ 对 targetSdk ≥ 26 的应用已不再保证可见全部账户）。
- **能不能读到**：**不确定，未实测，需真机验证。** 现代设备上第三方应用查询 `com.google` 账户
  很可能返回空数组（Google 侧收紧了账户可见性），把空数组当成「没有 Google 账户」是错误推断。
- **代价**：**中高**。账户类型本身接近账号标识，触碰 AGENTS.md 第 6 条「新增敏感标识」的红线。
- **能与什么构成矛盾**：与「声明是国行零售机」类判断可能有关，但证据强度低且误报高
  （无 Google 账户的国行机、企业管控机、纯本地用户都合法）。
- **建议**：**不采**。收益（弱）远低于隐私与误报成本。

### 2.7 键盘 / 输入法：`InputMethodManager`

- **API 区间**：`getInputMethodList()` / `getEnabledInputMethodList()` 自 API 11 起公开。
- **需要什么权限**：**不需要任何权限**，且**不受包可见性过滤**（输入法是系统级服务枚举）。
- **能不能读到**：**能**。`getEnabledInputMethodList()` 返回当前启用的输入法集合，
  `getInputMethodList()` 返回全部已安装输入法。默认输入法标识还可从 `Settings.Secure.DEFAULT_INPUT_METHOD` 读到
  （未实测，需真机验证该键在目标 ROM 上的可读性）。
- **代价**：**低**（只取计数或「是否非系统默认输入法」的布尔值），若取包名则升为中等（能推断用户族裔/地区习惯）。
- **能与什么构成矛盾**：「装了 3 个第三方输入法」是**正向**使用痕迹，但**不是矛盾信号**——
  它只能加证据、不能扣分。按 R1，**没有矛盾就用不上**。
  唯一勉强可用的方向：老镜像 + 输入法列表只有系统默认一项 + 其他个性化全默认 → 并入 C10（`REVIEW` 级，不扣分）。
- **建议**：**暂不采**。零成本但无矛盾可用，属于「看起来有用」的字段，进字段集会稀释契约。

### 2.8 Wi-Fi / 蓝牙历史

- **Wi-Fi**：`WifiManager.getConfiguredNetworks()` 自 **API 29 起废弃**，且**只返回调用方自己创建的配置**，
  对第三方应用基本恒为空；读 SSID 另需 `ACCESS_FINE_LOCATION` 且系统定位开关必须打开。
  **结论：口径已死，不采。**（参见 [WifiManager.ConfiguredNetworks](https://learn.microsoft.com/zh-cn/dotnet/api/android.net.wifi.wifimanager.configurednetworks?view=net-android-36.0)）
- **蓝牙**：`BluetoothAdapter.getBondedDevices()` 自 **API 31 起需要 `BLUETOOTH_CONNECT`**（运行时权限，
  Nearby devices 组）；API ≤ 30 需要 `BLUETOOTH`（安装期权限）。本仓库当前**没有声明任何蓝牙权限**。
  授权后可读**已配对设备集合**，只取计数不需要位置权限。
- **能不能读到**：蓝牙**能**（需新增运行时权限）；Wi-Fi **基本不能**。
- **代价**：蓝牙计数为**低**（不含设备名/地址）；若要设备名则为**中高**（可能含车机、手环等可识别硬件）。
- **能与什么构成矛盾**：「配对过 4 台设备」是正向痕迹，同 2.7，**不构成矛盾**，按 R1 不产生扣分。
  唯一可用的方向是老镜像 + 零配对 → 并入 C10 的弱规则。
- **建议**：**不采**。为正向痕迹新增一个运行时权限，收益不足以支撑权限面扩大。

### 2.9 `/data` 与存储画像

- **已有**：`StatFs(Environment.getDataDirectory())` 的 total / available 已在采
  （`memory.internalTotal` / `memory.internalAvailable`），另有 `systemSpace`、`appCacheSpace`。
- **能不能再进一步**：**不能**。App 无法列 `/data` 下其他应用的目录（`/data/data/<pkg>` 各自由 uid 隔离，
  `/data/media/0` 属 media_rw）。本仓库的 `SafeReader.listNames()` 只能列 App 自己能访问的路径，
  且它已经把「stat 成功但 list 返回 null」正确记为 `RESTRICTED`——**不要**用它去列 `/data` 然后
  把 `RESTRICTED` 当「没文件」。
- **口径失真问题**：`internalTotal - internalAvailable` = **系统镜像 + 所有应用 + 用户数据 + 缓存**，
  全新机的 `/data` 占用就有十几 GB。所以它**不能**当「用户数据量」，只能当「这台机器的存储被填到什么程度」，
  且必须配合 `internalTotal` 归一化。用它做矛盾检测的判别力**很低**。
- **代价**：**零**（已采）。
- **建议**：**不新增字段**；若要用，只能作为 C10 的辅助项，且必须写成 `REVIEW`。

### 2.10 时区 / 语言 / 字体缩放 / 无障碍

- **API 区间**：全版本。
- **需要什么权限**：**不需要**。`TimeZone.getDefault().getID()`、`Locale.getDefault()`（或 `LocaleList.getDefault()`）、
  `Configuration.fontScale`（已采）、`Settings.System.SCREEN_BRIGHTNESS` / `SCREEN_OFF_TIMEOUT`、
  `Settings.Global.AUTO_TIME` / `AUTO_TIME_ZONE` 的**读取**通常不需要权限
  （写入才需要 `WRITE_SETTINGS`）。`Settings.Secure.ACCESSIBILITY_ENABLED` 的可读性**未实测**。
- **能不能读到**：时区、语言、`fontScale` **确定能**；亮度/超时/自动时间**很可能能**（未实测，需真机验证）。
- **代价**：**极低**。时区与语言是粗粒度、非唯一、非行为级的配置；比媒体库/使用统计低两个数量级。
- **能不能构成矛盾**：**它们是「一致性」证据，不是「数量」证据**。
  一台用了三年的手机，语言/时区/字体缩放/亮度**全部停在出厂默认**，是弱异常；
  但展柜机、企业统配机、测试机合法地就是这样，**误报率高**。
  更稳的用法是**互相一致性**：时区与语言、时区与 `AUTO_TIME_ZONE` 开关、`fontScale` 与分辨率
  之间出现自相矛盾的组合（例如 `AUTO_TIME_ZONE=1` 但时区不是该地区的标准时区）。
- **建议**：**只采极少数、且只用于一致性**：`system.timeZoneId`（`Area/City` 枚举码，不采原始偏移历史）、
  `system.localeTag`（语言 + 地区，不采完整 `LocaleList`）。亮度/超时**不建议**（信噪比太低）。
  这两项属于 `SENSITIVITY = operational_context` 一类，不进任何唯一标识。

### 2.11 系统更新历史：`ro.build.date` 与 `Build.VERSION.SECURITY_PATCH` 的关系

- **已有素材**：`system.partitionBuildDates`（六个分区的 UTC 构建日期）、`system.buildTime`（`Build.TIME`）、
  `system.patch`、`system.systemSpl`、`system.vendorSpl`。
- **多分区构建日期不一致说明什么**：
  1. **正常 OTA**：`system` / `product` / `system_ext` 新，`vendor` / `odm` 可能停留在旧版本（厂商常混用旧 vendor）。
     → **单方向**差异（vendor 旧于 system）是**正常**的，不能判为矛盾。
  2. **整机重刷**：六个分区日期几乎同一时刻 → 全套镜像被替换过。
  3. **拼装镜像**：分区日期**跨度以年计且双向混乱**（vendor 比 system 新、`bootimage` 早于 `system` 很久）
     → 移植 ROM / 改机包的典型特征。
- **补丁与构建的硬约束**：**声明的补丁日期不可能晚于包含它的镜像构建日期**（补丁是构建输入）。
  这是本文档里**唯一一条物理上不可能、几乎不可能误报**的约束，见 C4。
- **代价**：**零**（全部已采）。
- **建议**：**不新增字段**，把 C3 / C4 直接建在已有字段上。这是性价比最高的一组规则。

### 2.12 `/proc/uptime` 与 `bootCount` 的组合

- **现状**：本项目读的是 `SystemClock.elapsedRealtime()`（含深度睡眠），**不是** `/proc/uptime`
  （后者不含 suspend 时间，且属可读性不稳的节点）。两者都表示「本次开机以来」。
- **能推出「平均每次开机用了多久」吗**：**不能可靠推出。**
  - `elapsedRealtime()` 只给**本次**开机时长；
  - `bootCount` 给的是**自上次清 /data 以来**的冷启动次数；
  - 二者相除只能得到「本次开机时长 / 开机次数」这个**无意义比值**。
  - 真正的「平均每次开机时长」需要**累计开机总时长**，而 Android 对普通应用**不提供**该计数器。
    唯一接近的是电池的 `charge_counter` 累计吞吐，但本仓库采到的 `battery.chargeCounter` 是**瞬时剩余电荷**，
    不是累计值。
- **有没有判别力**：**几乎没有。** `bootCount` 小 + `uptime` 长是**完全正常**的（一台从不重启的手机），
  `bootCount` 大 + `uptime` 短也正常（频繁开关机的测试机）。**二者不构成矛盾**。
- **唯一可用的弱形式**：`bootCount == 0` 而设备**正在运行**（`system.uptime > 0`）→ 计数不可信
  （可能被改写或 ROM 未维护该设置项），见 C6。注意这只能推出「该字段不可信」，
  **不能**推出「设备是假的」，所以状态应为 `UNKNOWN`，不扣分。
- **建议**：**不新增字段**，也不要用它推导平均使用时长；把 C6 写成「信号可信度」检查。

---

## 3. 矛盾判定式（C · 本任务核心产出）

### 3.1 通用记法

- `D(x)`：把日期/时间戳解析为 UTC 日期；`AGE(x) = D(采样日) - D(x)`，单位天。
- `MAXBUILD`：`system.partitionBuildDates` 里所有日期的**最大值**；`MINBUILD` 为最小值；
  `SPAN = MAXBUILD - MINBUILD`。
- `SYSD`：`system` 分区构建日期（缺则回退 `system.buildTime` 的 UTC 日期）。
- 只有参与字段**全部 `AVAILABLE`** 时才求值；任一缺失 → `UNKNOWN`，不扣分（禁止用缺失值反推）。
- 分级：`PRIORITY` = 物理不可能；`REVIEW` = 统计罕见 / 需人工核对；`UNKNOWN` = 证据不足。
  仅 `PRIORITY` 扣分，单条 12 分（沿用 `usageFreshBootPoints`），**多条同时成立时取最高分、不叠加**，
  本轴上限 12 分（R3）；`REVIEW` 只提示不扣分。

### 3.2 矛盾表

| code | 参与的字段 | 判定式 | 说明什么 | 误报风险 | 建议分级 |
| --- | --- | --- | --- | --- | --- |
| `FRESH_BOOT_ON_AGED_ROM` | `system.partitionBuildDates`（SYSD）、`system.bootCount`、`system.uptime` | `AGE(SYSD) ≥ 365` 且 `bootCount ≤ 3` 且 `uptime < 3 天` | 一个一年以上的镜像只被冷启动过 ≤3 次，且本次开机很短：`/data` 最近被清空/重置过，设备此前的使用记录被抹掉 | **高**：恢复出厂、刷机测试、展柜机、`BOOT_COUNT` 不被 ROM 维护都会命中 | 现状 `PRIORITY` 扣 12 分；**建议先降为 `REVIEW`**，加 `uptime` 佐证后再升回 `PRIORITY` |
| `NO_USER_TRACES_ON_AGED_ROM` | `SYSD`、`system.launcherAppCount`（新增）、`display.fontScale`、`system.initialSdk` | `AGE(SYSD) ≥ 730` 且 `launcherAppCount ≤ 5` 且 `fontScale == 1.0` 且 `initialSdk` 对应的首发年份 ≤ `D(SYSD)` 的年份 | 声明用了两年的设备，可见启动器应用个位数、个性化全默认：像一台被「装配」出来只为跑检测的机器 | **中高**：展柜机、企业统配机、产线测试机、极简用户 | `REVIEW`（不扣分） |
| `PARTITION_DATE_INCONSISTENT` | `system.partitionBuildDates` 全部分区 | `SPAN > 400 天` **且** 存在 `vendor/odm/bootimage` 日期**晚于** `system` 日期，或 `bootimage` 早于 `system` 超过 400 天 | 同一台设备的镜像被拼装：分区来自不同年代的构建产物。正常 OTA 是**单方向**的（vendor 旧于 system） | **中**：厂商混用旧 vendor 真实存在；跨版本 OTA 后 vendor 也可能更旧。只有「双向混乱」才算矛盾 | `REVIEW` |
| `PATCH_AFTER_BUILD` | `system.patch`（或 `system.systemSpl`）、`MAXBUILD`、`system.buildTime` | `D(system.patch) > MAXBUILD + 7 天`，或 `D(system.patch) > D(Build.TIME) + 7 天` | **补丁日期晚于包含它的镜像构建日期**。补丁是构建输入，镜像不可能包含它自己构建完成之后才发布的补丁 → **物理不可能** | **低**：除非日期解析失败、或设备把 `SECURITY_PATCH` 写成了未来日期（这本身也是异常）。注意：`vendorSpl` 允许晚于 `system` 构建（vendor 单独 OTA），**不要把 vendorSpl 放进这条规则** | `PRIORITY`（扣分） |
| `PERMISSIVE_ON_RELEASE_BUILD` | `system.selinux`、`system.tags`、`environment.buildDebuggable`、`environment.verityMode` | `selinux` 以 `Permissive` 开头 且 `tags` 含 `release-keys` 且 `buildDebuggable == 关闭` | 发行签名 + 非调试构建 + 宽容 SELinux 三者通常不同时成立：出厂 `user` 版本应为 `Enforcing`。这是**组合矛盾**，比单看 SELinux 模式强 | **低–中**：部分厂商 `user` 版本曾短暂 `permissive`；`selinux` 读数本身可能来自属性推断而非实时节点（`system.selinuxEvidence` 为 `inferred_*` 时**必须跳过本规则**） | `PRIORITY`（扣分） |
| `INITIAL_SDK_NEWER_THAN_ROM` | `system.initialSdk`、`SYSD` | `RELEASE_DATE(initialSdk) > D(SYSD)`，其中 `RELEASE_DATE` 为对应 API 级别的 Android 首发日期（内置固定表） | 声明「出厂就是 Android 14」的设备，其 system 分区却构建于 Android 14 发布之前 → **物理不可能** | **低–中**：`ro.product.first_api_level` 是可被属性层改写的声明值；工程机/预发布镜像可能早于公开发布日。给 30 天宽限 | `PRIORITY`（扣分） |
| `CYCLE_COUNT_ON_FRESH_ROM` | `battery.cycleCount`、`MAXBUILD`、`MINBUILD`、`system.bootCount` | `cycleCount ≥ 300` 且 `AGE(MAXBUILD) ≤ 90` 且 `SPAN ≤ 30 天` 且 `bootCount ≤ 5` | 电池被充放 ≥300 次（硬件计数器，**刷机不重置**），但**全部**分区都在 90 天内构建且几乎同时 → 整机被重新刷写，硬件年龄远大于镜像年龄 | **中**：用户手动刷官方整包是合法行为；换过电池的机器会偏低而非偏高（不会误报） | `REVIEW` |
| `UPTIME_WITHOUT_BOOT_COUNT` | `system.bootCount`、`system.uptime` | `bootCount == 0` 且 `uptime > 0` | 设备正在运行却记录 0 次开机：该计数器被改写或 ROM 未维护 → **该字段不可信**，连带 `FRESH_BOOT_ON_AGED_ROM` 也不可信 | **低**，但结论只能是「字段不可信」，**不是**「设备是假的」 | `UNKNOWN`（不扣分，只标记字段可信度） |
| `NO_PERSONALIZATION_ON_AGED_ROM` | `system.timeZoneId`（新增）、`system.localeTag`（新增）、`display.fontScale`、`SYSD` | `AGE(SYSD) ≥ 730` 且 `timeZoneId` 为 `UTC`/空 且 `localeTag` 为 `en-US` 且 `fontScale == 1.0` | 长期使用的设备却零个性化。**这是本文档里最弱的一条**，只作为其他矛盾的辅助确认 | **高**：展柜机、测试机、企业统配、纯本地化极简用户、跨国出差用户 | `REVIEW`（不扣分） |
| `DECLARED_NEW_BUT_OLD_HARDWARE` | `system.initialSdk`、`cpu.cpuParts` / `cpu.cpuCapacity` / `memory.physicalRam`（已有实测键）、`SYSD` | `initialSdk` 对应年份 ≥ `D(SYSD)` 年份 **且** 实测 SoC 微架构/内存落在更早世代（依赖现有对照表） | 声明是新一代机型，实测硬件却是旧世代：声明与实测的世代矛盾（属 declaration 轴与 usage 轴的交叉项，此处只登记，归 declaration 轴计分） | **中**：对照表覆盖不足时不可判定 | `REVIEW`（由 declaration 轴计分） |

### 3.3 为什么删掉 `SELINUX_WITHOUT_BOOT_HISTORY`

题目建议的 `SELINUX_WITHOUT_BOOT_HISTORY`（SELinux 模式 vs 开机历史）在因果上不成立：
SELinux 模式由**镜像与启动参数**决定，与「开过几次机」没有任何机制上的联系。
把两者拼在一起只会得到一个误报率高、解释不通的规则。因此本设计用
`PERMISSIVE_ON_RELEASE_BUILD`（C5）替代：它同样是组合矛盾，但参与项之间存在**真实的机制约束**
（发行签名的 `user` 构建必须 `Enforcing`），解释得通，也能在面板上说清楚。

### 3.4 判定式的实现位置

- 判定逻辑放 `app/src/main/java/com/sigmark/app/security/DevicePosture.kt`，与现有
  `bootEvidence` / `identityConsistency` / `hardwareFacts` 同构：纯函数、输入是 `Map<key, DeviceInfoItem>`
  与 `capturedAt`，输出 `PostureRow(id, name, state, message, source)`。
- **只读归档字段与采样时间，不保存派生评分**（沿用 ARCHITECTURE.md 第 52 行的约定）。
- 每条规则的 `message` 必须写清「哪个读数与哪个读数冲突」和「什么情况下这是合法的」，
  沿用现有文案风格（例如 `boot` 行的「解锁不等于假机」）。

---

## 4. 落地建议（D）

### 4.1 值得进字段集 26 的信号

字段集 26 只加**能支撑矛盾判定、且零新增权限**的键。建议 4 个（按价值排序）：

| 建议 key | 组 | 来源（代码实际读法） | 单位 | `valueKind` | `unit` | `sourceClass` / `sensitivity` | `minApi` | 支撑规则 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `system.firstBootTime` | `system` | `getprop ro.runtime.firstboot`（秒/毫秒时间戳，先按 `epochSecondsUtcDate` 同款校验），回退 `PackageManager.getPackageInfo("android", 0).firstInstallTime` | `epoch_ms` → 显示为 `YYYY-MM-DD` | `integer_text` | `epoch_ms` | `technical`（与 `partitionBuildDates` 同级，机型级，不含用户标识） | 26 | 新增 `FIRST_BOOT_BEFORE_BUILD`：`D(firstBootTime) < SYSD - 1 天` → 首次开机早于镜像构建，物理不可能 → `PRIORITY` |
| `battery.chargeFullDesign` | `battery` | `/sys/class/power_supply/battery/charge_full_design`（µAh，经 `SysfsField` 固定路径 + 格式/范围校验） | µAh → 显示 mAh | `integer_text` | `uAh` | `technical`（`sysfsFields` 现有口径，`observer = APP_SYSFS`） | 26 | 与 `battery.chargeFull` 组合出电池健康度，支撑 `CYCLE_COUNT_ON_FRESH_ROM` 与「硬件年龄 ≫ 镜像年龄」 |
| `battery.chargeFull` | `battery` | `/sys/class/power_supply/battery/charge_full`（µAh） | µAh → 显示 mAh | `integer_text` | `uAh` | 同上 | 26 | 同上 |
| `system.launcherAppCount` | `system` | `PackageManager.queryIntentActivities(MAIN/LAUNCHER, 0)` 去重包名计数（**复用现有 `<queries>`，不新增权限**） | 个 | `integer_text` | `app_count` | `operational_context`（`system` 组默认是 `technical`，此键需显式设为 `operational_context`，与 `environment` 组同类处理） | 26 | 支撑 `NO_USER_TRACES_ON_AGED_ROM`；同时可替代/补强 `rootManagerVisible` 的「受包可见性限制」说明 |

**关于 `sourceClass` 的写法**：仓库现有词典用的是 `Observer` 字段而不是 `sourceClass`
（`APP_SYSFS` / `APP_PROC` / `APP_PROC_MAPS+APP_DIR_LIST` / `ROOT` 等，见 `field_dictionary.go:101-105`）。
新增条目应沿用 `Observer`：两个 sysfs 键填 `APP_SYSFS`，`firstBootTime` 填 `APP_PROP`（若属性快照取不到则回退
`APP_PACKAGE_MANAGER`，需在 `detail` 里写清命中哪一路），`launcherAppCount` 填 `APP_PACKAGE_MANAGER`。
**不要**新增一个 `sourceClass` 字段，那会改动词典契约。

**另外两项建议不新增字段、直接复用**：

- 「平均每次开机时长」**不做**（见 2.12）。
- `system.patch` vs `MAXBUILD`、`initialSdk` vs `SYSD`、多分区跨度、`selinux + tags` 这四条规则
  **全部建在已归档字段上**，字段集 26 不需要为它们加任何键。这是本设计最重要的一条落地结论：
  **C 部分 10 条规则里有 6 条零新增字段即可实现**。

### 4.2 明确不建议采的信号

| 信号 | 理由（三选一或并列） |
| --- | --- |
| 媒体库数量与最早照片日期 | **隐私足迹过大** + **当前无权限时口径恒为 0，会产生假干净读数**（2.2）。这是最危险的一项，绝不能无权限采 |
| 通信录 / 通话记录 / 短信 | **隐私足迹极大**，与「本地采集、普通权限优先」定位直接冲突；矛盾价值低于分区日期类信号（2.3） |
| `UsageStatsManager` 使用统计 | **普通应用拿不到**（`PACKAGE_USAGE_STATS` 是特殊权限，须用户跳出应用去系统设置手动开启）；且是逐应用前台时长，隐私足迹为全部通道之首（2.5） |
| `AccountManager` 账户 | **口径不可信**（API 26+ 账户可见性收窄，空数组不能推「无账户」）+ 触碰「新增敏感标识」红线（2.6） |
| `WifiManager.getConfiguredNetworks()` | **口径已死**：API 29 起废弃且只返回调用方自己创建的配置，对第三方应用基本恒为空（2.8） |
| `BluetoothAdapter.getBondedDevices()` | 需新增 `BLUETOOTH_CONNECT` 运行时权限，而配对计数只是**正向痕迹**，按 R1 不构成矛盾 → 扩权限换零扣分能力（2.8） |
| `QUERY_ALL_PACKAGES` 全量应用清单 | **口径失真**且是 Play 限制的敏感权限；现有 `<queries>` 的启动器口径已足够，且只取计数（2.1） |
| 输入法列表（包名级） | 零权限但不构成矛盾，只加证据不加分；取包名还会升为中等隐私（2.7） |
| 屏幕亮度 / 息屏超时 | **信噪比太低**，且与 `fontScale`/时区高度相关，边际信息为零（2.10） |
| `/data` 文件数量 | **普通应用拿不到**（uid 隔离），强行列会把 `RESTRICTED` 误读成「没有文件」（2.9） |
| 平均每次开机时长 | **不可推导**：Android 不给普通应用累计开机总时长，`uptime / bootCount` 是无意义比值（2.12） |

### 4.3 字段数量预估与契约影响

- 新增静态键：**4 个**（`system.firstBootTime`、`system.launcherAppCount`、
  `battery.chargeFull`、`battery.chargeFullDesign`）。
- 若把 `system.timeZoneId` / `system.localeTag` 也纳入（`NO_PERSONALIZATION_ON_AGED_ROM` 需要），则为 **6 个**。
  **建议先只上 4 个**：那条规则误报率高、且 `REVIEW` 级不扣分，可以晚一版再加。
- `maxFields`：字段集 25 是 `235 + 24 = 259`。字段集 26 应为 `239 + 24 = 263`（或 6 个键时 `241 + 24 = 265`）。
  **不会超限**——`maxFields` 是每个字段集手工抬上去的常量，不是硬上限；
  真正需要同步的是 `protocol.go` 的 `if p.FieldSetVersion >= 26 { maxFields = 263 }` 分支。
- 需要同步改动的位置（**本文档不改，供实现时对照**）：
  1. `app/src/main/java/com/sigmark/app/lan/LanDetails.kt`：`firstBootTime`、`launcherAppCount` 进
     `processEvidenceFields["system"]`；两个 `battery` 键进 `SysfsField` 会自动被投影（`SysfsField.entries` 分组已覆盖）。
  2. `app/src/main/java/com/sigmark/app/lan/LanReport.kt`：`LanFieldSetVersion = 26`。
  3. `app/src/test/resources/lan-projection-v26.txt`：新增文件，行数 = 239。
  4. `backend/cmd/sigmark/protocol.go`：`versionedParameters` 追加 4 条 `{group, key, 26}`；`maxFields = 263`。
  5. `backend/cmd/sigmark/field_dictionary.go`：`latestFieldSet = 26`、`dictionaryVersion = "sigmark-lan-fields/17"`、
     `fieldUnits` 追加 4 条、`describeField` 里给 `firstBootTime` 加 `epoch_ms`（自动 `integer_text`）、
     给 `launcherAppCount` 加 `operational_context`。
  6. `app/src/main/java/com/sigmark/app/security/DevicePosture.kt`：新增 C 部分规则（面板侧解释）。
  7. `backend/cmd/sigmark/score.go` 的 `usageAxis()`：新增规则的计分侧实现。
     注意三条约束——(a) 新参与键必须登记进 `total`/`decided`，否则 R4 覆盖率虚高；
     (b) 命中多条时取最高分、不叠加，本轴上限 12 分；(c) 缺键走 `undetermined` 并带原因，
     **不要**用 `NOT_ARCHIVED` 当「没问题」。
  8. 单测：`LanDetailsTest` 投影集合、`protocol_test.go` 白名单、`DevicePostureTest` 每条规则的样例、
     `score_test.go` 的 usage 轴扣分与覆盖度样例。
- **风险提示**：`ro.runtime.firstboot` 与两个 `charge_full*` 节点的可读性**均未实测**。
  实现时必须保证读不到时是 `UNAVAILABLE / NOT_REPORTED` 或 `RESTRICTED / ACCESS_DENIED`，
  **绝不填 0**——0 会被 `CYCLE_COUNT_ON_FRESH_ROM` 和 `FIRST_BOOT_BEFORE_BUILD` 误当成真实值。

### 4.4 用户提示与隐私文档：**要更新**

AGENTS.md 第 6 条要求「新增敏感标识或对外传输时，先更新用户提示和隐私文档」。本次 4 个新键**都会对外传输**
（进 LAN 投影），因此**必须更新**，具体要写的内容：

1. **用户提示 / 上传预览**：「查看上传参数」列表由 `lanParameters()` 从投影自动生成，
   新键会自动出现，**无需改代码**；但需要确认预览里能读到这 4 项的 `note`，
   尤其是 `launcherAppCount` 必须写明「只上传可见启动器应用的**数量**，不含任何应用名、包名或权限」。
2. **README「隐私与导出」段落**：沿用现有逐字段集披露的写法，追加一段，建议原文：

   > 字段集 26 在「查看上传参数」列出设备首次开机日期（`system.firstBootTime`）、
   > 可见启动器应用数量（`system.launcherAppCount`）、电池满充容量与设计容量
   > （`battery.chargeFull`、`battery.chargeFullDesign`）。
   > 前两项是设备生命周期读数，后两项是机型级硬件读数；四项都不含应用名、包名、账号、序列号，
   > 也不构成设备或用户唯一标识。仍由用户手动确认发送。
   > 本版本**不申请**任何存储、媒体、通信录、使用情况访问或账户权限。

3. **不需要**更新 `docs/LAN-PILOT.md`（未改接口形状）与 `docs/SECURITY-EVIDENCE.md`
   （新增的是 usage 轴规则，不改启动证据规则）；但如果 `DevicePosture` 新增了 `PRIORITY` 行，
   建议在 `docs/SECURITY-EVIDENCE.md` 的规则清单里登记 code 与分级。
   计分侧新增的 code 还需在 `backend/web/src/score-view.ts` / `score-panel.tsx` 的文案里出现，
   否则前端会显示裸 code。
4. **不建议**把 `battery.chargeFull*` 标为 `sensitive`：它们是机型/电池级别读数，不含用户行为。

---

## 5. 验收与「未实测」清单

### 5.1 真机验证清单（字段集 26 实现后必做）

| 项 | 验证内容 | 通过标准 |
| --- | --- | --- |
| `ro.runtime.firstboot` | 在目标 ROM 上用 `SafeReader.property` 读；再用属性快照路径复核 | 读到秒/毫秒时间戳且能解析成合理日期；读不到记 `NOT_REPORTED`，**不是 0** |
| `charge_full` / `charge_full_design` | 在 `SysfsField` 新增节点后真机读 | 命中时数值在合理范围（如 3000–8000 mAh）；不命中记 `RESTRICTED`/`NODE_MISSING` |
| `launcherAppCount` | 与「设置 → 应用」里的人工计数对照 | 数值 ≤ 人工计数（下界成立），且 ≥ 3 |
| `battery.cycleCount` | API 34 设备上确认非 0 | 与系统设置里的电池信息一致（若可见） |
| 每条 C 规则 | 至少一台「真实老机」+ 一台「刚恢复出厂」+ 一台「展柜机」 | 真实老机不产生 `PRIORITY`；后两者最多 `REVIEW` |

### 5.2 明确标注「未实测，需真机验证」的项

1. `ro.runtime.firstboot` 在 App 域的可读性。
2. `PackageManager.getPackageInfo("android").firstInstallTime` 是否等于「首次开机/刷机时间」而非 `0`。
3. `/sys/class/power_supply/battery/charge_full` 与 `charge_full_design` 的可读性（参考 `battery/temp` 的机型差异）。
4. `Settings.Secure.DEFAULT_INPUT_METHOD`、`Settings.Secure.ACCESSIBILITY_ENABLED` 的可读性。
5. `AccountManager.getAccountsByType("com.google")` 在 targetSdk 26+ 上的实际返回（本设计**不采**，仅记录）。
6. `READ_CALL_LOG` / `READ_SMS` 在非默认应用角色下的实际状态（本设计**不采**）。
7. `Settings.System.SCREEN_BRIGHTNESS` 等读取是否在所有目标 ROM 上无权限即可（本设计**不采**）。

### 5.3 严禁的推理（本文档的禁止清单）

- 禁止把 `RESTRICTED` 当「没有」。`SafeReader.listNames()` 的注释已经写死了这条：
  「目录存在（stat 可见）但列出条目被拒绝，不能据此断言其中没有文件」。
- 禁止把 ADB shell / `su` / root 能读到的值写进 App 报告，或据此设计规则。
- 禁止从「旧版报告缺这个字段」推出「设备异常」（ARCHITECTURE.md 第 60 行：旧报告没有的值不反推）。
- 禁止把单信号的低值写成扣分（R1）。

---

## 6. 与其他文档的关系

- 采集状态语义与四态： [架构与数据契约](ARCHITECTURE.md)
- 现有安全面板规则与 `Finding` 分级： [安全证据](SECURITY-EVIDENCE.md)
- 已确认的改机覆盖区与盲区（本设计的通道选择大量依赖其结论）：
  [机型伪装的可覆盖面与盲区](DEVICE-DISGUISE-SURFACE.md)
- 权限边界与 `syscall` 实测： [syscall / Native 采集边界](SYSCALL-BOUNDARIES.md)
- 字段集历史写法参考： [字段集 19](FIELD-SET-19.md)、[字段集 17](FIELD-SET-17.md)
- 上传契约与分页详情： [内网试验手册](LAN-PILOT.md)
