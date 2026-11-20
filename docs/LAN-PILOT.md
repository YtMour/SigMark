# SigMark 0.4 · 内网试验手册

## 连接方式

1. 在 `backend/` 将 `.env.example` 复制为 `.env`，填写独立随机的 URL 安全 `DB_PASSWORD`、仅用于管理端的 `ADMIN_TOKEN`、测试电脑的私有 IPv4 `LAN_BIND`。可选 `LAN_PORT` 默认 48272、`LAN_BATCH` 默认 `lan-direct`。真实配置不进 Git，不构建到 APK。
2. 在 `backend/` 执行 `docker compose up --build -d`。同一局域网的电脑可访问 `http://<LAN_BIND>:<LAN_PORT>/`，输入管理令牌进入。管理页面与手机 API 同地址、同端口；数据库不发布端口。管理令牌仅在当前标签页内存中保留，点击「锁定」或刷新后需重新输入。
3. 在仓库根目录执行 `gradlew.bat "-PSIGMARK_LAN_URL=http://<LAN_BIND>:<LAN_PORT>" :app:assembleDebug :app:testDebugUnitTest`。安装 Debug APK 后，手机接入同一网络，首页点「上传报告」→ 预览和可选反馈 →「确认上传」。地址在构建时预设，用户无需输入网址、管理令牌或邀请码。手机收到回执后，后台刷新并筛选 `LAN_BATCH` 即可看到报告。测试主机地址变化时，需更新 `LAN_BIND` 并重建手机试验包；建议路由器保留测试主机地址。
4. 可独立选择「授权查看小区无线参数」；拒绝或仅授予大致位置不影响 Wi-Fi、基础运营商信息或报告上传；手机端的授权不触发上传。Release APK 仍仅本地采集与导出。

当前仅应在受控内网使用。此方案不需要路由器端口转发。HTTP 未加密，短令牌不适合公开部署；应由防火墙限制测试网络，避免在公共 Wi-Fi 或互联网开放。上报不使用邀请码或身份凭证，因此同一内网的客户端可能伪造报告；它们无法凭上报接口读取管理数据。管理 API 需要单独的 Bearer 令牌。

## 接口与维护

- `GET /readyz` 检查 PostgreSQL 连通。默认保留最近 30 天；明细最多显示 100 条，汇总覆盖所有匹配的近 30 天数据。
- `POST /api/v1/reports`：JSON 8 KiB 上限，应用协议头、限流和字段白名单校验。部署配置确定批次，不接收客户端自报批次。批次 + UUID 幂等；内容不一致返回 409。应用协议头不是鉴权。
- `GET /api/admin/session`、`/api/admin/reports?batch=…`、`/api/admin/summary?batch=…`：使用 `Authorization: Bearer <token>`。无账号密码和邀请码接口。
- 上传独立最小化载荷，包含网络类别、频段名称、制式、精选字段状态、型号、版本、采样时间与可选反馈，不包含完整快照、运营商、精确频点、小区标识或位置。不要在反馈中填写个人信息。
- 用 `docker compose ps` 查看状态，`docker compose stop` 停机并保留报告。升级保留现有 PostgreSQL 卷及原 DB 密码。使用 `go test ./...`、`go vet ./...`（`backend/`）及 `npm ci && npm run build`（`backend/web/`）复测。

## 服务器部署前

用 HTTPS、强令牌/管理会话和独立上报鉴权，不直接复用当前 HTTP 试验配置。补齐管理员身份、审计、迁移、备份恢复、数据删除、监控和跨设备验证后再扩大部署范围。
