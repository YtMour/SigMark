# 设备验证记录与复测清单

## 0.9.1 档案管理、App 内更新和网络回退（2026-11-20，Asia/Shanghai）

- 归档中的 MI 8 / Android 10 / 0.8.0 共 69 个上传字段。63 项可用，2 项 SELinux 节点受限，启动及构建 SELinux 属性、MTU 和 LTE 带宽共 4 项暂无数据。
- 在已连接的 Pixel 6 / Android 14 上，从 0.9.0 打开「检查更新」，发现 0.9.1 并下载。APK 校验通过，经 Android 系统界面确认覆盖安装。安装结果为 versionCode 10，重新启动并完成本地导出。网络接口回退取得 MTU 1500 字节。LTE 带宽本机仍未回报。ADB 系统侧记录读出 Enforcing，App 按自身来源保留节点受限。MI 8 的 0.9.1 回退和更新待实机验证。
- Chrome 使用独立合成批次跑通单份移动、恢复、批量移动、批量永久删除以及状态冲突回滚。既有 MI 8 报告可查询和按状态筛选，验证包括 390 px 页面。Go test、vet、Web 测试及生产构建通过。
- Android 22 项单测、Debug 构建及 Lint 通过，已发布到内网下载页。验证证据位于忽略目录 `app/build/lan-qa/v09/`。

## 0.8.0 普通应用诊断（2026-11-20，Asia/Shanghai）

- Debug APK 构建、21 项 Android 单测、Lint 和 Release 合并清单检查通过。Go 单测通过。APK 通过签名校验，免登录下载的 SHA-256 与构建产物相同，值为 `8AC3C65F0D7E220A6C60F89CB263F9A437865C320C12F202F3D2E970C3EE9502`。
- Pixel 6 / Android 14（ADB 代号 `oriole`）覆盖安装并启动。首页显示 12 类、192 项。实时面板收到加速度 XYZ 读数，切到后台后通过 SensorService 观察到注销。可见应用面板展示了所选应用的声明权限及授权状态。
- 通过系统文件选择器保存本地 JSON，读回 179 项可用、2 项受限、11 项暂无数据。系统特性、窗口边距、相机计数、存储加密和配置摘要可读。剩余能量暂无数据。SELinux 进程域可读，`enforce` 及 `policy` 均为 `RESTRICTED / ACCESS_DENIED / errno=13`。
- 内网上传预览实际展示 76 项白名单参数。单测断言本地诊断字段排除在上传投影之外。本轮验证止于上传预览，其他手机和厂商 ROM 待复测。
- APK 校验文件、界面记录及本地报告位于忽略目录 `app/build/lan-qa/diagnostics-v08/`。

## 0.7.0 · 会话、构建中心与公开下载（2026-11-20，Asia/Shanghai）

- 构建通过 `assembleDebug`、15 项 Android 单测、`lintDebug` 和 Release 合并清单检查。内网 Debug APK 签名校验通过，经免登录 HTTP 下载后 SHA-256 与本地产物一致，值为 `5441A05464AB86BEEC7348DC2145B766F2DE2076963F40304ECF7188D8CA4711`。
- 下载的 APK 已覆盖安装到 Pixel 6 / Android 14（ADB 设备代号 `oriole`）。App 页面和系统文件选择器导出的 JSON 均记录 8 类、125 项。主机验证了本地 JSON 的结构及新增字段。App 视角得到 IPv4 默认路由和专用 DNS 未启用。显式 MTU 暂无数据。SELinux 的 enforce 和 policy 均为 `RESTRICTED / ACCESS_DENIED`、`errno=13`。
- 手机在预览中确认后收到上传回执，从档案 API 按编号读回 76 项白名单参数。Chrome 验证了登录刷新、锁定与服务端会话注销、设置持久化、暂停时返回 `uploads_paused`、浏览器返回导航、APK 下载和报告 JSON 下载。设置已恢复测试前的值。桌面及 390 px 下检查布局。
- 在网页排队构建已登记的 `9923b70f`，Windows 工作进程成功生成并校验 0.6.0 APK。当前下载页仍发布本地构建并单独导入的 0.7.0。Go 测试、vet、Web 三项单测及生产构建通过。
- 第二台手机、Linux 构建主机与公网 HTTPS 环境待验证。浏览器、手机页面和 JSON 证据保存在忽略目录 `app/build/lan-qa/console-v07/`。

## 0.6.0：报告档案库与普通应用读取（2026-11-20，Asia/Shanghai）

- Debug 构建、Lint、14 项 Android 单测通过；已升级安装到 Pixel 6 / Android 14 并冷启动。APK SHA-256：`A6351782769CB5648675CD648C78170F5E14975582B4D3FBE599DC64B56722A1`。
- App 启动与本地 JSON 导出：`enforce` 和 `policy` 均保持 `RESTRICTED / ACCESS_DENIED`、`errno=13`。ENOENT、ENODEV 与其他 errno 走主机单测。已验证本机 CPU 频率与 Swap 仍可读；HDR、估算尺寸和 ROM 属性均有应用视角读数。未验证所有厂商 ROM 或底层阻塞驱动。
- 手机确认上传后，后台保存并读回 68 项白名单参数。Chrome 验证 favicon、报告检索、参数搜 `errno=13`、基线对比、JSON 下载及 390 px 移动布局，无页面级横向溢出。Go 测试/vet、Web 3 项单测与生产构建通过。
- 临时插入 127 条接收时间为 90 天前且时间戳相同的合成报告。按构建号搜索时，列表无重漏、统计为 127、详情可读；随后只清除了该合成批次。保留已有 PostgreSQL 卷；未配置自动备份或验证恢复。截图及本地报告放在忽略目录 `app/build/archive-v06/`。

## 0.5.0：SELinux 状态与参数管理台（2026-11-20，Asia/Shanghai）

- Debug 构建、Lint、13 项 Android 单测通过；已覆盖安装到 Pixel 6 / Android 14 并冷启动。APK SHA-256：`01F3EDE467D81F0C28B9E18C7E7A4155D857FCCC2BF1D13A4DCCF7601544C014`。
- App 视角：`enforce` 与 `policy` 均为 EACCES / 13，启动和构建属性未返回可识别的值。实时模式依旧未确认。ENOENT、其他 errno、标准 0/1 和非法值走主机单测，本机未出现这些分支。真机本地导出仍为 schema 1，含结构化 `errno: 13`、来源和空状态值。
- 真机确认上传后，服务端收存 schema 2 的 64 个白名单参数。读回验证 Wi-Fi 2462 MHz、RAM 12.00 GiB、LTE 信号及 SELinux errno。上报不含构建指纹、运营商或精确小区频点。Chrome 验证详情、按值搜索、仅看待确认及旧版报告说明；Go 单测和 vet、Web 构建通过。
- 单独批次写入 127 条同时间戳的合成报告，经部署 API 读出 30/30/30/30/7 条，无重复或遗漏。测试后仅清除该合成批次。既有报告及 30 天保留策略不变。原始证据留在忽略目录 `app/build/lan-v05/`。

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
