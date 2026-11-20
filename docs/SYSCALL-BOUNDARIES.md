# syscall / Native 采集边界

SigMark 可以使用 `android.system.Os` 或 NDK/libc 读取某些底层信息。本版已使用 `Os.uname()`、`Os.sysconf()`，并用 `Os.open()`/`Os.read()` 验证 SELinux 节点在普通应用进程内的访问结果。

## 结论

`syscall` 是进入内核的调用路径，不是额外权限。Java `File`、`android.system.Os`、Native libc 最终受同一应用 UID、文件权限和 SELinux 域约束。把 `/sys/fs/selinux/enforce` 从 Java 文件读取改为 `Os.open()` 后，在连接设备上仍返回 `errno=13`（`EACCES`）。因此 UI 显示 `RESTRICTED`，而不猜测 Enforcing/Permissive。

可用的底层补充信息包括 `uname` 的内核 release/编译版本、`sysconf` 的页大小，以及当前应用可读的 `/proc/cpuinfo`、部分 CPU 频率节点。它们是应用进程观察值，不一定与 ADB shell 或物理硬件规格相同。

0.4.0 在已有精确位置授权的真机上再测，应用仍返回 `EACCES`；Android 位置授权与该节点权限无关。若项目确实需要普通安装版范围之外的现场状态，可由自有 ROM 提供经过系统策略授权的只读诊断接口，或在测试记录独立标注系统侧观测；这不是普通 APK 的可采集值。不得通过关闭 SELinux 达成采集。

0.5 把实时状态与辅助线索分开展示：直接读 `enforce` 时仅 1/0 确认 Enforcing/Permissive；EACCES/EPERM 标为受限，ENOENT 标记节点未暴露，非 0/1 标为未确认。辅助检查仅尝试只读打开 `policy`，不读取策略正文；固定查询 `ro.boot.selinux` 与 `ro.build.selinux`，使用 App 原有身份，不申请额外权限。任何辅助结果都不替换实时状态。

## 后续技术选项

- **普通安装版**：继续优先使用公开 Android API、`android.system.Os` 与可读节点；权限错误记录 `errno` 和来源。
- **专用系统集成版**：若未来在自有 ROM 中预装为具有明确系统能力的组件，可在单独模块/构建变体中提供额外采集接口，保持普通安装版的数据契约一致并标注来源。此路线需要独立构建和真机验证。
- **NDK**：仅当需要 ABI 信息、特定 libc API 或性能/交叉核验时引入；不把它当作访问控制的替代路径。

任何跨视角比对都应分别标明 `App`、`ADB shell` 或系统组件，避免将不同权限上下文的结果混作一项。
