// ================== Cognitive Siege - Shared Types ==================

export type EnemyKind = 'anxiety' | 'depression' | 'obsession' | 'guilt' | 'ptsd';
export type TowerKind = 'memory' | 'belief' | 'resonance' | 'acceptance';

export type PathBias = 'short' | 'long' | 'edge' | 'center' | 'random';
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
