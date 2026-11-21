# ROM 回归：从报告到复测

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

对比导出格式为 `kind=sigmark.regression`、`schemaVersion=1`，含 `baseline` / `current`（报告 ID、批次、采样时间、App 采集器和字段集）、`savedBaseline`（可空的 ID、名称）、`context`、`counts`、`verdicts` 和 `checks`。不附原报告正文、任意测试反馈、资产 UUID 或安装标记。

- `checks[]` 以 `group.key` 标识，含 `verdict`（`review/expected/insufficient/changed/unchanged`）、说明、两侧 `{value,status,source,reason,errno}`；未归档侧为 null。自动流程不靠中文措辞判断。
- `counts` 包含 `bothArchived/baselineOnly/currentOnly/lostValue/gainedValue`。`lostValue` 指双方都归档且由有值变为无值，不等同 ROM 故障。历史没保存的字段不回填。
- `context.sameAsset=false` 时不对单一设备下回归结论；`baselineEarlier=false` 时先核对顺序。普通客户端证据标注 `attestation:not_verified`。通过两个报告 ID 回溯原始证据。
- `expectedNetwork` 为空或省略表示不要求。可选 `wifi/cellular/ethernet/vpn/none`，仅比较报告记录的默认传输，并不证明蜂窝已注册或互联网联通。导出附加 `context.network`：三侧值（未确认或不要求为 null）与 `not_required/matched/mismatch/insufficient`，不改变安全字段的判定。Android「复测准备」显示即时授权，不回填旧报告权限。
- 可复现链接：`#security?report=<current>&baseline=<before>&saved=<baseline-id>`，可显式附 `expectUnlock=1` 或 `expectUnlock=0` 覆盖该次实验预期；链接仍需管理会话。
- 入场链接 `#security?report=<current>&mode=retest` 不带基线，不会自动得出比较结果。未归组与已知不同设备分开标识，两者都不应用同设备的预期解锁条件。
