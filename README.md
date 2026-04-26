# 认知围城 / Cognitive Siege

> 在意识深处布防，对抗一群越打越聪明、还会跟你谈判的心魔——一场把心理治疗变成塔防博弈的「认知围城」。

LLM 驱动的自适应塔防 Web 游戏 / 游戏策划作品集 MVP。
玩家扮演**认知工程师**，进入失眠者的潜意识，对抗会**复盘、会谈判、会进化**的心魔。

## 核心创新

| 系统 | 说明 |
|------|------|
| 复盘 Agent | 每波结束，LLM 扮演"刚战败的心魔集体意识"输出独白 + 学到的东西 + 下一波策略 JSON |
| Evolution Applier | 把 next_strategy 真实应用到下一波生成器：路线偏好 / 编队 / 技能 / 攻势 / 阵容 |
| 谈判 Boss 战 | Boss 出场前与玩家多轮对话，玩家选项（共情/对峙/欺骗）真实改变 Boss 战参数 |
| 心魔人格化 | 5 种心魔，每种 4+ 个独立人格档案（名字/动机/台词），LLM 复盘时会引用它们 |
| 双资源 | 念力建塔 + 理智值（SAN）核心生命；理智过低触发"幻觉塔"，Boss 到核心会持续压迫 SAN |
| 塔管理 | 已建塔可升级到 3 级或拆除返还部分念力，后期需要动态换阵 |
| 战斗可读性 | 每波只展示并使用一条主路线，入侵点/自我核心与格子状态都有独立视觉层级 |
| 导演 Agent | 每关开场生成 80-120 字患者今晚情绪 vignette，建立代入感 |

## 技术栈

- 引擎：Phaser 3
- 语言：TypeScript
- 构建：Vite
- LLM：OpenAI 兼容接口（DeepSeek / 智谱 / Moonshot / Ollama / OpenAI 任意）
- 存储：localStorage（仅本地保存设置与 API Key）

## 开发

```bash
npm install
npm run audio:generate  # 可选：重新生成 public/assets/audio/*.wav
npm run dev      # http://localhost:5180
npm run build    # 产物在 dist/
npm run preview
```

## 音效

当前版本已从纯 WebAudio 蜂鸣升级为真实 WAV 资源：

- 音频文件位于 `public/assets/audio/`，由 `scripts/generate-audio.mjs` 生成。
- `AudioManager` 会优先播放 Phaser 缓存里的 WAV；如果文件缺失或浏览器阻止播放，会回退到 Web Audio 合成。
- 音色方向是“梦境塔防”：柔和钟琴、空气噪声、低频 SAN 冲击和胜负 stinger。
- 后续也可以替换为 CC0 素材包，例如 Kenney Interface Sounds / UI Audio / Impact Sounds。

## 演示模式

默认开启**演示模式**——所有 LLM 调用走本地预生成"心声库"（10+ 套预设独白 + 全部 Boss 对话）。
招聘方点击链接即可游玩，无需任何 API Key。

要启用真实 LLM：

1. 主菜单点 `设置`
2. 取消勾选 `演示模式`
3. 填入 `API Base`（例如 `https://api.deepseek.com`）+ `Model`（例如 `deepseek-chat`）+ `API Key`
4. 保存即可

## 当前可玩特性

- 共 10 波，每次从主菜单重新进入都会从第 1 波重新开始，并按当前难度回满 SAN。
- 4 种念头塔：美好回忆塔、信念塔、共鸣塔、自我接纳塔；已建塔可升级到 LV3，也可拆除返还部分念力。
- 5 种人格化心魔：焦虑、抑郁、强迫、自责、创伤；强迫循环者会触发"强迫复读"加速附近同伴。
- 每波只显示并执行一条主路线，避免多路线叠加造成布防误判。
- Boss 到达自我核心后不会消失，会持续扣除 SAN；SAN 归零即失败。
- 游戏内 CODEX 只保留核心机制与塔/心魔档案，基础操作直接由 HUD 与弹窗反馈承担。

## 上线部署

### GitHub Pages（推荐）

1. 在 GitHub 新建仓库，把本项目推上去。
2. 本地运行：

```bash
npm install
npm run audio:generate
npm run build
npm run deploy:pages
```

3. 脚本会生成 `.gh-pages-out/`，按终端提示进入该目录并推送到 `gh-pages` 分支：

```bash
cd .gh-pages-out
git init
git checkout -b gh-pages
git add -A
git commit -m "deploy"
git remote add origin <你的仓库地址>
git push -f origin gh-pages
```

4. 到 GitHub 仓库 `Settings -> Pages`，Source 选择 `Deploy from a branch`，Branch 选择 `gh-pages / root`。
5. 等 1-3 分钟，GitHub 会给出可访问链接。

### Vercel / Netlify / Cloudflare Pages

- Build command: `npm run build`
- Output directory: `dist`
- 如果平台支持 Install command，可填 `npm install && npm run audio:generate`

## 项目结构

```text
cognitive-siege/
├── src/
│   ├── main.ts                       Phaser 入口
│   ├── style.css                     超现实视觉主题
│   ├── types.ts                      共享类型
│   ├── settings.ts                   localStorage 设置
│   ├── game/
│   │   ├── data/                     数据：心魔/塔/人格/波次/Fallback 库
│   │   ├── entities/                 Tower / Enemy 实体
│   │   ├── systems/                  Grid / WaveSystem / EvolutionApplier / BattleLog
│   │   ├── llm/                      reviewAgent / negotiationAgent / directorAgent / client
│   │   └── scenes/                   Boot / Menu / Battle Phaser 场景
│   └── ui/                           DOM 覆盖层 (Settings/Review/Negotiation/Vignette/Help)
├── index.html
├── vite.config.ts
└── tsconfig.json
```

## LLM 输出契约

复盘 Agent 输出严格 JSON：

```json
{
  "monologue": "玩家可见的中文独白（人格化、有情绪）",
  "lesson": ["≤12字的简短启示", "≤3 条"],
  "next_strategy": {
    "path_weight_shift": "short | long | edge | center | random",
    "skill_priority": ["stealth", "swarm", "rush", "split", "taunt", "shield"],
    "formation": "scattered | clustered | wedge | rear_first",
    "aggression": -1.0,
    "preferred_kinds": ["anxiety", "depression", "obsession", "guilt", "ptsd"]
  }
}
```

`EvolutionApplier` 把这份策略翻译为下一波 `WaveSpec` 的真实改变：路线偏好、spawn delay 重排、HP/速度乘数、技能 tag、kind 替换。实际战斗阶段会把本波偏好收束为一条主路线，确保路线预告和敌人移动一致。


## 免责声明

本作为**虚构作品**，**并不替代任何真实心理治疗**。所有「心魔」均为人格化的叙事象征。如果你正在经历真实的心理困扰，请寻求专业帮助。
