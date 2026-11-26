# 设备安全打分（sigmark-score/5）设计与实现

> ## 铁律：SigMark 是 App
>
> **产品形态是普通应用在普通用户手机上采集。**
>
> **`adb` / shell 读数只是开发期的辅助观察，不是产品能力，不得与 App 采集结果混为一谈。**
>
> **任何判据、任何样例、任何结论，都必须以 App 视角的采集结果为准。**
>
> 三条直接后果，逐条落到下面的口径里：
>
> 1. **同一个属性，`adb` 与 App 可能读到不同的值。** Pixel 6 实测：`ro.board.platform` 用 `adb` 读是 `gs101`（`ADB`），App 读是 `mt6985`（`APP`）。**产品只认 App 读到的那个**——判据比对的两侧必须同视角，不能一边 shell 一边 App。这也意味着**任何只做过 `adb` 验证的判据，都还没有被产品视角验证过**。
> 2. **判据的「成本」要按 App 能读到什么来算**，不是按 root/shell 能改什么来算。一条 `setprop` 改掉的值，App 读到的是改后的值——所以「App 读得到」不等于「对手改不动」；反过来，`/proc` 透传这类 App 读得到、`resetprop` 改不掉的东西，才是真正的成本台阶（§13 F17）。
> 3. **本文所有实测数据必须标注视角：`APP` 或 `ADB`。** 没标注的一律按 `APP` 处理，因为那是产品口径；`ADB` 数据只出现在「开发期观察」的语境里，并且必须写明它不代表产品能力。
>
> 这条铁律不是新增限制，而是**把一直隐含的假设显式写出来**：§13 F16 的「非空≠对」、§4 R10 的「没看过不等于一致」，前提都是「看到的是 App 看到的东西」。视角一旦混用，那两条规则会同时失效。

> 状态：**已实现并上线**（2026-11-26，`sigmark-score/5` + `sigmark-profile/9`）。后端 `backend/cmd/sigmark/score.go` 是唯一投影实现（版本常量在 [score.go:67](../backend/cmd/sigmark/score.go#L67)），前端 `backend/web/src/score-view.ts` 负责渲染，**167 个顶层 Go 测试**（`go test -v -count=1 ./cmd/sigmark` 实测：**164 PASS / 3 SKIP / 0 FAIL**，共 237 个 `RUN` 行含子测试；3 个 SKIP 是 `TestIdentitySummaryPostgres` / `TestRepositoryStatsPostgres` / `TestAssetOverviewPostgres`，需要真实库）+ **103 项 Web 测试**锁住契约，五份黄金文件（Pixel 6 / MI 8 / 仿真器基准 / 仿真器改装两个变体）逐字节冻结真机结论。`go test -count=1 ./...` 全绿、`gofmt -l` 与 `go vet` 干净。
>
> **本文的定位**：定义口径与契约。凡是「文档声称、代码没有」的地方，§13 的 F 系列逐条记录；上一版收敛到只剩 U2 一项，**U2 已于 `sigmark-score/2` 落地**，F12 现在没有遗留项。凡是「代码有、文档没写」的地方，同样在 §13 里点出来。这不是一次性的设计稿，而是随实现同步维护的契约。
>
> 依赖：画像规则 `sigmark-profile/9`（[device_profile.go:25](../backend/cmd/sigmark/device_profile.go#L25)）、字段集 26、字段词典 `sigmark-lan-fields/17`、打分规则 `sigmark-score/5`。
>
> 结论先行：分数是**归档数据的只读投影**；`band` 才是结论，`value` 只用于排序；覆盖不足时不给数字；决定性命中直接把结论压到 D；打分**不能证明设备是真的**。

---

## 1. 现状与缺口

### 1.1 现在有什么

后台 `/device-profile` 由 `profileSignals()` 从已归档的 `Report.Parameters` 重算 10 个布尔标签（[device_profile.go:161](../backend/cmd/sigmark/device_profile.go#L161)）。每个标签只有三态：`hit` / `not_observed` / `insufficient`，并各自挂一组证据行（`key / status / value / source / reason / errno`）。标签顺序是 wire contract，只许追加、不许重排（`profileSignals` 内 `eval` 的调用顺序，[device_profile.go:276](../backend/cmd/sigmark/device_profile.go#L276) 起）。Android 侧用同一套口径渲染本机结论（[DevicePosture.kt:15](../app/src/main/java/com/sigmark/app/security/DevicePosture.kt#L15)），但手机端不持有归档，也不做跨报告聚合。

| # | code（从代码读出） | 界面名 | 依据字段 | 三态的真实含义 |
| --- | --- | --- | --- | --- |
| 1 | `virtual_build_markers` | 虚拟环境声明 | `cpu.hardware`、`system.product`、`system.device`（[device_profile.go:276](../backend/cmd/sigmark/device_profile.go#L276)） | 命中约定虚拟标记；三项均有可用值且都不匹配才算 `not_observed` |
| 2 | `selinux_permissive` | SELinux 宽容模式 | `system.selinux` + `system.selinuxEvidence`（[:197](../backend/cmd/sigmark/device_profile.go#L197)） | 直接读到 Permissive 才命中；推断与拒读都是 `insufficient` |
| 3 | `debugger_attached` | 印迹进程连接调试器 | `app.debuggerConnected`、`environment.tracerPid`（[:284](../backend/cmd/sigmark/device_profile.go#L284)） | `是` 或非 0 PID 命中；两者都明确否定才算未见 |
| 4 | `hook_injection` | 注入与 Hook 线索 | `environment.hookSignals`、`environment.rootMountHints`（[:285](../backend/cmd/sigmark/device_profile.go#L285)） | 任一处不是 `none` 即命中 |
| 5 | `root_manager_visible` | 可见的 Root 管理应用 | `environment.rootManagerVisible`（[:286](../backend/cmd/sigmark/device_profile.go#L286)） | 读到 `none` 才算未见 |
| 6 | `multi_open` | 多用户 / 分身环境 | `environment.userProfile`（[:287](../backend/cmd/sigmark/device_profile.go#L287)） | `secondary` / `managed` 命中；`owner` 未见 |
| 7 | `rom_verification` | ROM 验证与可调试声明 | `environment.verityMode`、`environment.buildDebuggable`（[:296](../backend/cmd/sigmark/device_profile.go#L296)） | disabled / logging / 开启 命中 |
| 8 | `software_drm` | DRM 密钥保护级别 | `environment.drmSecurityLevel`（[:305](../backend/cmd/sigmark/device_profile.go#L305)） | L3 命中；L1/L2 未见 |
| 9 | `identity_conflict` | App 身份声明核对 | 三对同义读数（[identity_consistency.go:7](../backend/cmd/sigmark/identity_consistency.go#L7)） | 任一对不同命中；**一侧可读、另一侧为空也命中**（`sigmark-profile/9` 新增，见 §4 R4 边界与 §13 F15）；全部适用对都比较过才未见 |
| 10 | `hardware_declaration_conflict` | 实测硬件与声明核对 | 10 条硬件证据 + overlay 通道（[hardware_facts.go:112](../backend/cmd/sigmark/hardware_facts.go#L112)） | 任一通道冲突命中；任一通道确认未见 |

**证据行的语义边界**（必须保留）：`RESTRICTED` 是系统拒读，`UNAVAILABLE` 是采样时没有值，`ERROR` 是读取失败，`NOT_ARCHIVED` 是旧报告没保存该字段。四者都不是 `not_observed`。`addHistory` 已经用 `h.State != "insufficient"` 决定历史分母（[device_profile.go:322](../backend/cmd/sigmark/device_profile.go#L322)），打分覆盖沿用同一个谓词，不新造语义。

### 1.2 现在缺什么

| 缺口 | 具体表现 | 后果 |
| --- | --- | --- |
| 不能聚合 | 10 个布尔值之间没有比较关系 | 看不出「一台机器比另一台更可疑」 |
| 不能表达程度 | `hit` 与 `hit` 一样重 | 模拟器命中和 L3 命中在界面上同等显眼 |
| 不能排序 / 告警 | 没有数量指标 | 无法按风险排报告、无法做阈值提醒 |
| 不能表达确信 | 三态里 `insufficient` 只说明「没判」 | 7 个标签证据不足与 7 个标签确认无异常，在顶部看起来一样干净 |

打分体系只回答这四件事；它**不**回答「设备是否原厂」「ROM 是否被篡改」「使用者是否做过危险操作」。

### 1.3 视角铁律：本文所有数据都是 App 视角（见文首）

这一节是文首那条铁律在本章的具体化，因为它决定**「现在有什么」这句话的含义**。

**产品能力 = 普通 App 在普通用户手机上能读到的值。** 不是 root 能读到的，不是 `adb shell getprop` 能读到的，不是开发机上模拟器里能读到的。三者经常不一致：

| 数据源 | 能不能作为判据输入 | 说明 |
| --- | --- | --- |
| App 内 `Build.*` / `SystemProperties` / `/proc` 读取 | **能** | 唯一的产品口径；本文所有判据都以它为准 |
| `adb shell getprop` | **不能**（只作开发期辅助观察） | Pixel 6 实测：`ro.board.platform` 走 `adb` 读 `gs101`，走 App 读 `mt6985`。**同一台机器、同一个属性、两个值** |
| root / `resetprop` 之后的读数 | **不能** | 那是攻击者视角，用来评估成本，不是用来定义判据 |

**为什么这件事会直接改变结论**：

1. **判据的「成本」不能用 `adb` 的改写能力来估。** 一条 `setprop` 能改掉的值，App 读到的是改后的值——所以「App 读得到」不等于「对手改不动」。反过来，`/proc/cpuinfo` 这类 App 读得到、`resetprop` 改不掉的通道，才是真正的成本台阶（§13 F17）。
2. **判据的两侧必须同视角。** 「App 侧值 vs 同名属性值」这种比较（`identity_conflict`）只有在两侧都来自 App 采集时才成立。一边 shell 一边 App，比出来的是**采集环境的差异**，不是设备的矛盾。
3. **样例必须标视角。** 本文出现的每个实测值都带 `APP` 或 `ADB` 标注；没标的按 `APP` 处理。§13 F17 与 §10.9 的雷神数据是 `APP`（真跑 App 采集上传）；VIRTUALIZATION-MATRIX 里的改写命令是 `ADB`（开发期观察，**不代表产品能力**）。

> 一句话：**「我能在 shell 里证明它是模拟器」不等于「产品能判出它是模拟器」。** 后者才是这份文档要交付的东西。

---

## 2. 三条轴

三条轴对应三种直觉，不是三个新数据源。它们全部从现有 10 个标签推导：

| code | 名称 | 权重 | 回答的直觉 | 典型依据 |
| --- | --- | --- | --- | --- |
| `declaration` | 声明一致性 | 40 | **信息不符合**：设备自己的说法之间、与独立通道之间是否互相矛盾 | `hardware_declaration_conflict`、`identity_conflict` |
| `behavior` | 行为风险 | 35 | **有危险行为或程序**：root / hook / 调试器 / SELinux 宽容 / 多开 / 模拟器 | 标签 1–8 |
| `usage` | 使用真实性 | 25 | **不像真实使用痕迹**：它像不像一个「被真实用了那么久」的设备 | `system.bootCount` + 分区构建日期 / 初始 API 级别（派生） |

### 2.1 为什么是 40 / 35 / 25

- **声明 40**：这是唯一一条「独立通道不在声明链上」的轴。`cpu.cpuParts` 来自 `/proc/cpuinfo`，`runtime.glesRenderer` 来自 EGL 驱动，`cpu.cpuCapacity` 来自内核 sysfs，`memory.cmaTotal` 来自 `/proc/meminfo`，overlay 文件名来自构建产物（[hardware_facts.go:215](../backend/cmd/sigmark/hardware_facts.go#L215) 为 GPU 通道，通道全集见 [hardware_facts.go:129](../backend/cmd/sigmark/hardware_facts.go#L129)）。改机层要同时骗过这些通道，成本远高于同时改 `Build.MODEL` 和 `ro.product.model`，所以这条轴的证据质量最高，也天然承载决定性命中。
- **行为 35**：采样瞬间的强信号，但短时效且容易被实验室操作触发（联调、Frida、刷机测试）。权重压在声明之下，避免把正在调试的测试机一棒打死。
- **使用 25**：最弱、最易伪造、隐私足迹最重的一轴。25 足以让一个明确的「声称 vs 计数」矛盾落到 B，但单独不足以到 C/D（§10.3 给出算术），只能当佐证。

三条轴权重和恰为 100，且声明 + 行为 = 75，保证总分不会被最弱的使用轴主导；同时任意两轴可判就能给出分数（R7）。

### 2.2 轴内标称分与轴权重是两种量纲，不能互相换算

规格给的轴内建议分（如 `hook_injection 25`、`debugger_attached 20`）是**轴内严重度单位（标称分）**，落在该轴自己的 0–100 分区间上。轴权重（40 / 35 / 25）只决定这条轴在**跨轴加权平均**里占多少份额。两者单位不同：

- `behavior` 内标签标称分合计 **115**，轴权重 **35**；
- `declaration` 内三条分支合计 **70**，轴权重 **40**；
- `usage` 内 1 个派生标签 **12**，轴权重 **25**。

标称分之和大于轴权重是**正常的**：权重不是扣分预算。轴内扣分先求和、再截断到 100（R6），轴分 = 100 − 该值。

副作用必须写清楚：**`behavior` 轴会饱和**——`hook_injection(25) + virtual_build_markers(35) = 60`，轴分只剩 40；`hook + selinux + debugger = 60` 也超过一半。多条中等命中会把这条轴打到很低，这是「标称分总量足够大」的必然结果。如果标定后发现过严，只能整体缩放标称分，留到 §9 的标定轮决定，不在 v1 偷改。

**曾经试过、被否掉的两种写法**（都有实测数据）：

| 写法 | hook 单条命中后的 behavior 轴分 | 结论 |
| --- | --- | --- |
| 按权重归一化 `100×(35−25)/35` | **29** | 太严厉：一条发现压过九条干净通道 |
| 扣分截断到权重 35 | 65（轴分下限 65） | 太宽松：全面不符也走不到 D |
| 截断到 100（采用） | **75** | ✅ |

### 2.3 标签归属（含规格未覆盖的两条）

下表的分支 code、标称分与决定性标记与 `score.go` 的常量/表**逐字一致**（`declarationHardwarePoints`、`declarationIdentityPoints`、`declarationIdentitySkuPoints`、`declarationOverlayPoints`、`usageFreshBootPoints`、`behaviorScoreTable`、`behaviorDisplayOnlyLabels`）。验收时按字面比对，不要按语义「大致对上」放过。**整张表由 `TestScoreDeductionTableMatchesTheDocumentedContract` 表驱动锁住**：它用覆盖全部分支的 fixture 收集实际产出，逐条比对 `(code, label, axis, points, decisive)`，并反向断言「代码产出的每个 code 都必须在本文有行」。改这张表必须先让那个测试失败——见 §13 F10。

**`label` 列不是分支名**：三条 hardware 分支（`FOREIGN_PROFILE` / `HARDWARE_CHANNEL_CONFLICT` / `OVERLAY_CODENAME_MISMATCH`）共用同一个 `label` = `hardware_declaration_conflict`，因为 overlay 代号冲突是那条标签的一条**通道**，不是第 11 个标签。曾经这里写成 `label: "overlay_codename"`，凭空发明了一个画像从不产出、文档也从不列出的标签名，账本上会出现一个读者无处可查的 label；已改回 `hardware.Code`。前端因此把**分支 code** 作为账本主标题、label 降为「来源标签」小字，否则同标签的两条扣分长得一模一样。

| 来源 | code | 轴 | 分支 code | 标称分 | 决定性 |
| --- | --- | --- | --- | --- | --- |
| 布尔标签 1 | `virtual_build_markers` | behavior | `VIRTUAL_BUILD_MARKERS` | 35 | **是** |
| 布尔标签 2 | `selinux_permissive` | behavior | `SELINUX_PERMISSIVE` | 15 | 否 |
| 布尔标签 3 | `debugger_attached` | behavior | `DEBUGGER_ATTACHED` | 20 | 否 |
| 布尔标签 4 | `hook_injection` | behavior | `HOOK_INJECTION` | 25 | 否 |
| 布尔标签 5 | `root_manager_visible` | behavior | `ROOT_MANAGER_VISIBLE` | 12 | 否 |
| 布尔标签 6 | `multi_open` | behavior | `MULTI_OPEN` | 8 | 否 |
| 布尔标签 7 | `rom_verification` | behavior（**展示不计分**） | — | — | — |
| 布尔标签 8 | `software_drm` | behavior（**展示不计分**） | — | — | — |
| 布尔标签 9 | `identity_conflict` | declaration | `IDENTITY_APP_UID` | 25 | **是**（仅 model / device 对） |
| 布尔标签 9 | `identity_conflict` | declaration | `IDENTITY_SKU` | 15 | 否 |
| 布尔标签 10 | `hardware_declaration_conflict` | declaration | `FOREIGN_PROFILE` | 30 | **是** |
| 布尔标签 10 | `hardware_declaration_conflict` | declaration | `HARDWARE_CHANNEL_CONFLICT` | 30 | 否 |
| 布尔标签 10 | `hardware_declaration_conflict` | declaration | `OVERLAY_CODENAME_MISMATCH` | 15 | 否 |
| 派生 | `fresh_boot_on_aged_rom` | usage | `FRESH_BOOT_ON_AGED_ROM` | 12 | 否 |
| **非标签通道**（`/4` 新增） | —（不走 `profileSignals`） | behavior | `STRUCTURAL_VIRTUAL_EVIDENCE` | 35 | **是** |

**最后一行不是布尔标签，必须单独理解**（§13 F17）：`STRUCTURAL_VIRTUAL_EVIDENCE` 由 `structuralVirtualDeduction` 直接从 `parameters` 读出，**不经过画像标签**。它存在的理由是 `virtual_build_markers` 那三个键由被审查设备自己提供——模拟器改三行属性就能让 35 分规则得到 `not_observed`（雷神实测 `?`）。它和 `VIRTUAL_BUILD_MARKERS`（黑名单）**互斥**：`markerHit == true` 时它不出手，一因一果（R2）。它也**不进 `behavior` 的 coverage 分母**——它是扣分通道，不是可判单元。

**`identity_conflict` 必须按冲突对分流，不能整条标签一刀切**：`appIdentityPairs` 有三对（model / device / SKU），代码必须看**是哪一对**不一致。早先的实现对任何 `hit` 都发 `IDENTITY_APP_UID 25` + 决定性 cap，结果把一条 SKU 分裂升级成 D —— 而 Pixel 6 上 shell 与 app uid 报不同 SKU 是**已记录的真实行为**（§6.3 专门论证 SKU 不作决定性）。`TestScoreSkuOnlyIdentityIsNotDecisive` 锁住这一点：SKU-only → `IDENTITY_SKU` 15 分、无 cap。

两处「规格没写、本文裁决」的地方，先在此标明，论证见 §13：

1. `rom_verification` 与 `software_drm` 在规格的三轴里没有归属。**已裁决：展示但不计分。** 它们留在画像里（控制台照常显示），但不计价、也不进 `behavior` 的 coverage 分母。代码用 `behaviorDisplayOnlyLabels` 显式声明，`TestScoreBehaviorAccountsForEveryLabel` 锁住「每个标签要么计价、要么在这张表里」，新加标签不许静默消失。理由见 §13 F1：`software_drm` 的 L3 是播放能力等级而不是伪装信号——干净的 MI 8 锚点本身就有 L3，计价会把阴性对照打成「有疑点」。
2. `fresh_boot_on_aged_rom` 不是 `profileSignals()` 的 10 个标签之一，是打分体系新定义的派生标签。它仍遵守 R1（code / label / keys / detail 齐全），但必须写清「派生」身份，否则前端和黄金测试会把它当成第 11 个布尔标签。

---

## 3. 扣分账本

### 3.1 结构

每一条扣分是一个对象：

| 字段 | 类型 | 语义 |
| --- | --- | --- |
| `code` | string | 触发分支的稳定代码（如 `FOREIGN_PROFILE`），枚举见 §2.3 |
| `label` | string | 该分支所属的布尔标签 code；派生标签写 `fresh_boot_on_aged_rom` |
| `axis` | string | 所在轴 code；必须与 `axes[].code` 一致（冗余，便于导出后独立审计） |
| `points` | int | 该分支的标称分，1..100（轴内百分制，与轴权重无关，见 §8.2） |
| `keys` | string[] | 至少 1 个真实存在的字段 key，必须出现在该标签的 `evidence` 里 |
| `detail` | string | 一句话人话，必须包含「测到的值 / 对上的画像」或「不一致的两侧」 |

规格的 JSON 形状示例省略了 deduction 内的 `axis`，但账本要求每条扣分都带轴：后端必须输出它，并保证 `deduction.axis == axes[].code`。这是冗余字段，作用是在导出 JSON 被拆开审计时，单条扣分仍能自证归属；前端可以忽略。

### 3.2 不允许裸数字

「30 分」本身不是证据。`points` 只能由 §2.3 的表产生；表里每一行都必须能落到一个标签和一组 key。任何新增扣分项必须同时增加：分支 code、标签映射、判定条件、证据 key、黄金测试用例。缺少任一环，Code Review 直接拒绝。

这条规则防的是「拍脑袋补一个 5 分」。一旦允许无出处扣分，分数就会变成产品经理的情绪函数，而不是可复核的证据投影。

### 3.3 同一标签内的同一条根因只出一条

`identity_conflict` 可能三对同时不一致，`hardware_declaration_conflict` 可能 RAM、CPU、GPU、overlay 同时冲突。规则不是「一个标签只出一条」，而是**一条根因只出一条**：

- `identity`：`IDENTITY_APP_UID(25)` 与 `IDENTITY_SKU(15)` 同时命中 → 只出 25 分那条，`keys` 取 model/device 两对；三对身份同属「改机」这一个根因。
- `hardware`：`FOREIGN_PROFILE(30)` 与 `OVERLAY_CODENAME_MISMATCH(15)` 是**两条不同事实**（「实测值等于另一颗 SoC 的画像」与「overlay 代号被改写」），**各计各的，两条并存**。Pixel 6 的真实输出就是 30 + 15 = 45、轴分 55（`testdata/score-pixel6.golden.json`）。反过来，若某份报告**只有 overlay 一条通道**不一致，就不再出 30 分的通道冲突——`nonOverlayBasis` 把 overlay 从 30 分那侧摘掉，避免一个事实收 45 分（§13 F2）。

理由见 R2：一次改机同时打破 model/device/board，是**一个根因**，不是三次造假；但 overlay 代号改写与 SoC 画像不符是两个可以独立成立的发现，不能互相吞掉。

---

## 4. 十一条硬规则

R1–R9 是规格原文；R10、R11 与 R7 的薄轴例外是**回算当轮 22 份真实报告之后补的**，都有真实反例支撑（见 §9.1.1；该表现已扩到 23 份，规则未再变）。

### R1 每分扣分可追溯：label + key + detail 三者缺一不可

**规则**：任何 `points > 0` 必须同时有 `label`（触发它的布尔标签）、至少一个 `keys`、一句 `detail`。

**为什么**：分数是给管理员看的结论，管理员必须能在一屏内回答「为什么扣这 20 分」。只有数字没有出处，等于把规则的黑箱又包了一层。反过来，只有 key 没有 detail，管理员还得自己去查 `652 MiB` 意味着什么。

**反例**：`{"points": 20}`；`{"points": 20, "detail": "硬件可疑"}`（没有 label 和 key，无法定位）；`{"keys": [], "detail": "..."}`。

**实现约束**：`keys` 从该标签的 `evidence` 行里取，不新造 key；`detail` 用模板生成（`{实测} 与 {画像} 一致` / `{左} 与 {右} 不一致`），避免自由发挥。黄金测试对 `code/label/points/keys` 做结构断言，对 `detail` 做文本快照（§9.4）。

> 已知例外：`fresh_boot_on_aged_rom` 是派生标签，没有对应的 `profileSignals()` 行。它的 label 由 `sigmark-score/5` 的派生标签表定义，R1 其余要求不变。这是规格「usage 轴有 25 权重但没有标签」的直接后果，见 §13 F1。

### R2 同一 label 内多条命中取 max，不求和

**规则**：先按 label 分组，组内取最大标称分，再跨 label 求和，最后截断到 100（R6）。

**为什么**：根因去重。一次改机同时打破 `model/device/board` 是一个根因；如果按字段计数，一台被完整改写的机器会因为「字段采得全」而扣得比只改一个字段的机器更多，分数编码的就成了「你恰好采了几个字段」，而不是「设备有多假」。这与我们上一轮修 `listNames` 是同一类错误：把实现细节当成证据强度。

**反例**：Pixel 6 改装机的三对身份读数可能全部自洽（改写层同时覆盖两侧），如果按「每对不一致扣 8 分」的朴素做法，它反而是 0 分；而一台只改了一侧、被 3 对里的 2 对抓到的机器会被扣更多。方向完全错了。

**实现约束**：分组键必须是 `profileLabel.Code`，不是 `deduction.code`；`usage` 的两个信号（分区日期、初始 API）同属 `fresh_boot_on_aged_rom`，也只能出一条。

### R3 `not_observed` 贡献 0 扣分，但计入 coverage 分子

**规则**：标签状态为 `not_observed` 时，扣 0 分，同时该标签算「可判」，进入轴 coverage 的分子（分母是该轴标签总数）。

**为什么**：这是唯一一种「查过且没发现」的状态。它必须能把分数从「未知」里救出来，否则所有证据都白采。

**边界**：`not_observed` 不是「扫了一眼」。代码里它有严格条件：`eval` 要求所有 key 都读到并给出否定（`negative == len(keys)`，[device_profile.go:191](../backend/cmd/sigmark/device_profile.go#L191)）；`identity` 要求所有适用对都比较过（[:272](../backend/cmd/sigmark/device_profile.go#L272)）；`hardware` 要求至少一个通道确认（[hardware_facts.go:292](../backend/cmd/sigmark/hardware_facts.go#L292)）。打分投影只能读标签状态，不得自己放宽。

**反例**：`hookSignals = none`、`rootMountHints = RESTRICTED` 时，`eval` 仍判 `insufficient`（因为 `negative != len(keys)`）；如果打分层擅自把它当 `not_observed`，就等于「读不到一半也算清白」，正是本轮要消灭的错误。

### R4 `insufficient` / `NOT_ARCHIVED` 不计扣分，计入 coverage 分母，并出现在 `undetermined`

**规则**：`insufficient` 不扣分，但该标签进入分母；该标签的所有不可用 key 进入 `undetermined`，并标明原因（`UNAVAILABLE` / `RESTRICTED` / `ERROR` / `NOT_ARCHIVED` / `PROFILE_UNSET` / `UNMAPPED_SDK_LEVEL` / `UNPARSEABLE_PARTITION_DATES` —— **共七个**，见下）。

**为什么**：不计扣分是对的——没有证据不能定罪；计入分母也是对的——没有证据不能免罪。两件事必须同时成立，否则就会滑向 §7.1 的「7 个 insufficient = 100 分」。

**R4 的边界：不对称 ≠ 无证据（`sigmark-score/3` 新增，这是对 R4 本身的一次收紧）**

「无证据不能定罪」这句话有一个容易读歪的版本：把**证据不对称**也当成「无证据」。它不是。

- **无证据** = 这一对读数我们**没拿到**：两侧都 `NOT_ARCHIVED`（旧字段集没这个字段）、或至少一侧 `RESTRICTED`/`ERROR`（系统拒绝或读取失败）、或两侧都读到了但都是空/占位符。这些情况下确实什么都不知道，`insufficient` 是诚实的。
- **证据不对称** = 同一对身份读数，**两侧 Status 都是 `AVAILABLE`**（采集进程把两边都读成功了，归档里也都有格子），但**恰好一侧产出可用值**。这不是「没拿到」，这是**一个只发生了一半的声明**。

**为什么后者算证据**：一对身份读数的两侧由**同一个进程、同一趟采集、从同两个来源**读出（`Build.MODEL` 与 `ro.product.model` 属性）。一个能在一边读成功、另一边读出空白的采集过程，**自己产生不出这种结果**——空白只能来自「那个属性被清掉了」。所以「一侧有值一侧空」不是部分读数，是**读数过程无法自行产生的形态**。

**代价必须写清**：这条边界让 R4 从「无证据不定罪」变成「无证据不定罪，但**证据不对称本身是证据**」。这是拿 R4 的宽松换掉一个洗白通道——`/2` 时代删掉一侧属性就能让 `hit` 退回 `insufficient`、扣分与决定性 cap 一起消失、报告与干净设备不可区分（§13 F15）。**权衡的结论是：宁可让一台 ROM 奇怪的设备多一条提示，也不能让删一个属性变成完全隐身。**

**四个跳过条件**（每一条都是防误伤，见 §13 F15）：`NOT_ARCHIVED` 跳过、非 `AVAILABLE` 状态跳过、两侧都空跳过、只有「两侧 AVAILABLE + 恰一侧为空」才判 `hit`。

**实现约束**：`NOT_ARCHIVED` 与 `RESTRICTED` 在 `undetermined` 里必须可区分：前者是「这份旧报告没存」，后者是「系统拒绝」，两者对管理员的含义完全不同。

**第五个原因 `PROFILE_UNSET`（已实现）**：回答「SoC 在登记表里，但该字段的期望值没登记」——比如 `sdm845` 的 `cmaMiB` 故意留空。它和另外四个**不是同一类**：那四个是字段状态（App 为什么没读到），这一个说的是「App 读到了，但**我们**没写应该是什么」。

实现路径：`hardwareFactsLabel` 在通道既没确认、也没识别为 foreign 时，若该 SoC 的登记值本身为空，就把通道以 `profile_unset:<key>` 前缀放进 `basis`；score 层 `profileUnsetKeys()` 把它映射成 `undetermined[].reason = "PROFILE_UNSET"`，只带那几行 key。

两条实现约束，都是踩过坑才写下来的：

1. **顺序必须是 confirmed → foreign → unset**。把 unset 放前面会让 `FOREIGN_PROFILE` 在每颗缺 `capacities`/`cmaMiB` 的 SoC 上静默失效，而 `gs101` 以外全都缺——等于把唯一能触发的决定性声明分支全部打瞎。
2. **unset 通道与聚合状态并存，不互相取代**。标签的 `State` 回答「有没有矛盾」（一条确认通道就够回答），unset 回答「每个已登记通道是不是真的比对过」。标签在 `confirmed` 分支提前 `return` 会吞掉后者。

它**不改判定、不降 coverage、不升版**：`not_observed` 该保持还是保持，只是缺口从「静默」变成「有名有姓」。真机验证：MI 8（`sdm845`）的 `memory.cmaTotal` 现在报 `PROFILE_UNSET`，`band` 仍是 A/100。见 §13 F12。

**第六个原因 `UNMAPPED_SDK_LEVEL`（`sigmark-score/2` 新增）**：`system.initialSdk` 读到了，但它的值不在年份表 `usageSdkYears` 里（[score.go:246](../backend/cmd/sigmark/score.go#L246)）。比如将来某台机器报 `initialSdk=36`，而表只登记到 35。

为什么必须单独一个值：**「不知道」不能渲染成「没问题」**。若把表外 SDK 当作「不存在」，`usageAxis` 会退回旧口径（只有分区日期可判），管理员看到的是一个没有缺口的 `not_observed`；若把它当作「新世代」，就等于凭空断定这台设备是近年出厂的——而它可能是一台 2016 年、API 级别更老的机器被塞了别的 ROM。两种猜测都会把「我们没查懂」伪装成结论。表本身是**查表不是算术**：`2017 + (sdk − 26)` 这种写法在每次发布节奏变化处都会差一年，然后静默地把一整代设备标错（[score.go:224](../backend/cmd/sigmark/score.go#L224) 的注释写了这个理由）。

**第七个原因 `UNPARSEABLE_PARTITION_DATES`（`sigmark-score/2` 新增）**：`system.partitionBuildDates` 读到了、格式也能切分，但从中解析不出年份。

为什么必须单独一个值：它和 `UNAVAILABLE` 是两件事。`UNAVAILABLE` 是「采样时没值」，`UNPARSEABLE_PARTITION_DATES` 是「有值，但我们的解析器读不懂」。混成一个，会让「ROM 改了日期格式」看起来和「设备没提供日期」完全一样——而前者恰恰是需要人看一眼的信号。当前实现里 `oldestPartitionYear` 返回 not-ok 就落到这个值（[score.go:1260](../backend/cmd/sigmark/score.go#L1260)），不猜年份、不按「今天」兜底。

**R4 的实现前置条件：标签必须公布自己的分支（`basis`）**。`hardware_declaration_conflict` 可以用六条不同的通道达到同一个 `hit`，而「哪一条」决定了它是不是决定性的。在加 `basis` 之前，打分层只能拿证据行去**重问一次** `hardwareFactsLabel`（限制可见字段）来猜分支——那是同一问题的第二份实现，只要 `hardware_facts.go` 新增一条规则就会漂移。

现在的契约是 `profileLabel.basis []string`（`omitempty`）：

```
hardware_declaration_conflict 的 basis 取值：
  ram_dispersion | cpu_core_set | gpu_family | overlay_codename
  | foreign_profile:cpu.cpuCapacity | foreign_profile:memory.cmaTotal
```

规则：

1. `hit` 时列出**全部**冲突分支，不是第一条。Pixel 6 的真实输出是五条并存
   （`ram_dispersion, cpu_core_set, overlay_codename, foreign_profile:cpu.cpuCapacity, foreign_profile:memory.cmaTotal`）——
   只记第一条会把 foreign-profile 埋掉，等级从 D 掉回 B。
2. `not_observed` 时列出**确认**分支，让「为什么判它干净」也可追问。
3. 判定不出时 `basis` 为空并省略，绝不猜。
4. 打分层只读 `basis`，不再自行推导硬件结论。

**验收**：`TestHardwareFactsPublishTheirBasis`（单分支、foreign 前缀、多分支并存、确认分支、空分支五种情形）。

### R5 决定性命中直接把等级压到 D，不参与平均

**规则**：命中 §6 清单任一分支时，`decisive = true`，`band = "D"`，并写入 `caps[]`。轴分与 `value` 照常计算，但**不参与定级**。

**R5 优先于 R8/R10**：低覆盖和声明轴盲都会把 `value` 置 `null`，但**都不能撤销一个决定性结论**。一份报告同时满足「决定性命中」和「coverage < 0.5」时，正确输出是 `value: null, band: "D", decisive: true, caps: [...]` —— 致命证据不需要覆盖够才成立。早先的实现在低覆盖时直接 `return`，`band` 停在 `"?"`，于是同一份文档同时说「决定性项命中」和「未知」，前端把两句都渲染出来。`TestScoreVirtualBuildMarkersIsNotDeductedTwice` 与 `TestScoreDecisiveSurvivesABlindDeclarationAxis` 锁住这一点。

**为什么**：这是防「一堆合格项把致命项平均掉」的唯一手段。加权平均对任何单点都是线性的，30 分的致命项在 100 分制里只占 30%，再被两条干净轴一摊就没了。数学上不可能靠调权重解决——只要它参与平均，就一定能被平均掉。所以必须有一个不参与平均的开关。

**反例**：§7.2 的「九绿一红」：只有 foreign-profile 命中，朴素加权 **88 分、A 档**；加 cap 后 88 分仍是 D。分数保留 88 是为了排序（同为 D 档的两台机器，88 分的那台问题更少），不是为了定级。

**实现约束**：`decisive` 必须**从证据重算**，不能读某个存下来的 `reason` 字符串。这一点已由 R4 的 `basis` 解决：`hardwareFactsLabel` 现在公布判定分支（[hardware_facts.go:289](../backend/cmd/sigmark/hardware_facts.go#L289) 起的三条 `out.Basis = …` 分支），打分层读 `basis` 里的 `foreign_profile:` 前缀即可，不再重问一遍同一函数。`identity` 直接用 `compareAppIdentity` 返回的 `conflicts`（[identity_consistency.go:37](../backend/cmd/sigmark/identity_consistency.go#L37)）判断是哪一对。

### R6 轴分 = 100 − 轴扣分合计，clamp 到 [0,100]

**规则**：

```
applied(axis) = min( Σ points(label, axis), 100 )
score(axis)   = clamp( 100 − applied(axis), 0, 100 )
```

**为什么不是按轴权重归一化**：轴权重（40 / 35 / 25）只是这条轴在**跨轴加权平均**里的份额，它和「轴内扣分是多少分」是两种量纲，不能互相换算。规格里的标称分（hook 25、debugger 20、foreign-profile 30…）本来就是百分制下的轴内扣分。

两种错误的写法，都用真实数据验过：

| 写法 | 后果 | 实测 |
| --- | --- | --- |
| 归一化 `100×(w−applied)/w` | hook 单条命中就让 behavior 轴从 100 掉到 **29**（25/35 = 71% 的轴），一条发现压过九条干净通道 | 太严厉 |
| 把 `applied` 截断到轴权重 | 声明轴最差只能到 60，三条轴全扣满时总分最低 66，**D 档只能靠决定性 cap 够得着**，「全面不符」的设备自己走不到 D | 太宽松 |
| **截断到 100（采用）** | 轴分覆盖完整 0–100；标称分保持选定时的含义 | ✅ |

**关于「扣分合计不得超过轴权重」**：这句话不成立，也不该成立。声明轴的三个分支是 30 + 25 + 15 = 70，本身就超过权重 40；行为轴 `hook 25 + virtual 35 = 60` 也超过 35。要求不超权重，等于要求每条轴的标称分之和 ≤ 权重，那三条轴的分值区间就分别是 60–100 / 65–100 / 75–100，加权平均彻底失去意义。**权重是加权系数，不是扣分预算。**

**实现约束**：只用整数运算，避免浮点在不同平台产生 0.0001 的差异破坏黄金测试。

**输出补充**：轴 `coverage < 0.5` 时，该轴的 `score` 输出 `null` 而不是 100。一个「什么都没查到」的轴显示 100 分，正是 §7.1 要防的错觉。

### R7 总分 = 只对 `coverage >= 0.5` 的轴做加权平均；覆盖不足的轴不进总分，只进 `undetermined`

**规则**：

```
included = { axis | coverage(axis) ≥ 0.5 }
value    = round_half_up( Σ_{a∈included} weight(a) × score(a) / Σ_{a∈included} weight(a) )
```

空轴、低覆盖轴不参与分母。若 `included` 为空，走 R8。

**为什么**：未知轴既不能当 0 分（那等于「没采到 = 最坏」），也不能当 100 分（那等于「没采到 = 最好」），只能退出平均。规格示例里 `coverage: 0.9` 的声明轴参与、`coverage: 0.2` 的轴不参与，就是这个意思。

**反例**：一台设备 `usage` 全不可用（coverage 0），若把它当 0 分参与平均，一台完全干净、声明与行为都 100 的机器会变成 75 分/B——凭空降档；若当 100 分，则一台使用痕迹明显矛盾的机器会被抬回 A。两种都错。

### R8 总体 coverage < 0.5 → `value = null`、`band = "?"`

**规则**：总体 coverage = `Σ weight(axis) × coverage(axis) / 100`。小于 0.5 时不给数字，`band = "?"`、`bandLabel = "未知"`。

**为什么**：这是 R3/R4 的收口。标签级 coverage 再细，也必须有一个总闸：证据基础不足一半时，任何数字都是假精度。`null` 不是 0，前端不能显示「0 分」；排序时 `?` 排最后，趋势图遇到 `null` 断开而不是插值。

**反例**：§7.1 的合成样例：10 个标签里 7 个 `insufficient`，扣分为 0。朴素模型给 100 分/A；正确模型给 `value=null / band=?`。

**注意**：R8 先于 R5 判定顺序上要先算覆盖，再算分数；若同时 `decisive` 与低覆盖，`value=null` 但 `band="D"`（致命证据不需要覆盖够才成立），两者可以并存，见 §5.6。

### R9 `value` 只用于排序与趋势，`band` 才是结论

**规则**：band 五档：`A` 一致 / `B` 有疑点 / `C` 可疑 / `D` 高度可疑 / `?` 未知。阈值为 **A 85–100、B 70–84、C 50–69、D 0–49**；`decisive` 直接 D；覆盖不足 `?`。

**为什么**：87 和 88 之间没有任何证据学意义（§7.4）。把 band 当主产物，界面、告警、排序说明都引用 band；`value` 只出现在「按分数排序」和趋势折线里，并且必须同时显示 coverage，否则趋势会把「覆盖变化」误读成「设备变坏/变好」。

**反例**：把 `value` 做成红黄绿三色阈值，等于把 1 分的抖动放大成结论变化；同一台机器两次采样差 1 分就被标成「恶化」，是典型的假精度。

### R10 盲轴不能换来好结论 —— 两层形态（严格 / 窄）

R10 有两层，**不是同一套口径**。这一点必须写清楚，因为「盲轴怎么办」和「盲轴出不出数字」是两个问题。

**第一层：声明轴全盲 → 不出版数字，但决定性命中时例外（严格形态，`sigmark-score/5` 收紧）**

**规则**：declaration 轴 `coverage < 0.5` **且** `deductions` 为空时，即使总体 coverage ≥ 0.5，也输出 `value = null`、`band = "?"`、`axes[].score = null`（coverage 照实保留）。**唯一例外**：若 `decisive == true`，`value` **照常出版**，`band` 仍为 `D`。

即抑制条件是 **`declarationBlind && !out.Decisive`**，不再是裸的 `declarationBlind`。实现见 `declarationBlind` 循环（[score.go:464](../backend/cmd/sigmark/score.go#L464)）与出版前的 `if out.Coverage < scoreCoverageFloor || weights == 0 || (declarationBlind && !out.Decisive)` 分支（[score.go:470](../backend/cmd/sigmark/score.go#L470)）。

**为什么**：declaration 轴回答的是「这台设备有没有如实描述自己」。40% 权重的那条轴一条通道都没读到，不代表「一致」，只代表**没看**。把行为轴与使用轴的满分平均过去，会让 40% 的盲区换来一个 A——这是 §7.1「没采到不能等于安全」在总分层面的同一个错误。

**为什么决定性命中要例外（这是设计依据，不是权宜）**：

1. R10 这一层的**全部依据**是「别为一个没人看过的画面出版一个**舒服**的结果」。一旦决定性 cap 已经把 `band` 钉在 `D`，就**没有「舒服」可保护**了——D 是这套体系里最不舒服的结论，它已经出版出去了。
2. 而 §13 **F5 本来就要求**决定性命中保留 `value` 当排序键：`band` 是结论，`value` 只用于排序。两份都是 D 的报告，如果没有数字就**无法排序**，趋势图也只能断开——而这正是 `value` 存在的唯一理由。
3. **R8（总体 coverage 低于地板）与 `weights == 0` 仍然无条件吞数字。** 那两处不是「保护结论的体面」，而是「**没有数字本身就是结论**」——证据基础不足一半时，任何数字都是假精度（§4 R8）。两者不能混为一谈：一个是不该给，一个是不必藏。

**反例（真实数据）**：字段集 20 的四份伪装报告，declaration 轴 coverage = 0、`undetermined` 里 9 个 key 全是 `NOT_ARCHIVED`，旧口径给出 **100 / A**。这正是 R10 要拦的形状。

**反例（过度抑制，本轮修复）**：雷电报告 `6642e350`（字段集 25）：declaration 轴 coverage **0.33**（三路通道全 `UNAVAILABLE`，一条都没读到，也没找到扣分）、总体 coverage **0.73**（**高于地板**）、`decisive = true`。修复前输出 `band = D` **但 `value = null`**——`?` 不是它该有的样子，D 才是；而数字的缺席让审计员问不出下一个问题：「到底扣了多少分？」修复后 `value = 71`（§5.6、§10.2）。

**这条修复改变了归档结论，所以升 `/5`**：同一份报告从 `value: null` 变成 `value: 71`，两份 D 报告从「无法比较」变成「可以比较」。

**第二层：行为轴或使用轴全盲 → 数字照常出版，但禁止评为 A（窄形态，`sigmark-score/2` 新增）**

**规则**：behavior 或 usage 轴 `coverage < 0.5` **且** `deductions` 为空（即「盲」而不是「薄」）时，`value` 照常算出并出版，但 `band` **不得为 A**，强制降到 **B**。实现见 `axisBlind` 循环（[score.go:433](../backend/cmd/sigmark/score.go#L433)）与出版后的 `if out.Band == bandA && axisBlind != ""` 块（[score.go:532](../backend/cmd/sigmark/score.go#L532)）。

**为什么**：R7 会把低覆盖的轴整条剔出加权平均，权重随即重新归一化到「答了话」的轴上——于是**删掉证据能让分数变高**。红队实测在真实 MI 8 上拿到确切形状：保留 usage 输入得 **97/B**，删掉得 **100/A**，同机同日高 3 分、跨一个 band。这是「攻击者只要隐藏证据就能升级」的方向性漏洞，必须堵。

**为什么分两层、而不是统一成「都不出版」**：统一成不出版会**掩盖真实发现**。实测样本里一个 hook 注入 + debugger 都在的报告本来是 **D**，若因为 usage 轴薄就改成 `?`，报告里唯一看见了的东西反而丢了。所以窄形态锁的是 **band**（攻击者真正想动的东西），数字留作排序键照常输出。修复后，上面那台 MI 8 删证据得 **100/B**——数字仍是 100，但拿不到「一致」。

**边界（两层共用）**：「盲」= 读不到 **且** 没找到。带扣分的薄轴不算盲（那是 R7 的薄轴例外，见下），因为它已经找到了东西。

**验收**：`TestScoreRule7ThinAxisDoesNotDilute`、`TestScoreUsageHalfReadDoesNotLiftTheBand`（这两个是被这次改动改写过的），以及红队的 `TestRedteamDeletingUsageEvidenceScoresBetterThanKeepingIt`。**注意这一条是「测试先红、代码后改」**：旧测试原本全绿，漏洞是红队新写的测试暴露的。

### R11 `band = A` 要求零扣分

**规则**：加权算出 A 档之后，只要任意一条轴的 `deductions` 非空，`band` 降为 `B`；`value` **不动**（它只是排序键）。

**为什么**：`A` 的中文标签是「一致」。「一致」是一个**全称陈述**——没有任何一条通道与声明不一致。既然账本里躺着一条扣分，就必然有东西不一致，这个全称陈述已经不成立。分数高低是量的问题，「一致」是质的问题，量再高也不能把质买回来。

**反例（真实数据）**：字段集 22 的伪装报告 `value = 88`、declaration 轴扣 30 分，旧口径落 **A / 一致**。88 分之所以还在 A 档，是因为另外两条轴满分把一条 30 分的实证冲突稀释掉了——这就是 §7.2「平均分掩盖致命伤」的低配版。

**与 R5 的关系**：R11 在 R5 之前执行。R11 只降一档到 B，R5 才是压到 D；两者不冲突，顺序不能颠倒，否则 R11 会把 D 抬成 B。

### R7 的薄轴例外：带扣分的薄轴仍然计入总分

**规则**：R7 原口径是「coverage < 0.5 的轴不进总分」。**例外**：该轴 `deductions` 非空时仍然计入。

**为什么**：一条已记录的矛盾是**事实**，与它的兄弟通道读没读到无关。因为 coverage 低就把这条轴整条丢掉，等于把已经找到的实证扔了——而丢掉一个负面发现，永远比多算一个负面发现更危险。

**反例（真实数据）**：字段集 22 的伪装报告 declaration 轴 coverage = 0.67，本来就 ≥ 0.5，不触发；但同形状的薄轴（coverage 0.33 + 25 分 identity 冲突）在旧口径下会被整条丢弃，总分变成干净的 100。

> 以上 R1–R11 是 v1 的强制规则。§13 F4 提出的 R10-a 已被 R10 与 R11 覆盖，不再是待定建议。

---

## 5. 计算口径

### 5.1 标签可判性

| 标签状态 | 扣分 | coverage 分子 | coverage 分母 | `undetermined` |
| --- | --- | --- | --- | --- |
| `not_observed` | 0 | ✓ | ✓ | 只列该标签内仍不可用的 key（若有） |
| `hit` | 按分支 | ✓ | ✓ | 只列仍不可用的 key（若有） |
| `insufficient` | 0 | ✗ | ✓ | 全部不可用 key |

「不可用 key」= 证据行状态不是 `AVAILABLE`，或值为空 / `unknown`。

### 5.2 轴 coverage

```
coverage(axis) = 该轴可判单元数 / 该轴单元总数
declaration: 3 个单元（hardware_declaration_conflict、identity_conflict、overlay 通道）
behavior:    6 个计分标签（标签 1–6；标签 7、8 展示不计分，不进分母）
usage:       1 个派生标签（fresh_boot_on_aged_rom，需要 bootCount 可读，且分区日期或出厂 SDK 世代至少一个可读）
```

**注意**：这是**单元可判率**，不是字段完整率。`hardware_declaration_conflict` 只要有一条通道确认就是 `not_observed`（[hardware_facts.go:293](../backend/cmd/sigmark/hardware_facts.go#L293)），即使另外五条通道缺失。这类「单元可判、但通道不全」的缺口会进 `undetermined`（按 key 列出），不降低 coverage。

**`usage` 的口径必须按派生标签算，不能按字段数算**：早先的实现把 `bootCount` 和 `partitionBuildDates` 各算一个「标签」，于是只读到一个字段时 coverage 恰好是 **0.5**，正好等于 R7 的下界，这条什么矛盾都判不了的轴就带着未挣得的 100 进了加权平均——同一条证据能把 C 抬成 B。现在按派生标签算：`bootCount` 必须可读，且**分区日期（U1）或出厂 SDK 世代（U2）至少一个可读**，才记 1，否则记 0。

**`sigmark-score/2` 把「可判」的判定条件从「两个字段」放宽到「一个必选 + 一个二选一」**，方向要说清楚：这扩大的是**可判集**，不是扣分面。镜像很新、但世代很老的设备以前落在「判不了」，现在落在「判了且干净」——两者在界面上长得一样，混起来就是 §7.1 的错误。`TestScoreUsageCoverage` 与 `TestScoreUsageHalfReadDoesNotLiftTheBand` 仍锁住「只读到 bootCount 时 coverage 必须是 0」，`TestScoreUsageU2IgnoresRecentGenerations` 锁住「放宽后不得反过来变成扣分」。

若要让 coverage 反映字段完整度，需要把口径改成证据行加权——那会改变 R3/R4，建议 v2 再定，不在 v1 偷改。

### 5.3 总体 coverage

```
coverage(total) = (40 × c_declaration + 35 × c_behavior + 25 × c_usage) / 100
```

保留**两位**小数（`math.Round(v*100)/100`）。示例：`0.38`、`0.60`、`0.75`。

**为什么不是三位**：这套打分只有 10 个布尔标签、3 条轴，coverage 的格点本来就粗糙（declaration 只有 0 / 0.33 / 0.67 / 1，behavior 只有 0 / 0.17 / … / 1）。第三位小数只会在 `1/3` 这类值上制造 `0.333` 与 `0.33` 的差别，属于 §7.4 明确禁止的假精度。已枚举全部轴 coverage 格点在 R8 闸门附近的加权和，**没有任何组合会因为两位舍入而从 `<0.5` 翻成 `≥0.5`**（最近的组合恰好等于 50.0），所以两位不影响任何定级结论。

**契约要点**：JSON 数值不保留尾零（`0.70` 序列化成 `0.7`），测试按数值比较而不是字符串比较。

### 5.4 band

| band | 含义 | value 区间 | 附加条件 |
| --- | --- | --- | --- |
| `A` | 一致 | 85–100 | 无 decisive；无任何扣分（R11：有扣分即降 B） |
| `B` | 有疑点 | 70–84 | — |
| `C` | 可疑 | 50–69 | — |
| `D` | 高度可疑 | 0–49 | 或任意 decisive（不看 value） |
| `?` | 未知 | `null` | 总体 coverage < 0.5 |

**A 的含义必须写死**：A 只表示「本次归档里，我们能查的通道没有互相矛盾」，不表示设备安全、原厂、未被篡改。UI 上 A 旁边也要有这句话。

> 本表是 R1–R11 的规范。R10 **两层形态**（声明轴盲 → `?`；behavior/usage 轴盲 → 数字照常出版但禁止 A）与 R11（A 档要求零扣分）已在实现中落地并有测试锁住；§13 F4 记录的 A 档漏洞已由此关闭，红队发现的「删证据升档」方向也已由 R10 窄形态关闭（§4 R10）。

### 5.5 coverageLabel

| coverage | label | 含义 |
| --- | --- | --- |
| ≥ 0.900 | 充分可判 | 三条轴的标签基本都能判 |
| ≥ 0.600 | 部分可判 | 个别标签缺口 |
| ≥ 0.500 | 勉强可判 | 刚过闸门，结论要打折 |
| < 0.500 | 证据不足 | 不给数字 |

### 5.6 计算顺序（实现必须按这个顺序）

```
1. labels ← profileSignals(parameters)                 // 三态，不改
2. ledger ← 每个 hit 标签取最高分支（R2），生成 deduction
3. axes   ← 每轴 applied=min(Σpoints, 100)；score；coverage
4. caps   ← decisive 分支扫描（从证据重算，不读字符串）
5. coverage(total)                                     // 三轴加权，与给不给分正交
6. if coverage(total) < 0.5: value=null, band="?"       // R8，无条件
   if weights == 0:          value=null, band="?"       // 无任何轴有权重，无条件
   if declaration.coverage < 0.5 && 声明轴无扣分 && !decisive:
                             value=null, band="?"       // R10 严格形态（/5 收紧）
   else: included = axes where (coverage>=0.5 OR deductions 非空)        // R7 + 薄轴例外
         value = weighted_mean(included)
         band  = thresholds(value)
7. if band=="A" && 任一轴有扣分: band="B"                // R11，只降一档
7b.if band=="A" && 任一轴盲（coverage<0.5 且无扣分）: band="B"   // R10 窄形态，数字不动
8. if decisive: band="D"                                // R5，最后压档
9. undetermined ← 每个 insufficient 标签 + 可判标签里的不可用 key
10. 排序、取整、输出
```

第 6 步的三条闸门都要输出 `axes[].score = null`，但 `axes[].coverage` **照实保留**——coverage 回答「这一轴读到了多少」，与「给不给分」正交，把 coverage 也置 0 就把不给分的原因抹掉了。

第 8 步只覆盖 band，不覆盖 value：**低覆盖** + decisive 的输出是 `value:null, band:"D", decisive:true, caps:[...]`。前端必须先看 `caps` 与 `band`，不能因为 `value` 是 null 就把整块当「未知」。

**注意第 6 步与第 8 步不再矛盾**（`sigmark-score/5`）：修复前，一个「总体覆盖够、只是声明轴盲」的 decisive 报告会同时得到 `value=null` 与 `band=D`——**抑制和压档各自都对，合起来却出版了一个自相矛盾的文档**。修复后，第 6 步的第三条闸门带上了 `&& !decisive`，于是：

| 形状 | `value` | `band` | 理由 |
| --- | --- | --- | --- |
| 总体 coverage < 0.5（R8） | `null` | `D`（若 decisive） | **数字缺席本身就是结论**：证据不足一半，任何数字都是假精度 |
| `weights == 0` | `null` | `D`（若 decisive） | 同上，没有轴参与平均 |
| 声明轴盲 **且** 非 decisive | `null` | `?` | R10 的原意：不给没人看过的画面一个舒服结论 |
| 声明轴盲 **但** decisive | **有数字** | `D` | **已经没有「舒服」可保护**；数字只剩排序键这一个用途（§13 F5） |

R11（第 7 步）必须在 R5（第 8 步）之前，否则会把 D 抬成 B。

**R7 排除的轴不出版 `score`（`sigmark-score/5` 补上）**：第 6 步算出 `value` 之后，还要把**被 R7 排除**的轴（`coverage < 0.5` 且无扣分）的 `axes[].score` 置 `null`。否则文档**不可复算**：三轴印出来的分数加权算回去，等于不出那个 `value`。

实测（雷电 `6642e350`）：declaration 轴 coverage 0.33 被 R7 排除，若不置 `null` 就会印出 `declaration: 100`，于是三轴可见分给出 `(40×100 + 35×50 + 25×100)/100 = 82.5`，而出版的 `value` 是 **71**——审计员没有办法判断哪个数字是错的。置 `null` 之后规则统一为「**把有分的轴按权重加总，除以它们的权重**」，两种闸门下的读法完全一致。

（同一个形状在仿真器基准样本上是 `87.75` vs `80`：declaration 被排除、behavior 65、usage 100。两个样本的差额都来自同一条被 R7 剔除的轴。**另记一笔**：`score.go` 与 `score_ldplayer_test.go` 的注释里都写 `82.75`，这个数字**对不上任何一个样本**（雷电应为 `82.5`，仿真器基准应为 `87.75`）。本轮只改文档、未改代码，已记入 §13.1 待修。）

### 5.7 一个可复算的轴分例子

合成报告：声明轴命中 `hardware_declaration_conflict` 的**普通通道冲突**分支（30 分，非决定性），行为轴命中 `selinux_permissive`（15 分），使用轴两个通道都读不到。

```
declaration: applied = 30 → score = 100 − 30 = 70, coverage = 1.000
behavior:    applied = 15 → score = 100 − 15 = 85, coverage = 1.000
usage:       applied =  0 → score = null（coverage 0.000 < 0.5，不给分）

coverage(total) = (40×1.000 + 35×1.000 + 25×0.000) / 100 = 0.750 → 部分可判
included = {declaration, behavior}          // usage 覆盖 0 且无扣分，不进总分
value = round_half_up((40×70 + 35×85) / 75) = round(77.0) = 77
band  = 77 → B 有疑点                        // R11 无需介入，B 本来就非 A
```

这就是 §8.1 契约示例的全部数字。

**如果命中的是决定性分支**（比如 foreign-profile，同样 30 分），`value` 仍是 77 不变，但 `band` 被 R5 压到 **D** —— 这就是 §6.4「decisive 不等于确认是假机，但等级不再由分数决定」的样子。

**如果一条轴被扣满**（声明轴三分支全中，30+25+15 = 70）：

```
declaration: score = 30, behavior: 100, usage: 100, coverage = 1.00
value = round((40×30 + 35×100 + 25×100) / 100) = round(7200/100) = 72 → B
```

72 落 B —— **一条轴全崩不足以单独把总分拉进 D**，这是权重设计的必然结果。要进 D 只有两条路：决定性 cap，或两条以上轴同时崩。这是有意的：单点异常应该被别的证据校验，不该一击定生死。

---

## 6. 决定性命中

### 6.1 清单

| 分支 code | 所属标签 | 判定条件 | band |
| --- | --- | --- | --- |
| `FOREIGN_PROFILE` | `hardware_declaration_conflict` | 实测值与**另一颗已登记** SoC 的画像字段相等（`foreignProfile`，[hardware_facts.go:322](../backend/cmd/sigmark/hardware_facts.go#L322)） | D |
| `IDENTITY_APP_UID` | `identity_conflict` | App 侧与同名只读属性在 **model 或 device** 对上冲突，**或该对只有一侧可读**（`oneSidedIdentity`，[identity_consistency.go:70](../backend/cmd/sigmark/identity_consistency.go#L70)） | D |
| `VIRTUAL_BUILD_MARKERS` | `virtual_build_markers` | `cpu.hardware` / `system.product` / `system.device` 命中 ranchu / goldfish / vbox86 / emulator / `sdk_gphone*`（[device_profile.go:276](../backend/cmd/sigmark/device_profile.go#L276)） | D |
| `STRUCTURAL_VIRTUAL_EVIDENCE` | —（不走标签表） | **设备自相矛盾**：`cpu.cpuInfo` 报桌面 CPU 族名（硬通道，`/proc` 内核视图），或 `system.boardPlatform` 是通用平台串（软通道，`ro.board.platform` 属性）（[virtual_evidence.go:93](../backend/cmd/sigmark/virtual_evidence.go#L93)） | D |

**第四条是 `/4` 新增的，它和第三条的关系必须写清**：两条都走 `DECISIVE_VIRTUAL_BUILD` 这个 cap，但**互斥**——第三条（黑名单）命中时第四条不出手。原因不是省分，是**它们不是两个独立证据**：它们回答的是同一个问题「这是不是模拟器」，只是问的地方不同。第三条问设备自己（可被改写），第四条问设备有没有自相矛盾（改写成本高得多）。§13 F17 有实测。

### 6.2 foreign-profile 的判定

不是「值和声明不符」，而是「值和**另一个**登记画像完全相等」。这比「不符」强，因为它是一个**正向识别**：不需要知道被冒充的 SoC 应该是什么值，只需要知道实测值是另一颗芯片的。

Pixel 6 实例：声明 `mt6985`，实测 `cpu.cpuCapacity = 160/498/1024`、`memory.cmaTotal = 652 MiB`，两者都等于 `gs101` 的登记画像（[hardware_facts.go:29](../backend/cmd/sigmark/hardware_facts.go#L29)），因此 `foreignProfile` 为真、标签 hit、分支 `FOREIGN_PROFILE`。

**方向性限制（必须写进文档，也要写进 UI 提示）**：登记表里只有 `gs101` 填了 `capacities` 与 `cmaMiB`，其余 SoC 的这两项为空（[HANDOFF.md:60](HANDOFF.md)）。所以 foreign-profile **只能单向**识别「声明不是 gs101、实测像 gs101」。反向（声明 gs101、实测像别的芯片）不会触发 foreign，只会走 `HARDWARE_CHANNEL_CONFLICT`（30 分、非决定性）。把这一点藏起来，会让人误以为「没被判 D 就不是伪装」。§13 F7 给出两条修法。

还有一层前提：`declaredSoc` 必须能把声明解析到登记表内的 SoC（否则 `known=false`，capacity 与 CmaTotal 两条通道根本不会进入判定，[hardware_facts.go:92](../backend/cmd/sigmark/hardware_facts.go#L92)）。未登记 SoC 的机器永远不会被 foreign-profile 判 D，只会因为其他通道缺失而 `insufficient`。

### 6.3 identity 的 app-uid 分支

三对读数（[identity_consistency.go:7](../backend/cmd/sigmark/identity_consistency.go#L7)）：

| 对 | 左 | 右 | 分支 | 决定性 |
| --- | --- | --- | --- | --- |
| 型号 | `system.model`（`Build.MODEL`） | `system.propertyModel`（`ro.product.model`） | `IDENTITY_APP_UID` | 是 |
| 设备代号 | `system.device`（`Build.DEVICE`） | `system.propertyDevice`（`ro.product.device`） | `IDENTITY_APP_UID` | 是 |
| SKU | `system.sku`（`Build.SKU`） | `system.hardwareSku`（`ro.boot.hardware.sku`） | `IDENTITY_SKU` | 否 |

SKU 不作决定性的理由：API 31 以下没有 `Build.SKU`，`applicableIdentityPairs` 在「API ≤ 30 且 SKU 为空」时会直接丢掉这对（[identity_consistency.go:30](../backend/cmd/sigmark/identity_consistency.go#L30)）；Pixel 6 上 `ro.boot.hardware.sku` 还出现按 UID 改写导致的分裂（shell `GR1YH` / run-as `23078PND5G`，[HANDOFF.md:94](HANDOFF.md)），App 侧读数与候选不一致时无法区分「改写层」与「正常构建差异」。这条通道有真实的降级路径，不能和型号/设备代号同等对待。

### 6.4 decisive 不等于「确认是假机」

它只表示「这条证据按当前规则足以单独把结论压到 D」。它仍然可能来自实验环境（模拟器测试、云真机、故意伪装的红队样本）。`caps[].reason` 必须写清触发的是哪一条通道，不能只写「高度可疑」。

---

## 7. 四个陷阱

### 7.1 「没采到」不能等于「安全」

**合成样例 K**（字段集 25、旧内核、严格 SELinux、SoC 不在登记表；不是真实设备）：

| 标签 | 状态 | 原因 |
| --- | --- | --- |
| `virtual_build_markers` | `not_observed` | 三项声明可用且不匹配 |
| `selinux_permissive` | `insufficient` | 只读到「推断」 |
| `debugger_attached` | `insufficient` | `tracerPid` RESTRICTED，调试器标志 NOT_ARCHIVED |
| `hook_injection` | `insufficient` | 两个来源都 RESTRICTED |
| `root_manager_visible` | `insufficient` | RESTRICTED |
| `multi_open` | `not_observed` | `owner` |
| `rom_verification` | `not_observed` | enforcing + 关闭 |
| `software_drm` | `insufficient` | 设备没有 Widevine 读数 |
| `identity_conflict` | `insufficient` | 只读属性被拒，0 对可比 |
| `hardware_declaration_conflict` | `insufficient` | SoC 未登记，cpuParts/GPU/overlay 均不可用 |

7 个 `insufficient`，扣分合计 = 0。派生 usage 轴在样例中可判：`bootCount` 与 `initialSdk` 都可用，且 `bootCount` 不小、没有矛盾 → `not_observed`，所以 usage coverage = 1/1。

**`/4` 起这一行会多带四条 `unregistered_soc:` 标记**（§13 F18）：SoC 有声明但不在注册表，四个通道各留一条 basis。**聚合状态不变**（仍 `insufficient`，因为没有任何通道确认），而且这四条**不得进入 30 分计价**——否则这台设备会为四次从未发生的比较付钱。这正是 F18 里「危险的另一半」：留名是对的，留名变成扣分就是新 bug。

| 模型 | 轴 coverage（括号内为轴分） | 总分 | band |
| --- | --- | --- | --- |
| 朴素（只看扣分） | 不计算；三轴各 100 分 | **100** | **A 一致** |
| 正确（R3/R4/R7/R8） | declaration 0.000（—）；behavior 0.33（100）；usage 1.000（100） | **null** | **? 未知** |

计算：

```
coverage(total) = (40×0.000 + 35×0.33 + 25×1.000) / 100
                = (0 + 11.55 + 25) / 100 = 0.3655 → 0.37 < 0.5
→ value = null, band = "?"
```

注意：**两边的扣分都是 0**。区别完全来自 coverage。这正是「把读不到当成没有」与「把读不到当成未知」的分界；上一轮修掉的 `listNames` 缺陷（被拒目录被报成目录不存在，[HANDOFF.md:49](HANDOFF.md)）是同一个错误在字段层的版本。

**更隐蔽的变体（R1–R9 的口子，已被 R10 关闭）**：声明轴 0/3 全不可判，行为轴 6/6 全部确认无异常，使用轴 1/1 干净。

```
coverage(total) = (40×0 + 35×1 + 25×1) / 100 = 0.600 ≥ 0.5
included = {behavior, usage}
value = (35×100 + 25×100) / 60 = 100 → band A     ← R10 之前的结果
```

也就是说，**权重占 40% 的声明轴完全没查，仍然能拿 A**。这不是理论推演：字段集 20 的 4 份伪装报告就是长这个样子（§9.1.1）。

R10 落地后的结果是 `value=null`、`band="?"`、`coverage=0.60`——「读了 60% 但最关键的那 40% 一眼没看」必须说成未知，不能说成一致。coverage 仍然是 0.60，因为「读了多少」这个事实没变；变的只是「够不够下结论」。

### 7.2 平均分掩盖致命伤

**合成样例 P（九绿一红）**：10 个标签里 9 个 `not_observed`，只有 `hardware_declaration_conflict` 命中 foreign-profile 分支（30 分）。

| 步骤 | 计算 | 结果 |
| --- | --- | --- |
| 声明轴 | `100 − 30 = 70` | 70 |
| 行为轴 | 无扣分 | 100 |
| 使用轴 | 无扣分 | 100 |
| 朴素加权 | `(40×70 + 35×100 + 25×100)/100` | **88 → A 一致** |
| R5 之后 | value 仍 88，`decisive=true`，`caps=[DECISIVE_FOREIGN_PROFILE]` | **D 高度可疑** |

平均的算术很清楚：30 分的致命项被两条 100 分的干净轴摊薄成 88，**正好落在 A 档**。只要它参与平均，调权重只能改变摊薄比例，不能改变「被摊薄」这件事。R5 是唯一的结构性解法：把这条证据从定级函数里拿出来，单独决定 band。

顺带说明 R11 为什么必须存在：如果这台机器的冲突不是决定性分支（比如只扣 30 分但走普通通道冲突），88 就是最终结果，而 A 档标签写着「一致」——一条 30 分的实证冲突换来「一致」，这是不可接受的。R11 让它降 B。

这就是「九个好字段救一个坏字段」为什么必须禁止。

### 7.3 使用痕迹：最弱、最危险、最伤隐私的一轴

**先分清两件事**：

| 现象 | 例子 | 能不能扣分 |
| --- | --- | --- |
| **少** | `bootCount = 2`、应用少、照片少、联系人少 | **不能**。新机、恢复出厂、展台机、测试机都长这样 |
| **矛盾** | 同一台设备的「生命周期声称」与计数器对不上 | 可以，但只能低分、非决定性 |

规格举的例子是「分区建于 2021，而开机次数 2」。严格说这**不是逻辑矛盾**：`bootCount` 是「上次清数据以来的冷启动次数」，恢复出厂会重置（[SecurityObservations.kt:50](../app/src/main/java/com/sigmark/app/collector/SecurityObservations.kt#L50)）。2021 年的镜像 + 2 次开机，完全可能是一台刚被重置/翻新的机器。把它当「矛盾」而重罚，就是拿合法操作当伪装。

所以 usage 轴 v1 的定位只能是：

1. **绝不决定性**；
2. 标称分 12，使用轴轴分最多掉到 88，总分最多压到 97，再靠 R11 落到 B——**它靠分数本身连 B 都到不了**，这是有意的；
3. `detail` 必须写「先核对是否恢复出厂 / 刷机」，而不是「设备伪造」；
4. 真正的矛盾需要**同资产历史**里 `bootCount` 回退且分区日期不变——那才是「计数器被打回」的正向证据。v1 的画像窗口只有 30 天（[device_profile.go:16](../backend/cmd/sigmark/device_profile.go#L16)），做不到，列为 v2。

**误报面**：刚刷机的干净设备、测试机、展台设备、长期待机后重置的备用机，都会呈现「少」。这正是不能让它主导结论的原因。

**伪造面**：装 50 个应用、造几张照片，就能把「少」变成「正常」。usage 是最容易低成本满足的一轴；它提供的从来不是「真」的证据，只是「这次没发现矛盾」。所以它只能做佐证。

**隐私足迹**：v1 只用三个已经归档的字段，不新增权限。但一旦扩到「应用列表 / 照片数 / 联系人数」，量级完全不同——这些不是设备配置，是人的行为与社交关系。必须单独决策、单独开关、默认关闭，并且只上传计数/分档、不上传名称或内容。详见 §10.4。

### 7.4 分数会被博弈与假精度

- **87 与 88 没有意义**。v1 只有 10 个布尔标签、3 个状态、3 条轴；分数落在一个粗糙的离散格点上。1 分 ≈ 一次「某个标签从 insufficient 变成 not_observed」带来的 coverage 抖动。把 87/88 做成两个颜色，等于把噪声当信号。
- **规则是公开的**。仓库里的阈值、标签、分支 code 都能被读到；导出的画像 JSON 还带 `detail`。有动机的对手可以按规则逐项满足（尤其 usage）。打分是**分诊工具**，不是对抗性证明。不要声称它「防作弊」。
- **权重会漂移**。今天为了两个锚点调 5 分，明天为了一个新样本再调 5 分，分数就失去可比性。所以权重必须版本化：`sigmark-score/5` 固定当前这一套；任何权重、阈值、决定性清单、覆盖公式、轴归属的改动都升 `sigmark-score/6`，并让黄金测试表现为**显式 diff**，而不是静默漂移。
- **界面只给结论**。band + coverage + decisive 是主产物；`value` 放小字或排序控件里；不要给 87 和 88 两种颜色。

---

## 8. JSON 契约

`score` 是 `/api/admin/reports/{id}/device-profile` 响应顶层的**新增可选成员**，与 `labels` 平级。报告上传 JSON（`schemaVersion: 4`）不变；手机端不接收、不渲染、不计算 `score`。

### 8.1 完整示例（合成报告；数字与 §5.7 一致）

```json
"score": {
  "version": "sigmark-score/5",
  "value": 77,
  "band": "B",
  "bandLabel": "有疑点",
  "coverage": 0.750,
  "coverageLabel": "部分可判",
  "decisive": false,
  "axes": [
    {
      "code": "declaration",
      "label": "声明一致性",
      "weight": 40,
      "score": 70,
      "coverage": 1.000,
      "deductions": [
        {
          "code": "HARDWARE_CHANNEL_CONFLICT",
          "label": "hardware_declaration_conflict",
          "axis": "declaration",
          "points": 30,
          "keys": ["memory.totalRam", "memory.kernelMemTotal"],
          "detail": "多条独立通道互相矛盾（ram_dispersion）：memory.totalRam=12.00 GiB；memory.kernelMemTotal=7.44 GiB"
        }
      ]
    },
    {
      "code": "behavior",
      "label": "行为风险",
      "weight": 35,
      "score": 85,
      "coverage": 1.000,
      "deductions": [
        {
          "code": "SELINUX_PERMISSIVE",
          "label": "selinux_permissive",
          "axis": "behavior",
          "points": 15,
          "keys": ["system.selinux", "system.selinuxEvidence"],
          "detail": "系统直接报告 Permissive；不是历史推断。"
        }
      ]
    },
    {
      "code": "usage",
      "label": "使用真实性",
      "weight": 25,
      "score": null,
      "coverage": 0.000,
      "deductions": []
    }
  ],
  "caps": [],
  "undetermined": [
    {
      "axis": "usage",
      "keys": ["system.bootCount", "system.partitionBuildDates"],
      "reason": "UNAVAILABLE"
    }
  ]
}
```

### 8.2 字段表

| 路径 | 类型 | 空值 | 语义与稳定性 |
| --- | --- | --- | --- |
| `score.version` | string | 否 | 打分规则版本；与 `ruleVersion`（`sigmark-profile/9`）独立 |
| `score.value` | int | 可 null | 0–100；**三种情况为 `null`**：① R8（总体 coverage < `scoreCoverageFloor`）② `weights == 0`（没有任何轴有权重）③ 声明轴盲 **且** 非决定性（R10 严格形态）。**决定性命中不再是 `null` 的理由**（`/5` 改） |
| `score.band` | enum | 否 | `A` / `B` / `C` / `D` / `?`；**结论** |
| `score.bandLabel` | string | 否 | 一致 / 有疑点 / 可疑 / 高度可疑 / 未知 |
| `score.coverage` | number | 否 | 0–1，两位小数；标签可判率，不是字段完整率 |
| `score.coverageLabel` | string | 否 | 充分可判 / 部分可判 / 勉强可判 / 证据不足 |
| `score.decisive` | bool | 否 | 是否有决定性分支命中 |
| `score.axes` | array | 否 | 固定 3 项，顺序 declaration → behavior → usage |
| `axes[].code` | enum | 否 | `declaration` / `behavior` / `usage` |
| `axes[].label` | string | 否 | 中文名，仅展示 |
| `axes[].weight` | int | 否 | 40 / 35 / 25；同一 score 版本内不变 |
| `axes[].score` | int | 可 null | `null` 有两种来源：① 该轴 `coverage < 0.5` **且** `deductions` 为空（R7 排除 + R10 盲轴）② 整份文档走了不给分的闸门（R8 / `weights == 0` / R10 声明轴盲）。**带扣分的薄轴不置 `null`**——它进了总分，就必须有分 |
| `axes[].coverage` | number | 否 | 0–1，两位小数 |
| `axes[].deductions` | array | 否 | 每标签最多 1 条（R2） |
| `deductions[].code` | enum | 否 | 分支 code，见 §2.3 |
| `deductions[].label` | string | 否 | 布尔标签 code；usage 用派生标签 |
| `deductions[].axis` | enum | 否 | 必须与所在轴一致（冗余，见 §3.1） |
| `deductions[].points` | int | 否 | 标称分；1..100（轴内百分制，与轴权重无关） |
| `deductions[].keys` | string[] | 否 | ≥1，必须来自该标签的 evidence |
| `deductions[].detail` | string | 否 | 一句话人话；模板生成 |
| `caps[]` | array | 否（空数组） | 仅 decisive 时非空 |
| `caps[].code` | enum | 否 | `DECISIVE_FOREIGN_PROFILE` / `DECISIVE_IDENTITY_APP_UID` / `DECISIVE_VIRTUAL_BUILD` |
| `caps[].band` | string | 否 | 固定 `D` |
| `caps[].reason` | string | 否 | 说明触发通道，不含建议 |
| `undetermined[].axis` | enum | 否 | 所属轴 |
| `undetermined[].keys` | string[] | 否 | 1..8，按字典序 |
| `undetermined[].reason` | enum | 否 | **七个值**：`UNAVAILABLE` / `RESTRICTED` / `ERROR` / `NOT_ARCHIVED` 是字段状态；`PROFILE_UNSET` 是第五个，语义不同——「App 读到了，但登记表没写期望值」；`UNMAPPED_SDK_LEVEL`（第六个）是「`initialSdk` 读到了但不在年份表里」；`UNPARSEABLE_PARTITION_DATES`（第七个）是「分区日期读到了但解析不出年份」。后两个自 `sigmark-score/2` 起出现（见 §4 R4 与 §13 F12）。前端必须显式列出，未识别的值原样透出 |

### 8.3 排序与确定性（**已实现**）

> **状态**：本节**已经落地**，由 `orderScoreAxes` / `orderScoreUndetermined` / `caps` 排序三处实现，测试 `TestScoreGoldenFreezesRealDevices`（逐字节比对整份文档）与前端 `the ledger preserves backend order instead of re-sorting` 共同锁住。理由是导出的可复现性：同一台设备两次采集必须产出逐字节相同的文档，否则黄金文件的 diff 无法区分「设备变了」和「map 遍历顺序变了」。

- `axes` 顺序固定，不随命中变化；——**已实现**（`scoreAxisOrder`）
- `deductions` 按 `points` 降序、同分按 `code` 升序；——**已实现**（`orderScoreAxes`；Pixel 6 现在是 `FOREIGN_PROFILE 30` 在前、`OVERLAY_CODENAME_MISMATCH 15` 在后）
- `caps` 按 `code` 升序；——**已实现**
- `undetermined` 按轴序、reason、keys 字典序；——**已实现**（`orderScoreUndetermined`）
- 每轴 deduction 上限：declaration **3** 条、behavior **6** 条、usage **1** 条；——**是自然上限，不是强制截断**（declaration 最多 3 条＝三个分支各一条；behavior 最多 6 条＝六个计分标签；usage 1 条）。刻意不做截断：账本静默丢条目比长账本更糟，读者无法察觉它发生过。
- `undetermined` 按 `axis+reason` 分组，最多 24 组，每组最多 8 个 key；——**分组与去重已实现，组数/条数上限未实现**（上限是为了防止恶意报告撑爆响应，属于独立的限流问题；同组内 keys 已排序去重）
- `coverage` 的语义精度是两位小数；JSON 数值不保留尾零（`0.70` 会序列化成 `0.7`），测试按数值比较而不是字符串比较；——**已实现**（`roundScore`）
- 所有数值用整数 + half-up，禁止浮点不确定行为。——**已实现**

#### 8.3.1 文档必须可复算：R7 排除的轴不出版 `score`（`sigmark-score/5` 修复）

**不变量**：把 `axes[]` 里**有 `score` 的轴**按权重加总、除以这些轴的权重之和，必须等于 `value`。这条不变量是「确定性」的一部分——一份不可复算的文档，读者无法判断是分数错了还是账本错了。

**修复前这条不变量被破了两次，第二次只在模拟器数据上可见**：

行为轴的 `finalizeScoreAxis` 原本在**结构通道追加之前**调用。于是那条 35 分的 `STRUCTURAL_VIRTUAL_EVIDENCE` 被追加到账本之后，**轴分早已算完、再没重算**：

| 字段 | `/4` | `/5` |
| --- | --- | --- |
| behavior `deductions` 合计 | 35 + 15 = **50** | 35 + 15 = **50**（账本没变） |
| behavior `score` | **85**（= 100 − 15，只减了 SELinux） | **50**（= 100 − 50） |
| usage `score` | **88**（U2 又收了 12 分） | **100**（§10.2.1） |
| `value` | **`null`**（被 R10 吞掉，见 §4 R10） | **71** |

也就是说 `/4` 的归档报告**自己打自己**：账本列出 50 分的扣分，轴分却写 85。修复方式是把 `finalizeScoreAxis(&axis, ...)` 移到结构通道追加**之后**（[score.go:1092](../backend/cmd/sigmark/score.go#L1092)），声明轴与使用轴的调用点不变（[score.go:958](../backend/cmd/sigmark/score.go#L958)、[:1315](../backend/cmd/sigmark/score.go#L1315)）。

**两个缺陷互相掩盖，这一点必须记下来**：`/4` 时期这份报告的 `value` 是 `null`，所以「轴分算错」**在总分上根本看不出来**——没有数字可以对比。它唯一的表现形式是**文档内部矛盾**（账本 50、轴分 85）。也就是说：如果只修 `finalizeScoreAxis` 而不修 R10，总分仍然印不出来，这个顺序错误会继续隐身；如果只修 R10 而不修 `finalizeScoreAxis`，报告就会出版一个**从自己的轴复算不出来**的 91。**两处必须一起修**，`/5` 才是自洽的。

（`/5` 的 71 可复算：`(35×50 + 25×100)/60 = 70.83 → 71`。`/4` 若把两处都按错的状态硬算，会得到 `(35×85 + 25×88)/60 = 86.25 → 86`——但这个数字从来没有被出版过，因为 R10 把 `value` 吞了。记在这里是为了说明：**「修复前的总分是多少」这个问题没有答案**，`/4` 根本没给数。）

**这个缺陷在真机上完全不可见。** 真机永远不触发结构通道（`cpu.cpuInfo` 报的是 ARM 手机 SoC、`system.boardPlatform` 不是通用串），所以那条 append 永远不发生，`finalizeScoreAxis` 的调用位置也就无所谓。只有**模拟器数据**才把这个顺序错误暴露出来。

> **方法论（值得单列）**：这是「**测试样本必须包含攻击样本**」的活例证。五份黄金文件里有 Pixel 6 和 MI 8 两台真机，它们在这条缺陷上永远是绿的——不是因为代码对，是因为它们走不到那段代码。一个只由正常样本组成的回归集，会把「只在异常样本上出现」的 bug 保护起来，而不是抓住它。红队样本（雷电 / AVD）不是「额外的保险」，它们是**唯一能看见这类缺陷的眼睛**。

### 8.4 兼容与降级

| 情况 | 行为 |
| --- | --- |
| 旧后端没有 `score` | 前端隐藏整块，保留现有 `labels`；不猜测分数。✅ 已实现：`ScorePanel` 返回 `null` |
| `score.version` 未知（如 `/2`） | ✅ **已实现**：`scoreView()` 比对 `scoreVersion`；不认识就**不上色**（`tone` 强制 `bandTones['?']`）、`band` 与 `value` 原样透出（后端算的，前端不许改写）、`versionWarning` 非空且由 `score-panel.tsx` 置顶显示。**缺 `version` 字段同样按未知处理**——旧后端不写这个字段，默认它和当前前端用同一套阈值是错误假设 |
| 打分计算失败 | 后端省略 `score`，照常返回 `labels`；不能把失败写成 0 分或 A |
| 报告未归组 / 无历史 | 不影响：v1 打分只用当前报告字段，不用历史 |
| 字段集 < 25 的旧报告 | 照常计算；大量 key 为 `NOT_ARCHIVED` → coverage 低 → `?`，这是正确结果 |

**为什么「不上色」而不是「换一套颜色」**：颜色是「我们按当前阈值认为它属于哪一档」的判断，不是数据本身。阈值可能已经变了，硬染就是用一个过期结论覆盖一个更新的事实。反过来，数字和 `band` 是后端当场算的，前端改写它们同样是撒谎。所以降级的正确形态是**保留数据、撤掉判断、明说原因**——三者缺一不可。

测试锁在 `backend/web/test/score-view.test.mjs` 的四个 case：未知版本停色、缺字段按未知、当前版本不受影响（防止「降级逻辑」退化成「永远降级」）、真实仿真器样本仍走正常路径。

> **当前状态警告（`sigmark-score/5` 落地时）**：前端常量仍是 `'sigmark-score/4'`（[score-view.ts:78](../backend/web/src/score-view.ts#L78)），后端已出版 `/5`。所以**此刻每一份新报告都会走「未知版本」路径**：不上色、`versionWarning` 置顶，`band` 与 `value` 仍原样透出。四个 Web 测试**全部通过**，因为它们引用的是同一个常量——**两边一起错，测试证明的只是自洽**。这不是设计问题，是常量没跟上；见 §13.1 第 13 项。

### 8.5 命名冲突提醒

报告 JSON 顶层已有 `coverage`，含义是**字段覆盖**（[protocol.go:501](../backend/cmd/sigmark/protocol.go#L501)，`[]Coverage`，按组统计 AVAILABLE/RESTRICTED/... 的条数）。`score.coverage` 是**标签可判率**。两者同名不同义，文档、日志、前端变量名都必须带上下文；不要把它们相加或互换。

### 8.6 前后端义务

**后端**：

- 纯函数投影，不写库、不回写报告、不改 `labels`；
- 从证据重算分支与 decisive，不读存储的 `reason` 文案；
- `hardwareFactsLabel` 需暴露通道明细（同函数内重构，三态语义不变）；`identity` 直接用 `compareAppIdentity` 的 pair 结果；
- `fresh_boot_on_aged_rom` 的判定写在同一个投影模块里，不从手机端读结论；
- 失败时省略 `score`，不得输出半成品。

**前端**（[device-profile.tsx](../backend/web/src/device-profile.tsx)）：

- band 作为主标签，放在标题行；`caps` 作为不可折叠警示条，排在分数之前；
- `value` 只出现在「按分数排序」控件或小字；不得把 87/88 做成两个色阶；
- `undetermined` 默认折叠，按轴分组，文案写清「这些是没查到的项，不是通过项」；
- `score` 缺失时整块降级（已实现：`ScorePanel` 返回 `null`）；**版本未知时降级**（已实现：`scoreView()` 不认识的 `version` → `tone` 强制 `unknown` 不上色、数字与 band 原样透出、`versionWarning` 置顶显示；缺 `version` 字段同样按未知处理。见 §8.4 与 §13 F12）；
- 保留现有 10 个标签的明细视图（`labels` 仍是事实层，`score` 是派生结论层）。

### 8.7 版本对应与升版规则

`sigmark-score/5` 对应 `sigmark-profile/9` 与字段集 26。两者独立升版：

| 变更 | 升 `sigmark-score` | 说明 |
| --- | --- | --- |
| 标称分、轴权重、band 阈值、决定性清单、coverage 公式、轴归属 | **是** | 任何一项都会改变同样证据的结论，必须表现为黄金 diff |
| 新增 / 删除布尔标签，或标签顺序变化 | **是**（同时升 `sigmark-profile`） | coverage 分母变化，旧分数不可比 |
| **标签的状态映射变化**（同一份证据判出的 `state` 变了） | **是**（同时升 `sigmark-profile`） | 标签语义变了 → 画像升版；它会移动 band → 打分升版。`/2` → `/3` 就是这种情形 |
| 新增判定信号但全库零命中（`/2` 的 U2） | **是** | 口径变了就要升版，哪怕当前数据上没翻档 |
| **已有信号的触发条件收紧 / 放宽但全库零命中**（`/3` 的一侧身份不对称） | **是** | 同上：契约与命中数无关。全库 23 份零漂移，照样升版 |
| **新增一条绕开标签表、直接读 `parameters` 的扣分通道**（`/4` 的结构性虚拟证据） | **是**，但**不必**升 `sigmark-profile` | 标签层一个字没改（10 个标签、三态、证据行形状全不变），所以 `profileVersion` 不动；但它新增 35 分 + 决定性 cap，会移动 band |
| 字段集新增，但 `sigmark-score/5` 不读 | 否 | 例如 v26 的 `system.bootQemu`（已归档，尚无判据读它） |
| `detail` 文案润色 | 否 | 语义黄金不变；文本快照更新并在 PR 说明 |
| 旧报告缺字段 | 否 | 这是 `NOT_ARCHIVED` 的正常结果，不是规则变更 |

**「零命中也要升版」已经有两个实例，这条规则不再是一次性的判断**：

1. **`/1` → `/2`**：新增 U2（`initialSdk` 世代年龄）。全库 23 份**零命中**，仍升版——因为它改变了「什么算可判」，口径变了。
2. **`/2` → `/3`**：`identity_conflict` 新增「一侧可读、另一侧为空」这个 `hit` 条件。全库 23 份**逐份零漂移**（见 §9.1.1 第三次复核），仍升版——因为契约变了，命中数只是**当前数据的一个属性**，不是契约的属性。

**「升哪一层」由「哪一层变了」决定，不由改动大小决定**：`/3` 同时升 `score` 和 `profile`（标签状态映射变了）；`/4` 只升 `score`（标签层没变，新通道在标签表之外）。两条都合理，区别只在于改动落在哪一层。

**为什么这条要写死**：如果「没命中就不升版」，那么第一条真正命中的报告出现时，它的 `version` 会和一堆口径不同的旧报告混在一起，而 `version` 存在的唯一目的就是区分这件事。**升版的门槛是「契约变了」，不是「结论变了」。**

黄金测试里的 `version` 是断言的一部分：只改权重不升版，测试必须失败；只升版不改权重，也应当在评审里被质疑。

---

## 9. 校准

### 9.1 两个锚点

| 锚点 | 报告 id | 已知事实 | 必须落点 | 说明 |
| --- | --- | --- | --- | --- |
| Pixel 6（改装） | `745264e0-3227-452b-bb87-65f9bd314fe9` | `hardware_declaration_conflict = hit`，10 条证据全 AVAILABLE，`cpu.cpuCapacity=160/498/1024`、`cmaTotal=652 MiB`（[HANDOFF.md:88](HANDOFF.md)） | **D** | foreign-profile 决定性；任何非 D 都说明 decisive 分支没接上 |
| MI 8（未改装，API 29 / 内核 4.9） | `77e577c1-c84b-4c5e-bb53-a9fe882be7bf` | `hardware_declaration_conflict = not_observed`，`cpuCapacity=UNAVAILABLE`、`overlayDeviceCodename=UNAVAILABLE`（[DEVICE-VALIDATION.md:86](DEVICE-VALIDATION.md)） | **A 或 B** | 若落 C/D，说明旧内核的诚实降级被当成了证据缺口或异常 |

Pixel 6 的预期数字（按 R1–R11，行为轴干净、使用轴干净）：声明轴扣 `FOREIGN_PROFILE 30 + OVERLAY_CODENAME_MISMATCH 15 = 45` → 轴分 55；加权 `(40×55 + 35×100 + 25×100)/100 = 82` → 落 B，再被 R5 压到 **D**。

### 9.1.1 全库回算实测（历史 23 份 + 雷神 1 份 = 24 份，真实二进制、真实库）

这一步是 §9.3 要求的「先回算」的**已完成部分**，结果不是推断。下面这张表是 `/1` 时期对 **23 份历史报告**的回算；`/4` 之后新增第 24 份（雷神模拟器 `ce1bdc7f`），它的结果见本节末尾的「第四次复核」。

| 报告 | 字段集 | 设备 | value | band | coverage | decisive |
| --- | --- | --- | --- | --- | --- | --- |
| `745264e0` | 25 | Pixel 6 伪装 | 82 | **D** | 0.94 | ✅ `DECISIVE_FOREIGN_PROFILE` |
| `77e577c1` | 25 | MI 8 干净 | 100 | **A** | 0.81 | — |
| `2d1eccd0` / `b45a97a6` / `2dab6ca7` / `7c786f17` / `7eda351b` | 25 | Pixel 6 伪装 | 82 | **D** | 0.94 | ✅ |
| `99c3c23b` 等 3 份 | 25 | MI 8 干净 | 100 | **A** | 0.81 | — |
| `c0f517f1` / `c9cf53d5` | 24 | Pixel 6 伪装 | 82 | **D** | 0.94 | ✅ |
| `933fedf6` / `76423849` / `4263018e` | 23 | Pixel 6 伪装 | 82 | **B** | 0.94 | — |
| `ddb2b82e` | 22 | Pixel 6 伪装 | 88 | **B** | 0.81 | — |
| `890f2714` 等 4 份 | 20 | Pixel 6 伪装 | null | **?** | 0.54 | — |
| `a65bfefe` / `3791eb62` / `ed0d9ff6` | 16 | 伪装 / 干净 | null | **?** | 0.06 | — |

**D 组的 8 个 id 逐个列出**（`23078PND5G`，Pixel 6 伪装 Xiaomi，全部 `band=D` / `value=82` / `coverage=0.94` / `decisive=true`）：`2d1eccd0-b1dd-4a0b-9c34-9f39d31072c4`、`745264e0-3227-452b-bb87-65f9bd314fe9`（基准真机）、`b45a97a6-8d02-4043-95ac-6a0dd1ce4e01`、`2dab6ca7-5ea1-45bf-99ef-1c9f4b0ba167`、`7c786f17-5652-4070-8e86-42066093200e`、`7eda351b-5225-4c25-b352-adc24d76744d`、`c0f517f1-5bc6-4766-a7ae-3c507bf4c07d`、`c9cf53d5-80b5-431b-80f6-b1d241c45bc0`。其中 6 份字段集 25、2 份字段集 24。

**第二次复核：升 `sigmark-score/2` 后（2026-11-26）**：23 份报告**全部**返回 `version=sigmark-score/2`；**每份的 band / value / coverage 与升版前逐份完全一致**，没有任何一份翻档。分布是 **A 4 / D 8 / B 4 / ? 7**（比上一版成表时多 1 份，多出来的是字段集 25 的 Pixel 6 伪装报告 `b45a97a6`，因此 D 组由 7 增至 8）。这是「升版但不改判」的干净落地。

**第三次复核：升 `sigmark-score/3` + `sigmark-profile/9` 后（2026-11-26）**：仍 **23 份**、全部返回 `version=sigmark-score/3`、`ruleVersion=sigmark-profile/9`；**每份的 band / value / coverage / decisive 与 `/2` 时逐份完全一致**，**零漂移**。分布仍是 **A 4 / D 8 / B 4 / ? 7**。

**这一轮尤其值得记**：`/3` 改的是 `identity_conflict` 的**状态映射**（新增「一侧可读一侧为空 → `hit`」），这是会移动 band 的改动，理论上最该翻档。它没翻，原因**不是**改动无害，而是：

- 那 7 份「身份不对称」的旧报告全是字段集 16 / 20，`propertyModel` / `propertyDevice` / `hardwareSku` **整行不存在**（`NOT_ARCHIVED`），被第一条跳过条件挡掉了；
- 其余 16 份的身份对两侧都 AVAILABLE，没有不对称。

也就是说：**「零漂移」在这里是跳过条件写对了的证据，不是「改动没影响」的证据**。如果当初把 `NOT_ARCHIVED` 也算作不对称，这 7 份会全部从 `?` 变成带扣分的报告，D 组会暴涨。**全库回算的价值就在这里：它是唯一能区分「设计正确」和「碰巧没触发」的手段。**

**第四次复核：升 `sigmark-score/4` 后（2026-11-26）**：报告库变成 **24 份**（新增雷神模拟器报告 `ce1bdc7f`），全部返回 `version=sigmark-score/4`，`ruleVersion` 仍 `sigmark-profile/9`（**画像层没动**——新证据是 score 层直接从 `parameters` 读的，不经过标签）。**原有 23 份逐份零漂移**；第 24 份是新增的，`band=D`、`decisive=true`。分布 **A 4 / D 8 / B 4 / ? 7 / 雷神 D**（共 24）。

**第四次为什么必须升 `sigmark-score` 却不必升 `sigmark-profile`**：`STRUCTURAL_VIRTUAL_EVIDENCE` 不是新标签，也不是既有标签的状态映射变了——它是一条**在标签表之外、直接读 `parameters` 的扣分通道**。`profileSignals` 的 10 个标签、三态定义、证据行形状**一个字都没改**，所以 `profileVersion` 保持 `/9`。这条区分很重要：**升版看的是「哪一层变了」，不是「这次改得大不大」。**

**第五次复核：升 `sigmark-score/5` 后（2026-11-26）**：报告库仍是 **24 份**，全部返回 `version=sigmark-score/5`，`ruleVersion` 仍 `sigmark-profile/9`。**两台真机（Pixel 6 `867ad26e`、MI 8 `77e577c1`）逐份零漂移**——这正是这两处修复应当有的形状，因为它们只碰模拟器数据。

**漂移集中在雷电报告 `6642e350`（字段集 25）**，逐项实测：

| 字段 | `/4` | `/5` | 变化原因 |
| --- | --- | --- | --- |
| `value` | `null` | **71** | R10 收紧为 `declarationBlind && !Decisive` |
| `band` | D | **D** | 未变——决定性 cap 本来就钉在 D |
| `coverage` | 0.73 | **0.73** | 未变——U2 抑制不动可判性 |
| declaration 轴 | `score=null`, cov 0.33 | `score=null`, cov 0.33 | 未变（R7 排除，`/5` 只是确保它不印分） |
| behavior 轴 | **85**（账本却是 50） | **50** | `finalizeScoreAxis` 移到结构通道追加之后 |
| usage 轴 | **88**（U2 扣 12） | **100** | 虚拟化已确认，`FRESH_BOOT_ON_AGED_ROM` 不重复计费 |

`/4` 时期这份报告**自相矛盾**：账本列出 35 + 15 = 50 分的扣分，轴分却写 85（= 100 − 15）。`/5` 之后账本与轴分一致，`value` 也可从印出来的轴复算：`(35×50 + 25×100)/60 = 70.83 → 71`。**`band` 一次都没有变**——所以 `/5` 修的是「账本与分数的一致性」，不是判级标准。

**另一份雷电报告 `ce1bdc7f`（字段集 20）只受 `finalizeScoreAxis` 顺序影响**：它的结构通道同样命中，所以行为轴分同样比 `/4` 低 35 分（一条 35 分的扣分从「没进计算」变成「进了计算」）。`band` 仍是 D、`decisive` 仍是 true，这两项都不动。

**为什么 `sigmark-score/5` 仍然不升 `sigmark-profile`**：两处修复都不碰标签层。R10 的例外读的是 `out.Decisive`（score 层已有的事实）；U2 抑制读的是 `virtualEvidenceConfirmed`，它复用**已有的**黑名单标签与**已有的**结构通道读数函数，没有新增标签、没有改三态语义。字段层也没有新增必需键——`system.bootQemu` 是字段集 26 的新增，但 `/5` 的判据**不读它**（见 §13 F19）。

**U2 在生产报告库的命中数 = 0**，原因有据可查：Pixel 6 的 `initialSdk=33`（2022）但 `bootCount=86`；MI 8 的 `initialSdk=27`（2017）但 `bootCount=56`。两台真机的开机次数都远大于 `usageFreshBootCeiling(2)`，所以 U2 正确地没有触发。**U2 是新增覆盖，不是收紧口径**——这也是它对现有 23 份样本零影响的原因。**但「生产库 0 命中」不等于「没有阳性样本」**：仿真器上已实测到 1 份，且它暴露了真实的误报风险，见 §9.5 与 §10.2。

**关键结论**：没有任何一份伪装报告落 A，没有任何一份干净报告落 C/D。旧字段集落 `?` 是因为当时确实没采到声明通道，这是诚实降级，不是误判。

字段集 23 的三份落 **B** 而非 D，也是正确的：决定性分支依赖 `cpu.cpuCapacity` / `memory.cmaTotal`，这两个通道字段集 24 才引入，23 及更早的报告根本没有这两个读数，所以只能按「普通通道冲突」计 30 分，不能冒充决定性。**这正是「未登记就不猜」在打分层的体现**。

**回算抓到的三个真实缺陷**（都已修，见 §13 F4 修订记录）：

| 缺陷 | 症状 | 根因 | 修法 |
| --- | --- | --- | --- |
| A 档漏洞 | 字段集 20 的 4 份伪装报告 = 100 / A | declaration 轴 coverage = 0，被 R7 整条排除，另两轴满分顶上 | **R10**：声明轴盲 → `?` |
| A 档漏洞 | 字段集 22 的伪装报告 = 88 / A | 30 分实证冲突被另两轴满分稀释 | **R11**：A 档要求零扣分 |
| 负面发现被丢弃 | 薄轴（coverage 0.33）带 25 分 identity 冲突时整条被排除 | R7 只看 coverage，不看有没有找到东西 | **R7 薄轴例外**：带扣分的薄轴仍计入 |

这三条都是**先有数据、后有规则**：不是设计时想到的，是把 22 份真实报告跑一遍之后暴露出来的。这也是为什么 §9.3 把「先回算」排在「定权重」之前。

### 9.2 约束表（回算实测结果）

| # | 约束 | 计算（`100 − 扣分合计`，截断到 100） | 实测 |
| --- | --- | --- | --- |
| 1 | Pixel 6 → D | 声明 45 → 轴分 55；`(40×55+35×100+25×100)/100 = 82`，R5 压 D | ✅ 82/D |
| 2 | MI 8 干净 → A | 无扣分 → 100 | ✅ 100/A |
| 3 | 使用轴单独命中 12 → B | `(40×100+35×100+25×88)/100 = 97`，R11 降 B | ✅ 97/B |
| 4 | overlay 单独命中 → B | 声明 15 → 轴分 85；`(40×85+35×100+25×100)/100 = 94`，R11 降 B | ✅ 94/B |
| 5 | hook 单独命中 → B | 行为 25 → 轴分 75；`(40×100+35×75+25×100)/100 = 91`，R11 降 B | ✅ 91/B |
| 6 | identity app-uid → D | 25 分、决定性 | ✅ |
| 7 | 模拟器 → D | 行为 35 → 轴分 65；但覆盖不足，`value=null`，R5 仍给 D | ✅ **真机实测** D/null/0.67/decisive |
| 8 | 7 个 insufficient → `?` | coverage 0.37 < 0.5 | ✅ |
| 9 | 全轴崩到底 → D（无 cap） | 声明 70→30、行为 115→0、使用 12→88；`(40×30+0+25×88)/100 = 34` | ✅ 34/D |

第 3–5 行说明一件重要的事：**单条发现靠分数本身很难跌出 A 档**（97、94、91 都在 A 区间），所以 R11「A 档要求零扣分」不是锦上添花，而是**唯一**能表达「有一条不一致」的机制。没有 R11，一条 12 分的矛盾会被平均成 97/A。

第 9 行证明 D 档不依赖决定性 cap：声明轴的理论下限是 `100−70=30`（不是 `100−40=60`），所以「全面不符」的设备能靠分数自己走进 D。

这 9 条只验证「端点」与「方向」，**不验证行为轴内部的相对权重**。两个锚点都没有 hook / debugger / permissive / multi-open 阳性样本，所以 25 / 20 / 15 / 8 这些数字目前是**先验假设，不是标定结果**。必须诚实标注。

**第 7 行不是纸上推演**：它在真机（android-34 `google_apis` x86_64 仿真器，报告 `ff32a085-bc4a-42b0-88d0-ed13ce21f23b`）上实测得到，且连续两次采集结果完全一致。这份样本的价值在于它同时踩中两个条件——**决定性命中** + **覆盖不足 0.5**——这是 Pixel 6（0.94）和 MI 8（0.81）都到不了的组合，也正是第二轮红队 P0 缺陷（`decisive=true` 却 `band="?"`）的触发形态。它现在是一份黄金文件（`testdata/score-emulator.golden.json`），见 [EMULATOR-LAB.md §7](EMULATOR-LAB.md)。

### 9.3 先回算，再定权重

顺序不能反。先定权重再找理由，等于用两个锚点给拍脑袋的数字背书。

1. **只回算状态矩阵，不引入权重**：对全部历史报告跑现有 `profileSignals`，落一张 `(report_id, label, state, evidence_status)` 表；这一步与打分无关，可独立验收。
2. **看分布**：各标签的 hit / not_observed / insufficient 比例；有多少报告能凑够「声明 + 行为」两轴 coverage ≥ 0.5；旧字段集报告的 `?` 占比。
3. **定约束**：把 §9.2 的 9 条作为不等式，求一组标称分。若不止一组解，取最接近规格建议值的那组。
4. **敏感性**：每个标称分 ±5，检查约束是否翻转。翻转说明该数字没有被数据支撑，标记为「待标定」。
5. **冻结当前版本**（`sigmark-score/5`），生成黄金测试，最后才接 UI。

回算是只读批处理：分页读 `reports`，逐份计算，输出 JSON/CSV，不写库、不改报告。注意 `backend/scripts/qa_device_profile.py` 目前是过期的（断言字段集 21 / `sigmark-profile/5`，[HANDOFF.md:106](HANDOFF.md)），回算脚本不能复用它，得先修或另写。

#### 9.3.1 第 4 步的实测结果：权重分成两簇，不是一条梯队

第 4 步以前只是写在纸上的流程。现在它跑过了，代码是 `TestScoreBehaviorWeightsAreNotBandSensitive` 与 `TestScoreBehaviorWeightsSeparateIntoTwoClusters`，结论**不是「权重都被验证了」**，而是：

**band 对权重完全不敏感。** 六个标称分逐个 ±5，Pixel 6 / MI 8 / 三个仿真器变体的 band 一次都没有翻转。但这几乎不能说明权重好——band 是被 R5（决定性命中压 D）和 R11（A 档要求零扣分）决定的，算术在里面几乎没有发言权。**用 band 来验证权重，验的是 R5/R11，不是权重。**

**value 的次序只在两簇内稳定。** 为了看到权重真正起作用的地方，必须用**非决定性**样本：一台干净设备 + 恰好一条行为分支命中。用这种样本排序时，第一次断言「严格全序稳定」**失败了**，而那个失败是真实结论：

```
15 > 12 > 8 之间的差距小于 ±5，所以它们的互相次序在噪声内翻转。
```

具体地：`SELINUX_PERMISSIVE 15`、`ROOT_MANAGER_VISIBLE 12`、`MULTI_OPEN 8` 两两相差 3 和 4，±5 的扰动必然让其中一对交换位置。**所以「15 > 12 > 8」没有任何证据支撑，它只是三个看起来合理的数字。** 有证据支撑的只有这个分簇：

| 簇 | 标签 | 标称分 | 数据支撑 |
| --- | --- | --- | --- |
| 重 | `hook_injection` / `debugger_attached` | 25 / 20 | **簇级成立**：任何 ±5 扰动下都排在轻簇之前 |
| 轻 | `selinux_permissive` / `root_manager_visible` / `multi_open` | 15 / 12 / 8 | **簇级成立**；簇内次序不成立 |

所以测试断言的是「重簇永不排在轻簇之后」，簇内任意次序都接受。这不是降低标准，是**把标准降到数据真正支撑的高度**：写一个测不过的严格全序，只会逼后来人删掉测试。

**要真正标定 15/12/8，需要的是更多样本，不是更精确的算术**：至少各 30 份「干净设备 + 单分支命中」的真实报告，才能把三个数字的置信区间分开。目前各只有 1 份（仿真器 `setenforce 0` 只能造 permissive；root 管理器包和分身需要真机才有代表性）。**这是本文最诚实的一条限制，写在这里而不是藏起来。**

### 9.4 黄金测试

两层：

1. **语义黄金**（结构稳定、数值按数值比较）：`value / band / coverage / decisive / axes[].score / axes[].coverage / deductions[].code+points+keys / caps / undetermined`。任何权重、阈值、决定性清单、覆盖公式、轴归属的改动，都必须让这份快照出现显式 diff；没有 diff 就说明改动没生效或测试没覆盖。
2. **文案快照**（允许随版本更新）：`detail` 全文。文案润色不该被当成规则变更，但更新时要在 PR 说明里写「仅文案」。

固定样本（前三个是**真机归档证据**，其余是合成 fixture，均不含真实报告正文）：

| fixture | 覆盖点 | 期望（按当前代码复算） | 对应测试 |
| --- | --- | --- | --- |
| `pixel6-like` | foreign-profile 决定性；10 条硬件证据全可用 | `value=82, band=D, coverage=0.94, decisive=true, caps=[DECISIVE_FOREIGN_PROFILE]`；declaration 轴 55（30+15） | `TestScorePixel6AnchorLandsAtD`、`TestScoreGoldenFreezesRealDevices` |
| `mi8-like` | 旧内核；`cpuCapacity` / overlay 缺失；RAM/CPU/GPU 确认 | `value=100, band=A, coverage=0.81, decisive=false`；`undetermined` 为 `overlayDeviceCodename:UNAVAILABLE` + `system.selinux:RESTRICTED` | `TestScoreMI8AnchorStaysClean`、`TestScoreGoldenFreezesRealDevices` |
| `emulator` | **真机实测**（android-34 仿真器）；决定性命中 + 覆盖不足同时成立；L3 的 `software_drm` 展示不计分 | `value=null, band=D, coverage=0.67, decisive=true, caps=[DECISIVE_VIRTUAL_BUILD]`；declaration 0.33 无扣分、behavior 0.83 扣 35、usage 1 | `TestScoreEmulatorAnchorIsDecisiveUnderLowCoverage`、`TestScoreGoldenFreezesRealDevices`、前端 `a real decisive emulator capture renders D with no number, and both facts coexist` |
| `emulator-user10` | **真机实测**：应用跑在第二 Android 用户下 → `multi_open` 命中 | `value=null, band=D, coverage=0.67`；behavior 扣 `35 + 8 = 43` | `TestScoreEmulatorVariantMultiOpenPricesEight`、`TestScoreGoldenFreezesEmulatorVariants` |
| `emulator-permissive` | **真机实测**：第二用户 + `.magisk` 挂载 + `setenforce 0` → **全库唯一** behavior coverage = 1.0 | `value=null, band=D, coverage=0.73`；behavior 扣 `35+25+15+8 = 83`，轴分 17 | `TestScoreEmulatorVariantPermissiveReachesFullBehaviorCoverage`、`TestScoreGoldenFreezesEmulatorVariants` |
| `nine-green-one-red` | §7.2 | `value=88, band=D, decisive=true`（88 是排序键，D 来自 R5） | `TestScoreRule5DecisiveCapsTheBand` |
| `seven-insufficient` | §7.1 | `value=null, band="?", coverage=0.37` | `TestScoreRule8LowCoveragePublishesNothing` |
| `usage-only` | 使用轴单独命中（12 分 → 轴分 88） | `value=97, band=B`（R11 降档） | `TestScoreRule11BandANeedsNoDeductions` |
| `overlay-only` | overlay 分支（15 分 → 轴分 85） | `value=94, band=B` | `TestScoreOverlayCodenameIsNotDoubleCounted` |
| `identity-sku-only` | 非决定性身份分支单独命中（15 分 → 轴分 85） | `value=94, band=B` | `TestScoreSkuOnlyIdentityIsNotDecisive` |
| `contract-example` | 30 + 15 + usage 不可判（即 §8.1 示例） | `value=77, band=B` | 无独立 fixture（数字见 §8.1 手算） |
| `field-set-17` | 大量 `NOT_ARCHIVED`，`bootCount` 尚未归档 | `value=null, band="?"`（usage coverage 必为 0，declaration 通道缺失） | 无独立 fixture |

真实锚点验收：对两份报告发 `GET /device-profile`，把 `score` 段落存入验收记录（不入库、不进仓库），核对 `band`。报告原文与 UUID 已在 [HANDOFF.md](HANDOFF.md) / [DEVICE-VALIDATION.md](DEVICE-VALIDATION.md) 记录，测试 fixture 用文档里的字段值重建，不提交真实报告。

### 9.5 待标定清单

**2026-11-26 更新（`sigmark-score/2`）**：新增 U2 一行，状态是**生产库零命中、仿真器一份阳性、真机零样本**——这三件事要分开说，见本节后面的分栏与「已知误报风险：老镜像新实例」。其余行仍是 2026-11-25 的状态：仿真器已经补上三个真实阳性样本（见 [EMULATOR-LAB.md §7](EMULATOR-LAB.md)）。**注意「有样本」不等于「已标定」**——各只有 1 份，够证明分支会响、够证明排序方向，不够定数字。

| 信号 | 现状样本 | 还缺什么 | 影响 |
| --- | --- | --- | --- |
| `hook_injection` | ✅ 1 份（仿真器 `.magisk` 挂载 → `magisk_path`） | Frida / Zygisk **内存注入**的样本（当前只验了「非原生挂载」） | 25 是否过重 |
| `debugger_attached` | ✅ 1 份（`strace -f -p <pid>` 真实 ptrace → `tracerPid=9072`） | 真机上的 `jdb` / Android Studio attach 样本 | 20 是否过重 |
| `selinux_permissive` | ✅ 1 份（仿真器 `setenforce 0`） | 明确 permissive 的自定义 ROM（仿真器是 root 改的，真机形态不同） | 15 是否合理 |
| `root_manager_visible` | ✅ 1 份（装带 LAUNCHER 的 `com.topjohnwu.magisk` 空壳包） | 真机装真 Magisk / KernelSU 的样本 | 12 是否偏低 |
| `multi_open` | ✅ 1 份（仿真器第二用户 → `secondary`） | 真机双开 / 工作资料样本 | 8 是否偏低 |
| `rom_verification` / `software_drm` | ✅ 两个分支都在仿真器上自然命中（L3 + userdebug） | — | **已裁决展示不计分**（§13 F1） |
| `U2`（`initialSdk` 世代年龄） | ⚠️ **生产库 23 份 0 命中；仿真器 1 份实测阳性**（android-34 AVD，`first_api_level=34`→2023、`boot_count=2`、2026 采集年，恰好压在边界） | **真机阳性样本**——这与仿真器阳性不是一回事 | 12 分是否合适；年份边界是否正确；老镜像新实例的误报面（见下） |
| foreign-profile 反向 | ❌ 仍无 | 声明 gs101、实测其它 SoC | 是否需要补登记 |

**U2 的样本状态必须分两栏看，混起来就会说错话**：

- **生产报告库：23 份，0 命中。** 两台在手真机都因 `bootCount` 不小而正确地不触发（Pixel 6 = 86、MI 8 = 56）。
- **仿真器：1 份实测阳性。** `emulator-5554`（android-34 `google_apis` x86_64）上 `ro.product.first_api_level = 34` → 年份表映射 2023；`settings get global boot_count = 2`，正好等于 `usageFreshBootCeiling`；`ro.system.build.date = Thu Jul 11 18:22:01 UTC 2024`。采集年 2026 → `cutoff = 2023`，而 `2023 ≤ 2023`，**U2 命中，扣 12 分，usage 轴分 88**。
- **仍缺的是真机阳性样本。** 仿真器能命中，恰恰因为它是「新实例 + 老镜像」——那是最容易造出来的形状，不是最需要验证的形状。真机上「一台 2017 年的手机被重置一次」才是要验的场景，目前一份都没有。

**边界是精确的，不是近似的**（`TestEmulatorU2BoundaryIsExact` 锁住三档）：

| 采集年 | `cutoff` | `sdk 34 → 2023` | 是否命中 |
| --- | --- | --- | --- |
| 2025 | 2022 | `2023 > 2022` | ❌ 不命中（差一年） |
| **2026** | **2023** | **`2023 ≤ 2023`** | **✅ 命中（正好在边界上）** |
| 2027 | 2024 | `2023 ≤ 2024` | ✅ 命中，且此后永远命中 |

这张表说明一件重要的事：**同一台设备、同一份读数，会不会被扣分取决于采集年份**。`sdk 34` 在 2025 年采集时是「太新」，在 2026 年就变成「够老」。这不是 bug，是「三年窗口相对采样时间」的直接后果，但它意味着**跨年比较同一台设备的 usage 分是没有意义的**。

**为什么「各 1 份」不足以定数字**：§9.3.1 的敏感性测试已经证明 15/12/8 三者互相在噪声内。要分开它们，每个信号至少需要 30 份独立样本才能让置信区间不重叠。这**不是靠多跑几次仿真器能解决的**——同一台 AVD 的重复采集是同一个数据点，不是 30 个。必须换真机、换 ROM、换注入方式。**六个分支全部有阳性样本这件事，证明的是「判定链路是通的」，不是「权重是对的」**，两者差距很大。U2 现在的处境是：链路在仿真器上通了，**在真机上还没通过一次**。

#### 已知误报风险：老镜像新实例

**这是 U2 目前最实质的问题，必须如实写出来，不美化。**

**已实测（仿真器）**：一个**全新的** android-34 AVD 会被 U2 扣 12 分。原因不是有人在伪装，而是：

- 新 AVD 的 `ro.product.first_api_level` 等于它所使用的**系统镜像**的 API（34 → 2023）；
- `boot_count` 从 1–2 起步，正好落在 `usageFreshBootCeiling` 以内；
- 采集年一到 2026，`cutoff` 就是 2023，`2023 ≤ 2023` 成立。

**所以任何由「三年前以上」的系统镜像新建的 AVD，都会命中 `FRESH_BOOT_ON_AGED_ROM`。** 这不是判定错误——它精确命中了规则要抓的那个矛盾（设备世代老 + 开机次数少）；但**解释变了**：

- 对仿真器，正确解释是「**镜像老**」，不是「有人在隐藏使用痕迹」；
- 对真机，一台 2017 年的手机被恢复出厂一次，会拿到同样的 12 分，而**没有决定性 cap 来兜住它**。

**实测数字**：全新 android-34 AVD 的 usage 轴得 **88 分**（满分 100 − 12）。它在**总分上不受影响**，因为 behavior 轴的 `VIRTUAL_BUILD_MARKERS`（35 分、决定性）已经把 `band` 压到 D。但**那是仿真器的运气，不是真机的运气**——真机没有这条 cap。

**推理未验证（真机重置场景）**：一台 2017 年出厂、`initialSdk=26/27`、被恢复出厂后 `bootCount ≤ 2` 的真机，会得到一个扣 12 分的 `FRESH_BOOT_ON_AGED_ROM`，把总分从 100 拉到 97、`band` 从 A 降到 B（R11）。**目前没有任何真机样本验证这一条**，因为两台在手真机的 `bootCount` 分别是 86 和 56。这一段是按规则推出来的，不是测出来的，所以单独标注。

**缓解方向（尚未实现）**：给 U2 加 `uptime < 3 天` 的限定——真正「刚恢复出厂就开始用」的设备，`SystemClock.elapsedRealtime` 与 `bootCount` 的组合能把它和「一台一直在跑的老机器」分开。这个想法在上一轮就提出过，**本轮仍未做**，因为没有 `uptime` 通道进 usage 轴，且新字段要动字段集。在它落地之前，U2 的 12 分只能当作**待核对的提示**，不能当作「隐藏使用痕迹」的证据——这一点必须写进 UI 文案。

---

## 10. 使用真实性（usage）v1

### 10.1 唯一标签与两个信号

派生标签：`fresh_boot_on_aged_rom`，轴 `usage`，标称分 12，非决定性。

两个信号同属一个标签（R2：只取 max，不叠加）：

| 信号 | 判定 | keys | 实现状态 |
| --- | --- | --- | --- |
| `U1` 计数 vs 镜像年龄 | `bootCount ≤ 2` 且 `captureYear − min(partitionBuildDates 的年份) ≥ 3` | `system.bootCount`、`system.partitionBuildDates` | **已实现**（`usageAxis`，[score.go:1288](../backend/cmd/sigmark/score.go#L1288)） |
| `U2` 计数 vs 世代年龄 | `bootCount ≤ 2` 且 `initialSdk` 对应年份 ≤ `captureYear − 3` | `system.bootCount`、`system.initialSdk` | **已实现**（`sigmark-score/2`；比较在 [score.go:1289](../backend/cmd/sigmark/score.go#L1289) 的 `agedDevice`，年份映射的失败分支在 [score.go:1254](../backend/cmd/sigmark/score.go#L1254)） |

**两个信号是两条独立的检查，不是互斥分支。** 这一条必须写死，因为写错会静默废掉 U2：早先的实现用 `else if` 把它们串起来，于是「分区日期可读」时 U2 永远不触发——而那正是 U2 存在的场景（镜像很新、设备很老）。现在的写法是两条独立的布尔量：

```go
agedImage  := dateYearOK && dateYear <= cutoff   // U1
agedDevice := sdkYearOK  && sdkYear  <= cutoff   // U2
switch {
case agedImage:  …  // 优先用 U1 的解释
case agedDevice: …  // 只在 U1 不成立时用 U2
}
```

**两者同时命中时只扣一次 12 分**（R2 一因一果），且**优先用 U1 的解释**：分区日期是直接证据，`initialSdk` 的年份是从「出厂 API 级别」查表推出来的，可信度低一档。U1 命中时 `initialSdk` 仍会作为附加 key 拼进 `keys`（`sdkOK` 就拼），让管理员看到两路读数都在，但扣分只有一条。

**可判条件（`sigmark-score/2` 放宽后）**：`system.bootCount` **可用**，且**分区日期可用或 SDK 世代可用**（二者其一即可），才记 `decided = 1`。这是**扩大可判集，不是扩大扣分**：镜像很新、但世代很老的设备以前是「判不了」，现在是「判了且干净」——两者必须分开，因为「判不了」和「干净」在界面上长得一样，混起来就是 §7.1 的错误。

历史背景：`/1` 要求 `bootCount` 与 `partitionBuildDates` 两个字段都 AVAILABLE。只读到一个字段是 0.5，正好等于 R7 的下界，那会给一条判不了任何东西的轴发一个未挣得的 100——这是 §5.2 与 §13 F0 R-3 明确修掉的。

日期比较用采样时间 `capturedAtEpochMs` 的 UTC 日期，**按年份粒度**：`cutoff = captureYear − usageAgedRomYears(3)`（[score.go:1327](../backend/cmd/sigmark/score.go#L1327) 的 `usageAgedRomCutoff`），再要求最早分区年份（U1）或出厂 API 年份（U2）`≤ cutoff`。所以「3 年」是**年差 ≥ 3**，不是 1095 天——闰年与月日不参与比较。报告没有可用采样时间时回落到固定年份 2021（`usageAgedRomFallbackYear`，[score.go:219](../backend/cmd/sigmark/score.go#L219)），让历史 fixture 的落点不因窗口改成相对而翻档。`partitionBuildDates` 的格式是 `system 2021-03-01 · vendor 2021-03-01`（[protocol.go:219](../backend/cmd/sigmark/protocol.go#L219)），取最早日期，不按分区名加权；解析失败就记 `UNPARSEABLE_PARTITION_DATES`（见 §4 R4），不猜。

**`initialSdk` 的年份对照表已经实现了**（`sigmark-score/2`）。表在 `usageSdkYears`（[score.go:246](../backend/cmd/sigmark/score.go#L246)），解析函数是 `usageSdkYear`（[score.go:252](../backend/cmd/sigmark/score.go#L252)）：

| `initialSdk` | 26、27 | 28 | 29 | 30 | 31、32 | 33 | 34 | 35 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 对应年份 | 2017 | 2018 | 2019 | 2020 | 2021 | 2022 | 2023 | 2024 |

两点必须讲清：

- **这是查表，不是算术**。刻意不写 `2017 + (sdk − 26)`：那种写法在每次发布节奏变化处都会差一年，然后静默地把一整代设备标错。表的取值是每个 API 级别作为稳定版发布的日历年。
- **表外级别返回 not-ok，记 `UNMAPPED_SDK_LEVEL`，不当作「新」**。把「不知道」渲染成「没问题」是这套体系里最不能犯的错（同 §7.1）。

为什么 U2 值得有，而它并不只是 U1 的重复：`partitionBuildDates` 描述的是**镜像**，攻击者刷一个当前 ROM 就把它变成当前的；`initialSdk` 描述的是**设备**，它由厂商在制造时写进只读系统属性，报的是这台硬件出厂时的 API 级别。2017 年的手机跑 2024 年的镜像，`initialSdk` 仍然报 27。**U1 刷机即可伪造，U2 不撒谎到硬件层面就伪造不了**——而那件事声明轴已经定过价了。

两个信号的关系（`sigmark-score/2` 口径）：两条独立检查，命中后合并成一条扣分；U1 与 U2 同时成立时只扣一次，解释用 U1。它们**不是**两个独立证据（都依赖 `bootCount`），所以永远不能各扣一次。

**但 U2 有一个必须写明的误报面**：`initialSdk` 是**出厂**级别，不是「设备有多老」的证明。一台**刚恢复出厂**的 2017 年真机、或一个**由老系统镜像新建的 AVD**，都会得到 `bootCount ≤ 2` + `initialSdk` 很老，从而命中 U2 —— 而这不是伪装。仿真器上已实测（android-34 AVD → usage 轴 88 分）。所以在 UI 与导出里，U2 的 12 分只能表述为**「镜像/世代与开机次数不匹配，先核对是否恢复出厂」**，不能表述为「隐藏了使用痕迹」。完整论证与实测数据见 §9.5「已知误报风险：老镜像新实例」。

### 10.2 「矛盾」与「少」的边界

- `bootCount = 2` + 分区日期缺失 + `initialSdk` 也缺失 → **少**，不是矛盾，0 分（而且这条轴不可判，`undetermined` 里会同时出现 `system.partitionBuildDates` 与 `system.initialSdk` 两行）。
- `bootCount = 2` + 分区日期缺失 + `initialSdk = 27`（2017）→ **U2 命中**，扣 12 分。这是 U2 存在的场景：镜像日期读不到（或很新），但设备世代很老。`detail` 用 U2 的模板：「出厂 SDK 27 对应 2017 年，距采样已满 3 年，开机次数只有 2 次」。
- `bootCount = 2` + 分区建于 2021 + `initialSdk = 27` → U1、U2 **同时成立**，只扣 **12** 分一次，`detail` 用 U1 的解释（分区日期是直接证据），`initialSdk` 仍作为附加 key 列出。
- `bootCount = 1200` + 分区建于 2018 → **正常**，0 分。
- `bootCount = 2` + 分区建于 2021 → **可疑但不违法**：可能是刚恢复出厂。使用轴扣 **12** 分（轴分 88），总分 **97/B**，`detail` 写「先核对是否恢复出厂或刷机」。
- `bootCount = 2` + 分区建于 2024（新）+ `initialSdk = 33`（2022）→ 两个信号都不老，**判了且干净**，0 分。这是 `/2` 放宽可判集带来的新结论，`/1` 时代它也是 0 分，但当时是「判不了」。
- **全新 AVD / 刚重置的真机 + 老镜像** → **U2 会命中并扣 12 分，而这不是伪装**。仿真器上已实测（android-34 AVD，`first_api_level=34`、`boot_count=2`、2026 采集年 → usage 轴 88 分）；真机上同样形状只是推理。**这一条不能当成「隐藏使用痕迹」的证据**，详见 §9.5「已知误报风险：老镜像新实例」。**`sigmark-score/5` 起，这一格被单向抑制，见 §10.2.1。**
- `bootCount` 在同资产历史里从 900 掉到 2，且分区日期没变 → **真正的矛盾**（计数器被打回）。v1 的 30 天窗口与「只算采样前」的 SQL（[device_profile.go:353](../backend/cmd/sigmark/device_profile.go#L353)）不一定能覆盖到，列为 v2。

#### 10.2.1 虚拟设备上不计这 12 分（`sigmark-score/5` 新增）

上面那条「全新 AVD / 老镜像 → U2 命中扣 12 分」在 `/5` 里被**单向抑制**掉了。

**规则**：`FRESH_BOOT_ON_AGED_ROM` 在**虚拟化已被独立通道确认**时不再计分。判定函数 `virtualEvidenceConfirmed(labels, parameters)`（[score.go:1103](../backend/cmd/sigmark/score.go#L1103)），**任一**通道确认为真即可：

| 通道 | 判据 | 出处 |
| --- | --- | --- |
| 黑名单标签 | `virtual_build_markers` 标签 `state == "hit"` | `scoreLabelByCode` 读**已算好的标签**，不重新推导 |
| 结构通道 | `STRUCTURAL_VIRTUAL_EVIDENCE` 命中（`cpu.cpuInfo` 或 `system.boardPlatform`） | [score.go:1113](../backend/cmd/sigmark/score.go#L1113) 的 `structuralVirtualRead`，与扣分通道**共用同一个读数函数** |

**为什么**（一因一果，R2）：

> 「镜像的 `first_api_level` 与系统镜像不一致」**就是**模拟器的定义，不是伪装。
>
> 雷电 `6642e350`：`initialSdk = 28`（Android 9 世代）配 android-14 镜像、`bootCount = 2`。这不是「有人把老机器的计数器打回去了」，而是 **AVD 的正常形态**——`ro.product.first_api_level` 由构建镜像决定，新实例本来就从 `bootCount` 1–2 开始。
>
> 同一个「这是模拟器」的事实，behavior 轴已经用 35 分 + 决定性 cap 收过费了。**不能再收一次 12 分**——否则模拟器因为「看起来像刚装的系统」被扣分，而它本来就是刚装的。

**三条关键约束（防滥用的核心，缺一条就变漏洞）**：

1. **单向**：只看「虚拟化是否已被独立通道确认」。**声称自己是模拟器要付 35 分 + D 档**，所以没有攻击者能靠这条路逃掉 12 分——他要先接受 35 分的 D。
2. **抑制的是定价，不是可判性**：`decided` 仍为 1、usage `coverage` 仍为 **1.00**、`undetermined` 一行不变。否则模拟器的 coverage 会被悄悄拉低，可能掉到 `scoreCoverageFloor` 以下，**变成借修复之名改形状**。「说得出」和「收了钱」是两件事，只抑制后者。
3. **真机上这条规则照常工作**：`TestUsageFreshBootStillFiresOnRealHardware` 用**与雷电完全相同的 usage 读数**（`bootCount 2` / `initialSdk 28` / 同一批分区日期）配一颗真机 SoC 画像，断言 12 分**照扣**。双向测试是这条修复能被接受的前提。

**实测**（雷电 `6642e350`）：usage 轴 **88 → 100**，`deductions` 清空，`coverage` 仍是 **1.00**（没有被压低）。

### 10.3 为什么它单独到不了 C/D

使用轴单独命中：扣 12 分 → `applied = min(12, 100) = 12` → usage score = `100 − 12 = 88`（R6：轴内百分制，不按轴权重归一化）。

```
value = (40×100 + 35×100 + 25×88) / 100 = 97 → 97 落在 A 区间，但有一条扣分 → R11 降到 B
```

即使另外两轴全 100，最多 **97/B**。要落 C/D，必须声明轴或行为轴也有命中。这是「只能佐证」的算术表达。

**`/5` 之后这条算术仍然成立，但适用范围要收窄一句**：上面这 12 分只在**未被确认为虚拟设备**时收。一台已被确认为模拟器的机器，usage 轴直接 100——**这不是给它加分，是不重复收同一笔钱**（§10.2.1）。

> 注意：这里**不能**写成 `100×(25−15)/25 = 40` 那种按轴权重归一化的算法。那是 §13 F3 明文否掉的读法（会把一条 hook 命中放大成轴分 29），本节曾经留着它，现已删除。

### 10.4 v1 不加字段；v27 的候选

v1 只读三个已归档字段：`system.bootCount`（字段集 20，[protocol.go:88](../backend/cmd/sigmark/protocol.go#L88)）、`system.partitionBuildDates`（字段集 17，[protocol.go:99](../backend/cmd/sigmark/protocol.go#L99)）、`system.initialSdk`（字段集 18）。这些已经在 v25 的 235 个静态键里，**不需要客户端改动**。

已归档但 v1 不启用的第三个信号：`battery.cycleCount`（字段集 16 起归档，[protocol.go:87](../backend/cmd/sigmark/protocol.go#L87)；Android 14+ 才有值，[field_dictionary.go:65](../backend/cmd/sigmark/field_dictionary.go#L65)）。它不会随恢复出厂归零（换电池可能改变），比 `bootCount` 更抗重置；但目前只有 API 34+ 有值，覆盖率不够，先留作 v2 候选，不改字段集。

> **字段集 26 已经落地**（本轮），但**不是这一节加的**：它只新增了 `system.bootQemu`（[protocol.go:96](../backend/cmd/sigmark/protocol.go#L96) 的 `{"system", "bootQemu", 26}`，`maxFields` 新增 `>= 26 → 260` 档，[protocol.go:578](../backend/cmd/sigmark/protocol.go#L578)），词典随之升到 `sigmark-lan-fields/17`。**`sigmark-score/5` 不读这个键**——它的判据仍然是结构通道与黑名单。所以「字段集升版」与「打分升版」在这里是两件独立的事：前者是采集面，后者是判据面。`bootQemu` 进归档但没人读它，这件事记在 §13.1 第 1a 项。

**v27 的候选**必须逐项单独决策，不能因为「能采」就采：

| 候选 | 采集方式 / 成本 | 暴露什么 | 为什么必须单独决策 |
| --- | --- | --- | --- |
| 应用安装数量 | `PackageManager` 可见包或 `QUERY_ALL_PACKAGES` | 兴趣、职业、社交圈 | 包可见性会让计数本身不可靠；且已有一条 `root_manager_visible` 在用可见包列表，扩成「全量计数」是另一个隐私等级 |
| 照片数量 / 最早照片时间 | `MediaStore` + `READ_MEDIA_IMAGES` | 生活轨迹、家庭、位置线索 | 内容级权限；即使只传计数，也改变用户预期 |
| 联系人数量 | `READ_CONTACTS` | 社交关系规模 | 与设备真伪无关，属于人的数据 |
| 屏幕使用时长 / 解锁次数 | `UsageStatsManager`（特殊访问） | 行为习惯 | 需要用户手动授权；一旦上传就是行为画像 |
| 已保存 Wi‑Fi / 蓝牙配对数量 | 系统服务 | 出行与设备环境 | 可关联到地点与他人设备 |
| 电池循环 / 充电次数 | 已归档 `battery.cycleCount` | 物理使用强度 | 无新权限，但当前覆盖不足；应先解决覆盖率 |

若要做，最低条件：**只上传计数或分档，不上传名称/内容**；独立开关、默认关闭；更新用户提示与隐私文档（[AGENTS.md:10](../AGENTS.md#L10)）；不进默认上传；先回答「它解决哪个具体误判」，否则不做。

---

## 11. 现在能立刻做的

### 11.1 这是纯投影

`score` 只依赖 `Report.Parameters` 与现有规则。字段集 25 的报告已经包含全部所需 key；`profileSignals` 已经是「从归档重算」的纯函数（[device_profile.go:161](../backend/cmd/sigmark/device_profile.go#L161)）。因此：

- **不改客户端契约**：`schemaVersion: 4`、235 个静态键、`maxFields` 分档都不动；
- **不改数据库**：不新增列、不迁移、不物化；
- **可回算全部历史报告**：包括字段集 25 以前的所有报告（17–24 也含在内）；旧报告缺 key → `NOT_ARCHIVED` → coverage 降低 → `?`，这是正确结果，不是失败；
- **不改 Android**：手机端继续显示现有 posture，不显示分数。理由：打分需要归档与历史，手机端不具备；且把阈值放进 APK 等于把规则送进对抗样本手里。

### 11.2 实施顺序

| 阶段 | 内容 | 验收 |
| --- | --- | --- |
| 0 | 修 `qa_device_profile.py`（已过期）；写只读回算脚本，输出状态矩阵 | 脚本跑通，不写库；矩阵覆盖全部在库报告 |
| 1 | 纯函数投影 + 单测（表驱动，合成 Parameter） | R1–R11 每条至少一条不变量测试 + 两个锚点黄金测试通过（`go test ./...` 全绿） |
| 2 | 通道明细重构（hardware channels、identity pair 明细） | 现有 10 标签三态不变；Go 全绿 |
| 3 | `/device-profile` 增加 `score`；前端渲染 | JSON 契约测试；浏览器 QA 选择器 `data-score-band` |
| 4 | 锚点验收（两份真实报告）+ 黄金测试冻结 | Pixel 6 = D；MI 8 = A/B；diff 可复现 |
| 5 | 更新 LAN-PILOT 契约文档（另一次改动，不在本文） | 文档与代码一致 |

阶段 0 必须先于阶段 1：没有状态矩阵，就无法判断某一档 `?` 占比是「数据太旧」还是「规则太严」。

### 11.3 不做什么

- 不改 `profileSignals` 的标签顺序、三态语义或 `ruleVersion`（除了未来新增标签时按既有约定追加）；
- 不把 `score` 写进数据库、上传 JSON 或手机端；
- 不用分数替换现有 `labels` 明细；
- 不因为「分数好看」而放宽 `insufficient` 的判定；
- 不在没有回算数据的情况下冻结权重；
- 不提交真实报告正文或 UUID 到测试 fixture。

---

## 12. 边界

**打分不能证明设备是真的。**

`value=100 / band=A` 只能说明：**本次归档里，我们能查的通道没有互相矛盾**。它不能证明：

- 设备是原厂真机（改写层可以同时覆盖声明链，`hardware_facts` 只能碰到部分独立通道）；
- ROM 未被篡改（verity / debuggable 是 ROM 自述，不是镜像校验，[SECURITY-EVIDENCE.md:93](SECURITY-EVIDENCE.md)）；
- 使用者没做过危险操作（画像只看「这次采样看见过什么」，不看行为历史，[SECURITY-EVIDENCE.md:101](SECURITY-EVIDENCE.md)）；
- 设备没有被 root / hook 过（`hook_injection` 只看本进程映射与挂载视图，受包可见性限制）；
- 同一资产的多份报告来自同一台物理设备（资产归组是显式关系，不是硬件认证）。

同理，`band=D` 也不等于「这是假机」：它可能是模拟器测试、云真机、红队样本或实验用改装机。结论永远是「按当前规则，这条证据足以单独把等级压到 D」。

---

## 13. 规格缺口与修正建议

规格未写明、需要裁决的地方，以及实现过程中被验证推翻的假设。第一轮（回算真实报告）发现的记在 F2–F4，第二轮（静态审查）发现的汇总在 F0，第三轮（文档 ↔ 代码只读审计）发现的记在 F10–F12，第四轮（U2 落地 + R10 两层 + 红队对抗）记在 **F14–F16**，第五轮（身份通道修复 + 版本双升）是 **F15 的结案**，第六轮（雷神模拟器实测）是 **F17（黑名单被改写绕过）+ F18（未登记 SoC 静默跳过）**。

**每一轮的性质都在变，这一点比单条缺陷重要**：前两轮修的是**代码**（规则错了，改实现），第三轮修的是**文档**（实现是对的，文档没跟上），**第四轮修的是判据本身**——红队用两个实验推翻了两条「我们以为验证过了」的结论：`F14` 证明「删证据能升档」（旧测试全绿时它就在），`F15` 证明「洗白身份后与干净设备不可区分」（前两版实验都被污染，第三版才成立）。`F16` 把这几轮里**五次同类错误**（行号只查非空、实验用带噪声的基线、测试计数没写清口径、结果自洽但基线不干净、链接标签与 href 不同步）归成一条：**用不足以支撑结论的判据冒充验证**。**第六轮又进了一层**：F17 不是判据执行错了，是**判据问错了对象**——它去问被审查的设备「你是不是模拟器」，而设备答了「不是」。六轮的共同点是：**结论的可信度取决于判据，不取决于我们检查了多少次**。

**第五、六轮是本文目前「把洞真的堵上」的记录**，值得对照着看：F14 用 R10 窄形态把「删证据」从 100/A 压到 100/B；F15 用 one-sided identity 把「洗白」从 100/A 压回 90/D；F17 用结构性证据把「三行属性改写」从 `?` 压到 D。三条都不是「提高分数门槛」，而是**改变「什么算证据」**——这类修法才能同时挡住攻击和误伤，代价是必须升版并重跑全库。

**F18 是另一种修法，定位要说准**：它**不增加任何判定能力**，只是把「四个通道被跳过」这件事写出来。修的是「漏了要说」，不是「不漏」——注册表还是只有 6 条 SoC，未登记设备的硬件轴仍然什么都没比，只是现在会自己说出这一点。**把静默的盲区变成可见的盲区，本身有价值，但它不是覆盖。**

**第三轮（F10–F12）暴露的不是某个数字算错，而是「文档没有测试保护」**——所以它烂得最久。凡是「文档声称、代码没有」或「代码有、文档没写」的地方，本文现在一律显式标注状态，不再用「已经如此」的语气描述未实现的契约。

### F0 第二轮红队审查：八条组合缺陷

第一轮靠「回算 22 份真实报告」抓到 5 个缺陷（§9.1.1、§13 F2–F4）。第二轮换了个方法：**只读静态审查 + 手算**，专门找「每条规则单独看是对的、但叠在一起给出错误结论」的路径。又抓到八条，全部已修、全部有测试。

| # | 严重度 | 缺陷 | 触发条件 | 修法 |
| --- | --- | --- | --- | --- |
| R-1 | **致命** | R5 被 R8/R10 的早退跳过：`decisive=true` + `caps` 非空 + `band="?"` 同时出现 | 决定性标签命中但总体 coverage < 0.5（模拟器 + 大量 RESTRICTED） | 早退分支里也执行 R5 |
| R-2 | **高** | SKU-only 身份冲突被当成 app-uid 分支：15 分非决定性做成 25 分 + 决定性 D | API≥31 且只有 `system.sku` 与 `system.hardwareSku` 不一致（Pixel 6 的真实行为） | 按冲突对分流 `IDENTITY_SKU` / `IDENTITY_APP_UID` |
| R-3 | **高** | usage coverage 按字段数算：只读一个字段就是 0.5，恰好过 R7 闭区间闸门 | 字段集 17–19 的旧报告；或 `bootCount` 可读但日期 RESTRICTED | coverage 改按派生标签算 |
| R-4 | 中 | 前端 `counted` 与后端 R7 薄轴例外矛盾：后端计入、界面说「未计入总分」 | 任何 coverage<0.5 且带扣分的轴 | 前端同步该例外并改文案 |
| R-5 | 中低 | behavior 轴静默丢掉 `rom_verification` / `software_drm` | DRM=L3 或 verity off 的设备（**MI 8 锚点本身就中**） | 显式声明 display-only + 一致性测试 |
| R-6 | 低 | usage 硬编码 `2021`，判定不看采样时间 | 2023 分区 + 2026 采样（该扣不扣）；2022 采样 2021 分区（不该扣却扣） | 改成相对采样的 3 年窗口 |
| R-7 | 低 | `hit` 标签的不可用 key 不进 `undetermined` | hook 命中但 `rootMountHints=RESTRICTED` | 新增 `scoreUnreadableKeys` 接入三个 hit 分支 |
| R-8 | 低 | coverage 两位小数 vs 文档三位 | 全库 | 裁决为两位，改文档（§5.3） |

**为什么第一轮没抓到 R-1、R-2**：第一轮只回算已有报告，而这 22 份里**没有一份**是「决定性命中 + 低覆盖」，也**没有一份**是「SKU-only 冲突」。它们不是理论隐患——模拟器报告一定会走 R-1 的路径，而 Pixel 6 的 SKU 按 UID 分裂是**已记录的真实行为**。这正说明「只用现有数据验证」不够，静态审查和手算必须并行。

**回归验证**：修完重跑全库 22 份，**落点与修前完全一致**（Pixel 6 全 D/82、MI 8 全 A/100、字段集 23 全 B/82、旧字段集全 `?`）。也就是说这 8 条修的是尚未被现有数据触发的路径，没有引入任何回归。黄金文件也未变。**2026-11-25 本轮改动后再次对部署中的 API 实测全库 22 份，分布仍为 A:4 / D:7 / B:4 / ?:7，逐份 band 与 value 均未变。**

以下 F1–F8 按影响排序，每条都给出「本文怎么处理」与「建议怎么定」。

### F1 轴内建议分与轴权重不自洽 —— **已裁决（标签 7/8 展示不计分）**

- **事实**：`behavior` 建议分 25+20+15+12+8+35 = **115**，轴权重 35；`declaration` 30+25+15 = **70**，轴权重 40；`usage` 权重 25 但没有任何 v1 标签；`rom_verification` / `software_drm` 没有轴归属。
- **本文处理**：把建议分定义为「轴内标称分」（百分制），轴内求和后截断到 100（R6）；`usage` 用派生标签。
- **标签 7/8 的裁决：展示不计分。** 早先的实现两边都不选——表格里没有它们的分数，`profileSignals` 却照常产出，于是它们**静默消失**，还顺带把 `behavior` 的 coverage 分母从 8 抬到 6（等于虚高 25% 覆盖）。现在代码用 `behaviorDisplayOnlyLabels` 显式声明，`TestScoreBehaviorAccountsForEveryLabel` 在新增标签未裁决时直接失败。
- **不计分的理由**：`software_drm` 的 L3 是 Widevine 播放能力等级，不是伪装信号——**干净的 MI 8 锚点本身就有 L3**，计价会把阴性对照打成「有疑点」；`rom_verification` 的 verity off / debuggable 只说明 bootloader 解锁，是正常选择而非「描述不符」。
- **代价（必须承认）**：`behavior` 轴只覆盖 6 个计分标签，两个真实的安全状态不参与定级。这是有意的取舍——宁可漏掉两条弱信号，也不要让阴性对照误报。
- **后果**：`behavior` 轴容易饱和（`hook 25 + virtual 35 = 60`，轴分只剩 40；再加 selinux 15 就到 25）。

### F2 `overlay_codename` 不是 10 个布尔标签之一 —— **已修（去重 + 已落地）**

- **事实**：后台没有 `overlay_codename` 标签；overlay 代号冲突是 `hardware_declaration_conflict` 的一条通道（[hardware_facts.go:218](../backend/cmd/sigmark/hardware_facts.go#L218)）。Android 侧倒是有同名行（[DevicePosture.kt:106](../app/src/main/java/com/sigmark/app/security/DevicePosture.kt#L106)），但那是手机端 posture，不是后台画像标签。
- **本文处理**：把规格里的 15 分落成同一标签下的分支 `OVERLAY_CODENAME_MISMATCH`，不新增 label。
- **回算发现的实际 bug**：实现时确实双重计数了 —— 代号不一致既进 30 分的 `HARDWARE_CHANNEL_CONFLICT`，又进 15 分的 `OVERLAY_CODENAME_MISMATCH`，两条扣分的 `keys` 完全相同（`system.device` + `environment.overlayDeviceCodename`），一个事实收 45 分。
- **已落地的修法**：`hardware_declaration_conflict` 的 30 分扣分只按**非 overlay** 的分支计（`nonOverlayBasis`）。若某份报告只有代号这一条通道不一致，就只出 15 分的 overlay 扣分，不出 30 分的通道冲突。
- **验收**：`TestScoreOverlayCodenameIsNotDoubleCounted`（只有代号不一致 → 恰好一条 15 分扣分、轴分 85、非决定性）与 `TestScoreOverlayAndForeignProfileCoexist`（代号 + foreign-profile 两个**不同事实**仍然各计各的）。
- **遗留**：若将来要把 overlay 独立成标签，必须同时把 overlay 通道从 hardware 标签里摘掉，并升 `sigmark-profile/9`——那是一次真正的契约变更，不能在打分层偷偷做。

### F3 R6 的「扣分合计不得超过轴权重」是错的 —— **已修（改为截断到 100）**

- **事实**：规格里「轴分 = 100 − 扣分合计」与「扣分合计不得超过轴权重」两句放在一起不自洽，但**错的是后一句**。声明轴三个分支是 30+25+15 = 70 > 权重 40，行为轴 hook 25 + virtual 35 = 60 > 权重 35 —— 标称分之和本来就大于权重。
- **本文当时的处理（错的）**：归一化 `100×(weight−applied)/weight`。实测下来 hook 单条命中就让 behavior 轴从 100 掉到 **29**，一条发现压过九条干净通道。
- **最终处理（已落地）**：`applied = min(Σpoints, 100)`，`score = clamp(100 − applied, 0, 100)`。理由见 §4 R6：**权重是跨轴加权系数，不是扣分预算**，两者量纲不同不能换算。
- **影响**：三种读法给出的数字完全不同（30 分扣在 40 权重上：字面 70、归一化 25）。规格里的 JSON 示例 `score:45` 在任何一种读法下都算不出来，只能当作「形状示例」，不能当作算术示例。
- **验收**：`TestScoreRule6AxisScoreSpansTheFullRange` 锁住「70 分扣分 → 轴分 30」与「扣满 → 轴分 0」两端。

### F4 R7/R8 的 A 档漏洞 —— **已修（R10 + R11 + R7 薄轴例外）**

- **事实**：声明轴（权重 40）0/3 全不可判，行为轴与使用轴干净时，`coverage=0.600`、`value=100`、`band=A`（§7.1 变体）。
- **当时处理**：v1 先按 R1–R9 实现，文档标出漏洞并建议新增 R10-a。
- **回算结果**：这个漏洞不是理论问题。全库回算（§9.1.1）发现 **5 份已确认伪装的报告被打了 A**：
  - 字段集 20 的 4 份：`value=100`、`band=A`，declaration 轴 coverage = 0；
  - 字段集 22 的 1 份：`value=88`、`band=A`，30 分实证冲突被另两轴满分稀释。
- **已落地的修法**（三条，全部有测试锁住）：
  - **R10**：declaration 轴 `coverage<0.5` 且无扣分 → `value=null`、`band="?"`。修掉字段集 20 的 4 份。
  - **R11**：`band` 算出 A 后，只要任一轴有扣分就降 B（`value` 不动）。修掉字段集 22 的 1 份。
  - **R7 薄轴例外**：`coverage<0.5` 但 `deductions` 非空的轴**仍然计入**总分。修掉「薄轴上的实证冲突被整条丢弃」。
- **回归验证**：修后重跑全库 22 份，**零份伪装报告落 A，零份干净报告落 C/D**。Pixel 6 仍 D、MI 8 仍 A，锚点约束全部保持。
- **测试**：`TestScoreRule10BlindDeclarationAxisPublishesNothing`、`TestScoreRule11BandANeedsNoDeductions`、`TestScoreRule7ThinAxisWithDeductionStillCounts`。
- **遗留（已由后续改动解决）**：R10-a 的 (i) 条（A 档要求 behavior 轴 coverage ≥ 0.5）当时**没有**采纳，理由是 R11 已经保证「A = 零扣分」。**这一判断后来被红队推翻**：R7 会把低覆盖轴剔出平均并重新归一化权重，于是删掉证据反而让分数变高（真实 MI 8：保留 usage 输入 97/B，删掉 100/A）。现在由 **R10 窄形态**以更小的代价补上——只禁 A 档、不夺数字，见 §4 R10 与 §13 F15。

### F4b R10 与 R5 的先后（第二轮红队）—— **已修**

- **事实**：R10 的早退把 R5 一起跳过了。一份决定性标签命中的模拟器报告（coverage 0.31）输出 `decisive=true`、`caps` 非空、`band="?"`，而前端 `score-panel.tsx:22` 会无条件渲染「等级已直接压到 D」，同一屏自相矛盾。
- **为什么第一轮没抓到**：22 份历史报告里没有一份是「决定性命中 + 低覆盖」。这是静态审查的价值——不是理论隐患，模拟器报告必然走这条路。
- **修法**：早退分支里同样执行 R5。`value` 仍是 `null`（覆盖不足不给数字），但 `band` 是结论、不是数字。
- **测试**：`TestScoreVirtualBuildMarkersIsNotDeductedTwice`（补充 band 断言）、`TestScoreDecisiveSurvivesABlindDeclarationAxis`。

### F5 R5 与 `value` 的语义要写进 UI

- **事实**：decisive 时 band=D，但 value 仍可能是 88（§7.2 的九绿一红；Pixel 6 锚点是 82）。管理员看到「82 分 / D 档」会怀疑实现有 bug。
- **本文处理**：`caps[].reason` 必须解释触发通道；文档写明「D + 82（或 88）不是矛盾」；前端把 `caps` 放在分数之前。
- **建议**：不要为了「看起来一致」把 decisive 的 value 压到 49 或 null——那会丢失「同为 D 档，谁的问题更多」的排序信息。保留原值，靠 band + caps 表达结论。

### F6 usage 的「矛盾」语义过强

- **事实**：`bootCount` 会在恢复出厂/清数据时重置（[SecurityObservations.kt:50](../app/src/main/java/com/sigmark/app/collector/SecurityObservations.kt#L50)）。「分区建于 2021 + bootCount=2」不是逻辑矛盾，只是可能被重置。
- **本文处理**：v1 只给 12 分、非决定性，`detail` 要求提示「先核对恢复出厂/刷机」；真正的计数器回退留到 v2（同资产历史）。
- **建议**：确认 v1 的措辞不要写「伪造/矛盾」；若坚持叫「矛盾」，就必须同时承认它可被合法重置解释，否则会制造大量误报。

### F7 foreign-profile 决定性目前是单向的

- **事实**：`socProfiles` 里只有 `gs101` 填了 `capacities` 与 `cmaMiB`，其余为空（[hardware_facts.go:26](../backend/cmd/sigmark/hardware_facts.go#L26)；[HANDOFF.md:60](HANDOFF.md)）；并且声明必须能被 `declaredSoc` 解析到登记表内（[hardware_facts.go:92](../backend/cmd/sigmark/hardware_facts.go#L92)）。
- **后果**：只能识别「声明是已登记的非 gs101、实测像 gs101」。声明 gs101、实测别的 SoC 时，`foreignProfile` 找不到对照值；声明未登记的 SoC 时，两条通道根本不进入判定——两种都只能走普通冲突（30 分、非决定性、B 档）或 `insufficient`。
- **本文处理**：在 §6.2 与 UI 提示里写明方向性；不把「未判 D」说成「排除伪装」。
- **建议**：要么补齐其余 SoC 的 `capacity_profile` / `CmaTotal`（需要书面依据，不能猜），要么把决定性条件收窄为「foreign-profile 且目标画像字段非空」，并在文案里写「仅覆盖已登记画像」。

### F8 JSON 示例的数字与字段名

- **事实**：示例 `declaration.score=45` 与 30 分扣分不可复算（见 F3）；示例的 `coverage: 0.73 → 部分可判` 与本文阈值一致（0.73 ≥ 0.6 且 < 0.9），保留；`score.coverage` 与报告顶层 `coverage` 同名不同义。
- **本文处理（已落地）**：§8.1 换成可复算示例（77/B，`70` 与 `85` 两个轴分，`0.750` 覆盖）。**任何示例数字都必须能按 §5.7 手算复现**，否则就只是形状示意。
- **建议**：不要照抄规格里的 `45` 反推公式——它在任何一种读法下都算不出来。

### F9 coverage 是标签级，不是字段级

- **事实**：`hardware_declaration_conflict` 一条通道确认即 `not_observed`；MI 8 的 `cpuCapacity` 缺失、`cmaTotal` 因 `sdm845` 未登记期望值而不判、overlay 不可用，标签仍算可判。
- **本文处理**：缺口进 `undetermined` 的 key 列表，不降 coverage。
- **建议**：接受这个口径（否则 coverage 会变成「字段数量」的伪装），但在 UI 上把 `undetermined` 展开给管理员看，别让「可判」被读成「查全了」。

### F10 分支 code 的命名没有测试锁 —— **已修（补了整表断言）**

- **事实**：文档里的四个分支 code 曾与代码不一致：`VIRTUAL_BUILD`（代码 `VIRTUAL_BUILD_MARKERS`）、`DECLARED_CHANNEL_MISMATCH`（代码 `HARDWARE_CHANNEL_CONFLICT`）、`OVERLAY_CODENAME`（代码 `OVERLAY_CODENAME_MISMATCH`）、`usage_timeline_conflict`（代码 `fresh_boot_on_aged_rom`）。**四个名字在代码里一个都不存在**，而全仓 `go test ./...` 一直是绿的——因为没有任何测试枚举 §2.3 这张表。
- **根因**：现有测试是「一个分支一条」的行为测试（`TestScoreSkuOnlyIdentityIsNotDecisive`、`TestScoreOverlayCodenameIsNotDoubleCounted` 等），断言的是**行为**（多少分、是否决定性），不是**标识符**。标识符只在各自实现里出现一次，改名字没有任何断言会失败。
- **本文处理**：§2.3 已按代码逐字改正，并在表格上方加了「验收时按字面比对」的说明。
- **已落地（补了代码）**：`TestScoreDeductionTableMatchesTheDocumentedContract` 表驱动断言 §2.3 的 `(code, label, axis, points, decisive)` 五元组，并反向断言「实现产出的每个 code 都必须在表里」。**它上线当天就抓到两个真缺陷**：
  1. `OVERLAY_CODENAME_MISMATCH` 的 `label` 写成了 `overlay_codename`——凭空发明了一个画像不产出、文档不列出的标签名。已改回 `hardware.Code`（= `hardware_declaration_conflict`）。
  2. 该测试自带的 FOREIGN_PROFILE fixture 一开始用 `cpu.hardware=qcom`，而 `qcom` 不在 `socProfiles` 里，`declaredSoc()` 解析不出已登记 SoC，`foreignProfile()` 永远返回 false——**分支根本不会触发**。这暴露了一个真实的脆弱点：`FOREIGN_PROFILE` 需要「声明的是已登记 SoC」才成立，声明一个表外的厂商名时这条通道静默失效。改用 Pixel 6 的真实形态（`cpu.hardware=mtk` + `system.socModel=Dimensity 9200+`）后通过。
- **仍未做**：`behaviorScoreTable ∪ behaviorDisplayOnlyLabels == profileSignals 标签集` 这条并集断言已由 `TestScoreBehaviorAccountsForEveryLabel` 覆盖，无需重复。

### F11 文档引用的行号会漂移 —— 建议纳入验收

- **事实**：本文 §1、§4、§5.2、§6、§10.2、§13、§15 共 19 处代码行号引用曾经整列错位（`device_profile.go` 与 `hardware_facts.go` 因新增注释与通道整体后移），其中三处指向的是**空行**而不是任何语句。
- **根因**：行号是代码的派生量，代码演进后没人会顺手回头改文档，CI 也不检查。凡是「引用行号」的文档都会这样烂掉。
- **本文处理**：全部按当前代码重新核对并更新。
- **建议**：在 §14 加一条验收项——**文档里每个 `文件:行号` 引用都必须能打开对应的函数或语句**（不是空行、不是无关的上一行）。可半自动化：脚本抽出所有 `#L(\d+)` 锚点，比对目标文件该行是否落在预期函数体内。更稳的写法是引用**函数名**而不是行号，行号只作辅助。

### F12 「文档写了、代码没有」的清单 —— 四处已全部落地，无遗留

- **事实**：以下四处曾以「已经如此」的语气写在文档里，实际代码不存在：`PROFILE_UNSET` 这个 `undetermined` 原因、§10.1 的 U2（`initialSdk` 年份表）与「1095 天」窗口、§8.3 的排序/分组/每轴条数上限、§8.4 的「未知 `score.version` 前端降级」。
- **本文处理**：四处曾都改成**显式标注「未实现 / 目标契约」**并写清当时的真实行为。**四处现已全部落地**，本节不再有遗留项。
- **前三处已落地**（2026-11-25）：

  1. **§8.3 排序与分组**（`orderScoreAxes` / `orderScoreUndetermined` / caps 按 code 排序）。不做排序，黄金文件的 diff 分不清「设备变了」和「map 遍历顺序变了」，导出也不可复现。**没有升版**——它只改输出顺序，不改任何判定。
  2. **`PROFILE_UNSET` 第五个 reason**。之前「SoC 已登记但期望值留空」表现为通道被整条跳过，既不进 `undetermined` 也不降 coverage，管理员看到 `not_observed` 会以为查过了。现在通道会带 `profile_unset:` 前缀进 `basis`，score 层映射成第五个 reason。**不改判定，不需升版**（`not_observed` 该保持还是保持）。
     - **落地当天抓到两个自己的缺陷**，都值得记下来：
       - **`unset` 分支抢在 `foreignProfile` 前面**，导致所有 `FOREIGN_PROFILE` 静默失效——而 `gs101` 以外每颗 SoC 的登记项都缺 `capacities`/`cmaMiB`，也就是**唯一能触发决定性声明分支的设备全部被打瞎**。Pixel 6 从 D 掉到 B，四个测试失败。正确顺序是 confirmed → foreign → unset：**正向识别永远优先于「没有可比的值」**。
       - **标签在 `confirmed` 分支提前 return**，`out.Basis = unset` 永远执行不到。后果是「`ram_dispersion` 确认了」就把「capacity 通道根本没比对过」这件事吞掉了。现在两条并存：状态回答「有没有矛盾」，unset 回答「每个已登记通道是不是真的查过」，这是两个问题。
  3. **§8.4 前端 `version` 降级**。`scoreView()` 之前完全不读 `version`。现在不认识就**不上色**（`tone` 强制为 `unknown`）、数字和 band 原样透出（那是后端算的，前端不许改写）、并给出 `versionWarning`，`score-panel.tsx` 置顶显示。缺 `version` 字段同样按未知处理——旧后端不写这个字段，默认它和当前前端一致是错误假设。

- **第四处：U2 已落地（`sigmark-score/2`，2026-11-26）**：
  - **实现了什么**：`usageSdkYears` 年份表 + `usageSdkYear()` 解析（[score.go:246](../backend/cmd/sigmark/score.go#L246)、[:252](../backend/cmd/sigmark/score.go#L252)）；`usageAxis` 里 U1/U2 改成两条独立检查（[score.go:1288](../backend/cmd/sigmark/score.go#L1288)、[:1289](../backend/cmd/sigmark/score.go#L1289)，合并处 [score.go:1290](../backend/cmd/sigmark/score.go#L1290) 的 `switch`）；可判条件放宽为「`bootCount` 可用 且（分区日期可用 或 SDK 世代可用）」（[score.go:1279](../backend/cmd/sigmark/score.go#L1279)）；新增两个 reason `UNMAPPED_SDK_LEVEL` / `UNPARSEABLE_PARTITION_DATES`（[score.go:1270](../backend/cmd/sigmark/score.go#L1270)、[:1260](../backend/cmd/sigmark/score.go#L1260)）。详见 §10.1 与 §4 R4。
  - **升版**：`/1` → `/2`（[score.go:67](../backend/cmd/sigmark/score.go#L67)）。口径变了就要升版，哪怕当前数据上零翻档。
  - **落地时修掉一个自己写的缺陷（值得记下来）**：第一版用 `else if` 把 U1、U2 串起来，于是「分区日期可读」时 U2 **永不触发**——而那正是 U2 存在的场景（镜像新、设备老）。改判定不是「加个分支」，而是先想清楚两个信号是**独立检查**还是**互斥备选**；这里必须是独立检查，再在合并处用 `switch` 保证一因一果只扣一次。同一类错误在 §4 R4 的 `unset` 抢跑里已经犯过一次，两次都是「顺序写错，静默废掉一条通道」。
  - **验证到哪一步**：23 份生产库全库回算，`version` 全为 `/2`，band/value/coverage 逐份未变，**生产库 U2 命中 0**（理由见 §9.1.1）；**仿真器上 1 份实测阳性**（android-34 AVD，`first_api_level=34`→2023、`boot_count=2`、2026 采集年，`cutoff=2023`，正好压边界，usage 轴 100 → **88**）。测试：`score_usage_u2_test.go` 9 个 + `score_emulator_u2_test.go` 2 个 + 5 份黄金文件（diff 只有 `version` 一行）。
  - **仍未验证的部分（两件事，不要合成一句）**：① **真机阳性样本一份都没有**——仿真器能命中是因为它是「新实例 + 老镜像」，那是最容易造的形状，不是最需要验的形状；② **老镜像新实例存在误报面**（全新 AVD / 刚重置的真机会被扣 12 分，且真机上没有决定性 cap 兜底）。详见 §9.5「已知误报风险：老镜像新实例」。
  - **缓解方向（本轮未做）**：给 U2 加 `uptime < 3 天` 限定，把「刚重置就开始用」与「一直在跑的老机器」分开。需要新字段进 usage 轴、动字段集，因此不在本轮范围。

- **为什么不直接删掉原来的标注**：它们是有意的设计意图，删掉会让人以为「不需要」；标成未实现才既不撒谎也不丢需求。现在四处的状态都改成「已实现 + 落地日期 + 验证到哪一步」，同样的道理：只写「已实现」而不写验证边界，就是下一轮 F12。



### F13 行为轴权重是分簇的，不是一条梯队 —— 已实测，已降级为「簇内待标定」

- **事实**：`behaviorScoreTable` 的 25 / 20 / 15 / 12 / 8 一直是**先验假设**。三个真机锚点里，`hook_injection`、`debugger_attached`、`selinux_permissive`、`root_manager_visible`、`multi_open` 的阳性样本数是 **0**。也就是说这五个数字从来没有被任何数据检验过，而文档一直在用它们。
- **已补的样本（2026-11-25，六个分支全部有真实阳性）**：见 [EMULATOR-LAB.md §7.3](EMULATOR-LAB.md)。
  - `.magisk` 挂载 → `hook_injection`（25）
  - 第二 Android 用户 → `multi_open`（8）
  - `setenforce 0` → `selinux_permissive`（15）
  - 装一个带 LAUNCHER 的 `com.topjohnwu.magisk` 空壳包 → `root_manager_visible`（12）
  - `strace -f -p <pid>` 真实 ptrace → `debugger_attached`（20）
  - 全六条同时 → 扣分 115 超预算，**轴分 clamp 到 0**（R6 下界第一次被真实数据命中）

  每个分支各 1 份。**「有样本」只证明分支会响、方向对，不证明数字对**——见下面的敏感性结论。
- **敏感性实测**（§9.3.1）：每个标称分 ±5，**band 一次都没翻转**——但这几乎没有信息量，因为 band 由 R5/R11 决定。真正暴露问题的是 **value 次序**：第一次写「严格全序稳定」的断言时它**失败了**，因为 15、12、8 两两相差 3 和 4，小于扰动幅度。
- **诚实结论**：**「15 > 12 > 8」没有证据支撑。** 有支撑的只有「hook/debugger 重簇 > 其余轻簇」。测试已改成断言分簇，并在注释里写明这是**把标准降到数据支撑的高度**，不是放水。
- **要真正标定需要什么**：每个信号 ≥30 份**独立**样本。同一台 AVD 重复采集是同一个数据点，跑一百次也还是 1 份。必须换真机、换 ROM、换注入方式。这是本文目前**最实质的一条未完成项**，比 F12 剩下那三项更影响结论的可信度。

### F14 红队发现的第一个洞：删证据能升档 —— **已修（R10 窄形态）**

- **事实**：R7 把 `coverage < 0.5` 的轴整条剔出加权平均，权重随即重新归一化到「答了话」的轴上。于是**删掉证据会让分数变高**。
- **实测（真实 MI 8，同机同日）**：保留 usage 输入得 **97/B**；把 usage 输入删掉得 **100/A**。**高 3 分，跨一个 band**，而报告内容其实变少了。这不是理论推演，是红队测试在真机归档上跑出来的。
- **修法**：R10 扩成两层（§4 R10）。声明轴保持严格形态（盲 → 不出版数字）；behavior / usage 轴走窄形态（数字照常出版，但 `band` 不得为 A，强制降 B）。修复后同一台 MI 8 删证据得 **100/B**——数字仍是 100，但「一致」拿不到了。
- **为什么只禁 A、不夺数字**：统一成「都不出版」会掩盖真实发现。实测一个 hook 注入 + debugger 都在的样本本来是 **D**，若因 usage 轴薄就改成 `?`，报告里唯一看见了的东西反而丢了。窄形态锁的是 **band**（攻击者真正想动的东西），数字留作排序键。
- **测试**：`TestRedteamDeletingUsageEvidenceScoresBetterThanKeepingIt`，以及被这次改动改写的 `TestScoreRule7ThinAxisDoesNotDilute`、`TestScoreUsageHalfReadDoesNotLiftTheBand`。
- **方法论价值（比修法本身更重要）**：这个洞**在旧测试全绿的情况下存在**，是新写的红队测试把它揪出来的。改判定必须先写一个**能红的测试**；否则「改完还是绿」既可能是改对了，也可能是根本没碰到那段代码。

### F15 红队发现的第二个洞：洗白身份后与干净设备不可区分 —— **已修（`sigmark-score/3` 的 one-sided identity）**

**问题一句话**：删掉一侧身份读数，能把 `hit` 洗成 `insufficient`，25 分扣分与决定性 cap 一起消失，而**洗白后的报告与一台真的没冲突的设备逐字段不可区分**。危害不在分数高，在**证据消失**。

#### 修复前的实测（干净基线，100/A）

| 状态 | value | band |
| --- | --- | --- |
| 干净基线 | **100** | **A** |
| 引入一个身份冲突 | **90** | **D** |
| 洗白（冲突侧置空） | **100** | **A** ← 洗白后完全恢复成 A |

这正是红队当时预言、但没跑的那条路径（预言写在 `score_redteam_decisive_test.go` 的文件头注释里），实测成立：**一个已确认的伪装，删掉一个属性就变回「一致」，文档里没有任何痕迹**（`undetermined` 无条目、`deductions` 无那 25 分、`caps` 无决定性标记）。

#### 修复判据

新增 `oneSidedIdentity`（[identity_consistency.go:70](../backend/cmd/sigmark/identity_consistency.go#L70)），由 `profileSignals` 消费（[device_profile.go:259](../backend/cmd/sigmark/device_profile.go#L259)）：

> 同一对身份读数，**两侧 Status 都是 `AVAILABLE`**，但只有一侧产出可用值 → 判 `hit`。

**四个显式跳过条件，每一条都是防误伤的理由**：

| # | 跳过条件 | 为什么必须跳过 |
| --- | --- | --- |
| 1 | 任一侧 `NOT_ARCHIVED` | 该字段集根本没有这个字段，没有读数可谈，也谈不上「消失」。**关键**：全库 7 份「不对称」报告全是字段集 16 / 20，`propertyModel` / `propertyDevice` / `hardwareSku` 三行整行不存在，所以不误伤（见 §9.1.1 第三次复核） |
| 2 | 任一侧不是 `AVAILABLE`（`RESTRICTED` / `ERROR` / `UNAVAILABLE`） | 采集受限或读取失败，**不是证据**。把它当不对称等于因为 App 没有权限而给设备扣分 |
| 3 | 两侧都不可用（都空 / 都是占位符） | 真的读不到，是设备或采集的限制，不是篡改。**攻击者清空一侧时，另一侧仍然可读**——所以「两侧都空」不是这个攻击的形状 |
| 4 | 以上都不满足才判 `hit` | 只有「两侧 AVAILABLE + 恰一侧为空」这一种组合算证据 |

命中时附一行证据 `identity_asymmetry`（[device_profile.go:266](../backend/cmd/sigmark/device_profile.go#L266)），值为「**N 对身份读数只有一侧可读（共 M 对在档）**」；cap 的 reason 也用这句（`identityAsymmetryDetail`，[score.go:1004](../backend/cmd/sigmark/score.go#L1004)；消费点 [score.go:892](../backend/cmd/sigmark/score.go#L892)）。

**措辞是有意的**：只写**观察到了什么**，不写「被篡改」。打分不能知道那是 ROM 的怪癖还是一个被删掉的属性——它能说的只有「同一份声明的两侧都被读成功了，但只有一侧给出了值」。剩下那一步留给读报告的人。

#### 修复后的实测（同一批测试，`go test -v` 的实际输出）

| 实验 | 干净基线 | 一个身份冲突 | 洗白（冲突侧置空） |
| --- | --- | --- | --- |
| 决定性（`score_redteam_decisive_test.go`） | 100 / **A** | 90 / **D** | **90 / D** |
| 隔离设备（`score_redteam_clean_test.go`） | 88 / **B** | 78 / **D** | **78 / D** |

**洗白不再有任何收益**：置空一侧属性后，报告**原样停在冲突态**——`declaration` 的 coverage 不再掉（那一对仍然算「在档」，只是内容从「不一致」变成「不对称」），扣分和决定性 cap 都保留，`band` 仍是 D。

#### 一个连带的语义变更：单侧占位符现在也算不对称

原来 `device=" UnKnOwN "` vs `propertyDevice="corot"` 判 `insufficient`，**现在判 `hit`**。

理由：占位符（`unknown` / `null` / `none` / `n/a` / `-`，见 [identity_consistency.go:22](../backend/cmd/sigmark/identity_consistency.go#L22) 的 `usableIdentity`）和空白一样便宜。**只堵空白不堵 `unknown` 等于没堵**——攻击者把属性写成 `unknown` 就绕过了整个判定。所以 `usableIdentity` 先把占位符归一成空，再走同一条「恰一侧为空」的判定。

**但两侧都是占位符仍然不算**：那是设备真的报不出，不是有人在藏。两个测试锁住这个边界（[device_profile_test.go:440](../backend/cmd/sigmark/device_profile_test.go#L440)）：

- `one-sided placeholder is asymmetry evidence` —— 一侧占位符、一侧真值 → `hit`（原测试名 `unknown placeholder is missing evidence`，语义已改）；
- `placeholder on both sides is still not comparable` —— 两侧都是占位符 → 仍 `insufficient`。

**这一条是拿 R4 的宽松换来的**：R4 说「无证据不定罪」，但「一侧有值一侧无值」不是无证据，是**证据不对称**。完整论证见 §4 R4 的边界段。

#### 三次被污染 / 作废的实验（全部保留作方法论记录）

这个洞的结论改了三次，每次都因为**判据不够**，不是因为「再跑一遍」：

| 次 | 样本 | 结论 | 为什么作废 |
| --- | --- | --- | --- |
| 1 | `pixel6Evidence()`（`score_redteam_overlay_test.go`） | 82/D，「洗白无效」 | Pixel 6 自带 `FOREIGN_PROFILE`(30) + overlay 不一致(15)，82/D 是它们造成的 |
| 2 | 干净设备但 `kernelMemTotal=7.44 GiB`（`score_redteam_clean_test.go`） | 88/B → 78/D → 88/B，「洗白只到 B」 | 7.44 vs 12.00 GiB 是 **38% 离散度**，超过 8% 阈值（[hardware_facts.go:173](../backend/cmd/sigmark/hardware_facts.go#L173)），触发 `ram_dispersion` 的 `HARDWARE_CHANNEL_CONFLICT` 30 分。基线本来就带扣分 → **R11 保证它永远到不了 A**。三个数字互相自洽，却证明不了任何事 |
| 3 | 同一台设备，`kernelMemTotal=11.20 GiB`（`score_redteam_decisive_test.go`） | 100/A → 90/D → 100/A，**洞成立** | 这次基线真的是干净的，并且测试**先断言基线必须是 100/A**，否则直接 `Fatalf` |

**第 2 次是最危险的一种错**：它的结果能自圆其说（88/78/88 三个数互相一致），看起来完全可信，但基线是脏的，注定到不了 A。是红队**从 value 反推权重**（88 = 40×70/100 + 35 + 25，那 70 分只可能来自一条 30 分扣分）才发现的。判据是「**基线必须先独立验证干净**」，不是「结果自洽」。详见 §13 F16 第四次。

#### 为什么必须升 `sigmark-score/3` 与 `sigmark-profile/9`

`identity_conflict` 的**状态映射**变了（新增一个 `hit` 条件，且占位符的语义变了）：标签语义变 → `profileVersion` 升；它会移动 `band` → `scoreVersion` 升。全库 23 份零漂移也照升——契约与命中数无关（§8.7 第二例）。

### F16 验证方法的教训：非空 ≠ 对，自洽 ≠ 干净，有数字 ≠ 有口径

- **事实**：上一轮声称「70 处行号引用全部逐行验证、无空行」，这一轮的抽查推翻了它——**6 处引用指向的不是所声称的东西**（GPU 通道指到 `cpu_core_set`、`not_observed` 指到 `profile_unset`、`foreignProfile` 指到一行注释等）。
- **根因**：那次的验证脚本只检查「该行非空」，**没检查「该行是不是所声称的那个东西」**。空行检查能抓住最粗的漂移，抓不住「指向了同文件里另一条语句」这种更常见的错法。
- **教训**：**非空 ≠ 对，存在 ≠ 正确**。这条对本项目有普遍性——它和 §7.1「读到了 ≠ 读懂了」、R10「没看 ≠ 干净」、`listNames`「读不到 ≠ 不存在」是同一类错误的四个层级（验证脚本 / 采集 / 打分 / 目录列举）。**每一次「我们检查过了」都必须追问：检查的是什么属性？那个属性足以支撑结论吗？**
- **本文处理**：全文 **171 处**引用是**逐条打开目标行、确认它确实是所声称的函数/语句**之后才写的，不只看非空。本轮 `score.go` 又因新增两个函数整体后移（`usageSdkYears` 188→205、`usageAxis` 1013→1094、`agedImage` 1091→1172 等 30 余处），`hardware_facts.go` 也后移（`hardwareFactsLabel` 116→129、`foreignProfile` 292→322 等），已按**符号位置重新定位**而不是按偏移量加常数——偏移量在插入点跨过引用点时会算错。§14 第 20 项的通过条件已相应写严。
- **同一个病在同一轮里出现了五次**，五次都靠**换判据**才修好，一次也没靠「再检查一遍」：
  1. **行号只查非空** → 6 处指向同文件另一条语句。换成「该行是不是那个东西」。
  2. **洗白实验用了自带噪声的基线**（`score_redteam_overlay_test.go` 用 `pixel6Evidence()`）→ 得出「82/D，洗白无效」，**结论作废**：Pixel 6 自带 `FOREIGN_PROFILE`(30) 与 overlay 不一致(15)，那 82/D 跟洗白无关。换成「基线是否真的干净」。
  3. **测试计数没写清口径** → `^=== RUN   Test` 把子测试 `TestXxx/sub` 也算进顶层，得出 197 个「顶层测试」（真实是 146 顶层 + 70 子测试 = 216 个 `RUN` 行（`/4` 时代口径；`/5` 后为 167 顶层 + 70 子测试 = 237 个 `RUN` 行）），又手算出 201。换成「数 `--- PASS/SKIP/FAIL` 行」才对齐。
  4. **结果自洽 ≠ 基线干净**（最隐蔽的一次）。第二次洗白实验拿到 88/B → 78/D → 88/B，三个数字互相自洽、变化方向也合理，看着完全可信。但基线**本来就不是干净的**：`kernelMemTotal=7.44 GiB` 对 `totalRam=12.00 GiB` 是 **38% 离散度**，超过 8% 阈值，触发 `ram_dispersion` 的 `HARDWARE_CHANNEL_CONFLICT` 30 分。基线带着一条声明轴扣分，R11 就**保证它永远到不了 A**——所以「洗白只到 B」是**fixture 决定的**，不是规则挡住的。这个结论是红队**从 value 反推权重**发现的：`88 = 40×70/100 + 35 + 25`，那个 70 分只能来自一条 30 分扣分。判据换成「**基线必须先独立验证干净**」——现在决定性实验的第一句断言就是 `if clean.Band != bandA || *clean.Value != 100 { Fatalf }`。
  5. **链接能打开 ≠ 标签说的是同一件事**（本轮新发现，也是本文积了四轮的旧账）。每次行号重定位都只改了 href，**方括号里的可见数字没跟着改**——于是全文有 **80 余处** 形如 `[score.go:33]` 指向 `#L51` 的引用：「点进去是对的，但读者看到的是旧行号」。它一直没被发现，因为**验证脚本只检查 href 能否解析**，从来没人读标签。换成「**标签必须等于 href**」之后，用一条正则一次性对齐（现在 0 处不一致）。**这条特别值得记：文档的读者看的是标签，不是 href。**
- **五条其实是同一条**：**用了一个不足以支撑结论的判据，然后把它当成验证**。非空≠对、有样本≠干净、有数字≠有口径、自洽≠干净、可点击≠已同步。
- **第四条最隐蔽，第五条最普遍**：第四条的错误**没有外部症状**（长得和正确结果一模一样，只能从结果反推原因）；第五条的错**有症状但没人看**（每一处都在正文里明晃晃地错着，四轮都没人发现，因为所有人——包括验证脚本——只看 href）。**当一个实验的结果恰好符合预期时，最该问的是「这个结果有没有可能被别的东西决定」；当一处引用点得开时，最该问的是「读者看到的那个数字对了吗」。**

- **因此定四条硬规矩**（前两条已写进 §14）：
  1. **口径必须写在数字旁边**：写「**167 个顶层测试（含子测试共 237 个 `RUN` 行）**」，不写「237 个测试」。只写一个数字，下一个人无法判断它是哪种口径——第 3 次出错就是这么来的。
  2. **测试数字必须来自一条可复现的命令，不是某次运行的记忆**。本文所有测试数字的口径固定为：

     ```
     go test -v -count=1 ./cmd/sigmark
     ```

     **数 `--- PASS:` / `--- SKIP:` / `--- FAIL:` 行**（顶层测试，各自只出现一次），**不数 `=== RUN`**（含子测试，会多算）。本文当前口径：164 PASS + 3 SKIP = **167 个顶层测试**，`RUN` 行 237 个（167 顶层 + 70 子测试）。
  3. **任何「对照实验」必须先证明对照组是干净的，再谈差异**。而且这个证明要写成测试里的**前置断言**，不能写在实验者的脑子里——第 4 次出错时，实验者本人是相信基线干净的。
  4. **改行号时必须同时改标签，并用脚本校验「标签 == href」**。人眼读的是方括号里的字，href 只是跳转目标——只对一半等于没对。

- **为什么这条值得单列一节**：**测试数字是本文唯一会被别人直接引用、且不会被重新推导的东西**。规则写错了会有人算一遍，行号漂了会有人打开看，但「167 个测试」别人只会照抄。它错了，错误会原样传播下去，而且永远不会被发现。

### F17 35 分的决定性规则被三行属性改写绕过 —— **已修（`sigmark-score/4` 的结构性证据）**

**结论先说**：`VIRTUAL_BUILD_MARKERS` 是一条 **35 分 + 决定性 cap** 的规则，它读的三个键**全部由被审查的设备自己提供**。第三方模拟器把这三个值改掉，规则就只能得到 `not_observed`——**不是「没发现」，是「被喂了答案」**。

#### 实测（不是构造，是真机采集）

用户手动启动雷神模拟器（LDPlayer 9），实跑 SigMark 1.14.0 采集并上传，报告号 **`ce1bdc7f-f128-4e8b-a225-bbeb2bee7c35`**。报告里的属性原文：

```
system.boardPlatform = aosp-user
cpu.hardware         = qcom
system.product       = RMX5010
system.device        = unicorn
cpu.cpuInfo          = AMD Ryzen 9 9950X 16-Core Processor
ro.boot.qemu         = 1        （采集端从不读它）
MemTotal             = 2036460 kB（1.9 GiB）
SELinux              = Permissive
ro.product.brand     = realme，但四个 fingerprint 全是 Xiaomi/unicorn/unicorn
```

| 状态 | `band` | `virtual_build_markers` | cap | 扣分 |
| --- | --- | --- | --- | --- |
| **修复前** | **`?`** | `not_observed` | 无 | 0 |
| **修复后** | **`D`** | `not_observed`（未变） | `DECISIVE_VIRTUAL_BUILD` | 35 + 15 + 12 |

**注意修复后 `virtual_build_markers` 仍然是 `not_observed`**——标签层没有被改动，判 D 的是一条**新通道**。这一点很重要：修复不是「让黑名单更聪明」，是「换一个对手改不动的地方看」。

#### 根因：输入由对手提供

`virtual_build_markers` 读 `cpu.hardware` / `system.product` / `system.device`，比对 `ranchu` / `goldfish` / `vbox86` / `emulator` / `sdk_gphone`。这三个键的值**由被审查的设备自己提供**，雷神把它们全填成 `qcom` / `RMX5010` / `unicorn`，规则只能得到 `not_observed`。**35 分和决定性 cap 被三行 `resetprop` 清零。**

这是与前四次**不同性质**的错误，必须分开记：

| 轮次 | 错误的形状 |
| --- | --- |
| F12（`PROFILE_UNSET` 静默跳过）、F13 / F15（删证据升档、删一侧洗白）、F18（未登记 SoC 静默跳过） | 「**该看的没看**」——判据本身是对的，但没执行、没留名、或者被删掉了输入 |
| **F17** | 「**看的地方由对手填**」——判据执行了，但它问的是对手，对手答了「我不是」 |

**黑名单类规则有结构性缺陷：它的输入由对手提供。** 这条不是实现 bug，是判据选错了地方。

#### 修复：两条非黑名单通道（**成本不对称，见下节更正**）

新增 `backend/cmd/sigmark/virtual_evidence.go`，判据从「名字像不像模拟器」换成「**设备有没有自相矛盾**」：

| 通道 | 判据 | 数据从哪来 | 改造成本 |
| --- | --- | --- | --- |
| `desktop_cpu_info` | `cpu.cpuInfo` 含 `intel` / `amd` / `ryzen` / `core i3`–`core i9` / `xeon` / `apple m1`–`m4` 等（[virtual_evidence.go:48](../backend/cmd/sigmark/virtual_evidence.go#L48)） | **内核视图**：`/proc/cpuinfo` 透传 | **硬**。`/proc/cpuinfo` 是 `-r--r--r-- root root`，shell 写入被拒（`Permission denied`）。要改它得改 guest kernel 的视角 |
| `generic_board_platform` | `system.boardPlatform` ∈ {`aosp`, `aosp-user`, `generic*`, `unknown`, `emulator`, `goldfish`, `ranchu`, `vbox86`}（[virtual_evidence.go:33](../backend/cmd/sigmark/virtual_evidence.go#L33)） | **属性**：`ro.board.platform`（[DeviceCollectors.kt:129](../app/src/main/java/com/sigmark/app/collector/DeviceCollectors.kt#L129) 的 `declaredProperty`） | **软**。雷神实测 `setprop ro.board.platform test_probe` **一条命令**就改掉 |

两条都不做名字黑名单匹配，所以它们问的不是「你叫什么」，是「你说的和你测到的能不能同时为真」。**但「问的问题不同」不等于「更难满足」**——只有 `cpuInfo` 那条换了成本，`boardPlatform` 那条只是换了个问题，成本原地不动。

#### 成本更正：一条硬通道 + 一条软通道（本轮修正）

**本文上一版把 `boardPlatform` 写成「镜像构建产物、改它要动内核视角」，这是错的**，必须改正并留下痕迹：

| 通道 | 来源 | 改造成本 | 雷神实测 |
| --- | --- | --- | --- |
| `system.boardPlatform` | `ro.board.platform` —— **普通属性** | **1 条 `setprop`** | `setprop ro.board.platform test_probe` → `getprop` 返回 `test_probe`，改成功（已恢复 `aosp-user`） |
| `cpu.cpuInfo` | `/proc/cpuinfo` —— **内核视图** | 需改 guest kernel 视角 | `echo ... > /proc/cpuinfo` → `can't create /proc/cpuinfo: Permission denied`；`ls -l` → `-r--r--r-- 1 root root 0` |

**所以规则的真实强度是：一条硬通道 + 一条软通道，不是两条硬通道。** 只要模拟器把 `ro.board.platform` 改成真实代号（`pineapple` / `gs101` / `sdm845` / `mt6985` 都行），`generic_board_platform` 立刻失效，**35 分全靠 `cpu.cpuInfo` 一条撑着**。

这不是要掩饰的缺陷，而是这条规则的**诚实上限**，已用两个测试锁死（`TestRedteamFakingPlatformAloneIsCheap` 证明一条改写就能清掉软通道、两条都改则结构性证据归零；`TestRedteamCpuInfoSurvivesPlatformRewrite` 证明 `cpuInfo` 通道独立于 `boardPlatform` 的任意取值）。**规则的上限要写在规则旁边，否则下一个人会以为有两条硬通道。**

**这条成本差的原始命令与输出**（`setprop` 成功、`echo > /proc/cpuinfo` 被拒、`ls -l` 显示 `-r--r--r--`）记在 [VIRTUALIZATION-MATRIX.md](VIRTUALIZATION-MATRIX.md) §三，本文不复述。**同一份台账还测出一条更宽的结论**：六项改写能力实测下来**五项可写，唯一写不动的是 `/proc/cpuinfo`**——`ro.build.tags`、`ro.board.platform`、`ro.boot.veritymode`、`ro.debuggable`、`persist.*` 全部一条 `setprop` 改掉。所以「凡以 `ro.*` 为输入的判据在第三方模拟器上都是软通道」，受影响的不止本文这条规则，`rom_verification` 的两个输入也在其中（见 §13.1 第 8 项）。

**因此这一节最该记住的一句是：** **F17 修的是「35 分规则读错了地方」，没修、也修不了「整个体系有大量判据读属性」这件事。** 很容易把它读成「模拟器问题解决了」——实际只是把**一条**规则从软通道换成硬通道，而体系里还有大量规则读 `ro.*`，在雷神上全是软的。

#### 两个防误伤设计（都是承重的，不是保险）

这两条与上面的成本问题**无关**——它们防的是**误伤**，不是**漏报**，所以不受「软通道」影响，仍然都是承重的：

1. **`implementer 0x` 直接返回 false**（[virtual_evidence.go:79](../backend/cmd/sigmark/virtual_evidence.go#L79)）。ARM 正品在 `/proc/cpuinfo` 里就是 `CPU implementer 0x41` 这种形式，这是**正品信号**，不是可疑信号。不加这一条，所有真机都会被自己的 CPU 行判成桌面芯片。
2. **空白或不认识返回 false**（[virtual_evidence.go:73](../backend/cmd/sigmark/virtual_evidence.go#L73)）。**「我不认识」不是证据。** 桌面 CPU 族名是人工枚举的，明天出一颗没见过的新 ARM 芯片，它的名字必然不在表里——如果把「不认识」当可疑，误伤面就是**每一颗未来的 ARM 芯片**，而漏报面只是一个还没出现的模拟器。这个取舍必须是单向的。

#### 计分：同分、同决定性、与黑名单互斥

- `structuralVirtualPoints = 35`（[score.go:179](../backend/cmd/sigmark/score.go#L179)），与 `VIRTUAL_BUILD_MARKERS` 同分、同决定性。
- **互斥**：`structuralVirtualDeduction(parameters, markerHit)` 在 `markerHit == true` 时直接返回 false（[score.go:1133](../backend/cmd/sigmark/score.go#L1133)）。理由是一因一果（R2）——同一次「这是模拟器」不该收两次钱，而且黑名单命中时它的 detail 更直白，留给它。
- 扣分码 **`STRUCTURAL_VIRTUAL_EVIDENCE`**，走同一个 **`DECISIVE_VIRTUAL_BUILD`** cap（[score.go:1069](../backend/cmd/sigmark/score.go#L1069)）。
- 扣分挂在行为轴（`axisBehavior`），因为它是**对设备自述的实测反驳**，不是声明轴的自我矛盾。

#### detail 只写观察，不写结论

雷神那份报告的 `detail` 原文：

```
设备自相矛盾：desktop_cpu_info、generic_board_platform（cpu.cpuInfo=AMD Ryzen 9 9950X 16-Core Processor）（system.boardPlatform=aosp-user）
```

它说的是**测到了什么**，不是「这是模拟器」。差别在于：前者读报告的人可以自己判断（也许是一台接了外置 CPU 的怪机器），后者是打分越权下结论。**能写「什么和什么不能同时为真」，就不要写「它是什么」。**

#### 为什么只升 `sigmark-score/4`，不升 `sigmark-profile`

新通道**在标签表之外**：它直接读 `parameters`，不经过 `profileSignals`。10 个标签、三态定义、证据行形状一个字没改，所以 `profileVersion` 仍是 `/9`。但它新增 35 分 + 决定性 cap，会移动 band，所以 `scoreVersion` 必须升。见 §8.7。

#### 验证

- `score_redteam_emulator_test.go`（6 个 Test，fixture 直接取自归档报告，不允许漂移）：
  - `TestRedteamEmulatorRewritesEveryVirtualBuildMarker` —— 先断言**前提**：三个键确实都躲过了黑名单，且 label 确实是 `not_observed`。前提不成立这个测试就失去意义；
  - `TestRedteamStructuralContradictionCatchesWhatTheBlocklistMisses` —— 两条通道各自命中，且合计 ≥ 2；
  - `TestRedteamStructuralCheckDoesNotFireOnRealDevices` —— 7 个真机/空白反例（Pixel 6 Tensor、MI 8 SDM845、Redmi MT6985、SD 8 Gen 3、Dimensity 9300、空白）；
  - `TestRedteamOneRewriteIsNotEnough` —— 只改 `boardPlatform` 不够，`cpuInfo` 仍然独立成立；
  - `TestRedteamFakingPlatformAloneIsCheap` —— **成本不对称的锁**：`boardPlatform` 改成 `pineapple` 后软通道立刻失效；两条都改则 `structuralVirtualEvidence` **归零**。它存在的目的就是防止「两条硬通道」这个说法漂回来；
  - `TestRedteamCpuInfoSurvivesPlatformRewrite` —— `boardPlatform` 依次设 `pineapple` / `gs101` / `sdm845` / `mt6985`，`cpuInfo` 通道**始终独立成立**。
- 全库 24 份逐份回算零漂移（§9.1.1 第四次复核）；黄金 5 份数值全不变，只有 `version` 行变。

#### 方法论：**换个问题不等于换个成本**

这一节的结论要分两句说，第二句是这一轮补的：

1. **判据要尽量选对手改起来更贵的通道**，而不是对手随手就能填的通道。
2. **但「判据问的问题不同」不等于「判据更难满足」。** `boardPlatform` 确实问了一个新问题（平台串像不像 SoC 代号），但它照样是一个属性，照样一条 `setprop` 就清掉。**换个问题不等于换个成本。**

**判断成本要看数据从哪来——属性 / `/proc` / 构建产物——不是看它问什么。** 这是本轮最容易搞错的一点，本文自己就错了一次：上一版把 `ro.board.platform` 当成「构建产物」，于是把一个一条命令就能改的属性，写成了「改它要动内核视角」。

「名字匹配」永远只是第一道筛子——它的成本是对方写一行 `resetprop`，而筛子的成本是我们枚举所有可能的假名字。**两者的成本不对称，而且方向对我们不利。** 结构性判据里真正把成本反过来的是 `cpu.cpuInfo` 那条：对方要让它看起来像手机，就得改 `/proc`。

这条也解释了为什么 F12、F18 那类「留名」的修法在这里不够用：**留名只解决「我们知不知道自己没看」，不解决「我们看的地方是不是可信」。**

**一条现成、还没接上的通道**：雷神那份报告里 `system.socManufacturer=AOSP`，同时 `system.manufacturer=realme`、`system.brand=realme`。AOSP 是 AOSP 构建的合法值，真机零售 SoC 报的是厂商名（Qualcomm / MediaTek / Google）——「宣称零售机」和「SoC 厂商是 AOSP」不能同时为真。这条字段**采集、投影、Go 白名单三层齐全**，已经躺在归档里，但除白名单和一处 AVD fixture 外**没有任何代码读它**。所以它不属于 F17 这类「看了但看错地方」，而属于「能看、还没看」——记在 §13.1 第 6 项。**这也说明结构性判据的原料往往早就在库里了，缺的只是有人去接。**

### F18 未登记 SoC 的四个通道静默跳过 —— **已修（`sigmark-score/4` 的 `unregistered_soc:` 留名）**

**结论先说**：SoC 不在注册表里时，`hardware_declaration_conflict` 的四个通道**全部不执行、且什么都不写**。标签只聚合了跑起来的两个通道，两者一致就输出 `not_observed`——**「没比较」和「比较过且一致」渲染成了同一个结果**。

#### 问题形状

`hardwareFactsLabel` 里四个分支全部以 `known &&` 为前置：

```
cpu_core_set   (cpu.cpuParts)
gpu_family     (runtime.glesRenderer)
cpu_capacity   (cpu.cpuCapacity)
cma_total      (memory.cmaTotal)
```

`declaredSoc` 解析不到 `socProfiles` 里的条目时 `known == false`，四个通道全死。label 只聚合 `ram_dispersion` 和 `overlay_codename`，一致就 `not_observed`。

**这和 F12（`PROFILE_UNSET`）是同一形状的错误，只是高一层**：F12 是「通道被跳过且不留名」，F18 是「**四个通道一起被跳过且不留名**」。当前注册表只有 6 条（`gs101` / `mt6985` / `sm8550` / `sm8450` / `sm8250` / `sdm845`），**任何新芯片都能免费拿到一份干净的硬件判定**，而且唯一的发现方式是背下注册表。

#### 修复：不猜期望值，把省略写出来

**不给未知 SoC 编造期望值**（那会凭空造事实，比 bug 更坏），而是**把省略公布出来**：未登记时给四个通道各记一条 `unregistered_soc:<channel>` 的 basis（[hardware_facts.go:190](../backend/cmd/sigmark/hardware_facts.go#L190)、[:192](../backend/cmd/sigmark/hardware_facts.go#L192)）。

#### 一个关键区分：`known == false` 混了两种情况

这是本次最容易做错的地方。`declaredSoc` 返回 `known == false` 时，可能是：

1. 报告里**根本没声明** SoC（老报告没这个字段）；
2. **声明了但注册表不认识**。

**只有第 2 种是我们的覆盖缺口。** 所以新增 `socDeclared(read)`（[hardware_facts.go:112](../backend/cmd/sigmark/hardware_facts.go#L112)），只有「**有声明但未登记**」才打 gap 标记。否则会把「这份老报告没这个字段」误报成「我们试过但失败了」——那是在**制造**噪声，不是消除噪声。

#### 危险的另一半：gap 标记不能变成扣分

`unregistered_soc:` 条目和真实冲突 basis **共用同一个 `Basis` 切片**，而 `declarationAxis` 对非 overlay 的 basis 按 **30 分**（`HARDWARE_CHANNEL_CONFLICT`）计价。如果不在那里排除这个前缀，**每一台未登记设备都会开始为一次从未发生的比较付 30 分**——正好是所修 bug 的反面，而且更坏：前者是「少报了」，后者是「凭空扣分」。

所以 `nonOverlayBasis`（[score.go:749](../backend/cmd/sigmark/score.go#L749)）新增排除 `unregistered_soc:` 前缀（[score.go:760](../backend/cmd/sigmark/score.go#L760)）。**省略不是矛盾**——这一句就是排除的全部理由。

#### 验证

`score_redteam_unregistered_test.go`，4 个 Test：

1. `TestRedteamUnregisteredSocNamesTheChannelsItSkipped` —— 四条被跳过的通道必须各自留名，先断言 fixture 的 SoC 确实未登记（前提断言）；
2. `TestRedteamUnregisteredSocKeepsTheAggregateState` —— 聚合 state **不动**（仍 `not_observed`）。点名省略是**审计改进，不是新判决**；在这里造 `insufficient` 会把库里所有未登记设备一起降档；
3. `TestRedteamUnregisteredSocDoesNotPayTheChannelConflictPrice` —— 未登记通道不得进入 30 分计价，**同时真实冲突（`ram_dispersion`）必须仍然被计价**，防止排除写得太宽；
4. `TestRedteamRegisteredSocPublishesNoUnregisteredBasis` —— 已登记 SoC 不得出现任何 `unregistered_soc:`。

全库 24 份**零漂移**（§9.1.1 第四次复核）；Go 全包通过，Web 103/103。**零漂移在这里是可以先推出来的**：新加的 basis 全部带 `unregistered_soc:` 前缀，而 `nonOverlayBasis` 已经把它们排除在计价之外，所以没有任何一份报告的扣分项会变。实测只是确认这个推论——**但推论要写在实测前面**，否则「零漂移」看起来像运气。

#### 修的是「漏了要说」，不是「不漏」

注册表还是只有 6 条 SoC。修完之后，一台未登记设备的硬件轴仍然**什么都没比**——只是现在它会**自己说出这一点**。所以这条的定位必须写准：**它把「静默的盲区」变成了「可见的盲区」，盲区本身还在。** 见 §13 未决清单第 2 条。

### F19 两条「文档自相矛盾」类缺陷 —— **已修（`sigmark-score/5`）**

这两条与 F17/F18 不是同一类。F17/F18 修的是**判据被绕过**（漏判），F19 修的是**出版出来的文档不可信**（自相矛盾）。后者更隐蔽：它不影响「这台设备该判几档」，只影响「读者能不能相信这份报告」。

#### F19-a：决定性命中仍然吞掉 `value`

见 §4 R10 第一层。抑制条件从裸的 `declarationBlind` 收紧为 `declarationBlind && !out.Decisive`（[score.go:470](../backend/cmd/sigmark/score.go#L470)）。

**判据依据**：R10 的目的是「别给没人看过的画面一个**舒服**的结论」。决定性 cap 已经把 band 钉在 D，舒服的东西不存在了；此时 `value` 的唯一用途是排序键（§13 F5 明文要求决定性命中保留它）。

**没有放宽的部分**：R8（总体 coverage < 地板）与 `weights == 0` 仍然无条件吞数字。那两处「没有数字」本身就是结论。

#### F19-b：`FRESH_BOOT_ON_AGED_ROM` 对模拟器重复计费

见 §10.2.1。虚拟化被独立通道确认时不再收这 12 分（[score.go:1287](../backend/cmd/sigmark/score.go#L1287) 的 `&& !virtualized`）。

**判据依据**：一因一果（R2）。「镜像 `first_api_level` 与系统镜像不一致」是模拟器的**定义**，不是伪装；同一个「这是模拟器」的事实已经由 behavior 轴 35 分 + 决定性 cap 收过费。

**三条防滥用约束**：单向（声称是模拟器要付 35 分 + D）、只抑制定价不抑制可判性（`decided` 仍 1、coverage 仍 1.00）、真机不受影响（`TestUsageFreshBootStillFiresOnRealHardware` 双向锁）。

#### F19-c：`finalizeScoreAxis` 的顺序让 35 分没进轴分

见 §8.3.1。行为轴的 `finalizeScoreAxis` 原本在结构通道追加**之前**调用，于是那 35 分进了账本、没进轴分：账本写 50、轴分写 85。修复是把调用移到追加之后（[score.go:1092](../backend/cmd/sigmark/score.go#L1092)）。

**为什么这一条最值得记**：**它在真机上永远不可见**。真机不触发结构通道，那段 append 从不发生。五份黄金文件里的 Pixel 6 与 MI 8 在这条缺陷上永远是绿的——不是因为代码对，是因为它们走不到那行。**一个只由正常样本组成的回归集，会保护「只在异常样本上出现」的 bug。**

#### F19 的方法论：两条缺陷互相掩盖

`/4` 时期，F19-a 把 `value` 吞掉了，于是 F19-c 造成的「轴分算错」**在总分上根本看不出来**——没有数字可以对比。F19-c 唯一的表现形式是文档内部矛盾（账本 50、轴分 85）。

推论很硬：

- 只修 F19-c 不修 F19-a → 总分仍然印不出来，顺序错误继续隐身；
- 只修 F19-a 不修 F19-c → 报告会出版一个**从自己的轴复算不出来**的数字。

**所以「修一个最明显的」是错的策略。** 当一个缺陷把另一个缺陷的**症状**遮住时，逐个修会让修复看起来成功、实际只是换了一个症状。判断标准不是「这个 bug 还在不在」，而是「**这份文档现在能不能被读者独立复算**」。

#### 为什么只升 `sigmark-score/5`

两处修复都不碰标签层（`sigmark-profile` 保持 `/9`），也不新增必需字段。`value` 与轴分都变了，所以 `sigmark-score` 必须升——**判级标准一个字没改，改的是出版出来的数字**。

#### 验证

`score_ldplayer_test.go`（462 行）以归档实测值为 fixture，逐项断言：`value == 71`、`band == D`、declaration 轴 `score == nil`、`recomputeValue` 与出版值一致；另有反向测试断言 R8 仍然吞数字（`TestScoreDecisiveStillWithholdsTheNumberUnderTheCoverageFloor`）。usage 侧由 `TestUsageFreshBootStillFiresOnRealHardware` 反向锁住真机行为。

### 13.1 未决清单（按优先级，2026-11-26 更新）

F 系列记的是**已经发生并处理过**的缺口。下面是**还没处理**的，按「能被攻击者利用的便宜程度」排序，不按工作量。

| # | 未决项 | 断在哪一层 | 为什么这个优先级 |
| --- | --- | --- | --- |
| 1a | **`ro.boot.qemu` 已采（字段集 26），`ro.kernel.qemu` 仍未采；且打分规则还没读它** | **采集层已通，规则层未接**：`DeviceCollectors.kt:139` 有 `declaredProperty("bootQemu", "ro.boot.qemu", ...)`，`LanDetails.kt` 两个投影集合都含 `bootQemu`（第 14 行 / 第 30 行），`protocol.go:96` 白名单有 `{"system", "bootQemu", 26}`，`maxFields` 新增 `>= 26 → 260` 档（[protocol.go:578](../backend/cmd/sigmark/protocol.go#L578)）。**`ro.kernel.qemu` 仍然没有。** 三层登记缺第三层的一个旁证：`field_dictionary.go` 里 `bootQemu` **零命中**——白名单收它，词典没给它条目 | 雷神那份报告里 `ro.boot.qemu=1` 就在设备上，是最便宜的直接证据。**现在它进得来归档了，但没有任何判据读它**（`score.go` / `device_profile.go` / `hardware_facts.go` 对 `bootQemu` 零引用）。这是「字段到位、规则缺席」，和 1b 正好相反。**第一优先级：先加判据，再谈别的。** |
| 1b | **`Build.FINGERPRINT` 采了但没上传** | **投影 + 白名单层**：`DeviceCollectors.kt:108` 已经采到（key `fingerprint`），但 `LanDetails.kt` 的两个投影集合（`system` 组，第 14 行推送集 / 第 28 行本地集）**都没有 `fingerprint`**，`protocol.go` 的 `parameterKeys["system"]` **也没有**（`partitionField` 正则只放行 `partition_*`，没有旁路） | 这条比 1a 更值得记，因为**采集是对的、规则也没漏读，断在中间**。雷神那份报告 `brand=realme` 而四个 partition fingerprint 写 `Xiaomi/unicorn/unicorn`，这处现成的矛盾**在归档报告里根本不存在这个字段**——195 个 key 里 `fingerprint` 零命中。改法只动**投影和白名单**，不动采集器。 |
| 2 | **SoC 注册表只有 6 条**（`gs101` / `mt6985` / `sm8550` / `sm8450` / `sm8250` / `sdm845`） | 打分层的**知识面**（不是链路断了） | 覆盖面短板。F18 已让未登记设备**自报缺口**，但四个通道仍然全是空的——修的是「漏了要说」，不是「不漏」。 |
| 3 | **`FRESH_BOOT_ON_AGED_ROM` 在模拟器上误报 12 分** | 打分层的**判据**（`first_api_level=28` + `bootCount=1` 会命中 U2） | **一半已修（`/5`）**：虚拟化被独立通道确认时不再计这 12 分（§10.2.1）。**剩下的另一半仍在**：**真机**刚恢复出厂、或真机刷了老 ROM，同样形状仍然会被扣 12 分——那不是模拟器，`virtualEvidenceConfirmed` 返回 false，扣分照旧。缓解方案（`uptime < 3 天`）仍未实现。 |
| 4 | **桌面 CPU 族名是人工枚举**；ARM 服务器芯片（如 Ampere Altra）若出现在 `cpuInfo` 会被误判 | 打分层的**知识面**（`desktopCpuMarkers` 是手写清单） | 两个方向都未验证：新桌面厂商会漏（漏报）；Ampere Altra 这类**真 ARM 服务器芯片**出现在手机报告的 `cpuInfo` 里会被当成桌面芯片（误报）。 |
| 5 | **单观察者通道是否也能被删一侧擦除**（overlay / SELinux / `virtual_build`） | 打分层的**判据形态**（没有「另一侧」可比） | F15 修的是身份通道的「两侧可读一侧空」。这三条都是**单观察者**通道，F15 的判据套不上。它们能不能被同样的手法擦掉，一次都没测过。 |
| 6 | **`system.socManufacturer` 上传了但没有判据读它** | 链路**已通**（采集、投影、白名单三层齐全），缺的是**规则** | 雷神那份报告 `socManufacturer=AOSP` 而 `manufacturer=realme`、`brand=realme`。AOSP 是 AOSP 构建的合法值，真机零售 SoC 报的是厂商名（Qualcomm / MediaTek / Google）——「宣称零售机」与「SoC 厂商是 AOSP」不能同时为真。**已核实**：Go 侧除 `protocol.go` 白名单和一处 AVD fixture 外**没有任何代码读它**，所以这是一条**现成可用、零成本、还没接上**的通道。 |
| 7 | **`generic_board_platform` 可被单条 `setprop` 清除，结构性证据实际只有一条硬通道** | 打分层的**判据成本**（`ro.board.platform` 是普通属性，[DeviceCollectors.kt:129](../app/src/main/java/com/sigmark/app/collector/DeviceCollectors.kt#L129)） | **这是 F17 的真实剩余限制，不是已解决项。** 雷神实测 `setprop ro.board.platform test_probe` 一条命令改成功，软通道当场失效，35 分只剩 `cpu.cpuInfo` 一条撑着；两条都改则结构性证据归零（`TestRedteamFakingPlatformAloneIsCheap` 就是这个归零的断言）。要补硬通道，得找**属性之外**的来源（`/proc`、EGL 驱动串、构建产物），不是再找一个属性。 |
| 8 | **凡以 `ro.*` 为输入的判据在第三方模拟器上都是软通道** | 打分层的**判据成本**（雷神实测：六项改写能力里**五项可写，唯一写不动的是 `/proc/cpuinfo`**） | **已全部实测，不再是推断。** `rom_verification` 的两个输入确认都是软通道：`environment.verityMode` ← `ro.boot.veritymode`（原值空 → `setprop` 成 `enforcing`）、`environment.buildDebuggable` ← `ro.debuggable`（原值 `0` → `setprop` 成 `1`），两条都改成功。同样受影响的还有 `selinux_permissive` 的属性来源。**这条不要求立刻改规则，要求的是不再把「读属性」写成「检测」。** 逐条命令与原始输出见 [VIRTUALIZATION-MATRIX.md](VIRTUALIZATION-MATRIX.md) §3.2b 与 §3.6（本文不复述数据，只引结论）。 |
| 9 | **`-writable-system` 持久化验证：技术阻塞，已放弃** | **验证路线**（不是代码问题） | `adb remount` 返回 `Now reboot your device for settings to take effect`，但 `adb reboot` 在 emulator 37.3.10 无快照无头配置下让设备**永久 offline**；`-wipe-data` 后 adb 鉴权重置同样卡 offline。**重试 6 次，用户叫停 AVD 路线。** 结论是「这条路当前走不通」，不是「没试」。 |
| 10 | **arm64-v8a 在 x86 宿主的速度：未测** | **验证路线** | 镜像下载已取消，所以连速度数据都没有。它影响的是「用 arm64 AVD 做真机近似」这条路线可不可行，不影响现有规则。 |
| 11 | **其它虚拟化平台属性：未测**（Android-x86 / Bliss / Waydroid / redroid） | **样本面** | 目前只有 **AOSP AVD 与雷神两类样本**。这两类都属于「Android 官方/商业模拟器」，而 redroid / Waydroid 是**容器方案**，属性面完全不同——现有实测规律不能外推。 |
| 12 | **老 API 镜像：已完成**（android-30） | **已验证，非未决** | 结论：Google 官方重发的老 API 镜像天然构成「**老设备 + 新镜像**」，U2（`FRESH_BOOT_ON_AGED_ROM`）的触发条件在官方镜像上**自动成立**。这是**误报面**，不是攻击证据——真机刷老 ROM 也会命中。保留在此只为让清单完整，不需要再动。 |
| 13 | **前端版本常量还停在 `sigmark-score/4`** | **前端契约层**（[score-view.ts:78](../backend/web/src/score-view.ts#L78) 的 `export const scoreVersion = 'sigmark-score/4'`） | 后端已出版 `/5`，前端只认得 `/4`。按 §8.4 的降级规则，**每一份新报告都会走「未知版本」路径**：不上色（`tone` 强制 `?`）、`versionWarning` 置顶。**数据不丢**（`band` 与 `value` 原样透出），但整个打分面板的视觉结论失效。20 个 Web 测试仍然全绿，因为它们**引用的是同一个常量**——常量改错时两边一起错，测试永远发现不了。这正是 §13 F16 第 3 条「自洽 ≠ 干净」的又一次复发：**测试与实现共用同一个错误常量时，测试证明的只是自洽。** 修法：把常量改成 `/5`，并加一条「常量必须等于后端 `scoreVersion`」的跨语言断言（或从 golden 文件读）。**本轮不在范围内，未改代码。** |
| 14 | **`score.go` / `score_ldplayer_test.go` 注释里的 `82.75` 对不上任何样本** | **注释层**（代码逻辑正确，只有注释数字错） | `score.go` 的 `/5` 版本历史注释与 `score_ldplayer_test.go:134` 都写「三轴可见分 82.75 vs 71」。实测应为 **82.5**（雷电：`(40×100 + 35×50 + 25×100)/100`），而仿真器基准样本是 **87.75 vs 80**。**两条注释都没有任何测试断言**，所以永远不会红。这正是 §13 F16 第 3 条「有数字 ≠ 有口径」的复发：**注释里的数字和文档里的数字一样，没人复算就一定会漂。** 修法：把这两个数字改成「由样本自己算出来」，或直接删掉具体数字只留公式。**本轮只改文档、未改代码。** |

**平台覆盖与改写能力的完整实测台账**（命令 + 原始输出）不在本文，见 [VIRTUALIZATION-MATRIX.md](VIRTUALIZATION-MATRIX.md)：它记录了雷神 LDPlayer 9 的属性改写能力、`/proc/cpuinfo` 不可写证据、平台覆盖现状与复现步骤。本文只引用它的结论，不重复它的数据。

**这张表本身也有一个方法论要求**：每一项都要写清「**断在哪一层**」和「为什么是这个优先级」。只写「待办：改进 SoC 覆盖」是没用的——它既不能验收，也不能排序。**本轮新增了「断在哪一层」这一列，因为 1a 和 1b 证明了「同一个字段缺失」可以来自三个完全不同的地方。**

**这一列是本轮最值钱的东西：「采了但没上传」和「没采」在归档层看起来完全一样**——都是字段缺失。审计采集系统时必须**分别验证这两层**，否则会把「投影漏配」误判成「规则漏读」，然后跑去改规则，改完发现字段还是不在。

判断方法（顺序不能反）：

1. 先查 **Android 采集侧**有没有这个 key（`DeviceCollectors.kt` / `SecurityObservations.kt`）；
2. 再查 **投影**（`LanDetails.kt` 的 `system` 组集合）和 **Go 白名单**（`protocol.go` 的 `parameterKeys`）；
3. 三处都查完，才能说断点在哪一层。

**三层齐全**（1b 的 `fingerprint` 缺后两层，6 的 `socManufacturer` 三层齐全）→ 才轮到怀疑「规则没读」。**在确认三层齐全之前，任何「规则漏读」的结论都是猜测。**

**还有一种更隐蔽的情况：证据已经存在于测试或文档里，但从未接进生产链路。** 这种「**已知未用**」比「完全未知」更难发现，因为**搜索时会命中**，容易让人误以为已经处理过。1a 就是这种：`qemu` 只在 `score_redteam_emulator_test.go` 里出现——红队把雷神实测值写进 fixture 当证据，而采集器一次都没读它。所以判断「某字段有没有人处理」时，**不能只问「仓库里有没有这个字符串」，要问「生产链路上有没有人读它」**；前者会命中测试和注释，后者才决定报告里有没有这个字段。

**顺带记一条自查**：本轮我第一版写的是「全仓 `qemu` 零命中」，那是**错的**——错在我用了 `Get-ChildItem -Recurse -Include *.kt,*.go` 这种写法，`-Include` 在这种参数形态下静默返回空，**空结果被当成了「不存在」**。这和 F16 第一条「行号只查非空」是同一个病：**验证命令本身可能什么都没查**。凡是拿到「零命中」的结论，必须先证明那条命令**能命中一个已知存在的样本**。

---

## 14. 验收清单

| # | 检查 | 通过条件 |
| --- | --- | --- |
| 1 | 标签 code 与顺序 | 与 `profileSignals` 的 10 项、wire 顺序一致 |
| 2 | 分支映射 | §2.3 每行都有 code / label / points / keys / detail，且 **code 与 `score.go` 逐字一致**。✅ `TestScoreDeductionTableMatchesTheDocumentedContract` 表驱动锁住 `(code, label, axis, points, decisive)` 五元组，并反向断言实现产出的每个 code 都在表里（§13 F10） |
| 3 | R1 | 不存在无 label、无 key、无 detail 的扣分 |
| 4 | R2 | 同一 label 最多 1 条；三对身份冲突不叠加；**同一事实不跨分支重复计分**（`nonOverlayBasis`） |
| 5 | R3/R4 | 7 个 insufficient 的 fixture 得 `?`；`undetermined` 原因可区分。✅ **七个值**：四个字段状态 + `PROFILE_UNSET`（SoC 已登记但缺期望值）+ `UNMAPPED_SDK_LEVEL`（`initialSdk` 读到但不在年份表里）+ `UNPARSEABLE_PARTITION_DATES`（分区日期读到但解析不出年份）。前五个由 `TestScoreProfileUnset*` 五个测试锁住，含「不得遮蔽 foreign-profile」与「不得替代字段状态」两条反向断言；后两个由 `TestScoreUsageU2UnmappedSdkIsNamedNotAssumed` 与 U2 系列测试锁住（§13 F12） |
| 6 | R5 | 四个 decisive fixture 均 D，`caps` 各一条（Pixel 6 / 仿真器 / identity app-uid / nine-green-one-red） |
| 7 | R6 | 轴分覆盖 0–100（扣满 = 0）；扣分不按权重换算；整数运算 |
| 8 | R7/R8 | 低覆盖轴不进平均，**但带扣分的薄轴必须计入**；`value=null` 时前端不显示 0；**被 R7 排除的轴必须出版 `score = null`**，否则文档不可复算。✅ `recomputeValue` 断言「印出来的有分轴加权重算 == `value`」（§5.6、§8.3.1） |
| 9 | R9 | 87/88 不产生不同颜色；band 文案正确。✅ `TestScoreNearbyValuesShareABand` 钉住相邻分数同 band，并单独断言 50/49 **不得**同 band（C/D 边界在这里） |
| 10 | R10/R11 | **R10 两层都要验**：声明轴盲 → `?` 不出版数字（严格形态），**但决定性命中例外、`value` 照常出版**（`/5`）；behavior/usage 轴盲 → **数字照常出版但 band 不得为 A**（窄形态）。A 档零扣分，有扣分即降 B。✅ `TestRedteamDeletingUsageEvidenceScoresBetterThanKeepingIt`（删证据得 100/B，不再是 100/A）+ `TestScoreDecisiveKeepsItsValueWhenTheDeclarationAxisIsBlind`（决定性命中保留 `value`，且可复算）+ `TestScoreDecisiveStillWithholdsTheNumberUnderTheCoverageFloor`（**反向**：R8 仍然无条件吞数字）+ 被改写的 `TestScoreRule7ThinAxisDoesNotDilute`、`TestScoreUsageHalfReadDoesNotLiftTheBand`（§4 R10） |
| 11 | `basis` | `hit` 列出全部冲突分支；`not_observed` 列出确认分支；判不出时为空 |
| 12 | 身份分流 | model/device 对 → 25 分 + 决定性；**SKU-only → 15 分、非决定性**；**一侧可读一侧为空 → 同样走这条分支（`hit`），不另设扣分值** |
| 13 | 轴分母口径 | declaration 3 单元、behavior 6 个计分标签、usage 1 个派生标签。✅ `TestScoreDeclarationAxisHasExactlyThreeUnits`：Pixel 6 全决出 → coverage 恰好 1.0（分母为 4 时最好只有 0.75）；MI 8 → 恰好 0.67，并显式排除 0.5 / 0.75 这两个错误的分子分母组合 |
| 14 | 标签归属 | 每个 behavior 标签要么计价、要么在 `behaviorDisplayOnlyLabels` 里 |
| 15 | 锚点 | Pixel 6 = D/82；MI 8 = A/100；**仿真器 = D/null/0.67/decisive**；五份黄金文件锁住整份文档。`/1` → `/2`、`/2` → `/3`、`/3` → `/4` **三次**升版后，五份黄金文件的 diff **都只有 `version` 一行**，判定逐字未变 |
| 16 | 版本 | 权重、标称分、分支 label 或输出顺序改动必产生黄金 diff；**改判定或标签状态映射才升 `sigmark-score/N`**，只改输出形状不升版。当前 `/4` ↔ `profile/9`；「零命中也要升版」已有两例（`/1`→`/2` 的 U2、`/2`→`/3` 的一侧身份不对称），**且 `/4` 证明「升哪一层由哪一层变了决定」**——标签层没变，所以只升 `score` 不升 `profile`。三次升版全库都零漂移照升（§8.7） |
| 17 | 边界 | 文档、UI、导出都写明「不能证明真机」。✅ `score-panel.tsx` 标题下已写明「这套判定只看本次采样看见的痕迹，**不能证明是真机**，也不能证明设备没有被改装」；文档见 §12 |
| 18 | 隐私 | v1 未新增字段/权限；v27 候选有单独决策清单（字段集 26 的 `system.bootQemu` 是采集面新增，不进打分，见 §10.4） |
| 19 | 降级 | 三种情况都不伪造分数。✅ **旧后端无 `score` → 已实现且已测**；**计算失败省略 `score` → 已实现，`TestScoreEmptyArchiveIsNotACleanDevice` 锁住「空档案不得渲染成 A」与 wire 上的显式 `null`**；**未知 `version` → 已实现且已测**（不上色、数据原样、`versionWarning` 置顶；缺字段同按未知）。见 §8.4 与 §13 F12 |
| 20 | 行号引用 | 本文每个 `文件:行号` 引用**两个方向都要对**：① href 能打开**所声称的那个函数或语句**——不是空行、不是无关行、也不是同文件里另一条语句；② **方括号里的可见行号必须等于 href 里的行号**（`[score.go:217]` 配 `#L217` 可以，`[score.go:205]` 配 `#L217` 不行）。只查「非空」或只查「href 可解析」都不算通过（§13 F16 第 5 条）。改代码后必须逐条回扫，并用一条正则校验标签 == href |
| 21 | 排序确定性 | 同一份证据两次投影必须产出逐字节相同的文档：`deductions` 按 points 降序、`caps` 按 code 升序、`undetermined` 按轴/reason/keys 排序去重。✅ 由黄金文件逐字节比对 + 前端 `the ledger preserves backend order instead of re-sorting` 锁住（§8.3） |
| 22 | 行为轴阳性样本 | 五个仿真器变体各产生一份真实报告，`multi_open` / `hook_injection` / `selinux_permissive` 三个分支**都有真实阳性**且扣分与 §2.3 一致。✅ `TestScoreEmulatorVariant*` 四个测试 + 两份变体黄金文件；实测记录见 [EMULATOR-LAB.md §7.3](EMULATOR-LAB.md) |
| 23 | 权重敏感性 | 每个标称分 ±5，band 不得翻转；value 次序按**簇**稳定（重簇永不排在轻簇之后），**不要求簇内全序**——簇内三个数字互相在噪声内，这是实测结论而非缺陷。✅ `TestScoreBehaviorWeightsAreNotBandSensitive` + `TestScoreBehaviorWeightsSeparateIntoTwoClusters`（§9.3.1） |
| 24 | U2 两条独立检查 | U1 与 U2 **不得**用 `else if` 串成互斥分支；分区日期可读时 U2 仍必须能触发。✅ `TestScoreUsageU2CatchesOldDeviceOnFreshImage`（镜像新、世代老 → 必须命中）与 `TestScoreUsageU1StillFiresWhenTheImageIsOld`（U1 仍要响） |
| 25 | U2 一因一果 | U1、U2 同时成立时**只扣一次 12 分**，且 `detail` 用 U1 的解释（分区日期是直接证据）。✅ `TestScoreUsageU1AndU2DoNotDoubleCount` |
| 26 | U2 年份表 | 表值逐项与 §10.1 的表一致；**表外级别返回 not-ok 并记 `UNMAPPED_SDK_LEVEL`，不得当作「新」**；不得出现 `2017 + (sdk − 26)` 式估算。✅ `TestUsageSdkYearTable` + `TestScoreUsageU2UnmappedSdkIsNamedNotAssumed` |
| 27 | U2 的判定边界 | `bootCount > 2` 不得命中；世代不老的不得命中；窗口相对采样时间而非固定年份。✅ `TestScoreUsageU2RequiresFewBoots`、`TestScoreUsageU2IgnoresRecentGenerations`、`TestScoreUsageU2WindowIsRelativeToCapture` |
| 28 | 可判条件放宽的方向 | 放宽的是**可判集**不是**扣分**：镜像新、世代老的设备从「判不了」变成「判了且干净」，不得反过来变成扣分。✅ 由 `TestScoreUsageU2IgnoresRecentGenerations` 与全库 23 份回算零翻档共同锁住（§9.1.1） |
| 29 | U2 的样本局限 | **必须如实分两栏写**：生产报告库 23 份 **0 命中**；仿真器 **1 份实测阳性**（android-34 AVD）；**真机阳性样本仍为 0**。验收时不得把「仿真器命中」写成「真机已验证」（§9.5） |
| 30 | U2 边界精确性 | 同一份读数（`sdk 34 → 2023`）在采集年 2025 不命中、2026 命中、2027 命中；`cutoff = 采集年 − 3`，边界是 `≤` 不是 `<`。✅ `TestEmulatorU2BoundaryIsExact` 三档全锁（§9.5） |
| 31 | U2 老镜像新实例误报面 | 全新 AVD / 刚重置的真机命中 U2 时，**必须写成「镜像老」而不是「隐藏使用痕迹」**；仿真器实测 usage 轴 88 分、总分不受影响（`VIRTUAL_BUILD_MARKERS` 已压 D），但真机没有这条 cap。✅ `TestEmulatorU2FiresOnAFreshOldImageAndThatIsExpected`；UI 文案要求见 §9.5 |
| 32 | 身份洗白漏洞（**已修**，`sigmark-score/3`） | 删一侧身份读数**不得**再洗掉 `hit`。修复前 100/A → 90/D → **100/A**；修复后 100/A → 90/D → **90/D**，隔离设备 88/B → 78/D → **78/D**。洗白后报告必须停在冲突态，`band` 仍 D。✅ `TestRedteamLaunderingFromAGenuinelyCleanBaseline`（且首句断言基线必须是 100/A）+ `TestRedteamLaunderingIsolateACompletelyCleanDevice`（§13 F15） |
| 33 | 测试数字的口径 | 本文每个测试数字旁边**必须写明口径**（顶层 vs 含子测试），且必须来自可复现命令 `go test -v -count=1 ./cmd/sigmark`：**数 `--- PASS:` / `--- SKIP:` / `--- FAIL:` 行，不数 `=== RUN`**（`=== RUN` 含子测试 `TestXxx/sub`，会多算）。当前口径 143 PASS + 3 SKIP = **146 个顶层测试**，`RUN` 行 216 个（§13 F16） |
| 34 | 不对称的四个跳过条件 | 逐条验，缺一条就会误伤：① 任一侧 `NOT_ARCHIVED` → 不算（旧字段集整行不存在）；② 任一侧非 `AVAILABLE`（`RESTRICTED`/`ERROR`/`UNAVAILABLE`）→ 不算；③ 两侧都空/都占位符 → 不算；④ 只有「两侧 AVAILABLE + 恰一侧为空」→ `hit`。✅ `device_profile_test.go` 的 `restricted side is not comparable`、`no identity rows`、`placeholder on both sides is still not comparable` 三个反例 + 全库 7 份字段集 16/20 报告零漂移（§4 R4、§13 F15） |
| 35 | 占位符语义 | **单侧占位符（`unknown`/`null`/`none`/`n/a`/`-`）必须判 `hit`**——只堵空白不堵占位符等于没堵；**两侧都是占位符仍判 `insufficient`**——那是设备真的报不出。✅ `one-sided placeholder is asymmetry evidence` + `placeholder on both sides is still not comparable` |
| 36 | 不对称的措辞与证据行 | 命中时证据行必须是 `identity_asymmetry`，值形如「N 对身份读数只有一侧可读（共 M 对在档）」；`detail` **不得**出现「被篡改」「伪造」等断言，只能写观察到的形态。✅ `identityAsymmetryDetail`（[score.go:1004](../backend/cmd/sigmark/score.go#L1004)）+ 决定性 cap 的 reason 复用同一句（§13 F15） |
| 37 | 对照实验的前置断言 | 任何「洗白 / 加固有效」的对照实验，**必须先在测试里断言对照组是干净的**（基线 band=A 且 value=100 且声明轴零扣分），再谈差异；不得靠实验者相信。第二次洗白实验就是因为基线带着 30 分 `ram_dispersion` 而作废（§13 F16 第四次） |
| 38 | 模拟器改写三键后仍能判 D | 雷神报告 `ce1bdc7f`（`cpu.hardware=qcom` / `system.product=RMX5010` / `system.device=unicorn`）必须 **`band=D` + `decisive=true` + 35 分 `STRUCTURAL_VIRTUAL_EVIDENCE`**；同时 `virtual_build_markers` 保持 `not_observed`（判 D 靠的是新通道，不是把黑名单改聪明）。✅ `TestRedteamEmulatorRewritesEveryVirtualBuildMarker`（先断言前提：三键确实躲过黑名单）+ `TestRedteamStructuralContradictionCatchesWhatTheBlocklistMisses`（§13 F17） |
| 39 | 结构性证据的两个防误伤 | ① `cpuInfo` 含 `implementer 0x` 必须返回 false（ARM 正品信号，否则所有真机都中）；② 空白或不认识的 `cpuInfo` 必须返回 false（**「我不认识」不是证据**，否则误伤每一颗未来的 ARM 芯片）。✅ `TestRedteamStructuralCheckDoesNotFireOnRealDevices` 的 7 个真机/空白反例 + `TestRedteamOneRewriteIsNotEnough`（§13 F17） |
| 40 | 结构性证据与黑名单互斥 | `markerHit == true` 时 `structuralVirtualDeduction` 必须返回 false——一因一果（R2），同一次「这是模拟器」不得收两次 35 分，也不得产生两条 `DECISIVE_VIRTUAL_BUILD` cap。✅ `structuralVirtualDeduction` 的首个分支（[score.go:1133](../backend/cmd/sigmark/score.go#L1133)）；扣分码 `STRUCTURAL_VIRTUAL_EVIDENCE` 走同一个 cap（[score.go:1069](../backend/cmd/sigmark/score.go#L1069)） |
| 41 | 未登记 SoC 必须点名被跳过的通道 | SoC 有声明但不在注册表时，四个通道（`cpu_core_set` / `gpu_family` / `cpu_capacity` / `cma_total`）必须各留一条 `unregistered_soc:<channel>`；**聚合 state 不得改变**（仍 `not_observed`——点名省略是审计改进，不是新判决）；**已登记 SoC 不得出现任何 `unregistered_soc:`**。✅ `score_redteam_unregistered_test.go` 的 `NamesTheChannelsItSkipped` + `KeepsTheAggregateState` + `RegisteredSocPublishesNoUnregisteredBasis`（§13 F18） |
| 42 | gap 标记不得进入 30 分计价 | `nonOverlayBasis` 必须排除 `unregistered_soc:` 前缀，**同时真实冲突（如 `ram_dispersion`）必须仍然被计价**——排除过宽会把真的矛盾也一起免掉。两个方向都要验。✅ `TestRedteamUnregisteredSocDoesNotPayTheChannelConflictPrice`（§13 F18） |
| 43 | 「没声明 SoC」≠「未登记 SoC」 | `known == false` 混了两种情况，只有「**有声明但注册表不认识**」才打 gap 标记；老报告没这个字段时不得打标记，否则把「这份报告没存」误报成「我们试过但失败了」。✅ `socDeclared`（[hardware_facts.go:112](../backend/cmd/sigmark/hardware_facts.go#L112)）与 `!known && socDeclared(read)` 的合取（[hardware_facts.go:190](../backend/cmd/sigmark/hardware_facts.go#L190)） |
| 44 | 采集字段必须三层同时登记 | 任何要进归档的采集字段，**三层缺一即视为未落地**：① Android 采集侧（`DeviceCollectors.kt` / `SecurityObservations.kt` 有该 key）；② 投影（`LanDetails.kt` 的 `system` 组集合）；③ Go 白名单（`protocol.go` 的 `parameterKeys`）。**「采了但没上传」和「没采」在归档层完全一样**，不逐层验就会把「投影漏配」误判成「规则漏读」。反例：`Build.FINGERPRINT` 有第 ① 层、缺 ②③ 层，195 个归档 key 里 `fingerprint` 零命中（§13.1 第 1b 项） |
| 45 | 结构性证据的成本标签必须诚实 | 描述两条通道时**不得**把 `generic_board_platform` 写成「构建产物 / 改它要动内核」——它是 `ro.board.platform` 属性（[DeviceCollectors.kt:129](../app/src/main/java/com/sigmark/app/collector/DeviceCollectors.kt#L129)），一条 `setprop` 即可清除。**文档与代码注释里的成本描述必须与「数据从哪来」一致**（属性 / `/proc` / 构建产物），并写明规则真实强度是**一条硬通道 + 一条软通道**。✅ `TestRedteamFakingPlatformAloneIsCheap`（一条改写清掉软通道、两条都改则归零）+ `TestRedteamCpuInfoSurvivesPlatformRewrite`（`boardPlatform` 取 `pineapple`/`gs101`/`sdm845`/`mt6985` 时任取，`cpuInfo` 独立成立）（§13 F17 成本更正、§13.1 第 7 项） |
| 46 | 决定性命中不得吞掉 `value` | `band` 已被决定性 cap 钉在 D 时，`value` **必须出版**（排序键，§13 F5）。抑制条件是 `declarationBlind && !out.Decisive`，**不是**裸的 `declarationBlind`。✅ `TestScoreDecisiveKeepsItsValueWhenTheDeclarationAxisIsBlind`（§4 R10、§13 F19-a） |
| 47 | R8 与 `weights == 0` 必须**仍然**吞掉 `value` | 第 46 项不得被读成「决定性命中总给数字」。总体 coverage < 地板时，**即使决定性**也 `value = null`——那里「没有数字」本身就是结论。✅ `TestScoreDecisiveStillWithholdsTheNumberUnderTheCoverageFloor`（反向断言，与第 46 项成对） |
| 48 | 文档必须可复算 | 把 `axes[]` 里有 `score` 的轴按权重加总、除以这些轴权重之和，**必须等于 `value`**。因此被 R7 排除的轴必须出版 `score = null`；`finalizeScoreAxis` 必须在所有 append 之后调用。✅ `recomputeValue`（[score_test.go:100](../backend/cmd/sigmark/score_test.go#L100)）在雷电与仿真器样本上双向断言（§5.6、§8.3.1、§13 F19-c） |
| 49 | 虚拟设备不重复计费 | `FRESH_BOOT_ON_AGED_ROM` 在虚拟化被独立通道确认时**不计分**，但 `decided` 仍 1、usage `coverage` 仍 1.00、`undetermined` 不变。**抑制定价，不抑制可判性。** ✅ `TestUsageFreshBootStillFiresOnRealHardware`（**真机必须照扣**，用与雷电完全相同的 usage 读数）+ 雷电样本断言 usage 轴 100（§10.2.1、§13 F19-b） |
| 50 | 测试样本必须包含攻击样本 | 任何「只在模拟器/异常数据上出现」的缺陷，真机黄金文件**永远抓不到**——它走不到那段代码。回归集必须含至少一份红队实测样本（雷电 / AVD），并且该样本的每个数字都要来自归档而不是构造。反例：`finalizeScoreAxis` 顺序错误在 Pixel 6 与 MI 8 上全绿（§8.3.1、§13 F19-c） |

---

## 15. 附：代码位置

| 内容 | 位置 |
| --- | --- |
| 10 个标签、三态、证据行、历史计数 | [device_profile.go:161](../backend/cmd/sigmark/device_profile.go#L161) |
| 标签顺序 / wire contract | [device_profile.go:276](../backend/cmd/sigmark/device_profile.go#L276) 起的 `eval` 顺序 |
| `profileVersion = sigmark-profile/9` | [device_profile.go:25](../backend/cmd/sigmark/device_profile.go#L25) |
| 历史可判分母 | [device_profile.go:322](../backend/cmd/sigmark/device_profile.go#L322) |
| 画像 SQL（30 天、同资产、最多 50 份） | [device_profile.go:353](../backend/cmd/sigmark/device_profile.go#L353) |
| 硬件画像登记表（仅 gs101 有 capacities/cma） | [hardware_facts.go:26](../backend/cmd/sigmark/hardware_facts.go#L26)（**只有 6 条**：`gs101` / `mt6985` / `sm8550` / `sm8450` / `sm8250` / `sdm845`，见 §13 未决第 2 条） |
| 硬件通道、overlay 通道、三态判定 | [hardware_facts.go:129](../backend/cmd/sigmark/hardware_facts.go#L129)（`hardwareFactsLabel` 函数头）、[:223](../backend/cmd/sigmark/hardware_facts.go#L223)（overlay 通道）、[:293](../backend/cmd/sigmark/hardware_facts.go#L293)（`not_observed`） |
| 判定分支 `basis` 的公布 | [hardware_facts.go:289](../backend/cmd/sigmark/hardware_facts.go#L289)（冲突）与 [:294](../backend/cmd/sigmark/hardware_facts.go#L294)（确认）；两者都 `append(…, unset...)`，见 §4 R4 的顺序约束 |
| **未登记 SoC 的四个 gap 标记** | [hardware_facts.go:190](../backend/cmd/sigmark/hardware_facts.go#L190)（`!known && socDeclared(read)` 才打标）、[:192](../backend/cmd/sigmark/hardware_facts.go#L192)（`unregistered_soc:<channel>`）；`socDeclared` 在 [:112](../backend/cmd/sigmark/hardware_facts.go#L112)；见 §13 F18 |
| **gap 标记的计价排除** | [score.go:749](../backend/cmd/sigmark/score.go#L749)（`nonOverlayBasis`）、[:760](../backend/cmd/sigmark/score.go#L760)（排除 `unregistered_soc:` 前缀）、[:836](../backend/cmd/sigmark/score.go#L836)（`conflictBasis` 消费点） |
| foreignProfile | [hardware_facts.go:322](../backend/cmd/sigmark/hardware_facts.go#L322) |
| **结构性虚拟证据（`/4` 新增）** | 新文件 `virtual_evidence.go`（176 行）：`genericBoardPlatforms` [:60](../backend/cmd/sigmark/virtual_evidence.go#L60)、`desktopCpuMarkers` [:99](../backend/cmd/sigmark/virtual_evidence.go#L99)、`boardPlatformIsGeneric` [:109](../backend/cmd/sigmark/virtual_evidence.go#L109)（空串早退在 [:111](../backend/cmd/sigmark/virtual_evidence.go#L111)）、`cpuInfoContradictsHandset` [:126](../backend/cmd/sigmark/virtual_evidence.go#L126)（`implementer 0x` 早退在 [:132](../backend/cmd/sigmark/virtual_evidence.go#L132)）、`structuralVirtualEvidence` [:146](../backend/cmd/sigmark/virtual_evidence.go#L146) |
| **`/5` 新增：虚拟化是否已被确认** | `virtualEvidenceConfirmed` [score.go:1103](../backend/cmd/sigmark/score.go#L1103)（黑名单标签 **或** 结构通道，任一为真）；它复用 `structuralVirtualRead` [score.go:1113](../backend/cmd/sigmark/score.go#L1113)——与扣分通道**共用同一个读数函数**，不另造第二个定义；消费点 [score.go:1287](../backend/cmd/sigmark/score.go#L1287)（`&& !virtualized`）。见 §10.2.1、§13 F19-b |
| **`/5` 新增：轴分必须在所有 append 之后定稿** | `finalizeScoreAxis` [score.go:706](../backend/cmd/sigmark/score.go#L706)；调用点 [score.go:958](../backend/cmd/sigmark/score.go#L958)（declaration）、[:1092](../backend/cmd/sigmark/score.go#L1092)（**behavior，已移到结构通道 append 之后**）、[:1315](../backend/cmd/sigmark/score.go#L1315)（usage）。见 §8.3.1、§13 F19-c |
| **`/5` 新增：雷电实测 fixture 与可复算断言** | `score_ldplayer_test.go`（462 行，全部数字取自归档报告 `6642e350`）：`TestScoreDecisiveKeepsItsValueWhenTheDeclarationAxisIsBlind` [:135](../backend/cmd/sigmark/score_ldplayer_test.go#L135)（`value == 71` 且 `recomputeValue` 一致）、`TestScoreDecisiveStillWithholdsTheNumberUnderTheCoverageFloor` [:173](../backend/cmd/sigmark/score_ldplayer_test.go#L173)（反向：R8 仍吞数字）、`TestUsageFreshBootStillFiresOnRealHardware` [:316](../backend/cmd/sigmark/score_ldplayer_test.go#L316)（真机照扣 12 分） |
| **结构性证据的计分与互斥** | `structuralVirtualPoints = 35` [score.go:179](../backend/cmd/sigmark/score.go#L179)；`structuralVirtualDeduction` [score.go:1133](../backend/cmd/sigmark/score.go#L1133)（`markerHit` 早退 = 与黑名单互斥）；挂 cap 的调用点 [score.go:1069](../backend/cmd/sigmark/score.go#L1069)；detail 拼装 [:1151](../backend/cmd/sigmark/score.go#L1151)；见 §13 F17 |
| **结构性证据的成本不对称（两条通道的真实强度）** | [score_redteam_emulator_test.go:159](../backend/cmd/sigmark/score_redteam_emulator_test.go#L159)（`TestRedteamFakingPlatformAloneIsCheap`：一条改写清掉软通道，两条都改则归零）、[:180](../backend/cmd/sigmark/score_redteam_emulator_test.go#L180)（`TestRedteamCpuInfoSurvivesPlatformRewrite`：`boardPlatform` 任取 `pineapple`/`gs101`/`sdm845`/`mt6985`，`cpuInfo` 独立成立）；见 §13 F17「成本更正」、§14 第 45 项 |
| **虚拟化平台实测台账（外部文档）** | [VIRTUALIZATION-MATRIX.md](VIRTUALIZATION-MATRIX.md)：雷神 LDPlayer 9 的属性改写能力（`ro.*` / `persist.*` / `/data` 能改，`/proc/cpuinfo` 不能）、`/proc` 不可写的原始输出、平台覆盖现状与复现步骤。本文只引用其结论，不重复其数据；见 §13.1 第 7–12 项 |
| 身份三对读数、适用对、比较 | [identity_consistency.go:7](../backend/cmd/sigmark/identity_consistency.go#L7)（`appIdentityPairs`）、[:37](../backend/cmd/sigmark/identity_consistency.go#L37)（`compareAppIdentity`） |
| **一侧身份不对称的判定** | [identity_consistency.go:70](../backend/cmd/sigmark/identity_consistency.go#L70)（`oneSidedIdentity`）；跳过条件在 [:75](../backend/cmd/sigmark/identity_consistency.go#L75)（`NOT_ARCHIVED`）与 [:84](../backend/cmd/sigmark/identity_consistency.go#L84)（非 `AVAILABLE`）；两侧都空在 [:89](../backend/cmd/sigmark/identity_consistency.go#L89) |
| **不对称证据行与文案** | [device_profile.go:259](../backend/cmd/sigmark/device_profile.go#L259)（消费点）、[:266](../backend/cmd/sigmark/device_profile.go#L266)（`identity_asymmetry` 行）；[score.go:1004](../backend/cmd/sigmark/score.go#L1004)（`identityAsymmetryDetail`）、[:892](../backend/cmd/sigmark/score.go#L892)（决定性命中时替换 `detail`） |
| 占位符归一 | [identity_consistency.go:22](../backend/cmd/sigmark/identity_consistency.go#L22)（`usableIdentity`：`unknown`/`null`/`none`/`n/a`/`-` → 空） |
| Android 端同名行（overlay / hardware / identity） | [DevicePosture.kt:103](../app/src/main/java/com/sigmark/app/security/DevicePosture.kt#L103)、[:123](../app/src/main/java/com/sigmark/app/security/DevicePosture.kt#L123)、[:85](../app/src/main/java/com/sigmark/app/security/DevicePosture.kt#L85) |
| `bootCount` 语义与重置 | [SecurityObservations.kt:50](../app/src/main/java/com/sigmark/app/collector/SecurityObservations.kt#L50) |
| `partitionBuildDates` / `initialSdk` | [SecurityObservations.kt:118](../app/src/main/java/com/sigmark/app/collector/SecurityObservations.kt#L118)、[:43](../app/src/main/java/com/sigmark/app/collector/SecurityObservations.kt#L43) |
| 字段集与值类型 | [protocol.go:87](../backend/cmd/sigmark/protocol.go#L87)、[field_dictionary.go:70](../backend/cmd/sigmark/field_dictionary.go#L70) |
| **采集字段的三层登记（§14 第 44 项）** | ① Android 采集：[DeviceCollectors.kt:108](../app/src/main/java/com/sigmark/app/collector/DeviceCollectors.kt#L108)（`Build.FINGERPRINT`，**已采**）；② 投影：[LanDetails.kt:14](../app/src/main/java/com/sigmark/app/lan/LanDetails.kt#L14)（`system` 组推送集，**缺 `fingerprint`**）、[:30](../app/src/main/java/com/sigmark/app/lan/LanDetails.kt#L30)（本地集，同样缺）；③ Go 白名单：[protocol.go:34](../backend/cmd/sigmark/protocol.go#L34)（`parameterKeys["system"]`，**缺 `fingerprint`**）。`partitionField` 正则只放行 `partition_*`（[protocol.go:109](../backend/cmd/sigmark/protocol.go#L109)），无旁路。见 §13.1 第 1b 项 |
| 报告顶层 `coverage`（字段覆盖） | [protocol.go:501](../backend/cmd/sigmark/protocol.go#L501) |
| 打分版本常量 `sigmark-score/5` | [score.go:67](../backend/cmd/sigmark/score.go#L67)（含 `/1` → `/2` → `/3` → `/4` → `/5` 的版本历史注释，L24–L66） |
| R10 两层形态 | [score.go:433](../backend/cmd/sigmark/score.go#L433)（`axisBlind` 循环）、[:464](../backend/cmd/sigmark/score.go#L464)（`declarationBlind` 循环）、[:470](../backend/cmd/sigmark/score.go#L470)（声明轴盲 → 不出版数字）、[:532](../backend/cmd/sigmark/score.go#L532)（窄形态：`bandA && axisBlind != ""` → B） |
| U2 与 R10 的测试 | `score_usage_u2_test.go`（9 个）、`score_emulator_u2_test.go`（2 个，仿真器边界与老镜像新实例） |
| 红队测试 | `score_redteam_decisive_test.go`（**决定性实验**：干净 100/A 基线，§13 F15 的主证据）、`score_redteam_clean_test.go`（隔离设备，基线带 30 分 `ram_dispersion`，故只到 88/B）、`score_redteam_test.go`（删 usage 证据、删身份一侧）、`score_redteam_overlay_test.go`（**被污染的作废实验，保留作方法论反面教材**） |
| `initialSdk` 年份表与解析 | [score.go:246](../backend/cmd/sigmark/score.go#L246)（`usageSdkYears`）、[:252](../backend/cmd/sigmark/score.go#L252)（`usageSdkYear`） |
| usage 轴判定（U1/U2 两条独立检查） | [score.go:1206](../backend/cmd/sigmark/score.go#L1206)（`usageAxis` 函数头）、[:1279](../backend/cmd/sigmark/score.go#L1279)（可判条件）、[:1288](../backend/cmd/sigmark/score.go#L1288)（`agedImage`）、[:1289](../backend/cmd/sigmark/score.go#L1289)（`agedDevice`）、[:1290](../backend/cmd/sigmark/score.go#L1290)（`switch` 一因一果） |
| 两个新 reason 的产生点 | [score.go:1260](../backend/cmd/sigmark/score.go#L1260)（`UNPARSEABLE_PARTITION_DATES`）、[:1270](../backend/cmd/sigmark/score.go#L1270)（`UNMAPPED_SDK_LEVEL`） |
| 「3 年」窗口与无采样时间时的回落 | [score.go:1327](../backend/cmd/sigmark/score.go#L1327)（`usageAgedRomCutoff`）、[:219](../backend/cmd/sigmark/score.go#L219)（`usageAgedRomFallbackYear = 2021`） |
| 画像读取契约 | [LAN-PILOT.md:117](LAN-PILOT.md) |
| 现有 10 标签的界面文案 | [device-profile.tsx:12](../backend/web/src/device-profile.tsx#L12) |
| 不保存派生评分的既有约定 | [ARCHITECTURE.md:52](ARCHITECTURE.md) |
| 锚点与降级事实 | [HANDOFF.md:88](HANDOFF.md)、[HANDOFF.md:96](HANDOFF.md)、[DEVICE-VALIDATION.md:86](DEVICE-VALIDATION.md)、[DEVICE-VALIDATION.md:94](DEVICE-VALIDATION.md) |
