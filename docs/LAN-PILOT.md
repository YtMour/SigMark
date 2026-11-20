# SigMark 0.6 · 内网报告档案库

## 连接方式

1. 在 `backend/` 将 `.env.example` 复制为 `.env`，填写独立随机的 URL 安全 `DB_PASSWORD`、仅用于管理端的 `ADMIN_TOKEN`、测试电脑的私有 IPv4 `LAN_BIND`。可选 `LAN_PORT` 默认 48272、`LAN_BATCH` 默认 `lan-direct`。真实配置不进 Git，不构建到 APK。
2. 在 `backend/` 执行 `docker compose up --build -d`。同一局域网的电脑可访问 `http://<LAN_BIND>:<LAN_PORT>/`，输入管理令牌进入。管理页面与手机 API 同地址、同端口；数据库不发布端口。管理令牌仅在当前标签页内存中保留，点击「锁定」或刷新后需重新输入。
3. 在仓库根目录执行 `gradlew.bat "-PSIGMARK_LAN_URL=http://<LAN_BIND>:<LAN_PORT>" :app:assembleDebug :app:testDebugUnitTest`。安装 Debug APK 后，手机接入同一网络，首页点「上传报告」→ 预览和可选反馈 →「确认上传」。地址在构建时预设，用户无需输入网址、管理令牌或邀请码。手机收到回执后，后台刷新并筛选 `LAN_BATCH` 即可看到报告。测试主机地址变化时，需更新 `LAN_BIND` 并重建手机试验包；建议路由器保留测试主机地址。
4. 可独立选择「授权查看小区无线参数」；拒绝或仅授予大致位置不影响 Wi-Fi、基础运营商信息或报告上传；手机端的授权不触发上传。Release APK 仍仅本地采集与导出。

当前仅应在受控内网使用。此方案不需要路由器端口转发。HTTP 未加密，短令牌不适合公开部署；应由防火墙限制测试网络，避免在公共 Wi-Fi 或互联网开放。上报不使用邀请码或身份凭证，因此同一内网的客户端可能伪造报告；它们无法凭上报接口读取管理数据。管理 API 需要单独的 Bearer 令牌。

## 接口与维护

- `GET /readyz` 检查 PostgreSQL 连通。报告保存在 PostgreSQL 命名卷，**不按时间自动删除**，包括旧版仍存在的数据。已被旧版清理的记录不会复原。列表每页 30 条，无总数上限；汇总覆盖所有匹配报告。
- `POST /api/v1/reports`：JSON 128 KiB 上限，应用协议头、限流和字段白名单校验。部署配置确定批次；批次 + UUID 幂等。应用协议头不是鉴权。
- 管理接口使用 `Authorization: Bearer <token>`。列表 `GET /api/admin/reports?batch=…&q=…&before=…` 返回 `{items,nextCursor}`，列表与统计均支持批次和文本搜索（型号、构建/ROM 线索、API、App 版本、网络或 ID）。首请求省略 `before`，后续透传服务端游标。报告值通过 `GET /api/admin/reports/{id}` 获取，汇总用 `/api/admin/summary?batch=…&q=…`。
- 0.5 上传 `schemaVersion: 2`，包含各类白名单参数的实测值或空值，以及来源、状态、原因、说明和适用的 errno。包含实际 Wi-Fi 主链路频率/信道、信号、内存与电池等；不发送完整快照、运营商、精确小区频点/信道、小区标识或位置。旧版报告兼容，但仅能查看原来保存的状态，需用新版重新上传才有具体值。
- 用 `docker compose ps` 查看状态，`docker compose stop` 停机并保留报告。升级保留现有 PostgreSQL 卷及原 DB 密码，避免 `docker compose down -v`。使用 `go test ./...`、`go vet ./...`（`backend/`）及 `npm ci`、`npm test`、`npm run build`（`backend/web/`）复测。

## ROM 对比与留存

用同一测试批次和相近测试条件采集两次。选中第一份报告点「设为基线」，搜索/翻页选择第二份后点「与基线对比」。可以只看差异或只看系统与内核。基线只在当前浏览器工作区保留，不改写原报告；差异按 `group + key` 比较值、状态、原因、errno 和来源。电量、网络和可用内存随环境变化，不是 ROM 缺陷的直接证据。单份报告可下载原始结构化 JSON。

单份 JSON 下载不是数据库备份。长期实验前应对 PostgreSQL 做 `pg_dump` 备份并在独立数据库演练恢复；此版未配置定时备份。数据需要淘汰时先备份，再由维护者按保留策略人工处理。归档时间无限制不等于容量无限，需监控命名卷磁盘。

## 服务器部署前

用 HTTPS、强令牌/管理会话和独立上报鉴权，不直接复用当前 HTTP 试验配置。补齐管理员身份、审计、迁移、备份恢复、数据删除、监控和跨设备验证后再扩大部署范围。
