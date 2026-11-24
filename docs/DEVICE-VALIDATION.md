# 设备验证记录与复测清单

## 1.12.0 / 39 整体获取实测

- 通过 101 项 Android 单测、71 项 Web 单测、Go test/vet 和生产镜像构建。内网发布包与上版签名一致，下载和两台手机已安装 APK 的 SHA-256 均为 `724fdfb4000e996c79d810eb22bdaa82ca89b629d8b10f3a3c93b9061c262b82`。
- Pixel 6 首页点击「整体获取」，本机保存的待上传报告记录 TEE、AVC 首帧通过和 GLES 回读通过，提交状态为从未尝试。MI 8 显示新版首页和采集入口，主机模拟点击未触发本机新报告。
- 两台均调用与首页共用的实验采集流程，分别执行两次采样并上传到临时 PostgreSQL。四份报告均包含 AVC、GLES 的通过结果及起止时间。360 px 浏览器核对原始报告下载及实验展示，归组和重试回执通过。
- 后台在 320、390、1440 px 检查报告档案、资产子页、单份参数、安全、验收、构建、下载和设置。部署前后原库 22 份在库及回收站报告的哈希一致。验收文件见 `app/build/lan-qa/full-112/`。

## 1.11.0 / 38 内网发布与安装复测

- 内网已发布和回读同签名 APK，SHA-256 为 `5b20bd0d33628dc2ac5f1c1544affb1956b8f0f3c8b54ddc294848e77646e03a`。Pixel 6 从 1.7.0 覆盖升级，MI 8 从现有 1.11.0 覆盖安装本次发布包。两台的已安装 APK 哈希均与实际下载一致，首次安装时间保留。
- 两台在独立临时 PostgreSQL 中完成两次采集、实际 HTTP 上传、同机归组与原请求回执重试。Pixel 6 归档 184 项，MI 8 归档 178 项。360 px 浏览器通过字段来源检查及 JSON 下载。
- 本轮安装由 ADB 完成。系统安装器的 App 内点击更新路径待独立验收。输出和日志位于 `app/build/lan-qa/workflow-111/`。

## 1.11.0 / 38 · 开机次数、媒体性能等级与 root 观察（2026-11-24）

- **构建与测试**：97 项 Android JVM 单测、Lint（0 错误、30 项既有警告）、Go `vet` / 51 项测试、Web 70 项测试与生产构建、Python 8 项工具测试全部通过。APK 为 `app/build/outputs/apk/debug/app-debug.apk`，1.11.0 / 38，SHA-256 `341279bcba2399a4d9af11c7bc15ff016af6f5e3ec4a7e3d0a4d9b388f375c3c`；两台手机覆盖升级，仪器测试包用完卸载。
- **字段集 20**：`system.bootCount` 在 App 侧读到 86 / 56，与 shell `settings get global boot_count` 一致；`system.mediaPerformanceClass` 在 Pixel 6 / API 34 上为 31，MI 8 / API 29 记 `INTERFACE_UNSUPPORTED`。字段集 20 归档 184 / 178 项，默认 `CapabilitySmoke` 在两台均通过（字段集 20、扩展键、AVC 首帧、GLES 探针、USB 观察、本机草稿）。
- **root 观察通道**：新增 `sigmark-adb-evidence/5`（`observer=ROOT`）与 `tools/root_observation.py`，在 v4 字段之外给出 SELinux 策略摘要（`sha256:<64 位>`）；面板把 App、ADB shell、root 三个来源分列，root 值不回填 App 字段。**没有 root 真机可测**，只有解析、摘要格式与读数校验的单测；实机运行前先确认 `su -c getenforce` 与 `sha256sum /sys/fs/selinux/policy` 可用。
- **浏览器 QA（Chrome headless，fixture 拦截，无数据库写入）**：`report-reader`（9 视口、126 字段、搜索/状态/覆盖/返回位置）、新写的 `identity-summary`（导航、概览、三张表、导出 JSON、320/390 px、报告详情身份提示与一致报告不提示）、`device-profile`（重试、390 px、键盘、历史受限、JSON）、`security-v7`（签名匹配/不匹配、冲突、分区披露、窄屏）、`configuration-evidence`（隔离栈内 320 px 档案、机器码三分量、ROM 输入变化、sysfs 对照、上一份采样链接、导出）均通过。截图在 `app/build/lan-qa/qa-web/`。
- **内网部署**：重建并就地替换 `sigmark-lan-api-1`，数据库容器与卷未动。线上 `field-dictionary` 返回 `latestFieldSet=20`、`sigmark-lan-fields/10`、224 项；bundle 含「身份分布」「身份声明不一致」「root 观察」。真实库的 `identity-summary` 正常返回。
- **未做**：root 真机、Android 8/9 分区属性真机、向正式库上传测试样本；不判断那台双身份设备的物理来源。

## 1.10.0 / 37 · 身份字段与内部一致性（2026-11-24）

- **构建与测试**：97 项 Android JVM 单测、Lint（0 错误、30 项警告）、Go `build` / `vet` / 51 项测试、Web 69 项测试与生产构建、Python 4 项工具测试全部通过。APK 为 `app/build/outputs/apk/debug/app-debug.apk`，1.10.0 / 37，SHA-256 `ec03a7011933cc1cb6eeaf0179800516bab622e25130241924b8d7788d1d9828`。两台手机已覆盖升级，仪器测试包用完卸载。
- **字段集 19**：`system.boardPlatform`、`system.bootHardware`、`system.hardwareSku` 在 App 侧全部读到。序列 `35241FDF6S1P3K` 为 `mt6985 / mtk / 23078PND5G`，MI 8 为 `sdm845 / qcom / 未上报`（该 ROM 没有 `ro.boot.hardware.sku`）。快照 245 / 240 项，其中 232 / 219 可用、11 / 18 不可用、2 / 3 受限；归档字段 182 / 176。
- **App 内部一致性**：两台都通过。「指纹安全 → 查看其他系统检查」显示「设备身份字段 · 已观察」：序列 `35241FDF6S1P3K` 比较 3 对一致（`mt6985/mt6985`、`mtk/mtk`、`23078PND5G/23078PND5G`），MI 8 比较 2 对一致（SKU 两侧都没有值，不算可比）。**内部一致不等于物理真相**，这条只报告同一观察者内部的自洽性。
- **跨来源身份冲突（关键）**：同一分钟用 ADB 观察文件 v4 对照 App 报告：
  - 序列 `35241FDF6S1P3K`：平台代号 `mt6985` vs `gs101`、启动硬件 `mtk` vs `oriole`、启动硬件 SKU `23078PND5G` vs `GR1YH`——**三对全部不一致**；SELinux 推断值仍与 `getenforce` 一致；电池节点 App 受限、shell 读到 262。
  - MI 8：平台代号 `sdm845`、启动硬件 `qcom` 两侧一致；SKU 两侧都无值；电池节点两侧都读不到。
  页面按「App 与 shell 身份字段不一致（同一属性可能按上下文改写），两值分别保留」呈现，不合并、不回填。
- **规则版本**：前端 `rom-evidence/4` 新增 `identity_fields` 检查（review/observed/unknown）；设备风险画像 `sigmark-profile/3` 末尾追加 `identity_conflict`（9 个标签，顺序固定）；ADB 观察文件升到 `sigmark-adb-evidence/4`。
- **同资产身份漂移**：设备风险画像新增 `identityHistory`（窗口内出现过的「型号+主板+硬件声明」组合，含份数、最近时间与报告链接，最多 5 套）。用一份合成 v19 报告验证：同资产两份样本出现两种身份组合时，画像返回 2 条并保持最近优先；单份时返回 1 条。前端「设备风险画像」增加「历史身份声明」折叠块。
- **上传验收（隔离栈）**：用 `docker compose -p sigmark-qa1100` 起临时 PostgreSQL 17 + API（`127.0.0.1:48293`），上传两份合成 v19 报告（同资产、两种身份声明），逐项核对后 `down -v`，卷与网络均删除，未接触正式库。结果：
  - 上传 201，`assetLinked=true`；归档回读 `fieldSetVersion=19`，18 个字段含三条身份声明。
  - `GET /api/admin/field-dictionary`：`latestFieldSet=19`、`dictionaryVersion=sigmark-lan-fields/9`、222 项。
  - `GET .../device-profile`：`sigmark-profile/3`、9 个标签；第一份 `identity_conflict=hit`（`boardPlatform=gs101` 与 `board=mt6985` 冲突），第二份 `not_observed`；`identityHistory` 分别为 1 / 2 条。
  - 档案（dossier）：三个机器码分量全部生成，商品 `P2-1c04…`、硬件 `H2-d23f…` 与真机 App 值一致，ROM `R2-8b6d…`；`previousReportId` 指向上一次同资产采样；身份字段已归档。
  - 证据脚本与输出在 `app/build/lan-qa/upload-1100/`（不提交）。
- **仓库级身份分布**：新增 `GET /api/admin/identity-summary` 与「身份分布」页。在隔离栈（项目 `sigmark-qa1100`，`down -v` 后清理）上传 3 份合成 v19 报告：2 份同资产（两种身份声明）、1 份另一资产（与第二种相同声明）。接口返回 `assets=2`、`reports=3`、`multiIdentityAssets=1`、`sharedIdentities=1`（`assetCount=2`）、`conflictReports=1`（2 个冲突对）。纯函数单测覆盖聚合、缺失/受限不算冲突、列表截断；`TestIdentitySummaryPostgres` 在临时 PostgreSQL 上覆盖 SQL 投影、回收站排除与共享声明。前端构建产物包含该页面，浏览器回归未跑。
- **内网部署**：重建并就地替换 `sigmark-lan-api-1`，数据库容器与卷未动（`sigmark-lan-db-1` 运行时长未变）。健康检查 ready；线上 `GET /api/admin/field-dictionary` 返回 `latestFieldSet=19`、`sigmark-lan-fields/9`、222 项；`GET /api/admin/identity-summary` 在真实库（2 份在库报告、2 个资产）返回 `reports=2 assets=2`、三类列表为空（现有报告早于身份字段），页面 bundle 已包含「身份分布」与报告详情的「身份声明不一致」提示。
- **身份提示**：报告详情新增顶部「身份声明不一致」提示（共享纯函数 `identityConflictsOf`，忽略大小写、两侧都有值才比较），设备风险画像在 `identity_conflict` 命中时同样置顶提示；两处都只提示核对。新增 Web 单测覆盖三对冲突、缺一侧、受限与大小写归一。
- **未做**：未向正式后台上传；未运行浏览器 QA；Android 8/9 分区属性回退仍无真机（已补纯函数单测）；root 观察通道未接；不判断这台双身份设备的物理来源。

## 1.9.0 / 36 · 机器码三分量与设备世代（2026-11-24）

- **构建与单元测试**：Debug APK、94 项 Android JVM 单测、Lint（0 错误、30 项既有警告）、Go `build` / `vet` / 41 项测试、Web 65 项测试与生产构建、Python 4 项工具测试全部通过。APK 为 `app/build/outputs/apk/debug/app-debug.apk`，1.9.0 / 36，SHA-256 `a07ea151707d70e9ca9725ff0d90e97cf3ad3414bec7873bd413ef1af82d8c3e`。
- **正式包升级**：两台手机都用 `adb install -r` 覆盖到 1.9.0 (36)，数据和授权保留；仪器测试包用完已卸载，手机上只有 `com.sigmark.app`。
- **机器码三分量已在真机生成**（`-e configuration check` 连跑两次同码）：
  - 序列 `35241FDF6S1P3K`：`P2-1c041f1e860b175b83bda8ec8bb1f684` / `H2-d23fc40b1186d4fbf2fdbe5bb095699f` / `R2-45874610a0c6da10767fa24a206438a6`。
  - 序列 `5371113b`：`P2-2f9d7b64849e7b272548d6958d5ca996` / `H2-c4930cdce4ec2d4ddf9ea340ab056a26` / `R2-d4d8acf103f666a06786bb3e5e4c147e`。
- **字段集 18**：`system.initialSdk` 在 App 侧读到 33（序列 `35241FDF6S1P3K`）与 27（MI 8）。同一属性在 ADB shell 上分别是 31 与 27——第一台设备的属性值按上下文改写。分区分支两台都走 `Build.getFingerprintedPartitions`（API 34：5 个分区；API 29：4 个），Android 8/9 的属性回退分支本轮没有对应真机，只做了静态与契约核对。
- **真机发现的身份冲突（重要）**：序列 `35241FDF6S1P3K` 上，同一时刻两个上下文给出两套自洽的设备身份：

  | 观察项 | App（`untrusted_app` / `run-as`） | ADB shell（`u:r:shell:s0`） |
  | --- | --- | --- |
  | 型号 / 代号 | `23078PND5G` / `corot` | `Pixel 6` / `oriole` |
  | 主板 / SoC | `mt6985` / `Dimensity 9200+`（MediaTek） | `gs101` / `Tensor`（Google） |
  | `ro.product.first_api_level` | 33 | 31 |
  | 分区构建指纹 | `Xiaomi/corot_global/corot:14/…` | `google/oriole/oriole:14/…` |
  | 显示物理尺寸 / 内存 | 1220×2712 / 12.00 GiB | `wm size` 1080×2400 |

  用 `adb shell run-as com.sigmark.app getprop ro.product.model` 得到 `23078PND5G`，同一命令在 shell 下得到 `Pixel 6`：差异发生在按调用上下文的属性视图，而不是采集器。两种视图各自内部一致，本轮不判断哪一个是物理真相；结论是**任何单一 API 都不是“真实设备信息”**，报告只能标注观察者。机器码因此只编码 App 归档视角，跨来源对照用「证据来源对照」并排保留。
- **状态计数（快照口径）**：序列 `35241FDF6S1P3K` 241 项：229 可用、11 不可用、2 受限；MI 8 237 项：217 可用、17 不可用、3 受限。LAN 归档字段 179 / 173。
- **未做**：未上传到正式后台或临时 PostgreSQL；未运行浏览器 QA；未测 Android 8/9 分区属性回退；未接 root 观察通道；两台设备的真实物理来源不由本工具认定。

## 1.8.0 / 35 · 进程内安全线索与读取回退（2026-11-24）

- **构建与单元测试**：Debug APK、93 项 Android JVM 单测、Lint（0 错误、30 项既有警告）、Go `build` / `vet` / 41 项测试、Web 65 项测试与生产构建全部通过。APK 为 `app/build/outputs/apk/debug/app-debug.apk`，版本 1.8.0 / 35，SHA-256 `bd4bd24880e29ae93830cf8cbb53a89446b95c580755c9790f932e6af2699ca7`，签名仍为 Android Debug 证书（`e424900e…`）。
- **正式包已升级**：`adb install -r` 把 `com.sigmark.app` 从 1.7.0 覆盖到 1.8.0 (35)，两台手机的数据与已授权限保留（Pixel 6 与 MI 8 的电话状态、精确位置均为 granted）。升级后两台都能正常采集，`CapabilitySmoke`（字段集 17 断言、AVC 首帧、GLES 探针、USB 观察、本机草稿）通过。本轮用过的隔离包 `com.sigmark.app.qa` 与仪器测试包已卸载，手机上只留正式包。
- **SELinux 推断已在真机成立，并有内核审计旁证**：两台都得到 `system.selinux = Enforcing（强制模式，推断）`、`system.selinuxEvidence = inferred_mac`。logcat 同时给出 `avc: denied { read } name="enforce" ... scontext=u:r:untrusted_app ... permissive=0`，即策略拒绝发生在强制模式下；ADB `getenforce` 也返回 `Enforcing`。三个来源一致，推断值不是猜的。`system.selinuxPolicy` 仍 `RESTRICTED / ACCESS_DENIED / errno=13`，shell 也被 `security:read_policy` 拒绝，只有 root 能读内容。
- **真机发现并修掉一个误报**：首轮 dump 时两台都报 `environment.hookSignals = memfd_exec`。排查后确认是 ART 运行时自己创建的 JIT memfd，已改为排除运行时 memfd 名称（jit、dalvik、vdex、oat、gralloc、hwui、ion、adf）后才计入。复测两台均为 `none`。
- **属性回退与上下文改写**：Pixel 6 的 `system.bootloader` 由回退 `getprop ro.bootloader` 得到 `corot-1.0.9`；同一台设备的 shell 读同一属性得到 `slider-14.5-12088207`，说明属性会被 ROM 按进程上下文改写。MI 8 的该属性对 App 不可见，保持 `OPTIONAL_UNSET`。`system.baseOs` 两台都未提供。`system.partitionBuildDates`：Pixel 6 五个分区均 2024-08-09（`ro.bootimage.build.date.utc` 被 App 的 SELinux 策略拒绝，所以没有 bootimage）；MI 8 system / vendor / odm / bootimage 均 2021-10-28。
- **跨来源对照（App / 无 root 的 shell）**：`tools/coverage_observation.py` 升级为 `sigmark-adb-evidence/3`，新增 `ro.bootloader`、`ro.boot.veritymode`、`ro.debuggable` 与电池驱动温度节点。两台实机各采一份，与 15 秒内的 App 快照并排比较：补丁、启动校验、锁定、VBMeta、verity、SELinux 全部一致；电池温度在差值内（Pixel 6 26.5 °C / 264，电压 4395 mV 对 4395）；App 拒读的 `battery.sysBatteryTemp` 在 Pixel 6 上 shell 读到 265（26.5 °C），MI 8 上 shell 也读不到；`system.vendorSpl` 与 `environment.buildDebuggable` 在 Pixel 6 上 App 为未上报、shell 可读（2026-07-05 / 0）。这些都只在「证据来源对照」里并列，没有写回 App 字段。证据在 `app/build/lan-qa/evidence-180/`。
- **状态计数（快照口径，正式包）**：Pixel 6 为 241 项：228 可用、11 不可用、2 受限；受限只剩 `system.selinuxPolicy` 与 `battery.sysBatteryTemp`（公开温度仍可用）。MI 8 为 241 项：222 可用、16 不可用、3 受限（多出的是 GNSS 接口不支持与平均电流等本机不提供的项）。LAN 归档字段 178 / 175。
- **未做**：未向正式后台或临时 PostgreSQL 上传（避免测试样本写入真实仓库）；未运行浏览器 QA `backend/web/qa/*.cjs`；未测试分身/工作资料、被注入环境或模拟器；`backend/scripts/qa_device_profile.py` 未执行；`capture-adb-evidence.ps1` 因本机执行策略禁止运行脚本而未实跑，同等逻辑由 Python 工具在实机验证。

## 1.7.0 / 34 · 跨版本采集（2026-11-24）

- **构建**通过 Debug APK、78 项 Android JVM 单测、Lint、Go test/vet、52 项 Web 测试和 Web 生产构建。内网下载的 `com.sigmark.app` APK 版本为 1.7.0 / 34，签名与 1.6.0 一致。下载 SHA-256 为 `e0b29cdc3c0f6efd8af5e58ac0b5ed94fbfe30fa803dc1a5cb0821efc822d8db`。
- **安装与采集**使用独立测试包 `com.sigmark.app.qa`。Pixel 6 / Android 14（应用视角型号 `23078PND5G`）和 MI 8 / Android 10 均报告有电池。Pixel 样本报告 44 次电池循环，且仅有电话状态权限时成功取得默认数据卡「有服务」。Android 10 缺少公开循环次数接口，MI 8 上该字段为 `INTERFACE_UNSUPPORTED`。MI 8 的未授权样本将默认数据卡服务和订阅载波带宽标为 `PERMISSION_REQUIRED`；在正式 `com.sigmark.app` 1.7.0、电话状态与精确位置均已授权的复测中，两项均如实返回 `NOT_REPORTED`，没有用其他 SIM、注册小区或 ADB 读数填充。
- **上传、页面与导出**在独立临时 PostgreSQL 中验证。每部手机的两个不同采样归入同一测试资产，重送同一请求复用回执。360 px Chromium 搜索归档字段，检查状态、来源及下载 JSON。正式 LAN 更新后，数据库容器、卷与部署前可读的 4 份归档响应哈希匹配。
- **待验证** 真机成功返回订阅载波带宽、正式包手机内在线安装。当前 Pixel 样本为 `MODEM_NOT_REPORTED`，MI 8 全授权样本为 `NOT_REPORTED`，分别代表服务状态接口未给出有效载波列表；不是跨 ROM 固定值。普通 APK 仍按 Android 公共 API 和运行时权限工作，不依赖特定 ROM 分支。验收证据保存在 `app/build/lan-qa/portable-v16/`。

## 缺项与补充证据（2026-11-24）

- 两台已连接真机的 ADB 系统诊断显示 SELinux 均为 Enforcing。系统电池服务返回 MI 8 25.0 °C / 4164 mV，Pixel 6 27.0 °C / 4396 mV。MI 8 的 VBMeta 锁定属性未回报。记录在本机忽略目录 `app/build/lan-qa/coverage-evidence/`。
- 320 px Chrome 使用 MI 8 原报告和上述实机文件验证导入、坏文件提示、键盘展开和移除。App 原始拒读及另一次系统观察并列展示。检查期间浏览器只发 GET；部署沿用原 PostgreSQL 容器和卷。Web 48 项测试和生产构建、Python 2 项测试通过。

## 1.6.0 / 33 · 机器码与节点证据（2026-11-24）

- Pixel 6、MI 8 使用隔离 APK，各在普通应用进程连续采样两次。两个机器码分量均稳定；Pixel 6 重装隔离 APK 后两码仍匹配。两部相同配置可同码、ROM 输入变化只改变 ROM 分量、受限输入时暂停生成分量，均以合成夹具验证。
- 两台实机的 `possible` 和 `online` 均为 `0-7`。电池节点均为 `RESTRICTED / ACCESS_DENIED / errno=13`。Pixel 6 页面的本机重测草稿同时保存 `Runtime.availableProcessors=8` 和 `BatteryManager.EXTRA_TEMPERATURE=26.5 °C`，保留受限节点的空值。未将公开温度冒充节点返回。
- Pixel 6 走过生成机器码、重采与待上传列表，冻结草稿已核对但未发送。MI 8 的隔离 App 向临时 PostgreSQL 实际上传并核对字段来源、重试、同资产归档。320 px Chrome 验证机器码、ROM 输入变化、节点/API 对照和诊断 JSON 导出，浏览器数据为合成样本。
- Android 76 项单测、Debug 构建及 Lint，Go test/vet，Web 46 项单测与生产构建通过。内网发布 APK 下载哈希匹配且签名承接 1.5.0。数据库容器、卷与 3 份在库原报告已核对。未验收正式包的手机内升级、两台同型号实机、实际刷机前后变化或 ROM 服务。证据位于 `app/build/lan-qa/config-v15/`。

## 1.5.0 / 32 · GNSS 读数核对（2026-11-23）

- 用 1.4.1 的真实归档确认 Redmi 23076RA4BC 的原始值为 `2016`，来源为 Android GNSS 接口；新后台在 320 px 展开后按正确语义解释，无历史报告改写。三份在库报告的详情响应在部署前后逐份核对一致，PostgreSQL 容器和卷保留。
- Pixel 6 用隔离应用 ID 验证：无精确位置授权时为 `RESTRICTED / PERMISSION_REQUIRED`；授权后前台等待约 20 秒，本次两路未收到非空事件，记录 `not_seen`。型号年再次取得 2020。实际点按「更多工具 → GNSS 读数核对 → 开始前台实测 → 保存本机报告」，本地出现一份待上传；未发送到正式仓库。
- MI 8（Android 10）验证隔离包启动并完成 12 类标准采集；MIUI 拦截自动授予测试包权限，未在此机取得前台 GNSS 实测结果。Redmi 本轮仅复核历史报告，未进行新版开阔环境复测。API 30 单独天线接口已核对 SDK 签名，未在 Android 11 真机测试。
- Android Debug 和测试 APK、72 项单测与 Lint，Go test/vet，Web 46 项单测及生产构建通过。临时 PostgreSQL 用合成样本验证原始 0、状态/测量双回调正向、后续标准报告不覆盖该资产的 GNSS 回链；320 px 浏览器验证键盘展开、工作台结果和证据导出。真实非空 GNSS 回调仍待开阔处确认。
- 内网 1.5.0 同签名发布，实际下载与候选 APK 的 SHA-256 一致；从旧安装走设备安装器升级不在本轮验收内。本地测试证据在 `app/build/lan-qa/gnss-v14/`。

## 1.1.0 / 27 · 验收工作台（2026-11-23）

- 在 MI 8、Pixel 6 完成覆盖安装，仪器测试验证字段集 10 的两点网络数据和首帧测试。Pixel 6 实际走过「记录起点 → 系统网络设置 → 返回 → 记录终点 → 上传预览」；两次观察均为已验证的 Wi-Fi，未切换蜂窝，未提交真实报告。
- 临时 PostgreSQL 验证字段集 10、旧版接收、同资产和历史上限；390 px 浏览器验证字段筛选、键盘滚动、可切换基线和 JSON 导出。内网替换 API，保留原数据库。下载包 1.1.0 通过同签名升级元数据及实际下载 SHA-256 核对。

## 1.0.0 / 26 · ROM 验收大版本（2026-11-23）

- 构建 Debug、57 项 JVM 单测、Lint、仪器 APK、25 项 Web 单测、Web 生产包及 Go 单测/vet 通过。MI 8 和 Pixel 6 都覆盖安装 1.0.0，固定 H.264 首帧实测成功，并验证字段集 9 的采集、序列化与草稿读取。旧字段集 7 冻结请求及重试字节相同。
- Pixel 6 实际通过「选择验收方案 → ROM 验收 → 上传报告」打开本机列表，选中待上传项后核对预览提示与「确认上传」边界；检查草稿确认为字段集 9、ROM 方案、首帧通过、精确位置权限快照，且未发送。MI 8 跑了仪器测试，未操作手动点击链路。
- 独立 PostgreSQL 上传合成同资产样本，验证 7/8/9 字段集接收和字段版本边界。390 px Chrome 验证归档页、折叠键盘操作、同资产由通过变为未通过、精确到大致授权变化，以及下载 JSON。
- 内网只替换 API 容器；数据库容器与历史 MI 8 报告保持原样，读档对照校验通过（12 个分类、138 个字段）。字段词典线上验证返回 161 个固定字段。1.0.0 发布到 LAN 下载与更新源；确认包名、签名延续、版本 26、HEAD 尺寸与实际下载的 SHA-256。没有运行手机系统安装器的 OTA 全链路，没有把合成样本写入真实仓库。
- 两台手机仍未见系统回报已注册 LTE；没有用权限推断可用性。尚未验证实际刷机前后对照、移动网络切换、实体模拟器样本或独立硬件证明。原始证据在忽略目录 `app/build/lan-qa/acceptance100/`。

## 0.21.0 / 25 · 授权入口与 ROM 解码实测（2026-11-23）

- MI 8（Android 10）与 Pixel 6（Android 14）同签名覆盖安装。MI 8 原有电话和精确位置权限均允许，系统位置开启，但此次未提供活动订阅或注册小区；该状态不提示授权。Pixel 6 的电话状态未授权，仅卡槽服务状态需要处理；密钥、SELinux 与 Wi-Fi 不受该权限影响。
- Pixel 6 界面实测：首页「处理采集所需权限」→「授权电话状态」→ Android 原生权限弹窗；返回取消后显示「电话状态未授权，基础采集仍可使用」，没有修改授权。通过「更多工具 → 视频解码实测」看到了首帧成功及解码器。精确位置改授、系统位置开关往返和用户同意后的界面链路未在本轮真机操作中验证。
- MI 8 的 App 直接读到厂商声明补丁日期 `2020-12-01`，来源为 `getprop ro.vendor.build.security_patch`。Pixel 6 的 App 未得到该属性值，保留未上报。两台 App 读 SELinux 仍为 `EACCES / errno=13`。
- 同一固定样片在 MI 8 和 Pixel 6 都通过首帧解码。Android 分别选择 `OMX.qcom.video.decoder.avc` 和 `c2.exynos.h264.decoder`。此诊断仅检查默认解码器对内置样片的首个输出，不验收持续播放、画面一致性或其他编码。
- 样片来源：FFmpeg 本地生成的 `testsrc2` 测试图，AVC Baseline、320×180、15 fps、1 秒、无音频；SHA-256 为 `2c253574cb278fb3d537f9b17ae94a25a553daaafe05717a0b73843b91813b16`。用户文件未参与。
- 构建、JVM 单测、Android Lint、Go 单测以及两台真机仪器测试通过。使用配置好的 LAN 后端构建调试包，未写入真实报告仓库，下载发布版本保持 0.19.0。本次测试证据保存在忽略目录 `app/build/lan-qa/access021/`。

## 0.20.0 / 24 · 证据来源与硬件能力（2026-11-23）

- 保留 MI 8 的 0.18.1 / 字段集 7 归档基线。验证本机 APK 的签名与原安装一致，再覆盖安装 0.20.0（24）。未清除应用数据。
- Android 仪器测试在 MI 8 的应用进程运行采集器及 LAN 投影。连续两次采到 Vulkan 声明 1.1.0、前置和后置逻辑相机各 1 个（均 FULL）、按类型和唤醒能力汇总的传感器。SELinux 均为受限（errno=13）；单独执行的 ADB 观察为 Enforcing。
- 同一真机的独立临时草稿库验证：v7 草稿可重新打开、编辑和冻结。原字段集、采集器版本、请求 ID 与关联选择保留，重试字节一致。v8 草稿正常读取。仪器测试可复跑，使用 `assembleDebugAndroidTest` 构建测试 APK，然后对测试设备调用 `adb shell am instrument -w -r com.sigmark.app.test/com.sigmark.app.CapabilitySmoke`。
- 50 项 Android JVM 单测、24 项 Web 单测、Go 单测及 Web 生产构建通过。临时 PostgreSQL 验证字段集 8 收发、字段集 7 兼容及错报版本拒绝。已有虚拟声明、调试和回收站历史规则回归通过。
- 更新内网 API 服务，保留原数据库容器。在 Chrome 390 px 以现有 MI 8 归档和真实 ADB 文件验证了同屏对照、无效 JSON 提示、键盘滚动、移除文件及仅 GET 读档路径。
- MIUI 拒绝 ADB 模拟点击。手机端「整体获取 → 上传报告」的人工链路、模拟器实测和独立证明仍待验收。本轮没有用测试报告写入真实仓库。QA 日志与 ADB 文件位于忽略目录 `app/build/lan-qa/evidence020/`。

## 后台设备风险画像（2026-11-23）

- 在临时 PostgreSQL 17 + 候选 API 镜像中验证：同型号不同资产、未归组、回收站、采样/接收双时间条件、30 天边界、50/51 条截断、可判断分母、历史命中原报告、鉴权和错误返回。测试库与内网仓库完全分开。
- Chrome 390 px 合成回归覆盖错误重试、键盘展开、缺失与拒读差异、JSON 下载内容、跳转原报告再返回、未归组提示；既有 v6/v7 安全页回归通过。
- 仅替换内网 API 容器，数据库容器保持原实例，健康检查 ready。浏览器对一份现有 MI 8 归档只读复核，3 项标签均与服务响应一致。该报告此前有 5 份同资产样本：虚拟构建声明、进程调试均 0/5；SELinux 本次受限 errno=13，5 份历史无一可判断。不解释为准确率、实机认证或实时手机测试。

## 0.19.0 / 23 · 本机安全配置与特殊授权（2026-11-23）

- 成功运行 Android Debug 构建、46 个 JVM 单测及 Lint。用例包括：空证据与受限不判危险；启动线索冲突、有意解锁、红色启动；宽容模式、缺少安全锁屏和未启用加密；未来/无效补丁日期和 180/181 天边界；无障碍两种能力的交集；特殊授权不进入 LAN 白名单。
- Pixel 6 覆盖安装版本 0.19.0（23），打开「指纹安全」。本次快照页面为“优先处理 1、待核对 0、未确认 1”，优先项为当前用户未配置安全锁屏。该设备保持原配置；不从硬件型号或上述结果解释真假。
- 主动运行特殊授权检查后，当前用户可见无障碍服务及设备管理员列表均为空；印迹自身获准请求安装 APK 被列为「请核对」，没有判定恶意行为。真机上没有为了让测试变绿而授予/撤销权限；未测试有可读屏或手势服务的实际设备、硬件证明或真实攻击。MI 8 本版仍待人工复测。
- 本机忽略目录 app/build/lan-qa/posture019/ 保存构建日志、summary.xml、access.xml、access-lower.xml。未上传本次手机检查或删除仓库报告。

## 0.18.2 / 22 · 切网后上传原报告（2026-11-21）

- Android assembleDebug、41 个 JVM 单测及 lintDebug 通过。蜂窝权限分支覆盖 Android 10 已授权/未授权，合成样本覆盖先移动网络再 Wi-Fi 的网络标签与独立编号。
- Pixel 6（ADB）上的同源码独立测试包：关闭 Wi-Fi 后系统没有蜂窝默认路由，实际结果为「无默认网络」。在此状态主动采一份，恢复 Wi-Fi、重开 App 并采第二份，列表保留两份。单独选第一份，其时间、网络仍为首次采集值。
- 首次写入临时数据库后屏蔽成功回执，强停再启动，手动重试发送完全相同的字节并返回原报告编号。最终是临时库 1 份、手机另有 1 份待上传，正式报告库未写入测试样本。Wi-Fi 已恢复，临时包与端口映射已移除。真机还验证了指纹安全首屏。
- 真实蜂窝作为默认路由 → Wi-Fi 的场景仍待 MI 8 实测。复测时不要清数据；先确认首页「最近保存：移动网络」，再回 Wi-Fi，在「上传报告」按时间选原报告。旧版只在内存的未提交样本不作恢复承诺。

## 0.18.1 / 21 · 设备归组、整体获取和重试（2026-11-21，Asia/Shanghai）

- **构建与分发**：Android Debug、38 个 JVM 单测、Lint、Go 单测与 vet、22 个 Web 单测和生产构建通过。仅重新部署 API；保留 PostgreSQL。源码快照 9872b4a7bb2aa42bad5173f3cdcd72611088e7b39c5640dcc54cf8aa1720167f；实际下载 APK SHA-256 为 594b83e9f3abdd59bb138a3617e83450a4f84c13be0d358438a41d2abf3974c1，与本地构建一致，新旧签名一致。
- **正式内网包 / 连接的 Pixel 6**：从 0.18.0 点检查更新，下载并核对签名后由系统更新到 0.18.1（21），未卸载。整体获取 → 预览显示临时密钥保护 TEE，209 项本机 / 145 项归档 / 64 项仅本机。取消重开仍为同一采样时间；通过系统文件选择器保存 JSON，解析到 environment.keyProtection = AVAILABLE / TEE。没有向部署仓库上传验收数据。
- **端到端失回执 / 同一台手机**：使用同一冻结源码，仅更换测试包名和 LAN 目标，独立安装；通过 adb reverse 连接临时 PostgreSQL/API。确认前 0 报告；服务端存储后故意屏蔽首次成功回执，关窗、继续上传、重试得到最初的报告 ID；再看回执没有发出请求。新采样并确认上传后，库中共 1 部设备、2 份报告、0 未归组。测试包、端口映射及临时服务已移除。另以并发 API 夹具验证 4 次重试只落一份、冲突 409、改变关联意图的重放不产生空资产。
- **Web / 实库只读**：2 部已归组、5 份在库、0 未归组，其中 MI 8 为 3 份（最近两次采集相隔 8.270 秒）。390 px Chrome 从资产默认两行 → MI 8 三份采样 → 报告参数 → 原设备历史，通过。读数没有用于自动合并。合成浏览器回归通过全部 9 种宽度，三个返回路径的位置误差均为 0 px。
- **边界和复测**：未在 MI 8 上操作 0.18.1。请同后台地址覆盖升级，不清数据，勾选关联后提交一次新采样：在当前基线且无其他写入时，应见 MI 8 仍一行、3 → 4 份；查看回执不再新增。进程结束后草稿不恢复；重装或清数据后的资产归属须人工确认，不凭型号、指纹自动归并。证据保存在本机忽略目录 app/build/lan-qa/asset0181/，不纳入版本控制。

## 0.18.0 / 20 · ROM 安全证据（2026-11-21，Asia/Shanghai）

- **构建/分发**：Android Debug、36 个 JVM 单测、Lint（无错误）、Go 单测及 vet、22 个前端单测和 Web 生产构建通过。仅更新 LAN API 容器，保留原 PostgreSQL 卷；构建中心已登记 Android 源码快照。下载 APK SHA-256 `cef738a3ad9c0e13d38563e4bd5a0daef5b3dc57c90769c4f4d9e088483cfbae`，沿用原签名。实际查询 0.17.0/19 与 0.18.0/20 均有发布登记，未知版本无记录。
- **真机路径**：ADB 连接的 Pixel 6，应用观察型号为 23078PND5G、API 34。覆盖安装，打开「指纹安全」，看到未手测状态；主动生成临时密钥后报告 TEE，不是整机认证。采集到 5 个分区构建和 WebView 提供程序/版本。通过系统文档选择器导出本地 JSON 并解析；手测后上传预览为 209 项快照、145 项明细，未提交真实样本。另下载校验最终发布 APK，覆盖安装并再次运行自测确认 TEE。
- **后台路径**：在独立临时 PostgreSQL 和 API 中上传合成 v6、v7，核对详情、字段覆盖，并验证 v6 携带 v7 字段被拒。Chrome 390 px 合成响应回归验证签名匹配/不匹配/无记录、旧报告、分区依据展开和启动矛盾；原阅读器 9 个视口回归继续通过。本机测试证据在忽略目录 `app/build/lan-qa/security018/`。浏览器复现：按 [工作台回归环境](WORKSPACE-UI.md#复现阅读页回归)运行 `node backend/web/qa/security-v7.cjs`。
- **待验**：MI 8 本版在线升级与重采、API 35+ 的组件补丁实机、实际 StrongBox 返回、同一设备刷机前后对比均未在本轮验证。

## 报告阅读与小屏适配（2026-11-21，Asia/Shanghai）

- **实库只读核对**：在 390 px Chrome 窗口下，逐项比对详情 API 与网页。MI 8 为 12 类 / 126 项，23078PND5G 为 12 类 / 132 项。字段键、归档值（含 null）、来源、状态全部一致。本轮没有连接手机重新采集或安装，也没有将网页同手机本地未上传的字段逐项比对。
- **浏览器夹具**：在 320、390、760、891、944、945、1024、1440、1920 px 宽度均未出现整页横向溢出或参数列表内层纵向滚动。891×1003 的两份结果场景导航与内容间隙为 0 px；1024×720 下参数行宽 804 px。档案第二页（浏览器后退）、资产第二页（经单份安全分析返回）、设备采样加载更早记录后的焦点均回到原行，三项位置误差均为 0 px。
- 同一夹具还覆盖 12 类 / 126 项归档字段、错误码搜索、键盘展开依据、手机快照与归档计数、差异对比、空结果及无效编号、回收站和未找到报告。进行这些测试时，API 全部由响应夹具提供，未写入数据库；截图保存在本机忽略目录 `app/build/lan-qa/reader-focused/`。命令见[后台工作台](WORKSPACE-UI.md#复现阅读页回归)。
- 19 项 Web 单测、生产构建、Go 单测与 vet 通过。仅重建并更新内网 `api` 容器，未重建 PostgreSQL 或修改数据契约；发布通道仍为 Android 0.17.0（19）。

## 后台工作台重设计（2026-11-21，Asia/Shanghai）

- Web 六页共用导航和页头。Chrome 桌面 1440 px、883 px 和 360 px 验证入口与页面布局；另在 390 px 验证报告详情。窄屏检查导航 Escape 和焦点还原，无页面级横向溢出。
- 部署后的 PostgreSQL / HTTP 使用隔离合成批次，验证资产批量 ZIP、移入及恢复、设备采样深链接和后退、字段覆盖范围、历史分页和同机／跨设备复测。测试后只清理各自的合成数据，数据库卷和用户报告保留。
- 验证设置草稿放弃、当前 APK 信息、从构建列表打开自定义版本表单及发布确认。构建交互使用候选记录夹具，取消确认，未排队、编译或发布真实 APK。签名产物仍为 0.17.0 / 19；本轮未装机或重复用户的两台真机测试。
- 15 项前端单测、Web 生产构建、Go 测试与 vet 通过。截图在本机忽略目录 `app/build/lan-qa/workspace-unified/`，流程说明见 [后台工作台](WORKSPACE-UI.md)。

## 后台报告工作流（2026-11-21，Asia/Shanghai）

- **部署：** 重建 LAN API 镜像并就地更新服务；Web 生产构建和 14 项单测通过，Go 测试与 vet 通过。APK 仍为 0.17.0 / 19，本轮未重新构建或装机。
- **浏览器：** 使用桌面和 390 px Chrome 验收。档案首屏直达报告列表且不默认选中；管理、覆盖入口明确传递筛选，后退还原范围，顶栏导航打开默认视图；资产顶部保留全库统计，手机宽度下进入详情再返回可回到原列表。
- **合成数据：** 用 36 份报告、两条基线验证同资产优先但不自动选择，历史可搜索并翻到第 30 份之后，跨设备明确标注且不应用预期解锁。仅清理本次独立批次，未重置数据库。截图留在 `app/build/lan-qa/workspace-retest/`。
- **待体验：** MI 8 和另一台手机的真实报告联动、真机浏览器体验及实际刷机前后复测未在本轮验证。

## 0.17.0 资产首屏与复测准备（2026-11-20，Asia/Shanghai）

- **构建发布：** Go 单测/vet、前端 11 项单测和生产构建、Android Debug/单测/Lint/Release Manifest 通过。内网发布 0.17.0 / 19，签名沿用 0.16.1；公开下载 SHA-256 为 `129F341BF378A313FF5B6F33ABB5C230EB0EE6784AD6526E3362D3C0AEDB0F7`。
- **Pixel 6：** 从 0.16.1 通过 App 下载、校验、系统安装到 0.17.0；验证首页、更多工具和「复测准备」的采样时链路、授权区分及重新采集。读取了上传预览，未提交真机样本。本地导出经系统文件选择器保存，解析出 12 类、198 个字段，采集器标记 0.17.0。
- **后台：** 桌面、883 px 和 390 px 检查；高级筛选 Esc 取消并恢复焦点、应用及清除条件、仓库统计与分布、字段覆盖联动、直接安全分析与两份对比均通过。独立合成批次验证基线默认网络条件不匹配、刷新及 JSON 导出，以及移除基线保留报告。测试批次已清理。
- **待验收：** MI 8 覆盖升级和新首页；两部真实手机的同机刷机前后复测、实际蜂窝接管。当前只把报告默认网络同预期比较，不存储实时权限或验证公网联通。

## 报告阅读与命名回归基线（2026-11-20，Asia/Shanghai）

- 桌面和 390 px 浏览器验收：由报告深链接保存基线，带条件选新样本，刷新后保留复测，对比导出含缺项统计和原始证据；跨设备不会应用预期解锁。报告列表返回与浏览器后退保留上下文，无效链接显示提示。仓库总览和 883/390 px 的筛选、导出等回归通过。
- PostgreSQL/HTTP 用隔离合成批次验证同名拒绝、移入回收站时暂停使用、恢复后可复用、删除基线不删除原报告。测试后清理本批记录和引用，未重置原库。
- Android 复核构建和单测命令，APK 未变化，也未在本轮重装。真实设备刷机前后样本回归尚待验收。

## 仓库总览与安全对比（2026-11-20，Asia/Shanghai）

- Chrome 用独立合成批次验收顶部统计刷新及 JSON、分类筛选连到报告与覆盖页、回收站入口、按设备查看历史报告。桌面、883 px、390 px 检查通过。PostgreSQL 集成测试确认全库设备去重和跨版本分布口径，测试后仅清理合成批次。
- 验证报告行直接打开安全分析，勾选两份可直达对比。验证同设备、跨设备、字段集不同、补丁日期倒退、调试器连接变化及预期解锁，刷新保留对比条件。当资产不同或未归组时，不允许将解锁标成预期变化。默认报告详情及 ZIP 不新增资产标识。
- 前端 9 项单测与生产构建、Go 单测/vet 和 PostgreSQL 17 集成检查通过。本轮只更新内网后台，Android 仍为已发布的 0.16.1，构建和单测命令复核通过，未重新安装。

## 0.16.1 指纹安全和设备采样时间线（2026-11-20，Asia/Shanghai）

- 发布 0.16.1 / versionCode 18。APK SHA-256 为 `4C1C0926D5FB1E982FADD6043BD3FA61E011C15583F1C875D094F5DE8AA87101`，公开下载和登记产物一致，签名延续上一版。
- Pixel 6 经 App 在线更新从 0.15.0 安装 0.16.0，再用同签名构建产物覆盖到 0.16.1。验证指纹安全面板渲染启动依据，已读到的属性不再显示缺失说明。SELinux 受限时仍标为未确认；本地导出 JSON 验证版本号和两项保护状态。检查了上传预览，未提交该真机报告。
- Chrome 桌面及 390 px 验证：资产统计在顶部、同设备两份 ROM 样本由时间线直达原有对比、字段覆盖保留；指纹安全可切换样本，验收锁定/解锁线索、保护状态、SELinux 受限与旧协议仅状态。只写入并清理了独立合成批次，原卷和报告保留。测试完成时仓库显示 2 个已归组设备和 2 份在库报告。
- Android Debug 构建和单测、Lint、Release Manifest、Go 单测/vet、前端单测与构建通过。用户两部手机使用 0.16.1 的升级及新字段上报、硬件真实性认证仍未验收；当前版本没有接入硬件认证。

## 0.15.0 设备资产归组（2026-11-20，Asia/Shanghai）

- 独立 Compose/PostgreSQL 使用合成报告验证：同一安装并发上传两次只产生一个设备资产、重试沿用回执、两台同型号模拟设备分开、没勾选和旧版报告保持未归组。校验报告详情不含样本安装标记；混入已归组报告时手动归组整批回滚。
- Chrome 桌面与 390 px 验证：历史报告归到现有设备，来自同一手机的新安装资产可确认合并，随后上传沿用目标设备。最终 7 份合成报告归在 2 个资产下，字段覆盖仍统计 7 份报告。原业务卷未用于该测试。
- Android Debug APK、单测、Lint、Release Manifest、Go 单测/vet、前端测试与构建通过。内网发布 0.15.0 / 16，签名与上一版匹配，下载文件 SHA-256 为 `8D830236513ECCD8747B00BFAEAE6F87CF2FB10C16BB738D2446ABE698339464`。本轮 ADB 未发现连接手机，安装、真实上传选项和 MI 8 在线更新待复测。

## 0.14.0 后台补充：顶部分类与仓库统计（2026-11-20，Asia/Shanghai）

- Chrome 1440 px 和 390 px 验证分类与搜索在档案顶部、筛选跳转统计、字段集切换、原因展开及统计 JSON 导出。窄屏仅覆盖表内部横向滚动。
- PostgreSQL 17 的独立临时表集成测试及内网合成批次通过。同提交 UUID 的跨批次副本和同内容不同 UUID 的副本均被合并；改变采样时间的独立报告保留。内网用 6 条在库合成记录得到 4 份统计样本，另有 1 条回收站不参与统计。历史仅状态与确实未归档能分开计数。测试后仅移除合成记录，生产卷未重建。
- Go 单测、vet、前端单测及生产构建通过。Android Debug 构建和单测命令复核通过；本次未改 APK，已发布版本和签名仍为 0.14.0 / 15，无需重新安装。

## 0.14.0 分类、批量导出和链路时间线（2026-11-20，Asia/Shanghai）

- **构建与发布：** Debug APK、30 项 Android 单测、Lint、Release Manifest 检查、Go 单测与 vet、前端单测与构建通过。局域网发布 0.14.0（versionCode 15），签名证书与 0.13.0 相同。公开下载 APK SHA-256：`A9557E46EEE777A7984694943B9664770F74547C67B236874D8FCBA14698184B`。
- **安装与页面：** Pixel 6 / Android 14 从 0.13.0 通过 App 检查、下载并交给系统安装器完成覆盖升级。打开 0.14.0 后，用户授权路径可用；同一真机样本显示默认数据卡槽 1、卡槽 1 有服务。已恢复测试前的电话和安装来源权限设置。
- **导出：** 在应用前台暂停并恢复 Wi‑Fi，界面和导出的本地时间线 JSON 一致：Wi‑Fi 已验证 → 未见默认网络 → Wi‑Fi 未验证 → Wi‑Fi 已验证。该次未观测到蜂窝成为默认链路，不将离线间隙解释为蜂窝切换。
- **后台：** Chrome 桌面及 390 px 验证组合筛选及从档案跳转资产。独立合成批次验证历史未记录项、分页、搜索、跨设备代号的基线对比、2 份勾选 ZIP、32 份跨页 ZIP 和回收站 ZIP；逐份解包核对归档内容与清单。测试后仅移除该批次合成报告，原 PostgreSQL 卷保留。
- **待验证：** MI 8 / Android 10 的覆盖升级、新版上传、双卡同时有服务和 Wi‑Fi → 蜂窝的实际接管。Pixel 仅查看真实报告上传预览，本轮未向后台上传真机样本。

## 0.13.0 源码快照、在线更新和 MI 8 网络报告（2026-11-20，Asia/Shanghai）

- 冻结并登记当前 Android 工作区源码，同时保留 0.6.0 Git 基线。新快照走在线队列构建、单测、Lint、校验和发布，下载版本为 0.13.0 / versionCode 14。下载文件与发布元数据 SHA-256 一致：`EE34279FB230AB14CFF8D85ABAEE68DD8CDF92D35644F1791FE21E86DCBD7717`。
- Chrome 在构建中心以默认选中的 0.13.0 快照提交自定义版本 `0.13.51 / 51`。工作进程构建成功，鉴权下载的 APK SHA-256 与任务记录一致；测试包未替换公开版本。
- Pixel 6 通过 0.12.0 的 App 内检查更新下载并覆盖安装 0.13.0，重新启动并完成本地 JSON 导出。该次样本显示默认 Wi-Fi、卡槽 1 就绪、蜂窝数据未连接，但可读取 LTE 注册；这些观察值分开报告。
- 生产后台收到用户 MI 8 / Android 10 的 0.13.0 报告（字段集 4，122 项）。确认 Wi-Fi 默认路由、Wi-Fi 与蜂窝链路并存，卡槽 1 就绪、卡槽 2 未检测到 SIM、蜂窝数据已连接、LTE 已注册。LTE 信道带宽仍为 `UNAVAILABLE / MODEM_NOT_REPORTED`。只有归档证据，未直接观察 MI 8 的安装界面。
- Android 29 项单测、Debug 构建、Lint、Go test/vet 和 Web 构建通过。验证材料在忽略目录 `app/build/lan-qa/v013/`。

## 0.12.0 自动刷新、构建配置和更新兼容（2026-11-20，Asia/Shanghai）

- Chrome 在独立合成批次验证报告首页自动刷新、资产勾选时暂停及取消后恢复，测试覆盖桌面和 390 px。设置页独立保存浏览器刷新频率，未修改生产接收批次。
- 工作进程跑通在线构建历史源码（指定任务名称并执行单测和 Lint），已验证下载单个构建及阻止旧内部版本号发布。另用当前工作树的 Gradle 参数编译 `0.12.42 / 42`，用 aapt 和 BuildConfig 核对。网页自定义版本需先登记包含该构建契约的 Git 提交。
- Pixel 6 通过原 0.11.0 的检查更新流程完成 0.12.0 安装、启动和本地 JSON 导出；系统未提供实测电池能量，本机粗估显示 21.33 Wh。订阅载波带宽在本次样本未获得，SELinux 节点仍为受限。MI 8 尚未连接，缺证书的 ROM 分支走单测，现场兼容性待复测。
- Android 28 项单测、Lint、Go test/vet、Web 单测和生产构建通过。已发布 APK，下载与本地 SHA-256 一致：`D0804A7D2F13429A28FF218A8BDD2DDFB161A8C243F4745DCDAA62140A94A149`。证据位于忽略目录 `app/build/lan-qa/v012/`。

## 0.11.0 资产工作台与缺项诊断（2026-11-20，Asia/Shanghai）

- 核对生产后台 MI 8 / Android 10 的 0.10.0 归档：119 个字段，2 项受限、8 项暂无数据；该报告的 `BASE_OS` 为空，`systemDebuggable` 有旧来源读数。历史数据保持原样。
- 已连接 Pixel 6 完成覆盖安装、启动和本地 JSON 导出；0.11.0 按 `Build.TYPE / Build.TAGS` 得到应用视角的 `user / release-keys`。剩余能量为接口未提供、LTE 带宽为调制解调器未上报、BASE_OS 和 SELinux 参考属性为可选未提供。SELinux 节点仍是 EACCES / 13。
- 真机在独立测试后台上传并按回执读回，保留 125 项明细及 `schemaVersion=4`、`collectorVersion=0.11.0`、`fieldSetVersion=2`。Chrome 在桌面和 390 px 验证资产勾选、回收与恢复、直达报告、覆盖和参数视图、跨版本未记录筛选。真实报告未参与资产变更测试。MI 8 的新版采集待验证。
- Android 26 项单测、Lint、Go test/vet、Web 单测和生产构建通过。已发布测试 APK，下载和本地 SHA-256 一致：`990679D204A170BBBFEF50F208D4B0269B0080F091CA3FF5A908EF99BCC2EAE2`。证据位于忽略目录 `app/build/lan-qa/v011/`。

## 0.10.0 资产管理与归档覆盖（2026-11-20，Asia/Shanghai）

- Pixel 6 / Android 14 完成覆盖安装、启动和本地 JSON 导出。手机快照有 12 类、192 项，其中 180 项可用、2 项受限、10 项暂无数据。
- 在独立测试后台验证 App 预览、确认上传、回执、数据库归档、网页状态筛选及网页 JSON 下载。归档明细共 125 项，其中 2 项受限、6 项暂无数据。手机快照的分类计数完整读回。剩余能量、基础系统版本等缺值以结构化状态保留。浏览器下载的 JSON 与详情 API 返回相同。
- Chrome 检查桌面和 390 px 布局。报告档案仅提供查看操作。资产管理通过移入回收站及恢复复测。生产后台的 MI 8 / 0.9.1 历史报告可读，保留原有 71 项明细。MI 8 升至 0.10.0 后的快照和上报待复测。
- Android 23 项单测、Debug 构建、Lint、Go test/vet、Web 单测与生产构建通过。APK SHA-256 为 `ECFA05AD0428FE0295E0B82008434FF23643F056AC80418C3B278A0C7DBAF57D`。证据保存在忽略目录 `app/build/lan-qa/v010/`。

## 0.9.1 档案管理、App 内更新和网络回退（2026-11-20，Asia/Shanghai）

- 归档中的 MI 8 / Android 10 / 0.8.0 共 69 个上传字段。63 项可用，2 项 SELinux 节点受限，启动及构建 SELinux 属性、MTU 和 LTE 带宽共 4 项暂无数据。
- 在已连接的 Pixel 6 / Android 14 上，从 0.9.0 打开「检查更新」，发现 0.9.1 并下载。APK 校验通过，经 Android 系统界面确认覆盖安装。安装结果为 versionCode 10，重新启动并完成本地导出。网络接口回退取得 MTU 1500 字节。LTE 带宽本机仍未回报。ADB 系统侧记录读出 Enforcing，App 按自身来源保留节点受限。MI 8 的 0.9.1 回退和更新待实机验证。
- Chrome 使用独立合成批次跑通单份移动、恢复、批量移动、批量永久删除以及状态冲突回滚。既有 MI 8 报告可查询和按状态筛选，验证包括 390 px 页面。Go test、vet、Web 测试及生产构建通过。
- Android 22 项单测、Debug 构建及 Lint 通过，已发布到内网下载页。验证证据位于忽略目录 `app/build/lan-qa/v09/`。

## 0.8.0 普通应用诊断（2026-11-20，Asia/Shanghai）

- Debug APK 构建、21 项 Android 单测、Lint 和 Release 合并清单检查通过。Go 单测通过。APK 通过签名校验，免登录下载的 SHA-256 与构建产物相同，值为 `8AC3C65F0D7E220A6C60F89CB263F9A437865C320C12F202F3D2E970C3EE9502`。
- Pixel 6 / Android 14（ADB 代号 `oriole`）覆盖安装并启动。首页显示 12 类、192 项。实时面板收到加速度 XYZ 读数，切到后台后通过 SensorService 观察到注销。可见应用面板展示了所选应用的声明权限及授权状态。
- 通过系统文件选择器保存本地 JSON，读回 179 项可用、2 项受限、11 项暂无数据。系统特性、窗口边距、相机计数、存储加密和配置摘要可读。剩余能量暂无数据。SELinux 进程域可读，`enforce` 及 `policy` 均为 `RESTRICTED / ACCESS_DENIED / errno=13`。
- 内网上传预览实际展示 76 项白名单参数。单测断言本地诊断字段排除在上传投影之外。本轮验证止于上传预览，其他手机和厂商 ROM 待复测。
- APK 校验文件、界面记录及本地报告位于忽略目录 `app/build/lan-qa/diagnostics-v08/`。

## 0.7.0 · 会话、构建中心与公开下载（2026-11-20，Asia/Shanghai）

- 构建通过 `assembleDebug`、15 项 Android 单测、`lintDebug` 和 Release 合并清单检查。内网 Debug APK 签名校验通过，经免登录 HTTP 下载后 SHA-256 与本地产物一致，值为 `5441A05464AB86BEEC7348DC2145B766F2DE2076963F40304ECF7188D8CA4711`。
- 下载的 APK 已覆盖安装到 Pixel 6 / Android 14（ADB 设备代号 `oriole`）。App 页面和系统文件选择器导出的 JSON 均记录 8 类、125 项。主机验证了本地 JSON 的结构及新增字段。App 视角得到 IPv4 默认路由和专用 DNS 未启用。显式 MTU 暂无数据。SELinux 的 enforce 和 policy 均为 `RESTRICTED / ACCESS_DENIED`、`errno=13`。
- 手机在预览中确认后收到上传回执，从档案 API 按编号读回 76 项白名单参数。Chrome 验证了登录刷新、锁定与服务端会话注销、设置持久化、暂停时返回 `uploads_paused`、浏览器返回导航、APK 下载和报告 JSON 下载。设置已恢复测试前的值。桌面及 390 px 下检查布局。
- 在网页排队构建已登记的 `9923b70f`，Windows 工作进程成功生成并校验 0.6.0 APK。当前下载页仍发布本地构建并单独导入的 0.7.0。Go 测试、vet、Web 三项单测及生产构建通过。
- 第二台手机、Linux 构建主机与公网 HTTPS 环境待验证。浏览器、手机页面和 JSON 证据保存在忽略目录 `app/build/lan-qa/console-v07/`。

## 0.6.0：报告档案库与普通应用读取（2026-11-20，Asia/Shanghai）

- Debug 构建、Lint、14 项 Android 单测通过；已升级安装到 Pixel 6 / Android 14 并冷启动。APK SHA-256：`A6351782769CB5648675CD648C78170F5E14975582B4D3FBE599DC64B56722A1`。
- App 启动与本地 JSON 导出：`enforce` 和 `policy` 均保持 `RESTRICTED / ACCESS_DENIED`、`errno=13`。ENOENT、ENODEV 与其他 errno 走主机单测。已验证本机 CPU 频率与 Swap 仍可读；HDR、估算尺寸和 ROM 属性均有应用视角读数。未验证所有厂商 ROM 或底层阻塞驱动。
- 手机确认上传后，后台保存并读回 68 项白名单参数。Chrome 验证 favicon、报告检索、参数搜 `errno=13`、基线对比、JSON 下载及 390 px 移动布局，无页面级横向溢出。Go 测试/vet、Web 3 项单测与生产构建通过。
- 临时插入 127 条接收时间为 90 天前且时间戳相同的合成报告。按构建号搜索时，列表无重漏、统计为 127、详情可读；随后只清除了该合成批次。保留已有 PostgreSQL 卷；未配置自动备份或验证恢复。截图及本地报告放在忽略目录 `app/build/archive-v06/`。

## 0.5.0：SELinux 状态与参数管理台（2026-11-20，Asia/Shanghai）

- Debug 构建、Lint、13 项 Android 单测通过；已覆盖安装到 Pixel 6 / Android 14 并冷启动。APK SHA-256：`01F3EDE467D81F0C28B9E18C7E7A4155D857FCCC2BF1D13A4DCCF7601544C014`。
- App 视角：`enforce` 与 `policy` 均为 EACCES / 13，启动和构建属性未返回可识别的值。实时模式依旧未确认。ENOENT、其他 errno、标准 0/1 和非法值走主机单测，本机未出现这些分支。真机本地导出仍为 schema 1，含结构化 `errno: 13`、来源和空状态值。
- 真机确认上传后，服务端收存 schema 2 的 64 个白名单参数。读回验证 Wi-Fi 2462 MHz、RAM 12.00 GiB、LTE 信号及 SELinux errno。上报不含构建指纹、运营商或精确小区频点。Chrome 验证详情、按值搜索、仅看待确认及旧版报告说明；Go 单测和 vet、Web 构建通过。
- 单独批次写入 127 条同时间戳的合成报告，经部署 API 读出 30/30/30/30/7 条，无重复或遗漏。测试后仅清除该合成批次。既有报告及 30 天保留策略不变。原始证据留在忽略目录 `app/build/lan-v05/`。

## 0.4.0：单地址直传与移动网络（2026-11-20，Asia/Shanghai）

- **构建与装机**：Debug 预设同一局域网后台地址，构建、10 项单测和 Lint 通过；Release 合并清单仍无 `INTERNET`。Pixel 6 / Android 14 覆盖安装并冷启动。Debug SHA-256：`AA6BF13E7534B0453F11824627F56F0F83B80E3B703F08AA29EC2F1AE9ECF2DD`。
- **单地址直传**：同一局域网地址服务管理台和上报 API。用 Chrome 复测错误/正确令牌、筛选、详情和锁定；未授权 API 返回 401 且无浏览器账号密码弹框，旧邀请码接口返回 404。手机预览只有反馈输入，确认前没有写入，确认后回执与 PostgreSQL 记录匹配；旧批次报告保留。
- **无线复测**：已有精确位置授权下，手动刷新收到公开接口回调。经本地 JSON 验证可读 LTE B3、标准下行范围 1805–1880 MHz、RSRP/RSRQ/RSSNR，并且移动数据开关为开启；系统未上报 EARFCN 和信道带宽，所以精确参考频率仍为空，统一标为 `UNAVAILABLE / NOT_REPORTED`。SELinux 仍是 `RESTRICTED / ACCESS_DENIED` (`errno=13`)。
- 本次未验证 5G、其他 ROM 或公网部署。真机回归材料留在忽略目录 `app/build/lan-v04/`。

## 0.3.0：手机 → 内网后台（2026-11-20，Asia/Shanghai）

- **编译**：Debug、未签名 Release、Lint 均构建成功，9 项 Android 单测通过。检查 Release APK 权限清单，不含 `INTERNET`。Debug SHA-256：`923E28F2703860D4F637117421AF6EBC2CB67A25F58D5126B3319C508A8B866E`。
- **设备**：Pixel 6 / Android 14 覆盖安装并冷启动；未修改已有精确位置授权。已授权情况下取得 LTE 频段和信号；系统没有返回 EARFCN、参考频率所需输入或带宽，保持 `UNAVAILABLE / NOT_REPORTED`。完整本地 JSON 通过系统文件选择器保存后解析验证；仍为 8 类、`schemaVersion: 1`。
- **同 Wi‑Fi 上报**：向局域网采集端输入邀请码，预览前后数据库均无该批次记录；确认发送后 App 显示收件编号，已从管理端查询到 1 份报告和 6 项精选字段状态。通过管理端确认报告没有原始指纹、运营商或精确频点。
- **服务端与浏览器**：Go 测试、`go vet` 和 Web 构建通过；PostgreSQL readiness 正常；实测 401（缺少邀请码）、400（未知字段）、同内容幂等、409（同请求编号不同内容），采集端访问管理路由返回 404。Chrome 验证管理台加载、批次筛选、报告明细及邀请码签发。API 重建后原报告仍可读取。
- **范围**：本机和单台 Android 真机已联调；未验证公网、正式 HTTPS/SSO、USB 转发、备份恢复或多设备并发。原始验证产物留在 `app/build/lan-qa/`，不提交。

## 0.2.0：网络诊断复测（2026-11-20，Asia/Shanghai）

- **构建**：`assembleDebug`、`testDebugUnitTest`（7 项通过）、`lintDebug` 成功；Lint 仍有已有的工具链、目标版本及资源警告。APK SHA-256：`D799F0B6BE228CD9C5E29B20AE018A3AD217895CD01F42F86E69FAA12A6B939D`。
- **安装与启动**：Pixel 6 / Android 14，通过 `adb install -r` 覆盖安装 0.2.0，冷启动成功。没有切换设备网络或更改系统位置开关。
- **页面**：默认网络为 Wi-Fi。实测读取 2462 MHz / 2.4 GHz 信道 11、RSSI −45 dBm、Wi-Fi 6 及协商收发速率。移动网络页面在默认走 Wi-Fi 时仍展示已注册运营商、LTE 制式和信号等级，并标明蜂窝数据未连接。小区参数授权说明和 Android 权限弹窗均已出现；退出后保留原有未授权状态。
- **导出**：通过系统保存页生成 JSON 并解析验证：`schemaVersion: 1`，8 类、104 项，102 项可用、2 项受限。`system.selinux` 为 `ACCESS_DENIED`（`EACCES`）；`cellular.cellDiagnostics` 为 `PERMISSION_REQUIRED`。APK 无 `INTERNET` 权限；已核对导出的网络字段中没有 SSID/BSSID、IP 或小区 ID。
- **待验证**：精确位置授权后 LTE/NR 小区数据、纯蜂窝默认路由、双卡/漫游、Wi-Fi 6 GHz、VPN 和不同厂商 ROM；信道/参考频率换算通过主机单测，不等同于这些真机分支已验证。

原始采集与回归材料留在本机 `app/build/network-qa/`，不提交仓库。

## 0.1.0 基线

记录日期：2026-11-20（Asia/Shanghai）。测试设备由 ADB 报告为 Pixel 6 / `oriole`，Android 14 / API 34。该设备应用进程读取的型号与 ADB 属性不同，因此本记录将两者区分。

## 已观察到的限制

| 字段 | 应用身份下现象 | 处理 |
| --- | --- | --- |
| `/proc/version` | Permission denied | 改用公开的 `Os.uname()` 获取内核名、release、编译版本与架构；语义标注为“内核编译信息” |
| `/sys/fs/selinux/enforce` | Permission denied | 保留 `RESTRICTED`，明确说明这不是 SELinux 模式结论 |
| `/proc/cpuinfo` | 可读，但无 `Hardware` / `model name` | 解析 `CPU implementer`、`CPU part`、`CPU architecture` 等现有字段作为 CPU 描述 |
| `Build.MODEL` 等 | App 显示 `23078PND5G` / `corot`，ADB 显示 `Pixel 6` / `oriole` | UI 与文档标记为“应用进程视角”，报告保留原始值 |

初版现场报告（改动前）为 7 类、82 项：79 可用、2 受限、1 不可用。以上仅是现场观察，不代表所有 Android 机型。

本次修订后再次安装并导出：7 类、86 项，85 项可用、1 项受限（SELinux 模式）。内核编译信息、CPU 描述与指令特性、首核最高频率、低内存阈值及电池电流均有值。导出前提醒与系统保存界面已实际验证；调试版单元测试为 4/4 通过。该结果只代表当前连接设备及其应用进程视角。

后续用 `Os.open()` 直接验证 SELinux 节点仍返回 `errno=13`（`EACCES`）。这进一步确认本机普通应用上下文的限制，不改变其 `RESTRICTED` 语义。此轮界面更新后的再次构建/安装和截图验证记录应单独核对，不沿用前次 APK 哈希。

本轮新版界面与图标再次安装后，已验证：首屏显示摘要、刷新/导出、搜索和分类；“待确认”入口能直接筛出 SELinux 限制项；导出前确认弹窗与系统保存页正常。最终导出的 JSON 为 7 类、86 项，85 项 `AVAILABLE`、1 项 `RESTRICTED`，后者附 `errno=13`。复测使用 Debug APK；截图和 JSON 保留在本机 `app/build/`，不进入 Git。

## 复测步骤

```powershell
.\gradlew.bat :app:assembleDebug :app:testDebugUnitTest
adb devices -l
adb install -r .\app\build\outputs\apk\debug\app-debug.apk
adb shell am start -n com.sigmark.app/.MainActivity
```

在手机上检查：

1. 首页采集完成、分类和搜索可用，返回桌面再进入仍可刷新。
2. “查看受限 / 待确认”可定位异常项；点按普通字段可查看来源。
3. 内核编译信息与 CPU 描述有值；SELinux 模式若受限应显示原因，而非猜测值。
4. 导出前有内容提醒；通过系统文件选择器保存 JSON 后核验 `schemaVersion`、状态、来源和内容。
5. 用 `adb logcat` 排查启动或导出异常；使用不同 Android 版本与厂商 ROM 重复验证。

报告含设备识别信息，真机 JSON 和截图只保留在本地构建目录，默认不提交仓库。

## 1.4.1 综合验收补充

- App 更新页从 PackageManager 取实际已安装的版本；按 versionCode 判定是否更新，包名、版本、签名及下载哈希核验继续保留。
- 真机 App 上报可用 `python -B backend/scripts/qa_android_upload.py --serial <USB设备> --image <已构建镜像>` 验收。需先在这台设备安装签名一致的 Debug APK 和 instrumentation APK；脚本使用临时反向端口、独立测试 SQLite 文件及临时 PostgreSQL，不写正式报告。检查两次实际 HTTP 上报、重试使用同一回执及新采样正确归组。
- Pixel 6 实机观察到 1.4.1 查询与发布版一致；从 App 进程通过隔离服务上报两份不同采样（首份 157 项），同一请求重试不重复入库，两份结果正确归组。新 Android 14 测试机（23076RA4BC）手动安装 1.4.0 后，首页显示 12 类、206 项，其中 193 项有值。该 ROM 拦截主机模拟点击，查验主页不代表完成了真机在线安装。
- 当前仅实现内网上报。整体验收仍需实体 OTG 的正向数量变化、独立预标注设备的校准集、硬件挑战验证、远程 HTTPS/独立上报身份与完整字段适用性审计。
