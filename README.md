# SigMark / 印迹

**交给后续智能体**：先看 [当前版本交接](docs/HANDOFF.md)，再看 [路线与验收优先级](docs/ROADMAP.md)。**1.21.2（50）已发布到构建中心**，下载渠道不再是 1.16.0/43；后台代码与部署均为字段集 25（`latestFieldSet=25`、词典 `sigmark-lan-fields/16`、235 键），画像规则 `sigmark-profile/8`。真机验收覆盖 Pixel 6（改装机）与 Xiaomi MI 8（未改装，API 29）两台。机型改写的可覆盖面与盲区单独记录在 [机型伪装可覆盖面与盲区](docs/DEVICE-DISGUISE-SURFACE.md)。

**日常采集** · 在手机 App 点击「整体获取」，需要后台查看时再从 App 上传报告。后台打开报告即执行安全检查，无需电脑或导入文件。历史 App 与 ADB 对照仅在「辅助对照 · 外部记录」中查看，不计入 App 安全结果。

**1.21.2** · 收口上一轮三项遗留，并修掉一个真实缺陷。① **仪器测试**：新增 `SafeReaderInstrumentedTest.kt`，22 条断言全 PASS。② **浏览器 QA**：接入 Playwright（用系统 Chrome，不下载自带 Chromium），`npm run qa` 对着真实部署跑通两个脚本。③ **SKU per-UID 跨机型**：用未改装的 MI 8 反证——`ro.boot.hardware.sku` 在这台机器上根本不存在（两个 UID 都读空），`model`／`device` 两 UID 一致，说明 per-UID 改写是**改机层行为而非 Android 行为**。④ **真实缺陷**：`SafeReader.listNames` 原来把「无权限」和「不存在」都报成 `UNAVAILABLE/NOT_REPORTED`，等于把「读不到」当成「没有」；改为先 `Os.stat` 再列举，被拒目录现在正确报 `RESTRICTED/ACCESS_DENIED errno=13`。⑤ **新增 SoC 登记 `sdm845`**（Snapdragon 845），画像规则升到 `sigmark-profile/8`；其 capacities 与 cmaMiB 故意留空（内核 4.9 不暴露 `cpu_capacity`，`CmaTotal` 是设备树值不是 SoC 常量）。APK 12 006 913 字节，SHA-256 `85ec158f…`。[设备验证记录](docs/DEVICE-VALIDATION.md) · [overlay 多路径抽取](docs/OVERLAY-ROBUSTNESS.md)

**1.21.0** · 新增 `environment.overlayEvidence`：把 overlay 设备代号的**多路径抽取结果**收进单条字段，形如 `rro:oriole / vendor_dir:oriole / product_dir:oriole / sku:g9s9b,gb7n6,gr1yh / soc:gs101`。抽取按「本进程实际加载的 maps → idmap 转义名 → 四个分区 overlay 目录」三级冗余，多级冲突时以 maps 为准并写 `conflict:` 段。实测还推翻了一个假设：`ro.boot.hardware.sku` 在改装机上与 `device`／`model` 一样被按 UID 改写（shell 读 `GR1YH`，App 进程内读 `23078PND5G`），所以 `sku:` 只作旁证、不参与代号判定，与候选都不匹配时退回并列形态。字段集 25，词典 `sigmark-lan-fields/16`（235 键），`maxFields` 分档 `>=25 → 259`。Pixel 6 真机上传报告 `7c786f17…`，归档 207 项。[overlay 多路径抽取](docs/OVERLAY-ROBUSTNESS.md) · [字段集 24](docs/FRAMEWORK-DIAGNOSTICS.md#字段集-24内核算力权重与预留连续内存)

**1.20.0** · 新增两个「内核口径」通道：`cpu.cpuCapacity`（`/sys/devices/system/cpu/cpu{N}/cpu_capacity`，内核按实际核心类型写入的算力权重，按核心顺序去重，形如 `160/498/1024`）与 `memory.cmaTotal`（`/proc/meminfo` 的 `CmaTotal`，内核启动时预留的连续内存池，`652 MiB`）。判定改用「登记表反查」：实测值命中**另一个已登记 SoC** 的 profile 判冲突，命中声明 SoC 自己的登记值判一致，声明 SoC 未登记或实测值不在表内判未确认、不猜。后台资产画像升到 `sigmark-profile/7`，`hardware_declaration_conflict` 证据行 8 → 10 条。字段集 24，词典 `sigmark-lan-fields/15`（234 键）。Pixel 6 实测两条通道均与声明 `mt6985` 冲突，真机上传报告 `c0f517f1…`。[字段集 24](docs/FRAMEWORK-DIAGNOSTICS.md#字段集-24内核算力权重与预留连续内存) · [伪装面与盲区](docs/DEVICE-DISGUISE-SURFACE.md)

**1.19.0** · 新增第四条不依赖声明链的通道：`/proc/self/maps` 里 framework RRO overlay 文件名携带的镜像产品代号。改机层改写属性和 `Build`，但不会重建构建时生成的 overlay 文件，因此同一台 Pixel 6 上属性报 `corot`、overlay 报 `oriole`。本机判断新增「镜像 overlay 代号核对」行，后台 `sigmark-profile/6` 把 `system.device` 与 `environment.overlayDeviceCodename` 作为第四条独立通道并入 `hardware_declaration_conflict`，8 条证据全部为真实归档读数。字段集 23，词典 `sigmark-lan-fields/14`（232 键）。[伪装面与盲区](docs/DEVICE-DISGUISE-SURFACE.md) · [字段集 22](docs/FRAMEWORK-DIAGNOSTICS.md#字段集-22第二观察通道实测硬件)

**1.18.0** · 新增第二观察通道：`/proc/cpuinfo` 全分块 CPU 微架构签名、`/proc/meminfo` 与 `sysconf` 的内存口径、EGL 报告的 GPU 驱动字符串。同义核对全一致时仍可能不一致的是这些通道；Pixel 6 改写机上实测暴露内存与 CPU 两处冲突，GPU 一致。字段集 22，SoC 不在登记表内记未确认，不判定真伪。[字段集 22](docs/FRAMEWORK-DIAGNOSTICS.md#字段集-22第二观察通道实测硬件)

**1.17.0** · App 内逐对比较型号、设备代号和适用的硬件 SKU 的同义读数，共两至三对。主板与平台、硬件与启动硬件是不同声明，不再计为身份冲突。后台直接从归档复算，新字段集 21 保留来源与状态。[检查口径](docs/SECURITY-EVIDENCE.md#app-身份声明核对)

**1.16.0** · 上传确认页精简为采样、目的地、传输提示和设备关联。备注和实际发送的参数可按需展开。密钥自测增加本机加解密检验。

**1.15.0** · 后台新增保存跨来源身份对照的功能。手机首页保留采集、上传和安全结论，验收实验和原始读数移入工具菜单及诊断详情。

**1.14.0** · 点击「整体获取」后，首页自动显示本次安全检查结果和检查依据。后台打开已上传的 App 报告即执行检查，ADB 与 JSON 导入位于「辅助对照」。

**1.13.0** · 手机「指纹安全」展示并保存六项 App 身份声明。后台「指纹安全 → 本地身份对照」可以直接打开 App 和 ADB 的 JSON，确认同机后显示差异数。文件仅用于当前浏览器页面。[操作与验证](docs/SECURITY-EVIDENCE.md#本地身份对照)

**1.12.0** · 「整体获取」同时执行密钥保护、AVC 首帧和 GLES 离屏回读。实验结果随采样保存，可在后台验收工作台展开查看。网络切换、USB 插拔和 GNSS 保留单独入口。[操作与验证](docs/ACCEPTANCE-1.0.md)

**1.11.0** · 字段集 20 采集系统冷启动次数（`Settings.Global.BOOT_COUNT`）与媒体性能等级（API 31+），两者都只作世代/生命周期对照。外部观察新增 opt-in 的 `sigmark-adb-evidence/5`（`observer=ROOT`）：在 v4 字段之外给出 SELinux 策略摘要，需已 root 的测试机；面板把 App、ADB shell、root 三个来源分列，互不填充。浏览器 QA 新增身份分布页用例，报告详情对身份声明不一致的样本置顶提示。详见 [字段集 20](docs/FRAMEWORK-DIAGNOSTICS.md#字段集-20开机次数与媒体性能等级)、[syscall 边界](docs/SYSCALL-BOUNDARIES.md) 与 [设备验证记录](docs/DEVICE-VALIDATION.md)。

**1.10.0** · 字段集 19 新增三条身份声明（`ro.board.platform`、`ro.boot.hardware`、`ro.boot.hardware.sku`），与 `Build.BOARD / HARDWARE / SKU` 做同一观察者内部的三对一致性检查；安全规则升到 `rom-evidence/4`，设备风险画像升到 `sigmark-profile/3`（第 9 个标签 `identity_conflict`），ADB 观察文件升到 v4 并并列比较这三项；设备风险画像新增同资产「历史身份声明」；报告详情对身份声明不一致的样本置顶提示；后台新增「身份分布」页，汇总多身份资产、跨资产同一声明与内部冲突报告。真机实测：小米序列上 App 读到 `mt6985 / mtk / 23078PND5G`，ADB shell 读到 `gs101 / oriole / GR1YH`，三对全部冲突；另一台 MI 8 两侧一致。详见 [字段集 19](docs/FRAMEWORK-DIAGNOSTICS.md#字段集-19身份字段与内部一致性)、[设备验证记录](docs/DEVICE-VALIDATION.md) 与 [安全证据](docs/SECURITY-EVIDENCE.md)。

**1.9.0** · 机器码升级为三个独立分量（商品 `P2-`、硬件 `H2-`、ROM `R2-`），字段集 18 新增设备初始 API 级别；Android 8/9 的分区构建指纹改由只读属性补齐。真机实测发现同一属性在不同上下文可读到不同值：同一台设备上 App 读到小米 `23078PND5G / corot / mt6985`，ADB shell 读到 `Pixel 6 / oriole / gs101`，初始 API 级别也分别是 33 与 31。因此机器码只编码 App 归档视角，跨来源对照保留两套值。字段集 17 的 SELinux 推断、进程内安全线索与安全比对 `rom-evidence/3` 继续有效。详见 [机器码与节点](docs/CONFIGURATION-EVIDENCE.md)、[字段集 17](docs/FRAMEWORK-DIAGNOSTICS.md#字段集-17进程内安全线索与读取回退)、[字段集 18](docs/FRAMEWORK-DIAGNOSTICS.md#字段集-18设备世代与分区分支) 与 [设备验证记录](docs/DEVICE-VALIDATION.md)。

**1.8.0** · 字段集 17 新增进程内安全线索，并给固定受限项补上可推断或可回退的读取路径。SELinux 实时模式在节点被策略拒绝时给出带依据的「推断」值（`system.selinuxEvidence` 标注依据），不再只有「系统拒绝访问」；属性改为每份快照一次 `getprop`，`Build` 为空的 Bootloader、基础系统版本与存储加密状态回退只读属性，电池温度节点增加 `bms/temp` 候选。新增 Hook/注入映射线索、内核 TracerPid、系统分区挂载线索、可见的 Root 管理应用、运行用户环境、DRM 保护级别、dm-verity 与可调试声明、分区构建日期。安全比对升到 `rom-evidence/3`：按启动／ROM／运行时／保护／身份分组，区分「受限」「未归档」「变化」，不再把 SELinux 的推断值当成变化。设备风险画像升到 `sigmark-profile/2`，新增五类标签并统计历史受限份数。已在 Pixel 6 / Android 14 与 MI 8 / Android 10 的隔离包上实测：两台都得到「推断为强制模式」，首轮 `memfd_exec` 误报（ART JIT）已排除，受限项只剩 SELinux 策略节点与电池驱动温度。详见 [设备验证记录](docs/DEVICE-VALIDATION.md)、[字段集 17](docs/FRAMEWORK-DIAGNOSTICS.md#字段集-17进程内安全线索与读取回退) 与 [安全证据](docs/SECURITY-EVIDENCE.md)。

**1.7.0** · 通用 Android APK 扩充电池与蜂窝采集。字段集 16 新增电池存在状态、电池循环次数和默认数据卡服务状态。Android 13 及以上读取默认数据卡服务状态仅需电话状态权限。

**补充证据入口**：报告详情新增「缺项与补充证据」，列出当前非可用项、来源及复测建议；可在浏览器本地并列观察固定清单 ADB 读数，不回填 App 原报告。

**1.6.0**：新增「机器码与节点证据」。商品与 ROM 分量分别计算，设备档案展示输入、缺项和同机变化；字段集 15 增加三个固定 `/sys` 读数。见 [机器码与系统节点](docs/CONFIGURATION-EVIDENCE.md)。

**1.5.0**：手机新增「GNSS 读数核对」，报告保留 Android 原始型号年与前台回调证据；在资产档案可直接找回最近一次 GNSS 核对。字段集 14、手动上传方式不变。见 [GNSS 读数质量与复测](docs/GNSS-QUALITY.md)。

**1.4.1**：更新页以系统安装信息核对版本，并区分「可更新／当前最新／本机更新」。验收工作台展示可比的 ROM 实验回退与恢复，保留两侧原始证据；字段集 13 不变。

**1.4.0**：设备档案支持合并影响预览和有保护的撤销；手机新增主动 USB 插拔观察，并在网络、AVC 和 GLES 实验中记录起止墙钟。验收工作台保留单调时钟间隔、同资产重复次数和导出依据。离线校准按设备统计，尚不等同于独立设备证明。

**1.3.0**：App「查看扩展采集」和报告详情「扩展采集」直接显示已记录、有值及各字段集覆盖。标准采样新增 GNSS、输入、传感器和 Camera2 七项，ROM 验收另加三项离屏图形实测证据。历史快照保持原样。见 [采集字段说明](docs/FRAMEWORK-DIAGNOSTICS.md#字段集-12扩展硬件采集与图形实测)。

Android 设备采集与 ROM 验收工具。**1.1.0** 新增独立「验收工作台」，旧报告也能直接筛选同机变化、失值和受限原因；手机首页新增「网络切换实验」，记录两次观察并保存待上传报告。见 [验收手册](docs/ACCEPTANCE-1.0.md)。

0.18.2 起将「整体获取」与「上传报告」分开：在移动网络点击采集，结果保存在手机；连回后台所在 Wi-Fi 后按采集时间和网络选报告，确认才发送。重新采集、切网或重启 App 不会覆盖已保存的报告。保留设备归组、双卡诊断、链路时间线和报告批量导出。详见 [安全证据](docs/SECURITY-EVIDENCE.md) 和 [内网试验手册](docs/LAN-PILOT.md)。

资产管理顶部保留「仓库总览」，下方每部已归组手机一行。点「打开档案」查看该设备最近一次采样的 12 类参数、缺项原因和采样历史；另设在库报告、全仓字段覆盖和回收站。报告档案逐份保留。指纹安全可选样本和基线，解释启动链、保护状态和调试线索，不将配置摘要当硬件证明。见 [后台工作台](docs/WORKSPACE-UI.md)、[安全证据](docs/SECURITY-EVIDENCE.md) 和 [后续路线](docs/ROADMAP.md)。

报告可保存为命名基线，在「指纹安全」选新样本复测并导出结果。操作、API 和证据格式见 [ROM 回归工作流](docs/REGRESSION-WORKFLOW.md)。

后台「指纹安全 → 设备风险画像」列出本次观察和同一资产过往采样的区别。展开标签可查看来源、受限原因、最近一次观察到该状态的原报告，也可导出 JSON。旧报告直接可用，不必重传。它不是整机真假或反欺诈评分。[规则与验证](docs/SECURITY-EVIDENCE.md#设备风险画像)

## 构建

使用 Android Studio 打开仓库，或在命令行运行：

```powershell
.\gradlew.bat :app:assembleDebug :app:testDebugUnitTest
```

要求 JDK 17+、Android SDK Platform 36。APK 输出在 `app/build/outputs/apk/debug/app-debug.apk`。

## 当前采集范围

系统与固件、内核与 CPU、内存与存储、屏幕与显示、电池、传感器清单、网络与 Wi-Fi、移动网络。网络页包含当前链路频率、频段、信道、信号和协商速率；移动网络页区分注册运营商与 SIM 运营商，经用户授权可查看系统公开的小区无线参数。字段具有 `AVAILABLE`、`UNAVAILABLE`、`RESTRICTED`、`ERROR` 四种状态，报告保留来源及采集时间。内核编译信息走 `Os.uname()`；部分 `/proc`、`/sys` 在各 ROM 上仍可能不可读。界面可单独筛查非可用项；点按字段查看来源、长按复制数值。详见 [网络诊断与隐私](docs/NETWORK-DIAGNOSTICS.md)。

0.8 增加系统能力与运行时、相机音频与外设、安全与环境线索、应用与权限四类。首页可打开前台实时传感器面板和桌面应用权限面板。设备配置摘要使用应用可见的 Build 字段和 ABI，可随本地 JSON 保存。构建、调试、启动属性和固定路径的观察结果分别列出。

0.7 新增应用视角下的 SoC 型号和厂商、ROM 声明的硬件能力、省电模式、系统热分级、默认路由地址族、专用 DNS 状态和链路 MTU。网络摘要只保留类型、状态或数值，不记录 IP、网关或 DNS 主机名。

## 初次真机观察

在连接设备上，ADB 的 `ro.product.model` 为 `Pixel 6`、`ro.product.device` 为 `oriole`，但 App 进程内 `Build.MODEL` 为 `23078PND5G`、`Build.DEVICE` 为 `corot`，构建指纹也相应不同。MVP 如实展示应用进程可见值；这些值可能受设备环境改写，不能单独用于判断物理硬件。初版现场报告（改动前）包含 7 个分类、82 项，其中 79 项可用、2 项读取受限、1 项不可用；修订后复测为 7 类、86 项，其中 85 项可用、1 项读取受限（SELinux 模式）。详情和复测清单见 [设备验证记录](docs/DEVICE-VALIDATION.md)。

## 隐私与导出

采集在设备本地完成。完整报告包含构建信息及可用的运营商和无线参数，仅在用户确认导出并选定位置后保存。试验后台使用 Go + PostgreSQL + React + Docker Compose，只接收用户预览确认后的独立最小化载荷；权限授权和上传互不触发。见 [内网试验手册](docs/LAN-PILOT.md) 与 [后台设计](docs/BACKEND-DESIGN.md)。

本地 JSON 还含语言时区、应用自身的安装及签名信息、环境与配置摘要。可见应用面板的其他应用清单及权限详情、传感器实时值只在面板内显示。上传预览显示归档字段和仅本机项目数量。字段来源和兼容行为见 [采集字段说明](docs/FRAMEWORK-DIAGNOSTICS.md)。

字段集 22 在「查看上传参数」列出实测 CPU 核心标识、内存口径与 GPU 驱动字符串；它们都是机型级读数，不含序列号或账号。字段集 24 另列内核写入的算力权重序列（`cpu.cpuCapacity`）与预留连续内存池（`memory.cmaTotal`），同样是机型级读数。字段集 25 列出 overlay 证据串（`environment.overlayEvidence`），内容是镜像构建产物里的分区 overlay 文件名、SoC 与 SKU 候选，同样是机型级读数、不含序列号或账号。字段集 21 在「查看上传参数」列出 App 读到的产品型号和设备代号属性。这些是机型声明，不是序列号或账号，不增加设备或用户唯一标识；仍由用户手动确认发送。

开发者可阅读 [架构与数据契约](docs/ARCHITECTURE.md)；自动化协作约定见 [AGENTS.md](AGENTS.md)。

底层采集的权限边界与 `syscall` 实测见 [syscall / Native 采集边界](docs/SYSCALL-BOUNDARIES.md)。

## 图标

App 图标由 imagegen CLI/API 模式生成，主图为 [sigmark-icon-master.png](output/imagegen/sigmark-icon-master.png)，Android 多密度资源位于 `app/src/main/res/mipmap-*`。生成提示词：`Premium Android icon for SigMark; fingerprint-like concentric ridges integrated with circuit traces and a central signal node; deep midnight ink, luminous pale mint, restrained amber; centered, no text or watermark.`
