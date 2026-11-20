# 设备验证记录与复测清单

## 0.4.0：单地址直传与移动网络（2026-11-20，Asia/Shanghai）

- **构建与装机**：Debug 预设同一局域网后台地址，构建、10 项单测和 Lint 通过；Release 合并清单仍无 `INTERNET`。Pixel 6 / Android 14 覆盖安装并冷启动。Debug SHA-256：`AA6BF13E7534B0453F11824627F56F0F83B80E3B703F08AA29EC2F1AE9ECF2DD`。
- **单地址直传**：同一局域网地址服务管理台和上报 API。用 Chrome 复测错误/正确令牌、筛选、详情和锁定；未授权 API 返回 401 且无浏览器账号密码弹框，旧邀请码接口返回 404。手机预览只有反馈输入，确认前没有写入，确认后回执与 PostgreSQL 记录匹配；旧批次报告保留。
- **无线复测**：已有精确位置授权下，手动刷新收到公开接口回调。经本地 JSON 验证可读 LTE B3、标准下行范围 1805–1880 MHz、RSRP/RSRQ/RSSNR，并且移动数据开关为开启；系统未上报 EARFCN 和信道带宽，所以精确参考频率仍为空，统一标为 `UNAVAILABLE / NOT_REPORTED`。SELinux 仍是 `RESTRICTED / ACCESS_DENIED` (`errno=13`)。
- 本次未验证 5G、其他 ROM 或公网部署。真机回归材料留在忽略目录 `app/build/lan-v04/`。

## 0.3.0：手机 → 内网后台（2026-11-20，Asia/Shanghai）

- **编译**：Debug、未签名 Release、Lint 均构建成功，9 项 Android 单测通过。检查 Release APK 权限清单，不含 `INTERNET`。Debug SHA-256：`923E28F2703860D4F637117421AF6EBC2CB67A25F58D5126B3319C508A8B866E`。
- **设备**：Pixel 6 / Android 14 覆盖安装并冷启动；未修改已有精确位置授权。已授权情况下取得 LTE 频段和信号；系统没有返回 EARFCN、参考频率所需输入或带宽，保持 `UNAVAILABLE / NOT_REPORTED`。完整本地 JSON 通过系统文件选择器保存后解析验证；仍为 8 类、`schemaVersion: 1`。
- **同 Wi‑Fi 上报**：向局域网采集端输入邀请码，预览前后数据库均无该批次记录；确认发送后 App 显示收件编号，已从管理端查询到 1 份报告和 6 项精选字段状态。通过管理端确认报告没有原始指纹、运营商或精确频点。
- **服务端与浏览器**：Go 测试、`go vet` 和 Web 构建通过；PostgreSQL readiness 正常；实测 401（缺少邀请码）、400（未知字段）、同内容幂等、409（同请求编号不同内容），采集端访问管理路由返回 404。Chrome 验证管理台加载、批次筛选、报告明细及邀请码签发。API 重建后原报告仍可读取。
- **范围**：本机和单台 Android 真机已联调；未验证公网、正式 HTTPS/SSO、USB 转发、备份恢复或多设备并发。原始验证产物留在 `app/build/lan-qa/`，不提交。

## 0.2.0：网络诊断复测（2026-11-20，Asia/Shanghai）

- **构建**：`assembleDebug`、`testDebugUnitTest`（7 项通过）、`lintDebug` 成功；Lint 仍有已有的工具链、目标版本及资源警告。APK SHA-256：`D799F0B6BE228CD9C5E29B20AE018A3AD217895CD01F42F86E69FAA12A6B939D`。
- **安装与启动**：Pixel 6 / Android 14，通过 `adb install -r` 覆盖安装 0.2.0，冷启动成功。没有切换设备网络或更改系统位置开关。
- **页面**：默认网络为 Wi-Fi。实测读取 2462 MHz / 2.4 GHz 信道 11、RSSI −45 dBm、Wi-Fi 6 及协商收发速率。移动网络页面在默认走 Wi-Fi 时仍展示已注册运营商、LTE 制式和信号等级，并标明蜂窝数据未连接。小区参数授权说明和 Android 权限弹窗均已出现；退出后保留原有未授权状态。
- **导出**：通过系统保存页生成 JSON 并解析验证：`schemaVersion: 1`，8 类、104 项，102 项可用、2 项受限。`system.selinux` 为 `ACCESS_DENIED`（`EACCES`）；`cellular.cellDiagnostics` 为 `PERMISSION_REQUIRED`。APK 无 `INTERNET` 权限；已核对导出的网络字段中没有 SSID/BSSID、IP 或小区 ID。
- **待验证**：精确位置授权后 LTE/NR 小区数据、纯蜂窝默认路由、双卡/漫游、Wi-Fi 6 GHz、VPN 和不同厂商 ROM；信道/参考频率换算通过主机单测，不等同于这些真机分支已验证。

原始采集与回归材料留在本机 `app/build/network-qa/`，不提交仓库。

## 0.1.0 基线

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

后续用 `Os.open()` 直接验证 SELinux 节点仍返回 `errno=13`（`EACCES`）。这进一步确认本机普通应用上下文的限制，不改变其 `RESTRICTED` 语义。此轮界面更新后的再次构建/安装和截图验证记录应单独核对，不沿用前次 APK 哈希。

本轮新版界面与图标再次安装后，已验证：首屏显示摘要、刷新/导出、搜索和分类；“待确认”入口能直接筛出 SELinux 限制项；导出前确认弹窗与系统保存页正常。最终导出的 JSON 为 7 类、86 项，85 项 `AVAILABLE`、1 项 `RESTRICTED`，后者附 `errno=13`。复测使用 Debug APK；截图和 JSON 保留在本机 `app/build/`，不进入 Git。

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
