# SigMark 0.7 · 内网报告工作区

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

## ROM 对比与留存

用同一测试批次和相近测试条件采集两次。选中第一份报告点「设为基线」，搜索/翻页选择第二份后点「与基线对比」。可以只看差异或只看系统与内核。基线只在当前浏览器工作区保留，不改写原报告；差异按 `group + key` 比较值、状态、原因、errno 和来源。电量、网络和可用内存随环境变化，不是 ROM 缺陷的直接证据。单份报告可下载原始结构化 JSON。

单份 JSON 下载不是数据库备份。长期实验前应对 PostgreSQL 做 `pg_dump` 备份并在独立数据库演练恢复；此版未配置定时备份。数据需要淘汰时先备份，再由维护者按保留策略人工处理。归档时间无限制不等于容量无限，需监控命名卷磁盘。

## 服务器部署前

服务器部署需配置 HTTPS、强令牌和 `COOKIE_SECURE=true`。当前 App 连接器仍为私有 IPv4 的 HTTP Debug 试验通道，远程部署还需补上 APP 的 HTTPS 地址配置和独立上报鉴权。扩大部署范围前验证构建隔离、签名、跨设备兼容性、备份恢复、审计和监控。
