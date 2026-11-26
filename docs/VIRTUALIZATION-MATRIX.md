# 虚拟化平台实测台账

本文件只记录**实测数据**，不写推测。每条都标明设备、时间、命令与原始输出。
用途：给 `docs/SECURITY-SCORE.md` 与 `docs/SCORE-REDTEAM.md` 提供可复现的现场依据，
并界定「哪些判据在一个第三方模拟器上还有效」。

最后更新：2026-11-26。

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
| 报告号 | `ce1bdc7f-f128-4e8b-a225-bbeb2bee7c35` |
| 采集时间 | 2026-11-26 14:05:12 |
| App | SigMark 1.14.0（`com.sigmark.app`） |
| 采集字段 | 234 项，210 已获取 |

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

**只清了常见的那个，漏了 `ro.boot.qemu`。** 但 SigMark 采集端
（`SafeReader.Property`）两个都没有枚举，所以这条自曝**从未进入报告**。

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

---

## 五、平台覆盖现状

| 平台 | 属性实测 | 采集上传 | 状态 |
| --- | --- | --- | --- |
| AOSP AVD `sigmark-emu34`（android-34） | ✅ | ✅ | 完成 |
| AOSP AVD android-30（老 API） | ✅ | ✅ | 完成（官方重发镜像） |
| 雷神 LDPlayer 9 | ✅ | ✅ | **完成（本文件主体）** |
| redroid（容器化） | ❌ | ❌ | **环境阻塞**：Windows 内核无 `/dev/binder`，容器 exit 129 |
| Android-x86 / Bliss | ❌ | ❌ | 未开始（需 VirtualBox/VMware + ISO） |
| Waydroid | ❌ | ❌ | 未开始（需 Linux + Wayland，Windows 不可用） |
| arm64-v8a 在 x86 宿主 | ❌ | ❌ | 未开始（镜像下载已取消） |
| `-writable-system` 持久化 | ❌ | ❌ | **块设备只读**：root 也解不开（`'/dev/block/sda2' is read-only`） |

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


### 6.2 arm64-v8a 在 x86 宿主速度：**未测**

镜像下载已取消（用户叫停 AVD 路线）。这一项需要下载 android-30 arm64 系统镜像并实测
启动耗时与运行帧率，属独立工作量。

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

### 6.4 Android-x86 / Bliss / Waydroid：**未测**

- **Android-x86 / Bliss**：需要 VirtualBox/VMware 虚拟机与 ISO 安装，属独立环境搭建。
- **Waydroid**：需要 Linux 宿主 + Wayland 会话，Windows 上不可用。

### 6.5 一项重要的判断修正

上一版把这几项笼统写成「未测」。**实测后要分开说**：

| 项 | 性质 |
| --- | --- |
| `-writable-system` | **环境阻塞**（两条路都试过，各有明确报错） |
| redroid | **环境阻塞**（宿主内核无 binder） |
| arm64 速度 | **未开始**（工作量问题，不是阻塞） |
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

# 4. 采集并上传（App 内：整体获取 → 上传报告）
& $adb -s 127.0.0.1:5557 shell "am start -n com.sigmark.app/.MainActivity"
```

取打分：

```powershell
curl.exe -s -H "Authorization: Bearer YM" `
  "http://192.168.1.114:48272/api/admin/reports/ce1bdc7f-f128-4e8b-a225-bbeb2bee7c35/device-profile"
```
