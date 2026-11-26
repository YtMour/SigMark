# syscall / Native 采集边界

SigMark 可以使用 `android.system.Os` 或 NDK/libc 读取某些底层信息。本版已使用 `Os.uname()`、`Os.sysconf()`，并用 `Os.open()`/`Os.read()` 验证 SELinux 节点在普通应用进程内的访问结果。

## 结论

`syscall` 是进入内核的调用路径，不是额外权限。Java `File`、`android.system.Os`、Native libc 最终受同一应用 UID、文件权限和 SELinux 域约束。把 `/sys/fs/selinux/enforce` 从 Java 文件读取改为 `Os.open()` 后，在连接设备上仍返回 `errno=13`（`EACCES`）。

当前采集只接受节点直接返回的 `1` 或 `0` 作为实时模式。EACCES 保留为 `RESTRICTED`，ENOENT 保留为 `UNAVAILABLE`。拒读时，目录与节点权限位可提供辅助线索，归入 `system.selinuxEvidence=inferred_mac`。旧报告保留原始推断文案，当前评估和回归将其视作未确认。

可用的底层补充信息包括 `uname` 的内核 release/编译版本、`sysconf` 的页大小与配置核数、当前应用可读的 `/proc/cpuinfo`、部分 CPU 频率节点，以及本进程的 `/proc/self/maps`、`mountinfo`、`status`。它们是应用进程观察值，不一定与 ADB shell 或物理硬件规格相同。

## 为什么不能在应用内“破解/绕过”

1. 拒绝发生在内核 LSM，不在 Java 层。Hook 自己的 `android.os.SELinux`、`SystemProperties` 或返回值只能伪造显示，真值仍拿不到；而且那会让报告变成自述而不是观察。
2. AOSP 在 `app_neverallows.te` 里写了 `neverallow all_untrusted_apps selinuxfs:file no_rw_file_perms;`。任何符合 CTS 的设备都不能给普通应用加这条 allow；要放开只能改 sepolicy 并刷入系统镜像。
3. 属性读取也按上下文过滤：真机上同一个 `ro.bootloader`，App 读到 `corot-1.0.9`，shell 读到 `slider-14.5-12088207`。跨来源合并会直接写错事实。
4. 隐藏 API（`SystemProperties` 反射等）被 hiddenapi 策略拦截；`service call`、`dumpsys` 需要 shell 或系统权限；其他应用的 ContentProvider/AIDL 需要签名或特权权限。应用内没有合法“自定义接口”能拿到这些值。

| 身份 | 能拿到 | 拿不到 |
| --- | --- | --- |
| App（`untrusted_app`） | 公开 API、本进程 `/proc/self/*`、DAC 可见的只读节点、被过滤后的属性 | `selinuxfs` 的 enforce/policy、电池 `power_supply` 节点、被隐藏的 `ro.*`（如 `ro.debuggable`）、其他进程与应用的私有数据 |
| ADB shell（`shell`，无 root） | `getenforce`、大部分 `ro.*`、部分 `sysfs`、`dumpsys`（含 telephony registry）、`pm`/`am` 的只读查询 | `security:read_policy`（策略正文）、其他 UID 的应用数据、`/proc/<其他应用>/maps` |
| 已具备特权的独立观察者 | 策略允许时可获取策略摘要 | 读取范围由观察进程的 SELinux 域及设备策略决定 |
| 自定义 ROM / 系统组件版 | 可在自有 sepolicy 中给专用域授权，让**系统组件**读到更多 | 需要自己构建与签名系统镜像；已不是“普通应用视角” |

设备侧补充结果通过「证据来源对照」与 App 读数并列。系统侧采集取决于系统组件所在的域及设备策略。

### 同一属性的按上下文视图（真机记录，2026-11-24）

同一台测试机、同一分钟内：

- `adb shell run-as com.sigmark.app getprop ro.product.model` → `23078PND5G`（`u0_a174`，`runas_app` 域）
- `adb shell getprop ro.product.model` → `Pixel 6`（`u:r:shell:s0`）

同一现象还出现在 `ro.product.board`（`mt6985` / `oriole`）、`ro.board.platform`（`mt6985` / `gs101`）、`ro.soc.model`、`ro.build.fingerprint` 与 `ro.product.first_api_level`（33 / 31）。`Build.*` 也是从这些属性读出来的，所以「读到型号就是真机」不成立；App 与 shell 两套值各自内部自洽。

处置：机器码拆成商品 `P2-`、硬件 `H2-`、ROM `R2-` 三个分量，只编码 App 归档视角；跨来源对照把两套值并排保留，型号不一致时先核对、不自动合并。任何一侧的读数都不能单独用来证明物理设备。

任何跨视角比对都应分别标明 `App`、`ADB shell`、`root` 或系统组件，避免将不同权限上下文的结果混作一项。

0.4.0 在已有精确位置授权的真机上再测，应用仍返回 `EACCES`；Android 位置授权与该节点权限无关。若项目确实需要普通安装版范围之外的现场状态，可由自有 ROM 提供经过系统策略授权的只读诊断接口，或在测试记录独立标注系统侧观测；这不是普通 APK 的可采集值。不得通过关闭 SELinux 达成采集。

0.5 把实时状态与辅助线索分开展示：直接读 `enforce` 时仅 1/0 确认 Enforcing/Permissive；EACCES/EPERM 标为受限，ENOENT 标记节点未暴露，非 0/1 标为未确认。辅助检查仅尝试只读打开 `policy`，不读取策略正文；固定查询 `ro.boot.selinux` 与 `ro.build.selinux`，使用 App 原有身份，不申请额外权限。任何辅助结果都不替换实时状态。

## 后续技术选项

- **普通安装版**：继续优先使用公开 Android API、`android.system.Os` 与可读节点；权限错误记录 `errno` 和来源。
- **专用系统集成版**：若未来在自有 ROM 中预装为具有明确系统能力的组件，可在单独模块/构建变体中提供额外采集接口，保持普通安装版的数据契约一致并标注来源。此路线需要独立构建和真机验证。
- **NDK**：仅当需要 ABI 信息、特定 libc API 或性能/交叉核验时引入；不把它当作访问控制的替代路径。

任何跨视角比对都应分别标明 `App`、`ADB shell` 或系统组件，避免将不同权限上下文的结果混作一项。

### 已连接测试机的系统侧记录

在仓库根目录执行 `python tools/rom_observation.py` 可输出一个标记 `observer=ADB_SHELL` 的本地 JSON。多台设备时使用 `--serial` 指定目标。记录包含 SELinux 模式、Android API、构建类型和 Verified Boot 属性，每项含来源及状态。工具只调用已连接设备上的固定只读查询。记录供测试人员在主机上同 App 导出的 JSON 对照。

自有 ROM 的下一阶段可以提供签名保护的只读 Android 服务。服务端用固定字段协议回报审核过的系统能力，限定调用方证书，保留系统服务来源和采样时间。该组件需要在目标 ROM 中实现并验证策略与升级，适用于具备系统集成条件的设备。

Android 运行时授权适用于定位等声明权限。系统文件访问还由应用进程身份和 SELinux 策略决定。MI 8 的归档中，`enforce` 和 `policy` 均返回 EACCES / 13。这两个节点没有用户授权弹窗。测试人员可从已连接设备另存系统侧读数，保留对应观察视角。

### 报告缺项与补充证据

报告详情选「缺项与补充证据」。这里列出本次已归档非可用字段、来源和推荐的复测条件。公开电池温度可用于回答「当前温度是多少」，不改写受限的节点原读数。

可在连接的测试机上生成同源对照文件：

```powershell
python -B tools/coverage_observation.py --serial ADB_SERIAL --output D:/SigMark/app/build/coverage-test.json
```

只复核 SELinux 时可加 `--selinux-only`。文件保存机型、观测时间和模式。生成后在「指纹安全 → 证据来源对照」选择本地 JSON。

### root 观察通道（opt-in，需 root）

需要策略正文或其他应用数据时，可用 `tools/root_observation.py` 生成 `sigmark-adb-evidence/5`（`observer=ROOT`）：在 v4 的字段之外增加一项 `system.selinuxPolicy`（`sha256:<64 位>` 策略摘要）。脚本通过 `adb shell "su -c ..."` 读取，要求在已 root 的测试设备上运行；没有 root 时脚本直接报错，不会降级乱填。面板把来源标为「root（su）」，与 App 字段、ADB shell 字段并列，三方都不互相填充。

```powershell
python -B tools/root_observation.py --serial ADB_SERIAL --output D:/SigMark/app/build/root-evidence.json
```

这个通道本轮没有 root 真机可验，只有解析与摘要格式的单测；在实机上运行前，先确认 `su -c getenforce` 与 `sha256sum /sys/fs/selinux/policy` 可用。root 读数会改变设备的启动校验与 Play Integrity 结论，属于“换观察身份”，不是 App 变强。

手动选择该 JSON 后，页面并列显示固定的十二项读数（v3 文件；v1/v2 旧文件仍可打开）：SELinux 实时模式、系统/厂商安全补丁、启动与锁定声明、电池服务温度和电压，以及 shell 才能读到的 `ro.bootloader`、`ro.boot.veritymode`、`ro.debuggable` 和电池驱动温度节点。采集使用 ADB 已授权的系统诊断。文件不包含序列号，仅在当前页面内存中使用。启动、SELinux 和动态电池读数仅在两次采样相差不超过五分钟时判一致性；电池读数可能来自同一底层驱动，驱动节点与公开温度都以 0.1 °C 计。App 和 ADB 型号不同需由操作者核对设备对应关系。

真机实测（2026-11-24，同一台 Pixel 6，两次采样相差 15 秒）：SELinux 推断值 `Enforcing（强制模式，推断）` 与 shell `getenforce=Enforcing` 一致；电池公开温度 26.5 °C 对应 `dumpsys battery` 的 264；App 被拒的电池节点 shell 能读到 265；App 未上报的 `ro.vendor.build.security_patch` 与 `ro.debuggable`，shell 分别读到 2026-07-05 与 0；同一 `ro.bootloader` 两边读到不同值（`corot-1.0.9` / `slider-14.5-12088207`），页面按「两值分别保留」显示。MI 8 上 shell 同样读不到电池节点，说明该拒绝不是换一个接口就能解决的。
