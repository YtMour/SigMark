# 设备验证记录与复测清单

记录日期：2026-11-20（Asia/Shanghai）。测试设备由 ADB 报告为 Pixel 6 / `oriole`，Android 14 / API 34。该设备应用进程读取的型号与 ADB 属性不同，因此本记录将两者区分。

## 已观察到的限制

| 字段 | 应用身份下现象 | 处理 |
| --- | --- | --- |
| `/proc/version` | Permission denied | 改用公开的 `Os.uname()` 获取内核名、release、编译版本与架构；语义标注为“内核编译信息” |
| `/sys/fs/selinux/enforce` | Permission denied | 保留 `RESTRICTED`，明确说明这不是 SELinux 模式结论 |
| `/proc/cpuinfo` | 可读，但无 `Hardware` / `model name` | 解析 `CPU implementer`、`CPU part`、`CPU architecture` 等现有字段作为 CPU 描述 |
| `Build.MODEL` 等 | App 显示 `23078PND5G` / `corot`，ADB 显示 `Pixel 6` / `oriole` | UI 与文档标记为“应用进程视角”，报告保留原始值 |

初版现场报告（改动前）为 7 类、82 项：79 可用、2 受限、1 不可用。以上仅是现场观察，不代表所有 Android 机型。

本次修订后再次安装并导出：7 类、86 项，85 项可用、1 项受限（SELinux 模式）。内核编译信息、CPU 描述与指令特性、首核最高频率、低内存阈值及电池电流均有值。导出前提醒与系统保存界面已实际验证；调试版单元测试为 4/4 通过。该结果只代表当前连接设备及其应用进程视角。

## 复测步骤

```powershell
.\gradlew.bat :app:assembleDebug :app:testDebugUnitTest
adb devices -l
adb install -r .\app\build\outputs\apk\debug\app-debug.apk
adb shell am start -n com.sigmark.app/.MainActivity
```

在手机上检查：

1. 首页采集完成、分类和搜索可用，返回桌面再进入仍可刷新。
2. “查看受限 / 待确认”可定位异常项；点按普通字段可查看来源。
3. 内核编译信息与 CPU 描述有值；SELinux 模式若受限应显示原因，而非猜测值。
4. 导出前有内容提醒；通过系统文件选择器保存 JSON 后核验 `schemaVersion`、状态、来源和内容。
5. 用 `adb logcat` 排查启动或导出异常；使用不同 Android 版本与厂商 ROM 重复验证。

报告含设备识别信息，真机 JSON 和截图只保留在本地构建目录，默认不提交仓库。
