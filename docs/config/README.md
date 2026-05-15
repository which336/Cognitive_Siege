# 认知围城配置表说明

这些表分为两处同步维护：

- `public/config/`：运行时读取表，Vite 打包后会进入 `dist/config/`。
- `docs/config/`：与运行时配置同步的策划副本，用于版本评审、调参记录和非工程同学查看。

当前运行时配置共 17 张 CSV，`docs/config` 的 CSV 文件清单应与 `public/config` 保持一致。游戏启动时由 `BootScene` 调用 `loadExternalConfig()` 读取 CSV。任意关键 CSV 读取、解析或校验失败时，会回退到 TypeScript 内置默认值；主菜单“配置校验”会显示实际加载数量和具体错误定位。

字段含义、枚举和数值单位见 [FIELD_DICTIONARY.md](./FIELD_DICTIONARY.md)。调表时优先查这份字典，不要直接改运行时依赖的表头。

## 配置表索引

| 表 | 作用 |
| --- | --- |
| `level_config.csv` | 1-6 关的关卡名、主题、特殊规则、全局 HP / 速度 / 念力补给倍率。 |
| `tower_config.csv` | 6 种念头塔的价格、定位、基础数值、升级展示口径。 |
| `enemy_config.csv` | 5 类心魔的基础属性、行为标签、路线偏好、威胁说明。 |
| `wave_config.csv` | 每个 `level_id` 下 1-10 波的主题、Boss 标记、阵型、念力补给、开放内容和设计目标。 |
| `wave_spawn_groups.csv` | 每个 `level_id` 下的实际出怪组，按同类连续出怪压缩，运行时展开成逐只 spawn。 |
| `ai_safety_config.csv` | Review Agent / EvolutionApplier 共用的安全阀，包括心魔开放、技能开放、侵略度限制。 |
| `tutorial_config.csv` | 战斗内教学提示。第 2-6 关提示只讲本关机制，路线提示由运行时结合实际开放路线补充。 |
| `map_routes.csv` | 每个 `level_id` 的 `short / long / edge` 路线 waypoint，运行时展开成连续路径格。 |
| `map_build_cells.csv` | 每个 `level_id`、每条主路线对应的固定可建造格。 |
| `map_route_rules.csv` | 每个 `level_id` 下不同波次和主路线的开放路线规则。 |
| `map_elements.csv` | 第 2-6 关的强机制地图物：呼吸阀、镜门、枯井、裂隙、审判碑。 |
| `enemy_route_preferences.csv` | 不同心魔的路线偏好，例如焦虑优先短线，抑郁优先长线。 |
| `route_strategy_weights.csv` | 复盘路线策略、心魔个性路线、随机扰动三者的抽样权重。 |
| `mind_cache_config.csv` | 念力残堆数量、血量、奖励、生成距离规则。 |
| `difficulty_config.csv` | 不同难度的开局理智上限、初始理智和初始念力。 |
| `wave_scaling_config.csv` | 逐波 HP、速度、伤害、奖励成长曲线，以及 Boss 额外倍率。 |
| `boss_combat_config.csv` | Boss 通用战斗参数，包括技能归属、召唤间隔、核心压迫、光环、护盾和召唤物参数；运行时优先按 Boss 本体心魔类型选择技能。 |

## 关卡口径

- 第 1 关 `level_1` 是教学关，保留原 10 波教学节奏。
- 第 2-6 关是完整新增关卡，每关 10 波，默认基础塔、心魔和基础技能已解锁。
- 第 2-6 关的前 2-3 波只教学本关强机制；第 5 波前形成第一次机制考验；第 10 波是终局压力波。
- 新增规则枚举为 `breath_phase / echo_group / scarcity / fracture_edge / trial_elite`。

## 地图与机制口径

- 每个 `level_id` 都必须有 `short / long / edge` 三条路线，但不要求每波都三线同时开放。
- `map_route_rules.csv` 决定保底开放路线；实际刷怪路线还会结合 `wave_spawn_groups.csv`、心魔路线偏好和复盘策略抽样。
- `map_elements.csv` 的 `kind` 取值为 `breath_vent / mirror_gate / dry_well / fracture_node / trial_obelisk`。
- `mirror_gate / dry_well / fracture_node / trial_obelisk` 是可被塔攻击的地图物；`breath_vent` 主要提供区域相位效果。
- `mirror_gate` 会复制首次穿过镜门的心魔，约 5.5 秒后从配对路线生成半血回声体；摧毁成对镜门中的任意一侧，可让本波后续回声失效。
- 存活的 `dry_well` 会压制 `radius_cells` 半径内塔位和普通念力残堆，玩家不能在压制格建塔或塑形；击破后返还念力、释放塔位，并在本局后续波次保持已清除状态。
- `fracture_node` 会强化边路压力，让边路心魔在裂隙范围内短时加速；边界桩放在裂隙半径内可以压制加速，摧毁裂隙可关闭该区域效果。
- 第 2-6 关的专属地图物效果必须在 `tutorial_config.csv` 前 3 波讲清楚；运行时提示只展示玩家需要知道的效果，不展示内部优先级。
- 地图元素位图资源位于 `public/assets/art`，文件名为 `map-breath-vent.png`、`map-mirror-gate.png`、`map-dry-well.png`、`map-fracture-rift.png`、`map-trial-obelisk.png`；资源缺失时保留程序绘制兜底。

## 内部冲突处理

以下是实现口径，不直接显示给玩家：

- LLM 复盘策略可以改变下一波路线倾向、阵型、技能、心魔种类和侵略度。
- 实际刷怪路线以当前波可开放路线为边界，不能把心魔分配到未开放或不存在的路线。
- 关卡保底机制负责兜底路线开放、地图元素和特殊规则，避免 LLM 输出破坏关卡结构。
- 教学提示只解释玩家当前需要理解的机制；路线文本应来自运行时实际开放路线，避免出现“只开一条路却提示短路长路”的矛盾。

## 校验重点

- 17 张运行时 CSV 必须非空，必填列和枚举值必须合法。
- `level_config.csv` 的 `level_id` 必须覆盖所有关卡范围表。
- `wave_config.csv` 与 `wave_spawn_groups.csv` 必须在每个 `level_id` 下覆盖 1-10 波，且每关至少有 1 个 Boss 波。
- `map_routes.csv` 必须为每个 `level_id` 提供 3 条路线；waypoint 必须是水平或垂直折线，运行时会自动补齐中间格。
- `map_route_rules.csv` 必须覆盖每个 `level_id` 的 1-10 波，`open_routes` 使用 `short|long|edge` 格式。
- 第 2-6 关必须至少配置 1 个 `map_elements.csv` 地图元素。
- `tutorial_config.csv` 不应写死与实际地图冲突的路线数量；路线差异由运行时补充。

## 后续可做

- 建立 XLSX / Google Sheet 到 CSV 的导出流程，降低手工维护成本。
- 把复盘文案模板、Boss 谈判角色和默认对话继续外置。
