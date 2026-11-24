# 架构与数据契约

SigMark 当前采用单模块 Kotlin / Compose 结构，目标是让每一项信息都可追溯，而不是只显示一个字符串。

## 数据流

- 字段集 9 把「标准采集／ROM 验收／网络复测」与采样开始时的授权状态挂在同一份报告。ROM 方案额外附固定样片实测结果，使用既有字段白名单协议；独立本地解码工具不改历史。详见 [1.0 验收手册](ACCEPTANCE-1.0.md)。

- `CollectionAccess.kt` 集中定义蜂窝字段的授权前置条件和 UI 路由。只对已知可由用户处理的受限原因显示入口。权限回调使用不创建草稿的刷新路径，遇到正在进行的采集时等待后补刷新。
- `MediaDecodeProbe.kt` 是按需执行的本机能力实测，和常规采集及指纹判定独立。内置 `sigmark-avc/1` 固定样片，通过 MediaExtractor/MediaCodec 检查首个非配置输出，区分文件、解码器初始化与首帧阶段，不读取个人文件、不上传。

- 管理端设备画像由 Go 按当前规则从原报告只读计算，React 只渲染返回值。上传字段集、移动端权限和库表均不变；导出的派生结果以稳定的规则代码、字段键及规则版本为准，不解析界面中文文案。详见[读取契约](LAN-PILOT.md#设备风险画像读取契约)。

`DeviceCollector` → `DeviceRepository` → `MainViewModel (StateFlow)` → Compose 页面 → 系统文档选择器导出 JSON。

Debug 内网试验分支：冻结当前本地快照 → `lan/LanReport.kt` 按白名单投影 → 用户确认上传 → 内置局域网地址的 Go API → PostgreSQL。浏览器用管理会话读取，同源脚本联调也可使用独立 Bearer 令牌。上传与完整 JSON 导出各自走独立流程。详细契约和运行说明见 [内网试验手册](LAN-PILOT.md)。

- `collector/DeviceCollectors.kt`：各分类独立采集；字段级捕获异常，分类级兜底，避免单项失败导致整页空白。当前只在进入页面和手动刷新时采集，不做后台定时轮询。
- `collector/SafeReader.kt`：`ReadResult<T>` 统一返回值、来源、状态、原因、详情及可选 errno。只读固定节点设字节上限与等待上限，使用有限线程池；固定属性查询仅通过应用自身身份调用 `getprop`，带进程超时。若驱动忽略非阻塞，超时停止等待不等于保证内核调用立刻结束；线程和队列上限限制影响范围。
- `collector/CpuInfoParser.kt`：将厂商格式差异较大的 `/proc/cpuinfo` 文本解析为可显示字段，不推断 SoC 商品名。
- `collector/NetworkCollectors.kt`：默认网络、Wi-Fi 链路和移动网络分开展示；`RadioMath.kt` 负责可单测的频率/信道换算。手动刷新且已授权时尝试一次公开小区更新，最多等待 2.5 秒再回退到缓存。
- `model/DeviceInfo.kt`：`DeviceInfoItem` 包含稳定 key、标签、值、来源、状态、说明。JSON 使用 `schemaVersion`，消费者应按 key 而非中文 label 解析。
- `MainViewModel.kt`：采集在 `Dispatchers.IO` 上执行，`StateFlow` 向 UI 暴露快照、刷新态和整体错误。
- `MainActivity.kt` 渲染快照，从 Compose 窗口状态补充尺寸及边距，在导出预览中提示内容，并写入用户选定的 URI。
- `collector/FrameworkCollectors.kt` 提供运行时、媒体、环境和应用字段。`SensorMonitor.kt` 随面板和前台生命周期管理订阅。`VisibleApps.kt` 按需查询当前可见且有桌面入口的应用和所选应用的权限。

## UI 测试动线

首屏固定顶部品牌、刷新和导出；下方依次是当前设备摘要、搜索、待确认筛选和分类。分类卡默认展示前 5 项及所有异常项，点“展开其余”查看全部，避免重要问题被折叠。字段点按展开来源说明，长按复制数值。异常筛选自动回到“全部”分类，空结果提供一键重置。视觉采用深海墨色背景、薄荷绿主色和琥珀色异常提示；应用图标素材位于 `output/imagegen/`。

## 状态语义

| 状态 | 语义 | 值 |
| --- | --- | --- |
| `AVAILABLE` | 成功取得可展示值 | 非空字符串 |
| `UNAVAILABLE` | 接口未返回有效值或 ROM 没有该字段 | `null` |
| `RESTRICTED` | 系统权限/策略拒绝读取 | `null` |
| `ERROR` | 其他读数异常 | `null` |

受限状态不等同于设备关闭某项能力。例如 `/sys/fs/selinux/enforce` 被拒绝，只能表示当前应用读取受限，不能据此推断 SELinux 模式。

本地 JSON `schemaVersion: 1` 向后兼容，增加可选数值 `errno`，`reason` 新增 `NODE_MISSING`、`INVALID_VALUE`。不存在时仅按 `status` 判断；不要从中文说明推断原因码。本地快照与 LAN API 独立版本化。

### LAN v4 · 开发与自动化入口

- Android 上传投影：`lan/LanDetails.kt`；服务端独立白名单和类型校验：`backend/cmd/sigmark/protocol.go`。新增上传字段时同步更新两端、用户预览、隐私文档和测试。
- LAN v4 字段集 8 新增 `runtime.vulkanVersion`、`media.cameraCapabilitySummary`、`sensors.typeWakeupSummary`。待上传队列读取各报告存入时的字段集。旧字段集沿用原有权限与字段白名单。
- 稳定字段标识为 `group + key`；标签仅供显示。记录有 `value`、`status`、`source`，可带 `reason`、`errno`、`note`。非可用值固定为 JSON null。`/api/admin/reports/{id}` 返回原始结构化报告，不通过抓网页获取。
- v3 在报告正文新增 `coverage`。每个 `group` 有 `available`、`restricted`、`unavailable`、`errors` 四项快照计数。每组各状态的计数覆盖对应归档行。自动化分析应使用 `parameters` 读明细，使用 `coverage` 对照快照口径。历史 v1/v2 缺少此元数据。
- v4 新增 `collectorVersion`（采集实现版本）和 `fieldSetVersion`（归档字段语义版本）。状态保留已有四类；`OPTIONAL_UNSET`、`INTERFACE_UNSUPPORTED`、`MODEM_NOT_REPORTED`、`NO_REGISTERED_LTE` 在 `UNAVAILABLE` 下细分原因。历史报告缺行只在对比视图标作「报告未记录」，不改写为采集状态或设备不支持。
- 字段集 5 增加 `cellular.defaultDataSlot`、`cellular.slotService`；两端白名单按分类和键匹配，字段集 2–4 继续接收。链路时间线使用独立本地 JSON（`schemaVersion: 1`；毫秒和 dBm 显式标注），不进入报告白名单。
- 字段集 6 增加 `environment.keyguardSecure` 和 `environment.storageEncryption`。安全分析规则只读取归档字段与采样时间，不保存派生评分；没有证明链时不生成设备认证结论。参见 [安全证据](SECURITY-EVIDENCE.md)。
- 0.12 的 v4 使用字段集 3，新增可选 `cellular.carrierBandwidths`。v4 字段集 2 仍可接收。电池能量粗估留在本地，不进入上传白名单。
- 0.13 的字段集 4 新增 `cellular.simState`、`network.visibleTransports` 和 `network.wifiRouteRole`。字段集 2/3 继续兼容。默认路由仍是原来的 `network.transport`；其他网络信号分别对照。
- 前端归档查看在 `main.tsx`，批量资产管理在 `assets.tsx`，共享报告类型、标签和导出在 `reports.ts`。资产页用 `/api/admin/report-count` 获取过滤后的两种资产数量，不扫描参数状态摘要。
- 报告列表、计数、摘要和 ZIP 共用查询范围：`q`、`batch`、`view=archive|trash`，以及精确匹配的 `android`、`api`、`brand`、`model`、`device`。品牌、Android 版本和设备代号取已归档的 `AVAILABLE` 字段，型号和 API 取报告头。没有有效归档值用 `~missing` 筛选；不从相邻报告回填。鉴权接口 `GET /api/admin/report-facets` 返回这些维度的值和匹配报告数，不受列表分页影响（每维最多 150 个常用值，缺项分类另保留）。
- `POST /api/admin/reports/export` 使用管理鉴权及 `X-SigMark-Admin: 1`。请求是 `{"mode":"selected","ids":["<uuid>"]}` 或 `{"mode":"filtered"}`，查询参数与列表相同。所选项移出范围返回 409，并且不产生部分 ZIP；超限返回 413。ZIP 的 `manifest.json` 包含格式版本、导出时间、数量和文件名。
- `repository_stats.go` 的字段覆盖 v2 按匹配报告计数；指标为 `available/restricted/unavailable/errors/legacy/missing`。历史 v1 的状态项只算 `legacy`。字段词表直接来自服务端归档白名单。
- 设备归组独立于 JSON：上传预览明确同意后，Android 发送发往当前 LAN 地址的随机安装标记（`X-SigMark-Asset-Key`），服务器将摘要映射为 `device_assets.id`。报告只增加关系列 `asset_id`，原始 JSON 和 ZIP 不变。老版本或未同意的报告默认未关联。事务保证同一标记并发上传不会创建设备副本，管理员合并设备时一并迁移报告关系和安装映射；这不是硬件识别或上传认证。脱库的服务器资产 UUID 与发送的安装标记不同。
- 列表/详情分离，游标由接收时间和 UUID 组成；分析脚本保持相同 `q` 和 `batch`、使用 `nextCursor` 翻页并按 `id` 去重。PostgreSQL 默认不自动清理。旧报告没有的值不反推，不应把旧版缺字段当作设备异常。界面比较逻辑见 `backend/web/src/compare.ts`。
- `backend/web/src/main.tsx` 根据 URL 片段选择工作区页面。会话和接收设置在 `backend/cmd/sigmark/admin.go`。构建中心由 Go API 写入文件队列，主机上的 `backend/scripts/build_worker.py` 从已登记的 Git SHA 构建并验证 APK。公开下载只读取当前发布记录，构建完成后由管理端独立发布。
- 持久回归基线由 `baselines.go` / `regression_baselines` 保存引用和实验预期，不复制报告。前端 `security-rules.ts` 负责解释证据，`regression.ts` 生成版本化对比导出，均可独立测试。读数缺失、字段未归档、跨资产对照与当前读数变化是独立信号。详见 [复测工作流](REGRESSION-WORKFLOW.md)。
- 资产搜索和高级筛选由 `asset-filters.tsx` 组合；Radix Popover 负责焦点、逃逸键和视口定位，业务只在确认后更新 URL 作用域。现有 React、Vite、CSS 和 API 保持不变。Android 用已有 Compose Material 3，复测准备不增加上传字段。
- `workspace-route.ts` 是档案、资产、字段覆盖和复测的 URL 范围契约。只迁移公开的筛选参数，不迁移勾选、回收站状态或当前报告；需要时通过显式 `report`、`baseline` 参数进入详情。`report-picker.tsx` 重用原报告查询与分页接口，不加入新的报告读写协议。
- `workspace-ui.tsx` 和 `workspace-ui.css` 提供统一的后台框架、页头、子页链接及空态；业务页各自保留数据请求与操作逻辑。`sampleAsset` 只用于设备采样深链接，不进入报告筛选或导出范围。详见 [后台工作台](WORKSPACE-UI.md)。
- 档案列表和独立阅读页按路由分别挂载；直接打开报告只读对应详情（对照时另读基线），不预取档案列表。`reader-history.ts` 将来源、分页游标、焦点和视口位置保存在该条浏览器历史记录中，不放入可分享 URL，不改变报告。设备采样按游标补载后才恢复定位。
- `reader-fields.ts` 从原始参数派生分类、检索结果与按状态计数；`reader-parameters.tsx` 展示读数与可展开的诊断依据。搜索和状态是交集，『全部』只清除状态条件。未归档字段不补行；手机快照统计与归档明细不是同一口径。自动化的稳定字段标识仍是 `group + key`，不依赖页面展示顺序。

### 普通设备兼容策略

- LAN v4 字段集 7：`system.partitionCount`、`system.partition_<name>`、`system.webViewProvider/webViewVersion/webViewCode`、`system.systemSpl/vendorSpl`、`environment.keyProtection`、`app.package/channel/certSha256`。动态分区名仅限小写字母、数字、下划线（1–32 字符、最多 24 个），只允许在 system 下。v7 最多 192 条，旧 v3/v4 仍最多 160 条。对照按稳定键，不按显示顺序。按需密钥测试的采样时刻在该项说明里，不改原快照时间。
- 启动规则的 Kotlin / TypeScript 实现共用测试样例 `app/src/test/resources/security-boot.tsv`；单份和对比都先判红色与冲突，再判符合预期的解锁。复测 JSON 的 `ruleVersion` 为 `rom-evidence/4`，与采集器和字段集版本独立。
- 管理端 `GET /api/admin/release-signer?package=com.sigmark.app&channel=lan-debug&version=0.18.0&code=20` 仅查已发布版本。当前记录来自发布指针，切换前将原发布证书摘要保存在构建数据目录 `published-signers/`；旧文件中从未记录的历史不作猜测。无对应数据是 `unregistered`，存储不可读是服务故障，不能作为证书不匹配。未改变用户归组或报告鉴权机制。

- 公开 API 优先：Build、ActivityManager、StatFs、Display、BatteryManager、SensorManager、ConnectivityManager。CPU 文本、首核频率、Swap、SELinux 与厂商属性是可选补充，不阻断其他参数。
- EACCES/EPERM 标记 `RESTRICTED`；ENOENT/ENODEV 映射 `UNAVAILABLE / NODE_MISSING`。`UNAVAILABLE` 是兼容旧版 JSON 的“暂无数据/不支持”状态，不另造 `UNSUPPORTED` 枚举。属性无返回值为 `NOT_REPORTED`；真正的失败或超时标记 `ERROR`。不根据缺失或受限推断风险。
- ROM 版本线索依次尝试 HyperOS、MIUI、ColorOS、One UI 的常见公开可读属性。HDR 是显示器声明的能力；尺寸来自系统 DPI 推算。电流按 BatteryManager 的 µA 转 mA，保留正负号，排除无效或明显异常的样本。
- 设备配置摘要只使用版本化的 Build 和 ABI 输入。环境线索记录各自状态和来源。实现和兼容范围见 [采集字段说明](FRAMEWORK-DIAGNOSTICS.md)。

## 扩展约定

新增字段时优先使用公开 Android API；再考虑常见可读节点。先保留原始来源与单位，再做显示格式化。动态值仅随手动刷新更新；若未来加入实时页，监听器应随页面可见性注册/注销。涉及 `Build.*` 的值注明“应用进程视角”，不当作物理硬件真值。新增数据导出字段应同步更新 `schemaVersion` 文档、单测和隐私提示。

### 0.18.1 · 采样、上传与资产的三个边界

- 「整体获取」先采集快照（含无线刷新），再自测临时密钥，最后预览，不自动提交。自测无结果时保留具体状态；本机配置摘要不进入上传。预览包含当前窗口信息；同次预览冻结同一份上传内容。
- SampleUpload 由 MainViewModel 持有。首次发送后锁定反馈、关联选择、请求编号与内容；网络错误后可重试，成功后只看回执。关窗或旋转不会丢失；结束进程、成功刷新或主动重测后是新采样操作，不承诺跨进程恢复。
- 提交按 (batch, requestId) 串行。先核对原 JSONB，再决定是否解析安装标记；重放不创建资产、不更改归属，同编号不同内容返回 409。成功回执含 reportId、batch、assetLinked；后者反映服务器所存关联，而非客户端勾选。旧服务无此字段时显示「后台未返回归组状态」。服务端切换批次后不保证跨批次去重。
- 回归命令（仓库根）：先在 backend 下执行 docker compose build api，再执行 python backend/scripts/qa_asset_uploads.py。脚本使用临时网络、数据库和 API，不访问部署仓库。

### 0.18.2 · 独立的本机待上传列表

- 普通启动及权限结果回调只更新首页显示。主动整体获取、手动刷新、密钥复测在配置 LAN 的构建中产生独立条目；首次可手动选择首页结果。采集不会发起网络请求。
- ReportShelf 在 App 私有 SQLite 中按后台地址隔离报告，仅存 LAN 允许的投影、采集网络和时间、备注、关联选择和发送状态，不保存完整本地导出。成功上传不自动删除本机副本。用户可按条删除；默认无自动上传、无后台重试。
- 首次确认时以事务固定正文、提交编号和关联选择，再发送；中断后从同一目的地恢复原始字节。回执保存在本机，查看已上传不重复发出请求。服务器仍按批次与提交编号去重，切换服务端批次不承诺跨批次去重。

### 字段集 17 与比对规则

- 字段集 20 增加 `system.bootCount`、`system.mediaPerformanceClass`，静态键 224、单帧上限 248，词典 `sigmark-lan-fields/10`。外部观察文件增加 `sigmark-adb-evidence/5`（`observer=ROOT`，SELinux 策略摘要），面板按来源分列。
- 字段集 19 增加 `system.boardPlatform`、`system.bootHardware`、`system.hardwareSku` 三个只读属性声明，静态键 222、单帧上限 246。安全规则 `rom-evidence/4` 新增同一观察者内部的「身份字段一致性」检查；设备风险画像升到 `sigmark-profile/3`，末尾追加 `identity_conflict`。ADB 观察文件升到 `sigmark-adb-evidence/4`，并列比较这三项。
- 字段集 18 增加 `system.initialSdk`（出厂 API 级别，来自 `ro.product.first_api_level`），静态键 219 个、单帧上限 243（219 + 最多 24 个分区行）。Android 8/9 的分区构建指纹改由 `ro.<partition>.build.fingerprint` 只读属性补齐，键空间与来源字段不变。
- 机器码升级为 `sigmark-config-code/2`，分为商品 `P2-`、硬件 `H2-`、ROM `R2-` 三个独立分量；硬件分量使用 `cpu.hardware`、`system.board`、`cpu.coresConfigured`、`system.initialSdk`。任一分量输入不全只影响该分量。它只编码 App 归档视角，不代表物理设备真相。
- Android 投影新增 11 个静态键：`environment.hookSignals`、`tracerPid`、`rootMountHints`、`rootManagerVisible`、`userProfile`、`drmSecurityLevel`、`verityMode`、`buildDebuggable`，`system.partitionBuildDates`、`selinuxEvidence`，`cpu.coresConfigured`。`environment.androidIdSha256` 只在本机 JSON 中，不进入上传投影。静态键 218 个，单帧上限 242（218 + 最多 24 个分区行）。共享登记表为 `app/src/test/resources/lan-projection-v17.txt`，Go 契约测试逐键比对。
- 采集侧统一「先公开 API、再固定节点、再只读属性」的顺序。属性读取每份快照执行一次 `getprop` 并解析成内存表，未命中的键回退单键读取；`battery.sysBatteryTemp` 允许 `battery/temp` 与 `bms/temp`，服务端按「命中任一允许路径」校验来源，词典与档案仍展示主路径。
- `system.selinux` 与 `system.selinuxEvidence` 必须成对解释：直接读数为 `exact`，EACCES 且 DAC 允许读取为 `inferred_mac`，selinuxfs 未挂载为 `inferred_disabled`。推断值在值串里带「推断」，任何消费者都不得把推断当成直接读数；规则与画像只把 `Permissive` 当风险线索。
- 前端安全规则升到 `rom-evidence/3`，检查项增加 `hook`、`trace`、`profile`、`drm`、`rom`；对照每行带 `category`，结论新增 `restricted`（一侧被系统拒绝）与 `not_archived`（一侧字段集未包含该键），并提供 `compareSummary` 汇总。`regression.ts` 生成的对比导出使用同一规则版本。
- 设备风险画像升到 `sigmark-profile/2`，标签顺序固定为 `virtual_build_markers`、`selinux_permissive`、`debugger_attached`、`hook_injection`、`root_manager_visible`、`multi_open`、`rom_verification`、`software_drm`，并输出 `historyRestricted`。历史样本的受限字段不进入命中，也不作为反证。
