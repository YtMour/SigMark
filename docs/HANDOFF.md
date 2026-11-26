# SigMark 智能体交接 · 1.21.2 / 字段集 25

更新于 **2026-11-25（Asia/Shanghai）**。接手先读 [仓库约定](../AGENTS.md) 和本页，再从 [路线图](ROADMAP.md) 选任务。本文区分已实现、已验证和待办；历史记录里的旧规则不代表现行行为。

## 现在交付到哪里

| 层 | 当前状态 | 以什么为准 |
| --- | --- | --- |
| Android | **1.21.2（50）已发布到构建中心**，Android 8.0 / API 26 起；采集、本机判断、实测硬件核对、overlay 代号与证据串核对、内核口径核对已实现 | [构建配置](../app/build.gradle.kts)、[Android 投影](../app/src/main/java/com/sigmark/app/lan/LanDetails.kt) |
| 内网后台 | 代码与部署均已支持 LAN JSON `schemaVersion: 4`、最新字段集 **25**（`latestFieldSet=25`、词典 `sigmark-lan-fields/16`、235 个静态键、`maxFields` 分档 `>=25 → 259`） | [协议白名单](../backend/cmd/sigmark/protocol.go)、[部署手册](LAN-PILOT.md) |
| 默认更新 | **已是 1.21.2（50）**。构建中心 job id `b62209513e1b43c991ae4964dbf248a0`，发布方式 `build_worker.py import-apk --publish`；`GET /api/downloads/current` 返回 `version=1.21.2 versionCode=50 size=12006913 sha256=85ec158f… signerSha256=e424900e…`。下载渠道不再是 1.16.0（43） | 管理端「构建中心」与 `GET /api/downloads/current`，两者分别核对 |
| 规则 | 字段词典 `sigmark-lan-fields/16`（235 个静态键）；观测风险 `sigmark-observation-risk/5`；复测 `rom-evidence/6`；资产画像 **`sigmark-profile/8`**（新增 `sdm845` 登记会改变该家族设备的判定结果，故升版；证据行仍 10 条、标签仍 10 个）；仓库身份分布 `sigmark-identity/2` | [检查口径](SECURITY-EVIDENCE.md)、[复测契约](REGRESSION-WORKFLOW.md) |
| 真机闭环 | 1.21.2 在 **Pixel 6（改装）与 Xiaomi MI 8（未改装，API 29）两台**上完成安装、本机采集（各 258 项）、证据导出与**真实上传**（Pixel 6 报告 `745264e0…`／归档 207 项／`state=hit`；MI 8 报告 `77e577c1…`／归档 204 项／`state=not_observed`），两台均 `assetLinked=true` | [设备验证记录](DEVICE-VALIDATION.md)，勿用浏览器模拟或构建成功代替 |

**试装 APK（当前主机、Git 忽略的构建产物）**：`D:\SigMark\app\build\outputs\apk\debug\SigMark-1.21.2-LAN-debug.apk`（1.21.2 / 50，字段集 25，**12 006 913 字节**，已注入 LAN 地址 `http://192.168.1.114:48272`，手机端上传入口可用）。SHA-256：`85ec158ffa40737f70c2c0988b1e85bf3e114c22ddd1948362cec337ae134833`。**此版已发布到构建中心**（job id `b62209513e1b43c991ae4964dbf248a0`，`signerSha256=e424900e…`）。此前所有散列（`b80abba5…`、`30e015d3…`、`0debb136…`）**全部作废**，中间产物不再可用。1.21.2 相比 1.21.0 多了两处实质改动：`SafeReader.listNames` 改为先 `Os.stat` 再列举（修掉「被拒目录被报成目录不存在」的真实缺陷），以及 SoC 登记表新增 `sdm845`。更早的 1.21.0（`b80abba5…`）、1.20.0（`4fa62aab…`）、1.19.0（`d5152b1c…`）、1.18.0（`525c21ba…`）与 1.17.0（`aff1a40f…`）仍在同目录。重新构建后应重新校验版本、来源地址、签名和散列；不同构建主机可能没有同一签名密钥。

**源码交接**：2026-11-25 主工作目录 `D:\SigMark`，分支 `main`，HEAD `37cd7cf`，包含多轮尚未提交的修改和新文件。只拉取 HEAD 会漏掉当前实现。接手先执行 `git status --short`，保留现有修改；若另建工作环境，先确认当前工作树的源码如何交接。尤其别漏掉 `IdentityConsistency.kt`、`HardwareConsistency.kt`、`SecurityProbes.kt`、`identity_consistency.go`、`hardware_facts.go`、`lan-projection-v25.txt`、`lan-projection-v24.txt`、`lan-projection-v23.txt`，也要保留现有的历史对照新文件。交接源码不夹带 `.env`、签名密钥、真实报告或整个数据库卷。

## 采集与结论的边界

1. **产品主流程**：手机「整体获取」→ 本机保存并检查 → 用户选择报告、预览并确认上传 → 后台打开归档即检查。上传不会再次采集。App 使用普通应用权限；验收不使用 ADB、root 或其他观察者补齐 App 读数。
2. **同义核对证明的是“改写是否完整”，实测核对才碰到硬件。** 字段集 21 的型号／设备代号／SKU 三对读数可能被同一改写层一起覆盖，全一致也只能说改写自洽。字段集 22 另加三条不走声明链的通道：`/proc/cpuinfo` 的全分块 MIDR、`/proc/meminfo` 与 `sysconf` 的内存口径、EGL 报告的 GPU 字符串；字段集 23 再加一条构建产物通道：`/proc/self/maps` 里 framework RRO overlay 文件名带的产品代号；字段集 24 再加两条**内核写入值**：`/sys/devices/system/cpu/cpu{N}/cpu_capacity` 的算力权重序列，和 `/proc/meminfo` 的 `CmaTotal` 预留连续内存池；字段集 25 把 overlay 代号扩成**多路径冗余证据串** `environment.overlayEvidence`（`rro:` / `idmap:` / `vendor_dir:` / `product_dir:` / `system_ext_dir:` / `odm_dir:` / `sku:` / `soc:` / `conflict:`）。任何一条与声明冲突都只提示核对测试条件，仍不判定设备真伪；SoC 不在登记表内、或实测值不在登记表内一律记未确认，不猜。伪装面与盲区的完整清单见 [机型伪装可覆盖面与盲区](DEVICE-DISGUISE-SURFACE.md)。
3. **把证据缺口与异常分开。** `RESTRICTED` 是明确拒读，`UNAVAILABLE` 是未上报／无有效值，`ERROR` 是读取失败，`NOT_ARCHIVED` 是后台判定归档缺行，不是 App 写入的采集状态。任一可比对有差异才提示复核；部分读数一致仍不是完全覆盖。旧报告保持原样，新派生规则可以复算但不回写。
4. **历史 6 项是外部对照，不是 App 的 6 项异常。** 它来自早期 App 报告和同机电脑 ADB 读数，保持在默认收起的「辅助对照 · 外部记录」。同资产页可能显示来源报告的历史对照；不代表当前样本重采到了同样差异，不纳入 App 分级、风险依据导出或设备身份验证。不要以“凑齐 6 项”为验收指标。
5. **界面与隐私**：首页和上传确认页只放结论、必要提示和主要操作。字段键、来源、详细原因留在可展开详情和导出；不增加唯一设备标识或后台自动上传。资产归组是显式关系，不用于确认物理设备身份。
6. **上传被 400 拒收时，先查字段集是否对齐，不要先怀疑设备时间。** 客户端 `LanFieldSetVersion` 现在是 25，后台 `latestFieldSet` 也曾短暂落后过（23→24→25 都经历过）；两者不一致时后台会**整份拒收**，而客户端把 400 统一提示为「报告未通过校验。请检查设备时间，刷新采集后重试。」（[LanReport.kt:131](../app/src/main/java/com/sigmark/app/lan/LanReport.kt)），这条文案会把排查方向带偏。正确顺序是：① 比对手机 App 的字段集与后台 `GET /api/admin/field-dictionary` 的 `latestFieldSet`／`dictionaryVersion`；② 再看报告 `capturedAt` 是否越界；③ 最后才怀疑设备时间或签名。在客户端把这条提示按错误码细分之前，交接和现场排查都要按这个顺序走。

## 接手优先级

### P0 · 字段集 25 的后台闭环（已完成）＋ 三项遗留收口（已完成）

**本轮（1.21.2 / 50）已完成**：上一版列的「已知未覆盖项」第 1、2、3 条全部做掉了，并额外登记了一个 SoC。

1. **仪器测试（原第 1 条）**：新增 `app/src/androidTest/java/com/sigmark/app/collector/SafeReaderInstrumentedTest.kt`，**22 条断言全 PASS**。跑法是 `-e probe`，不是 `-e class`（runner 是手写 Instrumentation）：

   ```powershell
   adb -s 35241FDF6S1P3K shell am instrument -w -e probe safereader com.sigmark.app.test/com.sigmark.app.CapabilitySmoke
   # → SafeReader instrumented: 22 passed, 0 failed
   ```

   覆盖 `cpuCapacitySignature` 9 条（非空、每段正整数、无重复段、`maxCores=1` 只有一段、`maxCores=0` 返回 null、段数不超存在核心数）与 `listNames` 13 条（可读目录 `/proc/self/task`、升序、默认上限 64、`maxEntries=3`、不存在路径、被拒目录 `/data/resource-cache`）。

2. **浏览器 QA（原第 2 条）**：`backend/web/package.json` 加 devDependency `playwright ^1.65.1`（**不下载自带 Chromium**，用系统 `channel:'chrome'`，回落 `msedge`）；新增 `backend/web/qa/run-browser-qa.cjs` 与 `backend/web/qa/README.md`，加 `"qa": "node qa/run-browser-qa.cjs"`。对着真实部署 `http://192.168.1.114:48272` 实跑，两个脚本 PASS。同时修掉三处**脚本假设问题**（不是 UI 缺陷）：`details[open]` 计数过严（真实报告有 11 个展开项，因 `device-profile.tsx:61` 在有历史时额外渲染 `data-profile="identity-history"`）、`ROM-B`／`未授予精确位置` 是种子数据假设、`/errno=13/` 撞 strict mode。

3. **SKU per-UID 跨机型（原第 3 条）**：第二部手机是 **Xiaomi MI 8（`dipper`）API 29、内核 4.9.186、未改装**。结论有反转——per-UID 改写**不是 Android 行为，是改机层行为**：未改装机上 `ro.boot.hardware.sku` 根本不存在（两个 UID 都读空），`model`／`device` 两 UID 一致。因此「属性一律按 UID 改写」收窄为「**被改装的设备上属性按 UID 改写；未改装设备上两个 UID 一致**」。详见下文「真机 B」与 [设备验证记录](DEVICE-VALIDATION.md)。

4. **新增 SoC 登记 `sdm845`**：画像规则因此 `sigmark-profile/7` → **`/8`**（新增登记会改变该家族设备的判定结果）。登记内容 label `Snapdragon 845`、cores `0x802`／`0x803`、gpu `adreno`、alias `snapdragon 845`，**capacities 与 cmaMiB 故意留空**（内核 4.9 不暴露 `cpu_capacity`；`CmaTotal` 是设备树值不是 SoC 常量，不猜），通过 `ro.board.platform` 解析（API 29 没有 `ro.soc.model`）。证据行仍 10 条、标签仍 10 个。

**本轮还修掉一个真实缺陷（重要）**：仪器测试暴露了 `listNames` 的行为错误——原来 `File.list()` 对「不存在」和「无权限」都返回 `null`，两者都落到 `UNAVAILABLE / NOT_REPORTED`，**被拒的目录被报成「目录不存在」**，这正是伪装检测最不能犯的错（把「读不到」当成「没有」）。现在先 `Os.stat(path)`：stat 抛 ENOENT/ENOTDIR → `UNAVAILABLE / NODE_MISSING`（errno 有值）；stat 成功但不是目录 → `UNAVAILABLE / NODE_MISSING`（detail「该路径存在但不是目录。」）；stat 成功但 `list()` 返回 null → **`RESTRICTED / ACCESS_DENIED`，errno=13**，detail「目录存在（stat 可见）但列出条目被拒绝，不能据此断言其中没有文件。」；正常 → `AVAILABLE`，升序、截断。实测 `/data/resource-cache` 从 `UNAVAILABLE/NOT_REPORTED` 变为 `RESTRICTED/ACCESS_DENIED errno=13`；`SecurityProbes.scanOverlayDir` 相应简化为只看 `RESTRICTED`。

**上一轮（1.21.0 / 48，字段集 25 主功能）已完成**：Pixel 6 采集 258 项、归档 207 项、`fieldSet=25`、`assetLinked=true`；后台 `latestFieldSet=25`、词典 `sigmark-lan-fields/16`（235 项）、`maxFields >=25 → 259`、`/readyz` ready。当时报告 `7c786f17-5652-4070-8e86-42066093200e`（`requestId=5b1dbad0-7f74-42d2-b48c-4778e280213d`）。1.21.2 上真机重采后报告换成下面这一组。

**再上一轮（1.20.0 / 47，字段集 24）已完成**：快照 257 项、归档 206 项、报告 `c0f517f1-5bc6-4766-a7ae-3c507bf4c07d`（`requestId=a9fa8fbf-424c-4d59-b82d-0e427b84c030`）；`cpu.cpuCapacity = 160/498/1024`、`memory.cmaTotal = 652 MiB` 两条均与 `gs101` 登记值一致而与声明 `mt6985` 冲突。

**仍未覆盖，属于下一步**：

1. 换机型复测：API 26–28 与其它非 AOSP ROM 上核对 `cpu.cpuCapacity`、`memory.cmaTotal`、`environment.overlayEvidence` 的可读性与状态。设备类别来自人工登记，不从型号字符串反推。目前只有 Pixel 6（改装）与 MI 8（未改装，API 29）两台样本。
2. 后台稳定性对照：由操作者分别确认上传两台设备的真机样本，不改变全局接收批次或历史报告。合成数据只进临时隔离栈。
3. 兼容性收口：确认字段集 21–24 客户端仍能被接收，v25 新键在 v24 报告里被拒绝（`environment.overlayEvidence` 的 `since=25`）。
4. 登记表补全：`mt6985`、`sm8550`、`sm8450`、`sm8250` 的 `capacity_profile` 与 `CmaTotal` 目前为空，只有 `gs101` 有值；`sdm845` 是**故意留空**（见上）。补之前，这两条通道对非 Tensor 机型只能判未确认——这是设计如此，不是缺陷。
5. 回滚风险：回滚到字段集 22 会让 v23+ 客户端整份 400，而客户端提示是「请检查设备时间」，完全误导。回滚与兼容细节见 [发布与回滚兼容](RELEASE-COMPAT.md)。
6. **`sku:` 通道只是旁证**：被改装的 Pixel 6 上 `ro.boot.hardware.sku` 在 shell（`GR1YH`）与 `run-as`（`23078PND5G`）之间分裂，App 侧声明 SKU 与三个 overlay 候选都不匹配，按设计退回「逗号并列全部候选」（`sku:g9s9b,gb7n6,gr1yh`）。它**不参与代号判定**，代号仍由 `rro`／`vendor_dir`／`product_dir` 裁决。未改装的 MI 8 上该属性**根本不存在**（两个 UID 都读空），因此这条通道在旧机型上是诚实降级。

### P1 · 提升判定质量，先不扩大采集范围

- **统一身份子规则的跨栈用例**：补一份 Kotlin、Go、TypeScript 共用的固定样本表，覆盖同义匹配／冲突、部分匹配、拒读、占位符、旧字段集、API 30/31 边界、非等价主板／平台、外部对照不进入分级。断言可比对数和结果；手机与后台的整体分级有各自口径，不把身份子规则一致等同于两端总体标签相同。
- **传感器指纹值得做，相机指纹明确不做**：复测确认传感器侧 App 的 37 项与 shell 的 `Total 37 h/w sensors` 逐项同名同 vendor，全是 Pixel 6 原厂器件，可作 `type + name + vendor` 通道；相机侧改机层注入了整个假 HAL provider（`ICameraProvider/ym/0-1`，设备 `ym/42`、`ym/43`），App 只看到伪造的 2 路，真机 `internal/0`、`internal/1` 不可见——通道已被接管，拿它当指纹等于用伪装层的答案审伪装层。细节见 [传感器与相机指纹级比对](SENSOR-CAMERA-FINGERPRINT.md) 与 [伪装面与盲区](DEVICE-DISGUISE-SURFACE.md) 第三节第 6 小节。
- **分清可读性与 ROM 回归**：从同一资产、较早、测试条件相近的基线出发；字段集变化与权限变化单列。结合已上线的 AVC/GLES、网络、GNSS 等按已知条件复现；防止把同一资产的重复采样当作许多独立设备。ROM 团队只接收实验编号、构建、可复现步骤和必要的脱敏读数，不把跨来源差异作为修 ROM 的直接结论。

### P2 · 有明确需求才另立功能

- 独立设备证明是后续功能，与当前本机密钥自测、App 声明和配置摘要分开。先明确参考设备、验证策略和隐私边界，再设计测试，保持“不支持、未执行、验证失败”可区分；不把此项列为已交付。
- 新字段须先说明它回答什么问题、设备/API 适用性、来源／单位／状态和获益。若确需上传，再同步修改 Android 投影、Go 白名单、词典、共享注册表、隐私提示和兼容测试；不改写旧报告。

## 代码入口与复验

| 任务 | 入口 |
| --- | --- |
| App 采集与冻结 | [DeviceCollectors.kt](../app/src/main/java/com/sigmark/app/collector/DeviceCollectors.kt)、[SafeReader.kt](../app/src/main/java/com/sigmark/app/collector/SafeReader.kt)、[MainViewModel.kt](../app/src/main/java/com/sigmark/app/MainViewModel.kt) |
| 端上结论与上传交互 | [IdentityConsistency.kt](../app/src/main/java/com/sigmark/app/security/IdentityConsistency.kt)、[HardwareConsistency.kt](../app/src/main/java/com/sigmark/app/security/HardwareConsistency.kt)、[DevicePosture.kt](../app/src/main/java/com/sigmark/app/security/DevicePosture.kt)、[SecurityPanel.kt](../app/src/main/java/com/sigmark/app/SecurityPanel.kt)、[LanReportDialog.kt](../app/src/main/java/com/sigmark/app/lan/LanReportDialog.kt) |
| LAN 契约锁步 | [LanReport.kt](../app/src/main/java/com/sigmark/app/lan/LanReport.kt)、[v25 共享字段表](../app/src/test/resources/lan-projection-v25.txt)（235 行；旧版对照仍在 [v24](../app/src/test/resources/lan-projection-v24.txt)、[v23](../app/src/test/resources/lan-projection-v23.txt)）、[protocol.go](../backend/cmd/sigmark/protocol.go)、[field_dictionary.go](../backend/cmd/sigmark/field_dictionary.go) |
| 后台观测与历史 | [security-rules.ts](../backend/web/src/security-rules.ts)、[risk-assessment.ts](../backend/web/src/risk-assessment.ts)、[identity_consistency.go](../backend/cmd/sigmark/identity_consistency.go)、[device_profile.go](../backend/cmd/sigmark/device_profile.go)、[hardware_facts.go](../backend/cmd/sigmark/hardware_facts.go)、[identity_summary.go](../backend/cmd/sigmark/identity_summary.go) |
| 独立历史对照 | [observation-panel.tsx](../backend/web/src/observation-panel.tsx)、[identity_review.go](../backend/cmd/sigmark/identity_review.go)，不接入 App 观测分级 |
| 专题文档 | [机型伪装可覆盖面与盲区](DEVICE-DISGUISE-SURFACE.md)、[overlay 代号多路径冗余抽取](OVERLAY-ROBUSTNESS.md)、[传感器与相机指纹级比对](SENSOR-CAMERA-FINGERPRINT.md)、[发布与回滚兼容](RELEASE-COMPAT.md) |

已落地并验证（字段集 25）：`protocol.go` 新增 `environment.overlayEvidence`（`since=25`，值域 `^[a-z0-9_,]+$` 的通道串，含冲突串校验），`maxFields` 增加 `>=25 → 259` 分档；`field_dictionary.go` 升到 `latestFieldSet=25`、词典 `sigmark-lan-fields/16`（235 个静态键），部署后 `/api/admin/field-dictionary` 已确认；fixture `lan-projection-v25.txt` 235 行；手机侧 `SecurityProbes.kt` 新增多路径抽取（`maps` 的 framework RRO → `maps` 的 idmap → 四个分区 overlay 目录扫描），目录列举走 `SafeReader.listNames`（`bounded` 400 ms 包裹 + `Os.stat` 三态判别），`LanReport.kt`／`LanDetails.kt` 同步白名单。画像规则已升到 **`sigmark-profile/8`**：新增 `sdm845` 登记，证据行仍 10 条、标签仍 10 个。

真机 A（Pixel 6，改装机，1.21.2 / 50，APK SHA-256 `85ec158f…`）：本机快照 258 项，LAN 归档 **207** 项，`fieldSet=25`，`assetLinked=true`。真实上传报告 `745264e0-3227-452b-bb87-65f9bd314fe9`（`requestId=70233f02-5043-445b-ae11-28e2a901f906`），后台 `hardware_declaration_conflict` **`state=hit`**，10 条证据全 `AVAILABLE`，含 `cpu.cpuCapacity=160/498/1024`、`memory.cmaTotal=652 MiB`。两条 overlay 字段实测值：

- `environment.overlayEvidence = AVAILABLE · rro:oriole / vendor_dir:oriole / product_dir:oriole / sku:g9s9b,gb7n6,gr1yh / soc:gs101 · /proc/self/maps + /vendor|product|system_ext|odm/overlay`
- `environment.overlayDeviceCodename = AVAILABLE · oriole · /proc/self/maps`（旧字段保留不变）
- `overlay_codename` 行 = `REVIEW · 属性报告的设备代号为 corot，镜像 overlay 记录的却是 oriole。…`

**`sku:` 段的偏差已实测解释**：设计预测 `sku:gr1yh`，真机是 `sku:g9s9b,gb7n6,gr1yh`。因为改装层的按 UID 改写也覆盖了 `ro.boot.hardware.sku`——shell 读到 `GR1YH`，`run-as com.sigmark.app` 读到 `23078PND5G`，App 侧声明 SKU 与三个候选全不匹配，按设计退回逗号并列。**这是设计正确降级**，`sku:` 只作旁证、不参与代号判定。详见 [overlay 代号多路径冗余抽取](OVERLAY-ROBUSTNESS.md) §3.4。

真机 B（Xiaomi MI 8 / `dipper`，**未改装**，API 29，内核 4.9.186，1.21.2 / 50）：本机快照 258 项（`AVAILABLE=233`、`UNAVAILABLE=21`、`RESTRICTED=4`），LAN 归档 **204** 项，`fieldSet=25`，`assetLinked=true`。真实上传报告 `77e577c1-c84b-4c5e-bb53-a9fe882be7bf`（`requestId=63807aa3-da73-45d7-b6af-9836352b38d0`）。后台 `/device-profile` 返回 `ruleVersion=sigmark-profile/8`、10 个标签、`hardware_declaration_conflict` **`state=not_observed`**（一致，不是 hit）。证据行实测值：`memory.totalRam/physicalRam/kernelMemTotal` 全 `5.50 GiB`；`cpu.cpuParts = 0x51:0x802×4 / 0x51:0x803×4`；`runtime.glesRenderer = Adreno (TM) 630`；`system.device = dipper`；`memory.cmaTotal = 200 MiB`；`system.socModel = NOT_ARCHIVED`（API 29 无 `ro.soc.model`）；`environment.overlayDeviceCodename = UNAVAILABLE`；`cpu.cpuCapacity = UNAVAILABLE`。

**MI 8 的两个降级事实要记住**：① 内核 4.9 不暴露 `cpu_capacity`，`cpuCapacity` 记 `UNAVAILABLE/NOT_REPORTED`——**不是 0，不是猜**；② MIUI 的 overlay 是自有命名（`CarrierConfigResCommon.apk`、`AccentColorBlack` 等），没有 `__device_user__auto_generated_rro` 模式，`overlayEvidence` 记 `UNAVAILABLE`。这两条恰好证明新字段在旧内核／非 AOSP ROM 上是**诚实降级**，不是崩掉。

上一轮（1.21.0 / 48 / 字段集 25 主功能）记录：Pixel 6 报告 `7c786f17-5652-4070-8e86-42066093200e`、归档 207 项。再上一轮（1.20.0 / 47 / 字段集 24）：快照 257 项、归档 206 项、报告 `c0f517f1-5bc6-4766-a7ae-3c507bf4c07d`；`cpu.cpuCapacity = 160/498/1024`、`memory.cmaTotal = 652 MiB`。再上一轮（1.19.0 / 字段集 23）：Android 单测 115 项、采集 255 项、报告 `4263018e…`、归档 204 项、8 条证据。

测试（1.21.2 完成时点）：Android JVM 单测 27 类 / **139 项** / 0 失败；Android **仪器测试 22 条断言全 PASS**；Go `go test -count=1 ./...` 全绿、`go vet` 干净；Web `npm test` **85 / 85 / 0**、`npm run build` exit 0；**浏览器 QA 两个脚本 PASS**。字段集 26 落地后这些项数会变，以最新一次运行为准。

**已知未覆盖（真实限制，不要写成已完成）**：
1. `cpuCapacitySignature` 的 ENOENT 跳过分支、`bounded` 的 400 ms 超时分支、`cpuCapacity` 的非 ENOENT errno 分支**仍然测不了**：`cpuCapacityBase` 是私有常量无法注入，本机 cpu0–cpu7 八个 `cpu_capacity` 全部存在且可读，超时分支需要卡死的挂载点才能复现。
2. `backend/scripts/qa_device_profile.py` **已过期且未修**：它硬断言 `latestFieldSet==21`、`dictionaryVersion=='sigmark-lan-fields/12'`、`ruleVersion=='sigmark-profile/5'`、9 个标签、`buildId=='ROM-B'`、字段集 12，而现在分别是 25 / `/16` / `/8` / 10 个标签 / 真机值。它会在跑到浏览器之前就失败。
3. MI 8 的 `cpu.cpuCapacity` 与 `environment.overlayEvidence` 降级路径**只在 MI 8 一台旧内核机上验证过**；API 26–28 与其它非 AOSP ROM 未测。
4. 回滚风险（见 [发布与回滚兼容](RELEASE-COMPAT.md)）：回滚到字段集 22 会让 v23+ 客户端整份 400，而客户端提示是「请检查设备时间」，完全误导。

已收口（1.21.0 起）：目录列举不再用 `java.io.File(path).list()` 直读，改走 `SafeReader.listNames`（`bounded` 400 ms 包裹、升序、截断 64 项），1.21.2 又补上 `Os.stat` 三态判别，修掉「被拒目录被报成目录不存在」。

本轮未执行：`backend/scripts/qa_device_profile.py` 的更新（见上第 2 条），以及 API 26–28 机型上的复测。

复验命令（分别在仓库根、`backend/`、`backend/web/`）：

```powershell
# 仓库根：Android 构建和本地单测；试装联网包另按 LAN-PILOT 配置地址
.\gradlew.bat :app:assembleDebug :app:testDebugUnitTest

# 仓库根：仪器测试（runner 是手写 Instrumentation，用 -e probe 不是 -e class）
adb -s 35241FDF6S1P3K shell am instrument -w -e probe safereader com.sigmark.app.test/com.sigmark.app.CapabilitySmoke

# backend：Go 单测和隔离集成；脚本自建临时容器，不写线上库
go test ./...

# backend/web：前端单测、构建、浏览器 QA（QA 脚本需要真实部署地址与 admin token）
cd backend/web
npm.cmd test
npm.cmd run build
$env:SIGMARK_QA_URL='http://192.168.1.114:48272'
$env:SIGMARK_QA_TOKEN='<ADMIN_TOKEN>'
$env:SIGMARK_QA_DOSSIER_ASSET='<ASSET_ID>'
npm.cmd run qa
```

浏览器 QA 用系统 Chrome（`channel:'chrome'`，回落 `msedge`），**不下载自带 Chromium**；说明见 [backend/web/qa/README.md](../backend/web/qa/README.md)。注意 `backend/scripts/qa_device_profile.py` 目前**已过期**（断言的是字段集 21 / `sigmark-profile/5`），会在跑到浏览器之前失败，见「已知未覆盖」第 2 条。

Web 修改前按 [仓库约定](../AGENTS.md) 使用 Modern Web Guidance。浏览器回归用 `npm.cmd run qa`（Playwright + 系统 Chrome，见 [qa/README.md](../backend/web/qa/README.md)），不再需要手配 Playwright 下载 Chromium；隔离脚本仍可加 `--browser`。线上检查只读，维护升级只重建 API，保留 PostgreSQL 容器与卷。记录健康、公开版本、新契约及抽检散列；报告 JSON 或 ZIP 不是数据库备份。
