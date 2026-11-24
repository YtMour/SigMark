# 机器码与系统节点

手机从「更多工具 → 机器码与节点证据」生成本次机器码，或点「重新采集并核对」对照前一次读数。在配置了 LAN 的版本中，复测会保存一份本机报告，上传仍需在预览中手动确认。仓库从「资产管理 → 设备档案」查看机器码分量、字段状态和上一份在库同机记录，同一资产按采样时间选择对照。导出诊断 JSON 包含版本、字段输入、同机报告引用和变化代码。

| 项目 | 用途 | 生命周期 |
| --- | --- | --- |
| 随机安装标记 | 用户选择把报告归到同一设备资产 | 本机安装与后台限定；重装后由用户重新确认关联。 |
| 本地旧配置摘要 | 旧版指纹安全页中的 Build/ABI 读数对照 | 仍留本机，字段或配置变动可改变结果。 |
| 设备配置机器码 | 审阅商品、硬件和 ROM 三个分量 | 基于当前证据独立计算。相同配置可同码，重装保留配置时可复现，无法确认物理唯一性。 |

`sigmark-config-code/2` 把证据拆成三个互相隔离的分量，任何一个被改写都不会悄悄带动另外两个：

| 分量 | 前缀 | 输入（固定键序） | 回答的问题 |
| --- | --- | --- | --- |
| 商品 | `P2-` | `system.brand`、`system.model`、`system.device`、`cpu.abis` | 这台设备声明的型号族是什么 |
| 硬件 | `H2-` | `cpu.hardware`、`system.board`、`cpu.coresConfigured`、`system.initialSdk` | 芯片与板级声明是否属同一族 |
| ROM | `R2-` | `system.type`、`system.buildId`、`system.incremental`、`system.patch` | 装的是哪一版构建 |

两端按固定键序和 LAN 文本投影值计算，保留大小写及 ABI 顺序，使用 UTF-8 字节长度前缀、按分量隔离的 SHA-256 前 128 位。分量四项均有效才生成；缺任何一项该分量留空，其余分量不受影响。`system.initialSdk` 来自公开只读属性 `ro.product.first_api_level`（Android 未向第三方公开 `Build.VERSION.DEVICE_INITIAL_SDK_INT`），只作世代对照。机器码、安装标记与旧摘要均不进入报告正文；后台按既有公开字段派生机器码。它不做归组键，也不参与安全评分。IMEI、序列号、MAC 不参与计算或传输。

真机上出现过同一属性在不同上下文读到不同值的情形（App 进程 `23078PND5G` / `corot` / `mt6985`，ADB shell `Pixel 6` / `oriole` / `gs101`）。机器码只编码**当前观察者**（App 归档）看到的字段，因此它是“这个身份看到的配置”，不是“物理设备真相”；与 shell 视图对照时用「证据来源对照」，两套值分别保留。

## 固定节点注册表

| 字段 | App 读取路径 | 约束 | 参照 |
| --- | --- | --- | --- |
| `cpu.sysCpuPossible` | `/sys/devices/system/cpu/possible` | Linux CPU 编号列表，0–4095，无重叠 | 与在线列表核对集合关系。 |
| `cpu.sysCpuOnline` | `/sys/devices/system/cpu/online` | 同上，采样时状态 | `Runtime.availableProcessors` 为当前进程可用数量，统计范围不同。 |
| `battery.sysBatteryTemp` | `/sys/class/power_supply/battery/temp` | 0.1 °C，−500 至 1200 | `BatteryManager.EXTRA_TEMPERATURE`；相差超过 2 °C 时复核。两者可能同源，且采样时点不同。 |

字段从字段集 15 采用，适用 API 26+ 且需要内核或厂商暴露相应节点。SafeReader 原有只读、单节点 400 ms 和有限线程资源继续适用，新增文本限额分别为 128、128、32 字节。上报保留原值或字段状态、路径及 errno。权限拒绝为 `RESTRICTED`、未暴露为 `UNAVAILABLE / NODE_MISSING`、超时和其他读异常为 `ERROR`。格式失配作为无有效值，有限数值原文可保留在原因说明。设备档案和字段词典明确标为普通 App 节点视角；ADB 诊断不参与这批字段的读取或补值。

## 自有 ROM 证据

`RomEvidenceReader.readV1()` 定义固定的三类只读数值声明，包含版本和采样时间。合成测试覆盖重复字段、未知版本和越界，合法样本标记 `ROM_SERVICE / service_claim`。当前未接入 Binder 服务。实机接入需在对应 ROM 树实现定型接口、校验服务 UID 和签名、限定可读取字段，再刷机验证。保持普通 App 样本与 ROM 服务声明分列；系统自述只用于对照，独立证明属于另一证据通道。
