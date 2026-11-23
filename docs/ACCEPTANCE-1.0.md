# SigMark 1.0 · ROM 验收

1.1 补充：从安全页或报告页打开「验收工作台」，自动选最近的同资产早期样本，可手动切换或选择仅看当前。结果区默认忽略已知瞬时波动；可按失值、当前受限、仅一侧归档、分类和关键字切换。导出 `sigmark.lab-sheet/1` 全量对照，不受表格过滤影响。认证接口 `GET /api/admin/reports/{id}/lab` 只读返回当前及最多 12 份接收不晚于当前的同资产旧报告；无归组或回收站不混入。

字段集 10 新增 `network.checkStartTransport/checkEndTransport/checkStartValidated/checkEndValidated/checkElapsed`。在手机首页选择「网络切换实验」，记录起点，自己切换，再记录终点。报告只保存端点观察及间隔，不测断网时长，也不采集 IP、SSID 或坐标。

## 手机操作

1. 日常参数选「整体获取」；需要特定实验时点「选择验收方案」。
2. 「ROM 验收」在标准采集后运行内置 H.264 样片，将首帧结果、阶段、解码器和毫秒数附到这次采样。「网络复测」保留当前链路和授权状态，不切换 Wi-Fi、蜂窝或 SIM，也不执行密钥和媒体实测。
3. 点击「上传报告」，选对应时间的独立采样，预览后确认。权限回调仅更新本机实时页面。ROM 验收不发送样片、坐标、电话号码和额外设备标识。
4. 只想运行本地解码时走「更多工具 → 视频解码实测」。该独立面板不改采样报告。

## 后台操作

- 「报告档案」打开样本可看「验收证据」。安全页任选同一资产的一份旧报告为基线，查看「验收对照」；建议保存一个有意义的命名基线。
- 只有资产关系相同、采样顺序有效、样片版本相同且两份都有实测，才给出首帧恢复或待复测判断。读数发生变化不自动归因于 ROM；解码耗时不参与判断。旧报告不补写验收结果。
- 新系统可查阅手机读数和独立 ADB 观察；两者依然不是硬件证明。系统拒读、用户未授权、未上报和未运行分别处理。

## DX / AX

LAN 上传仍为 schemaVersion 4，新增 fieldSetVersion 9。稳定字段：

| 键 | 取值 |
| --- | --- |
| `environment.capturePlan` | `standard/rom/network`；即时快照可能未选方案 |
| `environment.capturePhoneAccess` | `granted/not_granted` |
| `environment.captureLocationAccess` | `precise/approximate/not_granted` |
| `environment.captureLocationSwitch` | `enabled/disabled`，或保留无读数 |
| `media.avcFixture` | `sigmark-avc/1`，仅显式选择 ROM 验收时归档 |
| `media.avcFirstFrame` | `pass/fail`，未执行不生成字段 |
| `media.avcStage` | `source/configure/decode/done` |
| `media.avcDecoder`、`media.avcElapsed` | 可选解码器名称与 `N ms` |

采样授权反映采集开始时的观察，不是后续状态。导出的 `sigmark.regression` 结构保持 v1，新增 `acceptance`；`media=regression` 只表示选定样片的前后读数从通过变为未通过。比较结果同时保留稳定字段键、读数、来源以及原报告 ID。

`GET /api/admin/field-dictionary` 使用既有管理认证。返回词典 schemaVersion、最新字段集、稳定字段键、最低协议 / 字段集版本，以及归档状态和动态分区规则。单位仅在定义明确的字段上返回；没有标单位的旧字段继续以原读数和来源为准。此接口和验收对照均不写入报告。

复现：Android 运行构建、JVM 单测、Lint 和两台真机 `CapabilitySmoke`。后台运行 Go/Web 单测、构建 Docker 镜像，在临时 PostgreSQL 执行 `python -B backend/scripts/qa_device_profile.py --browser --image sigmark-qa:acceptance100`。测试夹具不写入现有仓库。
