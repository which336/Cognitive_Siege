// ================== Cognitive Siege - Shared Types ==================

export type EnemyKind = 'anxiety' | 'depression' | 'obsession' | 'guilt' | 'ptsd';
export type TowerKind = 'memory' | 'belief' | 'resonance' | 'acceptance' | 'insight' | 'boundary';

export type PathBias = 'short' | 'long' | 'edge' | 'center' | 'random';
export type RouteVariant = 'short' | 'long' | 'edge';
export type Formation = 'scattered' | 'clustered' | 'wedge' | 'rear_first';
export type SkillFlag = 'stealth' | 'swarm' | 'rush' | 'split' | 'taunt' | 'shield';

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
}

export interface MapProjection {
  activeRoute: RouteVariant;
  activeRoutes: RouteVariant[];
  inactiveRoutes: RouteVariant[];
  pathCells: GridPos[];
  inactivePathCells: GridPos[];
  buildCells: GridPos[];
  blockedCells: GridPos[];
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
  // Personality picked from persona pool when spawning. Drives quotes.
  personaIdx?: number;
}

export interface WaveSpec {
  index: number;
  isBoss: boolean;
  spawns: EnemySpawnSpec[];
  formation: Formation;
  // Resources granted at start of wave
  mindGift: number;
}

export interface CombatLogEntry {
  enemyKind: EnemyKind;
  personaName: string;
  killedBy: TowerKind | 'reached_core' | 'unknown';
  pathProgress: number; // 0..1
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
  // Coarse layout signature so the LLM can talk about player strategy
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
  /** -1..+1, negative = focus on weakest survivor, positive = swarm everything */
  aggression: number;
  /** Hint for downstream wave generator to prefer specific kinds */
  preferred_kinds: EnemyKind[];
}

export interface ReviewResult {
  monologue: string;
  lesson: string[];
  next_strategy: NextStrategy;
  /** True if produced by LLM; false if from fallback library */
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
  // System prompt injection
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
  specialNote: string; // shown in HUD
  endingTag: ChoiceTag;
}

export interface VignetteContext {
  patientName: string;
  night: number;
  emotion: string;
  hint: string;
}

// ---- Settings (persisted in localStorage) ----
export interface UserSettings {
  apiBase: string;
  apiKey: string;
  model: string;
  demoMode: boolean; // when true, all LLM calls bypass network and use fallback
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
