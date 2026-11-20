# SigMark · 内网报告工作区

## 连接方式

1. 在 `backend/` 将 `.env.example` 复制为 `.env`，填写独立随机的 URL 安全 `DB_PASSWORD`、仅用于管理端的 `ADMIN_TOKEN`、测试电脑的私有 IPv4 `LAN_BIND`。可选 `LAN_PORT` 默认 48272、`LAN_BATCH` 默认 `lan-direct`。真实配置不进 Git，不构建到 APK。
2. 在 `backend/` 执行 `docker compose up --build -d`。同一局域网访问 `http://<LAN_BIND>:<LAN_PORT>/`，用管理令牌登录。管理页面和手机 API 同源，数据库只在容器网络中监听。登录签发 7 天 HttpOnly / SameSite=Strict Cookie，服务端将会话摘要保存到 PostgreSQL。刷新页面可恢复会话，锁定会注销当前会话，修改管理令牌会使现有会话失效。
3. 第二台手机连接同一 Wi-Fi 后访问 `http://<LAN_BIND>:<LAN_PORT>/#downloads`，使用「下载 APK」安装当前内网 Debug 版本，无需管理令牌。首页点「上传报告」→ 预览和可选反馈 →「确认上传」。后台可按「设置」中的接收批次找到报告。地址变化时，需更新 `LAN_BIND` 并重新编译及发布 APK。
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

## 构建中心

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

用同一测试批次和相近测试条件采集两次。选中第一份报告点「设为基线」，搜索/翻页选择第二份后点「与基线对比」。可以只看差异或只看系统与内核。基线只在当前浏览器工作区保留，不改写原报告；差异按 `group + key` 比较值、状态、原因、errno 和来源。电量、网络和可用内存随环境变化，不是 ROM 缺陷的直接证据。单份报告可下载原始结构化 JSON。

「报告档案」提供查询、参数筛选、基线对比和导出。「资产管理」可勾选单份或本页最多 30 份报告，确认后移入回收站。回收站保留原报告和移入时间，支持恢复、下载 JSON 和永久删除。永久删除需输入 `DELETE` 确认。报告默认长期保存，回收站由管理员手动清理。PostgreSQL 的完整备份及恢复由 `pg_dump` 等数据库工具处理。

### 报告管理接口

- `GET /api/admin/reports` 和 `/api/admin/summary` 支持 `view=archive`（默认）或 `view=trash`，并可继续使用批次、搜索和分页。已移入回收站的报告含 `trashedAt`。详情仍可按 ID 读取，用于核查及导出。
- `GET /api/admin/report-count` 使用相同的 `view`、`batch`、`q`，仅返回 `{total}`。资产工作台用它展示匹配的在库与回收站计数。单条「查看报告」可从资产页直达档案中的报告详情。
- `POST /api/admin/reports/manage` 接收 `{"action":"trash","ids":["<UUID>"]}`。动作包括 `trash`、`restore`、`purge`，每次 1 至 30 个独立 ID。永久删除还需 `"confirmation":"DELETE"`。请求需管理会话或 Bearer 令牌以及 `X-SigMark-Admin: 1`。任一 ID 已不存在或状态变化时整批回滚，返回 `409 report_selection_changed`。客户端按相同视图刷新。
- 升级 Compose 时由启动迁移添加 `reports.trashed_at`，已有数据库卷和报告继续使用。

### App 内更新

0.9 系列内网 Debug 测试包首页提供「检查更新」。0.8 及更早版本从下载页覆盖安装一次。当前 App 以发布元数据的 `versionCode` 判定新版本，验证 APK 大小、SHA-256、包名、版本及安装签名后，唤起 Android 安装界面。首次使用时，在系统设置允许印迹作为安装来源，再返回点「安装更新」。系统如显示选择器，请选择其安装器。后续版本须使用同一签名，且逐次增加 `versionCode`。未带 `versionCode` 的旧构建产物仍可从网页下载。

0.12 会先用现代签名接口读取证书，在部分 ROM 无结果时尝试旧接口。若两个接口仍未返回证书，包名、版本与文件完整性检查通过后，交由 Android 安装器验证签名。明确读到签名不同则直接提示。若旧版检查更新仍出现通用错误，从下载页获取同签名 APK 覆盖安装一次；若系统也报告签名冲突，则核对原安装签名。保留原签名优先；确需换签时请先导出本地资料再处理迁移。

## 服务器部署前

服务器部署需配置 HTTPS、强令牌和 `COOKIE_SECURE=true`。当前 App 连接器仍为私有 IPv4 的 HTTP Debug 试验通道，远程部署还需补上 APP 的 HTTPS 地址配置和独立上报鉴权。扩大部署范围前验证构建隔离、签名、跨设备兼容性、备份恢复、审计和监控。
