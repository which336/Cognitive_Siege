import { ENEMY_DEFS } from '../game/data/enemies';
import {
  AgentProofSnapshot,
  AgentProofWaveSummary,
  EnemyKind,
  EnemySpawnSpec,
  MapProjectionSummary,
  ReviewResult,
  SkillFlag,
  WaveSpec,
} from '../types';
import { el, mountOverlay, typewriter } from './dom';

interface ShowReviewOpts {
  result: ReviewResult;
  changes: string[];        // human-readable list of next-wave changes
  nextWaveLabel: string;    // e.g. "下一波 / Wave 6 之 10"
  onContinue: () => void;
  isLoading?: boolean;
  onLoadingMsg?: string;
  proof?: AgentProofSnapshot;
  nextWave?: WaveSpec;
}

/**
 * Show the review panel. If isLoading=true, displays a thinking spinner with
 * a placeholder card; the caller swaps it via showReview again once result arrives.
 */
export function showReview(opts: ShowReviewOpts): { close: () => void } {
  const panel = el('div', { cls: 'cs-panel wide' });

  panel.appendChild(el('div', { cls: 'cs-panel-title', text: '心魔复盘' }));
  panel.appendChild(el('div', { cls: 'cs-panel-sub', text: '心魔战后复盘' }));

  if (opts.isLoading) {
    panel.appendChild(el('div', { cls: 'cs-thinking', text: opts.onLoadingMsg ?? '心魔们在低声商议……' }));
    panel.appendChild(el('div', { cls: 'cs-monologue', text: '……' }));
  } else {
    const r = opts.result;
    // Source badge
    const sourceLabel = el('div', {
      cls: 'cs-section-label',
      text: r.fromLLM ? `大模型实时生成 · 心声 #${Math.floor(Math.random() * 9000 + 1000)}` : '本地心声库（未配置大模型时启用）',
    });
    panel.appendChild(sourceLabel);

    // Monologue with typewriter effect
    const mono = el('div', { cls: 'cs-monologue' });
    panel.appendChild(mono);
    typewriter(mono, r.monologue, 36);

    // Lessons
    if (r.lesson.length) {
      panel.appendChild(el('div', { cls: 'cs-section', attrs: { style: 'margin-top:18px;' } }, [
        el('div', { cls: 'cs-section-label', text: '它们学到了什么' }),
        el('div', { cls: '', attrs: { style: 'padding-top:6px;' } },
          r.lesson.map(t => el('span', { cls: 'cs-lesson-tag', text: t }))),
      ]));
    }

    if (opts.nextWave) {
      panel.appendChild(renderNextWavePreview(opts.nextWave));
    }

    const ns = r.next_strategy;
    panel.appendChild(el('details', { cls: 'cs-section cs-review-details' }, [
      el('summary', { text: '展开复盘策略细节' }),
      el('div', { cls: 'cs-strategy-block' }, [
        el('div', { cls: 'cs-strategy-card' }, [
          el('div', { cls: 'lbl', text: '路线偏好' }),
          el('div', { cls: 'val', text: pathLabel(ns.path_weight_shift) }),
        ]),
        el('div', { cls: 'cs-strategy-card' }, [
          el('div', { cls: 'lbl', text: '推进编队' }),
          el('div', { cls: 'val', text: formationLabel(ns.formation) }),
        ]),
        el('div', { cls: 'cs-strategy-card' }, [
          el('div', { cls: 'lbl', text: '进攻强度' }),
          el('div', { cls: 'val', text: ns.aggression.toFixed(2) }),
        ]),
        el('div', { cls: 'cs-strategy-card' }, [
          el('div', { cls: 'lbl', text: '技能优先' }),
          el('div', { cls: 'val', text: ns.skill_priority.map(skillLabel).join(' · ') || '—' }),
        ]),
        el('div', { cls: 'cs-strategy-card', attrs: { style: 'grid-column: span 2;' } }, [
          el('div', { cls: 'lbl', text: '偏好心魔' }),
          el('div', { cls: 'val', text: ns.preferred_kinds.map(kindLabel).join(' · ') || '—' }),
        ]),
      ]),
    ]));

    // Concrete changes that the engine applied
    if (opts.changes.length) {
      panel.appendChild(el('div', { cls: 'cs-section' }, [
        el('div', { cls: 'cs-section-label', text: '已生效的下波变化' }),
        ...opts.changes.map(c =>
          el('div', { cls: '', attrs: { style: 'font-size:13px; color:#34d399; padding:3px 0; letter-spacing:1px;' }, text: '› ' + c }),
        ),
      ]));
    }

    if (opts.proof) {
      panel.appendChild(renderAgentProof(opts.proof));
    }

    panel.appendChild(el('div', { cls: 'cs-actions' }, [
      el('button', {
        cls: 'cs-btn primary',
        text: opts.nextWaveLabel,
        on: { click: () => { handle.close(); opts.onContinue(); } },
      }),
    ]));
  }

  const handle = mountOverlay(panel);
  return handle;
}

interface SpawnGroup {
  kind: EnemyKind;
  count: number;
  firstMs: number;
  lastMs: number;
  skills: SkillFlag[];
  hpMin: number;
  hpMax: number;
  spdMin: number;
  spdMax: number;
}

function renderNextWavePreview(wave: WaveSpec): HTMLElement {
  const groups = groupSpawnsByOrder(wave.spawns);
  return el('div', { cls: 'cs-section cs-next-wave' }, [
    el('div', { cls: 'cs-section-label', text: `下一波实际出怪 · 第 ${wave.index} 波 · 共 ${wave.spawns.length} 个` }),
    el('div', { cls: 'cs-next-wave-lead', text: `${wave.isBoss ? '首领波' : '普通波'} · ${formationLabel(wave.formation)} · 开波念力 +${wave.mindGift}` }),
    el('div', { cls: 'cs-next-wave-list' },
      groups.map((group, index) => spawnGroupRow(group, index))),
    el('div', { cls: 'cs-next-wave-traits' },
      uniqueKinds(wave.spawns).map(kindTraitCard)),
  ]);
}

function groupSpawnsByOrder(spawns: EnemySpawnSpec[]): SpawnGroup[] {
  const ordered = [...spawns].sort((a, b) => a.delayMs - b.delayMs);
  const groups: SpawnGroup[] = [];

  for (const spawn of ordered) {
    const skills = [...spawn.skills].sort() as SkillFlag[];
    const prev = groups[groups.length - 1];
    if (prev && prev.kind === spawn.kind && sameSkills(prev.skills, skills)) {
      prev.count++;
      prev.lastMs = spawn.delayMs;
      prev.hpMin = Math.min(prev.hpMin, spawn.hpMul);
      prev.hpMax = Math.max(prev.hpMax, spawn.hpMul);
      prev.spdMin = Math.min(prev.spdMin, spawn.speedMul);
      prev.spdMax = Math.max(prev.spdMax, spawn.speedMul);
      continue;
    }

    groups.push({
      kind: spawn.kind,
      count: 1,
      firstMs: spawn.delayMs,
      lastMs: spawn.delayMs,
      skills,
      hpMin: spawn.hpMul,
      hpMax: spawn.hpMul,
      spdMin: spawn.speedMul,
      spdMax: spawn.speedMul,
    });
  }

  return groups;
}

function sameSkills(a: SkillFlag[], b: SkillFlag[]): boolean {
  return a.length === b.length && a.every((skill, index) => skill === b[index]);
}

function spawnGroupRow(group: SpawnGroup, index: number): HTMLElement {
  const def = ENEMY_DEFS[group.kind];
  const time = group.firstMs === group.lastMs
    ? `${formatSeconds(group.firstMs)}s`
    : `${formatSeconds(group.firstMs)}-${formatSeconds(group.lastMs)}s`;
  const skillText = group.skills.length ? group.skills.map(skillLabel).join(' / ') : '无额外技能';
  const mulText = `生命 ${formatMulRange(group.hpMin, group.hpMax)} · 速度 ${formatMulRange(group.spdMin, group.spdMax)}`;

  return el('div', { cls: 'cs-next-wave-row' }, [
    el('div', { cls: 'idx', text: String(index + 1) }),
    el('div', { cls: 'main' }, [
      el('div', { cls: 'name', text: `${def.displayName} ×${group.count}` }),
      el('div', { cls: 'meta', text: `${time} 出场 · ${skillText}` }),
    ]),
    el('div', { cls: 'stat', text: mulText }),
  ]);
}

function kindTraitCard(kind: EnemyKind): HTMLElement {
  const def = ENEMY_DEFS[kind];
  return el('div', { cls: 'cs-next-wave-trait' }, [
    el('div', { cls: 'name', text: def.displayName }),
    el('div', { cls: 'desc', text: enemyTrait(kind) }),
  ]);
}

function uniqueKinds(spawns: EnemySpawnSpec[]): EnemyKind[] {
  const out: EnemyKind[] = [];
  for (const spawn of spawns) {
    if (!out.includes(spawn.kind)) out.push(spawn.kind);
  }
  return out;
}

function enemyTrait(kind: EnemyKind): string {
  return ({
    anxiety: '高速低血，容易漏，怕范围伤害。',
    depression: '高血慢速，会降低附近塔射速，适合用信念塔点杀。',
    obsession: '会回头反刍，并给周围同伴加速，需优先处理。',
    guilt: '带伪装，普通塔不稳定，需共鸣塔破隐。',
    ptsd: '受伤会向前闪回，难被路障拖住，核心前要补火力。',
  } as Record<EnemyKind, string>)[kind];
}

function formatSeconds(ms: number): string {
  return (ms / 1000).toFixed(ms % 1000 === 0 ? 0 : 1);
}

function formatMulRange(min: number, max: number): string {
  return min === max ? `×${min.toFixed(2)}` : `×${min.toFixed(2)}-${max.toFixed(2)}`;
}

function renderAgentProof(proof: AgentProofSnapshot): HTMLElement {
  const sourceLabel = proof.source === 'llm' ? '实时大模型' : '本地心声库';
  const statusLabel = ({
    llm_parsed: '在线模型返回结构化结果，已解析并应用',
    demo_fallback: '演示模式：使用本地策略库，仍走完整应用链路',
    online_fallback: '在线调用或解析失败，本地策略库已接管并应用',
  } as Record<AgentProofSnapshot['status'], string>)[proof.status];

  const flow = el('div', { cls: 'cs-proof-flow' }, [
    proofStep('1', '战斗摘要', [
      `第 ${proof.summary.wave} 波 · ${outcomeLabel(proof.summary.outcome)}`,
      `击杀 ${proof.summary.enemiesKilled} / 漏网 ${proof.summary.enemiesLeaked}`,
      `理智 ${signed(proof.summary.sanityDelta)} → ${proof.summary.sanityAfter}`,
    ]),
    proofStep('2', '复盘智能体', [
      `${sourceLabel} · ${proof.mode === 'demo' ? '演示模式' : '在线模式'}`,
      statusLabel,
    ]),
    proofStep('3', '结构化策略', [
      `${pathLabel(proof.strategy.path_weight_shift)} · ${formationLabel(proof.strategy.formation)}`,
      `进攻强度 ${proof.strategy.aggression.toFixed(2)}`,
      `技能 ${proof.strategy.skill_priority.map(skillLabel).join(' / ') || '—'}`,
    ]),
    proofStep('4', '引擎落地', [
      proof.changes.length ? `${proof.changes.length} 条变化已写入下一波` : '没有下一波可改写',
      proof.nextWaveAfter ? waveDigest(proof.nextWaveAfter) : '终局状态',
      proof.mapChange ? mapChangeDigest(proof.mapChange.after) : '地图投影保持当前终局状态',
    ]),
  ]);

  const raw = {
    本波摘要: proof.summary,
    生成来源: sourceLabel,
    运行模式: proof.mode === 'demo' ? '演示模式' : '在线模式',
    解析状态: statusLabel,
    结构化策略: {
      路线偏好: pathLabel(proof.strategy.path_weight_shift),
      技能优先: proof.strategy.skill_priority.map(skillLabel),
      推进编队: formationLabel(proof.strategy.formation),
      进攻强度: proof.strategy.aggression,
      偏好心魔: proof.strategy.preferred_kinds.map(kindLabel),
    },
    已生效变化: proof.changes,
    下一波改写前: proof.nextWaveBefore ? localizeWaveSummary(proof.nextWaveBefore) : null,
    下一波改写后: proof.nextWaveAfter ? localizeWaveSummary(proof.nextWaveAfter) : null,
    地图投影变化: proof.mapChange ? {
      改写前: localizeMapSummary(proof.mapChange.before),
      改写后: localizeMapSummary(proof.mapChange.after),
    } : null,
  };

  return el('details', { cls: 'cs-section cs-proof cs-review-details' }, [
    el('summary', { text: '展开智能体证据链' }),
    el('div', { cls: 'cs-proof-lead', text: '这不是装饰文本：复盘结果会进入策略应用器，并改写下一波的实际出怪表。' }),
    flow,
    renderProofDiff(proof),
    proof.mapChange ? renderMapChange(proof.mapChange.before, proof.mapChange.after) : null,
    el('details', { cls: 'cs-proof-details' }, [
      el('summary', { text: '展开压缩技术数据' }),
      el('pre', { text: JSON.stringify(raw, null, 2) }),
    ]),
  ]);
}

function proofStep(index: string, title: string, lines: string[]): HTMLElement {
  return el('div', { cls: 'cs-proof-step' }, [
    el('div', { cls: 'cs-proof-step-head' }, [
      el('span', { cls: 'idx', text: index }),
      el('span', { cls: 'title', text: title }),
    ]),
    ...lines.map(line => el('div', { cls: 'line', text: line })),
  ]);
}

function renderProofDiff(proof: AgentProofSnapshot): HTMLElement {
  if (!proof.nextWaveBefore || !proof.nextWaveAfter) {
    return el('div', { cls: 'cs-proof-terminal', text: '当前为终局复盘，没有下一波需要改写。' });
  }

  return el('div', { cls: 'cs-proof-diff' }, [
    waveCard('改写前', proof.nextWaveBefore),
    el('div', { cls: 'cs-proof-arrow', text: '→' }),
    waveCard('改写后', proof.nextWaveAfter),
  ]);
}

function waveCard(label: string, wave: AgentProofWaveSummary): HTMLElement {
  return el('div', { cls: 'cs-proof-wave' }, [
    el('div', { cls: 'label', text: label }),
    el('div', { cls: 'main', text: waveDigest(wave) }),
    el('div', { cls: 'meta', text: `阵容：${formatKindRecord(wave.kinds) || '—'}` }),
    el('div', { cls: 'meta', text: `技能：${formatSkillRecord(wave.skills) || '—'}` }),
    el('div', { cls: 'meta', text: `生命倍率 ${formatRange(wave.hpMulRange)} · 速度倍率 ${formatRange(wave.speedMulRange)}` }),
  ]);
}

function renderMapChange(before: MapProjectionSummary, after: MapProjectionSummary): HTMLElement {
  return el('div', { cls: 'cs-proof-diff' }, [
    mapCard('地图改写前', before),
    el('div', { cls: 'cs-proof-arrow', text: '→' }),
    mapCard('地图改写后', after),
  ]);
}

function mapCard(label: string, map: MapProjectionSummary): HTMLElement {
  return el('div', { cls: 'cs-proof-wave' }, [
    el('div', { cls: 'label', text: label }),
    el('div', { cls: 'main', text: mapChangeDigest(map) }),
    el('div', { cls: 'meta', text: `攻击意图：${map.attackIntent}` }),
    el('div', { cls: 'meta', text: `开放路线：${map.activeRoutes.map(routeVariantLabel).join(' / ')}` }),
    el('div', { cls: 'meta', text: `暗显岔路：${map.inactiveRoutes.map(routeVariantLabel).join(' / ') || '—'}` }),
  ]);
}

function mapChangeDigest(map: MapProjectionSummary): string {
  return `${map.activeRouteLabel}方案 · 开放 ${map.activeRoutes.length} 条路线 · 固定塔位 ${map.buildCellCount} 格`;
}

function waveDigest(wave: AgentProofWaveSummary): string {
  const boss = wave.isBoss ? '首领波' : '普通波';
  const paths = wave.pathBiases.map(pathLabel).join('/') || '—';
  return `第 ${wave.wave} 波 · ${boss} · ${wave.spawnCount} 个心魔 · ${formationLabel(wave.formation)} · 路线 ${paths}`;
}

function formatRecord(record: Partial<Record<string, number>>, labeler: (key: string) => string): string {
  return Object.entries(record)
    .filter(([, value]) => typeof value === 'number' && value > 0)
    .map(([key, value]) => `${labeler(key)}×${value}`)
    .join(' / ');
}

function formatKindRecord(record: AgentProofWaveSummary['kinds']): string {
  return formatRecord(record, key => kindLabel(key as Parameters<typeof kindLabel>[0]));
}

function formatSkillRecord(record: AgentProofWaveSummary['skills']): string {
  return formatRecord(record, key => skillLabel(key as Parameters<typeof skillLabel>[0]));
}

function formatRange(range: [number, number]): string {
  return range[0] === range[1] ? `${range[0]}` : `${range[0]}-${range[1]}`;
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

function localizeWaveSummary(wave: AgentProofWaveSummary): Record<string, unknown> {
  return {
    波次: wave.wave,
    类型: wave.isBoss ? '首领波' : '普通波',
    编队: formationLabel(wave.formation),
    念力奖励: wave.mindGift,
    出怪数量: wave.spawnCount,
    首个出怪毫秒: wave.firstSpawnMs,
    最后出怪毫秒: wave.lastSpawnMs,
    路线偏好: wave.pathBiases.map(pathLabel),
    阵容: Object.fromEntries(Object.entries(wave.kinds).map(([k, v]) => [kindLabel(k as Parameters<typeof kindLabel>[0]), v])),
    技能: Object.fromEntries(Object.entries(wave.skills).map(([k, v]) => [skillLabel(k as Parameters<typeof skillLabel>[0]), v])),
    生命倍率范围: wave.hpMulRange,
    速度倍率范围: wave.speedMulRange,
  };
}

function localizeMapSummary(map: MapProjectionSummary): Record<string, unknown> {
  return {
    地图方案: map.activeRouteLabel,
    开放路线: map.activeRoutes.map(routeVariantLabel),
    暗显岔路: map.inactiveRoutes.map(routeVariantLabel),
    攻击意图: map.attackIntent,
    可建塔格: map.buildCellCount,
    阻挡格: map.blockedCellCount,
    固定塔位: map.towerPocketCount,
    进攻强度标记: map.corruptionLevel,
  };
}

function outcomeLabel(outcome: AgentProofSnapshot['summary']['outcome']): string {
  return ({
    cleared: '已清除',
    survived: '幸存',
    failed: '失败',
  } as Record<AgentProofSnapshot['summary']['outcome'], string>)[outcome];
}

function pathLabel(path: AgentProofSnapshot['strategy']['path_weight_shift']): string {
  return ({
    short: '最短路径',
    long: '绕远路',
    edge: '贴边迂回',
    center: '正面强突',
    random: '路线扰动',
  } as Record<AgentProofSnapshot['strategy']['path_weight_shift'], string>)[path];
}

function routeVariantLabel(route: MapProjectionSummary['activeRoute']): string {
  return ({
    short: '短快主干',
    long: '长绕路线',
    edge: '边偷路线',
  } as Record<MapProjectionSummary['activeRoute'], string>)[route];
}

function formationLabel(formation: AgentProofSnapshot['strategy']['formation']): string {
  return ({
    scattered: '散兵线',
    clustered: '密集成团',
    wedge: '楔形加速',
    rear_first: '重型先行',
  } as Record<AgentProofSnapshot['strategy']['formation'], string>)[formation];
}

function skillLabel(skill: AgentProofSnapshot['strategy']['skill_priority'][number]): string {
  return ({
    stealth: '伪装',
    swarm: '蜂拥',
    rush: '疾走',
    split: '分裂',
    taunt: '嘲讽',
    shield: '护盾',
  } as Record<AgentProofSnapshot['strategy']['skill_priority'][number], string>)[skill];
}

function kindLabel(kind: AgentProofSnapshot['strategy']['preferred_kinds'][number]): string {
  return ({
    anxiety: '焦虑',
    depression: '抑郁',
    obsession: '强迫',
    guilt: '自责',
    ptsd: '创伤',
  } as Record<AgentProofSnapshot['strategy']['preferred_kinds'][number], string>)[kind];
}
