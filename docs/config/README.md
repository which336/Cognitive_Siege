# 认知围城配置表说明

这些表分为两处同步维护：

- `docs/config/`：策划源表，适合版本管理、面试展示和继续调参。
- `public/config/`：运行时读取表，Vite 打包后会进入 `dist/config/`。

游戏启动时由 `BootScene` 调用 `loadExternalConfig()` 读取 CSV。任意关键 CSV 读取、解析或校验失败时，会保留 TypeScript 内置默认值，Demo 不会因为缺表或错表直接崩溃。

## 已接入运行逻辑

- `tower_config.csv`：6 种念头塔的价格、定位、基础数值、升级展示口径。
- `enemy_config.csv`：5 类心魔的基础属性、行为标签、威胁说明。
- `wave_config.csv`：10 晚 / 10 波的主题、Boss 标记、阵型、念力补给、路线开放说明。
- `wave_spawn_groups.csv`：每波出怪组，按同类连续出怪压缩，运行时展开成逐只 spawn。
- `ai_safety_config.csv`：Review Agent / EvolutionApplier 共用的教学安全阀，包括心魔开放、技能开放、侵略度限制。
- `tutorial_config.csv`：战斗内教学提示，运行时由教学面板读取。
- `map_routes.csv`：三条路线的 waypoint 配置，运行时展开成连续路径格。
- `map_build_cells.csv`：每条主路线对应的固定可建造格。
- `map_route_rules.csv`：不同波次和主路线下实际开放哪些路线。
- `enemy_route_preferences.csv`：不同心魔的路线偏好，例如焦虑优先短线，抑郁优先长线。
- `route_strategy_weights.csv`：Review Agent 路线策略、心魔个性路线、随机路线三者的权重。
- `mind_cache_config.csv`：念力残堆数量、血量、奖励、生成距离规则。
- `difficulty_config.csv`：不同难度的开局理智上限、初始理智和初始念力。
- `wave_scaling_config.csv`：逐波 HP、速度、伤害、奖励成长曲线，以及 Boss 额外倍率。
- `boss_combat_config.csv`：Boss 技能归属、召唤间隔、核心压迫伤害、光环、护盾和召唤物参数。

## 运行机制

- 校验口径：加载后会检查必填行、枚举、数字范围、技能列表、路线列表和 1-10 波完整性；错误会在控制台显示 `表名:行号 字段 原因`。
- 波次口径：`wave_config.csv` 提供波次元信息，`wave_spawn_groups.csv` 提供实际出怪组。
- AI 口径：LLM prompt、sanitize、EvolutionApplier 使用同一套安全阀，避免提示和实际改表规则不一致。
- 地图口径：`Grid` 优先读取地图 CSV；地图 CSV 缺失或不合法时，回退到代码内置路线和塔位。
- 路线口径：`pickRouteForEnemy()` 会综合复盘策略、心魔路线偏好和随机扰动，避免所有怪物机械地走同一条线。
- 资源口径：念力残堆生成不再写死在战斗场景里，数量、血量、奖励和生成半径都由 CSV 控制。
- 难度口径：开局理智 / 念力、逐波成长曲线和 Boss 战斗参数都可以通过 CSV 调整。
- UI 口径：主菜单提供“配置校验”入口；也可以访问 `/?config` 直接打开配置校验报告。

## 字段约定

- `hpMul` / `speedMul`：波次对心魔基础属性的倍率。
- `delayMs`：从本波战斗开始后的出怪时间。
- `技能`：使用 `stealth / swarm / rush / split / taunt / shield`。
- 第 6 波起固定开放三条路线：短快主干、长绕路线、边偷路线。
- `map_routes.csv` 的路线 waypoint 必须是水平或垂直相邻折线；运行时会自动补齐中间格。
- `map_route_rules.csv` 的 `open_routes` 使用 `short|long|edge` 这种竖线分隔格式。

## 后续可做

- 把复盘文案模板、Boss 谈判角色和默认对话继续外置。
- 建立 XLSX / Google Sheet 到 CSV 的导出流程，降低手工维护成本。
