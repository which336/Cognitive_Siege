# CSV 字段字典

这份字典给策划调表时对照使用。运行时 CSV 的字段名不要随意改名，尤其是英文表头；程序按这些名字读取。所有 CSV 建议保存为 UTF-8。

## 通用枚举

| 值 | 含义 |
| --- | --- |
| `level_1` | 第 1 关，失眠首夜，基础教学关 |
| `level_2` | 第 2 关，呼吸错拍 |
| `level_3` | 第 3 关，镜室回声 |
| `level_4` | 第 4 关，枯井沉降 |
| `level_5` | 第 5 关，边界裂隙 |
| `level_6` | 第 6 关，整合审判 |
| `short` | 短快路线 |
| `long` | 长绕路线 |
| `edge` | 边路 / 偷路路线 |
| `anxiety` | 焦虑 |
| `depression` | 抑郁 |
| `obsession` | 强迫 |
| `guilt` | 自责 |
| `ptsd` | 创伤 |
| `stealth` | 隐身 / 伪装，需要破隐能力处理 |
| `swarm` | 群体密集压力 |
| `rush` | 快冲 |
| `split` | 分兵 / 分裂节奏 |
| `taunt` | 嘲讽，吸引塔火力 |
| `shield` | 护盾 / 厚前排 |

## level_config.csv

| 字段 | 中文含义 | 填写说明 |
| --- | --- | --- |
| `level_id` | 关卡 ID | 使用 `level_1` 到 `level_6`，其他关卡表用它关联。 |
| `中文名` | 关卡名 | 显示给玩家。 |
| `主题` | 关卡主题 | 策划和 UI 用的简短主题。 |
| `规则` | 特殊规则枚举 | 当前为 `tutorial / breath_phase / echo_group / scarcity / fracture_edge / trial_elite`。 |
| `全局HP倍率` | 本关心魔 HP 总倍率 | 1 表示不变，1.08 表示全关 HP 提高 8%。 |
| `全局速度倍率` | 本关心魔速度总倍率 | 1 表示不变，0.98 表示整体略慢。 |
| `念力补给倍率` | 本关波次念力奖励倍率 | 影响 `wave_config.csv` 中的本波念力补给。 |
| `描述` | 策划说明 | 不直接参与战斗逻辑。 |

## wave_config.csv

| 字段 | 中文含义 | 填写说明 |
| --- | --- | --- |
| `level_id` | 关卡 ID | 对应 `level_config.csv`。 |
| `波次` | 第几波 | 每个关卡必须覆盖 1-10。 |
| `波次主题` | 波次标题 | 显示或调试用。 |
| `是否Boss` | Boss 波标记 | 填 `是` 或 `否`。每关至少应有 1 个 Boss 波。 |
| `基础阵型` | 默认阵型 | 常用 `scattered / clustered / wedge / rear_first`。 |
| `本波念力补给` | 开波补给念力 | 会再乘以关卡的 `念力补给倍率`。 |
| `路线开放规则` | 玩家可读路线说明 | 文案说明，不应和实际开放路线冲突。 |
| `开放心魔` | 本波教学或提示心魔 | 可用中文或策划说明。 |
| `开放技能` | 本波教学或提示技能 | 可写 `stealth / shield` 等。 |
| `设计目标` | 策划意图 | 用于调参和复盘，不直接参与战斗逻辑。 |

## wave_spawn_groups.csv

| 字段 | 中文含义 | 填写说明 |
| --- | --- | --- |
| `level_id` | 关卡 ID | 对应 `level_config.csv`。 |
| `波次` | 第几波 | 与 `wave_config.csv` 对齐。 |
| `组序` | 出怪组顺序 | 同一波内从小到大排。 |
| `心魔` | 心魔类型 | 使用 `anxiety / depression / obsession / guilt / ptsd`。 |
| `数量` | 本组数量 | 正整数。Boss 通常是 1。 |
| `首个delayMs` | 首只出场延迟 | 单位毫秒。也可用 `/` 写逐只延迟列表，数量必须和 `数量` 一致。 |
| `间隔Ms` | 同组间隔 | 单位毫秒。 |
| `HP倍率` | 本组 HP 倍率 | 1 表示基础值，14 这类大数通常用于 Boss。 |
| `速度倍率` | 本组速度倍率 | 1 表示基础值，0.7 表示更慢。 |
| `路线倾向` | 主要刷怪路线 | 使用 `short / long / edge`。最终路线仍受开放路线限制。 |
| `技能` | 技能标签 | 可空。多个技能可用 `/`、`|`、`;`、空格或顿号分隔。 |
| `备注` | 策划说明 | 不直接参与战斗逻辑。 |

## map_routes.csv

| 字段 | 中文含义 | 填写说明 |
| --- | --- | --- |
| `level_id` | 关卡 ID | 每关都应配置 3 条路线。 |
| `route` | 路线 ID | `short / long / edge`。 |
| `seq` | 路点顺序 | 从 1 开始，按移动顺序填写。 |
| `col` | 格子列坐标 | 棋盘横向坐标，整数。 |
| `row` | 格子行坐标 | 棋盘纵向坐标，整数。 |
| `note` | 路点备注 | 例如 spawn、fork、merge、core。 |

说明：相邻路点之间必须是水平或垂直折线，运行时会自动补齐中间格。

## map_build_cells.csv

| 字段 | 中文含义 | 填写说明 |
| --- | --- | --- |
| `level_id` | 关卡 ID | 对应地图关卡。 |
| `route` | 关联路线 | `short / long / edge`，表示这个塔位主要服务哪条路线。 |
| `col` | 格子列坐标 | 可建造格横坐标。 |
| `row` | 格子行坐标 | 可建造格纵坐标。 |
| `note` | 塔位备注 | 例如 choke、core guard、resource island。 |

## map_route_rules.csv

| 字段 | 中文含义 | 填写说明 |
| --- | --- | --- |
| `level_id` | 关卡 ID | 对应地图关卡。 |
| `min_wave` | 起始波次 | 规则从第几波开始生效。 |
| `max_wave` | 结束波次 | 规则到第几波结束，可和 `min_wave` 相同。 |
| `primary_route` | 主策略路线 | 当前主路线是 `short / long / edge` 时使用这条规则。 |
| `open_routes` | 实际开放路线 | 用 `short|long|edge` 这种竖线分隔。 |
| `note` | 策划说明 | 不直接参与战斗逻辑。 |

说明：这张表是路线保底规则。LLM 复盘可以改变路线倾向，但不能把怪刷到未开放路线。

## map_elements.csv

| 字段 | 中文含义 | 填写说明 |
| --- | --- | --- |
| `level_id` | 关卡 ID | 地图物属于哪一关。 |
| `id` | 地图物唯一 ID | 同一关内不要重复。 |
| `kind` | 地图物类型 | `breath_vent / mirror_gate / dry_well / fracture_node / trial_obelisk`。 |
| `wave_start` | 生效起始波 | 从第几波出现。 |
| `wave_end` | 生效结束波 | 到第几波消失。 |
| `col` | 格子列坐标 | 地图物中心横坐标。 |
| `row` | 格子行坐标 | 地图物中心纵坐标。 |
| `radius_cells` | 影响半径 | 单位是格。 |
| `hp` | 血量 | 0 表示主要不是攻击目标；可攻击地图物用正数。 |
| `reward` | 击破奖励 | 击破后给玩家的念力。 |
| `cooldown_ms` | 冷却时间 | 单位毫秒。呼吸阀用来控制相位切换。 |
| `effect_mul` | 效果倍率 | 1.22 表示 22% 加速或等价倍率，具体含义由 `kind` 决定。 |
| `pair_id` | 配对 ID | 镜门成对使用，同一对填写相同值。可空。 |
| `route` | 关联路线 | `short / long / edge`，用于镜门、裂隙等路线机制。可空。 |
| `note` | 策划说明 | 不直接参与战斗逻辑。 |

各类型重点：

| `kind` | 作用 | 常调字段 |
| --- | --- | --- |
| `breath_vent` | 呼吸阀；每隔 `cooldown_ms` 切换吸气/呼气，吸气加速附近心魔，呼气提高附近心魔受伤 | `radius_cells / cooldown_ms / effect_mul` |
| `mirror_gate` | 镜门；心魔穿过后延迟生成配对路线回声体，击破任意一侧可关闭后续回声 | `hp / reward / cooldown_ms / effect_mul / pair_id / route` |
| `dry_well` | 枯井；高血量资源点，存活时压制半径内塔位和普通残堆，击破后返念力、释放塔位且本局后续波次不再出现 | `hp / reward / radius_cells / wave_start / wave_end` |
| `fracture_node` | 裂隙节点；存活时让边路心魔在半径内短时加速，边界桩在半径内可压制，击破后关闭该区域效果 | `hp / reward / radius_cells / effect_mul / route` |
| `trial_obelisk` | 审判碑；强化半径内精英，提供护盾、嘲讽优先级和减伤，可被塔优先拆除 | `hp / reward / radius_cells / effect_mul` |

## tutorial_config.csv

| 字段 | 中文含义 | 填写说明 |
| --- | --- | --- |
| `level_id` | 关卡 ID | 哪一关的提示。 |
| `波次` | 第几波显示 | 和战斗波次对应。 |
| `标题` | 教学提示标题 | 简短，不要遮挡太多视野。 |
| `正文` | 教学提示正文 | 解释当前机制，不要写死与实际路线冲突的路线数量。 |
| `开放内容` | 本次提示关联内容 | 例如 `breath_phase`、`Boss谈判`。 |
| `玩家应学会的操作` | 操作目标 | 用于策划自检。 |
| `动态路线说明` | 运行时路线提示说明 | 可选。为空则不显示；用于解释下方路线状态会随实际开放路线刷新。 |

## tower_config.csv

| 字段 | 中文含义 | 填写说明 |
| --- | --- | --- |
| `id` | 塔 ID | 程序使用的塔类型 ID。 |
| `中文名` | 塔名 | 显示给玩家。 |
| `定位` | 策略定位 | 例如 AOE、单体、破隐、阻挡。 |
| `放置位置` | 可放置类型 | 普通塔位或路线格。 |
| `基础价格` | 建造花费 | 消耗念力。 |
| `基础射程` | 初始射程 | 单位按格子尺度换算。 |
| `基础射速_每秒` | 初始每秒攻击次数 | 越大攻击越快。 |
| `基础伤害` | 初始单次伤害 | 影响常规攻击。 |
| `溅射半径` | AOE 半径 | 0 表示无溅射。 |
| `百分比当前生命` | 百分比伤害 | 按目标当前生命造成额外伤害。 |
| `阻挡耐久` | 阻挡生命 | 主要给边界桩使用；边界桩会压制接触中的创伤闪回位移。 |
| `升L2费用` / `升L3费用` | 升级花费 | 消耗念力。 |
| `L2伤害` / `L3伤害` | 升级后伤害 | 塔到对应等级时使用。 |
| `L2射程` / `L3射程` | 升级后射程 | 塔到对应等级时使用。 |
| `L2射速` / `L3射速` | 升级后射速 | 塔到对应等级时使用。 |
| `设计用途` | 策划说明 | 不直接参与战斗逻辑。 |

## enemy_config.csv

| 字段 | 中文含义 | 填写说明 |
| --- | --- | --- |
| `id` | 心魔 ID | `anxiety / depression / obsession / guilt / ptsd`。 |
| `中文名` | 心魔名 | 显示给玩家。 |
| `基础HP` | 基础生命 | 会被波次、关卡和难度倍率影响。 |
| `基础速度` | 基础移动速度 | 会被波次、关卡和技能倍率影响。 |
| `击杀念力` | 击杀奖励 | 击杀该心魔给玩家的念力。 |
| `抵达SAN伤害` | 漏怪伤害 | 抵达核心时扣除的理智值。 |
| `行为标签` | 行为概述 | 例如 rush、slow、loop、cloak。 |
| `路线偏好` | 偏好路线说明 | 文案说明，实际权重在 `enemy_route_preferences.csv`。 |
| `主要威胁` | 威胁说明 | 给玩家或策划理解用。 |
| `推荐应对` | 推荐策略 | 用于说明塔种克制。 |
| `首次教学波` | 首次教学波次 | 控制教学节奏参考。 |

## enemy_route_preferences.csv

| 字段 | 中文含义 | 填写说明 |
| --- | --- | --- |
| `enemy` | 心魔 ID | `anxiety / depression / obsession / guilt / ptsd`。 |
| `priority` | 偏好优先级 | 数字越小越优先。 |
| `route` | 偏好路线 | `short / long / edge`。 |
| `note` | 说明 | 不直接参与战斗逻辑。 |

## route_strategy_weights.csv

| 字段 | 中文含义 | 填写说明 |
| --- | --- | --- |
| `key` | 权重项 | `strategy_route_weight / kind_preference_weight / random_route_weight`。 |
| `value` | 权重值 | 当前为 0.7 / 0.2 / 0.1，建议总和接近 1。 |
| `note` | 说明 | 不直接参与战斗逻辑。 |

## mind_cache_config.csv

| 字段 | 中文含义 | 填写说明 |
| --- | --- | --- |
| `key` | 配置项 | 普通念力残堆的数量、血量、奖励、生成限制等。 |
| `value` | 配置值 | 数字或枚举，由具体 key 决定。 |
| `note` | 说明 | 不直接参与战斗逻辑。 |

说明：普通念力残堆在这里调；`dry_well` 枯井在 `map_elements.csv` 调。枯井的 `radius_cells` 同时控制压制范围和击破后可释放塔位的候选范围。

## difficulty_config.csv

| 字段 | 中文含义 | 填写说明 |
| --- | --- | --- |
| `difficulty` | 难度 ID | 例如 easy、normal、hard。 |
| `sanity_start` | 初始理智 | 开局 SAN。 |
| `sanity_max` | 理智上限 | SAN 最大值。 |
| `mind_start` | 初始念力 | 开局可用念力。 |
| `note` | 难度说明 | 不直接参与战斗逻辑。 |

## wave_scaling_config.csv

| 字段 | 中文含义 | 填写说明 |
| --- | --- | --- |
| `key` | 成长配置项 | 控制逐波 HP、速度、伤害、奖励、Boss 额外倍率等。 |
| `value` | 配置值 | 数字，由具体 key 决定。 |
| `note` | 说明 | 不直接参与战斗逻辑。 |

## boss_combat_config.csv

| 字段 | 中文含义 | 填写说明 |
| --- | --- | --- |
| `category` | Boss 配置类别 | 例如技能归属、召唤、核心压迫、护盾等类别。 |
| `key` | 配置项 | 具体参数名。 |
| `value` | 配置值 | 数字、ID 或枚举，由具体 key 决定。 |
| `note` | 说明 | 不直接参与战斗逻辑。 |

Boss 技能 ID 使用 `anxiety_core / depression_core / obsession_core / guilt_core / ptsd_core`。实际战斗优先按 Boss 本体心魔类型选择技能；`wave_skill` 只作为找不到本体类型时的兜底。

`category` 常见取值：

| `category` | 含义 | `key/value` 怎么看 |
| --- | --- | --- |
| `global` | Boss 通用战斗节奏 | `key` 是参数名，`value` 是数值，例如召唤间隔、压核心扣 SAN 间隔。 |
| `wave_skill` | 波次兜底技能 | `key` 是波次，`value` 是 Boss 技能 ID。只有找不到 Boss 本体类型时才用。 |
| `skill_display` | 技能显示名 | `key` 是 Boss 技能 ID，`value` 是 UI 横幅里显示的中文名。 |
| `skill_aura_speed_mul` | 焦虑 Boss 光环加速 | `key` 是技能 ID，`value` 是速度倍率。 |
| `skill_enraged_damage_mul` | 焦虑 Boss 狂暴伤害 | `key` 是技能 ID，`value` 是攻击倍率。 |
| `skill_shield_max_hp_ratio` | 护盾比例 | `key` 是技能 ID，`value` 是按最大生命折算的护盾比例。 |
| `skill_enraged_damage_taken_mul` | 狂暴减伤 | `key` 是技能 ID，`value` 是受伤倍率；低于 1 表示减伤。 |
| `minion_kind` | Boss 召唤的小怪类型 | `key` 是技能 ID，`value` 是 `anxiety/depression/obsession/guilt/ptsd`。 |
| `minion_hp_mul` | 召唤小怪血量倍率 | `key` 是技能 ID，`value` 是 HP 倍率。 |
| `minion_speed_mul` | 召唤小怪速度倍率 | `key` 是技能 ID，`value` 是速度倍率。 |
| `minion_path_bias` | 召唤小怪路线倾向 | `key` 是技能 ID，`value` 是 `short/long/edge`。 |
| `minion_skills` | 召唤小怪技能标签 | `key` 是技能 ID，`value` 可为空，多个技能用 `|` 分隔。 |

## ai_safety_config.csv

| 字段 | 中文含义 | 填写说明 |
| --- | --- | --- |
| `类别` | 安全阀类别 | 当前包括心魔开放、技能开放、侵略度限制、路线开放、复盘改表。 |
| `key` | 控制项 | 心魔 ID、技能 ID 或策略名。 |
| `生效条件` | 何时生效 | 例如第 4 波起、第 1-4 波。 |
| `配置值` | 限制值 | 例如允许、-0.25到0.25。 |
| `设计目的` | 策划意图 | 解释为什么要限制 LLM 或复盘改表。 |

说明：这张表是防止复盘策略破坏教学节奏和关卡结构的安全阀。玩家界面不展示这些内部优先级。
