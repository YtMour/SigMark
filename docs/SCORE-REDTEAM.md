# 设备安全打分的对抗性威胁模型（红队第三轮）

> **本文立场**：我是这套打分的攻击者，不是设计者。目标是在**知道全部规则**的前提下，用一台已被 root、可改 ROM 的改装机拿到 `band = A`，并找出会让老实设备被打成 B 的误报路径。
>
> **方法**：本文分两层，**不要混读**。
>
> - **§1–§9：代码审查 + 手算**。没有设备、没有跑 adb。凡是没有实测支撑的结论，一律标 **【未实机验证】**。
> - **§10：已实测**。由 lead 跑的五个 Go 测试产生（[score_redteam_test.go](../backend/cmd/sigmark/score_redteam_test.go)、[score_redteam_clean_test.go](../backend/cmd/sigmark/score_redteam_clean_test.go)、[score_redteam_overlay_test.go](../backend/cmd/sigmark/score_redteam_overlay_test.go)、[score_redteam_decisive_test.go](../backend/cmd/sigmark/score_redteam_decisive_test.go)、[score_redteam_emulator_test.go](../backend/cmd/sigmark/score_redteam_emulator_test.go)），**单变量对照**；我已全部自行复跑，输出与 §10 记录一致。口径要说清：其中四组是「**合成证据上的真机数据**」——用真机采集到的字段值拼成 fixture 喂给 `buildDeviceScore`，**不是重新上机采集**。§10 的结论标 **【已实测】**；§1–§9 中凡被实测修正过的判断，都在原处标了「实测修正」。
> - **唯一的例外（重要）**：**§5.3 / §10.9 是真实设备实测**——一台真的 LDPlayer 9 模拟器，真的装了 App、真的采集、真的上传，有报告号。它不是合成 fixture，**这是本文第一次有「端到端真机」证据**。
>
> **审计对象（行号已按本轮修改后的工作树逐行核对）**：[score.go](../backend/cmd/sigmark/score.go)（1244 行，`sigmark-score/4`，含 R10 两层形态、单侧身份证据、结构虚拟化证据）、[virtual_evidence.go](../backend/cmd/sigmark/virtual_evidence.go)（133 行，本轮新增，含成本纠正注释）、[score_redteam_emulator_test.go](../backend/cmd/sigmark/score_redteam_emulator_test.go)（189 行，本轮新增，六个 Test）、[score_redteam_cost_test.go](../backend/cmd/sigmark/score_redteam_cost_test.go)（150 行，发现 5 的成本清单，四个 Test）、[score_redteam_test.go](../backend/cmd/sigmark/score_redteam_test.go)（198 行）、[score_redteam_clean_test.go](../backend/cmd/sigmark/score_redteam_clean_test.go)（88 行）、[score_redteam_overlay_test.go](../backend/cmd/sigmark/score_redteam_overlay_test.go)（62 行）、[score_redteam_decisive_test.go](../backend/cmd/sigmark/score_redteam_decisive_test.go)（102 行）、[hardware_facts.go](../backend/cmd/sigmark/hardware_facts.go)（305 行）、[device_profile.go](../backend/cmd/sigmark/device_profile.go)（409 行，`sigmark-profile/9`）、[identity_consistency.go](../backend/cmd/sigmark/identity_consistency.go)（97 行）、[SECURITY-SCORE.md](SECURITY-SCORE.md)（契约，本轮仍在同步）、[EMULATOR-LAB.md](EMULATOR-LAB.md) §7.3（五个变体实测）。
>
> **一句话结论**：这套体系**算得对**，但它把「**删掉证据**」和「**证据干净**」算成了同一个分数，而删证据只需要改一个属性。攻击者拿 A 不需要骗过检测，只需要让检测**没有东西可读**。**`/9` + `/4` 之后，最便宜的三条路线已经被堵住**（§5.1、§5.2、§5.3），但「让通道整个消失」这条（§3.4.2、§5.5）还开着。
>
> **本轮进展**：13 条发现里，**3 条已修复**（发现 3：usage 轴删证据升档 → R10 两层；发现 2：单侧身份洗白 → `identity_asymmetry`；发现 13：三行属性绕过 35 分决定性规则 → 结构虚拟化证据）、**1 条已撤回**（U2 不可伪造）、**1 条文档状态已修复**（版本漂移）。其余 9 条仍成立，其中**未登记 SoC 现在是第一优先级**，**`ro.boot.qemu` 未采集是第二**。
>
> **方法论教训（本轮真的踩了，而且踩了五次）**：两次「单变量实验」都被样本自带的其它问题污染（§10.7 实验一的 `FOREIGN_PROFILE`、实验二的 `ram_dispersion`），第二次差点让我把结论写反。判据见 §8.1：**基线必须先独立验证，且改动后必须能精确回到基线**；以及**自洽≠干净**——三个数字能自圆其说，不等于测量对象是干净的。第三条见 §8.1.2：**成本看数据来源，不看判据问什么**——`boardPlatform` 换了个问题，但数据还是属性，一条 `setprop` 就清掉；原句「挑对手改起来贵的通道」不够，要加「数据从哪来」。第四条见 §8.1.3：**「采了没上传」和「压根没采」在归档层看起来完全一样**——不能把采集链路的断点算成规则漏读。第五条见 §8.1.4：**改一处不等于改完**——`boardPlatform` 那句错话在 `virtual_evidence.go` 和 `score.go` 各活了一份，改了一处另一处没动，**同一个错误会在多个文件里存活**。

---

## 0. 结论摘要

| # | 问题 | 严重度 | 状态 | 一句话 |
| --- | --- | --- | --- | --- |
| 1 | 未登记 SoC 让声明轴 5 条通道静默跳过，标签仍报 `not_observed` | **严重** | **未修**（**第一优先级**） | 声明一颗表外 SoC 比声明一颗表内 SoC **安全得多**，这是反向激励 |
| 2 | `hit` 可以通过「删一侧读数」洗成 `insufficient`：**证据被完全擦除，精确回到「从未冲突」的基线** | **严重** | **已修复**（`/9` 单侧身份证据） | 修复前实测：干净基线 `100/A` → 冲突 `90/D` → 洗白 **`100/A`**（逐字复现我的预测）。修复后洗白停在 **`90/D`**：单侧可读本身就是证据（§5.2） |
| 3 | usage 轴可被删出加权：`97/B` → `100/A` | **严重** | **已修复**（R10 推广为两层） | 删两个属性就比「被查到」得分更高；修复后删证据 = `100/B`，不再升档 |
| 4 | `virtual_build_markers`（唯一的行为决定性 cap）可被**清空**它的三个输入解除 | **严重** | **未修**（**同一根因的另一形态，见 #13**） | 空 `ro.product.name` → 标签转 `insufficient` → 无 cap、无 35 分 |
| 5 | U2 自称「不可伪造」，但来源是普通 `ro.*` 属性，且打分链路不交叉校验 | 中（原判「严重」，**已下调**） | **已撤回该说法**，代码注释已改正 | `resetprop ro.product.first_api_level` 一句话抹掉 U2；U2 的真实价值只是「伪造成本 +1 步」，不是不可伪造 |
| 6 | 「已 root + 已 hook + permissive + 被 ptrace」= **75/B** | **严重** | **未修** | 四项行为证据全中，仍然只是「有疑点」；行为轴永远到不了 D |
| 7 | `FRESH_BOOT_ON_AGED_ROM` 把「恢复出厂」当「伪造」，U2 让误报面再扩大一层 | **严重** | **未修** | 任何出厂三年以上、刷了新 ROM、重置一次的老机 = B |
| 8 | 契约文档仍声明 `sigmark-score/1`，代码已是 `/4`（`profileVersion /9`） | 中 | **已修复**（前端已升，文档正在同步） | 版本漂移：`docs/SECURITY-SCORE.md` 仍在同步，本条保留作追踪 |
| 9 | 决定性 cap 缺三条：`HOOK_INJECTION`、root+hook+permissive 组合、RAM 三通道分裂 | 中 | **未修** | 最像「正在被分析」的设备拿不到 D |
| 10 | `band = A` 在数值上退化成「恰好 100」一个点 | 中 | **未修**（文档表述问题） | 契约写 85–100，实现里 85–99 永远进 B，表格是死的 |
| 11 | `undetermined` 把「读到了但不一致」报成 `UNAVAILABLE` | 低 | **未修** | 审计线索自相矛盾 |
| 12 | `detail` 在「满 3 年」上按年份整数算，最多虚报约 1 年 | 低 | **未修** | 账本里的一句人话是错的 |
| 13 | **35 分决定性规则被三行属性改写绕过**：把三个名字填成合法真机值，规则就问不出「像不像模拟器」 | **严重**（本文最重） | **已修复**（`/4` 结构虚拟化证据）——**但强度只有一条硬通道** | **真实 LDPlayer 9 实测**（报告 `ce1bdc7f…`）：`band = ?`、`virtual_build_markers = not_observed`。修复后 `D` + `DECISIVE_VIRTUAL_BUILD`（§5.3、§10.9）。**注意**：新增两条通道里只有 `cpuInfo`（`/proc`）是真门槛，`boardPlatform` 是一条 `setprop` 就能清的属性（§5.3.4 实测） |
| 14 | **攻击成本可数**：从 `D` 到「不 decisive」= **2 个字段**（1 免费 + 1 贵）；**但 2 个字段 ≠ A** | 中（**不是漏洞，是账本**） | **已量化**（§5.4，四个测试锁住） | 雷神：`boardPlatform`（1 条 `setprop`）+ `cpu.cpuInfo`（改 guest kernel 视角）。declaration 轴另有三条「声明 vs 实测」要比对，**A 的账单更长**（§5.4、§6） |

**编号是稳定 ID**（正文与 §10 用「发现 2」「发现 3」指代），**优先级与编号无关**。

**关于「发现 4」这个叫法**：#4 早被占用（`virtual_build_markers` 被**清空**输入解除），而 lead 消息里说的「发现 4」是**同一根因的另一形态**（把输入**填成合法值**）。按稳定 ID 纪律，新发现记为 **#13**，并在 §5.3 与 #4 交叉引用——**两者共享同一个根因：这个标签的三个输入全部由被审查者提供。**

**关于「发现 5」这个叫法**：lead 说的「发现 5」在这里记为 **#14**（#5 早被占用，是 U2 的「不可伪造」误述）。**它和 #13 是同一件事的两面**：#13 说「**能绕**」，#14 说「**绕要花几个字段**」。**一个定性，一个定量**，所以分成两条而不是合并。

**当前优先级**：**第一是 #1（未登记 SoC）**——它是唯一还能「一步到 A」的未决项（§3.4.2、§7 第一件）；**第二是「三条现成证据进不了报告」**（§7 第二件）——`ro.boot.qemu` 压根没采、`Build.FINGERPRINT` 采了没上传；**第三是 §7 第三件**（`FRESH_BOOT` 误报面）；**第四是 §7 第四件**（单观察者通道）。

---

## 1. 攻击者模型

| 维度 | 假设 |
| --- | --- |
| 能力 | root；可改 `ro.*` 只读属性（改 `build.prop` / 重打包 ROM / `resetprop`）；可控制挂载命名空间（Magisk DenyList / Zygisk）；可改内核侧节点的返回值（自编译内核）；可写 `Settings.Global` |
| 知识 | 完整读过本仓库的规则、权重、分支表；知道每个数字来自哪个读数 |
| 目标 | `band = A`（不是「value 高」——R11 让任何扣分都掉 B，所以目标等价于**零扣分**） |
| 约束 | 不能改 SigMark APK（签名校验在下载侧，见 [LAN-PILOT.md](LAN-PILOT.md)）；不能改后台；不能阻止 App 采集，只能改变采集**读到的内容** |
| 不在模型内 | 供应链攻击、签名替换、后台数据库直改、社工管理员 |

**关键推论**：因为 R11（[SECURITY-SCORE.md §4](SECURITY-SCORE.md)，实现 [score.go:477](../backend/cmd/sigmark/score.go#L477)）规定「任意一条扣分 → 掉 B」，攻击者的目标函数不是「少扣分」而是「**一条扣分都不出现**」。这把问题从「骗过阈值」变成了「**让每条规则都无话可说**」，而后者便宜得多——不需要伪造一个正确的值，只需要让值为空。

---

## 2. 可攻击面总览：每个数字来自哪一次读

先把「分数 ← 标签 ← 读数」这条链摊开，攻击点自然浮现。

| 分支 | 标称分 | 依赖的读数 | 读数由谁产生 | 攻击者能否直接控制 |
| --- | --- | --- | --- | --- |
| `VIRTUAL_BUILD_MARKERS` | 35（**决定性**） | `cpu.hardware`、`system.product`、`system.device` | 属性 | **完全** |
| `HOOK_INJECTION` | 25 | `environment.hookSignals`、`environment.rootMountHints` | `/proc/self/maps`、`/proc/self/mountinfo`（本进程命名空间） | **完全**（命名空间） |
| `DEBUGGER_ATTACHED` | 20 | `app.debuggerConnected`、`environment.tracerPid` | `Debug.isDebuggerConnected()`、`/proc/self/status` | 间接（选注入方式） |
| `SELINUX_PERMISSIVE` | 15 | `system.selinux` + `system.selinuxEvidence` | `/sys/fs/selinux/enforce` | **完全**（内核/节点内容） |
| `ROOT_MANAGER_VISIBLE` | 12 | `environment.rootManagerVisible` | `queryIntentActivities(MAIN/LAUNCHER)` | **完全**（改包名/去 LAUNCHER） |
| `MULTI_OPEN` | 8 | `environment.userProfile` | `Process.myUid()/100000` | 完全（换个用户跑） |
| `IDENTITY_APP_UID` | 25（**决定性**） | 三对同义读数 | `Build.*` vs `ro.product.*` | **完全** |
| `IDENTITY_SKU` | 15 | SKU 对 | `Build.SKU` vs `ro.boot.hardware.sku` | 完全 |
| `FOREIGN_PROFILE` | 30（**决定性**） | `cpu.cpuCapacity`、`memory.cmaTotal` + 声明 SoC | 内核 sysfs / `/proc/meminfo` + 属性 | **部分**：能改声明侧，改不了内核侧——但能让声明侧「查无此表」 |
| `HARDWARE_CHANNEL_CONFLICT` | 30 | RAM×3、`cpu.cpuParts`、`runtime.glesRenderer`、overlay | `/proc`、EGL、构建产物 | **部分**：CPU/GPU 通道依赖 SoC 已登记 |
| `OVERLAY_CODENAME_MISMATCH` | 15 | `system.device` vs `environment.overlayDeviceCodename` | 属性 vs `/proc/self/maps` | 部分（可让 overlay 侧读不到） |
| `FRESH_BOOT_ON_AGED_ROM` | 12 | `system.bootCount`、`system.partitionBuildDates`、`system.initialSdk` | `Settings.Global`、`ro.*.build.date.utc`、`ro.product.first_api_level` | **完全** |

**读这张表的正确方式**：12 条分支里，**7 条完全由属性/命名空间决定**（可无成本改写），4 条部分可控，只有 1 条（`FOREIGN_PROFILE`）真正锚在攻击者不好改的内核读数上——而它要求「声明的是**已登记** SoC」。

这就是整套体系的真实强度边界：**唯一难伪造的通道，只在一个很小的条件下才启用。**

---

## 3. 绕过路径

### 3.1 逐分支：能省多少、兜底是什么

「能省」按**轴内标称分**计；「总分变化」按 `value = (40·decl + 35·beh + 25·usage)/100`、另外两轴满分计。**所有数值为手算，未实机验证**（公式见 [score.go:687](../backend/cmd/sigmark/score.go#L687) 的 `applied = min(Σ,100)`、`score = 100 − applied`，与 [score.go:387](../backend/cmd/sigmark/score.go#L387) 的加权循环）。

| 手法 | 目标分支 | 能省 | 总分变化 | 兜底是什么 | 成本 |
| --- | --- | --- | --- | --- | --- |
| `setprop ro.product.name <空>` | `VIRTUAL_BUILD_MARKERS` | 35 + **决定性 cap** | 见 §3.4.1 | **无**。`eval` 要求三个 key 全是否定才 `not_observed`（[device_profile.go:191](../backend/cmd/sigmark/device_profile.go#L191)），缺一个就 `insufficient` → 不命中、无 cap | 极低 |
| 把 `cpu.hardware`/`system.device` 改成非标记值 | `VIRTUAL_BUILD_MARKERS` | 35 + cap | 若声明 SoC 已登记 → 触发 `HARDWARE_CHANNEL_CONFLICT` 30（非决定性，88/B） | 部分兜底（30 分，非决定性） | 低 |
| 重命名 Frida gadget 的 `.so`、改 memfd 名 | `HOOK_INJECTION` | 25 | 91/B → 100/A | **无**。检测是路径**子串匹配**（[SecurityProbes.kt:56](../app/src/main/java/com/sigmark/app/collector/SecurityProbes.kt#L56)），改文件名即失效 | 低 |
| Magisk DenyList 勾上 SigMark | `HOOK_INJECTION` + `ROOT_MANAGER_VISIBLE` | 37 | 87/B → 100/A | **无**。DenyList 在目标进程命名空间卸载 magisk 挂载，`mountinfo` 里没有 `.magisk`（[:79](../app/src/main/java/com/sigmark/app/collector/SecurityProbes.kt#L79)） | 极低（一次勾选） |
| 去掉 root 管理器的 LAUNCHER intent-filter / 改包名 | `ROOT_MANAGER_VISIBLE` | 12 | 96/B → 100/A | **无**。固定包名 + 只查 `MAIN/LAUNCHER`（[SecurityProbes.kt:96](../app/src/main/java/com/sigmark/app/collector/SecurityProbes.kt#L96)）。EMULATOR-LAB §7.3 第 7 条已把这条记成「静默假阴性」【已实测】 | 低 |
| 用 Zygisk/Frida gadget 注入，不用 ptrace | `DEBUGGER_ATTACHED` | 20 | 93/B → 100/A | **无**。`TracerPid` 只在 ptrace **附着期间**非零，注入完成后归零 | 低 |
| `setenforce 1` | `SELINUX_PERMISSIVE` | 15 | 95/B → 100/A | **无** | 极低 |
| 让 enforce 节点返回非 `0/1` | `SELINUX_PERMISSIVE` | 15 | 95/B → 100/A | **无**。非标准内容 → `INVALID_VALUE` → `UNAVAILABLE` → `insufficient`（[SelinuxProbe.kt:100](../app/src/main/java/com/sigmark/app/collector/SelinuxProbe.kt#L100)） | 低（需内核） |
| 在 owner 用户跑 | `MULTI_OPEN` | 8 | 97/B → 100/A | **无** | 零 |
| `settings put global boot_count 999` | `FRESH_BOOT_ON_AGED_ROM` | 12 | 97/B → 100/A | **无**（`Settings.Global` 可写，[SecurityObservations.kt:52](../app/src/main/java/com/sigmark/app/collector/SecurityObservations.kt#L52)） | 极低 |
| 空白 `ro.<part>.build.date.utc` **且** `ro.product.first_api_level` | `FRESH_BOOT_ON_AGED_ROM` + **整条 usage 轴** | 12 + 轴退出 | ~~97/B → 100/A~~ → **已修复：100/B** | **已关闭**（R10 推广为两层，见 §5.1、§10.2） | 低 |
| `resetprop ro.product.first_api_level 35` | U2（`initialSdk` 分支） | 12 | 97/B → 100/A | **无**（详见 §3.6） | 极低 |
| 空白 `environment.overlayDeviceCodename` 的来源（RRO 命名） | `OVERLAY_CODENAME_MISMATCH` + hardware overlay 通道 | 15 | 94/B → 100/A | 声明轴 coverage 降到 0.67，仍 ≥ 0.5，**仍计分** | 低 |
| 空白一侧的 `ro.product.model` / `ro.product.device` | `IDENTITY_APP_UID` | 25 + **决定性 cap** | **90/D → `?`/null**（实测，**不是** A） | **R10 的 declaration 严格形态已兜住一半**（详见 §5.2、§10.3） | 极低 |
| 把四个 SoC 声明键全改成表外值 | `FOREIGN_PROFILE`、`cpu_core_set`、`gpu_family`、`cpu_capacity`、`cma_total` | 30 + cap（5 条通道一起消失） | 见 §3.4.2 | **只有 `ram_dispersion` 一条**，且它确认 → `not_observed` | 中（要改 4 个属性） |

**表的读法**：除了最后两行，其余全部是「**一条属性/一次勾选换一条分支**」，且没有一条有兜底。这就是为什么本文的标题是「删证据比伪造便宜」。

### 3.2 为什么 `hook_injection` 是纸糊的

[SecurityProbes.kt:41](../app/src/main/java/com/sigmark/app/collector/SecurityProbes.kt#L41) 的 `hookSignals` 做的是：读 `/proc/self/maps`，对每行的路径段做 `path.contains(code)`，`code ∈ {frida, gadget, xposed, substrate, riru, zygisk, lspatch}`，外加一条 `memfd_exec`（未识别的可执行 memfd）。

三个可攻击点：

1. **子串匹配**。把 `libfrida-gadget.so` 改名成 `libutils.so`，`contains("frida")` 与 `contains("gadget")` 同时失效。Xposed 的 `de.robv.android.xposed` 路径同理。这不是「绕过检测」，这是**改一个文件名**。
2. **命名空间**。`rootMountHints` 读 `/proc/self/mountinfo`（[:88](../app/src/main/java/com/sigmark/app/collector/SecurityProbes.kt#L88)），读到的是**本进程**的挂载表。Magisk DenyList 会在目标进程的命名空间里卸载 magisk 的 tmpfs/overlay，于是 `.magisk` 不出现。EMULATOR-LAB §7.3 第 2 条【已实测】用 `mount -t tmpfs` 验证了「能被看见」，但没有验证「被 DenyList 隐藏后看不见」——**这正是需要补的一条实测**。
3. **`memfd_exec` 只排除已知运行时名字**（`jit|dalvik|vdex|oat|gralloc|hwui|ion|adf`，[:39](../app/src/main/java/com/sigmark/app/collector/SecurityProbes.kt#L39)）。攻击者把注入的 memfd 命名成 `jit-cache-2` 即可通过白名单。

**兜底**：无。`hook_injection` 是行为轴第二重的分支（25），它唯一的防线是「攻击者不重命名」。

### 3.3 为什么 `debugger_attached` 抓不到真正的注入

它依赖 `TracerPid`（[SecurityProbes.kt:91](../app/src/main/java/com/sigmark/app/collector/SecurityProbes.kt#L91)）。`TracerPid` 的语义是「**当前**有谁在 ptrace 我」。

- 持续驻留的注入（Zygisk 模块、Frida gadget 随进程启动加载）**不经过 ptrace**，`TracerPid = 0`；
- 一次性注入（`frida-server` 默认模式）在注入完成后 detach，之后 `TracerPid = 0`；
- 只有**采样窗口内正在被 ptrace**（`strace -f -p`、lldb 附加）才会非零。

EMULATOR-LAB §7.3 第 8 条【已实测】的阳性样本用的正是 `strace -f -p`——也就是**最容易被看见的那一种**。这条分支的实际命中率约等于「采样时恰好有人在盯着」，对一个要长期潜伏的改装机是零成本绕过。

**判断**：20 分定价的是「联调现场」，不是「设备被控制」。定价没错，但把它算进行为风险轴会让「正在被分析的设备」和「被植入后门的设备」得到同一个分数——前者 20 分，后者 0 分，方向反了。

### 3.4 三条「一条属性换一个 A」的最小攻击

以下三条是本轮最值钱的发现，各自只需要**一次属性写入**，且都有明确的前后数字。**§3.4.1 / §3.4.2 仍全部【未实机验证】**；**§3.4.3 已被实测证实并已修复**（§10.2），保留在此是为了记录攻击形状与修复边界。每一步都能在代码里逐行对上。

#### 3.4.1 空白 `ro.product.name` 解除唯一的决定性行为 cap

`virtual_build_markers` 的判定是 `eval("virtual_build_markers", []string{"cpu.hardware", "system.product", "system.device"}, …)`（[device_profile.go:252](../backend/cmd/sigmark/device_profile.go#L252)）。`eval` 的收尾是：

```
if out.State != "hit" && negative == len(keys) { out.State = "not_observed" }
```
（[device_profile.go:191](../backend/cmd/sigmark/device_profile.go#L191)）

也就是说：**三个 key 必须全部读到并全部给出否定**，才是 `not_observed`；少一个就是 `insufficient`。而 `insufficient` 在打分层**不扣分、不产生 cap**（[score.go:1008](../backend/cmd/sigmark/score.go#L1008) 的 `behaviorAxis` 只在 `case "hit"` 里建扣分与 cap）。

于是：

| 状态 | 标签 | behavior 扣分 | cap | band |
| --- | --- | --- | --- | --- |
| 原样模拟器 | `hit` | 35 | `DECISIVE_VIRTUAL_BUILD` | **D**（value 88）【已实测，EMULATOR-LAB §7.2】 |
| 空白 `ro.product.name` | `insufficient` | 0 | 无 | 见下 |

模拟器 baseline 的 behavior 扣分只有 35（其余五项 `not_observed`），空白后 behavior 轴 **100 分、coverage 5/6 = 0.83**（仍 ≥ 0.5，仍计入），声明轴在 baseline 上本来就是 `null/0.33` → **触发 R10（声明轴盲）→ `band = "?"`**。

**所以这一步单独做还不够，它只是把 D 降成 `?`**。但 `?` 不是 A 也不是 D——对一个只需要「不被判 D」的攻击者，这一步就已经完成目标。要拿到 A，还需要 §3.4.2。

> 注意一个反直觉的地方：**R10 只保护声明轴，不保护行为轴**。行为轴「全盲」没有任何等价闸门（§5.1 会证明它和「全绿」同分）。

#### 3.4.2 声明一颗表外 SoC，让 5 条通道一起消失

`hardwareFactsLabel` 的六条通道里，有四条带 `known &&` 前置条件：

| 通道 | 行号 | 前置 |
| --- | --- | --- |
| `ram_dispersion` | [hardware_facts.go:154](../backend/cmd/sigmark/hardware_facts.go#L154) | 无（只要有 2 个 RAM 读数） |
| `cpu_core_set` | [:166](../backend/cmd/sigmark/hardware_facts.go#L166) | `known && len(parts) > 0` |
| `gpu_family` | [:177](../backend/cmd/sigmark/hardware_facts.go#L177) | `known && renderer != ""` |
| `overlay_codename` | [:191](../backend/cmd/sigmark/hardware_facts.go#L191) | 两侧都可读 |
| `cpu_capacity` / `cma_total` | [:210](../backend/cmd/sigmark/hardware_facts.go#L210) | `known`（且登记值非空） |

`known` 来自 `declaredSoc`（[:92](../backend/cmd/sigmark/hardware_facts.go#L92)），它按顺序试 `system.socModel → system.boardPlatform → cpu.hardware → system.board`，**只认表内值**（`socProfiles` 5 颗 + 别名）。四个键全部指向表外值时，`known = false`，于是：

- `cpu_core_set`、`gpu_family`、`cpu_capacity`、`cma_total` **四条通道根本不进入判定**；
- 只剩 `ram_dispersion`。三个 RAM 读数天然一致 → `confirmed` → 标签 `not_observed`（[:263](../backend/cmd/sigmark/hardware_facts.go#L263)）；
- `profileUnsetKeys` 也**不产出** `PROFILE_UNSET`（[score.go:640](../backend/cmd/sigmark/score.go#L640) 只扫 `profile_unset:` 前缀，而该前缀只在 `known` 为真且登记值为空时写入）；
- `undetermined` 里**一个字都不会出现**。

结果：一台**实际是 gs101、声明成 `sm7325`（表外）**的 Pixel 6，`hardware_declaration_conflict = not_observed`，声明轴 100 分，行为轴靠 §3.4.1 洗成 100 分，usage 靠 `boot_count` 洗成 100 分：

```
value = 100, band = A, coverage ≈ 0.89
```

**这条是本文最严重的发现**，因为：

1. 它把「**我不知道这颗 SoC 应该是什么**」编码成了「**这颗 SoC 没有问题**」。这正是 [SECURITY-SCORE.md §7.1](SECURITY-SCORE.md) 用 R10/R11 反复要消灭的那个错误（「没采到 ≠ 安全」），只是换了一层：不是标签 `insufficient`，而是**通道被静默跳过、标签仍然 `not_observed`**。
2. `PROFILE_UNSET` 修的是「SoC 已登记但期望值留空」（§13 F12），**没有修「SoC 未登记」**。后者比前者更常见——世界上绝大多数机型不在那 5 颗里。
3. 它是**反向激励**：老实声明 `mt6985` 的改装机被 `FOREIGN_PROFILE` 判 D（§9.1.1 实测 82/D），而声明 `sm7325` 的同一台机器拿 A。攻击者学一次就会了。
4. 它和 §13 F7 记录的单向性叠加：`foreignProfile` 只在「声明是表内、实测像另一颗表内」时成立，声明表外时连比对都不做。

#### 3.4.3 空白 `ro.system.build.date.utc` 把 usage 轴删出加权（**已修复**）

见 §5.1——这一条同时是「绕过」和「逻辑漏洞」，因为它的收益来自覆盖率闸门，不是来自某条规则。

**状态**：已在真实 MI 8 证据上实测证实（`97/B` → `100/A`），并由 R10 两层修复关闭（修复后 `100/B`，§10.2）。**这是本文唯一一条「攻击成立 + 已关闭」的完整闭环**，它同时说明了修复的正确形态：不出版数字会把真阳性藏掉，锁 band 才是对的。

### 3.5 完整 A 路线（编排）

把上面几条拼起来，一台已 root 的 Pixel 6 拿 A 的最省力路径（**未实机验证**，每一步都有代码依据）：

| 步 | 动作 | 关掉的东西 | 代价 |
| --- | --- | --- | --- |
| 1 | 四个 SoC 声明键改成表外值（如 `sm7325` / `kalama`） | `FOREIGN_PROFILE`、`cpu_core_set`、`gpu_family`、`cpu_capacity`、`cma_total` | 硬件标签降级为「只有 RAM 通道」，仍报 `not_observed` |
| 2 | `ro.product.name` 置空 | `VIRTUAL_BUILD_MARKERS`（→`insufficient`） | 无 |
| 3 | 让 overlay 代号与 `system.device` 一致（或让 RRO 命名不可识别） | `OVERLAY_CODENAME_MISMATCH` | 声明轴 coverage 0.67，仍计分 |
| 4 | model/device/SKU 三对**两侧一起**改写 | `IDENTITY_APP_UID` / `IDENTITY_SKU` | 无（Pixel 6 已经是这样） |
| 5 | Magisk DenyList 勾上 SigMark | `HOOK_INJECTION` + `ROOT_MANAGER_VISIBLE` | 一次勾选 |
| 6 | `setenforce 1` | `SELINUX_PERMISSIVE` | 无 |
| 7 | 在 owner 用户跑 | `MULTI_OPEN` | 无 |
| 8 | `settings put global boot_count 999` | `FRESH_BOOT_ON_AGED_ROM`（U1/U2 都要求 `bootCount ≤ 2`，[score.go:1192](../backend/cmd/sigmark/score.go#L1192)、阈值常量 [score.go:205](../backend/cmd/sigmark/score.go#L205)） | 无 |

八步之后，12 条分支**一条都不命中**，`value = 100`、`band = A`、`coverage ≈ 0.89`（充分可判）。整条路线的技术难度**低于写一个 Xposed 模块**，其中第 5、6、7、8 步是 Magisk 与设置里的现成开关。

> **修复后的变化（实测）**：R10 推广为两层之后，「**删掉** usage 的输入」不再能拿 A（实测 `100/B`，§10.2）。所以这条路线**必须**走第 8 步——把 `bootCount` 改成一个大的合法值，让 usage 轴**可判且干净**（coverage 1.0、零扣分），而不是把属性删空。代价从「删一个属性」上升到「写一个可信的假值」，方向是对的：**删证据变贵了，伪造仍然便宜**。这条路线整体仍然成立。

**这不是「检测被绕过」，这是「检测被清空」。** 系统没有一次被欺骗——它每次读到的都是真的：属性真的叫 `sm7325`，maps 里真的没有 frida，SELinux 真的在 enforcing。**分数是对的，结论是错的**，因为「读到的世界」被换成了一个自洽的假世界。

### 3.6 U2 的「不可伪造」不成立（已撤回该说法）

`/2` 新增（当前版本 `/4`，U2 的计分逻辑未变）的 U2（[score.go:207](../backend/cmd/sigmark/score.go#L207) 起）用 `system.initialSdk` 判断设备世代。**原始代码注释**给出的理由是：

> `partitionBuildDates` describes the *image* … `initialSdk` describes the *device* — it is written at manufacture into a read-only system property … U1 is spoofable by flashing; **U2 is not spoofable without lying about the hardware itself, which is the exact thing the declaration axis already prices.**

这两句话都**不成立**，而 lead 在核对了本轮意见后**已把注释改正**（[score.go:218](../backend/cmd/sigmark/score.go#L218) 起现在明确写「Do not overstate this … That was wrong on both counts, and a red-team review caught it」）。下面记录原始判断与改正后的定位，因为「这条曾经被写错过」本身是有价值的审计记录：

**(a) `initialSdk` 不是硬件锚。** 采集侧是 `SafeReader.property(SafeReader.Property.FIRST_API_LEVEL)`（[SecurityObservations.kt:43](../app/src/main/java/com/sigmark/app/collector/SecurityObservations.kt#L43)），也就是 `ro.product.first_api_level`——一个普通的 `ro.*` 属性。有 root 就是 `resetprop ro.product.first_api_level 35` 一行，与改 `ro.product.name` 的成本完全相同。它「只读」是指普通应用不可写，不是指 root 不可写；整套文档在别处（§13 F7）已经承认 `ro.*` 全部可改，这里却把它当成例外。

**(b) 声明轴没有为它定价。** `hardwareKeys`（[hardware_facts.go:112](../backend/cmd/sigmark/hardware_facts.go#L112)）是 `memory.totalRam / memory.physicalRam / memory.kernelMemTotal / cpu.cpuParts / system.socModel / runtime.glesRenderer / system.device / environment.overlayDeviceCodename / cpu.cpuCapacity / memory.cmaTotal`——**没有 `system.initialSdk`**。没有任何标签读它，也没有任何交叉校验把它和 `Build.VERSION.SDK_INT`、和 SoC 画像对上。全仓唯一的比对在 `identity_review`（[identity_review.go:16](../backend/cmd/sigmark/identity_review.go#L16) 的 `reviewIdentityKeys` 含 `system.initialSdk`），而那是一条**需要人工 ADB shell 二次观测、且必须落在采样时刻 ±5 分钟内**的复核接口（[:64](../backend/cmd/sigmark/identity_review.go#L64)），**不参与打分**。

所以 U2 的真实强度是（**修正后的表述**）：

| 攻击 | 结果 |
| --- | --- |
| `resetprop ro.product.first_api_level 35`（2024 世代） | U2 不成立，usage 轴 100 分、coverage 1.0 |
| 空白该属性 | `sdkOK = false` → 只有 U1 可能成立；若 U1 也不成立则 usage coverage 可能降为 0 → 轴退出（**注：这条已被 §10.2 的修复关闭，删空后是 `100/B`，不是 A**） |

**修正后的定位（重要）**：U2 的价值**不是**「不可伪造」，而是「**把伪造成本提高一步**」——攻击者从「刷一个当前 ROM」变成「刷 ROM + 再改一个出厂属性」。这在成本模型里是有意义的（§6 那张表的「成本」列正是按这个尺度写的），但**不能**被写成安全保证，也**不能**成为升版本号的主要理由。改正后的注释（[score.go:218](../backend/cmd/sigmark/score.go#L218)）已经把这一点写明：「U2 raises the cost of a disguise by one step; it does not make the disguise impossible, and nothing else in the pipeline would notice a lie here.」

**仍然成立的部分**：契约文档 [SECURITY-SCORE.md §13 F1](SECURITY-SCORE.md) 曾把 U2 列为「优先级最低」，而它已经在线扣分——这条不一致与 U2 是否可伪造无关，仍然需要文档同步（§5.9 第 1 条）。

---

## 4. 误报路径

### 4.1 开发者手机

| 场景 | 命中的分支 | value | band |
| --- | --- | --- | --- |
| 只开 USB 调试，没 root | 无 | 100 | **A** |
| 装了 Magisk 做测试，未配 DenyList | `HOOK 25 + ROOT 12 = 37` | 87 | **B** |
| 上面 + 测试用 permissive ROM | `+15 = 52` | 82 | **B** |
| 上面 + 采样时开了第二用户 | `+8 = 60` | 79 | **B** |
| 上面 + 采样时 `strace` 挂着 | `+20 = 80` | 72 | **B** |

**结论**：开发者的测试机**永远进不了 C/D**（行为轴上限见 §4.4），但也**永远进不了 A**——只要装了 Magisk，就至少是 B。这是个可辩护的取舍（「有 root 就别声称一致」），但代价是 **B 档被两类完全不同的设备占满**：一台只装了 Magisk 的测试机（87/B）和一台被完整植入的机器（72/B）在界面上都是「有疑点」。

只开 USB 调试不误报，这一点是对的：`debugger_attached` 要求真的 attach（`Debug.isDebuggerConnected()` 与 `TracerPid`），开关本身不算。EMULATOR-LAB §7.3 第 6 条【已实测】也确认了这点。

### 4.2 第三方 ROM / 新机 / 二手老机

| 人群 | 触发 | value | band | 判断 |
| --- | --- | --- | --- | --- |
| 刷 LineageOS，verity off | **不触发**（`rom_verification` 展示不计分，§13 F1 裁决） | 100 | A | ✅ 正确 |
| 刷移植 ROM，overlay 代号与 `system.device` 不一致 | `OVERLAY_CODENAME_MISMATCH 15` | 94 | B | ⚠️ **误报**：移植 ROM 的 RRO 命名来自**原始镜像**，与改写后的 `ro.product.device` 不一致是移植的正常结果 |
| 便宜机只有 L3 DRM | 不触发（展示不计分） | 100 | A | ✅ 正确 |
| 刚买的新机、刚重置的新机 | 不触发（分区年份新、SDK 新） | 100 | A | ✅ 正确 |
| 2021 年老机恢复出厂 | `FRESH_BOOT_ON_AGED_ROM 12`（U1） | 97 | B | ❌ **误报**，见 §4.3 |
| 2017 年老机刷了 2024 的 ROM 并重置 | `FRESH_BOOT_ON_AGED_ROM 12`（U2） | 97 | B | ❌ **误报**，见 §4.3 |
| 二手老机（卖家重置后寄出） | 同上 | 97 | B | ❌ **误报** |
| 旧库存新机（2022 生产、今天激活） | 同上 | 97 | B | ❌ **误报** |
| 长期不重启的老机（bootCount 低但没重置） | 同上 | 97 | B | ❌ **误报**（更隐蔽） |

### 4.3 `FRESH_BOOT_ON_AGED_ROM` 是不是误报？—— 是，而且 `/2` 之后更严重

规则实现（[score.go:1119](../backend/cmd/sigmark/score.go#L1119) 起）：`bootCount ≤ 2`（`usageFreshBootCeiling`，[score.go:205](../backend/cmd/sigmark/score.go#L205)）**且** 满足 U1 或 U2 之一：

- **U1**：分区最早年份 `≤ 采样年 − 3`（[score.go:1197](../backend/cmd/sigmark/score.go#L1197)），`detail` 写「分区最早建于 {年} 年，距采样已满 3 年，开机次数只有 {n} 次」（[:1210](../backend/cmd/sigmark/score.go#L1210)）；
- **U2**（`/2` 新增）：出厂 SDK 对应年份 `≤ 采样年 − 3`（[:1198](../backend/cmd/sigmark/score.go#L1198)），`detail` 写「出厂 SDK {sdk} 对应 {年} 年，距采样已满 3 年，开机次数只有 {n} 次」（[:1219](../backend/cmd/sigmark/score.go#L1219)）。

**判断：这是误报，而且是结构性的，不是调参能修的。** `/2` 之后误报面**扩大**了，因为 U2 不再要求「镜像老」，只要求「设备世代老」。

理由五条：

1. **两个条件测的是同一件事的两面。** `bootCount` 是「**上次清数据以来**的冷启动次数」（采集侧注释写得很清楚，[SecurityObservations.kt:50](../app/src/main/java/com/sigmark/app/collector/SecurityObservations.kt#L50)：每次冷启动递增，**恢复出厂或清数据会重置**）。所以「bootCount 很小」的**主要成因**就是「刚被清过数据」。无论 U1 还是 U2，联合分布都由**恢复出厂**这一个合法动作完整解释。**规则无法区分两者，因为数据里没有区分它们的字段。**
2. **U2 把「老设备」直接等同于「可疑」。** 一台 2017 年的 Pixel 2（`first_api_level = 26`）今天刷了最新 ROM、重置一次：`dateYear` 是 2026（U1 不成立），`sdkYear` 是 2017（U2 成立）→ 扣 12 分。**这是「老手机」这个事实本身在扣分**，与它是否被篡改无关。代码注释说 U2 抓的是「ROM-flashing attacker 的形状」，但同一个形状**也是**「老手机 + 官方最新系统 + 恢复出厂」的形状。
3. **误报率随设备年龄单调上升。** 采样年每加 1，cutoff 就加 1，于是「三年前出厂的机器 + 低开机次数」这个集合只增不减。到 2027 年，2024 年及以前出厂的所有设备都会落入窗口。这不是尾部误报，是**主干误报**。
4. **误报的代价和真阳性一样高。** 12 分 → usage 轴 88 → value 97 → **R11 把 band 打到 B**。也就是说：**「手机重置过一次」和「手机被完整植入」在界面上是同一个词——有疑点**（§4.1 最后一行的 72/B）。一个只值 12 分的弱信号，因为 R11 的悬崖效应，获得了和 80 分同等的话语权。
5. **它把「少」当成了「矛盾」。** [SECURITY-SCORE.md §10.2](SECURITY-SCORE.md) 自己写了「`bootCount = 2` + 分区建于 2021 → **可疑但不违法**：可能是刚恢复出厂。扣 15 分，落 B，`detail` 写『先核对是否恢复出厂或刷机』」——**文档承认它不是矛盾，代码照样扣分。** 这就是「知道是误报还扣」，比不知道更糟。

**附带的一个小错**：判据是**年份整数比较**（`dateYear <= cutoff`，[score.go:1197](../backend/cmd/sigmark/score.go#L1197)），不是经过时间。2023-12-31 建的分区在 2026-01-02 采样，实际只过了 2 年 2 天，但 `2023 <= 2023` 成立，`detail` 会写「**已满 3 年**」。这句话是**假的**——账本里的每一句人话都应当能对上读数（R1 的精神），这一句对不上。最坏情况虚报约 1 年。U2 同理：`sdkYear <= cutoff` 比的是「该 API 级别的发布年」，一台 2023 年底发布的设备在 2026 年初采样会被算成「满 3 年」。

**修复建议（一句话）**：U1 降为展示不计分，U2 改为「同资产历史里 `bootCount` 下降且 `initialSdk` 不变」才计价——后者才是「计数器被打回」的正向证据，也正是 §10.2 第 4 条留给 v2 的形态。

### 4.4 误报的总代价：band 塌缩

把所有场景的 value 排在一起看：

| value | 场景 | band |
| --- | --- | --- |
| 100 | 干净设备 | A |
| 100 | **被完全洗白的改装机（修复前）**：洗白 = 精确回到基线，基线是 A 就还是 A。【已实测，§10.8】 | ~~A~~ → **修复后落回 `90/D`**（单侧身份证据） |
| 100 | **删掉 usage 的两个输入**（修复后，R10 两层）【已实测，§10.2】 | **B**（数字满分，结论不是 A） |
| 97 | 手机重置过一次（U1 或 U2）/ `bootCount` 被改 / 只在第二用户跑 | B |
| 96 | 只剩 `ROOT_MANAGER_VISIBLE`（12） | B |
| 95 | 只剩 `SELINUX_PERMISSIVE`（15） | B |
| 94 | 移植 ROM 的 overlay 命名（15，声明轴）/ 仅 SKU 不一致（15） | B |
| 93 | 只剩 `DEBUGGER_ATTACHED`（20） | B |
| 91 | 只剩 `HOOK_INJECTION`（25） | B |
| 88 | `HARDWARE_CHANNEL_CONFLICT`（30，非决定性）/ 模拟器（35 + cap） | B / **D** |
| 88 | **「隔离干净设备」的基线**（自带 `ram_dispersion` 30）【已实测，§10.7】 | B |
| 87 | 开发者装了 Magisk（37） | B |
| 82 | 伪装机（字段集 23，无 capacity 通道）【已实测】 | B |
| 79 | 开发者 + permissive + 第二用户（60） | B |
| 78 | **同一台隔离设备 + 一个身份冲突**（30 + 25 + cap）【已实测，§10.7】 | **D** |
| 75 | **已 root + hook + permissive + 被 ptrace**（72） | B |
| 72 | 上面再加第二用户（80）/ 声明轴全线不符（70 分扣满） | B |
| 65 | 行为轴六项全中（115 → clamp 100） | **D**（靠 cap） |
| 34 | 三轴同时崩 | D |

**B 档横跨 72–100，28 分宽**，里面同时装着「重置过一次的手机」和「每一项行为证据都指向正在被分析的设备」。**band 作为「结论」的语义在这里失效了**：它不是结论，它是「至少有一条扣分」的同义词。

这不是 R11 的错（R11 解决的是真问题），而是**权重 × 阈值**的错：行为轴的满分权重只有 35，扣满 100 分也只能从总分里拿走 35 分。所以「行为轴能表达的最大严重度」是 65（C）——而 65 只有把六项全中才拿得到，其中 `virtual_build_markers` 一命中就直接 cap 到 D。**换句话说：行为轴在不含模拟器标记的情况下，永远表达不出比 B 更重的东西。**

---

## 5. 逻辑漏洞

### 5.1 覆盖率闸门：`读不到` 与 `读到且干净` 在总分上等价吗？——**是，但方向比你想的更糟（本条已修复）**

先把实现摊开。总分循环（[score.go:387](../backend/cmd/sigmark/score.go#L387) 起）：

```go
for _, axis := range out.Axes {
    if axis.Score == nil { continue }
    if axis.Coverage >= scoreCoverageFloor || len(axis.Deductions) > 0 {
        weighted += float64(axis.Weight) * float64(*axis.Score)
        weights += float64(axis.Weight)
    }
}
```
（[score.go:393](../backend/cmd/sigmark/score.go#L393)）

闸门条件是 `coverage >= 0.5` **或** `有扣分`。这带来两个结论，必须分开说：

**(a) 「拉低覆盖以躲掉扣分」这条攻击被堵住了。** 只要某轴有扣分，它就一定进加权，不管覆盖多低。这是 R7 的薄轴例外（[SECURITY-SCORE.md §4](SECURITY-SCORE.md)，[score.go:393](../backend/cmd/sigmark/score.go#L393) 的 `|| len(axis.Deductions) > 0`）。所以「先扣分、再把覆盖压低让它滚出总分」**不成立**。这一条设计是对的，而且那个 `||` 是**承重墙**——把它「清理」成纯 coverage 判断，整个体系立刻可被一条 RESTRICTED 打穿。

**(b) 但「读不到」和「读到且干净」确实同分，而且这不是等价，是「读不到」更优。** 因为被排除的轴权重会被**重新归一化**：

- 轴被排除 → 它的权重从分母消失 → 剩下的轴按比例放大；
- 如果剩下的轴都是 100，结果还是 100 → 与「读了且干净」同分（这就是「等价」）；
- **如果剩下的轴里有一条低于 100，排除一条「本来会是 88 分的轴」比保留它更划算** → **读不到 > 读到且不干净**。

**这就是 usage 轴上的洞，可以精确算出来（左半是推理，右两列是 §10.2 的实测）：**

| 情形 | usage 轴 | 计算 | value | band（修复前） | band（修复后，实测） |
| --- | --- | --- | --- | --- | --- |
| 正常采到，U1 命中 | coverage 1.0，score 88 | `(4000 + 3500 + 2200) / 100` | **97** | **B**（R11） | **B**（不变） |
| 删 `ro.system.build.date.utc` **和** `ro.product.first_api_level` | coverage 0，无扣分 → **排除** | `(4000 + 3500) / 75` | **100** | ~~**A**~~ | **B**（R10 窄形态：数字照发，禁止 A） |

同一台设备、同一天，**把证据删掉比留着证据高 3 分，并且跨过一个 band**——**这一条已被实测完全证实，且已修复**（§10.2 是 lead 在真实 MI 8 证据上的单变量对照：`97/B` vs `100/A`，修复后 `100/B`）。这条攻击原本没有副作用：

- usage 轴只有 1 个派生标签（[score.go:1154](../backend/cmd/sigmark/score.go#L1154) 的 `decided, total := 0, 1`），所以 coverage 只有 0 或 1 两个值；
- 可判的条件是 `bootOK && (dateYearOK || sdkYearOK)`（[:1192](../backend/cmd/sigmark/score.go#L1192)）。注意 `/2` 之后 **删一个不够**：只删分区日期，U2 仍能判；只删 `initialSdk`，U1 仍能判。要退出加权必须**同时**让三个信号都不可用，或者直接把 `system.bootCount` 弄成不可读；
- `FRESH_BOOT` 一旦命中，`decided = 1` → coverage = 1 → 它**永远带着扣分进总分**，所以「命中后再压覆盖」不可能；反过来，**在命中之前就让输入不可读**，规则就根本不成立；
- 剩下的读数仍然可读，所以 `undetermined` 里只列两行 `UNAVAILABLE`，看起来像「这台机器恰好没存分区日期和出厂 SDK」——一个非常正常的旧设备形态。

**对照文档**：`[SECURITY-SCORE.md §9.2](SECURITY-SCORE.md)` 把「使用轴单独命中 → 97/B」和「干净 → 100/A」并列写出来，恰好把攻击路径画了出来：**这两行之间只差两个被删掉的属性。**

**(c) 行为轴没有等价的保护，但也不容易被压到 0.5 以下。** 诚实地说：`hookSignals`/`rootMountHints` 读的是 `/proc/self/maps` 与 `/proc/self/mountinfo`，对**本进程**永远可读；`multi_open` 来自 UID，永远可判；`debugger_attached` 至少 `TracerPid` 可读。所以行为轴的覆盖率现实中 ≥ 5/6，攻击者压不下去。**能压下去的是声明轴（3 个通道）和 usage 轴（1 个标签）**。

**判断**：闸门本身不是「最大的洞」；**「删掉一个 1 标签轴的唯一输入」才是**。而 usage 轴恰好是三条轴里唯一一条「只有一个标签、且标签的输入全部可被属性控制」的轴。严重度 **严重**。

**修复形态（已落地，§10.2 实测）**：R10 从「只保 declaration 轴」推广到**全部三轴**，但**分两层**——[score.go:424](../backend/cmd/sigmark/score.go#L424) 的 `axisBlind` 负责全轴检测，[:440](../backend/cmd/sigmark/score.go#L440) 的 `declarationBlind` 保留原严格形态，[:494](../backend/cmd/sigmark/score.go#L494) 是窄形态的落点：

| 轴 | 盲（coverage < 0.5 且零扣分）时的行为 | 理由 |
| --- | --- | --- |
| `declaration` | **完全不出版数字**，`band = ?`（严格形态不变，[:446](../backend/cmd/sigmark/score.go#L446)） | 40% 权重的轴全盲时，用另外两轴平均出 A，就是把「没看」当成「看过」 |
| `behavior` / `usage` | **数字照常出版，但禁止 A**，band 强制降到 B（[:494](../backend/cmd/sigmark/score.go#L494)） | 若也改成不出版，一台「hook 注入 + debugger 都在」的真机会从 D 变成 `?`——**把唯一看见了的东西弄丢** |

为什么**不**统一成「全轴不出版」：lead 先试了全轴版本，结果正是上面那个退化（D → `?`）。所以窄形态是对的取舍：**攻击者想动的是结论，就锁死结论**；数字保留，D 仍然能被看见。

我原来的修复建议（「不允许一条轴因为删掉输入而退出加权」）**比实际落地的更重**；实际选择了更窄的一步，效果上同样关闭了「删证据升档」，且不损失真阳性。**这个取舍我认为是对的。** 唯一残留：数字仍是 100，只看 `value` 的消费方（排序、导出）仍会把它排在干净设备旁边——所以 `band` 必须继续是唯一被当作结论的字段（R9 本来就要求）。

### 5.2 `hit` → `insufficient` 洗白：证据可以被**完全擦除**（**已修复**：单侧可读本身就是证据）

这条比 §5.1 更直接，因为它洗掉的是**决定性分支**。它经历了**三次实测、两次样本污染、一次决定性验证**，最后被修掉。结论链完整记录如下——**因为过程本身比结论更有价值**（见 §8.1）。

#### 5.2.1 漏洞是什么（修复前）

`identity_conflict` 的状态机**在修复前**是（现在这段在 [device_profile.go:254](../backend/cmd/sigmark/device_profile.go#L254) 起，多了一个 `oneSided` 分支）：

```go
compared, conflicts := compareAppIdentity(pairs, readIdentity)
if len(conflicts) > 0 { identity.State = "hit" }
else if compared == len(pairs) { identity.State = "not_observed" }
// 否则保持 insufficient
```

而 `compareAppIdentity` 对**任一侧不可读的对直接 `continue`**（[identity_consistency.go:41](../backend/cmd/sigmark/identity_consistency.go#L41)），既不计数也不冲突。于是把冲突的一侧置空 → `compared = 2 ≠ 3` → 停在 `insufficient` → **打分层不扣分、不发 cap**（[score.go:863](../backend/cmd/sigmark/score.go#L863) 的 identity 分支只处理 `hit`）。

**危害的准确表述**（这是三轮实测最终收敛出来的）：

> **一个属性就能把一台已被确认伪装（`D`）的设备，洗成与「从未冲突过」的设备逐字段不可区分。** 攻击者得到的不是「高分」，而是**「没有案底」**——`band` 正常、`value` 正常、`undetermined` 里只有一行看起来完全正常的 `UNAVAILABLE`。

#### 5.2.2 三次实测：两次被污染，第三次决定性

| 实验 | 样本 | 冲突 | 洗白 | 是否可用 |
| --- | --- | --- | --- | --- |
| 一（§10.7） | 真实 Pixel 6 证据 | `72/D`，caps=2 | `82/D`，caps=1 | **作废**：样本自带 `FOREIGN_PROFILE`(30) + overlay(15)，`caps=2` 就是污染指纹 |
| 二（§10.7） | 「隔离干净设备」 | `78/D` | `88/B`（= 基线） | **部分可用**：洗白确实抹掉了 identity 扣分与 cap，**但基线本身不是 `100/A`** |
| 三（§10.8） | 真正的干净基线 | `90/D` | **`100/A`** | **决定性**：基线 `100/A`、零扣分，逐字复现我的预测 |

**实验二的污染**：那台样本的 `memory.kernelMemTotal = 7.44 GiB` 与 `totalRam = 12.00 GiB` 相差 **38%**，超过 8% 阈值（[hardware_facts.go:160](../backend/cmd/sigmark/hardware_facts.go#L160)）→ `ram_dispersion` 判冲突 → `HARDWARE_CHANNEL_CONFLICT` **30 分**（非决定性，[score.go:821](../backend/cmd/sigmark/score.go#L821)）。所以基线注定是 `88/B`：`88 = (40×70 + 35×100 + 25×100)/100`。**「不是 A」是样本起点就不是 A，不是 R10 拦住的。**

**实验三把基线修干净**（`kernelMemTotal = 11.20 GiB`，6.7% < 8% → `ram_dispersion` 转 confirmed），得到：

| 状态 | value | band | 声明轴 |
| --- | --- | --- | --- |
| 干净基线 | **100** | **A** | coverage 1.0、deductions 0 |
| 一个身份冲突 | **90** | **D** | coverage 1.0、deductions 1 |
| **洗白（冲突侧置空）** | **100** | **A** | coverage 1.0、deductions 0 |

**这就是完整的伪装**：`D` → 一个属性 → `A`，报告里一处痕迹都不留。**我最初的方向从头到尾都是对的**，前两轮的「不是 A」全部是测量污染。

#### 5.2.3 修复做了什么

**判据（一句话）**：**同一对身份读数，两侧都成功读到、但只有一侧产出值——这本身就是证据。**

新增 `oneSidedIdentity`（[identity_consistency.go:70](../backend/cmd/sigmark/identity_consistency.go#L70)），由 `device_profile.go` 消费（[device_profile.go:259](../backend/cmd/sigmark/device_profile.go#L259)）。**四个跳过条件**，每一个都对应一种「不是篡改」的真机情况：

| 条件 | 位置 | 为什么跳过 |
| --- | --- | --- |
| 任一侧 `NOT_ARCHIVED` | [identity_consistency.go:75](../backend/cmd/sigmark/identity_consistency.go#L75) | **该字段集根本没定义这个键**——行不存在，不是空行。全库 7 份单侧记录全是 fs=16/20，`propertyModel` / `propertyDevice` / `hardwareSku` 整行不存在，所以**不误伤历史报告** |
| 任一侧非 `AVAILABLE`（`RESTRICTED` / `ERROR` / `UNAVAILABLE`） | [:84](../backend/cmd/sigmark/identity_consistency.go#L84) | **采集受限不是证据**。系统拒绝读属性不是设备的错，罚它就等于罚权限模型 |
| 两侧都为空 | [:89](../backend/cmd/sigmark/identity_consistency.go#L89) | 真的读不到，是采集能力限制；**攻击者要留一侧可读**才有收益 |
| 两侧都可读且不相等 | 走原有 `conflicts` 分支 | 那不是「不对称」，是普通的「矛盾」，价格不同（`IDENTITY_APP_UID` 25 + 决定性 cap） |

命中时：[device_profile.go:263](../backend/cmd/sigmark/device_profile.go#L263) 把 `identity_conflict` 置 `hit`，并附一行 `identity_asymmetry` 证据（[:266](../backend/cmd/sigmark/device_profile.go#L266)），文案是「**N 对身份读数只有一侧可读（共 M 对在档）**」；打分层把它当 keys（[score.go:870](../backend/cmd/sigmark/score.go#L870)）并单独取 detail（[score.go:968](../backend/cmd/sigmark/score.go#L968)），cap 的 reason 也用这句。

**文案上的克制是刻意的**（[score.go:962](../backend/cmd/sigmark/score.go#L962) 起的注释）：只说「读到了、只有一侧有值」，**不说「篡改」**——打分层不知道这是 ROM 的怪癖还是被删的属性，读者自己判断。

#### 5.2.4 修复后实测

| 实验 | 冲突 | 洗白 | 结论 |
| --- | --- | --- | --- |
| 三（干净基线 `100/A`） | `90/D` | **`90/D`** | **不再回到 A**，等于冲突 |
| 二（隔离设备 `88/B`） | `78/D` | **`78/D`** | 同理，等于冲突 |
| 一（Pixel 6） | `72/D`，caps=2 | **`72/D`，caps=2** | 同名 cap 保留 |
| MI 8 | `90/D`，caps=1 | **`90/D`，caps=1** | 洗白后标签仍是 `hit`（原先是 `?`） |

**洗白不再有任何收益**：删掉一个属性，得到的分数与「留着不一致」完全相同——**而那才是它应得的分数**。

#### 5.2.5 连带变更：单侧占位符现在也算不对称

原来 `device = "UnKnOwN"` vs `propertyDevice = "corot"` 判 `insufficient`，**现在判 `hit`**。理由很直接：**占位符和空白一样便宜**，只堵空白不堵 `unknown` 等于没堵。

| 形态 | 修复前 | 修复后 |
| --- | --- | --- |
| 一侧空白、一侧有值 | `insufficient`（洗白成功） | **`hit`** |
| 一侧占位符（`unknown`/`null`/`none`/`n/a`/`-`）、一侧有值 | `insufficient` | **`hit`** |
| **两侧都占位符** | `insufficient` | **仍是 `insufficient`**（[identity_consistency.go:89](../backend/cmd/sigmark/identity_consistency.go#L89)：两侧都空，不是不对称） |

测试同步改名/新增：`one-sided placeholder is asymmetry evidence`、`placeholder on both sides is still not comparable`（[device_profile_test.go:440](../backend/cmd/sigmark/device_profile_test.go#L440)、[:443](../backend/cmd/sigmark/device_profile_test.go#L443)）。

**版本双升（纪律要求）**：`profileVersion /8 → /9`（[device_profile.go:25](../backend/cmd/sigmark/device_profile.go#L25)，状态映射变了）、`scoreVersion /2 → /3`（[score.go:51](../backend/cmd/sigmark/score.go#L51)，判定变了）。**标签的状态词表没变、报告的字段形状没变，但同一份归档会得出不同 band，所以必须升版**——这是「零命中也要升版」纪律的一次正确执行。

#### 5.2.6 这个修复**没有**覆盖的部分（重要）

修复只治 `identity_conflict` 这一对。**同一个手法（让一对读数的一侧消失）在别的通道上是否同样能擦除证据，一条都没测。**

| 同样的手法套在 | 现状 | 有等价修复吗 |
| --- | --- | --- |
| `OVERLAY_CODENAME_MISMATCH`（15） | 让 overlay 代号不可读 → `insufficient`（[score.go:905](../backend/cmd/sigmark/score.go#L905) 的 `default` 分支） | **没有**。overlay 只有一个来源，不存在「两侧对照」，所以也没有「不对称」可判 |
| `SELINUX_PERMISSIVE`（15） | 让 enforce 节点返回非 `0/1` → `INVALID_VALUE` → `insufficient` | **没有** |
| `HARDWARE_CHANNEL_CONFLICT` 的 CPU/GPU 通道（30） | 声明表外 SoC → 通道不进入判定（§3.4.2） | **没有**，这正是第一优先级未决项 |
| `virtual_build_markers`（35 + 唯一行为 cap） | 空 `ro.product.name` → `insufficient`（发现 4） | **没有** |

**为什么 identity 能修而别的不能**：identity 有**三对独立来源**（`Build.MODEL` vs `ro.product.model` 属性），所以「一侧有值、一侧没有」是可判的**不对称**；而 overlay / SELinux / SoC 画像**只有一个观察者**，它读不到就是读不到，打分层没有第二个视角可以对照。**这不是修法不够狠，是信息结构上就没有对照物。**

所以剩下四条真正的解法不是「加一条不对称判据」，而是**给每个通道找第二个独立观察者**（例如 overlay 代号与 `system.device` 之外的构建指纹交叉、SELinux 用 `/sys/fs/selinux/enforce` 与 `getenforce` 双读、SoC 用 `cpuParts` + `cpuCapacity` + `cmaTotal` 三通道互相印证）。**这是 §7 新第一位（未登记 SoC）要一起做的事。**

#### 5.2.7 严重度重估（保留作记录）

修复前我把严重度从「能拿 A」下调为「能抹掉证据」，**现在实测证明两者同时成立**：既是「能拿 A」（实验三），也是「没有案底」。当时的对比仍然成立，一并记录：

| 维度 | 「能拿 A」 | 「能抹掉证据」 |
| --- | --- | --- |
| 攻击者得到什么 | 一个满分结论 | **一份与干净设备无法区分的报告** |
| 运维能否发现 | 理论上还能靠别的通道交叉验证 | **不能**：`band`、`value`、`undetermined` 全都正常 |
| 取证价值 | 高（有一份 A 档的错误结论） | **更高**：连「曾经有过冲突」这件事都不存在了 |

一句话：**§5.1 的洞是「分数被骗」，本条是「历史被删」。后者更难被发现，也更要紧**——所以它虽然是第二条被修掉的，却是在决定性实验之后才被修，顺序是对的：**先证明危害，再动代码**。

### 5.3 35 分决定性规则被三行属性改写绕过（**已实测、已修复**：`/4`）

**这是本轮最重的一条，也是本文第一次有「真机（真模拟器）实测」而不是合成 fixture 的发现。** 前四条都是我在代码上推出来的；这一条是**实际跑出来的**。

#### 5.3.1 实测现场（可复现证据）

用户手动启动 **LDPlayer 9（雷神模拟器）**，lead 接 `127.0.0.1:5557`，装 SigMark 1.14.0，实跑采集并上传。**报告号 `ce1bdc7f-f128-4e8b-a225-bbeb2bee7c35`**。

它的属性（原样抄录，`→` 后是我的注解）：

```
ro.build.version.sdk        = 34
ro.product.first_api_level  = 28
ro.product.model            = RMX5010          → 声明成 realme 的一款机
ro.product.device           = unicorn          → 声明成 realme 的代号
ro.product.brand            = realme
system.board                = RMX5010
system.boardPlatform        = aosp-user        ← 关键：真机的这里是 SoC 代号
cpu.hardware                = qcom             ← 关键：改写成高通
system.product              = RMX5010          ← 关键
system.device               = unicorn          ← 关键
ro.boot.qemu                = 1                ← 直接自曝，但采集端从不读它
cpu.cpuInfo                 = AMD Ryzen 9 9950X 16-Core Processor  ← 关键：/proc 透传
MemTotal                    = 2036460 kB       （1.9 GiB）
SELinux                     = Permissive
ro.build.fingerprint        = Xiaomi/unicorn/unicorn:14/...        ← brand 却写 realme，自相矛盾
```

**修复前的判定：`band = ?`（未知），`virtual_build_markers = not_observed`。**

注意那个 `?` 的严重性：它不是「被抓到」，也不是「干净」，而是**「无法判定」**——对攻击者来说，这是比 `D` 好得多的结果，而且**报告里看起来像是一台读不到东西的怪设备**，不像作弊。

#### 5.3.2 根因一：规则问的是「名字像不像模拟器」，而这个名字由模拟器自己填

`virtual_build_markers` 只读三个键（[device_profile.go:276](../backend/cmd/sigmark/device_profile.go#L276)）：`cpu.hardware`、`system.product`、`system.device`，比对 `ranchu` / `goldfish` / `vbox86` / `emulator` / `sdk_gphone` 前缀。

雷神把这三个键**全填成 `qcom` / `RMX5010` / `unicorn`**——三个合法到不能再合法的真机值。规则于是 `not_observed`。**35 分 + 决定性 cap 被三行 `resetprop` 清零。**

这就是黑名单类规则的**结构性缺陷**：**它的输入是被审查者提供的。** 问「你像不像模拟器」，模拟器回答「不像」，规则就只能接受。

#### 5.3.3 根因二：`ro.boot.qemu=1` 根本没被采集

最讽刺的一点：这台设备**自己承认了**（`ro.boot.qemu = 1`），但采集端从来不读这个属性——`protocol.go` 的字段字典里没有它，`SafeReader.Property` 的白名单里也没有。**不是判据不够，是这条判据从没进入系统。**

本轮**没有补**这一条（见 §7 第二件），所以「最便宜的那条线索至今仍是盲的」。

#### 5.3.4 修复：不看名字，看自相矛盾

新增 [virtual_evidence.go](../backend/cmd/sigmark/virtual_evidence.go)（133 行），两条通道，**都不是黑名单名字匹配**：

| 通道 | 判据 |
| --- | --- |
| `desktop_cpu_info` | `cpu.cpuInfo` 含 `intel` / `amd` / `ryzen` / `threadripper` / `epyc` / `athlon` / `core i3`–`core i9` / `pentium` / `celeron` / `xeon` / `apple m1`–`apple m4`（[virtual_evidence.go:58](../backend/cmd/sigmark/virtual_evidence.go#L58)） |
| `generic_board_platform` | `system.boardPlatform` ∈ {`aosp`, `aosp-user`, `generic*`, `unknown`, `emulator`, `goldfish`, `ranchu`, `vbox86`}（[:43](../backend/cmd/sigmark/virtual_evidence.go#L43)、[:66](../backend/cmd/sigmark/virtual_evidence.go#L66)） |

**但「不是黑名单」不等于「一样贵」。这一节是本轮最重要的一次自我纠正。**

我第一版写的是「两条通道改起来都比黑名单贵」。**这是错的**，lead 查了采集侧并在雷神上实测：

| 通道 | 数据从哪来 | 改造成本 | 实测证据 |
| --- | --- | --- | --- |
| `system.boardPlatform` | **`ro.board.platform` 属性**（[DeviceCollectors.kt:129](../app/src/main/java/com/sigmark/app/collector/DeviceCollectors.kt#L129) 的 `declaredProperty`） | **1 条 `setprop`** | `setprop ro.board.platform test_probe` → `getprop` 返回 `test_probe`，**改成功** |
| `cpu.cpuInfo` | **`/proc/cpuinfo` 内核视图** | 需改 guest kernel 视角 | `echo 'model name : fake' > /proc/cpuinfo` → **`Permission denied`**；`ls -l` → `-r--r--r-- 1 root root`，**只读** |

**所以真实的强度是「一条硬通道 + 一条软通道」，不是「两条硬通道」。**

- `cpu.cpuInfo` 是**真的更贵**：它是 `/proc` 透传，**`resetprop` 对它无效**，要改得动内核视角或拦 `open()`；
- `system.boardPlatform` **一点都不贵**：它就是一条属性，和 `cpu.hardware` / `system.product` / `system.device` **同一个价位**。

**它买到的是「一个不同的问题」，不是「更高的成本」**：它问「这个平台串像不像 SoC 代号」，这是**对答案形状的判断**，不是对**值来源**的判断。模拟器只要把 `ro.board.platform` 写成 `pineapple`，这条通道**当场失效**。

> **这条区分是本轮最有价值的方法论**：「判据问的问题不同」≠「判据更难满足」。判断成本要看**数据从哪来**（属性 / `/proc` / 构建产物），**不是看它问什么**（§8.1.2）。

**两个防误伤设计（这一节是本条修复的质量所在）**：

| 设计 | 位置 | 为什么必须有 |
| --- | --- | --- |
| 遇到 `implementer 0x` 直接返回 `false` | [virtual_evidence.go:89](../backend/cmd/sigmark/virtual_evidence.go#L89) | 那是 **ARM 正品信号**，任何一颗真 ARM 芯片的 `cpuInfo` 都长这样。不排除它就会把**每一台真机**都打成模拟器 |
| 空白 / 不认识的字符串返回 `false` | [:85](../backend/cmd/sigmark/virtual_evidence.go#L85)、[:97](../backend/cmd/sigmark/virtual_evidence.go#L97) | **「我不认识」不是证据。** 否则下一颗没见过的 ARM 芯片（或 ARM 服务器芯片）会被当成模拟器 |

#### 5.3.5 计分：同分同决定性，但**互斥**

- `structuralVirtualPoints = 35`（[score.go:163](../backend/cmd/sigmark/score.go#L163)），与 `VIRTUAL_BUILD_MARKERS` **同分、同决定性**。
- **互斥**：`structuralVirtualDeduction(parameters, markerHit)` 在 `markerHit == true` 时**直接返回 false**（[score.go:1058](../backend/cmd/sigmark/score.go#L1058)）。**一因一果（R2），绝不重复计价**——一台被黑名单抓住的模拟器不会被再收一次 35 分。
- 扣分码 `STRUCTURAL_VIRTUAL_EVIDENCE`（label `structural_virtual_evidence`，[score.go:1090](../backend/cmd/sigmark/score.go#L1090)），走**同一个** `DECISIVE_VIRTUAL_BUILD` cap（[:1046](../backend/cmd/sigmark/score.go#L1046)）——**cap 名字没变，因为结论没变：这不是一台手机。**

**`detail` 的措辞（刻意只写观察，不写判决）**：

> `设备自相矛盾：desktop_cpu_info、generic_board_platform（cpu.cpuInfo=AMD Ryzen 9 9950X 16-Core Processor）（system.boardPlatform=aosp-user）`

它**不说「这是模拟器」**（[score.go:1079](../backend/cmd/sigmark/score.go#L1079) 起的注释写了理由：「这是模拟器」是**结论**，「cpuInfo 报了桌面 CPU 而设备声明自己是手机」是**观察**，读者可以不同意）。**这是整套体系里文案纪律最好的一处。**

#### 5.3.6 修复后实测

| 指标 | 修复前 | 修复后 |
| --- | --- | --- |
| `band` | **`?`** | **`D`** |
| `decisive` | `false` | **`true`** |
| behavior 轴扣分 | 15（只有 SELinux） | **35 + 15 + 12**（结构 + SELinux + root 管理器） |
| caps | 无 | `DECISIVE_VIRTUAL_BUILD → D` |

> **`band = D` 是 cap 直接给的，不需要看总分**（R5）：只要 `DECISIVE_VIRTUAL_BUILD` 在，结论就是 `D`。所以这个结论不依赖「behavior 轴加起来多少分」这种容易算错的东西——**这也说明为什么决定性 cap 比权重更可靠**。

#### 5.3.7 修复的边界（不要把它当成「模拟器问题解决了」）

| 还能绕过吗 | 怎么绕 | 成本 | 后果 |
| --- | --- | --- | --- |
| `generic_board_platform` | 把 `ro.board.platform` 写成真 SoC 代号（`pineapple` / `gs101` / `sdm845` / `mt6985`） | **极低：1 条 `setprop`**（雷神上已实测改成功） | 这条通道**当场失效**，但 `cpuInfo` 仍会响（[score_redteam_emulator_test.go:126](../backend/cmd/sigmark/score_redteam_emulator_test.go#L126) `TestRedteamOneRewriteIsNotEnough`；[:180](../backend/cmd/sigmark/score_redteam_emulator_test.go#L180) `TestRedteamCpuInfoSurvivesPlatformRewrite` 逐个代号验过） |
| `desktop_cpu_info` | 让 `/proc/cpuinfo` 报一个 ARM implementer 行 | **高**：`resetprop` 无效，要改 guest kernel 视角或 hook `open()` | 35 分**全靠这一条撑着** |

**成本是不对称的，这一点必须写清楚**：

> 攻击者不需要「同时伪造两条贵通道」。他只需要**做一件便宜的事**（改 `ro.board.platform`）+ **一件贵的事**（改 `/proc/cpuinfo`）。
>
> **而这两件里只有一件贵。** 换句话说：**规则的真实强度 = 一条硬通道，另一条随时可以一条命令清掉。**

**两条都改会怎样（这是规则的诚实上限，不是 bug）**：[score_redteam_emulator_test.go:159](../backend/cmd/sigmark/score_redteam_emulator_test.go#L159) 的 `TestRedteamFakingPlatformAloneIsCheap` 把 `boardPlatform` 改成 `pineapple`、`cpuInfo` 改成 ARM implementer 行，**结构性证据归零**。这条测试的注释写得很直白：「the rule must be honest about being defeatable by rewriting two readings」。

**所以这一条修复的准确描述是**：把「零成本绕过」变成了「**一条 `setprop` + 一处 `/proc` 伪造**」。它把成本从「零」抬到「需要一点工程」，**但没有关闭这条路**——而这是黑名单类判据能达到的上限。

**如果只记住一句**：`boardPlatform` 通道**不是承重墙**，它是**第二道便宜的筛子**。承重的只有 `cpuInfo` 一条。

#### 5.3.8 为什么这一条比前三条更值得记

前三条（§5.1、§5.2、§3.4.3）都是「**该看的没看**」：数据在报告里，规则没去读。

**这一条是「看的地方由对手提供」。** 这是**性质不同**的一类缺陷：修好前三条的思路（「补一条判据」）在这一条上**完全不成立**——补多少条名字匹配都没用，因为名字是攻击者填的。唯一的出路是**换通道**：去读**攻击者改起来更贵**的东西。

**但「换通道」这三个字要小心用**（这一节就是被这句话坑了一次）：`boardPlatform` 确实换了个问题，**但没换成本**。换通道只有在**同时换了数据来源**（属性 → `/proc` / 构建产物）时才算抬高了成本。方法论见 §8.1.2。

### 5.4 攻击成本清单：从 D 到「不 decisive」= **2 个字段**（**发现 5**，已实测）

前几节回答的是「**能不能绕过**」。这一节回答下一个问题：**要改几处。** 这个数字以前是感觉，现在是数出来的。

**按 `score.go` 的规则表逐条数，雷神报告当前 `D`（`decisive`）。要让它不 decisive，最小编辑集 = 2 个字段：**

| # | 字段 | 手段 | 成本 |
| --- | --- | --- | --- |
| 1 | `system.boardPlatform` | 一条 `setprop ro.board.platform` | **免费**（§5.3.4 实测） |
| 2 | `cpu.cpuInfo` | 改 guest kernel 对 `/proc/cpuinfo` 的输出 | **唯一贵的一步**（`resetprop` 无效） |

**但清掉两条决定性规则 ≠ 拿到 A。** 这个区分是本节存在的理由：

> **从 D 到「不 decisive」= 2 个字段。**
> **从 D 到 A = 2 个字段 + 让所有声明与实测自洽。**
>
> 把这两件事混成「改两处就能拿 A」是错的。

declaration 轴还有三条比对规则（`FOREIGN_PROFILE` 30、`OVERLAY_CODENAME_MISMATCH` 15、`HARDWARE_CHANNEL_CONFLICT` 30），它们比的是「**声明 vs 实测**」。要它们安静，得让两者**互相自洽**——那是另一批编辑，而且其中一部分读的**还是同一个 `/proc`**。

#### 5.4.1 完整计分通道表（这张表就是账本）

| 规则 | 分值 | 决定性 | 读什么 | 攻击者要做什么 |
| --- | --- | --- | --- | --- |
| `VIRTUAL_BUILD_MARKERS` | 35 | ✅ | `cpu.hardware` / `system.product` / `system.device` | 3 个属性（雷神已做完） |
| `STRUCTURAL_VIRTUAL_EVIDENCE` | 35 | ✅ | `cpu.cpuInfo` / `system.boardPlatform` | **1 个属性 + 1 处 `/proc`** |
| `HOOK_INJECTION` | 25 | | hook + mount 标签 | 1 个标签 |
| `DEBUGGER_ATTACHED` | 20 | | debugger + tracerPid | 1 个标签 |
| `SELINUX_PERMISSIVE` | 15 | | selinux 标签 | 1 个属性 |
| `ROOT_MANAGER_VISIBLE` | 12 | | root 管理器包 | 卸载 1 个包 |
| `MULTI_OPEN` | 8 | | 分身标签 | 1 个标签 |
| `FOREIGN_PROFILE` | 30 | | 声明 vs 实测 SoC | 让两者一致 |
| `OVERLAY_CODENAME_MISMATCH` | 15 | | overlay 代号 vs 设备 | 让两者一致 |
| `HARDWARE_CHANNEL_CONFLICT` | 30 | | 声明 vs 实测硬件通道 | 让两者一致 |

**这张表的用法**：它不是「绕过指南」，是**成本账**。每一行都回答「这条规则读几个字段、那几个字段由谁写」。**只有当「读什么」那一列是属性时，成本才是「改一下」；只要出现 `/proc`、EGL、构建产物，成本就跳档。**

#### 5.4.2 四个测试锁住这个账本

新增 [score_redteam_cost_test.go](../backend/cmd/sigmark/score_redteam_cost_test.go)（150 行，四个 Test）：

| 测试 | 锁什么 |
| --- | --- |
| `TestRedteamBillOfMaterialsForAnA`（[:40](../backend/cmd/sigmark/score_redteam_cost_test.go#L40)） | **中央测试**：两次编辑后两条决定性规则同时安静；若将来需要第三次编辑，成本上升，**必须显式更新** |
| `TestRedteamTheCheapEditAloneIsNotEnough`（[:81](../backend/cmd/sigmark/score_redteam_cost_test.go#L81)） | 只做免费编辑 → 仍被 `desktop_cpu_info` 抓住 |
| `TestRedteamTheExpensiveEditAloneIsAlsoNotEnough`（[:102](../backend/cmd/sigmark/score_redteam_cost_test.go#L102)） | 只做贵编辑 → 仍被 `generic_board_platform` 抓住 |
| `TestRedteamWhatTheRuleDoesNotPrice`（[:121](../backend/cmd/sigmark/score_redteam_cost_test.go#L121)） | **诚实的一半**：清掉决定性规则不等于清掉各轴 |

**中间两个测试的方向是相反的，这一点很重要**：一个证明「只花免费的钱没用」，一个证明「只做贵的事也没用」。**两者合起来才证明「两个字段是必需且充分的」**——只测一边的话，「最少 2 个」这个结论就有一半是猜的。

#### 5.4.3 这个数字的边界

- **它是 fixture 级的**：证明的是「规则读哪些字段」，**不是**「某个真实模拟器能不能做到」。真机 adb 实测在 §5.3.4 与 §10.9.5。
- **它只算到「不 decisive」**：A 的完整账单更长（见上），而 `TestRedteamWhatTheRuleDoesNotPrice` 就是提醒这一点的。
- **「2」这个数字会随规则增加而变**：`TestRedteamBillOfMaterialsForAnA` 里写死了 `propertyEdits, procEdits = 1, 1`，**将来规则变多时这条测试会先失败，逼你重新数**——这是有意的。

### 5.5 决定性 cap 的缺口

按「这个信号一旦命中，是否已经足以单独定性」逐一审：

| 信号 | 现值 | 应有 cap？ | 理由 |
| --- | --- | --- | --- |
| `VIRTUAL_BUILD_MARKERS` | **有**（[score.go:1032](../backend/cmd/sigmark/score.go#L1032)） | 有 | 模拟器/VM 声明 |
| `FOREIGN_PROFILE` | **有**（[:814](../backend/cmd/sigmark/score.go#L814)） | 有 | 正向识别另一颗芯片 |
| `IDENTITY_APP_UID` | **有**（[:885](../backend/cmd/sigmark/score.go#L885)） | 有 | 同一观察者两个接口说法不同 |
| `HOOK_INJECTION` | 无 | **应该有** | 进程内出现 Frida/Xposed 映射，在「设备是否被控制」这个问题上和模拟器同级。现在单条最高 91/B |
| `root_manager + hook + permissive + debugger` 组合 | 无 | **应该有** | 四项同时命中 = 一台正在被分析、已 root、且关闭了强制访问控制的设备，现在只有 **75/B** |
| `HARDWARE_CHANNEL_CONFLICT` 且含 `ram_dispersion` | 无 | **可以有** | 三个独立 RAM 通道互相差 > 8%（[hardware_facts.go:154](../backend/cmd/sigmark/hardware_facts.go#L154) 起），意味着框架在 RAM 上撒谎——这不是「疑点」 |
| `IDENTITY_SKU` | 无 | 不该有 | Pixel 6 上按 UID 分裂是已记录的真实行为（§6.3） |
| `FRESH_BOOT_ON_AGED_ROM` | 无 | 不该有 | 见 §4.3，它本身就该降级 |

**最刺眼的一条**：`HOOK_INJECTION` 是行为轴第二重的分支（25 分），却**不是**决定性；而比它轻的 `VIRTUAL_BUILD_MARKERS`（35 分，但同样是「环境不对」）是决定性的。这意味着**一台装了 Frida 的真机，比一台模拟器「更轻」**——而前者才是真实世界里针对这类 App 的常见攻击形态。

### 5.6 两条规则互相抵消

| 组合 | 现象 | 判断 |
| --- | --- | --- |
| `rom_verification`（verity off，0 分）+ `hook_injection`（`.magisk` 挂载，25 分） | 同一台 root 机器，**诚实的信号免费，模糊的字符串收费** | 方向反了。verity off 是「这台机器被解锁」的**确定性**证据，`.magisk` 是「路径里有个字符串」的**可能性**证据 |
| `FRESH_BOOT`（12 分，误报）+ `virtual_build_markers`（35 分，决定性） | 一个误报信号 + 一个真阳性信号，都进同一个 behavior/usage 体系 | 误报拉低 value，真阳性拉低 band，互不抵消但**都让 B 变挤** |
| `FRESH_BOOT` 与 **usage 覆盖率闸门** | 规则扣 12 分，闸门允许把整条轴删掉 → ~~净效果 **A**~~ | **真正的互相抵消**，而且**已被实测**：规则和闸门对同一台设备给出相反结论，闸门赢（§5.1、§10.2）。**本轮已修**：现在闸门仍让轴退出，但 R10 禁止 A，净效果 `100/B`——规则不再被闸门完全作废 |
| `virtual_build_markers` 同时「决定性」且「35 分」 | 命中时既 cap 到 D，又把 behavior 打到 65 | 无害的冗余，但要注意：如果将来有人把它的 35 分调成 0（认为「cap 已经够了」），模拟器的 value 会从 65 升到 100——**band 不变，value 变成满分**，排序会骗人 |

### 5.7 `band = A` 在数值上只有「恰好 100」一个点

契约写「A = 85–100」（[SECURITY-SCORE.md §5.6](SECURITY-SCORE.md)、R9；阈值表 [score.go:77](../backend/cmd/sigmark/score.go#L77) 的 `{bandA, 85}`）。实现上这个区间**不可观测**：

- 有扣分 → 该轴 < 100 → 加权 < 100 → value ≤ 99 → 若 ≥ 85 则被 R11 降 B（[score.go:477](../backend/cmd/sigmark/score.go#L477)）；
- 无扣分 → 所有计入的轴都是 100 → 加权 = 100（排除轴也是 100，归一化后仍是 100）。

所以 **`band = A` ⟺ `value = 100`**。85–99 这一段**永远进 B**。

**影响**：这不是算错，而是**文档在描述一个不存在的区间**。它会让读者以为「88 分可以是一致」，而 R11 的存在恰恰说明作者知道 88 不行。建议把 §5.6 的 A 行改成「100（且零扣分）」，并说明 85–99 只在「A 档被 R11 降级前的中间态」出现——现在这个中间态连日志里都看不到。

严重度 中（不影响判定，影响可读性与验收）。修复建议：改文档 + 在 `scoreBandThresholds` 上写注释，说明 `{bandA, 85}` 只是防御性下界，实际由 R11 收口。

### 5.8 15/12/8 在 ±5 噪声内，是否意味着只需防重簇？

**不意味着，而且结论正好相反。**

假设是：既然 15/12/8 分不开，攻击者只要防住重簇（hook 25 + debugger 20）就够了。

但攻击者的目标函数是 **R11 下的「零扣分」**，不是「低分」。所以：

- 防住重簇、留下 15+12+8 = 35 分 → behavior 轴 65 → value 88 → **R11 → B**。**失败**。
- 防住重簇、只留下 8 分（`multi_open`）→ value 97 → **R11 → B**。**还是失败**。

也就是说：**在 R11 下，「只防重簇」必然失败，必须把 12 条分支全部清空。** 重簇和轻簇的区别只在**value 的排序**（同为 B 档时谁更糟），对**能不能拿 A** 毫无影响。

那 ±5 噪声到底影响什么？只影响两件事：

1. **B 档内部的排序**（`value` 作为排序键），而 B 档由 R11 决定，排序只是展示；
2. **§9.3.1 的敏感性测试本身**——它断言「分簇」而不是「全序」，这是把标准降到数据支撑的高度，文档已经诚实标注了（[SECURITY-SCORE.md §13 F13](SECURITY-SCORE.md)）。

**所以正确的结论是**：15/12/8 的不可分辨**不是安全问题**（因为 R11 让它们无论怎么排都指向 B），**是排序质量问题**。攻击者不会去研究 15 和 12 的差别，他会直接读 §3.5 那张表。真正的防御资源应该花在「**让删证据变贵**」（§5.2、§5.1），而不是花在标定 15/12/8。

### 5.9 小账本缺陷（不影响定级，影响审计）

| # | 缺陷 | 位置 | 后果 |
| --- | --- | --- | --- |
| 1 | 契约文档仍写 `sigmark-score/1`，代码已是 `/4`（`profileVersion /9`） | [SECURITY-SCORE.md](SECURITY-SCORE.md) 标题与 §8 示例 vs [score.go:51](../backend/cmd/sigmark/score.go#L51)、[device_profile.go:25](../backend/cmd/sigmark/device_profile.go#L25) | **已修复**：前端已升 `/3`，契约文档正在同步（lead 说由另一位队友处理）。本条保留作追踪 |
| 2 | `undetermined` 把「读到了但不一致」报成 `UNAVAILABLE` | [score.go:607](../backend/cmd/sigmark/score.go#L607) 的 `scoreUndeterminedFor`：所有行都 AVAILABLE 时 `gap.Keys` 为空，随后回落到 `scoreAvailableKeys`，reason 仍是 `UNAVAILABLE` | 身份标签因「有一对不可比」而 `insufficient` 时，`undetermined` 会把**可读的 key** 标成 `UNAVAILABLE`。管理员看到的是「这些字段没读到」，而真相是「这些字段读到了、但凑不成完整比对」。审计线索自相矛盾 |
| 3 | `hit` 标签没有可读行时，`keys` 回落到全部 key | [score.go:553](../backend/cmd/sigmark/score.go#L553) 的 `scoreAvailableKeys` | R1 名义上满足（有 key），但引用的 key 从没读到过；`detail` 的证据摘要为空，变成「…不是 none：」后面什么都没有 |
| 4 | `usageAxis` 直接读原始 `Parameter`，绕过 `profileSignals` | [score.go:1119](../backend/cmd/sigmark/score.go#L1119) 起 | 与文件头注释「nothing re-reads a raw parameter」（[score.go:17](../backend/cmd/sigmark/score.go#L17)）矛盾。文件头自己承认了这个例外（[:351](../backend/cmd/sigmark/score.go#L351)），但例外在 `/2` 之后从 2 个字段涨到 3 个，漂移风险随之变大 |
| 5 | `detail` 的「已满 3 年」按年份整数算 | [score.go:1197](../backend/cmd/sigmark/score.go#L1197)、[:1210](../backend/cmd/sigmark/score.go#L1210) | 最多虚报约 1 年（§4.3 末尾） |
| 6 | `usageAgedRomFallbackYear` 硬编码 2021 | [score.go:203](../backend/cmd/sigmark/score.go#L203) | 只在 `capturedAt <= 0` 时生效（[:1232](../backend/cmd/sigmark/score.go#L1232)），但那是「硬编码年份」的残余。目前不可达，属于**潜在复发点** |
| 7 | `axisBlind` 只记**第一个**盲轴（[score.go:424](../backend/cmd/sigmark/score.go#L424) 的循环里 `break`） | 同上 | 两条轴同时盲时只暴露一条。对 band 无影响（都是禁止 A），但对排障有影响：管理员看不到「另外那条也盲了」 |
| 8 | 新测试的日志串与断言自相矛盾（**已修**） | [score_redteam_test.go:92](../backend/cmd/sigmark/score_redteam_test.go#L92) 原写「deleting it publishes no number」，而同一测试断言 `deletedScore.Band == bandB` 且 `value = 100` | **已修复**：文案改为印实际数字「97/B vs 100/B」，并说明「**数字仍会出版**（轴退出后归一化不可避免），**结论靠 band 锁死**」。**方法论：日志文案也是一种断言**——未经验证的文案会变成后人引用的**假证据**，这比代码错更难发现，因为它看起来像是记录而非判断 |

---

## 6. 攻击成本汇总

按「拿到 A 需要几步」排序：

| 路线 | 步骤数 | 需要 root | 需要改 ROM/内核 | 备注 |
| --- | --- | --- | --- | --- |
| 表外 SoC + 空 `ro.product.name` + DenyList + 三个开关 | **8** | 是 | 否（属性层即可） | §3.5，成本最低 |
| 只求「不判 D」（`?` 也算过关） | **2** | 是 | 否 | 表外 SoC + 空 `ro.product.name` |
| 只求「usage 不扣分」 | **1**（修复前 **0**，删两个属性即可） | 是 | 否 | **修复后必须写一个可信的假 `bootCount`**，删空只到 `100/B`（§10.2） |
| 只求「身份冲突不被抓」 | **已无效** | 是 | 否 | **修复后洗白不再是收益**：删掉一个属性得到 `90/D`，与留着不一致完全相同（§5.2.5 实测四组）。**这条路线已关闭** |
| 伪装成第三方模拟器（把三个名字填成合法真机值） | **修复前 0 步 → 修复后 1 条 `setprop`（`ro.board.platform`）+ 一处 `/proc/cpuinfo` 伪造** | 否（模拟器自带） | **`boardPlatform` 不用改 ROM**；`/proc` 要改 guest kernel 视角 | §5.3 实测：修复前 `?`、修复后 `D`。**成本是不对称的**：`boardPlatform` 一条命令就清，`cpuInfo` 才是真门槛（§5.3.4 实测对照） |
| 老实声明 `mt6985` 的伪装机 | — | — | — | **必被判 D**（§9.1.1 实测 82/D） |

最后一行是关键：**攻击成本与「是否老实声明」负相关**。目前最容易被抓的，是**最不用心的那批改装机**；稍微读一下规则的人，反而能拿 A。

**四轮修复带来的成本变化**：

| 修复 | 抬高了什么 | 没抬高什么 |
| --- | --- | --- |
| R10 两层（§5.1） | 「删 usage 输入」从 **0 步** → **1 步**（必须伪造一个可信的 `bootCount`） | 「改」的成本 |
| 单侧身份证据（§5.2） | 「删 identity 一侧」从 **1 步有效** → **0 收益**（删了等于不删） | 「改」的成本，以及「让整个通道消失」的成本 |
| 结构虚拟化证据（§5.3） | 「伪装成第三方模拟器」从 **改三行属性** → **改四行属性 + 一处 `/proc` 伪造** | **`boardPlatform` 那一行没抬高成本**——它本来就是属性（§5.3.4 实测）。真正抬高的只有 `/proc/cpuinfo` 那一处 |
| **成本量化（§5.4，发现 5）** | 把「从 D 到不 decisive」从**感觉**变成**数字**：**2 个字段**（1 免费 + 1 贵） | **没有抬高任何东西**——这一轮只数账，不改规则。**它甚至暴露了成本比想象的低**：真正要付的只有一处 `/proc` |

**第四行是这一轮唯一「没有抬高成本」的修复，而它的价值恰恰在这里**：前三行都在说「我们让攻击变贵了」，第四行说的是「**贵了多少，是可数的**」。**一个可数的成本比一个形容词有用**——它能让下一轮判断「值不值得再修」时有个分母。

**这张表最重要的一格是最后那行的「没抬高什么」**，而且我第一版在这里写错了：

- 我原来写「两条通道都在模拟器厂商的控制范围内」，把它们并列成**两个同等成本的门**；
- **实际是「一道硬门 + 一道纸门」**：`cpuInfo` 要 hook 文件读或改内核视图（贵）；`boardPlatform` 是 `ro.board.platform` 属性，**一条 `setprop` 就清掉**（雷神上已实测）。

**所以 §5.3 的准确说法是**：把门槛从「改三行属性」抬到「**改四行属性 + 一处 `/proc` 伪造**」——**抬高全部来自那一处 `/proc`**。诚实地说：**黑名单类判据的天花板就在这里**，而且这个天花板比第一版写的要低一点。

**注意这张表的上半部分仍然全是「改」**：§3.5 那条 8 步路线走的全是属性改写，不是删证据。所以前四轮修复**没有改变**成本表的前两行——**「改」比「删」贵，而目前我们只给「删」定过价。**

---

## 7. 如果只修三件事（本轮已关闭三件，列表重排）

按「修了之后攻击成本上升最多」排序，每条都只改判定、不改采集。**本轮已完成三件**（R10 两层、单侧身份证据、结构虚拟化证据），所以列表重排：**未登记 SoC 仍是第一**——它是现在唯一还能「一步到 A」的未决项；**第二变成「补采 `ro.boot.qemu`」**——因为这台模拟器自己都承认了，我们却没读。

### ✅ 已完成 ①：给「删证据」定价——R10 推广为两层

**问题**：usage 轴删两个属性就能整条退出加权，删证据比留证据高 3 分并跨一个 band（§5.1）。

**落地形态**（[score.go:424](../backend/cmd/sigmark/score.go#L424)、[:494](../backend/cmd/sigmark/score.go#L494)）：`declaration` 轴盲 → 不出版数字（`?`）；`behavior` / `usage` 轴盲 → 数字照发、禁止 A（降到 B）。

**实测**：`97/B`（留证据）vs `100/B`（删证据）——升档通道关闭（§10.2）。全库 23 份真实报告**判定零漂移**（A:4 / D:8 / B:4 / ?:7）。

**残留**：数字仍是 100，只看 `value` 的消费方会把「删干净的设备」排在干净设备旁边。所以 `band` 必须继续是唯一被当作结论的字段。

### ✅ 已完成 ②：单侧身份读数本身就是证据

**问题**：删掉一对身份读数的一侧，`compared` 掉到 2，标签转 `insufficient`，扣分与决定性 cap 一起消失——实测可从干净基线 `100/A` 洗回 `100/A`（§5.2、§10.8）。

**落地形态**：`oneSidedIdentity`（[identity_consistency.go:70](../backend/cmd/sigmark/identity_consistency.go#L70)）+ 四个跳过条件（`NOT_ARCHIVED` / 非 `AVAILABLE` / 两侧都空 / 两侧都可读）。命中 → `identity_conflict` 置 `hit`，附 `identity_asymmetry` 证据行，照样收 25 分与决定性 cap。

**实测**：`90/D` → 洗白 `90/D`（不再回到 `100/A`）。`profileVersion /8 → /9`、`scoreVersion /2 → /3`，全库 23 份**零漂移**。

**残留（重要）**：只覆盖 identity 这一对。overlay / SELinux / SoC 画像 / `virtual_build_markers` **只有一个观察者**，没有对照物可判「不对称」，所以同一个手法在它们身上仍然有效（§5.2.6）——这就是下面第四件事要连在一起做的原因。

### ✅ 已完成 ③：不再问「名字像不像」，改问「设备自不自相矛盾」

**问题**：`virtual_build_markers` 只读三个键，而这三个键由模拟器自己填。**真实 LDPlayer 9 实测**：把三个键填成 `qcom` / `RMX5010` / `unicorn`，35 分 + 决定性 cap 直接归零，`band = ?`（§5.3、§10.9，报告 `ce1bdc7f…`）。

**落地形态**：[virtual_evidence.go](../backend/cmd/sigmark/virtual_evidence.go) 两条**非黑名单**通道——`desktop_cpu_info`（`/proc/cpuinfo` 透传，**贵**）与 `generic_board_platform`（`ro.board.platform` 属性，**便宜**），各带一个防误伤闸门（`implementer 0x` 与「不认识就不算证据」）。

**实测**：`?` → **`D`**，`decisive = false → true`，走同一个 `DECISIVE_VIRTUAL_BUILD` cap；与黑名单规则**互斥**（一因一果）。`scoreVersion /3 → /4`，`profileVersion` **不动**（标签层没变）。

**残留（必须说清，而且这里我第一版写错了）**：**它抬高了成本，没有关闭这条路——但抬高的成本全部来自一条通道。**

- `cpuInfo` 是 `/proc` 透传，`resetprop` 无效，要 hook 文件读或改内核视图（**贵**）；
- `boardPlatform` 是 `ro.board.platform` **属性**，**一条 `setprop` 就清掉**（雷神上实测，§5.3.4）。

**所以真实强度是「一条硬通道 + 一条软通道」，不是两条。** 我第一版把 `boardPlatform` 写成「构建产物、改它要重打包 system 分区」，**那是错的**——它和 `cpu.hardware` 同一个价位。**黑名单类判据的天花板就在这里，而且比第一版写的更低**（§6 末、§5.3.4、§5.3.7）。

### 第一件：把「未登记 SoC」从「干净」改成「未知」，并让它可见

**问题**：声明表外 SoC 会让 5 条硬件通道静默跳过，标签仍报 `not_observed`（§3.4.2）。它同时是**绕过**和**反向激励**，触达面最广（世界上绝大多数机型不在那 5 颗里），而且**它是现在唯一还能「一步到 A」的未决项**。

**修法**：`hardwareFactsLabel` 在 `known == false` 时，不要只留 `ram_dispersion` 就下 `not_observed`；应当把「声明侧无法解析」本身记成一条**未决**（`undetermined` 里的第六个 reason，例如 `DECLARATION_UNRESOLVED`），并且**不让这个标签进入 coverage 分子**。这样「声明一颗没人认识的 SoC」的结果是覆盖下降、`?`，而不是满分。

**为什么仍是第一**：身份洗白和结构虚拟化都修掉之后，这条是**剩下的唯一「低成本 → A」路径**；而且它和 §5.2.6 那个结构性问题是同一个：**单通道读数没有第二观察者**。修它的同时应该把 SoC 的三条通道（`cpuParts` / `cpuCapacity` / `cmaTotal`）做成互相印证，这样「声明表外」与「删一条通道」才会落到同一个结论上。改动局限在 `hardware_facts.go` + 一个 reason 枚举，不动权重、不动 band。

### 第二件：接上三条**已经被现场证明有用、却进不了报告**的证据（**采集缺口**）

**问题**：这台 LDPlayer 有**三条**现成的、几乎零误报的模拟器证据，**一条都没有进入归档报告**。但它们的断点**不是同一个**，混着说会误导下一次修——所以必须分开写：

| 证据 | 现场值 | 采集端 | 投影 | Go 白名单 | 断在哪 |
| --- | --- | --- | --- | --- | --- |
| `ro.boot.qemu` / `ro.kernel.qemu` | `1`（主动自曝） | **没有**（`SafeReader.Property` 枚举里两个都没有） | 无 | 无 | **压根没采** |
| `Build.FINGERPRINT` | `Xiaomi/unicorn/unicorn:14/...` | **有**（[DeviceCollectors.kt:108](../app/src/main/java/com/sigmark/app/collector/DeviceCollectors.kt#L108)） | **没有**（`LanDetails.kt` 的 `system` 投影集合里没有它） | **没有**（`field_dictionary.go` 里搜 `fingerprint` 零命中） | **采了没上传** |

**两条断点的区别很关键**（这是本轮最容易被误判的地方）：

- **`ro.boot.qemu` 是「压根没采」**：枚举里就没有这个 Property，采集器根本不去读。
- **`Build.FINGERPRINT` 是「采了没上传」**：App 侧明确读了（[DeviceCollectors.kt:108](../app/src/main/java/com/sigmark/app/collector/DeviceCollectors.kt#L108)，还带了「应用进程视角；可能与 ADB 属性不同」的注释），但**投影集合没配、Go 白名单没加**，于是它在序列化时被丢掉，归档里**连这个字段都不存在**。

**实测确认（lead 拉的雷神报告全 195 字段）**：`key` 里 **`fingerprint` 一个都没有**；只有 `system.brand = realme`、`system.manufacturer = realme`、`system.socManufacturer = AOSP`。

**所以「指纹写 `Xiaomi` 而 brand 写 `realme`」这条现成矛盾，现在任何后端规则都读不到——不是规则漏读，是字段压根不在报告里。** 把它写成「有判据没读」会是错的。

**这个字段的取证价值**：模拟器厂商会记得改 `ro.product.brand`，但**不一定会让 `Build.FINGERPRINT` 的品牌段跟着改**——那是一整个拼好的字符串。所以「`brand` 与指纹首段不一致」是一条**结构上极难同时伪造**的矛盾（正好是 §8.1.2 里「交叉矛盾」那一类）。

**修法（五层，缺一不可）**：

| 层 | 改什么 |
| --- | --- |
| ① 采集（qemu） | `SafeReader.Property` 枚举加 `ro.boot.qemu`、`ro.kernel.qemu`（两者任一为 `1` 即命中） |
| ② 投影（两条都要） | `LanDetails.kt` 的 `system` 集合加 `fingerprint`；qemu 属于 `ro.*` 属性组，按现有分组接入 |
| ③ 契约（两条都要） | `field_dictionary.go` 加 key、`protocol.go` 加白名单判定 |
| ④ 字段集版本 | **`latestFieldSet 25 → 26`**（[field_dictionary.go:8](../backend/cmd/sigmark/field_dictionary.go#L8)） |
| ⑤ **`maxFields` 档位**（见下，最容易被忘） | **新增一档 `if p.FieldSetVersion >= 26 { maxFields = 235 + 新增固定键数 + 24 }`**（[protocol.go:574](../backend/cmd/sigmark/protocol.go#L574) 那一段的写法照抄） |

**第 ⑤ 层为什么必须单独列出来**：`maxFields` 不是单值，是**逐档递增**的（[protocol.go:556](../backend/cmd/sigmark/protocol.go#L556) 起：`>=19`→246、`>=20`→248、…、`>=25`→259）。所以加字段时**只改 `latestFieldSet` 而不加档位，字段集 25 的历史报告会因为超出 259 而校验失败——全库历史报告读不出来**。

**这就是「四层之外还有第五层」**，而且它和前几轮那条 lock-step 是同一类约束：

| 版本 / 档位 | 位置 | 不同步的后果 |
| --- | --- | --- |
| `dictionaryVersion` | `field_dictionary.go` | 字典与采集端不一致 |
| `latestFieldSet` | `field_dictionary.go:8` | 新字段被判为非法 |
| **`maxFields` 档位** | `protocol.go:556` 起 | **历史报告超出上限，读不出来**（不是新报告，是**旧报告**） |
| `profileVersion` | `device_profile.go:25` | 标签状态映射漂移 |
| `scoreVersion` | `score.go:51` | band 判定漂移 |

**注意「不写死数字」**：`235 + 新增固定键数 + 24` 里的「新增固定键数」取决于最终加几个 key（加 `fingerprint` + 两个 qemu = 3 → 262；若两个 qemu 合并成一个 = 2 → 261）。**这个数要等字段真正定下来再填，不要照抄任何一个具体数字。**

**连带要改的断言**（下一轮动手时别忘）：[protocol_test.go:417](../backend/cmd/sigmark/protocol_test.go#L417) 的注释写着「maxFields for field set 25 is 259: these 235 static keys plus 24 partition rows」，而 [protocol_test.go:418](../backend/cmd/sigmark/protocol_test.go#L418) 是**硬断言** `len(meta) != 235` → `t.Fatalf`。**加 3 个 key 会让这条测试直接失败**，所以它其实是「字段集升级时的一道闸门」——**它挡住你不是坏事，是提醒你第 ⑤ 层还没动。**

**为什么排第二**：它不改变任何现有判定，只是**把三条已知正确的判据接上**。收益极高、风险极低（`ro.boot.qemu` 在真机上不存在，读到 `NOT_ARCHIVED` 即可；`Build.FINGERPRINT` 真机上一定存在，`brand` 与首段本来一致，不会误伤）。它排在 SoC 之后，只因为 SoC 是**已存在判据被绕过**，而这条是**判据还没接上**——但**它应该和 SoC 同一轮做**。

**注意**：`ro.boot.qemu` 不能替代 §5.3 的结构判据——它也是一行 `resetprop -d` 就能删的，**便宜、准确，但同样由对手控制**（§8.1.2 的老问题）。相比之下 **`Build.FINGERPRINT` 的品牌矛盾更值钱**：它要伪造必须重拼整个指纹串，而且还得和 `system.brand` 对得上。

### 第三件：把 `FRESH_BOOT_ON_AGED_ROM` 降为展示不计分（U2 注释部分已完成）

**问题**：它把最合法的动作（恢复出厂）当成最可疑的动作，且随设备年龄单调误报（§4.3）。而 R11 让它直接把设备打到 B。

**修法**：U1 立即降为 0 分（保留展示与 `detail`，把「矛盾」改成「少」）；U2 在补上「`initialSdk` 与 `Build.VERSION.SDK_INT` / SoC 画像的交叉校验」之前不参与计价。

**注意**：U2 的注释**已经改正**（[score.go:218](../backend/cmd/sigmark/score.go#L218) 起），「撤回不可伪造声明」这半件事**已完成**；剩下的是计价口径本身。

**为什么排第三**：它不产生安全漏洞（是误报不是漏报），但它**污染了整个 usage 轴**，并且让「B 档」彻底失去区分度。修它的收益是让 band 重新有信息量——而这正是 R9「band 才是结论」的前提。它排在前面两条之后，只因为它是**误报**（不影响攻击者），而前两条是**绕过**。

### 第四件：给每个「单观察者」通道找第二个独立来源

**问题**：§5.2 的修复之所以能成立，是因为 identity 有**三对独立来源**可以对照。overlay 代号、SELinux 取值、`virtual_build_markers` 三个键、SoC 画像——**每一条都只有一个观察者**，所以「它消失了」和「它本来就是干净」在打分器眼里永远等价（§5.2.6）。这不是修法不够狠，是**信息结构上缺对照物**。

**修法**：不是再加一条不对称判据，而是**补第二来源**：

| 通道 | 现状 | 可用的第二观察者 |
| --- | --- | --- |
| overlay 代号 | 只有 RRO 命名 | 构建指纹里的 `ro.<part>.build.date.utc` 与 overlay 资源包的创建时间；或 `system.device` 之外的 product/vendor 分区代号 |
| SELinux | 只有 `enforce` 节点 | `getenforce` 输出 + `ro.boot.selinux` 属性双读，两者必须一致 |
| `virtual_build_markers` | `cpu.hardware` / `system.product` / `system.device` | **§5.3 已经给出了第二条路**（`cpuInfo` + `boardPlatform`），这条已部分完成；剩下的问题是「清空输入」那一形态（发现 4）——应当改成「少一个 → 已读到的键若全是否定，则按 `not_observed` 但标 `undetermined`」 |
| SoC 画像 | `cpuParts` / `cpuCapacity` / `cmaTotal` | 这三条已经互为对照（所以 `FOREIGN_PROFILE` 才有意义）；缺的是「表外 SoC」时**不让它们静默跳过**（即第一件） |

**为什么排第四**：它比前三件重（要动采集或要动字段集），但它是**唯一能根治「删一侧」这一整类手法**的方向——不补第二观察者，就只能像本轮这样**一条一条地堵**。

---

## 8. 未验证清单（诚实边界）

**§1–§9 的结论**都是代码审查 + 手算，下表条目**没有**真实设备样本，必须补测才能当结论用。**§10 里的七条已经实测**（其中六条在合成 fixture 上、一条是**真实模拟器端到端**），所以第 5、6、11、13 行标为「已实测」；其余仍待真机验证。

| # | 待验证 | 怎么验 | 预期 |
| --- | --- | --- | --- |
| 1 | 表外 SoC 是否真的让 `hardware_declaration_conflict = not_observed` | 模拟器上 `setprop ro.soc.model sm7325` 等四个键，跑一次采集 | 标签 `not_observed`、`basis` 只有 `ram_dispersion`、`undetermined` 为空 |
| 2 | 空 `ro.product.name` 是否真的把 `virtual_build_markers` 转成 `insufficient` | 同上，加 `setprop ro.product.name ""` | 标签 `insufficient`、无 cap、behavior coverage 5/6 |
| 3 | Magisk DenyList 后 `.magisk` 是否真的从 `mountinfo` 消失 | DenyList 勾 SigMark，采集一次 | `hookSignals = none`、`rootMountHints = none` |
| 4 | 重命名 gadget 后 `hookSignals` 是否漏检 | 把 `libfrida-gadget.so` 改名成 `libutils.so` 注入 | `none`（预期漏检） |
| 5 | 空 `ro.product.model` 是否真的把 identity 转成 `insufficient` | Pixel 6 上 `resetprop ro.product.model ""` | **这个问题已经被修复改写了**：空白一侧现在是 **`hit`**（`identity_asymmetry`），不再是 `insufficient`。**已在四个 fixture 上实测（§10.3、§10.7、§10.8）：修复前 `insufficient` 且扣分/cap 消失，修复后 `hit` 且 `90/D` 守住**；真机待验 |
| 6 | 删日期 + `first_api_level` 后 usage 轴是否整条退出 | 同上 | usage `score = null`、coverage 0、value 100。**已在 MI 8 fixture 上证实（§10.2）：cov=0、score=100、无扣分、band B** |
| 7 | `resetprop ro.product.first_api_level 35` 是否让 U2 失效 | 老机改成 35，采集 | usage 100、coverage 1.0、无扣分 |
| 8 | 2021 老机恢复出厂后的真实打分 | 真机重置后采集 | 97/B（验证 §4.3 的误报判断） |
| 9 | 2017 老机刷最新 ROM 后是否被 U2 判 B | 同上，`first_api_level = 26/27` | 97/B |
| 10 | 年份整数比较造成的「虚报满 3 年」 | 构造 2023-12-31 分区 + 2026-01-02 采样 | `detail` 写「已满 3 年」而实际 2 年 2 天 |
| 11 | **基线为 `100/A` 时洗白是否回到 `100/A`** | 把 `memory.kernelMemTotal` 改成 `11.20 GiB`（消掉 `ram_dispersion` 冲突），其余不动 | **已实测 = 是（修复前）/ 否（修复后）**：修复前 `100/A → 90/D → 100/A`（§10.8 实验三）；修复后洗白停在 **`90/D`**。「删一个属性 = 完整伪装」在修复前成立，现已关闭 |
| 12 | **`overlay` / `SELinux` / `virtual_build_markers` 三条通道是否同样可被「删一侧」擦除** | 各构造一对「两侧本应都有值」的读数（若存在），或直接构造「让唯一来源消失」的样本 | **预期仍可擦除**（§5.2.6：这三条只有一个观察者，没有「不对称」可判）。**这是当前最重要的未验证项**——修复只覆盖 identity 一对 |
| 13 | **第三方模拟器改写三个名字能否绕过 35 分决定性规则** | LDPlayer 9 实跑采集上传（已做，报告 `ce1bdc7f…`） | **已实测 = 能（修复前）/ 不能（修复后）**：修复前 `band = ?`、`virtual_build_markers = not_observed`；修复后 **`D`** + `DECISIVE_VIRTUAL_BUILD`（§5.3、§10.9） |

**已知的正面证据**（不是本文的结论，但支撑了 §3.1 表里的几行）：EMULATOR-LAB §7.3【已实测】证明六条行为分支**都会响**（`.magisk` 挂载 → 25、第二用户 → 8、`setenforce 0` → 15、Magisk 空壳包 → 12、`strace` → 20、全六条 → clamp 0），以及 §7.2【已实测】证明决定性 cap 在低覆盖下仍然压 D。**「会响」和「躲不掉」是两件事**，本文质疑的是后者。

### 8.1 五条方法论教训：**精确回到基线**、**自洽≠干净**、**成本看数据来源不看问题**、**缺失≠漏读**、**改一处≠改完**

这一轮我们连续两次被污染的样本骗了，而且第三次才拿到决定性结果，值得整节写下来：

| 实验 | 样本 | 结果 | 为什么不可用 |
| --- | --- | --- | --- |
| 实验一 | 真实 Pixel 6 证据 | 洗白后 `82/D` | 样本自带 `FOREIGN_PROFILE` 30 + overlay 不一致 15，**这些与洗白无关**，所以「仍是 D」什么也证明不了 |
| 实验二 | 「隔离干净设备」 | 洗白后 `88/B` | 样本的 `memory.kernelMemTotal` 与另两个 RAM 读数差 38%，触发 `HARDWARE_CHANNEL_CONFLICT` 30，**基线因此是 88/B 而不是 100/A** |
| 实验三 | 真正的干净基线（改掉那一个内存读数） | 洗白后 **`100/A`** | **决定性**：污染源被移除后，预测逐字复现 |

两次的错误是同一个：**用一个自带其它问题的样本去测单点，结果被污染了还不知道。**

**判据**（建议写进任何后续实验的验收条件）：

1. **基线必须先独立验证**——基线本身必须是你期望的那个形态（这里应该是 `100/A`，零扣分）。如果基线不是，说明样本已经被别的东西污染了。
2. **只动一个变量**，且改动必须是可逆的。
3. **改动后必须能精确回到基线**——这一条最有信息量：**只有能精确回到基线，才证明你动的确实是那个变量**；如果回不到基线，说明还有第二个东西在动。反过来，**「能精确回到基线」本身就是最强的证据**：它证明「删掉这个字段」与「这个字段从未冲突」在打分器眼里完全等价——**这正是本漏洞的准确表述**。

#### 8.1.1 「自洽≠干净」：用算术自洽性校验测量设计

实验二是怎么被识破的？**不是靠再跑一次测试，是靠把最后的 `value` 反推回权重表。**

三个数字（`88 / 78 / 88`）在当时被解读为「洗白只能到 B」。我的做法是问了一句：**这三个数字在什么前提下才自洽？**

```
88 = (40×70 + 35×100 + 25×100) / 100   → 声明轴必须是 70，即恒有 30 分扣分
78 = (40×45 + 35×100 + 25×100) / 100   → 45 = 70 − 25，即恒有 30 分 + identity 25
洗白 88                                  → 回到 70，说明那 30 分与洗白无关
```

三条同时成立**只在**「存在一个恒定的、非 identity 的 30 分声明轴扣分」时可能。而 30 分在声明轴上**只有一个候选**（`HARDWARE_CHANNEL_CONFLICT`），于是回头去找它从哪来——找到 `kernelMemTotal` 那 38% 的离散度。**污染不是被测试发现的，是被算术逼出来的。**

这与本文另外两条教训是同一族：

| 教训 | 说法 | 出处 |
| --- | --- | --- |
| **非空≠对** | 字段有值不等于值正确；`basis` 非空不等于比对过 | §3.4.2、§5.9 |
| **有数字≠有口径** | 报告里有 `value` 不等于这个数字回答了你以为的问题 | §5.7、§6 |
| **自洽≠干净** | **结果能自圆其说，不等于测量对象是干净的**——多个模型可能同时解释同一组数字，而此时唯一能分辨的办法是**把模型算出来，看它要求什么前提** | §8.1.1 |

**所以「用算术自洽性反查实验设计」是一个可复用的手法**：拿到一组实测数字，先写出「它必须成立的那个前提」，再看那个前提在样本里能否被独立确认。如果它只能被假设、不能被验证——**那这组数字就还没资格当证据。**

这一条与我在 `SECURITY-SCORE.md` 行号上犯的错是同一个：**没有先验证基线，就去解释差异。**

#### 8.1.2 「黑名单的输入由对手提供」：成本看**数据来源**，不看判据问什么

前三次漏洞（§5.1、§5.2、§3.4.3）都是**「该看的没看」**：数据明明在报告里，规则没去读。修法很清楚——补一条判据。

**第四次（§5.3）不是这一类。** 数据看了，判据也有，35 分也定好了——**但判据的输入是被审查者填的**。`virtual_build_markers` 问的是「这三个名字像不像模拟器」，而这三个名字**由模拟器自己选**。它回答「不像」，规则就只能接受。

这是黑名单类判据的**结构性缺陷**，与实现质量无关：

| 判据类型 | 输入由谁提供 | 绕过成本 | 例子 |
| --- | --- | --- | --- |
| **属性匹配**（黑名单） | **被审查者**（`resetprop` 随手改） | **零** | `virtual_build_markers`（§5.3.2）、**`generic_board_platform`** |
| **内核/文件透传** | 内核，被审查者要 hook 才能改 | 中 | `cpu.cpuInfo`（§5.3.4） |
| **构建产物** | 镜像打包时固定 | 低（属性层）到中（重打包） | （**本轮没有真正的例子**——`boardPlatform` 我原以为属于这一类，实测是属性，已移到第一行） |
| **交叉矛盾** | 无单一提供者——**两条独立通道必须同时撒谎** | **乘法** | 结构虚拟化证据（§5.3）——**但注意它实际只有一条硬通道，见下** |

**这张表我第一版填错了一格，而且错得很关键。**

我把 `system.boardPlatform` 归到了「**构建产物**」——理由是「真机这里是 SoC 代号，改它要重打包 system 分区」。听起来很合理，**但没查采集侧**。实际是：

```kotlin
declaredProperty("boardPlatform", "ro.board.platform", "平台代号声明", ...)   // DeviceCollectors.kt:129
```

**它就是一个属性。** 雷神上 `setprop ro.board.platform test_probe` → `getprop` 立刻返回 `test_probe`。**和 `cpu.hardware` 同一个价位。**

**所以这里要补一条比原来那句更准的判据**：

> **「判据问的问题不同」≠「判据更难满足」。**
>
> 判断一条判据的成本，看**数据从哪来**（属性 / `/proc` / 构建产物），**不是看它问什么**。
>
> `boardPlatform` 确实问了一个新问题（「这个平台串像不像 SoC 代号」），但它照样是一个属性，照样一条 `setprop` 就清掉。**换个问题不等于换个成本。**

**这也削弱了「交叉矛盾 = 乘法」这个说法**：结构虚拟化证据表面上两条通道，但**只有一条贵**。所以它的真实成本不是「两条都要改」，而是「**改一条便宜的（`setprop`）+ 改一条贵的（`/proc`）**」——**乘法只发生在两条都贵的时候。** 一条贵一条便宜，乘法的效果就退化成加法。

**结论（可复用，已修正）**：设计判据时问两句——

1. **「这条判据的输入，对手改起来要花多少？」**（原来只有这一句）
2. **「它问的问题是不是只是换了个说法，数据来源其实没变？」**（这一句是补的，`boardPlatform` 就是栽在这里）

- 如果数据来源还是 `ro.*` 属性，那**换多少个问题都是同一个成本**，只是提高了对手的阅读理解成本，不是安全边界；
- 真正的边界来自**数据来源换成对手改不动的层**（`/proc` 透传、构建产物、内核状态），**或者**两条**都贵**的独立通道同时撒谎（乘法），**或者**改了就会暴露另一处矛盾（交叉校验）。

**这一条与 §5.2 的修复是同一个道理的两面**：identity 之所以能修，是因为它有**三对独立来源**——对手要同时改三对，成本是乘法；overlay / SELinux 之所以修不了，是因为它们**只有一个观察者**（§5.2.6）。**「有几个独立观察者」是这套体系里唯一真正决定强度的那件事**，权重和阈值都不是。

**给下一轮的验收问题**（建议每次都问）：

1. 这条判据读的字段，**谁写的**？对手能不能改？改一次要几步？
2. 它有没有**第二个独立来源**可以对照？如果没有，那它就是「对手说没事就没事」。
3. 它失败时，报告里留下的是**「没读到」还是「读到了但矛盾」**？前者可以被主动制造（§5.2），后者不能。

#### 8.1.3 「采了但没上传」与「压根没采」在归档层看起来完全一样

这一条是 §10.9 逼出来的，而且**差点被我写错**。

我最初看到雷神的 `Build.FINGERPRINT = Xiaomi/...` 而 `brand = realme`，第一反应是「**有规则没读它**」。lead 去查了采集链路，真相是：

| | `ro.boot.qemu` | `Build.FINGERPRINT` |
| --- | --- | --- |
| 采集端 | **没有**（`SafeReader.Property` 枚举里就没有） | **有**（[DeviceCollectors.kt:108](../app/src/main/java/com/sigmark/app/collector/DeviceCollectors.kt#L108)） |
| 投影 | 无 | **无**（`LanDetails.kt` 的 `system` 集合没配） |
| Go 白名单 | 无 | **无**（`field_dictionary.go` 零命中） |
| 归档报告 | 不存在 | **不存在** |
| 真实断点 | **压根没采** | **采了没上传** |

**在归档层看，两者一模一样：字段缺失。** 而「字段缺失」这个现象可以对应**至少四种**完全不同的原因：

| # | 原因 | 该改哪 | 归档层能区分吗 |
| --- | --- | --- | --- |
| 1 | 设备上本来就没有这个属性 | 什么都不用改 | 不能 |
| 2 | 采集器没读（枚举/白名单缺） | App 采集层 | 不能 |
| 3 | 采了但投影没配 / 字典没加 | 投影 + 契约层 | 不能 |
| 4 | 采了、传了，但读取被系统拒绝 | 记 `RESTRICTED`，是正常状态 | 不能（但状态字段能） |

**所以「报告里没有这个字段」永远不能直接推出「规则漏读」。** 这是本文最容易犯的一类归因错误——**把采集链路的断点算到判定逻辑头上**，然后去改一条本来没错的规则。

**可复用的验收动作**（审计任何采集系统都适用）：

1. **分层验证**：要证明一个字段「读不到」，必须在**采集端 / 投影 / 契约 / 归档**四层各自留下证据，不能只看归档。（**加字段时还有第五道闸门**：`maxFields` 档位 + `protocol_test.go:418` 的 `len(meta) != 235` 硬断言——见 §7 第二件 ⑤。）
2. **正反都能测**：找一个**确定存在**的字段（如 `Build.FINGERPRINT`）走一遍链路——它采到了却没进报告，立刻把「采了没上传」这一类暴露出来；再用 `ro.boot.qemu`（真机不存在）确认「没采」长什么样。**两者在归档里长得一样，只有查采集端才能分开。**
3. **不要用「缺失」当结论**：报告里没有 ≠ 设备上没有 ≠ 规则没读。三个断言需要三份证据。

**这条与 §8.1.1 是同一族的第三次出现**：那一次是「结果自洽不等于测量干净」，这一次是「字段缺失不等于规则漏读」。**共同点都是——不要用观测到的现象直接代替对它成因的判定。**

#### 8.1.4 「改一处不等于改完」：同一句错误会在多个文件里存活

这一条是 lead 在改 §5.3.4 的成本描述时踩出来的，**而且踩得很典型**。

他先把 [virtual_evidence.go:24](../backend/cmd/sigmark/virtual_evidence.go#L24) 的注释改对了（`HONEST COST NOTE, corrected after review`），但 **`score.go` 里 `structuralVirtualPoints` 的注释还写着「`system.boardPlatform` is a build artifact」**——同一句错话，在两个文件里各活了一份。改了一个，另一个没动。

**为什么这类错误特别容易漏**：

| 原因 | 说明 |
| --- | --- |
| **注释不参与编译** | 编译器不会告诉你两处注释互相矛盾 |
| **两处都「看着对」** | 单独读 `score.go` 那段，句子通顺、逻辑自洽，**只有对照 `virtual_evidence.go` 才能发现它过时了** |
| **改的时候注意力在「这一处」** | 修 bug 的心理状态是「找到出错的那行」，不是「找出同一句话的所有副本」 |

**所以「改一处」这个动作本身是危险的**——它给人一种「已经改完了」的错觉。

**可复用的验收动作**：

1. **改之前先搜一遍**：把要改的那句话里**最独特的一个词**（这里是 `build artifact`）当关键字全仓搜，**在动手前就知道有几个副本**。
2. **改完再搜一遍**：确认搜出来的每一处都改过，或者都明确标注了「这里故意保留旧说法」。
3. **让测试当副本探测器**：`TestRedteamFakingPlatformAloneIsCheap` 和 `TestRedteamCpuInfoSurvivesPlatformRewrite` 只锁行为，**锁不住注释**——所以注释类的纠正只能靠**人工搜**。这一点必须诚实承认：**行为有测试守，叙述没有。**

**这条与 §8.1.3 的关系**：§8.1.3 说「同一个现象有四种成因，别只查一层」；这一条说「**同一个错误有多份副本，别只改一份**」。**一个是纵向的（查到底层），一个是横向的（查到所有副本）。**

---

## 9. 附：本文引用的位置

| 内容 | 位置 |
| --- | --- |
| 版本变更说明（`/1`→`/2`→`/3`→`/4` 的完整历史，含「零命中也要升版」的理由） | [score.go:26](../backend/cmd/sigmark/score.go#L26)、[:33](../backend/cmd/sigmark/score.go#L33)、[:51](../backend/cmd/sigmark/score.go#L51) |
| band 阈值（A 85 / B 70 / C 50 / D 0） | [score.go:77](../backend/cmd/sigmark/score.go#L77) |
| 轴权重 40 / 35 / 25 | [score.go:89](../backend/cmd/sigmark/score.go#L89) |
| behavior 计分表（六分支 + 分值 + Decisive 位） | [score.go:120](../backend/cmd/sigmark/score.go#L120) |
| 展示不计分的两个标签 | [score.go:180](../backend/cmd/sigmark/score.go#L180) |
| 分支分值常量（30/25/15/15/12） | [score.go:183](../backend/cmd/sigmark/score.go#L183) |
| `usageFreshBootPoints` / `usageAgedRomYears` / `usageFreshBootCeiling` | [score.go:190](../backend/cmd/sigmark/score.go#L190)、[:198](../backend/cmd/sigmark/score.go#L198)、[:205](../backend/cmd/sigmark/score.go#L205) |
| U2 的 SDK→年份表，以及「提高伪造成本、不是不可伪造」的改正说明 | [score.go:207](../backend/cmd/sigmark/score.go#L207)、[:218](../backend/cmd/sigmark/score.go#L218)、[:230](../backend/cmd/sigmark/score.go#L230) |
| 覆盖率闸门 + 薄轴例外 | [score.go:387](../backend/cmd/sigmark/score.go#L387)、[:393](../backend/cmd/sigmark/score.go#L393) |
| R10 两层：`axisBlind` 全轴盲检测 | [score.go:424](../backend/cmd/sigmark/score.go#L424) |
| R10 严格形态：`declarationBlind` + 不出版数字 | [score.go:440](../backend/cmd/sigmark/score.go#L440)、[:446](../backend/cmd/sigmark/score.go#L446) |
| R10 窄形态：盲轴禁止 A（数字照发） | [score.go:494](../backend/cmd/sigmark/score.go#L494) |
| R11（A 档零扣分） | [score.go:477](../backend/cmd/sigmark/score.go#L477) |
| R5（决定性 cap） | [score.go:501](../backend/cmd/sigmark/score.go#L501) |
| 轴分公式（`applied = min(Σ,100)`、`100 − applied`） | [score.go:687](../backend/cmd/sigmark/score.go#L687) |
| `scoreAvailableKeys` | [score.go:553](../backend/cmd/sigmark/score.go#L553) |
| `scoreUndeterminedFor` | [score.go:607](../backend/cmd/sigmark/score.go#L607) |
| `profileUnsetKeys` / `PROFILE_UNSET` | [score.go:640](../backend/cmd/sigmark/score.go#L640)、[:636](../backend/cmd/sigmark/score.go#L636) |
| `declarationAxis` 三个分支 | [score.go:790](../backend/cmd/sigmark/score.go#L790) |
| `FOREIGN_PROFILE` 与它的 cap | [score.go:814](../backend/cmd/sigmark/score.go#L814) |
| `HARDWARE_CHANNEL_CONFLICT` | [score.go:821](../backend/cmd/sigmark/score.go#L821) |
| identity 分支与 `IDENTITY_APP_UID` cap | [score.go:863](../backend/cmd/sigmark/score.go#L863)、[:885](../backend/cmd/sigmark/score.go#L885) |
| overlay 分支（`insufficient` 出口） | [score.go:905](../backend/cmd/sigmark/score.go#L905) |
| `behaviorAxis`（只处理 `hit`） | [score.go:1008](../backend/cmd/sigmark/score.go#L1008) |
| `DECISIVE_VIRTUAL_BUILD`（黑名单形态 / 结构形态） | [score.go:1032](../backend/cmd/sigmark/score.go#L1032)、[:1046](../backend/cmd/sigmark/score.go#L1046) |
| `usageAxis`（单标签、coverage 0/1） | [score.go:1119](../backend/cmd/sigmark/score.go#L1119)、[:1154](../backend/cmd/sigmark/score.go#L1154) |
| U1/U2 的可判条件与扣分 | [score.go:1192](../backend/cmd/sigmark/score.go#L1192)、[:1197](../backend/cmd/sigmark/score.go#L1197) |
| `detail` 文案 | [score.go:1210](../backend/cmd/sigmark/score.go#L1210)、[:1219](../backend/cmd/sigmark/score.go#L1219) |
| `usageAgedRomCutoff` | [score.go:1232](../backend/cmd/sigmark/score.go#L1232) |
| `declaredSoc` 只认表内值 | [hardware_facts.go:92](../backend/cmd/sigmark/hardware_facts.go#L92) |
| `hardwareKeys`（不含 `initialSdk`） | [hardware_facts.go:112](../backend/cmd/sigmark/hardware_facts.go#L112) |
| RAM 通道（无前置） | [hardware_facts.go:154](../backend/cmd/sigmark/hardware_facts.go#L154) |
| 四条通道的 `known` 前置 | [hardware_facts.go:166](../backend/cmd/sigmark/hardware_facts.go#L166)、[:177](../backend/cmd/sigmark/hardware_facts.go#L177)、[:191](../backend/cmd/sigmark/hardware_facts.go#L191)、[:210](../backend/cmd/sigmark/hardware_facts.go#L210) |
| `not_observed` 收口 | [hardware_facts.go:263](../backend/cmd/sigmark/hardware_facts.go#L263) |
| `eval` 的 `negative == len(keys)` | [device_profile.go:171](../backend/cmd/sigmark/device_profile.go#L171)、[:191](../backend/cmd/sigmark/device_profile.go#L191) |
| identity 状态机（`compared == len(pairs)`，现多 `oneSided` 分支） | [device_profile.go:254](../backend/cmd/sigmark/device_profile.go#L254)、[:263](../backend/cmd/sigmark/device_profile.go#L263) |
| 身份对比较跳过不可读侧 | [identity_consistency.go:41](../backend/cmd/sigmark/identity_consistency.go#L41) |
| **单侧身份证据**：`oneSidedIdentity` 与四个跳过条件 | [identity_consistency.go:70](../backend/cmd/sigmark/identity_consistency.go#L70)、[:75](../backend/cmd/sigmark/identity_consistency.go#L75)、[:84](../backend/cmd/sigmark/identity_consistency.go#L84)、[:89](../backend/cmd/sigmark/identity_consistency.go#L89)、[:92](../backend/cmd/sigmark/identity_consistency.go#L92) |
| `identity_asymmetry` 证据行与它的文案 | [device_profile.go:266](../backend/cmd/sigmark/device_profile.go#L266)、[score.go:867](../backend/cmd/sigmark/score.go#L867)、[:968](../backend/cmd/sigmark/score.go#L968) |
| 占位符两侧都空 → 仍不可比（反例） | [device_profile_test.go:440](../backend/cmd/sigmark/device_profile_test.go#L440)、[:443](../backend/cmd/sigmark/device_profile_test.go#L443) |
| **结构虚拟化证据**：两条非黑名单通道（**一条硬、一条软**） | [virtual_evidence.go](../backend/cmd/sigmark/virtual_evidence.go)（133 行） |
| **成本纠正注释**（`HONEST COST NOTE, corrected after review`） | [virtual_evidence.go:24](../backend/cmd/sigmark/virtual_evidence.go#L24) |
| `boardPlatform` 实际来源是**属性** `ro.board.platform` | [DeviceCollectors.kt:129](../app/src/main/java/com/sigmark/app/collector/DeviceCollectors.kt#L129) |
| `genericBoardPlatforms` 通用平台清单 | [virtual_evidence.go:43](../backend/cmd/sigmark/virtual_evidence.go#L43) |
| `desktopCpuMarkers` 桌面 CPU 族名清单 | [virtual_evidence.go:58](../backend/cmd/sigmark/virtual_evidence.go#L58) |
| `boardPlatformIsGeneric`（含 `generic*` / `aosp*` 前缀） | [virtual_evidence.go:66](../backend/cmd/sigmark/virtual_evidence.go#L66) |
| `cpuInfoContradictsHandset` 与它的两个防误伤闸门 | [virtual_evidence.go:83](../backend/cmd/sigmark/virtual_evidence.go#L83)、[:85](../backend/cmd/sigmark/virtual_evidence.go#L85)、[:89](../backend/cmd/sigmark/virtual_evidence.go#L89) |
| `structuralVirtualEvidence` 汇总 | [virtual_evidence.go:103](../backend/cmd/sigmark/virtual_evidence.go#L103) |
| `structuralVirtualPoints = 35`（与黑名单同分同决定性） | [score.go:163](../backend/cmd/sigmark/score.go#L163) |
| **`structuralVirtualPoints` 的成本纠正注释**（`CORRECTION, measured on LDPlayer 9 over adb`，两条通道成本对照） | [score.go:146](../backend/cmd/sigmark/score.go#L146) |
| `structuralVirtualDeduction` 与「一因一果」互斥 | [score.go:1057](../backend/cmd/sigmark/score.go#L1057)、[:1058](../backend/cmd/sigmark/score.go#L1058) |
| 结构证据的 `detail`（只写观察不写判决） | [score.go:1079](../backend/cmd/sigmark/score.go#L1079) |
| **LDPlayer 绕过复现 + 结构捕获 + 真机不误伤 7 例 + 单改一处不够 + 成本不对称的两个边界** | [score_redteam_emulator_test.go](../backend/cmd/sigmark/score_redteam_emulator_test.go)（189 行，六个 Test） |
| **`TestRedteamFakingPlatformAloneIsCheap`**：改 `boardPlatform` 后通道失效、两条都改则证据归零（诚实上限） | [score_redteam_emulator_test.go:159](../backend/cmd/sigmark/score_redteam_emulator_test.go#L159) |
| **`TestRedteamCpuInfoSurvivesPlatformRewrite`**：四个真代号轮换，`cpuInfo` 始终独立成立 | [score_redteam_emulator_test.go:180](../backend/cmd/sigmark/score_redteam_emulator_test.go#L180) |
| **攻击成本清单（发现 5）**：整份 `score_redteam_cost_test.go`（150 行，四个 Test） | [score_redteam_cost_test.go](../backend/cmd/sigmark/score_redteam_cost_test.go) |
| **`TestRedteamBillOfMaterialsForAnA`**：两次编辑后两条决定性规则同时安静；`propertyEdits, procEdits = 1, 1` 写死，规则变多时会先失败 | [score_redteam_cost_test.go:40](../backend/cmd/sigmark/score_redteam_cost_test.go#L40)、[:72](../backend/cmd/sigmark/score_redteam_cost_test.go#L72) |
| **`TestRedteamTheCheapEditAloneIsNotEnough`**：只做免费编辑仍被 `desktop_cpu_info` 抓住 | [score_redteam_cost_test.go:81](../backend/cmd/sigmark/score_redteam_cost_test.go#L81) |
| **`TestRedteamTheExpensiveEditAloneIsAlsoNotEnough`**：只做贵编辑仍被 `generic_board_platform` 抓住 | [score_redteam_cost_test.go:102](../backend/cmd/sigmark/score_redteam_cost_test.go#L102) |
| **`TestRedteamWhatTheRuleDoesNotPrice`**：清掉决定性规则 ≠ 清掉各轴（诚实的一半） | [score_redteam_cost_test.go:121](../backend/cmd/sigmark/score_redteam_cost_test.go#L121) |
| 计分通道清单的原始出处（文件头注释，十行规则表） | [score_redteam_cost_test.go:11](../backend/cmd/sigmark/score_redteam_cost_test.go#L11) |
| **`Build.FINGERPRINT` 采了没上传**（采集有、投影与字典都没有） | [DeviceCollectors.kt:108](../app/src/main/java/com/sigmark/app/collector/DeviceCollectors.kt#L108)、[LanDetails.kt:30](../app/src/main/java/com/sigmark/app/lan/LanDetails.kt#L30)、[field_dictionary.go:8](../backend/cmd/sigmark/field_dictionary.go#L8) |
| **`maxFields` 逐档递增**（字段集 25 = 259；新增字段必须加档，否则历史报告读不出来） | [protocol.go:574](../backend/cmd/sigmark/protocol.go#L574)、[protocol_test.go:417](../backend/cmd/sigmark/protocol_test.go#L417)、[:418](../backend/cmd/sigmark/protocol_test.go#L418) |
| **`ro.boot.qemu` 压根没采**（`SafeReader.Property` 无此枚举） | [SafeReader.kt:83](../app/src/main/java/com/sigmark/app/collector/SafeReader.kt#L83) 附近的枚举块 |
| `hookSignals` 子串匹配 | [SecurityProbes.kt:41](../app/src/main/java/com/sigmark/app/collector/SecurityProbes.kt#L41) |
| `memfd_exec` 运行时白名单 | [SecurityProbes.kt:39](../app/src/main/java/com/sigmark/app/collector/SecurityProbes.kt#L39) |
| `.magisk` 挂载判定 | [SecurityProbes.kt:79](../app/src/main/java/com/sigmark/app/collector/SecurityProbes.kt#L79) |
| root 管理器固定包名 | [SecurityProbes.kt:96](../app/src/main/java/com/sigmark/app/collector/SecurityProbes.kt#L96) |
| `TracerPid` 解析 | [SecurityProbes.kt:91](../app/src/main/java/com/sigmark/app/collector/SecurityProbes.kt#L91) |
| SELinux 非 0/1 → `INVALID_VALUE` | [SelinuxProbe.kt:100](../app/src/main/java/com/sigmark/app/collector/SelinuxProbe.kt#L100) |
| `initialSdk` 来自 `ro.product.first_api_level` | [SecurityObservations.kt:43](../app/src/main/java/com/sigmark/app/collector/SecurityObservations.kt#L43) |
| `bootCount` 会随清数据重置 | [SecurityObservations.kt:50](../app/src/main/java/com/sigmark/app/collector/SecurityObservations.kt#L50) |
| `bootCount` 读 `Settings.Global.BOOT_COUNT` | [SecurityObservations.kt:52](../app/src/main/java/com/sigmark/app/collector/SecurityObservations.kt#L52) |
| 分区日期读 `ro.<part>.build.date.utc` | [SecurityObservations.kt:119](../app/src/main/java/com/sigmark/app/collector/SecurityObservations.kt#L119) |
| 人工复核接口里才有 `initialSdk` 比对 | [identity_review.go:16](../backend/cmd/sigmark/identity_review.go#L16)、[:64](../backend/cmd/sigmark/identity_review.go#L64) |
| App 侧身份证据清单 | [AppIdentityEvidence.kt:9](../app/src/main/java/com/sigmark/app/security/AppIdentityEvidence.kt#L9) |
| 契约：R5/R6/R7/R10/R11 | [SECURITY-SCORE.md](SECURITY-SCORE.md) §4 |
| 契约：band 表 | [SECURITY-SCORE.md](SECURITY-SCORE.md) §5.6 |
| 回算实测（22 份）与三个已修缺陷 | [SECURITY-SCORE.md](SECURITY-SCORE.md) §9.1.1 |
| 敏感性结论（分簇而非全序） | [SECURITY-SCORE.md](SECURITY-SCORE.md) §13 F13 |
| 五个行为变体实测 | [EMULATOR-LAB.md](EMULATOR-LAB.md) §7.3 |
| 仿真器 baseline 打分（D/null/0.67） | [EMULATOR-LAB.md](EMULATOR-LAB.md) §7.2 |
| **§10 的实测**（合成 fixture 上的真机数据、单变量对照） | ⑤[score_redteam_emulator_test.go](../backend/cmd/sigmark/score_redteam_emulator_test.go)（138 行，§10.9 **真实模拟器**）、④[score_redteam_decisive_test.go](../backend/cmd/sigmark/score_redteam_decisive_test.go)（102 行，§10.8 **决定性实验**）、[score_redteam_test.go](../backend/cmd/sigmark/score_redteam_test.go)（198 行，发现 2/3 的原始两条）、[score_redteam_clean_test.go](../backend/cmd/sigmark/score_redteam_clean_test.go)（88 行，§10.7 实验二，**保留作方法论证据**）、[score_redteam_overlay_test.go](../backend/cmd/sigmark/score_redteam_overlay_test.go)（62 行，§10.7 实验一，**保留作方法论证据**） |
| 版本常量与变更说明（`sigmark-score/4`、`sigmark-profile/9`） | [score.go:51](../backend/cmd/sigmark/score.go#L51)、[:26](../backend/cmd/sigmark/score.go#L26)、[device_profile.go:25](../backend/cmd/sigmark/device_profile.go#L25)、[:18](../backend/cmd/sigmark/device_profile.go#L18) |
| 实测基线 `mi8Evidence()`（其中 overlay 通道为 `UNAVAILABLE`） | [score_test.go:144](../backend/cmd/sigmark/score_test.go#L144)、[:180](../backend/cmd/sigmark/score_test.go#L180) |

---

## 10. 实测验证记录（lead 执行，本轮新增）

> 本节全部属于 **【已实测】**，与 §1–§9 的推理分开记。执行者：lead。我（红队）**已自行复跑**同一命令，输出与其报告一致。
>
> **口径必须说清（分两种，不要混）**：
>
> - **§10.1–§10.8：合成证据上的真机数据**——用真机采集到的字段值拼成 fixture 喂给 `buildDeviceScore`，**不是重新上机采集**。它证明「判定逻辑会这样算」，不证明「真机上这条攻击链走得通」。
> - **§10.9：真实设备端到端**——一台真的 LDPlayer 9 模拟器，装真的 App、跑真的采集、上传到真的报告库，**有报告号 `ce1bdc7f-f128-4e8b-a225-bbeb2bee7c35`**。**这是本文唯一一条端到端证据，也是唯一一条不需要「合成」这个词的。**

### 10.1 怎么测的

| 项 | 内容 |
| --- | --- |
| 测试文件（本轮共六个） | ⑤[score_redteam_emulator_test.go](../backend/cmd/sigmark/score_redteam_emulator_test.go)（189 行，§10.9 真实模拟器 + 成本不对称，六个 Test）、⑥[score_redteam_cost_test.go](../backend/cmd/sigmark/score_redteam_cost_test.go)（150 行，§5.4 攻击成本清单，四个 Test）、④[score_redteam_decisive_test.go](../backend/cmd/sigmark/score_redteam_decisive_test.go)（102 行，§10.8 决定性实验）、[score_redteam_test.go](../backend/cmd/sigmark/score_redteam_test.go)（198 行，发现 2/3 的原始两条）、[score_redteam_clean_test.go](../backend/cmd/sigmark/score_redteam_clean_test.go)（88 行，§10.7 实验二）、[score_redteam_overlay_test.go](../backend/cmd/sigmark/score_redteam_overlay_test.go)（62 行，§10.7 实验一） |
| 基线证据 | `mi8Evidence()`——真实 MI 8 的归档字段值 + 状态（其中 `system.selinux` = `RESTRICTED`，`cpu.cpuCapacity` / `environment.overlayDeviceCodename` / `system.hardwareSku` = `UNAVAILABLE`）；§10.7 另用 `pixel6Evidence()` 与一台程序构造的隔离设备；§10.8 用同一台隔离设备但把 `kernelMemTotal` 修干净；**§10.9 用从归档报告 `ce1bdc7f…` 抄下来的真实字段** |
| 实验设计 | **单变量对照**：只改「被攻击的那个字段」，其余一切不动；每次调用同一个 `buildDeviceScore` 入口，`capturedAt` 固定 2026-06-01（§10.7/§10.8 用 2026） |
| 复跑命令 | `go test ./cmd/sigmark/ -run TestRedteam -v`（我已在本地跑过，**五个测试全部 PASS**，输出与下文逐字一致）；全包 `go test -v -count=1 ./cmd/sigmark` |
| 测试定位 | 文件头写明这些断言是「**断言漏洞今天存在**」，所以修复会让它们失败、**不许为了让测试过而弱化断言**（[score_redteam_test.go:9](../backend/cmd/sigmark/score_redteam_test.go#L9) 起）。**修复后这几条断言已经被改写成「断言漏洞已关闭」**——这是允许的，因为断言的方向变了（§10.8、§10.9） |
| 失败模式 | **样本污染**：三次实验里有两次被 fixture 自带的其它扣分污染（§8.1、§10.7）。**这是本轮最主要的方法论风险，比代码本身更容易出错。** §10.9 没有这个问题——它用的是真实报告，不是构造的样本 |

**原始日志（修复后，我复跑的完整输出）**：

```
=== RUN   TestRedteamLaunderingIsolateACompletelyCleanDevice
    score_redteam_clean_test.go:52: clean    : value=88 band=B decl cov=1
    score_redteam_clean_test.go:63: conflict : value=78 band=D decl cov=1 deductions=2
    score_redteam_clean_test.go:74: laundered: value=78 band=D decl cov=1 deductions=2
    score_redteam_clean_test.go:86: laundered band = D (value 78): not A, so the laundering is not a complete disguise
--- PASS: TestRedteamLaunderingIsolateACompletelyCleanDevice (0.00s)
=== RUN   TestRedteamLaunderingFromAGenuinelyCleanBaseline
    score_redteam_decisive_test.go:55: clean    : value=100 band=A decl cov=1 deductions=0
    score_redteam_decisive_test.go:68: conflict : value=90 band=D decl cov=1 deductions=1
    score_redteam_decisive_test.go:78: laundered: value=90 band=D decl cov=1 deductions=1
    score_redteam_decisive_test.go:100: laundered band = D (value 90): not a clean 100/A
--- PASS: TestRedteamLaunderingFromAGenuinelyCleanBaseline (0.00s)
=== RUN   TestRedteamLaunderingOnAnOverlayReadableDevice
    score_redteam_overlay_test.go:40: conflict  : decl cov=1 | value=72 band=D caps=2
    score_redteam_overlay_test.go:42: laundered : decl cov=1 | value=72 band=D caps=2
    score_redteam_overlay_test.go:54: declaration is NOT blind (cov 1 >= 0.5): the MI 8 result does NOT generalise
    score_redteam_overlay_test.go:60: laundered band = D (value 72): the laundering did not reach A
--- PASS: TestRedteamLaunderingOnAnOverlayReadableDevice (0.00s)
=== RUN   TestRedteamDeletingUsageEvidenceScoresBetterThanKeepingIt
    score_redteam_test.go:57: honest  : usage cov=1 score=88 deductions=1 | total value=97 band=B
    score_redteam_test.go:60: deleted : usage cov=0 score=100 deductions=0 | total value=100 band=B
    score_redteam_test.go:92: FIXED: keeping the evidence publishes 97/B; deleting it publishes 100/B — the number still prints (renormalising is unavoidable once the axis is out) but the band is capped, so deletion buys nothing
--- PASS: TestRedteamDeletingUsageEvidenceScoresBetterThanKeepingIt (0.00s)
=== RUN   TestRedteamDeletingOneIdentitySideLaundersAHit
    score_redteam_test.go:133: conflict  : state=hit | value=90 band=D caps=1
    score_redteam_test.go:135: laundered : state=hit | value=90 band=D caps=1
    score_redteam_test.go:156: asymmetry : 1 对身份读数只有一侧可读（共 2 对在档）
    score_redteam_test.go:170: FIXED: blanking one property now keeps 90/D (was 90/D) — the finding survives
--- PASS: TestRedteamDeletingOneIdentitySideLaundersAHit (0.00s)
PASS
ok  	sigmark/lan/cmd/sigmark	0.055s
```

> 第 92 行那句现在**和断言一致了**（`97/B` vs `100/B`，并说明「数字仍出版、结论靠 band 锁」）——这是 §5.9 第 8 条，**已修**。修复前它写的是 `publishes no number`，而同一行上方的日志自己就印着 `value=100`：**日志文案也是一种断言，没验证过的文案会变成后人引用的假证据。**
>
> 还要注意**修复后的洗白行自己就是证据**：`laundered : state=hit`（原先 `insufficient`）且 `value=90 band=D caps=1`（原先 `<nil>`/`?`/`0`）。**同一台设备、同一个属性、同一段代码路径，结论从「没有案底」变成「案底还在」。**

### 10.2 发现 3（usage 轴删证据升档）：**完全证实，且已修复**

**实测数字（单变量：只删 usage 的输入，其它一字不改）**：

| 变量 | usage 轴 | 总分 | band |
| --- | --- | --- | --- |
| **诚实**：`partitionBuildDates = "system 2019-06-01"`、`initialSdk = "27"`、`bootCount = "1"` | `coverage = 1`、`score = 88`、`deductions = 1` | **97** | **B** |
| **删证据**：`partitionBuildDates = ""`、`initialSdk = ""`、`bootCount = "1"`（其余不变） | `coverage = 0`、`score = 100`、`deductions = 0` | **100** | ~~A~~ → **B（修复后）** |

**修复前**：`97/B` → `100/A`。**差 3 分、跨一个 band**，我在 §5.1 写的「删证据比留证据得分更高」**一字不差地成立**。

**修复形态**：R10 从「只保 `declaration` 轴」推广到全部三轴，**分两层**：

| 轴 | 盲（coverage < 0.5 且零扣分）时 | 实现 |
| --- | --- | --- |
| `declaration` | **完全不出版数字**，band = `?`（原严格形态，保留） | `declarationBlind`，[score.go:440](../backend/cmd/sigmark/score.go#L440) → 早退 [:446](../backend/cmd/sigmark/score.go#L446) |
| `behavior` / `usage` | **数字照常出版，但禁止 A**，band 强制降到 B | `axisBlind`，[score.go:424](../backend/cmd/sigmark/score.go#L424) → [:494](../backend/cmd/sigmark/score.go#L494) |

**为什么不统一成「全轴不出版」**：lead 先试了全轴版本，结果一个「hook 注入 + debugger 都在」的真机样本**从 D 变成 `?`**——把唯一看见了的东西弄丢了。所以窄形态是对的：**结论（band）才是攻击者想动的东西，就锁死结论**，数字留下来让 D 仍然看得见。

**修复后实测**：删证据 = **`100/B`**，留证据 = **`97/B`**。升档通道关闭。

**回归**：全库 **23 份**真实报告在 `/3` + `profileVersion /9` 之后逐份比对 band/value（`/4` 之后是 24 份，见 §10.9.5），**判定零漂移**（A:4 / D:8 / B:4 / ?:7）。lead 跑了两遍（改标签后一遍、升版后一遍），两次都零漂移。这两项都是 lead 在数据库上跑的，**我没有复跑**（需要报告库），如实标注。

### 10.3 发现 2（删一侧读数）：**证据可被完全擦除（已证实），现已修复**

**实测数字（MI 8 fixture，修复前）**：

| 变量 | `identity_conflict` 状态 | 总分 | band | caps |
| --- | --- | --- | --- | --- |
| **造真冲突**：`system.model = "23078PND5G"` vs `system.propertyModel = "Pixel 6"` | `hit` | **90** | **D** | **1** |
| **洗白**：把 `system.propertyModel` 置空（其余不变） | `insufficient` | **null** | **`?`** | **0** |
| **洗白（修复后，同一测试）** | **`hit`** | **90** | **D** | **1** |

**这一组数字说明什么、不说明什么**：MI 8 上洗白后是 `null`/`?`，**不是 `A`**——但这是**这台 fixture 的特例**，因为它的 overlay 通道本来就不可读（见下）。**它证明的是「扣分与决定性 cap 一起消失」，不证明「最坏情况只是 `?`」。** 测试当时把自己记成 `CONFIRMED (bounded)`，`bounded` 用的是对的：**那一轮只看到一台设备上的上界，不是伤害的上界。**

> **后来两轮对照（§10.7、§10.8）把「上界」彻底改写了**：overlay 可读的隔离设备上洗白是 `88/B`（= 该设备基线，因为基线被污染）；把基线修干净之后，洗白是 **`100/A`**——**完整伪装**。详见 §10.8。

**为什么这里是 `?` 而不是 A（机制，已核对代码）**：在这个 fixture 上 `environment.overlayDeviceCodename` 本来就是 `UNAVAILABLE`（[score_test.go:180](../backend/cmd/sigmark/score_test.go#L180)），所以声明轴三条通道里 **overlay 早就是未决**。洗白 identity 之后只剩 hardware 一条可判 → 声明轴 coverage = **1/3 < 0.5** 且零扣分 → `declarationBlind` 成立 → 不出版数字。**是「声明轴被压到 1/3」救了这一局，不是「洗白被检测到」。**

**修复（`/9`）之后**：同一测试的洗白行变成 `state=hit | value=90 band=D caps=1`，并多打一行 `asymmetry : 1 对身份读数只有一侧可读（共 2 对在档）`。**结论从「没有案底」变回「案底还在」。** 判据与四个跳过条件见 §5.2.3，决定性验证见 §10.8。

lead 当时决定**不跟 R10 一起修**这一条：它需要改标签层的「不可比即证据」语义，比 R10 更深。**这个顺序是对的**——R10 是「轴级」判据，这条是「通道级」判据，混在一起会让 R10 的语义难解释；而且必须先有决定性实验证明危害，才值得改语义。**两轮之后它被单独修掉了，顺序正确。**

### 10.4 U2「不可伪造」：**已撤回**

我在 §3.6 的判断被采纳：`initialSdk` 取自 `ro.product.first_api_level`（[SecurityObservations.kt:43](../app/src/main/java/com/sigmark/app/collector/SecurityObservations.kt#L43)），`resetprop` 可改；`hardwareKeys`（[hardware_facts.go:112](../backend/cmd/sigmark/hardware_facts.go#L112)）不含它，打分链路不交叉校验。**代码注释已改正**（[score.go:218](../backend/cmd/sigmark/score.go#L218) 起）：U2 的价值降级为「提高伪造成本（要额外改一个出厂属性），不是不可伪造」。

### 10.5 版本与文档状态（本轮）

| 项 | 状态 |
| --- | --- |
| 代码 | `sigmark-score/4`、`sigmark-profile/9`（U2 在 `/2` 落地、R10 两层在 `/2` 之后、单侧身份证据在 `/3`、结构虚拟化证据在 `/4`） |
| 前端 | `score-view.ts` 已升（`scoreVersion /4`），Web 测试 **103/103/0** |
| 契约文档 `docs/SECURITY-SCORE.md` | **仍是旧版本号**，由另一位队友同步中（本文不改它） |
| 全库回算 | 23 份，`/3` + `/9` 之后**零漂移**（两次独立比对）；`/4` 之后 24 份仍零漂移（§10.9.5） |
| 全包测试 | 当轮 **133 PASS + 3 SKIP = 136 顶层**、`RUN` 199；**`/4` 之后 137 PASS + 3 SKIP = 140 顶层、`RUN` 210**；`gofmt` 干净、`go vet` exit 0 |
| 黄金 5 份 | 重生成，**数值全部不变**（Pixel6 82/D、MI8 100/A、三份仿真器 D），只有 `version` 一行变 |

**版本双升的理由**（写在代码注释里，[score.go:51](../backend/cmd/sigmark/score.go#L51)、[device_profile.go:25](../backend/cmd/sigmark/device_profile.go#L25)）：`profileVersion` 管「同一份归档是否得出不同标签集或不同标签状态」——这次是**状态映射变了**（`insufficient` → `hit`），所以 `8 → 9`；`scoreVersion` 管「同一份归档是否得出不同 band」——这次洗白后的 band 从 `A` 变成 `D`，所以 `2 → 3`。**两个都变，两个都升。**

### 10.6 本轮实测**没有**覆盖的部分（诚实边界）

| # | 没覆盖的 | 为什么重要 |
| --- | --- | --- |
| 1 | 只有**3 条**发现被实测（发现 1、2、3 各有一部分被 §10 覆盖），其余条目仍是推理 | §0 表里标「未修」的条目，除这几条外都还没被独立验证过 |
| 1b | **修复本身只做了代码层验证**：`go test` 全绿 + 23 份零漂移 + 黄金 5 份数值不变 | 没有真机跑过修复后的采集链路；`identity_asymmetry` 那行证据在真机报告里长什么样，没人见过 |
| 2 | 只在 **MI 8 fixture**、一个**隔离构造的干净 fixture**、以及**真实 Pixel 6**（污染，作废）上跑，**没在模拟器 fixture** 上跑 | 模拟器路径只有 EMULATOR-LAB 的 baseline 数字，没有本轮红队手法的对照 |
| 3 | 全库 23 份零漂移是 lead 的报告，**我没有复跑** | 需要 PostgreSQL 报告库，不在我的权限内 |
| 4 | **没有真机采集** | 「判定逻辑会这样算」≠「真机上这条攻击链走得通」；§8 的 12 条待验证仍然全部有效 |
| 5 | **修复只覆盖 `identity_conflict` 这一对**；`overlay` 通道、`SELinux` 通道、`virtual_build_markers` 是否同样可被「删一侧」擦除，**一对都没测** | §5.2.6 的表格里我列了四条「同一个手法可以套在另外几条上」，其中**三条至今是纯推理**。overlay 那条最可疑：它只要一个 `UNAVAILABLE` 就消失，而 `UNAVAILABLE` 在 MI 8 上是**系统自己造成的**（不可控但可掩盖）。**修复之后这一条更重要**：因为它证明「能修的前提是存在第二个观察者」，而那三条没有 |
| 6 | 修复后的**单侧占位符**判定只在单元测试里覆盖（`one-sided placeholder is asymmetry evidence`），**没有真实报告样本** | 全库 7 份单侧记录全是 `NOT_ARCHIVED`，所以「不误伤历史」有实证；但「占位符算不算不对称」这条新语义没有任何真实设备验证过 |
### 10.7 两次被污染的对照实验（**都保留作方法论证据**）

这一节记录**前两个实验**：**第一个作废**（样本污染），**第二个有效但基线也被污染**。它们现在都**不能作为结论依据**，但必须留着——因为正是它们把「实验设计」这件事教清楚了（§8.1）。**决定性的第三个实验见 §10.8。**

#### 实验一（作废）：真实 Pixel 6 证据

用的就是 [score_redteam_overlay_test.go](../backend/cmd/sigmark/score_redteam_overlay_test.go)（62 行），样本取自 `pixel6Evidence()`。**修复前**的复跑输出（历史）：

```
=== RUN   TestRedteamLaunderingOnAnOverlayReadableDevice
    score_redteam_overlay_test.go:40: conflict  : decl cov=1 | value=72 band=D caps=2
    score_redteam_overlay_test.go:42: laundered : decl cov=0.67 | value=82 band=D caps=1
    score_redteam_overlay_test.go:54: declaration is NOT blind (cov 0.67 >= 0.5): the MI 8 result does NOT generalise
    score_redteam_overlay_test.go:60: laundered band = D (value 82): the laundering did not reach A
--- PASS
```

**修复后同一测试**（洗白不再抹掉任何东西）：

```
    score_redteam_overlay_test.go:40: conflict  : decl cov=1 | value=72 band=D caps=2
    score_redteam_overlay_test.go:42: laundered : decl cov=1 | value=72 band=D caps=2
    score_redteam_overlay_test.go:54: declaration is NOT blind (cov 1 >= 0.5): the MI 8 result does NOT generalise
    score_redteam_overlay_test.go:60: laundered band = D (value 72): the laundering did not reach A
```

**它什么也证明不了**：Pixel 6 这台样本自带 `FOREIGN_PROFILE`（30，决定性，`caps=2` 就说明有两个 cap 同时在响）和 overlay 代号不一致（15）。洗白之后仍剩 `caps=1`——**剩下的那个 cap 与洗白无关**。用一个自带其它问题的样本去测单点，测出来的是别的东西。**作废，不作为任何结论的依据。**

（唯一有用且**至今仍成立**的信息：overlay 可读的设备上，洗白后的声明轴覆盖率**曾经**是 2/3 ——这一层我原推断对了。修复后因为不对称被计为 `hit`，覆盖率回到 1.0。）

#### 实验二（有效，但基线被污染）：隔离设备

[score_redteam_clean_test.go](../backend/cmd/sigmark/score_redteam_clean_test.go)（88 行），`TestRedteamLaunderingIsolateACompletelyCleanDevice`。构造一台**只有一处可动**的设备：model/device/sku 三对全部一致、overlay 可读且等于 `system.device`（`corot`）、硬件画像匹配（`cpu.cpuCapacity = 160/498/1024`、`cmaTotal = 652 MiB`、`glesRenderer = Mali-G78`，全部对上 `gs101`）、behavior 干净、usage 干净（`bootCount = 80`、`partitionBuildDates = system 2026-01-15`、`initialSdk = 34`）。然后**只动 `system.propertyModel` 一个字段**。

**修复前的原始日志（历史，已不再复现）**：

```
=== RUN   TestRedteamLaunderingIsolateACompletelyCleanDevice
    score_redteam_clean_test.go:52: clean    : value=88 band=B decl cov=1
    score_redteam_clean_test.go:63: conflict : value=78 band=D decl cov=1 deductions=2
    score_redteam_clean_test.go:74: laundered: value=88 band=B decl cov=0.67 deductions=1
    score_redteam_clean_test.go:86: laundered band = B (value 88): not A, so the laundering is not a complete disguise
--- PASS
```

**修复后同一测试现在打印**（`laundered` 不再回到基线）：

```
    score_redteam_clean_test.go:52: clean    : value=88 band=B decl cov=1
    score_redteam_clean_test.go:63: conflict : value=78 band=D decl cov=1 deductions=2
    score_redteam_clean_test.go:74: laundered: value=78 band=D decl cov=1 deductions=2
    score_redteam_clean_test.go:86: laundered band = D (value 78): not A, so the laundering is not a complete disguise
```

下表的「洗白」一行是**修复前**的数字（修复后的形态记在 §5.2.4——洗白 = 冲突）：

| 状态 | 总分 | band | 声明轴 coverage | 声明轴扣分条数 |
| --- | --- | --- | --- | --- |
| 基线（只存在「本来就没冲突」） | **88** | **B** | 1.0 | **1**（见下） |
| 引入一个身份冲突（`propertyModel = "Pixel 6"`） | **78** | **D** | 1.0 | **2**（实测） |
| 洗白（`propertyModel = ""`） | **88** | **B** | **0.67** | **1**（实测） |

#### 结论一（成立）：`declarationBlind` 不触发 —— 我的推断这一层对了

coverage = **0.67 ≥ 0.5**，`declarationBlind`（[score.go:440](../backend/cmd/sigmark/score.go#L440)）不成立 → **数字照常出版**。MI 8 上那个 `?` 确实是「声明轴被压到 1/3」造成的特例，**不是通用兜底**。

#### 结论二（成立，而且是最有价值的一条）：洗白**精确回到基线**

`78/D` → 洗白 `88/B`，**与基线 `88/B` 完全相同**。扣分 2 → 1（消失的那条正是 identity），cap 1 → 0（`caps` 在洗白后为空）。

**判据就在这里**：它**能精确回到基线** → 证明「把这一侧置空」与「这一侧从未冲突过」在打分器眼里**完全等价**。这不是「分数变高了」，是**那件事实在报告里不存在了**。

**危害的准确表述**：一台伪装机删掉一个属性之后，它的报告与一台真正干净的设备**逐字段不可区分**——`band` 正常、`value` 正常、`undetermined` 里只有一行看起来完全正常的 `UNAVAILABLE`。运维没有线索，取证没有痕迹。

#### 结论三（要修正 lead 的解读）：**「不是 A」不是 R10 拦住的，是样本自己的另一个问题拦住的**

lead 的解释是「洗白后扣分和 cap 一起没了，但声明轴仍有 1 条扣分残留，所以走不到 A」。**方向对，但那次残留不是 R10 造成的，是样本自带的无关扣分**。三个数字只在一个条件下自洽：

```
88 = (40×70 + 35×100 + 25×100) / 100        → 声明轴 70（扣 30）
78 = (40×45 + 35×100 + 25×100) / 100        → 声明轴 45（扣 30 + 25）
洗白 88                                      → 只剩那 30
```

**那 30 分是什么**：`memory.kernelMemTotal = 7.44 GiB`，而 `totalRam` / `physicalRam` 都是 `12.00 GiB`。差值 `(12−7.44)/12 = 38%`，远超 8% 阈值（[hardware_facts.go:160](../backend/cmd/sigmark/hardware_facts.go#L160)）→ `ram_dispersion` 通道**判为冲突** → `HARDWARE_CHANNEL_CONFLICT` **30 分**（非决定性，[score.go:821](../backend/cmd/sigmark/score.go#L821)）。

所以这台所谓「完全干净」的 fixture，**基线本来就带着 30 分硬件扣分**，它必然是 `88/B`，注定到不了 A——**不是洗白被防住了，是样本起点就不是 A。** 而行为轴不可能产生 30 分（`VIRTUAL_BUILD_MARKERS` 是 35，且三个键全是 `corot`/`qcom` 不会命中），usage 轴也是干净的，所以这 30 分**只能是声明轴的硬件通道**，没有第二种解释。

> 这也是同一个方法学错误的**第三次**出现，而且这次更隐蔽：实验一脏在「整条命名上」（FOREIGN_PROFILE），看一眼就能发现；实验二脏在「三个内存读数中的一个」，**它藏在 fixture 角落里，连测试作者都以为自己构造的是干净样本**。

#### 结论四（当时是推论，现在**已实测**）：**「洗白回到基线」这条性质，本身就推出 A 风险**

当时这一条不需要再跑也能说清，因为它只是把结论二换个基线：

> **如果洗白后精确等于基线，那么基线是 `100/A` 的设备，洗白后就还是 `100/A`。**

一台真正干净（零扣分、`100/A`）的设备：冲突时 `90/D`（25 分 + 决定性 cap），擦掉一个属性后回到 `100/A`。

**这个推论已经跑了，逐字成立**——见 §10.8：`100/A` → `90/D` → **`100/A`**。**推论被实测确认，而且是三轮里唯一被确认的那次。**

#### 决定性实验：当时的预测 vs 实测结果

**当时的预测**（把 `memory.kernelMemTotal` 从 `7.44 GiB` 改成 `11.20 GiB`，其余一字不动）：

| 状态 | 预测（当时是算术推导） | 实测（§10.8） |
| --- | --- | --- |
| 基线 | **100/A**、声明轴零扣分 | **100/A**，deductions 0 ✅ |
| 引入身份冲突 | **90/D**（声明轴 75，`DECISIVE_IDENTITY_APP_UID` 生效） | **90/D**，deductions 1 ✅ |
| 洗白（修复前） | **100/A**（声明轴 100、coverage 0.67、`declarationBlind` 不触发、R11 无扣分可降） | **100/A** ✅ |
| 洗白（修复后） | — | **90/D** ✅ |

**四项全中。** 这条跑出来是 `100/A`，就说明「**删一个属性 = 完整伪装**」在**任何 overlay 可读的设备**上成立——而这是绝大多数真机。

#### 顺带一个方法论教训

见 §8.1（尤其是 **§8.1.1「自洽≠干净」**）：**单变量实验的验收判据是「基线必须先被独立验证」+「改动后能精确回到基线」**。唯一能回到基线的实验，才证明你动的确实是那个变量——反过来，**「能精确回到基线」本身就是最强的证据**，它比「分数变化了多少」信息量大得多。这两个实验恰好在这一点上互补：实验二的回基线**证明了洗白有效**，而它的基线**没被验证**，所以不能用来证明「A 风险不成立」。

而实验二的污染**不是跑测试发现的，是从 `value` 反推权重表逼出来的**——见 §8.1.1，这是本轮最值钱的一条方法。

### 10.8 实验三（决定性）：干净基线上的洗白，以及修复后验证

#### 10.8.1 设计（对实验二的唯一改动）

[score_redteam_decisive_test.go](../backend/cmd/sigmark/score_redteam_decisive_test.go)（102 行），`TestRedteamLaunderingFromAGenuinelyCleanBaseline`。fixture 与实验二的隔离设备**同一台**，**只改一个数**：`memory.kernelMemTotal` 从 `7.44 GiB` → **`11.20 GiB`**（对其他两个 RAM 读数 `12.00 GiB` 的离散度 = **6.7%**，低于 8% 阈值 → `ram_dispersion` 从「冲突」转为「confirmed」）。

**测试本身把「基线必须先验证」写成了硬断言**（[score_redteam_decisive_test.go:83](../backend/cmd/sigmark/score_redteam_decisive_test.go#L83)）：基线不是 `100/A`、或声明轴有扣分，就 `t.Fatalf("... this experiment would be contaminated again")`。**这是前两次实验缺的那个检查。**

#### 10.8.2 修复前实测（我的预测逐字成立）

| 状态 | value | band | 声明轴 |
| --- | --- | --- | --- |
| **干净基线** | **100** | **A** | coverage 1.0、deductions **0** |
| **一个身份冲突**（`propertyModel = "Pixel 6"`） | **90** | **D** | coverage 1.0、deductions **1** |
| **洗白**（`propertyModel = ""`） | **100** | **A** | coverage 1.0、deductions **0** |

**这是完整的伪装**：一台已被确认伪装（`D`）的设备，**删掉一个属性**，回到满分 `100/A`，报告里一处痕迹都不留。

对照实验二（同一台设备、只差那一个内存读数）：基线 `88/B`、冲突 `78/D`、洗白 `88/B`。**两者差值全部在基线那 30 分上**，洗白行为一模一样——**「洗白 = 回到基线」这个性质，在两个基线上都成立**。

#### 10.8.3 修复后实测（同一个测试，断言方向反转）

修复（`/9` 的 `oneSidedIdentity`，§5.2.3）之后，同一测试的 `t.Fatalf` 条件变成「洗白如果仍回到 `100/A` 就失败」，实测：

| 状态 | value | band | 声明轴 |
| --- | --- | --- | --- |
| 干净基线 | 100 | A | deductions 0 |
| 一个身份冲突 | 90 | D | deductions 1 |
| **洗白** | **90** | **D** | **deductions 1**（标签仍 `hit`，附 `identity_asymmetry` 证据） |

**洗白不再有任何收益**：删掉属性得到的分数，与「留着不一致」完全相同。日志原文：`laundered band = D (value 90): not a clean 100/A`。

#### 10.8.4 全包与回归

| 项 | 结果 |
| --- | --- |
| `go test -v -count=1 ./cmd/sigmark` | 当轮：**133 PASS + 3 SKIP = 136 顶层**、`RUN` 199、**FAIL 0**；`/4` 之后 137/3=140 顶层、`RUN` 210；**发现 5 之后 147 PASS + 3 SKIP = 150 顶层、`RUN` 220、FAIL 0** |
| `gofmt` / `go vet` | 干净 / exit 0 |
| Web | **103/103/0** |
| 全库 23 份 | **零漂移**（A:4 / D:8 / B:4 / ?:7），升版前后各比对一次。**`/4` 之后库里有 24 份（新增这台 LDPlayer），仍然零漂移**（§10.9.5） |
| 黄金 5 份 | 重生成，**数值全部不变**（Pixel6 82/D、MI8 100/A、三份仿真器 D），只有 `version` 一行变 |

**注意最后一行的重要性**：修复改变了「单侧身份」这一类的判定，但**23 份真实报告与 5 份黄金样本一个都没动**——因为它们的单侧记录全是 `NOT_ARCHIVED`（字段集早期版本没定义那些键）。**「零漂移」不是「修复没生效」，而是「修复只打在了它该打的地方」**，这正是 `oneSidedIdentity` 那个 `NOT_ARCHIVED` 跳过条件的价值（§5.2.3）。

#### 10.8.5 一句话总结三轮

| 轮次 | 方法问题 | 得到的「结论」 | 真相 |
| --- | --- | --- | --- |
| 实验一 | 样本自带两个无关 cap | 洗白只能到 `82/D` | 与洗白无关，**作废** |
| 实验二 | 基线自带 30 分无关扣分 | 洗白只能到 `88/B`（= 基线） | 「回到基线」是对的，**但基线不是 A** |
| 实验三 | 基线先硬断言 `100/A` | 洗白回到 `100/A` | **危害成立**，随即被修 |

**三次实验的真正结论不是关于漏洞的，是关于测量的**：**一个「单变量对照」只有在基线被独立验证时才是对照，否则它只是又一台被污染的样本。**

### 10.9 实验四（**真实设备端到端**）：LDPlayer 9 绕过 35 分规则

**这一节与前八节不同：它不是合成 fixture。** 一台真的 LDPlayer 9（雷神）被真的启动、真的装了 SigMark 1.14.0、真的采集、真的上传到报告库。**报告号 `ce1bdc7f-f128-4e8b-a225-bbeb2bee7c35`。** 下文所有「修复前」的数字都是**从那台真实报告里读出来的**，不是算出来的。

#### 10.9.1 现场

| 项 | 内容 |
| --- | --- |
| 设备 | LDPlayer 9（雷神模拟器），宿主 Windows |
| 连接 | `127.0.0.1:5557` |
| 报告号 | `ce1bdc7f-f128-4e8b-a225-bbeb2bee7c35` |
| App | SigMark 1.14.0 |
| 采集方式 | 真机采集 → LAN 上传 → 归档入库（**未做任何手工改字段**） |
| 操作者 | 用户手动启动模拟器并安装；lead 执行采集与打分 |

**它自己声明的身份**：

```
ro.product.model      = RMX5010
ro.product.device     = unicorn
ro.product.brand      = realme
ro.product.first_api_level = 28
ro.build.version.sdk  = 34
```

**它实际暴露的**：

```
cpu.cpuInfo        = AMD Ryzen 9 9950X 16-Core Processor   ← 桌面 CPU
system.boardPlatform = aosp-user                            ← 通用构建
ro.boot.qemu       = 1                                      ← 压根没采（SafeReader 无此枚举）
MemTotal           = 2036460 kB（1.9 GiB）
SELinux            = Permissive
Build.FINGERPRINT  = Xiaomi/unicorn/unicorn:14/...          ← brand 却写 realme
```

**注意最后一行（表述必须准确）**：这台设备的指纹写着 `Xiaomi`，而 `ro.product.brand` 写着 `realme`——**它连自己的品牌都对不上**。

但**这不是「有规则没读它」**。准确的说法是：**这个字段连 Go 白名单都没进、归档报告里根本不存在，采集链路断在上传之前。**

- Android 侧**采了**：`Build.FINGERPRINT`（[DeviceCollectors.kt:108](../app/src/main/java/com/sigmark/app/collector/DeviceCollectors.kt#L108)）；
- **投影没配**：`LanDetails.kt` 的 `system` 集合里没有 `fingerprint`；
- **白名单没有**：`field_dictionary.go` 搜 `fingerprint` 零命中；
- **归档里不存在**：lead 拉了这份报告的全部 195 个字段，`key` 里 `fingerprint` **一个都没有**。

**所以任何后端规则都读不到它——不是因为规则漏了，是因为字段在上传前就被丢了。** 这类断点与「规则漏读」是完全不同的问题，修的地方也完全不同（§7 第二件、§8.1.3）。

（下文 `ro.build.fingerprint` 一行只是**旁证**：说明这台设备的品牌声明本身不自洽。它没有参与任何计分。）

#### 10.9.2 修复前（真实报告，原始值）

| 指标 | 值 |
| --- | --- |
| `band` | **`?`** |
| `virtual_build_markers` | **`not_observed`** |
| behavior 轴扣分 | **15**（只有 SELinux permissive） |
| caps | **无** |
| `decisive` | `false` |

**35 分 + 唯一的行为决定性 cap，被三行属性清零，结论是「无法判定」。**

**为什么 `?` 比 `D` 对攻击者更有利**（这一点必须写清楚，否则会误读成「没被攻破」）：

| | `D` | `?` |
| --- | --- | --- |
| 运维第一反应 | 「这台设备有问题」 | 「这台的字段好像没读到」 |
| 是否会被复核 | **会** | **大概率不会** |
| 是否留下「冲突」记录 | 会（有扣分、有 cap） | **不会**（一条扣分都没有） |
| 攻击者能否继续用 | 能（但被标记） | **能，且无标记** |

**所以这次不是「打平」，是「攻击成功且不留痕」。**

#### 10.9.3 根因（两个，独立）

| # | 根因 | 位置 | 性质 |
| --- | --- | --- | --- |
| 1 | 规则只读 `cpu.hardware` / `system.product` / `system.device`，而这三个键**由模拟器自己填** | [device_profile.go:276](../backend/cmd/sigmark/device_profile.go#L276) | **判据的结构缺陷**，与实现质量无关 |
| 2 | `ro.boot.qemu=1` **从没被采集**——字段字典与白名单里都没有 | `protocol.go` / `SafeReader.Property` | **采集缺口**，一条已知正确的判据根本没接上 |

**第二个根因尤其值得记**：这台设备**主动承认了**，我们却没接。就像门口装了摄像头，但没接电。

#### 10.9.4 修复后的判定（同一个测试，fixture 从真实报告抄来）

[score_redteam_emulator_test.go:34](../backend/cmd/sigmark/score_redteam_emulator_test.go#L34) 的 `ldPlayerReport()` 就是上表那批字段（注释写明「copied from the archived report so the fixture cannot drift away from the measurement」）。

| 指标 | 修复前 | 修复后 |
| --- | --- | --- |
| `band` | **`?`** | **`D`** |
| `decisive` | `false` | **`true`** |
| behavior 轴扣分 | 15 | **35 + 15 + 12**（结构 35 + SELinux 15 + root 管理器 12） |
| caps | 无 | `DECISIVE_VIRTUAL_BUILD → D` |
| `detail` | （无） | `设备自相矛盾：desktop_cpu_info、generic_board_platform（cpu.cpuInfo=AMD Ryzen 9 9950X 16-Core Processor）（system.boardPlatform=aosp-user）` |

**四个测试的断言方向**（都写成「断言漏洞已关闭」，与前几轮一致）：

| 测试 | 断言什么 |
| --- | --- |
| `TestRedteamEmulatorRewritesEveryVirtualBuildMarker` | 三个键**确实都绕过了**黑名单（前提不变），标签确实是 `not_observed`——**这一条断言的是「绕过仍然存在」，它保证 fixture 没跑偏** |
| `TestRedteamStructuralContradictionCatchesWhatTheBlocklistMisses` | 两个结构通道**都能单独命中**，且至少 2 条 |
| `TestRedteamStructuralCheckDoesNotFireOnRealDevices` | **7 个真机/空白样本一个都不误伤**（Pixel 6 Tensor ×2、MI 8 SDM845、Redmi mt6985、8 Gen 3 pineapple、天玑 9300 mt6989、空白） |
| `TestRedteamOneRewriteIsNotEnough` | 只把 `boardPlatform` 改成 `pineapple` **不够**，`cpuInfo` 仍独立命中 |
| `TestRedteamFakingPlatformAloneIsCheap` | 改 `boardPlatform` 后该通道**当场失效**；两条都改则结构性证据**归零**——**这是规则的诚实上限，不是 bug** |
| `TestRedteamCpuInfoSurvivesPlatformRewrite` | 把 `boardPlatform` 依次设成 `pineapple` / `gs101` / `sdm845` / `mt6985`，`cpuInfo` 通道**始终独立成立** |

#### 10.9.5 两条通道的成本实测（**本节是一次纠正**）

我原来把两条通道描述成「都更贵」，**错了一半**。lead 在雷神上用 adb 实测，输出原文：

**`boardPlatform` —— 一条命令就改掉了**：

```
setprop ro.board.platform test_probe
→ getprop ro.board.platform = test_probe        ← 改成功（已恢复为 aosp-user）
```

**`cpuInfo` —— 写不进去**：

```
echo 'model name : fake' > /proc/cpuinfo
→ /system/bin/sh: can't create /proc/cpuinfo: Permission denied

ls -l /proc/cpuinfo
→ -r--r--r-- 1 root root 0                      ← 只读，root 属主
```

**根因在采集侧**（[DeviceCollectors.kt:129](../app/src/main/java/com/sigmark/app/collector/DeviceCollectors.kt#L129)）：

```kotlin
declaredProperty("boardPlatform", "ro.board.platform", "平台代号声明", ...)
```

**`boardPlatform` 是一个属性**，不是构建产物。它和 `cpu.hardware` / `system.product` / `system.device` 同一个价位。

| 通道 | 来源 | 改造成本 | 实测 |
| --- | --- | --- | --- |
| `system.boardPlatform` | `ro.board.platform` **属性** | **1 条 `setprop`** | 已改成功 |
| `cpu.cpuInfo` | `/proc/cpuinfo` **内核视图** | 需改 guest kernel 视角 | shell 写被拒，文件 `-r--r--r--` |

**所以准确的结论是**：

> **一条通道更贵（`cpuInfo`，`/proc` 透传，`resetprop` 无效），一条通道只是问了不同的问题（`boardPlatform` 问「平台串像不像 SoC 代号」，但它本身照样能被一条 `setprop` 清掉）。**
>
> **规则的真实强度 = 一条硬通道 + 一条软通道，不是两条硬通道。**

**更要紧的推论**：只要模拟器厂商把 `ro.board.platform` 改成真实代号（如 `pineapple`），**`boardPlatform` 通道立刻失效，35 分全靠 `cpuInfo` 一条撑着**。`TestRedteamCpuInfoSurvivesPlatformRewrite` 就是为这个边界写的——它把 `boardPlatform` 逐个换成四个真代号，`cpuInfo` 每次都独立成立。

**这条纠正已经写进代码注释**（[virtual_evidence.go:24](../backend/cmd/sigmark/virtual_evidence.go#L24) 起，标题是 `HONEST COST NOTE, corrected after review`），并有两个测试锁住边界，防止这个说法漂回去。

#### 10.9.6 全包与回归

| 项 | 结果 |
| --- | --- |
| `go test -v -count=1 ./cmd/sigmark` | **147 PASS + 3 SKIP = 150 顶层**；`RUN` 行 **220**；**FAIL 0**（本轮新增 `score_redteam_cost_test.go` 四个 Test，140→150） |
| 全库 24 份（含这台 LDPlayer） | **零漂移**，全部 `version=sigmark-score/4`；分布 **A:4 / D:8 / B:4 / ?:7 / 雷神 D** |
| 黄金 5 份 | 数值**全部不变**（Pixel6 82/D、MI8 100/A、三份仿真器 D），只有 `version` 一行变 |
| Web | **103/103/0** |

**注意「全库 24 份零漂移」与「雷神从 `?` 变 `D`」并不矛盾**：前者说的是**已经归档的历史报告**（它们的字段集里没有 `ro.boot.qemu`，也不需要），后者说的是**这一台被重新打分**。**这正是 `scoreVersion /4` 的意义：它告诉消费方「同一份归档现在可能得出不同结论」**，所以前端必须按版本着色，不能把 `/3` 的数字和 `/4` 的数字混排。

#### 10.9.7 修复的边界（这一节存在的意义就是防止过度乐观）

**这次修复抬高了成本，没有关闭这条路——而且抬高的部分全部来自一条通道。**

| 攻击者要怎么绕 | 成本 | 说明 |
| --- | --- | --- |
| 只改 `ro.board.platform` → `pineapple` | **极低（1 条 `setprop`，已实测）** | **这条通道失效**，但 `cpuInfo` 仍响（`TestRedteamOneRewriteIsNotEnough`） |
| 只让 `cpuInfo` 报 ARM 形态 | **高**（`resetprop` 无效，要 hook 文件读 / 改内核视图） | **有效**：`desktop_cpu_info` 静默 |
| 两条都改 | **1 条 `setprop` + 一处 `/proc` 伪造** | **有效，且是本条修复的天花板**（`TestRedteamFakingPlatformAloneIsCheap` 明确断言证据归零）——届时只剩 `ro.boot.qemu`（而它还没被采集） |

**成本不对称这一点必须说清**：攻击者**不需要**「同时伪造两条贵通道」。他只需要**做一件便宜的事**（`setprop`）+ **一件贵的事**（改 `/proc`）。**乘法的效果在「一条贵一条便宜」时会退化成加法**（§8.1.2）。

**说到底**：结构判据把「零成本」变成了「一条属性 + 一处 `/proc`」，**这是黑名单类判据能达到的上限**，而且这个上限比第一版写的要低。真正的收敛要靠**补第二观察者**（§7 第四件）和**接上 `ro.boot.qemu`**（§7 第二件）。

#### 10.9.8 这一条教的东西（与 §8.1 四条合并看）

| 教训 | 本轮第几次出现 |
| --- | --- |
| 非空≠对 | 第三次 |
| 有数字≠有口径 | 第三次 |
| 自洽≠干净 | 第二次 |
| **黑名单的输入由对手提供** | **第一次**，且是最重的一次（§8.1.2） |
| **成本看数据来源，不看判据问什么** | **第一次**——`boardPlatform` 换了个问题，成本没变（§8.1.2、§10.9.5） |

**前三条都是「我们把数据读错了」；第四条是「数据本身由对手写」；第五条是「我们以为换了个问题就换了成本，其实没换」。**

**这一条的修法（换通道）与前三条的修法（补判据）完全不同**——但第五条又给「换通道」加了个限制：**只有同时换了数据来源才算换通道**，只换问题不算。这也是为什么它值得单独占一节。