# 浏览器回归（qa/）

这些脚本用 Playwright 驱动**真实部署的控制台**，只发 GET。它们不建库、不写库、不改后端，
所以可以随时对着一台已就绪的 LAN 后台跑。

## 跑什么

| 脚本 | 作用 | 需要什么 |
| --- | --- | --- |
| `device-profile.cjs` | 设备风险画像：重试、390px 布局、键盘展开、证据行、历史分母、导出 JSON、历史跳转 | 只需 `SIGMARK_QA_URL` |
| `device-profile.cjs --archive <UUID>` | 同一页面，但对着**真实归档报告**校验：标签数与后端一致、每条证据的 key 都渲染出来 | 额外需要 `SIGMARK_QA_TOKEN` |
| `device-dossier.cjs` | 设备档案：12 类参数、键盘展开、320px 与桌面宽度、仅看缺项、导出 JSON、原报告跳转、验收工作台基线、焦点回位 | 额外需要 `SIGMARK_QA_TOKEN` 与下面三个 id |

`device-dossier.cjs` 的探针值（哪个值必须被「仅看缺项」藏起来、哪一行要显示 errno）是
**从 dossier 接口的返回里现取**的，不写死 fixture，所以同一份脚本既能跑种子数据也能跑真机报告。

## 怎么跑

```powershell
cd D:\SigMark\backend\web
$env:SIGMARK_QA_URL='http://192.168.1.114:48272'

# 只要画像页（用脚本内建的合成 fixture，不碰后台数据）
npm.cmd run qa

# 画像页 + 设备档案，全部对着真实归档报告
$env:SIGMARK_QA_TOKEN=((Get-Content ..\.env | Where-Object { $_ -match '^ADMIN_TOKEN=' }) -split '=',2)[1]
$env:SIGMARK_QA_DOSSIER_ASSET='<资产 id>'
$env:SIGMARK_QA_ACCEPTANCE_CURRENT='<该资产最新报告 id>'
$env:SIGMARK_QA_ACCEPTANCE_BASELINE='<该资产上一份报告 id>'
npm.cmd run qa

# 画像页的归档模式（只读一份指定报告）
npm.cmd run qa -- --archive <报告 id>
```

`npm run qa` 会先探一次浏览器通道：有 Chrome 用 `chrome`，没有就试 `msedge`，都没有才回落到
Playwright 自带的 Chromium。**不需要跑 `npx playwright install`**，除非本机两个系统浏览器都没有。

想强制指定通道就设 `SIGMARK_QA_BROWSER`（`chrome` / `msedge` / 空字符串=用自带构建）。
脚本本身的默认视口是 390×844（画像）与 320×844（档案），两个都断言了没有横向溢出。

## 取那几个 id

```powershell
$h=@{Authorization="Bearer $env:SIGMARK_QA_TOKEN"}
# 资产列表：挑 model 对得上、reports 最多的那个
(Invoke-WebRequest -Uri "$env:SIGMARK_QA_URL/api/admin/device-assets" -Headers $h -UseBasicParsing).Content
# 资产的最新报告与上一份：dossier 的 reportId 是 current，configurationCode.previousReportId 是 baseline
(Invoke-WebRequest -Uri "$env:SIGMARK_QA_URL/api/admin/device-assets/<资产 id>/dossier" -Headers $h -UseBasicParsing).Content
```

## 注意

- 这些脚本**不替代** `backend/scripts/qa_device_profile.py`。那个脚本会在一次性容器里起独立的
  PostgreSQL 与 API，验证 SQL、批次隔离、回收站、基线注册与 dump/restore，还会把浏览器脚本指向
  那份种子数据。本文这层只验证**已部署控制台的界面**。
- 脚本里的 `assert.deepEqual(errors,[])` 表示页面不得有未捕获异常。失败时先看是哪一条断言，
  再决定是 fixture 假设过时（改断言）还是界面真坏了（**不要**改断言去迁就）。
