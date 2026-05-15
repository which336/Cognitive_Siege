import { ALL_ENEMY_KINDS, ENEMY_DEFS } from '../game/data/enemies';
import { ALL_TOWER_KINDS, TOWER_DEFS } from '../game/data/towers';
import { el, mountOverlay } from './dom';

/**
 * 机制档案弹层。重点解释值得展示的核心系统；
 * 已经在 HUD 中可见的基础控制只做简短说明。
 */
export function showHelp(onClose: () => void): { close: () => void } {
  const panel = el('div', { cls: 'cs-panel wide' });
  panel.appendChild(el('div', { cls: 'cs-panel-title', text: '核心机制档案' }));
  panel.appendChild(el('div', { cls: 'cs-panel-sub', text: '系统档案 · v0.1' }));

  panel.appendChild(el('div', { cls: 'cs-section-label', text: '快速上手' }));
  const starterGrid = el('div', { cls: 'cs-help-grid' });
  starterGrid.appendChild(el('div', { cls: 'cs-help-card' }, [
    el('div', { cls: 'name', text: '前 4 波教学目标' }),
    el('div', {
      cls: 'desc',
      text:
        '第 1 波先用两座低级塔铺开覆盖，不要只升级一座塔；第 2 波补信念塔打厚血；' +
        '第 3 波注意强迫的加速光环；第 4 波用共鸣塔破隐。',
    }),
  ]));
  starterGrid.appendChild(el('div', { cls: 'cs-help-card' }, [
    el('div', { cls: 'name', text: '基础操作' }),
    el('div', {
      cls: 'desc',
      text:
        '点击底部塔按钮进入建造，鼠标悬停地图会显示放置点与射程。右键或 ESC 取消选择；' +
        '点击已建塔可以查看射程、升级或拆除。',
    }),
  ]));
  starterGrid.appendChild(el('div', { cls: 'cs-help-card' }, [
    el('div', { cls: 'name', text: '路线与地形' }),
    el('div', {
      cls: 'desc',
      text:
        '发亮路线代表本波可能进攻路径。教学关会逐步开放；进阶关以本关地图规则和复盘后的实际亮线为准，' +
        '地图会随策略重构。',
    }),
  ]));
  starterGrid.appendChild(el('div', { cls: 'cs-help-card' }, [
    el('div', { cls: 'name', text: '念力残堆与塑形' }),
    el('div', {
      cls: 'desc',
      text:
        '没有心魔目标时，塔会自动攻击念力残堆并返还念力。塑形按钮会消耗念力，把普通阻塞格改成可建造格。',
    }),
  ]));
  panel.appendChild(starterGrid);

  panel.appendChild(el('div', { cls: 'cs-section-label', attrs: { style: 'margin-top:24px;' }, text: '念头塔' }));
  const towerGrid = el('div', { cls: 'cs-help-grid' });
  for (const k of ALL_TOWER_KINDS) {
    const t = TOWER_DEFS[k];
    const stats = t.special === 'percent_current'
      ? `基础：当前生命伤害 ${Math.round((t.percentCurrentHp ?? 0) * 100)}% / 射程 ${t.range} / 射速 ${t.fireRate}/秒。`
      : t.special === 'blocker'
        ? `基础：耐久 ${t.blockHp ?? 0} / 只能种在路线格 / 无攻击力 / 持续阻挡至死亡。`
        : `基础：伤害 ${t.damage} / 射程 ${t.range} / 射速 ${t.fireRate}/秒。`;
    towerGrid.appendChild(el('div', { cls: 'cs-help-card' }, [
      el('div', { cls: 'name', text: `${t.displayName}　[${t.cost} 念力]` }),
      el('div', {
        cls: 'desc',
        text: `${t.desc}  ${stats}`,
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
        text: `${e.desc}  基础：生命 ${e.hp} / 速度 ${e.speed} / 核心伤害 ${e.damage}。`,
      }),
    ]));
  }
  panel.appendChild(enemyGrid);

  panel.appendChild(el('div', {
    cls: 'cs-section-label',
    attrs: { style: 'margin-top:24px;' },
    text: '地图物件机制',
  }));
  const mapElementGrid = el('div', { cls: 'cs-help-grid' });
  mapElementGrid.appendChild(el('div', { cls: 'cs-help-card' }, [
    el('div', { cls: 'name', text: '呼吸阀' }),
    el('div', {
      cls: 'desc',
      text:
        '第 2 关出现。蓝色圆阀每 6 秒切换吸气/呼气：吸气让附近心魔加速，呼气让附近心魔更容易受伤。',
    }),
  ]));
  mapElementGrid.appendChild(el('div', { cls: 'cs-help-card' }, [
    el('div', { cls: 'name', text: '镜门' }),
    el('div', {
      cls: 'desc',
      text:
        '第 3 关出现。心魔穿过镜门后，会在约 5.5 秒后从配对路线生成半血回声体。镜门可被塔攻击，拆掉任意一侧会关闭本波后续回声。',
    }),
  ]));
  mapElementGrid.appendChild(el('div', { cls: 'cs-help-card' }, [
    el('div', { cls: 'name', text: '枯井' }),
    el('div', {
      cls: 'desc',
      text:
        '第 4 关出现。枯井是高血量资源点，存活时压制周围塔位和普通残堆，压制范围内不能建塔或塑形；击破后返还大量念力并释放塔位。',
    }),
  ]));
  mapElementGrid.appendChild(el('div', { cls: 'cs-help-card' }, [
    el('div', { cls: 'name', text: '裂隙节点' }),
    el('div', {
      cls: 'desc',
      text:
        '第 5 关出现。裂隙会让边路心魔在范围内短时加速。边界桩放在裂隙附近可以压制加速；裂隙节点也可被塔拆掉。',
    }),
  ]));
  mapElementGrid.appendChild(el('div', { cls: 'cs-help-card' }, [
    el('div', { cls: 'name', text: '审判碑' }),
    el('div', {
      cls: 'desc',
      text:
        '第 6 关出现。范围内首领、嘲讽或护盾精英会获得护盾、嘲讽优先级和减伤。塔会优先拆碑，也可以把边界桩放在光环外侧，让精英停在范围外。',
    }),
  ]));
  panel.appendChild(mapElementGrid);

  panel.appendChild(el('div', {
    cls: 'cs-section-label',
    attrs: { style: 'margin-top:24px;' },
    text: '智能体系统',
  }));
  const agentGrid = el('div', { cls: 'cs-help-grid' });
  agentGrid.appendChild(el('div', { cls: 'cs-help-card' }, [
    el('div', { cls: 'name', text: '心魔复盘智能体' }),
    el('div', {
      cls: 'desc',
      text:
        '每波结束后，幸存的心魔会公开回看自己的失败：在哪儿被打、被谁打、有没有用对技能。' +
        '它们会发布一段"内心独白"和一份结构化策略（路径偏好/编队/技能优先级/侵略性等），' +
        '下一波会按路线权重真实分路，地图机制会补充开放路线和场景压力。',
    }),
  ]));
  agentGrid.appendChild(el('div', { cls: 'cs-help-card' }, [
    el('div', { cls: 'name', text: '首领谈判智能体' }),
    el('div', {
      cls: 'desc',
      text:
        '首领战会进入多轮对话。你的每一次回应都会被标记为共情、对峙或欺骗，并改变这位首领的' +
        '生命/速度/伤害。共情会压低攻防，对峙会让它狂化，欺骗会让它迟疑但保留反扑风险。' +
        '这是除了塔阵之外的另一条战斗参数调节路线。',
    }),
  ]));
  agentGrid.appendChild(el('div', { cls: 'cs-help-card' }, [
    el('div', { cls: 'name', text: '开场旁白智能体' }),
    el('div', {
      cls: 'desc',
      text:
        '每波开场，由"叙事调度智能体"根据当前心魔氛围生成一段短小的小说式情境，' +
        '把"为什么本轮是这些心魔"埋进剧情里。',
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
        '每过一波，所有心魔的属性自动提升：生命 +18%、伤害 +16%、速度 +4%、击杀奖励 +4%。' +
        '第 6 波后生命、速度和伤害会额外加速成长；首领在此基础上再额外 ×1.55 生命 / ×1.30 伤害。',
    }),
  ]));
  opsGrid.appendChild(el('div', { cls: 'cs-help-card' }, [
    el('div', { cls: 'name', text: '首领核心压迫' }),
    el('div', {
      cls: 'desc',
      text:
        '普通心魔抵达自我核心时一次性扣除理智并消失；首领不会立刻离场。' +
        '它会停在核心处持续施压，每 0.9 秒扣除理智，直到被塔击杀或理智归零。' +
        '理智为 0 时游戏失败。',
    }),
  ]));
  opsGrid.appendChild(el('div', { cls: 'cs-help-card' }, [
    el('div', { cls: 'name', text: '首领全场技能' }),
    el('div', {
      cls: 'desc',
      text:
        '焦虑首领会提供全场移速光环，狂暴时额外提高核心/路障攻击力，并定时召唤焦虑。' +
        '其他首领会提供护盾，狂暴时获得减伤，并定时召唤与自己类型一致的心魔。战斗顶部会持续显示当前首领技能。',
    }),
  ]));
  opsGrid.appendChild(el('div', { cls: 'cs-help-card' }, [
    el('div', { cls: 'name', text: '理智与幻觉' }),
    el('div', {
      cls: 'desc',
      text:
        '理智值低于 30 时，你的塔有概率短暂"幻觉"——胡乱攻击或停火。' +
        '自我接纳塔能持续恢复理智，因此后期不是单纯堆火力，而是要在输出和心理稳定之间取舍。',
    }),
  ]));
  opsGrid.appendChild(el('div', { cls: 'cs-help-card' }, [
    el('div', { cls: 'name', text: '地图经济与塑形' }),
    el('div', {
      cls: 'desc',
      text:
        '塑形不再按波次免费发放，而是每次消耗念力，把普通阻塞格改造成可建造格。' +
        '阻塞区的念力残堆不能直接塑形；塔在没有心魔目标时会攻击残堆，打破后返还念力。',
    }),
  ]));
  opsGrid.appendChild(el('div', { cls: 'cs-help-card' }, [
    el('div', { cls: 'name', text: '审判碑' }),
    el('div', {
      cls: 'desc',
      text:
        '第 6 章会出现审判碑。范围内的首领、嘲讽或护盾精英会吸引塔火力，获得 10% 最大生命护盾，' +
        '并受到约 25% 更少伤害。塔会优先攻击审判碑；先拆碑，或把边界桩放在光环外侧，让精英停在范围外。',
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
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    close();
    onClose();
  };
  window.addEventListener('keydown', onKeyDown);

  function close(): void {
    window.removeEventListener('keydown', onKeyDown);
    handle.close();
  }

  return { close };
}
