// ================== 认知围城：跨模块共享类型 ==================

export type EnemyKind = 'anxiety' | 'depression' | 'obsession' | 'guilt' | 'ptsd';
export type TowerKind = 'memory' | 'belief' | 'resonance' | 'acceptance' | 'insight' | 'boundary';

export type PathBias = 'short' | 'long' | 'edge' | 'center' | 'random';
export type RouteVariant = 'short' | 'long' | 'edge';
export type Formation = 'scattered' | 'clustered' | 'wedge' | 'rear_first';
export type SkillFlag = 'stealth' | 'swarm' | 'rush' | 'split' | 'taunt' | 'shield';
export type LevelRuleKind = 'tutorial' | 'breath_phase' | 'echo_group' | 'scarcity' | 'fracture_edge' | 'trial_elite';
export type MapElementKind = 'breath_vent' | 'mirror_gate' | 'dry_well' | 'fracture_node' | 'trial_obelisk';

export type ChoiceTag = 'empathy' | 'confront' | 'deceive';

export interface GridPos {
  col: number;
  row: number;
}

export interface PixelPos {
  x: number;
  y: number;
}

export interface MapProjectionSummary {
  activeRoute: RouteVariant;
  activeRouteLabel: string;
  activeRoutes: RouteVariant[];
  inactiveRoutes: RouteVariant[];
  buildCellCount: number;
  blockedCellCount: number;
  corruptionLevel: number;
  towerPocketCount: number;
  attackIntent: string;
  mapElementCount: number;
  mapElementKinds: MapElementKind[];
}

export interface MapElementSpec {
  levelId: string;
  id: string;
  kind: MapElementKind;
  waveStart: number;
  waveEnd: number | null;
  cell: GridPos;
  radiusCells: number;
  hp: number;
  reward: number;
  cooldownMs: number;
  effectMul: number;
  pairId: string;
  route: RouteVariant | null;
  note: string;
}

// 当前波次使用的“地图投影”：同一套路线蓝图会根据策略开放不同分支和塔位。
export interface MapProjection {
  activeRoute: RouteVariant;
  activeRoutes: RouteVariant[];
  inactiveRoutes: RouteVariant[];
  pathCells: GridPos[];
  inactivePathCells: GridPos[];
  buildCells: GridPos[];
  blockedCells: GridPos[];
  mapElements: MapElementSpec[];
  corruptionLevel: number;
  summary: MapProjectionSummary;
}

export interface AgentProofMapChange {
  before: MapProjectionSummary;
  after: MapProjectionSummary;
}

export interface EnemySpawnSpec {
  kind: EnemyKind;
  delayMs: number;
  hpMul: number;
  speedMul: number;
  pathBias: PathBias;
  skills: SkillFlag[];
  // 出生时从人格池挑选，主要驱动台词和展示身份。
  personaIdx?: number;
  echoClone?: boolean;
}

export interface WaveSpec {
  index: number;
  isBoss: boolean;
  spawns: EnemySpawnSpec[];
  formation: Formation;
  // 每波布防开始时补给给玩家的念力。
  mindGift: number;
}

export interface LevelSpec {
  id: string;
  name: string;
  theme: string;
  rule: LevelRuleKind;
  globalHpMul: number;
  globalSpeedMul: number;
  mindGiftMul: number;
  waves: WaveSpec[];
}

export interface CombatLogEntry {
  enemyKind: EnemyKind;
  personaName: string;
  killedBy: TowerKind | 'reached_core' | 'unknown';
  pathProgress: number; // 0..1，用于复盘判断敌人推进深度。
  diedAt: GridPos | null;
  hpRemain: number;
}

export interface BattleSummary {
  waveIndex: number;
  outcome: 'cleared' | 'survived' | 'failed';
  enemiesKilled: number;
  enemiesLeaked: number;
  sanityDelta: number;
  sanityAfter: number;
  mindAfter: number;
  log: CombatLogEntry[];
  // 粗粒度防线签名，供复盘 Agent 判断玩家防守偏好。
  towerLayout: Array<{
    kind: TowerKind;
    col: number;
    row: number;
    level: number;
  }>;
}

export interface NextStrategy {
  path_weight_shift: PathBias;
  skill_priority: SkillFlag[];
  formation: Formation;
  /** -1..+1；负值偏保守试探，正值偏高压强攻。 */
  aggression: number;
  /** 给后续波次生成器的偏好提示，用来替换部分普通刷怪。 */
  preferred_kinds: EnemyKind[];
}

export interface ReviewResult {
  monologue: string;
  lesson: string[];
  next_strategy: NextStrategy;
  /** true 表示来自 LLM；false 表示使用了内置回退剧本。 */
  fromLLM: boolean;
}

export interface AgentProofBattleSummary {
  wave: number;
  outcome: BattleSummary['outcome'];
  sanityAfter: number;
  sanityDelta: number;
  mindAfter: number;
  enemiesKilled: number;
  enemiesLeaked: number;
  deathsByTower: Partial<Record<TowerKind | 'reached_core' | 'unknown', number>>;
  perKind: Partial<Record<EnemyKind, {
    spawned: number;
    killed: number;
    leaked: number;
    avgProgress: number;
  }>>;
  towerLayout: Partial<Record<TowerKind, number>>;
}

export interface AgentProofWaveSummary {
  wave: number;
  isBoss: boolean;
  formation: Formation;
  mindGift: number;
  spawnCount: number;
  firstSpawnMs: number;
  lastSpawnMs: number;
  pathBiases: PathBias[];
  kinds: Partial<Record<EnemyKind, number>>;
  skills: Partial<Record<SkillFlag, number>>;
  hpMulRange: [number, number];
  speedMulRange: [number, number];
}

export interface AgentProofSnapshot {
  summary: AgentProofBattleSummary;
  source: 'llm' | 'fallback';
  mode: 'demo' | 'online';
  status: 'llm_parsed' | 'demo_fallback' | 'online_fallback';
  strategy: NextStrategy;
  changes: string[];
  nextWaveBefore: AgentProofWaveSummary | null;
  nextWaveAfter: AgentProofWaveSummary | null;
  mapChange?: AgentProofMapChange;
}

export interface BossPersona {
  id: string;
  displayName: string;
  kindHint: EnemyKind;
  emoji: string;
  // 会注入到 BOSS 谈判 Agent 的人设描述。
  description: string;
  baseHp: number;
  baseSpeed: number;
}

export interface DialogueChoice {
  text: string;
  tag: ChoiceTag;
}

export interface DialogueTurn {
  bossLine: string;
  choices: DialogueChoice[];
}

export interface NegotiationResolution {
  hpMul: number;
  speedMul: number;
  damageMul: number;
  specialNote: string; // 展示在 HUD 中的谈判结果摘要。
  endingTag: ChoiceTag;
}

export interface VignetteContext {
  patientName: string;
  wave: number;
  emotion: string;
  hint: string;
}

// ---- 用户设置（持久化在 localStorage）----
export interface UserSettings {
  apiBase: string;
  apiKey: string;
  model: string;
  demoMode: boolean; // 为 true 时跳过所有联网 LLM 调用，直接使用回退内容。
  difficulty: 'easy' | 'normal' | 'hard';
  muted: boolean;
}

export const DEFAULT_SETTINGS: UserSettings = {
  apiBase: 'https://api.deepseek.com/v1',
  apiKey: '',
  model: 'deepseek-chat',
  demoMode: true,
  difficulty: 'normal',
  muted: false,
};
