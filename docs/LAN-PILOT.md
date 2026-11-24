# SigMark · 内网报告工作区

## 连接方式

1. 在 `backend/` 将 `.env.example` 复制为 `.env`，填写独立随机的 URL 安全 `DB_PASSWORD`、仅用于管理端的 `ADMIN_TOKEN`、测试电脑的私有 IPv4 `LAN_BIND`。可选 `LAN_PORT` 默认 48272、`LAN_BATCH` 默认 `lan-direct`。真实配置不进 Git，不构建到 APK。
2. 在 `backend/` 执行 `docker compose up --build -d`。同一局域网访问 `http://<LAN_BIND>:<LAN_PORT>/`，用管理令牌登录。管理页面和手机 API 同源，数据库只在容器网络中监听。登录签发 7 天 HttpOnly / SameSite=Strict Cookie，服务端将会话摘要保存到 PostgreSQL。刷新页面可恢复会话，锁定会注销当前会话，修改管理令牌会使现有会话失效。
3. 第二台手机连接同一 Wi-Fi 后访问 `http://<LAN_BIND>:<LAN_PORT>/#downloads`，使用「下载 APK」安装当前内网 Debug 版本，无需管理令牌。首页点「整体获取」保存本次报告；连回内网后，点「上传报告」→ 按采集时的网络和时间选择 →「确认上传」。上传页不会重新采集。后台可按「设置」中的接收批次找到报告。地址变化时，需更新 `LAN_BIND` 并重新编译及发布 APK。
4. 可独立选择「授权查看小区无线参数」；拒绝或仅授予大致位置不影响 Wi-Fi、基础运营商信息或报告上传；手机端的授权不触发上传。Release APK 仍仅本地采集与导出。

内网试验使用未加密的 HTTP。防火墙应限定在测试网络。上报协议头用于识别客户端协议，同一内网的客户端仍可能伪造报告。读取档案需管理会话或 Bearer 令牌。

## 接口与维护

- `GET /readyz` 检查 PostgreSQL 连通。报告保存在 PostgreSQL 命名卷，**不按时间自动删除**，包括旧版仍存在的数据。已被旧版清理的记录不会复原。列表每页 30 条，无总数上限；汇总覆盖所有匹配报告。
- `POST /api/v1/reports` 支持最大 128 KiB JSON、应用协议头、限流、字段白名单及批次 + UUID 幂等。「设置」可以存储新报告批次并暂停接收。历史报告仍留在各自的批次。暂停时返回 `503 uploads_paused`，手机仍可导出本地报告。首次保存前的默认批次取自 `LAN_BATCH`。
- 管理接口支持浏览器会话和 `Authorization: Bearer <token>`。管理端写请求还需 `X-SigMark-Admin: 1`。列表 `GET /api/admin/reports?batch=…&q=…&before=…` 返回 `{items,nextCursor}`，列表与统计均支持批次和文本搜索（型号、构建/ROM 线索、API、App 版本、网络或 ID）。首请求省略 `before`，后续透传服务端游标。报告值通过 `GET /api/admin/reports/{id}` 获取，汇总用 `/api/admin/summary?batch=…&q=…`。
- 0.5 上传 `schemaVersion: 2`，包含各类白名单参数的实测值或空值，以及来源、状态、原因、说明和适用的 errno。包含实际 Wi-Fi 主链路频率/信道、信号、内存与电池等；不发送完整快照、运营商、精确小区频点/信道、小区标识或位置。旧版报告兼容，但仅能查看原来保存的状态，需用新版重新上传才有具体值。
- 0.10 使用 `schemaVersion: 3`。归档白名单增加电池能量与电荷、窗口边距、运行时、媒体能力、环境和应用调试字段。归档行保留 `null` 状态值、来源、原因和适用的 errno。新增 `coverage` 数组记录手机各分类的可用、受限、暂无数据和异常计数。网页据此显示手机快照及其中仅本机项的范围。配置摘要、构建指纹、安装来源及权限、地区与时区、运营商、精确小区信道和频点继续留在手机。安装应用清单和传感器实时值各自在面板内查看。详见 [采集字段说明](FRAMEWORK-DIAGNOSTICS.md)。
- v1/v2 按历史提交的粒度呈现。新版上线后，用同一手机重新采集并上传以取得扩展明细。
- 0.11 使用 `schemaVersion: 4`、`collectorVersion` 和 `fieldSetVersion: 2`。v1–v3 仍保留原值。字段键缺失表示归档未记录；字段键存在且值为 `null` 时，用 `status` 和 `reason` 说明原因。
- 用 `docker compose ps` 查看状态，`docker compose stop` 停机并保留报告。升级保留现有 PostgreSQL 卷及原 DB 密码，避免 `docker compose down -v`。使用 `go test ./...`、`go vet ./...`（`backend/`）及 `npm ci`、`npm test`、`npm run build`（`backend/web/`）复测。
- 仓库统计的数据库集成测试：为测试 PostgreSQL 17 实例设置 `SIGMARK_TEST_DATABASE_URL`，在 `backend/` 执行 `go test -run '^TestRepositoryStatsPostgres$' -count=1 ./cmd/sigmark`。测试只使用该连接的临时表；未配置时跳过。优先使用独立测试实例。

### 设备档案读取契约

字段集 20 的 224 个静态上传键以共享测试清单 `app/src/test/resources/lan-projection-v20.txt` 锁定。Kotlin 测实际投影表，Go 测归档字典，用同一组 `group.key` 做双向一致性校验；动态分区另由正则和数量上限控制。清单并不要求每台手机实际上传所有字段。旧字段集 13–19 的清单仍保留在仓库中。

`GET /api/admin/device-assets/{id}/dossier` 需要管理会话或 Bearer 令牌。只读取该资产最新的在库报告，按手机采样时间选择、接收时间和报告 ID 破平；时间缺失的旧记录排在有效时间之后。资产没有在库采样时返回 404。它不修订报告，也不从其他 ROM 或同型号设备补值。

- `schemaVersion: 1`、`ruleVersion: "sigmark-dossier/5"` 为派生诊断版本，与上传协议、App 版本和字段集独立。可选 `latestGnssReportId` 引用同资产最近一份在库 GNSS 核对，即使有更新的标准采样也不覆盖这个入口。页面的诊断 JSON 与此接口同形；原始报告仍走原接口。

### 资产合并与撤销

「资产管理 → 设备档案 → 合并到另一设备」先展示在库、回收站、基线引用和后续上传关联影响，再确认同一部手机。报告正文及报告 ID 保持不变，目标保留别名；合并之后，原安装标记后续投稿也落到目标。

- `GET /api/admin/device-assets/merge-preview?source=...&target=...` 返回影响和快照 `previewToken`。提交 `POST /api/admin/device-assets/merge` 时附 `source,target,confirmed,previewToken`。预览后归属、回收站或基线变化会要求重新预览。
- `GET /api/admin/device-assets/merges?before=...` 分页查看新版记录；`POST /api/admin/device-assets/merges/{id}/undo` 携带 `{"confirmed":true}`。24 小时内若目标没有新增、删除或变更归属的报告/安装，可恢复原资产；之后仅保留日志。撤销时保持回收站状态和基线引用。试验环境使用共享凭据，日志不识别个人操作者。
- 安装摘要及原始归属只保存在撤销快照，不在接口中返回；撤销立即清理快照，过期快照在后续合并时清理。当前策略保守拒绝归属已变化的撤销，不猜测合并后新报告来自哪一侧。
- 如需给自动化只读仓库权限，可在 Compose 环境设置与 `ADMIN_TOKEN` 不同的 `REPOSITORY_READ_TOKEN`（至少 24 字符）。该令牌仅用于 Bearer 读取报告、档案、工作台、基线列表和字段统计；不创建浏览器会话，不读取构建、后台设置或合并审计，不进行批量导出或任何写操作。默认未启用，仍只用于内网；不替代 HTTPS 或独立上报身份。
- `categories[].fields[]` 按 `group + key` 保留归档的状态、值、来源、原因、备注和可选 errno；`kind` 区分配置与能力、采样状态与实测。时间为报告采样时间，并非每个 Android API 的实际读时间。
- `counts` 只计完整归档字段。有限的诊断清单不是上传白名单：`checklistSaved` 包含归档了无值状态的字段；`checklistScope` 再含条件适用但缺行的代表字段。旧协议/API 不适用、另有采样方案、授权不满足或历史条件未知均独立展示，不进入分母。`gaps[].code` 表示缺行解释而非设备读数；旧状态摘要单独标为 `legacyStatusOnly`，不能当完整证据。

## 构建中心

0.18.2：采集后首页显示最近保存时间和待上传份数。可以连续采多份再选一份上传。已上传报告在列表底部，可确认后删除本机副本，不影响后台。仅在本机清除应用数据或卸载会丢失所有本机报告；旧版尚未提交的内存报告不会被迁移。无后台地址的离线构建仍可手动导出本地 JSON。

历史版本 0.18.1 首推「整体获取」。也可点「上传当前采样」提交已有结果；成功后该入口变为「查看回执」。不同时间的新采样是不同报告，已勾选关联的同一安装只计一部设备。仅关闭预览不发送；重试同一草稿不重采。

0.18.0 的手动安全采样流程：在 App 首页点击「指纹安全」→ 可选「测试密钥保护」→ 关闭后「上传报告」核对预览。应在同一快照上传，点首页刷新会清掉上次自测。后台在「指纹安全」选择该报告查看发布签名、分区、组件和密钥信息；旧样本不回填。分区构建指纹和当前 APK 证书摘要从字段集 7 开始纳入此预览，整机配置摘要仍仅本机。见[字段与局限](SECURITY-EVIDENCE.md)。

启动 Compose 后，在仓库根目录操作构建工作进程。Windows 已验证，Linux 脚本分支待复测。构建主机需要 Python 3.12+、Git、JDK 17+、Android SDK Platform 36 和 Build Tools 36.0.0，设置 `JAVA_HOME` 和 `ANDROID_HOME`。

```powershell
python backend/scripts/build_worker.py approve HEAD "当前已审阅版本"
python -u backend/scripts/build_worker.py work --origin http://<LAN_BIND>:<LAN_PORT>
```

- `approve` 可登记本地分支、标签或提交号，记录其对应的固定 Git SHA。更新最新版时，维护者先拉取并检查提交，再重新登记。页面默认选中最后登记的版本，也可选任一已登记历史版本。
- 浏览器排队后，由独立主机进程导出源码快照并执行固定的 Gradle Debug 构建。构建中心显示在线和任务状态，同一时间处理一单。加 `--once` 可单次捞取任务。构建日志保存在 `backend/build-data/jobs/<任务 ID>/build.log`。构建成功后点击「发布到下载页」才会切换下载包。
- 导入本地构建时，先用相同 `--origin` 对应的 Gradle 参数生成包，再执行 `python backend/scripts/build_worker.py import-apk app/build/outputs/apk/debug/app-debug.apk --origin http://<LAN_BIND>:<LAN_PORT> --publish`。导入检查包名、Debug 标志、签名和 SHA-256，导入命令的地址来自维护者确认。前端下载页及 `GET /api/downloads/current` 提供版本和校验值，`/downloads/sigmark.apk` 提供当前产物。
- `backend/build-catalog/` 和 `backend/build-data/` 为本机持久目录。已有安装要继续覆盖升级时，构建机需使用同一个 Debug 签名密钥。正式部署时构建主机应使用独立账号和工作目录，仅登记审阅过的提交，保留构建和发布审计，按需备份归档及产物。

### 0.12 构建参数

- 每个任务可设置测试名称和是否运行 Android 单测与 Lint。带 `SIGMARK_BUILD_PROFILE_V1` 的 Git 提交登记后支持指定数字版本名（如 `0.12.42`）和正整数内部版本号。旧源码可用原版本构建。构建地址仍由工作进程的 `--origin` 确定，浏览器表单不接收任意 Gradle 参数。
- 自定义版本使用 `SIGMARK_VERSION_NAME` / `SIGMARK_VERSION_CODE`，只影响 Debug 构建。工作进程从已登记提交构建后再次核对 APK 实际版本，并记录签名证书 SHA-256。
- 后台 `GET /api/admin/builds/{id}/apk` 下载已完成的单个测试包，不切换发布版本。发布需两步确认。Web 发布拒绝旧内部版本号；当前发布证书已登记时，新产物也须匹配它。
- 已提交的源码可运行 `python backend/scripts/build_worker.py approve HEAD "当前 SigMark 源码"` 登记。也可在构建主机审阅本地改动后，执行 `python backend/scripts/build_worker.py snapshot "当前 Android 测试源码"`。这一步从明确的 Android 构建输入生成内容寻址快照并登记，不创建 Git 提交，不改暂存区。刷新构建中心，选择该快照并切换「自定义测试版本」。
- 快照包括 Android 源码、Gradle 配置和 wrapper；不包括后台数据、主机设置和签名密钥。目录 `backend/build-catalog/snapshots/` 存放冻结的归档。任务读取副本并验证 SHA-256，后续工作区改动需另建快照。Web 表单只选择主机已登记的源码，版本覆盖与发布是独立动作。

## ROM 对比与留存

报告档案和资产管理首页默认每 10 秒同步。切到历史页或浏览器后台时停止定时刷新；资产勾选或有确认窗口时不更新表格。刷新频率可在「设置」调整，仅保存在当前浏览器。服务器的「新报告标签（批次）」只影响之后接收的报告；例如分别用 `mi8-before` 和 `mi8-after` 归类并对照刷机前后的报告。

用同一测试批次和相近测试条件采集两次。在档案中打开第一份报告，通过「更多报告操作 → 设为临时对比基线」，返回列表，再打开第二份并选择「更多报告操作 → 对比全部参数」。可只看差异或只看系统与内核。这条临时基线仅在当前档案工作区保留，不改写原报告；差异按 `group + key` 比较值、状态、原因、errno 和来源。电量、网络和可用内存随环境变化，不是 ROM 缺陷的直接证据。「更多报告操作」也可下载该报告原始 JSON；持久回归基线是另一项显式保存的操作。

「报告档案」顶部提供搜索和「更多筛选」；Android 版本、API 级别、品牌、型号和设备代号可组合。品牌会收窄型号和设备代号。分类只依据现有归档值，没有值的历史报告可选「未记录」。使用「管理当前结果」或「查看字段覆盖」可将查询范围带入资产管理。

手机和桌面都在独立页面阅读报告。先用「定位分类」直达移动网络等分类，或搜索参数名、读数、字段键、来源、原因、`errno=13`。未取得值的项目就地显示原因，展开「依据」查看原始信息；「手机快照覆盖」可查看总采样数和仅本机项。返回键按原入口回到档案、资产管理或设备采样，保留筛选和已翻到的位置；直接打开分享链接则返回该查询的档案列表。

### 资产管理：仓库统计与字段覆盖

- 设备数按至少有一份在库报告的资产统计。同一资产无论上传多少份都算一部；两台同型号手机不自动合并。单列显示在库、未归组和回收站报告数，未归组不是一部设备，也不代表多少部未知设备。
- App 0.15+ 可在上传预览主动勾选「关联到同一设备资产」。该安装随后向同一后台上传时使用专用随机标记。新安装可能生成新标记；确认刷机前后确实是同一部手机，可在设备档案显式合并两个资产。合并把历史报告和今后的上传归到目标、保留目标别名，移除源资产；暂不支持一键撤销。没有标记的旧报告可勾选后新建设备，或归入已存在设备；先确认实际归属再操作。同一批次并不等于同一设备。
- 「字段覆盖」的样本单位仍是报告。可按机型、版本、批次和字段集缩小范围，再检查每项有值率、受限原因、系统未上报、异常、历史仅状态和未归档。可导出当前筛选的覆盖 JSON；不含其他报告正文，也不是备份。
- 「仓库总览」直接显示在资产管理顶部，支持刷新、导出统计 JSON、看全部报告、过滤未归组及打开回收站。展开「分类统计」后，从品牌、型号、Android 版本、API 级别或批次分布可直接筛选报告。分组设备数按各分类独立去重，切过 ROM 的设备可能出现在多个分类，分组设备数不可求和。
- 档案、资产与字段覆盖共用「更多筛选」，可暂存多个条件后一起应用。Esc 或取消不改变当前列表；已应用条件可逐项清除。通过页内入口显式带入筛选，主导航进入各页默认视图。勾选和回收站状态不带入；资产页顶部始终统计全库。
- 「在库报告」「按设备查看」「字段覆盖」「回收站」是仓库总览下的直达入口。「按设备查看」→「查看采样」显示单台设备的报告，包括采样时间、接收时间、构建号和字段集，支持分享管理端深链接。安全分析无需打开设备历史：直接使用主导航或报告行的「安全分析」。在库报告勾选两份可直达安全对照，设备采样中则可对比全部参数。

### 资产维护

「资产管理」可勾选单份或本页最多 30 份报告。选择「导出所选 ZIP」可导出勾选项，「导出筛选结果 ZIP」跨页导出当前视图的匹配项（含回收站视图），单次最多 250 份、原始报告正文合计最多 32 MiB。超限不截断，请先缩小筛选范围。ZIP 包含 `manifest.json` 及 `reports/<id>.json`；各 JSON 与单份导出使用相同报告结构。导出不更改归档。

管理员还可移入回收站、恢复、下载单份 JSON 和永久删除。永久删除需输入 `DELETE` 确认。报告默认长期保存，回收站由管理员手动清理。ZIP 是分析资料，不是 PostgreSQL 备份；完整备份和恢复使用 `pg_dump` 等工具。

### 报告管理接口

- `GET /api/admin/reports` 和 `/api/admin/summary` 支持 `view=archive`（默认）或 `view=trash`，并可继续使用批次、搜索和分页。已移入回收站的报告含 `trashedAt`。详情仍可按 ID 读取，用于核查及导出。
- `GET /api/admin/report-count` 使用相同筛选参数，仅返回 `{total}`。资产工作台用它展示匹配的在库与回收站计数。单条「查看报告」可从资产页直达档案中的报告详情。
- 列表、计数、摘要和导出支持精确分类参数 `android`、`api`、`brand`、`model`、`device`；`~missing` 匹配未记录项。用 `GET /api/admin/report-facets` 查看分类值及数量。
- `POST /api/admin/reports/export` 使用列表的筛选参数，以及管理鉴权和 `X-SigMark-Admin: 1`。请求为 `{"mode":"filtered"}` 或 `{"mode":"selected","ids":["<UUID>"]}`；成功返回 `application/zip`，响应头 `X-SigMark-Report-Count` 为实际份数。自动化脚本应以 `manifest.json` 为目录，不解析 ZIP 文件名判断数据范围。
- `GET /api/admin/repository-stats` 现为字段覆盖接口（`schemaVersion: 2`）。接受档案筛选及 `fieldSet`（正整数或 `legacy`），各状态之和等于 `scope.archived`。原因按枚举计数。
- `GET /api/admin/device-assets?q=…&before=…` 返回全库 `totals`（`devices/reports/unassigned/trash`）、设备页和 `nextCursor`。档案、覆盖与 ZIP 可使用 `q=asset:<UUID>` 或 `q=asset:unassigned` 精确定位报告。管理写操作使用同一会话和 `X-SigMark-Admin: 1`。用 `POST /api/admin/device-assets/assign` 提交 `{"ids":[…],"label":"…"}` 或 `{"ids":[…],"assetId":"…"}`（1–30 份仅限在库未归组报告，冲突整批回滚）；用 `POST /api/admin/device-assets/merge` 提交 `{"source":"…","target":"…","confirmed":true}`。
- `GET /api/admin/device-assets?summary=1` 返回仓库总览 v1：`generatedAt`、`totals`、按五种维度的 `distributions`。每维最多 8 个分类，`otherBuckets` 表示其余分类数。报告详情可用 `?include=asset` 取得外层归组关系；不改报告正文及默认导出。
- `POST /api/admin/reports/manage` 接收 `{"action":"trash","ids":["<UUID>"]}`。动作包括 `trash`、`restore`、`purge`，每次 1 至 30 个独立 ID。永久删除还需 `"confirmation":"DELETE"`。请求需管理会话或 Bearer 令牌以及 `X-SigMark-Admin: 1`。任一 ID 已不存在或状态变化时整批回滚，返回 `409 report_selection_changed`。客户端按相同视图刷新。
- 升级 Compose 时由启动迁移添加 `reports.trashed_at`，已有数据库卷和报告继续使用。

### App 内更新

0.9 系列内网 Debug 测试包首页提供「检查更新」。0.8 及更早版本从下载页覆盖安装一次。当前 App 以发布元数据的 `versionCode` 判定新版本，验证 APK 大小、SHA-256、包名、版本及安装签名后，唤起 Android 安装界面。首次使用时，在系统设置允许印迹作为安装来源，再返回点「安装更新」。系统如显示选择器，请选择其安装器。后续版本须使用同一签名，且逐次增加 `versionCode`。未带 `versionCode` 的旧构建产物仍可从网页下载。

0.12 会先用现代签名接口读取证书，在部分 ROM 无结果时尝试旧接口。若两个接口仍未返回证书，包名、版本与文件完整性检查通过后，交由 Android 安装器验证签名。明确读到签名不同则直接提示。若旧版检查更新仍出现通用错误，从下载页获取同签名 APK 覆盖安装一次；若系统也报告签名冲突，则核对原安装签名。保留原签名优先；确需换签时请先导出本地资料再处理迁移。

### 设备风险画像读取契约

`GET /api/admin/reports/{id}/device-profile` 使用同源管理会话或管理 Bearer 令牌。无认证 401，无效标识 400，不存在或已在回收站 404。读库错误 503；失败不是「未见风险」，页面支持单独重试。可通过「指纹安全 → 选择报告 → 设备风险画像」检查或导出同结构 JSON。

- 顶层：`reportId, ruleVersion, capturedAtEpochMs, linked, historyDays, historyLimit, historySamples, historyLimited, labels`。采样时间是手机上报的 Unix 毫秒，不是接收时间或受信时间戳。
- 时间窗：所选报告采样时间前 30×24 小时（左闭右开）；仅使用当前同一资产、未入回收站、且接收时间不晚于所选报告的样本。同一采样毫秒不互为历史；按采样时间降序，数量超过 50 时只算最近 50 份，并标记截断。这不限制入库或保留数量。未归组只评估当前报告。
- 每项：`code`、`state=hit|not_observed|insufficient`、逐字段 `evidence`（`key/status` 与可用的 `value/source/reason/errno`）。`NOT_ARCHIVED` 意味着这份报告没有该字段，并不推断手机不支持。历史命中数是 `historyHits`，分母是本项可判断的历史样本 `historyEvaluable`；不足项不算零。若命中历史，则有 `lastHistoricalHit.id/capturedAtEpochMs` 指向在库原件。
- 复现：从仓库根目录运行 `docker build -t sigmark-qa:device-profile backend`、`python -B backend/scripts/qa_device_profile.py --browser`。浏览器需 Node 可解析 Playwright，使用本机 Chrome 时设置 `SIGMARK_QA_BROWSER=chrome`。不带 `--browser` 仅跑 SQL/API。测试启动独立临时 PostgreSQL 与 API，不向配置的仓库上传。对明确指定的真实归档仅 GET：按工作台文档设置 QA 地址和本地令牌，执行 `node backend/web/qa/device-profile.cjs --archive <报告UUID>`。

## 服务器部署前

服务器部署需配置 HTTPS、强令牌和 `COOKIE_SECURE=true`。当前 App 连接器仍为私有 IPv4 的 HTTP Debug 试验通道，远程部署还需补上 APP 的 HTTPS 地址配置和独立上报鉴权。扩大部署范围前验证构建隔离、签名、跨设备兼容性、备份恢复、审计和监控。
