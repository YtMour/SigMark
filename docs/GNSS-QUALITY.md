# GNSS 读数质量与复测

## 为什么 Redmi 报告显示 2016？

在 LAN 归档中复核 Redmi 23076RA4BC（Android 14，SigMark 1.4.1，字段集 13；2026-11-23 20:56:12 Asia/Shanghai）：`system.gnssHardwareYear` 原始值是 `2016 / AVAILABLE`，来源是 `LocationManager.getGnssYearOfHardware`，不是后台换算。MI 8 同批报告为 2018，Pixel 6 的 App 视角报告为 2020。

[Android API 定义](https://developer.android.com/reference/android/location/LocationManager#getGnssYearOfHardware())是 GNSS **硬件与软件构建的型号年**。2016 是有效年份，与整机上市或芯片制造日期不是同一概念。`0` 是「型号年早于 2016，未提供具体年」；平台在无 GNSS 服务时也可能返回 0，因此结合 GPS 提供器和功能声明，不把 0 当作硬件存在的证明。旧报告无值保持无值，不补成 0。非零小于 2016、超出采样时设备 UTC 年份的读数会保留并标记复核，后者先核对设备时钟。上市年份不是采集值或规则阈值。

## 从可疑读数到复测

1. 报告 → 参数 → 展开「GNSS 硬件与软件型号年」。核对原值、来源、当次采样时间、声明一致性、前台实测和独立性；稳定旗标随工作台证据包导出。
2. 手机在该字段点「核对 GNSS 读数」，也可从「更多工具 → GNSS 读数核对」进入。授权精确位置并打开系统位置后，在开阔处点击「开始前台实测」。最多等待约 20 秒，关页或退到后台即注销。未见事件不是 GNSS 故障，也不是没授权；分别看回调字段的状态。
3. 点击「保存本机报告」，随后手动上传并勾选同设备关联。资产档案的「最近一份 GNSS 核对报告」只引用这个资产在库的实验报告；后续标准报告不会覆盖实验链接。网页不远程开启定位。

Android 28+ 公开型号年与型号名称。Android 30 的公开 SDK 仅提供 `GnssCapabilities.hasGnssAntennaInfo`，按版本调用；API 31+ 才把公开的测量、导航消息和天线能力作为组合读数。[Android 11 SDK 签名](https://github.com/aosp-mirror/platform_frameworks_base/blob/android-11.0.0_r1/api/current.txt)。

## 字段集 14 与隐私

新增静态字段：`system.gnssProvider`、`system.gnssModelReported`、`system.gnssAntennaSupport`。仅「GNSS 读数核对」方案归档 `gnssCheckPrerequisite/Status/Measurements/StartAt/EndAt/Elapsed`，含起点条件、两个独立回调的有无、墙钟端点及单调时钟耗时。真正进入前台观察但未获得非空回调记录为 `not_seen`；权限、接口或调用异常分别保留原状态。仅为启动 GNSS 请求临时 GPS 更新，不读取坐标属性；不持久化或上传坐标、轨迹、卫星标识、原始测量和名称。原始 OEM 型号名称仅在本机及用户主动导出的完整本地报告中。

`sigmark-field-quality/1` 是派生质量规则，不覆盖原报告或风险等级。Android 多个公开接口可能共享 GNSS 服务/HAL，交叉结果只能用于一致性核对；非空回调是功能性观测，不是独立验证。ADB 只用于另一观察视角，既不替换 App 读数也未必独立于同一 HAL。Android Key Attestation 验证密钥与启动链的一部分，不验证 GNSS 型号年。

## 方法参考（没有复用外部实现）

| 参考 | 可借鉴点 | SigMark 的取舍 |
| --- | --- | --- |
| [Google GnssLogger / gps-measurement-tools](https://github.com/google/gps-measurement-tools) · Apache-2.0 | 主动订阅 GNSS 状态与测量 | 只取事件有无，不记录科研级原始测量。 |
| [NetMonster Core](https://github.com/mroczis/netmonster-core) · Apache-2.0 | 多来源交叉核对，区分推断与读数 | 先为 GNSS 保留每个来源、前置条件及独立性；不靠一个字段推导数据卡身份。 |
| [WiFiAnalyzer](https://github.com/VREMSoftwareDevelopment/WiFiAnalyzer) · GPL-3.0 | 标明采样时效与信道、频率单位 | 仅作交互与方法参考，未引入代码；Wi‑Fi 频率先加格式质量旗标。 |
| [KeyAttestation](https://github.com/vvb2060/KeyAttestation) | 本机钥匙证明解析和状态解释 | 用于比照功能边界；仓库未确认有统一许可，不复用代码。 |
| [GrapheneOS Auditor](https://github.com/GrapheneOS/Auditor) · MIT | 另一设备/服务验证、配对和信任根 | 未来独立验证单列，不用本次 GNSS 回调提高设备身份信任级别。 |

## 复跑

Android：`./gradlew.bat :app:assembleDebug :app:testDebugUnitTest`。要隔离手机试验，可加 `-PSIGMARK_QA_ISOLATED=true` 和 `:app:assembleDebugAndroidTest`，得到 `com.sigmark.app.qa`，与现有安装及草稿分离。此包用 `adb shell am instrument -w -r -e gnss check com.sigmark.app.qa.test/com.sigmark.app.CapabilitySmoke` 核对本机读数及上传投影，不发送请求。后台用 `qa_device_profile.py --browser` 在隔离 PostgreSQL 注入合成 GNSS 样本；验证同资产回链、历史保留、320 px 阅读、键盘展开及证据包。
