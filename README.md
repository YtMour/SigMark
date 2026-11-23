# SigMark / 印迹

Android 设备信息采集 App。**0.19.0** 的「指纹安全」分别展示设备是否经过独立验证、五项本机系统保护，以及手动检查的三类特殊授权。规则与局限见[指纹安全说明](docs/SECURITY-EVIDENCE.md)。

0.18.2 起将「整体获取」与「上传报告」分开：在移动网络点击采集，结果保存在手机；连回后台所在 Wi-Fi 后按采集时间和网络选报告，确认才发送。重新采集、切网或重启 App 不会覆盖已保存的报告。保留设备归组、双卡诊断、链路时间线和报告批量导出。详见 [安全证据](docs/SECURITY-EVIDENCE.md) 和 [内网试验手册](docs/LAN-PILOT.md)。

后台六页统一使用同一套工作台导航。资产管理顶部保留「仓库总览」，下方默认每部已归组手机一行，点「查看采样」看历史；另设在库报告、字段覆盖和回收站。报告档案逐份保留。指纹安全可选样本和基线，解释启动链、保护状态和调试线索，不将配置摘要当硬件证明。见 [后台工作台](docs/WORKSPACE-UI.md)、[安全证据](docs/SECURITY-EVIDENCE.md) 和 [后续路线](docs/ROADMAP.md)。

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

开发者可阅读 [架构与数据契约](docs/ARCHITECTURE.md)；自动化协作约定见 [AGENTS.md](AGENTS.md)。

底层采集的权限边界与 `syscall` 实测见 [syscall / Native 采集边界](docs/SYSCALL-BOUNDARIES.md)。

## 图标

App 图标由 imagegen CLI/API 模式生成，主图为 [sigmark-icon-master.png](output/imagegen/sigmark-icon-master.png)，Android 多密度资源位于 `app/src/main/res/mipmap-*`。生成提示词：`Premium Android icon for SigMark; fingerprint-like concentric ridges integrated with circuit traces and a central signal node; deep midnight ink, luminous pale mint, restrained amber; centered, no text or watermark.`
