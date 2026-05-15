import {
  EnemyKind,
  Formation,
  GridPos,
  LevelRuleKind,
  LevelSpec,
  MapElementKind,
  MapElementSpec,
  PathBias,
  RouteVariant,
  SkillFlag,
  TowerKind,
  WaveSpec,
} from '../../types';
import { ENEMY_DEFS, EnemyDef } from './enemies';
import { TOWER_DEFS } from './towers';
import { setConfiguredLevelSpecs } from './waves';
import { MapConfigData, setConfiguredMapConfig } from '../systems/Grid';
import { RouteStrategyConfig, setRouteStrategyConfig } from '../systems/WaveSystem';

type CsvRow = Record<string, string>;
export interface TutorialTip {
  title: string;
  body: string;
  routeNote?: string;
}

export interface ConfigLoadReport {
  status: 'pending' | 'ok' | 'fallback';
  message: string;
  error: string | null;
  loadedTables: string[];
  checkedAt: string | null;
}

interface ExternalConfigTables {
  levelRows: CsvRow[];
  towerRows: CsvRow[];
  enemyRows: CsvRow[];
  waveRows: CsvRow[];
  spawnRows: CsvRow[];
  safetyRows: CsvRow[];
  tutorialRows: CsvRow[];
  routeRows: CsvRow[];
  buildCellRows: CsvRow[];
  routeRuleRows: CsvRow[];
  mapElementRows: CsvRow[];
  enemyRoutePreferenceRows: CsvRow[];
  routeStrategyWeightRows: CsvRow[];
  mindCacheRows: CsvRow[];
  difficultyRows: CsvRow[];
  waveScalingRows: CsvRow[];
  bossCombatRows: CsvRow[];
}

interface AggressionRange {
  minWave: number;
  maxWave: number | null;
  min: number;
  max: number;
}

export interface MindCacheConfig {
  baseCount: number;
  countPerWave: number;
  maxCountBonus: number;
  baseHp: number;
  hpPerWave: number;
  hpRandom: number;
  baseReward: number;
  rewardPerWave: number;
  rewardWaveCap: number;
  rewardRandom: number;
  nearBuildRadiusSq: number;
}

export type DifficultyKind = 'easy' | 'normal' | 'hard';
export const BOSS_SKILL_KINDS = ['anxiety_core', 'depression_core', 'obsession_core', 'guilt_core', 'ptsd_core'] as const;
export type BossSkillKind = typeof BOSS_SKILL_KINDS[number];

export interface DifficultyConfig {
  sanityStart: number;
  sanityMax: number;
  mindStart: number;
}

export interface WaveScalingConfig {
  lateStartWave: number;
  hpPerWave: number;
  hpLatePerWave: number;
  speedPerWave: number;
  speedLatePerWave: number;
  damagePerWave: number;
  damageLatePerWave: number;
  bountyPerWave: number;
  bossHpMul: number;
  bossDamageMul: number;
}

export interface BossSkillConfig {
  displayName: string;
  auraSpeedMul: number;
  enragedDamageMul: number;
  shieldMaxHpRatio: number;
  enragedDamageTakenMul: number;
  minion: {
    kind: EnemyKind;
    hpMul: number;
    speedMul: number;
    pathBias: PathBias;
    skills: SkillFlag[];
  };
}

export interface BossCombatConfig {
  summonIntervalMs: number;
  coreTickIntervalMs: number;
  coreDamageFactor: number;
  coreMinDamage: number;
  waveSkills: Partial<Record<number, BossSkillKind>>;
  skills: Record<BossSkillKind, BossSkillConfig>;
}

const towerKinds: TowerKind[] = ['memory', 'belief', 'resonance', 'acceptance', 'insight', 'boundary'];
const enemyKinds: EnemyKind[] = ['anxiety', 'depression', 'obsession', 'guilt', 'ptsd'];
const formations: Formation[] = ['scattered', 'clustered', 'wedge', 'rear_first'];
const pathBiases: PathBias[] = ['short', 'long', 'edge', 'center', 'random'];
const routeVariants: RouteVariant[] = ['short', 'long', 'edge'];
const skillFlags: SkillFlag[] = ['stealth', 'swarm', 'rush', 'split', 'taunt', 'shield'];
const levelRules: LevelRuleKind[] = ['tutorial', 'breath_phase', 'echo_group', 'scarcity', 'fracture_edge', 'trial_elite'];
const mapElementKinds: MapElementKind[] = ['breath_vent', 'mirror_gate', 'dry_well', 'fracture_node', 'trial_obelisk'];

let loaded = false;
let configLoadReport: ConfigLoadReport = {
  status: 'pending',
  message: '配置尚未加载',
  error: null,
  loadedTables: [],
  checkedAt: null,
};
let tutorialTips: Record<string, Record<number, TutorialTip>> = {
  level_1: {
    1: {
      title: '教学 1/4：焦虑疾走者',
      body: '先造2座美好回忆塔，别急着单塔升级。\n右侧金色图标是念力残堆。\n没有心魔时，塔会打破它返还念力。',
    },
    2: {
      title: '教学 2/4：抑郁重雾',
      body: '抑郁血厚、会拖慢附近塔，补信念塔处理高血量目标。\n本波开始出现第二条亮路，优先覆盖交汇处。',
    },
    3: {
      title: '教学 3/4：强迫循环者',
      body: '强迫会回头反刍并带快同伴，别只守出生点。\n点击已建塔可查看数值、升级或拆除。',
    },
    4: {
      title: '教学 4/4：自责伪装者',
      body: '自责带伪装，普通塔很难稳定锁定。\n共鸣塔伤害低，但能破隐和减速，放在路线交汇或核心前。',
    },
  },
};
let enemyMinWave: Record<EnemyKind, number> = {
  anxiety: 1,
  depression: 2,
  obsession: 3,
  guilt: 4,
  ptsd: 6,
};
let skillMinWave: Record<SkillFlag, number> = {
  rush: 1,
  stealth: 4,
  shield: 5,
  taunt: 5,
  swarm: 6,
  split: 6,
};
let aggressionRanges: AggressionRange[] = [
  { minWave: 1, maxWave: 4, min: -0.25, max: 0.25 },
  { minWave: 5, maxWave: null, min: -1, max: 1 },
];
let mindCacheConfig: MindCacheConfig = {
  baseCount: 6,
  countPerWave: 1,
  maxCountBonus: 4,
  baseHp: 54,
  hpPerWave: 8,
  hpRandom: 18,
  baseReward: 18,
  rewardPerWave: 3,
  rewardWaveCap: 18,
  rewardRandom: 10,
  nearBuildRadiusSq: 10,
};
let difficultyConfig: Record<DifficultyKind, DifficultyConfig> = {
  easy: { sanityStart: 120, sanityMax: 120, mindStart: 80 },
  normal: { sanityStart: 100, sanityMax: 100, mindStart: 60 },
  hard: { sanityStart: 80, sanityMax: 80, mindStart: 50 },
};
let waveScalingConfig: WaveScalingConfig = {
  lateStartWave: 6,
  hpPerWave: 0.18,
  hpLatePerWave: 0.09,
  speedPerWave: 0.04,
  speedLatePerWave: 0.015,
  damagePerWave: 0.16,
  damageLatePerWave: 0.055,
  bountyPerWave: 0.04,
  bossHpMul: 1.55,
  bossDamageMul: 1.3,
};
let bossCombatConfig: BossCombatConfig = {
  summonIntervalMs: 5000,
  coreTickIntervalMs: 900,
  coreDamageFactor: 0.35,
  coreMinDamage: 2,
  waveSkills: {
    5: 'anxiety_core',
    10: 'obsession_core',
  },
  skills: {
    anxiety_core: {
      displayName: '焦虑之核',
      auraSpeedMul: 1.1,
      enragedDamageMul: 1.2,
      shieldMaxHpRatio: 0,
      enragedDamageTakenMul: 1,
      minion: { kind: 'anxiety', hpMul: 1.05, speedMul: 1.2, pathBias: 'short', skills: ['rush'] },
    },
    depression_core: {
      displayName: '抑郁重雾',
      auraSpeedMul: 1,
      enragedDamageMul: 1,
      shieldMaxHpRatio: 0.1,
      enragedDamageTakenMul: 0.8,
      minion: { kind: 'depression', hpMul: 1.05, speedMul: 1, pathBias: 'short', skills: [] },
    },
    obsession_core: {
      displayName: '执念循环',
      auraSpeedMul: 1,
      enragedDamageMul: 1,
      shieldMaxHpRatio: 0.1,
      enragedDamageTakenMul: 0.8,
      minion: { kind: 'obsession', hpMul: 1.05, speedMul: 1.05, pathBias: 'edge', skills: ['split'] },
    },
    guilt_core: {
      displayName: '自责审判',
      auraSpeedMul: 1,
      enragedDamageMul: 1,
      shieldMaxHpRatio: 0.08,
      enragedDamageTakenMul: 0.88,
      minion: { kind: 'guilt', hpMul: 1.05, speedMul: 1, pathBias: 'long', skills: ['stealth'] },
    },
    ptsd_core: {
      displayName: '裂隙闪回',
      auraSpeedMul: 1,
      enragedDamageMul: 1,
      shieldMaxHpRatio: 0.08,
      enragedDamageTakenMul: 0.9,
      minion: { kind: 'ptsd', hpMul: 1.05, speedMul: 1, pathBias: 'edge', skills: [] },
    },
  },
};

export async function loadExternalConfig(): Promise<void> {
  if (loaded) return;
  loaded = true;

  try {
    // 所有 CSV 表一次性加载并整体校验；任意表失败就回退到内置默认值，避免半配置状态。
    const loadedTables = [
      'level_config.csv',
      'tower_config.csv',
      'enemy_config.csv',
      'wave_config.csv',
      'wave_spawn_groups.csv',
      'ai_safety_config.csv',
      'tutorial_config.csv',
      'map_routes.csv',
      'map_build_cells.csv',
      'map_route_rules.csv',
      'map_elements.csv',
      'enemy_route_preferences.csv',
      'route_strategy_weights.csv',
      'mind_cache_config.csv',
      'difficulty_config.csv',
      'wave_scaling_config.csv',
      'boss_combat_config.csv',
    ];
    const [
      levelRows,
      towerRows,
      enemyRows,
      waveRows,
      spawnRows,
      safetyRows,
      tutorialRows,
      routeRows,
      buildCellRows,
      routeRuleRows,
      mapElementRows,
      enemyRoutePreferenceRows,
      routeStrategyWeightRows,
      mindCacheRows,
      difficultyRows,
      waveScalingRows,
      bossCombatRows,
    ] = await Promise.all([
      ...loadedTables.map(fetchCsv),
    ]);

    validateConfigTables({
      levelRows,
      towerRows,
      enemyRows,
      waveRows,
      spawnRows,
      safetyRows,
      tutorialRows,
      routeRows,
      buildCellRows,
      routeRuleRows,
      mapElementRows,
      enemyRoutePreferenceRows,
      routeStrategyWeightRows,
      mindCacheRows,
      difficultyRows,
      waveScalingRows,
      bossCombatRows,
    });

    applyTowerConfig(towerRows);
    applyEnemyConfig(enemyRows);
    setConfiguredLevelSpecs(buildLevelSpecsFromRows(levelRows, waveRows, spawnRows));
    applyAiSafetyConfig(safetyRows);
    applyTutorialConfig(tutorialRows);
    setConfiguredMapConfig(buildMapConfig(routeRows, buildCellRows, routeRuleRows, mapElementRows, levelRows));
    setRouteStrategyConfig(buildRouteStrategyConfig(enemyRoutePreferenceRows, routeStrategyWeightRows));
    applyMindCacheConfig(mindCacheRows);
    applyDifficultyConfig(difficultyRows);
    applyWaveScalingConfig(waveScalingRows);
    applyBossCombatConfig(bossCombatRows);
    configLoadReport = {
      status: 'ok',
      message: `已加载并校验 ${loadedTables.length} 张 CSV 配置表`,
      error: null,
      loadedTables,
      checkedAt: new Date().toLocaleString(),
    };
    console.info('[config] CSV config loaded');
  } catch (err) {
    configLoadReport = {
      status: 'fallback',
      message: '外部 CSV 配置不可用，已回退到代码内置默认值',
      error: err instanceof Error ? err.message : String(err),
      loadedTables: [],
      checkedAt: new Date().toLocaleString(),
    };
    console.warn('[config] CSV config unavailable; using built-in defaults', err);
  }
}

export function getConfigLoadReport(): ConfigLoadReport {
  return configLoadReport;
}

export function getTutorialTip(waveIndex: number, levelId = 'level_1'): TutorialTip | null {
  return tutorialTips[levelId]?.[waveIndex] ?? tutorialTips.level_1?.[waveIndex] ?? null;
}

export function getMindCacheConfig(): MindCacheConfig {
  return mindCacheConfig;
}

export function getDifficultyConfig(difficulty: DifficultyKind): DifficultyConfig {
  return difficultyConfig[difficulty] ?? difficultyConfig.normal;
}

export function getWaveScalingConfig(): WaveScalingConfig {
  return waveScalingConfig;
}

export function getBossCombatConfig(): BossCombatConfig {
  return bossCombatConfig;
}

export function getAllowedEnemyKindsForWave(waveIndex: number, kinds = enemyKinds): EnemyKind[] {
  return kinds.filter((kind) => waveIndex >= enemyMinWave[kind]);
}

export function getAllowedSkillsForWave(waveIndex: number, skills = skillFlags): SkillFlag[] {
  return skills.filter((skill) => waveIndex >= skillMinWave[skill]);
}

export function clampAggressionForWave(waveIndex: number, aggression: number): number {
  const range = aggressionRanges.find((item) => (
    waveIndex >= item.minWave && (item.maxWave == null || waveIndex <= item.maxWave)
  )) ?? { min: -1, max: 1 };
  return Math.max(range.min, Math.min(range.max, aggression));
}

export function aiSafetyPromptRules(): string {
  const enemyLines = enemyKinds
    .map((kind) => `   - ${kind} 最早第 ${enemyMinWave[kind]} 波。`)
    .join('\n');
  const skillLines = skillFlags
    .map((skill) => `   - ${skill} 最早第 ${skillMinWave[skill]} 波。`)
    .join('\n');
  return `教学安全阀来自配置表：
${enemyLines}
${skillLines}
   - 前 4 波限制高侵略性，避免惩罚新手。`;
}

async function fetchCsv(filename: string): Promise<CsvRow[]> {
  // Vite 部署到子路径时 BASE_URL 会带前缀，配置文件路径必须跟随它。
  const base = import.meta.env.BASE_URL || '/';
  const url = `${base.replace(/\/$/, '')}/config/${filename}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${filename}: HTTP ${res.status}`);
  return parseCsv(decodeCsv(await res.arrayBuffer()));
}

function decodeCsv(buffer: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    // Windows Excel 常把中文 CSV 另存为 ANSI/GBK。浏览器默认 UTF-8 会把中文表头解坏，
    // 导致运行时校验找不到“中文名”等列；这里兜底兼容 GB18030。
    return new TextDecoder('gb18030').decode(buffer);
  }
}

function parseCsv(text: string): CsvRow[] {
  // 简单 CSV 解析器：支持 BOM、引号包裹字段和双引号转义，足够覆盖当前配置表。
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  const normalized = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i];
    const next = normalized[i + 1];

    if (quoted) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (ch !== '\r') {
      cell += ch;
    }
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }

  const [headers, ...body] = rows.filter((r) => r.some((v) => v.trim().length));
  if (!headers) return [];
  return body.map((values, index) => {
    const out: CsvRow = {};
    headers.forEach((header, i) => {
      out[header.trim()] = (values[i] ?? '').trim();
    });
    out.__line = String(index + 2);
    return out;
  });
}

function validateConfigTables(tables: ExternalConfigTables): void {
  // 加载前先做结构和范围校验，后续 apply 阶段就可以只关心映射逻辑。
  requireRows('level_config.csv', tables.levelRows);
  requireRows('tower_config.csv', tables.towerRows);
  requireRows('enemy_config.csv', tables.enemyRows);
  requireRows('wave_config.csv', tables.waveRows);
  requireRows('wave_spawn_groups.csv', tables.spawnRows);
  requireRows('ai_safety_config.csv', tables.safetyRows);
  requireRows('tutorial_config.csv', tables.tutorialRows);
  requireRows('map_routes.csv', tables.routeRows);
  requireRows('map_build_cells.csv', tables.buildCellRows);
  requireRows('map_route_rules.csv', tables.routeRuleRows);
  requireRows('map_elements.csv', tables.mapElementRows);
  requireRows('enemy_route_preferences.csv', tables.enemyRoutePreferenceRows);
  requireRows('route_strategy_weights.csv', tables.routeStrategyWeightRows);
  requireRows('mind_cache_config.csv', tables.mindCacheRows);
  requireRows('difficulty_config.csv', tables.difficultyRows);
  requireRows('wave_scaling_config.csv', tables.waveScalingRows);
  requireRows('boss_combat_config.csv', tables.bossCombatRows);

  const levelIds = validateLevelRows(tables.levelRows);
  validateTowerRows(tables.towerRows);
  validateEnemyRows(tables.enemyRows);
  validateWaveRows(tables.waveRows, levelIds);
  validateSpawnRows(tables.spawnRows, levelIds);
  validateSafetyRows(tables.safetyRows);
  validateTutorialRows(tables.tutorialRows, levelIds);
  validateMapRows(tables.routeRows, tables.buildCellRows, tables.routeRuleRows, tables.mapElementRows, levelIds);
  validateRouteStrategyRows(tables.enemyRoutePreferenceRows, tables.routeStrategyWeightRows);
  validateKeyValueRows('mind_cache_config.csv', tables.mindCacheRows, [
    'base_count',
    'count_per_wave',
    'max_count_bonus',
    'base_hp',
    'hp_per_wave',
    'hp_random',
    'base_reward',
    'reward_per_wave',
    'reward_wave_cap',
    'reward_random',
    'near_build_radius_sq',
  ], 0);
  validateDifficultyRows(tables.difficultyRows);
  validateKeyValueRows('wave_scaling_config.csv', tables.waveScalingRows, [
    'late_start_wave',
    'hp_per_wave',
    'hp_late_per_wave',
    'speed_per_wave',
    'speed_late_per_wave',
    'damage_per_wave',
    'damage_late_per_wave',
    'bounty_per_wave',
    'boss_hp_mul',
    'boss_damage_mul',
  ], 0);
  validateBossCombatRows(tables.bossCombatRows);
}

function validateTowerRows(rows: CsvRow[]): void {
  for (const row of rows) {
    expectEnum('tower_config.csv', row, 'id', towerKinds);
    expectEnum('tower_config.csv', row, '放置位置', ['可建造格', '路线格']);
    for (const field of ['基础价格', '基础射程', '基础射速_每秒', '基础伤害', '溅射半径']) {
      expectNumber('tower_config.csv', row, field, { min: 0 });
    }
    for (const field of ['阻挡耐久', '升L2费用', '升L3费用', 'L2伤害', 'L3伤害', 'L2射程', 'L3射程', 'L2射速', 'L3射速']) {
      expectNumber('tower_config.csv', row, field, { min: 0, optional: true });
    }
    const percent = row['百分比当前生命'];
    if (percent) {
      const value = percentValue(percent);
      if (value == null || value < 0 || value > 1) {
        configError('tower_config.csv', row, '百分比当前生命', 'must be 0%-100%');
      }
    }
  }
}

function validateEnemyRows(rows: CsvRow[]): void {
  for (const row of rows) {
    expectEnum('enemy_config.csv', row, 'id', enemyKinds);
    expectEnum('enemy_config.csv', row, '行为标签', ['rush', 'aura', 'loop', 'cloak', 'flicker']);
    for (const field of ['基础HP', '基础速度', '击杀念力', '抵达SAN伤害']) {
      expectNumber('enemy_config.csv', row, field, { min: 0 });
    }
  }
}

function validateWaveRows(rows: CsvRow[], levelIds: Set<string>): void {
  const seen = new Map<string, Set<number>>();
  for (const row of rows) {
    const levelId = row.level_id || 'level_1';
    if (!levelIds.has(levelId)) configError('wave_config.csv', row, 'level_id', `unknown level "${levelId}"`);
    const wave = expectNumber('wave_config.csv', row, '波次', { min: 1, max: 10, integer: true });
    if (!seen.has(levelId)) seen.set(levelId, new Set());
    seen.get(levelId)!.add(wave);
    expectEnum('wave_config.csv', row, '是否Boss', ['是', '否']);
    expectEnum('wave_config.csv', row, '基础阵型', formations);
    expectNumber('wave_config.csv', row, '本波念力补给', { min: 0 });
  }
  for (const levelId of levelIds) {
    const waves = seen.get(levelId) ?? new Set<number>();
    for (let wave = 1; wave <= 10; wave++) {
      if (!waves.has(wave)) throw new Error(`[config] wave_config.csv missing ${levelId} wave ${wave}`);
    }
  }
}

function validateSpawnRows(rows: CsvRow[], levelIds: Set<string>): void {
  // 刷怪表是最容易破坏游戏节奏的表，所以同时校验数量、延迟、倍率和技能枚举。
  for (const row of rows) {
    const levelId = row.level_id || 'level_1';
    if (!levelIds.has(levelId)) configError('wave_spawn_groups.csv', row, 'level_id', `unknown level "${levelId}"`);
    expectNumber('wave_spawn_groups.csv', row, '波次', { min: 1, max: 10, integer: true });
    expectNumber('wave_spawn_groups.csv', row, '组序', { min: 1, integer: true });
    expectEnum('wave_spawn_groups.csv', row, '心魔', enemyKinds);
    const count = expectNumber('wave_spawn_groups.csv', row, '数量', { min: 1, integer: true });
    expectDelayList('wave_spawn_groups.csv', row, '首个delayMs', count);
    expectNumber('wave_spawn_groups.csv', row, '间隔Ms', { min: 0, optional: true });
    expectNumber('wave_spawn_groups.csv', row, 'HP倍率', { min: 0 });
    expectNumber('wave_spawn_groups.csv', row, '速度倍率', { min: 0 });
    expectEnum('wave_spawn_groups.csv', row, '路线倾向', pathBiases);
    expectSkillList('wave_spawn_groups.csv', row, '技能', row['技能']);
  }
}

function validateSafetyRows(rows: CsvRow[]): void {
  for (const row of rows) {
    expectEnum('ai_safety_config.csv', row, '类别', ['心魔开放', '技能开放', '侵略度限制', '路线开放', '复盘改表']);
    if (row['类别'] === '心魔开放') expectEnum('ai_safety_config.csv', row, 'key', enemyKinds);
    if (row['类别'] === '技能开放') expectEnum('ai_safety_config.csv', row, 'key', skillFlags);
    if (row['类别'] === '侵略度限制' && row.key !== 'aggression') {
      configError('ai_safety_config.csv', row, 'key', 'must be aggression');
    }
    if ((row['类别'] === '路线开放' || row['类别'] === '复盘改表') && !row.key) {
      configError('ai_safety_config.csv', row, 'key', 'is required');
    }
    if (!row['生效条件']) configError('ai_safety_config.csv', row, '生效条件', 'is required');
  }
}

function validateTutorialRows(rows: CsvRow[], levelIds: Set<string>): void {
  for (const row of rows) {
    const levelId = row.level_id || 'level_1';
    if (!levelIds.has(levelId)) configError('tutorial_config.csv', row, 'level_id', `unknown level "${levelId}"`);
    expectNumber('tutorial_config.csv', row, '波次', { min: 1, max: 10, integer: true });
    if (!row['标题']) configError('tutorial_config.csv', row, '标题', 'is required');
    if (!row['正文']) configError('tutorial_config.csv', row, '正文', 'is required');
  }
}

function validateMapRows(
  routeRows: CsvRow[],
  buildCellRows: CsvRow[],
  routeRuleRows: CsvRow[],
  mapElementRows: CsvRow[],
  levelIds: Set<string>,
): void {
  for (const row of routeRows) {
    validateLevelRef('map_routes.csv', row, levelIds);
    expectEnum('map_routes.csv', row, 'route', routeVariants);
    expectNumber('map_routes.csv', row, 'seq', { min: 1, integer: true });
    expectNumber('map_routes.csv', row, 'col', { min: 0, integer: true });
    expectNumber('map_routes.csv', row, 'row', { min: 0, integer: true });
  }
  for (const row of buildCellRows) {
    validateLevelRef('map_build_cells.csv', row, levelIds);
    expectEnum('map_build_cells.csv', row, 'route', routeVariants);
    expectNumber('map_build_cells.csv', row, 'col', { min: 0, integer: true });
    expectNumber('map_build_cells.csv', row, 'row', { min: 0, integer: true });
  }
  for (const row of routeRuleRows) {
    validateLevelRef('map_route_rules.csv', row, levelIds);
    expectNumber('map_route_rules.csv', row, 'min_wave', { min: 1, max: 10, integer: true });
    expectNumber('map_route_rules.csv', row, 'max_wave', { min: 1, max: 10, integer: true, optional: true });
    expectEnum('map_route_rules.csv', row, 'primary_route', routeVariants);
    expectRouteList('map_route_rules.csv', row, 'open_routes', row.open_routes);
  }
  for (const row of mapElementRows) {
    validateLevelRef('map_elements.csv', row, levelIds);
    if (!row.id) configError('map_elements.csv', row, 'id', 'is required');
    expectEnum('map_elements.csv', row, 'kind', mapElementKinds);
    expectNumber('map_elements.csv', row, 'wave_start', { min: 1, max: 10, integer: true });
    expectNumber('map_elements.csv', row, 'wave_end', { min: 1, max: 10, integer: true, optional: true });
    expectNumber('map_elements.csv', row, 'col', { min: 0, integer: true });
    expectNumber('map_elements.csv', row, 'row', { min: 0, integer: true });
    expectNumber('map_elements.csv', row, 'radius_cells', { min: 0 });
    expectNumber('map_elements.csv', row, 'hp', { min: 0 });
    expectNumber('map_elements.csv', row, 'reward', { min: 0 });
    expectNumber('map_elements.csv', row, 'cooldown_ms', { min: 0 });
    expectNumber('map_elements.csv', row, 'effect_mul', { min: 0 });
    if (row.route) expectEnum('map_elements.csv', row, 'route', routeVariants);
  }
  const elementLevels = new Set(mapElementRows.map((row) => row.level_id || 'level_1'));
  for (const levelId of levelIds) {
    if (levelId !== 'level_1' && !elementLevels.has(levelId)) {
      throw new Error(`[config] map_elements.csv missing elements for ${levelId}`);
    }
  }
}

function validateLevelRef(filename: string, row: CsvRow, levelIds: Set<string>): void {
  const levelId = row.level_id || 'level_1';
  if (!levelIds.has(levelId)) configError(filename, row, 'level_id', `unknown level "${levelId}"`);
}

function validateRouteStrategyRows(preferenceRows: CsvRow[], weightRows: CsvRow[]): void {
  for (const row of preferenceRows) {
    expectEnum('enemy_route_preferences.csv', row, 'enemy', enemyKinds);
    expectNumber('enemy_route_preferences.csv', row, 'priority', { min: 1, integer: true });
    expectEnum('enemy_route_preferences.csv', row, 'route', routeVariants);
  }
  validateKeyValueRows('route_strategy_weights.csv', weightRows, [
    'strategy_route_weight',
    'kind_preference_weight',
    'random_route_weight',
  ], 0, 1);
}

function validateDifficultyRows(rows: CsvRow[]): void {
  for (const row of rows) {
    expectEnum('difficulty_config.csv', row, 'difficulty', ['easy', 'normal', 'hard']);
    expectNumber('difficulty_config.csv', row, 'sanity_start', { min: 1 });
    expectNumber('difficulty_config.csv', row, 'sanity_max', { min: 1 });
    expectNumber('difficulty_config.csv', row, 'mind_start', { min: 0 });
    const start = numberValue(row.sanity_start) ?? 0;
    const max = numberValue(row.sanity_max) ?? 0;
    if (start > max) configError('difficulty_config.csv', row, 'sanity_start', 'must be <= sanity_max');
  }
}

function validateBossCombatRows(rows: CsvRow[]): void {
  const categories = [
    'global',
    'wave_skill',
    'skill_display',
    'skill_aura_speed_mul',
    'skill_enraged_damage_mul',
    'skill_shield_max_hp_ratio',
    'skill_enraged_damage_taken_mul',
    'minion_kind',
    'minion_hp_mul',
    'minion_speed_mul',
    'minion_path_bias',
    'minion_skills',
  ];
  const globalKeys = ['summon_interval_ms', 'core_tick_interval_ms', 'core_damage_factor', 'core_min_damage'];
  for (const row of rows) {
    expectEnum('boss_combat_config.csv', row, 'category', categories);
    if (row.category === 'global') {
      expectEnum('boss_combat_config.csv', row, 'key', globalKeys);
      expectNumber('boss_combat_config.csv', row, 'value', { min: 0 });
    } else if (row.category === 'wave_skill') {
      expectNumber('boss_combat_config.csv', row, 'key', { min: 1, max: 10, integer: true });
      expectEnum('boss_combat_config.csv', row, 'value', [...BOSS_SKILL_KINDS]);
    } else {
      expectEnum('boss_combat_config.csv', row, 'key', [...BOSS_SKILL_KINDS]);
      if (row.category === 'minion_kind') expectEnum('boss_combat_config.csv', row, 'value', enemyKinds);
      if (row.category === 'minion_path_bias') expectEnum('boss_combat_config.csv', row, 'value', pathBiases);
      if (row.category === 'minion_skills') expectSkillList('boss_combat_config.csv', row, 'value', row.value, '|');
      if ([
        'skill_aura_speed_mul',
        'skill_enraged_damage_mul',
        'skill_shield_max_hp_ratio',
        'skill_enraged_damage_taken_mul',
        'minion_hp_mul',
        'minion_speed_mul',
      ].includes(row.category)) {
        expectNumber('boss_combat_config.csv', row, 'value', { min: 0 });
      }
    }
  }
}

function validateKeyValueRows(
  filename: string,
  rows: CsvRow[],
  allowedKeys: string[],
  min: number,
  max?: number,
): void {
  const seen = new Set<string>();
  for (const row of rows) {
    expectEnum(filename, row, 'key', allowedKeys);
    expectNumber(filename, row, 'value', { min, max });
    seen.add(row.key);
  }
  for (const key of allowedKeys) {
    if (!seen.has(key)) throw new Error(`[config] ${filename} missing key ${key}`);
  }
}

function requireRows(filename: string, rows: CsvRow[]): void {
  if (!rows.length) throw new Error(`[config] ${filename} has no data rows`);
}

function validateLevelRows(rows: CsvRow[]): Set<string> {
  const ids = new Set<string>();
  for (const row of rows) {
    const id = row.level_id || row.id;
    if (!id) configError('level_config.csv', row, 'level_id', 'is required');
    if (ids.has(id)) configError('level_config.csv', row, 'level_id', `duplicate "${id}"`);
    ids.add(id);
    if (!row['中文名']) configError('level_config.csv', row, '中文名', 'is required');
    if (!row['主题']) configError('level_config.csv', row, '主题', 'is required');
    expectEnum('level_config.csv', row, '规则', levelRules);
    expectNumber('level_config.csv', row, '全局HP倍率', { min: 0 });
    expectNumber('level_config.csv', row, '全局速度倍率', { min: 0 });
    expectNumber('level_config.csv', row, '念力补给倍率', { min: 0 });
  }
  return ids;
}

function expectEnum<T extends string>(filename: string, row: CsvRow, field: string, allowed: readonly T[]): T {
  const value = row[field];
  if (!allowed.includes(value as T)) {
    configError(filename, row, field, `must be one of: ${allowed.join(', ')}`);
  }
  return value as T;
}

function expectNumber(
  filename: string,
  row: CsvRow,
  field: string,
  opts: { min?: number; max?: number; integer?: boolean; optional?: boolean } = {},
): number {
  const raw = row[field];
  if (opts.optional && !raw) return 0;
  const value = numberValue(raw);
  if (value == null) configError(filename, row, field, 'must be a number');
  if (opts.integer && !Number.isInteger(value)) configError(filename, row, field, 'must be an integer');
  if (opts.min != null && value < opts.min) configError(filename, row, field, `must be >= ${opts.min}`);
  if (opts.max != null && value > opts.max) configError(filename, row, field, `must be <= ${opts.max}`);
  return value;
}

function expectDelayList(filename: string, row: CsvRow, field: string, count: number): void {
  const raw = row[field];
  if (!raw) configError(filename, row, field, 'is required');
  const values = raw
    .split('/')
    .map((value) => numberValue(value))
    .filter((value): value is number => value != null);
  if (!values.length || values.some((value) => value < 0)) {
    configError(filename, row, field, 'must contain non-negative delay numbers');
  }
  if (values.length > 1 && values.length !== count) {
    configError(filename, row, field, `explicit delay list length must match 数量 (${count})`);
  }
}

function expectSkillList(
  filename: string,
  row: CsvRow,
  field: string,
  raw: string,
  separator: RegExp | string = /[\/|;；、\s]+/,
): void {
  if (!raw) return;
  const parts = typeof separator === 'string'
    ? raw.split(separator)
    : raw.split(separator);
  for (const part of parts) {
    const skill = part.trim();
    if (!skill) continue;
    if (!skillFlags.includes(skill as SkillFlag)) {
      configError(filename, row, field, `unknown skill "${skill}"`);
    }
  }
}

function expectRouteList(filename: string, row: CsvRow, field: string, raw: string): void {
  if (!raw) configError(filename, row, field, 'is required');
  for (const part of raw.split('|')) {
    const route = part.trim();
    if (!routeVariants.includes(route as RouteVariant)) {
      configError(filename, row, field, `unknown route "${route}"`);
    }
  }
}

function configError(filename: string, row: CsvRow, field: string, message: string): never {
  const line = row.__line ?? '?';
  throw new Error(`[config] ${filename}:${line} ${field} ${message}`);
}

function applyTowerConfig(rows: CsvRow[]): void {
  // CSV 只覆盖数值和文案，运行时对象引用保持不变，避免引用方失效。
  for (const row of rows) {
    const kind = asTowerKind(row.id);
    if (!kind) continue;
    const def = TOWER_DEFS[kind];
    const percent = percentValue(row['百分比当前生命']);
    const blockHp = numberValue(row['阻挡耐久']);

    Object.assign(def, {
      displayName: row['中文名'] || def.displayName,
      cost: numberValue(row['基础价格']) ?? def.cost,
      range: numberValue(row['基础射程']) ?? def.range,
      fireRate: numberValue(row['基础射速_每秒']) ?? def.fireRate,
      damage: numberValue(row['基础伤害']) ?? def.damage,
      splashRadius: numberValue(row['溅射半径']) ?? def.splashRadius,
      placement: row['放置位置'] === '路线格' ? 'path' : 'build',
      desc: row['设计用途'] || def.desc,
    });
    if (percent != null) def.percentCurrentHp = percent;
    if (blockHp != null) def.blockHp = blockHp;
  }
}

function applyEnemyConfig(rows: CsvRow[]): void {
  for (const row of rows) {
    const kind = asEnemyKind(row.id);
    if (!kind) continue;
    const def = ENEMY_DEFS[kind];
    const behavior = asBehavior(row['行为标签']);
    Object.assign(def, {
      displayName: row['中文名'] || def.displayName,
      hp: numberValue(row['基础HP']) ?? def.hp,
      speed: numberValue(row['基础速度']) ?? def.speed,
      bounty: numberValue(row['击杀念力']) ?? def.bounty,
      damage: numberValue(row['抵达SAN伤害']) ?? def.damage,
      behavior: behavior ?? def.behavior,
      desc: [row['主要威胁'], row['推荐应对']].filter(Boolean).join('；') || def.desc,
    });
  }
}

function applyAiSafetyConfig(rows: CsvRow[]): void {
  // 安全阀控制教学期开放节奏，并约束复盘 Agent 的侵略度输出。
  const nextEnemyMin = { ...enemyMinWave };
  const nextSkillMin = { ...skillMinWave };
  const nextAggression: AggressionRange[] = [];

  for (const row of rows) {
    const category = row['类别'];
    const key = row.key;
    if (category === '心魔开放') {
      const kind = asEnemyKind(key);
      const minWave = minWaveFromCondition(row['生效条件']);
      if (kind && minWave != null) nextEnemyMin[kind] = minWave;
    } else if (category === '技能开放') {
      const skill = asSkillFlag(key);
      const minWave = minWaveFromCondition(row['生效条件']);
      if (skill && minWave != null) nextSkillMin[skill] = minWave;
    } else if (category === '侵略度限制' && key === 'aggression') {
      const waveRange = waveRangeFromCondition(row['生效条件']);
      const valueRange = numericRange(row['配置值']);
      if (waveRange && valueRange) {
        nextAggression.push({ ...waveRange, ...valueRange });
      }
    }
  }

  enemyMinWave = nextEnemyMin;
  skillMinWave = nextSkillMin;
  if (nextAggression.length) aggressionRanges = nextAggression;
}

function applyTutorialConfig(rows: CsvRow[]): void {
  const nextTips: Record<string, Record<number, TutorialTip>> = {};
  for (const row of rows) {
    const wave = numberValue(row['波次']);
    if (!wave || !row['标题']) continue;
    const levelId = row.level_id || 'level_1';
    if (!nextTips[levelId]) nextTips[levelId] = {};
    nextTips[levelId][wave] = {
      title: row['标题'],
      body: row['正文'],
      routeNote: row['动态路线说明'] || undefined,
    };
  }
  if (Object.keys(nextTips).length) tutorialTips = nextTips;
}

function buildLevelSpecsFromRows(levelRows: CsvRow[], waveRows: CsvRow[], spawnRows: CsvRow[]): LevelSpec[] {
  const levels = levelRows.map((row): LevelSpec => {
    const id = row.level_id || row.id || 'level_1';
    return {
      id,
      name: row['中文名'] || id,
      theme: row['主题'] || '',
      rule: asLevelRule(row['规则']) ?? 'tutorial',
      globalHpMul: numberValue(row['全局HP倍率']) ?? 1,
      globalSpeedMul: numberValue(row['全局速度倍率']) ?? 1,
      mindGiftMul: numberValue(row['念力补给倍率']) ?? 1,
      waves: buildWavesFromRows(
        waveRows.filter((waveRow) => (waveRow.level_id || 'level_1') === id),
        spawnRows.filter((spawnRow) => (spawnRow.level_id || 'level_1') === id),
        id,
      ),
    };
  });

  if (!levels.length) throw new Error('level_config produced 0 levels');
  return levels;
}

function buildWavesFromRows(waveRows: CsvRow[], spawnRows: CsvRow[], levelId = 'level_1'): WaveSpec[] {
  // wave_config 定义波次骨架，wave_spawn_groups 展开成逐个 EnemySpawnSpec。
  const waves = waveRows.map((row): WaveSpec => {
    const index = numberValue(row['波次']) ?? 1;
    const formation = asFormation(row['基础阵型']) ?? 'scattered';
    return {
      index,
      isBoss: row['是否Boss'] === '是',
      formation,
      mindGift: numberValue(row['本波念力补给']) ?? 0,
      spawns: [],
    };
  });
  const byIndex = new Map(waves.map((wave) => [wave.index, wave]));

  for (const row of spawnRows) {
    const wave = byIndex.get(numberValue(row['波次']) ?? -1);
    const kind = asEnemyKind(row['心魔']);
    if (!wave || !kind) continue;

    const delays = delayValues(row['首个delayMs'], row['间隔Ms'], numberValue(row['数量']) ?? 1);
    const skills = parseSkills(row['技能']);
    for (const delayMs of delays) {
      wave.spawns.push({
        kind,
        delayMs,
        hpMul: numberValue(row['HP倍率']) ?? 1,
        speedMul: numberValue(row['速度倍率']) ?? 1,
        pathBias: asPathBias(row['路线倾向']) ?? 'short',
        skills: [...skills],
      });
    }
  }

  const built = waves
    .filter((wave) => wave.spawns.length > 0)
    .sort((a, b) => a.index - b.index);
  if (built.length !== 10) throw new Error(`wave_config produced ${built.length} waves for ${levelId}, expected 10`);
  return built;
}

function buildMapConfig(
  routeRows: CsvRow[],
  buildCellRows: CsvRow[],
  routeRuleRows: CsvRow[],
  mapElementRows: CsvRow[],
  levelRows: CsvRow[],
): MapConfigData {
  const levelIds = levelRows.map((row) => row.level_id || row.id || 'level_1');
  const defaultLevelId = levelIds.includes('level_1') ? 'level_1' : (levelIds[0] ?? 'level_1');
  const levels: MapConfigData['levels'] = {};

  for (const levelId of levelIds) {
    const routeWaypoints = {
      short: buildRouteWaypoints(routeRows, levelId, 'short'),
      long: buildRouteWaypoints(routeRows, levelId, 'long'),
      edge: buildRouteWaypoints(routeRows, levelId, 'edge'),
    };
    const buildCells = {
      short: buildRouteCells(buildCellRows, levelId, 'short'),
      long: buildRouteCells(buildCellRows, levelId, 'long'),
      edge: buildRouteCells(buildCellRows, levelId, 'edge'),
    };
    const routeOpenRules = buildRouteOpenRules(routeRuleRows, levelId);
    const elements = buildMapElements(mapElementRows, levelId);
    if (!routeOpenRules.length) throw new Error(`map_route_rules is empty for ${levelId}`);
    if (levelId !== 'level_1' && !elements.length) throw new Error(`map_elements is empty for ${levelId}`);
    levels[levelId] = { routeWaypoints, buildCells, routeOpenRules, elements };
  }

  return { levels, defaultLevelId };
}

function buildRouteWaypoints(rows: CsvRow[], levelId: string, route: RouteVariant): GridPos[] {
  const points = rows
    .filter((row) => (row.level_id || 'level_1') === levelId && row.route === route)
    .sort((a, b) => (numberValue(a.seq) ?? 0) - (numberValue(b.seq) ?? 0))
    .map((row) => {
      const col = numberValue(row.col);
      const rowIndex = numberValue(row.row);
      return col == null || rowIndex == null ? null : { col, row: rowIndex };
    })
    .filter((cell): cell is GridPos => cell != null);
  if (points.length < 2) throw new Error(`map_routes missing ${levelId} route ${route}`);
  return points;
}

function buildRouteCells(rows: CsvRow[], levelId: string, route: RouteVariant): GridPos[] {
  return rows
    .filter((row) => (row.level_id || 'level_1') === levelId && row.route === route)
    .map((row) => {
      const col = numberValue(row.col);
      const rowIndex = numberValue(row.row);
      return col == null || rowIndex == null ? null : { col, row: rowIndex };
    })
    .filter((cell): cell is GridPos => cell != null);
}

function buildRouteOpenRules(rows: CsvRow[], levelId: string): MapConfigData['levels'][string]['routeOpenRules'] {
  return rows
    .filter((row) => (row.level_id || 'level_1') === levelId)
    .map((row) => {
      const primaryRoute = asRouteVariant(row.primary_route);
      const minWave = numberValue(row.min_wave);
      const maxWave = numberValue(row.max_wave);
      const openRoutes = row.open_routes
        .split('|')
        .map(asRouteVariant)
        .filter((route): route is RouteVariant => route != null);
      if (!primaryRoute || minWave == null || !openRoutes.length) return null;
      return { minWave, maxWave, primaryRoute, openRoutes };
    })
    .filter((rule): rule is MapConfigData['levels'][string]['routeOpenRules'][number] => rule != null);
}

function buildMapElements(rows: CsvRow[], levelId: string): MapElementSpec[] {
  return rows
    .filter((row) => (row.level_id || 'level_1') === levelId)
    .map((row) => {
      const kind = asMapElementKind(row.kind);
      const col = numberValue(row.col);
      const rowIndex = numberValue(row.row);
      if (!row.id || !kind || col == null || rowIndex == null) return null;
      return {
        levelId,
        id: row.id,
        kind,
        waveStart: numberValue(row.wave_start) ?? 1,
        waveEnd: row.wave_end ? numberValue(row.wave_end) : null,
        cell: { col, row: rowIndex },
        radiusCells: numberValue(row.radius_cells) ?? 0,
        hp: numberValue(row.hp) ?? 0,
        reward: numberValue(row.reward) ?? 0,
        cooldownMs: numberValue(row.cooldown_ms) ?? 0,
        effectMul: numberValue(row.effect_mul) ?? 1,
        pairId: row.pair_id ?? '',
        route: asRouteVariant(row.route),
        note: row.note ?? '',
      };
    })
    .filter((element): element is MapElementSpec => element != null);
}

function buildRouteStrategyConfig(
  preferenceRows: CsvRow[],
  weightRows: CsvRow[],
): Partial<RouteStrategyConfig> {
  // enemy_route_preferences 只描述优先级顺序，权重由 route_strategy_weights 单独配置。
  const preferences: RouteStrategyConfig['enemyRoutePreferences'] = {
    anxiety: [],
    depression: [],
    obsession: [],
    guilt: [],
    ptsd: [],
  };

  for (const kind of enemyKinds) {
    const routes = preferenceRows
      .filter((row) => row.enemy === kind)
      .sort((a, b) => (numberValue(a.priority) ?? 0) - (numberValue(b.priority) ?? 0))
      .map((row) => asRouteVariant(row.route))
      .filter((route): route is RouteVariant => route != null);
    if (routes.length) preferences[kind] = routes;
  }

  const weights = new Map(weightRows.map((row) => [row.key, numberValue(row.value)]));
  return {
    enemyRoutePreferences: preferences,
    strategyRouteWeight: weights.get('strategy_route_weight') ?? undefined,
    kindPreferenceWeight: weights.get('kind_preference_weight') ?? undefined,
  };
}

function applyMindCacheConfig(rows: CsvRow[]): void {
  const next = { ...mindCacheConfig };
  for (const row of rows) {
    const value = numberValue(row.value);
    if (value == null) continue;
    if (row.key === 'base_count') next.baseCount = value;
    if (row.key === 'count_per_wave') next.countPerWave = value;
    if (row.key === 'max_count_bonus') next.maxCountBonus = value;
    if (row.key === 'base_hp') next.baseHp = value;
    if (row.key === 'hp_per_wave') next.hpPerWave = value;
    if (row.key === 'hp_random') next.hpRandom = value;
    if (row.key === 'base_reward') next.baseReward = value;
    if (row.key === 'reward_per_wave') next.rewardPerWave = value;
    if (row.key === 'reward_wave_cap') next.rewardWaveCap = value;
    if (row.key === 'reward_random') next.rewardRandom = value;
    if (row.key === 'near_build_radius_sq') next.nearBuildRadiusSq = value;
  }
  mindCacheConfig = next;
}

function applyDifficultyConfig(rows: CsvRow[]): void {
  const next = { ...difficultyConfig };
  for (const row of rows) {
    const difficulty = asDifficultyKind(row.difficulty);
    if (!difficulty) continue;
    next[difficulty] = {
      sanityStart: numberValue(row.sanity_start) ?? next[difficulty].sanityStart,
      sanityMax: numberValue(row.sanity_max) ?? next[difficulty].sanityMax,
      mindStart: numberValue(row.mind_start) ?? next[difficulty].mindStart,
    };
  }
  difficultyConfig = next;
}

function applyWaveScalingConfig(rows: CsvRow[]): void {
  const values = new Map(rows.map((row) => [row.key, numberValue(row.value)]));
  waveScalingConfig = {
    lateStartWave: values.get('late_start_wave') ?? waveScalingConfig.lateStartWave,
    hpPerWave: values.get('hp_per_wave') ?? waveScalingConfig.hpPerWave,
    hpLatePerWave: values.get('hp_late_per_wave') ?? waveScalingConfig.hpLatePerWave,
    speedPerWave: values.get('speed_per_wave') ?? waveScalingConfig.speedPerWave,
    speedLatePerWave: values.get('speed_late_per_wave') ?? waveScalingConfig.speedLatePerWave,
    damagePerWave: values.get('damage_per_wave') ?? waveScalingConfig.damagePerWave,
    damageLatePerWave: values.get('damage_late_per_wave') ?? waveScalingConfig.damageLatePerWave,
    bountyPerWave: values.get('bounty_per_wave') ?? waveScalingConfig.bountyPerWave,
    bossHpMul: values.get('boss_hp_mul') ?? waveScalingConfig.bossHpMul,
    bossDamageMul: values.get('boss_damage_mul') ?? waveScalingConfig.bossDamageMul,
  };
}

function applyBossCombatConfig(rows: CsvRow[]): void {
  // BOSS 配置分为全局节奏、波次技能和技能明细三层，先深拷贝默认值再覆盖。
  const next: BossCombatConfig = {
    summonIntervalMs: bossCombatConfig.summonIntervalMs,
    coreTickIntervalMs: bossCombatConfig.coreTickIntervalMs,
    coreDamageFactor: bossCombatConfig.coreDamageFactor,
    coreMinDamage: bossCombatConfig.coreMinDamage,
    waveSkills: { ...bossCombatConfig.waveSkills },
    skills: Object.fromEntries(
      BOSS_SKILL_KINDS.map((kind) => [kind, cloneBossSkillConfig(bossCombatConfig.skills[kind])]),
    ) as Record<BossSkillKind, BossSkillConfig>,
  };

  for (const row of rows) {
    const category = row.category;
    const skill = asBossSkillKind(row.key);
    const value = numberValue(row.value);

    if (category === 'global') {
      if (row.key === 'summon_interval_ms' && value != null) next.summonIntervalMs = value;
      if (row.key === 'core_tick_interval_ms' && value != null) next.coreTickIntervalMs = value;
      if (row.key === 'core_damage_factor' && value != null) next.coreDamageFactor = value;
      if (row.key === 'core_min_damage' && value != null) next.coreMinDamage = value;
    } else if (category === 'wave_skill') {
      const wave = numberValue(row.key);
      const waveSkill = asBossSkillKind(row.value);
      if (wave != null && waveSkill) next.waveSkills[wave] = waveSkill;
    } else if (skill) {
      const cfg = next.skills[skill];
      if (category === 'skill_display' && row.value) cfg.displayName = row.value;
      if (category === 'skill_aura_speed_mul' && value != null) cfg.auraSpeedMul = value;
      if (category === 'skill_enraged_damage_mul' && value != null) cfg.enragedDamageMul = value;
      if (category === 'skill_shield_max_hp_ratio' && value != null) cfg.shieldMaxHpRatio = value;
      if (category === 'skill_enraged_damage_taken_mul' && value != null) cfg.enragedDamageTakenMul = value;
      if (category === 'minion_kind') cfg.minion.kind = asEnemyKind(row.value) ?? cfg.minion.kind;
      if (category === 'minion_hp_mul' && value != null) cfg.minion.hpMul = value;
      if (category === 'minion_speed_mul' && value != null) cfg.minion.speedMul = value;
      if (category === 'minion_path_bias') cfg.minion.pathBias = asPathBias(row.value) ?? cfg.minion.pathBias;
      if (category === 'minion_skills') cfg.minion.skills = parsePipeSkills(row.value);
    }
  }

  bossCombatConfig = next;
}

function cloneBossSkillConfig(config: BossSkillConfig): BossSkillConfig {
  return {
    ...config,
    minion: {
      ...config.minion,
      skills: [...config.minion.skills],
    },
  };
}

function parsePipeSkills(raw: string): SkillFlag[] {
  if (!raw) return [];
  return raw
    .split('|')
    .map((skill) => skill.trim())
    .filter((skill): skill is SkillFlag => skillFlags.includes(skill as SkillFlag));
}

function delayValues(first: string, interval: string, count: number): number[] {
  const exact = first
    .split('/')
    .map((value) => numberValue(value))
    .filter((value): value is number => value != null);
  if (exact.length > 1) return exact;

  const start = exact[0] ?? 0;
  const step = numberValue(interval) ?? 0;
  return Array.from({ length: count }, (_, i) => Math.round(start + i * step));
}

function parseSkills(raw: string): SkillFlag[] {
  if (!raw) return [];
  return raw
    .split(/[\/|;；、\s]+/)
    .map((skill) => skill.trim())
    .filter((skill): skill is SkillFlag => skillFlags.includes(skill as SkillFlag));
}

function minWaveFromCondition(raw: string): number | null {
  const match = raw.match(/第\s*(\d+)\s*波起/);
  return match ? Number(match[1]) : null;
}

function waveRangeFromCondition(raw: string): Pick<AggressionRange, 'minWave' | 'maxWave'> | null {
  const range = raw.match(/第\s*(\d+)\s*-\s*(\d+)\s*波/);
  if (range) return { minWave: Number(range[1]), maxWave: Number(range[2]) };
  const minOnly = raw.match(/第\s*(\d+)\s*波起/);
  if (minOnly) return { minWave: Number(minOnly[1]), maxWave: null };
  return null;
}

function numericRange(raw: string): Pick<AggressionRange, 'min' | 'max'> | null {
  const match = raw.match(/(-?\d+(?:\.\d+)?)\s*到\s*(-?\d+(?:\.\d+)?)/);
  if (!match) return null;
  return { min: Number(match[1]), max: Number(match[2]) };
}

function numberValue(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = Number(raw.replace(/"/g, '').replace('%', ''));
  return Number.isFinite(n) ? n : null;
}

function percentValue(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = numberValue(raw);
  if (n == null) return null;
  return raw.includes('%') ? n / 100 : n;
}

function asTowerKind(value: string): TowerKind | null {
  return towerKinds.includes(value as TowerKind) ? value as TowerKind : null;
}

function asEnemyKind(value: string): EnemyKind | null {
  return enemyKinds.includes(value as EnemyKind) ? value as EnemyKind : null;
}

function asFormation(value: string): Formation | null {
  return formations.includes(value as Formation) ? value as Formation : null;
}

function asPathBias(value: string): PathBias | null {
  return pathBiases.includes(value as PathBias) ? value as PathBias : null;
}

function asRouteVariant(value: string): RouteVariant | null {
  return routeVariants.includes(value as RouteVariant) ? value as RouteVariant : null;
}

function asSkillFlag(value: string): SkillFlag | null {
  return skillFlags.includes(value as SkillFlag) ? value as SkillFlag : null;
}

function asLevelRule(value: string): LevelRuleKind | null {
  return levelRules.includes(value as LevelRuleKind) ? value as LevelRuleKind : null;
}

function asMapElementKind(value: string): MapElementKind | null {
  return mapElementKinds.includes(value as MapElementKind) ? value as MapElementKind : null;
}

function asDifficultyKind(value: string): DifficultyKind | null {
  const difficulties: DifficultyKind[] = ['easy', 'normal', 'hard'];
  return difficulties.includes(value as DifficultyKind) ? value as DifficultyKind : null;
}

function asBossSkillKind(value: string): BossSkillKind | null {
  return BOSS_SKILL_KINDS.includes(value as BossSkillKind) ? value as BossSkillKind : null;
}

function asBehavior(value: string): EnemyDef['behavior'] | null {
  const behaviors = ['rush', 'aura', 'loop', 'cloak', 'flicker'] as const;
  return behaviors.includes(value as typeof behaviors[number])
    ? value as typeof behaviors[number]
    : null;
}
