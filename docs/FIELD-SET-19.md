# 字段集 19：身份字段与一致性（实现契约）

本轮在字段集 18 的基础上增加**同一观察者内部**的身份字段，用来发现「Build 声明」与「只读属性声明」互相矛盾的情况。它们不增加权限，不改变既有字段语义。

## 1. 新增字段（system 组，since 19）

| 键 | 标签 | 来源 | AVAILABLE 值格式 | Go 校验 |
| --- | --- | --- | --- | --- |
| `system.boardPlatform` | 平台代号声明 | `getprop ro.board.platform` | `^[a-z0-9_.-]{1,32}$`（如 `mt6985`、`sdm845`、`gs101`） | 正则 |
| `system.bootHardware` | 启动硬件声明 | `getprop ro.boot.hardware` | `^[a-z0-9_.-]{1,32}$`（如 `mtk`、`qcom`、`oriole`） | 正则 |
| `system.hardwareSku` | 启动硬件 SKU | `getprop ro.boot.hardware.sku` | `^[A-Za-z0-9._-]{1,32}$`（如 `GR1YH`、`23078PND5G`） | 正则 |

属性未设置或对当前应用不可见 → `UNAVAILABLE / NOT_REPORTED`。说明写明「只读属性，与 Build.* 是两条独立来源」。

## 2. 一致性对照（三对）

| 对 | 字段 |
| --- | --- |
| 主板 | `system.board`（Build.BOARD） ↔ `system.boardPlatform`（ro.board.platform） |
| 硬件 | `cpu.hardware`（Build.HARDWARE） ↔ `system.bootHardware`（ro.boot.hardware） |
| SKU | `system.sku`（Build.SKU，API 31+） ↔ `system.hardwareSku`（ro.boot.hardware.sku） |

判定：任一对两侧都 `AVAILABLE` 且值不同（忽略大小写）→ 冲突；至少一对可比且全部相同 → 一致；没有任何一对可比 → 证据不足。冲突只写「同一观察者内部两组声明不一致，先核对 ROM 属性改写」，不判定真伪。

## 3. LAN 契约

- `LanFieldSetVersion = 19`；`latestFieldSet = 19`；`dictionaryVersion = sigmark-lan-fields/9`。
- 静态键 222 个（219 + 3），`fieldSet >= 19` 时 `maxFields = 246`（222 + 24）。
- 新键写入 `app/src/test/resources/lan-projection-v19.txt`（排序、去重，222 行）。

## 4. 规则版本

- 前端安全规则 `rom-evidence/4`：新增检查项 `identity_fields`，标题「身份字段一致性」，依据上述六字段；状态 `review`（冲突）/ `observed`（一致）/ `unknown`（不可比）。
- 设备风险画像 `sigmark-profile/3`：在现有 8 个标签**末尾追加** `identity_conflict`（顺序固定，不要插队），依据同样六字段；冲突命中，一致未见，缺证据不足；`historyRestricted` 统计任一依据字段受限的历史样本数。
- App「指纹安全」增加同名本地行 `identity_fields`。

## 5. ADB 观察文件 v4

`sigmark-adb-evidence/4` 在 v3 基础上增加三个 shell 读数：`system.boardPlatform`、`system.bootHardware`、`system.hardwareSku`。比较规则：一致 → 「读数一致」；不一致 → 「读数不同：App 与 shell 身份字段不一致（同一属性可能按上下文改写）」。v1–v3 继续可读。

## 6. 验收

`.\gradlew.bat :app:assembleDebug :app:testDebugUnitTest`、`cd backend && go test ./...`、`cd backend/web && npm test && npm run build`、`cd tools && python -B -m unittest`。版本升到 1.10.0 / 37。
