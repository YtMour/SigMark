# ROM 回归：从报告到复测

## 设备证据与风险验收

从「设备档案 → 到验收工作台」或报告详情进入，选择「综合核对 / ROM 回归 / Wi‑Fi → 蜂窝」，可选同设备历史或登记基线。登记基线不会被最近 12 份的历史窗口截掉；只接受同资产、采样更早、在当前样本接收前已入库且未回收的报告。链接可携带 `objective` 和 `saved`，参数本身不赋予基线资格。

「导出验收证据包 JSON」生成 `sigmark.verification-package/1`（`kind: "sigmark.verification-package", schemaVersion: 1`），包含报告引用、12 类归档覆盖、实验条件和字段、对比、风险规则及证据强度。包内不附报告反馈、资产 UUID 或安装标记。瞬时或实验差异和跨字段集缺行单列，不把它们当作 ROM 回归；报告字段字典的版本随包保存。字典中的 API/权限条件只在已核对时才列出，空值不代表所有系统版本均适用。

字段集 13 为 AVC、GLES、网络和 USB 保存设备墙钟端点；不拿墙钟作为单调间隔。工作台统计已载入同资产报告的实验次数，注明历史窗口边界。Wi‑Fi→蜂窝达到工作台条件需有 Wi‑Fi 起点、蜂窝终点，并且 Android 验证终点可联网；这不是连续性或断网时长测试。旧报文没有各实验的墙钟起止时间，不用接收时间或相对耗时补算。

`sigmark-verification/3` 在实验卡和证据包新增同机对照。只有两边 ROM 方案及实验结果都可比时才报告通过、回退或恢复；不同 AVC 样片、不同已知 GLES 上下文版本、超时和旧版缺失分别说明。USB 和网络只对照现场观察，不报告 ROM 回退。

USB 仅比较手动记录的两个枚举数量。请在手机选择「更多工具 → USB 插拔实验」，准备 USB Host、OTG 转接器和外设，两分钟内保存两点。数量增加或减少为观察到变化，数量相同并不证明端口有故障。报告不含外设名称、标识、连接句柄或内容。

### 自定义 ROM 样本复测

1. 在实验记录中登记设备化名、ROM 构建版本和预期变更，记下 SigMark 版本、字段集、采集方案与授权状态。保持采样条件相近，由操作者在手机做两轮「整体获取」并确认上传；另选一台普通设备验证通用规则。App 验收无需 ADB 或导入。
2. 在验收工作台比较同一资产、同一观察视角的早期基线和新报告。身份声明差异、保护状态和主动实验结果分别记录；受限、未上报与旧版未归档保留各自状态。若有历史外部对照，仅在单独的「辅助对照 · 外部记录」查看，不补写任何 App 结果。
3. 交给 ROM 项目复核的记录包含实验编号、ROM 构建版本、可复现步骤与能力回归结论。下一版回到同一组验收用例，重点检查公开 API 可用性、读数稳定性、启动与保护状态以及 AVC/GLES 实测。完整设备报告默认留在测试机或本地归档。

### 离线校准

先独立人工登记设备类别和预期处置，再从工作台导出证据包，准备本地清单：

```json
{
  "schemaVersion": 1,
  "cases": [
    {
      "deviceKey": "bench-01",
      "cohort": "stock_device",
      "expected": "no_alert",
      "labelledAt": "2026-11-23T10:00:00Z",
      "packet": "bench-01.json"
    }
  ]
}
```

在仓库根目录执行 `node backend/web/qa/calibrate-risk.mjs manifest.json calibration.json`；输出路径应尚不存在。`cohort` 支持 `stock_device/custom_rom_device/emulator`，不决定风险标签；预期处置为 `alert/no_alert/unknown`。同设备、同类别、同策略、同规则版本只计最新一次，灰色单列，误报和漏报分母仅包含有明确预期且可评级的设备。同一设备可能跨实验类别出现，总设备数按化名去重，不把各层相加。工具离线运行，不修改后台或上传数据。

1. **保存刷机前样本。** 在「报告档案」打开报告，点击「保存回归基线」，起个易找的名称，如「MI 8 刷机前」。可选择新 ROM 是否预期解锁，以及两次样本应使用的默认网络。未指定网络时不判定网络条件。
2. **对照刷机后报告。** 找到新报告，点「与基线复测」。当前报告会带入，但不自动选择基线。「同设备的已保存基线」优先；「从历史报告选择」默认列出该设备的历史，可搜索仓库、加载更多，或主动选择其他设备作为样本对照。指纹安全也可独立打开做单份检查。
3. **先看摘要，再查证。** 将建议复核、证据不足、读数丢失及新增归档分开看。两份不是同一资产时，只做样本对照。「导出对比 JSON」保留结果及其原始字段来源。

基线只引用报告 ID，不复制或修改报告。团队共享同一仓库的基线，每库最多 100 条；同名（不区分大小写）拒绝。报告移入回收站时基线暂停使用，恢复后可用。永久删除报告时显示引用失效；移除基线不影响原报告。预期解锁仅在两份报告归属同一资产时生效，不覆盖矛盾或红色启动信号。

## DX / API

使用现有管理会话或 Bearer 令牌。写操作还需请求头 `X-SigMark-Admin: 1`。不要把令牌放进代码、日志或导出。

| 操作 | 接口 | 结果 |
| --- | --- | --- |
| 列出基线 | `GET /api/admin/regression-baselines` | `{schemaVersion:1,items:[...]}`。项含 `id,name,reportId,expectUnlock,expectedNetwork,createdAt,state,model,batch,assetId` |
| 保存引用 | `POST /api/admin/regression-baselines` | 请求 `{name,reportId,expectUnlock,expectedNetwork}`；成功 201 和 `{id}` |
| 移除引用 | `DELETE /api/admin/regression-baselines/{id}` | 成功 204；不会删除报告 |
| 读证据 | `GET /api/admin/reports/{reportId}?include=asset` | 原报告及外层归组关系，默认不附关系 |

`state` 为 `ready`、`trashed` 或 `missing`。写入错误代码：`invalid_baseline`、`baseline_name_exists`、`baseline_limit`、`baseline_report_not_available`、`baseline_not_found`。程序按枚举处理，不解析界面文案。

## AX / 证据导出

字段集 9 增加 `acceptance`。仅在资产相同、基线更早、两次样片相同且都有明确结果时输出首帧回归/恢复。授权不同仅作为测试条件提示；时间和解码器名称不会触发回归。接口约定见 [1.0 验收手册](ACCEPTANCE-1.0.md)。

对比导出格式为 `kind=sigmark.regression`、`schemaVersion=1`，含 `baseline` / `current`（报告 ID、批次、采样时间、App 采集器和字段集）、`savedBaseline`（可空的 ID、名称）、`context`、`counts`、`verdicts` 和 `checks`。不附原报告正文、任意测试反馈、资产 UUID 或安装标记。

- `checks[]` 通过 `group.key` 标识字段，包含 `verdict`、说明及两侧 `{value,status,source,reason,errno}`。未归档侧为 null。`not_archived` 表示报告未保存该字段，`restricted` 表示系统拒读，两者优先于 `insufficient`。当前规则 `rom-evidence/6` 对照字段集 21 的两条新身份声明，延续 v5 对 SELinux 两侧直接读数的要求。自动化使用字段键与判定代码。
- `counts` 包含 `bothArchived/baselineOnly/currentOnly/lostValue/gainedValue`。`lostValue` 指双方都归档且由有值变为无值，不等同 ROM 故障。历史没保存的字段不回填。
- `context.sameAsset=false` 时不对单一设备下回归结论；`baselineEarlier=false` 时先核对顺序。普通客户端证据标注 `attestation:not_verified`。通过两个报告 ID 回溯原始证据。
- `expectedNetwork` 为空或省略表示不要求。可选 `wifi/cellular/ethernet/vpn/none`，仅比较报告记录的默认传输，并不证明蜂窝已注册或互联网联通。导出附加 `context.network`：三侧值（未确认或不要求为 null）与 `not_required/matched/mismatch/insufficient`，不改变安全字段的判定。Android「复测准备」显示即时授权，不回填旧报告权限。
- 可复现链接：`#security?report=<current>&baseline=<before>&saved=<baseline-id>`，可显式附 `expectUnlock=1` 或 `expectUnlock=0` 覆盖该次实验预期；链接仍需管理会话。
- 入场链接 `#security?report=<current>&mode=retest` 不带基线，不会自动得出比较结果。未归组与已知不同设备分开标识，两者都不应用同设备的预期解锁条件。
