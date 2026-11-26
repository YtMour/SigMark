# SigMark 发布与兼容性盘点（1.19.0 / 字段集 23）——历史快照

> ⚠️ **本文是 2026-11-25 19:57–20:20 的一次性只读盘点，记录的是当时的状态，不是现行事实。**
> 它保留下来是因为第 2 节的回滚风险分析（回滚会让新客户端整份 400 而不是丢键）与第 1 节的
> 四道闸门判定链路至今仍然成立，可以当原理读。
>
> **所有「当前值」类的结论都已过期。现行事实见下表。**

## 现行状态（2026-11-25 20:47 实测，取代本文所有「当前」表述）

| 项 | 本文当时写的 | 现在 |
| --- | --- | --- |
| 默认下载 | 1.16.0 / 43，`sha256=4b00f0a3…` | **1.21.2 / 50**，`sha256=85ec158ffa40737f70c2c0988b1e85bf3e114c22ddd1948362cec337ae134833`，`size=12006913`，job `b62209513e1b43c991ae4964dbf248a0` |
| 后台 `latestFieldSet` | 23 | **25**（词典 `sigmark-lan-fields/16`，235 条，单帧上限 259） |
| 工作树 `LanFieldSetVersion` | 24 | **25**（与后台、投影 fixture、白名单四处一致） |
| 画像规则 | `sigmark-profile/6` | **`sigmark-profile/8`**（10 标签，含 `hardware_declaration_conflict`；`/7`→`/8` 因新增 `sdm845` 登记） |
| 签名证书 SHA-256 | `e424900e…`（与线上一致） | 未变，仍是 `e424900e635efe79ab05f904d6436394e980e26246085ac39f5ec9cc50463904` |
| 构建中心最新 job | 1.17.0 / 44 | **1.21.2 / 50**（1.18.0–1.21.2 已逐版发布） |
| 「重编必被 400 拒收」 | 成立（当时树 24 > 后台 23） | **已不成立**：树 25 = 后台 25，重编可直接上传 |

回滚风险的结论**没有变**，只是版本号要往前推：现在回滚到字段集 22 会让 v23 及以上的客户端
（含 1.21.2）整份 400，而客户端提示仍是「报告未通过校验。请检查设备时间，刷新采集后重试。」
（`app/src/main/java/com/sigmark/app/lan/LanReport.kt`），与真实原因不符。

---

## 0. 结论速览

| 结论 | 等级 | 依据 |
| --- | --- | --- |
| 工作树 `LanFieldSetVersion = 24`，后台 `latestFieldSet = 23`：**现在重新构建任何 APK 都会被后台 400 拒收** | **阻断级** | 实测 `app/.../LanReport.kt:19` = 24；`backend/.../field_dictionary.go:8` = 23 |
| 手上的 1.19.0 APK 声明字段集 23，但**既不能从 HEAD 复现，也不能从工作树复现** | **阻断级** | HEAD 是 20（`git diff` 显示 `-20 +24`），工作树是 24，APK 实测 23 |
| v21 / v22 / v23 客户端上传到当前后台**全部 201 接收**，不存在「静默丢键」路径 | 正常 | `protocol.go:538`、`protocol.go:120-135`、`protocol.go:552-564` |
| 后台回滚到字段集 22：v23 客户端**整份报告被 400 拒绝**，不是丢键 | **高危** | `protocol.go:538`（`FieldSetVersion > latestFieldSet` → invalid） |
| 已归档的 v23 报告在回滚后**仍可完整读取**（原始 JSON 直出，不回校验） | 正常 | `main.go:246-283`（`json.RawMessage`） |
| `hardware_declaration_conflict` 在只有 v22 报告时**仍然给结论**（走 RAM 通道），新键显示 `NOT_ARCHIVED` | 正常 | 实测 v22 报告 `ddb2b82e…` 的 `/device-profile` |
| 构建中心当前发布的是 1.16.0/43，构建工作进程**离线**（`workerOnline=false`），最新 job 只到 1.17.0/44 | 需处理 | 实测 `/api/admin/builds` |
| 1.19.0 APK 的签名证书 SHA-256 与已发布 1.16.0 **完全一致**，发布不会被 `publish_signer_changed` 拦下 | 正常 | `apksigner verify --print-certs` 实测 |

---

## 1. 三档字段集兼容矩阵（v21 / v22 / v23 → 当前后台 `latestFieldSet=23`）

### 1.1 判定链路（先看门在哪）

一次上传依次经过 4 道闸门，任一失败都是**整份报告 400 `invalid_report`**，不存在部分接收：

| # | 闸门 | 位置 | 作用 |
| --- | --- | --- | --- |
| 1 | `decodeStrict` + `DisallowUnknownFields` | `protocol.go:479-489`，`main.go:193` | 顶层出现未知 JSON 字段 → 400 |
| 2 | `Report.valid()` 版本区间 | `protocol.go:538` | `schemaVersion==4` 时要求 `2 ≤ FieldSetVersion ≤ latestFieldSet(=23)` |
| 3 | `Report.valid()` 字段数分档 | `protocol.go:491-525` | `>=22 → 255`、`>=23 → 256`（21 档是 250） |
| 4 | `Parameter.valid(schema, fieldSet)` | `protocol.go:120-135` | 键必须在 `parameterKeys`/`diagnosticKeys`/`partition_*`/`versionedParameters(since ≤ fieldSet)` 中 |

第 4 道的「since」闸门就是字段集演进的唯一开关，实测 `versionedParameters` 相关项（`protocol.go:90-93`）：

```go
{"system", "propertyModel", 21}, {"system", "propertyDevice", 21},
{"cpu", "cpuParts", 22}, {"memory", "physicalRam", 22}, {"memory", "kernelMemTotal", 22},
{"runtime", "glesRenderer", 22}, {"runtime", "glesVendor", 22},
{"environment", "overlayDeviceCodename", 23},
```

对应单测（实测存在，`protocol_test.go:673`、`704`）明确断言了「v22 键在 21 下无效」「v23 键在 22 下无效」：

```go
if !field.valid(4, 22) || field.valid(4, 21) { t.Fatalf("field set gating: %s.%s", ...) }
if !field.valid(4, 23) || field.valid(4, 22) { t.Fatal("overlayDeviceCodename must be gated at field set 23") }
```

### 1.2 矩阵（正常客户端 = 只发自己字段集定义的键）

| 客户端 | 声明 `fieldSetVersion` | 后台判定 | 结果 | 依据 |
| --- | --- | --- | --- | --- |
| v21（如 1.15.0 及更早） | 21 | `2 ≤ 21 ≤ 23` ✅；`len ≤ 250` ✅；键全部 `since ≤ 21` ✅ | **接收（201）** | `protocol.go:538`、`:517-519`、`:120-135` |
| v22（1.18.0） | 22 | `2 ≤ 22 ≤ 23` ✅；`len ≤ 255` ✅；6 个 v22 键 `since=22 ≤ 22` ✅ | **接收（201）** | `protocol.go:520-522`、`:91-92` |
| v23（1.19.0，当前试装包） | 23 | `2 ≤ 23 ≤ 23` ✅；`len ≤ 256` ✅；`overlayDeviceCodename since=23 ≤ 23` ✅ | **接收（201）** | `protocol.go:523-525`、`:93` |

**结论：三档全部接收，0 拒绝。**

### 1.3 关于「接收但新键被丢」——本仓库没有这条路径

必须明确纠正一个常见误解：后台**不会**「收下报告再丢掉不认识的键」。

- 参数级：`Parameter.valid()` 不通过 → `Report.valid()` 返回 false → `main.go:202-205` 直接 `fail(w, 400, "invalid_report")`，整份不落库。
- 存档级：报告以 `jsonb` 原样保存（`main.go:262` 的 `body`），读取时以 `json.RawMessage` 直出（`main.go:249`），后端从不做「过滤后重写」。

所以「新键被丢」在写入侧不存在，它只以**读取侧缺失**的形式出现：

| 场景 | 实际表现 | 证据 |
| --- | --- | --- |
| v21 报告被读 | 6 个 v22 键 + 1 个 v23 键不在存档里 → 标签证据行 `status: "NOT_ARCHIVED"` | `device_profile.go:158`、`:227` |
| v22 报告被读 | 只有 `environment.overlayDeviceCodename` 是 `NOT_ARCHIVED` | 实测见 §2.3 |

### 1.4 反向格：客户端越界发送会怎样（这才是「拒绝」的来源）

| 越界情形 | 结果 | 依据 |
| --- | --- | --- |
| v21 客户端发了 v22 键（如 `memory.physicalRam`） | **400 `invalid_report`** | `field.valid(4,21)` = false（`protocol_test.go:673`） |
| v22 客户端发了 `environment.overlayDeviceCodename` | **400 `invalid_report`** | `field.valid(4,22)` = false（`protocol_test.go:704`） |
| 任何客户端发 `fieldSetVersion = 24` | **400 `invalid_report`** | `protocol.go:538`（`> latestFieldSet`） |
| 参数条数 > 本档上限（21→250 / 22→255 / 23→256） | **400 `invalid_report`** | `protocol.go:535` + `:491-525` |
| 顶层多一个未知 JSON 字段 | **400 `invalid_report`** | `protocol.go:481`（`DisallowUnknownFields`） |

> 当前档案里实际条数上限远未触及：实测 11 份报告的最大参数条数为 **204**（3 份 v23），v22 为 **203**。也就是说 250/255/256 三档在本仓库的真实数据上**从未被区分过**，maxFields 分档目前只是安全余量，不是行为差异。

### 1.5 v24 这一档（现实风险，不是假想）

| 客户端 | 后台 | 结果 |
| --- | --- | --- |
| 工作树重建的 APK（`LanFieldSetVersion = 24`） | `latestFieldSet = 23` | **400 `invalid_report`**，且客户端会显示误导性文案 |

实测工作树与 HEAD 的差异（`git diff app/src/main/java/com/sigmark/app/lan/LanReport.kt`）：

```
-internal const val LanFieldSetVersion = 20
+internal const val LanFieldSetVersion = 24
```

v24 相比 v23 多两个键（对比 `app/src/test/resources/lan-projection-v23.txt` 与 `-v24.txt`，实测 232 → 234）：

```
cpu.cpuCapacity
memory.cmaTotal
```

这两个键在后台 `versionedParameters`、`parameterKeys`、`dictionary()` 里**都不存在**（实测 `/api/admin/field-dictionary` 返回 232 项，无此二键），所以 v24 报告会被三重拒收：字段集越界、键未知、条数可能超限。

---

## 2. 回滚风险表（后台回滚到字段集 22 的镜像）

前提假设：回滚目标镜像的 `latestFieldSet = 22`、`maxFields(22) = 255`、`overlayDeviceCodename` 的 `since = 23`。镜像内部常量在只读约束下**无法直接验证**（见 §5 缺口 G-1）。

### 2.1 v23 客户端上传会不会被拒

**会，而且整份拒绝，不是丢键。**

| 项 | 内容 |
| --- | --- |
| 触发条件 | 请求体 `fieldSetVersion = 23` |
| 第一道失败点 | `protocol.go:538`：`p.FieldSetVersion > latestFieldSet`（23 > 22）→ `valid()` = false |
| HTTP 结果 | `400`，body `{"error":"invalid_report"}`（`main.go:202-205`） |
| 被拒的键 | 单独看也是 400：`environment.overlayDeviceCodename`（`since=23`，`field.valid(4,22)` = false） |
| 条数风险 | 若该报告参数数 > 255 会再叠加一条失败；实测 v23 报告是 **204** 条，不触发 |
| 客户端文案 | 「报告未通过校验。请检查设备时间，刷新采集后重试。」（`LanReport.kt:131`）——**完全误导**，实际原因是版本偏斜，用户按提示重采也不会成功 |
| 限流叠加 | `POST /api/v1/reports` 为 `rate.NewLimiter(2, 8)`（`main.go:122`），重试风暴会先吃 429 |
| 影响面 | 当前唯一在跑的 v23 客户端就是 1.19.0 试装包；一旦回滚，**该机型的所有新报告全部上传失败** |

### 2.2 已归档的 v23 报告还能不能读

**能，完全能读，且不需要任何迁移。**

| 接口 | 回滚后行为 | 依据 |
| --- | --- | --- |
| `GET /api/admin/reports/<id>` | 正常 200，`report` 字段是**数据库原始 jsonb**，不做 `valid()` 复校验 | `main.go:246-283`；`storedReport.Report` 是 `json.RawMessage` |
| `GET /api/admin/reports/<id>/device-profile` | 正常 200，但 `environment.overlayDeviceCodename` 变成 `NOT_ARCHIVED` | 旧镜像 `hardwareKeys` 列表里没有该键 → `lookup()` 回落 `profileEvidence{Status:"NOT_ARCHIVED"}`（`device_profile.go:227`） |
| `GET /api/admin/reports`（列表/分页） | 正常，分页游标按 `received_at` 排序，与字段集无关 | `main.go:327-334`、`paging.go` |
| `GET /api/admin/report-facets` / `report-count` | 正常 | 实测当前 `{"total":11}` |
| `POST /api/admin/reports/export` | 正常（导出原始存档） | `report_export.go` |
| 数据库 | 无需变更：`schema.sql` 全是 `CREATE ... IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`，旧镜像启动不会删列，新列有默认值 | `backend/cmd/sigmark/schema.sql` |

唯一实质损失：**回滚镜像不认识 `overlayDeviceCodename` 这个键**，v23 报告里的「构建产物级 codename 证据」在画像页降级为 `NOT_ARCHIVED`，但原始值仍可在 `/reports/<id>` 的 JSON 里看到。

### 2.3 `sigmark-profile/6` 的 `hardware_declaration_conflict` 在只有 v22 报告时怎么显示

**实测**（只读 GET，报告 `ddb2b82e-5217-412b-8ab6-44026d2c472c`，v22 / 1.18.0 / 203 条）：

```powershell
$env:TOKEN = ((Get-Content D:\SigMark\backend\.env | Where-Object { $_ -match '^ADMIN_TOKEN=' }) -split '=',2)[1]
$h=@{Authorization="Bearer $env:TOKEN"}
(Invoke-WebRequest -Uri "http://192.168.1.114:48272/api/admin/reports/ddb2b82e-5217-412b-8ab6-44026d2c472c/device-profile" -Headers $h -UseBasicParsing).Content
```

输出（截取该标签）：

```json
{"code":"hardware_declaration_conflict","state":"hit","evidence":[
 {"key":"memory.totalRam","status":"AVAILABLE","value":"12.00 GiB","source":"ActivityManager.MemoryInfo.totalMem"},
 {"key":"memory.physicalRam","status":"AVAILABLE","value":"12.00 GiB","source":"Os.sysconf(_SC_PHYS_PAGES) × _SC_PAGESIZE"},
 {"key":"memory.kernelMemTotal","status":"AVAILABLE","value":"7.44 GiB","source":"/proc/meminfo"},
 {"key":"cpu.cpuParts","status":"AVAILABLE","value":"0x41:0xd05×4 / 0x41:0xd0b×2 / 0x41:0xd44×2","source":"/proc/cpuinfo"},
 {"key":"system.socModel","status":"AVAILABLE","value":"Dimensity 9200+","source":"Build.SOC_MODEL"},
 {"key":"runtime.glesRenderer","status":"AVAILABLE","value":"Immortalis-G715","source":"EGL14 / GLES20.glGetString(GL_RENDERER)"},
 {"key":"system.device","status":"AVAILABLE","value":"corot","source":"Build.DEVICE"},
 {"key":"environment.overlayDeviceCodename","status":"NOT_ARCHIVED"}],
 "historyHits":0,"historyRestricted":0,"historyEvaluable":0}
```

解读（`hardware_facts.go:104-184`）：

| 通道 | 判定逻辑 | v22 报告下 |
| --- | --- | --- |
| RAM 三通道 | `totalRam/physicalRam/kernelMemTotal` 两两偏差 > 8% 即冲突 | **12.00 vs 7.44 GiB ≈ 38% → 冲突命中**（这就是 `state: "hit"` 的来源） |
| SoC × cpuParts | 声明的 SoC 参考核型集合与 `cpuParts` 求交 | 可评估（mt6985 已收录） |
| SoC × glesRenderer | GPU 关键字匹配 | 可评估（Immortalis-G715） |
| `system.device` × `overlayDeviceCodename` | 两者都在且不同即冲突 | **不成立**：overlay 为 `NOT_ARCHIVED`，`if device != "" && overlay != ""` 短路跳过（`hardware_facts.go:164-168`） |

因此：

1. 结论**不会**因为缺 overlay 而消失——RAM 通道独立成立，仍报 `hit`。
2. 但**证据强度下降一档**：少了「构建产物 vs 声明」这条不依赖 prop 的通道，剩下全是「读数 vs 读数/声明」，被质疑时更容易被解释成采集口径差异。
3. `historyEvaluable: 0` 说明该标签的历史统计不参与（只统计 `state != insufficient` 的样本，本报告本身是 `hit` 但历史窗口内无同资产样本），回滚后新旧报告混在同一历史窗口时，`historyHits` 的语义会变成「v22 报告 0 命中 / v23 报告命中」，**跨版本对比不可直接相加**。

### 2.4 回滚风险汇总表

| # | 风险 | 触发 | 影响 | 等级 | 缓解 |
| --- | --- | --- | --- | --- | --- |
| R-1 | v23 客户端整份被 400 拒收 | 回滚镜像 `latestFieldSet=22` | 1.19.0 试装包全部上传失败，用户看到「检查设备时间」误报 | **高** | 回滚前先撤回/停用 v23 试装包，或同时把 App 侧 `LanFieldSetVersion` 降回 22 并重装 |
| R-2 | 回滚镜像未确认含 `latestFieldSet=22` | 打错镜像标签 | 可能回滚到 20/21 的镜像，v22 与 v23 客户端一起被拒 | **高** | 回滚前用一次性容器验证 `/api/admin/field-dictionary` 的 `latestFieldSet`（见 §5 G-1） |
| R-3 | 回滚后 v23 报告缺 overlay 证据 | 旧镜像 `hardwareKeys` 无该键 | 画像页 `NOT_ARCHIVED`，冲突判定少一条通道 | 中 | 保留 v23 报告 id 清单，回滚期只做只读查阅；恢复新镜像后自动补齐 |
| R-4 | 客户端错误文案误导排查 | `LanReport.kt:131` | 运维会去查设备时间而不是版本 | 中 | 回滚窗口内口头告知「看到 400 是版本偏斜」 |
| R-5 | 限流放大重试失败 | `rate.NewLimiter(2, 8)` | 批量重试触发 429，误判为网络问题 | 低 | 回滚后立即停止客户端重试 |
| R-6 | 数据库回滚不兼容 | `schema.sql` 无 down migration | 旧镜像启动只做 `IF NOT EXISTS`，不会破坏新列 | 低（已排除） | 无需操作；卷保留即可 |
| R-7 | 构建中心 `published-signers` 被旧镜像覆盖 | 回滚镜像仍会写 `published-signers/*.json` | 可能写入与当前不一致的签名记录 | 低 | 回滚镜像不应执行 publish；本轮不涉及 |

---

## 3. 发布到构建中心的检查清单（用 1.19.0 替换默认 1.16.0 之前）

### 3.1 发布链路的真实机制（先理解，否则清单会用错）

| 事实 | 实测/代码依据 |
| --- | --- |
| 当前默认下载 = 1.16.0/43，`sha256=4b00f0a3…`，`signerSha256=e424900e…`，`size=11974149` | `GET /api/downloads/current` |
| `/api/downloads/current` 的 `sha256` 是 **APK 文件字节的 SHA-256**；`signerSha256` 是 **签名证书（DER）的 SHA-256**，两者含义不同、不能互相校验 | `builds.go:315`；`build_worker.py:162,167` |
| 构建中心里**没有** 1.19.0 的 job；最新 job 是 1.17.0/44（`sha256=aff1a40f…`） | 实测 `/api/admin/builds` + `backend/build-data/jobs/*/job.json` |
| 发布（publish）**必须**基于一个 `state=succeeded` 且 `size`/`sha256` 与磁盘 APK 一致的 job | `builds.go:233-252`（`openAPK`） |
| 发布时会拒绝：版本号不前进（409 `publish_version_not_newer`）、签名变更（409 `publish_signer_changed`）、字节校验不符（409 `artifact_checksum_mismatch`） | `builds.go:269-289` |
| 构建工作进程当前**离线**：`workerOnline=false`（心跳文件缺失） | 实测 `/api/admin/builds` |
| 但本地 APK 可以直接 `import-apk` 注册成 job，不需要 worker 循环 | `build_worker.py:287-321` |
| 容器读的是宿主机 `backend/build-data`（`BUILD_DATA=/build-data`）与 `backend/build-catalog`（`BUILD_CATALOG=/build-catalog/versions.json`，只读挂载） | `compose.yaml:24-28`、`main.go:60` |
| 构建 worker 只从 `build-catalog/versions.json` 里**已批准的 commit** 构建（`git archive`），**不读工作树** | `build_worker.py:177-206` |

> 由此推出一条硬结论：**当前工作树的改动（字段集 24）永远进不了构建中心**，除非先 commit 再 `build_worker.py approve`。而一旦 commit 了字段集 24，后台就会开始拒收。发布 1.19.0（字段集 23）必须走「导入现成 APK」而不是「重新构建」。

### 3.2 检查清单

| # | 检查项 | 怎么查 | 期望值 | 失败时怎么办 |
| --- | --- | --- | --- | --- |
| C-1 | APK 文件存在且哈希一致 | `Get-FileHash D:\SigMark\app\build\outputs\apk\debug\SigMark-1.19.0-LAN-debug.apk -Algorithm SHA256` | `d5152b1ce60398b9824d498afbc646c98762f3a3c06207f6ddbc9a381ee650ec`（**实测已通过**） | 不要发布；重新从归档位置取回同一份 APK，禁止重编（重编会得到字段集 24） |
| C-2 | APK 大小 | `(Get-Item <apk>).Length` | `12267961` 字节（**实测**） | 同上，视为文件被替换 |
| C-3 | 包名/版本/debuggable | `aapt dump badging <apk>`（`build-tools\36.0.0\aapt.exe`） | `package: name='com.sigmark.app' versionCode='46' versionName='1.19.0'`，且含 `application-debuggable` | worker 会直接 `ValueError: Expected a SigMark Android debug APK.`，不要强行导入 |
| C-4 | 签名一致性（单签名 + 与线上同证书） | `apksigner.bat verify --print-certs --verbose <apk>` | 只有一个 Signer，`Signer #1 certificate SHA-256 digest: e424900e635efe79ab05f904d6436394e980e26246085ac39f5ec9cc50463904`（**实测**，与 1.16.0 线上 `signerSha256` 完全相同） | 若不同：`publishBuild` 会 409 `publish_signer_changed`，`import-apk --publish` 会 `ValueError`。此时**必须停下**，说明签名密钥变了，需先决策是否接受签名轮换 |
| C-5 | 签名方案 | 同上，看 `Verified using v2 scheme` | v2 = true（**实测**；v1/v3 为 false，属 AGP 默认行为） | v2 缺失会导致 Android 7+ 装不上，重打 |
| C-6 | LAN 地址已注入 | 在 APK 的 dex 里搜 `192.168.1.114:48272`（可用 PowerShell 读 zip 条目 `classes*.dex` 后做字节匹配） | `classes4.dex`、`classes6.dex` 命中（**实测**） | 未命中说明构建时没传 `-PSIGMARK_LAN_URL`，App 会连不上后台，重打 |
| C-7 | 字段集声明 | 反查 `app/src/main/java/com/sigmark/app/lan/LanReport.kt` 的 `LanFieldSetVersion`，并核对 APK 内是否含 v24 键字符串（`cpuCapacity`/`cmaTotal`） | 应为 23；APK 内**不应**出现 `cpuCapacity`/`cmaTotal`（**实测：均不存在**） | 若出现 → 该 APK 是字段集 24，后台会 400，**禁止发布** |
| C-8 | 注册 job | `python backend\scripts\build_worker.py import-apk "D:\SigMark\app\build\outputs\apk\debug\SigMark-1.19.0-LAN-debug.apk" --origin http://192.168.1.114:48272 --name "1.19.0 字段集23 试装"` | 输出 `Artifact ready <id> 1.19.0 d5152b1c…`，且 `backend/build-data/jobs/<id>/sigmark.apk` 的 size=12267961 | 报 `Unexpected private file`/`Expected one verified APK signer` → 回到 C-3/C-4 |
| C-9 | 发布前 job 自检 | `GET /api/admin/builds`，找该 id 的 `state`/`size`/`sha256`/`signerSha256` | `state=succeeded`、`sha256=d5152b1c…`、`size=12267961`、`signerSha256=e424900e…` | 任一不符 → 重新 `import-apk` |
| C-10 | 发布（唯一写操作，需 Lead 明确授权） | `POST /api/admin/builds/<id>/publish` | 200 + job JSON | 409 `publish_version_not_newer`（1.19.0/46 ≤ 1.16.0/43？不会）；409 `publish_signer_changed` → 回 C-4；409 `artifact_checksum_mismatch` → 磁盘 APK 被换 |
| C-11 | 下载信息切换 | `GET /api/downloads/current` | `version=1.19.0`、`versionCode=46`、`sha256=d5152b1c…`、`signerSha256=e424900e…`、`size=12267961` | 仍是 1.16.0 → publish 未生效，检查 `backend/build-data/current.json` 是否已指向新 id |
| C-12 | 下载字节校验 | 下载 `GET /downloads/sigmark.apk?sha256=d5152b1c…` 全量后本地 `Get-FileHash` | 206/200，本地哈希 = `d5152b1c…`；`ETag` 头 = `"d5152b1c…"`（`builds.go:351`） | 哈希不符 → `serveAPK` 直出文件，说明 job 目录里的 `sigmark.apk` 被改过，立即停止分发 |
| C-13 | 下载防错配护栏 | `GET /downloads/sigmark.apk?sha256=deadbeef` | `409 {"error":"release_changed"}`（**实测已通过**） | 若返回 200，说明护栏失效，禁止对外公布链接 |
| C-14 | 环境变量 | `docker exec sigmark-lan-api-1 env`（只读）或核对 `compose.yaml` | `BUILD_DATA=/build-data`、`BUILD_CATALOG=/build-catalog/versions.json` | 缺任一 → `/api/admin/builds` 返回 `build_store_unavailable`(503) 或空列表 |
| C-15 | 历史签名留档 | 发布成功后确认 `backend/build-data/published-signers/1.16.0-43.json` 生成 | 内容 = `e424900e…` | 未生成 → `retainPublished` 失败，会导致 `/api/admin/release-signer` 无法回答旧版本 |
| C-16 | 签名登记查询 | `GET /api/admin/release-signer?version=1.19.0&code=46&package=com.sigmark.app&channel=lan-debug` | 发布前 `{"state":"unregistered"}`（**实测**），发布后 `{"state":"registered","signerSha256":"e424900e…"}` | 发布后仍 unregistered → `current.json` 指向的 job 与版本号不匹配 |
| C-17 | 构建工作进程 | `GET /api/admin/builds` 的 `workerOnline` | 当前为 `false`（**实测**） | 若要走「重新构建」路线，必须先把 worker 拉起来（`build_worker.py work --origin http://192.168.1.114:48272`），否则 job 永远 `queued` |

### 3.3 为什么 `sha256` 与 `signerSha256` 不能混用

| 字段 | 含义 | 计算方式 | 校验谁 | 变了意味着什么 |
| --- | --- | --- | --- | --- |
| `sha256` | **APK 文件字节**摘要 | `hashlib.file_digest(apk,"sha256")`（`build_worker.py:162`） | `openAPK` 的 size 校验 + `publishBuild` 的 `artifact_checksum_mismatch` + `?sha256=` 下载护栏 + `ETag` | 只要重新编译（哪怕源码一字未改）就会变；时间戳、签名块都会影响 |
| `signerSha256` | **签名证书 DER** 的 SHA-256 | `apksigner verify --print-certs` 的 `Signer #1 certificate SHA-256 digest`（`build_worker.py:151-155`） | `publish_signer_changed`、`/api/admin/release-signer`、`published-signers/*.json` | 变了意味着换了签名密钥（换 debug keystore / 换机器），**升级会失败**（Android 拒绝不同证书的覆盖安装） |

一句话：`sha256` 管「文件没被篡改」，`signerSha256` 管「还能不能覆盖安装」。本次两者都无需变化（实测签名一致）。

---

## 4. 回滚标签命名惯例与建议命令（**只写文档，不执行**）

### 4.1 实测到的历史惯例

`docker images` 里 `sigmark-lan-api` / `sigmark-qa` 的标签分三派（实测列表）：

| 惯例 | 实例 | 语义 |
| --- | --- | --- |
| `rollback-before-<版本>-<YYYYMMDD-HHmmss>` | `sigmark-lan-api:rollback-before-117-20261125-175117` | 「推进到某版本之前」的可回滚快照，带时间戳 |
| `before-<特性>-<版本>` | `sigmark-lan-api:before-upload-preview-116`、`before-identity-review-115`、`before-auto-security-114` | 按特性命名，不带时间戳 |
| `pre-<特性>-<YYYYMMDD-HHmmss>` | `sigmark-lan-api:pre-concise-console-20261124-185141`、`pre-reader-flow-20261124-180826` | 同上但带时间戳（更早的写法） |

结论：`rollback-before-*` 是**跨版本推进**用的；`before-*` / `pre-*` 是**特性切换**用的。本轮属于「发布默认下载包切换 + 字段集 23 上线」，两种语义都沾，建议**各打一个**。

### 4.2 本轮建议标签

当前运行镜像（实测）：

```
sigmark-lan-api:latest   b9a5333cb60d   2026-11-25 19:08:43 +0800   （latestFieldSet=23，容器 sigmark-lan-api-1 已运行 49 分钟）
```

建议：

| 建议标签 | 用途 |
| --- | --- |
| `sigmark-lan-api:rollback-before-119-20261125-2015` | 主回滚点：1.19.0 发布**之前**的字段集 23 镜像 |
| `sigmark-lan-api:before-fieldset-23-release-119` | 特性命名别名，与历史 `before-*` 惯例对齐 |

命令（**待 Lead 授权后执行，本文不执行**）：

```powershell
# 1) 先确认运行中的容器用的就是 latest，并记录 ID
docker inspect --format '{{.Image}}' sigmark-lan-api-1
docker images --digests sigmark-lan-api

# 2) 打回滚标签（纯 tag，不改运行状态）
docker tag b9a5333cb60d sigmark-lan-api:rollback-before-119-20261125-2015
docker tag b9a5333cb60d sigmark-lan-api:before-fieldset-23-release-119

# 3) 回滚时的用法（仅在需要时）
docker tag sigmark-lan-api:rollback-before-119-20261125-2015 sigmark-lan-api:latest
docker compose -f D:\SigMark\backend\compose.yaml up -d --no-deps --force-recreate api
```

> 注意：第 3 步 `up -d` 会因 `build: .` 触发重建，可能重编译出新镜像。**真正回滚应使用 `docker compose up -d --no-build`**，或先 `docker service`/`docker run` 指定镜像。这一条在本仓库历史标签里没有先例，建议回滚演练时单独验证。

### 4.3 如果目标是回滚到字段集 22

必须先确认哪个镜像含 `latestFieldSet=22`。只读约束下**无法验证**（见 G-1）。候选（按构建时间排序）：

| 镜像 | 构建时间 | 备注 |
| --- | --- | --- |
| `sigmark-lan-api:rollback-before-117-20261125-175117` | 2026-11-25 17:34 | 1.17.0 之前 |
| `sigmark-lan-api:before-upload-preview-116` | 2026-11-25 17:11 | 1.16.0 之前 |
| `sigmark-lan-api:before-identity-review-115` | 2026-11-25 16:57 | 1.15.0 之前 |
| `sigmark-lan-api:before-auto-security-114` | 2026-11-25 16:39 | 1.14.0 之前 |

由于字段集 22 与 1.18.0 同期（实测 v22 报告 `ddb2b82e…` 来自 1.18.0），**上表没有一个必然对应字段集 22**——它们都早于 1.18.0 的部署。若确需回滚到 22，正确做法是**重新构建一个 `latestFieldSet=22` 的镜像并打 `rollback-22-<时间戳>` 标签**，而不是猜历史标签。

---

## 5. 遗留缺口清单

| # | 缺口 | 现状 | 风险 | 补救方式 |
| --- | --- | --- | --- | --- |
| G-1 | **回滚目标镜像的 `latestFieldSet` 未验证** | 只读约束下不能启动一次性容器读常量 | **高** | 获授权后：`docker run --rm -e DATABASE_URL=... -e ADMIN_TOKEN=... <img>` 起临时端口，`GET /api/admin/field-dictionary` 看 `latestFieldSet`；或回滚前先 `docker create` + `docker cp` 取二进制 `strings` |
| G-2 | **v22 客户端在线被接收未实测** | 档案里有 1 份 v22 报告（`ddb2b82e…`，1.18.0），但那是**当前后台**收下的历史数据，不能证明「此刻再传一份 v22 也会被收」；且没有 v21 报告 | 中 | 用一个独立的合成批次（`LAN_BATCH` 指向合成批）实传一份 `fieldSetVersion=22` 的合成报告，验证 201 + 参数条数，然后只清理该批次 |
| G-3 | **v21 档完全无真实样本** | 档案分布实测：v23×3、v22×1、v20×4、v16×3，**v21 零份** | 中 | 同上，合成一份 v21 报告验证 201；重点是确认 250 条上限不会误伤（v21 静态键 226 + 24 分区 = 250，正好卡满） |
| G-4 | **MI 8 / API 26–30 覆盖不全** | 实测仅有 1 份 MI 8（`dipper`）报告，`androidApi=29`（Android 10），版本 1.7.0 / 字段集 16 | **高** | 在 MI 8（API 29 已有基线）与至少一台 API 26/27/28/30 设备上跑 1.19.0，重点验证 `environment.overlayDeviceCodename`（`/proc/self/maps` 在旧内核上的可读性）、`cpu.cpuParts`（`/proc/cpuinfo` 解析）、`memory.physicalRam`（`sysconf`）三处新增读数 |
| G-5 | **APK 不可复现** | HEAD 的 `LanFieldSetVersion=20`、工作树 24、APK 实测 23：三者互不相同，且工作树改动未提交 | **高** | 发布前把「字段集 23 的那一版源码」单独 commit 并 `approve`，否则将来任何重编都得不到同一 APK；当前只能靠文件哈希锁定 |
| G-6 | **maxFields 分档从未被真实数据区分** | 实测最大 204 条，离 250/255/256 都有距离 | 低 | 写一个 256 条参数的合成报告打到当前后台（应 201），再打到回滚镜像（应 400），把分档行为变成实测结论 |
| G-7 | **v24 键在后台完全缺失** | `cpu.cpuCapacity`、`memory.cmaTotal` 在 `dictionary()` 232 项里不存在 | **高**（一旦发布 v24 客户端） | 若确需 v24，后台必须同步 `latestFieldSet=24` + 两个 `versionedParameter` + 字典项 + `lan-projection-v24.txt` 契约测试；在此之前**任何 v24 构建都不得下发** |
| G-8 | **构建工作进程离线** | `workerOnline=false`，心跳文件缺失 | 中 | 发布若走 `import-apk` 不受影响；若需重新构建，先启动 worker 并确认心跳 |
| G-9 | **客户端 400 文案不区分版本偏斜** | `LanReport.kt:131` 统一提示「检查设备时间」 | 中 | 属于代码改动，本轮不改；建议下一轮把 400 细分为 `invalid_report` 与版本不匹配 |
| G-10 | **`docker compose up -d` 会触发 `build: .`** | `compose.yaml:17` | 中 | 回滚演练必须用 `--no-build`，否则回滚可能变成「用当前源码重建」，与回滚意图相反 |
| G-11 | **未验证 `/api/admin/reports/export` 在回滚镜像下的字段集行为** | 未测（只读约束下未发 POST） | 低 | 回滚演练时单独验证 |
| G-12 | **1.19.0 未做真机回归** | 本次只做了静态与接口盘点 | **高** | 按 `AGENTS.md` 第 5 条，构建/安装/页面/导出四项证据齐全后才能称为发布候选 |

---

## 6. 实测命令与原始输出（可复现）

### 6.1 线上发布信息

```powershell
(Invoke-WebRequest -Uri "http://192.168.1.114:48272/api/downloads/current" -UseBasicParsing).Content
```

```json
{"origin":"http://192.168.1.114:48272","sha256":"4b00f0a322556f1cd686166446f0765e92808c8f40e2dea701a6c877e1b7a163","signerSha256":"e424900e635efe79ab05f904d6436394e980e26246085ac39f5ec9cc50463904","size":11974149,"version":"1.16.0","versionCode":43}
```

### 6.2 本地 APK

```powershell
Get-FileHash D:\SigMark\app\build\outputs\apk\debug\SigMark-1.19.0-LAN-debug.apk -Algorithm SHA256
```

```
size=12267961
sha256=d5152b1ce60398b9824d498afbc646c98762f3a3c06207f6ddbc9a381ee650ec
```

```powershell
& "$env:LOCALAPPDATA\Android\Sdk\build-tools\36.0.0\apksigner.bat" verify --print-certs --verbose <apk>
```

```
Verifies
Verified using v2 scheme (APK Signature Scheme v2): true
Number of signers: 1
Signer #1 certificate DN: C=US, O=Android, CN=Android Debug
Signer #1 certificate SHA-256 digest: e424900e635efe79ab05f904d6436394e980e26246085ac39f5ec9cc50463904
```

### 6.3 字段字典

```powershell
(Invoke-WebRequest -Uri "http://192.168.1.114:48272/api/admin/field-dictionary" -Headers $h -UseBasicParsing).Content | ConvertFrom-Json
```

```
latestFieldSet=23  dictionaryVersion=sigmark-lan-fields/14  items=232  schemaVersion=1
readingStates=AVAILABLE,RESTRICTED,UNAVAILABLE,ERROR
dynamic: {"maxPerReport":24,"minSchemaVersion":4,"pattern":"^system\\.partition_[a-z0-9_]{1,32}$","sinceFieldSet":7}
```

`sinceFieldSet >= 21` 的条目（实测）：

```
cpu.cpuParts                       22  core_part_counts  display_text
environment.overlayDeviceCodename  23  device_codename   enum_text   APP_PROC_MAPS
memory.kernelMemTotal              22  GiB               display_text
memory.physicalRam                 22  GiB               display_text
runtime.glesRenderer               22                    display_text
runtime.glesVendor                 22                    display_text
system.propertyDevice              21                    declaration_text  APP_GETPROP
system.propertyModel               21                    declaration_text  APP_GETPROP
```

### 6.4 档案字段集分布（11 份报告逐份读取）

```
id        model      api fs app      n
933fedf6 23078PND5G  34 23 1.19.0 204
76423849 23078PND5G  34 23 1.19.0 204
4263018e 23078PND5G  34 23 1.19.0 204
ddb2b82e 23078PND5G  34 22 1.18.0 203
890f2714 23078PND5G  34 20 1.15.0 203
55b00f37 23078PND5G  34 20 1.15.0 200
2b5f56eb 23078PND5G  34 20 1.14.0 200
e538c2a2 23078PND5G  34 20 1.12.0 200
a65bfefe 23078PND5G  34 16 1.7.0  171
3791eb62 23078PND5G  34 16 1.7.0  174
ed0d9ff6 MI 8        29 16 1.7.0  168
```

`/api/admin/report-count` → `{"total":11}`；`/api/admin/report-facets` → 模型 `23078PND5G`×10 / `MI 8`×1，Android `14`×10 / `10`×1。

### 6.5 构建中心

```
publishedId=60c8ba63565a4b2497883c7461d5d205  workerOnline=False  versions=11  jobs=37
1.17.0  44  succeeded  aff1a40f5fff…  signer e424900e…
1.16.0  43  succeeded  4b00f0a32255…  signer e424900e…   ← 当前发布
1.15.0  42  succeeded  b09832529624…  signer e424900e…
```

`current.json` = `"60c8ba63565a4b2497883c7461d5d205"`（= 1.16.0 的 job id）；`published-signers/` 共 18 个文件，最新为 `1.15.0-42.json`。

### 6.6 签名登记

```
version=1.19.0&code=46 → {"state":"unregistered"}
version=1.17.0&code=44 → {"state":"unregistered"}
version=1.16.0&code=43 → {"state":"registered","signerSha256":"e424900e…"}
```

### 6.7 下载护栏

```
GET /downloads/sigmark.apk  (Range: bytes=0-15)                    → 206
GET /downloads/sigmark.apk?sha256=deadbeef                          → 409 {"error":"release_changed"}
GET /downloads/sigmark.apk?sha256=4b00f0a3…（当前值）               → 206
```

### 6.8 容器与镜像

```
sigmark-lan-api:latest   b9a5333cb60d   2026-11-25 19:08:43 +0800 CST   28.7MB
容器 sigmark-lan-api-1  sigmark-lan-api  Up 49 minutes
容器 sigmark-lan-db-1   postgres:17-alpine  Up 5 days (healthy)
```

---

## 7. 证据边界

**已实测（可复现）**：`/api/downloads/current`、`/api/admin/field-dictionary`、`/api/admin/reports`（列表 + 11 份详情）、`/api/admin/reports/<id>/device-profile`（v23 与 v22 各一）、`/api/admin/builds`、`/api/admin/release-signer`、`/downloads/sigmark.apk` 的 206/409 护栏、`report-count`、`report-facets`、本地 APK 哈希/签名/包内 dex 字符串、`docker images`/`docker ps`、`build-data` 与 `build-catalog` 文件、`git diff`/`git status`。

**推断（有代码依据，未在线验证）**：v21 与 v24 客户端的实际接收/拒绝行为（无对应客户端可发）、回滚镜像的 `latestFieldSet` 常量、`publishBuild` 的 409 分支实际触发、旧镜像对 v23 报告的 `NOT_ARCHIVED` 表现（当前镜像是 23，实测的是「v22 报告缺 v23 键」，与「v23 报告遇旧镜像」是镜像关系而非同一次观测）。

**未做（按约束）**：任何 POST（含 `import-apk`、`publish`、合成报告）、任何 `docker tag`/`build`/`up`/`run`、任何删除、任何代码修改。
