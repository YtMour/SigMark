# SigMark / 印迹

Android 设备信息采集 App。当前为 **0.1.0 MVP**：本机读取、分类展示、搜索、手动刷新、待确认项筛查、通过系统文件选择器导出 JSON。无需登录，不请求联网权限。

## 构建

使用 Android Studio 打开仓库，或在命令行运行：

```powershell
.\gradlew.bat :app:assembleDebug :app:testDebugUnitTest
```

要求 JDK 17+、Android SDK Platform 36。APK 输出在 `app/build/outputs/apk/debug/app-debug.apk`。

## 当前采集范围

系统与固件、内核与 CPU、内存与存储、屏幕与显示、电池、传感器清单、网络类型。字段具有 `AVAILABLE`、`UNAVAILABLE`、`RESTRICTED`、`ERROR` 四种状态，报告保留来源及采集时间。内核编译信息走 `Os.uname()`；部分 `/proc`、`/sys` 在各 ROM 上仍可能不可读。界面可单独筛查非可用项；点按字段查看来源、长按复制数值；分类卡默认先显示关键项与异常项，便于测试时快速浏览。显示值不代表底层硬件的完整能力。

本版暂未实现 Android ID / MediaDrm ID、指纹摘要、Root/模拟器/Hook 风险信号、实时传感器监听、历史快照、云端上传。相关设想见仓库内三份需求文档；未来涉及标识信息时应提供独立的选择与导出说明。

## 初次真机观察

在连接设备上，ADB 的 `ro.product.model` 为 `Pixel 6`、`ro.product.device` 为 `oriole`，但 App 进程内 `Build.MODEL` 为 `23078PND5G`、`Build.DEVICE` 为 `corot`，构建指纹也相应不同。MVP 如实展示应用进程可见值；这些值可能受设备环境改写，不能单独用于判断物理硬件。初版现场报告（改动前）包含 7 个分类、82 项，其中 79 项可用、2 项读取受限、1 项不可用；修订后复测为 7 类、86 项，其中 85 项可用、1 项读取受限（SELinux 模式）。详情和复测清单见 [设备验证记录](docs/DEVICE-VALIDATION.md)。

## 隐私与导出

所有采集在设备本地完成。仅用户点击“导出 JSON”、确认提醒并选择位置时写出文件。构建指纹和设备信息可能仍具有识别性，分享报告前请检查内容。

开发者可阅读 [架构与数据契约](docs/ARCHITECTURE.md)；自动化协作约定见 [AGENTS.md](AGENTS.md)。

底层采集的权限边界与 `syscall` 实测见 [syscall / Native 采集边界](docs/SYSCALL-BOUNDARIES.md)。

## 图标

App 图标由 imagegen CLI/API 模式生成，主图为 [sigmark-icon-master.png](output/imagegen/sigmark-icon-master.png)，Android 多密度资源位于 `app/src/main/res/mipmap-*`。生成提示词：`Premium Android icon for SigMark; fingerprint-like concentric ridges integrated with circuit traces and a central signal node; deep midnight ink, luminous pale mint, restrained amber; centered, no text or watermark.`
