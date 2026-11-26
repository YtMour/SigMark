# 虚拟化平台实测台账

本文件只记录**实测数据**，不写推测。每条都标明设备、时间、命令与原始输出。
用途：给 `docs/SECURITY-SCORE.md` 与 `docs/SCORE-REDTEAM.md` 提供可复现的现场依据，
并界定「哪些判据在一个第三方模拟器上还有效」。

最后更新：2026-11-26。

---

## 〇、铁律：一切以 App 视角为准

这一条排在本文件所有实测之前，因为它是**口径**，不是结论。口径错了，后面每一个数字都会跟着错。

> **SigMark 是 App。产品形态是普通应用在普通用户手机上采集。**
> **adb / shell 读数只是开发期的辅助观察，不是产品能力，不得与 App 采集结果混为一谈。**
> **任何判据、任何样例、任何结论，都必须以 App 视角的采集结果为准。**

### 0.1 为什么需要把这条写成铁律

本文件里有大量 `adb shell` 命令——`setprop`、`ls -l /proc/cpuinfo`、`mount`。**它们全部只用于开发期探边界，不是产品行为。** 产品装到用户手机上时：

- 没有 `adb`，没有 `shell`，没有 `root`；
- 只有 `Context`、`Build.*`、`getprop`（普通应用身份）、`/proc` 的公开可读部分；
- 系统拒绝的一律记 `RESTRICTED`，**不许用 adb 读到的值去补**。

### 0.2 一个现场例证：同一个字段，两种读法给两个答案

Pixel 6 的 `ro.board.platform`：

| 视角 | 值 | 是否产品口径 |
| --- | --- | --- |
| 现场 adb 观察 | `gs101`（这台机器的真实平台） | ❌ **不是** |
| App 归档（报告 `2b931bd3`，字段集 26） | `mt6985` | ✅ **是** |

产品只认 **`mt6985`**。归档值可复核（`system.boardPlatform` 与 `system.board` 在这份报告里都是 `mt6985`）。

**这里要格外小心，不要把「不一致」讲成「adb 更准」**：App 与 adb 读的是同一条 `ro.board.platform`，两者若真的不同，只可能来自两次读取之间属性被改写过。而**无论哪种情况，结论都一样——adb 读数不能进产品口径**。真实 SoC 是 `gs101` 这件事，本文件是靠**硬件通道**推出来的（`cpu.cpuCapacity=160/498/1024`、`memory.cmaTotal=652 MiB`、`environment.overlayEvidence` 的 `soc:gs101`），不是靠属性。

### 0.3 这条铁律对判据的三个约束

| 约束 | 含义 | 本文件里的例子 |
| --- | --- | --- |
| **采集能力** | 只有 App 能拿到的字段才算数 | `ro.boot.qemu` 以前根本没采（§2.3），规则写得再好也无输入 |
| **观察视角** | 同一个字段在不同视角下可能是两个值 | §0.2 的 `gs101` / `mt6985` |
| **状态语义** | `RESTRICTED` / `UNAVAILABLE` 是结论的一部分，不是待补的空 | 两台真机 `system.selinux` 都是 `RESTRICTED`，不许用 adb 补成 `enforcing` |

---

## 一、为什么需要这份文件

打分体系有大量判据读的是 `ro.*` 属性。属性值在真机上由 ROM 决定、应用改不了；
但在模拟器上，宿主机 shell 往往能直接改写。**如果不先测清楚「谁能改什么」，
就无法判断一条规则到底是「检测」还是「自证」。**

本文件用一台真实存在的第三方模拟器（雷神 / LDPlayer 9）把这条边界测出来。

---

## 二、被测平台

| 项 | 值 |
| --- | --- |
| 平台 | 雷神模拟器（LDPlayer 9） |
| 连接方式 | `adb connect 127.0.0.1:5557` |
| 最新报告（字段集 **26**） | `9d5b546e-11d6-4c1d-9236-539eb4842736` |
| 采集时间 | 2026-11-26 15:51:32（+08:00） |
| App | SigMark 1.21.2（`com.sigmark.app`） |
| 采集项 | 251 项（coverage 汇总）；`system.bootQemu = '1'`，`AVAILABLE` |
| 历史报告 | `6642e350`（字段集 25）、`ce1bdc7f`（字段集 20）——§3 的全部改写实测都在这两份上做的 |

> **为什么同时留三份**：§3 的 `setprop` 实测是在字段集 20/25 的报告上做的，那时还没有
> `bootQemu`。字段集 26 的意义是「把自曝属性采进来」，不改变 §3 的任何结论。

### 2.1 它声明的身份

```
ro.build.version.sdk            = 34
ro.product.first_api_level      = 28
ro.product.model                = RMX5010
ro.product.device               = unicorn
ro.product.brand                = realme
ro.product.manufacturer         = realme
ro.product.name                 = RMX5010
ro.board.platform               = aosp-user
ro.boot.hardware                = qcom
ro.hardware                     = qcom
ro.hardware.egl                 = adreno
```

### 2.2 它的自相矛盾（四条，全部实测）

1. **品牌矛盾**：`brand`/`manufacturer`/`model` 全写 realme `RMX5010`，但四个
   fingerprint 全是 `Xiaomi/unicorn/unicorn:14/...`。
2. **代号矛盾**：`ro.product.device = unicorn` 是小米 12 的代号，却被标成 realme。
3. **硬件矛盾**：`ro.boot.hardware = qcom`，但 `/proc/cpuinfo` 报
   **AMD Ryzen 9 9950X 16-Core Processor**（宿主机 CPU 直通）。
4. **平台矛盾**：`ro.board.platform = aosp-user`，真机此处是 SoC 代号
   （`gs101` / `sdm845` / `mt6985` / `pineapple`）。

### 2.3 它的直接自曝

```
ro.boot.qemu = 1        ← 仍然存在
ro.kernel.qemu = (空)   ← 被清掉了
```

**只清了常见的那个，漏了 `ro.boot.qemu`。** 这条自曝长期没进报告，因为采集端
（`SafeReader.Property`）两个都没有枚举——**这是采集缺口，不是规则漏读**。

**字段集 26 已补上**（`DeviceCollectors.kt:139` 的 `declaredProperty("bootQemu", "ro.boot.qemu", …)`，
`LanDetails.kt:14`/`:30` 投影，`protocol.go:96` 白名单 `{"system", "bootQemu", 26}`）。
三台设备实测结果：

| 设备 | `system.bootQemu` | 状态 |
| --- | --- | --- |
| 雷电 LDPlayer 9（`9d5b546e`） | **`1`** | `AVAILABLE` |
| Pixel 6（`2b931bd3`） | `''` | `UNAVAILABLE` |
| MI 8（`dd334a08`） | `''` | `UNAVAILABLE` |

**这是「一条 getprop 分开真假」的实证**：雷电清掉了 `ro.kernel.qemu`，却漏了 `ro.boot.qemu`。

**但必须同时说清两件事，否则会把这条字段的价值说过头**：

1. **空值 ≠ 干净。** 两台真机都是 `UNAVAILABLE`（属性不存在），雷电是 `'1'`。
   读到 `'1'` 是**直接证据**；读到空只表示**没报告**，不表示不是模拟器——
   一个记得 `resetprop ro.boot.qemu` 的模拟器同样会给出空值。
2. **目前还没有规则读它。** 全库 grep `bootQemu`，除白名单 `protocol.go:96` 外
   **没有任何规则消费它**。所以它现在的状态是「**采到了、归档了、判据还没接**」——
   这正是 §6.5 那条方法论的实例：证据已经在库里，缺的是有人去接。

---

## 三、改写能力实测（本节是核心）

以下每条都在雷神上真实执行过，命令与输出原样保留。

### 3.1 `ro.*` 属性能被直接覆盖 —— **能**

```
$ adb -s 127.0.0.1:5557 shell "setprop ro.build.tags test-keys; getprop ro.build.tags"
test-keys
```

```
$ adb -s 127.0.0.1:5557 shell "setprop ro.board.platform test_probe; getprop ro.board.platform"
test_probe
```

（两条均已恢复原值：`release-keys`、`aosp-user`）

**含义**：任何以 `ro.*` 属性为输入的判据，在雷神上都可被一行 `setprop` 改写。
包括 `ro.build.tags`（`rom_verification` 的输入之一）与 `ro.board.platform`
（结构性虚拟化证据的输入之一）。

### 3.2 `persist.*` 属性能写 —— **能**

```
$ adb -s 127.0.0.1:5557 shell "setprop persist.sigmark.probe persisted_value; getprop persist.sigmark.probe"
persisted_value
```

**含义**：模拟器可持久化状态，不存在「重启就忘」这一层限制。

### 3.2b `rom_verification` 的两个输入也能改 —— **能**

`rom_verification` 读两个键：`environment.verityMode`（← `ro.boot.veritymode`）与
`environment.buildDebuggable`（← `ro.debuggable`）。两条都实测过：

```
$ adb -s 127.0.0.1:5557 shell "setprop ro.boot.veritymode enforcing; getprop ro.boot.veritymode"
enforcing                                        ← 原本为空，改成功

$ adb -s 127.0.0.1:5557 shell "setprop ro.debuggable 1; getprop ro.debuggable"
1                                                ← 原本 0，改成功
```

（均已恢复：`ro.boot.veritymode` 空、`ro.debuggable` 0）

**含义**：`rom_verification` 在雷神上**同样是软通道**。这不是推断，是实测。
进一步说，凡是输入落在 `ro.*` 上的判据，在这台模拟器上都不构成有效约束——
这是全体系层面的限制，不是某一条规则的问题。

### 3.3 `/data` 可写 —— **能**

```
$ adb -s 127.0.0.1:5557 shell "touch /data/local/tmp/probe && echo writable || echo denied"
writable
```

### 3.4 `/proc/cpuinfo` 不能被普通写 —— **不能**

```
$ adb -s 127.0.0.1:5557 shell "echo 'model name : fake' > /proc/cpuinfo"
/system/bin/sh: can't create /proc/cpuinfo: Permission denied

$ adb -s 127.0.0.1:5557 shell "ls -l /proc/cpuinfo"
-r--r--r-- 1 root root 0 2026-11-26 14:03 /proc/cpuinfo
```

**含义**：`cpu.cpuInfo` 是 `/proc` 内核视图，**shell 权限改不了**。要伪造它，
必须改 guest kernel 对 `/proc/cpuinfo` 的输出（内核模块、LD_PRELOAD 注入、
或换一个把 CPU 型号也一起假造的内核），这比一条 `setprop` 贵得多。

**这是全库唯一一条实测「改起来更贵」的通道。**

### 3.5 能力汇总表

| 目标 | 雷神上能否改写 | 手段 | 实测 |
| --- | --- | --- | --- |
| `ro.*` 属性 | **能** | `setprop` 一行 | ✅ |
| `persist.*` 属性 | **能** | `setprop` 一行 | ✅ |
| `/data` 文件 | **能** | 直接写 | ✅ |
| `/proc/cpuinfo` | **不能** | 需改内核视角 | ✅（被拒） |

### 3.6 逐条属性实测清单

所有条目都在雷神上真实执行过 `setprop` 并读回确认，测后已恢复原值。

| 属性 | 原值 | 改为 | 结果 | 影响的规则 |
| --- | --- | --- | --- | --- |
| `ro.build.tags` | `release-keys` | `test-keys` | **改成功** | `rom_verification` |
| `ro.board.platform` | `aosp-user` | `test_probe` | **改成功** | `STRUCTURAL_VIRTUAL_EVIDENCE` 软通道 |
| `ro.boot.veritymode` | （空） | `enforcing` | **改成功** | `rom_verification` |
| `ro.debuggable` | `0` | `1` | **改成功** | `rom_verification` |
| `persist.sigmark.probe` | （不存在） | `persisted_value` | **改成功** | （探针，验证持久化） |
| `/proc/cpuinfo` 写入 | — | — | **Permission denied** | `STRUCTURAL_VIRTUAL_EVIDENCE` 硬通道 |

**结论**：六项里五项可写，唯一写不动的是 `/proc/cpuinfo`。

**补一条只读项**：`ro.boot.qemu` 本轮没有做改写测试（改写它没有意义——它的价值在于
「模拟器有没有忘记清它」）。只做了**读取实测**：雷电 `getprop ro.boot.qemu` = `1`，
两台真机为空。见 §2.3。


---

## 四、对打分体系的意义

### 4.0 攻击成本清单：把雷神变成 A 要改几个字段

这是本文件最有用的一个结论，因为它是**可数的**，不是感觉。

雷神的报告当前是 **D（decisive）**。要把它推到 A，必须让所有计分通道安静。
按 `score.go` 的规则表逐条数：

| 规则 | 分值 | 决定性 | 读什么 | 攻击者要做什么 |
| --- | --- | --- | --- | --- |
| `VIRTUAL_BUILD_MARKERS` | 35 | ✅ | `cpu.hardware` / `system.product` / `system.device` | **3 个属性**（雷神已做完） |
| `STRUCTURAL_VIRTUAL_EVIDENCE` | 35 | ✅ | `cpu.cpuInfo` / `system.boardPlatform` | **1 个属性 + 1 处 `/proc`** |
| `HOOK_INJECTION` | 25 | | hook + mount 标签 | 1 个标签 |
| `DEBUGGER_ATTACHED` | 20 | | debugger + tracerPid | 1 个标签 |
| `SELINUX_PERMISSIVE` | 15 | | selinux 标签 | 1 个属性 |
| `ROOT_MANAGER_VISIBLE` | 12 | | root 管理器包 | 卸载 1 个包 |
| `MULTI_OPEN` | 8 | | 分身标签 | 1 个标签 |
| `FOREIGN_PROFILE` | 30 | | 声明 SoC vs 实测 SoC | 让两者一致 |
| `OVERLAY_CODENAME_MISMATCH` | 15 | | overlay 代号 vs 设备 | 让两者一致 |
| `HARDWARE_CHANNEL_CONFLICT` | 30 | | 声明 vs 实测硬件通道 | 让两者一致 |

**两条决定性规则的最小编辑集 = 2 个字段：**

1. `system.boardPlatform` ← 一条 `setprop`（**免费**）
2. `cpu.cpuInfo` ← 必须改 guest kernel 对 `/proc/cpuinfo` 的输出（**唯一贵的一步**）

**注意**：清掉两条决定性规则**不等于拿到 A**。declaration 轴还有三条比对规则
（`FOREIGN_PROFILE` 30 / `OVERLAY_CODENAME_MISMATCH` 15 / `HARDWARE_CHANNEL_CONFLICT` 30），
它们比的是「声明 vs 实测」，要让它们安静，得让声明和实测**互相自洽**——那需要更多编辑，
且其中一部分读的是同一个 `/proc`。

**所以准确的说法是**：

> **从 D 到「不 decisive」= 2 个字段。从 D 到 A = 2 个字段 + 让所有声明与实测自洽。**

把这两件事混成一句「改两处就能拿 A」是错的，本文件不这么写。

### 4.0b 真机回归：新规则没有误伤真机（2026-11-26 实测，字段集 26 三设备）

这一节是**反向验证**。前面所有内容都在证明「模拟器被抓住了」，但一条新规则如果
连真机也抓，那不是修好了，是**把所有人一起打死**。所以必须回答：新通道会不会误伤真机？

#### 4.0b.1 字段集 26：三台设备同一版本、同一天、同一 APK

这一轮把三台设备全部升到 **字段集 26 + App 1.21.2**，同一天连续采集，是**唯一一次
三设备口径完全一致**的对照。之前 §4.0b 只有 Pixel 6 / MI 8 两台字段集 25 的数据。

| 设备 | 报告 ID | 字段集 | 采集项 | `system.bootQemu` | band | value | decisive | 行为轴 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 雷电 LDPlayer 9 | `9d5b546e` | **26** | 251 | **`'1'` AVAILABLE** | **D** | **71** | True（`DECISIVE_VIRTUAL_BUILD`） | **50** |
| Pixel 6 | `2b931bd3` | **26** | 281 | `''` UNAVAILABLE | **D** | **82** | True（`DECISIVE_FOREIGN_PROFILE`） | **100** |
| MI 8 | `dd334a08` | **26** | 276 | `''` UNAVAILABLE | **A** | **100** | **False** | **100** |

数据来自报告 `9d5b546e-11d6-4c1d-9236-539eb4842736` / `2b931bd3-18d7-4dfe-a7ca-3e354c37ee09` / `dd334a08-d646-4208-bc09-e4a974c7671b`。

> **「采集项」的口径**：取 `report.coverage` 里 12 个分组 `available + restricted + unavailable + errors` 之和，**不是** `report.parameters` 数组长度（三份分别是 210 / 215 / 209）。两者不同，因为 coverage 统计的是采集器尝试过的全部条目，`parameters` 只收实际进报告的。本文件统一用 coverage 口径。

#### 4.0b.2 三条读法

**① 雷电拿到 D / 71，decisive 来自结构通道。** 行为轴 50 = 100 − 35（`STRUCTURAL_VIRTUAL_EVIDENCE`）− 15（`SELINUX_PERMISSIVE`）。它的 declaration 轴**没有分数**（覆盖 0.33，三台比对单元全答不出），这是 R7/R8 的正常行为，不是缺陷——见 §4.4 缺陷 1。

**② MI 8 拿到 A / 100 / 非决定性 —— 这是「新字段没误伤真机」的证据。** 它的 `system.bootQemu` 是 `UNAVAILABLE`、`system.boardPlatform = sdm845` 是真实 SoC 代号、`cpuInfo` 是真实高通内核视图。**新采的字段在这台机器上既没有给出假阳性，也没有把它的分数拉下来。** 一个新增的「模拟器自曝」字段如果会让老真机掉分，那它就不是判据，是噪声。

**③ Pixel 6 拿到 D / 82，但它的 D 不是新通道给的。** 行为轴 **100**（新通道一声没响），D 来自 declaration 轴的 `FOREIGN_PROFILE` 30 + `OVERLAY_CODENAME_MISMATCH` 15。它确实在伪装机型，所以这个 D 是对的；但它同时证明**两条新通道在真机上不误伤**。

#### 4.0b.3 样本量与局限

**2 台真机 + `TestRedteamStructuralCheckDoesNotFireOnRealDevices` 里的 7 个真机 fixture，不是统计意义上的误报率。** 要给出真正的误报率，需要 ≥30 台不同 SoC 的真机样本——这一项仍未做。

另外，三台设备里有 **1 台是模拟器、2 台是真机**，且两台真机分别是 `gs101` 与 `sdm845`。`mt6985`（Pixel 6 伪装时上报的值）**没有一台真机实测过**——它的画像是从注册表来的，不是从真机采的。

### 4.1 一条硬通道，一条软通道

`STRUCTURAL_VIRTUAL_EVIDENCE`（35 分，决定性）有两条通道：

| 通道 | 输入 | 在雷神上的实际强度 |
| --- | --- | --- |
| `desktop_cpu_info` | `cpu.cpuInfo` ← `/proc/cpuinfo` | **硬**（`setprop` 无效） |
| `generic_board_platform` | `system.boardPlatform` ← `ro.board.platform` | **软**（一行 `setprop` 即失效） |

**规则的真实强度 = 一条硬通道 + 一条软通道，不是两条硬通道。**

只要模拟器厂商把 `ro.board.platform` 改成真实代号（`pineapple` 等），
`generic_board_platform` 立刻失明，35 分全靠 `cpu.cpuInfo` 一条撑着。

### 4.2 为什么 `cpu.cpuInfo` 仍然值得依赖

因为它读的不是属性，是内核视图。一台把 CPU 型号也假造干净的模拟器，
已经不叫「伪装」了，它改的是 guest 内核——那是另一个工程量级。

**但要诚实**：这不是「不可伪造」，是「伪造更贵」。前几轮已经把
「不可伪造」这个说法撤回一次（`initialSdk` 那回），这里不再犯。

### 4.3 已有测试锁住的边界

| 测试 | 锁的是什么 |
| --- | --- |
| `TestRedteamFakingPlatformAloneIsCheap` | 改 `boardPlatform` 即可让该通道失效；两条都改则结构性证据归零——规则的诚实上限 |
| `TestRedteamCpuInfoSurvivesPlatformRewrite` | `boardPlatform` 依次设 `pineapple`/`gs101`/`sdm845`/`mt6985`，`cpuInfo` 通道始终独立成立 |

### 4.4 评分体系缺陷修复：`sigmark-score/4` → `/5`

这一节记的是**打分体系自己的 bug**，不是规则的取舍。三个缺陷全部由**雷神的真实数据**暴露，
其中第二个**在真机上永远暴露不了**。

#### 4.4.1 缺陷清单

| # | 缺陷 | 性质 | 修复 | 锚点 |
| --- | --- | --- | --- | --- |
| 1 | 决定性命中时吞掉 `value` | bug | 条件改为 `declarationBlind && !out.Decisive` | `score.go:470` |
| 2 | **behavior 轴分与自己的账本不符** | **bug，最严重** | `finalizeScoreAxis` 移到结构通道 append **之后** | `score.go:1082`–`1092`、`:706` |
| 3 | `FRESH_BOOT_ON_AGED_ROM` 在模拟器误报 −12 | 误报 | 虚拟化已确认时抑制（一因一果、单向） | `score.go:1287`、`virtualEvidenceConfirmed` `:1103` |

版本号同步升到 `sigmark-score/5`（`score.go:67`）；`sigmark-profile/9` **不变**——变的只有计分，标签与画像规则没动。

#### 4.4.2 缺陷 1：决定性报告没有分数

雷电的报告曾经 `band=D`、`decisive=true`，但 `value` 是**空的**。原因：declaration 轴三个比对单元一个都答不出（没有 `system.socModel`、没有 `cpu.cpuCapacity`、没有 `memory.cmaTotal`），轴覆盖 0.33，于是被当成「整份报告太薄」而撤掉数字——**可整份报告覆盖是 0.73，并不薄**。

问题在于那条判断把「某一条轴瞎了」和「整份报告瞎了」混成同一个条件。修复后 `band=D` 的结论不变，但**数字回来了**：雷电 `value = 71`。

为什么数字重要：两台都是 D 的时候，`band` 已经无法再区分谁更差，**唯一的排序依据就是这个数字**。

#### 4.4.3 缺陷 2：轴分和它自己的账本对不上（本文件最重要的一条）

**症状**：`STRUCTURAL_VIRTUAL_EVIDENCE` 那 35 分**从来没进过轴分**。

存档报告上印的是：

```
behavior 轴 score = 85          （= 100 − 15，只减了 SELINUX_PERMISSIVE）
behavior 轴 deductions = 35 + 15 = 50
```

**轴分和它自己的扣分明细差了 35 分。** 加权总分 91 也是从这个错的 85 算出来的，与两条扣分都对不上：

```
若 behavior = 85（错）、usage = 100、declaration 轴不参与平均（覆盖 0.33 < 0.5）：
  (85 × 35 + 100 × 25) / (35 + 25) = (2975 + 2500) / 60 = 91.25 → 91
若 behavior = 50（对）：
  (50 × 35 + 100 × 25) / 60 = (1750 + 2500) / 60 = 70.83 → 71   ← 修复后的实测值
```

**这两个数（91 与 71）都能手算复现**，所以「账本与分数矛盾」不是感觉，是可验证的算术事实。代码里也留了同样的记录（`score.go:1084`–`1087`）。

**根因**：结构通道的扣分是**在轴已经 finalize 之后**才 append 的——`finalizeScoreAxis` 先算完 `100 − Σpoints`，然后代码又往 `Deductions` 里塞了一条 35 分。账本被追加了，分数没重算。

**修复**：把 `finalizeScoreAxis(&axis, …)` 移到结构通道 append **之后**（`score.go:1092`）。修复后雷电：`value` 空→**71**，behavior 轴 空→**50**，usage 轴 空→**100**。

**为什么这条在真机上永远暴露不了**：

| 设备 | 结构通道 | 会不会触发这个 bug |
| --- | --- | --- |
| 任何真机 | 不命中（`implementer 0x` 短路 / 平台串是真 SoC 代号） | **不会**——不 append 就不存在「append 后没重算」 |
| 模拟器 | 命中 35 分 | **会** |

也就是说：**这个 bug 只在「规则真的命中了决定性通道」时才现形，而只有模拟器会命中。** 没有一台模拟器，这条缺陷可以一直躺在代码里，所有真机报告都自洽。

**这是本轮最值得带走的方法论教训**：

> **真机数据能证明「没误伤」，但不能证明「算对了」。**
> 一条只会对模拟器生效的代码路径，只能靠模拟器的数据来验。
> 所以「模拟器样本」不是可选的补充，它是**唯一能照出这类 bug 的灯**。

#### 4.4.4 缺陷 3：U2 在模拟器上误报 12 分

`FRESH_BOOT_ON_AGED_ROM`（U2）问的是「一台几乎没冷启动过的机器，却声称自己是更老的一代」。在模拟器上这个形状**是必然的，不是可疑的**：

- AVD/雷电的 `ro.product.first_api_level` 来自它自己的系统镜像，所以「SDK 28 的设备跑 android-14 镜像」是**官方镜像的正常布局**；
- 新建实例 `bootCount` 就是 1–2。

雷电实测：`initialSdk = 28`、`bootCount = 2` → U2 扣 12 分，**扣的是「它是模拟器」这件事**，而这件事行为轴已经决定性地扣了 35 分。**一因两罚，违反 R2。**

**修复方向是单向抑制**：只在「虚拟化已被独立通道确认」时抑制。这样：

- 一台真的 2017 年老机被重置一次，仍然拿它的 12 分；
- 攻击者**不能靠自称模拟器来获得抑制**——因为自称的代价是 35 分决定性加一个 D。

**覆盖率不受影响**：抑制的是**计价**，不是**可判性**。`decided` 仍记 1，因为「我们看得出来」和「我们扣了分」是两句话。

四个测试锁住这条边界（`score_ldplayer_test.go`）：

| 测试 | 锁什么 |
| --- | --- |
| `TestUsageFreshBootIsSuppressedOnAConfirmedVirtualDevice` | 确认虚拟化时确实不扣 |
| `TestUsageFreshBootStillFiresOnRealHardware` | **真机仍然扣**——抑制不能变成豁免 |
| `TestUsageFreshBootIsSuppressedByTheBuildMarkerChannelToo` | 两条通道任一条确认都够 |
| `TestUsageFreshBootSuppressionLeavesCoverageAndGapsAlone` | 只动计价，不动覆盖与未决项 |

#### 4.4.5 三个缺陷的共同点

三条**都不是规则设计错了，而是「结论算出来了，但没印对」**：

| 缺陷 | 算错了吗 | 印错了吗 |
| --- | --- | --- |
| 1 | 没算错（band 对） | **印错**（数字丢了） |
| 2 | **算错了**（轴分漏 35） | 也印错了（账本与分数矛盾） |
| 3 | 算错了（多扣 12） | 印对了（如实反映多扣） |

所以验证不能只看 `band`：**`band` 对，不代表分数对；分数对，不代表账本对。** `TestScoreDecisiveAxisScoreMatchesItsOwnLedger` 就是为此写的——它对**每个 fixture** 断言 `轴分 == clamp(100 − Σpoints, 0, 100)`，因为「某条分支在求和之后 append」这种错从任何单条分支都看不出来，只能整体扫。


---

## 五、平台覆盖现状

| 平台 | 属性实测 | 采集上传 | **字段集 26 实测** | 状态 |
| --- | --- | --- | --- | --- |
| AOSP AVD `sigmark-emu34`（android-34） | ✅ | ✅ | —（未在 26 上复采） | 完成（字段集 20–25 时代） |
| AOSP AVD android-30（老 API） | ✅ | ✅ | —（未在 26 上复采） | 完成（官方重发镜像） |
| 雷神 LDPlayer 9 | ✅ | ✅ | ✅ `9d5b546e` | **完成（本文件主体）** |
| **Pixel 6（真机）** | ✅ | ✅ | ✅ `2b931bd3` | 完成（伪装机型的真机样本） |
| **MI 8（真机）** | ✅ | ✅ | ✅ `dd334a08` | 完成（原生真机对照） |
| redroid（容器化） | ❌ | ❌ | ❌ | **环境阻塞**：Windows 内核无 `/dev/binder`，容器 exit 129 |
| Android-x86 / Bliss | ❌ | ❌ | ❌ | 未开始（需 VirtualBox/VMware + ISO） |
| Waydroid | ❌ | ❌ | ❌ | 未开始（需 Linux + Wayland，Windows 不可用） |
| arm64-v8a 在 x86 宿主 | ❌ | ❌ | ❌ | **FATAL：QEMU2 不支持跨架构**（已下载镜像实测，见 §6.2） |
| `-writable-system` 持久化 | ❌ | ❌ | ❌ | **块设备只读**：root 也解不开（`'/dev/block/sda2' is read-only`） |

### 5.0 字段集 26 的三设备实测（本轮新增）

字段集 26 相对 25 **只多一个 key**：`system.bootQemu`。全库去重后 `group.key` 从 **216 → 217**，
新增的恰好只有这一条，**没有字段被删**。

| 项 | 雷电 LDPlayer 9 | Pixel 6 | MI 8 |
| --- | --- | --- | --- |
| 报告 | `9d5b546e` | `2b931bd3` | `dd334a08` |
| 字段集 | 26 | 26 | 26 |
| App / collector | 1.21.2 | 1.21.2 | 1.21.2 |
| `parameters` 数组长度 | 210 | 215 | 209 |
| coverage 汇总 | 251 | 281 | 276 |
| `system.bootQemu` | **`1`** | `''` | `''` |
| band / value / decisive | D / 71 / True | D / 82 / True | A / 100 / False |

**一句话**：字段集 26 让「模拟器自曝」这条最便宜的判据第一次进了归档，
而且**没有动到任何真机的分数**（MI 8 仍是 A / 100）。


### 5.1 老 API 镜像的结论（已完成项）

android-30（`sdk=30`、`first_api_level=30`、`ro.build.date=2024-07-24`、
`security_patch=2024-08-05`、`model=sdk_gphone_x86_64`、
`hardware=ranchu`、`fingerprint=google/sdk_gphone_x86_64/...:userdebug/dev-keys`）

**结论**：Google 官方重发的老 API 镜像天然构成「老设备 + 新镜像」，
U2（`FRESH_BOOT_ON_AGED_ROM`）的触发条件在官方镜像上**自动成立**。
这属于**误报面**，不是攻击证据——真机刷老 ROM 也会命中。

---

## 六、未完成项（诚实清单，含实测阻塞原因）

### 6.1 `-writable-system` 持久化：**root 也做不到，块设备本身只读**

**路一：AOSP AVD**

```
$ adb remount
Now reboot your device for settings to take effect
$ adb reboot
（设备永久 offline）
```

emulator 37.3.10 在无快照无头配置下，`adb reboot` 后设备不再回来。
`-wipe-data` 后 adb 鉴权重置，同样卡 offline。重试 6 次，放弃。

**路二：雷神 LDPlayer 9（未开 root 时）**

```
$ adb root
adbd cannot run as root in production builds
$ adb remount
/system/bin/sh: remount: inaccessible or not found
```

**路三：雷神 LDPlayer 9（用户开启 ROOT 并重启后）** ← 决定性的一次

```
$ adb root
$ adb shell id
uid=0(root) gid=0(root) groups=0(root) ... context=u:r:su:s0      ← root 确实拿到了

$ adb remount
/system/bin/sh: remount: inaccessible or not found                  ← 命令仍不存在

$ adb shell "touch /system/sigmark_probe"
touch: '/system/sigmark_probe': Read-only file system

$ adb shell "mount -o rw,remount /"
'/dev/block/sda2' is read-only                                      ← 关键一行

$ adb shell "cat /proc/mounts | grep sda2 | head -1"
/dev/block/sda2 / ext4 ro,seclabel,nodev,relatime,errors=panic 0 0
```

**根因**：`/dev/block/sda2` 是**块设备层面的只读**（`brw-------`，整个 ext4 镜像以
`ro` 挂载）。这不是权限问题，root 也解不开——要写必须改虚拟机磁盘镜像，
或用 LDPlayer 自己的多开/镜像编辑工具，不是 adb 层面能做的事。

**结论**：`-writable-system` 在雷神上**三层全试过，全部失败**，且失败原因逐层更底层：

| 层 | 结果 |
| --- | --- |
| 无 root | `adbd cannot run as root` |
| 有 root | `remount` 命令不存在 |
| 有 root + 手动 mount | `'/dev/block/sda2' is read-only` |

**这是「测到边界」，不是「未测」。** 上一版写「环境阻塞」现在可以精确化为
「**块设备只读，root 无法突破**」。


### 6.2 arm64-v8a 在 x86 宿主：**硬性不支持，不是没测**

上一版写「未测（工作量问题）」。**这一轮真去下载并启动了，结论变了：根本跑不起来。**

**做了什么**：

```
$ sdkmanager --install "system-images;android-30;google_apis;arm64-v8a"
（下载完成，system.img 3.0 GB，镜像完整）

$ avdmanager create avd -n arm64test -k "system-images;android-30;google_apis;arm64-v8a"
$ emulator -avd arm64test -no-snapshot -no-audio -no-boot-anim -port 5560
```

**输出（5 秒内退出）**：

```
INFO  | Found systemPath .../system-images/android-30/google_apis/arm64-v8a/
FATAL | Avd's CPU Architecture 'arm64' is not supported by the QEMU2 emulator
        on x86_64 host. System image must match the host architecture.
[exit code: 1]
```

**根因**：Android SDK 自带的 emulator 37.3.10 只提供 **QEMU2 x86_64 宿主**版本。
在 Windows/x86_64 上，它**没有** ARM 转译层（Apple Silicon 上的 emulator 才有，
因为那边宿主就是 arm64）。这不是配置问题、不是缺参数、不是镜像问题——
`FATAL` 级别的架构断言，在 QEMU 启动前就退出。

**所以「arm64 启动速度」这个指标在本机不可能有数字。** 要测它必须换宿主：

| 方式 | 可行性 |
| --- | --- |
| Apple Silicon Mac（宿主即 arm64） | ✅ 原生支持 |
| Linux arm64 服务器 + KVM | ✅ 原生支持 |
| Windows x86_64 + AVD | ❌ **本机实测：FATAL** |
| 真机 arm64（Pixel 6 / MI 8） | ✅ **但那是真机，不是模拟器速度** |

**一个容易混的点**：我们手上两台真机**都是 arm64**，采集正常。所以「arm64 上的
SigMark 能不能跑」已经验证过了（能跑，见 §4.0b）。**没验证的是「arm64 模拟器的启动
有多慢」**——而这个数字在 x86 宿主上不存在。

这一点可以从归档里直接核：字段集 26 三份报告的 `cpu.arch` 与 `cpu.kernelMachine`
分别是 `aarch64`（Pixel 6 `2b931bd3`）、`aarch64`（MI 8 `dd334a08`）、`x86_64`（雷电 `9d5b546e`）。
**两台真机都在 arm64 上跑完了全量采集并成功上传**，所以「arm64 支持」是已验证的；
缺的只是「arm64 模拟器」这个不存在的样本。

**清理**：AVD 已删，3 GB 镜像已 `--uninstall`，环境无残留。

### 6.3 其它虚拟化平台：**已尝试 redroid，环境不支持**

```
$ docker pull redroid/redroid:14.0.0_64only-latest
Status: Downloaded newer image

$ docker run -d --privileged -p 5559:5555 redroid/redroid:14.0.0_64only-latest
$ docker ps -a
Exited (129) 11 seconds ago          ← 无任何日志输出

$ docker run --rm --privileged alpine sh -c "ls /dev/binder*"
ls: /dev/binder*: No such file or directory
```

**根因**：redroid 依赖宿主内核的 binder 模块（`/dev/binder`）。Windows Docker Desktop
跑在 WSL2/Hyper-V 的 LinuxKit 内核里，**没有 binder**，容器在 init 阶段就退出。
这不是配置问题，是宿主内核能力缺失，无法通过参数绕过。

**结论**：redroid 在 Windows Docker Desktop 上**跑不起来**。要测需要 Linux 宿主
（或 WSL2 里自编译带 binder 的内核）。

### 6.4 Android-x86 / Bliss / Waydroid：**未实测，但规则已覆盖**

这几项在本机**装不起来**（原因见下），所以没有实测数据。但「没有设备」和「没有规则」
是两件事——本轮把规则侧补齐了，用的是各平台**公开发布的默认板名**，不是猜。

**为什么本机装不起来**：

- **Android-x86 / Bliss**：需要 VirtualBox/VMware 虚拟机与 ISO 安装，属独立环境搭建。
- **Waydroid**：需要 Linux 宿主 + Wayland 会话，Windows 上不可用。

**规则侧做了什么**（`virtual_evidence.go` 的 `genericBoardPlatforms`，`virtual_evidence.go:60`，本轮扩到 **23 条**）：

| 平台 | 板名 | 来源 |
| --- | --- | --- |
| Waydroid | `waydroid` / `lineage_waydroid` | Waydroid 容器板名 |
| Android-x86 | `android_x86` / `androidx86` | ISO 默认 |
| Bliss OS | `bliss` / `blissos` | 默认 |
| Genymotion | `genymotion` / `vbox` | VirtualBox 板名 |
| QEMU 直启 | `qemu` / `qemu64` / `qemu_arm64` | `-kernel` 直启默认 |
| Cuttlefish | `cuttlefish` / `cf_x86_64_phone` | Android 云模拟器 |
| 原有 AOSP/QEMU | `goldfish` / `ranchu` / `emulator` / `vbox86` / `generic*` / `aosp*` | 原有 |

`desktopCpuMarkers` 同时扩到 **25 条**（`virtual_evidence.go:99`），新增三类：

- **云/服务器 ARM**：`ampere`（Ampere Altra）、`neoverse`、`graviton`（AWS）。
  **这三个是 ARM 服务器芯片**，不是 x86——但它们同样不是手机 SoC，
  一台手机报出它们就是在报宿主 CPU。
- **虚拟化标记**：`virtual cpu`、`qemu virtual`、`kvm`、`virtualbox`、`vmware`。

**关键：`implementer 0x` 短路仍然优先。** 真 ARM 手机的 cpuinfo 带
`implementer 0x41` 这一行，规则见到它就直接判为真机，不做后续 marker 匹配。
这是「一个可疑词」和「确定不是手机」的区别，只有后者能扣 35 分决定性。

**本轮新增 8 个测试**（`virtual_platforms_test.go`），其中三个是防误伤闸门：

| 测试 | 锁什么 |
| --- | --- |
| `TestVirtualPlatformsRecognisedWithoutMeasurement` | 12 个未实测平台的板名都能识别 |
| `TestVirtualPlatformsDoNotFireOnRealHandsetSocs` | **10 个真实 SoC 代号都不命中** |
| `TestVirtualPlatformsServerCpuIsNotAHandset` | 8 个云/服务器 CPU 能识别 |
| `TestVirtualPlatformsArmImplementerStillWins` | **`implementer 0x` 短路优先于 marker** |
| `TestVirtualPlatformsUnknownIsNotEvidence` | **不认识 ≠ 是 VM**（含 `rk3588`/`mt6893`） |
| `TestVirtualPlatformsPrefixStillWorks` | `generic_*`/`aosp_*` 前缀路径仍生效 |
| `TestVirtualPlatformsStructuralEvidenceNamesTheChannel` | 新覆盖真能到计分规则，不是死代码 |
| `TestVirtualPlatformsMeasuredDevicesStillClean` | **Pixel 6 / MI 8 实测值仍零命中** |

**全库回算验证**（当前库内 **29 份**报告，全部按 `sigmark-score/5` 实时回算）：
A:5 / B:4 / D:13 / ?:7，`decisive` 13 份。扩展覆盖**没有误伤任何一份真实报告**。

> 口径说明：报告分数是**读时实时计算**的（`device-profile` 接口现算），不存库。
> 所以「零漂移」只能表述为「当前分布」，不是「与历史值逐份对比」——历史分数没有留存。
> 上一版写的「25 份 / A:4 / B:4 / D:10 / ?:7 / decisive 10」是当时库内报告的份数，
> 本轮新增 3 份字段集 26 报告（雷电、Pixel 6、MI 8）后更新为 29 份。


**必须说清的限制**：这 13 个新平台名**没有一台实测过**。它们来自各平台公开的默认板名，
如果某个平台改了默认值，测试会红，需要有人回去重读该平台的源码。**这是「规则覆盖」，
不是「实测覆盖」**，两者不能混。

### 6.5 一项重要的判断修正

上一版把这几项笼统写成「未测」。**实测后要分开说**：

| 项 | 性质 |
| --- | --- |
| `-writable-system` | **环境阻塞**（两条路都试过，各有明确报错） |
| redroid | **环境阻塞**（宿主内核无 binder） |
| arm64 速度 | **硬性不支持**（x86 宿主上 QEMU2 拒绝启动 arm64 镜像） |
| Android-x86 / Bliss / Waydroid | **未开始**（需另建环境） |

**「未测」和「测了但环境不支持」是两件事。** 前者可能是懒惰，后者是有据可查的边界。
把后者写成前者，会让下一个接手的人重复踩同一个坑。

---

## 七、复现步骤

```powershell
$adb = "C:\Users\YM\AppData\Local\Android\Sdk\platform-tools\adb.exe"

# 1. 连接
& $adb connect 127.0.0.1:5557
& $adb -s 127.0.0.1:5557 shell getprop ro.product.model

# 2. 验证属性可改写（测完务必恢复）
& $adb -s 127.0.0.1:5557 shell "setprop ro.build.tags test-keys; getprop ro.build.tags"
& $adb -s 127.0.0.1:5557 shell "setprop ro.build.tags release-keys"

# 3. 验证 /proc/cpuinfo 不可写
& $adb -s 127.0.0.1:5557 shell "echo x > /proc/cpuinfo"   # 应报 Permission denied

# 4. 读自曝属性（只读，不改写）
& $adb -s 127.0.0.1:5557 shell "getprop ro.boot.qemu"     # 雷电应返回 1

# 5. 采集并上传（App 内：整体获取 → 上传报告）
& $adb -s 127.0.0.1:5557 shell "am start -n com.sigmark.app/.MainActivity"
```

取打分（字段集 26 的三份）：

```powershell
curl.exe -s -H "Authorization: Bearer YM" `
  "http://192.168.1.114:48272/api/admin/reports/9d5b546e-11d6-4c1d-9236-539eb4842736/device-profile"

curl.exe -s -H "Authorization: Bearer YM" `
  "http://192.168.1.114:48272/api/admin/reports/2b931bd3-18d7-4dfe-a7ca-3e354c37ee09/device-profile"

curl.exe -s -H "Authorization: Bearer YM" `
  "http://192.168.1.114:48272/api/admin/reports/dd334a08-d646-4208-bc09-e4a974c7671b/device-profile"
```

取原始参数（`report.parameters` 是**数组**，元素 `{group,key,label,value,source,status}`，不是 map）：

```powershell
$d = Invoke-RestMethod -Uri "http://192.168.1.114:48272/api/admin/reports/9d5b546e-11d6-4c1d-9236-539eb4842736" -Headers @{ Authorization = "Bearer YM" }
$d.report.parameters | Where-Object { $_.key -eq 'bootQemu' }
```
