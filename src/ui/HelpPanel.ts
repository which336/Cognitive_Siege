import { ALL_ENEMY_KINDS, ENEMY_DEFS } from '../game/data/enemies';
import { ALL_TOWER_KINDS, TOWER_DEFS } from '../game/data/towers';
import { el, mountOverlay } from './dom';

/**
 * Codex / help overlay. Keep it focused on the portfolio-worthy core systems,
 * not on basic controls that are already visible in the HUD.
 */
export function showHelp(onClose: () => void): { close: () => void } {
  const panel = el('div', { cls: 'cs-panel wide' });
  panel.appendChild(el('div', { cls: 'cs-panel-title', text: '核心机制档案' }));
  panel.appendChild(el('div', { cls: 'cs-panel-sub', text: 'CODEX  ·  v0.7' }));

  panel.appendChild(el('div', { cls: 'cs-section-label', text: '念头塔' }));
  const towerGrid = el('div', { cls: 'cs-help-grid' });
  for (const k of ALL_TOWER_KINDS) {
    const t = TOWER_DEFS[k];
    towerGrid.appendChild(el('div', { cls: 'cs-help-card' }, [
      el('div', { cls: 'name', text: `${t.displayName}　[${t.cost} 念力]` }),
      el('div', {
        cls: 'desc',
        text: `${t.desc}  基础：伤害 ${t.damage} / 射程 ${t.range} / 射速 ${t.fireRate}/秒。`,
      }),
    ]));
  }
  panel.appendChild(towerGrid);

  panel.appendChild(el('div', {
    cls: 'cs-section-label',
    attrs: { style: 'margin-top:24px;' },
    text: '人格化心魔',
  }));
  const enemyGrid = el('div', { cls: 'cs-help-grid' });
  for (const k of ALL_ENEMY_KINDS) {
    const e = ENEMY_DEFS[k];
    enemyGrid.appendChild(el('div', { cls: 'cs-help-card' }, [
      el('div', { cls: 'name', text: e.displayName }),
      el('div', {
        cls: 'desc',
        text: `${e.desc}  基础：HP ${e.hp} / 速度 ${e.speed} / 核心伤害 ${e.damage}。`,
      }),
    ]));
  }
  panel.appendChild(enemyGrid);

  panel.appendChild(el('div', {
    cls: 'cs-section-label',
    attrs: { style: 'margin-top:24px;' },
    text: 'AI Agent 系统',
  }));
  const agentGrid = el('div', { cls: 'cs-help-grid' });
  agentGrid.appendChild(el('div', { cls: 'cs-help-card' }, [
    el('div', { cls: 'name', text: '心魔复盘 Review Agent' }),
    el('div', {
      cls: 'desc',
      text:
        '每波结束后，幸存的心魔会公开回看自己的失败：在哪儿被打、被谁打、有没有用对技能。' +
        '它们会发布一段"内心独白"和一份 next_strategy（路径偏好/编队/技能优先级/侵略性等），' +
        '下一波就真的按这个策略来。它们越聪明，你的塔阵就越容易被针对。',
    }),
  ]));
  agentGrid.appendChild(el('div', { cls: 'cs-help-card' }, [
    el('div', { cls: 'name', text: 'Boss 谈判 Negotiation Agent' }),
    el('div', {
      cls: 'desc',
      text:
        'BOSS 战会进入多轮对话。你的每一次回应（"质问 / 共情 / 沉默 / 回避"）都会改变这位 BOSS 的' +
        'HP/速度/伤害——共情足够多，它甚至会主动认输；强硬只会让它狂化。这是除了塔阵之外，' +
        '另一条胜利路线。',
    }),
  ]));
  agentGrid.appendChild(el('div', { cls: 'cs-help-card' }, [
    el('div', { cls: 'name', text: '开场旁白 Director Agent' }),
    el('div', {
      cls: 'desc',
      text:
        '每一夜开场，由"叙事调度 Agent"根据当前心魔氛围生成一段短小的小说式情境，' +
        '把"为什么今晚是这些心魔"埋进剧情里。',
    }),
  ]));
  panel.appendChild(agentGrid);

  panel.appendChild(el('div', {
    cls: 'cs-section-label',
    attrs: { style: 'margin-top:24px;' },
    text: '战斗核心机制',
  }));
  const opsGrid = el('div', { cls: 'cs-help-grid' });
  opsGrid.appendChild(el('div', { cls: 'cs-help-card' }, [
    el('div', { cls: 'name', text: '波次递增' }),
    el('div', {
      cls: 'desc',
      text:
        '每过一波，所有心魔的属性自动提升：HP +18%、伤害 +16%、速度 +4%、击杀奖励 +10%。' +
        'BOSS 在此基础上再额外 ×1.55 HP / ×1.30 伤害——后期没有"白嫖"波次，必须升塔或重排。',
    }),
  ]));
  opsGrid.appendChild(el('div', { cls: 'cs-help-card' }, [
    el('div', { cls: 'name', text: 'BOSS 核心压迫' }),
    el('div', {
      cls: 'desc',
      text:
        '普通心魔抵达自我核心时一次性扣除 SAN 并消失；BOSS 不会立刻离场。' +
        '它会停在核心处持续施压，每 0.9 秒扣除 SAN，直到被塔击杀或 SAN 归零。' +
        'SAN 为 0 时游戏失败。',
    }),
  ]));
  opsGrid.appendChild(el('div', { cls: 'cs-help-card' }, [
    el('div', { cls: 'name', text: '理智与幻觉' }),
    el('div', {
      cls: 'desc',
      text:
        '理智值（SAN）低于 30 时，你的塔有概率短暂"幻觉"——胡乱攻击或停火。' +
        '自我接纳塔能持续恢复 SAN，因此后期不是单纯堆火力，而是要在输出和心理稳定之间取舍。',
    }),
  ]));
  opsGrid.appendChild(el('div', { cls: 'cs-help-card' }, [
    el('div', { cls: 'name', text: '强迫复读 Aura' }),
    el('div', {
      cls: 'desc',
      text:
        '强迫·循环者每次回头反刍时，会向半径约 3 格的所有同伴泛起一道金色光芒，' +
        '令它们 +20% 移速 1.2 秒。一只被忽略的 obsession 能把整条战线带快——优先点掉它。',
    }),
  ]));
  panel.appendChild(opsGrid);

  panel.appendChild(el('div', {
    cls: 'cs-disclaimer',
    text:
      '提示：这个档案只解释核心系统。具体塔、心魔与基础操作以游戏内按钮、弹窗和战斗反馈为准。',
  }));

  panel.appendChild(el('div', { cls: 'cs-actions' }, [
    el('button', {
      cls: 'cs-btn primary',
      text: '关闭',
      on: { click: () => { handle.close(); onClose(); } },
    }),
  ]));

  const handle = mountOverlay(panel);
  return handle;
}
